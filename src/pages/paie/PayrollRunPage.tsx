import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, Loader, Plus, ArrowLeft, Check, BookOpen, Lock } from 'lucide-react';
import { PayrollRunService, type PayrollRun } from '../../utils/supabasePayrollRun';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

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

  if (!isPaie && !isSuperAdmin) return <div className="text-center py-12 text-muted-foreground">Accès réservé au rôle Paie.</div>;
  if (loading) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>;

  if (detail) {
    return (
      <div className="max-w-5xl mx-auto py-6 px-3">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <button onClick={() => setDetail(null)} className="p-1.5 hover:bg-secondary rounded-lg"><ArrowLeft className="h-4 w-4 text-muted-foreground" /></button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-foreground">Livre de paie — {MONTHS[detail.period_month - 1]} {detail.period_year}</h1>
            <p className="text-xs text-muted-foreground">{detail.payslips?.length || 0} bulletin(s) · statut {detail.status}</p>
          </div>
          {detail.status === 'draft' && <button onClick={validate} disabled={busy} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"><Check className="h-4 w-4" /> Valider</button>}
          {!detail.journal_entry_id && <button onClick={comptabiliser} disabled={busy} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary border border-border text-sm disabled:opacity-50"><BookOpen className="h-4 w-4" /> Comptabiliser</button>}
          {detail.journal_entry_id && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 px-2"><Check className="h-3.5 w-3.5" />Comptabilisé</span>}
        </div>

        <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-secondary/50 text-xs text-muted-foreground border-b border-border/60">
                <th className="text-left font-medium px-3 py-2">Employé</th>
                <th className="text-right font-medium px-3 py-2">Brut</th>
                <th className="text-right font-medium px-3 py-2">CNSS</th>
                <th className="text-right font-medium px-3 py-2">IR</th>
                <th className="text-right font-medium px-3 py-2">Net</th>
                <th className="w-8"></th>
              </tr></thead>
              <tbody>
                {(detail.payslips || []).map(p => (
                  <tr key={p.id} onClick={() => navigate(`/paie/bulletins/${p.id}`)} className="border-b border-border/40 hover:bg-secondary/30 cursor-pointer">
                    <td className="px-3 py-2">{(p.employee as any)?.full_name || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(p.total_gross)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmt(p.cnss_employee + p.amo_employee)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmt(p.ir_amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">{fmt(p.net_salary)}</td>
                    <td className="px-2 text-center">{(p as any).is_locked && <Lock className="h-3 w-3 text-muted-foreground inline" />}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="bg-secondary/40 font-semibold">
                <td className="px-3 py-2 text-right text-xs text-muted-foreground">Totaux</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(detail.total_gross)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(detail.total_cnss)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(detail.total_ir)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{fmt(detail.total_net)}</td>
                <td></td>
              </tr></tfoot>
            </table>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Coût total employeur : <span className="font-semibold text-foreground">{fmt(detail.employer_cost)} MAD</span></p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-6 px-3">
      <div className="flex items-center gap-2 mb-4">
        <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10"><CalendarClock className="h-5 w-5 text-primary" /></div>
        <div>
          <h1 className="text-lg font-bold text-foreground leading-tight">Journée de paie</h1>
          <p className="text-xs text-muted-foreground">Génération des bulletins en lot</p>
        </div>
      </div>

      <div className="bg-card border border-border/60 rounded-xl p-4 mb-4 flex items-end gap-2 flex-wrap">
        <div><label className="block text-[11px] text-muted-foreground mb-1">Mois</label>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className="px-3 py-2 text-sm rounded-lg bg-secondary border border-border">{MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select></div>
        <div><label className="block text-[11px] text-muted-foreground mb-1">Année</label>
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="px-3 py-2 text-sm rounded-lg bg-secondary border border-border">{YEARS.map(y => <option key={y} value={y}>{y}</option>)}</select></div>
        <button onClick={generate} disabled={busy} className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
          {busy ? <Loader className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Générer la paie du mois
        </button>
      </div>

      <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
        {runs.length === 0 ? <div className="px-3 py-10 text-center text-sm text-muted-foreground">Aucun lot de paie</div> : runs.map(r => (
          <button key={r.id} onClick={() => open(r.id)} className="w-full flex items-center justify-between px-3 py-3 border-b border-border/40 last:border-0 hover:bg-secondary/30 text-left">
            <div>
              <div className="font-medium text-foreground text-sm">{MONTHS[r.period_month - 1]} {r.period_year}</div>
              <div className="text-[11px] text-muted-foreground">Net {fmt(r.total_net)} MAD · coût {fmt(r.employer_cost)} MAD</div>
            </div>
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${r.status === 'validated' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : r.status === 'paid' ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'}`}>{r.status === 'validated' ? 'Validé' : r.status === 'paid' ? 'Payé' : 'Brouillon'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
