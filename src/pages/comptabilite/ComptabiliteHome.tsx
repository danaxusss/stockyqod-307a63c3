import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { BookMarked, BookOpen, Scale, FileText, Loader, TrendingUp, Wallet, ArrowDownRight, ArrowUpRight, Sparkles } from 'lucide-react';
import type { Account, FiscalYear } from '../../types';
import { AccountingService } from '../../utils/supabaseAccounting';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

function fmtMad(n: number) {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' MAD';
}

export default function ComptabiliteHome() {
  const { showToast } = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [fy, setFy] = useState<FiscalYear | null>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const year = await AccountingService.ensureCurrentFiscalYear();
      setFy(year);
      const [a, l] = await Promise.all([
        AccountingService.listAccounts(),
        AccountingService.getPostedLines(year.id).catch(() => []),
      ]);
      setAccounts(a); setLines(l);
    } catch (e: any) {
      showToast({ type: 'error', message: e?.message || 'Erreur de chargement' });
    } finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const initPcm = async () => {
    setInitializing(true);
    try {
      const n = await AccountingService.initPcm();
      showToast({ type: 'success', title: 'Plan comptable initialisé', message: `${n} comptes créés` });
      await load();
    } catch (e: any) {
      showToast({ type: 'error', message: e?.message || 'Échec' });
    } finally { setInitializing(false); }
  };

  const classOf = useMemo(() => new Map(accounts.map(a => [a.code, a.class])), [accounts]);

  const kpis = useMemo(() => {
    let produits = 0, charges = 0, tresorerie = 0, creances = 0, dettes = 0;
    for (const l of lines) {
      const cls = classOf.get(l.account_code) ?? Number(String(l.account_code)[0]);
      const d = Number(l.debit) || 0, c = Number(l.credit) || 0;
      if (cls === 7) produits += c - d;
      else if (cls === 6) charges += d - c;
      else if (cls === 5) tresorerie += d - c;
      if (String(l.account_code).startsWith('3421')) creances += d - c;
      if (String(l.account_code).startsWith('4411')) dettes += c - d;
    }
    return { resultat: produits - charges, tresorerie, creances, dettes, produits, charges };
  }, [lines, classOf]);

  if (loading) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>;

  if (accounts.length === 0) {
    return (
      <div className="max-w-xl mx-auto py-16 px-3 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-5"><BookMarked className="h-8 w-8 text-primary" /></div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Comptabilité générale</h1>
        <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
          Initialisez le <b>Plan Comptable Marocain (CGNC)</b> pour cette société. Vous pourrez ensuite saisir vos écritures, consulter le grand livre et la balance.
        </p>
        <button onClick={initPcm} disabled={initializing}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
          {initializing ? <Loader className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Initialiser le plan comptable marocain
        </button>
      </div>
    );
  }

  const cards = [
    { icon: TrendingUp, label: 'Résultat de l\'exercice', value: fmtMad(kpis.resultat), tone: kpis.resultat >= 0 ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' : 'text-red-600 dark:text-red-400 bg-red-500/10' },
    { icon: Wallet, label: 'Trésorerie nette', value: fmtMad(kpis.tresorerie), tone: 'text-primary bg-primary/10' },
    { icon: ArrowDownRight, label: 'Créances clients', value: fmtMad(kpis.creances), tone: 'text-blue-600 dark:text-blue-400 bg-blue-500/10' },
    { icon: ArrowUpRight, label: 'Dettes fournisseurs', value: fmtMad(kpis.dettes), tone: 'text-amber-600 dark:text-amber-400 bg-amber-500/10' },
  ];

  const nav = [
    { to: '/comptabilite/a-comptabiliser', icon: BookOpen, label: 'À comptabiliser', desc: 'Factures, règlements et paie → écritures' },
    { to: '/comptabilite/journaux', icon: BookOpen, label: 'Saisie / Journaux', desc: 'Saisir et valider les écritures' },
    { to: '/comptabilite/grand-livre', icon: FileText, label: 'Grand livre', desc: 'Mouvements par compte' },
    { to: '/comptabilite/balance', icon: Scale, label: 'Balance', desc: 'Soldes par compte' },
    { to: '/comptabilite/lettrage', icon: BookOpen, label: 'Lettrage', desc: 'Rapprocher débits / crédits' },
    { to: '/comptabilite/tva', icon: FileText, label: 'Déclaration TVA', desc: 'TVA due / crédit de la période' },
    { to: '/comptabilite/banque', icon: Wallet, label: 'Rapprochement bancaire', desc: 'Importer un relevé par scan (IA)' },
    { to: '/comptabilite/etats', icon: Scale, label: 'États de synthèse', desc: 'Bilan & CPC (modèle simplifié)' },
    { to: '/comptabilite/plan', icon: BookMarked, label: 'Plan comptable', desc: 'Comptes CGNC' },
  ];

  return (
    <div className="max-w-5xl mx-auto py-6 px-3">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10"><BookMarked className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">Comptabilité générale</h1>
            <p className="text-xs text-muted-foreground">Exercice {fy?.label} · {accounts.length} comptes</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {cards.map((k, i) => (
          <div key={i} className="bg-card border border-border/60 rounded-xl p-3">
            <div className={`inline-flex items-center justify-center w-8 h-8 rounded-lg mb-2 ${k.tone}`}><k.icon className="h-4 w-4" /></div>
            <div className="text-base font-bold text-foreground tabular-nums leading-tight">{k.value}</div>
            <div className="text-[11px] text-muted-foreground">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {nav.map(n => (
          <Link key={n.to} to={n.to} className="flex items-center gap-3 bg-card border border-border/60 rounded-xl p-4 hover:bg-secondary/40 transition-colors">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 shrink-0"><n.icon className="h-5 w-5 text-primary" /></div>
            <div>
              <div className="font-semibold text-foreground text-sm">{n.label}</div>
              <div className="text-xs text-muted-foreground">{n.desc}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
