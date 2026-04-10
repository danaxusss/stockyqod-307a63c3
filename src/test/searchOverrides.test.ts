import { describe, expect, it } from 'vitest';
import { searchProductsLocally } from '../hooks/useSearchState';
import type { Product } from '../types';

const products: Product[] = [
  {
    barcode: '123',
    name: 'Décapant four',
    brand: 'Restom',
    techsheet: '',
    price: 120,
    buyprice: 80,
    reseller_price: 100,
    provider: 'Distrib Plus',
    stock_levels: { showroom: 5 },
  },
];

const overrides = [
  {
    type: 'brand',
    original_name: 'CHM',
    custom_name: 'Restom',
  },
];

describe('searchProductsLocally', () => {
  it('matches both the current and original brand names in text search', () => {
    expect(searchProductsLocally(products, { query: 'restom' }, overrides)).toHaveLength(1);
    expect(searchProductsLocally(products, { query: 'chm' }, overrides)).toHaveLength(1);
  });

  it('matches the brand filter with either the current or original brand name', () => {
    expect(searchProductsLocally(products, { brand: 'Restom' }, overrides)).toHaveLength(1);
    expect(searchProductsLocally(products, { brand: 'CHM' }, overrides)).toHaveLength(1);
  });
});