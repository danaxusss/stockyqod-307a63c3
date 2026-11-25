import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { BookMarked, BookOpen, Scale, FileText, Loader, TrendingUp, Wallet, ArrowDownRight, ArrowUpRight, Sparkles, ChevronRight, Inbox } from 'lucide-react';
import type { Account, FiscalYear } from '../../types';
import { AccountingService } from '../../utils/supabaseAccounting';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { PageHeader } from '../../components/PageHeader';
import { btnPrimary, btnSecondary, EmptyState, KpiTile, LoadingState, panel } from '../../components/backoffice/BackOfficeUi';

function fmtMad(n: number) {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' MAD';
}

export default function ComptabiliteHome() {
  const { showToast } = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [fy, setFy] = useState<FiscalYear | null>(null);
  const [years, setYears] = useState<FiscalYear[]>([]);
  const [lines, setLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const year = await AccountingService.ensureCurrentFiscalYear();
      setFy(year);
      setYears(await AccountingService.listFiscalYears());
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

  if (loading) return <LoadingState />;

  if (accounts.length === 0) {
    return (
      <div className="mx-auto max-w-[110rem]">
        <PageHeader title="Comptabilité générale" subtitle="Plan comptable à initialiser" />
        <div className={panel}>
          <EmptyState icon={BookMarked} title="Aucun plan comptable pour cette société"
            hint={<>Initialisez le <b className="font-semibold text-foreground">Plan Comptable Marocain (CGNC)</b> pour cette société. Vous pourrez ensuite saisir vos écritures, consulter le grand livre et la balance.</>}>
            <button onClick={initPcm} disabled={initializing} className={btnPrimary}>
              {initializing ? <Loader className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Initialiser le plan comptable marocain
            </button>
          </EmptyState>
        </div>
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
    { to: '/comptabilite/immobilisations', icon: BookMarked, label: 'Immobilisations', desc: 'Amortissements & dotations' },
    { to: '/comptabilite/etats', icon: Scale, label: 'États de synthèse', desc: 'Bilan & CPC (modèle simplifié)' },
    { to: '/comptabilite/cloture', icon: BookOpen, label: 'Clôture d\'exercice', desc: 'Verrou, à-nouveaux, export FEC, estimation IS' },
    { to: '/comptabilite/plan', icon: BookMarked, label: 'Plan comptable', desc: 'Comptes CGNC' },
  ];

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="Comptabilité générale"
        subtitle={`${accounts.length} comptes · Plan comptable marocain (CGNC)`}
        actions={<>
          <label className="flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card pl-3 pr-1 text-sm text-muted-foreground">
            Exercice
            {/* The year every accounting page shows; entries always go to the year of their date. */}
            <select
              value={fy?.id || ''}
              onChange={e => { AccountingService.setDisplayedFiscalYear(e.target.value); load(); }}
              className="h-8 rounded-md border-0 bg-transparent pr-1 text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="Exercice affiché"
            >
              {years.map(y => <option key={y.id} value={y.id}>{y.label}{y.status === 'closed' ? ' (clôturé)' : ''}</option>)}
            </select>
          </label>
          <Link to="/comptabilite/journaux" className={btnSecondary}><BookOpen className="h-4 w-4 text-primary" />Saisie / journaux</Link>
          <Link to="/comptabilite/a-comptabiliser" className={btnPrimary}><Inbox className="h-4 w-4" />À comptabiliser</Link>
        </>}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(k => (
          <KpiTile key={k.label} icon={k.icon} tone={k.tone} label={k.label} value={k.value} />
        ))}
      </div>

      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Modules</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {nav.map(n => (
          <Link key={n.to} to={n.to} className="group flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition hover:border-primary/40 hover:shadow-md">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10"><n.icon className="h-5 w-5 text-primary" aria-hidden="true" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-foreground">{n.label}</span>
              <span className="block truncate text-xs text-muted-foreground">{n.desc}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
          </Link>
        ))}
      </div>
    </div>
  );
}
