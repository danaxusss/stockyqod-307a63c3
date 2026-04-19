import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Truck, Download, ArrowLeft, FileText, Building2, Loader, Pencil, Check, X, Plus } from 'lucide-react';
import { Quote, QuoteItem, Company } from '../../types';
import { SupabaseDocumentsService } from '../../utils/supabaseDocuments';
import { SupabaseCompaniesService } from '../../utils/supabaseCompanies';
import { PdfExportService } from '../../utils/pdfExport';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../hooks/useAuth';

const inputCls = 'w-full px-2 py-1 text-xs border border-input rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary';

export default function BLDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isSuperAdmin, isCompta } = useAuth();
  const { showToast } = useToast();

  const [bl, setBl] = useState<Quote | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
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
  const [draftNotes, setDraftNotes] = useState('');
  const [draftStatus, setDraftStatus] = useState('');
  const [draftItems, setDraftItems] = useState<QuoteItem[]>([]);

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
      if (doc?.company_id) setTargetCompanyId(doc.company_id);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    } finally {
      setIsLoading(false);
    }
  }, [id, showToast]);

  useEffect(() => { load(); }, [load]);

  const startEdit = () => {
    if (!bl) return;
    setDraftNumber(bl.quoteNumber);
    setDraftCustomerName(bl.customer?.fullName || '');
    setDraftCustomerPhone(bl.customer?.phoneNumber || '');
    setDraftCustomerCity(bl.customer?.city || '');
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

  const handleSave = async () => {
    if (!bl) return;
    setIsSaving(true);
    try {
      await SupabaseDocumentsService.updateDocument(bl.id, {
        quoteNumber: draftNumber,
        customer: { ...bl.customer, fullName: draftCustomerName, phoneNumber: draftCustomerPhone, city: draftCustomerCity },
        items: draftItems,
        notes: draftNotes.trim() || null,
        status: draftStatus,
      });
      showToast({ type: 'success', title: 'BL mis à jour', message: 'Modifications sauvegardées' });
      setIsEditing(false);
      await load();
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    } finally {
      setIsSaving(false);
    }
  };

  const updateDraftItem = (idx: number, field: string, value: string | number) => {
    setDraftItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const updated: any = { ...item, [field]: value };
      if (field === 'quantity') updated.subtotal = (updated.unitPrice || 0) * Math.max(1, Number(value));
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
      const company = bl.company_id ? await SupabaseCompaniesService.getCompanyById(bl.company_id) : null;
      const settings = company ? {
        company_name: company.name, address: company.address, phone: company.phone,
        phone2: company.phone2, email: company.email, ice: company.ice, rc: company.rc,
        if_number: company.if_number, cnss: company.cnss, patente: company.patente,
        logo_url: company.logo_url, logo_size: company.logo_size,
        tva_rate: company.tva_rate, quote_validity_days: company.quote_validity_days,
        payment_terms: company.payment_terms, quote_visible_fields: company.quote_visible_fields,
        quote_style: { accentColor: company.accent_color, fontFamily: company.font_family, showBorders: true, borderRadius: 1, headerSize: 'large', totalsStyle: 'highlighted' },
      } as any : null;
      await PdfExportService.exportQuoteToPdf(bl, settings, undefined, undefined, undefined, 'bl');
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur PDF', message: String(e) });
    }
  };

  if (!isSuperAdmin && !isCompta) return <div className="text-center py-12 text-muted-foreground">Accès réservé au rôle Comptabilité.</div>;
  if (isLoading) return <div className="flex items-center justify-center min-h-[40vh]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!bl) return <div className="text-center py-12 text-muted-foreground">BL introuvable.</div>;

  const isFinal = bl.status === 'final';

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => navigate('/compta/bls')} className="p-1.5 hover:bg-accent rounded-lg">
          <ArrowLeft className="h-4 w-4 text-muted-foreground" />
        </button>
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <input value={draftNumber} onChange={e => setDraftNumber(e.target.value)}
              className="text-lg font-bold font-mono w-full px-2 py-0.5 border border-input rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
          ) : (
            <>
              <h1 className="text-lg font-bold text-foreground font-mono">{bl.quoteNumber}</h1>
              <p className="text-xs text-muted-foreground">{bl.customer?.fullName} — {new Date(bl.createdAt).toLocaleDateString('fr-FR')}</p>
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
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${isFinal ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'}`}>
            {isFinal ? 'Finalisé' : 'Brouillon'}
          </span>
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
            <button onClick={startEdit} className="p-1.5 hover:bg-accent rounded-lg text-muted-foreground" title="Modifier">
              <Pencil className="h-4 w-4" />
            </button>
            <button onClick={handleExportPdf} className="flex items-center space-x-1.5 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
              <Download className="h-3.5 w-3.5" /><span>PDF</span>
            </button>
            {!isFinal && (
              <button onClick={() => setShowModal(true)}
                className="flex items-center space-x-1.5 px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg">
                <FileText className="h-3.5 w-3.5" /><span>→ Proforma</span>
              </button>
            )}
          </>
        )}
      </div>

      {/* Client info */}
      <div className="glass rounded-lg p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div>
          <p className="text-[11px] text-muted-foreground mb-0.5">Client</p>
          {isEditing
            ? <input value={draftCustomerName} onChange={e => setDraftCustomerName(e.target.value)} className={inputCls} placeholder="Nom client" />
            : <p className="font-medium text-foreground">{bl.customer?.fullName || '—'}</p>}
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground mb-0.5">Téléphone</p>
          {isEditing
            ? <input value={draftCustomerPhone} onChange={e => setDraftCustomerPhone(e.target.value)} className={inputCls} placeholder="Téléphone" />
            : <p className="text-foreground">{bl.customer?.phoneNumber || '—'}</p>}
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground mb-0.5">Ville</p>
          {isEditing
            ? <input value={draftCustomerCity} onChange={e => setDraftCustomerCity(e.target.value)} className={inputCls} placeholder="Ville" />
            : <p className="text-foreground">{bl.customer?.city || '—'}</p>}
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground mb-0.5">Articles</p>
          <p className="font-bold text-foreground">{isEditing ? draftItems.length : bl.items.length}</p>
        </div>
      </div>

      {/* Items table */}
      <div className="glass rounded-xl shadow-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Articles</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-secondary">
              <tr>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase w-8">#</th>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Désignation</th>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Marque</th>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Référence</th>
                <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground uppercase">Quantité</th>
                {isEditing && <th className="px-3 py-2 w-8" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(isEditing ? draftItems : bl.items).map((item, idx) => (
                <tr key={item.id} className="hover:bg-accent/50">
                  <td className="px-3 py-2 text-[10px] text-muted-foreground">{idx + 1}</td>
                  {isEditing ? (
                    <>
                      <td className="px-2 py-1.5"><input value={item.quoteName || ''} onChange={e => updateDraftItem(idx, 'quoteName', e.target.value)} className={inputCls} placeholder="Désignation" /></td>
                      <td className="px-2 py-1.5"><input value={item.quoteBrand || ''} onChange={e => updateDraftItem(idx, 'quoteBrand', e.target.value)} className={inputCls} placeholder="Marque" /></td>
                      <td className="px-2 py-1.5"><input value={item.quoteBarcode || ''} onChange={e => updateDraftItem(idx, 'quoteBarcode', e.target.value)} className={inputCls} placeholder="Référence" /></td>
                      <td className="px-2 py-1.5"><input type="number" min="1" value={item.quantity} onChange={e => updateDraftItem(idx, 'quantity', Math.max(1, Number(e.target.value)))} className={`${inputCls} text-right w-20`} /></td>
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
                      <td className="px-3 py-2.5 text-right text-sm font-bold text-foreground">{item.quantity}</td>
                    </>
                  )}
                </tr>
              ))}
              {isEditing && (
                <tr>
                  <td colSpan={6} className="px-3 py-2">
                    <button onClick={addBlankItem} className="flex items-center space-x-1.5 text-xs text-primary hover:underline">
                      <Plus className="h-3.5 w-3.5" /><span>Ajouter un article</span>
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Notes */}
      {isEditing ? (
        <div className="glass rounded-lg p-3">
          <p className="text-[11px] text-muted-foreground mb-1">Notes</p>
          <textarea value={draftNotes} onChange={e => setDraftNotes(e.target.value)}
            rows={3} placeholder="Notes..."
            className="w-full px-2 py-1.5 text-sm border border-input rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
        </div>
      ) : bl.notes ? (
        <div className="glass rounded-lg p-3 text-sm text-muted-foreground italic">{bl.notes}</div>
      ) : null}

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
    </div>
  );
}
