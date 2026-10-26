import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TechnicalSheetFinder } from '../components/TechnicalSheetFinder';
import { TechnicalSheetButton } from '../components/TechnicalSheetButton';
import { SheetSearchNotConfiguredError, SheetSearchService } from '../utils/sheetSearchService';
import { createSheetFromFile, findSheetBySourceUrl, linkSheetToProduct, loadAllSheets } from '../utils/technicalSheets';
import { renderPdfPages } from '../utils/pdfPreview';
import { buildSheetQuery, libraryMatches, sheetTitle } from '../utils/sheetSearch';
import type { TechnicalSheet } from '../types';

const showToast = vi.hoisted(() => vi.fn());

vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../utils/sheetSearchService', () => ({
  SheetSearchNotConfiguredError: class SheetSearchNotConfiguredError extends Error {},
  SheetSearchService: { search: vi.fn(), fetchDocument: vi.fn() },
}));
vi.mock('../utils/technicalSheets', () => ({
  loadAllSheets: vi.fn(),
  findSheetBySourceUrl: vi.fn(),
  linkSheetToProduct: vi.fn(),
  createSheetFromFile: vi.fn(),
}));
vi.mock('../utils/pdfPreview', () => ({ renderPdfPages: vi.fn() }));

const search = vi.mocked(SheetSearchService.search);
const fetchDocument = vi.mocked(SheetSearchService.fetchDocument);
const allSheets = vi.mocked(loadAllSheets);
const bySource = vi.mocked(findSheetBySourceUrl);
const linkSheet = vi.mocked(linkSheetToProduct);
const createSheet = vi.mocked(createSheetFromFile);
const renderPages = vi.mocked(renderPdfPages);

const PRODUCT = { barcode: 'GSB13', name: 'Perceuse GSB 13', brand: 'Bosch' };

const sheet = (id: string, title: string, manufacturer = ''): TechnicalSheet => ({
  id, title, manufacturer, category: '', sector: '', file_url: `https://storage.test/${id}.pdf`, file_size: 10, file_type: 'application/pdf',
  view_count: 0, download_count: 0, created_at: '', updated_at: '',
});

const WEB = {
  url: 'https://bosch.example/docs/gsb13.pdf', title: '[PDF] Perceuse GSB 13 RE - Fiche technique | Bosch', snippet: 'Puissance 600 W',
  source: 'bosch.example', kind: 'pdf' as const,
};

function pdfFile() {
  const file = new File(['%PDF-1.4'], 'gsb13.pdf', { type: 'application/pdf' });
  // jsdom's File may lack arrayBuffer().
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(8) });
  return file;
}

function renderFinder(linkedSheetIds: string[] = []) {
  const onLinked = vi.fn();
  const onClose = vi.fn();
  render(<TechnicalSheetFinder product={PRODUCT} linkedSheetIds={linkedSheetIds} onLinked={onLinked} onClose={onClose} />);
  return { onLinked, onClose };
}

afterEach(() => { vi.clearAllMocks(); });

describe('technical sheet helpers', () => {
  it('builds French, English and reference searches', () => {
    expect(buildSheetQuery(PRODUCT, 'fr')).toBe('Bosch Perceuse GSB 13 fiche technique');
    expect(buildSheetQuery(PRODUCT, 'en')).toBe('Bosch Perceuse GSB 13 datasheet');
    expect(buildSheetQuery(PRODUCT, 'reference')).toBe('Bosch "GSB13"');
  });

  it('cleans web titles for the library', () => {
    expect(sheetTitle(WEB, 'x')).toBe('Perceuse GSB 13 RE - Fiche technique');
    expect(sheetTitle({ title: 'gsb13.pdf', url: '' }, 'x')).toBe('gsb13');
    expect(sheetTitle({ title: '', url: '' }, 'Perceuse')).toBe('Perceuse');
  });

  it('suggests library sheets that mention the product, skipping linked ones', () => {
    const sheets = [sheet('a', 'Fiche Perceuse GSB', 'Bosch'), sheet('b', 'Perceuse à percussion'), sheet('c', 'Meuleuse'), sheet('d', 'Perceuse GSB 13')];
    expect(libraryMatches(sheets, PRODUCT).map(s => s.id)).toEqual(['a', 'd']);
    expect(libraryMatches(sheets, PRODUCT, ['a']).map(s => s.id)).toEqual(['d']);
  });
});

