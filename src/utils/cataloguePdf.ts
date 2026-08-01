/**
 * Navigable catalogue PDF — TypeScript port of the catalogue-pm ReportLab
 * generator (v5): minimal dark cover, "how to search" guide on page 2,
 * clickable A–Z index, then products in either a compact LIST (table) or a
 * photo GRID (4 cards × 6 rows).
 * Coordinates follow the original (bottom-up, points); Y() converts to jsPDF.
 */
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import type { CatalogueFamily, CatalogueProduct } from './supabaseCatalogue';

export type CatalogueVariant = 'ttc' | 'pro' | 'none';
export type CatalogueLayout = 'list' | 'grid';

export interface CatalogueOptions {
  variant: CatalogueVariant;
  layout: CatalogueLayout;
  title: string;
  brand: string;
  site: string;
  logoDataUrl?: string | null;
  /** optional filename tag, e.g. PHOTOS */
  tag?: string;
  onProgress?: (msg: string, pct: number) => void;
}

export interface Fam extends CatalogueFamily { products: CatalogueProduct[] }
export type ImgMap = Map<string, { data: string; w: number; h: number }>;

// ── palette / geometry (identical to pdfgen.py) ─────────────────────────────
const RED = '#C42B2F', INK = '#16181D', GRAY = '#6B7280';
const MIST = '#F5F6F8', LINE = '#E5E7EB', FADE = '#B8BEC7', WHITE = '#FFFFFF';
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
// grid: 4 cards per row, 6 rows per page
const G_COLS = 4, G_GAP = 8;
const G_W = (CW - (G_COLS - 1) * G_GAP) / G_COLS;
const G_PHOTO_H = 50, G_H = 105, G_ROW = G_H + 8;

const Y = (y: number) => PH - y;
const fill = (d: jsPDF, c: string) => d.setFillColor(c);
const tracked = (s: string) => s.split('').join(' ');
const fprice = (p: number | null | undefined) =>
  p == null ? '' : p.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ | /g, ' ');
const letterOf = (n: string) => { const c = (n.trim()[0] || '#').toUpperCase(); return /^[A-Z]$/.test(c) ? c : '#'; };
const fmtOf = (u: string) => u.startsWith('data:image/png') ? 'PNG' : u.startsWith('data:image/webp') ? 'WEBP' : 'JPEG';

function font(d: jsPDF, style: 'F' | 'FB' | 'FH', size: number) {
  d.setFont('helvetica', style === 'F' ? 'normal' : 'bold');
  d.setFontSize(size);
}
const wOf = (d: jsPDF, s: string) => d.getTextWidth(s);
function split(d: jsPDF, s: string, style: 'F' | 'FB', size: number, w: number): string[] {
  font(d, style, size);
  return d.splitTextToSize(s || '', w) as string[];
}
const text = (d: jsPDF, s: string, x: number, y: number, a: 'left' | 'center' | 'right' = 'left') =>
  d.text(s, x, Y(y), { align: a });
const rect = (d: jsPDF, x: number, y: number, w: number, h: number) => d.rect(x, Y(y + h), w, h, 'F');
const rRect = (d: jsPDF, x: number, y: number, w: number, h: number, r: number, m: 'F' | 'FD' = 'F') =>
  d.roundedRect(x, Y(y + h), w, h, r, r, m);
const line = (d: jsPDF, x1: number, y1: number, x2: number, y2: number) => d.line(x1, Y(y1), x2, Y(y2));

function link(d: jsPDF, x1: number, y1: number, x2: number, y2: number, page: number, top?: number) {
  try { (d as any).link(x1, Y(y2), x2 - x1, y2 - y1, { pageNumber: page, top: top != null ? Y(top) : 0 }); } catch { /* */ }
}
function drawImg(d: jsPDF, img: { data: string; w: number; h: number }, x: number, y: number, bw: number, bh: number) {
  const s = Math.min(bw / img.w, bh / img.h);
  const w = img.w * s, h = img.h * s;
  try { d.addImage(img.data, fmtOf(img.data), x + (bw - w) / 2, Y(y + bh) + (bh - h) / 2, w, h); } catch { /* */ }
}

// ── layout: LIST ────────────────────────────────────────────────────────────
type Op = ['fam', string, string, number, number] | ['famcont', string, number]
  | ['hdr', number] | ['row', CatalogueProduct, number, number, number];

