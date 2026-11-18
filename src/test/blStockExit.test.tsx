import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BLDetailPage from '../pages/compta/BLDetailPage';
import { deliveryExitLines } from '../inventory/lib/stockPosting';
import { StockVouchersService } from '../utils/stockVouchers';
import type { Quote } from '../types';

const state = vi.hoisted(() => ({ stock: true, legacy: false, voucher: null as null | { id: string; number: string | null; status: string } }));
const locations = vi.hoisted(() => [{ id: 'loc-dep', name: 'Dépôt', abbreviation: 'DEP' }, { id: 'loc-show', name: 'Showroom', abbreviation: 'SHOW' }]);
const products = vi.hoisted(() => [
  { barcode: 'P1', name: 'Four mixte', stock_levels: { DEP: 5, SHOW: 2 } },
  { barcode: 'P2', name: 'Plat inox', stock_levels: { SHOW: 9 } },
  { barcode: 'P3', name: 'Chaise', stock_levels: { DEP: 1, SHOW: 1 } },
]);
const bl = vi.hoisted(() => ({
  id: 'bl-1', quoteNumber: 'BL-0042', documentType: 'bl', status: 'final', createdAt: new Date('2026-11-18'), updatedAt: new Date('2026-11-18'),
  customer: { fullName: 'Hôtel Atlas', phoneNumber: '', address: '', city: '', salesPerson: '' }, totalAmount: 1000, company_id: 'c1',
  items: [
    { id: 'a', quantity: 3, unitPrice: 100, subtotal: 300, product: { barcode: 'P1', name: 'Four mixte' }, dispatch: [
      { stock_location_id: 'loc-dep', stock_location_abbrev: 'DEP', sub_location_code: '', quantity: 2 },
      { stock_location_id: 'loc-show', stock_location_abbrev: 'SHOW', sub_location_code: '', quantity: 1 },
    ] },
    { id: 'b', quantity: 4, unitPrice: 10, subtotal: 40, product: { barcode: 'P2', name: 'Plat inox' } },
    { id: 'c', quantity: 1, unitPrice: 10, subtotal: 10, quoteName: 'Chaise', product: { barcode: 'P3', name: 'Chaise' } },
  ],
}));

vi.mock('../utils/supabaseDocuments', () => ({ SupabaseDocumentsService: { getById: vi.fn(async () => bl), findProformaForBL: vi.fn(async () => null) } }));
vi.mock('../utils/supabaseCompanies', () => ({ SupabaseCompaniesService: { getAllCompanies: vi.fn(async () => []) } }));
vi.mock('../utils/companySettings', () => ({ CompanySettingsService: { getSettings: vi.fn(async () => null) } }));
vi.mock('../utils/pdfExport', () => ({ PdfExportService: {} }));
vi.mock('../utils/supabaseClient', () => ({ supabase: {} }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('../utils/supabaseStock', () => ({ StockService: { getProducts: vi.fn(async () => products) } }));
vi.mock('../utils/supabaseStockLocations', () => ({ StockLocationsService: { getStockLocations: vi.fn(async () => locations) } }));
vi.mock('../inventory/lib/stockPosting', async importOriginal => ({
  ...(await importOriginal<typeof import('../inventory/lib/stockPosting')>()),
  isDocumentStockPosted: vi.fn(async () => state.legacy),
}));
vi.mock('../utils/stockVouchers', async importOriginal => ({
  ...(await importOriginal<typeof import('../utils/stockVouchers')>()),
  StockVouchersService: { findForDocument: vi.fn(async () => state.voucher), saveDraft: vi.fn(async () => 'bs-1') },
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ isSuperAdmin: false, isCompta: true, currentUser: { username: 'sara' } }) }));
vi.mock('../hooks/useAccess', () => ({ useAccess: () => ({ access: { stock: state.stock } }) }));
const showToast = vi.hoisted(() => vi.fn());
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast }) }));
const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async importOriginal => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useNavigate: () => navigate }));

const saveDraft = vi.mocked(StockVouchersService.saveDraft);
const renderBl = () => render(<MemoryRouter initialEntries={['/compta/bls/bl-1']}><Routes><Route path="/compta/bls/:id" element={<BLDetailPage />} /></Routes></MemoryRouter>);

afterEach(() => { vi.clearAllMocks(); state.stock = true; state.legacy = false; state.voucher = null; });

describe('lines of a delivery note’s Bon de sortie', () => {
  it('takes each line from where it ships, and reports lines without a location', () => {
    const { lines, skippedItems } = deliveryExitLines(bl as unknown as Quote, products as never, locations as never);
    expect(lines).toEqual([
      { barcode: 'P1', product_name: 'Four mixte', quantity: 2, unit_cost: null, location_id: 'loc-dep' },
      { barcode: 'P1', product_name: 'Four mixte', quantity: 1, unit_cost: null, location_id: 'loc-show' },
      { barcode: 'P2', product_name: 'Plat inox', quantity: 4, unit_cost: null, location_id: 'loc-show' },
    ]);
    // Stock at two locations and no dispatch: which one is unknown.
    expect(skippedItems).toEqual(['Chaise']);
  });
});

describe('delivery note page', () => {
  it('prepares the Bon de sortie and opens it for stock staff', async () => {
    renderBl();
    fireEvent.click(await screen.findByRole('button', { name: /Créer le bon de sortie/ }));
    await waitFor(() => expect(saveDraft).toHaveBeenCalled());
    expect(saveDraft.mock.calls[0][0]).toMatchObject({
      kind: 'sortie', reason: 'livraison_client', location_id: 'loc-show', source_document_id: 'bl-1', source_document_number: 'BL-0042',
      note: 'BL BL-0042 — Hôtel Atlas', created_by: 'sara',
    });
    expect(saveDraft.mock.calls[0][0].lines).toHaveLength(3);
    expect(navigate).toHaveBeenCalledWith('/inventaire/bons/bs-1');
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Lignes non reprises' }));
  });

  it('leaves validation to the warehouse for billing staff', async () => {
    state.stock = false;
    renderBl();
    fireEvent.click(await screen.findByRole('button', { name: /Créer le bon de sortie/ }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Bon de sortie préparé' })));
    expect(navigate).not.toHaveBeenCalled();
    expect(await screen.findByText('Bon de sortie à valider')).toBeInTheDocument();
  });

  it('shows the Bon de sortie that took it out, and offers no second one', async () => {
    state.voucher = { id: 'bs-9', number: 'BS-2026-0009', status: 'validated' };
    renderBl();
    expect((await screen.findAllByText(/BS-2026-0009/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Créer le bon de sortie/ })).not.toBeInTheDocument();
  });

  it('keeps delivery notes counted out the old way as they are', async () => {
    state.legacy = true;
    renderBl();
    expect(await screen.findByText('Stock décompté')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Créer le bon de sortie/ })).not.toBeInTheDocument();
  });
});
