import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Loader, Check, Zap, FileText, Wallet, Undo2, Users } from 'lucide-react';
import type { Quote, Payslip, FiscalYear, Journal } from '../../types';
import { AccountingService } from '../../utils/supabaseAccounting';
import { SupabaseDocumentsService } from '../../utils/supabaseDocuments';
import { SupabasePayslipsService } from '../../utils/supabasePayslips';
import { CompanySettingsService } from '../../utils/companySettings';
import { getCompanyContext } from '../../utils/supabaseCompanyFilter';
import { buildInvoiceEntry, buildAvoirEntry, buildPaymentEntries, buildPayslipEntry, type EntryDraft } from '../../accounting/postingRules';
import { invoicePayment } from '../../utils/documentLines';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Panel } from '../../components/PageHeader';
import { StatusPill } from '../../components/lists/StatusPill';
import { btnPrimary, btnSoft, checkbox, KpiTile, LoadingState, PhoneActionBar } from '../../components/backoffice/BackOfficeUi';
import { SupplierPostingSection } from '../fournisseurs/SupplierPostingSection';

function fmtMad(n: number) { return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n) + ' MAD'; }

// Documents for the signed-in company's books (the issuer's books).
const ledgerDocs = (type: 'invoice' | 'avoir') => {
  const { companyId } = getCompanyContext();
  return companyId ? SupabaseDocumentsService.getForLedger(type, companyId) : SupabaseDocumentsService.getAllByType(type);
};

