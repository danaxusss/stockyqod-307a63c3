import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StockVoucherPage from '../pages/inventaire/StockVoucherPage';
import StockVouchersPage from '../pages/inventaire/StockVouchersPage';
import { StockService } from '../utils/supabaseStock';
import {
  costUpdatesAverage, draftProblems, isNegativeStockRefusal, reasonLabel, reasonsFor, StockVouchersService, voucherErrorMessage,
  type StockVoucher,
} from '../utils/stockVouchers';
import { buildStockVoucherPdf } from '../utils/stockVoucherPdf';

const locations = vi.hoisted(() => [{ id: 'loc-1', name: 'Dépôt', abbreviation: 'DEP' }, { id: 'loc-2', name: 'Showroom', abbreviation: 'SHOW' }]);
const auth = vi.hoisted(() => ({ isAdmin: false }));

vi.mock('../utils/stockVouchers', async importOriginal => {
  const real = await importOriginal<typeof import('../utils/stockVouchers')>();
  return {
    ...real,
    StockVouchersService: { list: vi.fn(), get: vi.fn(), saveDraft: vi.fn(), deleteDraft: vi.fn(), validate: vi.fn(), cancel: vi.fn() },
  };
});
vi.mock('../utils/supabaseStock', () => ({ StockService: { getProducts: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('../utils/supabaseClient', () => ({ supabase: {} }));
vi.mock('../inventory/hooks/useAccessibleLocations', () => ({
  useAccessibleLocations: () => ({ accessibleLocations: locations, locations, loading: false }),
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ currentUser: { username: 'magasin' }, isAdmin: auth.isAdmin }) }));
const showToast = vi.hoisted(() => vi.fn());
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast }) }));
const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async importOriginal => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useNavigate: () => navigate }));

const service = vi.mocked(StockVouchersService);
const products = vi.mocked(StockService.getProducts);
const product = (barcode: string, name: string, stock: number) =>
  ({ barcode, name, brand: 'ATA', price: 0, buyprice: 0, reseller_price: 0, provider: '', image: null, stock_levels: { DEP: stock } }) as never;

const voucher = (over: Partial<StockVoucher> = {}): StockVoucher => ({
  id: 'v1', company_id: 'c1', kind: 'sortie', number: 'BS-2026-0001', status: 'validated', voucher_date: '2026-11-19',
  location_id: 'loc-1', reason: 'casse_perte', note: 'Palette tombée', created_by: 'magasin', validated_by: 'magasin',
  validated_at: '2026-11-19T10:00:00Z', negative_override: false, cancelled_by: null, cancelled_at: null, cancel_reason: null,
  created_at: '2026-11-19T09:00:00Z', lines: [{ barcode: 'P1', product_name: 'Four', quantity: 2, unit_cost: null }], ...over,
});

const renderAt = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/inventaire/bons" element={<StockVouchersPage />} />
      <Route path="/inventaire/bons/:id" element={<StockVoucherPage />} />
    </Routes>
  </MemoryRouter>,
);

afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); auth.isAdmin = false; });

describe('voucher rules', () => {
  it('names reasons, says when the cost moves the average price, and lists what is missing', () => {
    expect(reasonLabel('sortie', 'casse_perte')).toBe('Casse / perte');
    expect(reasonLabel('entree', 'reception_sans_commande')).toBe('Réception sans commande');
    expect(costUpdatesAverage('entree', 'reception_sans_commande')).toBe(true);
    expect(costUpdatesAverage('entree', 'stock_initial')).toBe(false);
    expect(costUpdatesAverage('sortie', 'reception_sans_commande')).toBe(false);
    expect(draftProblems({ location_id: null, reason: 'autre', lines: [] })).toEqual(['Choisissez un emplacement.', 'Ajoutez au moins un article.']);
    expect(draftProblems({ location_id: 'l', reason: 'autre', lines: [{ barcode: 'a', product_name: 'a', quantity: 0, unit_cost: -1 }] }))
      .toEqual(['Chaque quantité doit être supérieure à 0.', 'Un coût unitaire ne peut pas être négatif.']);
    expect(voucherErrorMessage({ message: 'ERROR: P0001: Stock insuffisant pour Four' })).toBe('Stock insuffisant pour Four');
    expect(isNegativeStockRefusal(new Error('Stock insuffisant pour Four (1 disponible)'))).toBe(true);
    expect(isNegativeStockRefusal(new Error('Bon introuvable'))).toBe(false);
    expect(reasonsFor('sortie', true).map(r => r.value)).toEqual(['livraison_client']);
    expect(reasonsFor('sortie', false).map(r => r.value)).not.toContain('livraison_client');
    expect(reasonLabel('sortie', 'livraison_client')).toBe('Livraison client');
  });

  it('prints a voucher with its number, lines and totals', () => {
    const doc = buildStockVoucherPdf(voucher({ kind: 'entree', reason: 'reception_sans_commande', number: 'BE-2026-0007', lines: [
      { barcode: 'P1', product_name: 'Four mixte', quantity: 2, unit_cost: 1500 },
      { barcode: 'P2', product_name: 'Plat inox', quantity: 3, unit_cost: null },
    ] }), { locationName: 'Dépôt', settings: { company_name: 'Cuisimat' } as never });
    const text = doc.output();
    for (const s of ['BE-2026-0007', 'Four mixte', 'Plat inox', 'Cuisimat', '3 000,00 Dh']) expect(text).toContain(s);
  });
});

