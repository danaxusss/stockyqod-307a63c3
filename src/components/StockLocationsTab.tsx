import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Check, X, Loader } from 'lucide-react';
import { Provider, StockLocation } from '../types';
import { StockLocationsService } from '../utils/supabaseStockLocations';
import { useToast } from '../context/ToastContext';

interface Props {
  companyId: string | null;
}

export function StockLocationsTab({ companyId }: Props) {
  const { showToast } = useToast();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [loading, setLoading] = useState(true);

  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [editingLocation, setEditingLocation] = useState<string | null>(null);
  const [newProviderForm, setNewProviderForm] = useState<{ name: string; abbreviation: string } | null>(null);
  const [newLocationForm, setNewLocationForm] = useState<{ name: string; abbreviation: string; provider_id: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, any>>({});

  const load = async () => {
    setLoading(true);
    try {
      const [p, l] = await Promise.all([
        StockLocationsService.getProviders(),
        StockLocationsService.getStockLocations(),
      ]);
      setProviders(p);
      setLocations(l);
    } catch {
      showToast({ type: 'error', message: 'Erreur lors du chargement des emplacements' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // ── Providers ──────────────────────────────────────────────────

  const saveProvider = async (id?: string) => {
    setSaving(true);
    try {
      const vals = id ? editValues[id] : newProviderForm;
      if (!vals?.name?.trim()) return;
      await StockLocationsService.upsertProvider({ id, name: vals.name.trim(), abbreviation: vals.abbreviation?.trim() || '' });
      setEditingProvider(null);
      setNewProviderForm(null);
      await load();
      showToast({ type: 'success', message: 'Fournisseur sauvegardé' });
    } catch {
      showToast({ type: 'error', message: 'Erreur sauvegarde fournisseur' });
    } finally {
      setSaving(false);
    }
  };

  const deleteProvider = async (id: string) => {
    if (!confirm('Supprimer ce fournisseur ?')) return;
    try {
      await StockLocationsService.deleteProvider(id);
      await load();
      showToast({ type: 'success', message: 'Fournisseur supprimé' });
    } catch {
      showToast({ type: 'error', message: 'Erreur suppression' });
    }
  };

  // ── Stock Locations ────────────────────────────────────────────

  const saveLocation = async (id?: string) => {
    setSaving(true);
    try {
      const vals = id ? editValues[id] : newLocationForm;
      if (!vals?.name?.trim()) return;
      await StockLocationsService.upsertStockLocation({
        id,
        name: vals.name.trim(),
        abbreviation: vals.abbreviation?.trim() || '',
        provider_id: vals.provider_id || undefined,
      });
      setEditingLocation(null);
      setNewLocationForm(null);
      await load();
      showToast({ type: 'success', message: 'Emplacement sauvegardé' });
    } catch {
      showToast({ type: 'error', message: 'Erreur sauvegarde emplacement' });
    } finally {
      setSaving(false);
    }
  };

  const deleteLocation = async (id: string) => {
    if (!confirm('Supprimer cet emplacement ?')) return;
    try {
      await StockLocationsService.deleteStockLocation(id);
      await load();
      showToast({ type: 'success', message: 'Emplacement supprimé' });
    } catch {
      showToast({ type: 'error', message: 'Erreur suppression' });
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-12">
      <Loader className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );

  return (
    <div className="space-y-6">

      {/* ── PROVIDERS ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">Fournisseurs</h3>
          <button
            onClick={() => setNewProviderForm({ name: '', abbreviation: '' })}
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" /> Ajouter
          </button>
        </div>
        <div className="border border-border rounded-lg divide-y divide-border">
          {providers.map(p => (
            <div key={p.id} className="flex items-center gap-2 px-3 py-2">
              {editingProvider === p.id ? (
                <>
                  <input className="flex-1 px-2 py-1 text-sm border border-input rounded bg-background" value={editValues[p.id]?.name ?? p.name}
                    onChange={e => setEditValues(v => ({ ...v, [p.id]: { ...v[p.id], name: e.target.value } }))} placeholder="Nom" />
                  <input className="w-20 px-2 py-1 text-sm border border-input rounded bg-background" value={editValues[p.id]?.abbreviation ?? p.abbreviation}
                    onChange={e => setEditValues(v => ({ ...v, [p.id]: { ...v[p.id], abbreviation: e.target.value } }))} placeholder="Abrév." />
                  <button onClick={() => saveProvider(p.id)} disabled={saving} className="p-1 text-emerald-500 hover:bg-emerald-500/10 rounded"><Check className="h-3.5 w-3.5" /></button>
                  <button onClick={() => setEditingProvider(null)} className="p-1 text-muted-foreground hover:bg-accent rounded"><X className="h-3.5 w-3.5" /></button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm">{p.name}</span>
                  {p.abbreviation && <span className="text-xs text-muted-foreground font-mono">{p.abbreviation}</span>}
                  <button onClick={() => { setEditingProvider(p.id); setEditValues(v => ({ ...v, [p.id]: { name: p.name, abbreviation: p.abbreviation } })); }} className="p-1 text-primary hover:bg-primary/10 rounded text-xs">Modifier</button>
                  <button onClick={() => deleteProvider(p.id)} className="p-1 text-destructive hover:bg-destructive/10 rounded"><Trash2 className="h-3.5 w-3.5" /></button>
                </>
              )}
            </div>
          ))}
          {providers.length === 0 && !newProviderForm && (
            <p className="text-xs text-muted-foreground px-3 py-3">Aucun fournisseur. Cliquez sur Ajouter.</p>
          )}
          {newProviderForm !== null && (
            <div className="flex items-center gap-2 px-3 py-2 bg-muted/30">
              <input className="flex-1 px-2 py-1 text-sm border border-input rounded bg-background" value={newProviderForm.name}
                onChange={e => setNewProviderForm(f => f && ({ ...f, name: e.target.value }))} placeholder="Nom *" autoFocus />
              <input className="w-20 px-2 py-1 text-sm border border-input rounded bg-background" value={newProviderForm.abbreviation}
                onChange={e => setNewProviderForm(f => f && ({ ...f, abbreviation: e.target.value }))} placeholder="Abrév." />
              <button onClick={() => saveProvider()} disabled={saving} className="p-1 text-emerald-500 hover:bg-emerald-500/10 rounded"><Check className="h-3.5 w-3.5" /></button>
              <button onClick={() => setNewProviderForm(null)} className="p-1 text-muted-foreground hover:bg-accent rounded"><X className="h-3.5 w-3.5" /></button>
            </div>
          )}
        </div>
      </section>

      {/* ── STOCK LOCATIONS ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">Emplacements de stock</h3>
          <button
            onClick={() => setNewLocationForm({ name: '', abbreviation: '', provider_id: '' })}
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" /> Ajouter
          </button>
        </div>
        <div className="border border-border rounded-lg divide-y divide-border">
          {locations.map(loc => (
            <div key={loc.id} className="flex items-center gap-2 px-3 py-2">
              {editingLocation === loc.id ? (
                <>
                  <input className="flex-1 px-2 py-1 text-sm border border-input rounded bg-background" value={editValues[loc.id]?.name ?? loc.name}
                    onChange={e => setEditValues(v => ({ ...v, [loc.id]: { ...v[loc.id], name: e.target.value } }))} />
                  <input className="w-16 px-2 py-1 text-sm border border-input rounded bg-background" value={editValues[loc.id]?.abbreviation ?? loc.abbreviation}
                    onChange={e => setEditValues(v => ({ ...v, [loc.id]: { ...v[loc.id], abbreviation: e.target.value } }))} placeholder="Abrév." />
                  <select className="px-2 py-1 text-sm border border-input rounded bg-background" value={editValues[loc.id]?.provider_id ?? (loc.provider_id || '')}
                    onChange={e => setEditValues(v => ({ ...v, [loc.id]: { ...v[loc.id], provider_id: e.target.value } }))}>
                    <option value="">— Aucun —</option>
                    {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <button onClick={() => saveLocation(loc.id)} disabled={saving} className="p-1 text-emerald-500 hover:bg-emerald-500/10 rounded"><Check className="h-3.5 w-3.5" /></button>
                  <button onClick={() => setEditingLocation(null)} className="p-1 text-muted-foreground hover:bg-accent rounded"><X className="h-3.5 w-3.5" /></button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm font-medium">{loc.name}</span>
                  {loc.abbreviation && <span className="text-xs text-primary font-mono font-semibold">{loc.abbreviation}</span>}
                  {loc.provider_id && <span className="text-xs text-muted-foreground">{providers.find(p => p.id === loc.provider_id)?.name}</span>}
                  <button onClick={() => { setEditingLocation(loc.id); setEditValues(v => ({ ...v, [loc.id]: { name: loc.name, abbreviation: loc.abbreviation, provider_id: loc.provider_id || '' } })); }} className="p-1 text-primary hover:bg-primary/10 rounded text-xs">Modifier</button>
                  <button onClick={() => deleteLocation(loc.id)} className="p-1 text-destructive hover:bg-destructive/10 rounded"><Trash2 className="h-3.5 w-3.5" /></button>
                </>
              )}
            </div>
          ))}
          {locations.length === 0 && !newLocationForm && (
            <p className="text-xs text-muted-foreground px-3 py-3">Aucun emplacement. Cliquez sur Ajouter.</p>
          )}
          {newLocationForm !== null && (
            <div className="flex items-center gap-2 px-3 py-2 bg-muted/30">
              <input className="flex-1 px-2 py-1 text-sm border border-input rounded bg-background" value={newLocationForm.name}
                onChange={e => setNewLocationForm(f => f && ({ ...f, name: e.target.value }))} placeholder="Nom *" autoFocus />
              <input className="w-16 px-2 py-1 text-sm border border-input rounded bg-background" value={newLocationForm.abbreviation}
                onChange={e => setNewLocationForm(f => f && ({ ...f, abbreviation: e.target.value }))} placeholder="Abrév. *" />
              <select className="px-2 py-1 text-sm border border-input rounded bg-background" value={newLocationForm.provider_id}
                onChange={e => setNewLocationForm(f => f && ({ ...f, provider_id: e.target.value }))}>
                <option value="">— Fournisseur —</option>
                {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button onClick={() => saveLocation()} disabled={saving} className="p-1 text-emerald-500 hover:bg-emerald-500/10 rounded"><Check className="h-3.5 w-3.5" /></button>
              <button onClick={() => setNewLocationForm(null)} className="p-1 text-muted-foreground hover:bg-accent rounded"><X className="h-3.5 w-3.5" /></button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
