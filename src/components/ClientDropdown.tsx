import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { Search, User, Plus } from 'lucide-react';
import { SupabaseClientsService, Client } from '../utils/supabaseClients';

interface ClientDropdownProps {
  value: string;
  onChange: (client: Client | null, inputValue: string) => void;
  placeholder?: string;
  className?: string;
  onCreateNew?: (query?: string) => void;
}

export function ClientDropdown({ value, onChange, placeholder = 'Rechercher un client...', className = '', onCreateNew }: ClientDropdownProps) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<Client[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const updateDropdownPosition = useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updateDropdownPosition();
    window.addEventListener('scroll', updateDropdownPosition, true);
    window.addEventListener('resize', updateDropdownPosition);
    return () => {
      window.removeEventListener('scroll', updateDropdownPosition, true);
      window.removeEventListener('resize', updateDropdownPosition);
    };
  }, [open, updateDropdownPosition]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    try {
      const data = await SupabaseClientsService.searchClients(q);
      setResults(data);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    onChange(null, v);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(v), 250);
  };

  const handleSelect = (client: Client) => {
    setQuery(client.full_name);
    onChange(client, client.full_name);
    setOpen(false);
    setResults([]);
  };

  const showNoResults = open && !loading && query.trim().length >= 2 && results.length === 0;
  const showDropdown = open && (results.length > 0 || loading || showNoResults);

  const dropdown = showDropdown ? (
    <div
      style={dropdownStyle}
      className="bg-popover border border-border rounded-lg shadow-lg overflow-hidden max-h-56 overflow-y-auto"
    >
      {loading && (
        <div className="px-3 py-2 text-xs text-muted-foreground">Recherche...</div>
      )}
      {results.map(client => (
        <button
          key={client.id}
          type="button"
          onMouseDown={() => handleSelect(client)}
          className="w-full text-left px-3 py-2 hover:bg-accent transition-colors"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <User className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <div>
                <span className="text-sm font-medium text-foreground">{client.full_name}</span>
                {client.client_code && (
                  <span className="ml-2 text-[10px] font-mono text-primary bg-primary/10 px-1 rounded">{client.client_code}</span>
                )}
              </div>
            </div>
            <span className="text-xs text-muted-foreground">{client.phone_number}{client.city ? ` · ${client.city}` : ''}</span>
          </div>
        </button>
      ))}
      {showNoResults && onCreateNew && (
        <button
          type="button"
          onMouseDown={() => {
            const q = query;
            // Reset dropdown completely so it doesn't keep searching in the background
            setOpen(false);
            setQuery('');
            setResults([]);
            if (debounceRef.current) clearTimeout(debounceRef.current);
            onCreateNew(q);
          }}
          className="w-full text-left px-3 py-2 hover:bg-accent transition-colors flex items-center space-x-2 text-primary"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="text-sm">Aucun résultat — Créer « {query} »</span>
        </button>
      )}
      {!showNoResults && onCreateNew && results.length > 0 && (
        <button
          type="button"
          onMouseDown={() => {
            const q = query;
            setOpen(false);
            setQuery('');
            setResults([]);
            if (debounceRef.current) clearTimeout(debounceRef.current);
            onCreateNew(q);
          }}
          className="w-full text-left px-3 py-2 hover:bg-accent transition-colors border-t border-border flex items-center space-x-2 text-primary"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="text-sm">Nouveau client...</span>
        </button>
      )}
    </div>
  ) : null;

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInput}
          onFocus={() => { if (query.trim()) { setOpen(true); } }}
          placeholder={placeholder}
          className="w-full pl-8 pr-3 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring"
        />
      </div>
      {typeof document !== 'undefined' && ReactDOM.createPortal(dropdown, document.body)}
    </div>
  );
}
