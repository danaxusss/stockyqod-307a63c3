import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';
import { PCM_SEED, DEFAULT_JOURNALS } from '../accounting/pcmSeed';
import type { Account, FiscalYear, Journal, JournalEntry, JournalEntryLine } from '../types';

// A ledger belongs to one company: even users who see every company's
// documents work in the books of the company they are signed in to.
function scope<T>(q: any): any {
  const { companyId } = getCompanyContext();
  if (companyId) return q.eq('company_id', companyId);
  return q;
}

const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const frDay = (day: string) => day.split('-').reverse().join('/');
const contains = (y: FiscalYear, day: string) => y.start_date <= day && day <= y.end_date;
const choiceKey = () => `stocky_fiscal_year:${getCompanyContext().companyId || ''}`;

export class AccountingService {
  // ── Fiscal years ──────────────────────────────────────────────────────────
  static async listFiscalYears(): Promise<FiscalYear[]> {
    const { data, error } = await scope((supabase as any).from('accounting_fiscal_years').select('*').order('start_date', { ascending: false }));
    if (error) throw error;
    return (data || []) as FiscalYear[];
  }

  /**
   * The fiscal year the accounting pages show: the one picked on the home
   * page, else the one containing today (created when missing).
   */
  static async ensureCurrentFiscalYear(): Promise<FiscalYear> {
    const years = await this.listFiscalYears();
    let chosen: string | null = null;
    try { chosen = localStorage.getItem(choiceKey()); } catch { /* storage unavailable */ }
    const picked = chosen ? years.find(y => y.id === chosen) : undefined;
    if (picked) return picked;
    const today = localDay();
    return years.find(y => contains(y, today)) || this.fiscalYearFor(today, years);
  }

  /** Remember which fiscal year the accounting pages show (null: the current one). */
  static setDisplayedFiscalYear(id: string | null): void {
    try {
      if (id) localStorage.setItem(choiceKey(), id);
      else localStorage.removeItem(choiceKey());
    } catch { /* storage unavailable */ }
  }

