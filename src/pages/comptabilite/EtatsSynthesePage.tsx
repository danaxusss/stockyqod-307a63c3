import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Download, AlertTriangle } from 'lucide-react';
import type { Account, FiscalYear } from '../../types';
import { AccountingService } from '../../utils/supabaseAccounting';
import { useToast } from '../../context/ToastContext';
import { PageHeader } from '../../components/PageHeader';
import { btnSecondary, LoadingState, panel, Segmented } from '../../components/backoffice/BackOfficeUi';

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

  if (loading) return <LoadingState />;

  const Line = ({ label, amount, bold, muted }: { label: string; amount: number; bold?: boolean; muted?: boolean }) => (
    <div className={`flex items-baseline justify-between gap-4 px-4 py-2.5 sm:px-5 ${bold ? 'bg-secondary/40 font-semibold' : ''}`}>
      <span className={`min-w-0 text-sm ${muted ? 'text-muted-foreground' : 'text-foreground'}`}>{label}</span>
      <span className="whitespace-nowrap text-sm tabular-nums text-foreground">{fmt(amount)}</span>
    </div>
  );
  const groupTitle = 'border-b border-border px-4 py-3 font-semibold text-foreground sm:px-5';

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="États de synthèse"
        subtitle={`Modèle simplifié · exercice ${fy?.label ?? ''}`}
        actions={<>
          <Segmented<'bilan' | 'cpc'> label="État affiché" value={tab} onChange={setTab}
            options={[{ value: 'cpc', label: 'CPC' }, { value: 'bilan', label: 'Bilan' }]} />
          <button onClick={exportCsv} className={btnSecondary}><Download className="h-4 w-4" /> CSV</button>
        </>}
      />

      {tab === 'cpc' ? (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <section className={`${panel} overflow-hidden`}>
            <h2 className={groupTitle}>Produits</h2>
            <div className="divide-y divide-border">
              {cpc.produits.map(r => <Line key={r.code} label={`${r.code} — ${r.label}`} amount={r.amount} muted />)}
              <Line label="Total produits" amount={cpc.totalProduits} bold />
            </div>
          </section>
          <section className={`${panel} overflow-hidden`}>
            <h2 className={groupTitle}>Charges</h2>
            <div className="divide-y divide-border">
              {cpc.charges.map(r => <Line key={r.code} label={`${r.code} — ${r.label}`} amount={r.amount} muted />)}
              <Line label="Total charges" amount={cpc.totalCharges} bold />
            </div>
          </section>
          <div className={`${panel} flex items-center justify-between gap-4 px-4 py-4 sm:px-5 lg:col-span-2 ${cpc.resultat >= 0 ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
            <span className="font-semibold text-foreground">Résultat net {cpc.resultat >= 0 ? '(bénéfice)' : '(perte)'}</span>
            <span className={`whitespace-nowrap text-lg font-bold tabular-nums ${cpc.resultat >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>{fmt(cpc.resultat)}</span>
          </div>
        </div>
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2">
          <section className={`${panel} overflow-hidden`}>
            <h2 className={groupTitle}>Actif</h2>
            <div className="divide-y divide-border">
              <Line label="Immobilisations (net)" amount={bilan.immob} />
              <Line label="Actif circulant" amount={bilan.actifCirc} />
              <Line label="Trésorerie - Actif" amount={bilan.tresoActif} />
              <Line label="Total Actif" amount={bilan.totalActif} bold />
            </div>
          </section>
          <section className={`${panel} overflow-hidden`}>
            <h2 className={groupTitle}>Passif</h2>
            <div className="divide-y divide-border">
              <Line label="Capitaux propres" amount={bilan.capitaux} />
              <Line label="Résultat net de l'exercice" amount={bilan.resultat} />
              <Line label="Dettes du passif circulant" amount={bilan.dettes} />
              <Line label="Trésorerie - Passif" amount={bilan.tresoPassif} />
              <Line label="Total Passif" amount={bilan.totalPassif} bold />
            </div>
          </section>
          {Math.abs(bilan.totalActif - bilan.totalPassif) > 0.5 && (
            <p className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-200 md:col-span-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Écart Actif/Passif de {fmt(Math.abs(bilan.totalActif - bilan.totalPassif))} — écritures d'à-nouveaux ou de régularisation manquantes.</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
