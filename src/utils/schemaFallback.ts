// The owner runs migrations by hand, sometimes after the front end is
// deployed. A write naming a column the database does not have yet fails as a
// whole, so writes that carry new columns retry once without them: the
// document is saved like before the migration instead of not at all.

export interface DbError { code?: string; message?: string }
export interface DbResult<T = unknown> { data: T; error: DbError | null }

/**
 * A write refused because one of its columns is unknown: PostgREST answers
 * "Could not find the 'x' column of 'y' in the schema cache" (PGRST204),
 * Postgres "column "x" of relation "y" does not exist" (42703).
 */
export function isMissingColumnError(error: DbError | null | undefined, columns?: string[]): boolean {
  if (!error) return false;
  const message = error.message || '';
  const generic = error.code === 'PGRST204' || error.code === '42703'
    || /could not find the '[^']+' column/i.test(message)
    || /column "?[\w.]+"? (of relation "?\w+"? )?does not exist/i.test(message);
  if (!generic) return false;
  if (!columns?.length) return true;
  // Only retry when the unknown column is one of the new ones (or unnamed):
  // a typo in an old column must still fail.
  const named = message.match(/'(\w+)' column|column "?(?:\w+\.)?(\w+)"?/i);
  const column = named?.[1] || named?.[2];
  return !column || columns.includes(column);
}

/** A copy of `payload` without the given keys. */
export function withoutColumns<T extends Record<string, unknown>>(payload: T, columns: string[]): T {
  const copy = { ...payload };
  for (const c of columns) delete copy[c];
  return copy;
}

/**
 * Run a write; when the database does not know one of `optional` columns yet,
 * run it again without them. `run` must build a fresh query each time.
 */
export async function writeTolerant<T>(
  payload: Record<string, unknown>,
  optional: string[],
  run: (payload: Record<string, unknown>) => PromiseLike<DbResult<T>>,
): Promise<DbResult<T>> {
  const first = await run(payload);
  if (!first.error || !optional.some(c => c in payload) || !isMissingColumnError(first.error, optional)) return first;
  return run(withoutColumns(payload, optional));
}
