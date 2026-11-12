import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, fakeClient, type FakeDb } from './fakeSupabase';

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock('../utils/supabaseClient', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../integrations/supabase/client', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../utils/supabaseCompanyFilter', () => ({
  getCompanyContext: () => ({ companyId: 'c1', bypassFilter: true, isSuperAdmin: true, isCompta: false }),
}));

import { BackupService } from '../utils/backupService';
import { buildCsv } from '../utils/csvExport';
import { importDocuments, parseCSVFile, type ParsedDocument } from '../utils/csvImport';
import { parseLocaleNumber } from '../utils/localeNumber';
import { excelCellValue } from '../utils/converter';
import { ProductUploadService } from '../utils/productUploadService';

beforeEach(() => {
  state.db = createFakeDb({});
});

const products = (n: number) => Array.from({ length: n }, (_, i) => ({
  barcode: `P${String(i).padStart(5, '0')}`, name: `Produit ${i}`, brand: 'B', provider: 'F', image: null,
  kiosk_category: null, techsheet: '', price: 10, buyprice: 5, reseller_price: 8, stock_levels: { A: 5 },
}));

describe('full backup', () => {
  it('keeps every business table, not only quotes, products and clients', async () => {
    const data = await BackupService.export();
    for (const table of ['returns', 'stock_movements', 'stock_locations', 'providers', 'purchase_orders', 'journal_entries',
      'journal_entry_lines', 'employees', 'payslips', 'tasks', 'product_photos', 'product_stock_settings']) {
      expect(Object.keys(data.tables)).toContain(table);
    }
  });

  it('reads every product past the 1,000-row cap, each once, even when the server order changes', async () => {
    state.db.tables.products = products(1500);
    state.db.maxRows = 1000;
    state.db.unstableOrder = true;
    const data = await BackupService.export();
    const codes = (data.tables.products as { barcode: string }[]).map(p => p.barcode);
    expect(codes).toHaveLength(1500);
    expect(new Set(codes).size).toBe(1500);
  });

  it('says which tables could not be read instead of saving them as empty', async () => {
    state.db.tables.quotes = [{ id: 'q1' }];
    state.db.failRead = table => (table === 'quotes' ? 'permission denied' : undefined);
    const data = await BackupService.export();
    expect(data.failed_tables).toContain('quotes');
  });

  it('restores document counters by their own key, and a second restore does not duplicate them', async () => {
    state.db.strictUpsert = true;
    const backup = { version: '1.0', created_at: '2026-11-01', tables: { document_counters: [{ company_id: 'c1', document_type: 'invoice', last_number: 12 }] } };
    const first = await BackupService.restore(backup);
    await BackupService.restore(backup);
    expect(first.document_counters).toEqual({ upserted: 1, errors: 0 });
    expect(state.db.tables.document_counters).toHaveLength(1);
  });

  it('restores the returns of a yearly archive', async () => {
    const archive = { version: '1.0', created_at: '2026-11-01', archive_year: 2025, tables: { quotes: [{ id: 'q1' }], returns: [{ id: 'r1' }] } };
    await BackupService.restore(archive);
    expect(state.db.tables.returns).toEqual([{ id: 'r1' }]);
  });

  it('a full reset clears the numbering counters, which have no id column', async () => {
    state.db.tables.document_counters = [{ company_id: 'c1', document_type: 'invoice', last_number: 12 }];
    await BackupService.resetAllData(null, true);
    expect(state.db.tables.document_counters).toHaveLength(0);
  });
});

describe('yearly archive', () => {
  const docs = (n: number) => Array.from({ length: n }, (_, i) => ({
    id: `q${String(i).padStart(5, '0')}`, company_id: 'c1', created_at: `2025-06-01T10:00:${String(i % 60).padStart(2, '0')}Z`,
  }));

  it('archives every document of the year past the 1,000-row cap (they are deleted afterwards)', async () => {
    state.db.tables.quotes = docs(1500);
    state.db.tables.returns = [];
    state.db.maxRows = 1000;
    const archive = await BackupService.exportDocumentsByYear(2025, 'c1', false);
    expect(archive.tables.quotes).toHaveLength(1500);
  });

  it('fails when the returns cannot be read, so they are not deleted without a copy', async () => {
    state.db.tables.quotes = docs(3);
    state.db.tables.returns = [{ id: 'r1', company_id: 'c1', created_at: '2025-03-01T10:00:00Z' }];
    state.db.failRead = table => (table === 'returns' ? 'timeout' : undefined);
    await expect(BackupService.exportDocumentsByYear(2025, 'c1', false)).rejects.toThrow();
  });
});

