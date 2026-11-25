import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Download, Loader, Pencil, Check, X, Plus, Calendar, Lock, Unlock, ChevronDown, ChevronUp, ChevronRight, MessageCircle, CopyPlus, Search as SearchIcon, Mail, Printer, CheckCircle, Clock, AlertCircle, Trash2, Undo2, Wallet } from 'lucide-react';
import { Quote, QuoteItem, PaymentEntry, Product } from '../../types';
import { SupabaseDocumentsService, POSTED_INVOICE_MESSAGE } from '../../utils/supabaseDocuments';
import { SupabaseClientsService } from '../../utils/supabaseClients';
import { iceError, normalizeIce } from '../../utils/legalIds';
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
import { formatMoney } from '../../utils/format';
import {
  addDays, cashLimitWarning, cashStampDuty, daysBetween, defaultWithholding, discountRate, documentDay, documentTvaRate, dueDateError, formatDay,
  invoiceDueDay, invoiceOverdue, invoicePayment, invoiceSettlements, invoiceVat, isCashMethod, isProvisionalNumber, isWithholding, localDay,
  newPaymentEntry, paymentEntryError, recomputeLine, taxAttestationStatus, toHT, toTTC, unitPriceHTInput, documentTotal, MAX_PAYMENT_DAYS,
  WITHHOLDING_METHOD, WITHHOLDING_RATES,
} from '../../utils/documentLines';

/** "facture CM2611-4", or "facture (brouillon)" for a draft without a number. */
const shareName = (q: Quote) => (isProvisionalNumber(q.quoteNumber) ? 'facture (brouillon)' : `facture ${q.quoteNumber}`);

const PAYMENT_MODES: Array<[string, string]> = [
  ['Virement bancaire', 'Virement'], ['Chèque', 'Chèque'], ['Espèces', 'Espèces'], ['Carte bancaire', 'Carte'],
  ['Versement', 'Versement bancaire'], ['Effet de commerce', 'Effet'],
];

