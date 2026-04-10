import { useState, useEffect, useCallback, useRef } from 'react';
import { Product } from '../types';
import { useAppContext } from '../context/AppContext';
import { searchStateManager } from '../utils/searchStateManager';
import { useProductOverrides } from './useProductOverrides';

export interface SearchFilters {
  query?: string;
  brand?: string;
  stockLocation?: string;
}

interface OverrideEntry {
  type: string;
  original_name: string;
  custom_name: string;
}

type OverrideType = 'brand' | 'provider';

const normalizeOverrideName = (value: string) => value.toLowerCase().trim();

function buildOverrideLookup(overrides: OverrideEntry[]) {
  const lookup = {
    brand: {
      byCustom: new Map<string, OverrideEntry>(),
      byOriginal: new Map<string, OverrideEntry>(),
    },
    provider: {
      byCustom: new Map<string, OverrideEntry>(),
      byOriginal: new Map<string, OverrideEntry>(),
    },
  };

  for (const override of overrides) {
    if (override.type !== 'brand' && override.type !== 'provider') continue;

    const customName = normalizeOverrideName(override.custom_name);
    const originalName = normalizeOverrideName(override.original_name);

    if (customName) lookup[override.type].byCustom.set(customName, override);
    if (originalName) lookup[override.type].byOriginal.set(originalName, override);
  }

  return lookup;
}

function getRelatedNames(
  lookup: ReturnType<typeof buildOverrideLookup>,
  type: OverrideType,
  value: string,
): string[] {
  const normalizedValue = normalizeOverrideName(value || '');
  if (!normalizedValue) return [];

  const match = lookup[type].byCustom.get(normalizedValue) || lookup[type].byOriginal.get(normalizedValue);
  if (!match) return [normalizedValue];

  return Array.from(new Set([
    normalizeOverrideName(match.custom_name),
    normalizeOverrideName(match.original_name),
  ].filter(Boolean)));
}

export function searchProductsLocally(
  products: Product[],
  filters: SearchFilters,
  overrides: OverrideEntry[] = []
): Product[] {
  const { query = '', brand = '', stockLocation = '' } = filters;
  const queryLower = query.toLowerCase().trim();
  const queryTokens = queryLower.length > 0 ? queryLower.split(/\s+/).filter(t => t.length > 0) : [];
  const brandLower = brand.toLowerCase().trim();
  const stockLocationLower = stockLocation.toLowerCase().trim();
  const overrideLookup = buildOverrideLookup(overrides);

  return products.filter(product => {
    const brandNames = getRelatedNames(overrideLookup, 'brand', product.brand || '');
    const providerNames = getRelatedNames(overrideLookup, 'provider', product.provider || '');

    // Brand filter (fast check first)
    if (brandLower && !brandNames.includes(brandLower)) return false;

    // Stock location filter
    if (stockLocationLower) {
      if (!product.stock_levels) return false;
      const hasStock = Object.keys(product.stock_levels).some(loc =>
        loc.toLowerCase() === stockLocationLower && (product.stock_levels[loc] || 0) > 0
      );
      if (!hasStock) return false;
    }

    // Text search
    if (queryTokens.length > 0) {
      // Exact barcode match — fast path
      if (String(product.barcode).toLowerCase() === queryLower) return true;

      const searchableText = `${product.name} ${brandNames.join(' ')} ${providerNames.join(' ')}`.toLowerCase();
      if (!queryTokens.every(token => searchableText.includes(token))) return false;
    }

    return true;
  });
}

interface UseSearchStateReturn {
  query: string;
  setQuery: (query: string) => void;
  selectedBrand: string;
  setSelectedBrand: (brand: string) => void;
  selectedStockLocation: string;
  setSelectedStockLocation: (location: string) => void;
  results: Product[];
  isLoading: boolean;
  searchError: string | null;
  sortBy: 'name' | 'price' | 'brand' | 'stock';
  setSortBy: (sort: 'name' | 'price' | 'brand' | 'stock') => void;
  sortOrder: 'asc' | 'desc';
  setSortOrder: (order: 'asc' | 'desc') => void;
  scrollPosition: number;
  saveScrollPosition: (position: number) => void;
  restoreScrollPosition: () => void;
  clearSearchState: () => void;
}

