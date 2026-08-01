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
 * Config comes from config.json (copied from config.example.json) or env vars.
 * Nothing here trusts the network for auth — it uses the Supabase service key,
 * so keep config.json on the machine only.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { createClient } = require('@supabase/supabase-js');
const wa = require('@open-wa/wa-automate');

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
    // Use the real Google Chrome (recommended by open-wa for multi-device).
    // Set to false in config.json to fall back to the bundled Chromium.
    useChrome: cfg.useChrome === undefined ? true : !!cfg.useChrome,
    // Show the browser window (helps first-time pairing on some machines).
    headless: cfg.headless === undefined ? true : !!cfg.headless,
    // Optional explicit path to chrome.exe if auto-detection fails.
    executablePath: process.env.WA_CHROME_PATH || cfg.executablePath || undefined,
    // open-wa 4.76 ships an outdated User-Agent that WhatsApp Web now rejects
    // ("works with Chrome 100 or later"). Force a modern one so the QR loads.
    userAgent: cfg.userAgent ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
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
// WhatsApp chatId from an E.164 phone (+2126… → 2126…@c.us).
const toChatId = (phone) => phone.replace(/[^\d]/g, '') + '@c.us';

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
let running = true;

async function processOutbox() {
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
    const chatId = toChatId(job.to_phone);
    let res;
    if (job.media_url) res = await client.sendImage(chatId, job.media_url, 'file', job.body || '');
    else res = await client.sendText(chatId, job.body);
    const msgId = typeof res === 'string' ? res : (res && res._serialized) || null;
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
  try {
    client = await wa.create({
      sessionId: `stocky_${CFG.sessionId}`,
      multiDevice: true,
      useChrome: CFG.useChrome,
      executablePath: CFG.executablePath,
      headless: CFG.headless,
      customUserAgent: CFG.userAgent,
      qrTimeout: 0,
      authTimeout: 0,
      cacheEnabled: false,
      disableSpins: true,
      qrLogSkip: true,
      killProcessOnBrowserClose: true,
      sessionDataPath: path.join(__dirname, '.sessions'),
      catchQR: async (base64Qr) => {
        // base64Qr is already a data URL from open-wa; store it for the UI
        try {
          const dataUrl = base64Qr.startsWith('data:') ? base64Qr : `data:image/png;base64,${base64Qr}`;
          await patchSession({ status: 'pairing', qr_data_url: dataUrl });
          log('QR published — scan it from the Connection Center.');
        } catch (e) { log('QR publish error:', e && e.message); }
      },
    });

    client.onAck(async (msg) => {
      try {
        const id = msg.id && (msg.id._serialized || msg.id);
        if (id) await db.from('wa_outbox').update({ ack: msg.ack }).eq('wa_message_id', id);
        await emit('ack', { message_id: id, ack: msg.ack });
      } catch { /* */ }
    });
    client.onMessage(async (m) => {
      try {
        if (m.fromMe || m.isGroupMsg) return;
        const phone = '+' + String(m.from).replace(/@c\.us$/, '');
        await emit('inbound', { from: phone, body: m.body || '', type: m.type });
      } catch { /* */ }
    });
    client.onStateChanged(async (state) => {
      log('state:', state);
      if (state === 'CONNECTED') await patchSession({ status: 'connected', qr_data_url: null });
      if (['UNPAIRED', 'UNPAIRED_IDLE', 'CONFLICT'].includes(state)) {
        await patchSession({ status: 'disconnected' });
        await emit('disconnected', { state });
      }
    });

    const info = await client.getHostDevice().catch(() => null);
    const phone = info && info.id && info.id.user ? '+' + info.id.user : null;
    await patchSession({ status: 'connected', phone_number: phone, qr_data_url: null });
    await emit('connected', { phone });
    log('Connected as', phone || '(unknown)');
    loop();
  } catch (e) {
    log('fatal:', e && e.message);
    await patchSession({ status: 'disconnected' }).catch(() => {});
    process.exit(1);
  }
}

process.on('SIGINT', async () => { running = false; log('Shutting down…'); await patchSession({ status: 'disconnected' }).catch(() => {}); process.exit(0); });

main();
