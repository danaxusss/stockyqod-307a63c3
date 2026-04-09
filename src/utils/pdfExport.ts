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
const WHITE: [number, number, number] = [255, 255, 255];

export class PdfExportService {
  static formatDate(date: Date): string {
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    return `${d}/${m}/${y}`;
  }

  static formatCurrency(amount: number): string {
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
    const margin = 12;
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

    const hasDiscount = quote.items.some(item => (item.discount ?? 0) > 0);

    // === Build footer legal lines ===
    const buildFooterLines = (): string[] => {
      const lines: string[] = [];
      // Line 1: Company name + address
      const line1Parts: string[] = [companyName];
      if (settings?.address) line1Parts.push(settings.address);
      lines.push(line1Parts.join(' - '));

      // Line 2: Legal identifiers
      const legalParts: string[] = [];
      if (settings?.rc) legalParts.push(`RC N° ${settings.rc}`);
      if (settings?.if_number) legalParts.push(`IF N° ${settings.if_number}`);
      if (settings?.cnss) legalParts.push(`CNSS N° ${settings.cnss}`);
      if (settings?.patente) legalParts.push(`PATENTE N° ${settings.patente}`);
      if (settings?.ice && fields.showCompanyICE) legalParts.push(`ICE N° ${settings.ice}`);
      if (legalParts.length > 0) lines.push(legalParts.join(' - '));

      // Line 3: Phones
      const phoneParts: string[] = [];
      if (settings?.phone) phoneParts.push(`Tél: ${settings.phone}`);
      if (settings?.phone2) phoneParts.push(settings.phone2);
      if (settings?.phone_dir) phoneParts.push(`DIR : ${settings.phone_dir}`);
      if (settings?.phone_gsm) phoneParts.push(`GSM: ${settings.phone_gsm}`);
      if (phoneParts.length > 0) lines.push(phoneParts.join(' / '));

      // Line 4: Email + website
      const contactParts: string[] = [];
      if (settings?.email) contactParts.push(`Email: ${settings.email}`);
      if (settings?.website && fields.showCompanyWebsite) contactParts.push(`Site web: ${settings.website}`);
      if (contactParts.length > 0) lines.push(contactParts.join(' - '));

      return lines;
    };

    const footerLines = buildFooterLines();

    // === Draw header and footer on every page ===
    const drawPageDecorations = () => {
      // Top accent bar
      doc.setFillColor(...ACCENT);
      doc.rect(0, 0, pageWidth, 2, 'F');
      // Bottom accent bar
      doc.setFillColor(...ACCENT);
      doc.rect(0, pageHeight - 2, pageWidth, 2, 'F');

      // Footer
      const footerLineHeight = 3;
      const footerTotalHeight = footerLines.length * footerLineHeight + 4;
      const footerBaseY = pageHeight - footerTotalHeight - 2;

      doc.setDrawColor(...ACCENT);
      doc.setLineWidth(0.5);
      doc.line(margin, footerBaseY, pageWidth - margin, footerBaseY);

      let fy = footerBaseY + 3;
      for (let i = 0; i < footerLines.length; i++) {
        if (i === 0) {
          doc.setFont(font, 'bold');
          doc.setTextColor(...ACCENT);
          doc.setFontSize(5.5);
        } else {
          doc.setFont(font, 'normal');
          doc.setTextColor(...GRAY);
          doc.setFontSize(5);
        }
        doc.text(footerLines[i], pageWidth / 2, fy, { align: 'center', maxWidth: contentWidth });
        fy += footerLineHeight;
      }
    };

    // Draw first page decorations
    drawPageDecorations();

    y = 7;

    // === HEADER: Logo OR Company Name (left) | DEVIS (right) ===
    let logoLoaded = false;
    let logoHeight = 0;

    // Logo size settings
    const logoSizeConfig = {
      small: { maxW: 35, maxH: 20 },
      medium: { maxW: 50, maxH: 28 },
      large: { maxW: 70, maxH: 38 },
    };
    const logoSize = settings?.logo_size || 'medium';
    const { maxW: maxLogoW, maxH: maxLogoH } = logoSizeConfig[logoSize] || logoSizeConfig.medium;

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

    // DEVIS title (right side)
    const devisBoxW = 45;
    const devisBoxH = 11;
    const devisBoxX = pageWidth - margin - devisBoxW;
    const devisBoxY = y;

    doc.setFillColor(...ACCENT);
    doc.roundedRect(devisBoxX, devisBoxY, devisBoxW, devisBoxH, 2, 2, 'F');
    doc.setFontSize(22);
    doc.setFont(font, 'bold');
    doc.setTextColor(...WHITE);
    doc.text('DEVIS', devisBoxX + devisBoxW / 2, devisBoxY + devisBoxH / 2 + 3, { align: 'center' });

    // If logo is loaded, skip company name & tagline. Otherwise show them.
    if (!logoLoaded) {
      const nameX = margin;
      const nameY = y + 4;
      const maxNameWidth = devisBoxX - nameX - 5;

      let nameFontSize = style.headerSize === 'small' ? 14 : style.headerSize === 'medium' ? 17 : 19;
      doc.setFont(font, 'bold');
      while (nameFontSize > 9) {
        doc.setFontSize(nameFontSize);
        if (doc.getTextWidth(companyName) <= maxNameWidth) break;
        nameFontSize -= 1;
      }
      doc.setFontSize(nameFontSize);
      doc.setTextColor(...ACCENT);
      doc.text(companyName, nameX, nameY + 4, { maxWidth: maxNameWidth });

      doc.setFontSize(6.5);
      doc.setFont(font, 'normal');
      doc.setTextColor(...GRAY);
      doc.text('MATERIEL DE CUISINE PROFESSIONNEL', nameX, nameY + 9);
    }

    y = Math.max(y + logoHeight, y + 14) + 5;

    // === THIN SEPARATOR LINE ===
    doc.setDrawColor(...ACCENT);
    doc.setLineWidth(0.4);
    doc.line(margin, y, pageWidth - margin, y);
    y += 4;

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
        fontSize: 7.5,
        cellPadding: { top: 2, bottom: 2, left: 3, right: 3 },
        lineColor: [230, 230, 230],
        lineWidth: 0.2,
        textColor: DARK,
      },
      columnStyles: {
        0: {
          cellWidth: 28,
          fillColor: ACCENT,
          textColor: WHITE,
          fontStyle: 'bold',
          fontSize: 6.5,
        },
        1: {
          cellWidth: leftColWidth - 28,
          fontSize: 7.5,
          fillColor: [252, 252, 252],
        },
      },
      tableLineColor: [230, 230, 230],
      tableLineWidth: 0.2,
    });

    const leftFinalY = (doc as any).lastAutoTable?.finalY || sectionStartY + 30;

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
      quoteInfoRows.push(['Validite', `${validityDays} jours (${this.formatDate(validityDate)})`]);
    }

    autoTable(doc, {
      startY: sectionStartY,
      body: quoteInfoRows,
      margin: { left: rightColX, right: margin },
      theme: 'plain',
      styles: {
        fontSize: 7.5,
        cellPadding: { top: 2, bottom: 2, left: 3, right: 3 },
        lineColor: [230, 230, 230],
        lineWidth: 0.2,
        textColor: DARK,
      },
      columnStyles: {
        0: { cellWidth: 24, fontStyle: 'bold', textColor: ACCENT, fontSize: 6.5, fillColor: ACCENT_LIGHT },
        1: { cellWidth: rightColWidth - 24, halign: 'right', fillColor: [252, 252, 252] },
      },
      tableLineColor: [230, 230, 230],
      tableLineWidth: 0.2,
    });

    const rightFinalY = (doc as any).lastAutoTable?.finalY || sectionStartY + 25;
    y = Math.max(leftFinalY, rightFinalY) + 5;

    // === ITEMS TABLE ===
    const tableHeaders = hasDiscount
      ? [['Marque', 'REF', 'DESCRIPTION', 'QTE', 'PU TTC', 'Remise', 'TOTAL TTC']]
      : [['Marque', 'REF', 'DESCRIPTION', 'QTE', 'PU TTC', 'TOTAL TTC']];

    const tableBody = quote.items.map(item => {
      const discount = item.discount ?? 0;
      const discountedPrice = item.unitPrice * (1 - discount / 100);
      const totalTTC = discountedPrice * item.quantity;
      const row = [
        item.product.brand || '',
        item.product.barcode || '',
        item.product.name,
        String(item.quantity),
        this.formatCurrency(item.unitPrice),
      ];
      if (hasDiscount) {
        row.push(discount > 0 ? `${discount}%` : '-');
      }
      row.push(this.formatCurrency(totalTTC));
      return row;
    });

    const itemColumnStyles: Record<number, any> = hasDiscount
      ? {
          0: { cellWidth: 18, halign: 'center' },
          1: { cellWidth: 24, halign: 'center' },
          2: { cellWidth: 'auto' },
          3: { cellWidth: 12, halign: 'center' },
          4: { cellWidth: 24, halign: 'right' },
          5: { cellWidth: 16, halign: 'center' },
          6: { cellWidth: 26, halign: 'right', fontStyle: 'bold' },
        }
      : {
          0: { cellWidth: 18, halign: 'center' },
          1: { cellWidth: 24, halign: 'center' },
          2: { cellWidth: 'auto' },
          3: { cellWidth: 12, halign: 'center' },
          4: { cellWidth: 24, halign: 'right' },
          5: { cellWidth: 26, halign: 'right', fontStyle: 'bold' },
        };

    // Calculate footer height to set bottom margin for items table
    const footerLineHeight = 3;
    const footerTotalHeight = footerLines.length * footerLineHeight + 8;

    autoTable(doc, {
      startY: y,
      head: tableHeaders,
      body: tableBody,
      margin: { left: margin, right: margin, bottom: footerTotalHeight + 4 },
      styles: {
        fontSize: 7,
        cellPadding: { top: 2, bottom: 2, left: 2.5, right: 2.5 },
        lineColor: [230, 230, 230],
        lineWidth: 0.2,
        textColor: DARK,
        overflow: 'linebreak',
      },
      headStyles: {
        fillColor: ACCENT,
        textColor: WHITE,
        fontStyle: 'bold',
        fontSize: 7,
        halign: 'center',
        cellPadding: { top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 },
      },
      alternateRowStyles: {
        fillColor: [248, 249, 252],
      },
      columnStyles: itemColumnStyles,
      didDrawPage: (data) => {
        drawPageDecorations();
        const pageCount = doc.getNumberOfPages();
        doc.setFontSize(6);
        doc.setFont(font, 'normal');
        doc.setTextColor(...GRAY);
        doc.text(`Page ${doc.getCurrentPageInfo().pageNumber} / ${pageCount}`, pageWidth - margin, pageHeight - footerTotalHeight - 4, { align: 'right' });
      },
    });

    y = (doc as any).lastAutoTable.finalY + 4;

    // Check if totals fit on current page
    const totalsHeight = (fields.showTVA ? 20 : 8) + 16;
    if (y + totalsHeight > pageHeight - footerTotalHeight - 8) {
      doc.addPage();
      drawPageDecorations();
      y = 12;
    }

    // === TOTALS SECTION ===
    const totalTTC = quote.totalAmount;
    const totalHT = totalTTC / (1 + tvaRate / 100);
    const totalTVA = totalTTC - totalHT;

    const totalsWidth = 75;
    const totalsX = pageWidth - margin - totalsWidth;

    if (fields.showTVA) {
      doc.setFillColor(248, 249, 252);
      doc.rect(totalsX, y, totalsWidth, 6.5, 'F');
      doc.setDrawColor(230, 230, 230);
      doc.rect(totalsX, y, totalsWidth, 6.5, 'S');
      
      doc.setFontSize(7.5);
      doc.setFont(font, 'bold');
      doc.setTextColor(...DARK);
      doc.text('TOTAL HT', totalsX + 3, y + 4.5);
      doc.text(this.formatCurrency(totalHT) + ' Dh', totalsX + totalsWidth - 3, y + 4.5, { align: 'right' });
      y += 6.5;

      doc.setFillColor(248, 249, 252);
      doc.rect(totalsX, y, totalsWidth, 6.5, 'F');
      doc.setDrawColor(230, 230, 230);
      doc.rect(totalsX, y, totalsWidth, 6.5, 'S');
      
      doc.setFont(font, 'bold');
      doc.setTextColor(...DARK);
      doc.text(`TVA ${tvaRate}%`, totalsX + 3, y + 4.5);
      doc.text(this.formatCurrency(totalTVA) + ' Dh', totalsX + totalsWidth - 3, y + 4.5, { align: 'right' });
      y += 6.5;
    }

    if (style.totalsStyle === 'highlighted') {
      doc.setFillColor(...ACCENT);
      doc.rect(totalsX, y, totalsWidth, 8, 'F');
      doc.setFontSize(9);
      doc.setFont(font, 'bold');
      doc.setTextColor(...WHITE);
    } else if (style.totalsStyle === 'boxed') {
      doc.setDrawColor(...ACCENT);
      doc.setLineWidth(0.6);
      doc.rect(totalsX, y, totalsWidth, 8, 'S');
      doc.setFontSize(9);
      doc.setFont(font, 'bold');
      doc.setTextColor(...ACCENT);
    } else {
      doc.setFontSize(9);
      doc.setFont(font, 'bold');
      doc.setTextColor(...ACCENT);
    }

    doc.text('TOTAL TTC', totalsX + 3, y + 5.5);
    doc.text(this.formatCurrency(totalTTC) + ' Dh', totalsX + totalsWidth - 3, y + 5.5, { align: 'right' });
    y += 10;

    // === PAYMENT TERMS ===
    if (fields.showPaymentTerms) {
      doc.setFontSize(7);
      doc.setFont(font, 'italic');
      doc.setTextColor(...GRAY);
      doc.text(
        `Conditions de reglement : ${settings?.payment_terms || '30 jours'}`,
        margin,
        y
      );
      y += 5;
    }

    // === NOTES ===
    if (fields.showNotes && quote.notes) {
      doc.setDrawColor(230, 230, 230);
      doc.line(margin, y, margin + 50, y);
      y += 3;
      doc.setTextColor(...DARK);
      doc.setFont(font, 'bold');
      doc.setFontSize(7);
      doc.text('Note :', margin, y);
      doc.setFont(font, 'normal');
      const noteLines = doc.splitTextToSize(quote.notes, contentWidth - 12);
      doc.text(noteLines, margin + 12, y);
      y += 3 + noteLines.length * 3.5;
    }

    // Fix page numbers
    const totalPagesCount = doc.getNumberOfPages();
    for (let i = 1; i <= totalPagesCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setFont(font, 'normal');
      doc.setTextColor(...GRAY);
      doc.setFillColor(255, 255, 255);
      doc.rect(pageWidth - margin - 30, pageHeight - footerTotalHeight - 8, 30, 6, 'F');
      doc.text(`Page ${i} / ${totalPagesCount}`, pageWidth - margin, pageHeight - footerTotalHeight - 5, { align: 'right' });
    }

    // === SAVE ===
    const filename = `Devis_${quote.quoteNumber}_${this.formatDate(quote.createdAt).replace(/\//g, '-')}.pdf`;
    doc.save(filename);
  }
}
