import { supabase } from './supabaseClient';
import { throwEdgeError, describeEdgeError } from './edgeError';

// ─── Conversion ─────────────────────────────────────────────────────────────
// One generic path, deliberately.
//
// There used to be three: a bank-statement mode, an invoice mode and this
// generic one. The specialised modes demanded a rigid JSON shape and failed on
// real documents, while the generic table extraction read the very same bank
// statement correctly — dates, labels, debits and credits, every page. A
// single well-tested path beats three where two are broken.
export const CONVERTER_FN = 'ai-extract-table';

// ─── Lazy loading of the PDF engine ─────────────────────────────────────────
/** True when the browser failed to fetch a lazily-imported chunk. */
export function isModuleLoadError(e: unknown): boolean {
  const msg = String((e as Error)?.message || e || '');
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(msg);
}

/**
 * pdfjs is loaded on demand (it is ~0.5 MB plus a 1.2 MB worker). That fetch
 * can fail for reasons unrelated to the file being converted: a tab left open
 * across a deploy, a stale service worker, or a flaky mobile connection.
 * Retry once after a short pause, then surface a message that says what to do.
 */
async function loadPdfjs(): Promise<any> {
  try {
    return await import('pdfjs-dist');
  } catch (first) {
    if (!isModuleLoadError(first)) throw first;
    await new Promise(r => setTimeout(r, 800));
    try {
      return await import('pdfjs-dist');
    } catch {
      throw new Error(
        "Le module de lecture PDF n'a pas pu être chargé. " +
        "L'application a probablement été mise à jour depuis l'ouverture de cette page — " +
        "utilisez « Recharger l'application » ci-dessous."
      );
    }
  }
}

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

  const pdfjs = await loadPdfjs();
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
/** Read one page image into { title, columns, rows }. */
export async function extractPage(imageDataUrl: string, model?: string | null): Promise<TableResult> {
  const { data, error } = await supabase.functions.invoke(CONVERTER_FN, {
    body: { image_base64: imageDataUrl, mime: 'image/jpeg', kind: 'table', model: model || undefined },
  });
  if (error) await throwEdgeError(error, CONVERTER_FN);
  if ((data as any)?.error) throw new Error((data as any).error);
  return (data as any).data as TableResult;
}

// ─── Model selection ────────────────────────────────────────────────────────
export interface VisionModel { id: string; name: string; free: boolean; prompt_price: number }

const MODEL_PREF_KEY = 'stocky_converter_model';

/** Empty string = automatic (the server's own preference order). */
export function getPreferredModel(): string {
  try { return localStorage.getItem(MODEL_PREF_KEY) || ''; } catch { return ''; }
}
export function setPreferredModel(id: string): void {
  try {
    if (id) localStorage.setItem(MODEL_PREF_KEY, id);
    else localStorage.removeItem(MODEL_PREF_KEY);
  } catch { /* storage unavailable */ }
}

/**
 * Live list of image-capable models from OpenRouter, via the edge function so
 * the API key stays server-side. Hard-coded ids go stale; this always shows
 * what actually exists on the account today.
 */
export async function listVisionModels(): Promise<VisionModel[]> {
  const { data, error } = await supabase.functions.invoke('ai-extract-table', {
    body: { action: 'list-models' },
  });
  if (error) await throwEdgeError(error, 'ai-extract-table');
  if ((data as any)?.error) throw new Error((data as any).error);
  return ((data as any).models || []) as VisionModel[];
}

// ─── Deployment check ───────────────────────────────────────────────────────
export type FnHealth = 'ok' | 'missing' | 'error';

export interface HealthReport { fn: string; state: FnHealth; detail: string }

/**
 * Is this Edge Function actually deployed?
 *
 * We send a deliberately invalid body. A deployed function rejects it with a
 * readable HTTP status (400) — which proves it is alive. A function that isn't
 * deployed produces a reply the browser blocks (no CORS headers), so
 * supabase-js reports a transport failure with no status at all. That absence
 * is the signal we key on.
 */
export async function checkFunction(fn: string): Promise<HealthReport> {
  try {
    const { error } = await supabase.functions.invoke(fn, { body: {} });
    if (!error) return { fn, state: 'ok', detail: 'Déployée et joignable.' };

    const d = await describeEdgeError(error, fn);
    if (d.status === null) {
      return { fn, state: 'missing', detail: "Ne répond pas — probablement pas déployée." };
    }
    if (d.status === 400) {
      // It answered "you sent nothing useful" — exactly what we wanted.
      return { fn, state: 'ok', detail: 'Déployée et joignable.' };
    }
    if (d.status === 500 && /OPENROUTER_API_KEY/i.test(d.serverMessage || '')) {
      return { fn, state: 'error', detail: "Déployée, mais le secret OPENROUTER_API_KEY manque." };
    }
    return { fn, state: 'ok', detail: `Déployée (a répondu ${d.status}).` };
  } catch (e: any) {
    return { fn, state: 'missing', detail: e?.message || 'Injoignable.' };
  }
}

/** Check the function the converter relies on. */
export async function checkConverterFunctions(): Promise<HealthReport[]> {
  return Promise.all([CONVERTER_FN].map(checkFunction));
}

// ─── Merge multi-page results ────────────────────────────────────────────────
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
