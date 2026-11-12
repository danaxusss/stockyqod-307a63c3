import React, { useState, useEffect, useCallback } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckSquare, Square, Download, FileText, Building2, Loader, Pencil, Check, Plus, CopyPlus, Search as SearchIcon, Printer, ChevronRight, Trash2 } from 'lucide-react';
import { Quote, QuoteItem, Company, Product } from '../../types';
import { SupabaseDocumentsService } from '../../utils/supabaseDocuments';
import { SupabaseCompaniesService } from '../../utils/supabaseCompanies';
import { PdfExportService } from '../../utils/pdfExport';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../hooks/useAuth';
import { useKeyboardSave, useAutoSave, useEscapeKey } from '../../hooks/useShortcuts';
import { ClientDropdown } from '../../components/ClientDropdown';
import { ClientFormModal } from '../../components/ClientFormModal';
import { ProductSearchModal } from '../../components/ProductSearchModal';
import { PrintPreviewModal } from '../../components/PrintPreviewModal';
import { discountRate, documentTotal, localDay, recomputeLine, toHT, toTTC, unitPriceHTInput } from '../../utils/documentLines';
import { formatMoney } from '../../utils/format';
import { DocClientCard, DocPhoneBar, DocProgress, DocToggle, type DocStep } from '../../components/documents/DocParts';
import { docDate, docFieldCls, docInputCls, docPanel, docSideAction, docTh } from '../../components/documents/docStyles';


