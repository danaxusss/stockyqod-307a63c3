import { describe, expect, it } from 'vitest';
import { PdfExportService } from '../utils/pdfExport';
import type { Quote } from '../types';

const docOf = (id: string, type: 'invoice' | 'avoir', total: number, extra: Partial<Quote> = {}) => ({
  id, quoteNumber: id.toUpperCase(), document_type: type, totalAmount: total, createdAt: new Date('2026-11-05'), quote_date: '05/11/2026',
  avance_amount: 0, payment_methods_json: [], items: [], customer: { fullName: 'Ali' }, ...extra,
}) as unknown as Quote;

describe('client statement PDF', () => {
  it('shows credit notes as negative lines and a total net of them', async () => {
    const text = (await PdfExportService.buildClientFinancialPdf('Ali', [
      docOf('fa-1', 'invoice', 1200, { payment_methods_json: [{ method: 'Espèces', amount: 200 }] } as never),
      docOf('av-1', 'avoir', 300),
    ], 20, null)).output();
    expect(text).toContain('AV-1');
    expect(text).toContain('Avoir');
    expect(text).toMatch(/-300[,.]00/);
    // 1 200 − 300 = 900 owed in total, 200 paid: 700 left.
    expect(text).toMatch(/900[,.]00/);
    expect(text).toMatch(/700[,.]00/);
  });

  it('says when the client is in credit', async () => {
    const text = (await PdfExportService.buildClientFinancialPdf('Ali', [docOf('fa-2', 'invoice', 100, { payment_methods_json: [{ method: 'Espèces', amount: 100 }] } as never), docOf('av-2', 'avoir', 50)], 20, null)).output();
    expect(text).toMatch(/\(Cr.dit\) Tj/); // "Crédit" on the total row
  });
});
