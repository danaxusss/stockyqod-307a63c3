import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';
import { WaContactsService, matchSegment, type WaContact, type SegmentFilter } from './supabaseWaContacts';

export interface WaTemplate {
  id: string; name: string; body: string;
  media_url: string | null; cta_label: string | null; cta_url: string | null;
}

export interface WaCampaign {
  id: string;
  name: string;
  session_id: string | null;
  body: string;
  media_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  segment_filter: SegmentFilter;
  status: 'draft' | 'scheduled' | 'running' | 'paused' | 'done' | 'cancelled';
  scheduled_at: string | null;
  total_recipients: number;
  created_at: string;
}

export interface CampaignStats { total: number; queued: number; sent: number; delivered: number; read: number; failed: number; blocked: number }

/** Fill {{name}}, {{phone}}, {{field}} from a contact; unknown vars → ''. Appends CTA link. */
export function renderMessage(body: string, contact: { name?: string | null; phone: string; custom?: Record<string, any> }, cta?: { label?: string | null; url?: string | null }): string {
  let out = (body || '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key: string) => {
    const k = key.toLowerCase();
    if (k === 'name' || k === 'nom') return contact.name || '';
    if (k === 'phone' || k === 'tel') return contact.phone || '';
    const v = contact.custom?.[key] ?? contact.custom?.[k];
    return v == null ? '' : String(v);
  }).replace(/\n{3,}/g, '\n\n');
  if (cta?.url) out += `\n\n${cta.label ? cta.label + ' : ' : ''}${cta.url}`;
  return out.trim();
}

/** Variable names referenced by a template body (for the studio helper). */
export function extractVars(body: string): string[] {
  const set = new Set<string>();
  for (const m of (body || '').matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) set.add(m[1]);
  return Array.from(set);
}

function scoped(table: string) {
  const { companyId, bypassFilter } = getCompanyContext();
  let q = (supabase as any).from(table).select('*');
  if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
  return q;
}

export class WaCampaignsService {
  // ── Templates ─────────────────────────────────────────────────────────────
  static async listTemplates(): Promise<WaTemplate[]> {
    const { data, error } = await scoped('wa_templates').order('name');
    if (error) throw error;
    return (data || []) as WaTemplate[];
  }
  static async saveTemplate(t: Partial<WaTemplate> & { name: string }): Promise<void> {
    const { companyId } = getCompanyContext();
    if (t.id) {
      const { error } = await (supabase as any).from('wa_templates').update({
        name: t.name, body: t.body ?? '', media_url: t.media_url ?? null, cta_label: t.cta_label ?? null, cta_url: t.cta_url ?? null,
      }).eq('id', t.id);
      if (error) throw error;
    } else {
      const { error } = await (supabase as any).from('wa_templates').insert({
        company_id: companyId, name: t.name, body: t.body ?? '', media_url: t.media_url ?? null, cta_label: t.cta_label ?? null, cta_url: t.cta_url ?? null,
      });
      if (error) throw error;
    }
  }
  static async deleteTemplate(id: string): Promise<void> {
    const { error } = await (supabase as any).from('wa_templates').delete().eq('id', id);
    if (error) throw error;
  }

  static async uploadMedia(file: File): Promise<string> {
    const path = `wa-media/${crypto.randomUUID()}.${(file.name.split('.').pop() || 'jpg')}`;
    const { error } = await supabase.storage.from('product-photos').upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
    if (error) throw error;
    return supabase.storage.from('product-photos').getPublicUrl(path).data.publicUrl;
  }

