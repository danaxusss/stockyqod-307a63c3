import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, Download, FileText, ClipboardList, PackageCheck, X, Loader, AlertTriangle } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { DocumentCard, documentCardList } from '../../components/lists/DocumentCard';
import { StatusPill } from '../../components/lists/StatusPill';
import { useCompactList } from '../../hooks/use-mobile';
import { useToast } from '../../context/ToastContext';
import { btnPrimary, btnSecondary, checkbox, EmptyState, fieldAuto, field, KpiTile, LoadingState, panel, td, tdNum, th, thRight, theadRow, tfootRow } from '../../components/backoffice/BackOfficeUi';
import { formatMoney } from '../../utils/format';
import { exportToCSV } from '../../utils/csvExport';
import {
  frDay, NATURE_LABELS, overdueDays, r2, remainingOf, STATUS_LABELS, supplierDisplayName, today,
  type Supplier, type SupplierInvoice, type SupplierInvoiceStatus, type SupplierPayment,
} from '../../accounting/supplierInvoices';
import { delayFacts } from '../../accounting/paymentDelays';
import { PurchaseSourcesService, SupplierInvoicesService, SupplierSchemaMissingError, SuppliersService, type ReceptionSummary } from '../../utils/supabaseSuppliers';
import { PurchaseOrdersService } from '../../utils/supabasePurchaseOrders';
import type { PurchaseOrder } from '../../types';
import { SchemaMissingNotice, SupplierStatusPill, SupplierTabs } from './SupplierUi';

export const SUPPLIER_INVOICES_PATH = '/compta/factures-fournisseurs';

