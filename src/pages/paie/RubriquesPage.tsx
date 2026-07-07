import React, { useEffect, useState, useCallback } from 'react';
import { FileText, Plus, Loader, Sparkles, Trash2, Check, X } from 'lucide-react';
import { RubriquesService, type Rubrique } from '../../utils/supabaseRubriques';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

const BASE_LABELS: Record<string, string> = { fixe: 'Fixe', pourcentage_base: '% du base', heures: 'Heures', formule: 'Formule' };

export default function RubriquesPage() {
  const { isPaie, isSuperAdmin } = useAuth();
  const { showToast } = useToast();
  const [rubriques, setRubriques] = useState<Rubrique[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ code: '', label: '', type: 'gain', base: 'fixe', rate: '0', soumis_cnss: true, soumis_ir: true, soumis_cimr: false, inclus_anciennete: false });

  const load = useCallback(async () => {
    setLoading(true);
    try { setRubriques(await RubriquesService.list()); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const initDefaults = async () => {
    setBusy(true);
    try { const n = await RubriquesService.initDefaults(); showToast({ type: 'success', message: `${n} rubrique(s) ajoutée(s)` }); await load(); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };

  const save = async () => {
    if (!form.code.trim() || !form.label.trim()) { showToast({ type: 'error', message: 'Code et libellé requis' }); return; }
    setBusy(true);
    try {
      await RubriquesService.upsert({ code: form.code.trim().toUpperCase(), label: form.label.trim(), type: form.type as any, base: form.base as any, rate: Number(form.rate) || 0, soumis_cnss: form.soumis_cnss, soumis_amo: form.soumis_cnss, soumis_ir: form.soumis_ir, soumis_cimr: form.soumis_cimr, inclus_anciennete: form.inclus_anciennete });
      showToast({ type: 'success', message: 'Rubrique enregistrée' });
      setAdding(false); setForm({ ...form, code: '', label: '' }); await load();
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };

  if (!isPaie && !isSuperAdmin) return <div className="text-center py-12 text-muted-foreground">Accès réservé au rôle Paie.</div>;

  return (
    <div className="max-w-4xl mx-auto py-6 px-3">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10"><FileText className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">Rubriques de paie</h1>
            <p className="text-xs text-muted-foreground">{rubriques.length} rubrique(s)</p>
          </div>
        </div>
        <div className="flex gap-2">
          {rubriques.length === 0 && <button onClick={initDefaults} disabled={busy} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary border border-border text-sm"><Sparkles className="h-4 w-4" /> Rubriques par défaut</button>}
          <button onClick={() => setAdding(v => !v)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"><Plus className="h-4 w-4" /> Rubrique</button>
        </div>
      </div>

      {adding && (
        <div className="bg-card border border-primary/30 rounded-xl p-3 mb-4 space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div><label className="block text-[11px] text-muted-foreground mb-1">Code</label><input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" /></div>
            <div className="col-span-2"><label className="block text-[11px] text-muted-foreground mb-1">Libellé</label><input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" /></div>
            <div><label className="block text-[11px] text-muted-foreground mb-1">Type</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border"><option value="gain">Gain</option><option value="retenue">Retenue</option></select></div>
          </div>
          <div className="flex flex-wrap gap-3 items-center text-xs">
            <label className="flex items-center gap-1"><input type="checkbox" checked={form.soumis_cnss} onChange={e => setForm(f => ({ ...f, soumis_cnss: e.target.checked }))} /> Soumis CNSS/AMO</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={form.soumis_ir} onChange={e => setForm(f => ({ ...f, soumis_ir: e.target.checked }))} /> Soumis IR</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={form.soumis_cimr} onChange={e => setForm(f => ({ ...f, soumis_cimr: e.target.checked }))} /> Soumis CIMR</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={form.inclus_anciennete} onChange={e => setForm(f => ({ ...f, inclus_anciennete: e.target.checked }))} /> Inclus ancienneté</label>
            <div className="ml-auto flex gap-1">
              <button onClick={save} disabled={busy} className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm disabled:opacity-50">{busy ? '…' : <Check className="h-4 w-4" />}</button>
              <button onClick={() => setAdding(false)} className="px-2 py-1.5 rounded-lg bg-secondary border border-border"><X className="h-4 w-4" /></button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>
      ) : (
        <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-secondary/50 text-xs text-muted-foreground border-b border-border/60">
              <th className="text-left font-medium px-3 py-2">Code</th>
              <th className="text-left font-medium px-3 py-2">Libellé</th>
              <th className="text-left font-medium px-3 py-2">Type</th>
              <th className="text-left font-medium px-3 py-2">Soumis à</th>
              <th className="w-8"></th>
            </tr></thead>
            <tbody>
              {rubriques.map(r => (
                <tr key={r.id} className="border-b border-border/40">
                  <td className="px-3 py-2 font-mono">{r.code}</td>
                  <td className="px-3 py-2">{r.label}</td>
                  <td className="px-3 py-2"><span className={`text-[11px] px-1.5 py-0.5 rounded ${r.type === 'gain' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/15 text-red-600 dark:text-red-400'}`}>{r.type === 'gain' ? 'Gain' : 'Retenue'}</span></td>
                  <td className="px-3 py-2 text-[11px] text-muted-foreground">{[r.soumis_cnss && 'CNSS', r.soumis_ir && 'IR', r.soumis_cimr && 'CIMR', r.inclus_anciennete && 'Anc.'].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-2 text-center"><button onClick={() => RubriquesService.remove(r.id).then(load)} className="p-1 text-muted-foreground hover:bg-secondary rounded"><Trash2 className="h-3.5 w-3.5" /></button></td>
                </tr>
              ))}
              {rubriques.length === 0 && <tr><td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">Aucune rubrique — cliquez « Rubriques par défaut »</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