const rowH = (d: jsPDF, p: CatalogueProduct, w: number) =>
  Math.max(PHOTO + 12, split(d, p.designation, 'F', 9, w).length * 12 + 22);

function layoutList(d: jsPDF, fams: Fam[], startPage: number, wDes: number) {
  const pages: Op[][] = []; let cur: Op[] = [];
  const famMeta = new Map<string, [number, number]>();
  let y = TOP;
  const flush = () => { pages.push(cur); cur = []; y = TOP; };
  for (const f of fams) {
    const rows = f.products;
    if (y - (FAM_H + 8 + HDR_H + rowH(d, rows[0], wDes)) < BOT) flush();
    famMeta.set(f.id, [startPage + pages.length, y]);
    cur.push(['fam', f.name, f.id, y, rows.length]); y -= FAM_H + 8;
    cur.push(['hdr', y]); y -= HDR_H;
    rows.forEach((p, i) => {
      const h = rowH(d, p, wDes);
      if (y - h < BOT) {
        flush();
        cur.push(['famcont', f.name, y]); y -= FAM_H - 6 + 4;
        cur.push(['hdr', y]); y -= HDR_H;
      }
      cur.push(['row', p, y, h, i]); y -= h;
    });
  }
  if (cur.length) pages.push(cur);
  return { pages, famMeta };
}

// ── layout: GRID (4 × 6) ────────────────────────────────────────────────────
type GOp = ['fam', string, string, number, number] | ['famcont', string, number]
  | ['card', CatalogueProduct, number, number];

function layoutGrid(fams: Fam[], startPage: number) {
  const pages: GOp[][] = []; let cur: GOp[] = [];
  const famMeta = new Map<string, [number, number]>();
  let y = TOP;
  const flush = () => { pages.push(cur); cur = []; y = TOP; };
  for (const f of fams) {
    if (y - (FAM_H + 10 + G_H) < BOT) flush();
    famMeta.set(f.id, [startPage + pages.length, y]);
    cur.push(['fam', f.name, f.id, y, f.products.length]); y -= FAM_H + 10;
    let col = 0;
    for (const p of f.products) {
      if (col === 0 && y - G_H < BOT) {
        flush();
        cur.push(['famcont', f.name, y]); y -= FAM_H - 6 + 8;
      }
      cur.push(['card', p, ML + col * (G_W + G_GAP), y]);
      col++;
      if (col === G_COLS) { col = 0; y -= G_ROW; }
    }
    if (col) y -= G_ROW;
    y -= 4;
  }
  if (cur.length) pages.push(cur);
  return { pages, famMeta };
}

// ── layout: INDEX ───────────────────────────────────────────────────────────
type IOp = ['letter', string, number, number] | ['entry', Fam, number, number];

function layoutIndex(fams: Fam[]) {
  const entries = [...fams].sort((a, b) => a.name.localeCompare(b.name));
  const pages: IOp[][] = []; let cur: IOp[] = [];
  let col = 0, y = IDX_TOP;
  const seen = new Map<string, number>();
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
      if (!seen.has(L)) seen.set(L, pages.length);
      y -= IDX_LET; last = L;
    }
    advance(IDX_ROW);
    cur.push(['entry', f, col, y]); y -= IDX_ROW;
  }
  if (cur.length) pages.push(cur);
  return { pages, seen };
}

// ── chrome ──────────────────────────────────────────────────────────────────
function header(d: jsPDF, logo: any, title: string) {
  if (logo) drawImg(d, logo, ML, PH - 38, 100, 20);
  font(d, 'FH', 8.5); d.setTextColor(GRAY);
  text(d, tracked(title), PW - MR, PH - 32, 'right');
  fill(d, RED); rect(d, ML, PH - 48, CW, 2.2);
  fill(d, INK); rect(d, ML, PH - 48, 58, 4.2);
}

function footer(d: jsPDF, page: number, total: number, site: string, withIndex = true) {
  d.setDrawColor(LINE); d.setLineWidth(0.6);
  line(d, ML, 40, PW - MR, 40);
  font(d, 'F', 8); d.setTextColor(GRAY);
  text(d, `${page} / ${total}`, PW / 2, 28, 'center');
  text(d, site, PW - MR, 28, 'right');
  if (withIndex) {
    d.setTextColor(RED); font(d, 'FB', 8);
    text(d, '← INDEX', ML, 28);
    link(d, ML - 2, 24, ML + 45, 38, 3);
  }
}

