import type { ReactNode } from 'react';
import { Loader, Minus, Package, Plus, Search } from 'lucide-react';
import { resolveProductImageUrl } from '../../utils/productImages';
import { opsField, opsLabel, opsPanel } from './stockOpsStyles';

/** Small 4:5 product photo, or a package icon when there is none. */
export function ProductThumb({ image, size = 'md' }: { image?: string | null; size?: 'sm' | 'md' }) {
  const url = resolveProductImageUrl(image);
  const box = size === 'sm' ? 'h-10 w-8' : 'h-[3.75rem] w-12';
  return (
    <span className={`flex ${box} shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-white`}>
      {url ? <img src={url} alt="" className="h-full w-full object-contain" loading="lazy" /> : <Package className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
    </span>
  );
}

/**
 * Quantity with − / + around the existing number input. The buttons only call
 * the page's own handlers; the input keeps the page's onChange.
 */
export function QtyStepper({ input, onMinus, onPlus, minusDisabled, label }: {
  input: ReactNode;
  onMinus: () => void;
  onPlus: () => void;
  minusDisabled?: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center rounded-lg border border-input bg-background">
      <button type="button" onClick={onMinus} disabled={minusDisabled} aria-label={`Diminuer ${label}`}
        className="flex h-10 w-10 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40">
        <Minus className="h-3.5 w-3.5" />
      </button>
      {input}
      <button type="button" onClick={onPlus} aria-label={`Augmenter ${label}`}
        className="flex h-10 w-10 items-center justify-center text-muted-foreground hover:text-foreground">
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Classes for the number input inside QtyStepper. */
export const stepperInput = 'h-10 w-14 border-0 bg-transparent p-0 text-center text-sm font-semibold tabular-nums text-foreground focus:outline-none focus:ring-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

/** The product search field with its results list underneath. */
export function ProductSearch({ label, value, onChange, placeholder, children }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** The result rows, when there are any. */
  children?: ReactNode;
}) {
  return (
    <div>
      <label className={opsLabel}>{label}</label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={label}
          className={`${opsField} pl-9`} />
        {children && (
          <div className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

/** One row of the search results. */
export function SearchResult({ image, name, detail, aside, onClick }: {
  image?: string | null;
  name: string;
  detail?: ReactNode;
  aside?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
      className="flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left last:border-0 hover:bg-secondary">
      <ProductThumb image={image} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{name}</span>
        {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
      </span>
      {aside && <span className="shrink-0 text-xs text-muted-foreground">{aside}</span>}
      <Plus className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
    </button>
  );
}

export function OpsLoading() {
  return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader className="mr-2 h-5 w-5 animate-spin" />Chargement…</div>;
}

/** A titled white card. */
export function OpsSection({ title, aside, children, className = '' }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`${opsPanel} ${className}`}>
      {title && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3 sm:px-5">
          <h2 className="font-semibold text-foreground">{title}</h2>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}