describe('CSV export', () => {
  const lines = (csv: string) => csv.replace(/^\uFEFF/, '').split('\r\n');

  it('uses semicolons and decimal commas, as Excel in French expects', () => {
    const [header, row] = lines(buildCsv([{ Client: 'Café Le Central', 'Total TTC': 25683.6 }]));
    expect(header).toBe('Client;Total TTC');
    expect(row).toBe('Café Le Central;25683,6');
  });

  it('keeps the leading zero of phone numbers and the digits of long codes', () => {
    const [, row] = lines(buildCsv([{ Tel: '0661234510', ICE: '001234567000089' }]));
    expect(row).toBe('"=""0661234510""";"=""001234567000089"""');
  });

  it('does not let a cell start a formula', () => {
    const [, row] = lines(buildCsv([{ Client: '=HYPERLINK("http://x")', Note: '+212 6', Montant: -12.5 }]));
    expect(row.split(';')[0]).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(row.split(';')[1]).toBe("'+212 6");
    expect(row.split(';')[2]).toBe('-12,5');
  });

  it('starts with a BOM so accents open correctly', () => {
    expect(buildCsv([{ Ville: 'Fès' }]).startsWith('\uFEFF')).toBe(true);
  });
});

describe('CSV import', () => {
  it('reads a file saved by Excel in French: semicolons and decimal commas', () => {
    const csv = '\uFEFFnumero;client_nom;designation;quantite;prix_unitaire_ht;remise_pct\r\nDEV-1;Ahmed;Produit A;2;100,50;0\r\n';
    const { rows } = parseCSVFile(csv, 'quote') as { rows: ParsedDocument[] };
    expect(rows).toHaveLength(1);
    expect(rows[0].items[0]).toMatchObject({ designation: 'Produit A', quantity: 2, unitPrice: 100.5 });
  });

  it('keeps a quoted note that spans several lines', () => {
    const csv = 'numero,designation,notes\nDEV-1,Produit A,"ligne 1\nligne 2"\nDEV-1,Produit B,\n';
    const { rows } = parseCSVFile(csv, 'quote') as { rows: ParsedDocument[] };
    expect(rows[0].notes).toBe('ligne 1\nligne 2');
    expect(rows[0].items.map(i => i.designation)).toEqual(['Produit A', 'Produit B']);
  });

  it('creates lines the quote, PDF and invoice pages can open (product, TTC unit price)', async () => {
    state.db.tables.quotes = [];
    const doc: ParsedDocument = {
      numero: 'DEV-1', clientCode: '', clientName: 'Ahmed', clientPhone: '', clientCity: '', clientIce: '', notes: '', status: 'draft',
      items: [{ designation: 'Produit A', quantity: 2, unitPrice: 100, discount: 0 }],
    };
    const result = await importDocuments([doc], 'quote', 20);
    expect(result.errors).toEqual([]);
    const item = state.db.tables.quotes[0].items[0];
    expect(item.product.name).toBe('Produit A');
    expect(item.unitPrice).toBe(120);
    expect(item.subtotal).toBe(240);
    expect(state.db.tables.quotes[0].total_amount).toBe(240);
  });
});

describe('numbers typed as text', () => {
  it.each([
    ['1234,50', 1234.5], ['1 234,50 Dh', 1234.5], ['1\u202f234,5', 1234.5], ['1,234.50', 1234.5],
    ['1.234,50', 1234.5], ['12', 12], ['-3,5', -3.5], ['1,234', 1234], ['0,75', 0.75], ['0,750', 0.75],
  ])('%s → %s', (text, value) => {
    expect(parseLocaleNumber(text)).toBe(value);
  });

  it('is empty for text that is not a number', () => {
    expect(parseLocaleNumber('abc')).toBeNull();
    expect(parseLocaleNumber('')).toBeNull();
  });
});

describe('converter Excel cells', () => {
  it('keeps codes and phone numbers as text, and turns amounts into numbers', () => {
    expect(excelCellValue('0661234510')).toBe('0661234510');
    expect(excelCellValue('6110000000001')).toBe('6110000000001');
    expect(excelCellValue('1 234,50')).toBe(1234.5);
    expect(excelCellValue('12')).toBe(12);
    expect(excelCellValue('-3.5')).toBe(-3.5);
    expect(excelCellValue('Four mixte')).toBe('Four mixte');
  });
});

describe('product Excel import', () => {
  it('never resets the stock of an existing product, past the 1,000-row cap and with a changing server order', async () => {
    state.db.tables.products = products(1500);
    state.db.tables.product_name_overrides = [];
    state.db.tables.stock_movements = [];
    state.db.maxRows = 1000;
    state.db.unstableOrder = true;
    state.db.strictUpsert = true;
    const incoming = { ...products(1500)[1200], stock_levels: { A: 0 } };
    await ProductUploadService.uploadProducts([incoming]);
    const saved = state.db.tables.products.filter(p => p.barcode === incoming.barcode);
    expect(saved).toHaveLength(1);
    expect(saved[0].stock_levels).toEqual({ A: 5 });
    expect(state.db.tables.stock_movements).toHaveLength(0);
  });

  it('a code repeated in the file does not make its whole batch fail', async () => {
    state.db.tables.products = [];
    state.db.tables.product_name_overrides = [];
    state.db.tables.stock_movements = [];
    state.db.strictUpsert = true;
    const [a, b] = products(2);
    await ProductUploadService.uploadProducts([a, b, { ...a, price: 12 }]);
    expect(state.db.tables.products.map(p => p.barcode).sort()).toEqual([a.barcode, b.barcode]);
  });
});