function letterBar(d: jsPDF, letters: Map<string, number>) {
  const bw = CW / 26, yb = PH - 106, r = Math.min(bw - 2, 18) / 2;
  font(d, 'FH', 9);
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((L, i) => {
    const cx = ML + i * bw + bw / 2, cy = yb + 5, on = letters.has(L);
    fill(d, on ? RED : MIST); d.circle(cx, Y(cy), r, 'F');
    d.setTextColor(on ? WHITE : FADE);
    text(d, L, cx, cy - 3.2, 'center');
    if (on) link(d, cx - r, cy - r, cx + r, cy + r, letters.get(L)!);
  });
}

// ── main ────────────────────────────────────────────────────────────────────
export async function generateCataloguePdf(
  fams: Fam[], images: ImgMap, opts: CatalogueOptions,
): Promise<{ blob: Blob; pages: number; filename: string }> {
  const { variant, layout, title, brand, site } = opts;
  const progress = opts.onProgress || (() => {});
  const included = fams.filter(f => f.products.length > 0);
  if (!included.length) throw new Error('Aucune famille / aucun produit à inclure');

  const d = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  d.setProperties({ title: `${title} — ${brand}`, author: brand });

  const priceLabel = variant === 'ttc' ? 'PRIX TTC' : variant === 'pro' ? 'PRIX PRO' : null;
  const wDes = W_DES + (variant === 'none' ? 80 : 0);
  const pval = (p: CatalogueProduct) =>
    variant === 'none' ? null : (variant === 'pro' && p.price_pro != null ? p.price_pro : p.price);

  const logo = opts.logoDataUrl ? await measure(opts.logoDataUrl).catch(() => null) : null;
  const today = new Date().toISOString().slice(0, 10);

  progress('Mise en page…', 5);
  const { pages: idxPages, seen } = layoutIndex(included);
  const nIdx = idxPages.length;
  const laid = layout === 'grid' ? layoutGrid(included, 2 + nIdx + 1) : layoutList(d, included, 2 + nIdx + 1, wDes);
  const prodPages = laid.pages as any[];
  const famMeta = laid.famMeta;
  const total = 2 + nIdx + prodPages.length;
  const letters = new Map<string, number>();
  seen.forEach((rel, L) => letters.set(L, 3 + rel));

  const outline = (d as any).outline;
  const addOutline = (t: string, page: number, parent?: any) => {
    try { return outline?.add(parent ?? null, t, { pageNumber: page }); } catch { return null; }
  };

  // ═══ PAGE 1 — minimal cover ═══
  fill(d, INK); d.rect(0, 0, PW, PH, 'F');
  fill(d, RED); rect(d, 0, PH - 6, PW, 6);
  const lw = 320, lh = 100, lx = PW / 2 - lw / 2, ly = PH - 340;
  fill(d, WHITE); rRect(d, lx, ly, lw, lh, 12);
  if (logo) drawImg(d, logo, lx + 34, ly + 28, lw - 68, lh - 56);
  else { d.setTextColor(INK); font(d, 'FB', 24); text(d, brand.toUpperCase(), PW / 2, ly + lh / 2 - 8, 'center'); }
  d.setTextColor(WHITE); font(d, 'FH', 44);
  text(d, 'CATALOGUE', PW / 2, PH - 428, 'center');
  d.setTextColor(RED); font(d, 'FH', 18);
  text(d, tracked(title.replace(/^CATALOGUE\s*/i, '') || 'PRODUITS'), PW / 2, PH - 456, 'center');
  d.setDrawColor(RED); d.setLineWidth(2);
  line(d, PW / 2 - 34, PH - 478, PW / 2 + 34, PH - 478);
  const nprod = included.reduce((s, f) => s + f.products.length, 0);
  d.setTextColor(FADE); font(d, 'F', 10.5);
  text(d, `Édition du ${today}`, PW / 2, PH - 508, 'center');
  text(d, `${nprod} articles · ${included.length} familles`, PW / 2, PH - 526, 'center');
  d.setTextColor(WHITE); font(d, 'FB', 10.5);
  text(d, site, PW / 2, 60, 'center');
  fill(d, RED); rect(d, 0, 0, PW, 5);

  // ═══ PAGE 2 — how to search ═══
  d.addPage();
  header(d, logo, title);
  addOutline('Comment trouver un article', 2);
  fill(d, RED); rect(d, ML, PH - 78, 10, 10);
  d.setTextColor(INK); font(d, 'FH', 16);
  text(d, 'COMMENT TROUVER UN ARTICLE ?', ML + 18, PH - 78);
  const steps: [string, string, string][] = [
    ['1', 'Ouvrez la recherche de votre lecteur PDF', "Appuyez sur l'icône loupe — disponible dans toutes les apps : Fichiers, WhatsApp, Adobe, Chrome…"],
    ['2', "Tapez le nom de l'article recherché", 'Exemple : « couteau chef », « assiette porcelaine », « planche à découper »…'],
    ['3', 'Le lecteur vous amène directement au résultat', 'Utilisez les flèches suivant / précédent si plusieurs résultats correspondent.'],
  ];
  let gy = PH - 120;
  for (const [num, t1, t2] of steps) {
    fill(d, MIST); d.setDrawColor(LINE); d.setLineWidth(0.8);
    rRect(d, ML + 20, gy - 62, CW - 40, 58, 9, 'FD');
    fill(d, RED); d.circle(ML + 48, Y(gy - 33), 14, 'F');
    d.setTextColor(WHITE); font(d, 'FH', 15);
    text(d, num, ML + 48, gy - 38, 'center');
    d.setTextColor(INK); font(d, 'FB', 11);
    text(d, t1, ML + 74, gy - 27);
    d.setTextColor(GRAY);
    split(d, t2, 'F', 9, CW - 130).forEach((ln, i) => text(d, ln, ML + 74, gy - 42 - i * 11.5));
    gy -= 74;
  }
  d.setTextColor(INK); font(d, 'FH', 13);
  text(d, 'VOUS PRÉFÉREZ NAVIGUER VISUELLEMENT ?', PW / 2, gy - 24, 'center');
  d.setTextColor(GRAY); font(d, 'F', 9);
  text(d, "L'index A–Z contient un lien direct vers chaque famille d'articles.", PW / 2, gy - 42, 'center');
  const bw2 = 240, bh = 44, bx = PW / 2 - bw2 / 2, by = gy - 104;
  fill(d, RED); rRect(d, bx, by, bw2, bh, 9);
  d.setTextColor(WHITE); font(d, 'FH', 14);
  text(d, "VOIR L'INDEX", PW / 2 - 12, by + 16, 'center');
  const ax = PW / 2 + wOf(d, "VOIR L'INDEX") / 2 + 4, ay = by + 21;
  d.setDrawColor(WHITE); d.setLineWidth(2);
  line(d, ax, ay, ax + 16, ay); line(d, ax + 16, ay, ax + 10, ay + 5); line(d, ax + 16, ay, ax + 10, ay - 5);
  link(d, bx, by, bx + bw2, by + bh, 3);
  try {
    const qr = await QRCode.toDataURL(`https://${site}/`, { margin: 1, scale: 6, color: { dark: INK, light: WHITE } });
    const qs = 84;
    d.addImage(qr, 'PNG', PW / 2 - qs / 2, Y(96 + qs), qs, qs);
    d.setTextColor(GRAY); font(d, 'F', 8.5);
    text(d, `Scannez pour visiter ${site}`, PW / 2, 80, 'center');
  } catch { /* QR optional */ }
  footer(d, 2, total, site, false);

  // ═══ INDEX ═══
  const idxOutline = addOutline('Index des familles', 3);
  idxPages.forEach((items, pi) => {
    d.addPage();
    const page = 3 + pi;
    header(d, logo, title);
    fill(d, RED); rect(d, ML, PH - 78, 10, 10);
    d.setTextColor(INK); font(d, 'FH', 16);
    text(d, 'INDEX DES FAMILLES', ML + 18, PH - 78);
    d.setTextColor(GRAY); font(d, 'F', 8.5);
    text(d, 'cliquez sur une famille pour y accéder', PW - MR, PH - 76, 'right');
    letterBar(d, letters);
    for (const op of items) {
      const x0 = ML + op[2] * (COLW + 20);
      if (op[0] === 'letter') {
        const [, L, , y0] = op;
        addOutline(L, page, idxOutline);
        fill(d, RED); d.circle(x0 + 8, Y(y0 - 0.5), 8.5, 'F');
        d.setTextColor(WHITE); font(d, 'FH', 10);
        text(d, L, x0 + 8, y0 - 4, 'center');
        d.setDrawColor(INK); d.setLineWidth(0.9);
        line(d, x0 + 22, y0 - 3, x0 + COLW, y0 - 3);
      } else {
        const [, f, , y0] = op;
        const [pg, famTop] = famMeta.get(f.id)!;
        const lbl = String(pg);
        font(d, 'FB', 7.6);
        const wpg = wOf(d, lbl);
        font(d, 'F', 7.6);
        let nm = f.name;
        while (wOf(d, nm) > COLW - wpg - 10 && nm.length > 4) nm = nm.slice(0, -2);
        if (nm !== f.name) nm = nm.trimEnd() + '…';
        d.setTextColor(INK); text(d, nm, x0, y0 - 4);
        font(d, 'FB', 7.6); text(d, lbl, x0 + COLW, y0 - 4, 'right');
        d.setDrawColor(LINE); d.setLineWidth(0.5); d.setLineDashPattern([1, 2], 0);
        font(d, 'F', 7.6);
        line(d, x0 + wOf(d, nm) + 4, y0 - 2.5, x0 + COLW - wpg - 4, y0 - 2.5);
        d.setLineDashPattern([], 0);
        link(d, x0, y0 - 6, x0 + COLW, y0 + 7, pg, famTop + 14);
      }
    }
    footer(d, page, total, site, pi > 0);
  });

  // ═══ PRODUCTS ═══
  const famHeader = (name: string, y0: number, n: number, page: number) => {
    addOutline(name, page);
    fill(d, RED); rect(d, ML, y0 - FAM_H + 4, 4.5, FAM_H - 4);
    d.setTextColor(INK); font(d, 'FH', 12);
    let nm = name;
    while (wOf(d, nm) > CW - 110 && nm.length > 4) nm = nm.slice(0, -2);
    text(d, nm, ML + 13, y0 - FAM_H + 12);
    d.setTextColor(GRAY); font(d, 'F', 8);
    text(d, `${n} article${n > 1 ? 's' : ''}`, PW - MR, y0 - FAM_H + 12, 'right');
  };
  const famCont = (name: string, y0: number) => {
    const h = FAM_H - 6;
    fill(d, FADE); rect(d, ML, y0 - h + 4, 4.5, h - 4);
    d.setTextColor(GRAY); font(d, 'FH', 9);
    text(d, name + '   (SUITE)', ML + 13, y0 - h + 9);
  };

  prodPages.forEach((ops: any[], pi: number) => {
    d.addPage();
    const page = 3 + nIdx + pi;
    header(d, logo, title);
    for (const op of ops) {
      if (op[0] === 'fam') famHeader(op[1], op[3], op[4], page);
      else if (op[0] === 'famcont') famCont(op[1], op[2]);
      else if (op[0] === 'card') {
        // ── GRID card ──
        const [, p, x, yy] = op as GOp & ['card', CatalogueProduct, number, number];
        fill(d, WHITE); d.setDrawColor(LINE); d.setLineWidth(0.7);
        rRect(d, x, yy - G_H, G_W, G_H, 5, 'FD');
        const im = p.image ? images.get(p.id) : null;
        if (im) drawImg(d, im, x + 6, yy - 6 - G_PHOTO_H, G_W - 12, G_PHOTO_H);
        else {
          fill(d, MIST); rRect(d, x + 6, yy - 6 - G_PHOTO_H, G_W - 12, G_PHOTO_H, 4);
          d.setTextColor(FADE); font(d, 'F', 6);
          text(d, 'photo à venir', x + G_W / 2, yy - 6 - G_PHOTO_H / 2, 'center');
        }
        d.setDrawColor(LINE); d.setLineWidth(0.4);
        line(d, x + 6, yy - 11 - G_PHOTO_H, x + G_W - 6, yy - 11 - G_PHOTO_H);
        const ty = yy - 20 - G_PHOTO_H;
        d.setTextColor(RED); font(d, 'FB', 6.6);
        text(d, (p.ref || '').slice(0, 20), x + 6, ty);
        let ls = split(d, p.designation, 'F', 6, G_W - 12);
        if (ls.length > 2) { ls = ls.slice(0, 2); ls[1] = ls[1].slice(0, -1).trimEnd() + '…'; }
        d.setTextColor(INK); font(d, 'F', 6);
        ls.forEach((ln, k) => text(d, ln, x + 6, ty - 8.5 - k * 7.5));
        if (priceLabel) {
          d.setTextColor(RED); font(d, 'FH', 8.5);
          text(d, fprice(pval(p)), x + G_W - 6, yy - G_H + 6, 'right');
          d.setTextColor(GRAY); font(d, 'F', 5);
          text(d, priceLabel, x + 6, yy - G_H + 7.5);
        }
      } else if (op[0] === 'hdr') {
        const y0 = op[1];
        d.setTextColor(GRAY); font(d, 'FB', 7);
        text(d, 'RÉF.', X_REF, y0 - 11);
        text(d, 'PHOTO', X_PHO + 12, y0 - 11);
        text(d, 'DÉSIGNATION', X_DES, y0 - 11);
        if (priceLabel) text(d, priceLabel, X_PRIX_R, y0 - 11, 'right');
        d.setDrawColor(INK); d.setLineWidth(0.9);
        line(d, ML, y0 - HDR_H, ML + CW, y0 - HDR_H);
      } else if (op[0] === 'row') {
        // ── LIST row ──
        const [, p, y0, rh, i] = op as Op & ['row', CatalogueProduct, number, number, number];
        if (i % 2 === 1) { fill(d, MIST); rect(d, ML, y0 - rh, CW, rh); }
        d.setDrawColor(LINE); d.setLineWidth(0.4);
        line(d, ML, y0 - rh, ML + CW, y0 - rh);
        const cy = y0 - rh / 2;
        d.setTextColor(INK);
        split(d, p.ref, 'FB', 8.5, W_REF).forEach((ln, k) => text(d, ln, X_REF, cy + 3 - k * 10));
        const im = p.image ? images.get(p.id) : null;
        const px = X_PHO + (W_PHO - PHOTO) / 2;
        fill(d, WHITE); d.setDrawColor(LINE); d.setLineWidth(0.6);
        rRect(d, px - 2, cy - PHOTO / 2 - 2, PHOTO + 4, PHOTO + 4, 4, 'FD');
        if (im) drawImg(d, im, px, cy - PHOTO / 2, PHOTO, PHOTO);
        else { d.setTextColor(FADE); font(d, 'F', 6.5); text(d, 'photo', X_PHO + W_PHO / 2, cy - 2, 'center'); }
        const ls = split(d, p.designation, 'F', 9, wDes);
        d.setTextColor(INK); font(d, 'F', 9);
        const yT = cy + (ls.length - 1) * 6 - 3;
        ls.forEach((ln, k) => text(d, ln, X_DES, yT - k * 12));
        if (priceLabel) {
          d.setTextColor(RED); font(d, 'FH', 10);
          text(d, fprice(pval(p)), X_PRIX_R, cy - 3, 'right');
        }
      }
    }
    footer(d, page, total, site);
    if (pi % 10 === 0) progress(`Pages produits… ${pi + 1}/${prodPages.length}`, 40 + Math.round((pi / prodPages.length) * 55));
  });

  progress('Finalisation…', 98);
  const sfx = { ttc: '', pro: '_PRO', none: '_SANS_PRIX' }[variant];
  const lay = layout === 'grid' ? '_GRILLE' : '';
  const tag = opts.tag ? `_${opts.tag}` : '';
  return { blob: d.output('blob'), pages: total, filename: `CATALOGUE${lay}${tag}${sfx}_${today}.pdf` };
}

