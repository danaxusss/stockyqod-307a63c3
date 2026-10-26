import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileSearch, FileText, Search } from 'lucide-react';
import type { SheetLink } from '../utils/technicalSheets';

/**
 * The technical sheet icon of a product. A linked sheet opens directly
 * (several: a short menu to pick one); without one, people allowed to edit
 * products get a search button that opens the sheet finder.
 */
export function TechnicalSheetButton({ sheets, canSearch, onSearch, className = '', iconClassName = 'h-4 w-4', inverse = false }: {
  sheets: SheetLink[];
  canSearch: boolean;
  onSearch: () => void;
  className?: string;
  iconClassName?: string;
  /** On a coloured (primary) background. */
  inverse?: boolean;
}) {
  const linkedTone = inverse ? 'text-primary-foreground hover:bg-white/20' : 'text-primary hover:bg-primary/10';
  const searchTone = inverse ? 'text-primary-foreground/70 hover:bg-white/20 hover:text-primary-foreground' : 'text-muted-foreground/70 hover:bg-accent hover:text-foreground';
  const [menu, setMenu] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (event: Event) => {
      if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Escape') return;
      if (event.target instanceof Node && (menuRef.current?.contains(event.target) || buttonRef.current?.contains(event.target))) return;
      setMenu(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menu]);

  if (sheets.length === 1) {
    const [sheet] = sheets;
    return (
      <a href={sheet.file_url} target="_blank" rel="noopener noreferrer" title={`Fiche technique : ${sheet.title}`}
        aria-label={`Ouvrir la fiche technique ${sheet.title}`} className={`rounded ${linkedTone} ${className}`}>
        <FileText className={iconClassName} />
      </a>
    );
  }

  if (sheets.length > 1) {
    return (
      <>
        <button ref={buttonRef} type="button" title={`${sheets.length} fiches techniques`} aria-label={`${sheets.length} fiches techniques`}
          aria-haspopup="menu" aria-expanded={!!menu}
          onClick={() => {
            if (menu) { setMenu(null); return; }
            const rect = buttonRef.current!.getBoundingClientRect();
            setMenu({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
          }}
          className={`relative rounded ${linkedTone} ${className}`}>
          <FileText className={iconClassName} />
          <span className={`absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[9px] font-bold leading-none ${inverse ? 'bg-primary-foreground text-primary' : 'bg-primary text-primary-foreground'}`}>{sheets.length}</span>
        </button>
        {menu && createPortal(
          <div ref={menuRef} role="menu" style={{ top: menu.top, right: menu.right }}
            className="fixed z-[90] w-72 max-w-[calc(100vw-16px)] overflow-hidden rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-xl">
            {sheets.map(sheet => (
              <a key={sheet.id} role="menuitem" href={sheet.file_url} target="_blank" rel="noopener noreferrer" onClick={() => setMenu(null)}
                className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent">
                <FileText className="h-4 w-4 shrink-0 text-primary" /><span className="truncate">{sheet.title}</span>
              </a>
            ))}
            {canSearch && (
              <button role="menuitem" type="button" onClick={() => { setMenu(null); onSearch(); }}
                className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
                <Search className="h-4 w-4 shrink-0" />Rechercher une autre fiche
              </button>
            )}
          </div>,
          document.body,
        )}
      </>
    );
  }

  if (!canSearch) return null;
  return (
    <button type="button" onClick={onSearch} title="Rechercher une fiche technique" aria-label="Rechercher une fiche technique"
      className={`rounded ${searchTone} ${className}`}>
      <FileSearch className={iconClassName} />
    </button>
  );
}
