import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { FileSpreadsheet, Loader, Download } from 'lucide-react';
import { SupabasePayslipsService } from '../../utils/supabasePayslips';
import { SupabaseEmployeesService } from '../../utils/supabaseEmployees';
import { PayrollSettingsService } from '../../utils/supabasePayrollSettings';
import type { Payslip, Employee } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

function fmt(n: number) { return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n); }
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 4 }, (_, i) => currentYear - i);

function downloadCsv(name: string, header: string[], rows: (string | number)[][]) {
  const csv = '﻿' + [header.join(';'), ...rows.map(r => r.join(';'))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

type Tab = 'cnss' | 'ir' | 'cimr' | 'virements';

export default function DeclarationsPage() {
  const { isPaie, isSuperAdmin } = useAuth();
  const { showToast } = useToast();
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [employees, setEmployees] = useState<Map<string, Employee>>(new Map());
  const [cap, setCap] = useState(6000);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(currentYear);
  const [tab, setTab] = useState<Tab>('cnss');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ps, emps, s] = await Promise.all([
        SupabasePayslipsService.list({ year, month }),
        SupabaseEmployeesService.list(),
        PayrollSettingsService.get(year).catch(() => null),
      ]);
      setPayslips(ps);
      setEmployees(new Map(emps.map(e => [e.id, e])));
      if (s) setCap(s.cnss_cap);
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  }, [year, month, showToast]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => payslips.map(p => {
    const e = employees.get(p.employee_id);
    const brutPlafonne = Math.min(p.total_gross, cap);
    return {
      name: e?.full_name || (p.employee as any)?.full_name || '—',
      cnss: e?.cnss_number || '', rib: e?.bank_iban || '', cimr_no: e?.cimr_number || '',
      brut: p.total_gross, brutPlafonne,
      cnss_emp: p.cnss_employee, amo_emp: p.amo_employee, cnss_er: p.cnss_employer, amo_er: p.amo_employer,
      af: p.alloc_familiales, tfp: (p as any).tfp_employer || 0,
      ir: p.ir_amount, cimr: p.cimr_employee, net: p.net_salary,
    };
  }), [payslips, employees, cap]);

  const totals = useMemo(() => rows.reduce((t, r) => ({
    brut: t.brut + r.brut, cnss_emp: t.cnss_emp + r.cnss_emp, amo_emp: t.amo_emp + r.amo_emp,
    cnss_er: t.cnss_er + r.cnss_er, amo_er: t.amo_er + r.amo_er, af: t.af + r.af, tfp: t.tfp + r.tfp,
    ir: t.ir + r.ir, cimr: t.cimr + r.cimr, net: t.net + r.net,
  }), { brut: 0, cnss_emp: 0, amo_emp: 0, cnss_er: 0, amo_er: 0, af: 0, tfp: 0, ir: 0, cimr: 0, net: 0 }), [rows]);

  const period = `${MONTHS[month - 1]}_${year}`;

  const exports: Record<Tab, () => void> = {
    cnss: () => downloadCsv(`BDS_CNSS_${period}.csv`, ['Employé', 'N° CNSS', 'Salaire brut', 'Brut plafonné', 'CNSS sal.', 'AMO sal.', 'CNSS pat.', 'AMO pat.', 'Alloc. fam.', 'TFP'],
      rows.map(r => [r.name, r.cnss, r.brut.toFixed(2), r.brutPlafonne.toFixed(2), r.cnss_emp.toFixed(2), r.amo_emp.toFixed(2), r.cnss_er.toFixed(2), r.amo_er.toFixed(2), r.af.toFixed(2), r.tfp.toFixed(2)])),
    ir: () => downloadCsv(`IR_${period}.csv`, ['Employé', 'Salaire brut', 'IR retenu'], rows.map(r => [r.name, r.brut.toFixed(2), r.ir.toFixed(2)])),
    cimr: () => downloadCsv(`CIMR_${period}.csv`, ['Employé', 'N° CIMR', 'CIMR salariale'], rows.map(r => [r.name, r.cimr_no, r.cimr.toFixed(2)])),
    virements: () => downloadCsv(`Virements_${period}.csv`, ['Employé', 'RIB', 'Net à payer'], rows.map(r => [r.name, r.rib, r.net.toFixed(2)])),
  };

  if (!isPaie && !isSuperAdmin) return <div className="text-center py-12 text-muted-foreground">Accès réservé au rôle Paie.</div>;

  const TABS: [Tab, string][] = [['cnss', 'CNSS / BDS'], ['ir', 'IR'], ['cimr', 'CIMR'], ['virements', 'Ordre de virement']];

  return (
    <div className="max-w-4xl mx-auto py-6 px-3">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10"><FileSpreadsheet className="h-5 w-5 text-primary" /></div>
          <div><h1 className="text-lg font-bold text-foreground leading-tight">Déclarations & virements</h1><p className="text-xs text-muted-foreground">{payslips.length} bulletin(s) · {MONTHS[month - 1]} {year}</p></div>
        </div>
        <div className="flex items-center gap-2">
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className="px-2 py-2 text-sm rounded-lg bg-secondary border border-border">{MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select>
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="px-2 py-2 text-sm rounded-lg bg-secondary border border-border">{YEARS.map(y => <option key={y} value={y}>{y}</option>)}</select>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex rounded-lg border border-border overflow-hidden">
          {TABS.map(([t, l]) => <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 text-xs font-medium ${tab === t ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>{l}</button>)}
        </div>
        <button onClick={exports[tab]} disabled={rows.length === 0} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary border border-border text-sm disabled:opacity-50"><Download className="h-3.5 w-3.5" /> Export CSV</button>
      </div>

      {loading ? <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div> : (
        <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              {tab === 'cnss' && (<>
                <thead><tr className="bg-secondary/50 text-xs text-muted-foreground border-b border-border/60"><th className="text-left font-medium px-3 py-2">Employé</th><th className="text-left font-medium px-3 py-2">N° CNSS</th><th className="text-right font-medium px-3 py-2">Brut plaf.</th><th className="text-right font-medium px-3 py-2">CNSS+AMO sal.</th><th className="text-right font-medium px-3 py-2">Part patronale</th></tr></thead>
                <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-border/40"><td className="px-3 py-2">{r.name}</td><td className="px-3 py-2 font-mono text-xs">{r.cnss || '—'}</td><td className="px-3 py-2 text-right tabular-nums">{fmt(r.brutPlafonne)}</td><td className="px-3 py-2 text-right tabular-nums">{fmt(r.cnss_emp + r.amo_emp)}</td><td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmt(r.cnss_er + r.amo_er + r.af + r.tfp)}</td></tr>)}</tbody>
                <tfoot><tr className="bg-secondary/40 font-semibold"><td colSpan={2} className="px-3 py-2 text-right text-xs text-muted-foreground">Totaux</td><td className="px-3 py-2 text-right tabular-nums">{fmt(rows.reduce((s, r) => s + r.brutPlafonne, 0))}</td><td className="px-3 py-2 text-right tabular-nums">{fmt(totals.cnss_emp + totals.amo_emp)}</td><td className="px-3 py-2 text-right tabular-nums">{fmt(totals.cnss_er + totals.amo_er + totals.af + totals.tfp)}</td></tr></tfoot>
              </>)}
              {tab === 'ir' && (<>
                <thead><tr className="bg-secondary/50 text-xs text-muted-foreground border-b border-border/60"><th className="text-left font-medium px-3 py-2">Employé</th><th className="text-right font-medium px-3 py-2">Salaire brut</th><th className="text-right font-medium px-3 py-2">IR retenu</th></tr></thead>
                <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-border/40"><td className="px-3 py-2">{r.name}</td><td className="px-3 py-2 text-right tabular-nums">{fmt(r.brut)}</td><td className="px-3 py-2 text-right tabular-nums">{fmt(r.ir)}</td></tr>)}</tbody>
                <tfoot><tr className="bg-secondary/40 font-semibold"><td className="px-3 py-2 text-right text-xs text-muted-foreground">Total IR</td><td className="px-3 py-2 text-right tabular-nums">{fmt(totals.brut)}</td><td className="px-3 py-2 text-right tabular-nums">{fmt(totals.ir)}</td></tr></tfoot>
              </>)}
              {tab === 'cimr' && (<>
                <thead><tr className="bg-secondary/50 text-xs text-muted-foreground border-b border-border/60"><th className="text-left font-medium px-3 py-2">Employé</th><th className="text-left font-medium px-3 py-2">N° CIMR</th><th className="text-right font-medium px-3 py-2">CIMR salariale</th></tr></thead>
                <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-border/40"><td className="px-3 py-2">{r.name}</td><td className="px-3 py-2 font-mono text-xs">{r.cimr_no || '—'}</td><td className="px-3 py-2 text-right tabular-nums">{fmt(r.cimr)}</td></tr>)}</tbody>
                <tfoot><tr className="bg-secondary/40 font-semibold"><td colSpan={2} className="px-3 py-2 text-right text-xs text-muted-foreground">Total</td><td className="px-3 py-2 text-right tabular-nums">{fmt(totals.cimr)}</td></tr></tfoot>
              </>)}
              {tab === 'virements' && (<>
                <thead><tr className="bg-secondary/50 text-xs text-muted-foreground border-b border-border/60"><th className="text-left font-medium px-3 py-2">Employé</th><th className="text-left font-medium px-3 py-2">RIB</th><th className="text-right font-medium px-3 py-2">Net à payer</th></tr></thead>
                <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-border/40"><td className="px-3 py-2">{r.name}</td><td className="px-3 py-2 font-mono text-xs">{r.rib || '⚠ RIB manquant'}</td><td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(r.net)}</td></tr>)}</tbody>
                <tfoot><tr className="bg-secondary/40 font-semibold"><td colSpan={2} className="px-3 py-2 text-right text-xs text-muted-foreground">Total à virer</td><td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{fmt(totals.net)}</td></tr></tfoot>
              </>)}
            </table>
          </div>
          {payslips.length === 0 && <div className="px-3 py-8 text-center text-muted-foreground text-sm">Aucun bulletin pour cette période. Générez la paie du mois.</div>}
        </div>
      )}
    </div>
  );
}