// ── image helpers ───────────────────────────────────────────────────────────
function measure(dataUrl: string): Promise<{ data: string; w: number; h: number }> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res({ data: dataUrl, w: im.naturalWidth || 100, h: im.naturalHeight || 100 });
    im.onerror = rej;
    im.src = dataUrl;
  });
}

/** Fetch catalogue photos with limited concurrency → keyed by product id. */
export async function fetchCatalogueImages(
  products: CatalogueProduct[], urlOf: (p: string) => string,
  onProgress: (msg: string, pct: number) => void,
): Promise<ImgMap> {
  const withImg = products.filter(p => p.image);
  const map: ImgMap = new Map();
  let done = 0;
  const queue = [...withImg];
  const worker = async () => {
    for (;;) {
      const p = queue.shift();
      if (!p) return;
      try {
        const r = await fetch(urlOf(p.image!));
        if (r.ok) {
          const b = await r.blob();
          const url = await new Promise<string>((res, rej) => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result as string); fr.onerror = rej;
            fr.readAsDataURL(b);
          });
          map.set(p.id, await measure(url));
        }
      } catch { /* missing image → placeholder */ }
      done++;
      if (done % 25 === 0 || done === withImg.length) {
        onProgress(`Photos… ${done}/${withImg.length}`, Math.round((done / withImg.length) * 100));
      }
    }
  };
  await Promise.all(Array.from({ length: 16 }, worker));
  return map;
}
