import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ImageFinderPage from '../pages/ImageFinderPage';
import { ImageSearchNotConfiguredError, ImageSearchService } from '../utils/imageSearchService';
import { uploadPrimaryProductImage } from '../utils/productImages';
import {
  barcodeQuery, base64ToFile, buildImageQuery, imageQueue, pastedImageUrl,
} from '../utils/imageSearch';
import type { Product } from '../types';

const product = (barcode: string, name: string, brand: string, image: string | null = null): Product => ({
  barcode, name, brand, image, techsheet: '', price: 0, buyprice: 0, reseller_price: 0, provider: '', stock_levels: {},
});

const appState = vi.hoisted(() => ({ products: [] as Product[] }));
const showToast = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ canEditProducts: true }));
const syncData = vi.hoisted(() => vi.fn());

vi.mock('../context/AppContext', () => ({ useAppContext: () => ({ state: appState, syncData }) }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ companyId: 'company-1', currentUser: { username: 'stock' }, canEditProducts: auth.canEditProducts }) }));
vi.mock('../hooks/useUserAuth', () => ({ useUserAuth: () => ({ authenticatedUser: null }) }));
vi.mock('../utils/productImages', () => ({
  resolveProductImageUrl: (image: string | null) => (image ? `https://cdn.test/${image}` : null),
  uploadPrimaryProductImage: vi.fn(),
}));
vi.mock('../utils/imageSearchService', () => ({
  ImageSearchNotConfiguredError: class ImageSearchNotConfiguredError extends Error {},
  ImageSearchService: { search: vi.fn(), fetchImage: vi.fn() },
}));

const search = vi.mocked(ImageSearchService.search);
const fetchImage = vi.mocked(ImageSearchService.fetchImage);
const upload = vi.mocked(uploadPrimaryProductImage);

const RESULT = {
  url: 'https://shop.example/drill.jpg', thumbnail: 'https://thumbs.example/drill.jpg',
  width: 800, height: 800, title: 'Perceuse Bosch GSB', source: 'shop.example', page: 'https://shop.example/p/drill',
};

afterEach(() => { vi.clearAllMocks(); auth.canEditProducts = true; });

function renderFinder() {
  return render(<MemoryRouter><ImageFinderPage /></MemoryRouter>);
}

describe('image search helpers', () => {
  it('builds a query without repeating the brand', () => {
    expect(buildImageQuery({ name: 'Perceuse GSB 13', brand: 'Bosch' })).toBe('Bosch Perceuse GSB 13');
    expect(buildImageQuery({ name: 'BOSCH Perceuse  GSB', brand: 'Bosch' })).toBe('BOSCH Perceuse GSB');
    expect(buildImageQuery({ name: 'Marteau', brand: '' })).toBe('Marteau');
  });

  it('only offers barcode searches for EAN-like references', () => {
    expect(barcodeQuery('6111234567890')).toBe('6111234567890');
    expect(barcodeQuery('REF-12')).toBeNull();
  });

  it('recognises pasted image addresses', () => {
    expect(pastedImageUrl(' https://cdn.example.com/a.png ')).toBe('https://cdn.example.com/a.png');
    expect(pastedImageUrl('not a url')).toBeNull();
    expect(pastedImageUrl('javascript:alert(1)')).toBeNull();
  });

  it('queues products without an image, counting images saved in this session', () => {
    const products = [product('1', 'A', 'X'), product('2', 'B', 'Y', 'img.jpg'), product('3', 'C', 'X')];
    expect(imageQueue(products, { missingOnly: true, brand: '', search: '', images: {} }).map(p => p.barcode)).toEqual(['1', '3']);
    expect(imageQueue(products, { missingOnly: true, brand: '', search: '', images: { 1: 'new.jpg' } }).map(p => p.barcode)).toEqual(['3']);
    expect(imageQueue(products, { missingOnly: false, brand: 'X', search: 'c', images: {} }).map(p => p.barcode)).toEqual(['3']);
  });

  it('turns downloaded bytes into a named image file', () => {
    const file = base64ToFile(btoa('abc'), 'image/png', '6111234567890');
    expect(file.name).toBe('6111234567890.png');
    expect(file.type).toBe('image/png');
    expect(file.size).toBe(3);
  });
});

describe('ImageFinderPage', () => {
  it('searches for the first product without an image, saves the chosen result and moves on', async () => {
    appState.products = [
      product('611000000001', 'Perceuse GSB 13', 'Bosch'),
      product('611000000002', 'Marteau', 'Stanley', 'company-1/primary/x.jpg'),
      product('611000000003', 'Scie sauteuse', 'Makita'),
    ];
    search.mockResolvedValue([RESULT]);
    const file = new File(['x'], '611000000001.jpg', { type: 'image/jpeg' });
    fetchImage.mockResolvedValue(file);
    upload.mockResolvedValue('company-1/primary/new.jpg');

    renderFinder();
    await waitFor(() => expect(search).toHaveBeenCalledWith('Bosch Perceuse GSB 13'));
    fireEvent.click(await screen.findByRole('button', { name: /Perceuse Bosch GSB/ }));
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer et continuer/ }));

    await waitFor(() => expect(upload).toHaveBeenCalledWith(expect.objectContaining({
      product: expect.objectContaining({ barcode: '611000000001' }),
      file, companyId: 'company-1', replaceExisting: false,
    })));
    expect(fetchImage).toHaveBeenCalledWith(RESULT.url, '611000000001', RESULT.page);
    // Next product without an image (the hammer already has one).
    await waitFor(() => expect(search).toHaveBeenLastCalledWith('Makita Scie sauteuse'));
    expect(screen.getByRole('heading', { name: 'Scie sauteuse' })).toBeInTheDocument();
  });

  it('falls back to the search engine thumbnail when the source site refuses the download', async () => {
    appState.products = [product('611000000001', 'Perceuse GSB 13', 'Bosch')];
    search.mockResolvedValue([RESULT]);
    const thumbnail = new File(['t'], '611000000001.jpg', { type: 'image/jpeg' });
    fetchImage.mockRejectedValueOnce(new Error('HTTP 403')).mockResolvedValueOnce(thumbnail);
    upload.mockResolvedValue('company-1/primary/new.jpg');

    renderFinder();
    fireEvent.click(await screen.findByRole('button', { name: /Perceuse Bosch GSB/ }));
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer et continuer/ }));

    await waitFor(() => expect(upload).toHaveBeenCalledWith(expect.objectContaining({ file: thumbnail })));
    expect(fetchImage).toHaveBeenLastCalledWith(RESULT.thumbnail, '611000000001');
  });

  it('explains how to paste images when no search provider is configured', async () => {
    appState.products = [product('611000000001', 'Perceuse GSB 13', 'Bosch')];
    search.mockRejectedValue(new ImageSearchNotConfiguredError('not configured'));

    renderFinder();
    expect(await screen.findByText('Recherche intégrée non configurée')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Google Images/ })).toHaveAttribute('href', expect.stringContaining('tbm=isch'));
  });

  it('is reserved to users allowed to edit products, without starting any search', async () => {
    auth.canEditProducts = false;
    appState.products = [product('611000000001', 'Perceuse GSB 13', 'Bosch')];
    renderFinder();
    expect(screen.getByText('Accès réservé')).toBeInTheDocument();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(search).not.toHaveBeenCalled();
  });
});
