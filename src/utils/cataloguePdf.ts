/**
 * Navigable product-catalogue PDF — TypeScript port of the catalogue-pm
 * ReportLab generator (dark cover + QR, clickable A–Z bar, two-column linked
 * family index, bookmarked product tables with photo thumbnails).
 * Coordinates follow the original (bottom-up, points); Y() converts to jsPDF.
 */
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import type { CatalogFamily, CatalogProduct } from './supabaseCatalog';

export type CatalogueVariant = 'ttc' | 'pro' | 'none';
export type CatalogueTemplate = 'list' | 'grid';

export interface CatalogueOptions {
  variant: CatalogueVariant;
  template?: CatalogueTemplate;  // default 'list'
  title: string;          // e.g. "CATALOGUE PETIT MATÉRIEL"
  brand: string;          // company name
  site: string;           // e.g. cuisimat-groupe.ma
  logoDataUrl?: string | null;
  onProgress?: (msg: string, pct: number) => void;
}

interface Fam extends CatalogFamily { products: CatalogProduct[]; }
type ImgMap = Map<string, { data: string; w: number; h: number }>; // barcode → image

// ── palette / geometry (identical to pdfgen.py) ─────────────────────────────
const RED = '#C42B2F', INK = '#16181D', CARD = '#252A33', GRAY = '#6B7280';
const MIST = '#F5F6F8', LINE = '#E5E7EB', FADE = '#B8BEC7';
const PW = 595.28, PH = 841.89;
const ML = 40, MR = 40, CW = PW - ML - MR;
const TOP = PH - 70, BOT = 52;
const X_REF = ML + 4, W_REF = 88;
const X_PHO = ML + 96, W_PHO = 56;
const X_DES = ML + 162, W_DES = 250;
const X_PRIX_R = ML + CW - 6;
const FAM_H = 28, HDR_H = 17, PHOTO = 46;
const IDX_TOP = PH - 126, IDX_BOT = 56, IDX_ROW = 12.5, IDX_LET = 24;
const COLW = (CW - 20) / 2;

const Y = (y: number) => PH - y;
const hex = (doc: jsPDF, c: string, stroke = false) => stroke ? doc.setDrawColor(c) : doc.setFillColor(c);
const tracked = (s: string) => s.split('').join(' ');
const fprice = (p: number | null | undefined) =>
  p == null ? '' : p.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ |\s/g, ' ');
const letterOf = (name: string) => {
  const c = (name.trim()[0] || '#').toUpperCase();
  return /^[A-Z]$/.test(c) ? c : '#';
};

function font(doc: jsPDF, style: 'F' | 'FB' | 'FH', size: number) {
  doc.setFont('helvetica', style === 'F' ? 'normal' : 'bold');
  doc.setFontSize(size);
}
const widthOf = (doc: jsPDF, s: string) => doc.getTextWidth(s);
function split(doc: jsPDF, s: string, style: 'F' | 'FB', size: number, w: number): string[] {
  font(doc, style, size);
  return doc.splitTextToSize(s || '', w) as string[];
}
function text(doc: jsPDF, s: string, x: number, yRl: number, align: 'left' | 'center' | 'right' = 'left') {
  doc.text(s, x, Y(yRl), { align });
}
function rect(doc: jsPDF, x: number, yRl: number, w: number, h: number) {
  doc.rect(x, Y(yRl + h), w, h, 'F');
}
function roundRect(doc: jsPDF, x: number, yRl: number, w: number, h: number, r: number, mode: 'F' | 'S' | 'FD' = 'F') {
  doc.roundedRect(x, Y(yRl + h), w, h, r, r, mode);
}
function line(doc: jsPDF, x1: number, y1: number, x2: number, y2: number) {
  doc.line(x1, Y(y1), x2, Y(y2));
}
function linkRect(doc: jsPDF, x1: number, y1: number, x2: number, y2: number, pageNumber: number, topRl?: number) {
  try {
    (doc as any).link(x1, Y(y2), x2 - x1, y2 - y1, { pageNumber, top: topRl != null ? Y(topRl) : 0 });
  } catch { /* annotations unsupported — PDF still renders */ }
}
const fmtOf = (dataUrl: string) => dataUrl.startsWith('data:image/png') ? 'PNG' : dataUrl.startsWith('data:image/webp') ? 'WEBP' : 'JPEG';

