// The server returns at most 1,000 rows per request whatever the limit asked
// (PostgREST max_rows), so a read that can grow past that goes page by page.
export const READ_PAGE = 1000;

/** Page size actually requested: the server cap. Tests set it to their fake cap. */
export const readAllConfig = { pageSize: READ_PAGE };

export interface Pageable<T> {
  order(column: string, options?: { ascending?: boolean }): { range(from: number, to: number): PromiseLike<{ data: T[] | null; error: unknown }> };
}

// Pages requested at the same time once a read turns out to span several.
const PARALLEL_PAGES = 4;

/**
 * Every row of a query. `build` makes a fresh query each time (filters and
 * any ordering of its own); `key` is a unique column added last to the
 * ordering, so pages stay stable when the other sort values tie.
 *
 * The first page is read alone (most reads fit in it: one request). A full
 * page means there may be more, so the next pages are read a few at a time,
 * in parallel, until one comes back short.
 */
export async function readAll<T = Record<string, unknown>>(build: () => Pageable<T>, key = 'id'): Promise<T[]> {
  const size = readAllConfig.pageSize;
  const page = async (index: number) => {
    const from = index * size;
    const { data, error } = await build().order(key).range(from, from + size - 1);
    if (error) throw error;
    return data || [];
  };
  const out: T[] = [];
  const first = await page(0);
  out.push(...first);
  if (first.length < size) return out;
  for (let next = 1; ; next += PARALLEL_PAGES) {
    const wave = await Promise.all(Array.from({ length: PARALLEL_PAGES }, (_, i) => page(next + i)));
    for (const rows of wave) {
      out.push(...rows);
      if (rows.length < size) return out;
    }
  }
}
