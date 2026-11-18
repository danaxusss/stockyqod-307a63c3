import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Lock, Loader, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { FiscalYear } from '../../types';
import { AccountingService } from '../../utils/supabaseAccounting';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Panel } from '../../components/PageHeader';
import { StatusPill } from '../../components/lists/StatusPill';
import { btnPrimary, LoadingState, PhoneActionBar } from '../../components/backoffice/BackOfficeUi';

function fmtMad(n: number) { return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n) + ' MAD'; }

export default function CloturePage() {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const [years, setYears] = useState<FiscalYear[]>([]);
  const [openFy, setOpenFy] = useState<FiscalYear | null>(null);
  const [draftCount, setDraftCount] = useState(0);
  const [resultat, setResultat] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // The year to close is the oldest one still open.
      await AccountingService.ensureCurrentFiscalYear();
      const all = await AccountingService.listFiscalYears();
      const fy = [...all].filter(y => y.status === 'open').sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
      if (!fy) { setYears(all); setOpenFy(null); return; }
      setOpenFy(fy);
      const [ys, drafts, lines] = await Promise.all([
        Promise.resolve(all),
        AccountingService.listEntries({ fiscalYearId: fy.id, status: 'draft', limit: 1000 }),
        AccountingService.getPostedLines(fy.id),
      ]);
      setYears(ys);
      setDraftCount(drafts.length);
      let p = 0, c = 0;
      for (const l of lines) { const cl = Number(String(l.account_code)[0]); const d = Number(l.debit) || 0, cr = Number(l.credit) || 0; if (cl === 7) p += cr - d; else if (cl === 6) c += d - cr; }
      setResultat(p - c);
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const yearOver = !!openFy && openFy.end_date < today;
  const canClose = draftCount === 0 && yearOver;

  const close = async () => {
    if (!openFy) return;
    if (!confirm(`Clôturer définitivement l'exercice ${openFy.label} ? Les écritures deviennent non modifiables et les à-nouveaux sont générés sur l'exercice suivant.`)) return;
    setBusy(true);
    try {
      const res = await AccountingService.closeExercice(openFy, currentUser?.username || null);
      showToast({ type: 'success', title: 'Exercice clôturé', message: `À-nouveaux (${res.carried} lignes) reportés sur ${res.newYearLabel}` });
      await load();
    } catch (e: any) {
      showToast({ type: 'error', title: 'Clôture impossible', message: e?.message || 'Échec' });
    } finally { setBusy(false); }
  };

  if (loading) return <LoadingState />;

  const closeButton = (
    <button onClick={close} disabled={busy || !canClose} className={btnPrimary}>
      {busy ? <Loader className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
      Clôturer l'exercice {openFy?.label}
    </button>
  );
  const row = 'flex items-center justify-between gap-4 px-4 py-3 text-sm sm:px-5';
  const note = 'flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-200';

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader title="Clôture d'exercice" subtitle="Verrou + report des à-nouveaux" actions={<span className="hidden md:inline-flex">{closeButton}</span>} />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <Panel title="Exercice courant">
            <div className="divide-y divide-border">
              <div className={row}><span className="text-muted-foreground">Exercice courant</span><span className="font-semibold text-foreground">{openFy?.label}</span></div>
              <div className={row}><span className="text-muted-foreground">Résultat de l'exercice</span><span className={`whitespace-nowrap font-semibold tabular-nums ${resultat >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>{fmtMad(resultat)}</span></div>
              <div className={row}>
                <span className="text-muted-foreground">Écritures en brouillon</span>
                {draftCount === 0
                  ? <StatusPill tone="success" icon={<CheckCircle2 className="h-3 w-3" />}>Aucune</StatusPill>
                  : <StatusPill tone="warning" icon={<AlertTriangle className="h-3 w-3" />}>{draftCount} à traiter</StatusPill>}
              </div>
            </div>
          </Panel>

          {openFy && !yearOver && (
            <p className={note}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>L'exercice {openFy.label} se termine le {openFy.end_date.split('-').reverse().join('/')} : la clôture sera possible après cette date.</span>
            </p>
          )}
          {draftCount > 0 && (
            <p className={note}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Validez ou supprimez les écritures en brouillon avant de clôturer (Saisie / Journaux).</span>
            </p>
          )}
        </div>

        <Panel title="Exercices">
          <ul className="divide-y divide-border">
            {years.map(y => (
              <li key={y.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm sm:px-5">
                <span className="min-w-0">
                  <span className="block font-semibold text-foreground">{y.label}</span>
                  <span className="block text-xs tabular-nums text-muted-foreground">{y.start_date} → {y.end_date}</span>
                </span>
                {y.status === 'closed'
                  ? <StatusPill tone="neutral" icon={<Lock className="h-3 w-3" />}>Clôturé</StatusPill>
                  : <StatusPill tone="success">Ouvert</StatusPill>}
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <PhoneActionBar>{closeButton}</PhoneActionBar>
    </div>
  );
}
