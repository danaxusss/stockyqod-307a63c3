// Corporate tax (IS) estimate at closing, from the accounting result only:
// no tax reintegrations or deductions, so it is an estimate, not the tax
// return.
//
// IS rates (CGI art. 19-I and the transition of art. 247-XXXVII-A): ONE
// proportional rate applies to the whole net profit, chosen by the level of
// that profit ("le taux … appliqué aux sociétés dont le bénéfice net est …").
// It is not a marginal scale. Keyed by the year the fiscal year opened in; a
// year past the table uses the last row, so a new finance law is one line.

export interface IsRates {
  /** net profit ≤ 300,000 */
  upTo300k: number;
  /** 300,001 – 1,000,000 */
  upTo1M: number;
  /** above 1,000,000 and below 100,000,000 */
  below100M: number;
  /** 100,000,000 and above */
  from100M: number;
}

export const IS_RATES: Record<number, IsRates> = {
  2023: { upTo300k: 0.125, upTo1M: 0.20, below100M: 0.2825, from100M: 0.32 },
  2024: { upTo300k: 0.15, upTo1M: 0.20, below100M: 0.255, from100M: 0.33 },
  2025: { upTo300k: 0.175, upTo1M: 0.20, below100M: 0.2275, from100M: 0.34 },
  2026: { upTo300k: 0.20, upTo1M: 0.20, below100M: 0.20, from100M: 0.35 },
};

/** Cotisation minimale (CGI art. 144-I-D): 0.25 %, never below 3,000 MAD for IS taxpayers. */
export const CM_RATE = 0.0025;
export const CM_MINIMUM = 3000;

/**
 * Contribution sociale de solidarité (CGI art. 267–273): proportional rate of
 * the bracket applied to the whole profit, for profits of 1,000,000 MAD and
 * more; applies to the years 2022 to 2028 (art. 273, LF 2026).
 */
export const CSS_BRACKETS: { from: number; rate: number }[] = [
  { from: 40_000_000, rate: 0.05 },
  { from: 10_000_000, rate: 0.035 },
  { from: 5_000_000, rate: 0.025 },
  { from: 1_000_000, rate: 0.015 },
];
export const CSS_YEARS = { from: 2022, to: 2028 };

/** Last year of the IS transition: acomptes are computed with the rates of the year they are paid for (art. 247-XXXVII-B). */
const TRANSITION_LAST_YEAR = 2026;

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function isRatesFor(year: number): IsRates {
  const years = Object.keys(IS_RATES).map(Number).sort((a, b) => a - b);
  const pick = years.filter(y => y <= year).pop() ?? years[0];
  return IS_RATES[pick];
}

/** The single rate that applies to a given net profit. */
export function isRate(year: number, profit: number): number {
  const r = isRatesFor(year);
  if (profit <= 300_000) return r.upTo300k;
  if (profit <= 1_000_000) return r.upTo1M;
  if (profit < 100_000_000) return r.below100M;
  return r.from100M;
}

export function cssRate(year: number, profit: number): number {
  if (year < CSS_YEARS.from || year > CSS_YEARS.to) return 0;
  return CSS_BRACKETS.find(b => profit >= b.from)?.rate ?? 0;
}

/**
 * Account prefixes of the cotisation minimale base (art. 144-I-B, which refers
 * to art. 9): turnover (711, 712) and other operating income (718), operating
 * subsidies (716), financial income of art. 9-I-B-1° to 3° (732, 733, 738),
 * and subsidies booked as non-current income (756). Stock variations (713),
 * own work capitalised (714) and write-backs (719, 739, 759) are not in it.
 * Rabais accordés (7119) reduce 711, as they should.
 */
export const CM_BASE_PREFIXES = ['711', '712', '716', '718', '732', '733', '738', '756'];

/** Turnover and other income of the CM base, net of VAT, from account balances (debit − credit). */
export function cmBaseFromBalances(balances: Map<string, number>): number {
  let base = 0;
  balances.forEach((b, code) => { if (CM_BASE_PREFIXES.some(p => code.startsWith(p))) base -= b; });
  return r2(Math.max(0, base));
}

/** Result before corporate tax: classes 7 − 6, leaving out tax already booked on 670. */
export function resultBeforeTaxFromBalances(balances: Map<string, number>): { result: number; taxBooked: number } {
  let result = 0, taxBooked = 0;
  balances.forEach((b, code) => {
    const cls = code[0];
    if (code.startsWith('670')) { taxBooked += b; return; }
    if (cls === '6' || cls === '7') result -= b;
  });
  return { result: r2(result), taxBooked: r2(taxBooked) };
}

export interface Instalment { due: string; amount: number }

export interface CorporateTaxEstimate {
  year: number;
  resultBeforeTax: number;
  rate: number;
  isAmount: number;
  cmBase: number;
  cmAmount: number;
  /** The minimum contribution is due instead of the IS (it is the larger). */
  cmApplies: boolean;
  isDue: number;
  cssRate: number;
  css: number;
  netResult: number;
  /** Instalments of the following fiscal year (art. 170-I). */
  instalments: Instalment[];
  instalmentYear: number;
}

function instalmentsFor(nextYear: number, total: number, floorOnly: boolean): Instalment[] {
  // The 3,000 MAD minimum is paid at once before the end of the 3rd month (art. 170-I, 3rd para.).
  if (floorOnly) return [{ due: `${nextYear}-03-31`, amount: r2(total) }];
  const quarter = r2(total / 4);
  const last = r2(total - quarter * 3);
  return [
    { due: `${nextYear}-03-31`, amount: quarter },
    { due: `${nextYear}-06-30`, amount: quarter },
    { due: `${nextYear}-09-30`, amount: quarter },
    { due: `${nextYear}-12-31`, amount: last },
  ];
}

/** IS due on a result: the larger of the proportional IS and the cotisation minimale. */
function isDueFor(year: number, result: number, cmBase: number) {
  const profit = Math.max(0, result);
  const rate = isRate(year, profit);
  const isAmount = r2(profit * rate);
  const cmAmount = r2(Math.max(cmBase * CM_RATE, CM_MINIMUM));
  return { rate, isAmount, cmAmount, cmApplies: cmAmount > isAmount, isDue: Math.max(isAmount, cmAmount) };
}

/**
 * Estimate for a fiscal year opened in `year` (calendar years: the label).
 * Instalments of the following year are 25 % of the reference year's tax; for
 * a following year up to 2026 they are computed with that year's rates
 * (art. 247-XXXVII-B).
 */
export function estimateCorporateTax(input: { year: number; resultBeforeTax: number; cmBase: number }): CorporateTaxEstimate {
  const { year } = input;
  const result = r2(input.resultBeforeTax);
  const cmBase = r2(Math.max(0, input.cmBase));
  const due = isDueFor(year, result, cmBase);
  const profit = Math.max(0, result);
  const cRate = cssRate(year, profit);
  const css = r2(profit * cRate);

  const nextYear = year + 1;
  const ref = nextYear <= TRANSITION_LAST_YEAR ? isDueFor(nextYear, result, cmBase) : due;
  const floorOnly = ref.isDue <= CM_MINIMUM && ref.cmApplies;

  return {
    year,
    resultBeforeTax: result,
    rate: due.rate,
    isAmount: due.isAmount,
    cmBase,
    cmAmount: due.cmAmount,
    cmApplies: due.cmApplies,
    isDue: due.isDue,
    cssRate: cRate,
    css,
    netResult: r2(result - due.isDue - css),
    instalments: instalmentsFor(nextYear, ref.isDue, floorOnly),
    instalmentYear: nextYear,
  };
}