export function useSearchState(): UseSearchStateReturn {
  const { state } = useAppContext();
  const { overrides } = useProductOverrides();
  const [query, setQueryState] = useState('');
  const [selectedBrand, setSelectedBrandState] = useState('');
  const [selectedStockLocation, setSelectedStockLocationState] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [sortBy, setSortByState] = useState<'name' | 'price' | 'brand' | 'stock'>('name');
  const [sortOrder, setSortOrderState] = useState<'asc' | 'desc'>('asc');
  const [scrollPosition, setScrollPosition] = useState(0);
  const [isInitialized, setIsInitialized] = useState(false);

  const searchTimeoutRef = useRef<NodeJS.Timeout>();

  // Initialize state from storage
  useEffect(() => {
    const savedState = searchStateManager.getState();
    if (savedState) {
      setQueryState(savedState.query);
      setSelectedBrandState(savedState.selectedBrand || '');
      setSelectedStockLocationState(savedState.selectedStockLocation || '');
      setSortByState(savedState.sortBy);
      setSortOrderState(savedState.sortOrder);
      setScrollPosition(savedState.scrollPosition);
    }
    setIsInitialized(true);
  }, []);

  // Search from context products
  useEffect(() => {
    if (!isInitialized) return;

    const handleSearch = () => {
      const hasValidQuery = query.trim().length >= 3;
      const hasFilters = selectedBrand || selectedStockLocation;

      if (!hasValidQuery && !hasFilters) {
        setResults([]);
        setSearchError(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setSearchError(null);

      try {
        const products = searchProductsLocally(state.products, {
          query: hasValidQuery ? query : '',
          brand: selectedBrand,
          stockLocation: selectedStockLocation
        }, overrides);

        const sorted = sortProducts(products, sortBy, sortOrder);
        setResults(sorted);
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Erreur de recherche inconnue';
        setSearchError(`Erreur lors de la recherche: ${msg}`);
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    };

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(handleSearch, 150);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [query, selectedBrand, selectedStockLocation, sortBy, sortOrder, isInitialized, state.products, overrides]);

  // Persist state
  useEffect(() => {
    if (!isInitialized) return;
    searchStateManager.saveState({ query, selectedBrand, selectedStockLocation, scrollPosition, sortBy, sortOrder });
  }, [query, selectedBrand, selectedStockLocation, scrollPosition, sortBy, sortOrder, isInitialized]);

  const sortProducts = (products: Product[], by: string, order: string): Product[] => {
    return [...products].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      switch (by) {
        case 'name': aVal = a.name.toLowerCase(); bVal = b.name.toLowerCase(); break;
        case 'price': aVal = a.price; bVal = b.price; break;
        case 'brand': aVal = (a.brand || '').toLowerCase(); bVal = (b.brand || '').toLowerCase(); break;
        case 'stock':
          aVal = Object.values(a.stock_levels || {}).reduce((s, l) => s + l, 0);
          bVal = Object.values(b.stock_levels || {}).reduce((s, l) => s + l, 0);
          break;
        default: return 0;
      }

      if (aVal < bVal) return order === 'asc' ? -1 : 1;
      if (aVal > bVal) return order === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const setQuery = useCallback((q: string) => { setQueryState(q); setScrollPosition(0); }, []);
  const setSelectedBrand = useCallback((b: string) => { setSelectedBrandState(b); setScrollPosition(0); }, []);
  const setSelectedStockLocation = useCallback((l: string) => { setSelectedStockLocationState(l); setScrollPosition(0); }, []);
  const setSortBy = useCallback((s: 'name' | 'price' | 'brand' | 'stock') => { setSortByState(s); setScrollPosition(0); }, []);
  const setSortOrder = useCallback((o: 'asc' | 'desc') => { setSortOrderState(o); setScrollPosition(0); }, []);

  const saveScrollPosition = useCallback((pos: number) => {
    setScrollPosition(pos);
    searchStateManager.saveScrollPosition(pos);
  }, []);

  const restoreScrollPosition = useCallback(() => {
    const main = document.querySelector('main') || document.documentElement;
    if (main && scrollPosition > 0) {
      requestAnimationFrame(() => main.scrollTo({ top: scrollPosition, behavior: 'auto' }));
    }
  }, [scrollPosition]);

  const clearSearchState = useCallback(() => {
    searchStateManager.clearState();
    setQueryState('');
    setSelectedBrandState('');
    setSelectedStockLocationState('');
    setResults([]);
    setSortByState('name');
    setSortOrderState('asc');
    setScrollPosition(0);
    setSearchError(null);
  }, []);

  return {
    query, setQuery,
    selectedBrand, setSelectedBrand,
    selectedStockLocation, setSelectedStockLocation,
    results, isLoading, searchError,
    sortBy, setSortBy, sortOrder, setSortOrder,
    scrollPosition, saveScrollPosition, restoreScrollPosition,
    clearSearchState
  };
}