function drawFitted(doc: jsPDF, img: { data: string; w: number; h: number }, x: number, yRl: number, box: number) {
  const s = Math.min(box / img.w, box / img.h);
  const w = img.w * s, h = img.h * s;
  const dx = x + (box - w) / 2, dyTop = Y(yRl + box) + (box - h) / 2;
  try { doc.addImage(img.data, fmtOf(img.data), dx, dyTop, w, h); } catch { /* corrupt image — skip */ }
}

// ── layout (two-pass, identical logic) ──────────────────────────────────────
type Op =
  | ['fam', string, string, number, number]
  | ['famcont', string, number]
  | ['hdr', number]
  | ['row', CatalogProduct, number, number, number];

function rowHeight(doc: jsPDF, p: CatalogProduct, wDes: number): number {
  const lines = split(doc, p.name || '', 'F', 9, wDes);
  return Math.max(PHOTO + 12, lines.length * 12 + 22);
}

function layoutProducts(doc: jsPDF, fams: Fam[], startPage: number, wDes: number) {
  const pages: Op[][] = [];
  let cur: Op[] = [];
  const famMeta = new Map<string, [number, number]>();
  let y = TOP;
  const flush = () => { pages.push(cur); cur = []; y = TOP; };
  for (const f of fams) {
    const rows = f.products;
    const firstH = FAM_H + 8 + HDR_H + rowHeight(doc, rows[0], wDes);
    if (y - firstH < BOT) flush();
    famMeta.set(f.id, [startPage + pages.length, y]);
    cur.push(['fam', f.name, f.id, y, rows.length]); y -= FAM_H + 8;
    cur.push(['hdr', y]); y -= HDR_H;
    rows.forEach((p, i) => {
      const rh = rowHeight(doc, p, wDes);
      if (y - rh < BOT) {
        flush();
        cur.push(['famcont', f.name, y]); y -= FAM_H - 6 + 4;
        cur.push(['hdr', y]); y -= HDR_H;
      }
      cur.push(['row', p, y, rh, i]); y -= rh;
    });
  }
  if (cur.length) pages.push(cur);
  return { pages, famMeta };
}

// ── grid template layout ────────────────────────────────────────────────────
const G_COLS = 3, G_GAP = 10;
const CARD_W = (CW - (G_COLS - 1) * G_GAP) / G_COLS;   // ≈ 165 pt
const CARD_H = 196, CARD_PHOTO = 104;

type GridOp =
  | ['fam', string, string, number, number]
  | ['famcont', string, number]
  | ['grow', CatalogProduct[], number];               // one row of up to 3 cards

function layoutGrid(fams: Fam[], startPage: number) {
  const pages: GridOp[][] = [];
  let cur: GridOp[] = [];
  const famMeta = new Map<string, [number, number]>();
  let y = TOP;
  const flush = () => { pages.push(cur); cur = []; y = TOP; };
  for (const f of fams) {
    if (y - (FAM_H + 6 + CARD_H) < BOT) flush();
    famMeta.set(f.id, [startPage + pages.length, y]);
    cur.push(['fam', f.name, f.id, y, f.products.length]); y -= FAM_H + 6;
    for (let i = 0; i < f.products.length; i += G_COLS) {
      if (y - CARD_H < BOT) {
        flush();
        cur.push(['famcont', f.name, y]); y -= FAM_H - 6 + 4;
      }
      cur.push(['grow', f.products.slice(i, i + G_COLS), y]);
      y -= CARD_H + G_GAP;
    }
  }
  if (cur.length) pages.push(cur);
  return { pages, famMeta };
}

type IdxOp = ['letter', string, number, number] | ['entry', Fam, number, number];

function layoutIndex(fams: Fam[]) {
  const entries = [...fams].sort((a, b) => a.name.localeCompare(b.name));
  const pages: IdxOp[][] = [];
  let cur: IdxOp[] = [];
  let col = 0, y = IDX_TOP;
  const lettersSeen = new Map<string, number>();
  const advance = (h: number) => {
    if (y - h < IDX_BOT) {
      if (col === 0) { col = 1; y = IDX_TOP; }
      else { pages.push(cur); cur = []; col = 0; y = IDX_TOP; }
    }
  };
  let last: string | null = null;
  for (const f of entries) {
    const L = letterOf(f.name);
    if (L !== last) {
      advance(IDX_LET + IDX_ROW);
      cur.push(['letter', L, col, y]);
      if (!lettersSeen.has(L)) lettersSeen.set(L, pages.length);
      y -= IDX_LET;
      last = L;
    }
    advance(IDX_ROW);
    cur.push(['entry', f, col, y]);
    y -= IDX_ROW;
  }
  if (cur.length) pages.push(cur);
  return { pages, lettersSeen };
}

