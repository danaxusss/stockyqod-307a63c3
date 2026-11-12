import React, { useState, useEffect, useCallback } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Download, FileText, Building2, Loader, Pencil, Check, Plus, CopyPlus, Search as SearchIcon, Printer, Boxes, ChevronRight, Trash2 } from 'lucide-react';
import { Quote, QuoteItem, Company, Product } from '../../types';
import { SupabaseDocumentsService } from '../../utils/supabaseDocuments';
import { SupabaseCompaniesService } from '../../utils/supabaseCompanies';
import { PdfExportService } from '../../utils/pdfExport';
import { CompanySettingsService, CompanySettings } from '../../utils/companySettings';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../hooks/useAuth';
import { useKeyboardSave, useAutoSave, useEscapeKey } from '../../hooks/useShortcuts';
import { ClientDropdown } from '../../components/ClientDropdown';
import { ClientFormModal } from '../../components/ClientFormModal';
import { ProductSearchModal } from '../../components/ProductSearchModal';
import { PrintPreviewModal } from '../../components/PrintPreviewModal';
import { documentTotal, localDay, recomputeLine } from '../../utils/documentLines';
import { formatMoney } from '../../utils/format';
import { DocClientCard, DocPhoneBar, DocProgress, DocToggle, type DocStep } from '../../components/documents/DocParts';
import { docDate, docFieldCls, docInputCls, docPanel, docSideAction, docTh } from '../../components/documents/docStyles';

