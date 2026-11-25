import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronRight, Plus, Trash2, Save, CheckCircle2, Loader, BookCheck, Lock, Pencil, Wallet, FileText, AlertTriangle, Undo2 } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useAccess } from '../../hooks/useAccess';
import { useToast } from '../../context/ToastContext';
import { StatusPill } from '../../components/lists/StatusPill';
import { btnDanger, btnPrimary, btnSecondary, btnSoft, checkbox, field, fieldLabel, fieldSm, iconBtnDanger, LoadingState, panel, td, tdNum, th, thRight, theadRow } from '../../components/backoffice/BackOfficeUi';
import { formatMoney } from '../../utils/format';
import { AccountingService } from '../../utils/supabaseAccounting';
import { SupabaseCompaniesService } from '../../utils/supabaseCompanies';
import { getCompanyContext } from '../../utils/supabaseCompanyFilter';
import { PCM_SEED } from '../../accounting/pcmSeed';
import {
  accountsForNature, blankLine, DEFAULT_ACCOUNT, certificateValidOn, defaultDueDate, frDay, invoiceErrors, invoiceTotals, isGoodsAccount,
  LEGACY_VAT_RATES, linesFromCosts, matchSupplier, NATURE_LABELS, PAYMENT_MODE_LABELS, r2, remainingOf, supplierDisplayName,
  today, VAT_RATES, vatOf,
  type DueKind, type Supplier, type SupplierInvoice, type SupplierInvoiceLine, type SupplierInvoiceNature, type SupplierPayment, type SupplierPaymentMode,
} from '../../accounting/supplierInvoices';
import { cashWarning, IR_WITHHOLDING_HELP, splitPayment, suggestVatWithholding, VAT_WITHHOLDING_RATES, type CashLimitResult } from '../../accounting/supplierWithholding';
import { delayFacts } from '../../accounting/paymentDelays';
import { PurchaseSourcesService, SupplierInvoicesService, SupplierSchemaMissingError, SuppliersService } from '../../utils/supabaseSuppliers';
import { SupplierForm } from './SuppliersPage';
import { Notice, SchemaMissingNotice, SupplierStatusPill } from './SupplierUi';
import { SUPPLIER_INVOICES_PATH } from './SupplierInvoicesPage';

type Header = {
  id?: string;
  supplier_id: string;
  supplier_invoice_number: string;
  invoice_date: string;
  reception_date: string | null;
  delivery_date: string | null;
  due_date: string;
  due_kind: DueKind;
  nature: SupplierInvoiceNature;
  is_works: boolean;
  description: string;
  ir_rate: number | null;
  ir_amount: number;
  notes: string;
  source_po_id: string | null;
  source_receipt_id: string | null;
};

const newHeader = (): Header => {
  const d = today();
  return {
    supplier_id: '', supplier_invoice_number: '', invoice_date: d, reception_date: d, delivery_date: null,
    due_date: defaultDueDate({ invoice_date: d, delivery_date: null }), due_kind: 'legal', nature: 'marchandises', is_works: false,
    description: '', ir_rate: null, ir_amount: 0, notes: '', source_po_id: null, source_receipt_id: null,
  };
};

const fromInvoice = (i: SupplierInvoice): Header => ({
  id: i.id, supplier_id: i.supplier_id, supplier_invoice_number: i.supplier_invoice_number, invoice_date: i.invoice_date,
  reception_date: i.reception_date, delivery_date: i.delivery_date, due_date: i.due_date, due_kind: i.due_kind, nature: i.nature,
  is_works: i.is_works, description: i.description || '', ir_rate: i.ir_rate, ir_amount: i.ir_amount, notes: i.notes || '',
  source_po_id: i.source_po_id, source_receipt_id: i.source_receipt_id,
});

// The buyer's own case for art. 117-V-c, remembered per company on this device.
const bigBuyerKey = () => `stocky_ras_tva_societes:${getCompanyContext().companyId || ''}`;

