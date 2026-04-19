import { supabase } from './supabaseClient';

export interface BackupData {
  version: string;
  created_at: string;
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
}
