import { useState, useEffect, useCallback, useRef } from 'react';
import { Product } from '../types';
import { searchProducts, SearchFilters } from '../utils/database';
import { searchStateManager } from '../utils/searchStateManager';

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
  const scrollElementRef = useRef<Element | null>(null);

  // Initialize state from storage on mount
  useEffect(() => {
    const savedState = searchStateManager.getState();
    if (savedState) {
      console.log('Restoring search state:', savedState);
      setQueryState(savedState.query);
      setSelectedBrandState(savedState.selectedBrand || '');
      setSelectedStockLocationState(savedState.selectedStockLocation || '');
      setSortByState(savedState.sortBy);
      setSortOrderState(savedState.sortOrder);
      setScrollPosition(savedState.scrollPosition);
    }
    setIsInitialized(true);
  }, []);

  // Perform search with debouncing and minimum character requirement
  useEffect(() => {
    if (!isInitialized) return;

    const handleSearch = async () => {
      // Require at least 3 characters for text search OR a filter selection
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
        const searchFilters: SearchFilters = {
          query: hasValidQuery ? query : '',
          brand: selectedBrand,
          stockLocation: selectedStockLocation
        };
        
        console.log('Starting search with filters:', searchFilters);
        const products = await searchProducts(searchFilters);
        console.log('Search completed, found products:', products.length);
        
        const sortedProducts = sortProducts(products, sortBy, sortOrder);
        setResults(sortedProducts);
      } catch (error) {
        console.error('Search failed:', error);
        const errorMessage = error instanceof Error ? error.message : 'Erreur de recherche inconnue';
        setSearchError(`Erreur lors de la recherche: ${errorMessage}`);
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    };

    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Set new timeout for debouncing
    searchTimeoutRef.current = setTimeout(handleSearch, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query, selectedBrand, selectedStockLocation, sortBy, sortOrder, isInitialized]);

  // Save state whenever it changes (excluding results)
  useEffect(() => {
    if (!isInitialized) return;

    searchStateManager.saveState({
      query,
      selectedBrand,
      selectedStockLocation,
      scrollPosition,
      sortBy,
      sortOrder
    });
  }, [query, selectedBrand, selectedStockLocation, scrollPosition, sortBy, sortOrder, isInitialized]);

  const sortProducts = (products: Product[], sortBy: string, sortOrder: string): Product[] => {
    return [...products].sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortBy) {
        case 'name':
          aValue = a.name.toLowerCase();
          bValue = b.name.toLowerCase();
          break;
        case 'price':
          aValue = a.price;
          bValue = b.price;
          break;
        case 'brand':
          aValue = (a.brand || '').toLowerCase();
          bValue = (b.brand || '').toLowerCase();
          break;
        case 'stock':
          aValue = Object.values(a.stock_levels || {}).reduce((sum, level) => sum + level, 0);
          bValue = Object.values(b.stock_levels || {}).reduce((sum, level) => sum + level, 0);
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const setQuery = useCallback((newQuery: string) => {
    setQueryState(newQuery);
    setScrollPosition(0); // Reset scroll when query changes
  }, []);

  const setSelectedBrand = useCallback((brand: string) => {
    setSelectedBrandState(brand);
    setScrollPosition(0); // Reset scroll when filter changes
  }, []);

  const setSelectedStockLocation = useCallback((location: string) => {
    setSelectedStockLocationState(location);
    setScrollPosition(0); // Reset scroll when filter changes
  }, []);
  const setSortBy = useCallback((newSortBy: 'name' | 'price' | 'brand' | 'stock') => {
    setSortByState(newSortBy);
    setScrollPosition(0); // Reset scroll when sorting changes
  }, []);

  const setSortOrder = useCallback((newSortOrder: 'asc' | 'desc') => {
    setSortOrderState(newSortOrder);
    setScrollPosition(0); // Reset scroll when sorting changes
  }, []);

  const saveScrollPosition = useCallback((position: number) => {
    setScrollPosition(position);
    searchStateManager.saveScrollPosition(position);
  }, []);

  const restoreScrollPosition = useCallback(() => {
    // Find the main content container
    const mainContainer = document.querySelector('main') || document.documentElement;
    if (mainContainer && scrollPosition > 0) {
      console.log('Restoring scroll position to:', scrollPosition);
      
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        mainContainer.scrollTo({
          top: scrollPosition,
          behavior: 'auto' // Instant scroll for restoration
        });
      });
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
    query,
    setQuery,
    selectedBrand,
    setSelectedBrand,
    selectedStockLocation,
    setSelectedStockLocation,
    results,
    isLoading,
    searchError,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
    scrollPosition,
    saveScrollPosition,
    restoreScrollPosition,
    clearSearchState
  };
}