export default function AComptabiliserPage() {
  const { currentUser } = useAuth();
  const { showToast } = useToast();

  const [fy, setFy] = useState<FiscalYear | null>(null);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [invoices, setInvoices] = useState<Quote[]>([]);
  const [avoirs, setAvoirs] = useState<Quote[]>([]);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [postedIds, setPostedIds] = useState<Set<string>>(new Set());
  const [paymentTotals, setPaymentTotals] = useState<Map<string, { amount: number; count: number }>>(new Map());
  const [loanAmounts, setLoanAmounts] = useState<Map<string, number>>(new Map());
  const [tvaRate, setTvaRate] = useState(20);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [autoPost, setAutoPost] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [year, j, inv, av, ps, posted, payTotals] = await Promise.all([
        AccountingService.ensureCurrentFiscalYear(),
        AccountingService.listJournals(),
        ledgerDocs('invoice'),
        ledgerDocs('avoir'),
        SupabasePayslipsService.list().catch(() => [] as Payslip[]),
        AccountingService.postedSourceIds(),
        AccountingService.paymentPostedTotals(),
      ]);
      setFy(year); setJournals(j); setInvoices(inv); setAvoirs(av); setPayslips(ps); setPostedIds(posted); setPaymentTotals(payTotals);
      setLoanAmounts(await SupabasePayslipsService.loanDeductions(ps).catch(() => new Map()));
      const { companyId } = getCompanyContext();
      if (companyId) {
        const s = await CompanySettingsService.getSettings(companyId).catch(() => null);
        if (s?.tva_rate != null) setTvaRate(s.tva_rate);
      }
    } catch (e: any) {
      showToast({ type: 'error', message: e?.message || 'Erreur de chargement' });
    } finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const opts = () => ({ post: autoPost, createdBy: currentUser?.username || null });

  // Each entry goes into the fiscal year of its own date.
  const generate = async (drafts: EntryDraft[], key: string) => {
    if (drafts.length === 0) return;
    setBusy(key);
    try {
      for (const d of drafts) await AccountingService.createFromDraft(d, journals, opts());
      showToast({ type: 'success', message: autoPost ? 'Écriture validée' : 'Brouillon généré' });
      await load();
    } catch (e: any) {
      showToast({ type: 'error', title: 'Erreur', message: e?.message || 'Échec' });
    } finally { setBusy(null); }
  };

  const paymentDrafts = useCallback((q: Quote) => {
    const t = paymentTotals.get(q.id) || { amount: 0, count: 0 };
    return buildPaymentEntries(q, t.amount, t.count);
  }, [paymentTotals]);
  // A payslip posted through its pay run is already in the books.
  const inPostedRun = useCallback((p: Payslip) => !!p.run_id && postedIds.has(`run:${p.run_id}`), [postedIds]);
  const payslipDraft = (p: Payslip) => buildPayslipEntry(p, (p as any).employee?.full_name, loanAmounts.get(p.id) || 0);

  const pending = useMemo(() => {
    const inv = invoices.filter(q => !postedIds.has(q.id));
    const invPay = invoices.filter(q => paymentDrafts(q).length > 0);
    const av = avoirs.filter(q => !postedIds.has(q.id));
    const ps = payslips.filter(p => !postedIds.has(p.id) && !inPostedRun(p));
    return { inv, invPay, av, ps, total: inv.length + invPay.length + av.length + ps.length };
  }, [invoices, avoirs, payslips, postedIds, paymentDrafts, inPostedRun]);

  const genAll = async () => {
    setBusy('all');
    try {
      const drafts: EntryDraft[] = [
        ...pending.inv.map(q => buildInvoiceEntry(q, tvaRate)),
        ...pending.invPay.flatMap(paymentDrafts),
        ...pending.av.map(q => buildAvoirEntry(q, tvaRate)),
        ...pending.ps.map(payslipDraft),
      ];
      for (const d of drafts) await AccountingService.createFromDraft(d, journals, opts());
      showToast({ type: 'success', title: 'Terminé', message: `${drafts.length} écriture(s) ${autoPost ? 'validées' : 'en brouillon'}` });
      await load();
    } catch (e: any) {
      showToast({ type: 'error', title: 'Erreur', message: e?.message || 'Échec' });
      await load();
    } finally { setBusy(null); }
  };

  const Row = ({ label, sub, amount, done, onGen, k }: { label: string; sub: string; amount: number; done: boolean; onGen: () => void; k: string }) => (
    <li className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">{label}</div>
        <div className="truncate text-xs text-muted-foreground">{sub}</div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-4">
        <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-foreground">{fmtMad(amount)}</span>
        {done ? (
          <StatusPill tone="success" icon={<Check className="h-3 w-3" />}>Fait</StatusPill>
        ) : (
          <button onClick={onGen} disabled={busy === k} className={`${btnSoft} min-w-[5.5rem]`}>
            {busy === k ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}{busy === k ? '…' : 'Générer'}
          </button>
        )}
      </div>
    </li>
  );

  if (loading) return <LoadingState />;

  const autoPostToggle = (
    <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-foreground">
      <input type="checkbox" checked={autoPost} onChange={e => setAutoPost(e.target.checked)} className={checkbox} />
      Valider automatiquement
    </label>
  );
  const genAllButton = (
    <button onClick={genAll} disabled={busy !== null || pending.total === 0} className={btnPrimary}>
      {busy === 'all' ? <Loader className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Tout générer
    </button>
  );

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="À comptabiliser"
        subtitle={`${pending.total} document(s) en attente · exercice ${fy?.label ?? ''}`}
        actions={<>{autoPostToggle}<span className="hidden md:inline-flex">{genAllButton}</span></>}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile icon={FileText} label="Factures de vente" value={pending.inv.length} hint="en attente" tone={pending.inv.length ? 'text-amber-600 bg-amber-500/10 dark:text-amber-400' : undefined} />
        <KpiTile icon={Wallet} label="Encaissements" value={pending.invPay.length} hint="en attente" tone={pending.invPay.length ? 'text-amber-600 bg-amber-500/10 dark:text-amber-400' : undefined} />
        <KpiTile icon={Undo2} label="Avoirs" value={pending.av.length} hint="en attente" tone={pending.av.length ? 'text-amber-600 bg-amber-500/10 dark:text-amber-400' : undefined} />
        <KpiTile icon={Users} label="Bulletins de paie" value={pending.ps.length} hint="en attente" tone={pending.ps.length ? 'text-amber-600 bg-amber-500/10 dark:text-amber-400' : undefined} />
      </div>

      <PhoneActionBar>{genAllButton}</PhoneActionBar>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Section title="Factures de vente" count={pending.inv.length}>
          {invoices.map(q => (
            <Row key={q.id} k={q.id}
              label={`Facture ${q.quoteNumber}`} sub={q.customer?.fullName || ''}
              amount={q.totalAmount} done={postedIds.has(q.id)}
              onGen={() => generate([buildInvoiceEntry(q, tvaRate)], q.id)} />
          ))}
          {invoices.length === 0 && <Empty />}
        </Section>

        <Section title="Encaissements (factures réglées)" count={pending.invPay.length}>
          {invoices.filter(q => invoicePayment(q).paid > 0).map(q => {
            const drafts = paymentDrafts(q);
            const toBook = drafts.reduce((s, d) => s + d.lines[0].debit, 0);
            return (
              <Row key={`${q.id}:pay`} k={`${q.id}:pay`}
                label={`Règlement ${q.quoteNumber}`}
                sub={`${q.customer?.fullName || ''} · reçu ${fmtMad(invoicePayment(q).paid)}${drafts.length ? ` · ${drafts.length} à comptabiliser` : ''}`}
                amount={drafts.length ? toBook : invoicePayment(q).paid} done={drafts.length === 0}
                onGen={() => generate(drafts, `${q.id}:pay`)} />
            );
          })}
          {invoices.filter(q => invoicePayment(q).paid > 0).length === 0 && <Empty />}
        </Section>

        <Section title="Avoirs" count={pending.av.length}>
          {avoirs.map(q => (
            <Row key={q.id} k={q.id}
              label={`Avoir ${q.quoteNumber}`} sub={q.customer?.fullName || ''}
              amount={q.totalAmount} done={postedIds.has(q.id)}
              onGen={() => generate([buildAvoirEntry(q, tvaRate)], q.id)} />
          ))}
          {avoirs.length === 0 && <Empty />}
        </Section>

        <Section title="Bulletins de paie" count={pending.ps.length}>
          {payslips.map(p => (
            <Row key={p.id} k={p.id}
              label={`Paie ${String(p.period_month).padStart(2, '0')}/${p.period_year}`}
              sub={`${(p as any).employee?.full_name || p.payslip_number}${inPostedRun(p) ? ' · comptabilisé avec son lot' : ''}`}
              amount={p.net_salary} done={postedIds.has(p.id) || inPostedRun(p)}
              onGen={() => generate([payslipDraft(p)], p.id)} />
          ))}
          {payslips.length === 0 && <Empty />}
        </Section>
      </div>

      {/* Supplier invoices and payments: their own section, loaded and posted apart. */}
      <SupplierPostingSection autoPost={autoPost} />
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <Panel
      title={title}
      action={count > 0
        ? <StatusPill tone="warning">{count} en attente</StatusPill>
        : <StatusPill tone="success" icon={<Check className="h-3 w-3" />}>À jour</StatusPill>}
    >
      <ul className="divide-y divide-border">{children}</ul>
    </Panel>
  );
}
const Empty = () => <li className="px-4 py-8 text-center text-sm text-muted-foreground">Aucun document</li>;
