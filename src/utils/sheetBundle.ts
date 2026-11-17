// One PDF with all the technical sheets and product photos of a quote, so a
// client can download a single file. pdf-lib is loaded only when a bundle is
// built (dynamic import), so it stays out of the main bundle.
import type { PDFDocument as PDFDocumentType, PDFFont, PDFPage } from 'pdf-lib';

export type BundleFileKind = 'pdf' | 'image' | 'auto';

export interface BundleFile {
  url: string;
  /** Shown on the cover when the file cannot be included. */
  label: string;
  kind?: BundleFileKind;
}

export interface BundleSection {
  heading: string;
  subheading?: string;
  files: BundleFile[];
}

export interface BundleInput {
  title: string;
  subtitle?: string;
  company?: string;
  sections: BundleSection[];
}

export interface BundleResult {
  bytes: Uint8Array;
  included: number;
  /** Labels of the files that could not be downloaded or read. */
  skipped: string[];
}

export interface BundleOptions {
  /** Called after each file, included or not. */
  onProgress?: (done: number, total: number) => void;
  fetcher?: (url: string) => Promise<Response>;
  /** Turns an image pdf-lib cannot embed (WebP, GIF…) into JPEG bytes. */
  toJpeg?: (blob: Blob) => Promise<Uint8Array>;
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 40;

/** Kind of a file from its first bytes; null when it is neither a PDF nor an image. */
export function sniff(bytes: Uint8Array): 'pdf' | 'png' | 'jpg' | 'other-image' | null {
  const head = (n: number) => Array.from(bytes.slice(0, n));
  const ascii = String.fromCharCode(...head(12));
  if (ascii.startsWith('%PDF')) return 'pdf';
  if (head(4).join() === [0x89, 0x50, 0x4e, 0x47].join()) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  if (ascii.startsWith('GIF8') || (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') || ascii.startsWith('BM')) return 'other-image';
  if (ascii.slice(4, 8) === 'ftyp') return 'other-image'; // AVIF / HEIC
  return null;
}

/** Text the standard PDF font can draw (WinAnsi): typographic signs replaced, the rest dropped. */
export function pdfSafe(text: string): string {
  return (text || '')
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u00A0\u202F\u2009]/g, ' ')
    .replace(/\u2026/g, '...')
    .replace(/[^\u0020-\u007E\u00A0-\u00FF]/g, '');
}

/** Default image conversion in the browser: draw on a canvas, export JPEG. */
async function browserToJpeg(blob: Blob): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  const jpeg = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!jpeg) throw new Error('jpeg');
  return new Uint8Array(await jpeg.arrayBuffer());
}

