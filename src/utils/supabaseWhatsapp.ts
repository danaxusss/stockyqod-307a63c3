import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';
import { normalizePhone } from './phone';

export interface WaSession {
  id: string;
  company_id: string;
  label: string;
  phone_number: string | null;
  status: 'disconnected' | 'pairing' | 'connected';
  qr_data_url: string | null;
  paused: boolean;
  runner_seen_at: string | null;
  daily_cap: number;
  quiet_start: number;
  quiet_end: number;
  delay_mean_sec: number;
  delay_std_sec: number;
}

export interface WaOutbox {
  id: string;
  to_phone: string;
  body: string;
  media_url: string | null;
  status: string;
  ack: number;
  last_error: string | null;
  source: string;
  sent_at: string | null;
  created_at: string;
}

/** A runner is "online" if it heart-beated in the last 30s. */
export function runnerOnline(s: WaSession): boolean {
  if (!s.runner_seen_at) return false;
  return Date.now() - new Date(s.runner_seen_at).getTime() < 30_000;
}

function scoped(table: string) {
  const { companyId, bypassFilter } = getCompanyContext();
  let q = (supabase as any).from(table).select('*');
  if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
  return q;
}

export class WhatsappService {
  // ── Sessions ──────────────────────────────────────────────────────────────
  static async listSessions(): Promise<WaSession[]> {
    const { data, error } = await scoped('wa_sessions').order('created_at');
    if (error) throw error;
    return (data || []) as WaSession[];
  }

  static async ensureSession(): Promise<WaSession> {
    const existing = await this.listSessions();
    if (existing.length) return existing[0];
    const { companyId } = getCompanyContext();
    const { data, error } = await (supabase as any).from('wa_sessions')
      .insert({ company_id: companyId, label: 'Session principale' }).select().single();
    if (error) throw error;
    return data as WaSession;
  }

  static async getSession(id: string): Promise<WaSession | null> {
    const { data, error } = await (supabase as any).from('wa_sessions').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data as WaSession | null;
  }

  static async updateSession(id: string, patch: Partial<WaSession>): Promise<void> {
    const { error } = await (supabase as any).from('wa_sessions').update(patch).eq('id', id);
    if (error) throw error;
  }

  /** Ask the runner to re-pair by clearing the linked state. */
  static async requestRelink(id: string): Promise<void> {
    await this.updateSession(id, { status: 'pairing', qr_data_url: null, phone_number: null } as any);
  }

  // ── Opt-outs ──────────────────────────────────────────────────────────────
  static async isOptedOut(phone: string): Promise<boolean> {
    const { companyId } = getCompanyContext();
    const n = normalizePhone(phone);
    if (!n) return false;
    const { data } = await (supabase as any).from('wa_opt_outs')
      .select('id').eq('company_id', companyId).eq('phone', n).maybeSingle();
    return !!data;
  }

  static async addOptOut(phone: string, reason = 'manual'): Promise<void> {
    const { companyId } = getCompanyContext();
    const n = normalizePhone(phone);
    if (!n) throw new Error('Numéro invalide');
    const { error } = await (supabase as any).from('wa_opt_outs')
      .upsert({ company_id: companyId, phone: n, reason }, { onConflict: 'company_id,phone' });
    if (error) throw error;
  }

  // ── Test send (Phase 1) ───────────────────────────────────────────────────
  static async sendTest(sessionId: string, phone: string, body: string, createdBy: string | null, mediaUrl: string | null = null): Promise<void> {
    const { companyId } = getCompanyContext();
    const n = normalizePhone(phone);
    if (!n) throw new Error('Numéro invalide — vérifiez le format (ex. 0612345678 ou +212612345678)');
    if (!body.trim() && !mediaUrl) throw new Error('Message vide');
    if (await this.isOptedOut(n)) throw new Error('Ce numéro est dans la liste de désinscription');
    const { error } = await (supabase as any).from('wa_outbox').insert({
      company_id: companyId, session_id: sessionId, to_phone: n, body: body.trim(),
      media_url: mediaUrl, source: 'test', created_by: createdBy,
    });
    if (error) throw error;
  }

  static async recentOutbox(sessionId: string, limit = 20): Promise<WaOutbox[]> {
    const { data, error } = await (supabase as any).from('wa_outbox')
      .select('id, to_phone, body, media_url, status, ack, last_error, source, sent_at, created_at')
      .eq('session_id', sessionId).order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return (data || []) as WaOutbox[];
  }

  static async recentEvents(sessionId: string, limit = 20): Promise<any[]> {
    const { data, error } = await (supabase as any).from('wa_events')
      .select('id, type, payload, created_at').eq('session_id', sessionId)
      .order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return data || [];
  }

  /** Inbound replies captured by the runner (wa_events type = 'inbound'). */
  static async recentInbound(sessionId: string, limit = 15): Promise<WaInbound[]> {
    const { data, error } = await (supabase as any).from('wa_events')
      .select('id, payload, created_at').eq('session_id', sessionId).eq('type', 'inbound')
      .order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return (data || []).map((e: any) => ({
      id: e.id,
      from: e.payload?.from || '',
      body: e.payload?.body || '',
      created_at: e.created_at,
    }));
  }

  /** Today's queue health: sent so far, still queued, failed today. */
  static async queueStats(sessionId: string): Promise<QueueStats> {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const count = (q: any) => q.then((r: any) => r.count || 0);
    const base = () => (supabase as any).from('wa_outbox').select('id', { count: 'exact', head: true }).eq('session_id', sessionId);
    const [sentToday, queued, failedToday] = await Promise.all([
      count(base().eq('status', 'sent').gte('sent_at', start.toISOString())),
      count(base().in('status', ['pending', 'sending'])),
      count(base().eq('status', 'failed').gte('created_at', start.toISOString())),
    ]);
    return { sentToday, queued, failedToday };
  }
}

export interface WaInbound { id: string; from: string; body: string; created_at: string }
export interface QueueStats { sentToday: number; queued: number; failedToday: number }
