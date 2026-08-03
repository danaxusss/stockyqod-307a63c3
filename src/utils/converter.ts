import { supabase } from './supabaseClient';
import { throwEdgeError } from './edgeError';
import { BankService, type ParsedStatement } from './supabaseBank';

// ─── Conversion catalogue ────────────────────────────────────────────────────
// Each entry is one document type the converter understands. 'bank' rides the
// parse-bank-statement function that the accounting module already uses; the
// others go through ai-extract-table (deployed separately).
export type ConversionKind = 'bank' | 'table' | 'invoice';

export interface ConversionDef {
  kind: ConversionKind;
  label: string;
  description: string;
  /** Which edge function serves it — shown when the call fails. */
  fn: string;
}

export const CONVERSIONS: ConversionDef[] = [
  {
    kind: 'bank',
    label: 'Relevé bancaire → Excel',
    description: 'Dates, libellés, débits/crédits et soldes, prêts pour le rapprochement.',
    fn: 'parse-bank-statement',
  },
  {
    kind: 'table',
    label: 'Tableau (générique) → Excel',
    description: 'N\'importe quel document contenant un tableau : listes de prix, inventaires…',
    fn: 'ai-extract-table',
  },
  {
    kind: 'invoice',
    label: 'Facture → Excel',
    description: 'Fournisseur, numéro, dates, lignes d\'articles et totaux HT/TVA/TTC.',
    fn: 'ai-extract-table',
  },
];

// ─── File → page images ──────────────────────────────────────────────────────
/** Render every page of a PDF (or pass through an image) as JPEG data URLs. */
export async function fileToPageImages(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  if (!file.type.includes('pdf')) {
    // plain image — read as-is
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('Fichier illisible'));
      r.readAsDataURL(file);
    });
    onProgress?.(1, 1);
    return [dataUrl];
  }

  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url,
  ).toString();

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const images: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    // target ~1800px on the long side — enough for OCR without huge payloads
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, 1800 / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale: Math.max(1, scale) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
    images.push(canvas.toDataURL('image/jpeg', 0.85));
    onProgress?.(p, doc.numPages);
  }
  return images;
}

// ─── AI extraction ───────────────────────────────────────────────────────────
export interface TableResult { title: string | null; columns: string[]; rows: (string | number)[][] }
export interface InvoiceResult {
  supplier: string | null; invoice_number: string | null; invoice_date: string | null;
  currency: string | null; total_ht: number | null; total_tva: number | null; total_ttc: number | null;
  lines: { description: string; quantity: number | null; unit_price: number | null; total: number | null }[];
}

export async function extractPage(kind: ConversionKind, imageDataUrl: string): Promise<any> {
  if (kind === 'bank') {
    const { data } = await BankService.parseScan(imageDataUrl, 'image/jpeg');
    return data;
  }
  const { data, error } = await supabase.functions.invoke('ai-extract-table', {
    body: { image_base64: imageDataUrl, mime: 'image/jpeg', kind },
  });
  if (error) await throwEdgeError(error, 'ai-extract-table');
  if ((data as any)?.error) throw new Error((data as any).error);
  return (data as any).data;
}

// ─── Merge multi-page results ────────────────────────────────────────────────
export function mergeBank(pages: ParsedStatement[]): ParsedStatement {
  const first = <T,>(pick: (p: ParsedStatement) => T | null): T | null => {
    for (const p of pages) { const v = pick(p); if (v != null && v !== '') return v; }
    return null;
  };
  const lastClosing = [...pages].reverse().map(p => p.closing_balance).find(v => v != null) ?? null;
  return {
    bank_name: first(p => p.bank_name),
    account_code: first(p => p.account_code),
    rib: first(p => p.rib),
    period_start: first(p => p.period_start),
    period_end: [...pages].reverse().map(p => p.period_end).find(v => v != null) ?? null,
    opening_balance: first(p => p.opening_balance),
    closing_balance: lastClosing,
    lines: pages.flatMap(p => p.lines || []),
  };
}

export function mergeTables(pages: TableResult[]): TableResult {
  const base = pages.find(p => p.columns?.length) || pages[0];
  const columns = base?.columns || [];
  const rows = pages.flatMap(p =>
    (p.rows || []).map(r => {
      const row = [...r];
      while (row.length < columns.length) row.push('');
      return row.slice(0, columns.length);
    }));
  return { title: base?.title ?? null, columns, rows };
}

export function mergeInvoices(pages: InvoiceResult[]): InvoiceResult {
  const first = <T,>(pick: (p: InvoiceResult) => T | null): T | null => {
    for (const p of pages) { const v = pick(p); if (v != null && v !== '') return v; }
    return null;
  };
  return {
    supplier: first(p => p.supplier),
    invoice_number: first(p => p.invoice_number),
    invoice_date: first(p => p.invoice_date),
    currency: first(p => p.currency),
    total_ht: first(p => p.total_ht),
    total_tva: first(p => p.total_tva),
    total_ttc: first(p => p.total_ttc),
    lines: pages.flatMap(p => p.lines || []),
  };
}

