import { describe, expect, it } from 'vitest';
import {
  analyzeProductImageFiles,
  productBarcodeFromFilename,
  PRODUCT_IMAGE_BATCH_LIMIT,
} from '../utils/productImageBatch';
import type { Product } from '../types';

const product = (barcode: string, image: string | null = null): Product => ({
  barcode,
  name: `Product ${barcode}`,
  brand: 'Test',
  image,
  techsheet: '',
  price: 100,
  buyprice: 50,
  reseller_price: 80,
  provider: 'Provider',
  stock_levels: {},
});

const imageFile = (name: string, size = 4) => new File([new Uint8Array(size)], name, { type: 'image/jpeg' });

describe('product image batch analysis', () => {
  it('uses the exact filename stem as the barcode', () => {
    expect(productBarcodeFromFilename(' BRP-01.final.JPG ')).toBe('BRP-01.final');
  });

  it('separates new images, replacements, unmatched and duplicate barcodes', () => {
    const analysis = analyzeProductImageFiles(
      [imageFile('A-1.jpg'), imageFile('B_2.png'), imageFile('missing.webp'), imageFile('A-1.png')],
      [product('A-1'), product('B_2', 'company/old.jpg')],
    );

    expect(analysis.newImages.map(item => item.product.barcode)).toEqual(['A-1']);
    expect(analysis.replacements.map(item => item.product.barcode)).toEqual(['B_2']);
    expect(analysis.unmatched.map(file => file.name)).toEqual(['missing.webp']);
    expect(analysis.duplicates.map(file => file.name)).toEqual(['A-1.png']);
  });

  it('enforces the bounded first-version batch limit', () => {
    const files = Array.from({ length: PRODUCT_IMAGE_BATCH_LIMIT + 2 }, (_, index) => imageFile(`${index}.jpg`));
    const products = Array.from({ length: PRODUCT_IMAGE_BATCH_LIMIT + 2 }, (_, index) => product(String(index)));
    const analysis = analyzeProductImageFiles(files, products);

    expect(analysis.candidates).toHaveLength(PRODUCT_IMAGE_BATCH_LIMIT);
    expect(analysis.overflow).toHaveLength(2);
  });
});