  /**
   * The open fiscal year an entry dated `day` (YYYY-MM-DD) belongs to. The
   * calendar year is created when no year covers that date yet.
   */
  static async fiscalYearFor(day: string, known?: FiscalYear[]): Promise<FiscalYear> {
    const years = known || await this.listFiscalYears();
    const found = years.find(y => contains(y, day));
    if (found) {
      if (found.status !== 'open') throw new Error(`L'exercice ${found.label} est clôturé : aucune écriture ne peut y être passée au ${frDay(day)}.`);
      return found;
    }
    const y = Number(day.slice(0, 4));
    const start = `${y}-01-01`, end = `${y}-12-31`;
    if (years.some(x => x.start_date <= end && start <= x.end_date)) {
      throw new Error(`Aucun exercice ne couvre le ${frDay(day)} : créez-le avant de comptabiliser.`);
    }
    const { companyId } = getCompanyContext();
    const { data, error } = await (supabase as any).from('accounting_fiscal_years').insert({
      company_id: companyId, label: String(y), start_date: start, end_date: end, status: 'open',
    }).select().single();
    if (error) {
      // Created meanwhile by another tab.
      const again = (await this.listFiscalYears()).find(x => contains(x, day));
      if (again) return again;
      throw error;
    }
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
    if (localDay() <= fy.end_date) {
      throw new Error(`L'exercice ${fy.label} se termine le ${frDay(fy.end_date)} : clôturez-le après cette date.`);
    }
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
        { journalType: 'anouveaux', date: next.start_date, reference: `AN ${y + 1}`, label: `À-nouveaux ${y + 1}`, sourceType: 'anouveaux', sourceId: `an:${next.id}`, lines: anLines },
        journals, { post: true, createdBy: user },
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

  /** New draft entry, filed in the fiscal year that contains its date. */
  static async createEntry(
    header: { journal_id: string; entry_date: string; reference?: string | null; label?: string | null; source_type?: string; source_id?: string | null; created_by?: string | null },
    lines: JournalEntryLine[]
  ): Promise<JournalEntry> {
    const { companyId } = getCompanyContext();
    const fy = await this.fiscalYearFor(header.entry_date);
    const { data: entry, error } = await (supabase as any).from('journal_entries').insert({
      company_id: companyId, fiscal_year_id: fy.id, journal_id: header.journal_id,
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
    // A new date may move the draft to another fiscal year.
    const patch: Record<string, unknown> = { ...header };
    if (header.entry_date) patch.fiscal_year_id = (await this.fiscalYearFor(header.entry_date)).id;
    const { error } = await (supabase as any).from('journal_entries').update(patch).eq('id', id).eq('status', 'draft');
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
    const q = scope((supabase as any).from('journal_entries').select('source_id').not('source_id', 'is', null));
    const { data, error } = await q.limit(20000);
    if (error) throw error;
    return new Set((data || []).map((r: any) => r.source_id as string));
  }

  /**
   * Customer payments already booked, per invoice: the amount (reversed
   * entries excluded, their reversal cancels them) and how many entries exist.
   */
  static async paymentPostedTotals(): Promise<Map<string, { amount: number; count: number }>> {
    const { data, error } = await scope((supabase as any).from('journal_entries')
      .select('id, source_id, status').eq('source_type', 'payment')).limit(20000);
    if (error) throw error;
    const entries = (data || []) as { id: string; source_id: string | null; status: string }[];
    const lines = await this.linesForEntries(entries.filter(e => e.status !== 'reversed').map(e => e.id));
    const debitByEntry = new Map<string, number>();
    for (const l of lines) debitByEntry.set(l.entry_id, (debitByEntry.get(l.entry_id) || 0) + (Number(l.debit) || 0));
    const out = new Map<string, { amount: number; count: number }>();
    for (const e of entries) {
      if (!e.source_id || !e.source_id.includes(':pay')) continue;
      const invoiceId = e.source_id.split(':pay')[0];
      const cur = out.get(invoiceId) || { amount: 0, count: 0 };
      cur.count += 1;
      cur.amount = Math.round((cur.amount + (debitByEntry.get(e.id) || 0)) * 100) / 100;
      out.set(invoiceId, cur);
    }
    return out;
  }

  /** Entries generated from one source (a document, a period declaration…). */
  static async entriesForSource(sourceId: string): Promise<JournalEntry[]> {
    const { data, error } = await scope((supabase as any).from('journal_entries').select('*').eq('source_id', sourceId));
    if (error) throw error;
    return (data || []) as JournalEntry[];
  }

  /**
   * Create a DRAFT entry from an auto-posting rule draft. Resolves the journal
   * by type and tags source_type/source_id (idempotency handled by caller).
   * Optionally posts immediately.
   */
  static async createFromDraft(
    draft: { journalType: string; date: string; reference: string; label: string; sourceType: string; sourceId: string; lines: JournalEntryLine[] },
    journals: Journal[],
    opts: { post?: boolean; createdBy?: string | null } = {}
  ): Promise<JournalEntry> {
    const journal = journals.find(j => j.type === draft.journalType) || journals.find(j => j.type === 'od');
    if (!journal) throw new Error(`Journal introuvable pour le type ${draft.journalType}`);
    const entry = await this.createEntry(
      { journal_id: journal.id, entry_date: draft.date, reference: draft.reference, label: draft.label, source_type: draft.sourceType, source_id: draft.sourceId, created_by: opts.createdBy ?? null },
      draft.lines,
    );
    if (opts.post) return this.postEntry(entry.id, opts.createdBy ?? null);
    return entry;
  }

  // ── Posted-entries helper (two-step: entries → lines, avoids embedded filters) ─
  // A reversed entry stays in the books next to its reversal: reading only
  // 'posted' would keep the mirror and drop the original.
  private static async postedEntryMap(fiscalYearId?: string): Promise<Map<string, any>> {
    let q = (supabase as any).from('journal_entries')
      .select('id, entry_date, entry_number, journal_id, reference, label, source_type, source_id')
      .in('status', ['posted', 'reversed']);
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

  /** Remove a lettrage: only the lines of that group, nothing else sharing its code. */
  static async unletterLines(lineIds: string[]): Promise<void> {
    if (lineIds.length === 0) return;
    const { error } = await (supabase as any).from('journal_entry_lines')
      .update({ lettrage_code: null, lettered_at: null }).in('id', lineIds);
    if (error) throw error;
  }

  /** Lettrage codes already used on an account, every fiscal year included. */
  static async usedLettrageCodes(accountCode: string): Promise<string[]> {
    const { data, error } = await scope((supabase as any).from('journal_entry_lines')
      .select('lettrage_code').eq('account_code', accountCode).not('lettrage_code', 'is', null)).limit(20000);
    if (error) throw error;
    return Array.from(new Set(((data || []) as { lettrage_code: string }[]).map(r => r.lettrage_code)));
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
      return { ...r, entry_date: e?.entry_date, entry_number: e?.entry_number, journal_id: e?.journal_id, reference: e?.reference, entry_label: e?.label, source_type: e?.source_type, source_id: e?.source_id };
    });
  }
}