// ─── Excel export ────────────────────────────────────────────────────────────
const MONEY = '#,##0.00';

async function newWorkbook() {
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  return wb;
}

function download(buffer: ArrayBuffer, filename: string) {
  const url = URL.createObjectURL(new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function styleHeader(row: any) {
  row.font = { bold: true };
  row.eachCell((c: any) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
    c.border = { bottom: { style: 'thin' } };
  });
}

export async function exportBankExcel(s: ParsedStatement, filename: string) {
  const wb = await newWorkbook();
  const ws = wb.addWorksheet('Relevé');
  ws.columns = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Libellé', key: 'label', width: 50 },
    { header: 'Référence', key: 'ref', width: 16 },
    { header: 'Débit', key: 'debit', width: 14, style: { numFmt: MONEY } },
    { header: 'Crédit', key: 'credit', width: 14, style: { numFmt: MONEY } },
    { header: 'Solde', key: 'balance', width: 14, style: { numFmt: MONEY } },
  ];
  // info block above the table
  ws.spliceRows(1, 0, [], [], [], [], []);
  ws.getCell('A1').value = s.bank_name || 'Relevé bancaire';
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = s.rib ? `RIB : ${s.rib}` : '';
  ws.getCell('A3').value = (s.period_start || s.period_end)
    ? `Période : ${s.period_start || '?'} → ${s.period_end || '?'}` : '';
  ws.getCell('D4').value = 'Solde initial'; ws.getCell('E4').value = s.opening_balance;
  ws.getCell('D5').value = 'Solde final'; ws.getCell('E5').value = s.closing_balance;
  ws.getCell('E4').numFmt = MONEY; ws.getCell('E5').numFmt = MONEY;
  styleHeader(ws.getRow(6));
  for (const l of s.lines) {
    ws.addRow({ date: l.date || '', label: l.label || '', ref: l.reference || '', debit: l.debit || 0, credit: l.credit || 0, balance: l.balance ?? '' });
  }
  const totals = ws.addRow({
    label: 'TOTAUX',
    debit: s.lines.reduce((t, l) => t + (l.debit || 0), 0),
    credit: s.lines.reduce((t, l) => t + (l.credit || 0), 0),
  });
  totals.font = { bold: true };
  download(await wb.xlsx.writeBuffer() as ArrayBuffer, filename);
}

export async function exportTableExcel(t: TableResult, filename: string) {
  const wb = await newWorkbook();
  const ws = wb.addWorksheet(t.title?.slice(0, 28) || 'Tableau');
  ws.addRow(t.columns);
  styleHeader(ws.getRow(1));
  for (const r of t.rows) {
    // numeric strings → numbers so Excel can compute on them
    ws.addRow(r.map(v => {
      if (typeof v === 'number') return v;
      const s = String(v ?? '').trim();
      return s !== '' && /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s;
    }));
  }
  ws.columns.forEach((col: any, i: number) => {
    const max = Math.max(String(t.columns[i] || '').length,
      ...t.rows.slice(0, 200).map(r => String(r[i] ?? '').length));
    col.width = Math.min(50, Math.max(10, max + 2));
  });
  download(await wb.xlsx.writeBuffer() as ArrayBuffer, filename);
}

export async function exportInvoiceExcel(inv: InvoiceResult, filename: string) {
  const wb = await newWorkbook();
  const ws = wb.addWorksheet('Facture');
  ws.columns = [
    { header: 'Description', key: 'desc', width: 50 },
    { header: 'Quantité', key: 'qty', width: 12 },
    { header: 'Prix unitaire', key: 'pu', width: 14, style: { numFmt: MONEY } },
    { header: 'Total', key: 'total', width: 14, style: { numFmt: MONEY } },
  ];
  ws.spliceRows(1, 0, [], [], [], [], []);
  ws.getCell('A1').value = inv.supplier || 'Facture';
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = inv.invoice_number ? `N° ${inv.invoice_number}` : '';
  ws.getCell('A3').value = inv.invoice_date ? `Date : ${inv.invoice_date}` : '';
  styleHeader(ws.getRow(6));
  for (const l of inv.lines) {
    ws.addRow({ desc: l.description || '', qty: l.quantity ?? '', pu: l.unit_price ?? '', total: l.total ?? '' });
  }
  ws.addRow({});
  const put = (label: string, v: number | null) => {
    if (v == null) return;
    const r = ws.addRow({ pu: label, total: v });
    r.getCell('total').numFmt = MONEY;
    r.font = { bold: label === 'Total TTC' };
  };
  put('Total HT', inv.total_ht);
  put('TVA', inv.total_tva);
  put('Total TTC', inv.total_ttc);
  download(await wb.xlsx.writeBuffer() as ArrayBuffer, filename);
}
