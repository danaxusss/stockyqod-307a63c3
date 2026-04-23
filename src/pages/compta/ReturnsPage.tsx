import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RotateCcw, Plus, Trash2, X, Check, Loader, ChevronDown, ChevronUp, Lock, Unlock, Search, Pencil } from 'lucide-react';
import { Return, ReturnItem, Product } from '../../types';
import { SupabaseReturnsService } from '../../utils/supabaseReturns';
import { SupabaseClientsService } from '../../utils/supabaseClients';
import { CompanySettingsService } from '../../utils/companySettings';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../hooks/useAuth';
import { getCompanyContext } from '../../utils/supabaseCompanyFilter';
import { ProductSearchModal } from '../../components/ProductSearchModal';

const inputCls = 'w-full px-2 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary';

const EMPTY_FORM = {
  reference_number: '',
  client_name: '',
  reason: '',
  notes: '',
  items: [{ barcode: '', label: '', quantity: 1 }] as ReturnItem[],
};

type SortField = 'date' | 'reference';
type SortDir = 'asc' | 'desc';

export default function ReturnsPage() {
  const { showToast } = useToast();
  const { isSuperAdmin, isCompta } = useAuth();
  const [returns, setReturns] = useState<Return[]>([]);
  const [clientCodeMap, setClientCodeMap] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);

  // Create / Edit modal
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  // Product search modal
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [productSearchTarget, setProductSearchTarget] = useState<number | null>(null);

  // Expand
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Search / sort
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  // PIN modal (unlock before edit)
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pendingEditId, setPendingEditId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [data, clients] = await Promise.all([
        SupabaseReturnsService.getAll(),
        SupabaseClientsService.getAllClients().catch(() => []),
      ]);
      setReturns(data);
      const map: Record<string, string> = {};
      clients.forEach(c => { if (c.client_code) map[c.full_name.toLowerCase()] = c.client_code; });
      setClientCodeMap(map);
    } catch {
      showToast({ type: 'error', message: 'Erreur chargement retours' });
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = q
      ? returns.filter(r => {
          const code = (clientCodeMap[r.client_name.toLowerCase()] || '').toLowerCase();
          return r.reference_number.toLowerCase().includes(q) ||
            r.client_name.toLowerCase().includes(q) ||
            code.includes(q);
        })
      : returns;
    list = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'date') cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      else cmp = a.reference_number.localeCompare(b.reference_number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [returns, search, sortField, sortDir, clientCodeMap]);

  useEffect(() => { setPage(1); }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEdit = (ret: Return) => {
    setEditingId(ret.id);
    setForm({
      reference_number: ret.reference_number,
      client_name: ret.client_name,
      reason: ret.reason,
      notes: ret.notes || '',
      items: ret.items.length ? ret.items : [{ barcode: '', label: '', quantity: 1 }],
    });
    setShowModal(true);
  };

  const requestEdit = (ret: Return) => {
    if (ret.is_locked) {
      setPendingEditId(ret.id);
      setPinInput('');
      setShowPinModal(true);
    } else {
      openEdit(ret);
    }
  };

  const confirmPin = async () => {
    if (!pendingEditId) return;
    const { companyId } = getCompanyContext();
    try {
      const expectedPin = await CompanySettingsService.resolveSpecialPin(companyId);
      if (!expectedPin || pinInput !== expectedPin) {
        showToast({ type: 'error', message: 'PIN incorrect' });
        return;
      }
      setShowPinModal(false);
      const ret = returns.find(r => r.id === pendingEditId);
      if (ret) openEdit(ret);
    } catch {
      showToast({ type: 'error', message: 'Erreur vérification PIN' });
    }
  };

  const handleSave = async () => {
    if (!form.reference_number.trim() || !form.client_name.trim()) {
      showToast({ type: 'error', message: 'Numéro de référence et client requis' });
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        reference_number: form.reference_number.trim(),
        client_name: form.client_name.trim(),
        reason: form.reason.trim(),
        notes: form.notes.trim() || undefined,
        items: form.items.filter(i => i.label.trim()),
      };
      if (editingId) {
        await SupabaseReturnsService.update(editingId, payload);
        showToast({ type: 'success', message: 'Retour mis à jour' });
      } else {
        await SupabaseReturnsService.create(payload);
        showToast({ type: 'success', message: 'Retour créé' });
      }
      setShowModal(false);
      await load();
    } catch (e: any) {
      showToast({ type: 'error', message: e?.message || 'Erreur' });
    } finally {
      setIsSaving(false);
    }
  };

  const toggleLock = async (ret: Return) => {
    try {
      await SupabaseReturnsService.update(ret.id, { is_locked: !ret.is_locked });
      await load();
    } catch {
      showToast({ type: 'error', message: 'Erreur verrouillage' });
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

  const openProductSearch = (idx: number) => { setProductSearchTarget(idx); setShowProductSearch(true); };
  const onProductSelected = (p: Product) => {
    if (productSearchTarget === null) return;
    updateItem(productSearchTarget, 'label', p.name);
    updateItem(productSearchTarget, 'barcode', p.barcode || '');
    setShowProductSearch(false);
    setProductSearchTarget(null);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? <ChevronUp className="h-3 w-3 inline ml-0.5" /> : <ChevronDown className="h-3 w-3 inline ml-0.5" />;
  };

  if (!isSuperAdmin && !isCompta) {
    return <div className="text-center py-12 text-muted-foreground">Accès réservé.</div>;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="glass rounded-xl shadow-lg p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-primary rounded-lg" style={{ boxShadow: 'var(--shadow-glow)' }}>
              <RotateCcw className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Retours</h1>
              <p className="text-xs text-muted-foreground">{filtered.length} retour{filtered.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Rechercher..."
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring"
              />
            </div>
            <button onClick={openCreate} className="flex items-center space-x-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm whitespace-nowrap">
              <Plus className="h-3.5 w-3.5" /><span>Nouveau</span>
            </button>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="glass rounded-xl shadow-lg overflow-hidden">
        {/* Sort header */}
        <div className="px-4 py-2 border-b border-border bg-secondary/30 flex items-center gap-4 text-[11px] text-muted-foreground">
          <button onClick={() => toggleSort('reference')} className="hover:text-foreground font-medium">
            Référence <SortIcon field="reference" />
          </button>
          <span className="flex-1" />
          <button onClick={() => toggleSort('date')} className="hover:text-foreground font-medium">
            Date <SortIcon field="date" />
          </button>
        </div>

        {isLoading ? (
          <div className="p-8 text-center"><Loader className="h-6 w-6 animate-spin text-primary mx-auto" /></div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <RotateCcw className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Aucun retour enregistré</p>
          </div>
        ) : (
          <>
          <div className="divide-y divide-border">
            {paginated.map(ret => (
              <div key={ret.id}>
                <div className="px-4 py-3 flex items-center gap-2">
                  <button onClick={() => setExpandedId(expandedId === ret.id ? null : ret.id)}
                    className="text-muted-foreground hover:text-foreground flex-shrink-0">
                    {expandedId === ret.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono font-semibold text-foreground">{ret.reference_number}</span>
                      {ret.is_locked && <span className="text-sm" title="Verrouillé">🔒</span>}
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${ret.status === 'open' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'}`}>
                        {ret.status === 'open' ? 'Ouvert' : 'Clôturé'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {ret.client_name}
                      {clientCodeMap[ret.client_name.toLowerCase()] && (
                        <span className="ml-1.5 text-[9px] font-mono bg-blue-500/10 text-blue-600 dark:text-blue-400 px-1 py-0.5 rounded">{clientCodeMap[ret.client_name.toLowerCase()]}</span>
                      )}
                      {' — '}{ret.reason || '—'}
                    </p>
                  </div>
                  <span className="text-[11px] text-muted-foreground flex-shrink-0">{new Date(ret.created_at).toLocaleDateString('fr-FR')}</span>
                  <button
                    onClick={() => toggleLock(ret)}
                    className={`p-1 rounded hover:bg-accent flex-shrink-0 ${ret.is_locked ? 'text-amber-500' : 'text-muted-foreground'}`}
                    title={ret.is_locked ? 'Déverrouiller' : 'Verrouiller'}
                  >
                    {ret.is_locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                  </button>
                  <button onClick={() => requestEdit(ret)} className="p-1 text-muted-foreground hover:bg-accent rounded flex-shrink-0" title="Modifier">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => toggleStatus(ret)}
                    className="px-2 py-1 text-xs border border-border rounded hover:bg-accent text-muted-foreground flex-shrink-0">
                    {ret.status === 'open' ? 'Clôturer' : 'Rouvrir'}
                  </button>
                  <button onClick={() => handleDelete(ret.id)} className="p-1 text-destructive hover:bg-destructive/10 rounded flex-shrink-0">
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
          <div className="px-4 py-2.5 border-t border-border flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Afficher</span>
              <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} className="px-2 py-1 text-xs border border-input rounded bg-background text-foreground">
                {[20, 30, 50].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <span className="text-xs text-muted-foreground">/ {filtered.length}</span>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-1.5">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-2 py-1 text-xs border border-border rounded hover:bg-accent disabled:opacity-50">Préc.</button>
                <span className="px-2 text-xs text-muted-foreground">{page}/{totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-2 py-1 text-xs border border-border rounded hover:bg-accent disabled:opacity-50">Suiv.</button>
              </div>
            )}
          </div>
          </>
        )}
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 bg-black/50 backdrop-blur-sm p-4">
          <div className="glass rounded-xl shadow-2xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-foreground">{editingId ? 'Modifier le retour' : 'Nouveau retour'}</h2>
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
                    <div key={idx} className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => openProductSearch(idx)}
                        className="flex-shrink-0 px-2 py-1.5 text-xs border border-dashed border-primary/40 rounded-lg text-primary hover:bg-primary/10"
                        title="Chercher un produit"
                      >
                        <Search className="h-3.5 w-3.5" />
                      </button>
                      <input className={`${inputCls} flex-1`} value={item.label} onChange={e => updateItem(idx, 'label', e.target.value)} placeholder="Désignation *" />
                      <input className={`${inputCls} w-28`} value={item.barcode} onChange={e => updateItem(idx, 'barcode', e.target.value)} placeholder="Code-barres" />
                      <input type="number" min="1" className={`${inputCls} w-16`} value={item.quantity} onChange={e => updateItem(idx, 'quantity', Math.max(1, Number(e.target.value)))} />
                      <button onClick={() => removeItem(idx)} className="p-1 text-destructive hover:bg-destructive/10 rounded flex-shrink-0">
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
                <span>{editingId ? 'Sauvegarder' : 'Créer'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Product search modal */}
      {showProductSearch && (
        <ProductSearchModal onSelect={onProductSelected} onClose={() => { setShowProductSearch(false); setProductSearchTarget(null); }} />
      )}

      {/* PIN modal */}
      {showPinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="glass rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-amber-500" />
              <h2 className="text-sm font-bold text-foreground">Retour verrouillé</h2>
            </div>
            <p className="text-xs text-muted-foreground">Saisissez le PIN spécial pour modifier ce retour.</p>
            <input
              type="password"
              value={pinInput}
              onChange={e => setPinInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && confirmPin()}
              placeholder="PIN"
              className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring tracking-widest"
              autoFocus
            />
            <div className="flex space-x-2">
              <button onClick={() => setShowPinModal(false)} className="flex-1 px-3 py-1.5 text-sm border border-input rounded-lg hover:bg-accent text-foreground">Annuler</button>
              <button onClick={confirmPin} disabled={!pinInput} className="flex-1 px-3 py-1.5 text-sm bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-lg">Débloquer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
