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

function darkenColor(rgb: [number, number, number], factor: number): [number, number, number] {
  return [
    Math.max(0, Math.round(rgb[0] * (1 - factor))),
    Math.max(0, Math.round(rgb[1] * (1 - factor))),
    Math.max(0, Math.round(rgb[2] * (1 - factor))),
  ];
}

async function loadImageAsBase64(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

const DARK: [number, number, number] = [30, 30, 30];
const GRAY: [number, number, number] = [100, 100, 100];
const LIGHT_GRAY: [number, number, number] = [200, 200, 200];
const WHITE: [number, number, number] = [255, 255, 255];

export class PdfExportService {
  static formatDate(date: Date): string {
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    return `${d}/${m}/${y}`;
  }

  static formatCurrency(amount: number): string {
    // Use regular spaces (not narrow non-breaking spaces) for PDF compatibility
    const parts = amount.toFixed(2).split('.');
    const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `${intPart},${parts[1]}`;
  }

  static async exportQuoteToPdf(quote: Quote, settings?: CompanySettings | null): Promise<void> {
    const style: QuoteStyle = settings?.quote_style || {
      accentColor: '#3B82F6', fontFamily: 'helvetica', showBorders: true,
      borderRadius: 1, headerSize: 'large', totalsStyle: 'highlighted',
    };
    const ACCENT = hexToRgb(style.accentColor);
    const ACCENT_LIGHT = lightenColor(ACCENT, 0.92);
    const ACCENT_DARK = darkenColor(ACCENT, 0.15);
    const font = style.fontFamily || 'helvetica';

    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    const fields = settings?.quote_visible_fields || {
      showLogo: true, showCompanyAddress: true, showCompanyPhone: true,
      showCompanyEmail: true, showCompanyWebsite: false, showCompanyICE: true,
      showClientICE: true, showTVA: true, showNotes: true,
      showPaymentTerms: true, showValidityDate: true,
    };

    const tvaRate = settings?.tva_rate ?? 20;
    const companyName = settings?.company_name || 'Mon Entreprise';

    // === TOP ACCENT BAR ===
    doc.setFillColor(...ACCENT);
    doc.rect(0, 0, pageWidth, 3, 'F');

    y = 10;

    // === HEADER: Logo + Company Name (left) | DEVIS (right) ===
    let logoLoaded = false;
    let logoHeight = 0;

    if (fields.showLogo && settings?.logo_url) {
      const logoBase64 = await loadImageAsBase64(settings.logo_url);
      if (logoBase64) {
        try {
          const img = new Image();
          img.src = logoBase64;
          await new Promise<void>((resolve) => {
            img.onload = () => resolve();
            img.onerror = () => resolve();
          });
          
          // Calculate dimensions maintaining aspect ratio
          const maxLogoW = 45;
          const maxLogoH = 22;
          let logoW = maxLogoW;
          let logoH = (img.height / img.width) * logoW;
          if (logoH > maxLogoH) {
            logoH = maxLogoH;
            logoW = (img.width / img.height) * logoH;
          }

          doc.addImage(logoBase64, 'AUTO', margin, y, logoW, logoH);
          logoHeight = logoH;
          logoLoaded = true;
        } catch {
          logoLoaded = false;
        }
      }
    }

    // Company name + subtitle
    const nameX = logoLoaded ? margin + 48 : margin;
    const nameY = y + 4;
    
    doc.setFontSize(style.headerSize === 'small' ? 16 : style.headerSize === 'medium' ? 20 : 24);
    doc.setFont(font, 'bold');
    doc.setTextColor(...ACCENT);
    doc.text(companyName, nameX, nameY + 5);

    doc.setFontSize(7.5);
    doc.setFont(font, 'normal');
    doc.setTextColor(...GRAY);
    doc.text('MATERIEL DE CUISINE PROFESSIONNEL', nameX, nameY + 10);

    // DEVIS title (right side) with accent background
    const devisBoxW = 55;
    const devisBoxH = 14;
    const devisBoxX = pageWidth - margin - devisBoxW;
    const devisBoxY = y;

    doc.setFillColor(...ACCENT);
    doc.roundedRect(devisBoxX, devisBoxY, devisBoxW, devisBoxH, 2, 2, 'F');
    doc.setFontSize(28);
    doc.setFont(font, 'bold');
    doc.setTextColor(...WHITE);
    doc.text('DEVIS', devisBoxX + devisBoxW / 2, devisBoxY + devisBoxH / 2 + 4, { align: 'center' });

    y = Math.max(y + logoHeight, y + 18) + 8;

    // === THIN SEPARATOR LINE ===
    doc.setDrawColor(...ACCENT);
    doc.setLineWidth(0.6);
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;

    // === TWO COLUMN LAYOUT: Client info (left) + Quote meta (right) ===
    const leftColWidth = contentWidth * 0.55;
    const rightColWidth = contentWidth * 0.38;
    const rightColX = pageWidth - margin - rightColWidth;
    const sectionStartY = y;

    // --- LEFT: Client Information ---
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
        cellPadding: { top: 2.8, bottom: 2.8, left: 4, right: 4 },
        lineColor: [230, 230, 230],
        lineWidth: 0.3,
        textColor: DARK,
      },
      columnStyles: {
        0: {
          cellWidth: 32,
          fillColor: ACCENT,
          textColor: WHITE,
          fontStyle: 'bold',
          fontSize: 7.5,
        },
        1: {
          cellWidth: leftColWidth - 32,
          fontSize: 8.5,
          fillColor: [252, 252, 252],
        },
      },
      tableLineColor: [230, 230, 230],
      tableLineWidth: 0.3,
    });

    // --- RIGHT: Quote details ---
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
      startY: sectionStartY,
      body: quoteInfoRows,
      margin: { left: rightColX, right: margin },
      theme: 'plain',
      styles: {
        fontSize: 8.5,
        cellPadding: { top: 2.8, bottom: 2.8, left: 4, right: 4 },
        lineColor: [230, 230, 230],
        lineWidth: 0.3,
        textColor: DARK,
      },
      columnStyles: {
        0: { cellWidth: 28, fontStyle: 'bold', textColor: ACCENT, fontSize: 7.5, fillColor: ACCENT_LIGHT },
        1: { cellWidth: rightColWidth - 28, halign: 'right', fillColor: [252, 252, 252] },
      },
      tableLineColor: [230, 230, 230],
      tableLineWidth: 0.3,
    });

    // Get final Y after both sections
    const leftFinalY = (doc as any).lastAutoTable?.finalY || sectionStartY + 30;
    y = Math.max(leftFinalY, (doc as any).lastAutoTable?.finalY || sectionStartY + 30) + 5;

    // === COMPANY DETAILS LINE ===
    const companyDetails: string[] = [];
    if (fields.showCompanyAddress && settings?.address) companyDetails.push(settings.address);
    if (fields.showCompanyPhone && settings?.phone) companyDetails.push(`Tel: ${settings.phone}`);
    if (fields.showCompanyEmail && settings?.email) companyDetails.push(settings.email);

    if (companyDetails.length > 0) {
      // Small accent dot separator
      doc.setFontSize(7);
      doc.setFont(font, 'normal');
      doc.setTextColor(...GRAY);
      doc.text(companyDetails.join('  |  '), margin, y);
      y += 6;
    }

    // === ITEMS TABLE ===
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
        cellPadding: { top: 3, bottom: 3, left: 3, right: 3 },
        lineColor: [230, 230, 230],
        lineWidth: 0.2,
        textColor: DARK,
        overflow: 'linebreak',
      },
      headStyles: {
        fillColor: ACCENT,
        textColor: WHITE,
        fontStyle: 'bold',
        fontSize: 8,
        halign: 'center',
        cellPadding: { top: 3.5, bottom: 3.5, left: 3, right: 3 },
      },
      alternateRowStyles: {
        fillColor: [248, 249, 252],
      },
      columnStyles: {
        0: { cellWidth: 22, halign: 'center' },
        1: { cellWidth: 28, halign: 'center' },
        2: { cellWidth: 'auto' },
        3: { cellWidth: 14, halign: 'center' },
        4: { cellWidth: 26, halign: 'right' },
        5: { cellWidth: 28, halign: 'right', fontStyle: 'bold' },
      },
      didDrawPage: (data) => {
        // Redraw top accent bar on each page
        doc.setFillColor(...ACCENT);
        doc.rect(0, 0, pageWidth, 3, 'F');
      },
    });

    y = (doc as any).lastAutoTable.finalY + 6;

    // === TOTALS SECTION ===
    const totalTTC = quote.totalAmount;
    const totalHT = totalTTC / (1 + tvaRate / 100);
    const totalTVA = totalTTC - totalHT;

    const totalsWidth = 85;
    const totalsX = pageWidth - margin - totalsWidth;

    // Draw totals with clean styling
    if (fields.showTVA) {
      // TOTAL HT row
      doc.setFillColor(248, 249, 252);
      doc.rect(totalsX, y, totalsWidth, 8, 'F');
      doc.setDrawColor(230, 230, 230);
      doc.rect(totalsX, y, totalsWidth, 8, 'S');
      
      doc.setFontSize(9);
      doc.setFont(font, 'bold');
      doc.setTextColor(...DARK);
      doc.text('TOTAL HT', totalsX + 4, y + 5.5);
      doc.text(this.formatCurrency(totalHT), totalsX + totalsWidth - 4, y + 5.5, { align: 'right' });
      y += 8;

      // TVA row
      doc.setFillColor(248, 249, 252);
      doc.rect(totalsX, y, totalsWidth, 8, 'F');
      doc.setDrawColor(230, 230, 230);
      doc.rect(totalsX, y, totalsWidth, 8, 'S');
      
      doc.setFont(font, 'bold');
      doc.setTextColor(...DARK);
      doc.text(`TVA ${tvaRate}%`, totalsX + 4, y + 5.5);
      doc.text(this.formatCurrency(totalTVA), totalsX + totalsWidth - 4, y + 5.5, { align: 'right' });
      y += 8;
    }

    // TOTAL TTC row (highlighted)
    if (style.totalsStyle === 'highlighted') {
      doc.setFillColor(...ACCENT);
      doc.rect(totalsX, y, totalsWidth, 10, 'F');
      doc.setFontSize(11);
      doc.setFont(font, 'bold');
      doc.setTextColor(...WHITE);
    } else if (style.totalsStyle === 'boxed') {
      doc.setDrawColor(...ACCENT);
      doc.setLineWidth(0.8);
      doc.rect(totalsX, y, totalsWidth, 10, 'S');
      doc.setFontSize(11);
      doc.setFont(font, 'bold');
      doc.setTextColor(...ACCENT);
    } else {
      doc.setFontSize(11);
      doc.setFont(font, 'bold');
      doc.setTextColor(...ACCENT);
    }

    doc.text('TOTAL TTC', totalsX + 4, y + 7);
    doc.text(this.formatCurrency(totalTTC), totalsX + totalsWidth - 4, y + 7, { align: 'right' });
    y += 14;

    // === PAYMENT TERMS ===
    if (fields.showPaymentTerms) {
      doc.setFontSize(8);
      doc.setFont(font, 'italic');
      doc.setTextColor(...GRAY);
      doc.text(
        `Conditions de reglement : ${settings?.payment_terms || '30 jours'}`,
        margin,
        y
      );
      y += 6;
    }

    // === NOTES ===
    if (fields.showNotes && quote.notes) {
      doc.setDrawColor(230, 230, 230);
      doc.line(margin, y, margin + 60, y);
      y += 4;
      doc.setTextColor(...DARK);
      doc.setFont(font, 'bold');
      doc.setFontSize(8);
      doc.text('Note :', margin, y);
      doc.setFont(font, 'normal');
      const noteLines = doc.splitTextToSize(quote.notes, contentWidth - 15);
      doc.text(noteLines, margin + 14, y);
      y += 4 + noteLines.length * 4;
    }

    // === FOOTER (pinned to bottom) ===
    const footerBaseY = pageHeight - 18;

    // Accent line
    doc.setDrawColor(...ACCENT);
    doc.setLineWidth(0.8);
    doc.line(margin, footerBaseY - 2, pageWidth - margin, footerBaseY - 2);

    // Company name bold
    doc.setFontSize(7.5);
    doc.setFont(font, 'bold');
    doc.setTextColor(...ACCENT);
    doc.text(companyName, pageWidth / 2, footerBaseY + 2, { align: 'center' });

    // Contact details
    const legalParts: string[] = [];
    if (settings?.address) legalParts.push(settings.address);
    if (settings?.phone) legalParts.push(`Tel: ${settings.phone}`);
    if (settings?.email) legalParts.push(settings.email);
    if (settings?.website && fields.showCompanyWebsite) legalParts.push(settings.website);

    if (legalParts.length > 0) {
      doc.setFont(font, 'normal');
      doc.setTextColor(...GRAY);
      doc.setFontSize(6.5);
      doc.text(legalParts.join('  -  '), pageWidth / 2, footerBaseY + 6, { align: 'center', maxWidth: contentWidth });
    }

    // ICE
    if (fields.showCompanyICE && settings?.ice) {
      doc.setFontSize(6.5);
      doc.text(`ICE : ${settings.ice}`, pageWidth / 2, footerBaseY + 10, { align: 'center' });
    }

    // Bottom accent bar
    doc.setFillColor(...ACCENT);
    doc.rect(0, pageHeight - 3, pageWidth, 3, 'F');

    // === SAVE ===
    const filename = `Devis_${quote.quoteNumber}_${this.formatDate(quote.createdAt).replace(/\//g, '-')}.pdf`;
    doc.save(filename);
  }
}
