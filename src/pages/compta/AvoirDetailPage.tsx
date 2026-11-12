import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Download, Printer, Boxes, Loader, ChevronRight, Check, FileText, Undo2 } from 'lucide-react';
import { Quote } from '../../types';
import { SupabaseDocumentsService } from '../../utils/supabaseDocuments';
import { PdfExportService } from '../../utils/pdfExport';
import { CompanySettingsService } from '../../utils/companySettings';
import { SupabaseCompaniesService } from '../../utils/supabaseCompanies';
import { PrintPreviewModal } from '../../components/PrintPreviewModal';
import { discountRate, localDay, toHT } from '../../utils/documentLines';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../hooks/useAuth';
import { useKeyboardSave, useAutoSave } from '../../hooks/useShortcuts';
import { formatMoney } from '../../utils/format';

export default function AvoirDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isSuperAdmin, isCompta, currentUser } = useAuth();
  const { showToast } = useToast();

  const [avoir, setAvoir] = useState<Quote | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [stockReturned, setStockReturned] = useState<boolean | null>(null);
  const [stockBusy, setStockBusy] = useState(false);
  const [avoirDate, setAvoirDate] = useState('');
  const [printTTCOnly, setPrintTTCOnly] = useState(false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewFilename, setPreviewFilename] = useState('');
  const [tvaRate, setTvaRate] = useState(20);

  const load = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      const doc = await SupabaseDocumentsService.getById(id);
      setAvoir(doc);
      setAvoirDate(doc?.quote_date || localDay(new Date(doc?.createdAt || Date.now())));
      const compId = doc?.issuing_company_id || doc?.company_id;
      if (compId) {
        const settings = await CompanySettingsService.getSettings(compId).catch(() => null);
        if (settings?.tva_rate != null) setTvaRate(settings.tva_rate);
      }
      if (doc?.id) {
        import('../../inventory/lib/stockPosting')
          .then(m => m.isDocumentStockPosted(doc.id))
          .then(setStockReturned)
          .catch(() => setStockReturned(false));
      }
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    } finally {
      setIsLoading(false);
    }
  }, [id, showToast]);

  useEffect(() => { load(); }, [load]);

  // Number of the invoice this credit note cancels, for display only.
  const [sourceNumber, setSourceNumber] = useState<string | null>(null);
  useEffect(() => {
    const parentId = avoir?.parent_document_id;
    if (!parentId) { setSourceNumber(null); return; }
    let cancelled = false;
    SupabaseDocumentsService.getById(parentId)
      .then(doc => { if (!cancelled) setSourceNumber(doc?.quoteNumber || null); })
      .catch(() => { /* the link still works without the number */ });
    return () => { cancelled = true; };
  }, [avoir?.parent_document_id]);

  const saveDate = useCallback(async () => {
    if (!avoir) return;
    try { await SupabaseDocumentsService.updateDocument(avoir.id, { quote_date: avoirDate || null }); } catch { /* silent */ }
  }, [avoir, avoirDate]);

  useKeyboardSave(saveDate, !!avoir && !isLoading);
  useAutoSave(saveDate, !!avoir && !isLoading);

  const getSettings = async (av: Quote) => {
    const compId = av.issuing_company_id || av.company_id;
    if (!compId) return null;
    try { return await CompanySettingsService.getSettings(compId); } catch { return null; }
  };

  const handleReturnStock = async () => {
    if (!avoir) return;
    setStockBusy(true);
    try {
      const { postDocumentStockReturn } = await import('../../inventory/lib/stockPosting');
      const res = await postDocumentStockReturn(avoir, { createdBy: currentUser?.username || null });
      const skippedNames = res.skippedItems.slice(0, 5).join(', ') + (res.skippedItems.length > 5 ? '…' : '');
      if (res.alreadyPosted) {
        showToast({ type: 'info', title: 'Déjà remis', message: 'Le stock de cet avoir a déjà été remis.' });
        setStockReturned(true);
      } else if (res.posted === 0) {
        showToast({ type: 'warning', title: 'Rien à remettre', message: res.skipped > 0 ? `Emplacement ou code produit manquant pour : ${skippedNames}` : 'Aucun article à remettre en stock.' });
      } else {
        const skipMsg = res.skipped > 0 ? ` · non remis (emplacement/code manquant) : ${skippedNames}` : '';
        showToast({ type: 'success', title: 'Stock remis', message: `${res.posted} retour(s) en stock${skipMsg}` });
        setStockReturned(true);
      }
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur stock', message: String((e as any)?.message || e) });
    } finally {
      setStockBusy(false);
    }
  };

  const handleExportPdf = async () => {
    if (!avoir) return;
    try {
      const settings = await getSettings(avoir);
      await PdfExportService.exportQuoteToPdf(avoir, settings, undefined, undefined, undefined, 'avoir', undefined, printTTCOnly);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur PDF', message: String(e) });
    }
  };

  const handlePreview = async () => {
    if (!avoir) return;
    try {
      const settings = await getSettings(avoir);
      const { blob, filename } = await PdfExportService.generatePdfBlob(avoir, settings, undefined, undefined, undefined, 'avoir', undefined, printTTCOnly);
      setPreviewBlob(blob);
      setPreviewFilename(filename);
      setShowPrintPreview(true);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur aperçu', message: String(e) });
    }
  };

  if (!isSuperAdmin && !isCompta) return <div className="py-12 text-center text-muted-foreground">Accès réservé au rôle Comptabilité.</div>;
  if (isLoading) return <div className="flex items-center justify-center min-h-[40vh]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!avoir) return <div className="py-12 text-center text-muted-foreground">Avoir introuvable. <Link to="/compta/avoirs" className="font-semibold text-primary hover:underline">Retour aux avoirs</Link></div>;

  const panel = 'rounded-xl border border-border bg-card shadow-sm';
  const totalHT = toHT(avoir.totalAmount, tvaRate);
  const customerLine = [avoir.customer?.phoneNumber, avoir.customer?.city].filter(Boolean).join(' · ');
  const initials = (avoir.customer?.fullName || '').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('');

  return (
    <div className="mx-auto max-w-7xl pb-28 md:pb-0">
      {/* Title */}
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0">
          <nav aria-label="Fil d’Ariane" className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex">
            <Link to="/compta/avoirs" className="hover:text-foreground">Avoirs</Link>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-foreground">{avoir.quoteNumber}</span>
          </nav>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">Avoir {avoir.quoteNumber}</h1>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${stockReturned ? 'bg-emerald-500/10 text-emerald-700 ring-emerald-600/20 dark:text-emerald-300' : 'bg-secondary text-muted-foreground ring-border'}`}>
          {stockReturned ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Boxes className="h-3.5 w-3.5" aria-hidden="true" />}
          {stockReturned === null ? 'Stock…' : stockReturned ? 'Stock remis' : 'Stock non remis'}
        </span>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          {/* Source invoice */}
          {avoir.parent_document_id && (
            <section className={`${panel} flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5`} aria-label="Facture source">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden="true"><FileText className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Avoir sur la facture</p>
                <p className="font-semibold text-foreground">{sourceNumber || '…'}</p>
              </div>
              <Link to={`/compta/invoices/${avoir.parent_document_id}`} className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-secondary">
                Voir la facture
              </Link>
            </section>
          )}

          {/* Client and date */}
          <section className={`${panel} p-4 sm:p-5`} aria-label="Client">
            <div className="flex items-start gap-3 sm:gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold uppercase text-primary" aria-hidden="true">{initials || '—'}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-semibold leading-tight text-foreground">{avoir.customer?.fullName || 'Client non renseigné'}</p>
                <p className="mt-1 text-sm text-muted-foreground">{customerLine || 'Aucune coordonnée'}</p>
              </div>
            </div>
            <div className="mt-4 border-t border-border pt-4 sm:max-w-xs">
              <label htmlFor="avoir-date" className="block text-xs text-muted-foreground">Date de l’avoir</label>
              <input
                id="avoir-date"
                type="date"
                value={avoirDate}
                onChange={e => setAvoirDate(e.target.value)}
                onBlur={async () => {
                  if (!avoir) return;
                  try { await SupabaseDocumentsService.updateDocument(avoir.id, { quote_date: avoirDate || null }); }
                  catch { /* ignore */ }
                }}
                className="-ml-1 mt-0.5 w-full rounded-md border border-transparent bg-transparent px-1 py-1 text-sm font-medium text-foreground hover:border-input focus:border-input focus:ring-2 focus:ring-ring"
              />
            </div>
          </section>

          {/* Reason */}
          {avoir.notes && (
            <section className={`${panel} p-4 sm:p-5`} aria-labelledby="avoir-reason-title">
              <h2 id="avoir-reason-title" className="text-xs font-medium text-muted-foreground">Motif de l’avoir</h2>
              <p className="mt-1 whitespace-pre-line text-sm text-foreground">{avoir.notes}</p>
            </section>
          )}

          {/* Lines */}
          <section className={panel} aria-labelledby="avoir-lines-title">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3 sm:px-5">
              <h2 id="avoir-lines-title" className="font-semibold text-foreground">Articles concernés</h2>
              <span className="text-sm text-muted-foreground">{avoir.items.length} ligne{avoir.items.length !== 1 ? 's' : ''}</span>
            </div>
            {avoir.items.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">Aucun article sur cet avoir.</p>
            ) : (
              <>
                <div className="hidden gap-4 border-b border-border bg-secondary/40 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:flex">
                  <span className="w-6" /><span className="flex-1">Désignation</span><span className="w-14 text-right">Qté</span><span className="w-32 text-right">PU HT</span><span className="w-32 text-right">Total HT</span>
                </div>
                <ul className="divide-y divide-border">
                  {avoir.items.map((item, i) => {
                    const unitHT = toHT(item.unitPrice, tvaRate);
                    const lineHT = toHT(item.subtotal ?? item.quantity * item.unitPrice, tvaRate);
                    const rate = discountRate(item);
                    const brandRef = [item.quoteBrand || item.product?.brand, item.quoteBarcode || item.product?.barcode].filter(Boolean).join(' · ');
                    return (
                      <li key={i} className="flex items-start gap-3 px-4 py-3 sm:px-5 md:items-center md:gap-4">
                        <span className="w-6 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground md:pt-0">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium leading-snug text-foreground">{item.quoteName || item.product?.name || (item as { name?: string }).name || '—'}</p>
                          {brandRef && <p className="truncate text-sm text-muted-foreground">{brandRef}</p>}
                          <p className="mt-0.5 text-sm tabular-nums text-muted-foreground md:hidden">
                            {item.quantity} × {formatMoney(unitHT)} HT{rate > 0 ? ` · remise ${rate} %` : ''}
                          </p>
                        </div>
                        <span className="hidden w-14 text-right font-semibold tabular-nums text-foreground md:block">{item.quantity}</span>
                        <span className="hidden w-32 text-right tabular-nums text-foreground md:block">
                          {formatMoney(unitHT)}
                          {rate > 0 && <span className="block text-xs font-semibold text-amber-700 dark:text-amber-300">remise {rate} %</span>}
                        </span>
                        <span className="w-28 shrink-0 text-right font-semibold tabular-nums text-foreground md:w-32">{formatMoney(lineHT)}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            <dl className="space-y-1.5 border-t border-border px-4 py-3 text-sm sm:px-5">
              <div className="flex justify-between"><dt className="text-muted-foreground">Total HT</dt><dd className="tabular-nums text-foreground">{formatMoney(totalHT)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">TVA {tvaRate} %</dt><dd className="tabular-nums text-foreground">{formatMoney(avoir.totalAmount - totalHT)}</dd></div>
              <div className="flex justify-between text-base font-semibold"><dt className="text-foreground">Total TTC</dt><dd className="tabular-nums text-foreground">{formatMoney(avoir.totalAmount)}</dd></div>
            </dl>
          </section>
        </div>

        {/* Summary and actions: stays in view while the lines scroll */}
        <aside className="space-y-4 lg:sticky lg:top-4" aria-label="Récapitulatif et actions">
          <section className={`${panel} p-5`} aria-labelledby="avoir-summary-title">
            <h2 id="avoir-summary-title" className="font-semibold text-foreground">Montant de l’avoir</h2>
            <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-foreground">{formatMoney(avoir.totalAmount)}</p>
            <p className="text-xs text-muted-foreground">TTC · {avoir.items.length} article{avoir.items.length !== 1 ? 's' : ''}</p>

            <div className="mt-4 border-t border-border pt-4">
              <p className="text-sm font-semibold text-foreground">Stock</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {stockReturned ? 'Les quantités retournées ont été remises en stock.' : 'Remettez les quantités retournées dans leur emplacement d’origine.'}
              </p>
              <button
                type="button"
                onClick={handleReturnStock}
                disabled={stockBusy || stockReturned === true}
                className={`mt-3 flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold shadow-sm disabled:opacity-60 ${
                  stockReturned
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 cursor-default shadow-none'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                }`}
              >
                {stockBusy ? <Loader className="h-4 w-4 animate-spin" /> : stockReturned ? <Check className="h-4 w-4" /> : <Boxes className="h-4 w-4" />}
                {stockReturned ? 'Stock remis' : 'Remettre en stock'}
              </button>
            </div>
          </section>

          <section className={`${panel} p-5`} aria-labelledby="avoir-actions-title">
            <h2 id="avoir-actions-title" className="sr-only">Actions</h2>
            <button type="button" onClick={handleExportPdf}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-sm font-semibold text-foreground hover:bg-secondary">
              <Download className="h-4 w-4" />Télécharger le PDF
            </button>
            <button type="button" onClick={handlePreview}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-sm font-semibold text-foreground hover:bg-secondary">
              <Printer className="h-4 w-4 text-primary" />Aperçu avant impression
            </button>
            <label className="relative mt-3 flex cursor-pointer items-center gap-3 border-t border-border pt-3">
              <input type="checkbox" checked={printTTCOnly} onChange={e => setPrintTTCOnly(e.target.checked)} className="peer sr-only" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">Prix TTC uniquement</span>
                <span className="block text-xs text-muted-foreground">Masquer le détail HT et TVA sur le PDF</span>
              </span>
              <span aria-hidden="true" className={`relative h-5 w-9 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring ${printTTCOnly ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${printTTCOnly ? 'left-[1.125rem]' : 'left-0.5'}`} />
              </span>
            </label>
          </section>
        </aside>
      </div>

      {/* Phone: amount and the next step stay at hand, above the tab bar */}
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 border-t border-border bg-card px-4 py-2.5 shadow-[0_-4px_16px_rgba(17,24,39,0.06)] md:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 text-xs text-muted-foreground"><Undo2 className="h-3 w-3" aria-hidden="true" />Avoir TTC</p>
            <p className="whitespace-nowrap text-lg font-bold tabular-nums leading-tight text-foreground">{formatMoney(avoir.totalAmount)}</p>
          </div>
          <button type="button" onClick={handleExportPdf} aria-label="Télécharger le PDF"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-foreground">
            <Download className="h-5 w-5" />
          </button>
          {stockReturned === false && (
            <button type="button" onClick={handleReturnStock} disabled={stockBusy}
              className="flex h-11 shrink-0 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
              {stockBusy ? <Loader className="h-4 w-4 animate-spin" /> : <Boxes className="h-4 w-4" />}Remettre en stock
            </button>
          )}
        </div>
      </div>

      {showPrintPreview && previewBlob && (
        <PrintPreviewModal blob={previewBlob} filename={previewFilename} onClose={() => { setShowPrintPreview(false); setPreviewBlob(null); }} />
      )}
    </div>
  );
}
