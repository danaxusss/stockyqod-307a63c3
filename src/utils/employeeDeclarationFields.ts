// Employee fields of the annual salary return (20261126140000_payroll_declarations.sql)
// and how an employee is saved before that migration has run.

import { isMissingColumnError } from './payrollDb';

/** Employee columns added by the declarations migration. */
export const DECLARATION_EMPLOYEE_COLUMNS = ['last_name', 'first_name', 'address', 'residence_card', 'tax_id', 'dts_category'];

const filled = (v: unknown) => v != null && String(v).trim() !== '';

/** Dropping the declaration columns would lose what was typed: refuse instead. */
export function declarationFieldsLost(row: Record<string, unknown>): string | null {
  return DECLARATION_EMPLOYEE_COLUMNS.some(c => filled(row[c]))
    ? 'Les informations de déclaration (nom, prénom, adresse, carte de séjour, IF, liste 9421) ne peuvent pas être enregistrées tant que la base n\'est pas à jour.'
    : null;
}

type DbError = { message?: string; code?: string };
type DbResult = { data: unknown; error: DbError | null };

/** The column an "unknown column" error names (PostgREST or Postgres wording), if it says. */
export function missingColumnName(error: DbError | null | undefined): string | null {
  const msg = error?.message || '';
  return /could not find the '([^']+)' column/i.exec(msg)?.[1] ?? /column "?([\w]+)"? (?:of relation "?\w+"? )?does not exist/i.exec(msg)?.[1] ?? null;
}

const strip = (row: Record<string, unknown>, columns: string[]) => {
  const out = { ...row };
  for (const c of columns) delete out[c];
  return out;
};

/**
 * Writes an employee row, retried without the columns of a migration that has
 * not run: the declaration columns (this change) and the 2026 payroll ones
 * (`columns`, refused by `mustKeep` as before). Each set is dropped only when
 * the error names one of its columns (or names none), and a set holding data
 * is refused rather than dropped.
 */
export async function writeEmployeeWithFallback(
  write: (payload: Record<string, unknown>) => PromiseLike<DbResult>,
  payload: Record<string, unknown>,
  columns: string[],
  mustKeep: (row: Record<string, unknown>) => string | null,
): Promise<DbResult> {
  let row = payload;
  let result = await write(row);
  let declDropped = false;
  let baseDropped = false;
  while (result.error && isMissingColumnError(result.error)) {
    const col = missingColumnName(result.error);
    const declFirst = col ? DECLARATION_EMPLOYEE_COLUMNS.includes(col) : !declDropped;
    if (declFirst && !declDropped) {
      const reason = declarationFieldsLost(row);
      if (reason) return { data: null, error: { message: `${reason} Exécutez d'abord la migration 20261126140000_payroll_declarations.sql dans Supabase.` } };
      row = strip(row, DECLARATION_EMPLOYEE_COLUMNS);
      declDropped = true;
    } else if (!baseDropped) {
      const reason = mustKeep(row);
      if (reason) return { data: null, error: { message: `${reason} Exécutez d'abord la migration 20261125140000_payroll_2026.sql dans Supabase.` } };
      row = strip(row, columns);
      baseDropped = true;
    } else if (!declDropped) {
      const reason = declarationFieldsLost(row);
      if (reason) return { data: null, error: { message: `${reason} Exécutez d'abord la migration 20261126140000_payroll_declarations.sql dans Supabase.` } };
      row = strip(row, DECLARATION_EMPLOYEE_COLUMNS);
      declDropped = true;
    } else {
      break;
    }
    result = await write(row);
  }
  return result;
}
