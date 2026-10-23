import { useState, type FormEvent } from 'react';
import { Check, ChevronDown, Loader, Plus } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import type { BusinessSector } from '../types';

/**
 * Multi-select for a product's business sectors. Renders its list in a
 * portal, so it works inside scrolling tables. With `onCreate`, a missing
 * sector can be added on the spot and is selected right away.
 */
export function SectorPicker({ sectors, value, onChange, onCreate, disabled, size = 'sm', label = 'Secteur' }: {
  sectors: BusinessSector[];
  value: string[];
  onChange: (sectorIds: string[]) => void;
  onCreate?: (name: string) => Promise<BusinessSector>;
  disabled?: boolean;
  size?: 'sm' | 'md';
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const selected = sectors.filter(sector => value.includes(sector.id));

  const toggle = (id: string) => onChange(value.includes(id) ? value.filter(item => item !== id) : [...value, id]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!onCreate || !newName.trim() || creating) return;
    setCreating(true);
    setCreateError('');
    try {
      const sector = await onCreate(newName);
      if (!value.includes(sector.id)) onChange([...value, sector.id]);
      setNewName('');
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Création impossible');
    } finally {
      setCreating(false);
    }
  };

  const compact = size === 'sm';
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button type="button" aria-label={`${label} : ${selected.map(sector => sector.name).join(', ') || 'aucun'}`}
          className={`flex w-full items-center justify-between gap-1 rounded-md border border-input bg-background text-left text-foreground disabled:opacity-60 ${compact ? 'min-w-32 px-2 py-1 text-[11px]' : 'h-9 px-3 text-sm'}`}>
          <span className="flex min-w-0 flex-wrap gap-1">
            {selected.length ? selected.slice(0, compact ? 2 : 6).map(sector => (
              <span key={sector.id} className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">{sector.name}</span>
            )) : <span className="text-muted-foreground">Aucun secteur</span>}
            {compact && selected.length > 2 && <span className="text-muted-foreground">+{selected.length - 2}</span>}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-2">
        <p className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {sectors.map(sector => {
            const checked = value.includes(sector.id);
            return (
              <button key={sector.id} type="button" role="menuitemcheckbox" aria-checked={checked} onClick={() => toggle(sector.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent">
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input'}`}>
                  {checked && <Check className="h-3 w-3" />}
                </span>
                {sector.name}
              </button>
            );
          })}
          {!sectors.length && <p className="px-2 py-3 text-center text-xs text-muted-foreground">Aucun secteur défini.</p>}
        </div>
        {onCreate && (
          <form onSubmit={create} className="mt-2 border-t border-border pt-2">
            <div className="flex gap-1">
              <input value={newName} onChange={event => { setNewName(event.target.value); setCreateError(''); }} maxLength={60}
                placeholder="Nouveau secteur…" aria-label="Nouveau secteur"
                className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs" />
              <button type="submit" disabled={!newName.trim() || creating} aria-label="Ajouter le secteur"
                className="rounded-md bg-primary px-2 text-primary-foreground disabled:opacity-50">
                {creating ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              </button>
            </div>
            {createError && <p className="mt-1 text-[11px] text-destructive">{createError}</p>}
          </form>
        )}
      </PopoverContent>
    </Popover>
  );
}
