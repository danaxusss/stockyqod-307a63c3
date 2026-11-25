import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { CompanySettings } from './companySettings';
import { frDay } from '../inventory/lib/stockValuation';
import { reconTotals, type ReconLine, type Reconciliation } from '../inventory/lib/invoicedStock';
import { GAP_NOTE, reconNotes, reconTitle } from '../inventory/lib/invoicedStockExport';

// jsPDF's standard fonts have no narrow no-break space (fr-FR thousands
// separator): plain spaces instead, so the figures print and can be searched.
const plain = (s: string) => s.replace(/[\u202f\u00a0]/g, ' ');
const qty = (v: number) => plain(new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(Number(v) || 0));
const money = (v: number) => plain(new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v) || 0));
const pad = (n: number) => String(n).padStart(2, '0');

export interface ReconPdfInfo {
  day: string;
  openingAsOf: string | null;
  settings?: CompanySettings | null;
  producedAt: Date;
  filters?: string[];
  countUnreturnedCredits?: boolean;
}

/**
 * The reconciliation of the invoiced stock with the real stock at a date,
 * for the accountant's file: company identifiers, one line per reference,
 * totals, what the figures leave out, page numbers.
 */
export function buildInvoicedStockPdf(lines: ReconLine[], rec: Pick<Reconciliation, 'uncounted' | 'creditNotes'>, info: ReconPdfInfo): jsPDF {
  const doc = new jsPDF('l', 'mm', 'a4');
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = 10;
  const accent: [number, number, number] = [30, 58, 138];
  const s = info.settings;
  const title = reconTitle(info.day);
  const t = reconTotals(lines);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(17, 24, 39);
  doc.text(s?.company_name?.trim() || 'Société', margin, margin + 2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(90, 98, 112);
  const ids = [s?.ice && `ICE ${s.ice}`, s?.if_number && `IF ${s.if_number}`, s?.rc && `RC ${s.rc}`].filter(Boolean).join(' · ');
  if (ids) doc.text(ids, margin, margin + 7);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...accent);
  doc.text(title.toUpperCase(), width - margin, margin + 2, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(17, 24, 39);
  doc.text(info.openingAsOf ? `Ouverture au ${frDay(info.openingAsOf)}` : 'Sans ouverture : stock facturé depuis zéro', width - margin, margin + 8, { align: 'right' });
  if (info.filters && info.filters.length) doc.text(`Filtres : ${info.filters.join(', ')}`, width - margin, margin + 13, { align: 'right' });
  doc.setFontSize(8);
  doc.setTextColor(90, 98, 112);
  doc.text(GAP_NOTE, margin, margin + 18);

  autoTable(doc, {
    startY: margin + 22,
    head: [['Référence', 'Désignation', 'Marque', 'Ouverture', 'Acheté', 'Vendu', 'Retourné', 'Stock facturé', 'Stock réel', 'Écart', 'Coût unit. HT', 'Valeur écart HT']],
    body: lines.map(l => [
      l.barcode, l.name, l.brand, qty(l.opening), qty(l.bought), qty(l.sold), qty(l.returned),
      qty(l.invoiced), qty(l.real), qty(l.gap), money(l.unitCost), money(l.gapValue),
    ]),
    foot: [[
      { content: `${t.references} référence(s), ${t.gapLines} avec un écart`, colSpan: 3 },
      ...[t.opening, t.bought, t.sold, t.returned, t.invoiced, t.real, t.gap].map(v => ({ content: qty(v), styles: { halign: 'right' as const } })),
      '',
      { content: `${money(t.gapValue)} MAD`, styles: { halign: 'right' as const } },
    ]],
    showFoot: 'lastPage',
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 1.3, textColor: [17, 24, 39], overflow: 'linebreak' },
    headStyles: { fillColor: accent, textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [243, 244, 246], textColor: [17, 24, 39], fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 28 }, 2: { cellWidth: 22 },
      3: { halign: 'right', cellWidth: 17 }, 4: { halign: 'right', cellWidth: 17 }, 5: { halign: 'right', cellWidth: 17 }, 6: { halign: 'right', cellWidth: 17 },
      7: { halign: 'right', cellWidth: 19 }, 8: { halign: 'right', cellWidth: 17 }, 9: { halign: 'right', cellWidth: 16 },
      10: { halign: 'right', cellWidth: 21 }, 11: { halign: 'right', cellWidth: 24 },
    },
    margin: { left: margin, right: margin, bottom: 14 },
  });

  let endY = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? margin + 22) + 6;
  doc.setFontSize(8);
  doc.setTextColor(90, 98, 112);
  for (const n of reconNotes(rec, info)) {
    const wrapped = doc.splitTextToSize(n, width - margin * 2);
    if (endY + 4 * wrapped.length > height - 14) { doc.addPage(); endY = margin + 6; }
    doc.text(wrapped, margin, endY);
    endY += 4 * wrapped.length + 1;
  }

  const at = info.producedAt;
  const produced = `Édité le ${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()} ${pad(at.getHours())}:${pad(at.getMinutes())} · Stocky`;
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(120, 128, 140);
    doc.text(`${s?.company_name?.trim() || ''} — ${title} · ${produced}`, margin, height - 6);
    doc.text(`Page ${page} / ${pages}`, width - margin, height - 6, { align: 'right' });
  }
  return doc;
}

export function exportInvoicedStockPdf(lines: ReconLine[], rec: Pick<Reconciliation, 'uncounted' | 'creditNotes'>, info: ReconPdfInfo): void {
  buildInvoicedStockPdf(lines, rec, info).save(`rapprochement-stock-facture-${info.day}.pdf`);
}