// ── chrome ──────────────────────────────────────────────────────────────────
function header(doc: jsPDF, logo: { data: string; w: number; h: number } | null, title: string) {
  if (logo) {
    const s = Math.min(100 / logo.w, 20 / logo.h);
    try { doc.addImage(logo.data, fmtOf(logo.data), ML, Y(PH - 38) - 20 + (20 - logo.h * s) / 2, logo.w * s, logo.h * s); } catch { /* */ }
  }
  hex(doc, GRAY); font(doc, 'FH', 8.5);
  doc.setTextColor(GRAY);
  text(doc, tracked(title), PW - MR, PH - 32, 'right');
  hex(doc, RED); rect(doc, ML, PH - 48, CW, 2.2);
  hex(doc, INK); rect(doc, ML, PH - 48, 58, 4.2);
}

function footer(doc: jsPDF, page: number, total: number, site: string, withIndexLink: boolean) {
  hex(doc, LINE, true); doc.setLineWidth(0.6);
  line(doc, ML, 40, PW - MR, 40);
  font(doc, 'F', 8); doc.setTextColor(GRAY);
  text(doc, `${page} / ${total}`, PW / 2, 28, 'center');
  text(doc, site, PW - MR, 28, 'right');
  if (withIndexLink) {
    doc.setTextColor(RED); font(doc, 'FB', 8);
    text(doc, '← INDEX', ML, 28);
    linkRect(doc, ML - 2, 24, ML + 45, 38, 2);
  }
}

function letterBar(doc: jsPDF, lettersAbs: Map<string, number>) {
  const bw = CW / 26, yb = PH - 106, r = Math.min(bw - 2, 18) / 2;
  font(doc, 'FH', 9);
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((L, i) => {
    const cx = ML + i * bw + bw / 2, cy = yb + 5;
    const on = lettersAbs.has(L);
    hex(doc, on ? RED : MIST);
    doc.circle(cx, Y(cy), r, 'F');
    doc.setTextColor(on ? '#FFFFFF' : FADE);
    text(doc, L, cx, cy - 3.2, 'center');
    if (on) linkRect(doc, cx - r, cy - r, cx + r, cy + r, lettersAbs.get(L)!);
  });
}

