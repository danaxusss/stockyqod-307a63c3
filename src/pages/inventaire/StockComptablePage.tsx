import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Boxes, Coins, Download, FileText, Lock, Package, Search } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { InvoicedStockView } from './InvoicedStockView';
import { StatusPill } from '../../components/lists/StatusPill';
import { btnSecondary, checkbox, EmptyState, KpiTile, LoadingState, Segmented, tdNum, th, theadRow, thRight, tfootRow, td } from '../../components/backoffice/BackOfficeUi';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { useAccessibleLocations } from '../../inventory/hooks/useAccessibleLocations';
import { useStockAtDate } from '../../inventory/hooks/useStockAtDate';
import { findLevelKey, locationCandidates } from '../../inventory/lib/locationKeys';
import {
  buildStockStatement, FALLBACK_LABEL, frDay, inventoryCsvRows, statementTotals, todayIn, VALUATION_METHOD, vatRuleText, type StockLine,
} from '../../inventory/lib/stockValuation';
import { downloadText, toCsv } from '../../accounting/ledgerExport';
import { STOCK_ACCOUNT } from '../../accounting/stockEntry';
import { AccountingService } from '../../utils/supabaseAccounting';
import { seesPurchaseCosts } from '../../utils/productCosts';
import { formatMoney } from '../../utils/format';
import type { FiscalYear, StockLocation } from '../../types';
import { opsField, opsLabel, opsPanel } from './stockOpsStyles';

