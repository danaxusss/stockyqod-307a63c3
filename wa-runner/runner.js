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

// WhatsApp message ids come in several shapes across library versions:
// "true_2126…@c.us_3EB0…", { _serialized }, { id }. We correlate acks on the
// trailing hex token, which is stable in all of them.
function msgIdForms(raw) {
  if (!raw) return { full: null, hex: null };
  const full = typeof raw === 'string' ? raw : (raw._serialized || raw.id || null);
  if (!full) return { full: null, hex: null };
  const parts = String(full).split('_');
  return { full: String(full), hex: parts[parts.length - 1] || String(full) };
}

// Apply an ack to the outbox. Acks may arrive out of order — only ever raise.
// Matching order: exact id → trailing-hex → most recent sent row to that phone.
async function applyAck(rawId, phone, ack) {
  const { full, hex } = msgIdForms(rawId);
  if (full) {
    const { data } = await db.from('wa_outbox').update({ ack })
      .eq('wa_message_id', full).lt('ack', ack).select('id');
    if (data && data.length) return true;
  }
  if (hex) {
    const { data } = await db.from('wa_outbox').update({ ack })
      .like('wa_message_id', '%' + hex).lt('ack', ack).select('id');
    if (data && data.length) return true;
  }
  if (phone) {
    const { data: row } = await db.from('wa_outbox').select('id')
      .eq('session_id', CFG.sessionId).eq('to_phone', phone)
      .eq('status', 'sent').lt('ack', ack)
      .order('sent_at', { ascending: false }).limit(1).maybeSingle();
    if (row) { await db.from('wa_outbox').update({ ack }).eq('id', row.id); return true; }
  }
  return false;
}

// Catch up on acks that arrived while the runner was offline: re-read the
// last messages of every chat we recently sent to and re-apply their acks.
async function reconcileAcks() {
  try {
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    const { data: rows } = await db.from('wa_outbox')
      .select('id, to_phone, wa_message_id, ack')
      .eq('session_id', CFG.sessionId).eq('status', 'sent')
      .lt('ack', 3).gte('sent_at', since)
      .order('sent_at', { ascending: false }).limit(200);
    if (!rows || !rows.length) return;
    const phones = [...new Set(rows.map(r => r.to_phone))];
    let fixed = 0;
    for (const phone of phones.slice(0, 50)) {
      try {
        const chat = await client.getChatById(toDigits(phone) + '@c.us');
        const msgs = await chat.fetchMessages({ limit: 20, fromMe: true });
        for (const m of msgs) {
          if (typeof m.ack === 'number' && m.ack > 0) {
            if (await applyAck(m.id, phone, m.ack)) fixed++;
          }
        }
      } catch { /* chat may not exist anymore */ }
      await sleep(400);
    }
    if (fixed) log(`reconciled ${fixed} ack(s) missed while offline`);
  } catch (e) { log('reconcile error:', e && e.message); }
}

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
async function setContactValidity(phone, status) {
  await db.from('wa_contacts')
    .update({ wa_status: status, wa_checked_at: new Date().toISOString() })
    .eq('company_id', CFG.companyId).eq('phone', phone);
}