export default function SupplierInvoicesPage() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const compact = useCompactList();
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [payments, setPayments] = useState<SupplierPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [search, setSearch] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [status, setStatus] = useState<'' | SupplierInvoiceStatus>('');
  const [unpaid, setUnpaid] = useState(false);
  const [overdue, setOverdue] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [picker, setPicker] = useState<'po' | 'reception' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [inv, sup, pay] = await Promise.all([SupplierInvoicesService.list(), SuppliersService.list(), SupplierInvoicesService.payments()]);
      setInvoices(inv); setSuppliers(sup); setPayments(pay); setMissing(false);
    } catch (e) {
      if (e instanceof SupplierSchemaMissingError) setMissing(true);
      else showToast({ type: 'error', title: 'Erreur', message: (e as Error).message });
    } finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const supplierOf = useMemo(() => new Map(suppliers.map(s => [s.id, s])), [suppliers]);
  const paymentsOf = useMemo(() => {
    const m = new Map<string, SupplierPayment[]>();
    for (const p of payments) (m.get(p.invoice_id) || m.set(p.invoice_id, []).get(p.invoice_id)!).push(p);
    return m;
  }, [payments]);
  const day = today();

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter(i => {
      if (supplierId && i.supplier_id !== supplierId) return false;
      if (status && i.status !== status) return false;
      if (unpaid && (i.status === 'draft' || remainingOf(i) <= 0.005)) return false;
      if (overdue && overdueDays(i, day) === 0) return false;
      if (from && i.invoice_date < from) return false;
      if (to && i.invoice_date > to) return false;
      if (q) {
        const s = supplierOf.get(i.supplier_id);
        const hay = [i.number, i.supplier_invoice_number, s?.name, s?.first_name, s?.ice, i.description].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).map(i => {
      const facts = i.status !== 'draft' ? delayFacts(i, paymentsOf.get(i.id) || [], day) : null;
      return { inv: i, supplier: supplierOf.get(i.supplier_id), late: overdueDays(i, day), fine: facts?.fine || 0 };
    });
  }, [invoices, supplierId, status, unpaid, overdue, from, to, search, supplierOf, paymentsOf, day]);

  const totals = useMemo(() => {
    const t = { ht: 0, vat: 0, ttc: 0, remaining: 0, overdue: 0, fine: 0 };
    for (const r of rows) {
      t.ht += r.inv.total_ht; t.vat += r.inv.total_vat; t.ttc += r.inv.total_ttc;
      if (r.inv.status !== 'draft') t.remaining += remainingOf(r.inv);
      if (r.late > 0) t.overdue += remainingOf(r.inv);
      t.fine += r.fine;
    }
    return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, r2(v)])) as typeof t;
  }, [rows]);

  const csv = () => exportToCSV(rows.map(r => ({
    'N° interne': r.inv.number || 'Brouillon',
    'Fournisseur': supplierDisplayName(r.supplier),
    'ICE': r.supplier?.ice || '',
    'IF': r.supplier?.if_number || '',
    'N° facture fournisseur': r.inv.supplier_invoice_number,
    'Date facture': frDay(r.inv.invoice_date),
    'Échéance': frDay(r.inv.due_date),
    'Nature': NATURE_LABELS[r.inv.nature],
    'Statut': STATUS_LABELS[r.inv.status],
    'HT': r.inv.total_ht,
    'TVA': r.inv.total_vat,
    'dont TVA non déductible': r.inv.total_nondeductible_vat,
    'TTC': r.inv.total_ttc,
    'Réglé': r.inv.paid_amount,
    'Reste à payer': remainingOf(r.inv),
    'Jours de retard': r.late,
    'Amende estimée (loi 69-21)': r.fine,
    'Plafond espèces dépassé': r.inv.cash_over_limit ? 'oui' : '',
  })), `factures-fournisseurs-${day}`);

  const open = (id: string) => navigate(`${SUPPLIER_INVOICES_PATH}/${id}`);
  const statusCell = (r: typeof rows[number]) => (
    <span className="inline-flex flex-wrap items-center gap-1">
      <SupplierStatusPill status={r.inv.status} />
      {r.late > 0 && <StatusPill tone="danger">{r.late} j de retard</StatusPill>}
      {r.inv.cash_over_limit && <StatusPill tone="warning" icon={<AlertTriangle className="h-3 w-3" />}>Espèces</StatusPill>}
    </span>
  );

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader title="Factures fournisseurs" subtitle="Achats, TVA récupérable, règlements et délais de paiement"
        actions={!missing && (
          <>
            <button onClick={() => setPicker('po')} className={btnSecondary}><ClipboardList className="h-4 w-4" />Depuis une commande</button>
            <button onClick={() => setPicker('reception')} className={btnSecondary}><PackageCheck className="h-4 w-4" />Depuis une réception</button>
            <Link to={`${SUPPLIER_INVOICES_PATH}/nouvelle`} className={btnPrimary}><Plus className="h-4 w-4" />Nouvelle facture</Link>
          </>
        )}>
        <SupplierTabs current="invoices" />
      </PageHeader>

      {loading ? <LoadingState /> : missing ? <SchemaMissingNotice /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile label="Total TTC" value={formatMoney(totals.ttc)} hint={`${rows.length} facture(s) · TVA ${formatMoney(totals.vat)}`} />
            <KpiTile label="Reste à payer" value={formatMoney(totals.remaining)} />
            <KpiTile label="En retard" value={formatMoney(totals.overdue)} valueClassName={totals.overdue > 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground'} />
            <KpiTile label="Amende estimée" value={formatMoney(totals.fine)} hint="loi 69-21, à la charge de l’acheteur" to="/compta/delais-paiement" />
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="relative min-w-[14rem] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Fournisseur, n° de facture…" aria-label="Rechercher" className={`${field} pl-9`} />
            </div>
            <select aria-label="Fournisseur" value={supplierId} onChange={e => setSupplierId(e.target.value)} className={fieldAuto}>
              <option value="">Tous les fournisseurs</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{supplierDisplayName(s)}</option>)}
            </select>
            <select aria-label="Statut" value={status} onChange={e => setStatus(e.target.value as typeof status)} className={fieldAuto}>
              <option value="">Tous les statuts</option>
              {(Object.keys(STATUS_LABELS) as SupplierInvoiceStatus[]).map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
            <label className="flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm"><input type="checkbox" className={checkbox} checked={unpaid} onChange={e => setUnpaid(e.target.checked)} />Non payées</label>
            <label className="flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm"><input type="checkbox" className={checkbox} checked={overdue} onChange={e => setOverdue(e.target.checked)} />En retard</label>
            <label className="text-xs text-muted-foreground">Du<input type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="Du" className={`${fieldAuto} ml-1`} /></label>
            <label className="text-xs text-muted-foreground">au<input type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="Au" className={`${fieldAuto} ml-1`} /></label>
            <button onClick={csv} disabled={rows.length === 0} className={btnSecondary}><Download className="h-4 w-4" />CSV</button>
          </div>

          <div className={`${panel} overflow-hidden`}>
            {rows.length === 0 ? (
              <EmptyState icon={FileText} title="Aucune facture fournisseur" hint="Saisissez les factures reçues : elles alimentent la TVA récupérable, le grand livre et la déclaration des délais de paiement." />
            ) : compact ? (
              <ul className={documentCardList}>
                {rows.map(r => (
                  <DocumentCard key={r.inv.id} to={`${SUPPLIER_INVOICES_PATH}/${r.inv.id}`}
                    number={r.inv.number || 'Brouillon'} status={statusCell(r)}
                    title={supplierDisplayName(r.supplier)} subtitle={`Facture ${r.inv.supplier_invoice_number}`}
                    date={`${frDay(r.inv.invoice_date)} · échéance ${frDay(r.inv.due_date)}`}
                    amount={formatMoney(r.inv.total_ttc)}
                    note={r.inv.status !== 'draft' && remainingOf(r.inv) > 0.005 ? <span className={r.late ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}>reste {formatMoney(remainingOf(r.inv))}</span> : undefined} />
                ))}
              </ul>
            ) : (
              <table className="w-full text-sm">
                <thead className={theadRow}>
                  <tr>
                    <th className={th}>N°</th><th className={th}>Fournisseur</th><th className={th}>Facture</th><th className={th}>Date</th><th className={th}>Échéance</th>
                    <th className={thRight}>HT</th><th className={thRight}>TVA</th><th className={thRight}>TTC</th><th className={thRight}>Reste</th><th className={th}>Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map(r => (
                    <tr key={r.inv.id} onClick={() => open(r.inv.id)} className="cursor-pointer hover:bg-secondary/60">
                      <td className={`${td} whitespace-nowrap`}><Link to={`${SUPPLIER_INVOICES_PATH}/${r.inv.id}`} onClick={e => e.stopPropagation()} className="font-mono font-semibold text-primary hover:underline">{r.inv.number || 'Brouillon'}</Link></td>
                      <td className={`${td} font-medium text-foreground`}>{supplierDisplayName(r.supplier)}</td>
                      <td className={td}>{r.inv.supplier_invoice_number}</td>
                      <td className={`${td} whitespace-nowrap`}>{frDay(r.inv.invoice_date)}</td>
                      <td className={`${td} whitespace-nowrap ${r.late ? 'font-semibold text-red-600 dark:text-red-400' : ''}`}>{frDay(r.inv.due_date)}</td>
                      <td className={tdNum}>{formatMoney(r.inv.total_ht)}</td>
                      <td className={tdNum}>{formatMoney(r.inv.total_vat)}</td>
                      <td className={`${tdNum} font-semibold`}>{formatMoney(r.inv.total_ttc)}</td>
                      <td className={tdNum}>{r.inv.status === 'draft' ? '—' : formatMoney(remainingOf(r.inv))}</td>
                      <td className={td}>{statusCell(r)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className={tfootRow}>
                    <td className={td} colSpan={5}>Total ({rows.length})</td>
                    <td className={tdNum}>{formatMoney(totals.ht)}</td><td className={tdNum}>{formatMoney(totals.vat)}</td>
                    <td className={tdNum}>{formatMoney(totals.ttc)}</td><td className={tdNum}>{formatMoney(totals.remaining)}</td><td className={td} />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      )}

      {picker && <SourcePicker kind={picker} onClose={() => setPicker(null)} onPick={q => navigate(`${SUPPLIER_INVOICES_PATH}/nouvelle?${q}`)} />}
    </div>
  );
}

/** Choose the purchase order or reception an invoice is made from. */
function SourcePicker({ kind, onClose, onPick }: { kind: 'po' | 'reception'; onClose: () => void; onPick: (query: string) => void }) {
  const [pos, setPos] = useState<PurchaseOrder[] | null>(null);
  const [receptions, setReceptions] = useState<ReceptionSummary[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    (kind === 'po'
      ? PurchaseOrdersService.list().then(l => setPos(l.filter(p => p.status !== 'cancelled')))
      : PurchaseSourcesService.receptions().then(setReceptions)
    ).catch(e => setError((e as Error).message));
  }, [kind]);
  const loading = kind === 'po' ? pos === null : receptions === null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-3" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div role="dialog" aria-modal="true" aria-labelledby="source-picker-title" onClick={e => e.stopPropagation()}
        className="relative flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 id="source-picker-title" className="font-semibold text-foreground">{kind === 'po' ? 'Facture d’une commande fournisseur' : 'Facture d’une réception'}</h2>
          <button onClick={onClose} aria-label="Fermer" className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {error ? <p className="p-5 text-sm text-destructive">{error}</p> : loading ? <div className="flex justify-center p-8"><Loader className="h-5 w-5 animate-spin" /></div> : (
            <ul className="divide-y divide-border">
              {kind === 'po' && pos!.map(p => (
                <li key={p.id}><button type="button" onClick={() => onPick(`po=${p.id}`)} className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-secondary">
                  <span className="min-w-0"><span className="block font-mono text-sm font-semibold text-primary">{p.po_number}</span><span className="block truncate text-sm text-foreground">{p.provider_name || 'Sans fournisseur'}</span></span>
                  <span className="shrink-0 text-right text-xs text-muted-foreground">{frDay(p.order_date)}<br />{formatMoney(Number(p.total_ht))} TTC</span>
                </button></li>
              ))}
              {kind === 'reception' && receptions!.map(r => (
                <li key={r.sourceId}><button type="button" onClick={() => onPick(`reception=${encodeURIComponent(r.sourceId)}`)} className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-secondary">
                  <span className="min-w-0 truncate text-sm text-foreground">{r.reason}</span>
                  <span className="shrink-0 text-right text-xs text-muted-foreground">{frDay(r.date.slice(0, 10))}<br />{r.lines.length} article(s)</span>
                </button></li>
              ))}
              {((kind === 'po' && pos!.length === 0) || (kind === 'reception' && receptions!.length === 0)) && <li className="p-5 text-center text-sm text-muted-foreground">Rien à facturer.</li>}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
