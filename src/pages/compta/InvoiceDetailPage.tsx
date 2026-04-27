import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Receipt, Download, ArrowLeft, Loader, Pencil, Check, X, Plus, Calendar, Lock, Unlock, ChevronDown, ChevronUp, MessageCircle, Copy, CopyPlus, Search as SearchIcon, Mail, Printer, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { Quote, QuoteItem, PaymentEntry, Product } from '../../types';
import { SupabaseDocumentsService } from '../../utils/supabaseDocuments';
import { PdfExportService } from '../../utils/pdfExport';
import { CompanySettingsService, CompanySettings } from '../../utils/companySettings';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../hooks/useAuth';
import { useKeyboardSave, useAutoSave, useEscapeKey } from '../../hooks/useShortcuts';
import { buildWhatsAppShareUrl, openPreparingWhatsAppWindow, redirectPreparingWindowToWhatsApp, openWhatsAppShare } from '../../utils/whatsappShare';
import { ClientDropdown } from '../../components/ClientDropdown';
import { ClientFormModal } from '../../components/ClientFormModal';
import { SupabaseUsersService } from '../../utils/supabaseUsers';
import { ProductSearchModal } from '../../components/ProductSearchModal';
import { PrintPreviewModal } from '../../components/PrintPreviewModal';

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n);
}

