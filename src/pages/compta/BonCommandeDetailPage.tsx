import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Save, FileDown, Loader, Plus, Trash2,
  ChevronDown, ChevronUp, Check, AlertCircle, ClipboardList,
} from 'lucide-react';
import { Quote, QuoteItem, CustomerInfo, StockLocation } from '../../types';
import { SupabaseDocumentsService } from '../../utils/supabaseDocuments';
import { PdfExportService } from '../../utils/pdfExport';
import { CompanySettingsService } from '../../utils/companySettings';
import { StockLocationsService } from '../../utils/supabaseStockLocations';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { useAppContext } from '../../context/AppContext';

export default function BonCommandeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isFacturation, isSuperAdmin, companyId } = useAuth();
  const { showToast } = useToast();
  const { state } = useAppContext();

  const [bc, setBc] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [stockLocations, setStockLocations] = useState<StockLocation[]>([]);

  // Draft state
  const [draftItems, setDraftItems] = useState<QuoteItem[]>([]);
  const [draftCustomerName, setDraftCustomerName] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [draftStatus, setDraftStatus] = useState<'draft' | 'final'>('draft');
  const [expandedDispatch, setExpandedDispatch] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [doc, locs] = await Promise.all([
        SupabaseDocumentsService.getById(id),
        StockLocationsService.getStockLocations(),
      ]);
      if (!doc) { navigate('/compta/bons-commande'); return; }
      setBc(doc);
      setDraftItems(doc.items || []);
      setDraftCustomerName(doc.customer?.fullName || '');
      setDraftNotes(doc.notes || '');
      setDraftStatus(doc.status === 'final' ? 'final' : 'draft');
      setStockLocations(locs);
    } catch {
      showToast({ type: 'error', message: 'Erreur lors du chargement du BC' });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (!isFacturation && !isSuperAdmin) {
    return <div className="p-8 text-center text-muted-foreground">Accès réservé au rôle Facturation.</div>;
  }

  // Dispatch validation
  const isItemDispatched = (item: QuoteItem) => {
    if (!item.dispatch || item.dispatch.length === 0) return false;
    const total = item.dispatch.reduce((s, d) => s + (d.quantity || 0), 0);
    return total === item.quantity;
  };

  const allDispatched = draftItems.every(isItemDispatched);

  const updateDispatch = (
    itemId: string,
    locId: string,
    locName: string,
    subCode: string,
    qty: number
  ) => {
    setDraftItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      const existing = item.dispatch || [];
      const key = `${locId}::${subCode}`;
      const filtered = existing.filter(d => `${d.stock_location_id}::${d.sub_location_code}` !== key);
      const newDispatch = qty > 0
        ? [...filtered, { stock_location_id: locId, stock_location_name: locName, sub_location_code: subCode, quantity: qty }]
        : filtered;
      return { ...item, dispatch: newDispatch };
    }));
  };

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await SupabaseDocumentsService.updateDocument(id, {
        customer: { ...(bc?.customer || {} as CustomerInfo), fullName: draftCustomerName },
        items: draftItems,
        notes: draftNotes || null,
        status: draftStatus,
      });
      showToast({ type: 'success', message: 'BC sauvegardé' });
      await load();
    } catch (e: any) {
      showToast({ type: 'error', message: e.message });
    } finally {
      setSaving(false);
    }
  };

  const handleExportPdf = async () => {
    if (!bc) return;
    setExporting(true);
    try {
      const settings = await CompanySettingsService.getSettings(bc.company_id || companyId || undefined).catch(() => null);
      // Save first to persist dispatch data
      if (saving) return;
      const exportDoc = { ...bc, items: draftItems };
      await PdfExportService.exportQuoteToPdf(exportDoc, settings, undefined, undefined, undefined, 'bon_commande');
    } catch (e: any) {
      showToast({ type: 'error', message: e.message });
    } finally {
      setExporting(false);
    }
  };

  const removeItem = (itemId: string) => {
    setDraftItems(prev => prev.filter(i => i.id !== itemId));
  };

  const updateItemQty = (itemId: string, qty: number) => {
    setDraftItems(prev => prev.map(i => i.id === itemId ? { ...i, quantity: Math.max(1, qty), dispatch: [] } : i));
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-64">
      <Loader className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
  if (!bc) return null;

  const formatDate = (d: Date) => new Date(d).toLocaleDateString('fr-FR');

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="glass rounded-xl shadow-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/compta/bons-commande')} className="p-1.5 hover:bg-accent rounded-lg">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="p-2 bg-primary rounded-lg">
              <ClipboardList className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">BC — {bc.quoteNumber}</h1>
              <p className="text-xs text-muted-foreground">{formatDate(bc.createdAt)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleExportPdf} disabled={exporting} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-accent">
              {exporting ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
              PDF
            </button>
            <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
              {saving ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Sauvegarder
            </button>
          </div>
        </div>
      </div>

      {/* Info & status */}
      <div className="glass rounded-xl shadow-lg p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Client</label>
          <input value={draftCustomerName} onChange={e => setDraftCustomerName(e.target.value)}
            className="w-full px-3 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground" placeholder="Nom du client" />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
          <input value={draftNotes} onChange={e => setDraftNotes(e.target.value)}
            className="w-full px-3 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground" placeholder="Notes..." />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Statut</label>
          <select value={draftStatus} onChange={e => setDraftStatus(e.target.value as 'draft' | 'final')}
            className="w-full px-3 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground">
            <option value="draft">Brouillon</option>
            <option value="final">Final</option>
          </select>
        </div>
      </div>

      {/* Dispatch validation summary */}
      {draftItems.length > 0 && (
        <div className={`rounded-xl p-3 flex items-center gap-2 text-sm ${allDispatched ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-700'}`}>
          {allDispatched
            ? <><Check className="h-4 w-4 shrink-0" /> Tous les articles sont affectés aux emplacements de collecte.</>
            : <><AlertCircle className="h-4 w-4 shrink-0" /> {draftItems.filter(i => !isItemDispatched(i)).length} article(s) non encore affecté(s).</>
          }
        </div>
      )}

      {/* Items */}
      <div className="glass rounded-xl shadow-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold">Articles ({draftItems.length})</h2>
        </div>
        {draftItems.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Aucun article. Utilisez "Créer depuis BL" pour pré-remplir.</p>
        ) : (
          <div className="divide-y divide-border">
            {draftItems.map(item => {
              const expanded = expandedDispatch.has(item.id);
              const dispatched = isItemDispatched(item);
              const totalDispatched = (item.dispatch || []).reduce((s, d) => s + d.quantity, 0);
              const remaining = item.quantity - totalDispatched;

              return (
                <div key={item.id}>
                  {/* Item row */}
                  <div className="flex items-center gap-2 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium truncate">{item.quoteName || item.product?.name}</span>
                        {item.quoteBrand && <span className="text-[10px] text-muted-foreground">{item.quoteBrand}</span>}
                        {item.quoteBarcode && <span className="text-[10px] font-mono text-muted-foreground">{item.quoteBarcode}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <input type="number" min={1} value={item.quantity}
                        onChange={e => updateItemQty(item.id, parseInt(e.target.value) || 1)}
                        className="w-14 h-7 text-xs text-center border border-input rounded bg-background" />
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${dispatched ? 'bg-emerald-500/10 text-emerald-600' : remaining > 0 ? 'bg-amber-500/10 text-amber-600' : 'bg-muted text-muted-foreground'}`}>
                        {dispatched ? '✓' : `${totalDispatched}/${item.quantity}`}
                      </span>
                      <button onClick={() => setExpandedDispatch(prev => { const n = new Set(prev); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n; })}
                        className="p-1 hover:bg-accent rounded" title="Affecter emplacements">
                        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>
                      <button onClick={() => removeItem(item.id)} className="p-1 hover:bg-destructive/10 text-destructive rounded">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Dispatch panel */}
                  {expanded && (
                    <div className="bg-muted/20 border-t border-border px-8 py-3 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground mb-2">Affectation aux emplacements de collecte</p>
                      {stockLocations.length === 0 && (
                        <p className="text-xs text-muted-foreground">Aucun emplacement configuré. Allez dans Paramètres → Emplacements.</p>
                      )}
                      {stockLocations.map(loc => {
                        const stockQty = (item.product?.stock_levels || {})[loc.name] ?? 0;
                        const subs = loc.sub_locations || [];
                        return (
                          <div key={loc.id} className="space-y-1">
                            <p className="text-[11px] font-semibold text-foreground flex items-center gap-1">
                              {loc.name}
                              {loc.abbreviation && <span className="font-mono text-muted-foreground">({loc.abbreviation})</span>}
                              <span className="text-muted-foreground font-normal">— stock: {stockQty}</span>
                            </p>
                            {subs.length === 0 ? (
                              <div className="flex items-center gap-2">
                                <label className="text-xs text-muted-foreground w-24">{loc.abbreviation || loc.name}</label>
                                <input
                                  type="number" min={0} max={item.quantity}
                                  value={(item.dispatch || []).find(d => d.stock_location_id === loc.id && d.sub_location_code === '')?.quantity ?? 0}
                                  onChange={e => updateDispatch(item.id, loc.id, loc.name, '', parseInt(e.target.value) || 0)}
                                  className="w-14 h-6 text-xs text-center border border-input rounded bg-background"
                                />
                              </div>
                            ) : subs.map(sub => (
                              <div key={sub.id} className="flex items-center gap-2 pl-3">
                                <label className="text-xs text-muted-foreground w-24">{sub.name} <span className="font-mono">({sub.code})</span></label>
                                <input
                                  type="number" min={0} max={item.quantity}
                                  value={(item.dispatch || []).find(d => d.stock_location_id === loc.id && d.sub_location_code === sub.code)?.quantity ?? 0}
                                  onChange={e => updateDispatch(item.id, loc.id, loc.name, sub.code, parseInt(e.target.value) || 0)}
                                  className="w-14 h-6 text-xs text-center border border-input rounded bg-background"
                                />
                              </div>
                            ))}
                          </div>
                        );
                      })}
                      {remaining !== 0 && (
                        <p className="text-xs text-amber-600">
                          {remaining > 0 ? `Il reste ${remaining} unité(s) à affecter` : `Surplus de ${Math.abs(remaining)} unité(s)`}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
