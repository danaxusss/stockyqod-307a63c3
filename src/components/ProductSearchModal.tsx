import React, { useState, useRef, useEffect } from 'react';
import { Search, X, Package, Loader } from 'lucide-react';
import { searchProducts } from '../utils/database';
import { Product } from '../types';

interface ProductSearchModalProps {
  onSelect: (product: Product) => void;
  onClose: () => void;
}

export function ProductSearchModal({ onSelect, onClose }: ProductSearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await searchProducts({ query: query.trim() });
        setResults(res.slice(0, 30));
      } finally {
        setLoading(false);
      }
    }, 250);
  }, [query]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="glass rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center gap-2 p-4 border-b border-border flex-shrink-0">
          <Package className="h-4 w-4 text-primary flex-shrink-0" />
          <h2 className="text-sm font-semibold text-foreground flex-1">Rechercher un produit</h2>
          <button onClick={onClose} className="p-1 hover:bg-accent rounded-lg">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Search input */}
        <div className="p-3 border-b border-border flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            {loading && <Loader className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground animate-spin" />}
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Désignation, marque, code-barres..."
              className="w-full pl-8 pr-8 py-2 text-sm border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto divide-y divide-border">
          {results.length === 0 && query.trim() && !loading && (
            <div className="p-6 text-center text-sm text-muted-foreground">Aucun produit trouvé</div>
          )}
          {!query.trim() && (
            <div className="p-6 text-center text-sm text-muted-foreground">Tapez pour rechercher...</div>
          )}
          {results.map(product => (
            <button
              key={product.id}
              onClick={() => { onSelect(product); onClose(); }}
              className="w-full text-left px-4 py-3 hover:bg-accent transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{product.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {product.brand && <span className="mr-2">{product.brand}</span>}
                    {product.barcode && <span className="font-mono">{product.barcode}</span>}
                  </p>
                </div>
                {product.price != null && (
                  <span className="text-xs font-mono font-bold text-foreground flex-shrink-0">
                    {new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(product.price)} Dh
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
