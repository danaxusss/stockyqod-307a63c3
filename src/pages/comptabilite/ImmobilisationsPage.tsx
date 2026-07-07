import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Building, Plus, Loader, Trash2, Check, X, Zap } from 'lucide-react';
import { AssetsService, type FixedAsset } from '../../utils/supabaseAssets';
import { AccountingService } from '../../utils/supabaseAccounting';
import type { FiscalYear, Journal } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

function fmt(n: number) { return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n); }

export default function ImmobilisationsPage() {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [fy, setFy] = useState<FiscalYear | null>(null);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ label: '', account_code: '2340', acquisition_date: new Date().toISOString().slice(0, 10), amount: '', duration_years: '5', depreciation_account_code: '2834', expense_account_code: '6191' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, year, j] = await Promise.all([AssetsService.list(), AccountingService.ensureCurrentFiscalYear(), AccountingService.listJournals()]);
      setAssets(a); setFy(year); setJournals(j);
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const year = fy ? Number(fy.label) : new Date().getFullYear();

  const save = async () => {
    if (!form.label.trim() || !Number(form.amount)) { showToast({ type: 'error', message: 'Libellé et montant requis' }); return; }
    setBusy(true);
    try {
      await AssetsService.create({
        label: form.label.trim(), account_code: form.account_code, acquisition_date: form.acquisition_date,
        amount: Number(form.amount), duration_years: Number(form.duration_years) || 5,
        depreciation_account_code: form.depreciation_account_code, expense_account_code: form.expense_account_code,
        created_by: currentUser?.username || null,
      });
      showToast({ type: 'success', message: 'Immobilisation ajoutée' });
      setAdding(false); setForm({ ...form, label: '', amount: '' });
      await load();
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };

  const dotation = async (a: FixedAsset) => {
    if (!fy) return;
    setBusy(true);
    try {
      await AssetsService.generateDotation(a, year, fy.id, journals, currentUser?.username || null);
      showToast({ type: 'success', title: 'Dotation générée', message: `Amortissement ${year} comptabilisé` });
      await load();
    } catch (e: any) { showToast({ type: 'error', title: 'Erreur', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };

  const remove = async (a: FixedAsset) => {
    if (!confirm(`Supprimer l'immobilisation « ${a.label} » ? (les écritures d'amortissement restent)`)) return;
    try { await AssetsService.remove(a.id); await load(); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
  };

  if (loading) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>;

  return (
    <div className="max-w-4xl mx-auto py-6 px-3">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10"><Building className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">Immobilisations</h1>
            <p className="text-xs text-muted-foreground">Amortissement linéaire · exercice {fy?.label}</p>
          </div>
        </div>
        <button onClick={() => setAdding(v => !v)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"><Plus className="h-4 w-4" /> Immobilisation</button>
      </div>

      {adding && (
        <div className="bg-card border border-primary/30 rounded-xl p-3 mb-4 grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
          <div className="col-span-2"><label className="block text-[11px] text-muted-foreground mb-1">Libellé</label>
            <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" /></div>
          <div><label className="block text-[11px] text-muted-foreground mb-1">Montant HT</label>
            <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" /></div>
          <div><label className="block text-[11px] text-muted-foreground mb-1">Durée (ans)</label>
            <input type="number" value={form.duration_years} onChange={e => setForm(f => ({ ...f, duration_years: e.target.value }))} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" /></div>
          <div><label className="block text-[11px] text-muted-foreground mb-1">Acquisition</label>
            <input type="date" value={form.acquisition_date} onChange={e => setForm(f => ({ ...f, acquisition_date: e.target.value }))} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" /></div>
          <div><label className="block text-[11px] text-muted-foreground mb-1">Cpte immo</label>
            <input value={form.account_code} onChange={e => setForm(f => ({ ...f, account_code: e.target.value }))} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border font-mono" /></div>
          <div><label className="block text-[11px] text-muted-foreground mb-1">Cpte amort.</label>
            <input value={form.depreciation_account_code} onChange={e => setForm(f => ({ ...f, depreciation_account_code: e.target.value }))} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border font-mono" /></div>
          <div className="flex gap-1">
            <button onClick={save} disabled={busy} className="flex-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm disabled:opacity-50">{busy ? '…' : <Check className="h-4 w-4 mx-auto" />}</button>
            <button onClick={() => setAdding(false)} className="px-2 py-1.5 rounded-lg bg-secondary border border-border"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-secondary/50 text-xs text-muted-foreground">
                <th className="text-left font-medium px-3 py-2.5">Immobilisation</th>
                <th className="text-right font-medium px-3 py-2.5">Montant</th>
                <th className="text-right font-medium px-3 py-2.5">Dotation/an</th>
                <th className="text-right font-medium px-3 py-2.5">Amort. cumulé</th>
                <th className="text-right font-medium px-3 py-2.5">VNC</th>
                <th className="text-right font-medium px-3 py-2.5 w-40">Exercice {year}</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {assets.map(a => {
                const annual = AssetsService.annualAmount(a);
                const cum = AssetsService.cumulative(a);
                const vnc = Math.max(0, Number(a.amount) - cum);
                const doneThisYear = (a.depreciations || []).some(d => d.year === year);
                const fullyAmortized = vnc <= (Number(a.salvage) || 0) + 0.005;
                return (
                  <tr key={a.id} className="border-b border-border/40">
                    <td className="px-3 py-2">
                      <div className="font-medium text-foreground">{a.label}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{a.account_code} · {a.duration_years} ans · dep. {new Date(a.acquisition_date).toLocaleDateString('fr-FR')}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(Number(a.amount))}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmt(annual)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmt(cum)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{fmt(vnc)}</td>
                    <td className="px-3 py-2 text-right">
                      {doneThisYear ? <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">Dotation faite</span>
                        : fullyAmortized ? <span className="text-[11px] text-muted-foreground">Amorti</span>
                        : <button onClick={() => dotation(a)} disabled={busy} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"><Zap className="h-3 w-3" /> Générer</button>}
                    </td>
                    <td className="px-2 text-center"><button onClick={() => remove(a)} className="p-1 text-muted-foreground hover:bg-secondary rounded"><Trash2 className="h-3.5 w-3.5" /></button></td>
                  </tr>
                );
              })}
              {assets.length === 0 && <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">Aucune immobilisation</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
