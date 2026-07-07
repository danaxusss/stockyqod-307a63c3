import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Lock, Loader, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { FiscalYear } from '../../types';
import { AccountingService } from '../../utils/supabaseAccounting';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

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
      const fy = await AccountingService.ensureCurrentFiscalYear();
      setOpenFy(fy);
      const [ys, drafts, lines] = await Promise.all([
        AccountingService.listFiscalYears(),
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

  const canClose = draftCount === 0;

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

  if (loading) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>;

  return (
    <div className="max-w-2xl mx-auto py-6 px-3">
      <div className="flex items-center gap-2 mb-4">
        <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10"><Lock className="h-5 w-5 text-primary" /></div>
        <div>
          <h1 className="text-lg font-bold text-foreground leading-tight">Clôture d'exercice</h1>
          <p className="text-xs text-muted-foreground">Verrou + report des à-nouveaux</p>
        </div>
      </div>

      <div className="bg-card border border-border/60 rounded-xl p-4 mb-4">
        <div className="flex justify-between py-1.5 text-sm"><span className="text-muted-foreground">Exercice courant</span><span className="font-semibold">{openFy?.label}</span></div>
        <div className="flex justify-between py-1.5 text-sm"><span className="text-muted-foreground">Résultat de l'exercice</span><span className={`font-semibold tabular-nums ${resultat >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{fmtMad(resultat)}</span></div>
        <div className="flex justify-between py-1.5 text-sm items-center">
          <span className="text-muted-foreground">Écritures en brouillon</span>
          {draftCount === 0
            ? <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium"><CheckCircle2 className="h-4 w-4" />Aucune</span>
            : <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium"><AlertTriangle className="h-4 w-4" />{draftCount} à traiter</span>}
        </div>
      </div>

      {!canClose && (
        <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
          Validez ou supprimez les écritures en brouillon avant de clôturer (Saisie / Journaux).
        </p>
      )}

      <button onClick={close} disabled={busy || !canClose}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
        {busy ? <Loader className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
        Clôturer l'exercice {openFy?.label}
      </button>

      <div className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Exercices</h2>
        <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
          {years.map(y => (
            <div key={y.id} className="flex items-center justify-between px-3 py-2 border-b border-border/40 last:border-0 text-sm">
              <span className="font-medium">{y.label}</span>
              <span className="text-muted-foreground">{y.start_date} → {y.end_date}</span>
              {y.status === 'closed'
                ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground"><Lock className="h-3 w-3" />Clôturé</span>
                : <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">Ouvert</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
