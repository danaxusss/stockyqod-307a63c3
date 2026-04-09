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

const DARK = [30, 30, 30];
const GRAY = [120, 120, 120];
const LIGHT_BG = [245, 247, 250];

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
    const font = style.fontFamily || 'helvetica';
    const br = style.borderRadius ?? 1;

    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
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
    const titleSize = style.headerSize === 'large' ? 24 : style.headerSize === 'medium' ? 20 : 16;
    const companySize = style.headerSize === 'large' ? 18 : style.headerSize === 'medium' ? 15 : 12;

    // === HEADER ===
    // Company name (left)
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...DARK);
    doc.text(settings?.company_name || 'Mon Entreprise', margin, y + 7);

    // DEVIS title (right)
    doc.setFontSize(24);
    doc.setTextColor(...BLUE);
    doc.text('DEVIS', pageWidth - margin, y + 7, { align: 'right' });

    y += 14;

    // Company details (left)
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRAY);

    if (fields.showCompanyAddress && settings?.address) {
      doc.text(`Adresse : ${settings.address}`, margin, y);
      y += 4.5;
    }
    if (fields.showCompanyPhone && settings?.phone) {
      doc.text(`Téléphone : ${settings.phone}`, margin, y);
      y += 4.5;
    }
    if (fields.showCompanyEmail && settings?.email) {
      doc.text(`E-mail : ${settings.email}`, margin, y);
      y += 4.5;
    }
    if (fields.showCompanyWebsite && settings?.website) {
      doc.text(`Site internet : ${settings.website}`, margin, y);
      y += 4.5;
    }
    if (fields.showCompanyICE && settings?.ice) {
      doc.text(`ICE : ${settings.ice}`, margin, y);
      y += 4.5;
    }

    // Quote info (right side)
    const rightX = pageWidth - margin;
    let rightY = 22;
    doc.setFontSize(9);
    doc.setTextColor(...DARK);
    doc.text(`N° ${quote.quoteNumber}`, rightX, rightY, { align: 'right' });
    rightY += 4.5;
    doc.text(`Date : ${this.formatDate(quote.createdAt)}`, rightX, rightY, { align: 'right' });
    rightY += 4.5;
    if (fields.showValidityDate) {
      const validityDays = settings?.quote_validity_days ?? 30;
      const validityDate = new Date(quote.createdAt);
      validityDate.setDate(validityDate.getDate() + validityDays);
      doc.text(`Valable jusqu'au : ${this.formatDate(validityDate)}`, rightX, rightY, { align: 'right' });
    }

    y = Math.max(y, rightY) + 8;

    // === CLIENT BOX ===
    const clientBoxY = y;
    doc.setDrawColor(200, 210, 225);
    doc.setLineWidth(0.3);

    const clientLines: string[] = [];
    clientLines.push(`Client : ${quote.customer.fullName}`);
    if (quote.customer.address) clientLines.push(`Adresse : ${quote.customer.address}, ${quote.customer.city}`);
    if (quote.customer.phoneNumber) clientLines.push(`Tél : ${quote.customer.phoneNumber}`);
    if (fields.showClientICE && quote.customer.ice) clientLines.push(`ICE : ${quote.customer.ice}`);

    const boxH = 6 + clientLines.length * 5;
    doc.roundedRect(margin, clientBoxY, contentWidth / 2, boxH, 1, 1, 'S');

    doc.setFontSize(9);
    doc.setTextColor(...DARK);
    let clientY = clientBoxY + 5;
    clientLines.forEach((line, i) => {
      doc.setFont('helvetica', i === 0 ? 'bold' : 'normal');
      doc.text(line, margin + 4, clientY);
      clientY += 5;
    });

    y = clientBoxY + boxH + 8;

    // === ITEMS TABLE ===
    const showTVA = fields.showTVA;
    
    const tableHeaders = showTVA
      ? [['DESCRIPTION', 'QTÉ', 'PRIX U. HT', 'TVA %', 'TVA €', 'TOTAL HT']]
      : [['DESCRIPTION', 'QTÉ', 'PRIX UNITAIRE', 'TOTAL']];

    const tableBody = quote.items.map(item => {
      const unitHT = item.unitPrice / (1 + tvaRate / 100);
      const totalHT = unitHT * item.quantity;
      const tvaAmount = totalHT * (tvaRate / 100);

      if (showTVA) {
        return [
          `${item.product.name}\n${item.product.brand} • ${item.product.barcode}`,
          String(item.quantity),
          `${this.formatCurrency(unitHT)} Dh`,
          `${tvaRate}%`,
          `${this.formatCurrency(tvaAmount)} Dh`,
          `${this.formatCurrency(totalHT)} Dh`,
        ];
      } else {
        return [
          `${item.product.name}\n${item.product.brand} • ${item.product.barcode}`,
          String(item.quantity),
          `${this.formatCurrency(item.unitPrice)} Dh`,
          `${this.formatCurrency(item.subtotal)} Dh`,
        ];
      }
    });

    const colStyles = showTVA
      ? {
          0: { cellWidth: 'auto' },
          1: { cellWidth: 18, halign: 'center' },
          2: { cellWidth: 28, halign: 'right' },
          3: { cellWidth: 18, halign: 'center' },
          4: { cellWidth: 25, halign: 'right' },
          5: { cellWidth: 28, halign: 'right' },
        }
      : {
          0: { cellWidth: 'auto' },
          1: { cellWidth: 20, halign: 'center' },
          2: { cellWidth: 35, halign: 'right' },
          3: { cellWidth: 35, halign: 'right' },
        };

    autoTable(doc, {
      startY: y,
      head: tableHeaders,
      body: tableBody,
      margin: { left: margin, right: margin },
      styles: {
        fontSize: 8.5,
        cellPadding: 3,
        lineColor: [220, 225, 235],
        lineWidth: 0.2,
        textColor: DARK,
      },
      headStyles: {
        fillColor: BLUE,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8.5,
      },
      alternateRowStyles: {
        fillColor: LIGHT_BG,
      },
      columnStyles: colStyles,
    });

    y = (doc as any).lastAutoTable.finalY + 6;

    // === TOTALS ===
    const totalsX = pageWidth - margin - 80;
    const totalsWidth = 80;

    if (showTVA) {
      const totalTTC = quote.totalAmount;
      const totalHT = totalTTC / (1 + tvaRate / 100);
      const totalTVA = totalTTC - totalHT;

      // Total HT
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...DARK);
      doc.text('TOTAL HT', totalsX, y + 4);
      doc.text(`${this.formatCurrency(totalHT)} Dh`, pageWidth - margin, y + 4, { align: 'right' });
      y += 7;

      // Total TVA
      doc.setFont('helvetica', 'normal');
      doc.text('TOTAL TVA', totalsX, y + 4);
      doc.text(`${this.formatCurrency(totalTVA)} Dh`, pageWidth - margin, y + 4, { align: 'right' });
      y += 7;

      // Total TTC - highlighted
      doc.setFillColor(...BLUE);
      doc.roundedRect(totalsX - 2, y, totalsWidth + 2, 9, 1, 1, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text('TOTAL TTC', totalsX + 2, y + 6);
      doc.text(`${this.formatCurrency(quote.totalAmount)} Dh`, pageWidth - margin - 2, y + 6, { align: 'right' });
      y += 16;
    } else {
      doc.setFillColor(...BLUE);
      doc.roundedRect(totalsX - 2, y, totalsWidth + 2, 9, 1, 1, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text('TOTAL', totalsX + 2, y + 6);
      doc.text(`${this.formatCurrency(quote.totalAmount)} Dh`, pageWidth - margin - 2, y + 6, { align: 'right' });
      y += 16;
    }

    // === NOTES ===
    if (fields.showNotes && quote.notes) {
      doc.setTextColor(...DARK);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8.5);
      doc.text(`Note : ${quote.notes}`, margin, y);
      y += 10;
    }

    // === FOOTER: Payment terms & conditions ===
    if (fields.showPaymentTerms) {
      // Check if we need a new page
      if (y > 250) {
        doc.addPage();
        y = margin;
      }

      y = Math.max(y, 230);

      doc.setDrawColor(220, 225, 235);
      doc.line(margin, y, pageWidth - margin, y);
      y += 6;

      doc.setTextColor(...BLUE);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text('MODALITÉ ET CONDITIONS', margin, y);
      y += 6;

      doc.setTextColor(...DARK);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(`Conditions de règlement de la facture : ${settings?.payment_terms || '30 jours'}`, margin, y);
      y += 5;

      // Legal text
      y += 5;
      doc.setTextColor(...GRAY);
      doc.setFontSize(6.5);
      const legalText = `Conformément à l'article L. 441-6, une indemnité de 40 € est due en cas de retard de paiement ou de non paiement total d'une facture à la date de paiement définie dans le document.`;
      doc.text(legalText, pageWidth / 2, y, { align: 'center', maxWidth: contentWidth });

      if (settings?.company_name) {
        y += 5;
        doc.text(`${settings.company_name}${settings.ice ? ` - ICE : ${settings.ice}` : ''}`, pageWidth / 2, y, { align: 'center' });
      }
    }

    // === DOWNLOAD ===
    const filename = `Devis_${quote.quoteNumber}_${this.formatDate(quote.createdAt).replace(/\//g, '-')}.pdf`;
    doc.save(filename);
  }
}
