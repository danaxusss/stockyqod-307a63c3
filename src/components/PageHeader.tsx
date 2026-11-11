import type { ReactNode } from 'react';

/**
 * The shared top of a page: title and subtitle on the left, the page's
 * actions on the right (main action last). Wraps under the title on phones.
 */
export function PageHeader({ title, subtitle, actions, children }: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Filters or tabs shown under the title row. */
  children?: ReactNode;
}) {
  return (
    <header className="mb-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </header>
  );
}

/** A white card with an optional title row ("Tout voir" link on the right). */
export function Panel({ title, action, children, className = '' }: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-xl border border-border bg-card shadow-sm ${className}`}>
      {title && (
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <h2 className="font-semibold text-foreground">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
