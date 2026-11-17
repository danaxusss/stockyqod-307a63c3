import { describe, expect, it } from 'vitest';
import type { QuoteItem } from '../types';
import { buildSupplierPurchasePdf, groupBySupplier, NO_SUPPLIER, supplierOf, toOrder } from '../utils/supplierPurchasePdf';

const line = (barcode: string, provider: string, quantity: number, buyprice: number, stock: Record<string, number> = {}, extra: Partial<QuoteItem> = {}): QuoteItem => ({
  id: barcode,
  product: { barcode, name: `Produit ${barcode}`, brand: 'B', techsheet: '', price: buyprice * 1.5, buyprice, reseller_price: 0, provider, stock_levels: stock },
  priceType: 'normal', marginPercentage: 0, finalPrice: buyprice * 1.5, unitPrice: buyprice * 1.5,
  quantity, subtotal: buyprice * 1.5 * quantity, addedAt: new Date(), ...extra,
});

describe('purchasing sheet by supplier', () => {
  it('groups lines by supplier, A to Z, with the unknown supplier last and quote order kept', () => {
    const groups = groupBySupplier([
      line('A1', 'RESTOQUIP', 2, 100),
      line('B1', '', 1, 50),
      line('C1', 'Cuisimat', 1, 300),
      line('A2', 'RESTOQUIP', 3, 10),
    ]);
    expect(groups.map(group => group.supplier)).toEqual(['Cuisimat', 'RESTOQUIP', NO_SUPPLIER]);
    expect(groups[1].items.map(item => item.product.barcode)).toEqual(['A1', 'A2']);
    expect(groups[1].purchaseTotal).toBe(230);
    expect(groups[1].units).toBe(5);
  });

  it('uses the supplier chosen for an off-catalogue line, and "Manuel" means none', () => {
    expect(supplierOf(line('X', 'Manuel', 1, 10, {}, { provider_name: 'POLY CUISINE' }))).toBe('POLY CUISINE');
    expect(supplierOf(line('Y', 'Manuel', 1, 10))).toBe(NO_SUPPLIER);
  });

  it('counts what is left to order after the stock on hand', () => {
    expect(toOrder(line('A', 'S', 5, 10, { DEPOT: 2, CUISISHOP: 1 }))).toBe(2);
    expect(toOrder(line('B', 'S', 2, 10, { DEPOT: 7 }))).toBe(0);
    expect(toOrder(line('C', 'S', 3, 10, { DEPOT: -4 }))).toBe(3);
  });

  it('builds a PDF with one section per supplier', () => {
    const doc = buildSupplierPurchasePdf(
      [line('A1', 'RESTOQUIP', 2, 1234.5, { DEPOT: 1 }), line('C1', 'Cuisimat', 1, 300)],
      { quoteNumber: 'QT-1', clientName: 'Hôtel Atlas', sellerName: 'Ali', quoteDate: '2026-11-17' },
      null,
    );
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    const text = doc.output();
    expect(text).toContain('RESTOQUIP');
    expect(text).toContain('Cuisimat');
    expect(text).toContain('2 469,00 Dh');
  });
});
