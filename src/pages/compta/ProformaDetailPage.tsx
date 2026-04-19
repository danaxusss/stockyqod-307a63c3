import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckSquare, Square, Download, FileText, ArrowLeft, Building2, Loader, Pencil, Check, X, Plus } from 'lucide-react';
import { Quote, QuoteItem, Company } from '../../types';
import { SupabaseDocumentsService } from '../../utils/supabaseDocuments';
import { SupabaseCompaniesService } from '../../utils/supabaseCompanies';
import { PdfExportService } from '../../utils/pdfExport';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../hooks/useAuth';

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n);
}

function statusBadge(status: string) {
  if (status === 'solde') return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">Soldé</span>;
  if (status === 'final') return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">Finalisé</span>;
  return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">En cours</span>;
}

const inputCls = 'w-full px-2 py-1 text-xs border border-input rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary';

export default function ProformaDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
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

  const startEdit = () => {
    if (!proforma) return;
    setDraftNumber(proforma.quoteNumber);
    setDraftCustomerName(proforma.customer?.fullName || '');
    setDraftCustomerPhone(proforma.customer?.phoneNumber || '');
    setDraftCustomerCity(proforma.customer?.city || '');
    setDraftNotes(proforma.notes || '');
    setDraftStatus(proforma.status);
    setDraftItems(proforma.items.map(i => ({ ...i })));
    setSelectedIds([]);
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!proforma) return;
    setIsSaving(true);
    try {
      await SupabaseDocumentsService.updateDocument(proforma.id, {
        quoteNumber: draftNumber,
        customer: { ...proforma.customer, fullName: draftCustomerName, phoneNumber: draftCustomerPhone, city: draftCustomerCity },
        items: draftItems,
        notes: draftNotes.trim() || null,
        status: draftStatus,
      });
      showToast({ type: 'success', title: 'Proforma mis à jour', message: 'Modifications sauvegardées' });
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

  const toggleItem = (itemId: string) => {
    setSelectedIds(prev => prev.includes(itemId) ? prev.filter(x => x !== itemId) : [...prev, itemId]);
  };

  const unbilledItems = proforma?.items.filter(i => !i.is_billed) || [];
  const selectedItems = proforma?.items.filter(i => selectedIds.includes(i.id)) || [];
  const invoiceTotal = selectedItems.reduce((s, i) => s + i.subtotal, 0);

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
      await PdfExportService.exportQuoteToPdf(proforma, settings, undefined, undefined, undefined, 'proforma');
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur PDF', message: String(e) });
    }
  };

  if (!isSuperAdmin && !isCompta) return <div className="text-center py-12 text-muted-foreground">Accès réservé au rôle Comptabilité.</div>;
  if (isLoading) return <div className="flex items-center justify-center min-h-[40vh]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!proforma) return <div className="text-center py-12 text-muted-foreground">Proforma introuvable.</div>;

  const remaining = proforma.totalAmount - (proforma.paid_amount || 0);
  const draftTotal = draftItems.reduce((s, i) => s + i.subtotal, 0);

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => navigate('/compta/proformas')} className="p-1.5 hover:bg-accent rounded-lg">
          <ArrowLeft className="h-4 w-4 text-muted-foreground" />
        </button>
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <input value={draftNumber} onChange={e => setDraftNumber(e.target.value)}
              className="text-lg font-bold font-mono w-full px-2 py-0.5 border border-input rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
          ) : (
            <>
              <h1 className="text-lg font-bold text-foreground font-mono">{proforma.quoteNumber}</h1>
              <p className="text-xs text-muted-foreground">{proforma.customer?.fullName} — {new Date(proforma.createdAt).toLocaleDateString('fr-FR')}</p>
            </>
          )}
        </div>
        {isEditing ? (
          <select value={draftStatus} onChange={e => setDraftStatus(e.target.value)}
            className="text-xs border border-input rounded px-2 py-1 bg-background text-foreground">
            <option value="draft">En cours</option>
            <option value="pending">En attente</option>
            <option value="final">Finalisé</option>
            <option value="solde">Soldé</option>
          </select>
        ) : statusBadge(proforma.status)}
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
          </>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="glass rounded-lg p-3 text-center">
          <div className="text-base font-bold text-foreground">{fmt(isEditing ? draftTotal : proforma.totalAmount)} Dh</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Total TTC</div>
        </div>
        <div className="glass rounded-lg p-3 text-center">
          <div className="text-base font-bold text-emerald-600">{fmt(proforma.paid_amount || 0)} Dh</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Payé</div>
        </div>
        <div className="glass rounded-lg p-3 text-center">
          <div className="text-base font-bold text-destructive">{fmt(remaining)} Dh</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Reste</div>
        </div>
      </div>

      {/* Client info */}
      <div className="glass rounded-lg p-4 grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-[11px] text-muted-foreground mb-0.5">Client</p>
          {isEditing
            ? <input value={draftCustomerName} onChange={e => setDraftCustomerName(e.target.value)} className={inputCls} placeholder="Nom client" />
            : <p className="font-medium text-foreground">{proforma.customer?.fullName || '—'}</p>}
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground mb-0.5">Téléphone</p>
          {isEditing
            ? <input value={draftCustomerPhone} onChange={e => setDraftCustomerPhone(e.target.value)} className={inputCls} placeholder="Téléphone" />
            : <p className="text-foreground">{proforma.customer?.phoneNumber || '—'}</p>}
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground mb-0.5">Ville</p>
          {isEditing
            ? <input value={draftCustomerCity} onChange={e => setDraftCustomerCity(e.target.value)} className={inputCls} placeholder="Ville" />
            : <p className="text-foreground">{proforma.customer?.city || '—'}</p>}
        </div>
      </div>

      {/* Source BLs */}
      {proforma.source_bl_ids && proforma.source_bl_ids.length > 0 && (
        <div className="glass rounded-lg p-3">
          <p className="text-xs text-muted-foreground mb-1.5">BL sources</p>
          <div className="flex flex-wrap gap-1.5">
            {proforma.source_bl_ids.map(blId => (
              <span key={blId} className="px-2 py-0.5 text-[10px] bg-secondary rounded font-mono">{blId.slice(0, 8)}…</span>
            ))}
          </div>
        </div>
      )}

      {/* Items table with checkboxes (billing) or edit inputs */}
      <div className="glass rounded-xl shadow-lg overflow-hidden">
        <div className="flex items-center justify-between p-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Articles ({isEditing ? draftItems.length : proforma.items.length})</h2>
          {!isEditing && unbilledItems.length > 0 && (
            <button onClick={() => setShowInvoiceModal(true)} disabled={selectedIds.length === 0}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-lg">
              <FileText className="h-3.5 w-3.5" />
              <span>Générer Facture ({selectedIds.length})</span>
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-secondary">
              <tr>
                {!isEditing && <th className="px-3 py-2 w-8" />}
                <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase w-6">#</th>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Produit</th>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Marque</th>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Réf</th>
                <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground uppercase">Qté</th>
                <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground uppercase">PU HT</th>
                <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground uppercase">Total HT</th>
                {!isEditing && <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Statut</th>}
                {!isEditing && <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Facturé par</th>}
                {isEditing && <th className="px-3 py-2 w-8" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(isEditing ? draftItems : proforma.items).map((item, idx) => {
                const billed = item.is_billed === true;
                const selected = selectedIds.includes(item.id);
                const tvaRate = 20;
                const unitHT = item.unitPrice / (1 + tvaRate / 100);
                const totalHT = unitHT * item.quantity;
                return (
                  <tr key={item.id} className={`hover:bg-accent/50 ${!isEditing && billed ? 'opacity-60' : ''}`}>
                    {!isEditing && (
                      <td className="px-3 py-2.5">
                        <button disabled={billed} onClick={() => toggleItem(item.id)} className="text-primary disabled:cursor-not-allowed">
                          {selected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4 text-muted-foreground" />}
                        </button>
                      </td>
                    )}
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
                        <td className="px-3 py-2.5">
                          {billed
                            ? <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">Facturé</span>
                            : <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">Non facturé</span>}
                        </td>
                        <td className="px-3 py-2.5 text-[10px] text-muted-foreground">
                          {item.billed_by_company_id ? (companyMap[item.billed_by_company_id] || '—') : '—'}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
              {isEditing && (
                <tr>
                  <td colSpan={8} className="px-3 py-2">
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
      ) : proforma.notes ? (
        <div className="glass rounded-lg p-3 text-sm text-muted-foreground italic">{proforma.notes}</div>
      ) : null}

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
                <span>{fmt(invoiceTotal)} Dh TTC</span>
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
    </div>
  );
}
