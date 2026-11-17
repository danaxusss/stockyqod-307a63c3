import { describe, expect, it } from 'vitest';
import { knownSeries, normalizeSeries } from '../utils/productSeries';
import { sortSeries } from '../utils/kioskSort';

describe('product series', () => {
  it('stores a series without the typed prefix, and "Aucune" or empty as none', () => {
    expect(normalizeSeries(' Série 700 ')).toBe('700');
    expect(normalizeSeries('serie900')).toBe('900');
    expect(normalizeSeries('G900')).toBe('G900');
    expect(normalizeSeries('Aucune')).toBeNull();
    expect(normalizeSeries('  ')).toBeNull();
    expect(normalizeSeries(null)).toBeNull();
  });

  it('orders series numerically, then names', () => {
    expect(sortSeries(['900', 'Premium', '700', ' 600', '700'])).toEqual(['600', '700', '900', 'Premium']);
  });

  it('suggests the brand series first', () => {
    const products = [
      { brand: 'OLIS', series: '900' }, { brand: 'OLIS', series: '700' },
      { brand: 'ATA', series: '600' }, { brand: 'ATA', series: null },
    ];
    expect(knownSeries(products, 'ATA')).toEqual(['600', '700', '900']);
    expect(knownSeries(products)).toEqual(['600', '700', '900']);
  });
});
