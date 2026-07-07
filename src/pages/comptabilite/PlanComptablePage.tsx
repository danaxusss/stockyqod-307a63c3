import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { BookMarked, Search, Plus, Loader, X, Check } from 'lucide-react';
import type { Account } from '../../types';
import { AccountingService } from '../../utils/supabaseAccounting';
import { useToast } from '../../context/ToastContext';

const CLASS_LABELS: Record<number, string> = {
  1: 'Financement permanent', 2: 'Actif immobilisé', 3: 'Actif circulant',
  4: 'Passif circulant', 5: 'Trésorerie', 6: 'Charges', 7: 'Produits', 8: 'Résultats',
};

export default function PlanComptablePage() {
  const { showToast } = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ code: '', label: '', vat_rate: '', lettrable: false });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setAccounts(await AccountingService.listAccounts()); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? accounts.filter(a => a.code.includes(q) || a.label.toLowerCase().includes(q)) : accounts;
    const byClass = new Map<number, Account[]>();
    list.forEach(a => { if (!byClass.has(a.class)) byClass.set(a.class, []); byClass.get(a.class)!.push(a); });
    return Array.from(byClass.entries()).sort((a, b) => a[0] - b[0]);
  }, [accounts, query]);

  const save = async () => {
    if (!/^\d{3,8}$/.test(form.code.trim())) { showToast({ type: 'error', message: 'Code invalide (3 à 8 chiffres)' }); return; }
    if (!form.label.trim()) { showToast({ type: 'error', message: 'Libellé requis' }); return; }
    const cls = Number(form.code.trim()[0]);
    const type = cls === 1 || cls === 4 ? 'bilan_passif' : cls === 2 || cls === 3 ? 'bilan_actif' : cls === 5 ? 'tresorerie' : cls === 6 ? 'charge' : 'produit';
    setSaving(true);
    try {
      await AccountingService.upsertAccount({
        code: form.code.trim(), label: form.label.trim(), class: cls, type,
        vat_rate: form.vat_rate ? Number(form.vat_rate) : null, lettrable: form.lettrable,
      } as any);
      showToast({ type: 'success', message: 'Compte enregistré' });
      setAdding(false); setForm({ code: '', label: '', vat_rate: '', lettrable: false });
      await load();
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setSaving(false); }
  };

  return (
    <div className="max-w-4xl mx-auto py-6 px-3">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10"><BookMarked className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">Plan comptable</h1>
            <p className="text-xs text-muted-foreground">{accounts.length} comptes (CGNC)</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Code ou libellé…"
              className="pl-8 pr-3 py-2 text-sm rounded-lg bg-secondary border border-border w-56 focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <button onClick={() => setAdding(v => !v)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
            <Plus className="h-4 w-4" /> Compte
          </button>
        </div>
      </div>

      {adding && (
        <div className="bg-card border border-primary/30 rounded-xl p-3 mb-4 grid grid-cols-1 sm:grid-cols-[110px_1fr_90px_auto] gap-2 items-end">
          <div><label className="block text-[11px] text-muted-foreground mb-1">Code</label>
            <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="ex: 6182" className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" /></div>
          <div><label className="block text-[11px] text-muted-foreground mb-1">Libellé</label>
            <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" /></div>
          <div><label className="block text-[11px] text-muted-foreground mb-1">TVA %</label>
            <input value={form.vat_rate} onChange={e => setForm(f => ({ ...f, vat_rate: e.target.value }))} placeholder="—" className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" /></div>
          <div className="flex gap-1">
            <button onClick={save} disabled={saving} className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm disabled:opacity-50">{saving ? '…' : <Check className="h-4 w-4" />}</button>
            <button onClick={() => setAdding(false)} className="px-2 py-1.5 rounded-lg bg-secondary border border-border"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>
      ) : (
        <div className="space-y-4">
          {filtered.map(([cls, list]) => (
            <div key={cls} className="bg-card border border-border/60 rounded-xl overflow-hidden">
              <div className="px-3 py-2 bg-secondary/50 text-xs font-semibold text-foreground border-b border-border/60">
                Classe {cls} — {CLASS_LABELS[cls] || ''}
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {list.map(a => (
                    <tr key={a.id} className="border-b border-border/40 last:border-0 hover:bg-secondary/30">
                      <td className="px-3 py-2 font-mono text-foreground w-24">{a.code}</td>
                      <td className="px-3 py-2 text-foreground">{a.label}</td>
                      <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                        {a.vat_rate != null && <span className="mr-2">TVA {a.vat_rate}%</span>}
                        {a.lettrable && <span className="px-1.5 py-0.5 rounded bg-secondary">lettrable</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
