import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, Loader, Plus, ArrowLeft, Check, BookOpen, Lock, ChevronRight } from 'lucide-react';
import { PayrollRunService, type PayrollRun } from '../../utils/supabasePayrollRun';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Panel } from '../../components/PageHeader';
import { StatusPill } from '../../components/lists/StatusPill';
import { btnPrimary, btnSecondary, EmptyState, field, fieldLabel, KpiTile, LoadingState, panel, PhoneActionBar, td, tdNum, tfootRow, th, theadRow, thRight } from '../../components/backoffice/BackOfficeUi';

function fmt(n: number) { return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n); }
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 4 }, (_, i) => currentYear - i);

export default function PayrollRunPage() {
  const navigate = useNavigate();
  const { isPaie, isSuperAdmin, currentUser } = useAuth();
  const { showToast } = useToast();
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [detail, setDetail] = useState<PayrollRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(currentYear);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRuns(await PayrollRunService.list()); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setBusy(true);
    try {
      const run = await PayrollRunService.generate(month, year, currentUser?.username || null);
      showToast({ type: 'success', title: 'Lot généré', message: `Paie ${MONTHS[month - 1]} ${year}` });
      const full = await PayrollRunService.getRun(run.id); setDetail(full);
      await load();
    } catch (e: any) { showToast({ type: 'error', title: 'Erreur', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };

  const open = async (id: string) => { const r = await PayrollRunService.getRun(id); setDetail(r); };

  const validate = async () => {
    if (!detail) return;
    setBusy(true);
    try { await PayrollRunService.validate(detail.id); showToast({ type: 'success', message: 'Lot validé (cumuls mis à jour)' }); await open(detail.id); await load(); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };

  const comptabiliser = async () => {
    if (!detail) return;
    setBusy(true);
    try { await PayrollRunService.postToAccounting(detail.id, currentUser?.username || null); showToast({ type: 'success', title: 'Comptabilisé', message: 'Écriture de paie en brouillon (À valider dans la Compta)' }); await open(detail.id); }
    catch (e: any) { showToast({ type: 'error', title: 'Erreur', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };

  if (!isPaie && !isSuperAdmin) return <div className="py-12 text-center text-muted-foreground">Accès réservé au rôle Paie.</div>;
  if (loading) return <LoadingState />;

  if (detail) {
    const validateButton = detail.status === 'draft' && <button onClick={validate} disabled={busy} className={btnPrimary}><Check className="h-4 w-4" /> Valider</button>;
    const bookButton = !detail.journal_entry_id && <button onClick={comptabiliser} disabled={busy} className={btnSecondary}><BookOpen className="h-4 w-4" /> Comptabiliser</button>;
    return (
      <div className="mx-auto max-w-[110rem]">
        <button onClick={() => setDetail(null)} aria-label="Retour aux lots de paie"
          className="mb-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />Journée de paie
        </button>
        <PageHeader
          title={`Livre de paie — ${MONTHS[detail.period_month - 1]} ${detail.period_year}`}
          subtitle={`${detail.payslips?.length || 0} bulletin(s) · statut ${detail.status}`}
          actions={<>
            {detail.journal_entry_id && <StatusPill tone="success" icon={<Check className="h-3 w-3" />}>Comptabilisé</StatusPill>}
            <span className="hidden gap-2 md:flex">{bookButton}{validateButton}</span>
          </>}
        />

        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiTile label="Brut" value={fmt(detail.total_gross)} />
          <KpiTile label="CNSS" value={fmt(detail.total_cnss)} />
          <KpiTile label="Net" value={fmt(detail.total_net)} valueClassName="text-emerald-700 dark:text-emerald-300" />
          <KpiTile label="Coût total employeur" value={`${fmt(detail.employer_cost)} MAD`} />
        </div>

        <div className={`${panel} overflow-hidden`}>
          <ul className="divide-y divide-border md:hidden">
            {(detail.payslips || []).map(p => (
              <li key={p.id}>
                <button onClick={() => navigate(`/paie/bulletins/${p.id}`)} className="flex w-full items-start gap-3 px-4 py-3 text-left active:bg-secondary">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate font-medium text-foreground">{p.employee?.full_name || '—'}{p.is_locked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Verrouillé" />}</span>
                    <span className="block text-xs tabular-nums text-muted-foreground">Brut {fmt(p.total_gross)} · CNSS {fmt(p.cnss_employee + p.amo_employee)} · IR {fmt(p.ir_amount)}</span>
                  </span>
                  <span className="shrink-0 text-right font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{fmt(p.net_salary)}</span>
                </button>
              </li>
            ))}
            <li className="flex items-center justify-between bg-secondary/40 px-4 py-3 text-sm font-semibold">
              <span className="text-muted-foreground">Totaux · IR {fmt(detail.total_ir)}</span>
              <span className="tabular-nums text-emerald-700 dark:text-emerald-300">{fmt(detail.total_net)}</span>
            </li>
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead><tr className={theadRow}>
                <th className={th}>Employé</th>
                <th className={thRight}>Brut</th>
                <th className={thRight}>CNSS</th>
                <th className={thRight}>IR</th>
                <th className={thRight}>Net</th>
                <th className={`${th} w-10`}><span className="sr-only">Verrou</span></th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {(detail.payslips || []).map(p => (
                  <tr key={p.id} onClick={() => navigate(`/paie/bulletins/${p.id}`)} className="cursor-pointer hover:bg-secondary/40">
                    <td className={`${td} font-medium text-foreground`}>{p.employee?.full_name || '—'}</td>
                    <td className={`${tdNum} text-foreground`}>{fmt(p.total_gross)}</td>
                    <td className={`${tdNum} text-muted-foreground`}>{fmt(p.cnss_employee + p.amo_employee)}</td>
                    <td className={`${tdNum} text-muted-foreground`}>{fmt(p.ir_amount)}</td>
                    <td className={`${tdNum} font-semibold text-emerald-700 dark:text-emerald-300`}>{fmt(p.net_salary)}</td>
                    <td className={`${td} text-center`}>{p.is_locked && <Lock className="inline h-3.5 w-3.5 text-muted-foreground" aria-label="Verrouillé" />}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className={tfootRow}>
                <td className={`${td} text-right text-xs uppercase tracking-wide text-muted-foreground`}>Totaux</td>
                <td className={`${tdNum} text-foreground`}>{fmt(detail.total_gross)}</td>
                <td className={`${tdNum} text-foreground`}>{fmt(detail.total_cnss)}</td>
                <td className={`${tdNum} text-foreground`}>{fmt(detail.total_ir)}</td>
                <td className={`${tdNum} text-emerald-700 dark:text-emerald-300`}>{fmt(detail.total_net)}</td>
                <td></td>
              </tr></tfoot>
            </table>
          </div>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">Coût total employeur : <span className="font-semibold tabular-nums text-foreground">{fmt(detail.employer_cost)} MAD</span></p>

        {(validateButton || bookButton) && <PhoneActionBar>{bookButton}{validateButton}</PhoneActionBar>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader title="Journée de paie" subtitle="Génération des bulletins en lot">
        <div className={`${panel} grid grid-cols-2 items-end gap-3 p-3 sm:flex sm:flex-wrap`}>
          <div className="sm:w-44"><label className={fieldLabel} htmlFor="run-month">Mois</label>
            <select id="run-month" value={month} onChange={e => setMonth(Number(e.target.value))} className={field}>{MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select></div>
          <div className="sm:w-32"><label className={fieldLabel} htmlFor="run-year">Année</label>
            <select id="run-year" value={year} onChange={e => setYear(Number(e.target.value))} className={field}>{YEARS.map(y => <option key={y} value={y}>{y}</option>)}</select></div>
          <button onClick={generate} disabled={busy} className={`${btnPrimary} col-span-2 sm:ml-auto`}>
            {busy ? <Loader className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Générer la paie du mois
          </button>
        </div>
      </PageHeader>

      <Panel title="Lots de paie">
        {runs.length === 0 ? <EmptyState icon={CalendarClock} title="Aucun lot de paie" /> : (
          <ul className="divide-y divide-border">
            {runs.map(r => (
              <li key={r.id}>
                <button onClick={() => open(r.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-secondary/40 sm:px-5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10"><CalendarClock className="h-5 w-5 text-primary" aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-foreground">{MONTHS[r.period_month - 1]} {r.period_year}</span>
                    <span className="block truncate text-xs tabular-nums text-muted-foreground">Net {fmt(r.total_net)} MAD · coût {fmt(r.employer_cost)} MAD</span>
                  </span>
                  {r.status === 'validated' ? <StatusPill tone="success">Validé</StatusPill> : r.status === 'paid' ? <StatusPill tone="info">Payé</StatusPill> : <StatusPill tone="warning">Brouillon</StatusPill>}
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
