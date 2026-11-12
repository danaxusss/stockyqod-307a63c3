import { supabase } from './supabaseClient';
import { readAll } from './readAll';

export interface BackupData {
  version: string;
  created_at: string;
  archive_year?: number;
  tables: Record<string, unknown[]>;
  /** Tables that could not be read: the backup does not hold them. */
  failed_tables?: string[];
}

/**
 * Every table with business data, each with its unique key (upsert on
 * restore, stable paging on export), in an order where a row's references
 * are restored before it. Left out: app_users (users and PIN hashes are
 * server-only), the kiosk tables (only the kiosk edge function can read
 * them), push subscriptions and rate limits.
 */
const BACKUP_TABLES: Array<{ name: string; key: string[] }> = [
  ['companies'], ['company_settings'], ['catalog_families'], ['clients'],
  ['document_counters', 'company_id,document_type'], ['business_sectors'], ['providers'], ['stock_locations'],
  ['products', 'barcode'], ['product_stock_settings'], ['catalog_products'], ['product_name_overrides'],
  ['product_photos'], ['product_photo_products'], ['quote_templates'], ['technical_sheets'], ['technical_sheet_products'],
  ['quotes'], ['returns'], ['sheet_share_links'],
  ['stock_movements'], ['stock_postings', 'posting_key'], ['purchase_order_counters', 'company_key,year'],
  ['purchase_orders'], ['purchase_order_items'],
  ['accounts'], ['journals'], ['accounting_fiscal_years'], ['journal_entries'], ['journal_entry_lines'], ['vat_declarations'],
  ['bank_accounts'], ['bank_statements'], ['bank_statement_lines'], ['fixed_assets'], ['fixed_asset_depreciations'],
  ['employees'], ['employee_loans'], ['leave_requests'], ['payroll_settings'], ['payroll_rubriques'], ['payroll_runs'],
  ['payslips'], ['payslip_items'], ['payslip_variables'], ['payroll_cumuls'],
  ['tasks'], ['task_contacts'], ['task_activities'], ['task_checkins'], ['task_notifications'], ['tracking_sessions'], ['driver_locations'],
  ['wa_sessions'], ['wa_contacts'], ['wa_segments'], ['wa_templates'], ['wa_campaigns'], ['wa_campaign_recipients'],
  ['wa_links'], ['wa_link_clicks'], ['wa_auto_replies'], ['wa_commands'], ['wa_events'], ['wa_outbox'], ['wa_opt_outs'],
  ['activity_logs'],
].map(([name, key = 'id']) => ({ name, key: key.split(',') }));

export type BackupTableName = string;

export interface BackupProgress {
  table: string;
  done: number;
  total: number;
}

/** A table this database does not have yet (its migration was not run). */
const missingTable = (error: unknown) => {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === 'PGRST205' || e?.code === '42P01' || /could not find the table/i.test(e?.message || '');
};

/** Every row, page by page in key order (the server caps a read at 1,000 rows); null when the table does not exist. */
async function fetchAllRows(table: string, key: string[]): Promise<unknown[] | null> {
  const [last, ...firsts] = [...key].reverse();
  try {
    return await readAll(() => {
      let q = (supabase as any).from(table).select('*');
      for (const col of firsts.reverse()) q = q.order(col);
      return q;
    }, last);
  } catch (error) {
    if (missingTable(error)) return null;
    throw new Error(`${table}: ${(error as { message?: string })?.message || error}`);
  }
}

/** Start of a year in local time, as an ISO date (documents are dated in local time). */
const yearStart = (year: number) => new Date(year, 0, 1).toISOString();