export default function SupplierInvoiceDetailPage() {
  const { id = 'nouvelle' } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { access } = useAccess();
  const { showToast } = useToast();
  const isNew = id === 'nouvelle';

  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [invoice, setInvoice] = useState<SupplierInvoice | null>(null);
  const [payments, setPayments] = useState<SupplierPayment[]>([]);
  const [entries, setEntries] = useState<Array<{ source_id: string | null; status: string; entry_number?: number | null }>>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [accounts, setAccounts] = useState<Array<{ code: string; label: string }>>([]);
  const [products, setProducts] = useState<Map<string, string>>(new Map());
  const [vatRate, setVatRate] = useState(20);
  const [header, setHeader] = useState<Header>(newHeader);
  const [lines, setLines] = useState<SupplierInvoiceLine[]>([]);
  const [editing, setEditing] = useState(isNew);
  const [dueTouched, setDueTouched] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [newSupplier, setNewSupplier] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const supplier = suppliers.find(s => s.id === header.supplier_id);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { companyId } = getCompanyContext();
      const [sup, chart, names, company] = await Promise.all([
        SuppliersService.list(),
        AccountingService.listAccounts().catch(() => []),
        PurchaseSourcesService.productNames(),
        companyId ? SupabaseCompaniesService.getCompanyById(companyId).catch(() => null) : Promise.resolve(null),
      ]);
      setSuppliers(sup);
      setAccounts(chart.length ? chart.filter(a => a.active !== false) : PCM_SEED);
      setProducts(names);
      const rate = Number(company?.tva_rate ?? 20);
      setVatRate(rate);
      setMissing(false);
      if (isNew) {
        const h = newHeader();
        let prefill: SupplierInvoiceLine[] = [];
        const poId = params.get('po');
        const receptionId = params.get('reception');
        if (poId || receptionId) {
          const po = await PurchaseSourcesService.purchaseOrder(poId || receptionId!).catch(() => null);
          if (poId && po) {
            const received = po.items.some(i => i.qty_received > 0);
            prefill = linesFromCosts(po.items.map(i => ({ barcode: i.barcode, label: i.label, quantity: received ? i.qty_received : i.qty_ordered, unitCostTtc: i.unit_cost })), rate);
            h.source_po_id = po.id;
            h.description = `Commande ${po.po_number}`;
          }
          if (receptionId) {
            const rec = (await PurchaseSourcesService.receptions(366)).find(r => r.sourceId === receptionId);
            if (rec) {
              prefill = linesFromCosts(rec.lines.map(l => ({ barcode: l.barcode, label: names.get(l.barcode) || l.barcode, quantity: l.quantity, unitCostTtc: l.unitCost })), rate);
              h.source_receipt_id = rec.sourceId;
              h.reception_date = rec.date.slice(0, 10);
              h.delivery_date = rec.date.slice(0, 10);
              h.description = rec.reason;
              if (po) h.source_po_id = po.id;
            }
          }
          const match = po ? matchSupplier(sup, po) : undefined;
          if (match) {
            h.supplier_id = match.id;
            h.due_date = defaultDueDate(h, match.payment_days);
            h.due_kind = match.payment_days > 60 ? 'agreed' : 'legal';
          }
        }
        setHeader(h);
        setLines(prefill.length ? prefill : [blankLine('marchandises', 0, rate)]);
        setEditing(true);
      } else {
        const inv = await SupplierInvoicesService.get(id);
        if (!inv) { setNotFound(true); return; }
        const [pay, led] = await Promise.all([SupplierInvoicesService.payments(id), SupplierInvoicesService.ledgerEntries()]);
        setInvoice(inv); setPayments(pay); setEntries(led);
        setHeader(fromInvoice(inv)); setLines(inv.lines || []);
        setEditing(inv.status === 'draft');
        setDueTouched(true);
      }
    } catch (e) {
      if (e instanceof SupplierSchemaMissingError) setMissing(true);
      else showToast({ type: 'error', title: 'Erreur', message: (e as Error).message });
    } finally { setLoading(false); }
  }, [id, isNew, params, showToast]);
  useEffect(() => { load(); }, [load]);

  const booking = invoice ? SupplierInvoicesService.bookingOf(entries, 'invoice', invoice.id) : 'none';
  const booked = booking === 'posted';
  const totals = useMemo(() => invoiceTotals(lines), [lines]);
  const errors = useMemo(() => invoiceErrors(header, lines), [header, lines]);
  const natureAccounts = useMemo(() => accountsForNature(accounts, header.nature), [accounts, header.nature]);

  // The due date follows the invoice date, delivery and supplier until typed by hand.
  const setH = <K extends keyof Header>(k: K, v: Header[K]) => setHeader(prev => {
    const next = { ...prev, [k]: v };
    if (!dueTouched && (k === 'invoice_date' || k === 'delivery_date' || k === 'supplier_id')) {
      const s = suppliers.find(x => x.id === next.supplier_id);
      if (next.invoice_date) next.due_date = defaultDueDate(next, s?.payment_days);
      next.due_kind = (s?.payment_days ?? 60) > 60 ? 'agreed' : 'legal';
    }
    if (k === 'nature' && v !== 'services') { next.ir_rate = null; next.ir_amount = 0; }
    if (k === 'ir_rate') next.ir_amount = v == null ? 0 : r2(totals.ht * Number(v) / 100);
    return next;
  });

  const setLine = (i: number, patch: Partial<SupplierInvoiceLine>) => setLines(prev => prev.map((l, idx) => {
    if (idx !== i) return l;
    const next = { ...l, ...patch };
    if ('amount_ht' in patch || 'vat_rate' in patch) next.vat_amount = vatOf(next.amount_ht, next.vat_rate);
    if ('barcode' in patch && patch.barcode && !l.label) next.label = products.get(patch.barcode) || next.label;
    return next;
  }));

  const save = async (andValidate = false) => {
    if (errors.length) { showToast({ type: 'error', title: 'À corriger', message: errors[0] }); return; }
    setBusy(andValidate ? 'validate' : 'save');
    try {
      const saved = await SupplierInvoicesService.save({ ...header, company_id: invoice?.company_id }, lines, currentUser?.username);
      if (andValidate) {
        const number = await SupplierInvoicesService.validate(saved.id);
        showToast({ type: 'success', title: 'Facture validée', message: number });
      } else showToast({ type: 'success', message: 'Facture enregistrée' });
      if (isNew) navigate(`${SUPPLIER_INVOICES_PATH}/${saved.id}`, { replace: true });
      else await load();
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: (e as Error).message });
    } finally { setBusy(null); }
  };

  const validate = async () => {
    if (!invoice) return;
    if (editing) return save(true);
    setBusy('validate');
    try { const n = await SupplierInvoicesService.validate(invoice.id); showToast({ type: 'success', title: 'Facture validée', message: n }); await load(); }
    catch (e) { showToast({ type: 'error', title: 'Erreur', message: (e as Error).message }); }
    finally { setBusy(null); }
  };

  const remove = async () => {
    if (!invoice || !confirm('Supprimer cette facture fournisseur ?')) return;
    setBusy('delete');
    try { await SupplierInvoicesService.remove(invoice.id); navigate(SUPPLIER_INVOICES_PATH); }
    catch (e) { showToast({ type: 'error', title: 'Suppression impossible', message: (e as Error).message }); setBusy(null); }
  };

  const post = async () => {
    if (!invoice) return;
    setBusy('post');
    try {
      await SupplierInvoicesService.postInvoice({ ...invoice, lines }, supplier, { createdBy: currentUser?.username || null });
      showToast({ type: 'success', title: 'Écriture créée', message: 'Brouillon dans le journal des achats : validez-le dans Saisie / journaux.' });
      await load();
    } catch (e) { showToast({ type: 'error', title: 'Erreur', message: (e as Error).message }); }
    finally { setBusy(null); }
  };

  if (loading) return <LoadingState />;
  if (missing) return <SchemaMissingNotice />;
  if (notFound) return (
    <div className="mx-auto max-w-md py-16 text-center">
      <FileText className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <p className="mt-3 font-medium text-foreground">Facture introuvable</p>
      <Link to={SUPPLIER_INVOICES_PATH} className="mt-3 inline-block text-sm font-semibold text-primary hover:underline">Retour aux factures fournisseurs</Link>
    </div>
  );

  const ro = !editing;
  const title = isNew ? 'Nouvelle facture fournisseur' : `Facture ${invoice?.number || 'brouillon'} · ${supplierDisplayName(supplier)}`;
  const rates = header.invoice_date < '2026-01-01' ? [...VAT_RATES, ...LEGACY_VAT_RATES] : [...VAT_RATES];
  const facts = invoice && invoice.status !== 'draft' ? delayFacts(invoice, payments, today()) : null;

  return (
    <div className="mx-auto max-w-[110rem] pb-24 md:pb-0">
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0">
          <nav aria-label="Fil d’Ariane" className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex">
            <Link to={SUPPLIER_INVOICES_PATH} className="hover:text-foreground">Factures fournisseurs</Link>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-foreground">{isNew ? 'Nouvelle' : invoice?.number || 'Brouillon'}</span>
          </nav>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{title}</h1>
        </div>
        {invoice && <SupplierStatusPill status={invoice.status} />}
        {booking === 'posted' && <StatusPill tone="success" icon={<Lock className="h-3 w-3" />}>Comptabilisée</StatusPill>}
        {booking === 'draft' && <StatusPill tone="info">Écriture en brouillon</StatusPill>}
      </div>

      {booked && <div className="mb-4"><Notice tone="info">Cette facture fournisseur est comptabilisée. Extournez son écriture dans Comptabilité pour la modifier.</Notice></div>}
      {invoice?.cash_over_limit && <div className="mb-4"><Notice tone="warning">Un règlement en espèces dépasse les plafonds légaux : une partie de la TVA n’est pas récupérable et une partie de la charge n’est pas déductible (voir les règlements).</Notice></div>}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <section className={`${panel} grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3`}>
            <div className="sm:col-span-2 xl:col-span-1">
              <label htmlFor="si-supplier" className={fieldLabel}>Fournisseur</label>
              <div className="flex gap-2">
                <select id="si-supplier" value={header.supplier_id} disabled={ro} onChange={e => setH('supplier_id', e.target.value)} className={field}>
                  <option value="">— Choisir —</option>
                  {suppliers.filter(s => s.active !== false || s.id === header.supplier_id).map(s => <option key={s.id} value={s.id}>{supplierDisplayName(s)}</option>)}
                </select>
                {!ro && <button type="button" onClick={() => setNewSupplier(true)} className={btnSecondary} aria-label="Nouveau fournisseur" title="Nouveau fournisseur"><Plus className="h-4 w-4" /></button>}
              </div>
              {supplier && (
                <p className="mt-1 text-xs text-muted-foreground">
                  ICE {supplier.ice || '—'} · IF {supplier.if_number || '—'} · délai {supplier.payment_days} j ·{' '}
                  {certificateValidOn(supplier.tax_certificate_date, today()) ? 'attestation fiscale valide' : 'pas d’attestation fiscale valide'}
                </p>
              )}
            </div>
            <Field id="si-number" label="N° de la facture du fournisseur" value={header.supplier_invoice_number} ro={ro} onChange={v => setH('supplier_invoice_number', v)} />
            <div>
              <label htmlFor="si-nature" className={fieldLabel}>Nature</label>
              <select id="si-nature" value={header.nature} disabled={ro} onChange={e => {
                const next = e.target.value as SupplierInvoiceNature;
                // Lines still on the old nature's default account follow the new nature.
                setLines(prev => prev.map(l => (l.account_code === DEFAULT_ACCOUNT[header.nature] ? { ...l, account_code: DEFAULT_ACCOUNT[next] } : l)));
                setH('nature', next);
              }} className={field}>
                {(Object.keys(NATURE_LABELS) as SupplierInvoiceNature[]).map(n => <option key={n} value={n}>{NATURE_LABELS[n]}</option>)}
              </select>
              {header.nature !== 'marchandises' && (
                <label className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" className={checkbox} disabled={ro} checked={header.is_works} onChange={e => setH('is_works', e.target.checked)} />Travaux (construction, installation…)
                </label>
              )}
            </div>
            <Field id="si-date" type="date" label="Date de la facture" value={header.invoice_date} ro={ro} onChange={v => setH('invoice_date', v)} />
            <Field id="si-reception" type="date" label="Date de réception" value={header.reception_date || ''} ro={ro} onChange={v => setH('reception_date', v || null)} />
            <Field id="si-delivery" type="date" label="Date de livraison / fin des travaux" value={header.delivery_date || ''} ro={ro} onChange={v => setH('delivery_date', v || null)} />
            <div>
              <label htmlFor="si-due" className={fieldLabel}>Échéance</label>
              <input id="si-due" type="date" value={header.due_date} disabled={ro} onChange={e => { setDueTouched(true); setH('due_date', e.target.value); }} className={field} />
              <div className="mt-1.5 flex gap-3 text-xs text-muted-foreground">
                {(['legal', 'agreed'] as const).map(k => (
                  <label key={k} className="flex items-center gap-1">
                    <input type="radio" name="due_kind" disabled={ro} checked={header.due_kind === k} onChange={() => setH('due_kind', k)} />
                    {k === 'legal' ? 'Sans accord (60 j)' : 'Délai convenu (120 j max.)'}
                  </label>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <Field id="si-desc" label="Nature des marchandises, travaux ou services (déclaration des délais)" value={header.description} ro={ro} onChange={v => setH('description', v)} />
            </div>
          </section>

          <section className={`${panel} overflow-hidden`}>
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
              <h2 className="font-semibold text-foreground">Lignes</h2>
              {!ro && <button type="button" onClick={() => setLines(prev => [...prev, blankLine(header.nature, prev.length, vatRate)])} className={btnSoft}><Plus className="h-3.5 w-3.5" />Ajouter une ligne</button>}
            </div>
            {!ro && <p className="px-4 pt-3 text-xs text-muted-foreground sm:px-5">Montants hors taxe, comme sur la facture. Les lignes reprises d’une commande ou d’une réception ont été converties en HT (les coûts y sont saisis TTC). Une ligne de marchandises (compte 6111) indique l’article et la quantité.</p>}
            <datalist id="si-products">{[...products].slice(0, 3000).map(([bc, name]) => <option key={bc} value={bc}>{name}</option>)}</datalist>
            <datalist id="si-accounts">{natureAccounts.map(a => <option key={a.code} value={a.code}>{a.label}</option>)}</datalist>
            <ul className="divide-y divide-border">
              {lines.map((l, i) => (
                <li key={i} className="grid gap-2 px-4 py-3 sm:px-5 md:grid-cols-[minmax(0,1.6fr)_8rem_5rem_6rem_8rem_6rem_6.5rem_2.5rem] md:items-end">
                  <Cell label="Libellé"><input aria-label={`Libellé ligne ${i + 1}`} value={l.label} disabled={ro} onChange={e => setLine(i, { label: e.target.value })} className={fieldSm} /></Cell>
                  <Cell label="Article"><input aria-label={`Article ligne ${i + 1}`} list="si-products" value={l.barcode || ''} disabled={ro} onChange={e => setLine(i, { barcode: e.target.value || null })} className={`${fieldSm} font-mono`} placeholder={isGoodsAccount(l.account_code) ? 'Code' : '—'} /></Cell>
                  <Cell label="Qté"><input aria-label={`Quantité ligne ${i + 1}`} type="number" min={0} step="any" value={l.quantity ?? ''} disabled={ro} onChange={e => setLine(i, { quantity: e.target.value === '' ? null : Number(e.target.value) })} className={`${fieldSm} text-right`} /></Cell>
                  <Cell label="Compte"><input aria-label={`Compte ligne ${i + 1}`} list="si-accounts" value={l.account_code} disabled={ro} onChange={e => setLine(i, { account_code: e.target.value.trim() })} className={`${fieldSm} font-mono`} /></Cell>
                  <Cell label="Montant HT"><input aria-label={`Montant HT ligne ${i + 1}`} type="number" step="0.01" value={l.amount_ht} disabled={ro} onChange={e => setLine(i, { amount_ht: Number(e.target.value) })} className={`${fieldSm} text-right`} /></Cell>
                  <Cell label="TVA">
                    <select aria-label={`Taux de TVA ligne ${i + 1}`} value={l.vat_rate} disabled={ro} onChange={e => setLine(i, { vat_rate: Number(e.target.value) })} className={fieldSm}>
                      {[...new Set([...rates, l.vat_rate])].map(r => <option key={r} value={r}>{r} %</option>)}
                    </select>
                  </Cell>
                  <Cell label="Montant TVA">
                    <input aria-label={`Montant TVA ligne ${i + 1}`} type="number" step="0.01" value={l.vat_amount} disabled={ro} onChange={e => setLine(i, { vat_amount: Number(e.target.value) })} className={`${fieldSm} text-right`} />
                    <label className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground" title="Véhicules de tourisme, cadeaux, réceptions… (art. 106) : la TVA s’ajoute au coût">
                      <input type="checkbox" className={checkbox} disabled={ro} checked={l.vat_nondeductible} onChange={e => setLine(i, { vat_nondeductible: e.target.checked })} />non déductible
                    </label>
                  </Cell>
                  <div className="flex md:justify-end">{!ro && <button type="button" aria-label={`Retirer la ligne ${i + 1}`} onClick={() => setLines(prev => prev.filter((_, idx) => idx !== i))} className={iconBtnDanger}><Trash2 className="h-4 w-4" /></button>}</div>
                </li>
              ))}
              {lines.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted-foreground">Aucune ligne.</li>}
            </ul>
          </section>

          {header.nature === 'services' && (
            <section className={`${panel} p-4 sm:p-5`}>
              <h2 className="font-semibold text-foreground">Retenue à la source IR / IS (honoraires)</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="si-ir-rate" className={fieldLabel}>Taux (%)</label>
                  <select id="si-ir-rate" value={header.ir_rate ?? ''} disabled={ro} onChange={e => setH('ir_rate', e.target.value === '' ? null : Number(e.target.value))} className={field}>
                    <option value="">Aucune retenue</option>
                    {[5, 10, 20, 30].map(r => <option key={r} value={r}>{r} %</option>)}
                  </select>
                </div>
                <Field id="si-ir-amount" type="number" label="Montant retenu" value={String(header.ir_amount)} ro={ro} onChange={v => setH('ir_amount', Number(v) || 0)} />
              </div>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">{IR_WITHHOLDING_HELP.map(h => <li key={h}>{h}</li>)}</ul>
            </section>
          )}

          {invoice && invoice.status !== 'draft' && (
            <PaymentsSection invoice={invoice} supplier={supplier} payments={payments} entries={entries} canPost={access.accounting}
              user={currentUser?.username || null} onChange={load} />
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4" aria-label="Totaux et actions">
          <section className={`${panel} p-5`}>
            <h2 className="font-semibold text-foreground">Totaux</h2>
            <table className="mt-3 w-full text-sm">
              <thead><tr className="text-xs text-muted-foreground"><th className="text-left font-medium">Taux</th><th className="text-right font-medium">Base HT</th><th className="text-right font-medium">TVA</th><th className="text-right font-medium">TTC</th></tr></thead>
              <tbody>
                {totals.byRate.map(t => (
                  <tr key={t.rate}><td className="py-1">{t.rate} %</td><td className="py-1 text-right tabular-nums">{formatMoney(t.base)}</td><td className="py-1 text-right tabular-nums">{formatMoney(t.vat)}</td><td className="py-1 text-right tabular-nums">{formatMoney(t.ttc)}</td></tr>
                ))}
              </tbody>
            </table>
            <dl className="mt-3 space-y-1.5 border-t border-border pt-3 text-sm">
              <Row label="Total HT" value={formatMoney(totals.ht)} />
              <Row label="TVA" value={formatMoney(totals.vat)} />
              {totals.nonDeductibleVat > 0 && <Row label="dont non déductible" value={formatMoney(totals.nonDeductibleVat)} />}
              <Row label="Total TTC" value={formatMoney(totals.ttc)} strong />
              {header.ir_amount > 0 && <Row label="Retenue IR/IS" value={formatMoney(header.ir_amount)} />}
              {invoice && invoice.status !== 'draft' && <Row label="Reste à payer" value={formatMoney(remainingOf(invoice))} strong />}
            </dl>
            {facts && facts.daysLate > 0 && !facts.excluded && (
              <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-800 dark:text-red-200">
                {facts.unpaid > 0.005 ? `${facts.daysLate} jours de retard` : 'Payée en retard'} : amende estimée {formatMoney(facts.fine)} (taux directeur {facts.keyRate.rate.toLocaleString('fr-FR')} % le 1er mois, puis 0,85 % par mois).
              </p>
            )}
            {editing && errors.length > 0 && <p role="alert" className="mt-3 text-xs text-destructive">{errors[0]}</p>}
            <div className="mt-4 space-y-2">
              {editing && (
                <button onClick={() => save(false)} disabled={busy !== null} className={`${btnSecondary} w-full`}>
                  {busy === 'save' ? <Loader className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Enregistrer
                </button>
              )}
              {(isNew || invoice?.status === 'draft') && (
                <button onClick={() => (isNew ? save(true) : validate())} disabled={busy !== null || errors.length > 0} className={`${btnPrimary} w-full`}>
                  {busy === 'validate' ? <Loader className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Valider la facture
                </button>
              )}
              {invoice && !editing && !booked && (
                <button onClick={() => setEditing(true)} className={`${btnSecondary} w-full`}><Pencil className="h-4 w-4" />Modifier</button>
              )}
              {invoice && editing && invoice.status !== 'draft' && (
                <button onClick={() => { setHeader(fromInvoice(invoice)); setLines(invoice.lines || []); setEditing(false); }} className={`${btnSecondary} w-full`}><Undo2 className="h-4 w-4" />Annuler les modifications</button>
              )}
              {invoice && invoice.status !== 'draft' && access.accounting && booking === 'none' && (
                <button onClick={post} disabled={busy !== null || editing} className={`${btnPrimary} w-full`}>
                  {busy === 'post' ? <Loader className="h-4 w-4 animate-spin" /> : <BookCheck className="h-4 w-4" />}Comptabiliser
                </button>
              )}
              {invoice && !booked && payments.length === 0 && (
                <button onClick={remove} disabled={busy !== null} className={`${btnDanger} w-full`}><Trash2 className="h-4 w-4" />Supprimer</button>
              )}
            </div>
          </section>
          <section className={`${panel} p-5 text-sm`}>
            <h2 className="font-semibold text-foreground">Notes</h2>
            <textarea aria-label="Notes" value={header.notes} disabled={ro} onChange={e => setH('notes', e.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-70" />
            {invoice?.source_po_id && <p className="mt-2 text-xs"><Link to={`/inventaire/commandes/${invoice.source_po_id}`} className="text-primary hover:underline">Voir la commande d’origine</Link></p>}
          </section>
        </aside>
      </div>

      {newSupplier && (
        <SupplierForm initial={{ name: '', legal_type: 'societe', payment_days: 60 }} user={currentUser?.username || null}
          onClose={() => setNewSupplier(false)}
          onSaved={s => { setNewSupplier(false); setSuppliers(prev => [...prev, s].sort((a, b) => a.name.localeCompare(b.name, 'fr'))); setH('supplier_id', s.id); }} />
      )}
    </div>
  );
}

function Field({ id, label, value, onChange, ro, type = 'text' }: { id: string; label: string; value: string; onChange: (v: string) => void; ro: boolean; type?: string }) {
  return (
    <div>
      <label htmlFor={id} className={fieldLabel}>{label}</label>
      <input id={id} type={type} value={value} disabled={ro} onChange={e => onChange(e.target.value)} className={field} step={type === 'number' ? '0.01' : undefined} />
    </div>
  );
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>{children}</div>;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className={`flex justify-between gap-2 ${strong ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}><dt>{label}</dt><dd className="tabular-nums">{value}</dd></div>;
}

// ── Payments ────────────────────────────────────────────────────────────────
function PaymentsSection({ invoice, supplier, payments, entries, canPost, user, onChange }: {
  invoice: SupplierInvoice; supplier: Supplier | undefined; payments: SupplierPayment[];
  entries: Array<{ source_id: string | null; status: string }>; canPost: boolean; user: string | null; onChange: () => Promise<void> | void;
}) {
  const { showToast } = useToast();
  const remaining = remainingOf(invoice);
  const [date, setDate] = useState(today());
  const [settled, setSettled] = useState(remaining);
  const [mode, setMode] = useState<SupplierPaymentMode>('virement');
  const [reference, setReference] = useState('');
  const [bank, setBank] = useState('');
  const [bigBuyer, setBigBuyer] = useState(() => { try { return localStorage.getItem(bigBuyerKey()) === '1'; } catch { return false; } });
  const irAlready = r2(payments.reduce((s, p) => s + p.ir_withheld, 0));
  const suggestion = suggestVatWithholding({
    legalType: supplier?.legal_type || 'societe', nature: invoice.nature, isWorks: invoice.is_works,
    certificateDate: supplier?.tax_certificate_date, paymentDate: date, invoiceTtc: invoice.total_ttc, buyerWithholdsOnCompanies: bigBuyer,
  });
  const [vatRateW, setVatRateW] = useState<number>(suggestion.rate);
  const closes = settled >= remaining - 0.005;
  const auto = splitPayment({ settled, invoiceTtc: invoice.total_ttc, invoiceVat: invoice.total_vat, vatRate: vatRateW, invoiceIr: invoice.ir_amount, irAlreadyWithheld: irAlready, closesInvoice: closes });
  const [vatW, setVatW] = useState<number | null>(null);
  const [irW, setIrW] = useState<number | null>(null);
  const vatWithheld = vatW ?? auto.vatWithheld;
  const irWithheld = irW ?? auto.irWithheld;
  const cash = r2(settled - vatWithheld - irWithheld);
  const [cashCheck, setCashCheck] = useState<CashLimitResult | undefined>();
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { setSettled(remaining); }, [remaining]);
  useEffect(() => { setVatRateW(suggestion.rate); setVatW(null); }, [suggestion.rate]);
  useEffect(() => {
    let live = true;
    const ratio = invoice.total_ttc > 0 ? (invoice.total_vat - invoice.total_nondeductible_vat) / invoice.total_ttc : 0;
    SupplierInvoicesService.previewCashLimits({ supplier_id: invoice.supplier_id, payment_date: date, amount: cash, mode }, ratio)
      .then(r => { if (live) setCashCheck(r); }).catch(() => {});
    return () => { live = false; };
  }, [invoice, date, cash, mode]);

  const add = async () => {
    setSaving(true);
    try {
      await SupplierInvoicesService.addPayment({
        invoice_id: invoice.id, supplier_id: invoice.supplier_id, payment_date: date, amount: cash, mode, reference, bank,
        vat_withholding_rate: vatRateW, vat_withheld: vatWithheld, ir_withheld: irWithheld, notes: null, created_by: user,
      }, invoice);
      showToast({ type: 'success', message: 'Règlement enregistré' });
      setVatW(null); setIrW(null); setReference('');
      await onChange();
    } catch (e) { showToast({ type: 'error', title: 'Erreur', message: (e as Error).message }); }
    finally { setSaving(false); }
  };

  const remove = async (p: SupplierPayment) => {
    if (!confirm('Supprimer ce règlement ?')) return;
    setBusy(p.id);
    try { await SupplierInvoicesService.removePayment(p); await onChange(); }
    catch (e) { showToast({ type: 'error', title: 'Suppression impossible', message: (e as Error).message }); }
    finally { setBusy(null); }
  };

  const post = async (p: SupplierPayment) => {
    setBusy(p.id);
    try {
      await SupplierInvoicesService.postPayment(p, invoice, supplier, { createdBy: user });
      showToast({ type: 'success', title: 'Écriture créée', message: 'Brouillon en banque / caisse : validez-le dans Saisie / journaux.' });
      await onChange();
    } catch (e) { showToast({ type: 'error', title: 'Erreur', message: (e as Error).message }); }
    finally { setBusy(null); }
  };

  const warning = cashWarning(cashCheck);
  return (
    <section className={`${panel} overflow-hidden`}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <h2 className="flex items-center gap-2 font-semibold text-foreground"><Wallet className="h-4 w-4" aria-hidden="true" />Règlements</h2>
        <span className="text-sm text-muted-foreground">Reste {formatMoney(remaining)}</span>
      </div>
      {payments.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={theadRow}><tr><th className={th}>Date</th><th className={th}>Mode</th><th className={thRight}>Versé</th><th className={thRight}>TVA retenue</th><th className={thRight}>IR/IS retenu</th><th className={th}>Écriture</th><th className={th} aria-label="Actions" /></tr></thead>
            <tbody className="divide-y divide-border">
              {payments.map(p => {
                const state = SupplierInvoicesService.bookingOf(entries, 'payment', p.id);
                return (
                  <tr key={p.id}>
                    <td className={`${td} whitespace-nowrap`}>{frDay(p.payment_date)}</td>
                    <td className={td}>{PAYMENT_MODE_LABELS[p.mode] || p.mode}{p.reference ? ` · ${p.reference}` : ''}
                      {(p.cash_vat_nondeductible > 0 || p.cash_expense_nondeductible > 0) && <span className="mt-0.5 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle className="h-3 w-3" />TVA perdue {formatMoney(p.cash_vat_nondeductible)} · charge non déductible {formatMoney(p.cash_expense_nondeductible)}</span>}
                    </td>
                    <td className={tdNum}>{formatMoney(p.amount)}</td>
                    <td className={tdNum}>{p.vat_withheld > 0 ? `${formatMoney(p.vat_withheld)} (${p.vat_withholding_rate} %)` : '—'}</td>
                    <td className={tdNum}>{p.ir_withheld > 0 ? formatMoney(p.ir_withheld) : '—'}</td>
                    <td className={td}>{state === 'posted' ? <StatusPill tone="success">Comptabilisé</StatusPill> : state === 'draft' ? <StatusPill tone="info">Brouillon</StatusPill> : canPost
                      ? <button onClick={() => post(p)} disabled={busy === p.id} className={btnSoft}><BookCheck className="h-3.5 w-3.5" />Comptabiliser</button>
                      : <span className="text-xs text-muted-foreground">À comptabiliser</span>}</td>
                    <td className={`${td} text-right`}>{state !== 'posted' && <button onClick={() => remove(p)} disabled={busy === p.id} aria-label="Supprimer le règlement" className={iconBtnDanger}><Trash2 className="h-4 w-4" /></button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {remaining > 0.005 && (
        <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">
          <div><label htmlFor="pay-date" className={fieldLabel}>Date du règlement</label><input id="pay-date" type="date" value={date} onChange={e => setDate(e.target.value)} className={field} /></div>
          <div><label htmlFor="pay-settled" className={fieldLabel}>Montant soldé (TTC)</label><input id="pay-settled" type="number" step="0.01" min={0} max={remaining} value={settled} onChange={e => { setSettled(Number(e.target.value)); setVatW(null); setIrW(null); }} className={field} /></div>
          <div>
            <label htmlFor="pay-mode" className={fieldLabel}>Mode</label>
            <select id="pay-mode" value={mode} onChange={e => setMode(e.target.value as SupplierPaymentMode)} className={field}>
              {(Object.keys(PAYMENT_MODE_LABELS) as SupplierPaymentMode[]).map(m => <option key={m} value={m}>{PAYMENT_MODE_LABELS[m]}</option>)}
            </select>
            {mode === 'cheque' && <p className="mt-1 text-xs text-muted-foreground">Chèque barré non endossable pour garder la déduction.</p>}
          </div>
          <div><label htmlFor="pay-ref" className={fieldLabel}>Référence</label><input id="pay-ref" value={reference} onChange={e => setReference(e.target.value)} className={field} /></div>
          <div><label htmlFor="pay-bank" className={fieldLabel}>Banque</label><input id="pay-bank" value={bank} onChange={e => setBank(e.target.value)} className={field} /></div>
          <div>
            <label htmlFor="pay-vat-rate" className={fieldLabel}>Retenue de TVA à la source</label>
            <select id="pay-vat-rate" value={vatRateW} onChange={e => { setVatRateW(Number(e.target.value)); setVatW(null); }} className={field}>
              {VAT_WITHHOLDING_RATES.map(r => <option key={r} value={r}>{r === 0 ? 'Aucune' : `${r} % de la TVA`}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2 xl:col-span-3">
            <Notice tone={suggestion.rate > 0 ? 'warning' : 'info'}>
              <span className="font-semibold">Suggestion : {suggestion.rate === 0 ? 'pas de retenue' : `${suggestion.rate} % de la TVA`}.</span> {suggestion.reason}
              {vatRateW !== suggestion.rate && <button type="button" onClick={() => { setVatRateW(suggestion.rate); setVatW(null); }} className="ml-2 font-semibold underline">Appliquer</button>}
            </Notice>
            {invoice.nature === 'services' && supplier?.legal_type !== 'personne_physique' && (
              <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" className={checkbox} checked={bigBuyer} onChange={e => { setBigBuyer(e.target.checked); try { localStorage.setItem(bigBuyerKey(), e.target.checked ? '1' : '0'); } catch { /* storage unavailable */ } }} />
                Notre entreprise retient aussi sur les sociétés (banque, assurance, ou CA au-delà du seuil de la LF 2026 : 500 M MAD dès juillet 2026, 350 M en 2027, 200 M en 2028)
              </label>
            )}
          </div>
          <div><label htmlFor="pay-vat" className={fieldLabel}>TVA retenue</label><input id="pay-vat" type="number" step="0.01" min={0} value={vatWithheld} onChange={e => setVatW(Number(e.target.value))} className={field} /></div>
          <div><label htmlFor="pay-ir" className={fieldLabel}>IR/IS retenu</label><input id="pay-ir" type="number" step="0.01" min={0} value={irWithheld} onChange={e => setIrW(Number(e.target.value))} className={field} /></div>
          <div className="flex flex-col justify-end">
            <p className="text-sm text-muted-foreground">Versé au fournisseur</p>
            <p className="text-lg font-bold tabular-nums text-foreground">{formatMoney(cash)}</p>
          </div>
          {warning && <div className="sm:col-span-2 xl:col-span-3"><Notice tone="danger">{warning}</Notice></div>}
          <div className="sm:col-span-2 xl:col-span-3">
            <button onClick={add} disabled={saving || !(settled > 0) || cash < 0} className={btnPrimary}>
              {saving ? <Loader className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Enregistrer le règlement
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
