import { Fragment, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronDown, ChevronRight, Coins, Download, FileText, Info, Lock, Package, RotateCcw, Scale, Search } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { StatusPill } from '../../components/lists/StatusPill';
import { btnPrimary, btnSecondary, checkbox, EmptyState, KpiTile, LoadingState, td, tdNum, tfootRow, th, theadRow, thRight } from '../../components/backoffice/BackOfficeUi';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { useAccessibleLocations } from '../../inventory/hooks/useAccessibleLocations';
import { useStockAtDate } from '../../inventory/hooks/useStockAtDate';
import { findLevelKey, locationCandidates } from '../../inventory/lib/locationKeys';
import { buildStockStatement, frDay, todayIn, type StockLine } from '../../inventory/lib/stockValuation';
import {
  brandsOf, buildInvoicedStock, canSeeInvoicedStock, filterRecon, reconTotals, type DocRef, type InvoicedOpening, type PurchaseInvoiceInput, type ReconLine, type SalesDocInput,
} from '../../inventory/lib/invoicedStock';
import { ISSUER_NOTE, reconCsvRows, SUPPLIER_CREDIT_NOTE_NOTE } from '../../inventory/lib/invoicedStockExport';
import { InvoicedStockService, INVOICED_STOCK_MIGRATION, SUPPLIER_MIGRATION } from '../../utils/supabaseInvoicedStock';
import { getCompanyContext } from '../../utils/supabaseCompanyFilter';
import { downloadText, toCsv } from '../../accounting/ledgerExport';
import { formatMoney } from '../../utils/format';
import type { StockLocation } from '../../types';
import { InvoicedStockOpening } from './InvoicedStockOpening';
import { opsField, opsLabel, opsPanel } from './stockOpsStyles';

