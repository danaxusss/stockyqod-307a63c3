import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DatabaseZap } from 'lucide-react';
import { StatusPill, type StatusTone } from '../../components/lists/StatusPill';
import { STATUS_LABELS, type SupplierInvoiceStatus } from '../../accounting/supplierInvoices';
import { SUPPLIER_MIGRATION } from '../../utils/supabaseSuppliers';

// Shared bits of the supplier pages (list, detail, reports).

const TONES: Record<SupplierInvoiceStatus, StatusTone> = { draft: 'neutral', validated: 'info', partial: 'warning', paid: 'success' };

export function SupplierStatusPill({ status }: { status: SupplierInvoiceStatus }) {
  return <StatusPill tone={TONES[status] || 'neutral'}>{STATUS_LABELS[status] || status}</StatusPill>;
}

/** Shown instead of an error while the database has not been migrated. */
export function SchemaMissingNotice() {
  return (
    <div role="alert" className="mx-auto mt-6 max-w-2xl rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm text-amber-900 dark:text-amber-100">
      <p className="flex items-center gap-2 font-semibold"><DatabaseZap className="h-4 w-4" aria-hidden="true" />Factures fournisseurs pas encore installées</p>
      <p className="mt-2">Exécutez la migration <code className="rounded bg-background/60 px-1 font-mono text-xs">{SUPPLIER_MIGRATION}</code> dans l’éditeur SQL de Supabase, puis rechargez la page.</p>
    </div>
  );
}

/** Links between the supplier pages, shown under the page title. */
export function SupplierTabs({ current }: { current: 'invoices' | 'suppliers' | 'delays' | 'withholdings' }) {
  const tabs: Array<{ key: typeof current; to: string; label: string }> = [
    { key: 'invoices', to: '/compta/factures-fournisseurs', label: 'Factures' },
    { key: 'suppliers', to: '/compta/fournisseurs', label: 'Fournisseurs' },
    { key: 'delays', to: '/compta/delais-paiement', label: 'Délais de paiement' },
    { key: 'withholdings', to: '/compta/retenues-source', label: 'Retenues à la source' },
  ];
  return (
    <nav aria-label="Achats" className="inline-flex max-w-full overflow-x-auto rounded-lg border border-border bg-secondary/60 p-0.5">
      {tabs.map(t => (
        <Link key={t.key} to={t.to} aria-current={t.key === current ? 'page' : undefined}
          className={`min-h-9 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition ${t.key === current ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'danger'; children: ReactNode }) {
  const cls = tone === 'danger'
    ? 'border-red-500/40 bg-red-500/10 text-red-800 dark:text-red-200'
    : tone === 'warning'
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100'
      : 'border-blue-500/30 bg-blue-500/10 text-blue-900 dark:text-blue-100';
  return <div className={`rounded-lg border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

