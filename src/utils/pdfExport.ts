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
    const cacheBustedUrl = `${url}${url.includes('?') ? '&' : '?'}_cb=${Date.now()}`;
    const response = await fetch(cacheBustedUrl, { cache: 'no-cache' });
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

  static async exportQuoteToPdf(quote: Quote, settings?: CompanySettings | null, techSheetsUrl?: string, techSheetsExpiryLabel?: string, useStampOverride?: boolean, documentType: 'quote' | 'bl' | 'proforma' | 'invoice' | 'avoir' | 'bon_commande' = 'quote', blShowPrices?: boolean, printTTCOnly = true, returnBlob?: boolean): Promise<void | Blob> {
    const style: QuoteStyle = settings?.quote_style || {
      accentColor: '#3B82F6', fontFamily: 'helvetica', showBorders: true,
      borderRadius: 1, headerSize: 'large', totalsStyle: 'highlighted', template: 'classic',
    };
    const ACCENT = hexToRgb(style.accentColor);
    const ACCENT_LIGHT = lightenColor(ACCENT, 0.92);
    const ACCENT_DARK = darkenColor(ACCENT, 0.15);
    const font = style.fontFamily || 'helvetica';
    const template = style.template || 'classic';

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
      showPaymentTerms: true, showValidityDate: true, printTTCOnly: false,
      printColumns: { showBrand: true, showBarcode: true, showUnitPrice: true, showDiscount: true },
    };

    const printCols = fields.printColumns || { showBrand: true, showBarcode: true, showUnitPrice: true, showDiscount: true };

    const tvaRate = settings?.tva_rate ?? 20;
    const companyName = settings?.company_name || 'Mon Entreprise';

    const hasDiscount = quote.items.some(item => (item.discount ?? 0) > 0);

    // === Build footer legal lines ===
    const buildFooterLines = (): string[] => {
      const lines: string[] = [];
      const line1Parts: string[] = [companyName];
      if (settings?.address) line1Parts.push(settings.address);
      lines.push(line1Parts.join(' - '));

      const legalParts: string[] = [];
      if (settings?.rc) legalParts.push(`RC N° ${settings.rc}`);
      if (settings?.if_number) legalParts.push(`IF N° ${settings.if_number}`);
      if (settings?.cnss) legalParts.push(`CNSS N° ${settings.cnss}`);
      if (settings?.patente) legalParts.push(`PATENTE N° ${settings.patente}`);
      if (settings?.ice && fields.showCompanyICE) legalParts.push(`ICE N° ${settings.ice}`);
      if (legalParts.length > 0) lines.push(legalParts.join(' - '));

      const phoneParts: string[] = [];
      if (settings?.phone) phoneParts.push(`Tél: ${settings.phone}`);
      if (settings?.phone2) phoneParts.push(settings.phone2);
      if (settings?.phone_dir) phoneParts.push(`DIR : ${settings.phone_dir}`);
      if (settings?.phone_gsm) phoneParts.push(`GSM: ${settings.phone_gsm}`);
      if (phoneParts.length > 0) lines.push(phoneParts.join(' / '));

      const contactParts: string[] = [];
      if (settings?.email) contactParts.push(`Email: ${settings.email}`);
      if (settings?.website && fields.showCompanyWebsite) contactParts.push(`Site web: ${settings.website}`);
      if (contactParts.length > 0) lines.push(contactParts.join(' - '));

      return lines;
    };

    const footerLines = buildFooterLines();
    const footerLineHeight = 3;
    const footerTotalHeight = footerLines.length * footerLineHeight + 8;

    // === Document type label ===
    const docTypeLabel = documentType === 'bl' ? 'BON DE LIVRAISON'
      : documentType === 'bon_commande' ? 'BON DE COMMANDE'
      : documentType === 'proforma' ? 'PROFORMA'
      : documentType === 'invoice' ? 'FACTURE'
      : documentType === 'avoir' ? 'AVOIR'
      : 'DEVIS';

    // === Load logo ===
    let logoBase64: string | null = null;
    let logoW = 0, logoH = 0;
    const logoSizeConfig = { small: { maxW: 35, maxH: 20 }, medium: { maxW: 50, maxH: 28 }, large: { maxW: 70, maxH: 38 } };
    const logoSize = settings?.logo_size || 'medium';
    const { maxW: maxLogoW, maxH: maxLogoH } = logoSizeConfig[logoSize] || logoSizeConfig.medium;

    if (fields.showLogo && settings?.logo_url) {
      logoBase64 = await loadImageAsBase64(settings.logo_url);
      if (logoBase64) {
        const img = new Image();
        img.src = logoBase64;
        await new Promise<void>((resolve) => { img.onload = () => resolve(); img.onerror = () => resolve(); });
        logoW = maxLogoW;
        logoH = (img.height / img.width) * logoW;
        if (logoH > maxLogoH) { logoH = maxLogoH; logoW = (img.width / img.height) * logoH; }
      }
    }

    // === Quote meta rows ===
    const quoteDate = quote.quote_date ? new Date(quote.quote_date) : quote.createdAt;
    const buildMetaRows = (): [string, string][] => {
      const rows: [string, string][] = [
        ['Date', this.formatDate(quoteDate)],
        ['N° de piece', quote.quoteNumber],
      ];
      if (quote.commandNumber) rows.push(['N° de cmd', quote.commandNumber]);
      if (fields.showValidityDate && documentType === 'quote') {
        const validityDays = settings?.quote_validity_days ?? 30;
        const validityDate = new Date(quote.createdAt);
        validityDate.setDate(validityDate.getDate() + validityDays);
        rows.push(['Validite', `${validityDays} j (${this.formatDate(validityDate)})`]);
      }
      if (documentType === 'invoice') {
        if (quote.payment_date) rows.push(['Date paiement', this.formatDate(new Date(quote.payment_date))]);
        if (quote.payment_method) rows.push(['Mode paiement', quote.payment_method]);
        if (quote.payment_reference) rows.push(['N° référence', quote.payment_reference]);
        if (quote.payment_bank) rows.push(['Banque', quote.payment_bank]);
      }
      return rows;
    };

    const buildClientRows = (): [string, string][] => {
      const rows: [string, string][] = [];
      rows.push(['Client', quote.customer.fullName || '']);
      if (quote.customer.address || quote.customer.phoneNumber) {
        const addrParts: string[] = [];
        if (quote.customer.phoneNumber) {
          let phone = quote.customer.phoneNumber.trim();
          if (phone.startsWith('*')) phone = phone.substring(1).trim();
          if (phone.endsWith(',')) phone = phone.slice(0, -1).trim();
          addrParts.push(phone);
        }
        if (quote.customer.address) addrParts.push(quote.customer.address);
        rows.push(['Adresse / Tel', addrParts.join(' / ')]);
      }
      if (quote.customer.city) rows.push(['Ville', quote.customer.city]);
      if (quote.customer.salesPerson) rows.push(['Commercial', quote.customer.salesPerson]);
      if (fields.showClientICE && quote.customer.ice) rows.push(['ICE Client', quote.customer.ice]);
      return rows;
    };

    // ============================================================
    //  TEMPLATE: CLASSIC (default)
    // ============================================================
    const drawClassicHeader = async (): Promise<number> => {
      let yy = 7;

      // Top accent bar
      doc.setFillColor(...ACCENT);
      doc.rect(0, 0, pageWidth, 2, 'F');

      // Doc type label (right)
      const devisBoxW = (documentType === 'bl' || documentType === 'bon_commande') ? 58 : 45;
      const devisBoxH = 11;
      const devisBoxX = pageWidth - margin - devisBoxW;
      doc.setFillColor(...ACCENT);
      doc.roundedRect(devisBoxX, yy, devisBoxW, devisBoxH, 2, 2, 'F');
      doc.setFontSize((documentType === 'bl' || documentType === 'bon_commande') ? 14 : 22);
      doc.setFont(font, 'bold');
      doc.setTextColor(...WHITE);
      doc.text(docTypeLabel, devisBoxX + devisBoxW / 2, yy + devisBoxH / 2 + (documentType === 'bl' ? 2 : 3), { align: 'center' });

      // Logo or company name (left)
      if (logoBase64) {
        doc.addImage(logoBase64, 'AUTO', margin, yy, logoW, logoH);
        yy = Math.max(yy + logoH, yy + 14) + 5;
      } else {
        const nameX = margin;
        const nameY = yy + 4;
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
        yy = Math.max(yy + logoH, yy + 14) + 5;
      }

      // Separator
      doc.setDrawColor(...ACCENT);
      doc.setLineWidth(0.4);
      doc.line(margin, yy, pageWidth - margin, yy);
      yy += 4;

      // Client info (left) + quote meta (right)
      const leftColWidth = contentWidth * 0.55;
      const rightColWidth = contentWidth * 0.38;
      const rightColX = pageWidth - margin - rightColWidth;
      const sectionStartY = yy;

      autoTable(doc, {
        startY: sectionStartY,
        body: buildClientRows().map(([l, v]) => [l, v]),
        margin: { left: margin, right: pageWidth - margin - leftColWidth },
        theme: 'plain',
        styles: { fontSize: 7.5, cellPadding: { top: 2, bottom: 2, left: 3, right: 3 }, lineColor: [230, 230, 230], lineWidth: 0.2, textColor: DARK },
        columnStyles: {
          0: { cellWidth: 28, fillColor: ACCENT, textColor: WHITE, fontStyle: 'bold', fontSize: 6.5 },
          1: { cellWidth: leftColWidth - 28, fontSize: 7.5, fillColor: [252, 252, 252] },
        },
        tableLineColor: [230, 230, 230], tableLineWidth: 0.2,
      });
      const leftFinalY = (doc as any).lastAutoTable?.finalY || sectionStartY + 30;

      autoTable(doc, {
        startY: sectionStartY,
        body: buildMetaRows(),
        margin: { left: rightColX, right: margin },
        theme: 'plain',
        styles: { fontSize: 7.5, cellPadding: { top: 2, bottom: 2, left: 3, right: 3 }, lineColor: [230, 230, 230], lineWidth: 0.2, textColor: DARK },
        columnStyles: {
          0: { cellWidth: 24, fontStyle: 'bold', textColor: ACCENT, fontSize: 6.5, fillColor: ACCENT_LIGHT },
          1: { cellWidth: rightColWidth - 24, halign: 'right', fillColor: [252, 252, 252] },
        },
        tableLineColor: [230, 230, 230], tableLineWidth: 0.2,
      });
      const rightFinalY = (doc as any).lastAutoTable?.finalY || sectionStartY + 25;

      return Math.max(leftFinalY, rightFinalY) + 5;
    };

    // ============================================================
    //  TEMPLATE: MODERN
    //  Full-width colored header band; meta in a horizontal strip
    // ============================================================
    const drawModernHeader = async (): Promise<number> => {
      const headerH = logoBase64 ? Math.max(logoH + 10, 28) : 28;

      // Full-width header band
      doc.setFillColor(...ACCENT);
      doc.rect(0, 0, pageWidth, headerH, 'F');

      // Logo or company name in header
      if (logoBase64) {
        doc.addImage(logoBase64, 'AUTO', margin, (headerH - logoH) / 2, logoW, logoH);
      } else {
        doc.setFont(font, 'bold');
        doc.setFontSize(16);
        doc.setTextColor(...WHITE);
        doc.text(companyName, margin, headerH / 2 + 3);
        doc.setFontSize(7);
        doc.setFont(font, 'normal');
        doc.setTextColor(255, 255, 255);
        doc.setGState(doc.GState({ opacity: 0.7 }));
        doc.text('MATERIEL DE CUISINE PROFESSIONNEL', margin, headerH / 2 + 8);
        doc.setGState(doc.GState({ opacity: 1 }));
      }

      // Document type label (right side of header)
      const devisBoxW = (documentType === 'bl' || documentType === 'bon_commande') ? 62 : 50;
      const devisBoxH = headerH - 6;
      const devisBoxX = pageWidth - margin - devisBoxW;
      doc.setFillColor(...darkenColor(ACCENT, 0.25));
      doc.roundedRect(devisBoxX, 3, devisBoxW, devisBoxH, 2, 2, 'F');
      doc.setFontSize((documentType === 'bl' || documentType === 'bon_commande') ? 13 : 19);
      doc.setFont(font, 'bold');
      doc.setTextColor(...WHITE);
      doc.text(docTypeLabel, devisBoxX + devisBoxW / 2, 3 + devisBoxH / 2 + ((documentType === 'bl') ? 2 : 3), { align: 'center' });

      let yy = headerH + 4;

      // Info strip: client left, meta right
      const clientRows = buildClientRows();
      const metaRows = buildMetaRows();
      const stripH = Math.max(clientRows.length, metaRows.length) * 6 + 6;

      doc.setFillColor(247, 249, 253);
      doc.setDrawColor(...ACCENT);
      doc.setLineWidth(0.3);
      doc.rect(margin, yy, contentWidth, stripH, 'FD');

      // Client info (left half)
      const halfW = contentWidth / 2 - 6;
      let cy = yy + 4;
      clientRows.forEach(([label, value], i) => {
        doc.setFont(font, 'bold');
        doc.setFontSize(6.5);
        doc.setTextColor(...ACCENT);
        doc.text(label.toUpperCase() + ':', margin + 4, cy);
        doc.setFont(font, 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...DARK);
        doc.text(value, margin + 4 + doc.getTextWidth(label.toUpperCase() + ':') + 2, cy, { maxWidth: halfW - 30 });
        cy += 5.5;
      });

      // Meta info (right half)
      const metaX = margin + contentWidth / 2 + 2;
      let my = yy + 4;
      metaRows.forEach(([label, value]) => {
        doc.setFont(font, 'bold');
        doc.setFontSize(6.5);
        doc.setTextColor(...GRAY);
        doc.text(label + ':', metaX, my);
        doc.setFont(font, 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...DARK);
        doc.text(value, pageWidth - margin - 4, my, { align: 'right', maxWidth: halfW - 10 });
        my += 5.5;
      });

      // Accent bottom border on strip
      doc.setFillColor(...ACCENT);
      doc.rect(margin, yy + stripH - 1.5, contentWidth, 1.5, 'F');

      return yy + stripH + 5;
    };

    // ============================================================
    //  TEMPLATE: EXECUTIVE
    //  Split left panel (accent) for company info + right for document
    // ============================================================
    const drawExecutiveHeader = async (): Promise<number> => {
      const panelW = contentWidth * 0.42;
      const rightW = contentWidth - panelW - 4;
      const leftX = margin;
      const rightX = margin + panelW + 4;

      const clientRows = buildClientRows();
      const metaRows = buildMetaRows();
      const panelH = Math.max(logoH + 22, clientRows.length * 5.5 + 20, 50);

      // Left panel (accent color)
      doc.setFillColor(...ACCENT);
      doc.roundedRect(leftX, 5, panelW, panelH, 3, 3, 'F');

      // Logo in left panel
      let innerY = 10;
      if (logoBase64) {
        const lw = Math.min(logoW, panelW - 10);
        const lh = (logoH / logoW) * lw;
        doc.addImage(logoBase64, 'AUTO', leftX + (panelW - lw) / 2, innerY, lw, lh);
        innerY += lh + 4;
      } else {
        doc.setFont(font, 'bold');
        doc.setFontSize(12);
        doc.setTextColor(...WHITE);
        const nameLines = doc.splitTextToSize(companyName, panelW - 10);
        doc.text(nameLines, leftX + panelW / 2, innerY + 5, { align: 'center' });
        innerY += nameLines.length * 6 + 4;
        doc.setFontSize(6);
        doc.setFont(font, 'normal');
        doc.setTextColor(255, 255, 255);
        doc.setGState(doc.GState({ opacity: 0.75 }));
        doc.text('MATERIEL DE CUISINE PROFESSIONNEL', leftX + panelW / 2, innerY, { align: 'center' });
        doc.setGState(doc.GState({ opacity: 1 }));
        innerY += 6;
      }

      // Thin divider in left panel
      doc.setDrawColor(255, 255, 255);
      doc.setGState(doc.GState({ opacity: 0.3 }));
      doc.setLineWidth(0.3);
      doc.line(leftX + 5, innerY, leftX + panelW - 5, innerY);
      doc.setGState(doc.GState({ opacity: 1 }));
      innerY += 4;

      // Company contact info in left panel
      const contactLines: string[] = [];
      if (settings?.phone) contactLines.push(`Tel: ${settings.phone}`);
      if (settings?.phone2) contactLines.push(settings.phone2);
      if (settings?.email) contactLines.push(settings.email);
      if (settings?.address) contactLines.push(settings.address);
      doc.setFont(font, 'normal');
      doc.setFontSize(6);
      doc.setTextColor(...WHITE);
      contactLines.forEach(line => {
        doc.text(line, leftX + panelW / 2, innerY, { align: 'center', maxWidth: panelW - 8 });
        innerY += 4;
      });

      // Right side: document title + meta
      let ry = 7;
      // Document title
      const docBoxH = 12;
      doc.setFillColor(...DARK);
      doc.roundedRect(rightX, ry, rightW, docBoxH, 2, 2, 'F');
      doc.setFontSize((documentType === 'bl' || documentType === 'bon_commande') ? 12 : 17);
      doc.setFont(font, 'bold');
      doc.setTextColor(...WHITE);
      doc.text(docTypeLabel, rightX + rightW / 2, ry + docBoxH / 2 + ((documentType === 'bl') ? 2 : 3), { align: 'center' });
      ry += docBoxH + 4;

      // Meta rows (right panel)
      metaRows.forEach(([label, value]) => {
        doc.setFont(font, 'bold');
        doc.setFontSize(6.5);
        doc.setTextColor(...GRAY);
        doc.text(label + ':', rightX, ry);
        doc.setFont(font, 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...DARK);
        doc.text(value, rightX + rightW, ry, { align: 'right', maxWidth: rightW - 28 });
        ry += 5.5;
      });

      // Thin accent divider right
      ry += 2;
      doc.setDrawColor(...ACCENT);
      doc.setLineWidth(0.5);
      doc.line(rightX, ry, rightX + rightW, ry);
      ry += 3;

      // Client block (right panel, below divider)
      clientRows.forEach(([label, value]) => {
        doc.setFont(font, 'bold');
        doc.setFontSize(6.5);
        doc.setTextColor(...ACCENT);
        doc.text(label.toUpperCase() + ':', rightX, ry);
        doc.setFont(font, 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...DARK);
        doc.text(value, rightX + rightW, ry, { align: 'right', maxWidth: rightW - 28 });
        ry += 5.5;
      });

      const finalY = Math.max(5 + panelH, ry) + 6;

      // Bottom accent strip
      doc.setFillColor(...ACCENT);
      doc.rect(margin, finalY - 2, contentWidth, 1, 'F');

      return finalY + 3;
    };

    // ============================================================
    //  TEMPLATE: MINIMAL
    //  Clean lines, no color fills, professional minimalism
    // ============================================================
    const drawMinimalHeader = async (): Promise<number> => {
      let yy = 8;

      // Very thin top accent line
      doc.setFillColor(...ACCENT);
      doc.rect(0, 0, pageWidth, 1.5, 'F');

      // Logo or company name (left)
      if (logoBase64) {
        doc.addImage(logoBase64, 'AUTO', margin, yy, logoW, logoH);
        yy = Math.max(yy + logoH, yy + 10);
      } else {
        doc.setFont(font, 'bold');
        const nameFontSize = style.headerSize === 'small' ? 16 : style.headerSize === 'medium' ? 19 : 22;
        doc.setFontSize(nameFontSize);
        doc.setTextColor(...DARK);
        doc.text(companyName, margin, yy + 8);
        yy += 12;
      }

      // Document type (right, same line as company)
      const docLabelX = pageWidth - margin;
      doc.setFont(font, 'bold');
      doc.setFontSize((documentType === 'bl' || documentType === 'bon_commande') ? 11 : 16);
      doc.setTextColor(...ACCENT);
      doc.text(docTypeLabel, docLabelX, 14, { align: 'right' });

      yy += 3;

      // Full-width thin separator
      doc.setDrawColor(...DARK);
      doc.setLineWidth(0.6);
      doc.line(margin, yy, pageWidth - margin, yy);
      yy += 4;

      // Client + meta on same line, separated by a thin vertical line
      const clientRows = buildClientRows();
      const metaRows = buildMetaRows();
      const halfW = contentWidth / 2 - 6;

      let ly = yy, ry = yy;
      clientRows.forEach(([label, value]) => {
        doc.setFont(font, 'normal');
        doc.setFontSize(6.5);
        doc.setTextColor(...GRAY);
        doc.text(label + ':', margin, ly);
        doc.setFont(font, 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...DARK);
        doc.text(value, margin + 22, ly, { maxWidth: halfW - 22 });
        ly += 5;
      });

      const midX = margin + contentWidth / 2;
      metaRows.forEach(([label, value]) => {
        doc.setFont(font, 'normal');
        doc.setFontSize(6.5);
        doc.setTextColor(...GRAY);
        doc.text(label + ':', midX + 4, ry);
        doc.setFont(font, 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...DARK);
        doc.text(value, pageWidth - margin, ry, { align: 'right', maxWidth: halfW - 10 });
        ry += 5;
      });

      // Thin vertical separator between columns
      const maxY = Math.max(ly, ry);
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.3);
      doc.line(midX, yy - 2, midX, maxY + 1);

      yy = maxY + 4;

      // Bottom thin line
      doc.setDrawColor(180, 180, 180);
      doc.setLineWidth(0.3);
      doc.line(margin, yy, pageWidth - margin, yy);

      return yy + 4;
    };

    // ============================================================
    //  TEMPLATE: SIDEBAR
    //  Accent bookmark stripe on left; clean two-column info layout
    // ============================================================
    const drawSidebarHeader = async (): Promise<number> => {
      const stripeW = 6;
      doc.setFillColor(...ACCENT);
      doc.rect(0, 0, stripeW, 80, 'F');

      const cx = margin + stripeW - margin + 5; // content left X (relative to margin)
      const cxAbs = margin + (stripeW > margin ? stripeW - margin + 2 : 0) + 2;
      let yy = 8;

      if (logoBase64) {
        doc.addImage(logoBase64, 'AUTO', cxAbs, yy, logoW, logoH);
        yy += logoH + 4;
      } else {
        doc.setFont(font, 'bold');
        doc.setFontSize(16);
        doc.setTextColor(...ACCENT);
        doc.text(companyName, cxAbs, yy + 8, { maxWidth: contentWidth * 0.55 });
        yy += 14;
      }

      // Document type right-aligned at same level as company
      doc.setFont(font, 'bold');
      doc.setFontSize((documentType === 'bl' || documentType === 'bon_commande') ? 12 : 18);
      doc.setTextColor(...DARK);
      doc.text(docTypeLabel, pageWidth - margin, 14, { align: 'right' });

      yy = Math.max(yy, 22) + 2;

      doc.setDrawColor(...ACCENT);
      doc.setLineWidth(0.5);
      doc.line(cxAbs, yy, pageWidth - margin, yy);
      yy += 5;

      const clientRows = buildClientRows();
      const metaRows = buildMetaRows();
      const halfW = (pageWidth - margin - cxAbs) / 2 - 4;
      const midX = cxAbs + (pageWidth - margin - cxAbs) / 2 + 2;

      let ly = yy, ry = yy;
      clientRows.forEach(([label, value]) => {
        doc.setFont(font, 'bold'); doc.setFontSize(6.5); doc.setTextColor(...ACCENT);
        doc.text(label.toUpperCase() + ':', cxAbs, ly);
        doc.setFont(font, 'normal'); doc.setFontSize(7.5); doc.setTextColor(...DARK);
        doc.text(value, cxAbs + doc.getTextWidth(label.toUpperCase() + ':') + 1.5, ly, { maxWidth: halfW - 22 });
        ly += 5.5;
      });
      metaRows.forEach(([label, value]) => {
        doc.setFont(font, 'bold'); doc.setFontSize(6.5); doc.setTextColor(...GRAY);
        doc.text(label + ':', midX, ry);
        doc.setFont(font, 'normal'); doc.setFontSize(7.5); doc.setTextColor(...DARK);
        doc.text(value, pageWidth - margin, ry, { align: 'right', maxWidth: halfW });
        ry += 5.5;
      });

      const maxY = Math.max(ly, ry) + 2;
      doc.setDrawColor(210, 210, 210); doc.setLineWidth(0.3);
      doc.line(cxAbs, maxY, pageWidth - margin, maxY);
      return maxY + 5;
    };

    // ============================================================
    //  TEMPLATE: BANNER
    //  Centered bold document type; company & client in clean strips
    // ============================================================
    const drawBannerHeader = async (): Promise<number> => {
      // Top accent bar
      doc.setFillColor(...ACCENT);
      doc.rect(0, 0, pageWidth, 2, 'F');

      let yy = 7;

      // Centered doc type
      doc.setFont(font, 'bold');
      doc.setFontSize((documentType === 'bl' || documentType === 'bon_commande') ? 14 : 22);
      doc.setTextColor(...ACCENT);
      doc.text(docTypeLabel, pageWidth / 2, yy + 8, { align: 'center' });

      // Thin underline beneath title
      const titleW = doc.getTextWidth(docTypeLabel);
      doc.setDrawColor(...ACCENT);
      doc.setLineWidth(0.4);
      doc.line(pageWidth / 2 - titleW / 2, yy + 10, pageWidth / 2 + titleW / 2, yy + 10);
      yy += 16;

      // Company / logo row
      if (logoBase64) {
        const lx = margin;
        doc.addImage(logoBase64, 'AUTO', lx, yy, logoW, logoH);
        yy += logoH + 3;
      } else {
        doc.setFont(font, 'bold'); doc.setFontSize(12); doc.setTextColor(...DARK);
        doc.text(companyName, margin, yy + 6, { maxWidth: contentWidth * 0.55 });
        doc.setFont(font, 'normal'); doc.setFontSize(6); doc.setTextColor(...GRAY);
        if (settings?.phone) doc.text(settings.phone, margin, yy + 11);
        yy += 15;
      }

      const metaRows = buildMetaRows();
      const metaBaseY = yy - 12;
      metaRows.forEach(([label, value], mi) => {
        const my = metaBaseY + mi * 5.5;
        doc.setFont(font, 'bold'); doc.setFontSize(6.5); doc.setTextColor(...GRAY);
        doc.text(label + ':', pageWidth - margin - 50, my);
        doc.setFont(font, 'normal'); doc.setFontSize(7); doc.setTextColor(...DARK);
        doc.text(value, pageWidth - margin, my, { align: 'right' });
      });

      // Client shaded box
      const clientRows = buildClientRows();
      const boxH = clientRows.length * 6 + 6;
      doc.setFillColor(...ACCENT_LIGHT);
      doc.setDrawColor(...ACCENT);
      doc.setLineWidth(0.3);
      doc.roundedRect(margin, yy, contentWidth, boxH, 2, 2, 'FD');
      let cy = yy + 5;
      clientRows.forEach(([label, value]) => {
        doc.setFont(font, 'bold'); doc.setFontSize(6.5); doc.setTextColor(...ACCENT);
        doc.text(label.toUpperCase() + ':', margin + 4, cy);
        doc.setFont(font, 'normal'); doc.setFontSize(7.5); doc.setTextColor(...DARK);
        doc.text(value, margin + 38, cy, { maxWidth: contentWidth - 42 });
        cy += 6;
      });
      return yy + boxH + 6;
    };

    // ============================================================
    //  TEMPLATE: BOLD
    //  High-contrast dark header; strong accent accents; clean grid
    // ============================================================
    const drawBoldHeader = async (): Promise<number> => {
      const headerH = logoBase64 ? Math.max(logoH + 12, 32) : 32;

      // Dark header band
      doc.setFillColor(...DARK);
      doc.rect(0, 0, pageWidth, headerH, 'F');

      // Accent side accent on header
      doc.setFillColor(...ACCENT);
      doc.rect(pageWidth - 4, 0, 4, headerH, 'F');

      if (logoBase64) {
        doc.addImage(logoBase64, 'AUTO', margin, (headerH - logoH) / 2, logoW, logoH);
      } else {
        doc.setFont(font, 'bold'); doc.setFontSize(15); doc.setTextColor(...WHITE);
        doc.text(companyName, margin, headerH / 2 + 2);
        doc.setFontSize(6); doc.setFont(font, 'normal');
        doc.setTextColor(180, 180, 180);
        doc.text('MATERIEL DE CUISINE PROFESSIONNEL', margin, headerH / 2 + 7);
      }

      // Doc type in accent box on header (left of right stripe)
      const dtW = (documentType === 'bl' || documentType === 'bon_commande') ? 60 : 46;
      const dtX = pageWidth - 4 - dtW - 4;
      doc.setFillColor(...ACCENT);
      doc.roundedRect(dtX, 4, dtW, headerH - 8, 2, 2, 'F');
      doc.setFont(font, 'bold');
      doc.setFontSize((documentType === 'bl' || documentType === 'bon_commande') ? 12 : 18);
      doc.setTextColor(...WHITE);
      doc.text(docTypeLabel, dtX + dtW / 2, headerH / 2 + ((documentType === 'bl') ? 2 : 3), { align: 'center' });

      let yy = headerH + 4;

      // Client + meta in two column boxes
      const clientRows = buildClientRows();
      const metaRows = buildMetaRows();
      const colW = contentWidth / 2 - 2;

      // Client box (left)
      const rowCount = Math.max(clientRows.length, metaRows.length);
      const boxH = rowCount * 5.5 + 8;

      doc.setFillColor(248, 248, 248);
      doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.2);
      doc.rect(margin, yy, colW, boxH, 'FD');
      doc.setFillColor(...ACCENT);
      doc.rect(margin, yy, 3, boxH, 'F');
      let cy = yy + 5;
      clientRows.forEach(([label, value]) => {
        doc.setFont(font, 'bold'); doc.setFontSize(6.5); doc.setTextColor(...ACCENT);
        doc.text(label.toUpperCase() + ':', margin + 6, cy);
        doc.setFont(font, 'normal'); doc.setFontSize(7); doc.setTextColor(...DARK);
        doc.text(value, margin + colW - 3, cy, { align: 'right', maxWidth: colW - 32 });
        cy += 5.5;
      });

      // Meta box (right)
      const metaX = margin + colW + 4;
      doc.setFillColor(248, 248, 248);
      doc.rect(metaX, yy, colW, boxH, 'FD');
      doc.setFillColor(...DARK);
      doc.rect(metaX, yy, 3, boxH, 'F');
      let my = yy + 5;
      metaRows.forEach(([label, value]) => {
        doc.setFont(font, 'bold'); doc.setFontSize(6.5); doc.setTextColor(...GRAY);
        doc.text(label + ':', metaX + 6, my);
        doc.setFont(font, 'normal'); doc.setFontSize(7); doc.setTextColor(...DARK);
        doc.text(value, metaX + colW - 3, my, { align: 'right', maxWidth: colW - 32 });
        my += 5.5;
      });

      return yy + boxH + 5;
    };

    // ============================================================
    //  TEMPLATE: SPLIT
    //  Left accent panel (company) + right dark panel (doc type)
    // ============================================================
    const drawSplitHeader = async (): Promise<number> => {
      const panelH = logoBase64 ? Math.max(logoH + 14, 30) : 30;
      const halfW = pageWidth / 2;

      // Left panel (accent)
      doc.setFillColor(...ACCENT);
      doc.rect(0, 0, halfW, panelH, 'F');

      // Right panel (dark)
      doc.setFillColor(...DARK);
      doc.rect(halfW, 0, halfW, panelH, 'F');

      // Company / logo in left panel
      if (logoBase64) {
        const lx = margin;
        const ly = (panelH - logoH) / 2;
        doc.addImage(logoBase64, 'AUTO', lx, ly > 0 ? ly : 2, logoW, logoH);
      } else {
        doc.setFont(font, 'bold'); doc.setFontSize(13); doc.setTextColor(...WHITE);
        const lines = doc.splitTextToSize(companyName, halfW - margin * 2);
        doc.text(lines, margin + 2, panelH / 2 + 2);
      }

      // Doc type in right panel
      doc.setFont(font, 'bold');
      doc.setFontSize((documentType === 'bl' || documentType === 'bon_commande') ? 13 : 20);
      doc.setTextColor(...ACCENT);
      doc.text(docTypeLabel, halfW + (halfW - margin) / 2, panelH / 2 + 3, { align: 'center' });

      let yy = panelH + 5;

      // Two-column client + meta below panels
      const clientRows = buildClientRows();
      const metaRows = buildMetaRows();
      const colW = contentWidth / 2 - 3;

      // Thin accent underline
      doc.setDrawColor(...ACCENT); doc.setLineWidth(0.5);
      doc.line(margin, yy, margin + colW, yy);
      doc.setDrawColor(...DARK); doc.setLineWidth(0.5);
      doc.line(margin + colW + 6, yy, pageWidth - margin, yy);
      yy += 4;

      let ly = yy, ry = yy;
      clientRows.forEach(([label, value]) => {
        doc.setFont(font, 'bold'); doc.setFontSize(6.5); doc.setTextColor(...ACCENT);
        doc.text(label.toUpperCase() + ':', margin, ly);
        doc.setFont(font, 'normal'); doc.setFontSize(7.5); doc.setTextColor(...DARK);
        doc.text(value, margin + doc.getTextWidth(label.toUpperCase() + ':') + 2, ly, { maxWidth: colW - 28 });
        ly += 5.5;
      });
      const metaX = margin + colW + 6;
      metaRows.forEach(([label, value]) => {
        doc.setFont(font, 'bold'); doc.setFontSize(6.5); doc.setTextColor(...GRAY);
        doc.text(label + ':', metaX, ry);
        doc.setFont(font, 'normal'); doc.setFontSize(7.5); doc.setTextColor(...DARK);
        doc.text(value, pageWidth - margin, ry, { align: 'right', maxWidth: colW - 10 });
        ry += 5.5;
      });

      const maxY = Math.max(ly, ry);
      doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.3);
      doc.line(margin, maxY + 2, pageWidth - margin, maxY + 2);
      return maxY + 7;
    };

    // ============================================================
    //  DRAW PAGE DECORATIONS (called on each page)
    // ============================================================
    const drawPageDecorations = () => {
      if (template === 'minimal') {
        doc.setFillColor(...ACCENT);
        doc.rect(0, 0, pageWidth, 1.5, 'F');
        doc.setDrawColor(180, 180, 180);
        doc.setLineWidth(0.3);
        doc.line(margin, pageHeight - footerTotalHeight - 1, pageWidth - margin, pageHeight - footerTotalHeight - 1);
      } else if (template === 'bold') {
        doc.setFillColor(...DARK);
        doc.rect(0, 0, pageWidth, 2, 'F');
        doc.setFillColor(...ACCENT);
        doc.rect(0, pageHeight - 2, pageWidth, 2, 'F');
      } else if (template === 'split') {
        doc.setFillColor(...ACCENT);
        doc.rect(0, 0, pageWidth / 2, 2, 'F');
        doc.setFillColor(...DARK);
        doc.rect(pageWidth / 2, 0, pageWidth / 2, 2, 'F');
        doc.setFillColor(...ACCENT);
        doc.rect(0, pageHeight - 2, pageWidth, 2, 'F');
      } else {
        doc.setFillColor(...ACCENT);
        doc.rect(0, 0, pageWidth, 2, 'F');
        doc.setFillColor(...ACCENT);
        doc.rect(0, pageHeight - 2, pageWidth, 2, 'F');
      }

      const footerBaseY = pageHeight - footerTotalHeight - 2;

      // Disclaimer
      const disclaimer = '* Les produits et prix de ce devis peuvent légèrement évoluer lors de la confirmation selon les disponibilités en stock et les variations de prix à l\'arrivage.';
      doc.setFont(font, 'italic');
      doc.setFontSize(4.5);
      doc.setTextColor(160, 160, 160);
      doc.text(disclaimer, pageWidth / 2, footerBaseY - 3.5, { align: 'center', maxWidth: contentWidth });

      if (template !== 'minimal') {
        doc.setDrawColor(...ACCENT);
        doc.setLineWidth(0.5);
        doc.line(margin, footerBaseY, pageWidth - margin, footerBaseY);
      } else {
        doc.setDrawColor(180, 180, 180);
        doc.setLineWidth(0.3);
        doc.line(margin, footerBaseY, pageWidth - margin, footerBaseY);
      }

      let fy = footerBaseY + 3;
      for (let i = 0; i < footerLines.length; i++) {
        if (i === 0) {
          doc.setFont(font, 'bold');
          if (template === 'minimal') { doc.setTextColor(...DARK); } else { doc.setTextColor(...ACCENT); }
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

    // Draw template header
    if (template === 'modern') {
      y = await drawModernHeader();
    } else if (template === 'executive') {
      y = await drawExecutiveHeader();
    } else if (template === 'minimal') {
      y = await drawMinimalHeader();
    } else if (template === 'sidebar') {
      y = await drawSidebarHeader();
    } else if (template === 'banner') {
      y = await drawBannerHeader();
    } else if (template === 'bold') {
      y = await drawBoldHeader();
    } else if (template === 'split') {
      y = await drawSplitHeader();
    } else {
      y = await drawClassicHeader();
    }

    // ============================================================
    //  ITEMS TABLE
    // ============================================================
    const isBL = documentType === 'bl';
    const isBC = documentType === 'bon_commande';
    const tvaDivisor = 1 + tvaRate / 100;

    let tableHeaders: string[][];
    let tableBody: string[][];
    let itemColumnStyles: Record<number, any>;

    const showBLPrices = blShowPrices ?? settings?.bl_show_prices ?? true;

    if (isBC) {
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
      // Standard quote/invoice/proforma/avoir — apply column visibility
      const showBrand = printCols.showBrand !== false;
      const showBarcode = printCols.showBarcode !== false;
      const showUnitPrice = printCols.showUnitPrice !== false;
      const showDiscountCol = (printCols.showDiscount !== false) && hasDiscount;

      const headerCols: string[] = [];
      if (showBrand) headerCols.push('Marque');
      if (showBarcode) headerCols.push('REF');
      headerCols.push('DESCRIPTION');
      headerCols.push('QTE');
      if (showUnitPrice) headerCols.push(printTTCOnly ? 'PU TTC' : 'PU HT');
      if (showDiscountCol) headerCols.push('Remise');
      headerCols.push(printTTCOnly ? 'TOTAL TTC' : 'TOTAL HT');
      tableHeaders = [headerCols];

      tableBody = quote.items.map(item => {
        const discount = item.discount ?? 0;
        const row: string[] = [];
        if (showBrand) row.push(getQuoteItemBrand(item) || '');
        if (showBarcode) row.push(getQuoteItemBarcode(item) || '');
        row.push(getQuoteItemName(item));
        row.push(String(item.quantity));
        if (printTTCOnly) {
          // Show TTC prices — item.unitPrice is already TTC
          const discountedTTC = item.unitPrice * (1 - discount / 100);
          if (showUnitPrice) row.push(this.formatCurrency(item.unitPrice));
          if (showDiscountCol) row.push(discount > 0 ? `${discount}%` : '-');
          row.push(this.formatCurrency(discountedTTC * item.quantity));
        } else {
          const unitPriceHT = item.unitPrice / tvaDivisor;
          const discountedPriceHT = unitPriceHT * (1 - discount / 100);
          if (showUnitPrice) row.push(this.formatCurrency(unitPriceHT));
          if (showDiscountCol) row.push(discount > 0 ? `${discount}%` : '-');
          row.push(this.formatCurrency(discountedPriceHT * item.quantity));
        }
        return row;
      });

      // Build column styles dynamically
      const colStyles: Record<number, any> = {};
      let ci = 0;
      if (showBrand) { colStyles[ci] = { cellWidth: 18, halign: 'center' }; ci++; }
      if (showBarcode) { colStyles[ci] = { cellWidth: 24, halign: 'center' }; ci++; }
      colStyles[ci] = { cellWidth: 'auto' }; ci++;
      colStyles[ci] = { cellWidth: 12, halign: 'center' }; ci++;
      if (showUnitPrice) { colStyles[ci] = { cellWidth: 24, halign: 'right' }; ci++; }
      if (showDiscountCol) { colStyles[ci] = { cellWidth: 16, halign: 'center' }; ci++; }
      colStyles[ci] = { cellWidth: 26, halign: 'right', fontStyle: 'bold' };
      itemColumnStyles = colStyles;
    }

    // Template-specific table styles
    const tableHeadFill = template === 'minimal' ? DARK : ACCENT;
    const tableAltRow = template === 'minimal' ? [245, 245, 245] : [248, 249, 252];
    const tableLineW = template === 'minimal' ? 0 : 0.2;

    autoTable(doc, {
      startY: y,
      head: tableHeaders,
      body: tableBody,
      margin: { left: margin, right: margin, bottom: footerTotalHeight + 4 },
      styles: {
        fontSize: 7,
        cellPadding: { top: 2, bottom: 2, left: 2.5, right: 2.5 },
        lineColor: [230, 230, 230],
        lineWidth: tableLineW,
        textColor: DARK,
        overflow: 'linebreak',
      },
      headStyles: {
        fillColor: tableHeadFill,
        textColor: WHITE,
        fontStyle: 'bold',
        fontSize: 7,
        halign: 'center',
        cellPadding: { top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 },
      },
      alternateRowStyles: { fillColor: tableAltRow },
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

    // BL with prices: simple HT total
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

    // ============================================================
    //  TOTALS SECTION (non-BL, non-BC)
    // ============================================================
    if (!isBL && !isBC) {
      const totalsHeight = (fields.showTVA && !printTTCOnly ? 20 : 0) + 16;
      if (y + totalsHeight > pageHeight - footerTotalHeight - 8) {
        doc.addPage();
        drawPageDecorations();
        y = 12;
      }

      const totalTTC = quote.totalAmount;
      const totalHT = totalTTC / (1 + tvaRate / 100);
      const totalTVA = totalTTC - totalHT;

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
          if (template === 'minimal') {
            // Minimal: just bold text with a top line
            doc.setDrawColor(...DARK);
            doc.setLineWidth(0.5);
            doc.line(totalsX, y, totalsX + totalsWidth, y);
            y += 2;
            doc.setFontSize(10);
            doc.setFont(font, 'bold');
            doc.setTextColor(...DARK);
            doc.text(label, totalsX + 3, y + 5);
            doc.text(value, totalsX + totalsWidth - 3, y + 5, { align: 'right' });
            y += 9;
          } else if (style.totalsStyle === 'highlighted') {
            doc.setFillColor(...ACCENT);
            doc.rect(totalsX, y, totalsWidth, 8, 'F');
            doc.setFontSize(9);
            doc.setFont(font, 'bold');
            doc.setTextColor(...WHITE);
            doc.text(label, totalsX + 3, y + 5.5);
            doc.text(value, totalsX + totalsWidth - 3, y + 5.5, { align: 'right' });
            y += 10;
          } else if (style.totalsStyle === 'boxed') {
            doc.setDrawColor(...ACCENT);
            doc.setLineWidth(0.6);
            doc.rect(totalsX, y, totalsWidth, 8, 'S');
            doc.setFontSize(9);
            doc.setFont(font, 'bold');
            doc.setTextColor(...ACCENT);
            doc.text(label, totalsX + 3, y + 5.5);
            doc.text(value, totalsX + totalsWidth - 3, y + 5.5, { align: 'right' });
            y += 10;
          } else {
            doc.setFontSize(9);
            doc.setFont(font, 'bold');
            doc.setTextColor(...ACCENT);
            doc.text(label, totalsX + 3, y + 5.5);
            doc.text(value, totalsX + totalsWidth - 3, y + 5.5, { align: 'right' });
            y += 10;
          }
        } else {
          if (template === 'minimal') {
            doc.setFontSize(7.5);
            doc.setFont(font, 'normal');
            doc.setTextColor(...GRAY);
            doc.text(label, totalsX + 3, y + 4.5);
            doc.setTextColor(...DARK);
            doc.text(value, totalsX + totalsWidth - 3, y + 4.5, { align: 'right' });
            y += 5.5;
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
        }
      };

      if (printTTCOnly) {
        // Only show final TTC, hide all HT/TVA rows
        drawTotalsRow('TOTAL TTC', this.formatCurrency(totalTTC) + ' Dh', true);
      } else {
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
      }

      // Payment summary (invoice)
      if (documentType === 'invoice') {
        const avance = quote.avance_amount ?? 0;
        const paymentsTotal = (quote.payment_methods_json || []).reduce((s: number, e: any) => s + (e.amount || 0), 0);
        const totalPaid = avance + paymentsTotal;
        const reste = Math.max(0, totalTTC - totalPaid);
        if (avance > 0) drawTotalsRow('AVANCE REÇUE', '-' + this.formatCurrency(avance) + ' Dh');
        if (paymentsTotal > 0) drawTotalsRow('PAIEMENTS REÇUS', '-' + this.formatCurrency(paymentsTotal) + ' Dh');
        if (totalPaid > 0) {
          if (reste <= 0) {
            drawTotalsRow('FACTURE SOLDÉE ✓', this.formatCurrency(totalTTC) + ' Dh', true);
          } else {
            drawTotalsRow('TOTAL PAYÉ', this.formatCurrency(totalPaid) + ' Dh');
            drawTotalsRow('RESTE À PAYER', this.formatCurrency(reste) + ' Dh', true);
          }
        }
      }
    }

    // === INVOICE: "Arrêté" block ===
    if (documentType === 'invoice') {
      const amountInLetters = numberToWordsFr(quote.totalAmount);
      const blockPadX = 4;
      const blockPadY = 3.5;
      const labelText = 'Arrêté la présente facture à la somme de :';
      doc.setFontSize(7);
      const lettersLines = doc.splitTextToSize(amountInLetters, contentWidth - blockPadX * 2 - 2);
      const blockH = blockPadY * 2 + 5 + lettersLines.length * 4.5;

      if (y + blockH > pageHeight - footerTotalHeight - 8) {
        doc.addPage();
        drawPageDecorations();
        y = 12;
      }

      doc.setFillColor(...ACCENT_LIGHT);
      doc.setDrawColor(...ACCENT);
      doc.setLineWidth(0.4);
      doc.roundedRect(margin, y, contentWidth, blockH, 1.5, 1.5, 'FD');
      doc.setFont(font, 'italic');
      doc.setFontSize(7);
      doc.setTextColor(...GRAY);
      doc.text(labelText, margin + blockPadX, y + blockPadY + 3.5);
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
      doc.text(`Conditions de reglement : ${settings?.payment_terms || '30 jours'}`, margin, y);
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
      doc.setFillColor(200, 30, 30);
      doc.roundedRect(margin, ctaY, ctaBoxWidth, ctaBoxHeight, 1.5, 1.5, 'F');
      const iconX = margin + ctaPaddingX;
      const iconY = ctaY + (ctaBoxHeight - iconSize) / 2;
      doc.setFillColor(255, 255, 255);
      doc.rect(iconX, iconY, 3, iconSize, 'F');
      doc.setFillColor(200, 30, 30);
      doc.triangle(iconX + 1.5, iconY, iconX + 3, iconY, iconX + 3, iconY + 1.5, 'F');
      doc.setTextColor(255, 255, 255);
      const textY = ctaY + ctaBoxHeight / 2 + 1.2;
      doc.textWithLink(ctaLabel, iconX + iconSize + 2, textY, { url: techSheetsUrl });
      doc.link(margin, ctaY, ctaBoxWidth, ctaBoxHeight, { url: techSheetsUrl });
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
          const stampSizeConfig = { small: { maxW: 25, maxH: 25 }, medium: { maxW: 35, maxH: 35 }, large: { maxW: 50, maxH: 50 } };
          const stampSize = settings.stamp_size || 'medium';
          const { maxW: maxStampW, maxH: maxStampH } = stampSizeConfig[stampSize] || stampSizeConfig.medium;
          const stampImg = new Image();
          stampImg.src = stampBase64;
          await new Promise<void>((resolve) => { stampImg.onload = () => resolve(); stampImg.onerror = () => resolve(); });
          let stampW = maxStampW;
          let stampH = (stampImg.height / stampImg.width) * stampW;
          if (stampH > maxStampH) { stampH = maxStampH; stampW = (stampImg.width / stampImg.height) * stampH; }
          const stampX = pageWidth - margin - stampW;
          const stampY = pageHeight - footerTotalHeight - stampH - 4;
          doc.addImage(stampBase64, 'PNG', stampX, stampY, stampW, stampH);
        } catch { /* ignore */ }
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
    printTTCOnly = true,
  ): Promise<{ blob: Blob; filename: string }> {
    const docPrefix = documentType === 'bl' ? 'BL'
      : documentType === 'bon_commande' ? 'BC'
      : documentType === 'proforma' ? 'Proforma'
      : documentType === 'invoice' ? 'Facture'
      : documentType === 'avoir' ? 'Avoir'
      : 'Devis';
    const filename = `${docPrefix}_${quote.quoteNumber}.pdf`;
    const blob = await this.exportQuoteToPdf(quote, settings, techSheetsUrl, techSheetsExpiryLabel, useStampOverride, documentType, blShowPrices, printTTCOnly, true) as unknown as Blob;
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
      const dateStr = inv.quote_date ? inv.quote_date : inv.createdAt.toLocaleDateString('fr-FR');
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

    body.push(['TOTAL', '', this.formatCurrency(totalHT), this.formatCurrency(totalTVA), this.formatCurrency(totalTTC), this.formatCurrency(totalPaid), this.formatCurrency(totalReste), ''] as string[]);

    autoTable(doc, {
      startY: y,
      head: headers,
      body,
      styles: { font, fontSize: 8, cellPadding: 2.5 },
      headStyles: { fillColor: ACCENT, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
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

// ─── PAIE: Payslip PDF ───────────────────────────────────────────────────────

const MONTHS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

async function buildPayslipPdf(payslip: any, settings: any): Promise<{ doc: any; filename: string }> {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;

  const accentHex = settings?.quote_style?.accentColor || '#3B82F6';
  const ACCENT: [number, number, number] = hexToRgb(accentHex);
  const ACCENT_LIGHT = lightenColor(ACCENT, 0.92);
  const font = settings?.quote_style?.fontFamily || 'helvetica';

  doc.setFont(font);

  const companyName = settings?.company_name || 'Mon Entreprise';
  const emp = payslip.employee || {};
  const periodLabel = `${MONTHS_FR[(payslip.period_month || 1) - 1]} ${payslip.period_year}`;

  let y = margin;

  // ── Header band ── (height fits the logo's natural aspect ratio)
  let logoBase64: string | null = null;
  let logoW = 0, logoH = 0;
  if (settings?.logo_url) {
    logoBase64 = await loadImageAsBase64(settings.logo_url);
    if (logoBase64) {
      try {
        const props: any = (doc as any).getImageProperties(logoBase64);
        const maxW = 26, maxH = 18;
        logoW = maxW;
        logoH = (props.height / props.width) * logoW;
        if (logoH > maxH) { logoH = maxH; logoW = (props.width / props.height) * logoH; }
      } catch { logoW = 16; logoH = 16; }
    }
  }
  const bandH = Math.max(28, logoH + 8);

  doc.setFillColor(...ACCENT);
  doc.rect(0, 0, pageWidth, bandH, 'F');

  if (logoBase64) {
    try { doc.addImage(logoBase64, 'AUTO', margin, (bandH - logoH) / 2, logoW, logoH); } catch {}
  }

  const textX = margin + (logoBase64 ? logoW + 4 : 0);
  doc.setTextColor(...WHITE);
  doc.setFontSize(13);
  doc.setFont(font, 'bold');
  doc.text(companyName, textX, 11);
  doc.setFont(font, 'normal');
  doc.setFontSize(7);
  let hy = 16;
  if (settings?.address) { doc.text(String(settings.address), textX, hy); hy += 4; }
  // Legal identifiers (employer) — only those provided
  const ids: string[] = [];
  if (settings?.ice) ids.push(`ICE: ${settings.ice}`);
  if (settings?.rc) ids.push(`RC: ${settings.rc}`);
  if (settings?.if_number) ids.push(`IF: ${settings.if_number}`);
  if (settings?.cnss) ids.push(`CNSS: ${settings.cnss}`);
  if (settings?.patente) ids.push(`Patente: ${settings.patente}`);
  if (ids.length) doc.text(ids.join('  ·  '), textX, hy, { maxWidth: contentWidth - 55 });

  // Payslip title (right side)
  doc.setFontSize(11);
  doc.setFont(font, 'bold');
  doc.text('BULLETIN DE PAIE', pageWidth - margin, 11, { align: 'right' });
  doc.setFontSize(8);
  doc.setFont(font, 'normal');
  doc.text(periodLabel, pageWidth - margin, 17, { align: 'right' });
  doc.text(payslip.payslip_number || '', pageWidth - margin, 22, { align: 'right' });

  y = bandH + 6;
  doc.setTextColor(...DARK);

  // ── Employee info block ──
  doc.setFillColor(...ACCENT_LIGHT);
  doc.rect(margin, y, contentWidth, 30, 'F');
  doc.setDrawColor(...ACCENT);
  doc.setLineWidth(0.4);
  doc.rect(margin, y, contentWidth, 30, 'S');

  const col1x = margin + 3;
  const col2x = margin + contentWidth / 2 + 3;
  let iy = y + 6;

  const infoField = (label: string, value: string, x: number, yPos: number) => {
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    doc.setFont(font, 'normal');
    doc.text(label, x, yPos);
    doc.setFontSize(8.5);
    doc.setTextColor(...DARK);
    doc.setFont(font, 'bold');
    doc.text(value || '—', x, yPos + 4.5);
  };

  infoField('Nom & Prénom', emp.full_name || '—', col1x, iy);
  infoField('Poste', emp.position || '—', col2x, iy);
  iy += 11;
  infoField('N° CNSS', emp.cnss_number || '—', col1x, iy);

  // Ancienneté years
  let ancienLabel = '—';
  if (emp.hire_date) {
    const years = Math.floor((Date.now() - new Date(emp.hire_date).getTime()) / (365.25 * 24 * 3600 * 1000));
    ancienLabel = `${years} an${years > 1 ? 's' : ''} (${Math.round(payslip.anciennete_rate * 100)}%)`;
  }
  infoField('Ancienneté', ancienLabel, col2x, iy);
  iy += 11;
  infoField('Heures travaillées', `${payslip.hours_worked || 191} h`, col1x, iy);
  infoField('Contrat', emp.contract_type || 'CDI', col2x, iy);

  y += 34;
  doc.setTextColor(...DARK);

  // ── Earnings table ──
  y += 4;
  const earningItems = (payslip.items || []).filter((i: any) => i.item_type === 'earning');

  const earningsBody: any[] = [
    ['Salaire de base', '', PdfExportService.formatCurrency(payslip.base_salary)],
  ];
  if (payslip.anciennete_amount > 0) {
    earningsBody.push([
      `Prime d'ancienneté (${Math.round(payslip.anciennete_rate * 100)}%)`,
      '',
      PdfExportService.formatCurrency(payslip.anciennete_amount),
    ]);
  }
  earningItems.forEach((item: any) => {
    earningsBody.push([item.label, '', PdfExportService.formatCurrency(item.amount)]);
  });
  earningsBody.push([{ content: 'SALAIRE BRUT', styles: { fontStyle: 'bold' } }, '', { content: PdfExportService.formatCurrency(payslip.total_gross), styles: { fontStyle: 'bold' } }]);

  autoTable(doc, {
    startY: y,
    head: [['Éléments de rémunération', 'Base', 'Montant (MAD)']],
    body: earningsBody,
    styles: { font, fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: ACCENT, textColor: WHITE, fontStyle: 'bold', fontSize: 8 },
    columnStyles: { 0: { cellWidth: contentWidth * 0.6 }, 1: { cellWidth: contentWidth * 0.2 }, 2: { cellWidth: contentWidth * 0.2, halign: 'right' } },
    margin: { left: margin, right: margin },
    willDrawCell: (data: any) => {
      if (data.section === 'body' && data.row.index === earningsBody.length - 1) {
        data.cell.styles.fillColor = ACCENT_LIGHT;
      }
    },
  });

  y = (doc as any).lastAutoTable.finalY + 4;

  // ── Deductions table ──
  const deductionItems = (payslip.items || []).filter((i: any) => i.item_type === 'deduction');

  const deductionsBody: any[] = [
    ['CNSS (4,48% plafonné)', '', PdfExportService.formatCurrency(payslip.cnss_employee)],
    ['AMO (2,26%)', '', PdfExportService.formatCurrency(payslip.amo_employee)],
    ['IR (barème progressif)', '', PdfExportService.formatCurrency(payslip.ir_amount)],
  ];
  if (payslip.cimr_employee > 0) {
    deductionsBody.push(['CIMR', '', PdfExportService.formatCurrency(payslip.cimr_employee)]);
  }
  deductionItems.forEach((item: any) => {
    deductionsBody.push([item.label, '', PdfExportService.formatCurrency(item.amount)]);
  });
  deductionsBody.push([{ content: 'TOTAL RETENUES', styles: { fontStyle: 'bold' } }, '', { content: PdfExportService.formatCurrency(payslip.total_deductions), styles: { fontStyle: 'bold' } }]);

  autoTable(doc, {
    startY: y,
    head: [['Retenues et cotisations', '', 'Montant (MAD)']],
    body: deductionsBody,
    styles: { font, fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [180, 50, 50], textColor: WHITE, fontStyle: 'bold', fontSize: 8 },
    columnStyles: { 0: { cellWidth: contentWidth * 0.6 }, 1: { cellWidth: contentWidth * 0.2 }, 2: { cellWidth: contentWidth * 0.2, halign: 'right' } },
    margin: { left: margin, right: margin },
    willDrawCell: (data: any) => {
      if (data.section === 'body' && data.row.index === deductionsBody.length - 1) {
        data.cell.styles.fillColor = [255, 230, 230];
      }
    },
  });

  y = (doc as any).lastAutoTable.finalY + 6;

  // ── Net salary box ──
  doc.setFillColor(...ACCENT);
  doc.roundedRect(margin, y, contentWidth, 16, 2, 2, 'F');
  doc.setTextColor(...WHITE);
  doc.setFont(font, 'bold');
  doc.setFontSize(10);
  doc.text('SALAIRE NET À PAYER :', margin + 4, y + 7);
  doc.setFontSize(13);
  doc.text(`${PdfExportService.formatCurrency(payslip.net_salary)} MAD`, pageWidth - margin - 4, y + 7, { align: 'right' });

  y += 20;
  doc.setTextColor(...DARK);
  doc.setFont(font, 'italic');
  doc.setFontSize(7.5);
  const netWords = numberToWordsFr(Math.round(payslip.net_salary));
  doc.text(`Arrêté à la somme de : ${netWords} Dirhams`, margin, y);

  y += 6;
  if (payslip.frais_pro > 0) {
    doc.setFont(font, 'normal');
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(
      `Frais professionnels (abattement fiscal, non retenu) : ${PdfExportService.formatCurrency(payslip.frais_pro)} MAD`,
      margin, y
    );
    y += 6;
  }
  doc.setTextColor(...DARK);

  // ── Employer cost note ──
  if (payslip.cnss_employer > 0 || payslip.amo_employer > 0 || payslip.alloc_familiales > 0) {
    doc.setFont(font, 'normal');
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    const total_employer = (payslip.cnss_employer || 0) + (payslip.amo_employer || 0) + (payslip.alloc_familiales || 0);
    doc.text(
      `Charges patronales (informatif) — CNSS: ${PdfExportService.formatCurrency(payslip.cnss_employer)} | AMO: ${PdfExportService.formatCurrency(payslip.amo_employer)} | Alloc. fam.: ${PdfExportService.formatCurrency(payslip.alloc_familiales)} | Total: ${PdfExportService.formatCurrency(total_employer)} MAD`,
      margin, y, { maxWidth: contentWidth }
    );
    y += 8;
  }

  // ── Signature line ──
  y = Math.max(y, 240);
  doc.setTextColor(...DARK);
  doc.setFont(font, 'normal');
  doc.setFontSize(8);
  doc.text(`Lu et approuvé — ${PdfExportService.formatDate(new Date())}`, margin, y);
  doc.text('Signature employé :', pageWidth - margin - 50, y);
  doc.setDrawColor(...GRAY);
  doc.setLineWidth(0.3);
  doc.line(pageWidth - margin - 50, y + 10, pageWidth - margin, y + 10);

  // Footer
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFontSize(7);
  doc.setTextColor(180, 180, 180);
  doc.text(companyName, margin, pageHeight - 5);
  doc.text(payslip.payslip_number || '', pageWidth - margin, pageHeight - 5, { align: 'right' });

  const filename = `PAIE-${(payslip.payslip_number || 'bulletin').replace(/[^a-zA-Z0-9_\-]/g, '_')}.pdf`;
  return { doc, filename };
}

export async function exportPayslipToPdf(payslip: any, settings: any): Promise<void> {
  const { doc, filename } = await buildPayslipPdf(payslip, settings);
  doc.save(filename);
}

export async function generatePayslipPdfBlob(payslip: any, settings: any): Promise<{ blob: Blob; filename: string }> {
  const { doc, filename } = await buildPayslipPdf(payslip, settings);
  const blob = doc.output('blob');
  return { blob, filename };
}
