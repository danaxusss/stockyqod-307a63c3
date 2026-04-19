import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Receipt, Download, ArrowLeft, Loader, Pencil, Check, X, Plus, Calendar } from 'lucide-react';
import { Quote, QuoteItem } from '../../types';
import { SupabaseDocumentsService } from '../../utils/supabaseDocuments';
import { SupabaseCompaniesService } from '../../utils/supabaseCompanies';
import { PdfExportService } from '../../utils/pdfExport';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../hooks/useAuth';

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n);
}

const inputCls = 'w-full px-2 py-1 text-xs border border-input rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary';

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isSuperAdmin, isCompta } = useAuth();
  const { showToast } = useToast();

  const [invoice, setInvoice] = useState<Quote | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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
  const [draftPaymentDate, setDraftPaymentDate] = useState('');
  const [draftPaymentMethod, setDraftPaymentMethod] = useState('');
  const [draftPaymentReference, setDraftPaymentReference] = useState('');
  const [draftPaymentBank, setDraftPaymentBank] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      const doc = await SupabaseDocumentsService.getById(id);
      setInvoice(doc);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    } finally {
      setIsLoading(false);
    }
  }, [id, showToast]);

  useEffect(() => { load(); }, [load]);

  const startEdit = () => {
    if (!invoice) return;
    setDraftNumber(invoice.quoteNumber);
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
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!invoice) return;
    setIsSaving(true);
    try {
      await SupabaseDocumentsService.updateDocument(invoice.id, {
        quoteNumber: draftNumber,
        customer: { ...invoice.customer, fullName: draftCustomerName, phoneNumber: draftCustomerPhone, city: draftCustomerCity },
        items: draftItems,
        notes: draftNotes.trim() || null,
        status: draftStatus,
        payment_date: draftPaymentDate || null,
        payment_method: draftPaymentMethod || null,
        payment_reference: draftPaymentReference || null,
        payment_bank: draftPaymentBank || null,
      });
      showToast({ type: 'success', title: 'Facture mise à jour', message: 'Modifications sauvegardées' });
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

  const handleExportPdf = async () => {
    if (!invoice) return;
    try {
      const compId = invoice.issuing_company_id || invoice.company_id;
      const company = compId ? await SupabaseCompaniesService.getCompanyById(compId) : null;
      const settings = company ? {
        company_name: company.name, address: company.address, phone: company.phone,
        phone2: company.phone2, email: company.email, ice: company.ice, rc: company.rc,
        if_number: company.if_number, cnss: company.cnss, patente: company.patente,
        logo_url: company.logo_url, logo_size: company.logo_size,
        tva_rate: company.tva_rate, quote_validity_days: company.quote_validity_days,
        payment_terms: company.payment_terms, quote_visible_fields: company.quote_visible_fields,
        quote_style: { accentColor: company.accent_color, fontFamily: company.font_family, showBorders: true, borderRadius: 1, headerSize: 'large', totalsStyle: 'highlighted' },
      } as any : null;
      await PdfExportService.exportQuoteToPdf(invoice, settings, undefined, undefined, undefined, 'invoice');
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur PDF', message: String(e) });
    }
  };

  if (!isSuperAdmin && !isCompta) return <div className="text-center py-12 text-muted-foreground">Accès réservé au rôle Comptabilité.</div>;
  if (isLoading) return <div className="flex items-center justify-center min-h-[40vh]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!invoice) return <div className="text-center py-12 text-muted-foreground">Facture introuvable.</div>;

  const tvaRate = 20;
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
            <input value={draftNumber} onChange={e => setDraftNumber(e.target.value)}
              className="text-lg font-bold font-mono w-full px-2 py-0.5 border border-input rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
          ) : (
            <>
              <h1 className="text-lg font-bold text-foreground font-mono">{invoice.quoteNumber}</h1>
              <p className="text-xs text-muted-foreground">{invoice.customer?.fullName} — {new Date(invoice.createdAt).toLocaleDateString('fr-FR')}</p>
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
          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
            {invoice.status === 'final' ? 'Finalisé' : 'Brouillon'}
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
            ? <input value={draftCustomerName} onChange={e => setDraftCustomerName(e.target.value)} className={inputCls} placeholder="Nom client" />
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
                    <button onClick={addBlankItem} className="flex items-center space-x-1.5 text-xs text-primary hover:underline">
                      <Plus className="h-3.5 w-3.5" /><span>Ajouter un article</span>
                    </button>
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
        <div className="glass rounded-lg p-3">
          <p className="text-[11px] text-muted-foreground mb-1">Notes</p>
          <textarea value={draftNotes} onChange={e => setDraftNotes(e.target.value)}
            rows={3} placeholder="Notes..."
            className="w-full px-2 py-1.5 text-sm border border-input rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
        </div>
      ) : invoice.notes ? (
        <div className="glass rounded-lg p-3 text-sm text-muted-foreground italic">{invoice.notes}</div>
      ) : null}
    </div>
  );
}
