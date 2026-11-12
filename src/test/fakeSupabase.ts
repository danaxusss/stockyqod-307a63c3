// A small in-memory stand-in for the Supabase query builder, enough for the
// service code under test: filters, updates that return the rows they hit,
// inserts, deletes, paging and RPC stubs. Each update bumps `updated_at`, like
// the database trigger does.

type Row = Record<string, any>;
type Filter = (row: Row) => boolean;

export interface FakeDb {
  tables: Record<string, Row[]>;
  rpc: Record<string, (args: any) => unknown>;
  /** Called before a write runs; throw or return an error to make it fail. */
  failWrite?: (table: string, op: 'insert' | 'update' | 'delete', payload: unknown) => string | void;
  clock: number;
  /** Server-side row cap of a read, like PostgREST's max_rows (Supabase: 1000). */
  maxRows?: number;
  /** Called before a read runs; return a message to make it fail. */
  failRead?: (table: string) => string | void;
  /**
   * Reads without order() come back in a different order on each call, as
   * Postgres may when rows change between requests: pages read without a
   * stable order then skip and repeat rows.
   */
  unstableOrder?: boolean;
  /** upsert() with onConflict updates the row with the same key (and fails like Postgres on a missing key column or a key repeated in one call). */
  strictUpsert?: boolean;
  reads?: number;
}

export function createFakeDb(tables: Record<string, Row[]> = {}): FakeDb {
  return { tables, rpc: {}, clock: Date.parse('2026-10-01T00:00:00Z') };
}

const getPath = (row: Row, col: string) => {
  const m = col.match(/^(\w+)->>(\w+)$/);
  return m ? row[m[1]]?.[m[2]] : row[col];
};

class Query implements PromiseLike<{ data: any; error: any }> {
  private filters: Filter[] = [];
  private op: 'select' | 'update' | 'insert' | 'delete' = 'select';
  private payload: any;
  private returning = false;
  private mode: 'many' | 'single' | 'maybeSingle' = 'many';
  // Several order() calls combine, first one first, like PostgREST.
  private sorts: { col: string; asc: boolean }[] = [];
  private window: [number, number] | null = null;
  private max: number | null = null;
  private conflict: string[] | null = null;

  constructor(private db: FakeDb, private table: string) {}

  private rows() { return (this.db.tables[this.table] ||= []); }

