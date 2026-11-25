import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { CompanySettings } from './companySettings';
import { FALLBACK_LABEL, frDay, statementTotals, VALUATION_METHOD, vatRuleText, type StockLine } from '../inventory/lib/stockValuation';

// jsPDF's standard fonts have no narrow no-break space (fr-FR thousands
// separator): plain spaces instead, so the figures print and can be searched.
const plain = (s: string) => s.replace(/[\u202f\u00a0]/g, ' ');
const qty = (v: number) => plain(new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(Number(v) || 0));
const money = (v: number) => plain(new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v) || 0));
const pad = (n: number) => String(n).padStart(2, '0');

export interface InventoryPdfInfo {
  day: string;
  vatRate: number;
  settings?: CompanySettings | null;
  /** Location shown, when not every location. */
  location?: string | null;
  producedAt: Date;
}

/**
 * The detailed inventory at a date (CGI art. 145-II), for the auditor's
 * file: company identifiers, method, one line per reference with its
 * quantity, unit cost and value excluding VAT, totals, page numbers.
 */
export function buildStockInventoryPdf(lines: StockLine[], info: InventoryPdfInfo): jsPDF {
  const doc = new jsPDF('l', 'mm', 'a4');
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = 12;
  const accent: [number, number, number] = [30, 58, 138];
  const s = info.settings;
  const title = `Inventaire détaillé au ${frDay(info.day)}`;
  const totals = statementTotals(lines);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(17, 24, 39);
  doc.text(s?.company_name?.trim() || 'Société', margin, margin + 2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(90, 98, 112);
  const ids = [
    s?.ice && `ICE ${s.ice}`, s?.if_number && `IF ${s.if_number}`, s?.rc && `RC ${s.rc}`,
    s?.patente && `Patente ${s.patente}`, s?.cnss && `CNSS ${s.cnss}`,
  ].filter(Boolean).join(' · ');
  let y = margin + 7;
  for (const text of [ids, s?.address].filter(Boolean) as string[]) {
    const wrapped = doc.splitTextToSize(text, width / 2 - margin);
    doc.text(wrapped, margin, y);
    y += 4 * wrapped.length;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...accent);
  doc.text(title.toUpperCase(), width - margin, margin + 2, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(17, 24, 39);
  doc.text(`Méthode : ${VALUATION_METHOD}`, width - margin, margin + 8, { align: 'right' });
  doc.text(info.location ? `Emplacement : ${info.location}` : 'Tous les emplacements', width - margin, margin + 13, { align: 'right' });

  doc.setFontSize(8);
  doc.setTextColor(90, 98, 112);
  const rule = doc.splitTextToSize(vatRuleText(info.vatRate), width - margin * 2);
  const ruleY = Math.max(y, margin + 18) + 2;
  doc.text(rule, margin, ruleY);

  const marked = (l: StockLine) => (l.currentCost ? ' *' : '');
  autoTable(doc, {
    startY: ruleY + 4 * rule.length + 1,
    head: [['Référence', 'Désignation', 'Marque', 'Quantité', 'Coût unitaire HT', 'Valeur HT']],
    body: lines.map(l => [
      l.barcode, l.name, l.brand, qty(l.quantity) + (l.negative ? ' (négatif)' : ''), money(l.unitCost) + marked(l), money(l.value),
    ]),
    foot: [[
      { content: `${totals.references} référence${totals.references > 1 ? 's' : ''} en stock`, colSpan: 3 },
      { content: qty(totals.quantity), styles: { halign: 'right' } },
      '',
      { content: `${money(totals.value)} MAD`, styles: { halign: 'right' } },
    ]],
    showFoot: 'lastPage',
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.5, textColor: [17, 24, 39], overflow: 'linebreak' },
    headStyles: { fillColor: accent, textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [243, 244, 246], textColor: [17, 24, 39], fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 38 }, 2: { cellWidth: 34 },
      3: { cellWidth: 28, halign: 'right' }, 4: { cellWidth: 32, halign: 'right' }, 5: { cellWidth: 34, halign: 'right' },
    },
    margin: { left: margin, right: margin, bottom: 16 },
  });

  let endY = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? ruleY) + 6;
  const notes = [
    totals.negativeLines > 0 && `${totals.negativeLines} ligne(s) en quantité négative à la date : elles comptent pour zéro dans la valeur totale.`,
    totals.fallbackLines > 0 && `* ${totals.fallbackLines} ligne(s) valorisée(s) au coût moyen actuel, le coût à la date n'ayant pas pu être reconstitué (${[...new Set(lines.filter(l => l.currentCost && l.quantity !== 0).map(l => FALLBACK_LABEL[l.fallbackReason || 'no_cost']))].join(', ')}).`,
  ].filter(Boolean) as string[];
  doc.setFontSize(8);
  doc.setTextColor(90, 98, 112);
  for (const n of notes) {
    const wrapped = doc.splitTextToSize(n, width - margin * 2);
    if (endY + 4 * wrapped.length > height - 16) { doc.addPage(); endY = margin + 6; }
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
    doc.text(`${s?.company_name?.trim() || ''} — ${title} · ${produced}`, margin, height - 7);
    doc.text(`Page ${page} / ${pages}`, width - margin, height - 7, { align: 'right' });
  }
  return doc;
}

export function exportStockInventoryPdf(lines: StockLine[], info: InventoryPdfInfo): void {
  buildStockInventoryPdf(lines, info).save(`inventaire-${info.day}.pdf`);
}