const inputCls = 'w-full px-2 py-1 text-xs border border-input rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary';

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isSuperAdmin, isCompta } = useAuth();
  const { showToast } = useToast();

  const [invoice, setInvoice] = useState<Quote | null>(null);
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const [useStamp, setUseStamp] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

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
  const [draftPaymentDate, setDraftPaymentDate] = useState('');
  const [draftPaymentMethod, setDraftPaymentMethod] = useState('');
  const [draftPaymentReference, setDraftPaymentReference] = useState('');
  const [draftPaymentBank, setDraftPaymentBank] = useState('');
  const [draftNotes2, setDraftNotes2] = useState('');
  const [draftAvance, setDraftAvance] = useState(0);
  const [showAvance, setShowAvance] = useState(false);
  const [draftPaymentMethods, setDraftPaymentMethods] = useState<PaymentEntry[]>([]);
  const [showExtraPayments, setShowExtraPayments] = useState(false);
  // Lock / PIN
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  // WhatsApp
  const [showWaModal, setShowWaModal] = useState(false);
  const [waPhone, setWaPhone] = useState('');
  const [agentPhone, setAgentPhone] = useState<string | null>(null);
  const [agentPhoneLoading, setAgentPhoneLoading] = useState(false);
  // Product search
  const [showProductSearch, setShowProductSearch] = useState(false);
  // Print preview
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewFilename, setPreviewFilename] = useState('');
  // Client form
  const [showClientForm, setShowClientForm] = useState(false);
  const [clientFormInitialName, setClientFormInitialName] = useState('');
  // Avoir
  const [showAvoirModal, setShowAvoirModal] = useState(false);
  const [avoirReason, setAvoirReason] = useState('');
  const [avoirLoading, setAvoirLoading] = useState(false);

  const paymentSummary = useMemo(() => {
    if (!invoice) return null;
    const avance = invoice.avance_amount || 0;
    const entries = (invoice.payment_methods_json || []) as PaymentEntry[];
    const paymentsTotal = entries.reduce((s, e) => s + (e.amount || 0), 0);
    const totalPaid = avance + paymentsTotal;
    const reste = Math.max(0, invoice.totalAmount - totalPaid);
    const status: 'paid' | 'partial' | 'unpaid' =
      reste <= 0 && (totalPaid > 0 || invoice.totalAmount === 0) ? 'paid' :
      totalPaid > 0 ? 'partial' : 'unpaid';
    return { avance, entries, paymentsTotal, totalPaid, reste, status };
  }, [invoice]);

  const load = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      const doc = await SupabaseDocumentsService.getById(id);
      setInvoice(doc);
      const compId = doc?.issuing_company_id || doc?.company_id;
      if (compId) {
        const settings = await CompanySettingsService.getSettings(compId).catch(() => null);
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

  // Auto-enter edit mode for freshly created documents
  useEffect(() => {
    if (searchParams.get('new') === '1' && invoice && !isEditing) startEdit();
  }, [invoice, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const startEdit = () => {
    if (!invoice) return;
    setDraftNumber(invoice.quoteNumber);
    setDraftDate(invoice.quote_date || new Date(invoice.createdAt).toISOString().split('T')[0]);
    setDraftCustomerName(invoice.customer?.fullName || '');
    setDraftCustomerPhone(invoice.customer?.phoneNumber || '');
    setDraftCustomerCity(invoice.customer?.city || '');
    setDraftNotes(invoice.notes || '');
    setDraftStatus(invoice.status);
    setDraftItems(invoice.items.map(i => ({
      ...i,
      quoteName: i.quoteName || i.product?.name || '',
      quoteBrand: i.quoteBrand || i.product?.brand || '',
      quoteBarcode: i.quoteBarcode || i.product?.barcode || '',
    })));
    setDraftPaymentDate(invoice.payment_date || '');
    setDraftPaymentMethod(invoice.payment_method || '');
    setDraftPaymentReference(invoice.payment_reference || '');
    setDraftPaymentBank(invoice.payment_bank || '');
    setDraftNotes2(invoice.notes2 || '');
    setDraftAvance(invoice.avance_amount || 0);
    setShowAvance((invoice.avance_amount || 0) > 0);
    setDraftPaymentMethods((invoice.payment_methods_json as PaymentEntry[]) || []);
    setShowExtraPayments(((invoice.payment_methods_json as PaymentEntry[]) || []).length > 0);
    setIsEditing(true);
  };

  const handleSave = async (isAutoSave = false) => {
    if (!invoice) return;
    if (!isAutoSave && !draftCustomerName.trim()) {
      showToast({ type: 'error', title: 'Client requis', message: 'Veuillez saisir le nom du client avant de sauvegarder.' });
      return;
    }
    setIsSaving(true);
    try {
      await SupabaseDocumentsService.updateDocument(invoice.id, {
        quoteNumber: draftNumber,
        customer: { ...invoice.customer, fullName: draftCustomerName, phoneNumber: draftCustomerPhone, city: draftCustomerCity },
        items: draftItems,
        notes: draftNotes.trim() || null,
        notes2: draftNotes2.trim() || null,
        status: draftStatus,
        payment_date: draftPaymentDate || null,
        payment_method: draftPaymentMethod || null,
        payment_reference: draftPaymentReference || null,
        payment_bank: draftPaymentBank || null,
        avance_amount: showAvance ? draftAvance : 0,
        payment_methods_json: draftPaymentMethods.length > 0 ? draftPaymentMethods : [],
        quote_date: draftDate || null,
      });
      if (!isAutoSave) {
        showToast({ type: 'success', title: 'Facture mise à jour', message: 'Modifications sauvegardées' });
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
      const updated: any = { ...item, [field]: value };
      if (field === 'quantity' || field === 'unitPrice') {
        updated.subtotal = (updated.unitPrice || 0) * Math.max(1, updated.quantity || 1);
      }
      return updated as QuoteItem;
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

  const handleLock = async () => {
    if (!invoice) return;
    try {
      await SupabaseDocumentsService.updateDocument(invoice.id, { is_locked: true });
      showToast({ type: 'success', message: 'Facture verrouillée' });
      await load();
    } catch (e) {
      showToast({ type: 'error', message: String(e) });
    }
  };

  const handleUnlock = () => {
    setPinInput('');
    setShowPinModal(true);
  };

  const confirmUnlock = async () => {
    if (!invoice) return;
    try {
      // Always fetch fresh settings so a PIN set after page load is picked up
      const compId = invoice.issuing_company_id || invoice.company_id;
      const expectedPin = await CompanySettingsService.resolveSpecialPin(compId);
      if (!expectedPin) {
        showToast({ type: 'error', message: 'Aucun PIN configuré dans les paramètres société' });
        return;
      }
      if (pinInput !== expectedPin) {
        showToast({ type: 'error', message: 'PIN incorrect' });
        return;
      }
      await SupabaseDocumentsService.updateDocument(invoice.id, { is_locked: false });
      showToast({ type: 'success', message: 'Facture déverrouillée' });
      setShowPinModal(false);
      setPinInput('');
      await load();
    } catch (e) {
      showToast({ type: 'error', message: String(e) });
    }
  };

  const handleExportPdf = async () => {
    if (!invoice) return;
    try {
      const compId = invoice.issuing_company_id || invoice.company_id;
      const freshSettings = compId
        ? await CompanySettingsService.getSettings(compId).catch(() => companySettings)
        : companySettings;
      await PdfExportService.exportQuoteToPdf(invoice, freshSettings, undefined, undefined, useStamp, 'invoice');
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur PDF', message: String(e) });
    }
  };

  const handleWhatsAppShare = async (phone: string) => {
    if (!invoice) return;
    const waPopup = openPreparingWhatsAppWindow();
    try {
      const compId = invoice.issuing_company_id || invoice.company_id;
      const freshSettings = compId
        ? await CompanySettingsService.getSettings(compId).catch(() => companySettings)
        : companySettings;
      await PdfExportService.exportQuoteToPdf(invoice, freshSettings, undefined, undefined, useStamp, 'invoice');
    } catch { /* continue even if PDF fails */ }

    const company = companySettings?.company_name?.trim() || '';
    const msg = `Bonjour ${invoice.customer?.fullName || ''},\nVeuillez trouver ci-joint votre facture ${invoice.quoteNumber} d'un montant de ${fmt(invoice.totalAmount)} Dh.${company ? `\n\nCordialement,\n${company}` : ''}`;
    const waUrl = buildWhatsAppShareUrl(phone, msg);
    const redirected = redirectPreparingWindowToWhatsApp(waUrl, waPopup);
    if (!redirected) {
      if (!openWhatsAppShare(waUrl)) {
        navigator.clipboard.writeText(msg).then(() =>
          showToast({ type: 'success', title: 'Copié', message: 'Message copié — ouvrez WhatsApp et collez-le.' })
        );
      }
    }
  };

  if (!isSuperAdmin && !isCompta) return <div className="text-center py-12 text-muted-foreground">Accès réservé au rôle Comptabilité.</div>;
  if (isLoading) return <div className="flex items-center justify-center min-h-[40vh]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!invoice) return <div className="text-center py-12 text-muted-foreground">Facture introuvable.</div>;

  const tvaRate = companySettings?.tva_rate ?? 20;
  const draftTotal = draftItems.reduce((s, i) => s + i.subtotal, 0);

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => navigate('/compta/invoices')} className="p-1.5 hover:bg-accent rounded-lg">
          <ArrowLeft className="h-4 w-4 text-muted-foreground" />
        </button>
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <div className="flex items-center gap-2 flex-wrap">
              <input value={draftNumber} onChange={e => setDraftNumber(e.target.value)}
                className="text-lg font-bold font-mono px-2 py-0.5 border border-input rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
              <input type="date" value={draftDate} onChange={e => setDraftDate(e.target.value)}
                className="text-xs px-2 py-0.5 border border-input rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
          ) : (
            <>
              <h1 className="text-lg font-bold text-foreground font-mono">{invoice.quoteNumber}</h1>
              <p className="text-xs text-muted-foreground">{invoice.customer?.fullName} — {invoice.quote_date ? new Date(invoice.quote_date).toLocaleDateString('fr-FR') : new Date(invoice.createdAt).toLocaleDateString('fr-FR')}</p>
            </>
          )}
        </div>
        {isEditing ? (
          <select value={draftStatus} onChange={e => setDraftStatus(e.target.value)}
            className="text-xs border border-input rounded px-2 py-1 bg-background text-foreground">
            <option value="draft">Brouillon</option>
            <option value="final">Finalisé</option>
          </select>
        ) : (
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
              {invoice.status === 'final' ? 'Finalisé' : 'Brouillon'}
            </span>
            {paymentSummary && paymentSummary.status === 'paid' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                <CheckCircle className="h-3 w-3" />Soldée
              </span>
            )}
            {paymentSummary && paymentSummary.status === 'partial' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                <Clock className="h-3 w-3" />Partiel
              </span>
            )}
            {paymentSummary && paymentSummary.status === 'unpaid' && invoice.status === 'final' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
                <AlertCircle className="h-3 w-3" />Non payée
              </span>
            )}
          </div>
        )}
        {isEditing ? (
          <>
            <button onClick={() => setIsEditing(false)} className="p-1.5 hover:bg-accent rounded-lg text-muted-foreground" title="Annuler">
              <X className="h-4 w-4" />
            </button>
            <button onClick={handleSave} disabled={isSaving}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg">
              {isSaving ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              <span>{isSaving ? 'Sauvegarde...' : 'Sauvegarder'}</span>
            </button>
          </>
        ) : (
          <>
            {invoice.is_locked ? (
              <button onClick={handleUnlock} className="p-1.5 hover:bg-amber-500/10 rounded-lg text-base leading-none" title="Déverrouiller">
                🔒
              </button>
            ) : (
              <>
                <button onClick={startEdit} className="p-1.5 hover:bg-accent rounded-lg text-muted-foreground" title="Modifier">
                  <Pencil className="h-4 w-4" />
                </button>
                <button onClick={handleLock} className="p-1.5 hover:bg-accent rounded-lg text-muted-foreground" title="Verrouiller">
                  <Unlock className="h-4 w-4" />
                </button>
              </>
            )}
            {companySettings?.stamp_url && (
              <button
                onClick={() => setUseStamp(v => !v)}
                title={useStamp ? 'Retirer le tampon' : 'Apposer le tampon'}
                className={`p-1.5 rounded-lg transition-colors text-base leading-none ${useStamp ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/40' : 'hover:bg-accent text-muted-foreground'}`}
              >
                ✍🏻
              </button>
            )}
            <button onClick={handleExportPdf} className="flex items-center space-x-1.5 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
              <Download className="h-3.5 w-3.5" /><span>PDF</span>
            </button>
            <button
              onClick={async () => {
                if (!invoice) return;
                const freshSettings = await CompanySettingsService.getSettings(invoice.company_id!);
                const { blob, filename } = await PdfExportService.generatePdfBlob(invoice, freshSettings, undefined, undefined, useStamp, 'invoice');
                setPreviewBlob(blob);
                setPreviewFilename(filename);
                setShowPrintPreview(true);
              }}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-sm bg-secondary hover:bg-accent border border-border text-foreground rounded-lg"
              title="Aperçu avant impression"
            >
              <Printer className="h-3.5 w-3.5" /><span>Aperçu</span>
            </button>
            <button
              onClick={async () => {
                setWaPhone(invoice.customer?.phoneNumber || '');
                setAgentPhone(null);
                setAgentPhoneLoading(true);
                setShowWaModal(true);
                try {
                  const users = await SupabaseUsersService.getAllUsers();
                  const salesName = invoice.customer?.salesPerson?.trim().toLowerCase() || '';
                  const match = salesName ? users.find(u =>
                    (u.custom_seller_name && u.custom_seller_name.trim().toLowerCase().includes(salesName)) ||
                    u.username.trim().toLowerCase() === salesName
                  ) : null;
                  setAgentPhone(match?.phone || '');
                } catch { setAgentPhone(''); }
                finally { setAgentPhoneLoading(false); }
              }}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg"
              title="Partager sur WhatsApp"
            >
              <MessageCircle className="h-3.5 w-3.5" /><span>WhatsApp</span>
            </button>
            <button
              onClick={() => {
                const subject = encodeURIComponent(`Facture ${invoice.quoteNumber}`);
                const body = encodeURIComponent(
                  `Bonjour ${invoice.customer?.fullName || ''},\n\nVeuillez trouver ci-joint votre facture ${invoice.quoteNumber} d'un montant de ${fmt(invoice.totalAmount)} Dh.\n\nCordialement,\n${companySettings?.company_name || ''}`
                );
                window.location.href = `mailto:?subject=${subject}&body=${body}`;
              }}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-sm bg-secondary hover:bg-accent border border-border text-foreground rounded-lg"
              title="Envoyer par email"
            >
              <Mail className="h-3.5 w-3.5" /><span>Email</span>
            </button>
            <button
              onClick={async () => {
                if (!window.confirm('Dupliquer cette facture ?')) return;
                try {
                  const dup = await SupabaseDocumentsService.duplicateDocument(invoice.id);
                  navigate(`/compta/invoices/${dup.id}`);
                } catch (e) {
                  showToast({ type: 'error', message: String(e) });
                }
              }}
              className="p-1.5 hover:bg-accent rounded-lg text-muted-foreground"
              title="Dupliquer"
            >
              <CopyPlus className="h-4 w-4" />
            </button>
            {(isSuperAdmin || isCompta) && invoice.status === 'final' && (
              <button
                onClick={() => { setAvoirReason(''); setShowAvoirModal(true); }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-violet-600 hover:bg-violet-700 text-white rounded-lg"
                title="Créer un avoir (note de crédit)"
              >
                <X className="h-3 w-3" />Avoir
              </button>
            )}
          </>
        )}
      </div>

      {/* Stats + parent link */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="glass rounded-lg p-3 text-center">
          <div className="text-base font-bold text-foreground">{fmt(isEditing ? draftTotal : invoice.totalAmount)} Dh</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Total TTC</div>
        </div>
        <div className="glass rounded-lg p-3 text-center">
          <div className="text-base font-bold text-foreground">{invoice.items.length}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Articles</div>
        </div>
        {invoice.parent_document_id && (
          <div className="glass rounded-lg p-3 text-center col-span-2">
            <div className="text-[11px] text-muted-foreground mb-0.5">Proforma source</div>
            <Link to={`/compta/proformas/${invoice.parent_document_id}`}
              className="text-sm font-mono font-semibold text-primary hover:underline">
              Voir Proforma →
            </Link>
          </div>
        )}
      </div>

      {/* Client info */}
      <div className="glass rounded-lg p-4 grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-[11px] text-muted-foreground mb-0.5">Client</p>
          {isEditing
            ? <ClientDropdown
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
            : <p className="font-medium text-foreground">{invoice.customer?.fullName || '—'}</p>}
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground mb-0.5">Téléphone</p>
          {isEditing
            ? <input value={draftCustomerPhone} onChange={e => setDraftCustomerPhone(e.target.value)} className={inputCls} placeholder="Téléphone" />
            : <p className="text-foreground">{invoice.customer?.phoneNumber || '—'}</p>}
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground mb-0.5">Ville</p>
          {isEditing
            ? <input value={draftCustomerCity} onChange={e => setDraftCustomerCity(e.target.value)} className={inputCls} placeholder="Ville" />
            : <p className="text-foreground">{invoice.customer?.city || '—'}</p>}
        </div>
      </div>

      {/* Payment info */}
      <div className="glass rounded-lg p-4 space-y-3 text-sm">
        <p className="text-xs font-semibold text-foreground">Paiement</p>

        {/* Primary payment fields */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <p className="text-[11px] text-muted-foreground mb-0.5">Date</p>
            {isEditing ? (
              <div className="relative">
                <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                <input type="date" value={draftPaymentDate} onChange={e => setDraftPaymentDate(e.target.value)}
                  className={`${inputCls} pl-6`} />
              </div>
            ) : <p className="text-foreground">{invoice.payment_date ? new Date(invoice.payment_date).toLocaleDateString('fr-FR') : '—'}</p>}
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground mb-0.5">Mode</p>
            {isEditing ? (
              <select value={draftPaymentMethod} onChange={e => setDraftPaymentMethod(e.target.value)} className={inputCls}>
                <option value="">— Sélectionner —</option>
                <option value="Virement bancaire">Virement bancaire</option>
                <option value="Chèque">Chèque</option>
                <option value="Espèces">Espèces</option>
                <option value="Carte bancaire">Carte bancaire</option>
                <option value="Effet de commerce">Effet de commerce</option>
                <option value="Versement">Versement</option>
              </select>
            ) : (
              <p className="text-foreground">{invoice.payment_method || '—'}</p>
            )}
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground mb-0.5">N° référence</p>
            {isEditing
              ? <input value={draftPaymentReference} onChange={e => setDraftPaymentReference(e.target.value)} className={inputCls} placeholder="N° chèque / virement / effet…" />
              : <p className="font-mono text-foreground">{invoice.payment_reference || '—'}</p>}
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground mb-0.5">Banque</p>
            {isEditing
              ? <input value={draftPaymentBank} onChange={e => setDraftPaymentBank(e.target.value)} className={inputCls} placeholder="Nom de la banque…" />
              : <p className="text-foreground">{invoice.payment_bank || '—'}</p>}
          </div>
        </div>

        {/* Additional payment methods — full width row */}
        {isEditing && (
          <div className="border border-border rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowExtraPayments(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 bg-secondary/50 hover:bg-secondary transition-colors text-xs font-medium text-foreground"
            >
              <span className="flex items-center gap-1.5">
                <Plus className="h-3.5 w-3.5 text-primary" />
                Règlements supplémentaires
                {draftPaymentMethods.length > 0 && (
                  <span className="px-1.5 py-0.5 bg-primary/15 text-primary rounded-full text-[10px] font-semibold">
                    {draftPaymentMethods.length}
                  </span>
                )}
              </span>
              {showExtraPayments
                ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
            </button>
            {showExtraPayments && (
              <div className="p-4 space-y-2.5">
                {draftPaymentMethods.map((pm, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_110px_32px] gap-2 items-center">
                    <select
                      value={pm.method}
                      onChange={e => setDraftPaymentMethods(prev => prev.map((p, i) => i === idx ? { ...p, method: e.target.value } : p))}
                      className={inputCls}
                    >
                      <option value="">— Mode —</option>
                      <option value="Virement bancaire">Virement</option>
                      <option value="Chèque">Chèque</option>
                      <option value="Espèces">Espèces</option>
                      <option value="Versement">Versement</option>
                      <option value="Effet de commerce">Effet</option>
                    </select>
                    <input
                      value={pm.reference || ''}
                      onChange={e => setDraftPaymentMethods(prev => prev.map((p, i) => i === idx ? { ...p, reference: e.target.value } : p))}
                      className={inputCls} placeholder="Référence"
                    />
                    <input
                      value={pm.bank || ''}
                      onChange={e => setDraftPaymentMethods(prev => prev.map((p, i) => i === idx ? { ...p, bank: e.target.value } : p))}
                      className={inputCls} placeholder="Banque"
                    />
                    <input
                      type="number"
                      value={pm.amount || ''}
                      onChange={e => setDraftPaymentMethods(prev => prev.map((p, i) => i === idx ? { ...p, amount: Number(e.target.value) } : p))}
                      className={`${inputCls} text-right`} placeholder="Montant"
                    />
                    <button
                      onClick={() => setDraftPaymentMethods(prev => prev.filter((_, i) => i !== idx))}
                      className="flex items-center justify-center w-8 h-7 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setDraftPaymentMethods(prev => [...prev, { method: '', reference: '', bank: '', amount: 0 }])}
                  className="flex items-center gap-1.5 text-xs text-primary hover:underline pt-0.5"
                >
                  <Plus className="h-3 w-3" />Ajouter un règlement
                </button>
              </div>
            )}
          </div>
        )}

        {/* Avance sur facture — full width row */}
        {isEditing && (
          <div className="border border-border rounded-xl overflow-hidden">
            <label className="w-full flex items-center justify-between px-4 py-3 bg-secondary/50 cursor-pointer hover:bg-secondary transition-colors">
              <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                <ChevronDown className="h-3.5 w-3.5 text-primary" />
                Avance sur facture
              </span>
              <input
                type="checkbox"
                checked={showAvance}
                onChange={e => setShowAvance(e.target.checked)}
                className="h-4 w-4 rounded accent-primary"
              />
            </label>
            {showAvance && (
              <div className="p-4">
                <div className="flex items-end gap-4">
                  <div className="flex-1 max-w-xs">
                    <label className="block text-[11px] text-muted-foreground mb-1">Montant avance (Dh)</label>
                    <input
                      type="number" min="0" step="0.01"
                      value={draftAvance}
                      onChange={e => setDraftAvance(Number(e.target.value))}
                      className={inputCls} placeholder="0.00"
                    />
                  </div>
                  {draftAvance > 0 && (
                    <div className="pb-0.5">
                      <div className="text-[10px] text-muted-foreground mb-0.5">Reste NET TTC</div>
                      <div className="text-base font-bold font-mono text-amber-600 dark:text-amber-400">
                        {fmt(Math.max(0, (invoice?.totalAmount ?? 0) - draftAvance - draftPaymentMethods.reduce((s, e) => s + (e.amount || 0), 0)))} Dh
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* View-mode: full payment summary */}
        {!isEditing && paymentSummary && (paymentSummary.avance > 0 || paymentSummary.entries.length > 0) && (
          <div className="border-t border-border pt-3 space-y-2">
            {paymentSummary.avance > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Avance reçue</span>
                <span className="font-mono font-semibold text-foreground">{fmt(paymentSummary.avance)} Dh</span>
              </div>
            )}
            {paymentSummary.entries.filter(e => e.amount || e.method).map((e, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-2">
                  {e.method || 'Règlement'}
                  {e.reference && <span className="font-mono text-[10px] bg-secondary px-1.5 py-0.5 rounded">{e.reference}</span>}
                  {e.bank && <span className="text-[10px] text-muted-foreground">{e.bank}</span>}
                </span>
                <span className="font-mono font-semibold text-foreground">{e.amount ? fmt(e.amount) + ' Dh' : '—'}</span>
              </div>
            ))}
            <div className="border-t border-border pt-2 flex items-center justify-between text-xs font-semibold">
              <span className="text-muted-foreground">Total payé</span>
              <span className="font-mono text-emerald-600 dark:text-emerald-400">{fmt(paymentSummary.totalPaid)} Dh</span>
            </div>
            <div className="flex items-center justify-between text-sm font-bold">
              <span className="text-muted-foreground">{paymentSummary.reste <= 0 ? 'Facture soldée ✓' : 'Reste à payer'}</span>
              <span className={`font-mono ${paymentSummary.reste <= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {paymentSummary.reste <= 0 ? '0,00 Dh' : fmt(paymentSummary.reste) + ' Dh'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Items table */}
      <div className="glass rounded-xl shadow-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Articles ({isEditing ? draftItems.length : invoice.items.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-secondary">
              <tr>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase w-8">#</th>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Produit</th>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Marque</th>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Réf</th>
                <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground uppercase">Qté</th>
                <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground uppercase">PU HT</th>
                <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground uppercase">Total HT</th>
                {isEditing && <th className="px-3 py-2 w-8" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(isEditing ? draftItems : invoice.items).map((item, idx) => {
                const unitHT = item.unitPrice / (1 + tvaRate / 100);
                const totalHT = unitHT * item.quantity;
                return (
                  <tr key={item.id} className="hover:bg-accent/50">
                    <td className="px-3 py-2 text-[10px] text-muted-foreground">{idx + 1}</td>
                    {isEditing ? (
                      <>
                        <td className="px-2 py-1.5"><input value={item.quoteName || ''} onChange={e => updateDraftItem(idx, 'quoteName', e.target.value)} className={inputCls} placeholder="Désignation" /></td>
                        <td className="px-2 py-1.5"><input value={item.quoteBrand || ''} onChange={e => updateDraftItem(idx, 'quoteBrand', e.target.value)} className={inputCls} placeholder="Marque" /></td>
                        <td className="px-2 py-1.5"><input value={item.quoteBarcode || ''} onChange={e => updateDraftItem(idx, 'quoteBarcode', e.target.value)} className={inputCls} placeholder="Référence" /></td>
                        <td className="px-2 py-1.5"><input type="number" min="1" value={item.quantity} onChange={e => updateDraftItem(idx, 'quantity', Math.max(1, Number(e.target.value)))} className={`${inputCls} text-right w-20`} /></td>
                        <td className="px-2 py-1.5"><input type="number" min="0" step="0.01" value={item.unitPrice} onChange={e => updateDraftItem(idx, 'unitPrice', Number(e.target.value))} className={`${inputCls} text-right w-24`} /></td>
                        <td className="px-3 py-2 text-right text-xs font-mono text-muted-foreground">{fmt(item.subtotal / (1 + tvaRate / 100))} Dh</td>
                        <td className="px-2 py-1.5 text-center">
                          <button onClick={() => removeDraftItem(idx)} className="p-1 text-destructive hover:bg-destructive/10 rounded">
                            <X className="h-3 w-3" />
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2.5 text-xs text-foreground">{item.quoteName || item.product?.name || '—'}</td>
                        <td className="px-3 py-2.5 text-[10px] text-muted-foreground">{item.quoteBrand || item.product?.brand || '—'}</td>
                        <td className="px-3 py-2.5 text-[10px] font-mono text-muted-foreground">{item.quoteBarcode || item.product?.barcode || '—'}</td>
                        <td className="px-3 py-2.5 text-right text-xs font-bold text-foreground">{item.quantity}</td>
                        <td className="px-3 py-2.5 text-right text-xs font-mono text-foreground">{fmt(unitHT)} Dh</td>
                        <td className="px-3 py-2.5 text-right text-xs font-mono font-bold text-foreground">{fmt(totalHT)} Dh</td>
                      </>
                    )}
                  </tr>
                );
              })}
              {isEditing && (
                <tr>
                  <td colSpan={8} className="px-3 py-2">
                    <div className="flex items-center gap-3">
                      <button onClick={addBlankItem} className="flex items-center space-x-1.5 text-xs text-primary hover:underline">
                        <Plus className="h-3.5 w-3.5" /><span>Ligne vide</span>
                      </button>
                      <button onClick={() => setShowProductSearch(true)} className="flex items-center space-x-1.5 text-xs text-primary hover:underline">
                        <SearchIcon className="h-3.5 w-3.5" /><span>Chercher produit</span>
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
            {!isEditing && invoice.items.length > 0 && (
              <tfoot className="bg-secondary">
                <tr>
                  <td colSpan={5} className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">Total HT</td>
                  <td className="px-3 py-2 text-right text-xs font-mono font-bold text-foreground">
                    {fmt(invoice.items.reduce((s, i) => s + (i.unitPrice / (1 + tvaRate / 100)) * i.quantity, 0))} Dh
                  </td>
                  <td />
                </tr>
                <tr>
                  <td colSpan={5} className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">Total TTC</td>
                  <td className="px-3 py-2 text-right text-sm font-mono font-bold text-foreground">{fmt(invoice.totalAmount)} Dh</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Notes */}
      {isEditing ? (
        <div className="glass rounded-lg p-3 space-y-2">
          <p className="text-[11px] text-muted-foreground">Notes</p>
          <textarea value={draftNotes} onChange={e => setDraftNotes(e.target.value)}
            rows={2} placeholder="Note client (visible sur le PDF)..."
            className="w-full px-2 py-1.5 text-sm border border-input rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
          <div className="relative">
            <hr className="border-border mb-2" />
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">Note interne</p>
            <textarea value={draftNotes2} onChange={e => setDraftNotes2(e.target.value)}
              rows={2} placeholder="Note interne (non visible sur le PDF)..."
              className="w-full px-2 py-1.5 text-sm border border-input rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
          </div>
        </div>
      ) : (invoice.notes || invoice.notes2) ? (
        <div className="glass rounded-lg p-3 space-y-2">
          {invoice.notes && <p className="text-sm text-muted-foreground italic">{invoice.notes}</p>}
          {invoice.notes && invoice.notes2 && <hr className="border-border" />}
          {invoice.notes2 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-0.5">Note interne</p>
              <p className="text-sm text-muted-foreground italic">{invoice.notes2}</p>
            </div>
          )}
        </div>
      ) : null}

      {/* Lock overlay */}
      {invoice.is_locked && (
        <div className="glass rounded-lg p-3 flex items-center gap-2 bg-amber-500/10 border border-amber-500/30">
          <span className="text-base leading-none">🔒</span>
          <span className="text-sm text-amber-300">Facture verrouillée — cliquez sur le cadenas pour déverrouiller</span>
        </div>
      )}

      {/* WhatsApp Modal */}
      {showWaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="glass rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />Envoyer sur WhatsApp
              </h2>
              <button onClick={() => setShowWaModal(false)} className="p-1 hover:bg-accent rounded-lg"><X className="h-4 w-4" /></button>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Numéro de téléphone</label>
              <input
                type="tel"
                value={waPhone}
                onChange={e => setWaPhone(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring"
                placeholder="Ex: 0661234567"
                autoFocus
              />
              <div className="mt-2 space-y-1.5">
                {invoice.customer?.salesPerson && (
                  <div className="flex items-center justify-between text-[11px] py-1.5 px-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                    <span className="text-muted-foreground">
                      Commercial : <span className="text-foreground font-medium">{invoice.customer.salesPerson}</span>
                    </span>
                    {agentPhoneLoading ? (
                      <span className="text-muted-foreground italic">chargement…</span>
                    ) : agentPhone ? (
                      <button onClick={() => setWaPhone(agentPhone)} className="text-emerald-500 font-medium hover:underline">
                        {agentPhone}
                      </button>
                    ) : (
                      <span className="text-muted-foreground italic">non configuré</span>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="flex space-x-2">
              <button onClick={() => setShowWaModal(false)} className="flex-1 px-3 py-1.5 text-sm border border-input rounded-lg hover:bg-accent text-foreground">Annuler</button>
              <button
                onClick={() => { setShowWaModal(false); handleWhatsAppShare(waPhone); }}
                disabled={!waPhone.trim()}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg"
              >
                <MessageCircle className="h-3.5 w-3.5" />Envoyer
              </button>
            </div>
          </div>
        </div>
      )}

      {showProductSearch && (
        <ProductSearchModal onSelect={p => { addFromProduct(p); setShowProductSearch(false); }} onClose={() => setShowProductSearch(false)} />
      )}

      {showPrintPreview && previewBlob && (
        <PrintPreviewModal blob={previewBlob} filename={previewFilename} onClose={() => { setShowPrintPreview(false); setPreviewBlob(null); }} />
      )}

      {/* PIN Modal */}
      {showPinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="glass rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <Lock className="h-4 w-4" />Déverrouiller la facture
              </h2>
              <button onClick={() => setShowPinModal(false)} className="p-1 hover:bg-accent rounded-lg"><X className="h-4 w-4" /></button>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">PIN spécial</label>
              <input
                type="password"
                value={pinInput}
                onChange={e => setPinInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && confirmUnlock()}
                className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring"
                placeholder="Entrez le PIN"
                autoFocus
              />
            </div>
            <div className="flex space-x-2">
              <button onClick={() => setShowPinModal(false)} className="flex-1 px-3 py-1.5 text-sm border border-input rounded-lg hover:bg-accent text-foreground">Annuler</button>
              <button onClick={confirmUnlock} className="flex-1 px-3 py-1.5 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded-lg">Déverrouiller</button>
            </div>
          </div>
        </div>
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

      {/* Avoir modal */}
      {showAvoirModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <X className="h-4 w-4 text-violet-500" />Créer un avoir
              </h2>
              <button onClick={() => setShowAvoirModal(false)} className="p-1 rounded hover:bg-secondary text-muted-foreground"><X className="h-4 w-4" /></button>
            </div>
            <p className="text-xs text-muted-foreground">Un avoir sera créé pour la facture <span className="font-mono font-semibold text-foreground">{invoice.quoteNumber}</span>.</p>
            <div>
              <label className="text-[11px] text-muted-foreground block mb-1">Motif de l'avoir</label>
              <textarea
                value={avoirReason}
                onChange={e => setAvoirReason(e.target.value)}
                placeholder="Ex: Retour marchandise, erreur de facturation..."
                rows={3}
                className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring resize-none"
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowAvoirModal(false)} className="flex-1 px-3 py-2 text-sm border border-border rounded-lg text-muted-foreground hover:bg-secondary">Annuler</button>
              <button
                onClick={async () => {
                  setAvoirLoading(true);
                  try {
                    const avoir = await SupabaseDocumentsService.createAvoirFromInvoice(invoice.id, avoirReason);
                    setShowAvoirModal(false);
                    navigate(`/compta/avoirs/${avoir.id}`);
                  } catch (e: any) {
                    showToast({ type: 'error', message: e?.message || 'Erreur création avoir' });
                  } finally {
                    setAvoirLoading(false);
                  }
                }}
                disabled={avoirLoading}
                className="flex-1 px-3 py-2 text-sm bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg"
              >
                {avoirLoading ? 'Création...' : 'Créer l\'avoir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