/** Lines of `text` that fit in `width` at `size`. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of pdfSafe(text).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

/** Builds the bundle. Never throws for a single bad file: it is skipped and reported. */
export async function buildSheetBundle(input: BundleInput, options: BundleOptions = {}): Promise<BundleResult> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const fetcher = options.fetcher || ((url: string) => fetch(url));
  const toJpeg = options.toJpeg || browserToJpeg;

  const out: PDFDocumentType = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  out.setTitle(pdfSafe(input.title));
  out.setProducer('Stocky');

  // Pages are added after the cover, which is written last (it lists skipped files).
  const cover = out.addPage(A4);
  const total = input.sections.reduce((sum, section) => sum + section.files.length, 0);
  let done = 0;
  let included = 0;
  const skipped: string[] = [];
  const sectionStatus: Array<{ section: BundleSection; ok: number; failed: string[] }> = [];

  const addImagePage = async (bytes: Uint8Array, kind: 'png' | 'jpg', section: BundleSection) => {
    const image = kind === 'png' ? await out.embedPng(bytes) : await out.embedJpg(bytes);
    const page: PDFPage = out.addPage(A4);
    const [width, height] = A4;
    // Caption above the photo: the product it belongs to.
    page.drawText(pdfSafe(section.heading).slice(0, 110), { x: MARGIN, y: height - MARGIN, size: 12, font: bold, color: rgb(0.07, 0.09, 0.15) });
    if (section.subheading) page.drawText(pdfSafe(section.subheading).slice(0, 120), { x: MARGIN, y: height - MARGIN - 15, size: 9, font, color: rgb(0.42, 0.45, 0.5) });
    const top = height - MARGIN - 30;
    const scale = Math.min((width - 2 * MARGIN) / image.width, (top - MARGIN) / image.height, 1.5);
    const w = image.width * scale;
    const h = image.height * scale;
    page.drawImage(image, { x: (width - w) / 2, y: MARGIN + (top - MARGIN - h) / 2, width: w, height: h });
  };

  for (const section of input.sections) {
    const status = { section, ok: 0, failed: [] as string[] };
    for (const file of section.files) {
      try {
        const response = await fetcher(file.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        let bytes = new Uint8Array(await blob.arrayBuffer());
        let kind = sniff(bytes);
        if (!kind) throw new Error('format');
        if (kind === 'pdf') {
          const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
          const pages = await out.copyPages(source, source.getPageIndices());
          pages.forEach(page => out.addPage(page));
        } else {
          if (kind === 'other-image') { bytes = await toJpeg(blob); kind = 'jpg'; }
          await addImagePage(bytes, kind, section);
        }
        status.ok += 1;
        included += 1;
      } catch {
        status.failed.push(file.label);
        skipped.push(file.label);
      }
      done += 1;
      options.onProgress?.(done, total);
    }
    sectionStatus.push(status);
  }

  // Cover: title, then the contents with what could not be included.
  const [width, height] = A4;
  let y = height - MARGIN - 10;
  if (input.company) {
    cover.drawText(pdfSafe(input.company), { x: MARGIN, y, size: 10, font: bold, color: rgb(0.12, 0.23, 0.54) });
    y -= 26;
  }
  for (const line of wrap(input.title, bold, 22, width - 2 * MARGIN)) {
    cover.drawText(line, { x: MARGIN, y, size: 22, font: bold, color: rgb(0.07, 0.09, 0.15) });
    y -= 27;
  }
  if (input.subtitle) {
    for (const line of wrap(input.subtitle, font, 11, width - 2 * MARGIN)) {
      cover.drawText(line, { x: MARGIN, y, size: 11, font, color: rgb(0.29, 0.33, 0.39) });
      y -= 15;
    }
  }
  y -= 14;
  cover.drawText('Contenu', { x: MARGIN, y, size: 13, font: bold, color: rgb(0.07, 0.09, 0.15) });
  y -= 8;
  cover.drawLine({ start: { x: MARGIN, y }, end: { x: width - MARGIN, y }, thickness: 0.6, color: rgb(0.82, 0.84, 0.86) });
  y -= 18;
  let coverPage = cover;
  for (const { section, ok, failed } of sectionStatus) {
    if (y < MARGIN + 40) {
      // Long quotes: the contents continue on a second page, kept right after the cover.
      coverPage = out.insertPage(out.getPages().indexOf(coverPage) + 1, A4);
      y = height - MARGIN - 10;
    }
    const note = failed.length === 0
      ? `${ok} document${ok > 1 ? 's' : ''}`
      : `${ok} inclus, ${failed.length} non inclus`;
    const headingLines = wrap(section.heading, bold, 10.5, width - 2 * MARGIN - 130);
    headingLines.forEach((line, index) => {
      coverPage.drawText(line, { x: MARGIN, y: y - index * 13, size: 10.5, font: bold, color: rgb(0.07, 0.09, 0.15) });
    });
    coverPage.drawText(pdfSafe(note), {
      x: width - MARGIN - font.widthOfTextAtSize(pdfSafe(note), 9), y, size: 9, font,
      color: failed.length ? rgb(0.72, 0.11, 0.11) : rgb(0.42, 0.45, 0.5),
    });
    y -= headingLines.length * 13;
    if (section.subheading) {
      coverPage.drawText(pdfSafe(section.subheading).slice(0, 110), { x: MARGIN, y, size: 9, font, color: rgb(0.42, 0.45, 0.5) });
      y -= 12;
    }
    for (const label of failed) {
      coverPage.drawText(pdfSafe(`Non incluse : ${label}`).slice(0, 110), { x: MARGIN + 10, y, size: 8.5, font, color: rgb(0.72, 0.11, 0.11) });
      y -= 11;
    }
    y -= 8;
  }
  const pageCount = out.getPageCount();
  out.getPages().forEach((page, index) => {
    const label = `${index + 1} / ${pageCount}`;
    page.drawText(label, { x: page.getWidth() - MARGIN - font.widthOfTextAtSize(label, 8), y: 18, size: 8, font, color: rgb(0.55, 0.58, 0.62) });
  });

  return { bytes: await out.save(), included, skipped };
}

