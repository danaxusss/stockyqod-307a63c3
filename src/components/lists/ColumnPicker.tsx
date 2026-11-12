import { useEffect, useRef, useState } from 'react';
import { Check, Columns3 } from 'lucide-react';

export type ColumnOption<K extends string> = { key: K; label: string };

/** "Colonnes" button with a checklist of the optional columns. */
export function ColumnPicker<K extends string>({ options, shown, onToggle }: {
  options: ColumnOption<K>[];
  shown: K[];
  onToggle: (key: K) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Escape') return;
      if (event.type === 'mousedown' && event.target instanceof Node && ref.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(value => !value)} aria-haspopup="true" aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary">
        <Columns3 className="h-4 w-4" />Colonnes
      </button>
      {open && (
        <div role="group" aria-label="Colonnes affichées" className="absolute right-0 top-full z-30 mt-1 w-56 rounded-lg border border-border bg-popover py-1 shadow-xl">
          {options.map(option => {
            const checked = shown.includes(option.key);
            return (
              <label key={option.key} className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-secondary">
                <input type="checkbox" checked={checked} onChange={() => onToggle(option.key)} className="sr-only" />
                <span aria-hidden="true" className={`flex h-4 w-4 items-center justify-center rounded border ${checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input'}`}>
                  {checked && <Check className="h-3 w-3" />}
                </span>
                {option.label}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
