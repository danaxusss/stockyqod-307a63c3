import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TechnicalSheetsPage from '../pages/TechnicalSheetsPage';
import { matchSheetFiles, matchedSheetTitle } from '../utils/sheetBatch';

const product = (barcode: string, name: string, brand = 'Bosch') => ({
  barcode, name, brand, provider: '', price: 0, buyprice: 0, reseller_price: 0, image: null, techsheet: '', stock_levels: {},
});

const PRODUCTS = [product('GSB13', 'Perceuse GSB 13'), product('GSB16', 'Perceuse GSB 16'), product('mx-1', 'Mixeur MX', 'Robot')];

const db = vi.hoisted(() => ({ inserts: [] as { table: string; rows: unknown }[], uploads: [] as string[] }));
const showToast = vi.hoisted(() => vi.fn());
const appState = vi.hoisted(() => ({ products: [] as unknown[] }));

vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock('../context/AppContext', () => ({ useAppContext: () => ({ state: appState }) }));
vi.mock('@/integrations/supabase/client', () => {
  const query = (table: string) => {
    const chain: Record<string, unknown> = {};
    const result = { data: [], error: null };
    for (const method of ['select', 'order', 'eq', 'in', 'delete']) chain[method] = () => chain;
    chain.then = (resolve: (value: unknown) => void) => resolve(result);
    chain.insert = (rows: unknown) => { db.inserts.push({ table, rows }); return Promise.resolve({ error: null }); };
    return chain;
  };
  return {
    supabase: {
      from: query,
      storage: {
        from: () => ({
          upload: (path: string) => { db.uploads.push(path); return Promise.resolve({ error: null }); },
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.test/${path}` } }),
          remove: () => Promise.resolve({ error: null }),
        }),
      },
    },
  };
});

const pdf = (name: string) => new File(['%PDF'], name, { type: 'application/pdf' });

afterEach(() => { vi.clearAllMocks(); db.inserts = []; db.uploads = []; });

describe('bulk sheet matching', () => {
  it('matches file names to product codes like the image import', () => {
    const matches = matchSheetFiles([pdf('GSB13.pdf'), pdf('MX-1.pdf'), pdf('GSB13+GSB16.pdf'), pdf('GSB13+NOPE.pdf'), pdf('Catalogue Bosch.pdf')], PRODUCTS);
    expect(matches.map(match => match.products.map(p => p.barcode))).toEqual([['GSB13'], ['mx-1'], ['GSB13', 'GSB16'], [], []]);
  });

  it('does not guess when a code differs only by case between two products', () => {
    expect(matchSheetFiles([pdf('ab1.pdf')], [product('AB1', 'A'), product('Ab1', 'B')])[0].products).toEqual([]);
    expect(matchSheetFiles([pdf('AB1.pdf')], [product('AB1', 'A'), product('Ab1', 'B')])[0].products.map(p => p.name)).toEqual(['A']);
  });

  it('titles a matched sheet with its products', () => {
    expect(matchedSheetTitle([{ name: 'Perceuse GSB 13' }, { name: 'Perceuse GSB 16' }], 'x')).toBe('Perceuse GSB 13 / Perceuse GSB 16');
    expect(matchedSheetTitle([], 'Catalogue')).toBe('Catalogue');
  });
});

describe('TechnicalSheetsPage bulk import', () => {
  async function chooseFiles(files: File[]) {
    appState.products = PRODUCTS;
    render(<MemoryRouter><TechnicalSheetsPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /Import en masse/ }));
    const input = document.querySelector('input[type="file"][multiple]') as HTMLInputElement;
    fireEvent.change(input, { target: { files } });
  }

  it('links files named after product codes and imports the others unlinked', async () => {
    await chooseFiles([pdf('GSB13.pdf'), pdf('GSB13+GSB16.pdf'), pdf('Catalogue.pdf')]);
    expect(screen.getByText(/2 fichier\(s\) reconnu\(s\), 1 importé\(s\) sans lien/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Importer 3 fichier/ }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', message: '3 fichier(s) importé(s), 3 lien(s) produit créé(s)' })));
    const sheets = db.inserts.filter(insert => insert.table === 'technical_sheets').map(insert => insert.rows as { id: string; title: string; manufacturer: string });
    expect(sheets.map(sheet => sheet.title)).toEqual(['Perceuse GSB 13', 'Perceuse GSB 13 / Perceuse GSB 16', 'Catalogue']);
    expect(sheets[0].manufacturer).toBe('Bosch');
    const links = db.inserts.filter(insert => insert.table === 'technical_sheet_products').map(insert => insert.rows);
    expect(links).toEqual([
      [{ sheet_id: sheets[0].id, product_barcode: 'GSB13' }],
      [{ sheet_id: sheets[1].id, product_barcode: 'GSB13' }, { sheet_id: sheets[1].id, product_barcode: 'GSB16' }],
    ]);
  });

  it('can import without linking', async () => {
    await chooseFiles([pdf('GSB13.pdf')]);
    fireEvent.click(screen.getByLabelText('Lier aux produits dont le code est le nom du fichier'));
    fireEvent.click(screen.getByRole('button', { name: /Importer 1 fichier/ }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ message: '1 fichier(s) importé(s)' })));
    expect(db.inserts.filter(insert => insert.table === 'technical_sheet_products')).toEqual([]);
    expect((db.inserts[0].rows as { title: string }).title).toBe('GSB13');
  });
});
