// @ts-nocheck
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Quote } from '../types';
import { CompanySettings, QuoteStyle } from './companySettings';
import { getQuoteItemBarcode, getQuoteItemBrand, getQuoteItemName } from './quoteItemDisplay';

async function generateQRDataUrl(text: string): Promise<string | null> {
  try {
    const qrcode = await import('qrcode');
    return await qrcode.toDataURL(text, { width: 80, margin: 1 });
  } catch {
    return null;
  }
}

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

function numberToWordsFr(amount: number): string {
  const UNITS = ['', 'UN', 'DEUX', 'TROIS', 'QUATRE', 'CINQ', 'SIX', 'SEPT', 'HUIT', 'NEUF',
    'DIX', 'ONZE', 'DOUZE', 'TREIZE', 'QUATORZE', 'QUINZE', 'SEIZE', 'DIX-SEPT', 'DIX-HUIT', 'DIX-NEUF'];
  const TENS = ['', 'DIX', 'VINGT', 'TRENTE', 'QUARANTE', 'CINQUANTE', 'SOIXANTE'];

  function below100(n: number): string {
    if (n === 0) return '';
    if (n < 20) return UNITS[n];
    const t = Math.floor(n / 10);
    const u = n % 10;
    if (t <= 6) {
      if (u === 0) return TENS[t];
      if (u === 1) return `${TENS[t]} ET UN`;
      return `${TENS[t]}-${UNITS[u]}`;
    }
    if (t === 7) {
      if (u === 0) return 'SOIXANTE-DIX';
      if (u === 1) return 'SOIXANTE ET ONZE';
      return `SOIXANTE-${UNITS[10 + u]}`;
    }
    if (t === 8) {
      if (u === 0) return 'QUATRE-VINGTS';
      return `QUATRE-VINGT-${UNITS[u]}`;
    }
    if (u === 0) return 'QUATRE-VINGT-DIX';
    return `QUATRE-VINGT-${UNITS[10 + u]}`;
  }

  function below1000(n: number): string {
    if (n === 0) return '';
    if (n < 100) return below100(n);
    const h = Math.floor(n / 100);
    const rest = n % 100;
    const restStr = below100(rest);
    if (h === 1) return rest === 0 ? 'CENT' : `CENT ${restStr}`;
    const hWord = UNITS[h];
    if (rest === 0) return `${hWord} CENTS`;
    return `${hWord} CENT ${restStr}`;
  }

  function convert(n: number): string {
    if (n === 0) return 'ZÉRO';
    const parts: string[] = [];
    const millions = Math.floor(n / 1_000_000);
    const thousands = Math.floor((n % 1_000_000) / 1000);
    const below = n % 1000;
    if (millions > 0) parts.push(millions === 1 ? 'UN MILLION' : `${below1000(millions)} MILLIONS`);
    if (thousands > 0) parts.push(thousands === 1 ? 'MILLE' : `${below1000(thousands)} MILLE`);
    if (below > 0) parts.push(below1000(below));
    return parts.join(' ');
  }

  const totalCents = Math.round(amount * 100);
  const dh = Math.floor(totalCents / 100);
  const ct = totalCents % 100;
  let result = `${convert(dh)} DIRHAM${dh > 1 ? 'S' : ''}`;
  if (ct > 0) result += ` ET ${convert(ct)} CENTIME${ct > 1 ? 'S' : ''}`;
  return result + ' TTC';
}

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

  static async exportQuoteToPdf(quote: Quote, settings?: CompanySettings | null, techSheetsUrl?: string, techSheetsExpiryLabel?: string, useStampOverride?: boolean, documentType: 'quote' | 'bl' | 'proforma' | 'invoice' | 'avoir' | 'bon_commande' = 'quote', blShowPrices?: boolean, returnBlob?: boolean): Promise<void | Blob> {
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
      showClientICE: true, showTVA: true, showTVABreakdown: true, showNotes: true,
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

      // Disclaimer line above footer separator
      const disclaimer = '* Les produits et prix de ce devis peuvent légèrement évoluer lors de la confirmation selon les disponibilités en stock et les variations de prix à l\'arrivage. Des produits similaires ou de qualité supérieure pourront être proposés en substitution.';
      doc.setFont(font, 'italic');
      doc.setFontSize(4.5);
      doc.setTextColor(160, 160, 160);
      doc.text(disclaimer, pageWidth / 2, footerBaseY - 3.5, { align: 'center', maxWidth: contentWidth });

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
        const footerMaxWidth = settings?.qr_code_url ? contentWidth - 18 : contentWidth;
        doc.text(footerLines[i], pageWidth / 2, fy, { align: 'center', maxWidth: footerMaxWidth });
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

    // Document type title (right side)
    const docTypeLabel = documentType === 'bl' ? 'BON DE LIVRAISON'
      : documentType === 'bon_commande' ? 'BON DE COMMANDE'
      : documentType === 'proforma' ? 'PROFORMA'
      : documentType === 'invoice' ? 'FACTURE'
      : documentType === 'avoir' ? 'AVOIR'
      : 'DEVIS';
    const devisBoxW = (documentType === 'bl' || documentType === 'bon_commande') ? 58 : 45;
    const devisBoxH = 11;
    const devisBoxX = pageWidth - margin - devisBoxW;
    const devisBoxY = y;

    doc.setFillColor(...ACCENT);
    doc.roundedRect(devisBoxX, devisBoxY, devisBoxW, devisBoxH, 2, 2, 'F');
    doc.setFontSize((documentType === 'bl' || documentType === 'bon_commande') ? 14 : 22);
    doc.setFont(font, 'bold');
    doc.setTextColor(...WHITE);
    doc.text(docTypeLabel, devisBoxX + devisBoxW / 2, devisBoxY + devisBoxH / 2 + (documentType === 'bl' ? 2 : 3), { align: 'center' });

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
      if (quote.customer.phoneNumber) {
        let phone = quote.customer.phoneNumber.trim();
        if (phone.startsWith('*')) phone = phone.substring(1).trim();
        if (phone.endsWith(',')) phone = phone.slice(0, -1).trim();
        addrParts.push(phone);
      }
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
        font: 'helvetica',
        charSpace: 0,
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
    const quoteDate = quote.quote_date ? new Date(quote.quote_date) : quote.createdAt;
    const quoteInfoRows: [string, string][] = [
      ['Date', this.formatDate(quoteDate)],
      ['N° de piece', quote.quoteNumber],
    ];
    if (quote.commandNumber) {
      quoteInfoRows.push(['N° de cmd', quote.commandNumber]);
    }
    if (fields.showValidityDate && documentType === 'quote') {
      const validityDays = settings?.quote_validity_days ?? 30;
      const validityDate = new Date(quote.createdAt);
      validityDate.setDate(validityDate.getDate() + validityDays);
      quoteInfoRows.push(['Validite', `${validityDays} jours (${this.formatDate(validityDate)})`]);
    }
    if (documentType === 'invoice') {
      if (quote.payment_date) {
        quoteInfoRows.push(['Date paiement', this.formatDate(new Date(quote.payment_date))]);
      }
      if (quote.payment_method) {
        quoteInfoRows.push(['Mode paiement', quote.payment_method]);
      }
      if (quote.payment_reference) {
        quoteInfoRows.push(['N° référence', quote.payment_reference]);
      }
      if (quote.payment_bank) {
        quoteInfoRows.push(['Banque', quote.payment_bank]);
      }
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
    const isBL = documentType === 'bl';
    const isBC = documentType === 'bon_commande';
    const tvaDivisor = 1 + tvaRate / 100;

    let tableHeaders: string[][];
    let tableBody: string[][];
    let itemColumnStyles: Record<number, any>;

    const showBLPrices = blShowPrices ?? settings?.bl_show_prices ?? true;
    if (isBC) {
      // Bon de Commande: items sorted by provider, with dispatch columns
      const sortedItems = [...quote.items].sort((a, b) => {
        const pa = (a.provider_name || a.product?.provider || '').toLowerCase();
        const pb = (b.provider_name || b.product?.provider || '').toLowerCase();
        return pa.localeCompare(pb);
      });
      tableHeaders = [['Marque', 'REF', 'DESCRIPTION', 'QTE', 'Collecte']];
      tableBody = sortedItems.flatMap(item => {
        if (item.dispatch && item.dispatch.length > 0) {
          return item.dispatch
            .filter(d => d.quantity > 0)
            .map(d => [
              getQuoteItemBrand(item) || '',
              getQuoteItemBarcode(item) || '',
              getQuoteItemName(item),
              String(d.quantity),
              d.stock_location_abbrev || d.stock_location_name || '',
            ]);
        }
        return [[
          getQuoteItemBrand(item) || '',
          getQuoteItemBarcode(item) || '',
          getQuoteItemName(item),
          String(item.quantity),
          '',
        ]];
      });
      itemColumnStyles = {
        0: { cellWidth: 20, halign: 'center' },
        1: { cellWidth: 26, halign: 'center' },
        2: { cellWidth: 'auto' },
        3: { cellWidth: 14, halign: 'center', fontStyle: 'bold' },
        4: { cellWidth: 22, halign: 'center', fontStyle: 'bold' },
      };
    } else if (isBL && !showBLPrices) {
      // BL: no price columns
      tableHeaders = [['Marque', 'REF', 'DESCRIPTION', 'QUANTITÉ']];
      tableBody = quote.items.map(item => [
        getQuoteItemBrand(item) || '',
        getQuoteItemBarcode(item) || '',
        getQuoteItemName(item),
        String(item.quantity),
      ]);
      itemColumnStyles = {
        0: { cellWidth: 22, halign: 'center' },
        1: { cellWidth: 28, halign: 'center' },
        2: { cellWidth: 'auto' },
        3: { cellWidth: 18, halign: 'center', fontStyle: 'bold' },
      };
    } else if (isBL && showBLPrices) {
      // BL with prices
      tableHeaders = [['Marque', 'REF', 'DESCRIPTION', 'QTE', 'PU HT', 'TOTAL HT']];
      tableBody = quote.items.map(item => {
        const unitPriceHT = item.unitPrice / (1 + tvaRate / 100);
        const totalHTItem = unitPriceHT * item.quantity;
        return [
          getQuoteItemBrand(item) || '',
          getQuoteItemBarcode(item) || '',
          getQuoteItemName(item),
          String(item.quantity),
          this.formatCurrency(unitPriceHT),
          this.formatCurrency(totalHTItem),
        ];
      });
      itemColumnStyles = {
        0: { cellWidth: 18, halign: 'center' },
        1: { cellWidth: 24, halign: 'center' },
        2: { cellWidth: 'auto' },
        3: { cellWidth: 12, halign: 'center' },
        4: { cellWidth: 24, halign: 'right' },
        5: { cellWidth: 26, halign: 'right', fontStyle: 'bold' },
      };
    } else {
      tableHeaders = hasDiscount
        ? [['Marque', 'REF', 'DESCRIPTION', 'QTE', 'PU HT', 'Remise', 'TOTAL HT']]
        : [['Marque', 'REF', 'DESCRIPTION', 'QTE', 'PU HT', 'TOTAL HT']];

      tableBody = quote.items.map(item => {
        const discount = item.discount ?? 0;
        const unitPriceHT = item.unitPrice / tvaDivisor;
        const discountedPriceHT = unitPriceHT * (1 - discount / 100);
        const totalHTItem = discountedPriceHT * item.quantity;
        const row = [
          getQuoteItemBrand(item) || '',
          getQuoteItemBarcode(item) || '',
          getQuoteItemName(item),
          String(item.quantity),
          this.formatCurrency(unitPriceHT),
        ];
        if (hasDiscount) row.push(discount > 0 ? `${discount}%` : '-');
        row.push(this.formatCurrency(totalHTItem));
        return row;
      });

      itemColumnStyles = hasDiscount
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
    }

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

    // BL with prices: show a simple HT total block
    if (isBL && showBLPrices) {
      const blTotalHT = quote.items.reduce((s, i) => s + (i.unitPrice / (1 + tvaRate / 100)) * i.quantity, 0);
      const totalsWidth = 75;
      const totalsX = pageWidth - margin - totalsWidth;
      doc.setFillColor(...ACCENT);
      doc.rect(totalsX, y, totalsWidth, 8, 'F');
      doc.setFontSize(9);
      doc.setFont(font, 'bold');
      doc.setTextColor(...WHITE);
      doc.text('TOTAL HT', totalsX + 3, y + 5.5);
      doc.text(this.formatCurrency(blTotalHT) + ' Dh', totalsX + totalsWidth - 3, y + 5.5, { align: 'right' });
      y += 10;
    }

    // Non-BL, non-BC: full totals section
    if (!isBL && !isBC) {

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

    // Remise calculation
    const totalHTBrut = quote.items.reduce((s, i) => {
      const unitHT = i.unitPrice / (1 + tvaRate / 100);
      return s + unitHT * i.quantity;
    }, 0);
    const totalRemise = totalHTBrut - totalHT;
    const hasRemise = totalRemise > 0.005;

    const totalsWidth = 75;
    const totalsX = pageWidth - margin - totalsWidth;

    const drawTotalsRow = (label: string, value: string, highlight = false) => {
      if (highlight) {
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
        doc.text(label, totalsX + 3, y + 5.5);
        doc.text(value, totalsX + totalsWidth - 3, y + 5.5, { align: 'right' });
        y += 10;
      } else {
        doc.setFillColor(248, 249, 252);
        doc.rect(totalsX, y, totalsWidth, 6.5, 'F');
        doc.setDrawColor(230, 230, 230);
        doc.rect(totalsX, y, totalsWidth, 6.5, 'S');
        doc.setFontSize(7.5);
        doc.setFont(font, 'bold');
        doc.setTextColor(...DARK);
        doc.text(label, totalsX + 3, y + 4.5);
        doc.text(value, totalsX + totalsWidth - 3, y + 4.5, { align: 'right' });
        y += 6.5;
      }
    };

    if (fields.showTVA) {
      const showBreakdown = fields.showTVABreakdown !== false;
      if (showBreakdown) {
        if (hasRemise) {
          drawTotalsRow('TOTAL HT BRUT', this.formatCurrency(totalHTBrut) + ' Dh');
          drawTotalsRow(`REMISE (-${((totalRemise / totalHTBrut) * 100).toFixed(1)}%)`, '-' + this.formatCurrency(totalRemise) + ' Dh');
          drawTotalsRow('HT NET', this.formatCurrency(totalHT) + ' Dh');
        } else {
          drawTotalsRow('TOTAL HT', this.formatCurrency(totalHT) + ' Dh');
        }
        drawTotalsRow(`TVA ${tvaRate}%`, this.formatCurrency(totalTVA) + ' Dh');
      }
    }

    drawTotalsRow('TOTAL TTC', this.formatCurrency(totalTTC) + ' Dh', true);

    // === PAYMENT SUMMARY block (invoice) ===
    if (documentType === 'invoice') {
      const avance = quote.avance_amount ?? 0;
      const paymentsTotal = (quote.payment_methods_json || []).reduce((s: number, e: any) => s + (e.amount || 0), 0);
      const totalPaid = avance + paymentsTotal;
      const reste = Math.max(0, totalTTC - totalPaid);
      if (avance > 0) {
        drawTotalsRow('AVANCE REÇUE', '-' + this.formatCurrency(avance) + ' Dh');
      }
      if (paymentsTotal > 0) {
        drawTotalsRow('PAIEMENTS REÇUS', '-' + this.formatCurrency(paymentsTotal) + ' Dh');
      }
      if (totalPaid > 0) {
        if (reste <= 0) {
          drawTotalsRow('FACTURE SOLDÉE ✓', this.formatCurrency(totalTTC) + ' Dh', true);
        } else {
          drawTotalsRow('TOTAL PAYÉ', this.formatCurrency(totalPaid) + ' Dh');
          drawTotalsRow('RESTE À PAYER', this.formatCurrency(reste) + ' Dh', true);
        }
      }
    }

    } // end !isBL

    // === INVOICE: "Arrêté" block with amount in letters ===
    if (documentType === 'invoice') {
      const amountInLetters = numberToWordsFr(quote.totalAmount);
      const blockPadX = 4;
      const blockPadY = 3.5;
      const labelText = 'Arrêté la présente facture à la somme de :';

      // Measure required height
      doc.setFontSize(7);
      const lettersLines = doc.splitTextToSize(amountInLetters, contentWidth - blockPadX * 2 - 2);
      const blockH = blockPadY * 2 + 5 + lettersLines.length * 4.5;

      if (y + blockH > pageHeight - footerTotalHeight - 8) {
        doc.addPage();
        drawPageDecorations();
        y = 12;
      }

      // Background box
      doc.setFillColor(...ACCENT_LIGHT);
      doc.setDrawColor(...ACCENT);
      doc.setLineWidth(0.4);
      doc.roundedRect(margin, y, contentWidth, blockH, 1.5, 1.5, 'FD');

      // Label line
      doc.setFont(font, 'italic');
      doc.setFontSize(7);
      doc.setTextColor(...GRAY);
      doc.text(labelText, margin + blockPadX, y + blockPadY + 3.5);

      // Amount in letters
      doc.setFont(font, 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...DARK);
      doc.text(lettersLines, margin + blockPadX, y + blockPadY + 3.5 + 5, { maxWidth: contentWidth - blockPadX * 2 - 2 });

      y += blockH + 4;
    }

    // === PAYMENT TERMS ===
    if (!isBL && !isBC && fields.showPaymentTerms) {
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

    // === TECH SHEETS LINK ===
    if (techSheetsUrl) {
      y += 5;
      const ctaLabel = 'Consulter les fiches techniques';
      const ctaPaddingX = 5;
      const ctaBoxHeight = 8;
      const iconSize = 4;
      
      doc.setFontSize(9);
      doc.setFont(font, 'bold');
      const ctaTextWidth = doc.getTextWidth(ctaLabel);
      const ctaBoxWidth = ctaTextWidth + ctaPaddingX * 2 + iconSize + 3;
      const ctaY = y;

      // Draw rounded button background
      doc.setFillColor(200, 30, 30);
      doc.roundedRect(margin, ctaY, ctaBoxWidth, ctaBoxHeight, 1.5, 1.5, 'F');

      // Draw document icon (simple rectangle with fold)
      const iconX = margin + ctaPaddingX;
      const iconY = ctaY + (ctaBoxHeight - iconSize) / 2;
      doc.setFillColor(255, 255, 255);
      doc.rect(iconX, iconY, 3, iconSize, 'F');
      doc.setFillColor(200, 30, 30);
      doc.triangle(iconX + 1.5, iconY, iconX + 3, iconY, iconX + 3, iconY + 1.5, 'F');

      // Draw white text as clickable link
      doc.setTextColor(255, 255, 255);
      const textY = ctaY + ctaBoxHeight / 2 + 1.2;
      doc.textWithLink(ctaLabel, iconX + iconSize + 2, textY, { url: techSheetsUrl });

      // Make the whole button area clickable
      doc.link(margin, ctaY, ctaBoxWidth, ctaBoxHeight, { url: techSheetsUrl });

      // Subtitle with expiry + digital notice
      y = ctaY + ctaBoxHeight + 2;
      doc.setFontSize(6);
      doc.setFont(font, 'italic');
      doc.setTextColor(130, 130, 130);
      let subtitle = 'Lien cliquable sur la version numerique du devis';
      if (techSheetsExpiryLabel) {
        subtitle += ` - valable ${techSheetsExpiryLabel === 'permanent' ? 'en permanence' : techSheetsExpiryLabel}`;
      }
      doc.text(subtitle, margin, y);
      y += 4;
    }

    // === QR CODE in footer ===
    if (settings?.qr_code_url) {
      const qrDataUrl = await generateQRDataUrl(settings.qr_code_url);
      if (qrDataUrl) {
        const qrSize = 14;
        const qrX = pageWidth - margin - qrSize;
        // Place QR below the footer separator (footerBaseY = pageHeight - (footerLines.length * 3 + 4) - 2)
        const qrY = pageHeight - (footerLines.length * 3 + 4);
        const totalPages2 = doc.getNumberOfPages();
        for (let pi = 1; pi <= totalPages2; pi++) {
          doc.setPage(pi);
          doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);
        }
      }
    }

    // === STAMP ===
    const shouldShowStamp = useStampOverride !== undefined ? useStampOverride : (settings?.use_stamp ?? false);
    if (shouldShowStamp && settings?.stamp_url) {
      const stampBase64 = await loadImageAsBase64(settings.stamp_url);
      if (stampBase64) {
        try {
          const stampSizeConfig = {
            small: { maxW: 25, maxH: 25 },
            medium: { maxW: 35, maxH: 35 },
            large: { maxW: 50, maxH: 50 },
          };
          const stampSize = settings.stamp_size || 'medium';
          const { maxW: maxStampW, maxH: maxStampH } = stampSizeConfig[stampSize] || stampSizeConfig.medium;
          const stampImg = new Image();
          stampImg.src = stampBase64;
          await new Promise<void>((resolve) => {
            stampImg.onload = () => resolve();
            stampImg.onerror = () => resolve();
          });
          let stampW = maxStampW;
          let stampH = (stampImg.height / stampImg.width) * stampW;
          if (stampH > maxStampH) {
            stampH = maxStampH;
            stampW = (stampImg.width / stampImg.height) * stampH;
          }
          const stampX = pageWidth - margin - stampW;
          const stampY = pageHeight - footerTotalHeight - stampH - 4;
          doc.addImage(stampBase64, 'PNG', stampX, stampY, stampW, stampH);
        } catch { /* ignore stamp rendering errors */ }
      }
    }

    // Fix page numbers
    const totalPagesCount = doc.getNumberOfPages();
    for (let i = 1; i <= totalPagesCount; i++) {
      doc.setPage(i);
      doc.setFontSize(6);
      doc.setFont(font, 'normal');
      doc.setTextColor(...GRAY);
      doc.setFillColor(255, 255, 255);
      doc.rect(pageWidth - margin - 25, pageHeight - footerTotalHeight - 6, 25, 5, 'F');
      doc.text(`Page ${i} / ${totalPagesCount}`, pageWidth - margin, pageHeight - footerTotalHeight - 4, { align: 'right' });
    }

    // === SAVE ===
    const docPrefix = documentType === 'bl' ? 'BL'
      : documentType === 'proforma' ? 'Proforma'
      : documentType === 'invoice' ? 'Facture'
      : 'Devis';
    const filename = `${docPrefix}_${quote.quoteNumber}_${this.formatDate(quote.createdAt).replace(/\//g, '-')}.pdf`;
    if (returnBlob) return doc.output('blob') as unknown as Blob;
    doc.save(filename);
  }

  static async generatePdfBlob(
    quote: Quote,
    settings?: CompanySettings | null,
    techSheetsUrl?: string,
    techSheetsExpiryLabel?: string,
    useStampOverride?: boolean,
    documentType: 'quote' | 'bl' | 'proforma' | 'invoice' | 'avoir' | 'bon_commande' = 'quote',
    blShowPrices?: boolean,
  ): Promise<{ blob: Blob; filename: string }> {
    const docPrefix = documentType === 'bl' ? 'BL'
      : documentType === 'bon_commande' ? 'BC'
      : documentType === 'proforma' ? 'Proforma'
      : documentType === 'invoice' ? 'Facture'
      : documentType === 'avoir' ? 'Avoir'
      : 'Devis';
    const filename = `${docPrefix}_${quote.quoteNumber}.pdf`;
    const blob = await this.exportQuoteToPdf(quote, settings, techSheetsUrl, techSheetsExpiryLabel, useStampOverride, documentType, blShowPrices, true) as unknown as Blob;
    return { blob, filename };
  }

  static async exportClientFinancialPdf(
    clientName: string,
    invoices: Quote[],
    tvaRate = 20,
    settings?: CompanySettings | null,
  ): Promise<void> {
    const style: QuoteStyle = settings?.quote_style || { accentColor: '#3B82F6', fontFamily: 'helvetica' };
    const ACCENT = hexToRgb(style.accentColor);
    const font = style.fontFamily || 'helvetica';
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 12;
    let y = margin;

    // Header
    doc.setFillColor(...ACCENT);
    doc.rect(0, 0, pageWidth, 18, 'F');
    doc.setFont(font, 'bold');
    doc.setFontSize(13);
    doc.setTextColor(255, 255, 255);
    doc.text('SITUATION FINANCIÈRE CLIENT', margin, 12);
    doc.setFontSize(10);
    doc.text(clientName, pageWidth - margin, 12, { align: 'right' });
    y = 24;

    const tvaDivisor = 1 + tvaRate / 100;

    const getStatus = (inv: Quote): string => {
      const total = inv.totalAmount;
      const paid = inv.paid_amount || 0;
      if (paid >= total) return 'Payé';
      if (paid > 0) return 'Part. payé';
      return 'En attente';
    };

    const headers = [['N° Facture', 'Date', 'HT', 'TVA', 'TTC', 'Payé', 'Reste', 'Statut']];
    const body = invoices.map(inv => {
      const ttc = inv.totalAmount;
      const ht = ttc / tvaDivisor;
      const tva = ttc - ht;
      const paid = inv.paid_amount || 0;
      const reste = Math.max(0, ttc - paid);
      const dateStr = inv.quote_date
        ? inv.quote_date
        : inv.createdAt.toLocaleDateString('fr-FR');
      return [
        inv.quoteNumber || '-',
        dateStr,
        this.formatCurrency(ht),
        this.formatCurrency(tva),
        this.formatCurrency(ttc),
        this.formatCurrency(paid),
        this.formatCurrency(reste),
        getStatus(inv),
      ];
    });

    const totalTTC = invoices.reduce((s, i) => s + i.totalAmount, 0);
    const totalPaid = invoices.reduce((s, i) => s + (i.paid_amount || 0), 0);
    const totalReste = Math.max(0, totalTTC - totalPaid);
    const totalHT = totalTTC / tvaDivisor;
    const totalTVA = totalTTC - totalHT;

    body.push([
      'TOTAL', '',
      this.formatCurrency(totalHT),
      this.formatCurrency(totalTVA),
      this.formatCurrency(totalTTC),
      this.formatCurrency(totalPaid),
      this.formatCurrency(totalReste),
      '',
    ] as string[]);

    const accentFill = ACCENT;
    autoTable(doc, {
      startY: y,
      head: headers,
      body,
      styles: { font, fontSize: 8, cellPadding: 2.5 },
      headStyles: { fillColor: accentFill, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
      willDrawCell: (data: any) => {
        if (data.section === 'body' && data.row.index === body.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [240, 240, 240];
        }
      },
      columnStyles: {
        0: { cellWidth: 28 },
        1: { cellWidth: 20 },
        2: { cellWidth: 22, halign: 'right' },
        3: { cellWidth: 22, halign: 'right' },
        4: { cellWidth: 24, halign: 'right', fontStyle: 'bold' },
        5: { cellWidth: 22, halign: 'right' },
        6: { cellWidth: 22, halign: 'right' },
        7: { cellWidth: 20, halign: 'center' },
      },
      margin: { left: margin, right: margin },
    });

    const safeClientName = clientName.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 40);
    doc.save(`Situation_${safeClientName}.pdf`);
  }
}
