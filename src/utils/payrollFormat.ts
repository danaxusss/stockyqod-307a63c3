// Shared French labels and number formats of the payroll pages.

export const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

export function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
}

/** A decimal rate as a French percentage label: 0.0448 → "4,48 %". */
export function pct(rate: number) {
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format((Number(rate) || 0) * 100)} %`;
}

/** Years offered in payroll pickers: from 2025 (first official set) to next year. */
export function payrollYears(): number[] {
  const next = new Date().getFullYear() + 1;
  const out: number[] = [];
  for (let y = next; y >= 2025; y--) out.push(y);
  return out;
}
