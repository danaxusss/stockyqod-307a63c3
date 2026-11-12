import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { docInitials, docPanel } from './docStyles';

export type DocStep = { label: string; detail: string; state: 'done' | 'current' | 'todo'; to?: string };

/** Devis → BL → Proforma → Facture: where this document sits in the chain. */
export function DocProgress({ steps, footer }: { steps: DocStep[]; footer?: ReactNode }) {
  return (
    <section className={`${docPanel} px-4 py-3 sm:px-5`} aria-label="Suivi du document">
      <ol className="grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((step, i) => {
          const dot = step.state === 'done' ? 'bg-emerald-600 text-white' : step.state === 'current' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground ring-1 ring-inset ring-border';
          const body = (
            <>
              <span className="flex items-center gap-2">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${dot}`} aria-hidden="true">
                  {step.state === 'done' ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className="hidden h-px flex-1 bg-border sm:block" aria-hidden="true" />
              </span>
              <span className={`mt-1.5 block text-sm font-semibold ${step.state === 'todo' ? 'text-muted-foreground' : 'text-foreground'}`}>{step.label}</span>
              <span className="block truncate text-xs text-muted-foreground">{step.detail}</span>
            </>
          );
          return (
            <li key={step.label} className="min-w-0" aria-current={step.state === 'current' ? 'step' : undefined}>
              {step.to ? <Link to={step.to} className="block rounded-md hover:opacity-80">{body}</Link> : body}
            </li>
          );
        })}
      </ol>
      {footer && <div className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">{footer}</div>}
    </section>
  );
}

/** The client of a document, read-only. */
export function DocClientCard({ name, details }: { name?: string; details: Array<string | null | undefined> }) {
  return (
    <div className="flex items-start gap-3 sm:gap-4">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold uppercase text-primary" aria-hidden="true">
        {docInitials(name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-lg font-semibold leading-tight text-foreground">{name || 'Client non renseigné'}</p>
        <p className="mt-1 text-sm text-muted-foreground">{details.filter(Boolean).join(' · ')}</p>
      </div>
    </div>
  );
}

/** A labelled switch for a PDF option. */
export function DocToggle({ checked, onChange, title, hint }: { checked: boolean; onChange: (value: boolean) => void; title: string; hint: string }) {
  return (
    // `relative` keeps the hidden checkbox inside the label, so focusing it does not scroll the page.
    <label className="relative flex cursor-pointer items-center gap-3 py-2">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="peer sr-only" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <span aria-hidden="true" className={`relative h-5 w-9 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring ${checked ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[1.125rem]' : 'left-0.5'}`} />
      </span>
    </label>
  );
}

/** Phone only: the key figure and the next step, above the tab bar. */
export function DocPhoneBar({ label, value, children }: { label: string; value: ReactNode; children?: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 border-t border-border bg-card px-4 py-2.5 shadow-[0_-4px_16px_rgba(17,24,39,0.06)] md:hidden">
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="whitespace-nowrap text-lg font-bold tabular-nums leading-tight text-foreground">{value}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
