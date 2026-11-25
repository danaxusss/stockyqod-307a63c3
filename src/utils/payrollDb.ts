import { supabase } from './supabaseClient';

// The 2026 payroll migration (20261125140000_payroll_2026.sql) is run by hand,
// possibly after this front-end is deployed. Until then, a write naming one of
// its new columns fails: the write is retried without them, so payroll keeps
// working with the old columns. Reads treat a missing column as its default.

type DbResult = { data: unknown; error: { message?: string; code?: string } | null };


/** An error caused by a column the database does not have (yet). */
export function isMissingColumnError(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'PGRST204' || error.code === '42703') return true;
  return /could not find the '.+' column|column .+ does not exist/i.test(error.message || '');
}

function strip<T extends Record<string, unknown>>(row: T, columns: string[]): T {
  const out = { ...row };
  for (const c of columns) delete out[c];
  return out;
}

/** The HR migration (leave, holidays, STC, trainees, paid runs). */
export const HR_MIGRATION = '20261126150000_hr.sql';

/** An error caused by a table the database does not have (yet). */
export function isMissingTableError(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'PGRST205' || error.code === '42P01') return true;
  return /could not find the table|relation .+ does not exist/i.test(error.message || '');
}

/** A CHECK constraint refused a value (e.g. a contract type the database does not know yet). */
export function isCheckViolation(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === '23514' || /violates check constraint/i.test(error.message || '');
}

/** "Exécutez d'abord la migration … dans Supabase." */
export const runMigrationHint = (file: string) => `Exécutez d'abord la migration ${file} dans Supabase.`;

/**
 * Runs a write; when it fails on an unknown column, runs it again without
 * `optionalColumns`. `mustKeep` says when dropping them would lose data that
 * matters (then the error is raised with an explanation instead, naming
 * `migration`).
 */
export async function writeWithFallback<T extends Record<string, unknown>>(
  write: (payload: T | T[]) => PromiseLike<DbResult>,
  payload: T | T[],
  optionalColumns: string[],
  mustKeep?: (payload: T) => string | null,
  migration = '20261125140000_payroll_2026.sql',
): Promise<DbResult> {
  const first = await write(payload);
  if (!first.error || !isMissingColumnError(first.error)) return first;
  const rows = Array.isArray(payload) ? payload : [payload];
  for (const r of rows) {
    const reason = mustKeep?.(r);
    // A reason that names its own migration is kept as it is.
    if (reason) return { data: null, error: { message: /migration/i.test(reason) ? reason : `${reason} ${runMigrationHint(migration)}` } };
  }
  const stripped = Array.isArray(payload) ? payload.map(r => strip(r, optionalColumns)) : strip(payload, optionalColumns);
  return write(stripped);
}

// ── An untyped query builder for the payroll tables ─────────────────────────
// The generated Database types do not list the payroll tables, so the typed
// client refuses them. This is the subset of the builder payroll uses, with
// rows typed as unknown (each caller says what it reads).

export interface DbError { message?: string; code?: string }
export interface DbResponse { data: unknown; error: DbError | null }

export interface PayrollQuery extends PromiseLike<DbResponse> {
  select(columns?: string): PayrollQuery;
  insert(values: unknown): PayrollQuery;
  update(values: unknown): PayrollQuery;
  upsert(values: unknown, options?: { onConflict?: string }): PayrollQuery;
  delete(): PayrollQuery;
  eq(column: string, value: unknown): PayrollQuery;
  gt(column: string, value: unknown): PayrollQuery;
  in(column: string, values: unknown[]): PayrollQuery;
  order(column: string, options?: { ascending?: boolean }): PayrollQuery;
  range(from: number, to: number): PayrollQuery;
  limit(count: number): PayrollQuery;
  single(): PayrollQuery;
  maybeSingle(): PayrollQuery;
}

/** The Supabase client, read at each call (tests swap it). */
export function payrollDb(): { from(table: string): PayrollQuery } {
  return supabase as unknown as { from(table: string): PayrollQuery };
}
