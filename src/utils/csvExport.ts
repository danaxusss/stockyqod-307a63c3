// CSV for Excel as set up in Morocco/France: ";" between cells, decimal
// commas, and a BOM so accents open correctly.
const SEP = ';';

/** One cell, written so Excel shows what the app shows. */
function csvCell(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v).replace('.', ',') : '';
  let s = String(v);
  if (/^\d+$/.test(s) && (s.length > 1 && s.startsWith('0') || s.length > 11)) {
    // Phone numbers, ICE, long codes: Excel would drop the leading zero or
    // show 6.11E+12. A ="…" formula keeps them as text.
    s = `="${s}"`;
  } else if (/^[=+\-@\t\r]/.test(s)) {
    // Text that Excel would run as a formula (CSV injection).
    s = `'${s}`;
  }
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '\uFEFF';
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.map(csvCell).join(SEP),
    ...rows.map(row => headers.map(h => csvCell(row[h])).join(SEP)),
  ].join('\r\n');
  return '\uFEFF' + csv;
}

export function exportToCSV(rows: Record<string, unknown>[], filename: string): void {
  if (rows.length === 0) return;
  const csv = buildCsv(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : filename + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}
