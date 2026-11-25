import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Loader, Zap } from 'lucide-react';
import { Panel } from '../../components/PageHeader';
import { StatusPill } from '../../components/lists/StatusPill';
import { btnSecondary, btnSoft } from '../../components/backoffice/BackOfficeUi';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { formatMoney } from '../../utils/format';
import { PAYMENT_MODE_LABELS, frDay, supplierDisplayName, type Supplier, type SupplierInvoice, type SupplierPayment } from '../../accounting/supplierInvoices';
import { SupplierInvoicesService, SupplierSchemaMissingError, SuppliersService } from '../../utils/supabaseSuppliers';

/**
 * Supplier invoices and payments waiting for their entry, inside "À
 * comptabiliser". Self-contained: it loads and posts its own documents.
 */
export function SupplierPostingSection({ autoPost }: { autoPost: boolean }) {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const [state, setState] = useState<'loading' | 'missing' | 'ready'>('loading');
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [payments, setPayments] = useState<SupplierPayment[]>([]);
  const [suppliers, setSuppliers] = useState<Map<string, Supplier>>(new Map());
  const [entries, setEntries] = useState<Array<{ source_id: string | null; status: string }>>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [inv, pay, sup, led] = await Promise.all([
        SupplierInvoicesService.list(), SupplierInvoicesService.payments(), SuppliersService.list(), SupplierInvoicesService.ledgerEntries(),
      ]);
      setInvoices(inv.filter(i => i.status !== 'draft')); setPayments(pay); setSuppliers(new Map(sup.map(s => [s.id, s]))); setEntries(led);
      setState('ready');
    } catch (e) {
      if (e instanceof SupplierSchemaMissingError) setState('missing');
      else { setState('ready'); showToast({ type: 'error', message: (e as Error).message }); }
    }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const invoiceOf = useMemo(() => new Map(invoices.map(i => [i.id, i])), [invoices]);
  const pendingInvoices = invoices.filter(i => SupplierInvoicesService.bookingOf(entries, 'invoice', i.id) === 'none');
  const pendingPayments = payments.filter(p => invoiceOf.has(p.invoice_id) && SupplierInvoicesService.bookingOf(entries, 'payment', p.id) === 'none');
  const opts = () => ({ post: autoPost, createdBy: currentUser?.username || null });

  const run = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key);
    try { await work(); showToast({ type: 'success', message: autoPost ? 'Écriture validée' : 'Brouillon généré' }); }
    catch (e) { showToast({ type: 'error', title: 'Erreur', message: (e as Error).message }); }
    finally { setBusy(null); await load(); }
  };
  const postInvoice = (i: SupplierInvoice) => SupplierInvoicesService.postInvoice(i, suppliers.get(i.supplier_id), opts());
  const postPayment = (p: SupplierPayment) => SupplierInvoicesService.postPayment(p, invoiceOf.get(p.invoice_id)!, suppliers.get(p.supplier_id), opts());
  // Invoices first: a payment's entry clears the 4411 credit its invoice made.
  const all = () => run('all', async () => {
    for (const i of pendingInvoices) await postInvoice(i);
    for (const p of pendingPayments) await postPayment(p);
  });

  if (state === 'loading') return null;
  if (state === 'missing') return null;
  const count = pendingInvoices.length + pendingPayments.length;
  const status = (n: number) => n > 0 ? <StatusPill tone="warning">{n} en attente</StatusPill> : <StatusPill tone="success" icon={<Check className="h-3 w-3" />}>À jour</StatusPill>;

  return (
    <div className="mt-4 grid items-start gap-4 xl:grid-cols-2">
      <Panel title="Factures fournisseurs" action={status(pendingInvoices.length)}>
        <ul className="divide-y divide-border">
          {pendingInvoices.map(i => (
            <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <Link to={`/compta/factures-fournisseurs/${i.id}`} className="truncate text-sm font-medium text-foreground hover:underline">{i.number} · {i.supplier_invoice_number}</Link>
                <div className="truncate text-xs text-muted-foreground">{supplierDisplayName(suppliers.get(i.supplier_id))} · {frDay(i.invoice_date)}</div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="whitespace-nowrap text-sm font-semibold tabular-nums">{formatMoney(i.total_ttc)}</span>
                <button onClick={() => run(i.id, () => postInvoice(i))} disabled={busy !== null} className={`${btnSoft} min-w-[5.5rem]`}>
                  {busy === i.id ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}Générer
                </button>
              </div>
            </li>
          ))}
          {pendingInvoices.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">Aucune facture fournisseur en attente</li>}
        </ul>
      </Panel>
      <Panel title="Règlements fournisseurs" action={status(pendingPayments.length)}>
        <ul className="divide-y divide-border">
          {pendingPayments.map(p => {
            const inv = invoiceOf.get(p.invoice_id)!;
            return (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">Règlement {inv.supplier_invoice_number}</div>
                  <div className="truncate text-xs text-muted-foreground">{supplierDisplayName(suppliers.get(p.supplier_id))} · {frDay(p.payment_date)} · {PAYMENT_MODE_LABELS[p.mode]}</div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="whitespace-nowrap text-sm font-semibold tabular-nums">{formatMoney(p.amount + p.vat_withheld + p.ir_withheld)}</span>
                  <button onClick={() => run(p.id, () => postPayment(p))} disabled={busy !== null} className={`${btnSoft} min-w-[5.5rem]`}>
                    {busy === p.id ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}Générer
                  </button>
                </div>
              </li>
            );
          })}
          {pendingPayments.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">Aucun règlement fournisseur en attente</li>}
        </ul>
        {count > 1 && (
          <div className="border-t border-border px-4 py-3 sm:px-5">
            <button onClick={all} disabled={busy !== null} className={btnSecondary}>
              {busy === 'all' ? <Loader className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}Générer tous les achats ({count})
            </button>
          </div>
        )}
      </Panel>
    </div>
  );
}
