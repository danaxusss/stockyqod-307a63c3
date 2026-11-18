import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { CompanySettings } from './companySettings';
import { KIND_LABEL, reasonLabel, type StockVoucher } from './stockVouchers';

const qty = (value: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(Number(value) || 0).replace(/[\u202f\u00a0]/g, ' ');
const money = (value: number) => `${(Number(value) || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} Dh`;
const date = (value: string | null | undefined) => (value ? new Date(value).toLocaleDateString('fr-FR') : '—');

/** A Bon d'entrée / Bon de sortie as a printable A4 page. */
export function buildStockVoucherPdf(voucher: StockVoucher, info: { locationName: string; settings?: CompanySettings | null }): jsPDF {
  const doc = new jsPDF('p', 'mm', 'a4');
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = 14;
  const accent: [number, number, number] = [30, 58, 138];
  const lines = voucher.lines || [];
  const withCost = voucher.kind === 'entree' && lines.some(l => l.unit_cost != null);

  // Letterhead
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(17, 24, 39);
  doc.text(info.settings?.company_name?.trim() || 'Stocky', margin, margin + 2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(90, 98, 112);
  const contact = [info.settings?.address, info.settings?.phone, info.settings?.email].filter(Boolean).join(' · ');
  if (contact) doc.text(doc.splitTextToSize(contact, width / 2), margin, margin + 7);

  // Title block
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...accent);
  doc.text(KIND_LABEL[voucher.kind].toUpperCase(), width - margin, margin + 2, { align: 'right' });
  doc.setFontSize(11);
  doc.setTextColor(17, 24, 39);
  doc.text(voucher.number || 'BROUILLON', width - margin, margin + 8, { align: 'right' });
  if (voucher.status === 'cancelled') {
    doc.setTextColor(185, 28, 28);
    doc.text('ANNULÉ', width - margin, margin + 14, { align: 'right' });
  }

  autoTable(doc, {
    startY: margin + 20,
    body: [
      ['Date', date(voucher.voucher_date), 'Emplacement', info.locationName || '—'],
      ['Motif', reasonLabel(voucher.kind, voucher.reason), 'Validé par', voucher.validated_by ? `${voucher.validated_by} le ${date(voucher.validated_at)}` : '—'],
      ...(voucher.note ? [['Note', { content: voucher.note, colSpan: 3 }]] : []),
      ...(voucher.status === 'cancelled' ? [['Annulation', { content: `${voucher.cancelled_by || ''} le ${date(voucher.cancelled_at)}${voucher.cancel_reason ? ` — ${voucher.cancel_reason}` : ''}`, colSpan: 3 }]] : []),
    ],
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.4, textColor: [17, 24, 39] },
    columnStyles: { 0: { fontStyle: 'bold', textColor: [90, 98, 112], cellWidth: 26 }, 2: { fontStyle: 'bold', textColor: [90, 98, 112], cellWidth: 28 } },
    margin: { left: margin, right: margin },
  });

  const startY = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? margin + 40) + 5;
  const totalQty = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
  const totalCost = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0);
  autoTable(doc, {
    startY,
    head: [['#', 'Code', 'Désignation', 'Quantité', ...(withCost ? ['Coût unitaire', 'Total'] : [])]],
    body: lines.map((l, i) => [
      String(i + 1), l.barcode, l.product_name || '', qty(l.quantity),
      ...(withCost ? [l.unit_cost != null ? money(l.unit_cost) : '—', l.unit_cost != null ? money(l.unit_cost * l.quantity) : '—'] : []),
    ]),
    foot: [[
      { content: `${lines.length} ligne${lines.length > 1 ? 's' : ''}`, colSpan: 3 },
      { content: qty(totalQty), styles: { halign: 'right' } },
      ...(withCost ? ['', { content: money(totalCost), styles: { halign: 'right' as const } }] : []),
    ]],
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.8, textColor: [17, 24, 39], overflow: 'linebreak' },
    headStyles: { fillColor: accent, textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [243, 244, 246], textColor: [17, 24, 39], fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 8, halign: 'right' }, 1: { cellWidth: 32 }, 3: { cellWidth: 22, halign: 'right' },
      ...(withCost ? { 4: { cellWidth: 28, halign: 'right' as const }, 5: { cellWidth: 28, halign: 'right' as const } } : {}),
    },
    margin: { left: margin, right: margin },
  });

  // Signatures
  let y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? startY) + 12;
  if (y > height - 45) { doc.addPage(); y = margin + 10; }
  const boxW = (width - margin * 2 - 10) / 2;
  doc.setDrawColor(209, 213, 219);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(90, 98, 112);
  [['Établi par', voucher.created_by || ''], [voucher.kind === 'entree' ? 'Reçu par' : 'Remis par', '']].forEach(([label, name], i) => {
    const x = margin + i * (boxW + 10);
    doc.rect(x, y, boxW, 26);
    doc.text(label, x + 3, y + 5);
    doc.setFont('helvetica', 'normal');
    if (name) doc.text(name, x + 3, y + 10);
    doc.setFont('helvetica', 'bold');
  });

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120, 128, 140);
    doc.text(`${KIND_LABEL[voucher.kind]} ${voucher.number || '(brouillon)'}`, margin, height - 8);
    doc.text(`Page ${page} / ${pages}`, width - margin, height - 8, { align: 'right' });
  }
  return doc;
}

export function exportStockVoucherPdf(voucher: StockVoucher, info: { locationName: string; settings?: CompanySettings | null }): void {
  const doc = buildStockVoucherPdf(voucher, info);
  doc.save(`${(voucher.number || `${voucher.kind}-brouillon`).replace(/[^A-Za-z0-9._-]+/g, '_')}.pdf`);
}
