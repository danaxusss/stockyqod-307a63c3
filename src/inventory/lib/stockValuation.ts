// Stock at a date, in quantity and value: the detailed inventory of the goods
// on hand at the end of a fiscal year (CGI art. 145-II) and the closing stock
// the accounts need (CGNC, account 3111). Pure functions.
//
// QUANTITY. Every stock writer of the database goes through
// apply_stock_movement (migrations 20260705120000 and 20261029120000), which
// adds `v_delta` to the level of one location and stores that same `v_delta`
// as stock_movements.quantity: + for in / return / transfer_in, − for out /
// transfer_out, the signed delta for adjustment and count (a physical count
// posts "counted − level", a reversal posts the opposite delta as an
// adjustment, a voucher posts in / out). The catalogue import inserts its
// 'count' rows itself, but with the delta it applied too
// (productUploadService.logImportReconcile). So
//
//     level at the end of day D = level now − Σ quantity of the movements after D
//
// holds for every movement but one: the "Solde d'ouverture" rows the first
// inventory migration seeded (source 'count', created by 'system'). They record
// the level the product already had when movements started to be tracked and
// did NOT change it, so they are skipped: a product whose stock predates the
// movements keeps that stock at any earlier date.
//
// UNIT COST. The method is the weighted average cost (CMUP) that the database
// keeps in products.buyprice. apply_stock_movement updates it on any movement
// that adds stock (v_delta > 0) and carries a unit cost (> 0):
//
//     T   = max(Σ levels of the product over ALL its locations before the movement, 0)
//     new = round((T × old + δ × u) / (T + δ), 2)
//
// No other movement changes it. Undoing a receipt, newest first, is therefore
//
//     old = ((T + δ) × new − δ × u) / T        (needs T > 0)
//
// rounded to 2 decimals like the stored value. When that is impossible (T ≤ 0,
// or a later receipt has no unit cost so the price paid is unknown) or gives
// nonsense (a negative cost), the line is valued at the current average cost
// and marked, so the user sees which lines to check.
//
// VAT. Stocky stores purchase prices including VAT, like its sale prices: the
// quote margin divides both by (1 + rate) (src/utils/quoteMargin.ts,
// QuoteCartPage "achat HT"), and receipts are prefilled with that price. The
// accounts need the stock excluding VAT (the VAT is deductible), so the unit
// cost is divided by (1 + company VAT rate).

export const OPENING_BALANCE_REASON = "Solde d'ouverture";
export const VALUATION_METHOD = 'Coût moyen pondéré (CMUP), hors taxe';
export const DEFAULT_TIME_ZONE = 'Africa/Casablanca';

export interface ValuationProduct {
  barcode: string;
  name: string;
  brand?: string | null;
  stock_levels: Record<string, unknown> | null | undefined;
  /** Current weighted average cost, including VAT. */
  buyprice: number | string | null | undefined;
}

export interface ValuationMovement {
  id?: string;
  barcode: string;
  location_key: string;
  type: string;
  quantity: number | string;
  unit_cost: number | string | null;
  reason?: string | null;
  source_type?: string | null;
  created_by?: string | null;
  created_at: string;
}

/** Why a line is valued at the current average cost. */
export type FallbackReason = 'receipt_without_cost' | 'stock_not_positive' | 'inconsistent' | 'no_cost';

export const FALLBACK_LABEL: Record<FallbackReason, string> = {
  // Straight apostrophes: these texts also go into the PDF, whose standard font may drop ’.
  receipt_without_cost: 'entrée sans coût après la date',
  stock_not_positive: "stock nul ou négatif lors d'une entrée",
  inconsistent: 'coût reconstitué incohérent',
  no_cost: "aucun coût d'achat",
};

export interface StockLine {
  barcode: string;
  name: string;
  brand: string;
  /** Quantity at the date, over the locations in scope. */
  quantity: number;
  /** Quantity at the date per stock_levels key in scope (keys that held or moved stock). */
  byKey: Record<string, number>;
  /** Average cost at the date including VAT (rebuilt, or the current one when marked). */
  unitCostTtc: number;
  /** Unit cost excluding VAT, 2 decimals. */
  unitCost: number;
  /** quantity × unitCost; 0 when the quantity is zero or negative. */
  value: number;
  /** True when the current average cost is used because the one at the date could not be rebuilt. */
  currentCost: boolean;
  fallbackReason: FallbackReason | null;
  negative: boolean;
}