const qtyFmt = (n: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(n).replace(/[\u202f\u00a0]/g, ' ');
const signedQty = (n: number) => (n > 0 ? `+${qtyFmt(n)}` : qtyFmt(n));
const PAGE = 200;
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const keyIsAt = (key: string, loc: Pick<StockLocation, 'name' | 'abbreviation'>) => findLevelKey({ [key]: 0 }, locationCandidates(loc)) === key;
const gapTone = (n: number) => (n > 0 ? 'text-amber-700 dark:text-amber-300' : n < 0 ? 'text-red-700 dark:text-red-300' : 'text-muted-foreground');

interface Sources {
  opening: InvoicedOpening | null;
  openingInstalled: boolean;
  purchases: PurchaseInvoiceInput[];
  suppliersInstalled: boolean;
  sales: SalesDocInput[];
  returned: Set<string>;
}

/**
 * "Stock facturé / réel": the stock the company's invoices give, next to the
 * real stock at the same date, with the gap. The page around it already
 * refuses users who may not see purchase costs.
 */
export function InvoicedStockView({ initialDay, onDay }: { initialDay: string; onDay?: (day: string) => void }) {
  const auth = useAuth();
  const { companyId } = getCompanyContext();
  if (!canSeeInvoicedStock(auth)) {
    return (
      <div className="mx-auto max-w-[110rem]">
        <PageHeader title="Stock comptable" subtitle="Stock facturé et stock réel" />
        <div className={opsPanel}>
          <EmptyState icon={Lock} title="Les factures fournisseurs ne sont pas accessibles à votre compte." hint="Le stock facturé est réservé à la comptabilité, à la facturation et aux administrateurs." />
        </div>
      </div>
    );
  }
  if (!companyId) {
    return (
      <div className="mx-auto max-w-[110rem]">
        <PageHeader title="Stock comptable" subtitle="Stock facturé et stock réel" />
        <div className={opsPanel}><EmptyState icon={Info} title="Aucune société n’est sélectionnée." hint="Le stock facturé se calcule société par société." /></div>
      </div>
    );
  }
  return <InvoicedStock companyId={companyId} initialDay={initialDay} onDay={onDay} />;
}

function InvoicedStock({ companyId, initialDay, onDay }: { companyId: string; initialDay: string; onDay?: (day: string) => void }) {
  const { companyName } = useAuth();
  const { showToast } = useToast();
  const today = useMemo(() => todayIn(), []);
  const [day, setDay] = useState(initialDay);
  const [dayInput, setDayInput] = useState(initialDay);
  const [query, setQuery] = useState('');
  const search = useDeferredValue(query);
  const [brand, setBrand] = useState('');
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [countUnreturned, setCountUnreturned] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [sources, setSources] = useState<Sources | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const { products, movements, settings, vatRate, loading, error } = useStockAtDate(day);
  const { locations, keyAllowed, loading: locationsLoading } = useAccessibleLocations();

  useEffect(() => { onDay?.(day); }, [day, onDay]);

  // Documents and opening: read once per company (and after a new opening);
  // a change of date only recomputes.
  useEffect(() => {
    let cancelled = false;
    setSourceError(null);
    (async () => {
      const [opening, purchases, sales] = await Promise.all([
        InvoicedStockService.opening(companyId),
        InvoicedStockService.purchases(companyId),
        InvoicedStockService.sales(companyId),
      ]);
      const returned = await InvoicedStockService.returnedToStock(sales.filter(d => d.document_type === 'avoir').map(d => d.id));
      if (!cancelled) {
        setSources({ opening: opening.opening, openingInstalled: opening.installed, purchases: purchases.invoices, suppliersInstalled: purchases.installed, sales, returned });
      }
    })().catch(e => { if (!cancelled) setSourceError((e as Error)?.message || 'Lecture des factures impossible'); });
    return () => { cancelled = true; };
  }, [companyId, version]);

  // Real stock: the locations of this company only (a super admin or a
  // billing user otherwise sees every company's locations), within what the
  // user may see. Without any location of the company, every visible one.
  const companyLocations = useMemo(() => locations.filter(l => l.company_id === companyId), [locations, companyId]);
  const keyInScope = useCallback((key: string) => keyAllowed(key) && (companyLocations.length === 0 || companyLocations.some(l => keyIsAt(key, l))), [keyAllowed, companyLocations]);

  const real = useMemo<StockLine[] | null>(() => {
    if (!products || !movements || locationsLoading) return null;
    return buildStockStatement(products, movements, { day, vatRate, keyInScope });
  }, [products, movements, locationsLoading, day, vatRate, keyInScope]);

  const rec = useMemo(() => {
    if (!real || !sources) return null;
    return buildInvoicedStock({
      companyId, day, opening: sources.opening, purchases: sources.purchases, sales: sources.sales,
      returnedToStock: sources.returned, countUnreturnedCredits: countUnreturned, real, companyVatRate: vatRate,
    });
  }, [real, sources, companyId, day, countUnreturned, vatRate]);

  const visible = useMemo(() => (rec ? filterRecon(rec.lines, { onlyGaps, search, brand }) : []), [rec, onlyGaps, search, brand]);
  const brands = useMemo(() => (rec ? brandsOf(rec.lines) : []), [rec]);
  const totals = useMemo(() => reconTotals(visible), [visible]);
  useEffect(() => { setShown(PAGE); }, [search, onlyGaps, brand, day]);

  const pickDay = (d: string) => { setDayInput(d); if (isDay(d)) setDay(d); };
  const company = settings?.company_name?.trim() || companyName || '';
  const openingAsOf = rec?.hasOpening ? sources!.opening!.asOf : null;
  const filters = [onlyGaps && 'écarts seulement', brand && `marque ${brand}`, search.trim() && `recherche « ${search.trim()} »`].filter(Boolean) as string[];

  const exportCsv = () => {
    if (!rec) return;
    const rows = reconCsvRows(visible, rec, { company, day, openingAsOf, producedAt: new Date(), filters, countUnreturnedCredits: countUnreturned });
    downloadText(toCsv(rows), `rapprochement-stock-facture-${day}.csv`, 'text/csv;charset=utf-8');
  };
  const exportPdf = async () => {
    if (!rec) return;
    try {
      const { exportInvoicedStockPdf } = await import('../../utils/invoicedStockPdf');
      exportInvoicedStockPdf(visible, rec, { day, openingAsOf, settings, producedAt: new Date(), filters, countUnreturnedCredits: countUnreturned });
    } catch (e) { showToast({ type: 'error', message: (e as Error)?.message || 'PDF impossible' }); }
  };

  const ready = !loading && !!rec;
  const opening = sources?.opening || null;
  const failed = error || sourceError;

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="Stock comptable"
        subtitle={`Stock facturé et stock réel au ${frDay(day)}`}
        actions={<>
          <button type="button" onClick={exportCsv} disabled={!ready || rec!.beforeOpening} className={btnSecondary}><Download className="h-4 w-4" aria-hidden="true" /> CSV</button>
          <button type="button" onClick={exportPdf} disabled={!ready || rec!.beforeOpening} className={btnSecondary}><FileText className="h-4 w-4" aria-hidden="true" /> PDF</button>
          <button type="button" onClick={() => setEditing(true)} disabled={!products || !sources || locationsLoading} className={btnPrimary}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> {opening ? 'Refaire l’ouverture' : 'Initialiser le stock facturé'}
          </button>
        </>}
      />

      <div className={`${opsPanel} mb-4 space-y-2 p-4 text-sm text-muted-foreground`}>
        <p className="text-foreground">
          Le stock facturé suit les factures : ouverture + achats sur factures fournisseurs validées − ventes sur factures émises + retours sur avoirs.
          L’écart est le stock réel moins le stock facturé.
        </p>
        <p><span className="font-semibold text-foreground">Écart positif</span> : des marchandises sont au dépôt sans que les factures le montrent. Elles ont été reçues mais leur facture fournisseur n’est pas encore enregistrée ou validée, ou bien elles sont déjà facturées à un client mais pas encore livrées.</p>
        <p><span className="font-semibold text-foreground">Écart négatif</span> : l’inverse. Des marchandises sont facturées par un fournisseur mais pas encore reçues, ou livrées à un client mais pas encore facturées.</p>
        <p>Les inventaires, la casse et les ajustements de stock ne passent pas par les factures : ils apparaissent aussi dans l’écart. {ISSUER_NOTE} {SUPPLIER_CREDIT_NOTE_NOTE}</p>
      </div>

      <div className={`${opsPanel} mb-4 p-4`}>
        <div className="grid gap-3 md:grid-cols-[auto_minmax(0,14rem)_minmax(0,1fr)]">
          <div>
            <label htmlFor="invoiced-day" className={opsLabel}>Date</label>
            <input id="invoiced-day" type="date" value={dayInput} onChange={e => pickDay(e.target.value)} className={`${opsField} md:w-44`} />
          </div>
          <div>
            <label htmlFor="invoiced-brand" className={opsLabel}>Marque</label>
            <select id="invoiced-brand" value={brand} onChange={e => setBrand(e.target.value)} className={opsField}>
              <option value="">Toutes les marques</option>
              {brands.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="invoiced-search" className={opsLabel}>Rechercher</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input id="invoiced-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Référence, article ou marque" className={`${opsField} pl-9`} />
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => pickDay(today)} aria-pressed={day === today} className={`${btnSecondary} min-h-9`}>Aujourd’hui</button>
          {opening && <button type="button" onClick={() => pickDay(opening.asOf)} aria-pressed={day === opening.asOf} className={`${btnSecondary} min-h-9`}>Ouverture ({frDay(opening.asOf)})</button>}
          <span className="flex-1" />
          <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" className={checkbox} checked={onlyGaps} onChange={e => setOnlyGaps(e.target.checked)} />Écarts seulement</label>
        </div>
        {day > today && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Date à venir : le stock réel affiché est le stock actuel.</p>}
      </div>

      {sources && <OpeningBanner sources={sources} />}

      {failed ? (
        <div className={opsPanel}><EmptyState icon={AlertTriangle} title="Le stock facturé n’a pas pu être calculé." hint={failed} /></div>
      ) : !ready ? (
        <LoadingState label="Lecture des factures et du stock…" />
      ) : rec!.beforeOpening ? (
        <div className={opsPanel}>
          <EmptyState icon={Info} title={`Le stock facturé commence le ${frDay(opening!.asOf)}, date de l’ouverture.`} hint="Choisissez une date à partir de celle-ci." />
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile icon={Package} label="Références avec un écart" value={`${totals.gapLines} / ${totals.references}`} />
            <KpiTile icon={FileText} label="Stock facturé HT" value={formatMoney(totals.invoicedValue)} />
            <KpiTile icon={Coins} label="Stock réel HT" value={formatMoney(totals.realValue)} />
            <KpiTile icon={Scale} label="Valeur de l’écart HT" value={formatMoney(totals.gapValue)} valueClassName={gapTone(totals.gapValue)} />
          </div>

          <Notes rec={rec!} countUnreturned={countUnreturned} setCountUnreturned={setCountUnreturned} companyLocations={companyLocations.length} />

          <div className={`${opsPanel} overflow-hidden`}>
            {visible.length === 0 ? (
              <EmptyState icon={Package} title="Aucun article." hint={onlyGaps ? 'Aucun écart avec ces filtres.' : undefined} />
            ) : (
              <>
                <ul className="divide-y divide-border md:hidden">
                  {visible.slice(0, shown).map(l => (
                    <li key={l.barcode} className="px-4 py-3">
                      <button type="button" onClick={() => setOpen(o => (o === l.barcode ? null : l.barcode))} aria-expanded={open === l.barcode} className="flex w-full items-start justify-between gap-3 text-left">
                        <span className="min-w-0">
                          <span className="line-clamp-2 font-medium text-foreground">{l.name}</span>
                          <span className="block truncate text-xs text-muted-foreground"><span className="font-mono">{l.barcode}</span>{l.brand ? ` · ${l.brand}` : ''}</span>
                        </span>
                        <span className={`shrink-0 font-semibold tabular-nums ${gapTone(l.gap)}`}>{signedQty(l.gap)}</span>
                      </button>
                      <p className="mt-1 text-xs text-muted-foreground">Facturé <span className="tabular-nums text-foreground">{qtyFmt(l.invoiced)}</span> · Réel <span className="tabular-nums text-foreground">{qtyFmt(l.real)}</span> · Écart <span className="tabular-nums text-foreground">{formatMoney(l.gapValue)}</span></p>
                      {open === l.barcode && <Detail line={l} docs={rec!.docs.get(l.barcode) || []} openingAsOf={openingAsOf} />}
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto md:block">
                  <table aria-label="Rapprochement par article" className="w-full text-sm">
                    <thead>
                      <tr className={theadRow}>
                        <th className={th}>Référence</th>
                        <th className={th}>Article</th>
                        <th className={th}>Marque</th>
                        <th className={thRight}>Ouverture</th>
                        <th className={thRight}>Acheté</th>
                        <th className={thRight}>Vendu</th>
                        <th className={thRight}>Retourné</th>
                        <th className={thRight}>Stock facturé</th>
                        <th className={thRight}>Stock réel</th>
                        <th className={thRight}>Écart</th>
                        <th className={thRight}>Valeur de l’écart HT</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {visible.slice(0, shown).map(l => (
                        <Fragment key={l.barcode}>
                          <tr className="hover:bg-secondary/40">
                            <td className={`${td} font-mono text-xs text-muted-foreground`}>{l.barcode}</td>
                            <td className={td}>
                              <button type="button" onClick={() => setOpen(o => (o === l.barcode ? null : l.barcode))} aria-expanded={open === l.barcode}
                                aria-label={`Détail ${l.name}`} className="inline-flex items-center gap-1 text-left font-medium text-foreground hover:underline">
                                {open === l.barcode ? <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                                {l.name}
                              </button>
                              {!l.inCatalogue && <span className="ml-2"><StatusPill tone="warning">Hors catalogue</StatusPill></span>}
                              {l.currentCost && l.gap !== 0 && <span className="ml-2" title="Coût à la date non reconstitué : coût moyen actuel"><StatusPill tone="warning">Coût actuel</StatusPill></span>}
                            </td>
                            <td className={`${td} text-muted-foreground`}>{l.brand || '—'}</td>
                            <td className={`${tdNum} text-muted-foreground`}>{qtyFmt(l.opening)}</td>
                            <td className={tdNum}>{qtyFmt(l.bought)}</td>
                            <td className={tdNum}>{qtyFmt(l.sold)}</td>
                            <td className={tdNum}>{qtyFmt(l.returned)}</td>
                            <td className={`${tdNum} font-semibold text-foreground`}>{qtyFmt(l.invoiced)}</td>
                            <td className={`${tdNum} font-semibold text-foreground`}>{qtyFmt(l.real)}</td>
                            <td className={`${tdNum} font-semibold ${gapTone(l.gap)}`}>{signedQty(l.gap)}</td>
                            <td className={`${tdNum} ${gapTone(l.gapValue)}`}>{formatMoney(l.gapValue)}</td>
                          </tr>
                          {open === l.barcode && (
                            <tr><td colSpan={11} className="bg-secondary/30 px-4 py-3"><Detail line={l} docs={rec!.docs.get(l.barcode) || []} openingAsOf={openingAsOf} /></td></tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className={tfootRow}>
                        <td className={td} colSpan={3}>Total : {totals.references} référence{totals.references > 1 ? 's' : ''}, {totals.gapLines} avec un écart</td>
                        <td className={tdNum}>{qtyFmt(totals.opening)}</td>
                        <td className={tdNum}>{qtyFmt(totals.bought)}</td>
                        <td className={tdNum}>{qtyFmt(totals.sold)}</td>
                        <td className={tdNum}>{qtyFmt(totals.returned)}</td>
                        <td className={tdNum}>{qtyFmt(totals.invoiced)}</td>
                        <td className={tdNum}>{qtyFmt(totals.real)}</td>
                        <td className={tdNum}>{signedQty(totals.gap)}</td>
                        <td className={tdNum}>{formatMoney(totals.gapValue)}</td>
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

      {editing && products && sources && (
        <InvoicedStockOpening
          companyId={companyId} products={products} vatRate={vatRate} keyInScope={keyInScope}
          existing={sources.opening} installed={sources.openingInstalled} today={today}
          onClose={() => setEditing(false)}
          onSaved={count => {
            setEditing(false);
            showToast({ type: 'success', message: `Ouverture enregistrée (${count} article${count > 1 ? 's' : ''}).` });
            setSources(null);
            setVersion(v => v + 1);
          }}
        />
      )}
    </div>
  );
}

function OpeningBanner({ sources }: { sources: Sources }) {
  const o = sources.opening;
  return (
    <div className="mb-4 space-y-2">
      {!sources.suppliersInstalled && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          Les factures fournisseurs ne sont pas encore installées : aucun achat n’est compté. Exécutez la migration {SUPPLIER_MIGRATION} dans Supabase.
        </p>
      )}
      {o ? (
        <p className="rounded-lg bg-secondary/60 px-3 py-2 text-sm text-foreground">
          Ouverture au {frDay(o.asOf)} : {o.quantities.size} article{o.quantities.size > 1 ? 's' : ''}{o.savedBy ? `, enregistrée par ${o.savedBy}` : ''}.
          Les factures datées de ce jour ou avant sont comprises dans l’ouverture.
        </p>
      ) : (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          Aucune ouverture : le stock facturé part de zéro, comme si rien n’avait été acheté ni vendu avant les premières factures enregistrées.
          Les chiffres n’ont de sens qu’une fois le stock facturé initialisé.
          {!sources.openingInstalled && ` Pour enregistrer une ouverture, exécutez la migration ${INVOICED_STOCK_MIGRATION} dans Supabase.`}
        </p>
      )}
    </div>
  );
}

function Notes({ rec, countUnreturned, setCountUnreturned, companyLocations }: {
  rec: ReturnType<typeof buildInvoicedStock>;
  countUnreturned: boolean;
  setCountUnreturned: (v: boolean) => void;
  companyLocations: number;
}) {
  const u = rec.uncounted;
  const un = rec.creditNotes.unreturned;
  const unAmount = un.reduce((s, c) => s + c.amountHt, 0);
  return (
    <div className="mb-4 space-y-1 text-sm text-muted-foreground">
      <p>
        Comptés : {rec.counted.purchaseInvoices} facture{rec.counted.purchaseInvoices > 1 ? 's' : ''} fournisseur{rec.counted.purchaseInvoices > 1 ? 's' : ''}, {rec.counted.salesInvoices} facture{rec.counted.salesInvoices > 1 ? 's' : ''} client{rec.counted.salesInvoices > 1 ? 's' : ''}, {rec.counted.creditNotes} avoir{rec.counted.creditNotes > 1 ? 's' : ''}.
        {companyLocations === 0 ? ' Aucun emplacement n’est rattaché à cette société : le stock réel couvre tous les emplacements visibles.' : ` Stock réel : ${companyLocations} emplacement${companyLocations > 1 ? 's' : ''} de la société.`}
      </p>
      {(u.saleLines > 0 || u.creditLines > 0) && (
        <p>
          Non comptés, faute d’article du catalogue :
          {u.saleLines > 0 && ` ${u.saleLines} ligne${u.saleLines > 1 ? 's' : ''} de factures (${formatMoney(u.saleAmountHt)} HT)`}
          {u.saleLines > 0 && u.creditLines > 0 && ','}
          {u.creditLines > 0 && ` ${u.creditLines} ligne${u.creditLines > 1 ? 's' : ''} d’avoirs (${formatMoney(u.creditAmountHt)} HT)`}.
        </p>
      )}
      {un.length > 0 && (
        <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-200">
          <p>
            {un.length} avoir{un.length > 1 ? 's' : ''} ({un.map(c => c.number).slice(0, 5).join(', ')}{un.length > 5 ? '…' : ''}, {formatMoney(unAmount)} HT) {un.length > 1 ? 'portent' : 'porte'} des articles qui n’ont pas été remis en stock.
            Rien ne dit s’il s’agit d’une réduction de prix ou d’un retour pas encore remis en stock : {countUnreturned ? 'ils sont comptés comme retours.' : 'ils sont traités comme des réductions de prix et ne sont pas comptés.'}
          </p>
          <label className="mt-1 flex items-center gap-2 text-foreground">
            <input type="checkbox" className={checkbox} checked={countUnreturned} onChange={e => setCountUnreturned(e.target.checked)} />
            Compter ces avoirs comme retours de marchandises
          </label>
        </div>
      )}
      {rec.creditNotes.withoutGoods.length > 0 && (
        <p>{rec.creditNotes.withoutGoods.length} avoir{rec.creditNotes.withoutGoods.length > 1 ? 's' : ''} sans lignes d’articles (réductions de prix) : non compté{rec.creditNotes.withoutGoods.length > 1 ? 's' : ''}.</p>
      )}
    </div>
  );
}

const DOC_LABEL: Record<DocRef['kind'], string> = { purchase: 'Facture fournisseur', sale: 'Facture client', return: 'Avoir' };
const docLink = (d: DocRef) => (d.kind === 'purchase' ? `/compta/factures-fournisseurs/${d.id}` : d.kind === 'sale' ? `/compta/invoices/${d.id}` : `/compta/avoirs/${d.id}`);

function Detail({ line, docs, openingAsOf }: { line: ReconLine; docs: DocRef[]; openingAsOf: string | null }) {
  return (
    <div className="mt-2 text-xs">
      <p className="mb-2 text-muted-foreground">
        {qtyFmt(line.opening)} à l’ouverture + {qtyFmt(line.bought)} achetés − {qtyFmt(line.sold)} vendus + {qtyFmt(line.returned)} retournés = {qtyFmt(line.invoiced)} facturés ;
        réel {qtyFmt(line.real)} ; écart {signedQty(line.gap)} × {formatMoney(line.unitCost)} = {formatMoney(line.gapValue)}.
      </p>
      {docs.length === 0 ? (
        <p className="text-muted-foreground">Aucune facture ni avoir {openingAsOf ? `après l’ouverture du ${frDay(openingAsOf)}` : 'à cette date'}.</p>
      ) : (
        <table aria-label={`Documents comptés pour ${line.name}`} className="w-full max-w-3xl">
          <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-3 font-medium">Date</th><th className="py-1 pr-3 font-medium">Document</th><th className="py-1 pr-3 font-medium">Tiers</th><th className="py-1 text-right font-medium">Quantité</th></tr></thead>
          <tbody>
            {docs.map(d => (
              <tr key={`${d.kind}-${d.id}`}>
                <td className="py-1 pr-3 tabular-nums">{frDay(d.date)}</td>
                <td className="py-1 pr-3"><Link to={docLink(d)} className="text-primary hover:underline">{DOC_LABEL[d.kind]} {d.number}</Link></td>
                <td className="py-1 pr-3 text-muted-foreground">{d.party || '—'}</td>
                <td className="py-1 text-right tabular-nums">{d.kind === 'sale' ? '−' : '+'}{qtyFmt(d.quantity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
