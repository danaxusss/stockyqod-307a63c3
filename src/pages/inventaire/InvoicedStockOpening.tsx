import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Boxes, Loader, Plus, Save, Search, Trash2, Upload, X } from 'lucide-react';
import { btnPrimary, btnSecondary, fieldSm, iconBtnDanger, td, tdNum, th, theadRow, thRight } from '../../components/backoffice/BackOfficeUi';
import { useEscapeKey } from '../../hooks/useShortcuts';
import { StockService } from '../../utils/supabaseStock';
import { InvoicedStockService, INVOICED_STOCK_MIGRATION } from '../../utils/supabaseInvoicedStock';
import { buildStockStatement, dayEndInstant, frDay, type ValuationMovement, type ValuationProduct } from '../../inventory/lib/stockValuation';
import { openingErrors, openingPayload, parseOpeningCsv, proposeOpening, type CsvProblem, type InvoicedOpening, type OpeningLine } from '../../inventory/lib/invoicedStock';
import { opsField, opsLabel } from './stockOpsStyles';

const PAGE = 200;
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * "Initialiser le stock facturé": the opening quantities, proposed from the
 * real stock at the chosen date, editable line by line or imported from a
 * spreadsheet, then saved as a whole (it replaces the previous opening).
 */
export function InvoicedStockOpening({ companyId, products, vatRate, keyInScope, existing, installed, today, onClose, onSaved }: {
  companyId: string;
  products: ValuationProduct[];
  vatRate: number;
  keyInScope: (key: string) => boolean;
  existing: InvoicedOpening | null;
  /** False before the migration: everything works but saving. */
  installed: boolean;
  today: string;
  onClose: () => void;
  onSaved: (count: number) => void;
}) {
  const [asOf, setAsOf] = useState(existing?.asOf || today);
  const [lines, setLines] = useState<OpeningLine[]>(() => existing
    ? [...existing.quantities].map(([barcode, quantity]) => ({ barcode, quantity })).sort((a, b) => a.barcode.localeCompare(b.barcode))
    : []);
  const [busy, setBusy] = useState<'propose' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<CsvProblem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const search = useDeferredValue(query);
  const [shown, setShown] = useState(PAGE);
  // Bumped when every line is replaced, so the quantity fields start again from the new values.
  const [version, setVersion] = useState(0);
  const [addRef, setAddRef] = useState('');
  const [addQty, setAddQty] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  useEscapeKey(onClose, true);

  const byBarcode = useMemo(() => new Map(products.map(p => [p.barcode, p])), [products]);
  const known = useMemo(() => new Set(products.map(p => p.barcode)), [products]);

  const visible = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return lines.map((l, index) => ({ ...l, index }))
      .filter(l => terms.every(t => `${l.barcode} ${byBarcode.get(l.barcode)?.name || ''} ${byBarcode.get(l.barcode)?.brand || ''}`.toLowerCase().includes(t)));
  }, [lines, search, byBarcode]);

  const propose = async () => {
    if (!isDay(asOf)) { setError('Indiquez la date de l’ouverture.'); return; }
    if (lines.length > 0 && !window.confirm(`Remplacer les ${lines.length} lignes affichées par le stock réel au ${frDay(asOf)} ?`)) return;
    setBusy('propose'); setError(null); setProblems([]);
    try {
      // Same reading and computation as the Stock comptable statement.
      const movements = await StockService.getMovementsSince(new Date(dayEndInstant(asOf)).toISOString()) as ValuationMovement[];
      const real = buildStockStatement(products, movements, { day: asOf, vatRate, keyInScope });
      const proposed = proposeOpening(real);
      setLines(proposed);
      setVersion(v => v + 1);
      setShown(PAGE);
      setNotice(`Stock réel au ${frDay(asOf)} proposé : ${proposed.length} article${proposed.length > 1 ? 's' : ''}. Corrigez les quantités si besoin avant d’enregistrer.`);
    } catch (e) {
      setError((e as Error)?.message || 'Lecture du stock impossible');
    } finally { setBusy(null); }
  };

  const importCsv = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const text = await file.text();
    const parsed = parseOpeningCsv(text, known);
    if (parsed.lines.length === 0 && parsed.problems.length === 0) { setError('Le fichier est vide.'); return; }
    if (lines.length > 0 && parsed.lines.length > 0 && !window.confirm(`Remplacer les ${lines.length} lignes affichées par les ${parsed.lines.length} lignes du fichier ?`)) return;
    if (parsed.lines.length > 0) { setLines(parsed.lines); setVersion(v => v + 1); setShown(PAGE); }
    setProblems(parsed.problems);
    setNotice(`${parsed.lines.length} ligne${parsed.lines.length > 1 ? 's' : ''} importée${parsed.lines.length > 1 ? 's' : ''}${parsed.problems.length ? `, ${parsed.problems.length} refusée${parsed.problems.length > 1 ? 's' : ''} (voir ci-dessous)` : ''}.`);
    if (fileRef.current) fileRef.current.value = '';
  };

  const setQty = (index: number, value: string) => {
    const n = Number(value.replace(',', '.'));
    setLines(ls => ls.map((l, i) => (i === index ? { ...l, quantity: value.trim() === '' ? 0 : n } : l)));
  };
  const remove = (index: number) => setLines(ls => ls.filter((_, i) => i !== index));
  const add = () => {
    const barcode = addRef.trim();
    const q = Number(addQty.replace(',', '.'));
    if (!barcode) { setError('Indiquez la référence à ajouter.'); return; }
    if (!known.has(barcode)) { setError(`${barcode} : référence inconnue du catalogue.`); return; }
    if (lines.some(l => l.barcode === barcode)) { setError(`${barcode} figure déjà dans l’ouverture : modifiez sa ligne.`); return; }
    if (!Number.isFinite(q) || addQty.trim() === '') { setError('Indiquez une quantité.'); return; }
    setError(null);
    setLines(ls => [{ barcode, quantity: q }, ...ls]);
    setAddRef(''); setAddQty('');
  };

  const save = async () => {
    const errors = openingErrors(asOf, lines, today);
    if (errors.length) { setError(errors.slice(0, 5).join(' ') + (errors.length > 5 ? ` (+${errors.length - 5})` : '')); return; }
    const payload = openingPayload(lines);
    if (existing && !window.confirm(`Cette ouverture remplace celle du ${frDay(existing.asOf)} (${existing.quantities.size} article${existing.quantities.size > 1 ? 's' : ''}). L’ancienne est supprimée et le stock facturé est recalculé. Continuer ?`)) return;
    setBusy('save'); setError(null);
    try {
      const count = await InvoicedStockService.saveOpening(companyId, asOf, payload);
      onSaved(count);
    } catch (e) {
      setError((e as Error)?.message || 'Enregistrement impossible');
    } finally { setBusy(null); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="opening-title" className="my-6 w-full max-w-3xl space-y-4 rounded-xl border border-border bg-card p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="opening-title" className="text-base font-semibold text-foreground">{existing ? 'Refaire l’ouverture du stock facturé' : 'Initialiser le stock facturé'}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Quantités facturées de chaque article à la fin du jour choisi. Les factures datées de ce jour ou avant sont comprises dans l’ouverture et ne sont plus comptées.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="rounded p-1 text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>

        {!installed && (
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
            L’enregistrement n’est pas encore possible : exécutez la migration {INVOICED_STOCK_MIGRATION} dans Supabase.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-end">
          <div>
            <label htmlFor="opening-day" className={opsLabel}>Date de l’ouverture</label>
            <input id="opening-day" type="date" value={asOf} max={today} onChange={e => setAsOf(e.target.value)} className={`${opsField} sm:w-44`} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={propose} disabled={busy !== null || !isDay(asOf)} className={btnSecondary}>
              {busy === 'propose' ? <Loader className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Boxes className="h-4 w-4" aria-hidden="true" />}
              Proposer le stock réel au {isDay(asOf) ? frDay(asOf) : '…'}
            </button>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy !== null} className={btnSecondary}>
              <Upload className="h-4 w-4" aria-hidden="true" /> Importer un CSV
            </button>
            <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" aria-label="Fichier CSV de l’ouverture" onChange={e => importCsv(e.target.files?.[0])} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">CSV : une ligne par article, « référence;quantité » (virgule ou point décimal ; une ligne d’en-tête est ignorée).</p>

        {notice && <p className="text-sm text-foreground">{notice}</p>}
        {problems.length > 0 && (
          <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
            <p className="font-medium">Lignes non importées :</p>
            <ul className="mt-1 max-h-32 list-disc overflow-y-auto pl-5 text-xs">
              {problems.slice(0, 50).map(p => <li key={p.line}>Ligne {p.line} : {p.reason} — <span className="font-mono">{p.text.slice(0, 60)}</span></li>)}
              {problems.length > 50 && <li>… et {problems.length - 50} autres</li>}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor="opening-search" className={opsLabel}>Rechercher</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input id="opening-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Référence ou article" className={`${fieldSm} pl-9`} />
            </div>
          </div>
          <div className="w-32">
            <label htmlFor="opening-add-ref" className={opsLabel}>Ajouter une référence</label>
            <input id="opening-add-ref" value={addRef} onChange={e => setAddRef(e.target.value)} className={fieldSm} />
          </div>
          <div className="w-24">
            <label htmlFor="opening-add-qty" className={opsLabel}>Quantité</label>
            <input id="opening-add-qty" inputMode="decimal" value={addQty} onChange={e => setAddQty(e.target.value)} className={`${fieldSm} text-right`} />
          </div>
          <button type="button" onClick={add} className={`${btnSecondary} min-h-9`}><Plus className="h-4 w-4" aria-hidden="true" /> Ajouter</button>
        </div>

        <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-border">
          {lines.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Aucune ligne : proposez le stock réel, importez un fichier ou ajoutez des références. Une ouverture vide met tout à zéro.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className={theadRow}><th className={th}>Référence</th><th className={th}>Article</th><th className={thRight}>Quantité</th><th className={th}><span className="sr-only">Retirer</span></th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.slice(0, shown).map(l => (
                  <tr key={`${version}-${l.barcode}`}>
                    <td className={`${td} font-mono text-xs text-muted-foreground`}>{l.barcode}</td>
                    <td className={td}>{byBarcode.get(l.barcode)?.name || <span className="text-amber-700 dark:text-amber-300">hors catalogue</span>}</td>
                    <td className={tdNum}>
                      <input aria-label={`Quantité ${l.barcode}`} inputMode="decimal" defaultValue={String(l.quantity).replace('.', ',')}
                        onChange={e => setQty(l.index, e.target.value)} className={`${fieldSm} w-24 text-right`} />
                    </td>
                    <td className="w-10 px-1"><button type="button" onClick={() => remove(l.index)} aria-label={`Retirer ${l.barcode}`} className={iconBtnDanger}><Trash2 className="h-4 w-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {visible.length > shown && (
          <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground">
            {shown} sur {visible.length} lignes
            <button type="button" onClick={() => setShown(s => s + PAGE)} className={`${btnSecondary} min-h-9`}>Afficher {Math.min(PAGE, visible.length - shown)} de plus</button>
          </div>
        )}

        {error && <p role="alert" className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{error}</p>}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          <span className="mr-auto text-sm text-muted-foreground">{lines.length} ligne{lines.length > 1 ? 's' : ''}</span>
          <button type="button" onClick={onClose} className={btnSecondary}>Annuler</button>
          <button type="button" onClick={save} disabled={busy !== null || !installed} className={btnPrimary}>
            {busy === 'save' ? <Loader className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
            Enregistrer l’ouverture
          </button>
        </div>
      </div>
    </div>
  );
}
