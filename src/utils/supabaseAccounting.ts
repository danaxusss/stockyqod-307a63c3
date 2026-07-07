import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';
import { PCM_SEED, DEFAULT_JOURNALS } from '../accounting/pcmSeed';
import type { Account, FiscalYear, Journal, JournalEntry, JournalEntryLine } from '../types';

function scope<T>(q: any): any {
  const { companyId, bypassFilter } = getCompanyContext();
  if (!bypassFilter && companyId) return q.eq('company_id', companyId);
  return q;
}

export class AccountingService {
  // ── Fiscal years ──────────────────────────────────────────────────────────
  static async listFiscalYears(): Promise<FiscalYear[]> {
    const { data, error } = await scope((supabase as any).from('accounting_fiscal_years').select('*').order('start_date', { ascending: false }));
    if (error) throw error;
    return (data || []) as FiscalYear[];
  }

  /** Return the open fiscal year for the company, creating the current-year one if none exists. */
  static async ensureCurrentFiscalYear(): Promise<FiscalYear> {
    const { companyId } = getCompanyContext();
    const years = await this.listFiscalYears();
    const open = years.find(y => y.status === 'open');
    if (open) return open;
    const y = new Date().getFullYear();
    const { data, error } = await (supabase as any).from('accounting_fiscal_years').insert({
      company_id: companyId, label: String(y), start_date: `${y}-01-01`, end_date: `${y}-12-31`, status: 'open',
    }).select().single();
    if (error) throw error;
    return data as FiscalYear;
  }