const inputCls = 'w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring';
const fieldCls = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

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
  // Booked in the accounts (validated journal entry): number, date, customer
  // and lines are fixed; payments and the due date can still be entered.
  const [isPosted, setIsPosted] = useState(false);
  // Private person per the client record, when the invoice does not say.
  const [clientIsIndividual, setClientIsIndividual] = useState<boolean | null>(null);
  const [iceInput, setIceInput] = useState('');
  const [iceSaving, setIceSaving] = useState(false);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [draftNumber, setDraftNumber] = useState('');
  const [draftDate, setDraftDate] = useState('');
  const [draftCustomerName, setDraftCustomerName] = useState('');
  const [draftCustomerPhone, setDraftCustomerPhone] = useState('');
  const [draftCustomerCity, setDraftCustomerCity] = useState('');
  const [draftCustomerAddress, setDraftCustomerAddress] = useState('');
  const [draftCustomerIce, setDraftCustomerIce] = useState('');
  const [draftIsIndividual, setDraftIsIndividual] = useState(false);
  const [draftDueDate, setDraftDueDate] = useState('');
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
  const [avoirLeft, setAvoirLeft] = useState<Record<string, number> | null>(null);
  const [avoirQty, setAvoirQty] = useState<Record<string, number>>({});

  // Settled = money received + VAT withheld by the client; each settlement at its own date.
  const paymentSummary = useMemo(() => {
    if (!invoice) return null;
    const p = invoicePayment(invoice);
    return { ...p, totalPaid: p.paid, settlements: invoiceSettlements(invoice) };
  }, [invoice]);

  // Stamp duty on cash settlements, when the issuing company opted in.
  const stampDutyOn = !!companySettings?.cash_stamp_duty;
  // A cash advance entered or changed now bears the duty; one recorded
  // before (maybe before the setting was on) is left as it was.
  const avanceTakesStamp = stampDutyOn && showAvance && draftAvance > 0 && isCashMethod(draftPaymentMethod) && !!invoice
    && (draftAvance !== (invoice.avance_amount || 0) || draftPaymentMethod !== (invoice.payment_method || ''));
  const finaliseConfirmText = (day: string) =>
    `Finaliser la facture ? Elle prend maintenant le prochain numéro de la série de ${day.slice(5, 7)}/${day.slice(0, 4)} et ne pourra plus revenir en brouillon (pour l’annuler : un avoir).`;

  const load = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      const doc = await SupabaseDocumentsService.getById(id);
      setInvoice(doc);
      setIsPosted(doc ? await SupabaseDocumentsService.isPosted(doc.id).catch(() => false) : false);
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

  // Whether the client is a private person (no ICE expected), from the
  // client record when the invoice does not say so itself.
  useEffect(() => {
    const phone = invoice?.customer?.phoneNumber?.trim();
    if (!invoice || invoice.customer?.isIndividual !== undefined || !phone) { setClientIsIndividual(null); return; }
    let cancelled = false;
    SupabaseClientsService.getClientByPhone(phone)
      .then(c => { if (!cancelled) setClientIsIndividual(c?.is_individual ?? null); })
      .catch(() => { /* the warning then relies on the invoice alone */ });
    return () => { cancelled = true; };
  }, [invoice]);

  // Devis → BL → Facture → Payé: follow the links the invoice already has
  // (invoice → proforma → its BLs → their quote). Read only, for display.
  const [chain, setChain] = useState<{ quote?: { id: string; number: string }; bls: Array<{ id: string; number: string }>; proforma?: { id: string; number: string } } | null>(null);
  useEffect(() => {
    if (!invoice) return;
    let cancelled = false;
    (async () => {
      const out: { quote?: { id: string; number: string }; bls: Array<{ id: string; number: string }>; proforma?: { id: string; number: string } } = { bls: [] };
      try {
        const proforma = invoice.parent_document_id ? await SupabaseDocumentsService.getById(invoice.parent_document_id) : null;
        if (proforma) out.proforma = { id: proforma.id, number: proforma.quoteNumber };
        const blIds = [...(invoice.source_bl_ids || []), ...(proforma?.source_bl_ids || [])];
        const bls = (await Promise.all([...new Set(blIds)].map(blId => SupabaseDocumentsService.getById(blId).catch(() => null)))).filter((b): b is Quote => !!b);
        out.bls = bls.map(b => ({ id: b.id, number: b.quoteNumber }));
        const quoteId = bls.find(b => b.parent_document_id)?.parent_document_id;
        const quote = quoteId ? await SupabaseDocumentsService.getById(quoteId).catch(() => null) : null;
        if (quote) out.quote = { id: quote.id, number: quote.quoteNumber };
      } catch { /* the line then shows the links as unknown */ }
      if (!cancelled) setChain(out);
    })();
    return () => { cancelled = true; };
  }, [invoice]);

  // Auto-enter edit mode for freshly created documents
  useEffect(() => {
    if (searchParams.get('new') === '1' && invoice && !isEditing) startEdit();
  }, [invoice, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const startEdit = () => {
    if (!invoice) return;
    setDraftNumber(invoice.quoteNumber);
    setDraftDate(invoice.quote_date || localDay(new Date(invoice.createdAt)));
    setDraftCustomerName(invoice.customer?.fullName || '');
    setDraftCustomerPhone(invoice.customer?.phoneNumber || '');
    setDraftCustomerCity(invoice.customer?.city || '');
    setDraftCustomerAddress(invoice.customer?.address || '');
    setDraftCustomerIce(invoice.customer?.ice || '');
    setDraftIsIndividual(!!(invoice.customer?.isIndividual ?? clientIsIndividual));
    setDraftDueDate(invoiceDueDay(invoice));
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
    // A wrong ICE or due date is never saved; the automatic save waits for a fix.
    const invoiceDay = draftDate || documentDay(invoice);
    const problem = iceError(draftCustomerIce) || (draftDueDate ? dueDateError(invoiceDay, draftDueDate) : null)
      || draftPaymentMethods.map(e => paymentEntryError(e, invoiceDay)).find(Boolean) || null;
    if (problem) {
      if (!isAutoSave) showToast({ type: 'error', message: problem });
      return;
    }
    // Finalising takes the next number of the series and cannot be undone:
    // never on an automatic save, and only once confirmed.
    const finalising = invoice.status === 'draft' && draftStatus !== 'draft' && !isAutoSave;
    if (finalising && !window.confirm(finaliseConfirmText(invoiceDay))) return;
    const sentStatus = invoice.status === 'draft' && !finalising ? invoice.status : draftStatus;
    // A cash advance cannot carry its stamp duty: with the duty on, it is
    // saved as the first dated settlement instead (same order, same amount).
    let avanceAmount = showAvance ? draftAvance : 0;
    let entries = draftPaymentMethods;
    if (avanceTakesStamp) {
      entries = [newPaymentEntry({
        method: draftPaymentMethod, reference: draftPaymentReference, bank: draftPaymentBank, amount: avanceAmount,
        date: draftPaymentDate || invoiceDay, stamp_duty: cashStampDuty(avanceAmount), advance: !!draftPaymentDate && draftPaymentDate < invoiceDay,
      }), ...entries];
      avanceAmount = 0;
    }
    const paymentUpdates = {
      notes: draftNotes.trim() || null,
      notes2: draftNotes2.trim() || null,
      payment_date: draftPaymentDate || null,
      payment_method: draftPaymentMethod || null,
      payment_reference: draftPaymentReference || null,
      payment_bank: draftPaymentBank || null,
      avance_amount: avanceAmount,
      payment_methods_json: entries.length > 0 ? entries : [],
      due_date: draftDueDate || null,
      // Settled so far (money received + VAT withheld), for the client balance and accounting.
      paid_amount: invoicePayment({
        totalAmount: isPosted ? invoice.totalAmount : documentTotal(draftItems),
        avance_amount: avanceAmount,
        payment_methods_json: entries,
      }).paid,
    };
    // Only the buyer's ICE, address and status may be completed on a booked
    // invoice: the rest of the customer stays as it was invoiced.
    const filledCustomer = { ...invoice.customer, address: draftCustomerAddress.trim(), ice: normalizeIce(draftCustomerIce), isIndividual: draftIsIndividual };
    setIsSaving(true);
    try {
      const saved = await SupabaseDocumentsService.updateDocument(invoice.id, isPosted ? { ...paymentUpdates, customer: filledCustomer } : {
        ...paymentUpdates,
        // The number of an issued invoice is fixed; a draft's is sent only when typed.
        ...(invoice.status === 'draft' && draftNumber.trim() !== invoice.quoteNumber ? { quoteNumber: draftNumber.trim() } : {}),
        customer: { ...filledCustomer, fullName: draftCustomerName, phoneNumber: draftCustomerPhone, city: draftCustomerCity },
        items: draftItems,
        status: sentStatus,
        quote_date: draftDate || null,
      });
      // The number may follow a new month; later saves start from the stored row.
      setInvoice(prev => prev ? { ...prev, ...saved } : saved);
      setDraftNumber(saved.quoteNumber);
      if (entries !== draftPaymentMethods) { setDraftPaymentMethods(entries); setDraftAvance(0); setShowAvance(false); }
      if (!isAutoSave) {
        showToast(finalising && saved.status !== 'draft'
          ? { type: 'success', title: 'Facture finalisée', message: `Numéro attribué : ${saved.quoteNumber}` }
          : { type: 'success', title: 'Facture mise à jour', message: 'Modifications sauvegardées' });
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
      const updated = { ...item, [field]: value } as QuoteItem;
      return field === 'quantity' || field === 'unitPrice' || field === 'discount' ? recomputeLine(updated) : updated;
    }));
  };

  const removeDraftItem = (idx: number) => setDraftItems(prev => prev.filter((_, i) => i !== idx));

  // The due date keeps its delay when the invoice date moves.
  const changeDraftDate = (day: string) => {
    if (day && draftDate && draftDueDate) setDraftDueDate(addDays(day, daysBetween(draftDate, draftDueDate)));
    setDraftDate(day);
  };

  /**
   * The buyer's ICE entered from the warning: saved on the invoice (allowed
   * even once booked) and on the client record, so the next invoices have it.
   */
  const saveCustomerIce = async (individual: boolean) => {
    if (!invoice) return;
    const ice = normalizeIce(iceInput);
    const problem = individual ? null : (iceError(ice) || (!ice ? 'Saisissez l’ICE du client (15 chiffres).' : null));
    if (problem) { showToast({ type: 'error', message: problem }); return; }
    setIceSaving(true);
    try {
      await SupabaseDocumentsService.updateDocument(invoice.id, {
        customer: individual ? { ...invoice.customer, isIndividual: true } : { ...invoice.customer, ice, isIndividual: false },
      });
      const phone = invoice.customer?.phoneNumber?.trim();
      const client = phone ? await SupabaseClientsService.getClientByPhone(phone).catch(() => null) : null;
      if (client) {
        await SupabaseClientsService.updateClient(client.id, individual ? { is_individual: true } : { ice }).catch(() => {
          showToast({ type: 'warning', message: 'Facture mise à jour, mais la fiche client n’a pas pu l’être.' });
        });
      }
      showToast({ type: 'success', message: individual ? 'Client marqué comme particulier' : 'ICE du client enregistré' });
      setIceInput('');
      await load();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setIceSaving(false);
    }
  };

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

  /** Issue the draft: it takes the next number of its month's series (CGI art. 145-III). */
  const handleFinalize = async () => {
    if (!invoice) return;
    if (!window.confirm(finaliseConfirmText(documentDay(invoice)))) return;
    setIsSaving(true);
    try {
      const saved = await SupabaseDocumentsService.finalizeInvoice(invoice.id);
      showToast({ type: 'success', title: 'Facture finalisée', message: `Numéro attribué : ${saved.quoteNumber}` });
      await load();
    } catch (e) {
      showToast({ type: 'error', title: 'Finalisation impossible', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setIsSaving(false);
    }
  };

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
      await PdfExportService.exportQuoteToPdf(invoice, freshSettings, undefined, undefined, useStamp, 'invoice', undefined, false);
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
      await PdfExportService.exportQuoteToPdf(invoice, freshSettings, undefined, undefined, useStamp, 'invoice', undefined, false);
    } catch { /* continue even if PDF fails */ }

    const company = companySettings?.company_name?.trim() || '';
    const msg = `Bonjour ${invoice.customer?.fullName || ''},\nVeuillez trouver ci-joint votre ${shareName(invoice)} d'un montant de ${formatMoney(invoice.totalAmount)}.${company ? `\n\nCordialement,\n${company}` : ''}`;
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

  const handlePreview = async () => {
    if (!invoice) return;
    // Same letterhead as the downloaded PDF: the issuing company.
    const freshSettings = await CompanySettingsService.getSettings(invoice.issuing_company_id || invoice.company_id || undefined);
    const { blob, filename } = await PdfExportService.generatePdfBlob(invoice, freshSettings, undefined, undefined, useStamp, 'invoice', undefined, false);
    setPreviewBlob(blob);
    setPreviewFilename(filename);
    setShowPrintPreview(true);
  };

  const openWhatsAppModal = async () => {
    if (!invoice) return;
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
  };

  const handleEmail = () => {
    if (!invoice) return;
    const subject = encodeURIComponent(shareName(invoice).replace(/^f/, 'F'));
    const body = encodeURIComponent(
      `Bonjour ${invoice.customer?.fullName || ''},\n\nVeuillez trouver ci-joint votre ${shareName(invoice)} d'un montant de ${formatMoney(invoice.totalAmount)}.\n\nCordialement,\n${companySettings?.company_name || ''}`
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const handleDuplicate = async () => {
    if (!invoice) return;
    if (!window.confirm('Dupliquer cette facture ?')) return;
    try {
      const dup = await SupabaseDocumentsService.duplicateDocument(invoice.id);
      navigate(`/compta/invoices/${dup.id}`);
    } catch (e) {
      showToast({ type: 'error', message: String(e) });
    }
  };

  const openAvoirModal = async () => {
    if (!invoice) return;
    setAvoirReason('');
    setAvoirLeft(null);
    setShowAvoirModal(true);
    try {
      const left = SupabaseDocumentsService.creditableQuantities(invoice, await SupabaseDocumentsService.getAvoirsForInvoice(invoice.id));
      setAvoirLeft(left);
      setAvoirQty(left);
    } catch (e) {
      setShowAvoirModal(false);
      showToast({ type: 'error', message: String(e) });
    }
  };

  /** Payments are entered in the invoice's edit mode: open it on a new règlement line. */
  const handleRecordPayment = () => {
    if (!invoice) return;
    if (invoice.is_locked) { handleUnlock(); return; }
    startEdit();
    setShowExtraPayments(true);
    setDraftPaymentMethods(prev => [...prev, newPaymentEntry({ amount: paymentSummary?.reste || 0 })]);
    setTimeout(() => document.getElementById('invoice-payment')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), 50);
  };

  /**
   * The client paid without the VAT and withheld it (CGI art. 117-IV): a
   * settlement that is not money received. Defaults to the VAT still not
   * withheld, capped by what is left to pay.
   */
  const withholdingEntry = (base: Pick<Quote, 'totalAmount' | 'avance_amount' | 'payment_methods_json'>, share = 100) => newPaymentEntry({
    kind: 'vat_withholding', method: WITHHOLDING_METHOD, withholding_rate: share,
    amount: defaultWithholding({ ...base, tva_rate: invoice?.tva_rate }, companySettings?.tva_rate, share),
  });
  const handleRecordWithholding = () => {
    if (!invoice) return;
    if (invoice.is_locked) { handleUnlock(); return; }
    startEdit();
    setShowExtraPayments(true);
    setDraftPaymentMethods(prev => [...prev, withholdingEntry(invoice)]);
    setTimeout(() => document.getElementById('invoice-payment')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), 50);
  };

  /** Change one payment line; a cash line gets its stamp duty (frozen) when the company applies it. */
  const updatePaymentEntry = (idx: number, patch: Partial<PaymentEntry>) => setDraftPaymentMethods(prev => prev.map((p, i) => {
    if (i !== idx) return p;
    const next: PaymentEntry = { ...p, ...patch };
    if (isWithholding(next)) return next;
    if ('method' in patch || 'amount' in patch) {
      if (stampDutyOn && isCashMethod(next.method) && (Number(next.amount) || 0) > 0) next.stamp_duty = cashStampDuty(Number(next.amount));
      else delete next.stamp_duty;
    }
    return next;
  }));

  if (!isSuperAdmin && !isCompta) return <div className="text-center py-12 text-muted-foreground">Accès réservé au rôle Comptabilité.</div>;
  if (isLoading) return <div className="flex items-center justify-center min-h-[40vh]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!invoice) return <div className="text-center py-12 text-muted-foreground">Facture introuvable.</div>;

  // The rate frozen on the invoice, not the company's current one.
  const tvaRate = documentTvaRate(invoice, companySettings?.tva_rate);
  const draftTotal = documentTotal(draftItems);
  // Lines invoiced from a proforma stay as billed there; corrections go through an avoir.
  // A booked invoice keeps its lines too.
  const linesLocked = !!invoice.parent_document_id || isPosted;
  const numberFixed = invoice.status !== 'draft';
  const overdue = invoiceOverdue(invoice);
  const dueDay = invoiceDueDay(invoice);
  const isIndividual = !!(invoice.customer?.isIndividual ?? clientIsIndividual);
  // Art. 145 CGI: the buyer's ICE on invoices to businesses (100 DH fine per omission).
  const missingClientIce = !!invoice.customer?.fullName?.trim() && !normalizeIce(invoice.customer?.ice) && !isIndividual;
  const shownItems = isEditing ? draftItems : invoice.items;
  const showDiscount = isEditing ? !linesLocked : shownItems.some(i => discountRate(i) > 0);

  const shownTotal = isEditing ? draftTotal : invoice.totalAmount;
  const shownHT = toHT(shownTotal, tvaRate);
  // While editing, the card follows the payments being typed.
  const draftView = { totalAmount: shownTotal, avance_amount: showAvance ? draftAvance : 0, payment_methods_json: draftPaymentMethods, payment_method: draftPaymentMethod };
  const draftSummary = invoicePayment(draftView);
  const shownSummary = isEditing ? draftSummary : invoicePayment(invoice);
  const paidNow = shownSummary.paid;
  const resteNow = Math.max(0, Math.round((shownTotal - paidNow) * 100) / 100);
  // Art. 193: cash on a sale of 20,000 DH or more (warning only).
  const cashWarning = cashLimitWarning(shownTotal, shownSummary.cash);
  const invoiceDayNow = isEditing && draftDate ? draftDate : documentDay(invoice);
  const provisional = isProvisionalNumber(invoice.quoteNumber);
  const isDraft = invoice.status === 'draft';
  const shownNumber = provisional ? 'Brouillon' : invoice.quoteNumber;
  // Art. 117-IV: without a recent attestation, VAT-registered clients withhold the VAT.
  const attestation = companySettings?.payment_settings_available ? taxAttestationStatus(companySettings.tax_attestation_date) : null;
  const showAttestation = !!attestation && attestation.state !== 'valid' && tvaRate > 0 && !isIndividual;
  const isPaid = paymentSummary?.status === 'paid';
  const invoiceDate = invoice.quote_date ? new Date(invoice.quote_date).toLocaleDateString('fr-FR') : new Date(invoice.createdAt).toLocaleDateString('fr-FR');
  const panel = 'rounded-xl border border-border bg-card shadow-sm';
  const paymentPill = !paymentSummary ? null
    : paymentSummary.status === 'paid' ? { label: 'Soldée', cls: 'bg-emerald-500/10 text-emerald-700 ring-emerald-600/20 dark:text-emerald-300', Icon: CheckCircle }
    : paymentSummary.status === 'partial' ? { label: 'Paiement partiel', cls: 'bg-amber-500/10 text-amber-800 ring-amber-600/20 dark:text-amber-300', Icon: Clock }
    : invoice.status === 'final' ? { label: 'Non payée', cls: 'bg-red-500/10 text-red-700 ring-red-600/20 dark:text-red-300', Icon: AlertCircle }
    : null;
  // The invoice's own payment mention (mode, reference, bank), when no advance carries it.
  const primaryPayment = (invoice.avance_amount || 0) > 0 ? [] : [invoice.payment_method, invoice.payment_reference, invoice.payment_bank, invoice.payment_date ? formatDay(invoice.payment_date.slice(0, 10)) : ''].filter(Boolean);

  const steps: Array<{ label: string; detail: string; state: 'done' | 'current' | 'todo'; to?: string }> = [
    chain?.quote
      ? { label: 'Devis', detail: chain.quote.number, state: 'done', to: `/quote-cart/${chain.quote.id}` }
      : { label: 'Devis', detail: chain ? 'non lié' : '…', state: 'todo' },
    chain && chain.bls.length > 0
      ? { label: 'BL', detail: chain.bls[0].number + (chain.bls.length > 1 ? ` +${chain.bls.length - 1}` : ''), state: 'done', to: `/compta/bls/${chain.bls[0].id}` }
      : { label: 'BL', detail: chain ? 'non lié' : '…', state: 'todo' },
    { label: 'Facture', detail: invoice.status === 'final' ? 'Finalisée' : 'Brouillon', state: invoice.status === 'final' ? 'done' : 'current' },
    { label: 'Payé', detail: isPaid ? 'Soldée' : paymentSummary?.status === 'partial' ? 'Partiel' : 'En attente', state: isPaid ? 'done' : invoice.status === 'final' ? 'current' : 'todo' },
  ];

  const toggleOption = (checked: boolean, onChange: (value: boolean) => void, title: string, hint: string) => (
    <label className="relative flex cursor-pointer items-center gap-3 py-2">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="peer sr-only" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <span aria-hidden="true" className={`relative h-5 w-9 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring ${checked ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[1.125rem]' : 'left-0.5'}`} />
      </span>
    </label>
  );
  const sideAction = 'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-foreground hover:bg-secondary disabled:opacity-50';

  return (
    <div className="mx-auto max-w-[110rem] pb-28 md:pb-0">
      {/* Title */}
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0">
          <nav aria-label="Fil d’Ariane" className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex">
            <Link to="/compta/invoices" className="hover:text-foreground">Factures</Link>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-foreground">{shownNumber}</span>
          </nav>
          {isEditing ? (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="invoice-number">Numéro de facture</label>
              {/* Continuous numbering: an issued invoice keeps its number; a draft gets one when finalised. */}
              <input id="invoice-number" value={provisional ? '' : draftNumber} onChange={e => setDraftNumber(e.target.value)}
                disabled={numberFixed || provisional} placeholder={provisional ? 'N° à la finalisation' : undefined}
                title={numberFixed ? 'Le numéro d’une facture finalisée ne change plus' : provisional ? 'Le numéro est attribué quand la facture est finalisée' : undefined}
                className="w-48 rounded-lg border border-input bg-background px-2.5 py-1.5 text-lg font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-70" />
              <label className="sr-only" htmlFor="invoice-date">Date de la facture</label>
              <input id="invoice-date" type="date" value={draftDate} onChange={e => changeDraftDate(e.target.value)} disabled={isPosted}
                className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-70" />
              <label htmlFor="invoice-due" className="text-xs text-muted-foreground">Échéance</label>
              <input id="invoice-due" type="date" value={draftDueDate} onChange={e => setDraftDueDate(e.target.value)}
                min={draftDate || undefined} max={draftDate ? addDays(draftDate, MAX_PAYMENT_DAYS) : undefined}
                className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
              {draftDate && draftDueDate && dueDateError(draftDate, draftDueDate) && (
                <p className="w-full text-xs text-destructive">{dueDateError(draftDate, draftDueDate)}</p>
              )}
            </div>
          ) : (
            <>
              <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{provisional ? 'Facture brouillon' : `Facture ${invoice.quoteNumber}`}</h1>
              {provisional && (
                <p className="text-xs text-muted-foreground">Réf. provisoire {invoice.quoteNumber} · le numéro est attribué à la finalisation</p>
              )}
            </>
          )}
        </div>
        {isEditing ? (
          <select value={draftStatus} onChange={e => setDraftStatus(e.target.value)} aria-label="Statut de la facture"
            disabled={numberFixed}
            className="rounded-full border-0 bg-secondary py-1 pl-3 pr-8 text-xs font-semibold text-foreground ring-1 ring-inset ring-border">
            {/* An issued invoice does not go back to draft: it is cancelled by a credit note. */}
            {!numberFixed && <option value="draft">Brouillon</option>}
            <option value="final">Finalisé</option>
            {draftStatus !== 'draft' && draftStatus !== 'final' && <option value={draftStatus}>{draftStatus}</option>}
          </select>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${invoice.status === 'final' ? 'bg-blue-500/10 text-blue-700 ring-blue-600/20 dark:text-blue-300' : 'bg-secondary text-muted-foreground ring-border'}`}>
              {invoice.status === 'final' ? 'Finalisée' : 'Brouillon'}
            </span>
            {paymentPill && (
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${paymentPill.cls}`}>
                <paymentPill.Icon className="h-3.5 w-3.5" aria-hidden="true" />{paymentPill.label}
              </span>
            )}
            {overdue.overdue && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-600/20 dark:text-red-300">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />En retard · {overdue.days} j
              </span>
            )}
            {isPosted && (
              <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-foreground ring-1 ring-inset ring-border">
                <Check className="h-3.5 w-3.5" aria-hidden="true" />Comptabilisée
              </span>
            )}
            {invoice.is_locked && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-600/20 dark:text-amber-300">
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />Verrouillée
              </span>
            )}
          </div>
        )}
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          {invoice.is_locked && !isEditing && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
              <Lock className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
              <p className="min-w-0 flex-1 text-sm text-amber-900 dark:text-amber-200">Facture verrouillée : déverrouillez-la avec le PIN pour la modifier ou enregistrer un paiement.</p>
              <button type="button" onClick={handleUnlock} className="rounded-lg border border-amber-600/30 bg-card px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-secondary">Déverrouiller</button>
            </div>
          )}

          {isPosted && (
            <div className="flex items-start gap-3 rounded-xl border border-border bg-secondary/50 px-4 py-3">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <p className="min-w-0 flex-1 text-sm text-foreground">
                {POSTED_INVOICE_MESSAGE} Les paiements, l’échéance et l’ICE du client restent modifiables.
              </p>
            </div>
          )}

          {showAttestation && attestation && (
            <div role="status" className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${attestation.state === 'expiring' ? 'border-amber-500/30 bg-amber-500/10' : 'border-red-500/30 bg-red-500/10'}`}>
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
              <p className="min-w-0 flex-1 text-sm text-foreground">
                {attestation.message}
                {attestation.state !== 'expiring' && ' Un client qui retient la TVA vous règle le HT : enregistrez sa retenue avec « TVA retenue par le client ».'}
              </p>
            </div>
          )}

          {missingClientIce && !isEditing && (
            <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
              <p className="flex items-start gap-2 text-sm text-amber-900 dark:text-amber-200">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                ICE du client manquant — obligatoire sur les factures aux professionnels (art. 145 CGI), amende de 100 DH par omission.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
                <label className="sr-only" htmlFor="invoice-client-ice">ICE du client</label>
                <input id="invoice-client-ice" value={iceInput} onChange={e => setIceInput(e.target.value)} inputMode="numeric"
                  placeholder="ICE (15 chiffres)" className="w-48 rounded-lg border border-input bg-card px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
                <button type="button" onClick={() => saveCustomerIce(false)} disabled={iceSaving || !iceInput.trim()}
                  className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  Enregistrer l’ICE
                </button>
                <button type="button" onClick={() => saveCustomerIce(true)} disabled={iceSaving}
                  className="rounded-lg border border-amber-600/30 bg-card px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-secondary disabled:opacity-50">
                  C’est un particulier
                </button>
                {iceInput.trim() && iceError(iceInput) && <p className="w-full text-xs text-destructive">{iceError(iceInput)}</p>}
              </div>
            </div>
          )}

          {/* Document chain */}
          <section className={`${panel} px-4 py-3 sm:px-5`} aria-label="Suivi du document">
            <ol className="grid grid-cols-4 gap-2">
              {steps.map((step, i) => {
                const dot = step.state === 'done' ? 'bg-emerald-600 text-white' : step.state === 'current' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground ring-1 ring-inset ring-border';
                const body = (
                  <>
                    <span className="flex items-center gap-2">
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${dot}`} aria-hidden="true">
                        {step.state === 'done' ? <Check className="h-3.5 w-3.5" /> : i + 1}
                      </span>
                      <span className="hidden h-px flex-1 bg-border sm:block" aria-hidden="true" />
                    </span>
                    <span className={`mt-1.5 block text-sm font-semibold ${step.state === 'todo' ? 'text-muted-foreground' : 'text-foreground'}`}>{step.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{step.detail}</span>
                  </>
                );
                return (
                  <li key={step.label} className="min-w-0">
                    {step.to ? <Link to={step.to} className="block rounded-md hover:opacity-80">{body}</Link> : body}
                  </li>
                );
              })}
            </ol>
            {chain?.proforma && (
              <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                Facturée depuis le proforma <Link to={`/compta/proformas/${chain.proforma.id}`} className="font-semibold text-primary hover:underline">{chain.proforma.number}</Link>
              </p>
            )}
            {!chain?.proforma && invoice.parent_document_id && (
              <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                <Link to={`/compta/proformas/${invoice.parent_document_id}`} className="font-semibold text-primary hover:underline">Voir le proforma source</Link>
              </p>
            )}
          </section>

          {/* Client */}
          <section className={`${panel} p-4 sm:p-5`} aria-labelledby="invoice-client-title">
            <h2 id="invoice-client-title" className={isEditing ? 'mb-3 font-semibold text-foreground' : 'sr-only'}>Client</h2>
            {isEditing ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {isPosted ? (
                  // Who was invoiced is fixed once booked; ICE and address can be completed.
                  <div className="md:col-span-3">
                    <p className="font-semibold text-foreground">{invoice.customer?.fullName || '—'}</p>
                    <p className="text-sm text-muted-foreground">{[invoice.customer?.phoneNumber, invoice.customer?.city].filter(Boolean).join(' · ')}</p>
                  </div>
                ) : (
                  <>
                    <div>
                      <p className="mb-1 text-xs font-medium text-foreground">Client *</p>
                      <ClientDropdown
                        value={draftCustomerName}
                        onChange={(client, val) => {
                          setDraftCustomerName(client ? client.full_name : val);
                          if (client) {
                            setDraftCustomerPhone(client.phone_number || '');
                            setDraftCustomerCity(client.city || '');
                            setDraftCustomerAddress(client.address || '');
                            setDraftCustomerIce(client.ice || '');
                            setDraftIsIndividual(!!client.is_individual);
                          }
                        }}
                        onCreateNew={q => { setClientFormInitialName(q || ''); setShowClientForm(true); }}
                        placeholder="Rechercher un client..."
                      />
                    </div>
                    <label className="block text-xs font-medium text-foreground">Téléphone
                      <input value={draftCustomerPhone} onChange={e => setDraftCustomerPhone(e.target.value)} className={`${fieldCls} mt-1`} placeholder="Téléphone" />
                    </label>
                    <label className="block text-xs font-medium text-foreground">Ville
                      <input value={draftCustomerCity} onChange={e => setDraftCustomerCity(e.target.value)} className={`${fieldCls} mt-1`} placeholder="Ville" />
                    </label>
                  </>
                )}
                <label className="block text-xs font-medium text-foreground md:col-span-2">Adresse
                  <input value={draftCustomerAddress} onChange={e => setDraftCustomerAddress(e.target.value)} className={`${fieldCls} mt-1`} placeholder="Adresse du client" />
                </label>
                <div>
                  <label className="block text-xs font-medium text-foreground">ICE
                    <input value={draftCustomerIce} onChange={e => setDraftCustomerIce(e.target.value)} inputMode="numeric" disabled={draftIsIndividual}
                      className={`${fieldCls} mt-1 disabled:opacity-60`} placeholder="15 chiffres" />
                  </label>
                  {iceError(draftCustomerIce) && <p className="mt-1 text-xs text-destructive">{iceError(draftCustomerIce)}</p>}
                  <label className="mt-1.5 flex items-center gap-2 text-xs text-foreground">
                    <input type="checkbox" checked={draftIsIndividual} onChange={e => setDraftIsIndividual(e.target.checked)} className="h-4 w-4 rounded accent-primary" />
                    Particulier (sans ICE)
                  </label>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 sm:gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold uppercase text-primary" aria-hidden="true">
                  {(invoice.customer?.fullName || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('')}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-lg font-semibold leading-tight text-foreground">{invoice.customer?.fullName || 'Client non renseigné'}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {[invoice.customer?.phoneNumber, invoice.customer?.city, `facturée le ${invoiceDate}`, `échéance le ${formatDay(dueDay)}`].filter(Boolean).join(' · ')}
                  </p>
                  {(invoice.customer?.address || invoice.customer?.ice || isIndividual) && (
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {[invoice.customer?.address, invoice.customer?.ice ? `ICE ${invoice.customer.ice}` : isIndividual ? 'Particulier' : ''].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Lines */}
          <section className={panel} aria-labelledby="invoice-lines-title">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3 sm:px-5">
              <h2 id="invoice-lines-title" className="font-semibold text-foreground">Articles</h2>
              <span className="text-sm text-muted-foreground">{shownItems.length} ligne{shownItems.length !== 1 ? 's' : ''}</span>
            </div>
            {/* A booked invoice shows its lines read-only, even while its payments are edited. */}
            {isEditing && !isPosted ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/40">
                    <tr>
                      <th className="w-8 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">#</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Désignation</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Marque</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Réf</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Qté</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">PU HT</th>
                      {showDiscount && <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Remise %</th>}
                      <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Total HT</th>
                      {!linesLocked && <th className="w-10 px-3 py-2" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {draftItems.map((item, idx) => {
                      const unitHT = toHT(item.unitPrice, tvaRate);
                      const totalHT = toHT(item.subtotal, tvaRate);
                      return (
                        <tr key={item.id}>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{idx + 1}</td>
                          <td className="px-2 py-1.5"><input value={item.quoteName || ''} onChange={e => updateDraftItem(idx, 'quoteName', e.target.value)} className={inputCls} placeholder="Désignation" aria-label="Désignation" /></td>
                          <td className="px-2 py-1.5"><input value={item.quoteBrand || ''} onChange={e => updateDraftItem(idx, 'quoteBrand', e.target.value)} className={inputCls} placeholder="Marque" aria-label="Marque" /></td>
                          <td className="px-2 py-1.5"><input value={item.quoteBarcode || ''} onChange={e => updateDraftItem(idx, 'quoteBarcode', e.target.value)} className={inputCls} placeholder="Référence" aria-label="Référence" /></td>
                          {linesLocked ? (
                            <>
                              <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">{item.quantity}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-foreground">{formatMoney(unitHT)}</td>
                            </>
                          ) : (
                            <>
                              <td className="px-2 py-1.5"><input type="number" min="1" value={item.quantity} onChange={e => updateDraftItem(idx, 'quantity', Math.max(1, Number(e.target.value)))} className={`${inputCls} w-20 text-right`} aria-label="Quantité" /></td>
                              <td className="px-2 py-1.5"><input type="number" min="0" step="0.01" value={unitPriceHTInput(item, tvaRate)} onChange={e => updateDraftItem(idx, 'unitPrice', toTTC(Number(e.target.value), tvaRate))} className={`${inputCls} w-24 text-right`} title="Prix unitaire hors taxes" aria-label="Prix unitaire HT" /></td>
                              <td className="px-2 py-1.5"><input type="number" min="0" max="100" step="0.5" value={discountRate(item)} onChange={e => updateDraftItem(idx, 'discount', Math.min(100, Math.max(0, Number(e.target.value))))} className={`${inputCls} w-16 text-right`} title="Remise %" aria-label="Remise %" /></td>
                            </>
                          )}
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">{formatMoney(totalHT)}</td>
                          {!linesLocked && (
                            <td className="px-2 py-1.5 text-center">
                              <button type="button" onClick={() => removeDraftItem(idx)} aria-label="Retirer la ligne" className="rounded p-1.5 text-destructive hover:bg-destructive/10">
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {linesLocked ? (
                  <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">Quantités et prix viennent du proforma : pour corriger un montant, créez un avoir.</p>
                ) : (
                  <div className="flex flex-wrap items-center gap-4 border-t border-border px-4 py-3">
                    <button type="button" onClick={() => setShowProductSearch(true)} className="flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
                      <SearchIcon className="h-4 w-4" />Chercher un produit
                    </button>
                    <button type="button" onClick={addBlankItem} className="flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
                      <Plus className="h-4 w-4" />Ligne vide
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="hidden gap-4 border-b border-border bg-secondary/40 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:flex">
                  <span className="w-6" /><span className="flex-1">Produit</span><span className="w-14 text-right">Qté</span><span className="w-32 text-right">Prix HT</span><span className="w-32 text-right">Total HT</span>
                </div>
                {invoice.items.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-muted-foreground">Aucun article sur cette facture.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {invoice.items.map((item, idx) => {
                      const unitHT = toHT(item.unitPrice, tvaRate);
                      const totalHT = toHT(item.subtotal, tvaRate);
                      const rate = discountRate(item);
                      const brandRef = [item.quoteBrand || item.product?.brand, item.quoteBarcode || item.product?.barcode].filter(Boolean).join(' · ');
                      return (
                        <li key={item.id} className="flex items-start gap-3 px-4 py-3 sm:px-5 md:items-center md:gap-4">
                          <span className="w-6 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground md:pt-0">{idx + 1}</span>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium leading-snug text-foreground">{item.quoteName || item.product?.name || '—'}</p>
                            {brandRef && <p className="truncate text-sm text-muted-foreground">{brandRef}</p>}
                            <p className="mt-0.5 text-sm tabular-nums text-muted-foreground md:hidden">
                              {item.quantity} × {formatMoney(unitHT)} HT{rate > 0 ? ` · remise ${rate} %` : ''}
                            </p>
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
              {tvaRate === 0 ? (
                <div className="flex justify-between"><dt className="text-muted-foreground">Exonéré de TVA{companySettings?.vat_exemption_text ? ` – ${companySettings.vat_exemption_text}` : ''}</dt><dd className="tabular-nums text-foreground">{formatMoney(0)}</dd></div>
              ) : (
                <div className="flex justify-between"><dt className="text-muted-foreground">TVA {tvaRate} %</dt><dd className="tabular-nums text-foreground">{formatMoney(shownTotal - shownHT)}</dd></div>
              )}
              <div className="flex justify-between text-base font-semibold"><dt className="text-foreground">Total TTC</dt><dd className="tabular-nums text-foreground">{formatMoney(shownTotal)}</dd></div>
            </dl>
          </section>

          {/* Payment details (editing) */}
          {isEditing && (
            <section id="invoice-payment" className={`${panel} scroll-mt-4 space-y-3 p-4 sm:p-5`} aria-labelledby="invoice-payment-title">
              <h2 id="invoice-payment-title" className="font-semibold text-foreground">Paiement</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <label className="block text-xs font-medium text-foreground">Date
                  <span className="relative mt-1 block">
                    <Calendar className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input type="date" value={draftPaymentDate} onChange={e => setDraftPaymentDate(e.target.value)} className={`${fieldCls} pl-7`} />
                  </span>
                </label>
                <label className="block text-xs font-medium text-foreground">Mode
                  <select value={draftPaymentMethod} onChange={e => setDraftPaymentMethod(e.target.value)} className={`${fieldCls} mt-1`}>
                    <option value="">— Sélectionner —</option>
                    <option value="Virement bancaire">Virement bancaire</option>
                    <option value="Chèque">Chèque</option>
                    <option value="Espèces">Espèces</option>
                    <option value="Carte bancaire">Carte bancaire</option>
                    <option value="Effet de commerce">Effet de commerce</option>
                    <option value="Versement">Versement</option>
                  </select>
                </label>
                <label className="block text-xs font-medium text-foreground">N° référence
                  <input value={draftPaymentReference} onChange={e => setDraftPaymentReference(e.target.value)} className={`${fieldCls} mt-1`} placeholder="N° chèque / virement / effet…" />
                </label>
                <label className="block text-xs font-medium text-foreground">Banque
                  <input value={draftPaymentBank} onChange={e => setDraftPaymentBank(e.target.value)} className={`${fieldCls} mt-1`} placeholder="Nom de la banque…" />
                </label>
              </div>

              <div className="overflow-hidden rounded-xl border border-border">
                <button
                  type="button"
                  onClick={() => setShowExtraPayments(v => !v)}
                  aria-expanded={showExtraPayments}
                  className="flex w-full items-center justify-between bg-secondary/50 px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
                >
                  <span className="flex items-center gap-1.5">
                    <Plus className="h-4 w-4 text-primary" />
                    Règlements reçus
                    {draftPaymentMethods.length > 0 && (
                      <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[11px] font-semibold text-primary">{draftPaymentMethods.length}</span>
                    )}
                  </span>
                  {showExtraPayments ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </button>
                {showExtraPayments && (
                  <div className="space-y-3 p-4">
                    {draftPaymentMethods.map((pm, idx) => {
                      const withholding = isWithholding(pm);
                      const dateError = paymentEntryError(pm, invoiceDayNow);
                      const before = !!pm.date && pm.date < invoiceDayNow;
                      const remove = (
                        <button type="button" onClick={() => setDraftPaymentMethods(prev => prev.filter((_, i) => i !== idx))}
                          aria-label="Retirer ce règlement"
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-destructive transition-colors hover:bg-destructive/10">
                          <X className="h-4 w-4" />
                        </button>
                      );
                      const dateInput = (
                        <input type="date" value={pm.date || ''} onChange={e => updatePaymentEntry(idx, { date: e.target.value })}
                          className={inputCls} aria-label={withholding ? 'Date de la retenue' : 'Date du règlement'}
                          title={pm.date ? undefined : 'Sans date : date de paiement de la facture'} />
                      );
                      return (
                        <div key={pm.id || idx} className={`space-y-1.5 rounded-lg ${withholding ? 'border border-violet-500/30 bg-violet-500/5 p-2.5' : ''}`}>
                          {withholding ? (
                            <>
                              <p className="text-xs font-semibold text-violet-800 dark:text-violet-300">TVA retenue à la source par le client — non encaissée</p>
                              <div className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[140px_1fr_1fr_110px_32px]">
                                {dateInput}
                                <select value={String(pm.withholding_rate || 100)} aria-label="Part de la TVA retenue" className={inputCls}
                                  onChange={e => {
                                    const share = Number(e.target.value);
                                    // Recomputed from the invoice without this line, so the share applies to the whole VAT.
                                    const others = { totalAmount: shownTotal, avance_amount: showAvance ? draftAvance : 0, payment_methods_json: draftPaymentMethods.filter((_, i) => i !== idx) };
                                    updatePaymentEntry(idx, { withholding_rate: share, amount: withholdingEntry(others, share).amount });
                                  }}>
                                  {WITHHOLDING_RATES.map(r => <option key={r} value={String(r)}>{r === 100 ? '100 % (biens d’équipement, travaux)' : '75 % (prestations, art. 117-V)'}</option>)}
                                </select>
                                <input value={pm.reference || ''} onChange={e => updatePaymentEntry(idx, { reference: e.target.value })}
                                  className={inputCls} placeholder="Réf. (attestation de retenue)" aria-label="Référence de la retenue" />
                                <input type="number" min="0" step="0.01" value={pm.amount || ''} onChange={e => updatePaymentEntry(idx, { amount: Number(e.target.value) })}
                                  className={`${inputCls} text-right`} placeholder="Montant" aria-label="Montant de la TVA retenue" />
                                {remove}
                              </div>
                              <p className="text-[11px] text-muted-foreground">
                                TVA de la facture : {formatMoney(invoiceVat({ totalAmount: shownTotal, tva_rate: invoice.tva_rate }, companySettings?.tva_rate))}. Le client la verse lui-même au fisc ; elle solde cette part de la facture.
                              </p>
                            </>
                          ) : (
                            <div className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[140px_1fr_1fr_1fr_110px_32px]">
                              {dateInput}
                              <select value={pm.method} onChange={e => updatePaymentEntry(idx, { method: e.target.value })} className={inputCls} aria-label="Mode de règlement">
                                <option value="">— Mode —</option>
                                {PAYMENT_MODES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                {pm.method && !PAYMENT_MODES.some(([v]) => v === pm.method) && <option value={pm.method}>{pm.method}</option>}
                              </select>
                              <input value={pm.reference || ''} onChange={e => updatePaymentEntry(idx, { reference: e.target.value })}
                                className={inputCls} placeholder="Référence" aria-label="Référence du règlement" />
                              <input value={pm.bank || ''} onChange={e => updatePaymentEntry(idx, { bank: e.target.value })}
                                className={inputCls} placeholder="Banque" aria-label="Banque du règlement" />
                              <input type="number" min="0" step="0.01" value={pm.amount || ''} onChange={e => updatePaymentEntry(idx, { amount: Number(e.target.value) })}
                                className={`${inputCls} text-right`} placeholder="Montant" aria-label="Montant du règlement" />
                              {remove}
                            </div>
                          )}
                          {!withholding && (pm.stamp_duty || 0) > 0 && isCashMethod(pm.method) && (
                            <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                              Droit de timbre 0,25 % : {formatMoney(pm.stamp_duty)} — à encaisser : {formatMoney((Number(pm.amount) || 0) + (pm.stamp_duty || 0))}
                            </p>
                          )}
                          {before && !withholding && (
                            <label className="flex items-center gap-2 text-xs text-foreground">
                              <input type="checkbox" checked={!!pm.advance} onChange={e => updatePaymentEntry(idx, { advance: e.target.checked })} className="h-4 w-4 rounded accent-primary" />
                              Avance reçue avant la facture
                            </label>
                          )}
                          {dateError && <p className="text-xs text-destructive">{dateError}</p>}
                        </div>
                      );
                    })}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5">
                      <button type="button" onClick={() => setDraftPaymentMethods(prev => [...prev, newPaymentEntry({ amount: draftSummary.reste })])}
                        className="flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
                        <Plus className="h-4 w-4" />Ajouter un règlement
                      </button>
                      {tvaRate > 0 && (
                        <button type="button" onClick={() => setDraftPaymentMethods(prev => [...prev, withholdingEntry(draftView)])}
                          className="flex items-center gap-1.5 text-sm font-semibold text-violet-700 hover:underline dark:text-violet-300">
                          <Plus className="h-4 w-4" />TVA retenue par le client
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="overflow-hidden rounded-xl border border-border">
                <label className="flex w-full cursor-pointer items-center justify-between bg-secondary/50 px-4 py-3 transition-colors hover:bg-secondary">
                  <span className="text-sm font-medium text-foreground">Avance sur facture</span>
                  <input type="checkbox" checked={showAvance} onChange={e => setShowAvance(e.target.checked)} className="h-4 w-4 rounded accent-primary" />
                </label>
                {showAvance && (
                  <div className="flex flex-wrap items-end gap-4 p-4">
                    <label className="block max-w-xs flex-1 text-xs font-medium text-foreground">Montant de l’avance (Dh)
                      <input type="number" min="0" step="0.01" value={draftAvance} onChange={e => setDraftAvance(Number(e.target.value))} className={`${fieldCls} mt-1`} placeholder="0.00" />
                    </label>
                    {draftAvance > 0 && (
                      <div className="pb-1">
                        <div className="text-xs text-muted-foreground">Reste net TTC</div>
                        <div className="font-semibold tabular-nums text-amber-700 dark:text-amber-300">
                          {formatMoney(Math.max(0, (invoice?.totalAmount ?? 0) - draftAvance - draftPaymentMethods.reduce((s, e) => s + (e.amount || 0), 0)))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {avanceTakesStamp && (
                  <p className="border-t border-border px-4 py-2 text-xs font-medium text-amber-800 dark:text-amber-300">
                    Droit de timbre 0,25 % : {formatMoney(cashStampDuty(draftAvance))} — à encaisser : {formatMoney(draftAvance + cashStampDuty(draftAvance))}.
                    {' '}L’avance en espèces sera enregistrée comme règlement daté.
                  </p>
                )}
              </div>

              {cashWarning && (
                <p role="alert" className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{cashWarning.message}
                </p>
              )}
            </section>
          )}

          {/* Notes */}
          {isEditing ? (
            <section className={`${panel} space-y-3 p-4 sm:p-5`} aria-labelledby="invoice-notes-title">
              <h2 id="invoice-notes-title" className="font-semibold text-foreground">Notes</h2>
              <label className="block text-xs text-muted-foreground">Visible sur la facture
                <textarea value={draftNotes} onChange={e => setDraftNotes(e.target.value)} rows={2} placeholder="Note client (visible sur le PDF)..." className={`${fieldCls} mt-1 resize-none`} />
              </label>
              <label className="block text-xs text-muted-foreground">Note interne (n’apparaît pas sur le PDF)
                <textarea value={draftNotes2} onChange={e => setDraftNotes2(e.target.value)} rows={2} placeholder="Note interne (non visible sur le PDF)..." className={`${fieldCls} mt-1 resize-none`} />
              </label>
            </section>
          ) : (invoice.notes || invoice.notes2) ? (
            <section className={`${panel} space-y-3 p-4 sm:p-5`} aria-labelledby="invoice-notes-title">
              <h2 id="invoice-notes-title" className="font-semibold text-foreground">Notes</h2>
              {invoice.notes && <p className="whitespace-pre-line text-sm text-foreground">{invoice.notes}</p>}
              {invoice.notes2 && (
                <div className={invoice.notes ? 'border-t border-border pt-3' : ''}>
                  <p className="text-xs font-medium text-muted-foreground">Note interne</p>
                  <p className="mt-0.5 whitespace-pre-line text-sm text-foreground">{invoice.notes2}</p>
                </div>
              )}
            </section>
          ) : null}
        </div>

        {/* Payment and actions: stays in view while the lines scroll */}
        <aside className="space-y-4 lg:sticky lg:top-4" aria-label="Paiement et actions">
          {isEditing && (
            <section className={`${panel} p-5`}>
              <p className="text-sm font-semibold text-foreground">Modification en cours</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Ctrl + S pour enregistrer, Échap pour annuler.</p>
              <button type="button" onClick={() => handleSave()} disabled={isSaving}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-60">
                {isSaving ? <Loader className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{isSaving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
              <button type="button" onClick={() => setIsEditing(false)} className="mt-2 w-full rounded-lg border border-border py-2 text-sm font-semibold text-foreground hover:bg-secondary">Annuler</button>
            </section>
          )}

          <section className={`${panel} p-5`} aria-labelledby="invoice-pay-title">
            <h2 id="invoice-pay-title" className="font-semibold text-foreground">Paiement</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Total TTC</dt><dd className="font-medium tabular-nums text-foreground">{formatMoney(shownTotal)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Encaissé</dt><dd className="font-medium tabular-nums text-emerald-700 dark:text-emerald-300">{formatMoney(shownSummary.received)}</dd></div>
              {shownSummary.withheld > 0 && (
                <div className="flex justify-between"><dt className="text-muted-foreground">TVA retenue par le client</dt><dd className="font-medium tabular-nums text-violet-700 dark:text-violet-300">{formatMoney(shownSummary.withheld)}</dd></div>
              )}
              {shownSummary.stampDuty > 0 && (
                <div className="flex justify-between text-xs"><dt className="text-muted-foreground">Droit de timbre encaissé (en plus)</dt><dd className="tabular-nums text-foreground">{formatMoney(shownSummary.stampDuty)}</dd></div>
              )}
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Échéance</dt>
                <dd className={`font-medium tabular-nums ${overdue.overdue ? 'text-red-700 dark:text-red-300' : 'text-foreground'}`}>
                  {formatDay(isEditing && draftDueDate ? draftDueDate : dueDay)}{overdue.overdue && !isEditing ? ` · ${overdue.days} j de retard` : ''}
                </dd>
              </div>
            </dl>
            <div className="mt-3 border-t border-border pt-3">
              <p className="text-sm font-semibold text-foreground">{resteNow <= 0 && paidNow > 0 ? 'Facture soldée' : 'Reste à payer'}</p>
              <p className={`text-2xl font-bold tabular-nums tracking-tight ${resteNow <= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-foreground'}`}>{formatMoney(resteNow)}</p>
            </div>
            {!isEditing && paymentSummary && (paymentSummary.settlements.some(s => s.amount || s.method) || primaryPayment.length > 0) && (
              <ul className="mt-3 space-y-1.5 border-t border-border pt-3 text-xs" aria-label="Règlements">
                {paymentSummary.settlements.filter(s => s.amount || s.method).map(s => (
                  <li key={s.key} className="flex justify-between gap-2">
                    <span className={`min-w-0 ${s.kind === 'vat_withholding' ? 'text-violet-700 dark:text-violet-300' : 'text-muted-foreground'}`}>
                      <span className="tabular-nums">{formatDay(s.date)}</span>
                      {' · '}{[s.source === 'avance' ? `Avance${s.method ? ` (${s.method})` : ''}` : s.kind === 'vat_withholding' ? `TVA retenue par le client${s.withholdingRate && s.withholdingRate !== 100 ? ` (${s.withholdingRate} %)` : ''}` : (s.method || 'Règlement'), s.reference, s.bank].filter(Boolean).join(' · ')}
                      {s.stampDuty > 0 && <span className="block">+ droit de timbre {formatMoney(s.stampDuty)}</span>}
                    </span>
                    <span className="shrink-0 tabular-nums text-foreground">{s.amount ? formatMoney(s.amount) : '—'}</span>
                  </li>
                ))}
                {primaryPayment.length > 0 && (
                  <li className="text-muted-foreground">Règlement : {primaryPayment.join(' · ')}</li>
                )}
              </ul>
            )}
            {!isEditing && cashWarning && (
              <p role="alert" className="mt-3 rounded-lg bg-amber-500/10 px-2.5 py-2 text-xs text-amber-900 dark:text-amber-200">{cashWarning.message}</p>
            )}
            {!isEditing && resteNow > 0 && (
              <>
                <button type="button" onClick={handleRecordPayment}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90">
                  <Wallet className="h-4 w-4" />Enregistrer un paiement
                </button>
                {tvaRate > 0 && (
                  <button type="button" onClick={handleRecordWithholding}
                    className="mt-2 w-full rounded-lg border border-border py-2 text-sm font-semibold text-foreground hover:bg-secondary">
                    TVA retenue par le client
                  </button>
                )}
              </>
            )}
            {!isEditing && isDraft && !invoice.is_locked && (
              <button type="button" onClick={handleFinalize} disabled={isSaving}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-primary/40 py-2 text-sm font-semibold text-primary hover:bg-primary/5 disabled:opacity-60">
                <CheckCircle className="h-4 w-4" />Finaliser la facture
              </button>
            )}
          </section>

          {!isEditing && (
            <section className={`${panel} p-5`} aria-labelledby="invoice-actions-title">
              <h2 id="invoice-actions-title" className="sr-only">Actions</h2>
              <button type="button" onClick={handleExportPdf}
                className={`flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold shadow-sm ${resteNow > 0 ? 'border border-border text-foreground hover:bg-secondary' : 'bg-primary text-primary-foreground hover:bg-primary/90'}`}>
                <Download className="h-4 w-4" />Télécharger le PDF
              </button>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <button type="button" onClick={handlePreview} className="flex flex-col items-center gap-1 rounded-lg border border-border py-2 text-xs font-semibold text-foreground hover:bg-secondary">
                  <Printer className="h-4 w-4 text-primary" />Aperçu
                </button>
                <button type="button" onClick={openWhatsAppModal} className="flex flex-col items-center gap-1 rounded-lg border border-border py-2 text-xs font-semibold text-foreground hover:bg-secondary">
                  <MessageCircle className="h-4 w-4 text-emerald-600" />WhatsApp
                </button>
                <button type="button" onClick={handleEmail} className="flex flex-col items-center gap-1 rounded-lg border border-border py-2 text-xs font-semibold text-foreground hover:bg-secondary">
                  <Mail className="h-4 w-4 text-primary" />E-mail
                </button>
              </div>
              {/* No "TTC only" option: an invoice always shows HT, VAT and TTC (CGI art. 145-III). */}
              {companySettings?.stamp_url && (
                <div className="mt-3 border-t border-border pt-1">
                  {toggleOption(useStamp, setUseStamp, 'Tampon', 'Apposer le tampon de la société')}
                </div>
              )}
              <div className="mt-2 space-y-0.5 border-t border-border pt-2">
                {invoice.is_locked ? (
                  <button type="button" onClick={handleUnlock} className={sideAction}><Unlock className="h-4 w-4 text-muted-foreground" />Déverrouiller</button>
                ) : (
                  <>
                    <button type="button" onClick={startEdit} className={sideAction}><Pencil className="h-4 w-4 text-muted-foreground" />Modifier la facture</button>
                    <button type="button" onClick={handleLock} className={sideAction}><Lock className="h-4 w-4 text-muted-foreground" />Verrouiller</button>
                  </>
                )}
                <button type="button" onClick={handleDuplicate} className={sideAction}><CopyPlus className="h-4 w-4 text-muted-foreground" />Dupliquer</button>
                {(isSuperAdmin || isCompta) && invoice.status === 'final' && (
                  <button type="button" onClick={openAvoirModal} className={sideAction}><Undo2 className="h-4 w-4 text-muted-foreground" />Créer un avoir</button>
                )}
              </div>
            </section>
          )}
        </aside>
      </div>

      {/* Phone: what is owed and the next step stay at hand, above the tab bar */}
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 border-t border-border bg-card px-4 py-2.5 shadow-[0_-4px_16px_rgba(17,24,39,0.06)] md:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">{resteNow <= 0 && paidNow > 0 ? 'Facture soldée' : 'Reste à payer'}</p>
            <p className="whitespace-nowrap text-lg font-bold tabular-nums leading-tight text-foreground">{formatMoney(resteNow)}</p>
          </div>
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
              {resteNow > 0 && (
                <button type="button" onClick={handleRecordPayment}
                  className="flex h-11 shrink-0 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">
                  <Wallet className="h-4 w-4" />Paiement
                </button>
              )}
            </>
          )}
        </div>
      </div>

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
          <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Undo2 className="h-4 w-4 text-primary" />Créer un avoir
              </h2>
              <button onClick={() => setShowAvoirModal(false)} className="p-1 rounded hover:bg-secondary text-muted-foreground"><X className="h-4 w-4" /></button>
            </div>
            <p className="text-xs text-muted-foreground">Avoir sur la facture <span className="font-semibold text-foreground">{invoice.quoteNumber}</span> : choisissez les quantités à créditer.</p>
            {!avoirLeft ? (
              <div className="flex justify-center py-3"><Loader className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            ) : Object.values(avoirLeft).every(q => q <= 0) ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">Cette facture est déjà entièrement couverte par des avoirs.</p>
            ) : (
              <div className="max-h-56 overflow-y-auto space-y-1.5">
                {invoice.items.filter(item => (avoirLeft[item.id] || 0) > 0).map(item => (
                  <label key={item.id} className="flex items-center gap-2 text-xs">
                    <span className="flex-1 min-w-0 truncate text-foreground">{item.quoteName || item.product?.name || '—'}</span>
                    <input
                      type="number" min={0} max={avoirLeft[item.id]} step="1"
                      value={avoirQty[item.id] ?? 0}
                      onChange={e => setAvoirQty(q => ({ ...q, [item.id]: Math.min(avoirLeft[item.id], Math.max(0, Number(e.target.value) || 0)) }))}
                      className={`${inputCls} text-right w-16`}
                    />
                    <span className="w-10 text-muted-foreground">/ {avoirLeft[item.id]}</span>
                  </label>
                ))}
                <div className="border-t border-border pt-1.5 flex justify-between text-xs font-semibold">
                  <span>Total avoir</span>
                  <span className="tabular-nums">{formatMoney(documentTotal(invoice.items.map(item => recomputeLine({ ...item, quantity: Math.min(avoirQty[item.id] || 0, avoirLeft[item.id] || 0) }))))} TTC</span>
                </div>
              </div>
            )}
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
                    const avoir = await SupabaseDocumentsService.createAvoirFromInvoice(invoice.id, avoirReason, avoirQty);
                    setShowAvoirModal(false);
                    navigate(`/compta/avoirs/${avoir.id}`);
                  } catch (e: any) {
                    showToast({ type: 'error', message: e?.message || 'Erreur création avoir' });
                  } finally {
                    setAvoirLoading(false);
                  }
                }}
                disabled={avoirLoading || !avoirLeft || !Object.values(avoirQty).some(q => q > 0)}
                className="flex-1 px-3 py-2 text-sm bg-primary hover:bg-primary/90 disabled:opacity-50 text-white rounded-lg"
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
