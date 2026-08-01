import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';
import { normalizePhone } from './phone';

export interface WaContact {
  id: string;
  company_id?: string;
  phone: string;
  name: string | null;
  email: string | null;
  tags: string[];
  custom: Record<string, any>;
  source: string;
  created_at: string;
}

export interface SegmentFilter {
  search?: string;        // matches name / phone / email
  tagsAny?: string[];     // has at least one of
  tagsAll?: string[];     // has all of
  tagsNone?: string[];    // has none of
  hasField?: string;      // custom field present & non-empty
}

export interface WaSegment {
  id: string;
  name: string;
  filter: SegmentFilter;
}

export interface ImportRow { phone: string; name?: string; email?: string; tags?: string[]; custom?: Record<string, any>; }
export interface ImportReport { inserted: number; updated: number; invalid: string[]; optedOut: number; duplicatesInFile: number }

/** Apply a segment filter to an in-memory contact list (also used by campaigns). */
export function matchSegment(c: WaContact, f: SegmentFilter): boolean {
  if (f.search) {
    const q = f.search.toLowerCase();
    const hay = `${c.name || ''} ${c.phone} ${c.email || ''}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  const tags = c.tags || [];
  if (f.tagsAll?.length && !f.tagsAll.every(t => tags.includes(t))) return false;
  if (f.tagsAny?.length && !f.tagsAny.some(t => tags.includes(t))) return false;
  if (f.tagsNone?.length && f.tagsNone.some(t => tags.includes(t))) return false;
  if (f.hasField) {
    const v = c.custom?.[f.hasField];
    if (v == null || v === '') return false;
  }
  return true;
}

export class WaContactsService {
  static async list(): Promise<WaContact[]> {
    const { companyId, bypassFilter } = getCompanyContext();
    const out: WaContact[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      let q = (supabase as any).from('wa_contacts')
        .select('id, phone, name, email, tags, custom, source, created_at')
        .order('created_at', { ascending: false }).range(from, from + PAGE - 1);
      if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
      const { data, error } = await q;
      if (error) throw error;
      out.push(...((data || []) as WaContact[]));
      if (!data || data.length < PAGE) break;
    }
    return out;
  }

  static async upsertOne(c: Partial<WaContact> & { phone: string }): Promise<void> {
    const { companyId } = getCompanyContext();
    const phone = normalizePhone(c.phone);
    if (!phone) throw new Error('Numéro invalide');
    const { error } = await (supabase as any).from('wa_contacts').upsert({
      company_id: companyId, phone, name: c.name ?? null, email: c.email ?? null,
      tags: c.tags ?? [], custom: c.custom ?? {}, source: c.source ?? 'manual',
    }, { onConflict: 'company_id,phone' });
    if (error) throw error;
  }

  static async remove(ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await (supabase as any).from('wa_contacts').delete().in('id', ids.slice(i, i + 200));
      if (error) throw error;
    }
  }

  /** Add/remove tags on many contacts (client passes the merged arrays). */
  static async setTags(updates: { id: string; tags: string[] }[]): Promise<void> {
    for (let i = 0; i < updates.length; i += 100) {
      const batch = updates.slice(i, i + 100);
      const res = await Promise.all(batch.map(u => (supabase as any).from('wa_contacts').update({ tags: u.tags }).eq('id', u.id)));
      const bad = res.find((r: any) => r.error);
      if (bad?.error) throw new Error(bad.error.message);
    }
  }

  /** Bulk import: normalize, dedupe, skip opted-out, upsert (merge tags). */
  static async import(rows: ImportRow[], onProgress: (done: number, total: number) => void): Promise<ImportReport> {
    const { companyId } = getCompanyContext();
    const invalid: string[] = [];
    const seen = new Map<string, ImportRow>();
    let duplicatesInFile = 0;

    for (const r of rows) {
      const phone = normalizePhone(r.phone);
      if (!phone) { invalid.push(r.phone || '(vide)'); continue; }
      if (seen.has(phone)) { duplicatesInFile++; const prev = seen.get(phone)!; // merge tags
        prev.tags = Array.from(new Set([...(prev.tags || []), ...(r.tags || [])]));
        continue;
      }
      seen.set(phone, { ...r, phone });
    }

    // opted-out set for this company
    const { data: outs } = await (supabase as any).from('wa_opt_outs').select('phone').eq('company_id', companyId);
    const optedOutSet = new Set((outs || []).map((o: any) => o.phone));

    // existing contacts (to merge tags rather than overwrite)
    const existing = await this.list();
    const existingByPhone = new Map(existing.map(c => [c.phone, c]));

    const payload: any[] = [];
    let optedOut = 0, updated = 0;
    for (const [phone, r] of seen) {
      if (optedOutSet.has(phone)) { optedOut++; continue; }
      const prev = existingByPhone.get(phone);
      if (prev) updated++;
      payload.push({
        company_id: companyId, phone,
        name: r.name ?? prev?.name ?? null,
        email: r.email ?? prev?.email ?? null,
        tags: Array.from(new Set([...(prev?.tags || []), ...(r.tags || [])])),
        custom: { ...(prev?.custom || {}), ...(r.custom || {}) },
        source: 'import',
      });
    }

    let done = 0;
    for (let i = 0; i < payload.length; i += 500) {
      const batch = payload.slice(i, i + 500);
      const { error } = await (supabase as any).from('wa_contacts').upsert(batch, { onConflict: 'company_id,phone' });
      if (error) throw new Error(error.message);
      done += batch.length;
      onProgress(done, payload.length);
    }
    return { inserted: payload.length - updated, updated, invalid, optedOut, duplicatesInFile };
  }

  // ── Segments ────────────────────────────────────────────────────────────
  static async listSegments(): Promise<WaSegment[]> {
    const { companyId, bypassFilter } = getCompanyContext();
    let q = (supabase as any).from('wa_segments').select('id, name, filter').order('name');
    if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []) as WaSegment[];
  }

  static async saveSegment(name: string, filter: SegmentFilter, id?: string): Promise<void> {
    const { companyId } = getCompanyContext();
    if (id) {
      const { error } = await (supabase as any).from('wa_segments').update({ name, filter }).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await (supabase as any).from('wa_segments').insert({ company_id: companyId, name, filter });
      if (error) throw error;
    }
  }

  static async deleteSegment(id: string): Promise<void> {
    const { error } = await (supabase as any).from('wa_segments').delete().eq('id', id);
    if (error) throw error;
  }

  // ── Opt-outs ────────────────────────────────────────────────────────────
  static async listOptOuts(): Promise<{ phone: string; reason: string; created_at: string }[]> {
    const { companyId, bypassFilter } = getCompanyContext();
    let q = (supabase as any).from('wa_opt_outs').select('phone, reason, created_at').order('created_at', { ascending: false });
    if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  static async addOptOut(phone: string, reason = 'manual'): Promise<void> {
    const { companyId } = getCompanyContext();
    const n = normalizePhone(phone);
    if (!n) throw new Error('Numéro invalide');
    const { error } = await (supabase as any).from('wa_opt_outs')
      .upsert({ company_id: companyId, phone: n, reason }, { onConflict: 'company_id,phone' });
    if (error) throw error;
  }

  static async removeOptOut(phone: string): Promise<void> {
    const { companyId } = getCompanyContext();
    const { error } = await (supabase as any).from('wa_opt_outs').delete().eq('company_id', companyId).eq('phone', phone);
    if (error) throw error;
  }

  /** Bulk opt-out import (from a CSV of numbers). */
  static async importOptOuts(phones: string[]): Promise<number> {
    const { companyId } = getCompanyContext();
    const rows = Array.from(new Set(phones.map(p => normalizePhone(p)).filter(Boolean) as string[]))
      .map(phone => ({ company_id: companyId, phone, reason: 'import' }));
    if (!rows.length) return 0;
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await (supabase as any).from('wa_opt_outs').upsert(rows.slice(i, i + 500), { onConflict: 'company_id,phone' });
      if (error) throw error;
    }
    return rows.length;
  }
}
