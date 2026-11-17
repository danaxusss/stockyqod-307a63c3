import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { QuoteItem } from '../types';
import type { CompanySettings } from './companySettings';

/** Lines without a supplier are grouped under this name, after the others. */
export const NO_SUPPLIER = 'Fournisseur non renseigné';

export interface SupplierGroup {
  supplier: string;
  items: QuoteItem[];
  /** Σ purchase price × quantity. */
  purchaseTotal: number;
  units: number;
}

/** The supplier of a quote line: chosen for an off-catalogue line, else the product's. */
export function supplierOf(item: QuoteItem): string {
  const name = (item.provider_name || item.product?.provider || '').trim();
  return name && name.toLowerCase() !== 'manuel' ? name : NO_SUPPLIER;
}

export const lineStock = (item: QuoteItem): number =>
  Object.values(item.product?.stock_levels || {}).reduce((sum: number, qty) => sum + Math.max(0, Number(qty) || 0), 0);

/** Quantity still to buy once the stock on hand is used. */
export const toOrder = (item: QuoteItem): number => Math.max(0, (Number(item.quantity) || 0) - lineStock(item));

/** Quote lines grouped by supplier: suppliers A→Z, lines in quote order, unknown supplier last. */
export function groupBySupplier(items: QuoteItem[]): SupplierGroup[] {
  const groups = new Map<string, SupplierGroup>();
  for (const item of items) {
    const supplier = supplierOf(item);
    const group = groups.get(supplier) || { supplier, items: [], purchaseTotal: 0, units: 0 };
    group.items.push(item);
    group.purchaseTotal += (Number(item.product?.buyprice) || 0) * (Number(item.quantity) || 0);
    group.units += Number(item.quantity) || 0;
    groups.set(supplier, group);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.supplier === NO_SUPPLIER) return 1;
    if (b.supplier === NO_SUPPLIER) return -1;
    return a.supplier.localeCompare(b.supplier, 'fr', { sensitivity: 'base' });
  });
}

// The PDF's built-in font has no narrow no-break space: plain spaces only.
const money = (value: number) => `${(Number(value) || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} Dh`;
const qty = (value: number) => String(Number(value) || 0);
// Footer cells don't take the column styles: align their numbers explicitly.
const right = (content: string) => ({ content, styles: { halign: 'right' as const } });

export interface SupplierPdfInfo {
  quoteNumber: string;
  clientName?: string;
  sellerName?: string;
  quoteDate?: string;
}

/**
 * Internal purchasing sheet for a quote: one table per supplier with the
 * products to buy, purchase prices, stock on hand and quantity to order.
 */
