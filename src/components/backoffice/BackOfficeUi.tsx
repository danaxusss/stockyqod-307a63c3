import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Loader, type LucideIcon } from 'lucide-react';

// Shared look of the back-office screens (comptabilité, paie, administration).
// Presentation only: the same buttons, fields, cards and tables as the
// documents and stock pages.

export const btnPrimary = 'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50';
export const btnSecondary = 'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3.5 text-sm font-medium text-foreground hover:bg-secondary disabled:opacity-50';
export const btnDanger = 'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-destructive px-3.5 text-sm font-semibold text-destructive-foreground shadow-sm hover:bg-destructive/90 disabled:opacity-50';
export const btnDangerOutline = 'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-destructive/30 bg-card px-3.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50';
/** Small action inside a row ("Générer", "Lettrer"…). */
export const btnSoft = 'inline-flex min-h-8 items-center justify-center gap-1 rounded-md bg-primary/10 px-2.5 text-xs font-semibold text-primary hover:bg-primary/20 disabled:opacity-50';
export const iconBtn = 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40';
export const iconBtnDanger = 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40';

const fieldBase = 'h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60';
export const field = `${fieldBase} w-full`;
/** A field that keeps its natural width (filters and pickers in a header). */
export const fieldAuto = `${fieldBase} w-auto max-w-full`;
/** Dense field inside a table row. */
export const fieldSm = 'h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60';
export const textArea = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';
export const fieldLabel = 'mb-1.5 block text-xs font-semibold text-muted-foreground';

export const panel = 'rounded-xl border border-border bg-card shadow-sm';
export const theadRow = 'border-b border-border bg-secondary/40';
export const th = 'px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground';
export const thRight = 'px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground';
export const td = 'px-3 py-2.5';
export const tdNum = 'whitespace-nowrap px-3 py-2.5 text-right tabular-nums';
export const tfootRow = 'border-t border-border bg-secondary/40 font-semibold';
/** A checkbox in the primary colour. */
export const checkbox = 'h-4 w-4 rounded border-input accent-[hsl(var(--primary))]';

export function LoadingState({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-20 text-sm text-muted-foreground" role="status">
      <Loader className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />{label}
    </div>
  );
}

/** Nothing to show yet: an icon, a sentence and, when there is one, the way forward. */
export function EmptyState({ icon: Icon, title, hint, children, className = '' }: {
  icon?: LucideIcon;
  title: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center px-4 py-10 text-center ${className}`}>
      {Icon && <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-muted-foreground"><Icon className="h-5 w-5" aria-hidden="true" /></span>}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint && <p className="mt-1 max-w-md text-sm text-muted-foreground">{hint}</p>}
      {children && <div className="mt-4 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

/** A key figure: icon and label on top, the value underneath. Links when `to` is set. */
export function KpiTile({ icon: Icon, tone = 'text-primary bg-primary/10', label, value, hint, to, valueClassName = 'text-foreground' }: {
  icon?: LucideIcon;
  tone?: string;
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  to?: string;
  valueClassName?: string;
}) {
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-muted-foreground sm:text-sm">
        {Icon && <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tone}`}><Icon className="h-4 w-4" aria-hidden="true" /></span>}
        <span className="truncate">{label}</span>
      </span>
      <span className={`mt-2 truncate text-lg font-bold tabular-nums tracking-tight sm:mt-3 sm:text-2xl ${valueClassName}`}>{value}</span>
      {hint && <span className="mt-1 truncate text-xs text-muted-foreground">{hint}</span>}
    </>
  );
  const cls = 'flex h-full min-w-0 flex-col rounded-xl border border-border bg-card p-3 shadow-sm sm:p-4';
  return to
    ? <Link to={to} className={`${cls} transition hover:border-primary/40 hover:shadow-md`}>{body}</Link>
    : <div className={cls}>{body}</div>;
}

/** A label / value pair in a stacked phone row. */
export function MobileField({ label, children, className = '' }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm tabular-nums text-foreground">{children}</dd>
    </div>
  );
}

/** Phone only: the page's main actions, above the tab bar. */
export function PhoneActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 border-t border-border bg-card px-4 py-2.5 shadow-[0_-4px_16px_rgba(17,24,39,0.06)] md:hidden">
      <div className="mx-auto flex max-w-3xl items-center gap-2 [&>*]:flex-1">{children}</div>
    </div>
  );
}

/** Tabs drawn as a segmented control (used where a page switches views). */
export function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: ReactNode }>;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-lg border border-border bg-secondary/60 p-0.5">
      {options.map(o => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={`min-h-9 whitespace-nowrap rounded-md px-3 text-sm font-medium transition ${value === o.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