// ── main ────────────────────────────────────────────────────────────────────
export async function generateCataloguePdf(
  fams: Fam[],
  images: ImgMap,
  opts: CatalogueOptions,
): Promise<{ blob: Blob; pages: number; filename: string }> {
  const { variant, title, brand, site } = opts;
  const progress = opts.onProgress || (() => {});
  const included = fams.filter(f => f.products.length > 0);
  if (!included.length) throw new Error('Aucune famille / aucun produit à inclure');

  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  doc.setProperties({ title: `${title} — ${brand}`, author: brand, subject: `Catalogue produits ${brand}` });

  const priceLabel = variant === 'ttc' ? 'PRIX TTC' : variant === 'pro' ? 'PRIX PRO' : null;
  const wDes = W_DES + (variant === 'none' ? 80 : 0);
  const pval = (p: CatalogProduct) =>
    variant === 'none' ? null : (variant === 'pro' && p.reseller_price ? p.reseller_price : p.price);

  const logo = opts.logoDataUrl ? await measure(opts.logoDataUrl) : null;

  progress('Mise en page…', 5);
  const template: CatalogueTemplate = opts.template || 'list';
  const { pages: idxPages, lettersSeen } = layoutIndex(included);
  const nIdx = idxPages.length;
  const laidOut = template === 'grid'
    ? layoutGrid(included, 1 + nIdx + 1)
    : layoutProducts(doc, included, 1 + nIdx + 1, wDes);
  const prodPages = laidOut.pages as (Op[] | GridOp[])[];
  const famMeta = laidOut.famMeta;
  const total = 1 + nIdx + prodPages.length;
  const lettersAbs = new Map<string, number>();
  lettersSeen.forEach((rel, L) => lettersAbs.set(L, 2 + rel));

  const outline = (doc as any).outline;
  const addOutline = (t: string, page: number, parent?: any) => {
    try { return outline?.add(parent ?? null, t, { pageNumber: page }); } catch { return null; }
  };

  // ============ COVER ============
  const today = new Date().toISOString().slice(0, 10);
  hex(doc, INK); doc.rect(0, 0, PW, PH, 'F');
  hex(doc, RED); rect(doc, 0, PH - 6, PW, 6);
  const lw = 300, lh = 92, lx = PW / 2 - lw / 2, ly = PH - 216;
  hex(doc, '#FFFFFF'); roundRect(doc, lx, ly, lw, lh, 10);
  if (logo) {
    const s = Math.min((lw - 60) / logo.w, (lh - 48) / logo.h);
    doc.addImage(logo.data, fmtOf(logo.data), PW / 2 - (logo.w * s) / 2, Y(ly + lh) + (lh - logo.h * s) / 2, logo.w * s, logo.h * s);
  } else {
    doc.setTextColor(INK); font(doc, 'FB', 22);
    text(doc, brand.toUpperCase(), PW / 2, ly + lh / 2 - 8, 'center');
  }
  doc.setTextColor('#FFFFFF'); font(doc, 'FH', 40);
  text(doc, 'CATALOGUE', PW / 2, PH - 286, 'center');
  doc.setTextColor(RED); font(doc, 'FH', 17);
  text(doc, tracked(title.replace(/^CATALOGUE\s*/i, '') || 'PRODUITS'), PW / 2, PH - 312, 'center');
  const nprod = included.reduce((s, f) => s + f.products.length, 0);
  doc.setTextColor(FADE); font(doc, 'F', 10.5);
  text(doc, `${nprod} articles  ·  ${included.length} familles  ·  édition du ${today}`, PW / 2, PH - 342, 'center');
  doc.setTextColor('#FFFFFF'); font(doc, 'FB', 10);
  text(doc, site, PW / 2, PH - 360, 'center');

  doc.setTextColor('#FFFFFF'); font(doc, 'FH', 13);
  text(doc, 'COMMENT TROUVER UN ARTICLE RAPIDEMENT ?', PW / 2, PH - 402, 'center');
  const steps: [string, string, string][] = [
    ['1', "Ouvrez la recherche de votre lecteur PDF", "Appuyez sur l'icône loupe — disponible dans toutes les apps : Fichiers, WhatsApp, Adobe, Chrome…"],
    ['2', "Tapez le nom de l'article recherché", "Exemple : « couteau chef », « assiette porcelaine », « planche à découper »…"],
    ['3', 'Le lecteur vous amène directement au résultat', 'Utilisez les flèches suivant / précédent si plusieurs résultats correspondent.'],
  ];
  let yy = PH - 418;
  for (const [num, t1, t2] of steps) {
    hex(doc, CARD); roundRect(doc, ML + 26, yy - 56, CW - 52, 52, 9);
    hex(doc, RED); doc.circle(ML + 52, Y(yy - 30), 13, 'F');
    doc.setTextColor('#FFFFFF'); font(doc, 'FH', 14);
    text(doc, num, ML + 52, yy - 35, 'center');
    font(doc, 'FB', 10.5);
    text(doc, t1, ML + 76, yy - 25);
    doc.setTextColor(FADE);
    split(doc, t2, 'F', 8.5, CW - 140).forEach((ln, i) => text(doc, ln, ML + 76, yy - 39 - i * 11));
    yy -= 64;
  }
  const bw2 = 230, bh = 42, bx = PW / 2 - bw2 / 2, by = yy - 34;
  hex(doc, RED); roundRect(doc, bx, by, bw2, bh, 9);
  doc.setTextColor('#FFFFFF'); font(doc, 'FH', 14);
  text(doc, "VOIR L'INDEX", PW / 2 - 12, by + 15, 'center');
  const ax = PW / 2 + widthOf(doc, "VOIR L'INDEX") / 2 + 4, ay = by + 20;
  doc.setDrawColor('#FFFFFF'); doc.setLineWidth(2);
  line(doc, ax, ay, ax + 16, ay); line(doc, ax + 16, ay, ax + 10, ay + 5); line(doc, ax + 16, ay, ax + 10, ay - 5);
  linkRect(doc, bx, by, bx + bw2, by + bh, 2);
  doc.setTextColor(FADE); font(doc, 'F', 8.5);
  text(doc, "Index complet A–Z avec un lien direct vers chaque famille d'articles", PW / 2, by - 16, 'center');
  try {
    const qrData = await QRCode.toDataURL(`https://${site}/`, { margin: 1, scale: 6, color: { dark: INK, light: '#FFFFFF' } });
    const qs = 76;
    hex(doc, '#FFFFFF'); roundRect(doc, PW / 2 - qs / 2 - 8, 66, qs + 16, qs + 16, 8);
    doc.addImage(qrData, 'PNG', PW / 2 - qs / 2, Y(74 + qs), qs, qs);
    doc.setTextColor(FADE); font(doc, 'F', 8.5);
    text(doc, `Scannez pour visiter ${site}`, PW / 2, 52, 'center');
  } catch { /* QR optional */ }
  hex(doc, RED); rect(doc, 0, 0, PW, 5);

  // ============ INDEX ============
  const idxOutline = addOutline('Index des familles', 2);
  idxPages.forEach((items, pi) => {
    doc.addPage();
    const page = 2 + pi;
    header(doc, logo, title);
    hex(doc, RED); rect(doc, ML, PH - 78, 10, 10);
    doc.setTextColor(INK); font(doc, 'FH', 16);
    text(doc, 'INDEX DES FAMILLES', ML + 18, PH - 78);
    doc.setTextColor(GRAY); font(doc, 'F', 8.5);
    text(doc, 'cliquez sur une famille pour y accéder', PW - MR, PH - 76, 'right');
    letterBar(doc, lettersAbs);
    for (const op of items) {
      const x0 = ML + op[2] * (COLW + 20);
      if (op[0] === 'letter') {
        const [, L, , y0] = op;
        addOutline(L, page, idxOutline);
        hex(doc, RED); doc.circle(x0 + 8, Y(y0 - 0.5), 8.5, 'F');
        doc.setTextColor('#FFFFFF'); font(doc, 'FH', 10);
        text(doc, L, x0 + 8, y0 - 4, 'center');
        doc.setDrawColor(INK); doc.setLineWidth(0.9);
        line(doc, x0 + 22, y0 - 3, x0 + COLW, y0 - 3);
      } else {
        const [, f, , y0] = op;
        const [pg, famTop] = famMeta.get(f.id)!;
        const pglabel = String(pg);
        font(doc, 'FB', 7.6);
        const wpg = widthOf(doc, pglabel);
        const maxw = COLW - wpg - 10;
        font(doc, 'F', 7.6);
        let nm = f.name;
        while (widthOf(doc, nm) > maxw && nm.length > 4) nm = nm.slice(0, -2);
        if (nm !== f.name) nm = nm.trimEnd() + '…';
        doc.setTextColor(INK);
        text(doc, nm, x0, y0 - 4);
        font(doc, 'FB', 7.6);
        text(doc, pglabel, x0 + COLW, y0 - 4, 'right');
        doc.setDrawColor(LINE); doc.setLineWidth(0.5); doc.setLineDashPattern([1, 2], 0);
        font(doc, 'F', 7.6);
        line(doc, x0 + widthOf(doc, nm) + 4, y0 - 2.5, x0 + COLW - wpg - 4, y0 - 2.5);
        doc.setLineDashPattern([], 0);
        linkRect(doc, x0, y0 - 6, x0 + COLW, y0 + 7, pg, famTop + 14);
      }
    }
    footer(doc, page, total, site, pi > 0);
  });

  // ============ PRODUCTS ============
  const drawCard = (p: CatalogProduct, x: number, yTopRl: number) => {
    hex(doc, '#FFFFFF'); doc.setDrawColor(LINE); doc.setLineWidth(0.6);
    roundRect(doc, x, yTopRl - CARD_H, CARD_W, CARD_H, 5, 'FD');
    const im = images.get(p.barcode);
    const photoX = x + (CARD_W - CARD_PHOTO) / 2;
    if (im) drawFitted(doc, im, photoX, yTopRl - 8 - CARD_PHOTO, CARD_PHOTO);
    else {
      hex(doc, MIST);
      roundRect(doc, photoX, yTopRl - 8 - CARD_PHOTO, CARD_PHOTO, CARD_PHOTO, 4);
      doc.setTextColor(FADE); font(doc, 'F', 6.5);
      text(doc, 'photo', x + CARD_W / 2, yTopRl - 8 - CARD_PHOTO / 2 - 2, 'center');
    }
    // réf
    doc.setTextColor(INK); font(doc, 'FB', 7.5);
    let ref = p.barcode || '';
    while (widthOf(doc, ref) > CARD_W - 14 && ref.length > 4) ref = ref.slice(0, -2);
    text(doc, ref, x + 7, yTopRl - CARD_PHOTO - 22);
    // désignation — max 3 lines, ellipsis
    let desLines = split(doc, p.name || '', 'F', 6.8, CARD_W - 14);
    if (desLines.length > 3) { desLines = desLines.slice(0, 3); desLines[2] = desLines[2].replace(/.{2}$/, '…'); }
    doc.setTextColor(GRAY); font(doc, 'F', 6.8);
    desLines.forEach((ln, k) => text(doc, ln, x + 7, yTopRl - CARD_PHOTO - 32 - k * 8.5));
    // prix
    if (priceLabel) {
      doc.setTextColor(RED); font(doc, 'FH', 10);
      text(doc, fprice(pval(p)), x + CARD_W - 7, yTopRl - CARD_H + 9, 'right');
      doc.setTextColor(FADE); font(doc, 'F', 5.5);
      text(doc, priceLabel, x + 7, yTopRl - CARD_H + 9);
    }
  };

  prodPages.forEach((ops, pi) => {
    doc.addPage();
    const page = 2 + nIdx + pi;
    header(doc, logo, title);
    if (template === 'grid') {
      for (const op of ops as GridOp[]) {
        if (op[0] === 'fam') {
          const [, name, , y0, nrows] = op;
          addOutline(name, page);
          hex(doc, RED); rect(doc, ML, y0 - FAM_H + 4, 4.5, FAM_H - 4);
          doc.setTextColor(INK); font(doc, 'FH', 12);
          let nm = name;
          while (widthOf(doc, nm) > CW - 110) nm = nm.slice(0, -2);
          text(doc, nm, ML + 13, y0 - FAM_H + 12);
          doc.setTextColor(GRAY); font(doc, 'F', 8);
          text(doc, `${nrows} article${nrows > 1 ? 's' : ''}`, PW - MR, y0 - FAM_H + 12, 'right');
        } else if (op[0] === 'famcont') {
          const [, name, y0] = op;
          const h = FAM_H - 6;
          hex(doc, FADE); rect(doc, ML, y0 - h + 4, 4.5, h - 4);
          doc.setTextColor(GRAY); font(doc, 'FH', 9);
          text(doc, name + '   (SUITE)', ML + 13, y0 - h + 9);
        } else {
          const [, row, y0] = op;
          row.forEach((p, i) => drawCard(p, ML + i * (CARD_W + G_GAP), y0));
        }
      }
      footer(doc, page, total, site, true);
      if (pi % 10 === 0) progress(`Pages produits… ${pi + 1}/${prodPages.length}`, 40 + Math.round((pi / prodPages.length) * 55));
      return;
    }
    for (const op of ops as Op[]) {
      if (op[0] === 'fam') {
        const [, name, fid, y0, nrows] = op;
        addOutline(name, page);
        hex(doc, RED); rect(doc, ML, y0 - FAM_H + 4, 4.5, FAM_H - 4);
        doc.setTextColor(INK); font(doc, 'FH', 12);
        let nm = name;
        while (widthOf(doc, nm) > CW - 110) nm = nm.slice(0, -2);
        text(doc, nm, ML + 13, y0 - FAM_H + 12);
        doc.setTextColor(GRAY); font(doc, 'F', 8);
        text(doc, `${nrows} article${nrows > 1 ? 's' : ''}`, PW - MR, y0 - FAM_H + 12, 'right');
        void fid;
      } else if (op[0] === 'famcont') {
        const [, name, y0] = op;
        const h = FAM_H - 6;
        hex(doc, FADE); rect(doc, ML, y0 - h + 4, 4.5, h - 4);
        doc.setTextColor(GRAY); font(doc, 'FH', 9);
        text(doc, name + '   (SUITE)', ML + 13, y0 - h + 9);
      } else if (op[0] === 'hdr') {
        const y0 = op[1];
        doc.setTextColor(GRAY); font(doc, 'FB', 7);
        text(doc, 'RÉF.', X_REF, y0 - 11);
        text(doc, 'PHOTO', X_PHO + 12, y0 - 11);
        text(doc, 'DÉSIGNATION', X_DES, y0 - 11);
        if (priceLabel) text(doc, priceLabel, X_PRIX_R, y0 - 11, 'right');
        doc.setDrawColor(INK); doc.setLineWidth(0.9);
        line(doc, ML, y0 - HDR_H, ML + CW, y0 - HDR_H);
      } else {
        const [, p, y0, rh, i] = op;
        if (i % 2 === 1) { hex(doc, MIST); rect(doc, ML, y0 - rh, CW, rh); }
        doc.setDrawColor(LINE); doc.setLineWidth(0.4);
        line(doc, ML, y0 - rh, ML + CW, y0 - rh);
        const cy = y0 - rh / 2;
        doc.setTextColor(INK);
        split(doc, p.barcode || '', 'FB', 8.5, W_REF).forEach((ln, k) => text(doc, ln, X_REF, cy + 3 - k * 10));
        const im = images.get(p.barcode);
        const px = X_PHO + (W_PHO - PHOTO) / 2;
        hex(doc, '#FFFFFF'); doc.setDrawColor(LINE); doc.setLineWidth(0.6);
        roundRect(doc, px - 2, cy - PHOTO / 2 - 2, PHOTO + 4, PHOTO + 4, 4, 'FD');
        if (im) drawFitted(doc, im, px, cy - PHOTO / 2, PHOTO);
        else {
          doc.setTextColor(FADE); font(doc, 'F', 6.5);
          text(doc, 'photo', X_PHO + W_PHO / 2, cy - 2, 'center');
        }
        const lines = split(doc, p.name || '', 'F', 9, wDes);
        doc.setTextColor(INK); font(doc, 'F', 9);
        const yTxt = cy + (lines.length - 1) * 6 - 3;
        lines.forEach((ln, k) => text(doc, ln, X_DES, yTxt - k * 12));
        if (priceLabel) {
          doc.setTextColor(RED); font(doc, 'FH', 10);
          text(doc, fprice(pval(p)), X_PRIX_R, cy - 3, 'right');
        }
      }
    }
    footer(doc, page, total, site, true);
    if (pi % 10 === 0) progress(`Pages produits… ${pi + 1}/${prodPages.length}`, 40 + Math.round((pi / prodPages.length) * 55));
  });

  progress('Finalisation…', 98);
  const sfx = { ttc: '', pro: '_PRO', none: '_SANS_PRIX' }[variant];
  const tpl = template === 'grid' ? '_GRILLE' : '';
  const filename = `CATALOGUE${tpl}${sfx}_${today}.pdf`;
  return { blob: doc.output('blob'), pages: total, filename };
}