  select() { if (this.op !== 'select') this.returning = true; return this; }
  update(values: Row) { this.op = 'update'; this.payload = values; return this; }
  insert(values: Row | Row[]) { this.op = 'insert'; this.payload = values; return this; }
  upsert(values: Row | Row[], opts?: { onConflict?: string }) {
    if (this.db.strictUpsert && opts?.onConflict) this.conflict = opts.onConflict.split(',').map(c => c.trim());
    return this.insert(values);
  }
  delete() { this.op = 'delete'; return this; }
  eq(col: string, v: unknown) { this.filters.push(r => String(getPath(r, col)) === String(v)); return this; }
  gt(col: string, v: number) { this.filters.push(r => Number(getPath(r, col)) > v); return this; }
  gte(col: string, v: unknown) { this.filters.push(r => String(getPath(r, col)) >= String(v)); return this; }
  lt(col: string, v: unknown) { this.filters.push(r => String(getPath(r, col)) < String(v)); return this; }
  lte(col: string, v: unknown) { this.filters.push(r => String(getPath(r, col)) <= String(v)); return this; }
  not(col: string, op: string, v: unknown) {
    if (op === 'is' && v === null) this.filters.push(r => getPath(r, col) != null);
    return this;
  }
  neq(col: string, v: unknown) { this.filters.push(r => String(getPath(r, col)) !== String(v)); return this; }
  in(col: string, vs: unknown[]) { this.filters.push(r => vs.map(String).includes(String(getPath(r, col)))); return this; }
  overlaps(col: string, vs: unknown[]) { this.filters.push(r => (r[col] || []).some((x: unknown) => vs.includes(x))); return this; }
  contains(col: string, vs: unknown[]) { this.filters.push(r => vs.every(v => (r[col] || []).includes(v))); return this; }
  /** "a.eq.x,b.is.null,c.ilike.%y%": any condition matches. Other operators keep every row. */
  or(expr: string) {
    const conds = expr.split(',').map(c => c.match(/^([\w>-]+)\.(eq|is|ilike)\.(.*)$/));
    if (conds.some(c => !c)) return this;
    this.filters.push(r => conds.some(c => {
      const [, col, op, v] = c as RegExpMatchArray;
      const val = getPath(r, col);
      if (op === 'is') return v === 'null' ? val == null : String(val) === v;
      if (op === 'eq') return String(val) === v;
      const re = new RegExp('^' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i');
      return re.test(String(val ?? ''));
    }));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) { this.sorts.push({ col, asc: opts?.ascending !== false }); return this; }
  range(from: number, to: number) { this.window = [from, to]; return this; }
  limit(n: number) { this.max = n; return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybeSingle'; return this; }

  private run(): { data: any; error: any } {
    const match = (r: Row) => this.filters.every(f => f(r));
    const fail = this.op !== 'select' ? this.db.failWrite?.(this.table, this.op, this.payload) : undefined;
    if (fail) return { data: null, error: { message: fail } };
    const readFail = this.op === 'select' ? this.db.failRead?.(this.table) : undefined;
    if (readFail) return { data: null, error: { message: readFail } };
    let out: Row[];
    if (this.op === 'insert' && this.conflict) {
      const keys = this.conflict;
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map(r => ({ ...r }));
      const keyOf = (r: Row) => JSON.stringify(keys.map(k => r[k]));
      if (list.some(r => keys.some(k => r[k] == null))) {
        return { data: null, error: { message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification' } };
      }
      if (new Set(list.map(keyOf)).size < list.length) {
        return { data: null, error: { message: 'ON CONFLICT DO UPDATE command cannot affect row a second time' } };
      }
      for (const r of list) {
        const existing = this.rows().find(x => keyOf(x) === keyOf(r));
        if (existing) Object.assign(existing, r); else this.rows().push(r);
      }
      out = list;
    } else if (this.op === 'insert') {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map(r => ({ ...r }));
      this.rows().push(...list);
      out = list;
    } else if (this.op === 'update') {
      out = this.rows().filter(match);
      for (const r of out) Object.assign(r, this.payload, { updated_at: new Date(++this.db.clock).toISOString() });
    } else if (this.op === 'delete') {
      out = this.rows().filter(match);
      this.db.tables[this.table] = this.rows().filter(r => !match(r));
    } else {
      out = this.rows().filter(match);
      if (this.db.unstableOrder && !this.sorts.length && (this.db.reads = (this.db.reads || 0) + 1) % 2 === 0) out = [...out].reverse();
    }
    if (this.sorts.length) {
      const cmp = (a: Row, b: Row) => {
        for (const { col, asc } of this.sorts) {
          const d = String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0;
          if (d) return asc ? d : -d;
        }
        return 0;
      };
      out = [...out].sort(cmp);
    }
    if (this.window) out = out.slice(this.window[0], this.window[1] + 1);
    if (this.max != null) out = out.slice(0, this.max);
    if (this.op === 'select' && this.db.maxRows != null) out = out.slice(0, this.db.maxRows);
    const data = structuredClone(out);
    if (this.op !== 'select' && !this.returning && this.mode === 'many') return { data: null, error: null };
    if (this.mode === 'single') {
      return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'not found' } };
    }
    if (this.mode === 'maybeSingle') return { data: data[0] ?? null, error: null };
    return { data, error: null };
  }

  then<A, B>(onOk?: ((v: { data: any; error: any }) => A | PromiseLike<A>) | null, onErr?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.run()).then(onOk, onErr);
  }
}

export function fakeClient(db: FakeDb) {
  return {
    from: (table: string) => new Query(db, table),
    rpc: async (fn: string, args: unknown) => {
      const impl = db.rpc[fn];
      if (!impl) return { data: null, error: { message: `rpc ${fn} missing` } };
      return { data: impl(args), error: null };
    },
  };
}
