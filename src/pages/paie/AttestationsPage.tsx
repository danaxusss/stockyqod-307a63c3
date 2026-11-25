import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { FileCheck2, Printer } from 'lucide-react';
import { SupabaseEmployeesService } from '../../utils/supabaseEmployees';
import { SupabasePayslipsService } from '../../utils/supabasePayslips';
import { HrDocumentService } from '../../utils/supabasePayrollHr';
import { CompanySettingsService, type CompanySettings } from '../../utils/companySettings';
import { getCompanyContext } from '../../utils/supabaseCompanyFilter';
import { buildCertificatePdf, certificateText, salaryFigures, type CertificateData, type CertificateKind } from '../../utils/hrPdf';
import { localDay } from '../../utils/documentLines';
import { fmt } from '../../utils/payrollFormat';
import type { Employee, Payslip } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { PageHeader } from '../../components/PageHeader';
import { PrintPreviewModal } from '../../components/PrintPreviewModal';
import { btnPrimary, EmptyState, field, fieldLabel, LoadingState, panel } from '../../components/backoffice/BackOfficeUi';
import { Notice } from './payrollUi';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message || 'Échec');

export default function AttestationsPage() {
  const { isPaie, isSuperAdmin } = useAuth();
  const { showToast } = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [company, setCompany] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [employeeId, setEmployeeId] = useState('');
  const [kind, setKind] = useState<CertificateKind>('attestation_travail');
  const [exitDate, setExitDate] = useState('');
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [preview, setPreview] = useState<{ blob: Blob; filename: string; number: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEmployees(await SupabaseEmployeesService.list());
      const { companyId } = getCompanyContext();
      if (companyId) setCompany(await CompanySettingsService.getSettings(companyId).catch(() => null));
    } catch (e) { showToast({ type: 'error', message: errMsg(e) }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const emp = employees.find(e => e.id === employeeId);
  useEffect(() => {
    setExitDate(emp?.date_sortie || '');
    if (!emp) { setPayslips([]); return; }
    SupabasePayslipsService.list({ employeeId: emp.id }).then(ps => {
      setPayslips(ps);
      const last = ps.filter(p => p.is_locked).map(p => p.period_year).sort((a, b) => b - a)[0];
      if (last) setYear(last);
    }).catch(e => showToast({ type: 'error', message: errMsg(e) }));
  }, [emp, showToast]);

  const figures = useMemo(() => salaryFigures(payslips, year), [payslips, year]);
  const left = !!emp && (!emp.is_active || (!!emp.date_sortie && emp.date_sortie <= localDay()));
  const years = useMemo(() => [...new Set(payslips.filter(p => p.is_locked).map(p => p.period_year))].sort((a, b) => b - a), [payslips]);

  const problem = !emp ? null
    : kind === 'certificat_travail' && !exitDate ? 'Saisissez la date de sortie (dernier jour du contrat).'
      : kind !== 'certificat_travail' && left ? `${emp.full_name} a quitté la société${emp.date_sortie ? ` le ${emp.date_sortie.split('-').reverse().join('/')}` : ''} : délivrez un certificat de travail.`
        : kind === 'attestation_salaire' && figures.lastMonths.length === 0 ? 'Aucun bulletin validé : l\'attestation de salaire reprend les bulletins validés.'
          : null;

  const data = (number: string, provisional: boolean): CertificateData => ({
    kind, number, provisional, issuedOn: localDay(), exitDate: exitDate || null,
    lastMonths: figures.lastMonths, annual: figures.annual,
  });

  const generate = async () => {
    if (!emp || problem) return;
    setBusy(true);
    try {
      const { number, registered } = await HrDocumentService.issue(kind, emp.id, localDay(), { exit_date: exitDate || null, year });
      if (!registered) showToast({ type: 'warning', message: 'Base non à jour (migration 20261126150000_hr.sql) : numéro provisoire, document non enregistré.' });
      const { doc, filename } = buildCertificatePdf(emp, company, data(number, !registered));
      setPreview({ blob: doc.output('blob'), filename, number });
    } catch (e) { showToast({ type: 'error', message: errMsg(e) }); }
    finally { setBusy(false); }
  };

  if (!isPaie && !isSuperAdmin) return <div className="py-12 text-center text-muted-foreground">Accès réservé au rôle Paie.</div>;
  if (loading) return <LoadingState />;

  const companyName = company?.company_name || 'La société';
  const text = emp ? certificateText(emp, companyName, data('…', false)) : [];

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="Attestations"
        subtitle="Attestation de travail, de salaire, certificat de travail"
        actions={emp && <button onClick={generate} disabled={busy || !!problem} className={btnPrimary}><Printer className="h-4 w-4" /> Générer le PDF</button>}
      />

      <div className={`${panel} mb-4 grid grid-cols-1 items-end gap-3 p-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]`}>
        <div><label className={fieldLabel} htmlFor="att-employee">Employé</label>
          <select id="att-employee" value={employeeId} onChange={e => setEmployeeId(e.target.value)} className={field}><option value="">—</option>{employees.map(e => <option key={e.id} value={e.id}>{e.full_name}{e.is_active ? '' : ' (sorti)'}</option>)}</select></div>
        <div><label className={fieldLabel} htmlFor="att-type">Type</label>
          <select id="att-type" value={kind} onChange={e => setKind(e.target.value as CertificateKind)} className={field}>
            <option value="attestation_travail">Attestation de travail</option>
            <option value="attestation_salaire">Attestation de salaire</option>
            <option value="certificat_travail">Certificat de travail</option>
          </select></div>
        {kind === 'certificat_travail' && (
          <div><label className={fieldLabel} htmlFor="att-exit">Date de sortie</label>
            <input id="att-exit" type="date" value={exitDate} onChange={e => setExitDate(e.target.value)} className={field} /></div>
        )}
        {kind === 'attestation_salaire' && (
          <div><label className={fieldLabel} htmlFor="att-year">Année (cumuls)</label>
            <select id="att-year" value={year} onChange={e => setYear(Number(e.target.value))} className={field}>{(years.length ? years : [year]).map(y => <option key={y} value={y}>{y}</option>)}</select></div>
        )}
      </div>

      {!emp && <div className={panel}><EmptyState icon={FileCheck2} title="Choisissez un employé pour préparer le document." /></div>}

      {emp && (
        <div className="mx-auto max-w-3xl space-y-3">
          {problem && <Notice tone="error">{problem}</Notice>}
          {kind === 'certificat_travail' && <Notice tone="info">Le certificat indique l'entrée, la sortie et les postes occupés (Code du travail, art. 72) ; rien d'autre sans accord des deux parties.</Notice>}
          <section className="space-y-3 rounded-xl border border-border bg-white p-6 text-sm leading-relaxed text-black shadow-sm sm:p-10" aria-label="Texte du document">
            {text.slice(0, -1).map((t, i) => <p key={i}>{t}</p>)}
            {kind === 'attestation_salaire' && (
              <table className="w-full text-xs">
                <thead><tr className="border-b"><th className="py-1 text-left">Mois</th><th className="py-1 text-right">Brut</th><th className="py-1 text-right">Net payé</th></tr></thead>
                <tbody>
                  {figures.lastMonths.map(m => <tr key={m.label} className="border-b border-gray-100"><td className="py-1">{m.label}</td><td className="py-1 text-right tabular-nums">{fmt(m.gross)}</td><td className="py-1 text-right tabular-nums">{fmt(m.net)}</td></tr>)}
                  {figures.annual && (
                    <tr className="font-semibold"><td className="py-1">Année {figures.annual.year} ({figures.annual.months} mois) · net imposable {fmt(figures.annual.netTaxable)} · IR {fmt(figures.annual.ir)}</td><td className="py-1 text-right tabular-nums">{fmt(figures.annual.gross)}</td><td className="py-1 text-right tabular-nums">{fmt(figures.annual.net)}</td></tr>
                  )}
                </tbody>
              </table>
            )}
            <p>{text[text.length - 1]}</p>
          </section>
        </div>
      )}

      {preview && <PrintPreviewModal blob={preview.blob} filename={preview.filename} onClose={() => setPreview(null)} />}
    </div>
  );
}