  static async closeFiscalYear(id: string, user: string | null): Promise<void> {
    const { error } = await (supabase as any).from('accounting_fiscal_years')
      .update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: user }).eq('id', id);
    if (error) throw error;
  }

  /**
   * Clôture: carries forward class 1–5 balances as à-nouveaux into the next
   * fiscal year (created if needed), books the résultat to 1191, posts the AN
   * entry, and locks the closed year. Requires no draft entries remain.
   */
  static async closeExercice(fy: FiscalYear, user: string | null): Promise<{ newYearLabel: string; carried: number }> {
    const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
    const drafts = await this.listEntries({ fiscalYearId: fy.id, status: 'draft', limit: 1 });
    if (drafts.length > 0) throw new Error('Des écritures en brouillon existent — validez-les ou supprimez-les avant la clôture.');

    const lines = await this.getPostedLines(fy.id);
    const bal = new Map<string, number>();
    for (const l of lines) bal.set(l.account_code, (bal.get(l.account_code) || 0) + (Number(l.debit) || 0) - (Number(l.credit) || 0));

    const y = Number(fy.label);
    const { companyId } = getCompanyContext();
    let next = (await this.listFiscalYears()).find(x => x.label === String(y + 1));
    if (!next) {
      const { data, error } = await (supabase as any).from('accounting_fiscal_years')
        .insert({ company_id: companyId, label: String(y + 1), start_date: `${y + 1}-01-01`, end_date: `${y + 1}-12-31`, status: 'open' }).select().single();
      if (error) throw error;
      next = data as FiscalYear;
    }

    const anLines: JournalEntryLine[] = [];
    bal.forEach((b, code) => {
      const c = Number(String(code)[0]);
      if (c >= 1 && c <= 5 && Math.abs(b) > 0.005) anLines.push({ account_code: code, label: 'À-nouveau', debit: b > 0 ? r2(b) : 0, credit: b < 0 ? r2(-b) : 0 });
    });
    const D = r2(anLines.reduce((s, l) => s + l.debit, 0));
    const C = r2(anLines.reduce((s, l) => s + l.credit, 0));
    const diff = r2(D - C);
    if (Math.abs(diff) > 0.005) anLines.push({ account_code: '1191', label: 'Résultat de l\'exercice', debit: diff < 0 ? r2(-diff) : 0, credit: diff > 0 ? r2(diff) : 0 });

    if (anLines.length > 0) {
      const journals = await this.listJournals();
      await this.createFromDraft(
        { journalType: 'anouveaux', date: `${y + 1}-01-01`, reference: `AN ${y + 1}`, label: `À-nouveaux ${y + 1}`, sourceType: 'anouveaux', sourceId: `an:${next.id}`, lines: anLines },
        next.id, journals, { post: true, createdBy: user },
      );
    }
    await this.closeFiscalYear(fy.id, user);
    return { newYearLabel: next.label, carried: anLines.length };
  }

  // ── Accounts (plan comptable) ─────────────────────────────────────────────
  static async listAccounts(): Promise<Account[]> {
    const { data, error } = await scope((supabase as any).from('accounts').select('*').order('code'));
    if (error) throw error;
    return (data || []) as Account[];
  }

  static async initPcm(): Promise<number> {
    const { companyId } = getCompanyContext();
    const existing = await this.listAccounts();
    const have = new Set(existing.map(a => a.code));
    const rows = PCM_SEED.filter(a => !have.has(a.code)).map(a => ({
      company_id: companyId, code: a.code, label: a.label, class: a.class, type: a.type,
      vat_rate: a.vat_rate ?? null, lettrable: a.lettrable ?? false, aux_kind: a.aux_kind ?? null, is_system: true,
    }));
    if (rows.length > 0) {
      const { error } = await (supabase as any).from('accounts').insert(rows);
      if (error) throw error;
    }
    await this.ensureDefaultJournals();
    return rows.length;
  }

  static async upsertAccount(a: Partial<Account> & { code: string; label: string; class: number; type: string }): Promise<Account> {
    const { companyId } = getCompanyContext();
    const payload = { ...a, company_id: a.company_id ?? companyId };
    const { data, error } = await (supabase as any).from('accounts')
      .upsert(payload, { onConflict: 'company_id,code' }).select().single();
    if (error) throw error;
    return data as Account;
  }

  // ── Journals ──────────────────────────────────────────────────────────────
  static async listJournals(): Promise<Journal[]> {
    const { data, error } = await scope((supabase as any).from('journals').select('*').order('code'));
    if (error) throw error;
    return (data || []) as Journal[];
  }

  static async ensureDefaultJournals(): Promise<void> {
    const { companyId } = getCompanyContext();
    const existing = await this.listJournals();
    const have = new Set(existing.map(j => j.code));
    const rows = DEFAULT_JOURNALS.filter(j => !have.has(j.code)).map(j => ({
      company_id: companyId, code: j.code, label: j.label, type: j.type, counterpart_account_code: j.counterpart_account_code ?? null,
    }));
    if (rows.length > 0) {
      const { error } = await (supabase as any).from('journals').insert(rows);
      if (error) throw error;
    }
  }

  // ── Entries ───────────────────────────────────────────────────────────────
  static async listEntries(filters: { fiscalYearId?: string; journalId?: string; status?: string; limit?: number } = {}): Promise<JournalEntry[]> {
    let q = (supabase as any).from('journal_entries').select('*').order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(filters.limit ?? 500);
    q = scope(q);
    if (filters.fiscalYearId) q = q.eq('fiscal_year_id', filters.fiscalYearId);
    if (filters.journalId) q = q.eq('journal_id', filters.journalId);
    if (filters.status) q = q.eq('status', filters.status);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []) as JournalEntry[];
  }

  static async getEntry(id: string): Promise<JournalEntry | null> {
    const { data, error } = await (supabase as any).from('journal_entries').select('*, lines:journal_entry_lines(*)').eq('id', id).single();
    if (error) throw error;
    if (!data) return null;
    const e = data as JournalEntry;
    e.lines = ((data.lines || []) as JournalEntryLine[]).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    return e;
  }

  static async createEntry(
    header: { fiscal_year_id: string; journal_id: string; entry_date: string; reference?: string | null; label?: string | null; source_type?: string; source_id?: string | null; created_by?: string | null },
    lines: JournalEntryLine[]
  ): Promise<JournalEntry> {
    const { companyId } = getCompanyContext();
    const { data: entry, error } = await (supabase as any).from('journal_entries').insert({
      company_id: companyId, fiscal_year_id: header.fiscal_year_id, journal_id: header.journal_id,
      entry_date: header.entry_date, reference: header.reference ?? null, label: header.label ?? null,
      status: 'draft', source_type: header.source_type ?? 'manual', source_id: header.source_id ?? null, created_by: header.created_by ?? null,
    }).select().single();
    if (error) throw error;
    await this.replaceLines(entry.id, companyId, lines);
    return entry as JournalEntry;
  }

  static async replaceLines(entryId: string, companyId: string | null, lines: JournalEntryLine[]): Promise<void> {
    await (supabase as any).from('journal_entry_lines').delete().eq('entry_id', entryId);
    const rows = lines
      .filter(l => l.account_code && (Number(l.debit) > 0 || Number(l.credit) > 0))
      .map((l, i) => ({
        entry_id: entryId, company_id: companyId, account_code: l.account_code, aux_account_id: l.aux_account_id ?? null,
        label: l.label ?? null, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, vat_rate: l.vat_rate ?? null, sort_order: i,
      }));
    if (rows.length > 0) {
      const { error } = await (supabase as any).from('journal_entry_lines').insert(rows);
      if (error) throw error;
    }
  }

  static async updateEntryDraft(
    id: string,
    header: { entry_date?: string; reference?: string | null; label?: string | null },
    lines: JournalEntryLine[]
  ): Promise<void> {
    const { companyId } = getCompanyContext();
    const { error } = await (supabase as any).from('journal_entries').update(header).eq('id', id);
    if (error) throw error;
    await this.replaceLines(id, companyId, lines);
  }

  static async postEntry(id: string, user: string | null): Promise<JournalEntry> {
    const { data, error } = await (supabase as any).rpc('post_journal_entry', { p_entry_id: id, p_user: user });
    if (error) throw error;
    return data as JournalEntry;
  }

  static async reverseEntry(id: string, user: string | null): Promise<JournalEntry> {
    const { data, error } = await (supabase as any).rpc('reverse_journal_entry', { p_entry_id: id, p_user: user });
    if (error) throw error;
    return data as JournalEntry;
  }

  static async deleteDraft(id: string): Promise<void> {
    const { error } = await (supabase as any).from('journal_entries').delete().eq('id', id).eq('status', 'draft');
    if (error) throw error;
  }

  // ── Auto-posting (Phase 2) ────────────────────────────────────────────────
  /** Set of source_ids that already have a journal entry (for double-post guard). */
  static async postedSourceIds(): Promise<Set<string>> {
    let q = (supabase as any).from('journal_entries').select('source_id').not('source_id', 'is', null);
    const { companyId, bypassFilter } = getCompanyContext();
    if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q.limit(20000);
    if (error) throw error;
    return new Set((data || []).map((r: any) => r.source_id as string));
  }

  /**
   * Create a DRAFT entry from an auto-posting rule draft. Resolves the journal
   * by type and tags source_type/source_id (idempotency handled by caller).
   * Optionally posts immediately.
   */
  static async createFromDraft(
    draft: { journalType: string; date: string; reference: string; label: string; sourceType: string; sourceId: string; lines: JournalEntryLine[] },
    fiscalYearId: string,
    journals: Journal[],
    opts: { post?: boolean; createdBy?: string | null } = {}
  ): Promise<JournalEntry> {
    const journal = journals.find(j => j.type === draft.journalType) || journals.find(j => j.type === 'od');
    if (!journal) throw new Error(`Journal introuvable pour le type ${draft.journalType}`);
    const entry = await this.createEntry(
      { fiscal_year_id: fiscalYearId, journal_id: journal.id, entry_date: draft.date, reference: draft.reference, label: draft.label, source_type: draft.sourceType, source_id: draft.sourceId, created_by: opts.createdBy ?? null },
      draft.lines,
    );
    if (opts.post) return this.postEntry(entry.id, opts.createdBy ?? null);
    return entry;
  }

  // ── Posted-entries helper (two-step: entries → lines, avoids embedded filters) ─
  private static async postedEntryMap(fiscalYearId?: string): Promise<Map<string, any>> {
    let q = (supabase as any).from('journal_entries')
      .select('id, entry_date, entry_number, journal_id, reference, label')
      .eq('status', 'posted');
    q = scope(q);
    if (fiscalYearId) q = q.eq('fiscal_year_id', fiscalYearId);
    const { data, error } = await q.limit(20000);
    if (error) throw error;
    return new Map((data || []).map((e: any) => [e.id, e]));
  }

  private static async linesForEntries(entryIds: string[], accountCode?: string): Promise<any[]> {
    if (entryIds.length === 0) return [];
    const out: any[] = [];
    for (let i = 0; i < entryIds.length; i += 300) {
      const batch = entryIds.slice(i, i + 300);
      let q = (supabase as any).from('journal_entry_lines').select('*').in('entry_id', batch);
      if (accountCode) q = q.eq('account_code', accountCode);
      const { data, error } = await q.limit(20000);
      if (error) throw error;
      out.push(...(data || []));
    }
    return out;
  }

  // ── Lettrage ──────────────────────────────────────────────────────────────
  /** Posted lines for an account, with entry date/reference joined. */
  static async getAccountLines(accountCode: string, fiscalYearId?: string): Promise<Array<JournalEntryLine & { entry_date: string; reference: string | null; entry_label: string | null }>> {
    const entries = await this.postedEntryMap(fiscalYearId);
    const lines = await this.linesForEntries(Array.from(entries.keys()), accountCode);
    return lines.map((r: any) => { const e = entries.get(r.entry_id); return { ...r, entry_date: e?.entry_date, reference: e?.reference, entry_label: e?.label }; });
  }

  static async letterLines(lineIds: string[], code: string): Promise<void> {
    const { error } = await (supabase as any).from('journal_entry_lines')
      .update({ lettrage_code: code, lettered_at: new Date().toISOString() }).in('id', lineIds);
    if (error) throw error;
  }

  static async unletter(code: string, accountCode: string): Promise<void> {
    const { error } = await (supabase as any).from('journal_entry_lines')
      .update({ lettrage_code: null, lettered_at: null }).eq('lettrage_code', code).eq('account_code', accountCode);
    if (error) throw error;
  }

  // ── TVA declarations ──────────────────────────────────────────────────────
  static async listVatDeclarations(): Promise<any[]> {
    const { data, error } = await scope((supabase as any).from('vat_declarations').select('*').order('period', { ascending: false }));
    if (error) throw error;
    return data || [];
  }

  static async saveVatDeclaration(rec: any): Promise<any> {
    const { companyId } = getCompanyContext();
    const { data, error } = await (supabase as any).from('vat_declarations')
      .upsert({ ...rec, company_id: rec.company_id ?? companyId }, { onConflict: 'company_id,period' }).select().single();
    if (error) throw error;
    return data;
  }

  // ── Reporting: grand livre + balance ──────────────────────────────────────
  /** All posted lines for the company (optionally a fiscal year), joined with entry header data. */
  static async getPostedLines(fiscalYearId?: string): Promise<Array<JournalEntryLine & { entry_date: string; entry_number: number | null; journal_id: string; reference: string | null; entry_label: string | null }>> {
    const entries = await this.postedEntryMap(fiscalYearId);
    const lines = await this.linesForEntries(Array.from(entries.keys()));
    return lines.map((r: any) => {
      const e = entries.get(r.entry_id);
      return { ...r, entry_date: e?.entry_date, entry_number: e?.entry_number, journal_id: e?.journal_id, reference: e?.reference, entry_label: e?.label };
    });
  }
}
