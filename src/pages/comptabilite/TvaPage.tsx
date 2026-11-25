import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Download, FileArchive, FileCheck, FileText, Info, Landmark, Loader, RotateCcw, Save, Settings2 } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Panel } from '../../components/PageHeader';
import { StatusPill } from '../../components/lists/StatusPill';
import { btnPrimary, btnSecondary, checkbox, field, fieldLabel, KpiTile, LoadingState, panel, PhoneActionBar, td, tdNum, th, theadRow, thRight, tfootRow } from '../../components/backoffice/BackOfficeUi';
import { VatReturnSettingsFields } from '../../components/settings/VatReturnSettingsFields';
import { formatMoney } from '../../utils/format';
import { buildCsv } from '../../utils/csvExport';
import { documentDay, localDay } from '../../utils/documentLines';
import { isReadableSnapshot, VatService, vatSettingsFrom, type VatData, type VatDeclarationRow } from '../../utils/supabaseVat';
import { buildVatReturnPdf, rateLabel, SALE_KIND_LABELS } from '../../utils/vatReturnPdf';
import {
  buildVatEntryLines, CATEGORY_LABELS, computeVatReturn, ledgerComparison, PAYMENT_MODE_CODE_LABELS, periodContaining, periodsOfYear,
  previousPeriod, salesBlock, salesEvents, suggestedPeriodicity, taxableTurnover, vatPeriod, VAT_MIGRATION, vatSettingsFieldsError,
  type DeductionItem, type LedgerLine, type SaleItem, type VatPeriodicity, type VatReturnResult, type VatSettingsValue, type VatWarning,
} from '../../accounting/vatReturn';
import {
  deductionCsvRows, deductionRows, deductionStatementFileName, deductionStatementIssues, deductionStatementXml, RD_MAX_ZIP_BYTES, zipDeductionStatement,
} from '../../accounting/vatDeductionStatement';

const fr = (d: string) => (d ? d.split('-').reverse().join('/') : '—');
const money = (n: number) => formatMoney(n);
const MONTH_LABEL = (ym: string) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked later: some browsers start the download after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: string })?.message || e));

