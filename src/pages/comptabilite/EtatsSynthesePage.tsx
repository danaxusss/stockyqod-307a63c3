import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { FileBarChart, Loader, Download } from 'lucide-react';
import type { Account, FiscalYear } from '../../types';
import { AccountingService } from '../../utils/supabaseAccounting';
import { useToast } from '../../context/ToastContext';

function fmt(n: number) { return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n); }

export default function EtatsSynthesePage() {
  const { showToast } = useToast();
  const [fy, setFy] = useState<FiscalYear | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [lines, setLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'bilan' | 'cpc'>('cpc');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const year = await AccountingService.ensureCurrentFiscalYear();
      setFy(year);
      const [a, l] = await Promise.all([AccountingService.listAccounts(), AccountingService.getPostedLines(year.id)]);
      setAccounts(a); setLines(l);
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const labelOf = useMemo(() => new Map(accounts.map(a => [a.code, a.label])), [accounts]);

  // balance (debit - credit) per account code
  const balances = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) {
      m.set(l.account_code, (m.get(l.account_code) || 0) + (Number(l.debit) || 0) - (Number(l.credit) || 0));
    }
    return m;
  }, [lines]);

  const byClass = useCallback((cls: number) => Array.from(balances.entries()).filter(([code]) => Number(String(code)[0]) === cls), [balances]);

  const cpc = useMemo(() => {
    const produits = byClass(7).map(([code, bal]) => ({ code, label: labelOf.get(code) || '', amount: -bal })).filter(r => Math.abs(r.amount) > 0.005);
    const charges = byClass(6).map(([code, bal]) => ({ code, label: labelOf.get(code) || '', amount: bal })).filter(r => Math.abs(r.amount) > 0.005);
    const totalProduits = produits.reduce((s, r) => s + r.amount, 0);
    const totalCharges = charges.reduce((s, r) => s + r.amount, 0);
    return { produits, charges, totalProduits, totalCharges, resultat: totalProduits - totalCharges };
  }, [byClass, labelOf]);

  const bilan = useMemo(() => {
    const immob = byClass(2).reduce((s, [, b]) => s + b, 0);
    const actifCirc = byClass(3).reduce((s, [, b]) => s + b, 0);
    const treso = byClass(5).reduce((s, [, b]) => s + b, 0);
    const tresoActif = Math.max(0, treso), tresoPassif = Math.max(0, -treso);
    const capitaux = -byClass(1).reduce((s, [, b]) => s + b, 0);
    const dettes = -byClass(4).reduce((s, [, b]) => s + b, 0);
    const resultat = cpc.resultat;
    const totalActif = immob + actifCirc + tresoActif;
    const totalPassif = capitaux + resultat + dettes + tresoPassif;
    return { immob, actifCirc, tresoActif, capitaux, dettes, tresoPassif, resultat, totalActif, totalPassif };
  }, [byClass, cpc.resultat]);

  const exportCsv = () => {
    let rows: string[] = [];
    if (tab === 'cpc') {
      rows.push('CPC;Montant');
      cpc.produits.forEach(r => rows.push(`${r.code} ${r.label};${r.amount.toFixed(2)}`));
      rows.push(`TOTAL PRODUITS;${cpc.totalProduits.toFixed(2)}`);
      cpc.charges.forEach(r => rows.push(`${r.code} ${r.label};${r.amount.toFixed(2)}`));
      rows.push(`TOTAL CHARGES;${cpc.totalCharges.toFixed(2)}`);
      rows.push(`RESULTAT NET;${cpc.resultat.toFixed(2)}`);
    } else {
      rows.push('Bilan;Montant');
      rows.push(`Immobilisations (net);${bilan.immob.toFixed(2)}`);
      rows.push(`Actif circulant;${bilan.actifCirc.toFixed(2)}`);
      rows.push(`Trésorerie-Actif;${bilan.tresoActif.toFixed(2)}`);
      rows.push(`TOTAL ACTIF;${bilan.totalActif.toFixed(2)}`);
      rows.push(`Capitaux propres;${bilan.capitaux.toFixed(2)}`);
      rows.push(`Résultat net;${bilan.resultat.toFixed(2)}`);
      rows.push(`Dettes du passif circulant;${bilan.dettes.toFixed(2)}`);
      rows.push(`Trésorerie-Passif;${bilan.tresoPassif.toFixed(2)}`);
      rows.push(`TOTAL PASSIF;${bilan.totalPassif.toFixed(2)}`);
    }
    const url = URL.createObjectURL(new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = `${tab}-${fy?.label || ''}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  if (loading) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>;

  const Line = ({ label, amount, bold, muted }: { label: string; amount: number; bold?: boolean; muted?: boolean }) => (
    <div className={`flex justify-between py-1.5 px-3 ${bold ? 'font-semibold border-t border-border/60 bg-secondary/30' : ''}`}>
      <span className={muted ? 'text-muted-foreground text-sm' : 'text-sm'}>{label}</span>
      <span className="tabular-nums text-sm">{fmt(amount)}</span>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto py-6 px-3">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10"><FileBarChart className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">États de synthèse</h1>
            <p className="text-xs text-muted-foreground">Modèle simplifié · exercice {fy?.label}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button onClick={() => setTab('cpc')} className={`px-3 py-1.5 text-xs font-medium ${tab === 'cpc' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>CPC</button>
            <button onClick={() => setTab('bilan')} className={`px-3 py-1.5 text-xs font-medium ${tab === 'bilan' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>Bilan</button>
          </div>
          <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary border border-border text-sm"><Download className="h-3.5 w-3.5" /> CSV</button>
        </div>
      </div>

      {tab === 'cpc' ? (
        <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
          <div className="px-3 py-2 bg-secondary/50 border-b border-border/60 text-sm font-semibold">Produits</div>
          {cpc.produits.map(r => <Line key={r.code} label={`${r.code} — ${r.label}`} amount={r.amount} muted />)}
          <Line label="Total produits" amount={cpc.totalProduits} bold />
          <div className="px-3 py-2 bg-secondary/50 border-y border-border/60 text-sm font-semibold">Charges</div>
          {cpc.charges.map(r => <Line key={r.code} label={`${r.code} — ${r.label}`} amount={r.amount} muted />)}
          <Line label="Total charges" amount={cpc.totalCharges} bold />
          <div className={`flex justify-between py-2.5 px-3 font-bold border-t-2 border-border ${cpc.resultat >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            <span>Résultat net {cpc.resultat >= 0 ? '(bénéfice)' : '(perte)'}</span>
            <span className="tabular-nums">{fmt(cpc.resultat)}</span>
          </div>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
            <div className="px-3 py-2 bg-secondary/50 border-b border-border/60 text-sm font-semibold">Actif</div>
            <Line label="Immobilisations (net)" amount={bilan.immob} />
            <Line label="Actif circulant" amount={bilan.actifCirc} />
            <Line label="Trésorerie - Actif" amount={bilan.tresoActif} />
            <Line label="Total Actif" amount={bilan.totalActif} bold />
          </div>
          <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
            <div className="px-3 py-2 bg-secondary/50 border-b border-border/60 text-sm font-semibold">Passif</div>
            <Line label="Capitaux propres" amount={bilan.capitaux} />
            <Line label="Résultat net de l'exercice" amount={bilan.resultat} />
            <Line label="Dettes du passif circulant" amount={bilan.dettes} />
            <Line label="Trésorerie - Passif" amount={bilan.tresoPassif} />
            <Line label="Total Passif" amount={bilan.totalPassif} bold />
          </div>
          {Math.abs(bilan.totalActif - bilan.totalPassif) > 0.5 && (
            <div className="md:col-span-2 text-xs text-amber-600 dark:text-amber-400">
              ⚠ Écart Actif/Passif de {fmt(Math.abs(bilan.totalActif - bilan.totalPassif))} — écritures d'à-nouveaux ou de régularisation manquantes.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
