// @ts-nocheck
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Quote } from '../types';
import { CompanySettings, QuoteStyle } from './companySettings';

function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
    : [59, 130, 246];
}

function lightenColor(rgb: [number, number, number], factor: number): [number, number, number] {
  return [
    Math.min(255, Math.round(rgb[0] + (255 - rgb[0]) * factor)),
    Math.min(255, Math.round(rgb[1] + (255 - rgb[1]) * factor)),
    Math.min(255, Math.round(rgb[2] + (255 - rgb[2]) * factor)),
  ];
}

const DARK: [number, number, number] = [30, 30, 30];
const GRAY: [number, number, number] = [100, 100, 100];
const LIGHT_GRAY: [number, number, number] = [200, 200, 200];

export class PdfExportService {
  static formatDate(date: Date): string {
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    return `${d}/${m}/${y}`;
  }

  static formatCurrency(amount: number): string {
    return new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  static async exportQuoteToPdf(quote: Quote, settings?: CompanySettings | null): Promise<void> {
    const style: QuoteStyle = settings?.quote_style || {
      accentColor: '#3B82F6', fontFamily: 'helvetica', showBorders: true,
      borderRadius: 1, headerSize: 'large', totalsStyle: 'highlighted',
    };
    const ACCENT = hexToRgb(style.accentColor);
    const ACCENT_LIGHT = lightenColor(ACCENT, 0.85);
    const font = style.fontFamily || 'helvetica';
    const br = style.borderRadius ?? 1;

    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    const fields = settings?.quote_visible_fields || {
      showLogo: true, showCompanyAddress: true, showCompanyPhone: true,
      showCompanyEmail: true, showCompanyWebsite: false, showCompanyICE: true,
      showClientICE: true, showTVA: true, showNotes: true,
      showPaymentTerms: true, showValidityDate: true,
    };

    const tvaRate = settings?.tva_rate ?? 20;

    // === HEADER: Company name + subtitle ===
    const companyName = settings?.company_name || 'Mon Entreprise';
    doc.setFontSize(22);
    doc.setFont(font, 'bold');
    doc.setTextColor(...ACCENT);
    doc.text(companyName, margin, y + 8);

    // Subtitle under company name
    doc.setFontSize(8);
    doc.setFont(font, 'normal');
    doc.setTextColor(...GRAY);
    doc.text('MATERIEL DE CUISINE PROFESSIONNEL', margin, y + 13);

    y += 20;

    // === TWO COLUMN LAYOUT: Client info (left) + Quote info (right) ===
    const leftColWidth = contentWidth * 0.58;
    const rightColWidth = contentWidth * 0.38;
    const rightColX = margin + leftColWidth + contentWidth * 0.04;
    const sectionStartY = y;

    // --- LEFT: Client Information Table ---
    const clientRows: [string, string][] = [];
    clientRows.push(['Nom du Client', quote.customer.fullName || '']);
    if (quote.customer.address || quote.customer.phoneNumber) {
      const addrParts: string[] = [];
      if (quote.customer.phoneNumber) addrParts.push(quote.customer.phoneNumber);
      if (quote.customer.address) addrParts.push(quote.customer.address);
      clientRows.push(['Adresse / Tel', addrParts.join(' / ')]);
    }
    if (quote.customer.city) {
      clientRows.push(['Ville', quote.customer.city]);
    }
    if (quote.customer.salesPerson) {
      clientRows.push(['Commercial', quote.customer.salesPerson]);
    }
    if (fields.showClientICE && quote.customer.ice) {
      clientRows.push(['ICE Client', quote.customer.ice]);
    }

    autoTable(doc, {
      startY: sectionStartY,
      body: clientRows.map(([label, value]) => [label, value]),
      margin: { left: margin, right: pageWidth - margin - leftColWidth },
      theme: 'plain',
      styles: {
        fontSize: 8.5,
        cellPadding: { top: 2.5, bottom: 2.5, left: 3, right: 3 },
        lineColor: LIGHT_GRAY,
        lineWidth: 0.3,
        textColor: DARK,
      },
      columnStyles: {
        0: {
          cellWidth: 30,
          fillColor: ACCENT,
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 7.5,
        },
        1: {
          cellWidth: leftColWidth - 30,
          fontSize: 8.5,
        },
      },
      tableLineColor: LIGHT_GRAY,
      tableLineWidth: 0.3,
    });

    // --- RIGHT: DEVIS title + Quote details ---
    let rightY = sectionStartY;

    // DEVIS title
    doc.setFontSize(28);
    doc.setFont(font, 'bold');
    doc.setTextColor(...ACCENT);
    doc.text('DEVIS', rightColX + rightColWidth, rightY + 6, { align: 'right' });
    rightY += 14;

    // Quote details as mini table
    const quoteInfoRows: [string, string][] = [
      ['Date', this.formatDate(quote.createdAt)],
      ['N° de piece', quote.quoteNumber],
    ];
    if (quote.commandNumber) {
      quoteInfoRows.push(['N° de cmd', quote.commandNumber]);
    }
    if (fields.showValidityDate) {
      const validityDays = settings?.quote_validity_days ?? 30;
      const validityDate = new Date(quote.createdAt);
      validityDate.setDate(validityDate.getDate() + validityDays);
      quoteInfoRows.push(['Validite', this.formatDate(validityDate)]);
    }

    autoTable(doc, {
      startY: rightY,
      body: quoteInfoRows,
      margin: { left: rightColX, right: margin },
      theme: 'plain',
      styles: {
        fontSize: 8,
        cellPadding: { top: 2, bottom: 2, left: 3, right: 3 },
        lineColor: LIGHT_GRAY,
        lineWidth: 0.2,
        textColor: DARK,
      },
      columnStyles: {
        0: { cellWidth: 25, fontStyle: 'bold', textColor: GRAY, fontSize: 7.5 },
        1: { cellWidth: rightColWidth - 25, halign: 'right' },
      },
    });

    // Get final Y after both sections
    const leftFinalY = (doc as any).lastAutoTable?.finalY || sectionStartY + 30;
    y = Math.max(leftFinalY, (doc as any).lastAutoTable?.finalY || sectionStartY + 30) + 6;

    // === COMPANY DETAILS (small line under header) ===
    const companyDetails: string[] = [];
    if (fields.showCompanyAddress && settings?.address) companyDetails.push(settings.address);
    if (fields.showCompanyPhone && settings?.phone) companyDetails.push(`Tel: ${settings.phone}`);
    if (fields.showCompanyEmail && settings?.email) companyDetails.push(settings.email);

    if (companyDetails.length > 0) {
      doc.setFontSize(7);
      doc.setFont(font, 'normal');
      doc.setTextColor(...GRAY);
      doc.text(companyDetails.join('  |  '), margin, y);
      y += 5;
    }

    // === ITEMS TABLE ===
    // CHR-style: Brand | Barcode | Description | QTE | PU TTC | TOTAL TTC
    const showTVA = fields.showTVA;

    const tableHeaders = [['Marque', 'REF', 'DESCRIPTION', 'QTE', 'PU TTC', 'TOTAL TTC']];

    const tableBody = quote.items.map(item => {
      const totalTTC = item.unitPrice * item.quantity;
      return [
        item.product.brand || '',
        item.product.barcode || '',
        item.product.name,
        String(item.quantity),
        this.formatCurrency(item.unitPrice),
        this.formatCurrency(totalTTC),
      ];
    });

    autoTable(doc, {
      startY: y,
      head: tableHeaders,
      body: tableBody,
      margin: { left: margin, right: margin },
      styles: {
        fontSize: 8,
        cellPadding: 2.5,
        lineColor: LIGHT_GRAY,
        lineWidth: 0.2,
        textColor: DARK,
        overflow: 'linebreak',
      },
      headStyles: {
        fillColor: ACCENT,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8,
        halign: 'center',
      },
      alternateRowStyles: {
        fillColor: [250, 250, 252],
      },
      columnStyles: {
        0: { cellWidth: 22, halign: 'center' },  // Marque
        1: { cellWidth: 28, halign: 'center' },   // REF / Barcode
        2: { cellWidth: 'auto' },                   // Description
        3: { cellWidth: 14, halign: 'center' },    // QTE
        4: { cellWidth: 26, halign: 'right' },     // PU TTC
        5: { cellWidth: 28, halign: 'right' },     // TOTAL TTC
      },
    });

    y = (doc as any).lastAutoTable.finalY + 4;

    // === TOTALS ===
    const totalTTC = quote.totalAmount;
    const totalHT = totalTTC / (1 + tvaRate / 100);
    const totalTVA = totalTTC - totalHT;

    // Totals table (right-aligned)
    const totalsData: (string | { content: string; styles: object })[][] = [];

    if (showTVA) {
      totalsData.push([
        { content: 'TOTAL HT', styles: { fontStyle: 'bold', halign: 'right' } },
        { content: `${this.formatCurrency(totalHT)}`, styles: { halign: 'right' } },
      ]);
      totalsData.push([
        { content: `TVA ${tvaRate}%`, styles: { fontStyle: 'bold', halign: 'right' } },
        { content: `${this.formatCurrency(totalTVA)}`, styles: { halign: 'right' } },
      ]);
    }

    // Total TTC row
    const ttcRowStyle = style.totalsStyle === 'highlighted'
      ? { fillColor: ACCENT, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 10 }
      : style.totalsStyle === 'boxed'
      ? { lineColor: ACCENT, lineWidth: 0.5, fontStyle: 'bold', textColor: ACCENT, fontSize: 10 }
      : { fontStyle: 'bold', textColor: ACCENT, fontSize: 10 };

    totalsData.push([
      { content: 'TOTAL TTC', styles: { ...ttcRowStyle, halign: 'right' } },
      { content: `${this.formatCurrency(totalTTC)}`, styles: { ...ttcRowStyle, halign: 'right' } },
    ]);

    autoTable(doc, {
      startY: y,
      body: totalsData,
      margin: { left: pageWidth - margin - 80, right: margin },
      theme: 'plain',
      styles: {
        fontSize: 9,
        cellPadding: { top: 2.5, bottom: 2.5, left: 4, right: 4 },
        textColor: DARK,
        lineColor: LIGHT_GRAY,
        lineWidth: 0.2,
      },
      columnStyles: {
        0: { cellWidth: 35 },
        1: { cellWidth: 45 },
      },
    });

    y = (doc as any).lastAutoTable.finalY + 6;

    // === NOTES ===
    if (fields.showNotes && quote.notes) {
      doc.setTextColor(...DARK);
      doc.setFont(font, 'bold');
      doc.setFontSize(8);
      doc.text('Note:', margin, y + 3);
      doc.setFont(font, 'normal');
      const noteLines = doc.splitTextToSize(quote.notes, contentWidth - 15);
      doc.text(noteLines, margin + 12, y + 3);
      y += 4 + noteLines.length * 4;
    }

    // === FOOTER ===
    // Always push footer to bottom area
    const footerY = Math.max(y + 10, pageHeight - 30);

    if (fields.showPaymentTerms) {
      doc.setDrawColor(...LIGHT_GRAY);
      doc.line(margin, footerY - 4, pageWidth - margin, footerY - 4);

      doc.setFontSize(7.5);
      doc.setFont(font, 'normal');
      doc.setTextColor(...GRAY);
      doc.text(
        `Conditions de reglement : ${settings?.payment_terms || '30 jours'}`,
        margin,
        footerY
      );
    }

    // Company legal footer (centered at very bottom)
    const legalY = pageHeight - 14;
    doc.setDrawColor(...ACCENT);
    doc.setLineWidth(0.5);
    doc.line(margin, legalY - 3, pageWidth - margin, legalY - 3);

    doc.setFontSize(7);
    doc.setFont(font, 'bold');
    doc.setTextColor(...ACCENT);
    doc.text(companyName, pageWidth / 2, legalY, { align: 'center' });

    // Address + contact line
    const legalParts: string[] = [];
    if (settings?.address) legalParts.push(settings.address);
    if (settings?.phone) legalParts.push(`Tel: ${settings.phone}`);
    if (settings?.email) legalParts.push(settings.email);
    if (settings?.website && fields.showCompanyWebsite) legalParts.push(settings.website);

    if (legalParts.length > 0) {
      doc.setFont(font, 'normal');
      doc.setTextColor(...GRAY);
      doc.setFontSize(6.5);
      doc.text(legalParts.join('  -  '), pageWidth / 2, legalY + 3.5, { align: 'center', maxWidth: contentWidth });
    }

    // ICE line
    if (fields.showCompanyICE && settings?.ice) {
      doc.setFontSize(6.5);
      doc.text(`ICE : ${settings.ice}`, pageWidth / 2, legalY + 7, { align: 'center' });
    }

    // === DOWNLOAD ===
    const filename = `Devis_${quote.quoteNumber}_${this.formatDate(quote.createdAt).replace(/\//g, '-')}.pdf`;
    doc.save(filename);
  }
}