function Notice({ tone = 'warning', children }: { tone?: 'warning' | 'info' | 'error'; children: React.ReactNode }) {
  const cls = tone === 'error'
    ? 'border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-200'
    : tone === 'info' ? 'border-blue-500/30 bg-blue-500/10 text-blue-900 dark:text-blue-200' : 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200';
  const Icon = tone === 'info' ? Info : AlertTriangle;
  return (
    <div role={tone === 'info' ? 'note' : 'alert'} className={`mb-3 flex gap-2 rounded-lg border px-3 py-2.5 text-xs ${cls}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}

function SaleItemsTable({ items }: { items: SaleItem[] }) {
  if (!items.length) return <p className="px-4 py-3 text-xs text-muted-foreground">Aucune pièce.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className={theadRow}><tr>
          <th className={th}>Date</th><th className={th}>Nature</th><th className={th}>Pièce</th><th className={th}>Client</th><th className={th}>Mode</th>
          <th className={thRight}>TTC compté</th><th className={thRight}>HT</th><th className={thRight}>TVA</th>
        </tr></thead>
        <tbody className="divide-y divide-border">
          {items.map((i, n) => (
            <tr key={`${i.docId}-${i.kind}-${i.date}-${n}`}>
              <td className={td}>{fr(i.date)}</td>
              <td className={td}>{SALE_KIND_LABELS[i.kind]}</td>
              <td className={td}>{i.number}{i.invoiceNumber ? <span className="text-muted-foreground"> sur {i.invoiceNumber}</span> : null}{i.invoiceDate && i.kind !== 'facture' ? <span className="block text-[11px] text-muted-foreground">facture du {fr(i.invoiceDate)}</span> : null}</td>
              <td className={td}>{i.client || '—'}</td>
              <td className={td}>{i.method || '—'}</td>
              <td className={tdNum}>{money(i.ttc)}{i.fullAmount !== undefined ? <span className="block text-[11px] text-muted-foreground">sur {money(i.fullAmount)}</span> : null}</td>
              <td className={tdNum}>{money(i.ht)}</td>
              <td className={`${tdNum} font-semibold`}>{money(i.vat)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DeductionItemsTable({ items, prorata }: { items: DeductionItem[]; prorata: number }) {
  if (!items.length) return <p className="px-4 py-3 text-xs text-muted-foreground">Aucun paiement.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className={theadRow}><tr>
          <th className={th}>Payée le</th><th className={th}>Fournisseur</th><th className={th}>Facture</th><th className={th}>Mode</th><th className={thRight}>Taux</th>
          <th className={thRight}>HT payé</th><th className={thRight}>TVA déductible</th>{prorata < 100 && <th className={thRight}>Après prorata</th>}<th className={thRight}>Perdue (espèces)</th>
        </tr></thead>
        <tbody className="divide-y divide-border">
          {items.map(i => (
            <tr key={i.key}>
              <td className={td}>{fr(i.paymentDate)}{i.late && <span className="block text-[11px] text-amber-700 dark:text-amber-300">période antérieure</span>}</td>
              <td className={td}>{i.supplierName}</td>
              <td className={td}>{i.invoiceNumber} <span className="text-muted-foreground">du {fr(i.invoiceDate)}</span>{i.registerNumber && <span className="block text-[11px] text-muted-foreground">{i.registerNumber}</span>}</td>
              <td className={td}>{PAYMENT_MODE_CODE_LABELS[i.modeCode]}{i.modeCode === 7 ? ` (${i.mode})` : ''}</td>
              <td className={tdNum}>{i.rate} %</td>
              <td className={tdNum}>{money(i.ht)}</td>
              <td className={`${tdNum} font-semibold`}>{money(i.vat)}</td>
              {prorata < 100 && <td className={tdNum}>{money(Math.round(i.vat * prorata) / 100)}</td>}
              <td className={tdNum}>{i.cashLoss ? money(i.cashLoss) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One line of the return, with its pieces under a "Détail" toggle. */
function ReturnLine({ label, base, vat, strong, children, sign }: { label: React.ReactNode; base?: number; vat: number; strong?: boolean; children?: React.ReactNode; sign?: string }) {
  const row = (
    <div className={`grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-0.5 px-4 py-2.5 sm:grid-cols-[1fr_9rem_9rem] sm:px-5 ${strong ? 'bg-secondary/40 font-semibold text-foreground' : ''}`}>
      <span className={strong ? '' : 'text-muted-foreground'}>{label}</span>
      <span className="hidden whitespace-nowrap text-right tabular-nums text-muted-foreground sm:block">{base !== undefined ? money(base) : ''}</span>
      <span className="whitespace-nowrap text-right tabular-nums text-foreground">{sign ? `${sign} ` : ''}{money(vat)}</span>
    </div>
  );
  if (!children) return row;
  return (
    <details className="group">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <div className="relative">{row}<span className="absolute right-1 top-2.5 text-[10px] text-primary group-open:hidden sm:hidden">▸</span></div>
      </summary>
      <div className="border-t border-dashed border-border bg-secondary/20">{children}</div>
    </details>
  );
}

function WarningsPanel({ warnings }: { warnings: VatWarning[] }) {
  if (!warnings.length) return null;
  const tone = (w: VatWarning) => (w.level === 'error' ? 'text-red-700 dark:text-red-300' : w.level === 'warning' ? 'text-amber-800 dark:text-amber-300' : 'text-muted-foreground');
  return (
    <Panel title={`Points à vérifier (${warnings.length})`} className="mb-4">
      <ul className="divide-y divide-border text-sm">
        {warnings.map(w => (
          <li key={w.code} className="px-4 py-2.5 sm:px-5">
            <p className={tone(w)}>{w.level === 'error' ? 'À corriger : ' : w.level === 'warning' ? 'À vérifier : ' : ''}{w.message}</p>
            {w.refs?.length ? <p className="mt-0.5 text-xs text-muted-foreground">{w.refs.slice(0, 12).join(' · ')}{w.refs.length > 12 ? ` … (+${w.refs.length - 12})` : ''}</p> : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export default function TvaPage() {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const user = currentUser?.username || null;
  const [data, setData] = useState<VatData | null>(null);
  const [ledger, setLedger] = useState<{ lines: LedgerLine[]; years: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pick, setPick] = useState<{ year: number; index: number } | null>(null);
  const [late, setLate] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftSettings, setDraftSettings] = useState<VatSettingsValue | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setData(await VatService.load());
    } catch (e) {
      setLoadError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const today = localDay();
  const year = pick?.year ?? Number(today.slice(0, 4));

  // Periodicity: the one chosen in the settings, else the one art. 108 points to.
  const suggestion = useMemo(() => {
    if (!data) return null;
    const prev = year - 1;
    const anyBefore = data.invoices.some(q => q.status !== 'draft' && documentDay(q).slice(0, 4) <= String(prev));
    const turnover = anyBefore ? taxableTurnover({ invoices: data.invoices, avoirs: data.avoirs, regime: data.vatSettings.regime, start: `${prev}-01-01`, end: `${prev}-12-31`, companyRate: data.companyRate }) : null;
    return { turnover, ...suggestedPeriodicity(turnover) };
  }, [data, year]);
  const periodicity: VatPeriodicity = data?.periodicityChosen ? data.vatSettings.periodicity : (suggestion?.periodicity || 'M');
  const settings = useMemo(() => (data ? { ...data.vatSettings, periodicity } : null), [data, periodicity]);

  // The period to file now: the last one that has ended.
  const period = useMemo(() => {
    const due = previousPeriod(periodContaining(periodicity, today));
    if (!pick) return due;
    const max = periodicity === 'M' ? 12 : 4;
    return vatPeriod(periodicity, pick.year, Math.min(max, Math.max(1, pick.index)));
  }, [pick, periodicity, today]);

  useEffect(() => { setLate([]); }, [period.key]);

  const existing: VatDeclarationRow | undefined = data?.declarations.find(d => d.period === period.key);
  const live = useMemo<VatReturnResult | null>(() => {
    if (!data || !settings) return null;
    return computeVatReturn({
      period, settings, companyRate: data.companyRate, invoices: data.invoices, avoirs: data.avoirs,
      supplierInvoices: data.supplierInvoices, supplierLines: data.supplierLines, supplierPayments: data.supplierPayments, suppliers: data.suppliers,
      declarations: data.declarations, includeLatePaymentIds: late, suppliersAvailable: data.suppliersAvailable, today,
    });
  }, [data, settings, period, late, today]);
  // A filed declaration is shown as stored, when its stored result can be read.
  const storedOk = !!existing?.snapshot && isReadableSnapshot(existing.snapshot);
  const frozen = existing?.status === 'filed' && storedOk ? existing.snapshot!.result : null;
  const shown = frozen || live;
  const releve = useMemo(() => (frozen && existing?.snapshot?.releve) || (shown ? deductionRows(shown) : []), [frozen, existing, shown]);
  const company = { name: data?.settings?.company_name || '', if: (data?.settings?.if_number || '').trim(), ice: (data?.settings?.ice || '').replace(/\s+/g, '') };
  const releveIssues = useMemo(() => deductionStatementIssues(releve, company.if), [releve, company.if]);

  // Ledger comparison, read once the page is up.
  useEffect(() => {
    let cancelled = false;
    setLedger(null);
    VatService.ledgerLines(period).then(r => { if (!cancelled) setLedger(r); }).catch(() => { if (!cancelled) setLedger({ lines: [], years: 0 }); });
    return () => { cancelled = true; };
  }, [period]);

  if (loading) return <LoadingState />;
  if (loadError || !data || !shown || !settings || !live) {
    return <div className="mx-auto max-w-3xl py-12 text-center text-sm text-destructive">Déclaration de TVA indisponible : {loadError || 'données non chargées'}.</div>;
  }

  const filed = existing?.status === 'filed';
  const run = async (name: string, f: () => Promise<void>) => {
    setBusy(name);
    try { await f(); } catch (e) { showToast({ type: 'error', title: 'Erreur', message: errorText(e) }); } finally { setBusy(null); }
  };
  const snapshot = () => VatService.snapshotOf(live, company, user);

  const saveDraft = () => run('draft', async () => {
    await VatService.saveDeclaration(snapshot(), 'draft', user, existing);
    showToast({ type: 'success', message: `Déclaration ${period.label} enregistrée en brouillon` });
    await load();
  });
  const markFiled = () => run('file', async () => {
    const errors = live.warnings.filter(w => w.level === 'error').length;
    if (!window.confirm(`Marquer la déclaration ${period.label} comme déposée ?\n\nLes montants et les listes seront figés tels qu’affichés${errors ? ` (${errors} point(s) à corriger restent signalés)` : ''}. La période suivante partira de son crédit.`)) return;
    await VatService.saveDeclaration(snapshot(), 'filed', user, existing);
    showToast({ type: 'success', message: `Déclaration ${period.label} marquée comme déposée` });
    await load();
  });
  const reopen = () => run('reopen', async () => {
    if (!existing) return;
    if (!window.confirm(`Rouvrir la déclaration déposée de ${period.label} ?\n\nElle sera recalculée à partir des documents actuels. Si vous l’avez déjà déposée sur SIMPL-TVA, une correction se fait par une déclaration rectificative.`)) return;
    await VatService.reopenDeclaration(existing, user);
    showToast({ type: 'success', message: 'Déclaration rouverte' });
    await load();
  });
  const createEntry = () => run('entry', async () => {
    await VatService.createEntryDraft(shown, user);
    showToast({ type: 'success', title: 'Écriture créée', message: 'Écriture de TVA en brouillon : vérifiez-la et validez-la dans Saisie / journaux.' });
  });
  const exportPdf = () => downloadBlob(`Declaration_TVA_${period.key}.pdf`, buildVatReturnPdf(shown, releve, company, { status: filed ? 'filed' : existing ? 'draft' : 'calcul' }).output('blob'));
  const exportCsv = () => downloadBlob(deductionStatementFileName(company.if, period, 'csv'), new Blob([buildCsv(deductionCsvRows(releve))], { type: 'text/csv;charset=utf-8' }));
  const exportEdi = () => {
    const errors = releveIssues.filter(i => i.level === 'error');
    if (errors.length) { showToast({ type: 'error', title: 'Relevé incomplet', message: errors.slice(0, 3).map(e => e.message).join(' ') }); return; }
    const xmlName = deductionStatementFileName(company.if, period, 'xml');
    const zip = zipDeductionStatement(deductionStatementXml(releve, company.if, period), xmlName);
    if (zip.byteLength > RD_MAX_ZIP_BYTES) { showToast({ type: 'error', message: 'Fichier de plus de 1 Mo une fois compressé : SIMPL-TVA le refuserait.' }); return; }
    downloadBlob(deductionStatementFileName(company.if, period, 'zip'), new Blob([zip], { type: 'application/zip' }));
  };
  const openSettings = () => {
    setDraftSettings({ vat_regime: settings.regime, vat_periodicity: data.periodicityChosen ? settings.periodicity : '', vat_prorata: settings.prorata, vat_opening_credit: settings.openingCredit, vat_start_date: settings.startDate || '' });
    setSettingsOpen(o => !o);
  };
  const saveSettings = () => run('settings', async () => {
    if (!draftSettings) return;
    const invalid = vatSettingsFieldsError(draftSettings);
    if (invalid) throw new Error(invalid);
    if (!draftSettings.vat_periodicity) throw new Error('Choisissez la périodicité.');
    await VatService.saveSettings(vatSettingsFrom(draftSettings));
    showToast({ type: 'success', message: 'Réglages TVA enregistrés' });
    setSettingsOpen(false);
    await load();
  });

  const r = shown;
  const deadline = r.deadline;
  const lateOverdue = today > deadline.electronic && !filed;
  const liveDiffers = !!frozen && (Math.abs(live.net - frozen.net) > 0.005 || Math.abs(live.sales.totalVat - frozen.sales.totalVat) > 0.005 || Math.abs(live.deductions.totalAfterProrata - frozen.deductions.totalAfterProrata) > 0.005);
  const years = Array.from({ length: 5 }, (_, i) => Number(today.slice(0, 4)) - 3 + i);

  // Ledger comparison
  const lc = ledger ? ledgerComparison(ledger.lines, period) : null;
  const debitView = settings.regime === 'encaissement'
    ? salesBlock(salesEvents({ invoices: data.invoices, avoirs: data.avoirs, regime: 'debit', start: period.start, end: period.end, companyRate: data.companyRate }).items)
    : r.sales;
  const supplierVatInvoiced = Math.round(data.supplierInvoices.filter(i => i.status !== 'draft' && i.invoice_date >= period.start && i.invoice_date <= period.end)
    .reduce((s, i) => s + (i.total_vat - i.total_nondeductible_vat), 0) * 100) / 100;
  let entryLines: ReturnType<typeof buildVatEntryLines> = [];
  try { entryLines = buildVatEntryLines(r); } catch { entryLines = []; }

  const stateBadge = filed ? <StatusPill tone="success">déposée le {fr(String(existing?.filed_at || '').slice(0, 10))}</StatusPill>
    : existing ? <StatusPill tone="info">brouillon enregistré</StatusPill> : <StatusPill tone="neutral">non enregistrée</StatusPill>;

  const mainActions = filed ? (
    <button type="button" onClick={reopen} disabled={!!busy} className={btnSecondary}>{busy === 'reopen' ? <Loader className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}Rouvrir</button>
  ) : (
    <>
      <button type="button" onClick={saveDraft} disabled={!!busy} className={btnSecondary}>{busy === 'draft' ? <Loader className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Enregistrer</button>
      <button type="button" onClick={markFiled} disabled={!!busy} className={btnPrimary}>{busy === 'file' ? <Loader className="h-4 w-4 animate-spin" /> : <FileCheck className="h-4 w-4" />}Marquer comme déposée</button>
    </>
  );

  const kpis = [
    { label: 'TVA exigible', value: money(r.sales.totalVat), tone: 'text-blue-600 dark:text-blue-400 bg-blue-500/10', icon: ArrowUpRight },
    { label: 'TVA déductible', value: money(r.deductions.totalAfterProrata), tone: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10', icon: ArrowDownLeft },
    r.toPay > 0
      ? { label: 'TVA à payer', value: money(r.toPay), tone: 'text-amber-600 dark:text-amber-400 bg-amber-500/10', icon: Landmark }
      : { label: 'Crédit à reporter', value: money(r.creditToCarry), tone: 'text-primary bg-primary/10', icon: Landmark },
  ];

  return (
    <div className="mx-auto max-w-[110rem] pb-24 md:pb-0">
      <PageHeader
        title="Déclaration de TVA"
        subtitle={`Régime ${settings.regime === 'encaissement' ? 'de l’encaissement' : 'des débits'} · ${periodicity === 'M' ? 'mensuelle' : 'trimestrielle'} · calculée depuis les factures, avoirs et paiements`}
        actions={<div className="hidden flex-wrap gap-2 md:flex">
          <button type="button" onClick={exportPdf} className={btnSecondary}><FileText className="h-4 w-4" />PDF</button>
          {mainActions}
        </div>}
      >
        <div className={`${panel} grid grid-cols-2 items-end gap-3 p-3 sm:flex sm:flex-wrap`}>
          <div className="sm:w-32">
            <label className={fieldLabel} htmlFor="tva-annee">Année</label>
            <select id="tva-annee" value={period.year} onChange={e => setPick({ year: Number(e.target.value), index: period.index })} className={field}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="sm:w-48">
            <label className={fieldLabel} htmlFor="tva-periode">{periodicity === 'M' ? 'Mois' : 'Trimestre'}</label>
            <select id="tva-periode" value={period.index} onChange={e => setPick({ year: period.year, index: Number(e.target.value) })} className={field}>
              {periodsOfYear(periodicity, period.year).map(p => <option key={p.key} value={p.index}>{p.label.replace(/ \d{4}$/, '')}</option>)}
            </select>
          </div>
          <div className="col-span-2 flex min-h-10 flex-wrap items-center gap-2 text-sm text-muted-foreground sm:ml-auto">
            <span className="font-medium capitalize text-foreground">{period.label}</span>
            {stateBadge}
            <span className={lateOverdue ? 'font-medium text-destructive' : ''}>à déposer et payer au plus tard le {fr(deadline.electronic)}</span>
            <button type="button" onClick={openSettings} className={btnSecondary} aria-expanded={settingsOpen}><Settings2 className="h-4 w-4" />Réglages TVA</button>
          </div>
        </div>
      </PageHeader>

      {settingsOpen && draftSettings && (
        <div className={`${panel} mb-4 p-3`}>
          <VatReturnSettingsFields value={draftSettings} onChange={p => setDraftSettings(s => (s ? { ...s, ...p } : s))} className={field} available={data.settingsAvailable} idPrefix="tva-reglage" />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={saveSettings} disabled={!!busy} className={btnPrimary}>{busy === 'settings' ? <Loader className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Enregistrer les réglages</button>
            {suggestion && <span className="text-xs text-muted-foreground">{suggestion.turnover !== null ? `CA taxable ${year - 1} : ${money(suggestion.turnover)}. ` : ''}{suggestion.reason}</span>}
          </div>
        </div>
      )}

      <Notice tone="info">
        <p><strong>À reporter sur SIMPL-TVA.</strong> Ces montants sont un calcul de Stocky : saisissez-les ou importez-les sur SIMPL-TVA et vérifiez-les avant de déposer. Le relevé de déductions s’importe en EDI (fichier zippé) une fois la déclaration créée en brouillon sur SIMPL-TVA.</p>
        <p>Ordre des blocs : article 112-I du CGI. Le formulaire officiel n’a pas pu être consulté : vérifiez les intitulés sur SIMPL-TVA.</p>
      </Notice>
      {!data.periodicityChosen && suggestion && (
        <Notice><p>Périodicité non choisie dans les réglages : {periodicity === 'M' ? 'mensuelle' : 'trimestrielle'} proposée. {suggestion.reason}</p></Notice>
      )}
      {!data.settingsAvailable && <Notice><p>Réglages TVA par défaut (encaissement, prorata 100 %, sans crédit de départ) : pour les enregistrer, exécutez la migration <code>{VAT_MIGRATION}</code> dans Supabase.</p></Notice>}
      {(!data.declarationsAvailable || data.snapshotAvailable === false) && <Notice><p>Le calcul fonctionne, mais une déclaration ne peut pas être enregistrée ni déposée tant que la migration <code>{VAT_MIGRATION}</code> n’est pas exécutée dans Supabase.</p></Notice>}
      {frozen && (
        <Notice tone={liveDiffers ? 'warning' : 'info'}>
          <p>Déclaration déposée : les montants et les listes affichés sont ceux enregistrés le {fr(String(existing?.snapshot?.computedAt || '').slice(0, 10))}{existing?.filed_by ? ` (par ${existing.filed_by})` : ''}.</p>
          {liveDiffers && <p>Les documents ont changé depuis : le calcul actuel donne {live.toPay > 0 ? `${money(live.toPay)} à payer` : `${money(live.creditToCarry)} de crédit`}. Une correction se fait sur SIMPL-TVA par une déclaration rectificative ; rouvrez la déclaration pour la refaire ici.</p>}
        </Notice>
      )}
      {existing?.snapshot && !storedOk && <Notice tone="error"><p>Le détail enregistré de cette déclaration est illisible : le calcul ci-dessous est celui des documents actuels. Les montants déposés restent ceux de la base (crédit reporté : {money(existing.credit_report)}).</p></Notice>}
      {existing && !existing.snapshot && <Notice><p>Déclaration enregistrée par l’ancienne version de la page (calcul comptable, sans le détail) : enregistrez-la à nouveau pour garder le détail.</p></Notice>}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {kpis.map((k, i) => (
          <div key={k.label} className={i === 2 ? 'col-span-2 lg:col-span-1' : ''}><KpiTile icon={k.icon} tone={k.tone} label={k.label} value={k.value} /></div>
        ))}
      </div>

      <WarningsPanel warnings={r.warnings} />

      <Panel title={`Déclaration · ${period.label}`} className="mb-4">
        <div className="text-sm">
          <div className="hidden grid-cols-[1fr_9rem_9rem] gap-x-4 border-b border-border px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
            <span>Ligne</span><span className="text-right">Base HT</span><span className="text-right">TVA</span>
          </div>
          <h3 className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-foreground sm:px-5">A. Chiffre d’affaires et TVA exigible</h3>
          <p className="px-4 pb-1 text-xs text-muted-foreground sm:px-5">{settings.regime === 'encaissement'
            ? 'Encaissements de la période (règlements et TVA retenue par les clients) des factures finalisées, au taux de chaque facture (art. 95 CGI).'
            : 'Factures finalisées datées de la période, et avances reçues avant leur facture (art. 95 CGI).'}</p>
          <div className="divide-y divide-border">
            {r.sales.byRate.map(l => (
              <ReturnLine key={l.rate} label={<>Taux {rateLabel(l.rate, l.legal)}{!l.legal && <span className="ml-1 text-amber-700 dark:text-amber-300">— à vérifier</span>}</>} base={l.base} vat={l.vat}>
                <SaleItemsTable items={l.items} />
              </ReturnLine>
            ))}
            {!r.sales.byRate.length && <p className="px-4 py-2.5 text-muted-foreground sm:px-5">Aucune opération imposable sur la période.</p>}
            {r.sales.creditNotes.items.length > 0 && (
              <ReturnLine label="dont avoirs (déjà déduits ci-dessus)" base={r.sales.creditNotes.base} vat={r.sales.creditNotes.vat}><SaleItemsTable items={r.sales.creditNotes.items} /></ReturnLine>
            )}
            <ReturnLine label="Total TVA exigible" base={r.sales.totalBase} vat={r.sales.totalVat} strong />
          </div>

          <h3 className="px-4 pt-4 text-xs font-semibold uppercase tracking-wide text-foreground sm:px-5">B. TVA déductible</h3>
          <p className="px-4 pb-1 text-xs text-muted-foreground sm:px-5">TVA des factures fournisseurs payées sur la période, au prorata de chaque paiement (art. 101-3° CGI), hors lignes exclues (art. 106-I) et TVA perdue en espèces (art. 106-II).</p>
          <div className="divide-y divide-border">
            {r.deductions.byCategory.map(c => (
              <ReturnLine key={c.category} label={CATEGORY_LABELS[c.category]} base={c.base} vat={c.vat}>
                <DeductionItemsTable items={c.items} prorata={r.deductions.prorata} />
              </ReturnLine>
            ))}
            {r.deductions.prorata < 100 && <ReturnLine label={`Prorata de déduction ${r.deductions.prorata} % (art. 104 CGI) : non déductible`} vat={r.deductions.prorataLoss} sign="−" />}
            <ReturnLine label="Total TVA déductible" base={r.deductions.totalBase} vat={r.deductions.totalAfterProrata} strong />
          </div>

          <h3 className="px-4 pt-4 text-xs font-semibold uppercase tracking-wide text-foreground sm:px-5">C. Crédit et retenues</h3>
          <div className="divide-y divide-border">
            <ReturnLine label={<>Crédit de la période précédente <span className="block text-xs">{r.credit.message}</span></>} vat={r.credit.amount} sign="−" />
            <ReturnLine label="TVA retenue à la source par les clients (art. 117-IV/V et 103-6° CGI)" vat={r.clientWithholdings.total} sign="−">
              {r.clientWithholdings.items.length ? (
                <div className="overflow-x-auto"><table className="w-full text-xs">
                  <thead className={theadRow}><tr><th className={th}>Date</th><th className={th}>Facture</th><th className={th}>Client</th><th className={th}>ICE</th><th className={thRight}>Part</th><th className={thRight}>Montant</th></tr></thead>
                  <tbody className="divide-y divide-border">{r.clientWithholdings.items.map((w, i) => (
                    <tr key={`${w.docId}-${i}`}><td className={td}>{fr(w.date)}</td><td className={td}>{w.number}</td><td className={td}>{w.client}</td><td className={td}>{w.clientIce || '—'}</td><td className={tdNum}>{w.share} %</td><td className={tdNum}>{money(w.amount)}</td></tr>
                  ))}</tbody>
                </table><p className="px-4 py-2 text-[11px] text-muted-foreground">Relevé détaillé à joindre : <Link className="text-primary hover:underline" to="/compta/releves-fiscaux">Retenue de TVA et timbre</Link>.</p></div>
              ) : <p className="px-4 py-3 text-xs text-muted-foreground">Aucune retenue sur la période.</p>}
            </ReturnLine>
          </div>

          <h3 className="px-4 pt-4 text-xs font-semibold uppercase tracking-wide text-foreground sm:px-5">D. Résultat</h3>
          <div className="divide-y divide-border">
            <ReturnLine label={r.toPay > 0 ? 'TVA à payer' : 'Crédit de TVA à reporter'} vat={r.toPay > 0 ? r.toPay : r.creditToCarry} strong />
            {r.refundableCredit > 0 && <ReturnLine label="dont crédit remboursable sur demande (TVA retenue par les clients, art. 103-6° CGI)" vat={r.refundableCredit} />}
          </div>
        </div>
      </Panel>

      {r.latePayments.length > 0 && !frozen && (
        <Panel title="Paiements fournisseur antérieurs non déduits" className="mb-4">
          <p className="px-4 pt-3 text-xs text-muted-foreground sm:px-5">Payés sur une période précédente mais absents des déclarations enregistrées. Le droit à déduction s’exerce dans l’année qui suit le mois (ou le trimestre) du paiement (art. 101-3° CGI).</p>
          <ul className="divide-y divide-border text-sm">
            {r.latePayments.map(c => (
              <li key={c.paymentId} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                <input id={`late-${c.paymentId}`} type="checkbox" className={checkbox} disabled={c.expired} checked={late.includes(c.paymentId)}
                  onChange={e => setLate(l => (e.target.checked ? [...l, c.paymentId] : l.filter(x => x !== c.paymentId)))} />
                <label htmlFor={`late-${c.paymentId}`} className="min-w-0 flex-1">{c.supplierName} · facture {c.invoiceNumber} · payée le {fr(c.paymentDate)}
                  <span className={`block text-xs ${c.expired ? 'text-destructive' : 'text-muted-foreground'}`}>{c.expired ? `Délai d’un an dépassé (fin le ${fr(c.deadline)}).` : `À déduire avant le ${fr(c.deadline)}.`}</span></label>
                <span className="whitespace-nowrap tabular-nums">{money(c.vat)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="À verser à part : TVA retenue sur vos fournisseurs" className="mb-4">
        <p className="px-4 pt-3 text-xs text-muted-foreground sm:px-5">TVA que vous avez retenue en payant vos fournisseurs (art. 117-IV/V CGI) : elle se verse au cours du mois qui suit chaque paiement, avec son bordereau-avis. Elle n’entre pas dans cette déclaration. <Link className="text-primary hover:underline" to="/compta/retenues-source">Retenues à la source</Link></p>
        {r.supplierWithholdings.items.length ? (
          <div className="mt-2 overflow-x-auto"><table className="w-full text-sm">
            <thead className={theadRow}><tr><th className={th}>Payée le</th><th className={th}>Fournisseur</th><th className={th}>Facture</th><th className={thRight}>Taux</th><th className={thRight}>TVA retenue</th><th className={th}>À verser en</th></tr></thead>
            <tbody className="divide-y divide-border">{r.supplierWithholdings.items.map(i => (
              <tr key={i.paymentId}><td className={td}>{fr(i.paymentDate)}</td><td className={td}>{i.supplierName}</td><td className={td}>{i.invoiceNumber}</td><td className={tdNum}>{i.rate} %</td><td className={tdNum}>{money(i.amount)}</td><td className={td}>{MONTH_LABEL(i.dueMonth)}</td></tr>
            ))}</tbody>
            <tfoot><tr className={tfootRow}><td className={td} colSpan={4}>Total à verser</td><td className={tdNum}>{money(r.supplierWithholdings.total)}</td><td /></tr></tfoot>
          </table></div>
        ) : <p className="px-4 py-3 text-sm text-muted-foreground sm:px-5">Aucune retenue sur la période.</p>}
      </Panel>

      <Panel title={`Relevé de déductions (${releve.length} ligne${releve.length > 1 ? 's' : ''})`} className="mb-4"
        action={<div className="flex flex-wrap gap-2">
          <button type="button" onClick={exportCsv} disabled={!releve.length} className={btnSecondary}><Download className="h-4 w-4" />CSV</button>
          <button type="button" onClick={exportEdi} disabled={!releve.length} className={btnPrimary}><FileArchive className="h-4 w-4" />Fichier EDI (zip)</button>
        </div>}>
        <p className="px-4 pt-3 text-xs text-muted-foreground sm:px-5">Une ligne par facture et par paiement (art. 112-II CGI), au format du cahier des charges EDI SIMPL-TVA v2.0. Montants de la part payée sur la période ; TVA avant prorata (le prorata a sa propre colonne).</p>
        {releveIssues.length > 0 && (
          <ul className="mx-4 mt-2 space-y-0.5 rounded-lg border border-border px-3 py-2 text-xs sm:mx-5">
            {releveIssues.map((i, n) => <li key={n} className={i.level === 'error' ? 'text-red-700 dark:text-red-300' : 'text-amber-800 dark:text-amber-300'}>{i.level === 'error' ? 'Bloquant : ' : 'À vérifier : '}{i.message}</li>)}
          </ul>
        )}
        {releve.length > 0 && (
          <div className="mt-2 overflow-x-auto"><table className="w-full text-xs">
            <thead className={theadRow}><tr>{['N°', 'Facture', 'Fournisseur', 'IF', 'ICE', 'Taux', 'HT', 'TVA', 'TTC', 'Mode', 'Payée le', 'Facture du'].map(h => <th key={h} className={['HT', 'TVA', 'TTC', 'Taux'].includes(h) ? thRight : th}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">{releve.map(x => (
              <tr key={x.ord}><td className={td}>{x.ord}</td><td className={td}>{x.num}<span className="block text-[11px] text-muted-foreground">{x.des}</span></td><td className={td}>{x.nom}</td><td className={td}>{x.if || <span className="text-destructive">manquant</span>}</td><td className={td}>{x.ice || <span className="text-destructive">manquant</span>}</td>
                <td className={tdNum}>{x.tx} %</td><td className={tdNum}>{money(x.mht)}</td><td className={tdNum}>{money(x.tva)}</td><td className={tdNum}>{money(x.ttc)}</td><td className={td}>{x.mp} – {PAYMENT_MODE_CODE_LABELS[x.mp]}</td><td className={td}>{fr(x.dpai)}</td><td className={td}>{fr(x.dfac)}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>

      <Panel title="Comparaison avec la comptabilité" className="mb-4">
        {!lc ? <p className="px-4 py-3 text-sm text-muted-foreground sm:px-5">Lecture des écritures…</p> : (
          <div className="text-sm">
            {ledger && ledger.years === 0 && <p className="px-4 pt-3 text-xs text-muted-foreground sm:px-5">Aucun exercice comptable ne couvre cette période.</p>}
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className={theadRow}><tr><th className={th}>Compte (écritures validées de la période)</th><th className={thRight}>Comptabilité</th><th className={thRight}>Documents, à la date des factures</th><th className={thRight}>Déclaration</th></tr></thead>
              <tbody className="divide-y divide-border">
                <tr><td className={td}>4455 TVA facturée (mouvements)</td><td className={tdNum}>{money(lc.collected)}</td><td className={tdNum}>{money(debitView.totalVat)}</td><td className={tdNum}>{money(r.sales.totalVat)}</td></tr>
                <tr><td className={td}>3455 TVA récupérable (34551 + 34552)</td><td className={tdNum}>{money(lc.recoverable)}</td><td className={tdNum}>{money(supplierVatInvoiced)}</td><td className={tdNum}>{money(r.deductions.totalVat)}</td></tr>
                <tr><td className={td}>34581 TVA retenue par les clients</td><td className={tdNum}>{money(lc.withheldByClients)}</td><td className={tdNum}>—</td><td className={tdNum}>{money(r.clientWithholdings.total)}</td></tr>
              </tbody>
            </table></div>
            <div className="space-y-1 px-4 py-3 text-xs text-muted-foreground sm:px-5">
              <p>La comptabilité enregistre la TVA à la date des factures (4455 à la vente, 3455 à l’achat). {settings.regime === 'encaissement'
                ? 'En régime de l’encaissement, la déclaration suit l’argent : un écart est normal. Il correspond à la TVA des factures de la période pas encore encaissées, moins celle des factures antérieures encaissées sur la période.'
                : 'En régime des débits, la TVA exigible suit les factures : 4455 et la déclaration devraient se rejoindre, sauf avances reçues avant facture et pièces pas encore comptabilisées.'}</p>
              <p>Côté achats, la déduction suit toujours le paiement (art. 101-3° CGI) : l’écart avec 3455 est la TVA des factures fournisseurs non encore payées, moins celle des factures antérieures payées sur la période. Un écart reste aussi tant que des pièces attendent dans « À comptabiliser » ou en brouillon.</p>
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Écriture de déclaration (OD, brouillon)" className="mb-4"
        action={<button type="button" onClick={createEntry} disabled={!!busy || !entryLines.length} className={btnSecondary}>{busy === 'entry' ? <Loader className="h-4 w-4 animate-spin" /> : <FileCheck className="h-4 w-4" />}Créer l’écriture en brouillon</button>}>
        <p className="px-4 pt-3 text-xs text-muted-foreground sm:px-5">Datée du {fr(period.end)} au journal OD, à vérifier et valider dans Saisie / journaux. Elle solde la TVA déclarée : 4455 au débit pour la TVA exigible, 3455 au crédit pour la TVA déduite, 34581 pour les retenues des clients, 3456 pour le crédit reporté, puis 4456 (à payer) ou 3456 (crédit). {settings.regime === 'encaissement' ? 'En encaissement, 4455 garde la TVA des factures non encore encaissées.' : ''} La TVA non déductible (prorata, espèces) reste au 3455 : passez-la en charge à la main. Le crédit reporté est repris sur 3456 : si votre crédit de départ est sur un autre compte, corrigez l’écriture.</p>
        <div className="mt-2 overflow-x-auto"><table className="w-full text-sm">
          <thead className={theadRow}><tr><th className={th}>Compte</th><th className={th}>Libellé</th><th className={thRight}>Débit</th><th className={thRight}>Crédit</th></tr></thead>
          <tbody className="divide-y divide-border">{entryLines.map((l, i) => (
            <tr key={i}><td className={td}>{l.account_code}</td><td className={td}>{l.label}</td><td className={tdNum}>{l.debit ? money(l.debit) : ''}</td><td className={tdNum}>{l.credit ? money(l.credit) : ''}</td></tr>
          ))}</tbody>
        </table></div>
      </Panel>

      <PhoneActionBar>
        <button type="button" onClick={exportPdf} className={btnSecondary}><FileText className="h-4 w-4" />PDF</button>
        {mainActions}
      </PhoneActionBar>
    </div>
  );
}
