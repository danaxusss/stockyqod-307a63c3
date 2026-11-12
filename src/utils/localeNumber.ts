/**
 * A number typed as text, French or English: "1 234,50 Dh", "1234,5",
 * "1.234,50", "1,234.50", "-3,5". Returns null when the text holds no
 * number. A lone comma is the decimal separator ("12,50"), except in the
 * thousands pattern "1,234" (three digits after it).
 */
export function parseLocaleNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let s = String(value ?? '').replace(/[\s\u00a0\u202f]/g, '').replace(/[^\d.,-]/g, '');
  if (!/\d/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // Both: the last one is the decimal separator, the other groups thousands.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s = /^-?[1-9]\d{0,2}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(/,/g, '.');
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, ''); // "1.234.567"
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