// ── image helpers ───────────────────────────────────────────────────────────
function measure(dataUrl: string): Promise<{ data: string; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ data: dataUrl, w: img.naturalWidth || 100, h: img.naturalHeight || 100 });
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/** Fetch product images (small JPEGs) with limited concurrency → barcode-keyed map. */
export async function fetchCatalogImages(
  products: CatalogProduct[],
  urlOf: (path: string) => string,
  onProgress: (msg: string, pct: number) => void,
): Promise<ImgMap> {
  const withImg = products.filter(p => p.catalog_image);
  const map: ImgMap = new Map();
  let done = 0;
  const CONC = 16;
  const queue = [...withImg];
  const worker = async () => {
    for (;;) {
      const p = queue.shift();
      if (!p) return;
      try {
        const resp = await fetch(urlOf(p.catalog_image!));
        if (resp.ok) {
          const blob = await resp.blob();
          const dataUrl = await new Promise<string>((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(r.result as string);
            r.onerror = rej;
            r.readAsDataURL(blob);
          });
          map.set(p.barcode, await measure(dataUrl));
        }
      } catch { /* missing image — cell shows "photo" placeholder */ }
      done++;
      if (done % 25 === 0 || done === withImg.length) {
        onProgress(`Photos… ${done}/${withImg.length}`, Math.round((done / withImg.length) * 100));
      }
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));
  return map;
}
