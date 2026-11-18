import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { FileSpreadsheet, Download, AlertTriangle } from 'lucide-react';
import { SupabasePayslipsService } from '../../utils/supabasePayslips';
import { SupabaseEmployeesService } from '../../utils/supabaseEmployees';
import { PayrollSettingsService } from '../../utils/supabasePayrollSettings';
import type { Payslip, Employee } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { PageHeader } from '../../components/PageHeader';
import { StatusPill } from '../../components/lists/StatusPill';
import { btnSecondary, EmptyState, fieldAuto, LoadingState, panel, Segmented, td, tdNum, tfootRow, th, theadRow, thRight } from '../../components/backoffice/BackOfficeUi';

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
  const [cnssRate, setCnssRate] = useState(0);
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
      if (s) { setCap(s.cnss_cap); setCnssRate(s.cnss_rate_emp); }
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  }, [year, month, showToast]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => payslips.map(p => {
    const e = employees.get(p.employee_id);
    // The CNSS base leaves out exempt allowances: read it back from the
    // employee contribution (base × rate, already capped).
    const brutPlafonne = cnssRate > 0 && p.cnss_employee > 0
      ? Math.min(cap, Math.round(p.cnss_employee / cnssRate * 100) / 100)
      : Math.min(p.total_gross, cap);
    return {
      name: e?.full_name || (p.employee as any)?.full_name || '—',
      cnss: e?.cnss_number || '', rib: e?.bank_iban || '', cimr_no: e?.cimr_number || '',
      brut: p.total_gross, brutPlafonne,
      cnss_emp: p.cnss_employee, amo_emp: p.amo_employee, cnss_er: p.cnss_employer, amo_er: p.amo_employer,
      af: p.alloc_familiales, tfp: (p as any).tfp_employer || 0,
      ir: p.ir_amount, cimr: p.cimr_employee, net: p.net_salary,
    };
  }), [payslips, employees, cap, cnssRate]);

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

  const nameCell = `${td} font-medium text-foreground`;
  const footLabel = `${td} text-right text-xs uppercase tracking-wide text-muted-foreground`;

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="Déclarations & virements"
        subtitle={`${payslips.length} bulletin(s) · ${MONTHS[month - 1]} ${year}`}
        actions={<div className="flex gap-2">
          <select value={month} onChange={e => setMonth(Number(e.target.value))} aria-label="Mois" className={fieldAuto}>{MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select>
          <select value={year} onChange={e => setYear(Number(e.target.value))} aria-label="Année" className={fieldAuto}>{YEARS.map(y => <option key={y} value={y}>{y}</option>)}</select>
        </div>}
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Segmented<Tab> label="Déclaration" value={tab} onChange={setTab} options={TABS.map(([t, l]) => ({ value: t, label: l }))} />
        <button onClick={exports[tab]} disabled={rows.length === 0} className={btnSecondary}><Download className="h-4 w-4" /> Export CSV</button>
      </div>

      {loading ? <LoadingState /> : (
        <div className={`${panel} overflow-hidden`}>
          {payslips.length === 0 ? (
            <EmptyState icon={FileSpreadsheet} title="Aucun bulletin pour cette période. Générez la paie du mois." />
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              {tab === 'cnss' && (<>
                <thead><tr className={theadRow}><th className={th}>Employé</th><th className={th}>N° CNSS</th><th className={thRight}>Brut plaf.</th><th className={thRight}>CNSS+AMO sal.</th><th className={thRight}>Part patronale</th></tr></thead>
                <tbody className="divide-y divide-border">{rows.map((r, i) => <tr key={i} className="hover:bg-secondary/40"><td className={nameCell}>{r.name}</td><td className={`${td} font-mono text-xs text-muted-foreground`}>{r.cnss || '—'}</td><td className={`${tdNum} text-foreground`}>{fmt(r.brutPlafonne)}</td><td className={`${tdNum} text-foreground`}>{fmt(r.cnss_emp + r.amo_emp)}</td><td className={`${tdNum} text-muted-foreground`}>{fmt(r.cnss_er + r.amo_er + r.af + r.tfp)}</td></tr>)}</tbody>
                <tfoot><tr className={tfootRow}><td colSpan={2} className={footLabel}>Totaux</td><td className={`${tdNum} text-foreground`}>{fmt(rows.reduce((s, r) => s + r.brutPlafonne, 0))}</td><td className={`${tdNum} text-foreground`}>{fmt(totals.cnss_emp + totals.amo_emp)}</td><td className={`${tdNum} text-foreground`}>{fmt(totals.cnss_er + totals.amo_er + totals.af + totals.tfp)}</td></tr></tfoot>
              </>)}
              {tab === 'ir' && (<>
                <thead><tr className={theadRow}><th className={th}>Employé</th><th className={thRight}>Salaire brut</th><th className={thRight}>IR retenu</th></tr></thead>
                <tbody className="divide-y divide-border">{rows.map((r, i) => <tr key={i} className="hover:bg-secondary/40"><td className={nameCell}>{r.name}</td><td className={`${tdNum} text-foreground`}>{fmt(r.brut)}</td><td className={`${tdNum} text-foreground`}>{fmt(r.ir)}</td></tr>)}</tbody>
                <tfoot><tr className={tfootRow}><td className={footLabel}>Total IR</td><td className={`${tdNum} text-foreground`}>{fmt(totals.brut)}</td><td className={`${tdNum} text-foreground`}>{fmt(totals.ir)}</td></tr></tfoot>
              </>)}
              {tab === 'cimr' && (<>
                <thead><tr className={theadRow}><th className={th}>Employé</th><th className={th}>N° CIMR</th><th className={thRight}>CIMR salariale</th></tr></thead>
                <tbody className="divide-y divide-border">{rows.map((r, i) => <tr key={i} className="hover:bg-secondary/40"><td className={nameCell}>{r.name}</td><td className={`${td} font-mono text-xs text-muted-foreground`}>{r.cimr_no || '—'}</td><td className={`${tdNum} text-foreground`}>{fmt(r.cimr)}</td></tr>)}</tbody>
                <tfoot><tr className={tfootRow}><td colSpan={2} className={footLabel}>Total</td><td className={`${tdNum} text-foreground`}>{fmt(totals.cimr)}</td></tr></tfoot>
              </>)}
              {tab === 'virements' && (<>
                <thead><tr className={theadRow}><th className={th}>Employé</th><th className={th}>RIB</th><th className={thRight}>Net à payer</th></tr></thead>
                <tbody className="divide-y divide-border">{rows.map((r, i) => <tr key={i} className="hover:bg-secondary/40"><td className={nameCell}>{r.name}</td><td className={`${td} font-mono text-xs text-muted-foreground`}>{r.rib || <StatusPill tone="warning" icon={<AlertTriangle className="h-3 w-3" />}>RIB manquant</StatusPill>}</td><td className={`${tdNum} font-semibold text-foreground`}>{fmt(r.net)}</td></tr>)}</tbody>
                <tfoot><tr className={tfootRow}><td colSpan={2} className={footLabel}>Total à virer</td><td className={`${tdNum} text-emerald-700 dark:text-emerald-300`}>{fmt(totals.net)}</td></tr></tfoot>
              </>)}
            </table>
          </div>
          )}
        </div>
      )}
    </div>
  );
}
