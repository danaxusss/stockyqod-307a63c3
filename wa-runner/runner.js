/**
 * Stocky WhatsApp runner (Phase 1)
 * ---------------------------------
 * Runs on the office PC (or later a VPS). One process = one WhatsApp session.
 *
 *  • Publishes the pairing QR + live status/heartbeat into `wa_sessions`.
 *  • Polls `wa_outbox` for pending messages, sends them with humanized
 *    Gaussian delays, honouring the session's daily cap and quiet hours.
 *  • Re-checks the opt-out list at the last mile before every send.
 *  • Reports acks (sent/delivered/read) and inbound messages into `wa_events`.
 *
 * Engine: whatsapp-web.js (free, MIT, actively maintained). Unlike open-wa it
 * sends to any number that is on WhatsApp — including numbers that are not in
 * the phone's contacts — via getNumberId(), which is what marketing needs.
 *
 * Config comes from config.json (copied from config.example.json) or env vars.
 * Nothing here trusts the network for auth — it uses the Supabase service key,
 * so keep config.json on the machine only.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { createClient } = require('@supabase/supabase-js');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

// ── config ──────────────────────────────────────────────────────────────────
function loadConfig() {
  const file = path.join(__dirname, 'config.json');
  let cfg = {};
  if (fs.existsSync(file)) cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    supabaseUrl: process.env.SUPABASE_URL || cfg.supabaseUrl,
    serviceKey: process.env.SUPABASE_SERVICE_KEY || cfg.serviceKey,
    sessionId: process.env.WA_SESSION_ID || cfg.sessionId,
    companyId: process.env.WA_COMPANY_ID || cfg.companyId,
    pollMs: Number(process.env.WA_POLL_MS || cfg.pollMs || 5000),
    // Show the browser window (helps first-time pairing on some machines).
    headless: cfg.headless === undefined ? true : !!cfg.headless,
    // Optional explicit path to chrome.exe. If empty, whatsapp-web.js uses the
    // Chromium that ships with its puppeteer dependency.
    executablePath: process.env.WA_CHROME_PATH || cfg.executablePath || undefined,
  };
}
const CFG = loadConfig();
for (const k of ['supabaseUrl', 'serviceKey', 'sessionId', 'companyId']) {
  if (!CFG[k]) { console.error(`\n[config] Missing "${k}". Copy config.example.json → config.json and fill it in.\n`); process.exit(1); }
}
const db = createClient(CFG.supabaseUrl, CFG.serviceKey, { auth: { persistSession: false } });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ── helpers ─────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Gaussian (Box–Muller), clamped so we never go below a floor.
function gaussianDelayMs(meanSec, stdSec) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  const sec = Math.max(8, meanSec + z * stdSec);
  return Math.round(sec * 1000);
}
// Digits only, no leading + (+2126… → 2126…), for getNumberId().
const toDigits = (phone) => String(phone).replace(/[^\d]/g, '');

async function getSession() {
  const { data, error } = await db.from('wa_sessions').select('*').eq('id', CFG.sessionId).single();
  if (error) throw error;
  return data;
}
async function patchSession(patch) {
  await db.from('wa_sessions').update(patch).eq('id', CFG.sessionId);
}
async function emit(type, payload) {
  await db.from('wa_events').insert({ company_id: CFG.companyId, session_id: CFG.sessionId, type, payload });
}
async function heartbeat() {
  await patchSession({ runner_seen_at: new Date().toISOString() });
}

// today's already-sent count (for the daily cap)
async function sentToday() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const { count } = await db.from('wa_outbox')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', CFG.sessionId).eq('status', 'sent').gte('sent_at', start.toISOString());
  return count || 0;
}
function inQuietHours(qStart, qEnd) {
  const h = new Date().getHours();
  // window may wrap midnight (e.g. 21 → 9)
  return qStart <= qEnd ? (h >= qStart && h < qEnd) : (h >= qStart || h < qEnd);
}
async function isOptedOut(phone) {
  const { data } = await db.from('wa_opt_outs').select('id').eq('company_id', CFG.companyId).eq('phone', phone).maybeSingle();
  return !!data;
}

// ── send loop ───────────────────────────────────────────────────────────────
let client = null;
let clientReady = false;
let running = true;

async function processOutbox() {
  if (!clientReady) return;
  const s = await getSession();
  if (s.paused || s.status !== 'connected') return;
  if (inQuietHours(s.quiet_start, s.quiet_end)) return;
  if (await sentToday() >= s.daily_cap) return;

  const { data: job } = await db.from('wa_outbox')
    .select('*').eq('session_id', CFG.sessionId).eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true }).limit(1).maybeSingle();
  if (!job) return;

  // claim it (optimistic — status guard prevents double-send across restarts)
  const { data: claimed } = await db.from('wa_outbox')
    .update({ status: 'sending', attempts: job.attempts + 1 })
    .eq('id', job.id).eq('status', 'pending').select().maybeSingle();
  if (!claimed) return;

  // last-mile opt-out re-check
  if (await isOptedOut(job.to_phone)) {
    await db.from('wa_outbox').update({ status: 'blocked', last_error: 'opt-out' }).eq('id', job.id);
    return;
  }

  try {
    // Resolve the number on WhatsApp. Works for non-contacts too; returns null
    // when the number simply isn't registered on WhatsApp.
    const numberId = await client.getNumberId(toDigits(job.to_phone));
    if (!numberId) throw new Error('Number not registered on WhatsApp');
    const chatId = numberId._serialized;

    let sent;
    if (job.media_url) {
      const media = await MessageMedia.fromUrl(job.media_url, { unsafeMime: true });
      sent = await client.sendMessage(chatId, media, { caption: job.body || '' });
    } else {
      sent = await client.sendMessage(chatId, job.body);
    }

    // With whatsapp-web.js, a resolved sendMessage() means the message was
    // accepted — a real failure throws and is caught below. The message id is
    // only used later to correlate acks, so extract it best-effort and never
    // fail the send just because the id shape differs across library versions.
    const rawId = sent && sent.id;
    const msgId = !rawId ? null
      : (typeof rawId === 'string' ? rawId
        : (rawId._serialized || rawId.id || null));

    await db.from('wa_outbox').update({ status: 'sent', sent_at: new Date().toISOString(), wa_message_id: msgId, last_error: null }).eq('id', job.id);
    log(`sent → ${job.to_phone}`);
    // humanized pause before the next one
    await sleep(gaussianDelayMs(s.delay_mean_sec, s.delay_std_sec));
  } catch (e) {
    const failed = job.attempts + 1 >= 3;
    await db.from('wa_outbox').update({ status: failed ? 'failed' : 'pending', last_error: String(e && e.message || e) }).eq('id', job.id);
    log(`send error → ${job.to_phone}: ${e && e.message}`);
    await emit('error', { outbox_id: job.id, error: String(e && e.message || e) });
  }
}

async function loop() {
  while (running) {
    try { await heartbeat(); await processOutbox(); }
    catch (e) { log('loop error:', e && e.message); }
    await sleep(CFG.pollMs);
  }
}

// ── boot ────────────────────────────────────────────────────────────────────
async function main() {
  log('Starting Stocky WA runner for session', CFG.sessionId);
  await patchSession({ status: 'pairing', qr_data_url: null });

  const puppeteerOpts = {
    headless: CFG.headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };
  if (CFG.executablePath) puppeteerOpts.executablePath = CFG.executablePath;

  client = new Client({
    // LocalAuth persists the linked session under .sessions/ so the QR only has
    // to be scanned once. clientId keeps multiple runners isolated on one PC.
    authStrategy: new LocalAuth({
      clientId: `stocky_${CFG.sessionId}`,
      dataPath: path.join(__dirname, '.sessions'),
    }),
    puppeteer: puppeteerOpts,
    takeoverOnConflict: true,
    takeoverTimeoutMs: 10000,
  });

  client.on('qr', async (qr) => {
    try {
      const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      await patchSession({ status: 'pairing', qr_data_url: dataUrl });
      log('QR published — scan it from the Connection Center.');
    } catch (e) { log('QR publish error:', e && e.message); }
  });

  client.on('authenticated', () => log('authenticated — session saved.'));
  client.on('auth_failure', async (m) => {
    log('auth failure:', m);
    await patchSession({ status: 'disconnected' }).catch(() => {});
    await emit('disconnected', { reason: 'auth_failure', detail: String(m) });
  });

  client.on('ready', async () => {
    clientReady = true;
    const wid = client.info && client.info.wid;
    const digits = wid ? String(wid.user || '').replace(/[^\d]/g, '') : '';
    const phone = digits ? '+' + digits : null;
    await patchSession({ status: 'connected', phone_number: phone, qr_data_url: null });
    await emit('connected', { phone });
    log('Connected as', phone || '(unknown)');
  });

  client.on('change_state', (state) => log('state:', state));

  client.on('disconnected', async (reason) => {
    clientReady = false;
    log('disconnected:', reason);
    await patchSession({ status: 'disconnected' }).catch(() => {});
    await emit('disconnected', { reason: String(reason) });
    // whatsapp-web.js tears down the browser on disconnect; exit so the .bat /
    // process manager can restart us and re-establish the session.
    process.exit(1);
  });

  // ack: 1 = sent(server), 2 = delivered, 3 = read, 4 = played (voice)
  client.on('message_ack', async (msg, ack) => {
    try {
      const id = msg.id && (msg.id._serialized || String(msg.id));
      if (id) await db.from('wa_outbox').update({ ack }).eq('wa_message_id', id);
      await emit('ack', { message_id: id, ack });
    } catch { /* */ }
  });

  // inbound messages (ignore our own and group traffic)
  client.on('message', async (m) => {
    try {
      if (m.fromMe || m.from === 'status@broadcast' || String(m.from).endsWith('@g.us')) return;
      const phone = '+' + String(m.from).replace(/@c\.us$/, '');
      await emit('inbound', { from: phone, body: m.body || '', type: m.type });
    } catch { /* */ }
  });

  try {
    await client.initialize();
    loop();
  } catch (e) {
    log('fatal:', e && e.message);
    await patchSession({ status: 'disconnected' }).catch(() => {});
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  running = false;
  log('Shutting down…');
  try { if (client) await client.destroy(); } catch { /* */ }
  await patchSession({ status: 'disconnected' }).catch(() => {});
  process.exit(0);
});

main();