describe('voucher pages', () => {
  it('creates a Bon de sortie: saves the draft, then validates it', async () => {
    products.mockResolvedValue([product('P1', 'Four mixte', 5)]);
    service.saveDraft.mockResolvedValue('new-id');
    service.validate.mockResolvedValue({ number: 'BS-2026-0002', movements: 1, negative_override: false });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderAt('/inventaire/bons/nouveau?type=sortie');

    fireEvent.change(await screen.findByRole('textbox', { name: /Ajouter un article/ }), { target: { value: 'four' } });
    fireEvent.click(await screen.findByText('Four mixte'));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Quantité Four mixte' }), { target: { value: '3' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Motif' }), { target: { value: 'usage_interne' } });
    fireEvent.click(screen.getAllByRole('button', { name: /Valider/ })[0]);

    await waitFor(() => expect(service.validate).toHaveBeenCalledWith('new-id'));
    expect(service.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'sortie', reason: 'usage_interne', location_id: 'loc-1', created_by: 'magasin',
      lines: [{ barcode: 'P1', product_name: 'Four mixte', quantity: 3, unit_cost: null }],
    }));
    expect(navigate).toHaveBeenCalledWith('/inventaire/bons/new-id', { replace: true });
  });

  it('warns when a sortie exceeds the stock, and lets only an admin push it through', async () => {
    products.mockResolvedValue([product('P1', 'Four mixte', 1)]);
    service.get.mockResolvedValue(voucher({ status: 'draft', number: null, lines: [{ barcode: 'P1', product_name: 'Four mixte', quantity: 4, unit_cost: null }] }));
    service.saveDraft.mockResolvedValue('v1');
    service.validate.mockRejectedValueOnce(new Error('Stock insuffisant pour Four mixte (1 disponible à Dépôt, 4 demandé).'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    auth.isAdmin = false;
    const { unmount } = renderAt('/inventaire/bons/v1');
    expect(await screen.findByRole('alert')).toHaveTextContent('dépasse le stock de Dépôt');
    fireEvent.click(screen.getAllByRole('button', { name: /Valider/ })[0]);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Validation refusée' })));
    expect(service.validate).toHaveBeenCalledTimes(1);
    unmount();

    auth.isAdmin = true;
    service.validate.mockReset();
    service.validate.mockRejectedValueOnce(new Error('Stock insuffisant pour Four mixte'))
      .mockResolvedValueOnce({ number: 'BS-2026-0003', movements: 1, negative_override: true });
    renderAt('/inventaire/bons/v1');
    fireEvent.click((await screen.findAllByRole('button', { name: /Valider/ }))[0]);
    await waitFor(() => expect(service.validate).toHaveBeenLastCalledWith('v1', true));
    expect(service.validate).toHaveBeenNthCalledWith(1, 'v1');
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'BS-2026-0003 validé', type: 'warning' })));
  });

  it('shows a validated voucher read-only, with PDF and cancellation', async () => {
    products.mockResolvedValue([product('P1', 'Four', 5)]);
    service.get.mockResolvedValue(voucher());
    service.cancel.mockResolvedValue({ reversed: 1 });
    vi.spyOn(window, 'prompt').mockReturnValue('erreur de saisie');
    renderAt('/inventaire/bons/v1');

    expect(await screen.findByText(/Bon de sortie BS-2026-0001/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Enregistrer le brouillon/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Ajouter un article/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /PDF/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Annuler le bon/ }));
    await waitFor(() => expect(service.cancel).toHaveBeenCalledWith('v1', 'erreur de saisie'));
  });

  it('shows the delivery note a Bon de sortie comes from, and where each line leaves from', async () => {
    products.mockResolvedValue([product('P1', 'Four mixte', 5)]);
    service.get.mockResolvedValue(voucher({
      status: 'draft', number: null, reason: 'livraison_client', source_document_id: 'bl-1', source_document_number: 'BL-0042',
      lines: [
        { barcode: 'P1', product_name: 'Four mixte', quantity: 2, unit_cost: null, location_id: 'loc-1' },
        { barcode: 'P1', product_name: 'Four mixte', quantity: 1, unit_cost: null, location_id: 'loc-2' },
      ],
    }));
    service.saveDraft.mockResolvedValue('v1');
    renderAt('/inventaire/bons/v1');
    expect(await screen.findByRole('link', { name: 'Livraison BL-0042' })).toHaveAttribute('href', '/compta/bls/bl-1');
    expect(screen.getByText('Showroom', { selector: 'span' })).toBeInTheDocument();
    expect(within(screen.getByRole('combobox', { name: 'Motif' })).getAllByRole('option').map(o => o.textContent)).toEqual(['Livraison client']);
    fireEvent.click(screen.getAllByRole('button', { name: /Enregistrer le brouillon/ })[0]);
    await waitFor(() => expect(service.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ source_document_id: 'bl-1', source_document_number: 'BL-0042' })));
  });

  it('lists vouchers with their number, type, reason and status, and filters them', async () => {
    service.list.mockResolvedValue([
      voucher(),
      voucher({ id: 'v2', kind: 'entree', number: null, status: 'draft', reason: 'stock_initial', note: null }),
    ]);
    renderAt('/inventaire/bons');
    const table = await screen.findByRole('table');
    expect(within(table).getByText('BS-2026-0001')).toBeInTheDocument();
    expect(within(table).getByText('Brouillon BE')).toBeInTheDocument();
    expect(within(table).getByText('Casse / perte')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'entree' } });
    expect(within(table).queryByText('BS-2026-0001')).not.toBeInTheDocument();
    expect(within(table).getByText('Stock initial')).toBeInTheDocument();
  });
});
