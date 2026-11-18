import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Landmark, Loader, FileCheck, AlertTriangle, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import type { FiscalYear, Journal, JournalEntryLine } from '../../types';
import { AccountingService } from '../../utils/supabaseAccounting';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Panel } from '../../components/PageHeader';
import { StatusPill } from '../../components/lists/StatusPill';
import { btnPrimary, field, fieldLabel, KpiTile, LoadingState, panel, PhoneActionBar } from '../../components/backoffice/BackOfficeUi';

const r2 = (n: number) => Math.round(n * 100) / 100;
const day = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const lastDay = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

function fmtMad(n: number) { return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n) + ' MAD'; }
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

export default function TvaPage() {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const [fy, setFy] = useState<FiscalYear | null>(null);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [lines, setLines] = useState<any[]>([]);
  const [decls, setDecls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [periodType, setPeriodType] = useState<'M' | 'T'>('M');
  const [month, setMonth] = useState(new Date().getMonth());
  const [quarter, setQuarter] = useState(Math.floor(new Date().getMonth() / 3));
  const [regime, setRegime] = useState<'debit' | 'encaissement'>('encaissement');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const year = await AccountingService.ensureCurrentFiscalYear();
      setFy(year);
      const [j, l, d] = await Promise.all([
        AccountingService.listJournals(),
        AccountingService.getPostedLines(year.id),
        AccountingService.listVatDeclarations().catch(() => []),
      ]);
      setJournals(j); setLines(l); setDecls(d);
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const year = fy ? Number(fy.label) : new Date().getFullYear();
  // Periods as calendar days (YYYY-MM-DD), compared with entry dates as text:
  // no time zone can push the last day of the month out of its period.
  const range = useMemo(() => {
    if (periodType === 'M') {
      return { start: day(year, month, 1), end: day(year, month, lastDay(year, month)), label: `${year}-${String(month + 1).padStart(2, '0')}`, human: `${MONTHS[month]} ${year}` };
    }
    const m0 = quarter * 3, m1 = m0 + 2;
    return { start: day(year, m0, 1), end: day(year, m1, lastDay(year, m1)), label: `${year}-T${quarter + 1}`, human: `T${quarter + 1} ${year}` };
  }, [periodType, month, quarter, year]);

  const calc = useMemo(() => {
    let facturee = 0, recupBiens = 0, recupCharges = 0, before4456 = 0;
    for (const l of lines) {
      const d = String(l.entry_date || '').slice(0, 10);
      if (!d) continue;
      const code = String(l.account_code);
      const debit = Number(l.debit) || 0, credit = Number(l.credit) || 0;
      // 4456 before the period: a debit balance is a TVA credit carried forward
      // (opening balances count as "before" even when dated on day one).
      if (code.startsWith('4456') && (d < range.start || l.source_type === 'anouveaux')) before4456 += debit - credit;
      // Declaration entries settle 4455/3455; they are not new TVA.
      if (String(l.source_id || '').startsWith('tva:') || d < range.start || d > range.end) continue;
      if (code.startsWith('4455')) facturee += credit - debit;
      else if (code.startsWith('34551')) recupBiens += debit - credit;
      else if (code.startsWith('3455')) recupCharges += debit - credit;
    }
    const recup = recupBiens + recupCharges;
    const net = facturee - recup;            // the period alone
    const carried = Math.max(0, r2(before4456)); // crédit de TVA from earlier periods
    const total = net - carried;
    return { facturee, recupBiens, recupCharges, recup, carried, net, due: total > 0 ? total : 0, credit: total < 0 ? -total : 0 };
  }, [lines, range]);

  const existing = useMemo(() => decls.find(d => d.period === range.label), [decls, range]);

  const generate = async () => {
    if (!fy) return;
    if (Math.abs(calc.net) < 0.005 && calc.facturee === 0 && calc.recup === 0) { showToast({ type: 'error', message: 'Aucune TVA sur la période' }); return; }
    setBusy(true);
    try {
      // "Régénérer" replaces the earlier draft; a validated one must be reversed first.
      const previous = await AccountingService.entriesForSource(`tva:${range.label}`);
      if (previous.some(e => e.status === 'posted')) {
        throw new Error('La déclaration de cette période est déjà validée en comptabilité : contre-passez son écriture avant de la refaire.');
      }
      for (const e of previous.filter(e => e.status === 'draft')) await AccountingService.deleteDraft(e.id);

      const lines2: JournalEntryLine[] = [];
      if (calc.facturee > 0) lines2.push({ account_code: '4455', label: 'TVA facturée', debit: Math.round(calc.facturee * 100) / 100, credit: 0 });
      if (calc.recupBiens > 0) lines2.push({ account_code: '34551', label: 'TVA récup. immobilisations', debit: 0, credit: Math.round(calc.recupBiens * 100) / 100 });
      if (calc.recupCharges > 0) lines2.push({ account_code: '34552', label: 'TVA récup. charges', debit: 0, credit: Math.round(calc.recupCharges * 100) / 100 });
      // The period's TVA goes to 4456; a credit carried there from earlier
      // periods offsets it in the account balance.
      if (calc.net > 0) lines2.push({ account_code: '4456', label: 'TVA due', debit: 0, credit: Math.round(calc.net * 100) / 100 });
      else if (calc.net < 0) lines2.push({ account_code: '4456', label: 'Crédit de TVA', debit: Math.round(-calc.net * 100) / 100, credit: 0 });

      const entry = await AccountingService.createFromDraft(
        { journalType: 'od', date: range.end, reference: `TVA ${range.label}`, label: `Déclaration TVA ${range.human}`, sourceType: 'manual', sourceId: `tva:${range.label}`, lines: lines2 },
        journals, { post: false, createdBy: currentUser?.username || null },
      );

      await AccountingService.saveVatDeclaration({
        fiscal_year_id: fy.id, period_type: periodType, period: range.label, regime,
        tva_facturee: calc.facturee, tva_recuperable_biens: calc.recupBiens, tva_recuperable_charges: calc.recupCharges,
        tva_due: calc.due, credit_report: calc.credit, entry_id: entry.id, status: 'draft',
      });
      showToast({ type: 'success', title: 'Déclaration générée', message: 'Écriture de TVA en brouillon — validez-la dans Saisie/Journaux' });
      await load();
    } catch (e: any) {
      showToast({ type: 'error', title: 'Erreur', message: e?.message || 'Échec' });
    } finally { setBusy(false); }
  };

  if (loading) return <LoadingState />;

  const kpis = [
    { label: 'TVA facturée', value: fmtMad(calc.facturee), tone: 'text-blue-600 dark:text-blue-400 bg-blue-500/10', icon: ArrowUpRight },
    { label: 'TVA récupérable', value: fmtMad(calc.recup), tone: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10', icon: ArrowDownLeft },
    calc.due > 0
      ? { label: 'TVA due', value: fmtMad(calc.due), tone: 'text-amber-600 dark:text-amber-400 bg-amber-500/10', icon: Landmark }
      : { label: 'Crédit de TVA', value: fmtMad(calc.credit), tone: 'text-primary bg-primary/10', icon: Landmark },
  ];

  const generateButton = (
    <button onClick={generate} disabled={busy} className={btnPrimary}>
      {busy ? <Loader className="h-4 w-4 animate-spin" /> : <FileCheck className="h-4 w-4" />}
      {existing ? 'Régénérer la déclaration' : 'Générer la déclaration & l\'écriture'}
    </button>
  );
  const detailRow = 'flex items-baseline justify-between gap-4 px-4 py-2.5 sm:px-5';

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="Déclaration de TVA"
        subtitle={`Exercice ${fy?.label ?? ''} · base comptable`}
        actions={<span className="hidden md:inline-flex">{generateButton}</span>}
      >
        <div className={`${panel} grid grid-cols-2 items-end gap-3 p-3 sm:flex sm:flex-wrap`}>
          <div className="sm:w-44">
            <label className={fieldLabel} htmlFor="tva-periodicite">Périodicité</label>
            <select id="tva-periodicite" value={periodType} onChange={e => setPeriodType(e.target.value as 'M' | 'T')} className={field}>
              <option value="M">Mensuelle</option>
              <option value="T">Trimestrielle</option>
            </select>
          </div>
          {periodType === 'M' ? (
            <div className="sm:w-44"><label className={fieldLabel} htmlFor="tva-mois">Mois</label>
              <select id="tva-mois" value={month} onChange={e => setMonth(Number(e.target.value))} className={field}>
                {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
              </select></div>
          ) : (
            <div className="sm:w-44"><label className={fieldLabel} htmlFor="tva-trimestre">Trimestre</label>
              <select id="tva-trimestre" value={quarter} onChange={e => setQuarter(Number(e.target.value))} className={field}>
                {[0, 1, 2, 3].map(q => <option key={q} value={q}>T{q + 1}</option>)}
              </select></div>
          )}
          <div className="sm:w-44"><label className={fieldLabel} htmlFor="tva-regime">Régime</label>
            <select id="tva-regime" value={regime} onChange={e => setRegime(e.target.value as any)} className={field}>
              <option value="encaissement">Encaissement</option>
              <option value="debit">Débit</option>
            </select>
          </div>
          <div className="flex min-h-10 items-center gap-2 text-sm text-muted-foreground sm:ml-auto">
            <span className="font-medium text-foreground">{range.human}</span>
            {existing && <StatusPill tone="info">déjà déclarée</StatusPill>}
          </div>
        </div>
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {kpis.map((k, i) => (
          <div key={k.label} className={i === 2 ? 'col-span-2 lg:col-span-1' : ''}>
            <KpiTile icon={k.icon} tone={k.tone} label={k.label} value={k.value} />
          </div>
        ))}
      </div>

      <Panel title={`Détail · ${range.human}`} className="mb-4">
        <div className="divide-y divide-border text-sm">
          <div className={detailRow}><span className="text-muted-foreground">TVA facturée (comptes 4455…)</span><span className="whitespace-nowrap tabular-nums text-foreground">{fmtMad(calc.facturee)}</span></div>
          <div className={detailRow}><span className="text-muted-foreground">TVA récupérable / immobilisations (34551)</span><span className="whitespace-nowrap tabular-nums text-foreground">{fmtMad(calc.recupBiens)}</span></div>
          <div className={detailRow}><span className="text-muted-foreground">TVA récupérable / charges (34552…)</span><span className="whitespace-nowrap tabular-nums text-foreground">{fmtMad(calc.recupCharges)}</span></div>
          {calc.carried > 0 && (
            <div className={detailRow}><span className="text-muted-foreground">Crédit de TVA des périodes précédentes (4456)</span><span className="whitespace-nowrap tabular-nums text-foreground">− {fmtMad(calc.carried)}</span></div>
          )}
          <div className={`${detailRow} bg-secondary/40 py-3 font-semibold text-foreground`}>
            <span>{calc.due > 0 ? 'TVA à payer' : 'Crédit de TVA reportable'}</span>
            <span className="whitespace-nowrap text-base tabular-nums">{fmtMad(calc.due > 0 ? calc.due : calc.credit)}</span>
          </div>
        </div>
      </Panel>

      {regime === 'encaissement' && (
        <p className="mb-3 flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Calcul sur base comptable (timing débit). En régime encaissement, la TVA facturée est exigible à l'encaissement — ajustez manuellement les factures non encaissées si nécessaire.</span>
        </p>
      )}

      <PhoneActionBar>{generateButton}</PhoneActionBar>
    </div>
  );
}