export class BackupService {
  static async export(
    onProgress?: (p: BackupProgress) => void
  ): Promise<BackupData> {
    const tables: Record<string, unknown[]> = {};
    const failed: string[] = [];
    for (let i = 0; i < BACKUP_TABLES.length; i++) {
      const { name, key } = BACKUP_TABLES[i];
      onProgress?.({ table: name, done: i, total: BACKUP_TABLES.length });
      try {
        const rows = await fetchAllRows(name, key);
        if (rows) tables[name] = rows;
      } catch {
        // Not saved as an empty table: restoring that would look complete.
        failed.push(name);
      }
    }
    onProgress?.({ table: '', done: BACKUP_TABLES.length, total: BACKUP_TABLES.length });
    return {
      version: '1.0',
      created_at: new Date().toISOString(),
      tables,
      ...(failed.length ? { failed_tables: failed } : {}),
    };
  }

  static download(data: BackupData): void {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stocky-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  static async restore(
    data: BackupData,
    onProgress?: (p: BackupProgress) => void
  ): Promise<Record<string, { upserted: number; errors: number }>> {
    const results: Record<string, { upserted: number; errors: number }> = {};
    for (let i = 0; i < BACKUP_TABLES.length; i++) {
      const { name: table, key } = BACKUP_TABLES[i];
      const rows = data.tables[table] || [];
      onProgress?.({ table, done: i, total: BACKUP_TABLES.length });
      if (rows.length === 0) {
        results[table] = { upserted: 0, errors: 0 };
        continue;
      }
      // Upsert in chunks of 200
      let upserted = 0;
      let errors = 0;
      const CHUNK = 200;
      for (let j = 0; j < rows.length; j += CHUNK) {
        const chunk = rows.slice(j, j + CHUNK);
        const { error } = await (supabase as any).from(table)
          .upsert(chunk, { onConflict: key.join(',') });
        if (error) errors += chunk.length;
        else upserted += chunk.length;
      }
      results[table] = { upserted, errors };
    }
    onProgress?.({ table: '', done: BACKUP_TABLES.length, total: BACKUP_TABLES.length });
    return results;
  }

  static parseFile(file: File): Promise<BackupData> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const data = JSON.parse(e.target?.result as string) as BackupData;
          if (!data.version || !data.tables) throw new Error('Format de fichier invalide');
          resolve(data);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Impossible de lire le fichier'));
      reader.readAsText(file);
    });
  }

  static summary(data: BackupData): { table: string; rows: number }[] {
    return BACKUP_TABLES.filter(t => t.name in data.tables).map(t => ({ table: t.name, rows: (data.tables[t.name] || []).length }));
  }

  // Returns the list of years that have document data (based on quotes.created_at).
  static async getAvailableYears(
    companyId: string | null,
    isSuperAdmin: boolean
  ): Promise<number[]> {
    let q = (supabase.from('quotes') as any)
      .select('created_at')
      .order('created_at', { ascending: true })
      .limit(1);
    if (!isSuperAdmin && companyId) q = q.eq('company_id', companyId);
    const { data: oldest } = await q;

    let q2 = (supabase.from('quotes') as any)
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1);
    if (!isSuperAdmin && companyId) q2 = q2.eq('company_id', companyId);
    const { data: newest } = await q2;

    if (!oldest?.length || !newest?.length) return [];
    const minYear = new Date(oldest[0].created_at).getFullYear();
    const maxYear = new Date(newest[0].created_at).getFullYear();
    const years: number[] = [];
    for (let y = minYear; y <= maxYear; y++) years.push(y);
    return years;
  }

  // Exports all quotes/BLs/proformas/invoices/avoirs/returns created in a given year.
  // The result uses the same BackupData format — it can be re-imported via restore().
  static async exportDocumentsByYear(
    year: number,
    companyId: string | null,
    isSuperAdmin: boolean,
    onProgress?: (msg: string) => void
  ): Promise<BackupData> {
    const start = yearStart(year);
    const end   = yearStart(year + 1);
    // The year is deleted after this archive: every row must be in it, so
    // read past the 1,000-row cap and fail rather than archive part of it.
    const inYear = (table: string) => () => {
      let q = (supabase.from(table as 'quotes') as any).select('*').gte('created_at', start).lt('created_at', end).order('created_at');
      if (!isSuperAdmin && companyId) q = q.eq('company_id', companyId);
      return q;
    };

    onProgress?.('Chargement des documents…');
    let docs: unknown[];
    try { docs = await readAll(inYear('quotes')); }
    catch (e) { throw new Error(`Erreur export documents: ${(e as { message?: string })?.message || e}`); }

    onProgress?.('Chargement des retours…');
    let rets: unknown[];
    try { rets = await readAll(inYear('returns')); }
    catch (e) { throw new Error(`Erreur export retours: ${(e as { message?: string })?.message || e}`); }

    return {
      version: '1.0',
      created_at: new Date().toISOString(),
      archive_year: year,
      tables: {
        quotes:  docs  || [],
        returns: rets  || [],
      },
    };
  }

  // Downloads an archive JSON for the given year.
  static downloadArchive(data: BackupData, year: number): void {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stocky-archive-${year}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Deletes all documents (quotes table + returns) created in the given year.
  // Returns the count of deleted quote rows.
  static async deleteDocumentsByYear(
    year: number,
    companyId: string | null,
    isSuperAdmin: boolean,
    onProgress?: (msg: string) => void
  ): Promise<number> {
    const start = yearStart(year);
    const end   = yearStart(year + 1);

    onProgress?.('Suppression des retours…');
    let qRet = (supabase.from('returns') as any)
      .delete()
      .gte('created_at', start)
      .lt('created_at', end);
    if (!isSuperAdmin && companyId) qRet = qRet.eq('company_id', companyId);
    const { error: retErr } = await qRet;
    if (retErr) throw new Error(`Erreur suppression retours: ${retErr.message}`);

    onProgress?.('Suppression des documents…');
    let qDocs = (supabase.from('quotes') as any)
      .delete()
      .gte('created_at', start)
      .lt('created_at', end);
    if (!isSuperAdmin && companyId) qDocs = qDocs.eq('company_id', companyId);
    const { error } = await qDocs;
    if (error) throw new Error(`Erreur suppression documents: ${error.message}`);

    return 0; // row count not reliably returned by delete in all Supabase configs
  }

  // Deletes ALL transactional data (quotes, clients, returns, document_counters)
  // for the given company. Products and settings are never touched.
  static async resetAllData(
    companyId: string | null,
    isSuperAdmin: boolean,
    onProgress?: (msg: string) => void
  ): Promise<void> {
    const applyFilter = (q: any) =>
      !isSuperAdmin && companyId ? q.eq('company_id', companyId) : q;

    onProgress?.('Suppression des retours…');
    const { error: e1 } = await applyFilter(
      (supabase.from('returns') as any).delete().not('id', 'is', null)
    );
    if (e1) throw new Error(`returns: ${e1.message}`);

    onProgress?.('Suppression des documents (devis, BL, proformas, factures…)…');
    const { error: e2 } = await applyFilter(
      (supabase.from('quotes') as any).delete().not('id', 'is', null)
    );
    if (e2) throw new Error(`quotes: ${e2.message}`);

    onProgress?.('Suppression des clients…');
    const { error: e3 } = await applyFilter(
      (supabase.from('clients') as any).delete().not('id', 'is', null)
    );
    if (e3) throw new Error(`clients: ${e3.message}`);

    onProgress?.('Réinitialisation des compteurs de numérotation…');
    const qCounters = isSuperAdmin && !companyId
      // document_counters has no id column: filter on a column it has.
      ? (supabase.from('document_counters') as any).delete().not('document_type', 'is', null)
      : companyId
        ? (supabase.from('document_counters') as any).delete().eq('company_id', companyId)
        : null;
    if (qCounters) {
      const { error: e4 } = await qCounters;
      if (e4) throw new Error(`document_counters: ${e4.message}`);
    }
  }
}
