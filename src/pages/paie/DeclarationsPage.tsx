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
import { btnSecondary, checkbox, EmptyState, fieldAuto, LoadingState, panel, Segmented, td, tdNum, tfootRow, th, theadRow, thRight } from '../../components/backoffice/BackOfficeUi';
import { FULL_MONTH_CNSS_DAYS } from '../../utils/payrollDefaults';
import { Notice } from './payrollUi';

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
  // Only validated payslips are declared; drafts can be shown as provisional.
  const [includeDrafts, setIncludeDrafts] = useState(false);
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

  const shown = useMemo(() => payslips.filter(p => includeDrafts || p.is_locked), [payslips, includeDrafts]);
  const drafts = payslips.filter(p => !p.is_locked).length;

  const rows = useMemo(() => shown.map(p => {
    const e = employees.get(p.employee_id);
    // The stored CNSS base (exempt allowances left out, before the cap).
    // Payslips saved before it was stored: read back from the contribution.
    const estimated = p.cnss_base == null || p.ir_taxable_gross == null || p.net_taxable == null;
    const cnssBase = p.cnss_base ?? (cnssRate > 0 && p.cnss_employee > 0 ? Math.round(p.cnss_employee / cnssRate * 100) / 100 : p.total_gross);
    const taxableGross = p.ir_taxable_gross ?? p.total_gross;
    const netTaxable = p.net_taxable ?? Math.round((taxableGross - p.frais_pro - p.cnss_employee - p.amo_employee - p.cimr_employee) * 100) / 100;
    return {
      name: e?.full_name || p.employee?.full_name || '—',
      cnss: e?.cnss_number || '', rib: e?.bank_iban || '', cimr_no: e?.cimr_number || '',
      brut: p.total_gross, cnssBase, brutPlafonne: Math.min(cnssBase, cap), days: p.cnss_days ?? FULL_MONTH_CNSS_DAYS,
      taxableGross, netTaxable, estimated, draft: !p.is_locked,
      cnss_emp: p.cnss_employee, amo_emp: p.amo_employee, cnss_er: p.cnss_employer, amo_er: p.amo_employer,
      af: p.alloc_familiales, tfp: p.tfp_employer || 0,
      ir: p.ir_amount, cimr: p.cimr_employee, cimr_er: p.cimr_employer || 0, net: p.net_salary,
    };
  }), [shown, employees, cap, cnssRate]);
  const anyEstimated = rows.some(r => r.estimated);

  const totals = useMemo(() => rows.reduce((t, r) => ({
    brut: t.brut + r.brut, cnss_emp: t.cnss_emp + r.cnss_emp, amo_emp: t.amo_emp + r.amo_emp,
    cnss_er: t.cnss_er + r.cnss_er, amo_er: t.amo_er + r.amo_er, af: t.af + r.af, tfp: t.tfp + r.tfp,
    ir: t.ir + r.ir, cimr: t.cimr + r.cimr, cimr_er: t.cimr_er + r.cimr_er, net: t.net + r.net,
    taxableGross: t.taxableGross + r.taxableGross, netTaxable: t.netTaxable + r.netTaxable, days: t.days + r.days,
  }), { brut: 0, cnss_emp: 0, amo_emp: 0, cnss_er: 0, amo_er: 0, af: 0, tfp: 0, ir: 0, cimr: 0, cimr_er: 0, net: 0, taxableGross: 0, netTaxable: 0, days: 0 }), [rows]);

  // A file built with drafts says so in its name.
  const period = `${MONTHS[month - 1]}_${year}${includeDrafts && drafts > 0 ? '_PROVISOIRE' : ''}`;

  const exports: Record<Tab, () => void> = {
    cnss: () => downloadCsv(`BDS_CNSS_${period}.csv`, ['Employé', 'N° CNSS', 'Jours déclarés', 'Salaire brut', 'Base CNSS', 'Brut plafonné', 'CNSS sal.', 'AMO sal.', 'CNSS pat.', 'AMO pat.', 'Alloc. fam.', 'TFP'],
      rows.map(r => [r.name, r.cnss, r.days, r.brut.toFixed(2), r.cnssBase.toFixed(2), r.brutPlafonne.toFixed(2), r.cnss_emp.toFixed(2), r.amo_emp.toFixed(2), r.cnss_er.toFixed(2), r.amo_er.toFixed(2), r.af.toFixed(2), r.tfp.toFixed(2)])),
    ir: () => downloadCsv(`IR_${period}.csv`, ['Employé', 'Brut imposable', 'Net imposable', 'IR retenu'], rows.map(r => [r.name, r.taxableGross.toFixed(2), r.netTaxable.toFixed(2), r.ir.toFixed(2)])),
    cimr: () => downloadCsv(`CIMR_${period}.csv`, ['Employé', 'N° CIMR', 'CIMR salariale', 'CIMR patronale'], rows.map(r => [r.name, r.cimr_no, r.cimr.toFixed(2), r.cimr_er.toFixed(2)])),
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
        subtitle={`${rows.length} bulletin(s) · ${MONTHS[month - 1]} ${year}`}
        actions={<div className="flex gap-2">
          <select value={month} onChange={e => setMonth(Number(e.target.value))} aria-label="Mois" className={fieldAuto}>{MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select>
          <select value={year} onChange={e => setYear(Number(e.target.value))} aria-label="Année" className={fieldAuto}>{YEARS.map(y => <option key={y} value={y}>{y}</option>)}</select>
        </div>}
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Segmented<Tab> label="Déclaration" value={tab} onChange={setTab} options={TABS.map(([t, l]) => ({ value: t, label: l }))} />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-h-9 items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={includeDrafts} onChange={e => setIncludeDrafts(e.target.checked)} className={checkbox} />
            Inclure les brouillons (provisoire){drafts > 0 && ` · ${drafts}`}
          </label>
          <button onClick={exports[tab]} disabled={rows.length === 0} className={btnSecondary}><Download className="h-4 w-4" /> Export CSV</button>
        </div>
      </div>
      {includeDrafts && drafts > 0 && <Notice className="mb-3">Déclaration provisoire : elle inclut {drafts} bulletin(s) non validé(s), qui peuvent encore changer.</Notice>}
      {!includeDrafts && drafts > 0 && <Notice tone="info" className="mb-3">{drafts} bulletin(s) non validé(s) ne sont pas inclus.</Notice>}
      {anyEstimated && <Notice tone="info" className="mb-3">Bulletins enregistrés avant le détail des bases : base CNSS et montants imposables reconstitués.</Notice>}

      {loading ? <LoadingState /> : (
        <div className={`${panel} overflow-hidden`}>
          {rows.length === 0 ? (
            <EmptyState icon={FileSpreadsheet} title={payslips.length === 0 ? 'Aucun bulletin pour cette période. Générez la paie du mois.' : 'Aucun bulletin validé pour cette période.'} />
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              {tab === 'cnss' && (<>
                <thead><tr className={theadRow}><th className={th}>Employé</th><th className={th}>N° CNSS</th><th className={thRight}>Jours</th><th className={thRight}>Base CNSS</th><th className={thRight}>Brut plaf.</th><th className={thRight}>CNSS+AMO sal.</th><th className={thRight}>Part patronale</th></tr></thead>
                <tbody className="divide-y divide-border">{rows.map((r, i) => <tr key={i} className="hover:bg-secondary/40"><td className={nameCell}>{r.name}{r.draft && <span className="ml-1 text-xs text-amber-700 dark:text-amber-300">(brouillon)</span>}</td><td className={`${td} font-mono text-xs text-muted-foreground`}>{r.cnss || '—'}</td><td className={`${tdNum} text-foreground`}>{r.days}</td><td className={`${tdNum} text-foreground`}>{fmt(r.cnssBase)}</td><td className={`${tdNum} text-foreground`}>{fmt(r.brutPlafonne)}</td><td className={`${tdNum} text-foreground`}>{fmt(r.cnss_emp + r.amo_emp)}</td><td className={`${tdNum} text-muted-foreground`}>{fmt(r.cnss_er + r.amo_er + r.af + r.tfp)}</td></tr>)}</tbody>
                <tfoot><tr className={tfootRow}><td colSpan={2} className={footLabel}>Totaux</td><td className={`${tdNum} text-foreground`}>{totals.days}</td><td className={`${tdNum} text-foreground`}>{fmt(rows.reduce((s, r) => s + r.cnssBase, 0))}</td><td className={`${tdNum} text-foreground`}>{fmt(rows.reduce((s, r) => s + r.brutPlafonne, 0))}</td><td className={`${tdNum} text-foreground`}>{fmt(totals.cnss_emp + totals.amo_emp)}</td><td className={`${tdNum} text-foreground`}>{fmt(totals.cnss_er + totals.amo_er + totals.af + totals.tfp)}</td></tr></tfoot>
              </>)}
              {tab === 'ir' && (<>
                <thead><tr className={theadRow}><th className={th}>Employé</th><th className={thRight}>Brut imposable</th><th className={thRight}>Net imposable</th><th className={thRight}>IR retenu</th></tr></thead>
                <tbody className="divide-y divide-border">{rows.map((r, i) => <tr key={i} className="hover:bg-secondary/40"><td className={nameCell}>{r.name}{r.draft && <span className="ml-1 text-xs text-amber-700 dark:text-amber-300">(brouillon)</span>}</td><td className={`${tdNum} text-foreground`}>{fmt(r.taxableGross)}</td><td className={`${tdNum} text-foreground`}>{fmt(r.netTaxable)}</td><td className={`${tdNum} text-foreground`}>{fmt(r.ir)}</td></tr>)}</tbody>
                <tfoot><tr className={tfootRow}><td className={footLabel}>Totaux</td><td className={`${tdNum} text-foreground`}>{fmt(totals.taxableGross)}</td><td className={`${tdNum} text-foreground`}>{fmt(totals.netTaxable)}</td><td className={`${tdNum} text-foreground`}>{fmt(totals.ir)}</td></tr></tfoot>
              </>)}
              {tab === 'cimr' && (<>
                <thead><tr className={theadRow}><th className={th}>Employé</th><th className={th}>N° CIMR</th><th className={thRight}>CIMR salariale</th><th className={thRight}>CIMR patronale</th></tr></thead>
                <tbody className="divide-y divide-border">{rows.map((r, i) => <tr key={i} className="hover:bg-secondary/40"><td className={nameCell}>{r.name}</td><td className={`${td} font-mono text-xs text-muted-foreground`}>{r.cimr_no || '—'}</td><td className={`${tdNum} text-foreground`}>{fmt(r.cimr)}</td><td className={`${tdNum} text-foreground`}>{fmt(r.cimr_er)}</td></tr>)}</tbody>
                <tfoot><tr className={tfootRow}><td colSpan={2} className={footLabel}>Total</td><td className={`${tdNum} text-foreground`}>{fmt(totals.cimr)}</td><td className={`${tdNum} text-foreground`}>{fmt(totals.cimr_er)}</td></tr></tfoot>
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
