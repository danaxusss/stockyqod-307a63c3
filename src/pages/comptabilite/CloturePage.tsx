import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Loader, AlertTriangle, CheckCircle2, Download, FileText, Calculator, Trash2, Boxes } from 'lucide-react';
import type { Account, FiscalYear, JournalEntry, JournalEntryLine } from '../../types';
import { AccountingService } from '../../utils/supabaseAccounting';
import { SupabaseCompaniesService } from '../../utils/supabaseCompanies';
import { getCompanyContext } from '../../utils/supabaseCompanyFilter';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Panel } from '../../components/PageHeader';
import { StatusPill } from '../../components/lists/StatusPill';
import { btnPrimary, btnSecondary, fieldAuto, iconBtnDanger, LoadingState, PhoneActionBar } from '../../components/backoffice/BackOfficeUi';
import { buildFecRows, checkFec, fecFileName, fecText, type FecCheck } from '../../accounting/fec';
import { cmBaseFromBalances, estimateCorporateTax, resultBeforeTaxFromBalances } from '../../accounting/corporateTax';
import { balancesOf } from '../../accounting/fiscalYears';
import { downloadText } from '../../accounting/ledgerExport';
import { errorText } from '../../accounting/errors';
import { openingStockBalance, stockEntryAmounts, stockEntryState, stockVariation, STOCK_ACCOUNT, STOCK_VARIATION_ACCOUNT } from '../../accounting/stockEntry';
import { buildStockStatement, statementTotals } from '../../inventory/lib/stockValuation';
import { useStockAtDate } from '../../inventory/hooks/useStockAtDate';
import { useAccessibleLocations } from '../../inventory/hooks/useAccessibleLocations';
import { seesPurchaseCosts } from '../../utils/productCosts';
import { STOCK_VALUATION_PATH } from '../../lib/navigation';

