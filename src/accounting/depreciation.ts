// Fixed-asset depreciation: schedules, CGI rules and category presets.
// Pure functions, used by supabaseAssets.ts and the Immobilisations page.

export type DepreciationMethod = 'lineaire' | 'degressif';

export interface DepreciableAsset {
  account_code?: string;
  acquisition_date: string;
  amount: number | string;
  salvage?: number | string | null;
  duration_years: number;
  method?: DepreciationMethod | string | null;
  passenger_car?: boolean | null;
  depreciations?: { year: number; amount: number | string }[];
}

export interface ScheduleRow {
  year: number;
  months: number;
  amount: number;
  cumulative: number;
  /** Net book value at the end of the year (never below the salvage value). */
  netBookValue: number;
  /** Already booked (a dotation entry exists), rather than planned. */
  booked: boolean;
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v: unknown) => Number(v) || 0;

function start(a: DepreciableAsset): { year: number; month: number } {
  const [y, m] = String(a.acquisition_date).slice(0, 10).split('-').map(Number);
  return { year: y || 0, month: m || 1 };
}

/** Amount to depreciate: cost less the salvage value. */
export const depreciableBase = (a: DepreciableAsset) => r2(num(a.amount) - num(a.salvage));

/**
 * Declining-balance coefficient (CGI art. 10-III-C-1°): 1.5 for 3 or 4
 * years, 2 for 5 or 6 years, 3 above 6 years. Below 3 years the CGI gives
 * none, so the method is not available.
 */
export function degressiveCoefficient(years: number): number | null {
  if (years >= 7) return 3;
  if (years >= 5) return 2;
  if (years >= 3) return 1.5;
  return null;
}

/** Why the declining-balance method cannot be used for this asset, or null when it can. */
export function degressiveRefusal(a: { account_code?: string; passenger_car?: boolean | null; duration_years: number }): string | null {
  // "à l'exclusion des immeubles quelle que soit leur destination et des
  // véhicules de transport de personnes" (art. 10-III-C-1°).
  if (/^23[12]/.test(String(a.account_code || ''))) return 'Les terrains et constructions ne peuvent pas être amortis en dégressif.';
  if (a.passenger_car) return 'Une voiture de tourisme ne peut pas être amortie en dégressif.';
  if (degressiveCoefficient(a.duration_years) == null) return 'Le dégressif demande une durée d\'au moins 3 ans.';
  return null;
}

/** Months depreciated in a calendar year, counted from the 1st of the acquisition month. */
function monthsIn(a: DepreciableAsset, year: number): number {
  const s = start(a);
  if (year < s.year) return 0;
  return year === s.year ? 13 - s.month : 12;
}

/** Months of the plan already elapsed at the start of `year`. */
function monthsBefore(a: DepreciableAsset, year: number): number {
  const s = start(a);
  if (year <= s.year) return 0;
  return (13 - s.month) + (year - s.year - 1) * 12;
}

/**
 * Dotation of one year, given what is already depreciated before it.
 * Linear: base / duration a year, prorated by month the first year; the
 * last year takes what is left.
 * Declining balance: the linear rate × coefficient applied to the remaining
 * value, prorated by month the first year; when the straight line of the
 * remaining value over the remaining months is higher, that is used.
 */
function yearAmount(a: DepreciableAsset, year: number, cumBefore: number): number {
  const months = monthsIn(a, year);
  if (months === 0) return 0;
  const base = depreciableBase(a);
  const remaining = r2(base - cumBefore);
  if (remaining <= 0 || a.duration_years <= 0) return 0;
  const coef = a.method === 'degressif' ? degressiveCoefficient(a.duration_years) : null;
  if (!coef) {
    const annual = r2(base / a.duration_years);
    return r2(Math.min(annual * months / 12, remaining));
  }
  const remainingMonths = a.duration_years * 12 - monthsBefore(a, year);
  if (remainingMonths <= months) return remaining;
  const declining = remaining * (coef / a.duration_years) * months / 12;
  const straight = remaining * months / remainingMonths;
  return r2(Math.min(Math.max(declining, straight), remaining));
}

/**
 * Dotation to book for `year`: computed from the dotations already booked
 * for earlier years (a year that was skipped is not assumed done).
 */
export function dotationForYear(a: DepreciableAsset, year: number): number {
  const s = start(a);
  if (!s.year || year < s.year) return 0;
  const before = (a.depreciations || []).filter(d => d.year < year).reduce((t, d) => t + num(d.amount), 0);
  return yearAmount(a, year, r2(before));
}

/** Full schedule: booked years as booked, the following years as planned. */
export function depreciationSchedule(a: DepreciableAsset): ScheduleRow[] {
  const s = start(a);
  if (!s.year || a.duration_years <= 0) return [];
  const booked = new Map((a.depreciations || []).map(d => [d.year, r2(num(d.amount))]));
  const base = depreciableBase(a);
  const salvage = num(a.salvage);
  const rows: ScheduleRow[] = [];
  let cum = 0;
  for (let year = s.year; year < s.year + a.duration_years + 50; year++) {
    const isBooked = booked.has(year);
    const amount = isBooked ? (booked.get(year) as number) : yearAmount(a, year, cum);
    if (!isBooked && amount <= 0) break;
    cum = r2(cum + amount);
    // The last year of the plan may be partial (acquired during a year).
    const planLeft = a.duration_years * 12 - monthsBefore(a, year);
    const months = planLeft > 0 ? Math.min(monthsIn(a, year), planLeft) : monthsIn(a, year);
    rows.push({ year, months, amount, cumulative: cum, netBookValue: r2(Math.max(salvage, num(a.amount) - cum)), booked: isBooked });
    if (!isBooked && cum >= base) break;
  }
  return rows;
}