/** Saves the bundle bytes as a file in the browser. */
export function downloadBundle(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const bundleFileName = (prefix: string, name: string) =>
  `${prefix}_${(name || 'documents').replace(/[^A-Za-z0-9._-]+/g, '_')}.pdf`;

// ── Sections ────────────────────────────────────────────────────────────────

interface SheetLike { id: string; title: string; manufacturer?: string | null; file_url: string }
interface ImageLike { barcode: string; name: string; brand?: string; url: string }
interface LineLike { product?: { barcode?: string; name?: string; brand?: string } | null; quoteName?: string; quoteBrand?: string }

/** Share page: the sheets, then the photos of products without a sheet. */
export function sectionsForShare(sheets: SheetLike[], images: ImageLike[]): BundleSection[] {
  return [
    ...sheets.map(sheet => ({
      heading: sheet.title,
      subheading: sheet.manufacturer || undefined,
      files: [{ url: sheet.file_url, label: sheet.title, kind: 'pdf' as const }],
    })),
    ...images.map(image => ({
      heading: image.name || image.barcode,
      subheading: [image.brand, image.barcode].filter(Boolean).join(' · ') || undefined,
      files: [{ url: image.url, label: `Photo ${image.name || image.barcode}`, kind: 'image' as const }],
    })),
  ];
}

/**
 * Quote: one section per product, in the order of the quote, with its
 * technical sheets or, without one, its photo. A sheet shared by several
 * products is included once, under the first of them.
 */
export function sectionsForQuote(
  items: LineLike[],
  sheets: SheetLike[],
  links: Array<{ sheet_id: string; product_barcode: string }>,
  images: ImageLike[],
): BundleSection[] {
  const sheetById = new Map(sheets.map(sheet => [sheet.id, sheet]));
  const imageByBarcode = new Map(images.map(image => [image.barcode, image]));
  const usedSheets = new Set<string>();
  const seenProducts = new Set<string>();
  const sections: BundleSection[] = [];
  for (const item of items) {
    const barcode = item.product?.barcode;
    if (!barcode || seenProducts.has(barcode)) continue;
    seenProducts.add(barcode);
    const name = item.quoteName || item.product?.name || barcode;
    const brand = item.quoteBrand || item.product?.brand || '';
    const files: BundleFile[] = [];
    for (const link of links.filter(row => row.product_barcode === barcode)) {
      const sheet = sheetById.get(link.sheet_id);
      if (!sheet || usedSheets.has(sheet.id)) continue;
      usedSheets.add(sheet.id);
      files.push({ url: sheet.file_url, label: sheet.title, kind: 'pdf' });
    }
    const image = imageByBarcode.get(barcode);
    if (!files.length && image) files.push({ url: image.url, label: `Photo ${name}`, kind: 'image' });
    if (files.length) sections.push({ heading: name, subheading: [brand, barcode].filter(Boolean).join(' · '), files });
  }
  return sections;
}
