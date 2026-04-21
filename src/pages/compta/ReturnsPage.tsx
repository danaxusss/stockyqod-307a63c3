import React, { useState, useEffect, useCallback } from 'react';
import { RotateCcw, Plus, Trash2, X, Check, Loader, ChevronDown, ChevronUp } from 'lucide-react';
import { Return, ReturnItem } from '../../types';
import { SupabaseReturnsService } from '../../utils/supabaseReturns';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../hooks/useAuth';

const inputCls = 'w-full px-2 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary';

const EMPTY_FORM = {
  reference_number: '',
  client_name: '',
  reason: '',
  notes: '',
  items: [{ barcode: '', label: '', quantity: 1 }] as ReturnItem[],
};

export default function ReturnsPage() {
  const { showToast } = useToast();
  const { isSuperAdmin, isCompta } = useAuth();
  const [returns, setReturns] = useState<Return[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await SupabaseReturnsService.getAll();
      setReturns(data);
    } catch {
      showToast({ type: 'error', message: 'Erreur chargement retours' });
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const openModal = () => {
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.reference_number.trim() || !form.client_name.trim()) {
      showToast({ type: 'error', message: 'Numéro de référence et client requis' });
      return;
    }
    setIsSaving(true);
    try {
      await SupabaseReturnsService.create({
        reference_number: form.reference_number.trim(),
        client_name: form.client_name.trim(),
        reason: form.reason.trim(),
        notes: form.notes.trim() || undefined,
        items: form.items.filter(i => i.label.trim()),
      });
      showToast({ type: 'success', message: 'Retour créé' });
      setShowModal(false);
      await load();
    } catch (e: any) {
      showToast({ type: 'error', message: e?.message || 'Erreur lors de la création' });
    } finally {
      setIsSaving(false);
    }
  };

  const toggleStatus = async (ret: Return) => {
    try {
      await SupabaseReturnsService.update(ret.id, { status: ret.status === 'open' ? 'closed' : 'open' });
      await load();
    } catch {
      showToast({ type: 'error', message: 'Erreur mise à jour statut' });
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Supprimer ce retour ?')) return;
    try {
      await SupabaseReturnsService.delete(id);
      showToast({ type: 'success', message: 'Retour supprimé' });
      await load();
    } catch {
      showToast({ type: 'error', message: 'Erreur suppression' });
    }
  };

  const addItem = () => setForm(f => ({ ...f, items: [...f.items, { barcode: '', label: '', quantity: 1 }] }));
  const removeItem = (idx: number) => setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  const updateItem = (idx: number, field: keyof ReturnItem, value: string | number) => {
    setForm(f => ({ ...f, items: f.items.map((item, i) => i === idx ? { ...item, [field]: value } : item) }));
  };

  if (!isSuperAdmin && !isCompta) {
    return <div className="text-center py-12 text-muted-foreground">Accès réservé.</div>;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="glass rounded-xl shadow-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-primary rounded-lg" style={{ boxShadow: 'var(--shadow-glow)' }}>
              <RotateCcw className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Retours</h1>
              <p className="text-xs text-muted-foreground">{returns.length} retour{returns.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <button onClick={openModal} className="flex items-center space-x-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm">
            <Plus className="h-3.5 w-3.5" /><span>Nouveau retour</span>
          </button>
        </div>
      </div>

      {/* List */}
      <div className="glass rounded-xl shadow-lg overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center"><Loader className="h-6 w-6 animate-spin text-primary mx-auto" /></div>
        ) : returns.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <RotateCcw className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Aucun retour enregistré</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {returns.map(ret => (
              <div key={ret.id}>
                <div className="px-4 py-3 flex items-center gap-3">
                  <button onClick={() => setExpandedId(expandedId === ret.id ? null : ret.id)}
                    className="text-muted-foreground hover:text-foreground">
                    {expandedId === ret.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono font-semibold text-foreground">{ret.reference_number}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${ret.status === 'open' ? 'bg-amber-500/15 text-amber-400' : 'bg-emerald-500/15 text-emerald-400'}`}>
                        {ret.status === 'open' ? 'Ouvert' : 'Clôturé'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{ret.client_name} — {ret.reason || '—'}</p>
                  </div>
                  <span className="text-[11px] text-muted-foreground">{new Date(ret.created_at).toLocaleDateString('fr-FR')}</span>
                  <button onClick={() => toggleStatus(ret)}
                    className="px-2 py-1 text-xs border border-border rounded hover:bg-accent text-muted-foreground">
                    {ret.status === 'open' ? 'Clôturer' : 'Rouvrir'}
                  </button>
                  <button onClick={() => handleDelete(ret.id)} className="p-1 text-destructive hover:bg-destructive/10 rounded">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {expandedId === ret.id && ret.items.length > 0 && (
                  <div className="px-10 pb-3">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-muted-foreground">
                          <th className="text-left py-1 pr-3">Article</th>
                          <th className="text-left py-1 pr-3">Réf</th>
                          <th className="text-right py-1">Qté</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {ret.items.map((item, i) => (
                          <tr key={i}>
                            <td className="py-1 pr-3 text-foreground">{item.label}</td>
                            <td className="py-1 pr-3 font-mono text-muted-foreground">{item.barcode || '—'}</td>
                            <td className="py-1 text-right font-bold text-foreground">{item.quantity}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {ret.notes && <p className="text-xs text-muted-foreground italic mt-2">{ret.notes}</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="glass rounded-xl shadow-2xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-foreground">Nouveau Retour</h2>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-accent rounded-lg"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">N° Référence *</label>
                  <input className={inputCls} value={form.reference_number} onChange={e => setForm(f => ({ ...f, reference_number: e.target.value }))} placeholder="N° devis / BL / facture" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Client *</label>
                  <input className={inputCls} value={form.client_name} onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))} placeholder="Nom du client" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Motif</label>
                <input className={inputCls} value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="Ex: Produit défectueux" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Articles</label>
                <div className="space-y-2">
                  {form.items.map((item, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-1.5 items-center">
                      <input className={`${inputCls} col-span-5`} value={item.label} onChange={e => updateItem(idx, 'label', e.target.value)} placeholder="Désignation *" />
                      <input className={`${inputCls} col-span-4`} value={item.barcode} onChange={e => updateItem(idx, 'barcode', e.target.value)} placeholder="Réf / code barre" />
                      <input type="number" min="1" className={`${inputCls} col-span-2`} value={item.quantity} onChange={e => updateItem(idx, 'quantity', Math.max(1, Number(e.target.value)))} placeholder="Qté" />
                      <button onClick={() => removeItem(idx)} className="p-1 text-destructive hover:bg-destructive/10 rounded col-span-1">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <button onClick={addItem} className="flex items-center space-x-1.5 text-xs text-primary hover:underline">
                    <Plus className="h-3 w-3" /><span>Ajouter un article</span>
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Notes</label>
                <textarea className={inputCls} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Notes internes..." />
              </div>
            </div>
            <div className="flex space-x-2 pt-1">
              <button onClick={() => setShowModal(false)} className="flex-1 px-3 py-1.5 text-sm border border-input rounded-lg hover:bg-accent text-foreground">Annuler</button>
              <button onClick={handleSave} disabled={isSaving}
                className="flex-1 flex items-center justify-center space-x-1.5 px-3 py-1.5 text-sm bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg disabled:opacity-50">
                {isSaving ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                <span>Créer</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