function fmtMad(n: number) { return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' MAD'; }
const pct = (r: number) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(r * 100)} %`;
const frDay = (d: string) => d.split('-').reverse().join('/');

export default function CloturePage() {
  const { currentUser, getPriceDisplayType, isAdmin, isSuperAdmin } = useAuth();
  const seesCosts = seesPurchaseCosts({ priceDisplayType: getPriceDisplayType?.(), isAdmin, isSuperAdmin });
  const { showToast } = useToast();
  const [years, setYears] = useState<FiscalYear[]>([]);
  const [openFy, setOpenFy] = useState<FiscalYear | null>(null);
  const [draftCount, setDraftCount] = useState(0);
  const [balances, setBalances] = useState<Map<string, number>>(new Map());
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [taxEntryExists, setTaxEntryExists] = useState(false);
  const [fecYearId, setFecYearId] = useState('');
  const [fecReport, setFecReport] = useState<(FecCheck & { label: string; file: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'close' | 'fec' | 'tax' | 'stock' | null>(null);
  const [yearLines, setYearLines] = useState<Array<JournalEntryLine & { entry_id?: string; source_type?: string | null; source_id?: string | null }>>([]);
  const [stockEntries, setStockEntries] = useState<JournalEntry[]>([]);
  const [postedStockLines, setPostedStockLines] = useState<JournalEntryLine[]>([]);
  const [draftStockLines, setDraftStockLines] = useState<JournalEntryLine[]>([]);
  // The accountant's figure after the physical count; null: the valued stock.
  const [closingInput, setClosingInput] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // The year to close is the oldest one still open.
      const shown = await AccountingService.ensureCurrentFiscalYear();
      const all = await AccountingService.listFiscalYears();
      setYears(all);
      setCounts(await AccountingService.entryCountsByYear());
      setFecYearId(prev => prev || shown?.id || all[0]?.id || '');
      const fy = [...all].filter(y => y.status === 'open').sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
      if (!fy) { setOpenFy(null); return; }
      setOpenFy(fy);
      const [drafts, lines, taxEntries, stock] = await Promise.all([
        AccountingService.listEntries({ fiscalYearId: fy.id, status: 'draft', limit: 1000 }),
        AccountingService.getPostedLines(fy.id),
        AccountingService.entriesForSource(AccountingService.taxSourceId(fy.id)),
        AccountingService.stockEntries(fy),
      ]);
      setDraftCount(drafts.length);
      setBalances(balancesOf(lines));
      setYearLines(lines);
      setTaxEntryExists(taxEntries.length > 0);
      setStockEntries(stock);
      // A posted stock entry's lines are among the year's posted lines; a draft's are read apart.
      const current = stockEntryState(stock).entry;
      setPostedStockLines(current?.status === 'posted' ? lines.filter(l => (l as { entry_id?: string }).entry_id === current.id) : []);
      setDraftStockLines(current?.status === 'draft' ? await AccountingService.entryLines(current.id) : []);
      setClosingInput(null);
    } catch (e) { showToast({ type: 'error', message: errorText(e, 'Erreur') }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  // ── Stock de marchandises ──
  const stockState = useMemo(() => stockEntryState(stockEntries), [stockEntries]);
  const openingStock = useMemo(() => openFy ? openingStockBalance(yearLines, openFy.id, new Set(stockEntries.map(e => e.id))) : 0, [yearLines, openFy, stockEntries]);
  const valuation = useStockAtDate(openFy && seesCosts ? openFy.end_date : null);
  const { keyAllowed, loading: locationsLoading } = useAccessibleLocations();
  const valued = useMemo(() => {
    if (!openFy || !valuation.products || !valuation.movements || locationsLoading) return null;
    return statementTotals(buildStockStatement(valuation.products, valuation.movements, { day: openFy.end_date, vatRate: valuation.vatRate, keyInScope: keyAllowed }));
  }, [openFy, valuation.products, valuation.movements, valuation.vatRate, locationsLoading, keyAllowed]);
  const closingStock = closingInput !== null ? Math.round((Number(closingInput.replace(',', '.')) || 0) * 100) / 100 : valued?.value ?? 0;
  const closingEdited = closingInput !== null && valued !== null && Math.abs(closingStock - valued.value) > 0.005;
  const postedAmounts = useMemo(() => stockEntryAmounts(postedStockLines), [postedStockLines]);
  const draftAmounts = useMemo(() => stockEntryAmounts(draftStockLines), [draftStockLines]);
  // No figure yet (valuation still loading or unavailable, nothing typed): no entry.
  const noClosingFigure = closingInput === null && valued === null;

  const createStockEntry = async () => {
    if (!openFy) return;
    const replace = stockState.state === 'draft';
    if (!confirm(`${replace ? 'Remplacer le brouillon de' : 'Créer'} l'écriture de stock au ${frDay(openFy.end_date)} (journal OD, en brouillon) : annulation du stock initial de ${fmtMad(openingStock)} (débit ${STOCK_VARIATION_ACCOUNT}, crédit ${STOCK_ACCOUNT}) et stock final de ${fmtMad(closingStock)} (débit ${STOCK_ACCOUNT}, crédit ${STOCK_VARIATION_ACCOUNT}) ?`)) return;
    setBusy('stock');
    try {
      const res = await AccountingService.saveStockEntryDraft(openFy, { opening: openingStock, closing: closingStock }, currentUser?.username || null);
      showToast({ type: 'success', title: res.replaced ? 'Brouillon remplacé' : 'Brouillon créé', message: 'Écriture de stock dans le journal OD, à valider dans Saisie / Journaux.' });
      await load();
    } catch (e) { showToast({ type: 'error', message: errorText(e, 'Échec') }); }
    finally { setBusy(null); }
  };

  const result = useMemo(() => resultBeforeTaxFromBalances(balances), [balances]);
  const resultat = result.result - result.taxBooked;
  const tax = useMemo(() => openFy ? estimateCorporateTax({ year: Number(openFy.label), resultBeforeTax: result.result, cmBase: cmBaseFromBalances(balances) }) : null, [openFy, result.result, balances]);

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const yearOver = !!openFy && openFy.end_date < today;
  const canClose = draftCount === 0 && yearOver;

  const close = async () => {
    if (!openFy) return;
    // Not blocked (a company may keep its stock outside Stocky), but never silent.
    if (stockState.state !== 'posted' && (Math.abs(openingStock) > 0.005 || valued === null || valued.value > 0.005)) {
      const figures = `stock initial au compte ${STOCK_ACCOUNT} : ${fmtMad(openingStock)}, stock valorisé au ${frDay(openFy.end_date)} : ${valued === null ? 'non calculé' : fmtMad(valued.value)}`;
      if (!confirm(`Aucune écriture de stock validée pour l'exercice ${openFy.label} (${figures}). Le résultat de l'exercice ne tiendra pas compte du stock de marchandises. Clôturer quand même ?`)) return;
    }
    if (!confirm(`Clôturer définitivement l'exercice ${openFy.label} ? Les écritures deviennent non modifiables et les à-nouveaux sont générés sur l'exercice suivant.`)) return;
    setBusy('close');
    try {
      const res = await AccountingService.closeExercice(openFy, currentUser?.username || null);
      showToast({ type: 'success', title: 'Exercice clôturé', message: `À-nouveaux (${res.carried} lignes) reportés sur ${res.newYearLabel}` });
      await load();
    } catch (e) {
      showToast({ type: 'error', title: 'Clôture impossible', message: errorText(e, 'Échec') });
    } finally { setBusy(null); }
  };

  const createTaxEntry = async () => {
    if (!openFy || !tax) return;
    if (!confirm(`Créer l'écriture d'impôt de ${fmtMad(tax.isDue)} en brouillon (6701 / 4453, au ${frDay(openFy.end_date)}) ? Vérifiez le montant avec votre déclaration fiscale avant de la valider.`)) return;
    setBusy('tax');
    try {
      await AccountingService.createCorporateTaxDraft(openFy, tax.isDue, currentUser?.username || null);
      showToast({ type: 'success', title: 'Brouillon créé', message: 'Écriture d\'IS dans le journal OD, à valider dans Saisie / Journaux.' });
      await load();
    } catch (e) { showToast({ type: 'error', message: errorText(e, 'Échec') }); }
    finally { setBusy(null); }
  };

  const exportFec = async () => {
    const fy = years.find(y => y.id === fecYearId);
    if (!fy) return;
    setBusy('fec');
    try {
      const { companyId } = getCompanyContext();
      const [data, accounts, journals, company] = await Promise.all([
        AccountingService.fecData(fy.id),
        AccountingService.listAccounts(),
        AccountingService.listJournals(),
        companyId ? SupabaseCompaniesService.getCompanyById(companyId) : Promise.resolve(null),
      ]);
      const input = { entries: data.entries, lines: data.lines, journals, accounts: accounts as Account[] };
      const check = checkFec(input, { draftCount: data.draftCount });
      if (!company?.if_number && !company?.ice) check.warnings.push('IF et ICE de la société non renseignés (Paramètres société) : le nom du fichier ne les porte pas.');
      const file = fecFileName(company, fy.end_date);
      setFecReport({ ...check, label: fy.label, file });
      if (check.entryCount === 0) { showToast({ type: 'info', message: `Aucune écriture validée sur l'exercice ${fy.label}.` }); return; }
      if (data.draftCount > 0 && !confirm(`${data.draftCount} écriture(s) en brouillon ne figurent pas dans le FEC : seules les écritures validées y sont. Exporter quand même ?`)) return;
      if (check.errors.length > 0 && !confirm(`Le contrôle a relevé ${check.errors.length} anomalie(s) (détail sur la page). Télécharger quand même le FEC ?`)) return;
      downloadText(fecText(buildFecRows(input)), file, 'text/plain;charset=utf-8');
    } catch (e) { showToast({ type: 'error', title: 'Export FEC impossible', message: errorText(e, 'Échec') }); }
    finally { setBusy(null); }
  };

  const removeYear = async (y: FiscalYear) => {
    if (!confirm(`Supprimer l'exercice ${y.label}, ouvert sans aucune écriture ?`)) return;
    try {
      await AccountingService.deleteEmptyFiscalYear(y);
      AccountingService.setDisplayedFiscalYear(null);
      showToast({ type: 'success', message: `Exercice ${y.label} supprimé` });
      await load();
    } catch (e) { showToast({ type: 'error', message: errorText(e, 'Échec') }); }
  };

  if (loading) return <LoadingState />;

  const closeButton = (
    <button onClick={close} disabled={busy !== null || !canClose} className={btnPrimary}>
      {busy === 'close' ? <Loader className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
      Clôturer l'exercice {openFy?.label}
    </button>
  );
  const row = 'flex items-center justify-between gap-4 px-4 py-3 text-sm sm:px-5';
  const amountCls = 'whitespace-nowrap font-semibold tabular-nums text-foreground';
  const note = 'flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-200';
  const info = 'px-4 py-3 text-xs text-muted-foreground sm:px-5';

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader title="Clôture d'exercice" subtitle="Verrou, à-nouveaux, FEC et estimation de l'IS" actions={<span className="hidden md:inline-flex">{closeButton}</span>} />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <Panel title="Exercice courant">
            <div className="divide-y divide-border">
              <div className={row}><span className="text-muted-foreground">Exercice courant</span><span className="font-semibold text-foreground">{openFy?.label}</span></div>
              <div className={row}><span className="text-muted-foreground">Résultat de l'exercice</span><span className={`whitespace-nowrap font-semibold tabular-nums ${resultat >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>{fmtMad(resultat)}</span></div>
              <div className={row}><span className="text-muted-foreground">Report à la clôture</span><span className="text-foreground">{resultat >= 0 ? '1191 Résultat net (solde créditeur)' : '1199 Résultat net (solde débiteur)'}</span></div>
              <div className={row}>
                <span className="text-muted-foreground">Écritures en brouillon</span>
                {draftCount === 0
                  ? <StatusPill tone="success" icon={<CheckCircle2 className="h-3 w-3" />}>Aucune</StatusPill>
                  : <StatusPill tone="warning" icon={<AlertTriangle className="h-3 w-3" />}>{draftCount} à traiter</StatusPill>}
              </div>
            </div>
          </Panel>

          {openFy && !yearOver && (
            <p className={note}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>L'exercice {openFy.label} se termine le {frDay(openFy.end_date)} : la clôture sera possible après cette date.</span>
            </p>
          )}
          {draftCount > 0 && (
            <p className={note}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Validez ou supprimez les écritures en brouillon avant de clôturer (Saisie / Journaux).</span>
            </p>
          )}

          {openFy && (
            <Panel title={`Stock de marchandises ${openFy.label}`}>
              <p className={info}>Inventaire au {frDay(openFy.end_date)} : le stock initial est annulé et le stock final enregistré par le compte {STOCK_VARIATION_ACCOUNT} (CGNC).</p>
              <div className="divide-y divide-border border-t border-border">
                <div className={row}><span className="text-muted-foreground">Stock initial (compte {STOCK_ACCOUNT})</span><span className={amountCls}>{fmtMad(stockState.state === 'posted' ? postedAmounts.opening : openingStock)}</span></div>
                {stockState.state === 'posted' ? (
                  <>
                    <div className={row}><span className="text-muted-foreground">Stock final comptabilisé</span><span className={amountCls}>{fmtMad(postedAmounts.closing)}</span></div>
                    <div className={row}><span className="text-muted-foreground">Variation de stock ({STOCK_VARIATION_ACCOUNT})</span><span className={amountCls}>{fmtMad(stockVariation(postedAmounts.opening, postedAmounts.closing))}</span></div>
                  </>
                ) : (
                  <>
                    <div className={row}>
                      <span className="min-w-0 text-muted-foreground">
                        Stock valorisé au {frDay(openFy.end_date)}
                        {seesCosts && <> · <Link to={`${STOCK_VALUATION_PATH}?date=${openFy.end_date}`} className="font-medium text-primary hover:underline">Voir l'inventaire</Link></>}
                        {valued && (valued.fallbackLines > 0 || valued.negativeLines > 0) && (
                          <span className="block text-xs">{valued.fallbackLines} ligne(s) au coût actuel · {valued.negativeLines} en quantité négative</span>
                        )}
                      </span>
                      <span className={amountCls}>{!seesCosts ? 'Prix d’achat non accessibles' : valuation.error ? 'Non calculé' : valued ? fmtMad(valued.value) : <Loader className="h-4 w-4 animate-spin" aria-label="Calcul en cours" />}</span>
                    </div>
                    <div className={row}>
                      <label htmlFor="stock-final" className="text-muted-foreground">
                        Stock final retenu
                        {closingEdited && valued && <span className="block text-xs text-amber-800 dark:text-amber-200">Écart avec le stock valorisé : {fmtMad(Math.round((closingStock - valued.value) * 100) / 100)}</span>}
                      </label>
                      <input id="stock-final" type="number" min={0} step="0.01" inputMode="decimal"
                        value={closingInput ?? (valued ? String(valued.value) : '')}
                        onChange={e => setClosingInput(e.target.value)}
                        className={`${fieldAuto} w-40 text-right tabular-nums`} />
                    </div>
                    <div className={row}><span className="text-muted-foreground">Variation de stock ({STOCK_VARIATION_ACCOUNT})</span><span className={amountCls}>{fmtMad(stockVariation(openingStock, closingStock))}</span></div>
                  </>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
                <span className="text-xs text-muted-foreground">
                  {stockState.state === 'posted'
                    ? <span className="flex flex-wrap items-center gap-2"><StatusPill tone="success" icon={<CheckCircle2 className="h-3 w-3" />}>Écriture validée{stockState.entry?.entry_number ? ` n° ${stockState.entry.entry_number}` : ''}</StatusPill>Pour la refaire, contre-passez-la d'abord dans Saisie / Journaux.</span>
                    : stockState.state === 'draft'
                      ? `Brouillon créé (stock initial ${fmtMad(draftAmounts.opening)}, stock final ${fmtMad(draftAmounts.closing)}) : validez-le dans Saisie / Journaux, ou remplacez-le.`
                      : 'Une variation positive augmente les charges, négative les diminue.'}
                </span>
                {stockState.state !== 'posted' && (
                  <button onClick={createStockEntry} disabled={busy !== null || noClosingFigure || (Math.abs(openingStock) < 0.005 && closingStock < 0.005) || closingStock < 0} className={btnSecondary}>
                    {busy === 'stock' ? <Loader className="h-4 w-4 animate-spin" /> : <Boxes className="h-4 w-4 text-primary" />}
                    {stockState.state === 'draft' ? 'Remplacer le brouillon' : "Créer l'écriture de stock"}
                  </button>
                )}
              </div>
            </Panel>
          )}

          {openFy && tax && (
            <Panel title={`Impôt sur les sociétés ${openFy.label} — estimation`}>
              <p className={info}>Estimation à partir du résultat comptable, sans réintégrations ni déductions fiscales. Le montant à déclarer est celui de votre liasse fiscale.</p>
              <div className="divide-y divide-border border-t border-border">
                <div className={row}><span className="text-muted-foreground">Résultat avant impôt</span><span className={amountCls}>{fmtMad(tax.resultBeforeTax)}</span></div>
                <div className={row}><span className="text-muted-foreground">IS au taux de {pct(tax.rate)}</span><span className={amountCls}>{fmtMad(tax.isAmount)}</span></div>
                <div className={row}><span className="text-muted-foreground">Cotisation minimale (0,25 % de {fmtMad(tax.cmBase)}, min. 3 000)</span><span className={amountCls}>{fmtMad(tax.cmAmount)}</span></div>
                <div className={`${row} bg-secondary/40`}><span className="font-semibold text-foreground">IS dû {tax.cmApplies ? '(cotisation minimale)' : ''}</span><span className={amountCls}>{fmtMad(tax.isDue)}</span></div>
                {tax.css > 0 && <div className={row}><span className="text-muted-foreground">Contribution sociale de solidarité ({pct(tax.cssRate)})</span><span className={amountCls}>{fmtMad(tax.css)}</span></div>}
                <div className={row}><span className="text-muted-foreground">Résultat net estimé</span><span className={amountCls}>{fmtMad(tax.netResult)}</span></div>
                <div className="px-4 py-3 text-sm sm:px-5">
                  <p className="mb-1.5 text-muted-foreground">Acomptes {tax.instalmentYear}</p>
                  <ul className="space-y-1">
                    {tax.instalments.map(i => (
                      <li key={i.due} className="flex justify-between gap-4"><span className="text-muted-foreground">avant le {frDay(i.due)}</span><span className="tabular-nums text-foreground">{fmtMad(i.amount)}</span></li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
                <span className="text-xs text-muted-foreground">
                  {result.taxBooked > 0 ? `Impôt déjà comptabilisé sur l'exercice : ${fmtMad(result.taxBooked)}.` : taxEntryExists ? 'L\'écriture d\'IS de l\'exercice existe déjà.' : 'Écriture en brouillon : débit 6701, crédit 4453.'}
                  {tax.css > 0 ? ' La CSS n\'est pas incluse.' : ''}
                </span>
                <button onClick={createTaxEntry} disabled={busy !== null || taxEntryExists || result.taxBooked > 0 || tax.isDue <= 0} className={btnSecondary}>
                  {busy === 'tax' ? <Loader className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4 text-primary" />} Créer l'écriture d'IS
                </button>
              </div>
            </Panel>
          )}
        </div>

        <div className="space-y-3">
          <Panel title="Fichier des écritures comptables (FEC)">
            <p className={info}>Copie des écritures à remettre en cas de contrôle fiscal (CGI art. 145 et 210) : fichier texte, une ligne par ligne d'écriture validée ou contre-passée de l'exercice, à-nouveaux compris. Les brouillons n'y figurent pas.</p>
            <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3 sm:px-5">
              <select value={fecYearId} onChange={e => { setFecYearId(e.target.value); setFecReport(null); }} aria-label="Exercice du FEC" className={fieldAuto}>
                {years.map(y => <option key={y.id} value={y.id}>{y.label}{y.status === 'closed' ? ' (clôturé)' : ''}</option>)}
              </select>
              <button onClick={exportFec} disabled={busy !== null || !fecYearId} className={btnPrimary}>
                {busy === 'fec' ? <Loader className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Exporter le FEC
              </button>
            </div>
            {fecReport && (
              <div className="space-y-2 border-t border-border px-4 py-3 text-sm sm:px-5">
                <p className="flex items-center gap-2 font-medium text-foreground"><FileText className="h-4 w-4 text-primary" aria-hidden="true" />{fecReport.file}</p>
                <p className="text-xs text-muted-foreground">
                  {fecReport.entryCount} écritures · {fecReport.lineCount} lignes · débit {fmtMad(fecReport.totalDebit)} · crédit {fmtMad(fecReport.totalCredit)}
                </p>
                {fecReport.errors.length === 0
                  ? <p className="flex gap-1.5 text-xs text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />Contrôles réussis : débit = crédit, écritures équilibrées, numérotation continue par journal, comptes présents au plan.</p>
                  : (
                    <ul className="space-y-1 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-800 dark:text-red-200">
                      {fecReport.errors.map(e => <li key={e}>{e}</li>)}
                    </ul>
                  )}
                {fecReport.warnings.length > 0 && (
                  <ul className="space-y-1 text-xs text-amber-800 dark:text-amber-200">
                    {fecReport.warnings.map(w => <li key={w} className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{w}</li>)}
                  </ul>
                )}
              </div>
            )}
          </Panel>

          <Panel title="Exercices">
            <p className={info}>Deux exercices au plus peuvent être ouverts. Un exercice ouvert par erreur et sans écriture peut être supprimé.</p>
            <ul className="divide-y divide-border border-t border-border">
              {years.map(y => {
                const n = counts.get(y.id) || 0;
                return (
                  <li key={y.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm sm:px-5">
                    <span className="min-w-0">
                      <span className="block font-semibold text-foreground">{y.label}</span>
                      <span className="block text-xs tabular-nums text-muted-foreground">{frDay(y.start_date)} → {frDay(y.end_date)} · {n} écriture{n !== 1 ? 's' : ''}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      {y.status === 'closed'
                        ? <StatusPill tone="neutral" icon={<Lock className="h-3 w-3" />}>Clôturé</StatusPill>
                        : <StatusPill tone="success">Ouvert</StatusPill>}
                      {y.status === 'open' && n === 0 && (
                        <button onClick={() => removeYear(y)} aria-label={`Supprimer l'exercice ${y.label}`} title="Supprimer l'exercice vide" className={iconBtnDanger}><Trash2 className="h-4 w-4" /></button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      </div>

      <PhoneActionBar>{closeButton}</PhoneActionBar>
    </div>
  );
}