describe('TechnicalSheetFinder', () => {
  it('searches the web for the product as soon as it opens', async () => {
    allSheets.mockResolvedValue([sheet('lib', 'Perceuse GSB 13 - notice', 'Bosch'), sheet('other', 'Meuleuse')]);
    search.mockResolvedValue([WEB]);
    renderFinder();
    expect(search).toHaveBeenCalledWith('Bosch Perceuse GSB 13 fiche technique', 'pdf');
    expect(await screen.findByText('Perceuse GSB 13 RE - Fiche technique')).toBeInTheDocument();
    expect(await screen.findByText('Déjà dans Stocky')).toBeInTheDocument();
    expect(screen.getByText('Perceuse GSB 13 - notice')).toBeInTheDocument();
    expect(screen.queryByText('Meuleuse')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Datasheet' }));
    expect(search).toHaveBeenLastCalledWith('Bosch Perceuse GSB 13 datasheet', 'pdf');
    fireEvent.change(screen.getByLabelText('Type de document'), { target: { value: 'documents' } });
    expect(search).toHaveBeenLastCalledWith('Bosch Perceuse GSB 13 datasheet', 'documents');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rechercher' })).toBeEnabled());
  });

  it('previews a PDF before linking it', async () => {
    allSheets.mockResolvedValue([]);
    search.mockResolvedValue([WEB]);
    fetchDocument.mockResolvedValue({ file: pdfFile(), kind: 'pdf' });
    renderPages.mockResolvedValue({ pages: ['data:image/png;base64,AAA'], numPages: 4 });
    renderFinder();
    fireEvent.click(await screen.findByRole('button', { name: /Aperçu/ }));
    expect(await screen.findByAltText('Page 1')).toBeInTheDocument();
    expect(fetchDocument).toHaveBeenCalledWith(WEB.url);
    expect(renderPages).toHaveBeenCalledWith(expect.any(ArrayBuffer), 3);
    expect(screen.getByText(/4 page\(s\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Afficher les 4 pages' }));
    await waitFor(() => expect(renderPages).toHaveBeenLastCalledWith(expect.any(ArrayBuffer), 20));
    // The document was downloaded once.
    expect(fetchDocument).toHaveBeenCalledTimes(1);
  });

  it('says when a Word document cannot be previewed', async () => {
    allSheets.mockResolvedValue([]);
    search.mockResolvedValue([{ ...WEB, url: 'https://bosch.example/gsb.docx', kind: 'docx' }]);
    fetchDocument.mockResolvedValue({ file: pdfFile(), kind: 'docx' });
    renderFinder();
    fireEvent.click(await screen.findByRole('button', { name: /Aperçu/ }));
    expect(await screen.findByText(/Aperçu non disponible pour les documents Word/)).toBeInTheDocument();
    expect(renderPages).not.toHaveBeenCalled();
  });

  it('stores a web sheet in the library and links it to the product', async () => {
    allSheets.mockResolvedValue([]);
    search.mockResolvedValue([WEB]);
    bySource.mockResolvedValue(null);
    const file = pdfFile();
    fetchDocument.mockResolvedValue({ file, kind: 'pdf' });
    const stored = sheet('new', 'Perceuse GSB 13 RE - Fiche technique', 'Bosch');
    createSheet.mockResolvedValue(stored);
    linkSheet.mockResolvedValue();
    const { onLinked, onClose } = renderFinder();
    fireEvent.click(await screen.findByRole('button', { name: /^Lier$/ }));
    await waitFor(() => expect(onLinked).toHaveBeenCalledWith(stored));
    expect(createSheet).toHaveBeenCalledWith(file, { title: 'Perceuse GSB 13 RE - Fiche technique', manufacturer: 'Bosch', sourceUrl: WEB.url });
    expect(linkSheet).toHaveBeenCalledWith('new', 'GSB13');
    expect(onClose).toHaveBeenCalled();
  });

  it('reuses a sheet already downloaded from the same address', async () => {
    allSheets.mockResolvedValue([]);
    search.mockResolvedValue([WEB]);
    const existing = sheet('known', 'GSB 13');
    bySource.mockResolvedValue(existing);
    linkSheet.mockResolvedValue();
    const { onLinked } = renderFinder();
    fireEvent.click(await screen.findByRole('button', { name: /^Lier$/ }));
    await waitFor(() => expect(onLinked).toHaveBeenCalledWith(existing));
    expect(fetchDocument).not.toHaveBeenCalled();
    expect(createSheet).not.toHaveBeenCalled();
    expect(linkSheet).toHaveBeenCalledWith('known', 'GSB13');
  });

  it('links a sheet from the library directly', async () => {
    const libSheet = sheet('lib', 'Perceuse GSB 13 - notice', 'Bosch');
    allSheets.mockResolvedValue([libSheet]);
    search.mockResolvedValue([]);
    linkSheet.mockResolvedValue();
    const { onLinked } = renderFinder();
    const row = (await screen.findByText('Perceuse GSB 13 - notice')).closest('div.border-b') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /^Lier$/ }));
    await waitFor(() => expect(onLinked).toHaveBeenCalledWith(libSheet));
    expect(linkSheet).toHaveBeenCalledWith('lib', 'GSB13');
    expect(fetchDocument).not.toHaveBeenCalled();
  });

  it('keeps manual search and import available when web search is not set up', async () => {
    allSheets.mockResolvedValue([]);
    search.mockRejectedValue(new SheetSearchNotConfiguredError('not configured'));
    renderFinder();
    expect(await screen.findByText('Recherche intégrée non configurée')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Google/ })).toHaveAttribute('href', expect.stringContaining('filetype%3Apdf'));
    expect(screen.getByRole('button', { name: /Importer un fichier/ })).toBeEnabled();
  });

  it('shows a link failure without closing', async () => {
    allSheets.mockResolvedValue([]);
    search.mockResolvedValue([WEB]);
    bySource.mockResolvedValue(null);
    fetchDocument.mockRejectedValue(new Error('Ce lien mène à une page web, pas à un document.'));
    const { onClose } = renderFinder();
    fireEvent.click(await screen.findByRole('button', { name: /^Lier$/ }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: 'Ce lien mène à une page web, pas à un document.' })));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('TechnicalSheetButton', () => {
  const one = [{ id: 'a', title: 'Fiche A', file_url: 'https://storage.test/a.pdf' }];
  const two = [...one, { id: 'b', title: 'Fiche B', file_url: 'https://storage.test/b.pdf' }];

  it('opens the only linked sheet directly', () => {
    render(<TechnicalSheetButton sheets={one} canSearch onSearch={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Ouvrir la fiche technique Fiche A' })).toHaveAttribute('href', 'https://storage.test/a.pdf');
  });

  it('lists several linked sheets', () => {
    const onSearch = vi.fn();
    render(<TechnicalSheetButton sheets={two} canSearch onSearch={onSearch} />);
    fireEvent.click(screen.getByRole('button', { name: '2 fiches techniques' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Fiche B' })).toHaveAttribute('href', 'https://storage.test/b.pdf');
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Rechercher une autre fiche/ }));
    expect(onSearch).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('offers a search when nothing is linked, only to people who can edit products', () => {
    const onSearch = vi.fn();
    const { rerender } = render(<TechnicalSheetButton sheets={[]} canSearch onSearch={onSearch} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher une fiche technique' }));
    expect(onSearch).toHaveBeenCalled();
    rerender(<TechnicalSheetButton sheets={[]} canSearch={false} onSearch={onSearch} />);
    expect(screen.queryByRole('button', { name: 'Rechercher une fiche technique' })).not.toBeInTheDocument();
  });
});
