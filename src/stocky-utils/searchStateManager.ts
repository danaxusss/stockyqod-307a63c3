interface SearchState {
  query: string;
  selectedBrand: string;
  selectedStockLocation: string;
  scrollPosition: number;
  sortBy: 'name' | 'price' | 'brand' | 'stock';
  sortOrder: 'asc' | 'desc';
  timestamp: number;
}

class SearchStateManager {
  private static instance: SearchStateManager;
  private state: SearchState | null = null;
  private readonly STORAGE_KEY = 'inventory_search_state';
  private readonly STATE_EXPIRY = 30 * 60 * 1000; // 30 minutes

  static getInstance(): SearchStateManager {
    if (!SearchStateManager.instance) {
      SearchStateManager.instance = new SearchStateManager();
    }
    return SearchStateManager.instance;
  }

  saveState(state: Omit<SearchState, 'timestamp'>): void {
    const stateWithTimestamp: SearchState = {
      ...state,
      timestamp: Date.now()
    };
    
    this.state = stateWithTimestamp;
    
    try {
      sessionStorage.setItem(this.STORAGE_KEY, JSON.stringify(stateWithTimestamp));
    } catch (error) {
      console.warn('Failed to save search state to sessionStorage:', error);
    }
  }

  getState(): SearchState | null {
    // First check in-memory state
    if (this.state && this.isStateValid(this.state)) {
      return this.state;
    }

    // Then check sessionStorage
    try {
      const stored = sessionStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const parsedState: SearchState = JSON.parse(stored);
        if (this.isStateValid(parsedState)) {
          this.state = parsedState;
          return parsedState;
        }
      }
    } catch (error) {
      console.warn('Failed to retrieve search state from sessionStorage:', error);
    }

    return null;
  }

  clearState(): void {
    this.state = null;
    try {
      sessionStorage.removeItem(this.STORAGE_KEY);
    } catch (error) {
      console.warn('Failed to clear search state from sessionStorage:', error);
    }
  }

  private isStateValid(state: SearchState): boolean {
    const now = Date.now();
    return (now - state.timestamp) < this.STATE_EXPIRY;
  }

  // Save scroll position separately for more frequent updates
  saveScrollPosition(position: number): void {
    if (this.state) {
      this.state.scrollPosition = position;
      try {
        sessionStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.state));
      } catch (error) {
        console.warn('Failed to save scroll position:', error);
      }
    }
  }
}

export const searchStateManager = SearchStateManager.getInstance();