const qtyFmt = (n: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(n).replace(/[\u202f\u00a0]/g, ' ');
const PAGE = 200;
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const keyIsAt = (key: string, loc: StockLocation) => findLevelKey({ [key]: 0 }, locationCandidates(loc)) === key;

/**
 * Stock comptable: the detailed inventory at a date, in quantity and value
 * excluding VAT (CGI art. 145-II), next to the balance of 3111 in the books.
 * Purchase prices are never shown to resellers: the page refuses itself to
 * them, on top of the route.
 */
export default function StockComptablePage() {
  const { getPriceDisplayType, isAdmin, isSuperAdmin } = useAuth();
  const allowed = seesPurchaseCosts({ priceDisplayType: getPriceDisplayType?.(), isAdmin, isSuperAdmin });
  if (!allowed) {
    return (
      <div className="mx-auto max-w-[110rem]">
        <PageHeader title="Stock comptable" subtitle="Inventaire détaillé en quantité et en valeur" />
        <div className={opsPanel}>
          <EmptyState icon={Lock} title="Les prix d’achat ne sont pas accessibles à votre compte." hint="L’inventaire valorisé n’est donc pas disponible." />
        </div>
      </div>
    );
  }
  return <StockComptableViews />;
}

type View = 'valorise' | 'facture';

/**
 * Two views of the stock at a date: the real stock valued ("Stock réel
 * valorisé") and the stock the invoices give next to it ("Stock facturé /
 * réel"). ?vue=facture opens the second; the date follows from one to the other.
 */
function StockComptableViews() {
  const [params, setParams] = useSearchParams();
  const view: View = params.get('vue') === 'facture' ? 'facture' : 'valorise';
  const asked = params.get('date') || '';
  const [day, setDay] = useState(() => (isDay(asked) ? asked : todayIn()));
  const pick = (v: View) => setParams(p => { const n = new URLSearchParams(p); if (v === 'facture') n.set('vue', 'facture'); else n.delete('vue'); return n; }, { replace: true });
  return (
    <>
      <div className="mx-auto mb-3 max-w-[110rem]">
        <Segmented<View> label="Vue du stock" value={view} onChange={pick}
          options={[{ value: 'valorise', label: 'Stock réel valorisé' }, { value: 'facture', label: 'Stock facturé / réel' }]} />
      </div>
      {view === 'facture' ? <InvoicedStockView initialDay={day} onDay={setDay} /> : <StockComptable initialDay={day} onDay={setDay} />}
    </>
  );
}

function StockComptable({ initialDay, onDay }: { initialDay?: string; onDay?: (day: string) => void }) {
  const { companyName } = useAuth();
  const { showToast } = useToast();
  const today = useMemo(() => todayIn(), []);
  // ?date=YYYY-MM-DD: the Clôture page links to the statement at the year end.
  const [params] = useSearchParams();
  const asked = params.get('date') || '';
  const start = initialDay && isDay(initialDay) ? initialDay : isDay(asked) ? asked : today;
  const [day, setDay] = useState(start);
  const [dayInput, setDayInput] = useState(start);
  useEffect(() => { onDay?.(day); }, [day, onDay]);
  const [locationId, setLocationId] = useState('');
  const [query, setQuery] = useState('');
  const search = useDeferredValue(query);
  const [hideZero, setHideZero] = useState(true);
  const [perLocation, setPerLocation] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [years, setYears] = useState<FiscalYear[]>([]);
  const [hasChart, setHasChart] = useState(false);
  const [books, setBooks] = useState<{ day: string; balance: number | null } | null>(null);

  const { products, movements, settings, vatRate, loading, error } = useStockAtDate(day);
  const { accessibleLocations, keyAllowed, loading: locationsLoading } = useAccessibleLocations();

  // Fiscal years and the chart: only for the date shortcuts and the 3111
  // comparison, so a user without accounting rights just goes without.
  useEffect(() => {
    AccountingService.listFiscalYears().then(setYears).catch(() => setYears([]));
    AccountingService.listAccounts().then(a => setHasChart(a.length > 0)).catch(() => setHasChart(false));
  }, []);

  useEffect(() => {
    if (!hasChart) { setBooks(null); return; }
    let cancelled = false;
    AccountingService.accountBalanceAt(STOCK_ACCOUNT, day)
      .then(r => { if (!cancelled) setBooks({ day, balance: r ? r.balance : null }); })
      .catch(() => { if (!cancelled) setBooks(null); });
    return () => { cancelled = true; };
  }, [hasChart, day]);

  const location = accessibleLocations.find(l => l.id === locationId) || null;
  const keyLabel = useCallback((key: string) => accessibleLocations.find(l => keyIsAt(key, l))?.name || key, [accessibleLocations]);

  // Computed once per date (and branch scope); search and display options only filter it.
  const all = useMemo<StockLine[] | null>(() => {
    if (!products || !movements || locationsLoading) return null;
    return buildStockStatement(products, movements, { day, vatRate, keyInScope: keyAllowed });
  }, [products, movements, locationsLoading, day, vatRate, keyAllowed]);

  const scoped = useMemo<StockLine[] | null>(() => {
    if (!all) return null;
    if (!location) return all;
    return all.map(l => {
      const byKey = Object.fromEntries(Object.entries(l.byKey).filter(([k]) => keyIsAt(k, location)));
      const quantity = Math.round(Object.values(byKey).reduce((s, q) => s + q, 0) * 1e6) / 1e6;
      return { ...l, byKey, quantity, negative: quantity < 0, value: quantity > 0 ? Math.round(quantity * l.unitCost * 100) / 100 : 0 };
    });
  }, [all, location]);

  const visible = useMemo(() => {
    if (!scoped) return [];
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return scoped
      .filter(l => !hideZero || l.quantity !== 0)
      .filter(l => terms.every(t => `${l.barcode} ${l.name} ${l.brand}`.toLowerCase().includes(t)))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr') || a.barcode.localeCompare(b.barcode));
  }, [scoped, search, hideZero]);

  useEffect(() => { setShown(PAGE); }, [search, hideZero, locationId, day]);

  const totals = useMemo(() => statementTotals(visible), [visible]);
  const fullTotal = useMemo(() => (all ? statementTotals(all).value : 0), [all]);
  const filtered = !!location || search.trim() !== '';

  const pickDay = (d: string) => { setDayInput(d); if (isDay(d)) setDay(d); };
  const yearEnds = useMemo(() => [...years].sort((a, b) => b.end_date.localeCompare(a.end_date)).filter(y => y.end_date <= today).slice(0, 4), [years, today]);

  const company = settings?.company_name?.trim() || companyName || '';
  const exportCsv = () => {
    const rows = inventoryCsvRows(visible, { company, day, vatRate, location: location?.name, producedAt: new Date(), ...(perLocation ? { keyLabel } : {}) });
    downloadText(toCsv(rows), `inventaire-${day}.csv`, 'text/csv;charset=utf-8');
  };
  const exportPdf = async () => {
    try {
      const { exportStockInventoryPdf } = await import('../../utils/stockInventoryPdf');
      exportStockInventoryPdf(visible, { day, vatRate, settings, location: location?.name, producedAt: new Date() });
    } catch (e) { showToast({ type: 'error', message: (e as Error)?.message || 'PDF impossible' }); }
  };

  const ready = !loading && !!scoped;
  const difference = books && books.balance !== null ? Math.round((fullTotal - books.balance) * 100) / 100 : null;

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="Stock comptable"
        subtitle={`Inventaire détaillé au ${frDay(day)}, en quantité et en valeur`}
        actions={<>
          <button type="button" onClick={exportCsv} disabled={!ready} className={btnSecondary}><Download className="h-4 w-4" aria-hidden="true" /> CSV</button>
          <button type="button" onClick={exportPdf} disabled={!ready} className={btnSecondary}><FileText className="h-4 w-4" aria-hidden="true" /> PDF</button>
        </>}
      />

      <div className={`${opsPanel} mb-4 p-4`}>
        <div className="grid gap-3 md:grid-cols-[auto_minmax(0,14rem)_minmax(0,1fr)]">
          <div>
            <label htmlFor="stock-day" className={opsLabel}>Date de l’inventaire</label>
            <input id="stock-day" type="date" value={dayInput} onChange={e => pickDay(e.target.value)} className={`${opsField} md:w-44`} />
          </div>
          <div>
            <label htmlFor="stock-location" className={opsLabel}>Emplacement</label>
            <select id="stock-location" value={locationId} onChange={e => setLocationId(e.target.value)} className={opsField}>
              <option value="">Tous les emplacements</option>
              {accessibleLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="stock-search" className={opsLabel}>Rechercher</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input id="stock-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Référence, article ou marque" className={`${opsField} pl-9`} />
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => pickDay(today)} aria-pressed={day === today} className={`${btnSecondary} min-h-9`}>Aujourd’hui</button>
          {yearEnds.map(y => (
            <button key={y.id} type="button" onClick={() => pickDay(y.end_date)} aria-pressed={day === y.end_date} className={`${btnSecondary} min-h-9`}>
              Fin {y.label} ({frDay(y.end_date)})
            </button>
          ))}
          <span className="flex-1" />
          <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" className={checkbox} checked={hideZero} onChange={e => setHideZero(e.target.checked)} />Masquer les quantités nulles</label>
          <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" className={checkbox} checked={perLocation} onChange={e => setPerLocation(e.target.checked)} />Détail par emplacement</label>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Méthode : {VALUATION_METHOD}. {vatRuleText(vatRate)}</p>
        {day > today && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Date à venir : le stock affiché est le stock actuel.</p>}
      </div>

      {error ? (
        <div className={opsPanel}><EmptyState icon={AlertTriangle} title="Le stock n’a pas pu être lu." hint={error} /></div>
      ) : !ready ? (
        <LoadingState label="Calcul du stock à la date…" />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile icon={Package} label="Références en stock" value={String(totals.references)} />
            <KpiTile icon={Boxes} label="Quantité totale" value={qtyFmt(totals.quantity)} />
            <KpiTile icon={Coins} label="Valeur hors taxe" value={formatMoney(totals.value)} />
            {hasChart && (
              <KpiTile icon={FileText} label={`Compte ${STOCK_ACCOUNT} au ${frDay(day)}`}
                value={books && books.balance !== null ? formatMoney(books.balance) : '—'}
                hint={books && books.balance === null ? 'Aucun exercice ne couvre cette date' : difference !== null ? `Écart ${formatMoney(difference)}` : undefined}
                valueClassName={difference !== null && Math.abs(difference) > 0.005 ? 'text-amber-700 dark:text-amber-300' : 'text-foreground'} />
            )}
          </div>

          <div className="mb-4 space-y-1 text-sm text-muted-foreground">
            <p>
              {totals.fallbackLines} ligne{totals.fallbackLines > 1 ? 's' : ''} au coût moyen actuel · {totals.negativeLines} ligne{totals.negativeLines > 1 ? 's' : ''} en quantité négative (comptée{totals.negativeLines > 1 ? 's' : ''} pour zéro dans la valeur).
            </p>
            {hasChart && (
              <p>
                {filtered ? `Le compte ${STOCK_ACCOUNT} se compare au stock de toutes les références et de tous les emplacements : ${formatMoney(fullTotal)}. ` : ''}
                Le solde du compte {STOCK_ACCOUNT} rejoint le stock valorisé une fois l’écriture de stock de fin d’exercice validée (Clôture d’exercice).
              </p>
            )}
          </div>

          <div className={`${opsPanel} overflow-hidden`}>
            {visible.length === 0 ? (
              <EmptyState icon={Package} title="Aucun article à cette date." hint={hideZero ? 'Les quantités nulles sont masquées.' : undefined} />
            ) : (
              <>
                <ul className="divide-y divide-border md:hidden">
                  {visible.slice(0, shown).map(l => (
                    <li key={l.barcode} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="line-clamp-2 font-medium text-foreground">{l.name}</p>
                          <p className="truncate text-xs text-muted-foreground"><span className="font-mono">{l.barcode}</span>{l.brand ? ` · ${l.brand}` : ''}</p>
                        </div>
                        <p className="shrink-0 font-semibold tabular-nums text-foreground">{formatMoney(l.value)}</p>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>Qté <span className={`tabular-nums ${l.negative ? 'text-red-700 dark:text-red-300' : 'text-foreground'}`}>{qtyFmt(l.quantity)}</span></span>
                        <span>Coût HT <span className="tabular-nums text-foreground">{formatMoney(l.unitCost)}</span></span>
                        <LineMarks line={l} />
                      </div>
                      {perLocation && <LocationDetail line={l} keyLabel={keyLabel} />}
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={theadRow}>
                        <th className={th}>Référence</th>
                        <th className={th}>Article</th>
                        <th className={th}>Marque</th>
                        <th className={thRight}>Quantité</th>
                        <th className={thRight}>Coût unitaire HT</th>
                        <th className={thRight}>Valeur HT</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {visible.slice(0, shown).map(l => (
                        <tr key={l.barcode} className="hover:bg-secondary/40">
                          <td className={`${td} font-mono text-xs text-muted-foreground`}>{l.barcode}</td>
                          <td className={td}>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-foreground">{l.name}</span>
                              <LineMarks line={l} />
                            </div>
                            {perLocation && <LocationDetail line={l} keyLabel={keyLabel} />}
                          </td>
                          <td className={`${td} text-muted-foreground`}>{l.brand || '—'}</td>
                          <td className={`${tdNum} ${l.negative ? 'text-red-700 dark:text-red-300' : 'text-foreground'}`}>{qtyFmt(l.quantity)}</td>
                          <td className={`${tdNum} text-muted-foreground`}>{formatMoney(l.unitCost)}</td>
                          <td className={`${tdNum} font-semibold text-foreground`}>{formatMoney(l.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className={tfootRow}>
                        <td className={td} colSpan={3}>Total : {totals.references} référence{totals.references > 1 ? 's' : ''} en stock</td>
                        <td className={tdNum}>{qtyFmt(totals.quantity)}</td>
                        <td className={tdNum} />
                        <td className={tdNum}>{formatMoney(totals.value)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {visible.length > shown && (
                  <div className="flex items-center justify-center gap-3 border-t border-border px-4 py-3 text-sm text-muted-foreground">
                    {shown} sur {visible.length} lignes affichées
                    <button type="button" onClick={() => setShown(s => s + PAGE)} className={`${btnSecondary} min-h-9`}>Afficher {Math.min(PAGE, visible.length - shown)} de plus</button>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function LineMarks({ line }: { line: StockLine }) {
  return (
    <>
      {line.currentCost && line.quantity !== 0 && (
        <span title={`Coût à la date non reconstitué : ${FALLBACK_LABEL[line.fallbackReason || 'no_cost']}`}>
          <StatusPill tone="warning">Coût actuel</StatusPill>
        </span>
      )}
      {line.negative && <StatusPill tone="danger">Négatif</StatusPill>}
    </>
  );
}

function LocationDetail({ line, keyLabel }: { line: StockLine; keyLabel: (key: string) => string }) {
  const parts = Object.entries(line.byKey).filter(([, q]) => q !== 0);
  if (parts.length === 0) return null;
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {parts.map(([k, q], i) => (
        <span key={k}>{i > 0 ? ' · ' : ''}{keyLabel(k)} <span className={`tabular-nums ${q < 0 ? 'text-red-700 dark:text-red-300' : 'text-foreground'}`}>{qtyFmt(q)}</span></span>
      ))}
    </p>
  );
}