  // ── Campaigns ─────────────────────────────────────────────────────────────
  static async listCampaigns(): Promise<WaCampaign[]> {
    const { data, error } = await scoped('wa_campaigns').order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []) as WaCampaign[];
  }
  static async getCampaign(id: string): Promise<WaCampaign | null> {
    const { data, error } = await (supabase as any).from('wa_campaigns').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data as WaCampaign | null;
  }
  static async saveCampaign(c: Partial<WaCampaign> & { name: string }): Promise<WaCampaign> {
    const { companyId } = getCompanyContext();
    const payload = {
      name: c.name, session_id: c.session_id ?? null, body: c.body ?? '', media_url: c.media_url ?? null,
      cta_label: c.cta_label ?? null, cta_url: c.cta_url ?? null, segment_filter: c.segment_filter ?? {},
      scheduled_at: c.scheduled_at ?? null,
    };
    if (c.id) {
      const { data, error } = await (supabase as any).from('wa_campaigns').update(payload).eq('id', c.id).select().single();
      if (error) throw error;
      return data as WaCampaign;
    }
    const { data, error } = await (supabase as any).from('wa_campaigns').insert({ company_id: companyId, status: 'draft', ...payload }).select().single();
    if (error) throw error;
    return data as WaCampaign;
  }
  static async deleteCampaign(id: string): Promise<void> {
    // remove any pending outbox first, then the campaign (recipients cascade)
    await (supabase as any).from('wa_outbox').delete().eq('campaign_id', id).in('status', ['pending', 'cancelled']);
    const { error } = await (supabase as any).from('wa_campaigns').delete().eq('id', id);
    if (error) throw error;
  }

  /** Contacts matched by a campaign's segment, minus opted-out ones. */
  static async resolveAudience(filter: SegmentFilter): Promise<WaContact[]> {
    const [contacts, outs] = await Promise.all([WaContactsService.list(), WaContactsService.listOptOuts()]);
    const optedOut = new Set(outs.map(o => o.phone));
    return contacts.filter(c => !optedOut.has(c.phone) && matchSegment(c, filter));
  }

  /**
   * Launch (or resume): materialize recipients (at-most-once) and enqueue
   * personalized messages into wa_outbox. Already-sent phones are skipped.
   */
  static async launch(campaignId: string, createdBy: string | null): Promise<{ enqueued: number; skipped: number }> {
    const { companyId } = getCompanyContext();
    const c = await this.getCampaign(campaignId);
    if (!c) throw new Error('Campagne introuvable');
    if (!c.session_id) throw new Error('Aucune session WhatsApp associée');
    if (!c.body.trim() && !c.media_url) throw new Error('Message vide');

    const audience = await this.resolveAudience(c.segment_filter);
    if (!audience.length) throw new Error('Audience vide (segment sans contact joignable)');

    // phones already sent for this campaign (safe re-launch / resume)
    const { data: sentRows } = await (supabase as any).from('wa_outbox')
      .select('to_phone').eq('campaign_id', campaignId).in('status', ['sent', 'sending']);
    const alreadySent = new Set((sentRows || []).map((r: any) => r.to_phone));
    // existing recipients (the at-most-once ledger)
    const { data: recRows } = await (supabase as any).from('wa_campaign_recipients').select('phone').eq('campaign_id', campaignId);
    const existingRec = new Set((recRows || []).map((r: any) => r.phone));

    const scheduledAt = c.scheduled_at && new Date(c.scheduled_at) > new Date() ? c.scheduled_at : new Date().toISOString();
    let enqueued = 0, skipped = 0;

    for (let i = 0; i < audience.length; i += 200) {
      const batch = audience.slice(i, i + 200);
      const recPayload: any[] = [];
      const outPayload: { phone: string; body: string; contact_id: string }[] = [];
      for (const ct of batch) {
        if (alreadySent.has(ct.phone)) { skipped++; continue; }
        const body = renderMessage(c.body, ct, { label: c.cta_label, url: c.cta_url });
        if (!existingRec.has(ct.phone)) {
          recPayload.push({ campaign_id: campaignId, company_id: companyId, contact_id: ct.id, phone: ct.phone, name: ct.name, body });
        }
        outPayload.push({ phone: ct.phone, body, contact_id: ct.id });
      }
      if (recPayload.length) {
        await (supabase as any).from('wa_campaign_recipients')
          .upsert(recPayload, { onConflict: 'campaign_id,phone', ignoreDuplicates: true });
      }
      if (outPayload.length) {
        const rows = outPayload.map(o => ({
          company_id: companyId, session_id: c.session_id, to_phone: o.phone, body: o.body,
          media_url: c.media_url, source: 'campaign', campaign_id: campaignId,
          scheduled_at: scheduledAt, created_by: createdBy,
        }));
        const { error } = await (supabase as any).from('wa_outbox').insert(rows);
        if (error) throw new Error(error.message);
        enqueued += rows.length;
      }
    }

    const status = c.scheduled_at && new Date(c.scheduled_at) > new Date() ? 'scheduled' : 'running';
    await (supabase as any).from('wa_campaigns').update({ status, total_recipients: audience.length }).eq('id', campaignId);
    return { enqueued, skipped };
  }

  /** Pause: cancel pending (not-yet-sent) outbox rows for this campaign. */
  static async pause(campaignId: string): Promise<void> {
    await (supabase as any).from('wa_outbox').update({ status: 'cancelled' }).eq('campaign_id', campaignId).eq('status', 'pending');
    await (supabase as any).from('wa_campaigns').update({ status: 'paused' }).eq('id', campaignId);
  }

  static async cancel(campaignId: string): Promise<void> {
    await (supabase as any).from('wa_outbox').update({ status: 'cancelled' }).eq('campaign_id', campaignId).eq('status', 'pending');
    await (supabase as any).from('wa_campaigns').update({ status: 'cancelled' }).eq('id', campaignId);
  }

  /**
   * Fix statuses the runner never maintains: 'scheduled' → 'running' once
   * sending has actually started, and either → 'done' once nothing is queued.
   * Returns the campaigns with corrected statuses.
   */
  static async syncStatuses(campaigns: WaCampaign[]): Promise<WaCampaign[]> {
    const active = campaigns.filter(c => c.status === 'running' || c.status === 'scheduled');
    if (!active.length) return campaigns;
    const { data } = await (supabase as any).from('wa_outbox')
      .select('campaign_id, status').in('campaign_id', active.map(c => c.id));
    const agg = new Map<string, { queued: number; started: boolean; total: number }>();
    for (const r of (data || []) as { campaign_id: string; status: string }[]) {
      const a = agg.get(r.campaign_id) || { queued: 0, started: false, total: 0 };
      a.total++;
      if (r.status === 'pending' || r.status === 'sending') a.queued++;
      if (r.status === 'sent' || r.status === 'failed' || r.status === 'blocked') a.started = true;
      agg.set(r.campaign_id, a);
    }
    const flips = new Map<string, WaCampaign['status']>();
    for (const c of active) {
      const a = agg.get(c.id);
      if (!a || !a.total) continue;
      if (a.queued === 0) flips.set(c.id, 'done');
      else if (c.status === 'scheduled' && a.started) flips.set(c.id, 'running');
    }
    await Promise.all(Array.from(flips, ([id, status]) =>
      (supabase as any).from('wa_campaigns').update({ status }).eq('id', id)));
    return campaigns.map(c => flips.has(c.id) ? { ...c, status: flips.get(c.id)! } : c);
  }

  static async stats(campaignId: string): Promise<CampaignStats> {
    const { data } = await (supabase as any).from('wa_outbox').select('status, ack').eq('campaign_id', campaignId);
    const rows = (data || []) as { status: string; ack: number }[];
    const s: CampaignStats = { total: rows.length, queued: 0, sent: 0, delivered: 0, read: 0, failed: 0, blocked: 0 };
    for (const r of rows) {
      if (r.status === 'pending' || r.status === 'sending') s.queued++;
      else if (r.status === 'sent') { s.sent++; if (r.ack >= 2) s.delivered++; if (r.ack >= 3) s.read++; }
      else if (r.status === 'failed') s.failed++;
      else if (r.status === 'blocked') s.blocked++;
    }
    return s;
  }
}