// ── app → runner commands (wa_commands) ─────────────────────────────────────
async function processCommands() {
  if (!clientReady) return;
  const { data: cmd } = await db.from('wa_commands')
    .select('*').eq('session_id', CFG.sessionId).eq('status', 'pending')
    .order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (!cmd) return;
  const { data: claimed } = await db.from('wa_commands')
    .update({ status: 'running' }).eq('id', cmd.id).eq('status', 'pending').select().maybeSingle();
  if (!claimed) return;

  try {
    if (cmd.type === 'validate_numbers') {
      const phones = Array.isArray(cmd.payload && cmd.payload.phones) ? cmd.payload.phones : [];
      let valid = 0, invalid = 0;
      log(`validating ${phones.length} number(s)…`);
      for (const phone of phones) {
        try {
          const id = await client.getNumberId(toDigits(phone));
          await setContactValidity(phone, id ? 'valid' : 'invalid');
          id ? valid++ : invalid++;
        } catch { /* leave unchecked on transient errors */ }
        await sleep(600 + Math.random() * 500); // gentle pace — these are lookups
      }
      await db.from('wa_commands').update({ status: 'done', result: { checked: phones.length, valid, invalid } }).eq('id', cmd.id);
      log(`validation done: ${valid} valid, ${invalid} invalid`);
    } else {
      await db.from('wa_commands').update({ status: 'failed', result: { error: 'unknown command type' } }).eq('id', cmd.id);
    }
  } catch (e) {
    await db.from('wa_commands').update({ status: 'failed', result: { error: String(e && e.message || e) } }).eq('id', cmd.id);
  }
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
    // when the number simply isn't registered on WhatsApp — a permanent
    // condition: fail immediately (no retries) and remember it on the contact.
    const numberId = await client.getNumberId(toDigits(job.to_phone));
    if (!numberId) {
      await db.from('wa_outbox').update({ status: 'failed', last_error: 'not registered on WhatsApp' }).eq('id', job.id);
      await setContactValidity(job.to_phone, 'invalid');
      log(`skip (no WhatsApp) → ${job.to_phone}`);
      return;
    }
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
    const msgId = msgIdForms(sent && sent.id).full;

    await db.from('wa_outbox').update({ status: 'sent', sent_at: new Date().toISOString(), wa_message_id: msgId, last_error: null }).eq('id', job.id);
    await setContactValidity(job.to_phone, 'valid');
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

// retention: purge old rows so the tables don't grow forever.
// events (acks, inbound, status) after 30 days; test/manual outbox after 90.
// campaign outbox rows are kept — they back the campaign stats.
async function purgeOld() {
  const days = (n) => new Date(Date.now() - n * 86400_000).toISOString();
  await db.from('wa_events').delete()
    .eq('session_id', CFG.sessionId).lt('created_at', days(30));
  await db.from('wa_outbox').delete()
    .eq('session_id', CFG.sessionId).is('campaign_id', null)
    .in('status', ['sent', 'failed', 'cancelled']).lt('created_at', days(90));
}

async function loop() {
  let lastPurge = 0;
  while (running) {
    try {
      await heartbeat(); await processOutbox(); await processCommands();
      if (Date.now() - lastPurge > 6 * 3600_000) {
        lastPurge = Date.now();
        purgeOld().catch(e => log('purge error:', e && e.message));
      }
    }
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
    // catch up on delivery/read receipts that arrived while we were offline
    reconcileAcks();
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
      if (typeof ack !== 'number' || ack < 1) return;
      const to = msg.to && String(msg.to).endsWith('@c.us') ? '+' + String(msg.to).replace(/@c\.us$/, '') : null;
      const matched = await applyAck(msg.id, to, ack);
      if (!matched) log(`ack ${ack} unmatched (${to || 'unknown'})`);
    } catch { /* */ }
  });

  // inbound messages (ignore our own and group traffic)
  const STOP_WORDS = /^\s*(stop|arret|arrêt|arreter|arrêter|desinscription|désinscription|desabonner|désabonner|unsubscribe|no)\s*[.!]?\s*$/i;
  client.on('message', async (m) => {
    try {
      // only direct chats from real numbers (@c.us) — skips groups (@g.us),
      // status, channels/newsletters and anonymized @lid senders
      if (m.fromMe || !String(m.from).endsWith('@c.us')) return;
      const phone = '+' + String(m.from).replace(/@c\.us$/, '');
      await emit('inbound', { from: phone, body: m.body || '', type: m.type });
      // auto opt-out: a STOP-like reply immediately blocks all future sends
      if (m.body && STOP_WORDS.test(m.body)) {
        await db.from('wa_opt_outs').upsert(
          { company_id: CFG.companyId, phone, reason: 'stop-reply' },
          { onConflict: 'company_id,phone' }
        );
        await emit('opt_out', { phone, via: 'stop-reply', body: m.body });
        log(`opt-out (STOP) ← ${phone}`);
      }
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