export function buildSupplierPurchasePdf(items: QuoteItem[], info: SupplierPdfInfo, settings?: CompanySettings | null): jsPDF {
  const doc = new jsPDF('l', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const accent: [number, number, number] = [30, 58, 138];
  const groups = groupBySupplier(items);
  const grandTotal = groups.reduce((sum, group) => sum + group.purchaseTotal, 0);

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(17, 24, 39);
  doc.text('Liste d’achat par fournisseur', margin, margin + 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(75, 85, 99);
  const company = settings?.company_name?.trim();
  if (company) doc.text(company, pageWidth - margin, margin + 4, { align: 'right' });
  const meta = [
    `Devis ${info.quoteNumber}`,
    info.clientName ? `Client : ${info.clientName}` : '',
    info.sellerName ? `Vendeur : ${info.sellerName}` : '',
    info.quoteDate ? `Date : ${new Date(info.quoteDate).toLocaleDateString('fr-FR')}` : '',
  ].filter(Boolean).join('   ·   ');
  doc.text(meta, margin, margin + 10);
  doc.text('Document interne — ne pas envoyer au client', pageWidth - margin, margin + 10, { align: 'right' });

  // Summary by supplier
  autoTable(doc, {
    startY: margin + 15,
    head: [['Fournisseur', 'Lignes', 'Unités', 'Total achat']],
    body: [
      ...groups.map(group => [group.supplier, String(group.items.length), qty(group.units), money(group.purchaseTotal)]),
    ],
    foot: [['Total', ...[String(items.length), qty(groups.reduce((sum, group) => sum + group.units, 0)), money(grandTotal)].map(right)]],
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.8, textColor: [17, 24, 39] },
    headStyles: { fillColor: accent, textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [243, 244, 246], textColor: [17, 24, 39], fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right', cellWidth: 20 }, 2: { halign: 'right', cellWidth: 20 }, 3: { halign: 'right', cellWidth: 40 } },
    tableWidth: 150,
    margin: { left: margin, right: margin },
  });

  // One table per supplier
  for (const group of groups) {
    const lastY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? margin;
    let y = lastY + 9;
    if (y > pageHeight - 40) { doc.addPage(); y = margin + 4; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...accent);
    doc.text(group.supplier, margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(75, 85, 99);
    doc.text(`${group.items.length} ligne${group.items.length > 1 ? 's' : ''} · ${qty(group.units)} unité${group.units > 1 ? 's' : ''} · total achat ${money(group.purchaseTotal)}`, pageWidth - margin, y, { align: 'right' });

    autoTable(doc, {
      startY: y + 2.5,
      head: [['#', 'Code', 'Désignation', 'Marque', 'Qté', 'Stock disponible', 'À commander', 'Prix d’achat', 'Total achat', 'Prix de vente TTC']],
      body: group.items.map((item, index) => {
        const product = item.product || ({} as QuoteItem['product']);
        const stock = Object.entries(product.stock_levels || {})
          .filter(([, value]) => (Number(value) || 0) > 0)
          .map(([location, value]) => `${location} ${Number(value)}`)
          .join(', ');
        return [
          String(index + 1),
          product.barcode || '',
          product.name || '',
          product.brand || '',
          qty(item.quantity),
          stock || '—',
          qty(toOrder(item)),
          money(Number(product.buyprice) || 0),
          money((Number(product.buyprice) || 0) * (Number(item.quantity) || 0)),
          money(Number(item.unitPrice) || 0),
        ];
      }),
      foot: [[
        { content: `Total ${group.supplier}`, colSpan: 4, styles: { halign: 'left' } },
        right(qty(group.units)), '', right(qty(group.items.reduce((sum, item) => sum + toOrder(item), 0))), '', right(money(group.purchaseTotal)), '',
      ]],
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.6, textColor: [17, 24, 39], valign: 'middle', overflow: 'linebreak' },
      headStyles: { fillColor: [243, 244, 246], textColor: [55, 65, 81], fontStyle: 'bold', lineColor: [209, 213, 219] },
      footStyles: { fillColor: [249, 250, 251], textColor: [17, 24, 39], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 8, halign: 'right', textColor: [107, 114, 128] },
        1: { cellWidth: 30 },
        2: { cellWidth: 'auto' },
        3: { cellWidth: 28 },
        4: { cellWidth: 12, halign: 'right' },
        5: { cellWidth: 36 },
        6: { cellWidth: 20, halign: 'right', fontStyle: 'bold' },
        7: { cellWidth: 26, halign: 'right' },
        8: { cellWidth: 28, halign: 'right' },
        9: { cellWidth: 26, halign: 'right' },
      },
      margin: { left: margin, right: margin },
    });
  }

  // Footer on every page
  const pages = doc.getNumberOfPages();
  const printedAt = new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(107, 114, 128);
    doc.text(`Devis ${info.quoteNumber} · liste d’achat · imprimée le ${printedAt}`, margin, pageHeight - 6);
    doc.text(`Page ${page} / ${pages}`, pageWidth - margin, pageHeight - 6, { align: 'right' });
  }
  return doc;
}

/** Builds and downloads the purchasing sheet. */
export function exportSupplierPurchasePdf(items: QuoteItem[], info: SupplierPdfInfo, settings?: CompanySettings | null): void {
  const doc = buildSupplierPurchasePdf(items, info, settings);
  const safeNumber = (info.quoteNumber || 'devis').replace(/[^A-Za-z0-9._-]+/g, '_');
  doc.save(`Achats_${safeNumber}.pdf`);
}
