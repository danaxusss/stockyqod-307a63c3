import { supabase } from './supabaseClient';

export interface BackupData {
  version: string;
  created_at: string;
  archive_year?: number;
  tables: Record<string, unknown[]>;
}

// Tables in FK-safe restore order
const BACKUP_TABLES = [
  'companies',
  'company_settings',
  'app_users',
  'clients',
  'document_counters',
  'products',
  'product_name_overrides',
  'quote_templates',
  'technical_sheets',
  'technical_sheet_products',
  'quotes',
  'sheet_share_links',
  'activity_logs',
] as const;

export type BackupTableName = typeof BACKUP_TABLES[number];

export interface BackupProgress {
  table: string;
  done: number;
  total: number;
}

async function fetchAllRows(table: string): Promise<unknown[]> {
  const PAGE = 1000;
  const rows: unknown[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await (supabase.from(table) as any)
      .select('*')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

export class BackupService {
  static async export(
    onProgress?: (p: BackupProgress) => void
  ): Promise<BackupData> {
    const tables: Record<string, unknown[]> = {};
    for (let i = 0; i < BACKUP_TABLES.length; i++) {
      const table = BACKUP_TABLES[i];
      onProgress?.({ table, done: i, total: BACKUP_TABLES.length });
      try {
        tables[table] = await fetchAllRows(table);
      } catch {
        tables[table] = [];
      }
    }
    onProgress?.({ table: '', done: BACKUP_TABLES.length, total: BACKUP_TABLES.length });
    return {
      version: '1.0',
      created_at: new Date().toISOString(),
      tables,
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
      const table = BACKUP_TABLES[i];
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
        const { error } = await (supabase.from(table) as any)
          .upsert(chunk, { onConflict: 'id' });
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
    return BACKUP_TABLES.map(t => ({ table: t, rows: (data.tables[t] || []).length }));
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
    const start = `${year}-01-01T00:00:00.000Z`;
    const end   = `${year + 1}-01-01T00:00:00.000Z`;

    onProgress?.('Chargement des documents…');
    let qDocs = (supabase.from('quotes') as any)
      .select('*')
      .gte('created_at', start)
      .lt('created_at', end)
      .order('created_at');
    if (!isSuperAdmin && companyId) qDocs = qDocs.eq('company_id', companyId);
    const { data: docs, error: docsErr } = await qDocs;
    if (docsErr) throw new Error(`Erreur export documents: ${docsErr.message}`);

    onProgress?.('Chargement des retours…');
    let qRet = (supabase.from('returns') as any)
      .select('*')
      .gte('created_at', start)
      .lt('created_at', end)
      .order('created_at');
    if (!isSuperAdmin && companyId) qRet = qRet.eq('company_id', companyId);
    const { data: rets } = await qRet;

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
    const start = `${year}-01-01T00:00:00.000Z`;
    const end   = `${year + 1}-01-01T00:00:00.000Z`;

    onProgress?.('Suppression des retours…');
    let qRet = (supabase.from('returns') as any)
      .delete()
      .gte('created_at', start)
      .lt('created_at', end);
    if (!isSuperAdmin && companyId) qRet = qRet.eq('company_id', companyId);
    await qRet;

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
      ? (supabase.from('document_counters') as any).delete().not('id', 'is', null)
      : companyId
        ? (supabase.from('document_counters') as any).delete().eq('company_id', companyId)
        : null;
    if (qCounters) {
      const { error: e4 } = await qCounters;
      if (e4) throw new Error(`document_counters: ${e4.message}`);
    }
  }
}
