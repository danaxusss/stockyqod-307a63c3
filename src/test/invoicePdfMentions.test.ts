import { describe, expect, it } from 'vitest';
import { PdfExportService } from '../utils/pdfExport';
import type { CompanySettings } from '../utils/companySettings';
import type { Quote } from '../types';

// The mandatory mentions of an invoice and a credit note (CGI art. 145-III),
// read back from the built PDF. Text is drawn piece by piece ("(...) Tj"),
// octal-escaped and wrapped: the pieces are decoded and joined with spaces,
// and spaces are collapsed before matching.
function pdfText(output: string): string {
  const pieces: string[] = [];
  for (const m of output.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
    pieces.push(m[1]
      .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
      .replace(/\\(.)/g, '$1'));
  }
  return pieces.join(' ').replace(/\s+/g, ' ');
}

const settings = (extra: Partial<CompanySettings> = {}) => ({
  company_name: 'Cuisimat SARL', address: 'Bd Brahim Roudani, Casablanca', phone: '0520180645',
  ice: '000061298000065', if_number: '40445099', patente: '35874257', rc: '299179', cnss: '8955504',
  tva_rate: 10, payment_terms: '', payment_terms_days: 60, vat_exemption_text: '', quote_validity_days: 30,
  // Every option that could hide a mention is switched off.
  quote_visible_fields: {
    showLogo: false, showCompanyAddress: true, showCompanyPhone: true, showCompanyEmail: true, showCompanyWebsite: false,
    showCompanyICE: false, showClientICE: false, showTVA: false, showTVABreakdown: false, showNotes: true,
    showPaymentTerms: false, showValidityDate: true,
    printColumns: { showImage: false, showBrand: true, showBarcode: true, showUnitPrice: true, showDiscount: true },
  },
  ...extra,
}) as unknown as CompanySettings;

const doc = (type: Quote['document_type'], extra: Partial<Quote> = {}): Quote => ({
  id: 'd1', quoteNumber: 'CM2611-3', createdAt: new Date('2026-11-05T10:00:00'), updatedAt: new Date('2026-11-05T10:00:00'),
  status: 'final', quote_date: '2026-11-05', document_type: type, totalAmount: 1200, tva_rate: 20, due_date: '2027-01-04',
  customer: { fullName: 'Hôtel Atlas', phoneNumber: '0661234510', address: '12 rue de Fès', city: 'Rabat', salesPerson: '', ice: '001234567000089' },
  items: [{ id: 'a', quantity: 2, unitPrice: 600, subtotal: 1200, quoteName: 'Four mixte', quoteBrand: 'Rational', quoteBarcode: 'R-1', addedAt: new Date(), product: null as never, priceType: 'normal', marginPercentage: 0, finalPrice: 600 }],
  payment_method: 'Virement bancaire', payment_reference: 'VIR-889',
  ...extra,
});

const build = async (type: Quote['document_type'], extra: Partial<Quote> = {}, s = settings()) => {
  const { doc: pdf } = await PdfExportService.buildQuotePdf(doc(type, extra), s, undefined, undefined, false, type, undefined, true);
  return pdfText(pdf.output());
};

describe('invoice PDF', () => {
  it('carries every mandatory mention whatever the print options', async () => {
    const text = await build('invoice');
    // Seller identifiers (ICE although "ICE de l'entreprise" is off).
    for (const id of ['ICE N° 000061298000065', 'IF N° 40445099', 'TP N° 35874257', 'RC N° 299179', 'CNSS N° 8955504']) expect(text).toContain(id);
    // Buyer name, address and ICE (although "ICE du client" is off).
    expect(text).toContain('Hôtel Atlas');
    expect(text).toContain('12 rue de Fès');
    expect(text).toContain('001234567000089');
    // HT, VAT at the invoice's own rate (20 %, the company is at 10 % now), TTC.
    expect(text).toContain('TOTAL HT');
    expect(text).toContain('1 000,00 Dh');
    expect(text).toContain('TVA 20%');
    expect(text).not.toContain('TVA 10%');
    expect(text).toContain('200,00 Dh');
    expect(text).toContain('TOTAL TTC');
    // Lines priced HT, not TTC-only.
    expect(text).toContain('PU HT');
    expect(text).not.toContain('PU TTC');
    // Payment mode and reference, terms and due date (loi 69-21).
    expect(text).toContain('Virement bancaire');
    expect(text).toContain('VIR-889');
    expect(text).toContain('Conditions de règlement : 60 jours à compter de la date de facture · Échéance : 04/01/2027');
    // Amount in words, French agreement.
    expect(text).toContain('MILLE DEUX CENTS DIRHAMS TTC');
    // No quote disclaimer.
    expect(text).not.toMatch(/peuvent légèrement évoluer/);
  });

  it('states the exemption instead of a 0 % VAT line', async () => {
    const text = await build('invoice', { tva_rate: 0 }, settings({ vat_exemption_text: 'Article 92-I-1° du CGI' }));
    expect(text).toContain('Exonéré de TVA - Article 92-I-1° du CGI');
    expect(text).not.toContain('TVA 0%');
    expect(text).toContain('TOTAL HT');
  });

  it('uses the company rate only for invoices from before rates were stored', async () => {
    const text = await build('invoice', { tva_rate: undefined });
    expect(text).toContain('TVA 10%');
  });
});

describe('credit note PDF', () => {
  it('names the invoice it corrects and keeps the mandatory mentions', async () => {
    const text = await build('avoir', { quoteNumber: 'AV-0004', source_invoice: { quoteNumber: 'CM2611-3', day: '2026-11-05' } });
    expect(text).toContain('Avoir sur facture N° CM2611-3 du 05/11/2026');
    expect(text).toContain('ICE N° 000061298000065');
    expect(text).toContain('001234567000089');
    expect(text).toContain('TVA 20%');
    expect(text).toContain('Arrêté le présent avoir à la somme de :');
    expect(text).not.toMatch(/peuvent légèrement évoluer/);
  });
});

describe('other documents keep their print options', () => {
  it('a quote can still print TTC only, hide the ICEs, and carries the disclaimer', async () => {
    const text = await build('quote');
    expect(text).toContain('PU TTC');
    expect(text).not.toContain('TVA 20%');
    expect(text).not.toContain('ICE N° 000061298000065');
    expect(text).not.toContain('001234567000089');
    expect(text).toMatch(/peuvent légèrement évoluer/);
    expect(text).not.toContain('Échéance');
  });

  it('a delivery note carries no disclaimer', async () => {
    expect(await build('bl')).not.toMatch(/peuvent légèrement évoluer/);
  });
});
