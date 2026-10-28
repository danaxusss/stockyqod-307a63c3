import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Inbox, Loader, Check, Zap } from 'lucide-react';
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
    <div className="flex items-center justify-between px-3 py-2 border-b border-border/40 last:border-0">
      <div className="min-w-0">
        <div className="font-medium text-foreground text-sm truncate max-w-[280px]">{label}</div>
        <div className="text-[11px] text-muted-foreground">{sub}</div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="tabular-nums text-sm text-foreground">{fmtMad(amount)}</span>
        {done ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400"><Check className="h-3.5 w-3.5" />Fait</span>
        ) : (
          <button onClick={onGen} disabled={busy === k} className="px-2.5 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 disabled:opacity-50">
            {busy === k ? '…' : 'Générer'}
          </button>
        )}
      </div>
    </div>
  );

  if (loading) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>;

  return (
    <div className="max-w-4xl mx-auto py-6 px-3">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10"><Inbox className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">À comptabiliser</h1>
            <p className="text-xs text-muted-foreground">{pending.total} document(s) en attente · exercice {fy?.label}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={autoPost} onChange={e => setAutoPost(e.target.checked)} className="accent-[hsl(var(--primary))]" />
            Valider automatiquement
          </label>
          <button onClick={genAll} disabled={busy !== null || pending.total === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
            {busy === 'all' ? <Loader className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Tout générer
          </button>
        </div>
      </div>

      <div className="space-y-4">
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
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-secondary/50 border-b border-border/60">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        {count > 0 && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">{count} en attente</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}
const Empty = () => <div className="px-3 py-6 text-center text-xs text-muted-foreground">Aucun document</div>;