/** Net book value: cost less depreciation booked, never below the salvage value. */
export function netBookValue(a: DepreciableAsset): number {
  const cum = (a.depreciations || []).reduce((t, d) => t + num(d.amount), 0);
  return r2(Math.max(num(a.salvage), num(a.amount) - cum));
}

export const isFullyDepreciated = (a: DepreciableAsset) =>
  r2((a.depreciations || []).reduce((t, d) => t + num(d.amount), 0)) >= depreciableBase(a) - 0.005;

// ── Passenger cars (CGI art. 10-I-F-1°-b) ────────────────────────────────────
// The tax-deductible value is capped per vehicle, VAT included, spread over
// five years: 400,000 MAD for cars acquired from 1 January 2025 (LF 2025,
// art. 8-IV-4°), 300,000 MAD before.

export function passengerCarCap(acquisitionDate: string): number {
  return String(acquisitionDate).slice(0, 10) >= '2025-01-01' ? 400_000 : 300_000;
}

/**
 * Part of a year's dotation that is not tax-deductible and is added back in
 * the tax return: the dotation × (cost − cap) / cost. The accounting
 * depreciation itself is unchanged.
 */
export function nonDeductibleDepreciation(a: DepreciableAsset, dotation: number): number {
  if (!a.passenger_car) return 0;
  const cost = num(a.amount);
  const cap = passengerCarCap(a.acquisition_date);
  if (cost <= cap || cost <= 0) return 0;
  return r2(dotation * (cost - cap) / cost);
}

// ── Accounts and presets ─────────────────────────────────────────────────────

/**
 * Depreciation and expense accounts that go with an asset account (CGNC):
 * 21x non-valeurs → 281x / 6191, 22x intangibles → 282x / 6192,
 * 23x tangibles → 283x / 6193.
 */
export function defaultAccountsFor(assetCode: string): { depreciation: string; expense: string } {
  const code = String(assetCode || '');
  const depreciation = code.length >= 3 ? `28${code.slice(1, 3)}` : '';
  const expense = code.startsWith('21') ? '6191' : code.startsWith('22') ? '6192' : '6193';
  return { depreciation, expense };
}

/** The expense account an asset should use, when it uses another one (e.g. 6191 for a vehicle). */
export function expenseAccountHint(a: { account_code: string; expense_account_code: string }): string | null {
  if (!/^2[123]/.test(String(a.account_code))) return null;
  const expected = defaultAccountsFor(a.account_code).expense;
  return a.expense_account_code === expected ? null : expected;
}

export interface AssetPreset {
  key: string;
  label: string;
  account_code: string;
  depreciation_account_code: string;
  expense_account_code: string;
  duration_years: number;
  /** Other usual durations, for a hint. */
  usual: string;
  passenger_car?: boolean;
  /** The declining-balance method is excluded (buildings, passenger cars). */
  noDegressive?: boolean;
}

// Usual durations accepted by the tax administration. Editable on the form.
export const ASSET_PRESETS: AssetPreset[] = [
  { key: 'batiment', label: 'Bâtiment', account_code: '2321', depreciation_account_code: '2832', expense_account_code: '6193', duration_years: 20, usual: '20 à 25 ans (4 à 5 %)', noDegressive: true },
  { key: 'agencement', label: 'Agencements, aménagements', account_code: '2356', depreciation_account_code: '2835', expense_account_code: '6193', duration_years: 10, usual: '10 ans (10 %)' },
  { key: 'materiel', label: 'Matériel et outillage', account_code: '2332', depreciation_account_code: '2833', expense_account_code: '6193', duration_years: 10, usual: '10 ans (10 %)' },
  { key: 'transport', label: 'Matériel de transport', account_code: '2340', depreciation_account_code: '2834', expense_account_code: '6193', duration_years: 5, usual: '5 ans (20 %)' },
  { key: 'voiture', label: 'Voiture de tourisme', account_code: '2340', depreciation_account_code: '2834', expense_account_code: '6193', duration_years: 5, usual: '5 ans (20 %)', passenger_car: true, noDegressive: true },
  { key: 'informatique', label: 'Matériel informatique', account_code: '2355', depreciation_account_code: '2835', expense_account_code: '6193', duration_years: 5, usual: '4 à 5 ans (20 à 25 %)' },
  { key: 'mobilier', label: 'Mobilier de bureau', account_code: '2351', depreciation_account_code: '2835', expense_account_code: '6193', duration_years: 10, usual: '10 ans (10 %)' },
  { key: 'logiciel', label: 'Logiciel', account_code: '2220', depreciation_account_code: '2822', expense_account_code: '6192', duration_years: 5, usual: '5 ans (20 %)' },
];