export default function ProformaDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isSuperAdmin, isCompta } = useAuth();
  const { showToast } = useToast();

  const [proforma, setProforma] = useState<Quote | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyMap, setCompanyMap] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [issuingCompanyId, setIssuingCompanyId] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [draftNumber, setDraftNumber] = useState('');
  const [draftDate, setDraftDate] = useState('');
  const [draftCustomerName, setDraftCustomerName] = useState('');
  const [draftCustomerPhone, setDraftCustomerPhone] = useState('');
  const [draftCustomerCity, setDraftCustomerCity] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [draftStatus, setDraftStatus] = useState('');
  const [draftItems, setDraftItems] = useState<QuoteItem[]>([]);
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewFilename, setPreviewFilename] = useState('');
  const [printTTCOnly, setPrintTTCOnly] = useState(false);
  const [showClientForm, setShowClientForm] = useState(false);
  const [clientFormInitialName, setClientFormInitialName] = useState('');
  // Where this proforma sits: its source BLs, their quote, and the invoices made from it.
  const [chain, setChain] = useState<{ quote?: { id: string; number: string }; bls: Array<{ id: string; number: string }>; invoices: Array<{ id: string; number: string }> } | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      const [doc, allCompanies] = await Promise.all([
        SupabaseDocumentsService.getById(id),
        SupabaseCompaniesService.getAllCompanies(),
      ]);
      setProforma(doc);
      setCompanies(allCompanies);
      const map: Record<string, string> = {};
      allCompanies.forEach(c => { map[c.id] = c.name; });
      setCompanyMap(map);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    } finally {
      setIsLoading(false);
    }
  }, [id, showToast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!proforma) return;
    let cancelled = false;
    (async () => {
      const out: { quote?: { id: string; number: string }; bls: Array<{ id: string; number: string }>; invoices: Array<{ id: string; number: string }> } = { bls: [], invoices: [] };
      try {
        const blIds: string[] = Array.from(new Set<string>(proforma.source_bl_ids || []));
        const bls = (await Promise.all(blIds.map(blId => SupabaseDocumentsService.getById(blId).catch(() => null)))).filter((d): d is Quote => !!d);
        out.bls = bls.map(d => ({ id: d.id, number: d.quoteNumber }));
        const quoteId = bls.find(d => d.parent_document_id)?.parent_document_id;
        const quote = quoteId ? await SupabaseDocumentsService.getById(quoteId).catch(() => null) : null;
        if (quote) out.quote = { id: quote.id, number: quote.quoteNumber };
        const billedIds: string[] = proforma.items.map(i => i.billed_invoice_id).filter((v): v is string => !!v);
        const invoices = (await Promise.all(Array.from(new Set<string>(billedIds)).map(invId => SupabaseDocumentsService.getById(invId).catch(() => null)))).filter((d): d is Quote => !!d);
        out.invoices = invoices.map(d => ({ id: d.id, number: d.quoteNumber }));
      } catch { /* the line then shows the links as unknown */ }
      if (!cancelled) setChain(out);
    })();
    return () => { cancelled = true; };
  }, [proforma]);

  useEffect(() => {
    if (searchParams.get('new') === '1' && proforma && !isEditing) startEdit();
  }, [proforma, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const startEdit = () => {
    if (!proforma) return;
    setDraftNumber(proforma.quoteNumber);
    setDraftDate(proforma.quote_date || localDay(new Date(proforma.createdAt)));
    setDraftCustomerName(proforma.customer?.fullName || '');
    setDraftCustomerPhone(proforma.customer?.phoneNumber || '');
    setDraftCustomerCity(proforma.customer?.city || '');
    setDraftNotes(proforma.notes || '');
    setDraftStatus(proforma.status);
    setDraftItems(proforma.items.map(i => ({
      ...i,
      quoteName: i.quoteName || i.product?.name || '',
      quoteBrand: i.quoteBrand || i.product?.brand || '',
      quoteBarcode: i.quoteBarcode || i.product?.barcode || '',
    })));
    setSelectedIds([]);
    setIsEditing(true);
  };

  const handleSave = async (isAutoSave = false) => {
    if (!proforma) return;
    if (!isAutoSave && !draftCustomerName.trim()) {
      showToast({ type: 'error', title: 'Client requis', message: 'Veuillez saisir le nom du client avant de sauvegarder.' });
      return;
    }
    setIsSaving(true);
    try {
      // Lines invoiced meanwhile (another tab, another user) stay billed.
      const items = await SupabaseDocumentsService.keepBilledLines(proforma.id, draftItems);
      await SupabaseDocumentsService.updateDocument(proforma.id, {
        quoteNumber: draftNumber,
        quote_date: draftDate || null,
        customer: { ...proforma.customer, fullName: draftCustomerName, phoneNumber: draftCustomerPhone, city: draftCustomerCity },
        items,
        notes: draftNotes.trim() || null,
        status: draftStatus,
      });
      if (!isAutoSave) {
        showToast({ type: 'success', title: 'Proforma mis à jour', message: 'Modifications sauvegardées' });
        setIsEditing(false);
        await load();
      }
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    } finally {
      setIsSaving(false);
    }
  };

  useKeyboardSave(() => handleSave(false), isEditing);
  useAutoSave(() => handleSave(true), isEditing);
  useEscapeKey(() => setIsEditing(false), isEditing);

  const updateDraftItem = (idx: number, field: string, value: string | number) => {
    setDraftItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      if (item.is_billed) return item; // billed lines are fixed by their invoice
      const updated = { ...item, [field]: value } as QuoteItem;
      return field === 'quantity' || field === 'unitPrice' || field === 'discount' ? recomputeLine(updated) : updated;
    }));
  };

  const removeDraftItem = (idx: number) => setDraftItems(prev => prev.filter((item, i) => i !== idx || item.is_billed));

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

  const toggleItem = (itemId: string) => {
    setSelectedIds(prev => prev.includes(itemId) ? prev.filter(x => x !== itemId) : [...prev, itemId]);
  };

  const unbilledItems = proforma?.items.filter(i => !i.is_billed) || [];
  const selectedItems = proforma?.items.filter(i => selectedIds.includes(i.id)) || [];
  const invoiceTotal = documentTotal(selectedItems);

  const handleGenerateInvoice = async () => {
    if (!proforma || !issuingCompanyId || selectedIds.length === 0) return;
    setIsGenerating(true);
    try {
      const invoice = await SupabaseDocumentsService.createInvoiceFromProforma(proforma.id, selectedIds, issuingCompanyId);
      showToast({ type: 'success', title: 'Facture créée', message: `${invoice.quoteNumber} générée avec succès` });
      setShowInvoiceModal(false);
      setSelectedIds([]);
      navigate(`/compta/invoices/${invoice.id}`);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExportPdf = async () => {
    if (!proforma) return;
    try {
      const company = proforma.company_id ? await SupabaseCompaniesService.getCompanyById(proforma.company_id) : null;
      const settings = company ? {
        company_name: company.name, address: company.address, phone: company.phone,
        phone2: company.phone2, email: company.email, ice: company.ice, rc: company.rc,
        if_number: company.if_number, cnss: company.cnss, patente: company.patente,
        logo_url: company.logo_url, logo_size: company.logo_size,
        tva_rate: company.tva_rate, quote_validity_days: company.quote_validity_days,
        payment_terms: company.payment_terms, quote_visible_fields: company.quote_visible_fields,
        quote_style: { accentColor: company.accent_color, fontFamily: company.font_family, showBorders: true, borderRadius: 1, headerSize: 'large', totalsStyle: 'highlighted' },
      } as any : null;
      await PdfExportService.exportQuoteToPdf(proforma, settings, undefined, undefined, undefined, 'proforma', undefined, printTTCOnly);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur PDF', message: String(e) });
    }
  };

  const handlePreview = async () => {
    if (!proforma) return;
    try {
      const company = proforma.company_id ? await SupabaseCompaniesService.getCompanyById(proforma.company_id) : null;
      const settings = company ? {
        company_name: company.name, address: company.address, phone: company.phone,
        phone2: company.phone2, email: company.email, ice: company.ice, rc: company.rc,
        if_number: company.if_number, cnss: company.cnss, patente: company.patente,
        logo_url: company.logo_url, logo_size: company.logo_size,
        tva_rate: company.tva_rate, quote_validity_days: company.quote_validity_days,
        payment_terms: company.payment_terms, quote_visible_fields: company.quote_visible_fields,
        quote_style: { accentColor: company.accent_color, fontFamily: company.font_family, showBorders: true, borderRadius: 1, headerSize: 'large', totalsStyle: 'highlighted' },
      } as any : null;
      const { blob, filename } = await PdfExportService.generatePdfBlob(proforma, settings, undefined, undefined, undefined, 'proforma', undefined, printTTCOnly);
      setPreviewBlob(blob);
      setPreviewFilename(filename);
      setShowPrintPreview(true);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    }
  };

  const handleDuplicate = async () => {
    if (!proforma || !window.confirm('Dupliquer ce proforma ?')) return;
    try {
      const dup = await SupabaseDocumentsService.duplicateDocument(proforma.id);
      navigate(`/compta/proformas/${dup.id}`);
    } catch (e) {
      showToast({ type: 'error', message: String(e) });
    }
  };

  if (!isSuperAdmin && !isCompta) return <div className="text-center py-12 text-muted-foreground">Accès réservé au rôle Comptabilité.</div>;
  if (isLoading) return <div className="flex items-center justify-center min-h-[40vh]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!proforma) return <div className="text-center py-12 text-muted-foreground">Proforma introuvable.</div>;

  // paid_amount on a proforma is the amount already invoiced from it.
  const remaining = proforma.totalAmount - (proforma.paid_amount || 0);
  const draftTotal = documentTotal(draftItems);
  const tvaRate = companies.find(c => c.id === proforma.company_id)?.tva_rate ?? 20;
  const shownItems = isEditing ? draftItems : proforma.items;
  const showDiscount = isEditing || shownItems.some(i => discountRate(i) > 0);
  const shownTotal = isEditing ? draftTotal : proforma.totalAmount;
  const shownHT = toHT(shownTotal, tvaRate);
  const billedCount = proforma.items.filter(i => i.is_billed).length;
  const allUnbilledSelected = unbilledItems.length > 0 && unbilledItems.every(i => selectedIds.includes(i.id));
  const statusPill = proforma.status === 'solde' ? { label: 'Soldé', cls: 'bg-emerald-500/10 text-emerald-700 ring-emerald-600/20 dark:text-emerald-300' }
    : proforma.status === 'final' ? { label: 'Finalisé', cls: 'bg-blue-500/10 text-blue-700 ring-blue-600/20 dark:text-blue-300' }
    : proforma.status === 'pending' ? { label: 'En attente', cls: 'bg-amber-500/10 text-amber-800 ring-amber-600/20 dark:text-amber-300' }
    : { label: 'En cours', cls: 'bg-secondary text-muted-foreground ring-border' };
  const invoiceNumber = (invoiceId?: string) => chain?.invoices.find(inv => inv.id === invoiceId)?.number;

  const steps: DocStep[] = [
    chain?.quote
      ? { label: 'Devis', detail: chain.quote.number, state: 'done', to: `/quote-cart/${chain.quote.id}` }
      : { label: 'Devis', detail: chain ? 'non lié' : '…', state: 'todo' },
    chain && chain.bls.length > 0
      ? { label: 'BL', detail: chain.bls[0].number + (chain.bls.length > 1 ? ` +${chain.bls.length - 1}` : ''), state: 'done', to: `/compta/bls/${chain.bls[0].id}` }
      : { label: 'BL', detail: chain ? 'non lié' : '…', state: 'todo' },
    { label: 'Proforma', detail: statusPill.label, state: billedCount > 0 || proforma.status === 'final' || proforma.status === 'solde' ? 'done' : 'current' },
    {
      label: 'Facture',
      detail: proforma.items.length === 0 ? '—' : billedCount === 0 ? 'non facturé' : `${billedCount}/${proforma.items.length} ligne${proforma.items.length > 1 ? 's' : ''}`,
      state: proforma.items.length > 0 && billedCount === proforma.items.length ? 'done' : billedCount > 0 ? 'current' : 'todo',
      to: chain?.invoices[0] ? `/compta/invoices/${chain.invoices[0].id}` : undefined,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl pb-28 md:pb-0">
      {/* Title */}
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0">
          <nav aria-label="Fil d’Ariane" className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex">
            <Link to="/compta/proformas" className="hover:text-foreground">Proformas</Link>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-foreground">{proforma.quoteNumber}</span>
          </nav>
          {isEditing ? (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="proforma-number">Numéro du proforma</label>
              <input id="proforma-number" value={draftNumber} onChange={e => setDraftNumber(e.target.value)}
                className="w-48 rounded-lg border border-input bg-background px-2.5 py-1.5 text-lg font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
              <label className="sr-only" htmlFor="proforma-date">Date du proforma</label>
              <input id="proforma-date" type="date" value={draftDate} onChange={e => setDraftDate(e.target.value)}
                className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
          ) : (
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">Proforma {proforma.quoteNumber}</h1>
          )}
        </div>
        {isEditing ? (
          <select value={draftStatus} onChange={e => setDraftStatus(e.target.value)} aria-label="Statut du proforma"
            className="rounded-full border-0 bg-secondary py-1 pl-3 pr-8 text-xs font-semibold text-foreground ring-1 ring-inset ring-border">
            <option value="draft">En cours</option>
            <option value="pending">En attente</option>
            <option value="final">Finalisé</option>
            <option value="solde">Soldé</option>
          </select>
        ) : (
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${statusPill.cls}`}>{statusPill.label}</span>
        )}
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <DocProgress
            steps={steps}
            footer={chain && chain.bls.length > 0 ? (
              <>BL sources : {chain.bls.map((b, i) => (
                <span key={b.id}>{i > 0 && ', '}<Link to={`/compta/bls/${b.id}`} className="font-semibold text-primary hover:underline">{b.number}</Link></span>
              ))}</>
            ) : null}
          />

          {/* Client */}
          <section className={`${docPanel} p-4 sm:p-5`} aria-labelledby="proforma-client-title">
            <h2 id="proforma-client-title" className={isEditing ? 'mb-3 font-semibold text-foreground' : 'sr-only'}>Client</h2>
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
              <DocClientCard name={proforma.customer?.fullName} details={[proforma.customer?.phoneNumber, proforma.customer?.city, `émis le ${docDate(proforma)}`]} />
            )}
          </section>

          {/* Lines */}
          <section className={docPanel} aria-labelledby="proforma-lines-title">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3 sm:px-5">
              <h2 id="proforma-lines-title" className="font-semibold text-foreground">Articles</h2>
              <span className="text-sm text-muted-foreground">{shownItems.length} ligne{shownItems.length !== 1 ? 's' : ''}{!isEditing && billedCount > 0 ? ` · ${billedCount} facturée${billedCount > 1 ? 's' : ''}` : ''}</span>
              {!isEditing && unbilledItems.length > 0 && (
                <button type="button" onClick={() => setSelectedIds(allUnbilledSelected ? [] : unbilledItems.map(i => i.id))}
                  className="ml-auto flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
                  {allUnbilledSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                  {allUnbilledSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
                </button>
              )}
            </div>
            {isEditing ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/40">
                    <tr>
                      <th className={`${docTh} w-8 text-left`}>#</th>
                      <th className={`${docTh} text-left`}>Désignation</th>
                      <th className={`${docTh} text-left`}>Marque</th>
                      <th className={`${docTh} text-left`}>Réf</th>
                      <th className={`${docTh} text-right`}>Qté</th>
                      <th className={`${docTh} text-right`}>PU HT</th>
                      <th className={`${docTh} text-right`}>Remise %</th>
                      <th className={`${docTh} text-right`}>Total HT</th>
                      <th className="w-10 px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {draftItems.map((item, idx) => {
                      const unitHT = toHT(item.unitPrice, tvaRate);
                      const totalHT = toHT(item.subtotal, tvaRate);
                      return item.is_billed === true ? (
                        <tr key={item.id} className="bg-secondary/20">
                          <td className="px-3 py-2 text-xs text-muted-foreground">{idx + 1}</td>
                          <td className="px-3 py-2 text-foreground">{item.quoteName || item.product?.name || '—'}</td>
                          <td className="px-3 py-2 text-muted-foreground">{item.quoteBrand || item.product?.brand || '—'}</td>
                          <td className="px-3 py-2 text-muted-foreground">{item.quoteBarcode || item.product?.barcode || '—'}</td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">{item.quantity}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-foreground">{formatMoney(unitHT)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{discountRate(item) > 0 ? `${discountRate(item)} %` : '—'}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">{formatMoney(totalHT)}</td>
                          <td className="px-2 py-1.5 text-center" title="Ligne facturée : non modifiable">
                            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">Facturé</span>
                          </td>
                        </tr>
                      ) : (
                        <tr key={item.id}>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{idx + 1}</td>
                          <td className="px-2 py-1.5"><input value={item.quoteName || ''} onChange={e => updateDraftItem(idx, 'quoteName', e.target.value)} className={docInputCls} placeholder="Désignation" aria-label="Désignation" /></td>
                          <td className="px-2 py-1.5"><input value={item.quoteBrand || ''} onChange={e => updateDraftItem(idx, 'quoteBrand', e.target.value)} className={docInputCls} placeholder="Marque" aria-label="Marque" /></td>
                          <td className="px-2 py-1.5"><input value={item.quoteBarcode || ''} onChange={e => updateDraftItem(idx, 'quoteBarcode', e.target.value)} className={docInputCls} placeholder="Référence" aria-label="Référence" /></td>
                          <td className="px-2 py-1.5"><input type="number" min="1" value={item.quantity} onChange={e => updateDraftItem(idx, 'quantity', Math.max(1, Number(e.target.value)))} className={`${docInputCls} w-20 text-right`} aria-label="Quantité" /></td>
                          <td className="px-2 py-1.5"><input type="number" min="0" step="0.01" value={unitPriceHTInput(item, tvaRate)} onChange={e => updateDraftItem(idx, 'unitPrice', toTTC(Number(e.target.value), tvaRate))} className={`${docInputCls} w-24 text-right`} title="Prix unitaire hors taxes" aria-label="Prix unitaire HT" /></td>
                          <td className="px-2 py-1.5"><input type="number" min="0" max="100" step="0.5" value={discountRate(item)} onChange={e => updateDraftItem(idx, 'discount', Math.min(100, Math.max(0, Number(e.target.value))))} className={`${docInputCls} w-16 text-right`} title="Remise %" aria-label="Remise %" /></td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">{formatMoney(totalHT)}</td>
                          <td className="px-2 py-1.5 text-center">
                            <button type="button" onClick={() => removeDraftItem(idx)} aria-label="Retirer la ligne" className="rounded p-1.5 text-destructive hover:bg-destructive/10">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
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
                  <span className="w-6" /><span className="flex-1">Produit</span><span className="w-14 text-right">Qté</span><span className="w-32 text-right">Prix HT</span><span className="w-32 text-right">Total HT</span>
                </div>
                {proforma.items.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-muted-foreground">Aucun article sur ce proforma.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {proforma.items.map(item => {
                      const billed = item.is_billed === true;
                      const selected = selectedIds.includes(item.id);
                      const unitHT = toHT(item.unitPrice, tvaRate);
                      const totalHT = toHT(item.subtotal, tvaRate);
                      const rate = discountRate(item);
                      const brandRef = [item.quoteBrand || item.product?.brand, item.quoteBarcode || item.product?.barcode].filter(Boolean).join(' · ');
                      const invNumber = invoiceNumber(item.billed_invoice_id);
                      const name = item.quoteName || item.product?.name || '—';
                      return (
                        <li key={item.id} className={`flex items-start gap-3 px-4 py-3 sm:px-5 md:items-center md:gap-4 ${selected ? 'bg-primary/5' : ''}`}>
                          <span className="w-6 shrink-0 pt-0.5 md:pt-0">
                            {billed ? (
                              <Check className="h-4 w-4 text-emerald-600" aria-label="Ligne facturée" />
                            ) : (
                              <button type="button" onClick={() => toggleItem(item.id)} aria-pressed={selected}
                                aria-label={`${selected ? 'Retirer de la facture' : 'Sélectionner pour la facture'} : ${name}`}
                                className="text-primary">
                                {selected ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5 text-muted-foreground" />}
                              </button>
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className={`font-medium leading-snug ${billed ? 'text-muted-foreground' : 'text-foreground'}`}>{name}</p>
                            {brandRef && <p className="truncate text-sm text-muted-foreground">{brandRef}</p>}
                            <p className="mt-0.5 text-sm tabular-nums text-muted-foreground md:hidden">
                              {item.quantity} × {formatMoney(unitHT)} HT{rate > 0 ? ` · remise ${rate} %` : ''}
                            </p>
                            {billed ? (
                              <p className="mt-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                                Facturé
                                {item.billed_by_company_id && companyMap[item.billed_by_company_id] ? ` par ${companyMap[item.billed_by_company_id]}` : ''}
                                {item.billed_invoice_id && invNumber && (
                                  <> · <Link to={`/compta/invoices/${item.billed_invoice_id}`} className="text-primary hover:underline">{invNumber}</Link></>
                                )}
                              </p>
                            ) : (
                              <p className="mt-1 text-xs font-semibold text-amber-800 dark:text-amber-300">Non facturé</p>
                            )}
                          </div>
                          <span className="hidden w-14 text-right font-semibold tabular-nums text-foreground md:block">{item.quantity}</span>
                          <span className="hidden w-32 text-right tabular-nums text-foreground md:block">
                            {formatMoney(unitHT)}
                            {showDiscount && rate > 0 && <span className="block text-xs font-semibold text-amber-700 dark:text-amber-300">remise {rate} %</span>}
                          </span>
                          <span className="w-28 shrink-0 text-right font-semibold tabular-nums text-foreground md:w-32">{formatMoney(totalHT)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
            <dl className="space-y-1.5 border-t border-border px-4 py-3 text-sm sm:px-5">
              <div className="flex justify-between"><dt className="text-muted-foreground">Total HT</dt><dd className="tabular-nums text-foreground">{formatMoney(shownHT)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">TVA {tvaRate} %</dt><dd className="tabular-nums text-foreground">{formatMoney(shownTotal - shownHT)}</dd></div>
              <div className="flex justify-between text-base font-semibold"><dt className="text-foreground">Total TTC</dt><dd className="tabular-nums text-foreground">{formatMoney(shownTotal)}</dd></div>
            </dl>
          </section>

          {/* Notes */}
          {isEditing ? (
            <section className={`${docPanel} p-4 sm:p-5`} aria-labelledby="proforma-notes-title">
              <h2 id="proforma-notes-title" className="mb-2 font-semibold text-foreground">Notes</h2>
              <textarea value={draftNotes} onChange={e => setDraftNotes(e.target.value)} rows={3} placeholder="Notes..." aria-label="Notes"
                className={`${docFieldCls} resize-none`} />
            </section>
          ) : proforma.notes ? (
            <section className={`${docPanel} p-4 sm:p-5`} aria-labelledby="proforma-notes-title">
              <h2 id="proforma-notes-title" className="mb-1 font-semibold text-foreground">Notes</h2>
              <p className="whitespace-pre-line text-sm text-foreground">{proforma.notes}</p>
            </section>
          ) : null}
        </div>

        {/* Billing and actions: stays in view while the lines scroll */}
        <aside className="space-y-4 lg:sticky lg:top-4" aria-label="Facturation et actions">
          {isEditing && (
            <section className={`${docPanel} p-5`}>
              <p className="text-sm font-semibold text-foreground">Modification en cours</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Ctrl + S pour enregistrer, Échap pour annuler. Les lignes facturées ne changent pas.</p>
              <button type="button" onClick={() => handleSave()} disabled={isSaving}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-60">
                {isSaving ? <Loader className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{isSaving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
              <button type="button" onClick={() => setIsEditing(false)} className="mt-2 w-full rounded-lg border border-border py-2 text-sm font-semibold text-foreground hover:bg-secondary">Annuler</button>
            </section>
          )}

          <section className={`${docPanel} p-5`} aria-labelledby="proforma-billing-title">
            <h2 id="proforma-billing-title" className="font-semibold text-foreground">Facturation</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Total TTC</dt><dd className="font-medium tabular-nums text-foreground">{formatMoney(shownTotal)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Déjà facturé</dt><dd className="font-medium tabular-nums text-emerald-700 dark:text-emerald-300">{formatMoney(proforma.paid_amount || 0)}</dd></div>
            </dl>
            <div className="mt-3 border-t border-border pt-3">
              <p className="text-sm font-semibold text-foreground">{remaining <= 0 && proforma.items.length > 0 ? 'Entièrement facturé' : 'Reste à facturer'}</p>
              <p className={`text-2xl font-bold tabular-nums tracking-tight ${remaining <= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-foreground'}`}>{formatMoney(Math.max(0, remaining))}</p>
            </div>
            {!isEditing && unbilledItems.length > 0 && (
              <>
                <p className="mt-3 text-xs text-muted-foreground">
                  {selectedIds.length === 0 ? 'Cochez les lignes à facturer dans la liste.' : `${selectedIds.length} ligne${selectedIds.length > 1 ? 's' : ''} sélectionnée${selectedIds.length > 1 ? 's' : ''} · ${formatMoney(invoiceTotal)} TTC`}
                </p>
                <button type="button" onClick={() => setShowInvoiceModal(true)} disabled={selectedIds.length === 0}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50">
                  <FileText className="h-4 w-4" />Générer la facture{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
                </button>
              </>
            )}
            {!isEditing && chain && chain.invoices.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-border pt-3 text-xs">
                {chain.invoices.map(inv => (
                  <li key={inv.id} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Facture</span>
                    <Link to={`/compta/invoices/${inv.id}`} className="font-semibold text-primary hover:underline">{inv.number}</Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {!isEditing && (
            <section className={`${docPanel} p-5`} aria-labelledby="proforma-actions-title">
              <h2 id="proforma-actions-title" className="sr-only">Actions</h2>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={handleExportPdf} className="flex flex-col items-center gap-1 rounded-lg border border-border py-2 text-xs font-semibold text-foreground hover:bg-secondary">
                  <Download className="h-4 w-4 text-primary" />Télécharger le PDF
                </button>
                <button type="button" onClick={handlePreview} className="flex flex-col items-center gap-1 rounded-lg border border-border py-2 text-xs font-semibold text-foreground hover:bg-secondary">
                  <Printer className="h-4 w-4 text-primary" />Aperçu
                </button>
              </div>
              <div className="mt-3 border-t border-border pt-1">
                <DocToggle checked={printTTCOnly} onChange={setPrintTTCOnly} title="Prix TTC uniquement" hint="Masquer le détail HT et TVA sur le PDF" />
              </div>
              <div className="mt-2 space-y-0.5 border-t border-border pt-2">
                <button type="button" onClick={startEdit} className={docSideAction}><Pencil className="h-4 w-4 text-muted-foreground" />Modifier le proforma</button>
                <button type="button" onClick={handleDuplicate} className={docSideAction}><CopyPlus className="h-4 w-4 text-muted-foreground" />Dupliquer</button>
              </div>
            </section>
          )}
        </aside>
      </div>

      {/* Phone: what is left to invoice and the next step, above the tab bar */}
      <DocPhoneBar label={remaining <= 0 && proforma.items.length > 0 ? 'Entièrement facturé' : 'Reste à facturer'} value={formatMoney(Math.max(0, remaining))}>
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
            {unbilledItems.length > 0 && (
              <button type="button" onClick={() => setShowInvoiceModal(true)} disabled={selectedIds.length === 0}
                className="flex h-11 shrink-0 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                <FileText className="h-4 w-4" />Facturer{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
              </button>
            )}
          </>
        )}
      </DocPhoneBar>

      {/* Invoice generation modal */}
      {showInvoiceModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl shadow-2xl max-w-md w-full p-5">
            <h2 className="text-base font-semibold text-foreground mb-4">Générer une Facture</h2>
            <div className="mb-3 p-3 bg-secondary rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">Articles sélectionnés ({selectedIds.length})</p>
              {selectedItems.map(i => (
                <div key={i.id} className="flex justify-between text-xs py-0.5">
                  <span className="text-foreground">{i.quoteName || i.product?.name}</span>
                  <span className="font-mono text-foreground">× {i.quantity}</span>
                </div>
              ))}
              <div className="border-t border-border mt-2 pt-2 flex justify-between text-sm font-bold">
                <span>Total Facture</span>
                <span>{formatMoney(invoiceTotal)} TTC</span>
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-xs font-medium text-foreground mb-1">Société émettrice *</label>
              <div className="relative">
                <Building2 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <select value={issuingCompanyId} onChange={e => setIssuingCompanyId(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-sm border border-input rounded-lg bg-secondary text-foreground">
                  <option value="">— Sélectionner —</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex space-x-2">
              <button onClick={() => setShowInvoiceModal(false)} className="flex-1 px-3 py-1.5 text-sm border border-input rounded-lg hover:bg-accent">Annuler</button>
              <button onClick={handleGenerateInvoice} disabled={!issuingCompanyId || isGenerating}
                className="flex-1 flex items-center justify-center space-x-1.5 px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg">
                {isGenerating
                  ? <><div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" /><span>Génération...</span></>
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
