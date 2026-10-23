import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Loader, Plus, Save, Trash2, X } from 'lucide-react';
import type { BusinessSector } from '../types';
import { BusinessSectorsService } from '../utils/businessSectors';
import { useToast } from '../context/ToastContext';
import { useEscapeKey } from '../hooks/useShortcuts';

type Draft = { name: string; name_en: string; name_ar: string };

const draftOf = (sector: BusinessSector): Draft => ({ name: sector.name, name_en: sector.name_en || '', name_ar: sector.name_ar || '' });

/** Add, rename, translate (for the kiosk) and delete business sectors. */
export function SectorManagerDialog({ sectors, productCounts, canDelete = true, onClose }: {
  sectors: BusinessSector[];
  productCounts: Record<string, number>;
  /** Deleting is kept for admins/managers; others may only add and rename. */
  canDelete?: boolean;
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  useEscapeKey(onClose, true);

  useEffect(() => {
    // Keep unsaved edits, pick up sectors added or renamed elsewhere.
    setDrafts(current => Object.fromEntries(sectors.map(sector => [sector.id, current[sector.id] || draftOf(sector)])));
  }, [sectors]);

  const changed = (sector: BusinessSector) => {
    const draft = drafts[sector.id];
    if (!draft) return false;
    const saved = draftOf(sector);
    return draft.name.trim() !== saved.name || draft.name_en.trim() !== saved.name_en || draft.name_ar.trim() !== saved.name_ar;
  };

  const save = async (sector: BusinessSector) => {
    const draft = drafts[sector.id];
    if (!draft.name.trim()) { showToast({ type: 'error', message: 'Le nom du secteur est obligatoire.' }); return; }
    setBusyId(sector.id);
    try {
      await BusinessSectorsService.update(sector.id, draft);
      setDrafts(current => ({ ...current, [sector.id]: { name: draft.name.trim(), name_en: draft.name_en.trim(), name_ar: draft.name_ar.trim() } }));
      showToast({ type: 'success', message: `Secteur « ${draft.name.trim()} » enregistré` });
    } catch (error) {
      showToast({ type: 'error', title: 'Enregistrement impossible', message: error instanceof Error ? error.message : 'Erreur inconnue' });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (sector: BusinessSector) => {
    const count = productCounts[sector.id] || 0;
    const warning = count ? ` Il sera retiré de ${count} produit(s).` : '';
    if (!window.confirm(`Supprimer le secteur « ${sector.name} » ?${warning}`)) return;
    setBusyId(sector.id);
    try {
      await BusinessSectorsService.remove(sector.id);
      showToast({ type: 'success', message: `Secteur « ${sector.name} » supprimé` });
    } catch (error) {
      showToast({ type: 'error', title: 'Suppression impossible', message: error instanceof Error ? error.message : 'Erreur inconnue' });
    } finally {
      setBusyId(null);
    }
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!newName.trim() || adding) return;
    setAdding(true);
    try {
      await BusinessSectorsService.create(newName);
      setNewName('');
    } catch (error) {
      showToast({ type: 'error', title: 'Ajout impossible', message: error instanceof Error ? error.message : 'Erreur inconnue' });
    } finally {
      setAdding(false);
    }
  };

  const setDraft = (id: string, values: Partial<Draft>) => setDrafts(current => ({ ...current, [id]: { ...current[id], ...values } }));

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="sector-manager-title" className="flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 id="sector-manager-title" className="text-base font-semibold text-foreground">Secteurs d’activité</h2>
            <p className="text-xs text-muted-foreground">Utilisés pour filtrer les produits dans Stocky et sur le kiosque. Les traductions sont facultatives (kiosque en anglais / arabe).</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Fermer"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_70px_auto] gap-2 px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:grid">
            <span>Nom</span><span>Anglais</span><span>Arabe</span><span className="text-right">Produits</span><span />
          </div>
          <div className="space-y-2">
            {sectors.map(sector => {
              const draft = drafts[sector.id] || draftOf(sector);
              const busy = busyId === sector.id;
              return (
                <div key={sector.id} className="grid grid-cols-2 items-center gap-2 rounded-lg border border-border p-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_70px_auto] sm:border-0 sm:p-1">
                  <input value={draft.name} onChange={event => setDraft(sector.id, { name: event.target.value })} maxLength={60} aria-label={`Nom du secteur ${sector.name}`} className="col-span-2 rounded-md border border-input bg-background px-2 py-1.5 text-sm sm:col-span-1" />
                  <input value={draft.name_en} onChange={event => setDraft(sector.id, { name_en: event.target.value })} placeholder={sector.name} maxLength={60} aria-label={`Nom anglais du secteur ${sector.name}`} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
                  <input value={draft.name_ar} onChange={event => setDraft(sector.id, { name_ar: event.target.value })} placeholder={sector.name} maxLength={60} dir="rtl" aria-label={`Nom arabe du secteur ${sector.name}`} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
                  <span className="text-xs text-muted-foreground sm:text-right">{productCounts[sector.id] || 0} produit(s)</span>
                  <div className="flex justify-end gap-1">
                    <button onClick={() => save(sector)} disabled={!changed(sector) || busy} aria-label={`Enregistrer ${sector.name}`} className="rounded-md p-1.5 text-primary hover:bg-primary/10 disabled:opacity-30">{busy ? <Loader className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}</button>
                    {canDelete && <button onClick={() => remove(sector)} disabled={busy} aria-label={`Supprimer ${sector.name}`} className="rounded-md p-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>}
                  </div>
                </div>
              );
            })}
            {!sectors.length && <p className="py-6 text-center text-sm text-muted-foreground">Aucun secteur.</p>}
          </div>
        </div>
        <form onSubmit={add} className="flex gap-2 border-t border-border p-4">
          <input value={newName} onChange={event => setNewName(event.target.value)} maxLength={60} placeholder="Nouveau secteur (ex. Boulangerie)" aria-label="Nouveau secteur" className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm" />
          <button type="submit" disabled={!newName.trim() || adding} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{adding ? <Loader className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Ajouter</button>
        </form>
      </div>
    </div>,
    document.body,
  );
}