export default function BLDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isSuperAdmin, isCompta, currentUser } = useAuth();
  const [stockPosted, setStockPosted] = useState<boolean | null>(null);
  const [stockBusy, setStockBusy] = useState(false);
  const { showToast } = useToast();

  const [bl, setBl] = useState<Quote | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const [useStamp, setUseStamp] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [targetCompanyId, setTargetCompanyId] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [draftNumber, setDraftNumber] = useState('');
  const [draftCustomerName, setDraftCustomerName] = useState('');
  const [draftCustomerPhone, setDraftCustomerPhone] = useState('');
  const [draftCustomerCity, setDraftCustomerCity] = useState('');
  const [draftDate, setDraftDate] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [draftStatus, setDraftStatus] = useState('');
  const [draftItems, setDraftItems] = useState<QuoteItem[]>([]);
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewFilename, setPreviewFilename] = useState('');
  const [blPricesOverride, setBlPricesOverride] = useState<boolean | null>(null);
  const [showClientForm, setShowClientForm] = useState(false);
  const [clientFormInitialName, setClientFormInitialName] = useState('');
  const [proformaOf, setProformaOf] = useState<{ id: string; quoteNumber: string } | null>(null);
  // Where this BL sits: the quote it came from, and the invoices of its proforma.
  const [chain, setChain] = useState<{ quote?: { id: string; number: string }; invoices: Array<{ id: string; number: string }> } | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      const [doc, allCompanies] = await Promise.all([
        SupabaseDocumentsService.getById(id),
        SupabaseCompaniesService.getAllCompanies(),
      ]);
      setBl(doc);
      setCompanies(allCompanies);
      setProformaOf(doc?.id ? await SupabaseDocumentsService.findProformaForBL(doc.id).catch(() => null) : null);
      if (doc?.id) {
        import('../../inventory/lib/stockPosting')
          .then(m => m.isDocumentStockPosted(doc.id))
          .then(setStockPosted)
          .catch(() => setStockPosted(false));
      }
      if (doc?.company_id) {
        setTargetCompanyId(doc.company_id);
        const settings = await CompanySettingsService.getSettings(doc.company_id).catch(() => null);
        setCompanySettings(settings);
        if (settings?.use_stamp) setUseStamp(true);
      }
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    } finally {
      setIsLoading(false);
    }
  }, [id, showToast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!bl) return;
    let cancelled = false;
    (async () => {
      const out: { quote?: { id: string; number: string }; invoices: Array<{ id: string; number: string }> } = { invoices: [] };
      try {
        const quote = bl.parent_document_id ? await SupabaseDocumentsService.getById(bl.parent_document_id).catch(() => null) : null;
        if (quote) out.quote = { id: quote.id, number: quote.quoteNumber };
        const proforma = proformaOf ? await SupabaseDocumentsService.getById(proformaOf.id).catch(() => null) : null;
        const billedIds: string[] = (proforma?.items || []).map(i => i.billed_invoice_id).filter((v): v is string => !!v);
        const invoiceIds = Array.from(new Set<string>(billedIds));
        const invoices = (await Promise.all(invoiceIds.map(invId => SupabaseDocumentsService.getById(invId).catch(() => null)))).filter((d): d is Quote => !!d);
        out.invoices = invoices.map(d => ({ id: d.id, number: d.quoteNumber }));
      } catch { /* the line then shows the links as unknown */ }
      if (!cancelled) setChain(out);
    })();
    return () => { cancelled = true; };
  }, [bl, proformaOf]);

  useEffect(() => {
    if (searchParams.get('new') === '1' && bl && !isEditing) startEdit();
  }, [bl, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const startEdit = () => {
    if (!bl) return;
    setDraftNumber(bl.quoteNumber);
    setDraftCustomerName(bl.customer?.fullName || '');
    setDraftCustomerPhone(bl.customer?.phoneNumber || '');
    setDraftCustomerCity(bl.customer?.city || '');
    setDraftDate(bl.quote_date || localDay(new Date(bl.createdAt)));
    setDraftNotes(bl.notes || '');
    setDraftStatus(bl.status);
    setDraftItems(bl.items.map(i => ({
      ...i,
      quoteName: i.quoteName || i.product?.name || '',
      quoteBrand: i.quoteBrand || i.product?.brand || '',
      quoteBarcode: i.quoteBarcode || i.product?.barcode || '',
    })));
    setIsEditing(true);
  };

  const handleSave = async (isAutoSave = false) => {
    if (!bl) return;
    if (!isAutoSave && !draftCustomerName.trim()) {
      showToast({ type: 'error', title: 'Client requis', message: 'Veuillez saisir le nom du client avant de sauvegarder.' });
      return;
    }
    setIsSaving(true);
    try {
      await SupabaseDocumentsService.updateDocument(bl.id, {
        quoteNumber: draftNumber,
        quote_date: draftDate || null,
        customer: { ...bl.customer, fullName: draftCustomerName, phoneNumber: draftCustomerPhone, city: draftCustomerCity },
        items: draftItems,
        notes: draftNotes.trim() || null,
        // A BL merged into a proforma stays converted.
        status: proformaOf ? 'final' : draftStatus,
      });
      if (!isAutoSave) {
        showToast({ type: 'success', title: 'BL mis à jour', message: 'Modifications sauvegardées' });
        setIsEditing(false);
        await load();
      }
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    } finally {
      setIsSaving(false);
    }
  };

  const handlePostStock = async () => {
    if (!bl) return;
    setStockBusy(true);
    try {
      const { postDocumentStockOut } = await import('../../inventory/lib/stockPosting');
      const res = await postDocumentStockOut(bl, { createdBy: currentUser?.username || null });
      const skippedNames = res.skippedItems.slice(0, 5).join(', ') + (res.skippedItems.length > 5 ? '…' : '');
      if (res.alreadyPosted) {
        showToast({ type: 'info', title: 'Déjà décompté', message: 'Le stock de ce BL a déjà été décompté.' });
        setStockPosted(true);
      } else if (res.posted === 0) {
        // Nothing could be posted: leave the button available once fixed.
        showToast({ type: 'warning', title: 'Rien à décompter', message: res.skipped > 0 ? `Emplacement ou code produit manquant pour : ${skippedNames}` : 'Aucun article à décompter.' });
      } else {
        const skipMsg = res.skipped > 0 ? ` · non décomptés (emplacement/code manquant) : ${skippedNames}` : '';
        showToast({ type: 'success', title: 'Stock décompté', message: `${res.posted} mouvement(s) de sortie${skipMsg}` });
        if (res.negatives && res.negatives > 0) {
          showToast({ type: 'warning', title: 'Stock négatif', message: `${res.negatives} article(s) passent en stock négatif — vérifiez les réceptions.` });
        }
        setStockPosted(true);
      }
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur stock', message: String((e as any)?.message || e) });
    } finally {
      setStockBusy(false);
    }
  };

  useKeyboardSave(() => handleSave(false), isEditing);
  useAutoSave(() => handleSave(true), isEditing);
  useEscapeKey(() => setIsEditing(false), isEditing);

  const updateDraftItem = (idx: number, field: string, value: string | number) => {
    setDraftItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const updated = { ...item, [field]: value } as QuoteItem;
      return field === 'quantity' ? recomputeLine(updated) : updated;
    }));
  };

  const removeDraftItem = (idx: number) => setDraftItems(prev => prev.filter((_, i) => i !== idx));

  const addBlankItem = () => setDraftItems(prev => [...prev, {
    id: crypto.randomUUID(),
    quantity: 1, unitPrice: 0, subtotal: 0,
    addedAt: new Date(), quoteName: '', quoteBrand: '', quoteBarcode: '',
    priceType: 'normal' as const, marginPercentage: 0, finalPrice: 0,
    product: null as any,
  }]);

  const addFromProduct = (product: Product) => setDraftItems(prev => [...prev, {
    id: crypto.randomUUID(),
    quantity: 1,
    unitPrice: product.price ?? 0,
    subtotal: product.price ?? 0,
    addedAt: new Date(),
    quoteName: product.name,
    quoteBrand: product.brand || '',
    quoteBarcode: String(product.barcode || ''),
    priceType: 'normal' as const,
    marginPercentage: 0,
    finalPrice: product.price ?? 0,
    product: null as any,
  }]);

  const handleCreateProforma = async () => {
    if (!bl || !targetCompanyId) return;
    setIsCreating(true);
    try {
      const proforma = await SupabaseDocumentsService.createProformaFromBL(bl.id, targetCompanyId);
      showToast({ type: 'success', title: 'Proforma créé', message: `${proforma.quoteNumber} créé avec succès` });
      navigate(`/compta/proformas/${proforma.id}`);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    } finally {
      setIsCreating(false);
      setShowModal(false);
    }
  };

  const handleExportPdf = async () => {
    if (!bl) return;
    try {
      const freshSettings = bl.company_id
        ? await CompanySettingsService.getSettings(bl.company_id).catch(() => companySettings)
        : companySettings;
      const showPrices = blPricesOverride !== null ? blPricesOverride : (freshSettings?.bl_show_prices ?? true);
      await PdfExportService.exportQuoteToPdf(bl, freshSettings, undefined, undefined, useStamp, 'bl', showPrices);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur PDF', message: String(e) });
    }
  };

  const handlePreview = async () => {
    if (!bl) return;
    const freshSettings = await CompanySettingsService.getSettings(bl.company_id!);
    const showPrices2 = blPricesOverride !== null ? blPricesOverride : (freshSettings?.bl_show_prices ?? true);
    const { blob, filename } = await PdfExportService.generatePdfBlob(bl, freshSettings, undefined, undefined, useStamp, 'bl', showPrices2);
    setPreviewBlob(blob);
    setPreviewFilename(filename);
    setShowPrintPreview(true);
  };

  const handleDuplicate = async () => {
    if (!bl || !window.confirm('Dupliquer ce BL ?')) return;
    try {
      const dup = await SupabaseDocumentsService.duplicateDocument(bl.id);
      navigate(`/compta/bls/${dup.id}`);
    } catch (e) {
      showToast({ type: 'error', message: String(e) });
    }
  };

  if (!isSuperAdmin && !isCompta) return <div className="text-center py-12 text-muted-foreground">Accès réservé au rôle Comptabilité.</div>;
  if (isLoading) return <div className="flex items-center justify-center min-h-[40vh]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!bl) return <div className="text-center py-12 text-muted-foreground">BL introuvable.</div>;

  const isFinal = bl.status === 'final';
  const showPricesNow = blPricesOverride !== null ? blPricesOverride : (companySettings?.bl_show_prices ?? true);
  const shownItems = isEditing ? draftItems : bl.items;
  const units = shownItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const canMakeProforma = !isFinal && !proformaOf;
  const firstInvoice = chain?.invoices[0];

  const steps: DocStep[] = [
    chain?.quote
      ? { label: 'Devis', detail: chain.quote.number, state: 'done', to: `/quote-cart/${chain.quote.id}` }
      : { label: 'Devis', detail: chain ? 'non lié' : '…', state: 'todo' },
    { label: 'BL', detail: isFinal ? 'Finalisé' : 'Brouillon', state: isFinal || proformaOf ? 'done' : 'current' },
    proformaOf
      ? { label: 'Proforma', detail: proformaOf.quoteNumber, state: 'done', to: `/compta/proformas/${proformaOf.id}` }
      : { label: 'Proforma', detail: isFinal ? 'non lié' : 'à créer', state: 'todo' },
    firstInvoice
      ? { label: 'Facture', detail: firstInvoice.number + (chain!.invoices.length > 1 ? ` +${chain!.invoices.length - 1}` : ''), state: 'done', to: `/compta/invoices/${firstInvoice.id}` }
      : { label: 'Facture', detail: proformaOf ? 'non facturé' : '—', state: proformaOf ? 'current' : 'todo' },
  ];

  return (
    <div className="mx-auto max-w-7xl pb-28 md:pb-0">
      {/* Title */}
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0">
          <nav aria-label="Fil d’Ariane" className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex">
            <Link to="/compta/bls" className="hover:text-foreground">Bons de livraison</Link>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-foreground">{bl.quoteNumber}</span>
          </nav>
          {isEditing ? (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="bl-number">Numéro du BL</label>
              <input id="bl-number" value={draftNumber} onChange={e => setDraftNumber(e.target.value)}
                className="w-48 rounded-lg border border-input bg-background px-2.5 py-1.5 text-lg font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
              <label className="sr-only" htmlFor="bl-date">Date du BL</label>
              <input id="bl-date" type="date" value={draftDate} onChange={e => setDraftDate(e.target.value)}
                className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
          ) : (
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">Bon de livraison {bl.quoteNumber}</h1>
          )}
        </div>
        {isEditing ? (
          <select value={proformaOf ? 'final' : draftStatus} onChange={e => setDraftStatus(e.target.value)} disabled={!!proformaOf} aria-label="Statut du BL"
            title={proformaOf ? `Ce BL est dans le proforma ${proformaOf.quoteNumber}` : undefined}
            className="rounded-full border-0 bg-secondary py-1 pl-3 pr-8 text-xs font-semibold text-foreground ring-1 ring-inset ring-border disabled:opacity-60">
            <option value="draft">Brouillon</option>
            <option value="final">Finalisé</option>
          </select>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${isFinal ? 'bg-blue-500/10 text-blue-700 ring-blue-600/20 dark:text-blue-300' : 'bg-secondary text-muted-foreground ring-border'}`}>
              {isFinal ? 'Finalisé' : 'Brouillon'}
            </span>
            {stockPosted && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:text-emerald-300">
                <Boxes className="h-3.5 w-3.5" aria-hidden="true" />Stock décompté
              </span>
            )}
          </div>
        )}
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <DocProgress steps={steps} />

          {/* Client */}
          <section className={`${docPanel} p-4 sm:p-5`} aria-labelledby="bl-client-title">
            <h2 id="bl-client-title" className={isEditing ? 'mb-3 font-semibold text-foreground' : 'sr-only'}>Client</h2>
            {isEditing ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div>
                  <p className="mb-1 text-xs font-medium text-foreground">Client *</p>
                  <ClientDropdown
                    value={draftCustomerName}
                    onChange={(client, val) => {
                      setDraftCustomerName(client ? client.full_name : val);
                      if (client) {
                        setDraftCustomerPhone(client.phone_number || '');
                        setDraftCustomerCity(client.city || '');
                      }
                    }}
                    onCreateNew={q => { setClientFormInitialName(q || ''); setShowClientForm(true); }}
                    placeholder="Rechercher un client..."
                  />
                </div>
                <label className="block text-xs font-medium text-foreground">Téléphone
                  <input value={draftCustomerPhone} onChange={e => setDraftCustomerPhone(e.target.value)} className={`${docFieldCls} mt-1`} placeholder="Téléphone" />
                </label>
                <label className="block text-xs font-medium text-foreground">Ville
                  <input value={draftCustomerCity} onChange={e => setDraftCustomerCity(e.target.value)} className={`${docFieldCls} mt-1`} placeholder="Ville" />
                </label>
              </div>
            ) : (
              <DocClientCard name={bl.customer?.fullName} details={[bl.customer?.phoneNumber, bl.customer?.city, `livré le ${docDate(bl)}`]} />
            )}
          </section>

          {/* Lines */}
          <section className={docPanel} aria-labelledby="bl-lines-title">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3 sm:px-5">
              <h2 id="bl-lines-title" className="font-semibold text-foreground">Articles</h2>
              <span className="text-sm text-muted-foreground">{shownItems.length} ligne{shownItems.length !== 1 ? 's' : ''} · {units} unité{units !== 1 ? 's' : ''}</span>
            </div>
            {isEditing ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/40">
                    <tr>
                      <th className={`${docTh} w-8 text-left`}>#</th>
                      <th className={`${docTh} text-left`}>Désignation</th>
                      <th className={`${docTh} text-left`}>Marque</th>
                      <th className={`${docTh} text-left`}>Référence</th>
                      <th className={`${docTh} text-right`}>Quantité</th>
                      <th className="w-10 px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {draftItems.map((item, idx) => (
                      <tr key={item.id}>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{idx + 1}</td>
                        <td className="px-2 py-1.5"><input value={item.quoteName || ''} onChange={e => updateDraftItem(idx, 'quoteName', e.target.value)} className={docInputCls} placeholder="Désignation" aria-label="Désignation" /></td>
                        <td className="px-2 py-1.5"><input value={item.quoteBrand || ''} onChange={e => updateDraftItem(idx, 'quoteBrand', e.target.value)} className={docInputCls} placeholder="Marque" aria-label="Marque" /></td>
                        <td className="px-2 py-1.5"><input value={item.quoteBarcode || ''} onChange={e => updateDraftItem(idx, 'quoteBarcode', e.target.value)} className={docInputCls} placeholder="Référence" aria-label="Référence" /></td>
                        <td className="px-2 py-1.5"><input type="number" min="1" value={item.quantity} onChange={e => updateDraftItem(idx, 'quantity', Math.max(1, Number(e.target.value)))} className={`${docInputCls} ml-auto w-20 text-right`} aria-label="Quantité" /></td>
                        <td className="px-2 py-1.5 text-center">
                          <button type="button" onClick={() => removeDraftItem(idx)} aria-label="Retirer la ligne" className="rounded p-1.5 text-destructive hover:bg-destructive/10">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex flex-wrap items-center gap-4 border-t border-border px-4 py-3">
                  <button type="button" onClick={() => setShowProductSearch(true)} className="flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
                    <SearchIcon className="h-4 w-4" />Chercher un produit
                  </button>
                  <button type="button" onClick={addBlankItem} className="flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
                    <Plus className="h-4 w-4" />Ligne vide
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="hidden gap-4 border-b border-border bg-secondary/40 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:flex">
                  <span className="w-6" /><span className="flex-1">Produit</span><span className="w-24 text-right">Quantité</span>
                </div>
                {bl.items.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-muted-foreground">Aucun article sur ce BL.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {bl.items.map((item, idx) => {
                      const brandRef = [item.quoteBrand || item.product?.brand, item.quoteBarcode || item.product?.barcode].filter(Boolean).join(' · ');
                      return (
                        <li key={item.id} className="flex items-start gap-3 px-4 py-3 sm:px-5 md:items-center md:gap-4">
                          <span className="w-6 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground md:pt-0">{idx + 1}</span>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium leading-snug text-foreground">{item.quoteName || item.product?.name || '—'}</p>
                            {brandRef && <p className="truncate text-sm text-muted-foreground">{brandRef}</p>}
                          </div>
                          <span className="w-24 shrink-0 text-right text-base font-semibold tabular-nums text-foreground">
                            {item.quantity}<span className="ml-1 text-xs font-normal text-muted-foreground md:hidden">u.</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </section>

          {/* Notes */}
          {isEditing ? (
            <section className={`${docPanel} p-4 sm:p-5`} aria-labelledby="bl-notes-title">
              <h2 id="bl-notes-title" className="mb-2 font-semibold text-foreground">Notes</h2>
              <textarea value={draftNotes} onChange={e => setDraftNotes(e.target.value)} rows={3} placeholder="Notes..." aria-label="Notes"
                className={`${docFieldCls} resize-none`} />
            </section>
          ) : bl.notes ? (
            <section className={`${docPanel} p-4 sm:p-5`} aria-labelledby="bl-notes-title">
              <h2 id="bl-notes-title" className="mb-1 font-semibold text-foreground">Notes</h2>
              <p className="whitespace-pre-line text-sm text-foreground">{bl.notes}</p>
            </section>
          ) : null}
        </div>

        {/* Summary and actions: stays in view while the lines scroll */}
        <aside className="space-y-4 lg:sticky lg:top-4" aria-label="Livraison et actions">
          {isEditing && (
            <section className={`${docPanel} p-5`}>
              <p className="text-sm font-semibold text-foreground">Modification en cours</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Ctrl + S pour enregistrer, Échap pour annuler.</p>
              <button type="button" onClick={() => handleSave()} disabled={isSaving}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-60">
                {isSaving ? <Loader className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{isSaving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
              <button type="button" onClick={() => setIsEditing(false)} className="mt-2 w-full rounded-lg border border-border py-2 text-sm font-semibold text-foreground hover:bg-secondary">Annuler</button>
            </section>
          )}

          <section className={`${docPanel} p-5`} aria-labelledby="bl-summary-title">
            <h2 id="bl-summary-title" className="font-semibold text-foreground">Livraison</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Articles</dt><dd className="font-medium tabular-nums text-foreground">{shownItems.length} ligne{shownItems.length !== 1 ? 's' : ''} · {units} u.</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Valeur TTC</dt><dd className="font-medium tabular-nums text-foreground">{formatMoney(isEditing ? documentTotal(draftItems) : bl.totalAmount)}</dd></div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Stock</dt>
                <dd className={`font-medium ${stockPosted ? 'text-emerald-700 dark:text-emerald-300' : 'text-foreground'}`}>{stockPosted ? 'Décompté' : stockPosted === null ? '…' : 'Non décompté'}</dd>
              </div>
            </dl>
            {!isEditing && (
              <>
                {proformaOf ? (
                  <Link to={`/compta/proformas/${proformaOf.id}`}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-sm font-semibold text-foreground hover:bg-secondary">
                    <FileText className="h-4 w-4 text-primary" />Voir le proforma {proformaOf.quoteNumber}
                  </Link>
                ) : canMakeProforma ? (
                  <button type="button" onClick={() => setShowModal(true)}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90">
                    <FileText className="h-4 w-4" />Créer un proforma
                  </button>
                ) : null}
                {!stockPosted && (
                  <button type="button" onClick={handlePostStock} disabled={stockBusy || stockPosted === null}
                    title="Décompter les quantités livrées du stock"
                    className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-sm font-semibold text-foreground hover:bg-secondary disabled:opacity-60">
                    {stockBusy ? <Loader className="h-4 w-4 animate-spin" /> : <Boxes className="h-4 w-4 text-primary" />}Décompter le stock
                  </button>
                )}
              </>
            )}
          </section>

          {!isEditing && (
            <section className={`${docPanel} p-5`} aria-labelledby="bl-actions-title">
              <h2 id="bl-actions-title" className="sr-only">Actions</h2>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={handleExportPdf} className="flex flex-col items-center gap-1 rounded-lg border border-border py-2 text-xs font-semibold text-foreground hover:bg-secondary">
                  <Download className="h-4 w-4 text-primary" />Télécharger le PDF
                </button>
                <button type="button" onClick={handlePreview} className="flex flex-col items-center gap-1 rounded-lg border border-border py-2 text-xs font-semibold text-foreground hover:bg-secondary">
                  <Printer className="h-4 w-4 text-primary" />Aperçu
                </button>
              </div>
              <div className="mt-3 border-t border-border pt-1">
                <DocToggle checked={showPricesNow} onChange={setBlPricesOverride} title="Prix sur le BL" hint="Afficher les prix sur le PDF" />
                {companySettings?.stamp_url ? <DocToggle checked={useStamp} onChange={setUseStamp} title="Tampon" hint="Apposer le tampon de la société" /> : null}
              </div>
              <div className="mt-2 space-y-0.5 border-t border-border pt-2">
                <button type="button" onClick={startEdit} className={docSideAction}><Pencil className="h-4 w-4 text-muted-foreground" />Modifier le BL</button>
                <button type="button" onClick={handleDuplicate} className={docSideAction}><CopyPlus className="h-4 w-4 text-muted-foreground" />Dupliquer</button>
              </div>
            </section>
          )}
        </aside>
      </div>

      {/* Phone: the next step stays at hand, above the tab bar */}
      <DocPhoneBar label="Articles livrés" value={`${units} unité${units !== 1 ? 's' : ''}`}>
        {isEditing ? (
          <button type="button" onClick={() => handleSave()} disabled={isSaving}
            className="flex h-11 shrink-0 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            {isSaving ? <Loader className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Enregistrer
          </button>
        ) : (
          <>
            <button type="button" onClick={handleExportPdf} aria-label="Télécharger le PDF"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-foreground">
              <Download className="h-5 w-5" />
            </button>
            {canMakeProforma ? (
              <button type="button" onClick={() => setShowModal(true)}
                className="flex h-11 shrink-0 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">
                <FileText className="h-4 w-4" />Proforma
              </button>
            ) : !stockPosted ? (
              <button type="button" onClick={handlePostStock} disabled={stockBusy || stockPosted === null}
                className="flex h-11 shrink-0 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
                {stockBusy ? <Loader className="h-4 w-4 animate-spin" /> : <Boxes className="h-4 w-4" />}Décompter
              </button>
            ) : null}
          </>
        )}
      </DocPhoneBar>

      {/* Proforma creation modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl shadow-2xl max-w-sm w-full p-5">
            <h2 className="text-base font-semibold text-foreground mb-1">Créer un Proforma</h2>
            <p className="text-xs text-muted-foreground mb-4">
              depuis <span className="font-mono font-semibold">{bl.quoteNumber}</span> — {bl.items.length} article{bl.items.length !== 1 ? 's' : ''}
            </p>
            <div className="mb-4">
              <label className="block text-xs font-medium text-foreground mb-1">Société cible *</label>
              <div className="relative">
                <Building2 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <select value={targetCompanyId} onChange={e => setTargetCompanyId(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-sm border border-input rounded-lg bg-secondary text-foreground">
                  <option value="">— Sélectionner —</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex space-x-2">
              <button onClick={() => setShowModal(false)} className="flex-1 px-3 py-1.5 text-sm border border-input rounded-lg hover:bg-accent">Annuler</button>
              <button onClick={handleCreateProforma} disabled={!targetCompanyId || isCreating}
                className="flex-1 flex items-center justify-center space-x-1.5 px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg">
                {isCreating
                  ? <><Loader className="h-3.5 w-3.5 animate-spin" /><span>Création...</span></>
                  : <><FileText className="h-3.5 w-3.5" /><span>Confirmer</span></>}
              </button>
            </div>
          </div>
        </div>
      )}

      {showProductSearch && (
        <ProductSearchModal
          onSelect={addFromProduct}
          onClose={() => setShowProductSearch(false)}
        />
      )}

      {showPrintPreview && previewBlob && (
        <PrintPreviewModal blob={previewBlob} filename={previewFilename} onClose={() => { setShowPrintPreview(false); setPreviewBlob(null); }} />
      )}

      {showClientForm && (
        <ClientFormModal
          initialName={clientFormInitialName}
          onSave={client => {
            setDraftCustomerName(client.full_name);
            setDraftCustomerPhone(client.phone_number);
            setDraftCustomerCity(client.city || '');
            setShowClientForm(false);
          }}
          onClose={() => setShowClientForm(false)}
        />
      )}
    </div>
  );
}
