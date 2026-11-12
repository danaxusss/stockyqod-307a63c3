// The server returns at most 1,000 rows per request whatever the limit asked
// (PostgREST max_rows), so a read that can grow past that goes page by page.
export const READ_PAGE = 1000;

export interface Pageable<T> {
  order(column: string, options?: { ascending?: boolean }): { range(from: number, to: number): PromiseLike<{ data: T[] | null; error: unknown }> };
}

/**
 * Every row of a query. `build` makes a fresh query each time (filters and
 * any ordering of its own); `key` is a unique column added last to the
 * ordering, so pages stay stable when the other sort values tie.
 */
export async function readAll<T = Record<string, unknown>>(build: () => Pageable<T>, key = 'id'): Promise<T[]> {
  const out: T[] = [];
  // Advance by what came back and stop on an empty page: a server cap
  // smaller than READ_PAGE then still reads everything.
  for (;;) {
    const { data, error } = await build().order(key).range(out.length, out.length + READ_PAGE - 1);
    if (error) throw error;
    if (!data?.length) return out;
    out.push(...data);
  }
}
