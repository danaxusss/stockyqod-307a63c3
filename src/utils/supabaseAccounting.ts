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

  // ── Reporting: grand livre + balance ──────────────────────────────────────
  /** All posted lines for the company (optionally a fiscal year), joined with entry header data. */
  static async getPostedLines(fiscalYearId?: string): Promise<Array<JournalEntryLine & { entry_date: string; entry_number: number | null; journal_id: string; reference: string | null; entry_label: string | null }>> {
    let q = (supabase as any).from('journal_entry_lines')
      .select('*, entry:journal_entries!inner(entry_date, entry_number, journal_id, reference, label, status, fiscal_year_id, company_id)')
      .eq('entry.status', 'posted');
    const { companyId, bypassFilter } = getCompanyContext();
    if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
    if (fiscalYearId) q = q.eq('entry.fiscal_year_id', fiscalYearId);
    const { data, error } = await q.limit(20000);
    if (error) throw error;
    return (data || []).map((r: any) => ({
      ...r,
      entry_date: r.entry?.entry_date,
      entry_number: r.entry?.entry_number,
      journal_id: r.entry?.journal_id,
      reference: r.entry?.reference,
      entry_label: r.entry?.label,
    }));
  }
}
