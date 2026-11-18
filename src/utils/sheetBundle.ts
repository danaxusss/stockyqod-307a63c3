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

/** The business shown on the cover: logo and contact details. */
export interface BundleCompany {
  name: string;
  logoUrl?: string | null;
  address?: string;
  phones?: string[];
  email?: string;
  website?: string;
  ice?: string;
  /** Brand colour (#rrggbb) for the cover. */
  accent?: string;
}

export interface BundleInput {
  title: string;
  subtitle?: string;
  /** Extra lines under the title (quote number, client, date). */
  details?: string[];
  company?: string | BundleCompany;
  sections: BundleSection[];
}

/** The cover's company block from the company settings. */
export function companyFromSettings(settings?: {
  company_name?: string; logo_url?: string | null; address?: string; phone?: string; phone2?: string;
  phone_gsm?: string; phone_dir?: string; email?: string; website?: string; ice?: string;
  quote_style?: { accentColor?: string } | null;
} | null): BundleCompany | undefined {
  if (!settings?.company_name) return undefined;
  const phones = [settings.phone, settings.phone2, settings.phone_gsm, settings.phone_dir].map(v => (v || '').trim()).filter(Boolean);
  return {
    name: settings.company_name,
    logoUrl: settings.logo_url || null,
    address: settings.address || '',
    phones: [...new Set(phones)],
    email: settings.email || '',
    website: settings.website || '',
    ice: settings.ice || '',
    accent: settings.quote_style?.accentColor || undefined,
  };
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

/** #rrggbb → 0..1 channels; a dark blue when missing or invalid. */
function hexColor(hex?: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return [0.12, 0.23, 0.54];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Contents rows that fit on one "Sommaire" page. */
const CONTENTS_PER_PAGE = 16;

/** Builds the bundle. Never throws for a single bad file: it is skipped and reported. */
export async function buildSheetBundle(input: BundleInput, options: BundleOptions = {}): Promise<BundleResult> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  type Img = Awaited<ReturnType<PDFDocumentType['embedPng']>>;
  const fetcher = options.fetcher || ((url: string) => fetch(url));
  const toJpeg = options.toJpeg || browserToJpeg;

  const out: PDFDocumentType = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  out.setTitle(pdfSafe(input.title));
  out.setProducer('Stocky');

  const company: BundleCompany | undefined = typeof input.company === 'string' ? { name: input.company } : input.company;
  const [ar, ag, ab] = hexColor(company?.accent);
  const accent = rgb(ar, ag, ab);
  const accentDark = rgb(ar * 0.72, ag * 0.72, ab * 0.72);
  const dark = rgb(0.07, 0.09, 0.15);
  const grey = rgb(0.42, 0.45, 0.5);
  const line = rgb(0.86, 0.88, 0.9);
  const white = rgb(1, 1, 1);
  const [width, height] = A4;

  // The cover is page 1; the contents ("Sommaire") pages are inserted after it
  // once the sections are known, so section page numbers account for them.
  const contentsPages = Math.max(1, Math.ceil(input.sections.length / CONTENTS_PER_PAGE));
  const cover = out.addPage(A4);
  const total = input.sections.reduce((sum, section) => sum + section.files.length, 0);
  let done = 0;
  let included = 0;
  const skipped: string[] = [];
  const sectionStatus: Array<{ section: BundleSection; ok: number; failed: string[]; firstPage: number | null }> = [];
  // Product photos for the cover mosaic (the first photo of each product).
  const mosaic: Array<{ image: Img; caption: string }> = [];

  const embedImage = async (bytes: Uint8Array, kind: 'png' | 'jpg'): Promise<Img> =>
    kind === 'png' ? out.embedPng(bytes) : out.embedJpg(bytes);

  const addImagePage = async (image: Img, section: BundleSection) => {
    const page: PDFPage = out.addPage(A4);
    // Caption band above the photo: the product it belongs to.
    page.drawRectangle({ x: 0, y: height - 74, width, height: 74, color: rgb(0.97, 0.97, 0.98) });
    page.drawRectangle({ x: 0, y: height - 74, width: 6, height: 74, color: accent });
    page.drawText(pdfSafe(section.heading).slice(0, 80), { x: MARGIN, y: height - 38, size: 13, font: bold, color: dark });
    if (section.subheading) page.drawText(pdfSafe(section.subheading).slice(0, 110), { x: MARGIN, y: height - 56, size: 9.5, font, color: grey });
    const top = height - 74 - 24;
    const bottom = MARGIN + 20;
    const scale = Math.min((width - 2 * MARGIN) / image.width, (top - bottom) / image.height, 1.6);
    const w = image.width * scale;
    const h = image.height * scale;
    page.drawImage(image, { x: (width - w) / 2, y: bottom + (top - bottom - h) / 2, width: w, height: h });
  };

  for (const section of input.sections) {
    const status = { section, ok: 0, failed: [] as string[], firstPage: null as number | null };
    for (const file of section.files) {
      try {
        const response = await fetcher(file.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        let bytes = new Uint8Array(await blob.arrayBuffer());
        let kind = sniff(bytes);
        if (!kind) throw new Error('format');
        const before = out.getPageCount();
        if (kind === 'pdf') {
          const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
          const pages = await out.copyPages(source, source.getPageIndices());
          pages.forEach(page => out.addPage(page));
        } else {
          if (kind === 'other-image') { bytes = await toJpeg(blob); kind = 'jpg'; }
          const image = await embedImage(bytes, kind);
          await addImagePage(image, section);
          if (!mosaic.some(tile => tile.caption === section.heading) && mosaic.length < 6) mosaic.push({ image, caption: section.heading });
        }
        // Page number in the final file: cover + contents pages come first.
        if (status.firstPage === null) status.firstPage = before + contentsPages + 1;
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

  // ── Cover ────────────────────────────────────────────────────────────────
  const bandHeight = 330;
  const bandBottom = height - bandHeight;
  cover.drawRectangle({ x: 0, y: bandBottom, width, height: bandHeight, color: accent });
  // A darker wedge for depth.
  cover.drawRectangle({ x: 0, y: bandBottom, width, height: 10, color: accentDark });
  cover.drawRectangle({ x: width - 150, y: bandBottom + 10, width: 150, height: bandHeight - 10, color: accentDark, opacity: 0.35 });

  // Logo on a white card, top left.
  let logo: Img | null = null;
  if (company?.logoUrl) {
    try {
      const response = await fetcher(company.logoUrl);
      if (!response.ok) throw new Error('logo');
      const blob = await response.blob();
      let bytes = new Uint8Array(await blob.arrayBuffer());
      let kind = sniff(bytes);
      if (kind === 'other-image') { bytes = await toJpeg(blob); kind = 'jpg'; }
      if (kind === 'png' || kind === 'jpg') logo = await embedImage(bytes, kind);
    } catch { /* no logo: the name stands alone */ }
  }
  const cardTop = height - 36;
  if (logo) {
    const scale = Math.min(150 / logo.width, 54 / logo.height);
    const w = logo.width * scale;
    const h = logo.height * scale;
    cover.drawRectangle({ x: MARGIN - 12, y: cardTop - h - 24, width: w + 24, height: h + 24, color: white });
    cover.drawImage(logo, { x: MARGIN, y: cardTop - h - 12, width: w, height: h });
  } else if (company?.name) {
    cover.drawText(pdfSafe(company.name).slice(0, 40), { x: MARGIN, y: cardTop - 30, size: 18, font: bold, color: white });
  }
  if (company?.name && logo) {
    const name = pdfSafe(company.name).slice(0, 40);
    cover.drawText(name, { x: width - MARGIN - bold.widthOfTextAtSize(name, 11), y: cardTop - 18, size: 11, font: bold, color: white });
    if (company.website) {
      const site = pdfSafe(company.website.split('/')[0].trim()).slice(0, 50);
      cover.drawText(site, { x: width - MARGIN - font.widthOfTextAtSize(site, 9), y: cardTop - 33, size: 9, font, color: rgb(0.88, 0.91, 0.97) });
    }
  }

  // Title block.
  let ty = bandBottom + 150;
  const kicker = 'CATALOGUE PRODUITS';
  cover.drawText(kicker, { x: MARGIN, y: ty + 58, size: 10, font: bold, color: rgb(0.85, 0.89, 0.97), characterSpacing: 2.5 } as never);
  cover.drawRectangle({ x: MARGIN, y: ty + 48, width: 46, height: 3, color: white });
  for (const titleLine of wrap(input.title, bold, 36, width - 2 * MARGIN - 120).slice(0, 2)) {
    cover.drawText(titleLine, { x: MARGIN, y: ty, size: 36, font: bold, color: white });
    ty -= 40;
  }
  if (input.subtitle) {
    cover.drawText(pdfSafe(input.subtitle).slice(0, 70), { x: MARGIN, y: ty + 6, size: 14, font: bold, color: rgb(0.92, 0.94, 0.99) });
    ty -= 22;
  }
  const detailText = (input.details || []).map(pdfSafe).filter(Boolean).join('   |   ');
  if (detailText) cover.drawText(detailText.slice(0, 100), { x: MARGIN, y: ty + 4, size: 10.5, font, color: rgb(0.85, 0.89, 0.97) });
  const summary = `${input.sections.length} produit${input.sections.length > 1 ? 's' : ''}  -  ${included} document${included > 1 ? 's' : ''}`;
  cover.drawText(summary, { x: MARGIN, y: bandBottom + 28, size: 10, font: bold, color: white });

  // Photo mosaic.
  const footerHeight = 112;
  const gridTop = bandBottom - 28;
  const gridBottom = footerHeight + 26;
  if (mosaic.length) {
    const cols = mosaic.length <= 2 ? mosaic.length : 3;
    const rows = Math.ceil(mosaic.length / cols);
    const gap = 14;
    const tileW = (width - 2 * MARGIN - gap * (cols - 1)) / cols;
    const tileH = (gridTop - gridBottom - gap * (rows - 1)) / rows;
    mosaic.forEach((tile, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = MARGIN + col * (tileW + gap);
      const yTop = gridTop - row * (tileH + gap);
      cover.drawRectangle({ x, y: yTop - tileH, width: tileW, height: tileH, color: white, borderColor: line, borderWidth: 0.8 });
      const captionH = 22;
      const pad = 8;
      const areaH = tileH - captionH - pad * 2;
      const scale = Math.min((tileW - pad * 2) / tile.image.width, areaH / tile.image.height);
      const w = tile.image.width * scale;
      const h = tile.image.height * scale;
      cover.drawImage(tile.image, { x: x + (tileW - w) / 2, y: yTop - pad - areaH + (areaH - h) / 2, width: w, height: h });
      cover.drawRectangle({ x, y: yTop - tileH, width: tileW, height: captionH, color: rgb(0.97, 0.97, 0.98) });
      let caption = pdfSafe(tile.caption);
      while (caption.length > 3 && bold.widthOfTextAtSize(caption, 7.5) > tileW - 12) caption = caption.slice(0, -2);
      if (caption !== pdfSafe(tile.caption)) caption = `${caption.trimEnd()}...`;
      cover.drawText(caption, { x: x + 6, y: yTop - tileH + 8, size: 7.5, font: bold, color: dark });
    });
  } else {
    const note = 'Fiches techniques des produits du devis';
    cover.drawText(note, { x: (width - font.widthOfTextAtSize(note, 14)) / 2, y: (gridTop + gridBottom) / 2, size: 14, font, color: grey });
  }

  // Contact strip.
  cover.drawRectangle({ x: 0, y: 0, width, height: footerHeight, color: rgb(0.96, 0.97, 0.98) });
  cover.drawRectangle({ x: 0, y: footerHeight - 3, width, height: 3, color: accent });
  if (company) {
    const columns: Array<[string, string[]]> = [
      ['ADRESSE', company.address ? wrap(company.address, font, 8.5, 160).slice(0, 3) : []],
      ['CONTACT', [company.phones?.length ? `Tel : ${company.phones.slice(0, 2).join(' / ')}` : '', company.email || ''].filter(Boolean).map(pdfSafe)],
      ['WEB', [company.website || '', company.ice ? `ICE : ${company.ice}` : ''].filter(Boolean).flatMap(value => wrap(value, font, 8.5, 150)).slice(0, 3)],
    ];
    const colW = (width - 2 * MARGIN) / 3;
    columns.forEach(([label, lines], index) => {
      const x = MARGIN + index * colW;
      cover.drawText(label, { x, y: footerHeight - 30, size: 7.5, font: bold, color: accent, characterSpacing: 1.5 } as never);
      lines.forEach((text, i) => cover.drawText(text.slice(0, 60), { x, y: footerHeight - 46 - i * 12, size: 8.5, font, color: dark }));
    });
  }

  // ── Contents ("Sommaire") ────────────────────────────────────────────────
  for (let pageIndex = 0; pageIndex < contentsPages; pageIndex++) {
    const page = out.insertPage(1 + pageIndex, A4);
    page.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: accent });
    page.drawText(pageIndex === 0 ? 'Sommaire' : 'Sommaire (suite)', { x: MARGIN, y: height - 70, size: 26, font: bold, color: dark });
    if (company?.name) {
      const name = pdfSafe(company.name).slice(0, 40);
      page.drawText(name, { x: width - MARGIN - bold.widthOfTextAtSize(name, 9), y: height - 66, size: 9, font: bold, color: grey });
    }
    page.drawRectangle({ x: MARGIN, y: height - 84, width: 46, height: 3, color: accent });
    let y = height - 124;
    const rows = sectionStatus.slice(pageIndex * CONTENTS_PER_PAGE, (pageIndex + 1) * CONTENTS_PER_PAGE);
    rows.forEach(({ section, ok, failed, firstPage }, i) => {
      const number = String(pageIndex * CONTENTS_PER_PAGE + i + 1).padStart(2, '0');
      page.drawText(number, { x: MARGIN, y, size: 16, font: bold, color: accent });
      const title = wrap(section.heading, bold, 11, width - 2 * MARGIN - 130)[0] || '';
      page.drawText(title, { x: MARGIN + 36, y: y + 2, size: 11, font: bold, color: dark });
      const sub = [section.subheading ? pdfSafe(section.subheading) : '', `${ok} document${ok > 1 ? 's' : ''}`].filter(Boolean).join('  -  ');
      page.drawText(sub.slice(0, 90), { x: MARGIN + 36, y: y - 12, size: 8.5, font, color: grey });
      const pageLabel = firstPage ? `p. ${firstPage}` : 'non incluse';
      const labelFont = firstPage ? bold : font;
      page.drawText(pageLabel, {
        x: width - MARGIN - labelFont.widthOfTextAtSize(pageLabel, 10), y: y + 2, size: 10, font: labelFont,
        color: firstPage ? dark : rgb(0.72, 0.11, 0.11),
      });
      let extra = 0;
      for (const label of failed.slice(0, 2)) {
        extra += 11;
        page.drawText(pdfSafe(`Non incluse : ${label}`).slice(0, 100), { x: MARGIN + 36, y: y - 12 - extra, size: 8, font, color: rgb(0.72, 0.11, 0.11) });
      }
      page.drawLine({ start: { x: MARGIN, y: y - 22 - extra }, end: { x: width - MARGIN, y: y - 22 - extra }, thickness: 0.5, color: line });
      y -= 40 + extra;
    });
  }

  // Page numbers (not on the cover).
  const pageCount = out.getPageCount();
  out.getPages().forEach((page, index) => {
    if (index === 0) return;
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