export interface StockTotals {
  /** Lines with a positive quantity. */
  references: number;
  /** Σ positive quantities (a negative quantity counts for zero). */
  quantity: number;
  value: number;
  /** Lines with a quantity that are valued at the current cost. */
  fallbackLines: number;
  negativeLines: number;
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
// Quantities are compared and summed with a little care for 0.1 + 0.2.
const clean = (n: number) => Math.round(n * 1e6) / 1e6;

/** A stock level read like the database's stock_level_value(): anything not a plain number is 0. */
export function levelValue(value: unknown): number {
  const s = String(value ?? '').trim();
  return /^-?[0-9]+(\.[0-9]+)?$/.test(s) ? Number(s) : 0;
}

/** The opening-balance rows of the first inventory migration: a record, not a change of level. */
export function isOpeningBalance(m: Pick<ValuationMovement, 'source_type' | 'reason' | 'created_by'>): boolean {
  return m.source_type === 'count' && m.reason === OPENING_BALANCE_REASON && m.created_by === 'system';
}

// ── Dates ──────────────────────────────────────────────────────────────────

function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * The first instant after day `day` (YYYY-MM-DD) in the given time zone, in
 * ms since the epoch: movements at or after it are "after the date".
 * Morocco moves its clock around Ramadan, never at midnight, so the offset
 * at local midnight is unambiguous.
 */
export function dayEndInstant(day: string, timeZone = DEFAULT_TIME_ZONE): number {
  const [y, m, d] = day.split('-').map(Number);
  const localMidnight = Date.UTC(y, m - 1, d + 1);
  const first = localMidnight - zoneOffsetMs(localMidnight, timeZone);
  return localMidnight - zoneOffsetMs(first, timeZone);
}

/** Today's date (YYYY-MM-DD) in the given time zone. */
export function todayIn(timeZone = DEFAULT_TIME_ZONE, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export const frDay = (day: string) => day.split('-').reverse().join('/');

/** Movements recorded after the end of `day`, newest first (the order they are undone in). */
export function movementsAfter<T extends ValuationMovement>(movements: T[], day: string, timeZone = DEFAULT_TIME_ZONE): T[] {
  const end = dayEndInstant(day, timeZone);
  return movements
    .map((m, i) => ({ m, i, t: Date.parse(m.created_at) }))
    .filter(x => Number.isFinite(x.t) && x.t >= end)
    // Movements of one posting share a timestamp and their order is not
    // stored; averages commute, so it only matters for rounding. Later input
    // first keeps it deterministic (the reads come back newest first).
    .sort((a, b) => b.t - a.t || a.i - b.i)
    .map(x => x.m);
}

// ── One product ────────────────────────────────────────────────────────────

/** Quantity per stock_levels key at the date, from the current levels and the movements after it. */
export function quantitiesAtDate(product: Pick<ValuationProduct, 'stock_levels'>, later: ValuationMovement[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(product.stock_levels || {})) out[key] = levelValue(value);
  for (const m of later) {
    if (isOpeningBalance(m)) continue;
    out[m.location_key] = clean((out[m.location_key] || 0) - num(m.quantity));
  }
  return out;
}

/**
 * Average cost (including VAT) at the date: the current one with the
 * receipts after the date undone, newest first. `later` must be every
 * movement of the product after the date, at every location, newest first:
 * the average is computed over the product's whole stock.
 */
export function averageCostAtDate(product: Pick<ValuationProduct, 'stock_levels' | 'buyprice'>, later: ValuationMovement[]): { cost: number; fallback: FallbackReason | null } {
  const current = r2(num(product.buyprice));
  let cost = current;
  let total = Object.values(product.stock_levels || {}).reduce<number>((s, v) => s + levelValue(v), 0);
  let fallback: FallbackReason | null = null;
  for (const m of later) {
    if (isOpeningBalance(m)) continue;
    const delta = num(m.quantity);
    const unit = num(m.unit_cost);
    const before = clean(total - delta);
    // A receipt without a price: what was paid for those goods is unknown.
    if (m.type === 'in' && !(unit > 0)) fallback ??= 'receipt_without_cost';
    if (fallback === null && delta > 0 && unit > 0) {
      const base = Math.max(before, 0);
      if (base <= 0) fallback = 'stock_not_positive';
      else {
        cost = r2(((base + delta) * cost - delta * unit) / base);
        if (cost < 0) fallback = 'inconsistent';
      }
    }
    total = before;
  }
  if (fallback) return { cost: current, fallback };
  if (!(cost > 0)) return { cost: current, fallback: 'no_cost' };
  return { cost, fallback: null };
}

/** A price including VAT brought back to excluding VAT (2 decimals). */
export function exclVat(priceTtc: number, vatRate: number): number {
  return r2(num(priceTtc) / (1 + (num(vatRate) || 0) / 100));
}

/** The one-line rule shown with the statement. */
export function vatRuleText(vatRate: number): string {
  const rate = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(num(vatRate));
  const factor = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(1 + num(vatRate) / 100);
  return `Valeur hors taxe : les prix d'achat sont saisis TTC dans Stocky, le coût moyen est divisé par ${factor} (TVA de ${rate} %, récupérable).`;
}

// ── Statement ──────────────────────────────────────────────────────────────

export interface StatementOptions {
  day: string;
  vatRate: number;
  /** stock_levels keys counted in the quantities (branch and location filter). Costs always use every key. */
  keyInScope?: (key: string) => boolean;
  timeZone?: string;
}

/**
 * One line per product: quantity at the end of `day` over the keys in scope,
 * average cost at that date, value excluding VAT. `movements` may hold more
 * than the movements after the date (they are filtered here).
 */
export function buildStockStatement(products: ValuationProduct[], movements: ValuationMovement[], opts: StatementOptions): StockLine[] {
  const inScope = opts.keyInScope || (() => true);
  const later = movementsAfter(movements, opts.day, opts.timeZone);
  const byProduct = new Map<string, ValuationMovement[]>();
  for (const m of later) {
    const list = byProduct.get(m.barcode);
    if (list) list.push(m); else byProduct.set(m.barcode, [m]);
  }
  return products.map(p => {
    const mine = byProduct.get(p.barcode) || [];
    const all = quantitiesAtDate(p, mine);
    const byKey: Record<string, number> = {};
    for (const [key, q] of Object.entries(all)) if (inScope(key)) byKey[key] = q;
    const quantity = clean(Object.values(byKey).reduce((s, q) => s + q, 0));
    const { cost, fallback } = averageCostAtDate(p, mine);
    const unitCost = exclVat(cost, opts.vatRate);
    return {
      barcode: p.barcode,
      name: p.name || p.barcode,
      brand: p.brand || '',
      quantity,
      byKey,
      unitCostTtc: cost,
      unitCost,
      value: quantity > 0 ? r2(quantity * unitCost) : 0,
      currentCost: fallback !== null,
      fallbackReason: fallback,
      negative: quantity < 0,
    };
  });
}

export function statementTotals(lines: StockLine[]): StockTotals {
  let references = 0, quantity = 0, value = 0, fallbackLines = 0, negativeLines = 0;
  for (const l of lines) {
    if (l.quantity > 0) { references += 1; quantity += l.quantity; value += l.value; }
    if (l.quantity < 0) negativeLines += 1;
    if (l.quantity !== 0 && l.currentCost) fallbackLines += 1;
  }
  return { references, quantity: clean(quantity), value: r2(value), fallbackLines, negativeLines };
}

// ── CSV ────────────────────────────────────────────────────────────────────

const csvAmount = (v: number) => r2(v).toFixed(2).replace('.', ',');
const csvQty = (v: number) => String(clean(v)).replace('.', ',');
const pad = (n: number) => String(n).padStart(2, '0');

export interface InventoryContext {
  company: string;
  day: string;
  vatRate: number;
  /** Location shown, when the statement is not for every location. */
  location?: string | null;
  producedAt: Date;
  /** Label of a stock_levels key, for the per-location column. */
  keyLabel?: (key: string) => string;
}

/**
 * Rows of the CSV inventory (write them with ledgerExport's toCsv: ";",
 * BOM, comma decimals). Opens with the company, the statement and its date,
 * the method, the date produced and the software, like the ledger exports.
 */
export function inventoryCsvRows(lines: StockLine[], ctx: InventoryContext): unknown[][] {
  const at = ctx.producedAt;
  const totals = statementTotals(lines);
  const perLocation = !!ctx.keyLabel;
  const rows: unknown[][] = [
    ['Société', ctx.company],
    ['État', `Inventaire détaillé au ${frDay(ctx.day)}`],
    ['Méthode', VALUATION_METHOD],
    ['Valeur hors taxe', vatRuleText(ctx.vatRate).replace(/^Valeur hors taxe : /, '')],
    ['Emplacement', ctx.location || 'Tous les emplacements'],
    ['Édité le', `${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()} ${pad(at.getHours())}:${pad(at.getMinutes())}`],
    ['Logiciel', 'Stocky'],
    [],
    ['Référence', 'Désignation', 'Marque', 'Quantité', 'Coût unitaire HT', 'Valeur HT', 'Coût retenu', ...(perLocation ? ['Détail par emplacement'] : [])],
  ];
  for (const l of lines) {
    rows.push([
      l.barcode, l.name, l.brand, csvQty(l.quantity), csvAmount(l.unitCost), csvAmount(l.value),
      l.currentCost ? `coût actuel (${FALLBACK_LABEL[l.fallbackReason || 'no_cost']})` : 'coût à la date',
      ...(perLocation ? [Object.entries(l.byKey).filter(([, q]) => q !== 0).map(([k, q]) => `${ctx.keyLabel!(k)} ${csvQty(q)}`).join(' | ')] : []),
    ]);
  }
  rows.push([]);
  rows.push(['Total', `${totals.references} référence${totals.references > 1 ? 's' : ''} en stock`, '', csvQty(totals.quantity), '', csvAmount(totals.value), '']);
  if (totals.negativeLines > 0) rows.push(['', `${totals.negativeLines} ligne(s) en quantité négative, comptée(s) pour zéro dans la valeur`]);
  if (totals.fallbackLines > 0) rows.push(['', `${totals.fallbackLines} ligne(s) valorisée(s) au coût moyen actuel`]);
  return rows;
}
