import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Upload } from 'lucide-react';
import type { Employee, Payslip } from '../../../types';
import { SupabaseEmployeesService } from '../../../utils/supabaseEmployees';
import { SupabasePayslipsService } from '../../../utils/supabasePayslips';
import { PayrollSettingsService } from '../../../utils/supabasePayrollSettings';
import { CompanySettingsService } from '../../../utils/companySettings';
import { officialSettingsFor, smigMonthly, type PayrollSettings } from '../../../utils/payrollDefaults';
import { computeForPayslip } from '../../../utils/payslipCompute';
import { lineFromRow } from '../../../utils/payslipLines';
import {
  asciiUpper, cnssDigits, EBDS_SITUATIONS, ebdsBytes, generateEbds, matchPreetabli, parsePreetabli, suggestedSituation,
  type EbdsEmployee, type EbdsPay, type EbdsResult, type EbdsSituation, type Preetabli,
} from '../../../utils/cnssEbds';
import { splitName } from '../../../utils/dts9421';
import { useAuth } from '../../../hooks/useAuth';
import { useToast } from '../../../context/ToastContext';
import { btnPrimary, fieldAuto, fieldSm, LoadingState, panel, td, tdNum, th, theadRow, thRight } from '../../../components/backoffice/BackOfficeUi';
import { Notice } from '../payrollUi';
import { downloadBlob, readFileBytes } from './download';

const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Shown wherever this file is offered: the layout comes from unofficial sources. */
export const EBDS_UNVERIFIED = 'Format établi à partir de descriptions non officielles : testez le dépôt sur Damancom (contrôle du fichier) avant toute déclaration réelle, et envoyez-nous un fichier préétabli réel pour validation.';

/** Entrant name as the file writes it: surname then first name. */
const entrantName = (e: Employee) => {
  const n = splitName(e);
  return asciiUpper(n.split ? e.full_name : `${n.lastName} ${n.firstName}`);
};

export function CnssEbdsTab({ month, year }: { month: number; year: number }) {
  const { companyId } = useAuth();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [bases, setBases] = useState<Map<string, number>>(new Map());
  const [settings, setSettings] = useState<PayrollSettings>(officialSettingsFor(year));
  const [companyCnss, setCompanyCnss] = useState('');
  const [file, setFile] = useState<Preetabli | null>(null);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [situations, setSituations] = useState<Record<string, EbdsSituation | null>>({});
  const [lineEnding, setLineEnding] = useState<'LF' | 'CRLF'>('LF');
  const [result, setResult] = useState<EbdsResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [emps, ps, s, company] = await Promise.all([
        SupabaseEmployeesService.list(),
        SupabasePayslipsService.list({ year, month }),
        PayrollSettingsService.get(year).catch(() => officialSettingsFor(year)),
        companyId ? CompanySettingsService.getSettings(companyId).catch(() => null) : Promise.resolve(null),
      ]);
      // Older payslips have no stored CNSS base: worked out from their lines.
      const older = ps.filter(p => p.is_locked && p.cnss_base == null);
      const b = new Map<string, number>();
      if (older.length) {
        const vars = await SupabasePayslipsService.getVariablesFor(older.map(p => p.id));
        const byId = new Map(emps.map(e => [e.id, e]));
        for (const p of older) b.set(p.id, computeForPayslip(p, byId.get(p.employee_id), (vars.get(p.id) || []).map(lineFromRow), s).cnss_base);
      }
      setEmployees(emps); setPayslips(ps); setBases(b); setSettings(s); setCompanyCnss(company?.cnss || '');
    } catch (e) { showToast({ type: 'error', message: (e as Error)?.message || 'Erreur' }); }
    finally { setLoading(false); }
  }, [year, month, companyId, showToast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setResult(null); }, [file, situations, lineEnding, month, year]);

  const locked = payslips.filter(p => p.is_locked);
  const drafts = payslips.length - locked.length;
  const ebdsEmployees: EbdsEmployee[] = useMemo(() => employees.map(e => ({
    id: e.id, name: e.full_name, cnss: e.cnss_number || '', cin: e.cin || '', hireDate: e.hire_date || null, exitDate: e.date_sortie || null,
  })), [employees]);
  const pays: EbdsPay[] = useMemo(() => locked.map(p => ({
    employeeId: p.employee_id, days: Number(p.cnss_days ?? 26), realSalary: p.cnss_base ?? bases.get(p.id) ?? p.total_gross,
  })), [locked, bases]);
  const match = useMemo(() => (file ? matchPreetabli(file, ebdsEmployees, pays) : null), [file, ebdsEmployees, pays]);
  const periodMismatch = file && (file.period.month !== month || file.period.year !== year);
  const affiliateMismatch = file && companyCnss && cnssDigits(companyCnss).replace(/^0+/, '') !== file.affiliate.replace(/^0+/, '');

  const onFile = async (f: File | undefined) => {
    setFile(null); setFileErrors([]); setSituations({}); setFileName(f?.name || '');
    if (!f) return;
    const bytes = await readFileBytes(f);
    const r = parsePreetabli(bytes);
    if ('errors' in r) { setFileErrors(r.errors); return; }
    setFile(r.file);
  };

  const situationOf = (number: string, fallback: EbdsSituation | null) => (number in situations ? situations[number] : fallback);

  const generate = () => {
    if (!file || !match) return;
    const missing = match.matches.filter(m => situationOf(m.insured.number, suggestedSituation(m, file.period)) == null);
    if (missing.length) {
      setResult({ ok: false, errors: missing.map(m => `${m.insured.number} ${m.insured.name} : choisissez une situation (aucun bulletin validé ce mois).`), warnings: [] });
      return;
    }
    const lines = match.matches.map(m => ({
      insured: m.insured,
      situation: situationOf(m.insured.number, suggestedSituation(m, file.period)) as EbdsSituation,
      days: m.pay?.days ?? 0,
      realSalary: m.pay?.realSalary ?? 0,
    }));
    const entrants = match.entrants.map(x => ({
      number: cnssDigits(x.employee.cnss), name: entrantName(employees.find(e => e.id === x.employee.id)!),
      cin: x.employee.cin, days: x.pay.days, realSalary: x.pay.realSalary, hireDate: x.employee.hireDate,
    }));
    setResult(generateEbds(file, lines, entrants, { cap: settings.cnss_cap, smigMonthly: smigMonthly(settings), lineEnding }));
  };

  const download = () => {
    if (!result || !('content' in result) || !file) return;
    downloadBlob(result.fileName, new Blob([ebdsBytes(result.content, file.encoding)], { type: 'text/plain' }));
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      <Notice tone="error">{EBDS_UNVERIFIED}</Notice>
      <p className="text-sm text-muted-foreground">
        Téléchargez sur Damancom le fichier préétabli de {MONTHS[month - 1]} {year} (AFFEBDS_…), importez-le ici, choisissez la situation des personnes
        sans bulletin, puis générez le fichier de déclaration. L'export CSV de l'onglet « CNSS / BDS » reste disponible.
      </p>
      {drafts > 0 && <Notice tone="info">{drafts} bulletin(s) non validé(s) ce mois ne sont pas déclarés. <Link to="/paie/bulletins" className="font-medium underline">Bulletins</Link></Notice>}

      <section className={panel}>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <label className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 text-sm font-medium text-foreground hover:bg-secondary">
            <Upload className="h-4 w-4" /> Importer le préétabli
            <input type="file" accept=".txt,text/plain" className="sr-only" aria-label="Fichier préétabli" onChange={e => onFile(e.target.files?.[0])} />
          </label>
          {fileName && <span className="font-mono text-xs text-muted-foreground">{fileName}</span>}
        </div>
        {fileErrors.length > 0 && (
          <div className="px-4 pb-4">
            <Notice tone="error">
              Fichier refusé (lecture stricte) :
              <ul className="mt-1 list-disc pl-4">{fileErrors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}</ul>
              {fileErrors.length > 20 && <p>… et {fileErrors.length - 20} autre(s).</p>}
            </Notice>
          </div>
        )}
        {file && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border p-4 text-sm sm:grid-cols-4">
            <dt className="text-muted-foreground">N° d'affiliation</dt><dd className="font-mono">{file.affiliate}</dd>
            <dt className="text-muted-foreground">Période</dt><dd className="font-mono">{file.periodField} ({String(file.period.month).padStart(2, '0')}/{file.period.year})</dd>
            <dt className="text-muted-foreground">Raison sociale</dt><dd>{file.companyName || '—'}</dd>
            <dt className="text-muted-foreground">Assurés</dt><dd>{file.insured.length}</dd>
            <dt className="text-muted-foreground">Émission</dt><dd className="font-mono">{file.issueDate.trim() || '—'}</dd>
            <dt className="text-muted-foreground">Exigibilité</dt><dd className="font-mono">{file.dueDate.trim() || '—'}</dd>
            <dt className="text-muted-foreground">Fins de ligne lues</dt><dd>{file.lineEnding}</dd>
            <dt className="text-muted-foreground">Identifiant transfert</dt><dd className="font-mono">{file.transferId}</dd>
          </dl>
        )}
        {file && (periodMismatch || affiliateMismatch || file.warnings.length > 0) && (
          <div className="space-y-2 px-4 pb-4">
            {periodMismatch && <Notice tone="error">Ce préétabli est pour {String(file.period.month).padStart(2, '0')}/{file.period.year}, pas pour {MONTHS[month - 1]} {year}.</Notice>}
            {affiliateMismatch && <Notice>N° d'affiliation du fichier ({file.affiliate}) différent de celui de la société ({companyCnss}).</Notice>}
            {file.warnings.map((w, i) => <Notice key={i}>{w}</Notice>)}
          </div>
        )}
      </section>

      {file && match && !periodMismatch && (<>
        <section className={`${panel} overflow-hidden`}>
          <h3 className="border-b border-border px-4 py-3 font-semibold text-foreground">Assurés du préétabli ({match.matches.length})</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className={theadRow}><th className={th}>N° CNSS</th><th className={th}>Nom (fichier)</th><th className={th}>Employé</th><th className={thRight}>Jours</th><th className={thRight}>Salaire réel</th><th className={th}>Situation</th></tr></thead>
              <tbody className="divide-y divide-border">{match.matches.map(m => {
                const sit = situationOf(m.insured.number, suggestedSituation(m, file.period));
                return (
                  <tr key={m.insured.number} className={sit == null ? 'bg-amber-500/5' : ''}>
                    <td className={`${td} font-mono text-xs`}>{m.insured.number}</td>
                    <td className={td}>{m.insured.name}</td>
                    <td className={td}>
                      {m.employee ? <span>{m.employee.name}{m.nameDiffers && <span className="ml-1 text-xs text-amber-700 dark:text-amber-300">(nom différent)</span>}</span>
                        : <span className="text-muted-foreground">Aucun employé avec ce n° CNSS{m.nameHint && <> · même nom : {m.nameHint.name} (vérifiez son n° CNSS)</>}</span>}
                      {m.employee && !m.pay && <span className="ml-1 text-xs text-muted-foreground">· pas de bulletin validé</span>}
                    </td>
                    <td className={tdNum}>{m.pay ? m.pay.days : 0}</td>
                    <td className={tdNum}>{fmt(m.pay?.realSalary ?? 0)}</td>
                    <td className={td}>
                      <select aria-label={`Situation de ${m.insured.name}`} className={fieldSm} value={sit ?? '—'}
                        onChange={e => setSituations(s => ({ ...s, [m.insured.number]: e.target.value === '—' ? null : e.target.value as EbdsSituation }))}>
                        {sit == null && <option value="—">À choisir</option>}
                        {EBDS_SITUATIONS.map(x => <option key={x.code || 'normal'} value={x.code}>{x.label}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </section>

        <section className={`${panel} overflow-hidden`}>
          <h3 className="border-b border-border px-4 py-3 font-semibold text-foreground">Entrants : bulletin validé, absents du préétabli ({match.entrants.length})</h3>
          {match.entrants.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Aucun entrant.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className={theadRow}><th className={th}>Employé</th><th className={th}>N° CNSS</th><th className={th}>CIN</th><th className={th}>Embauche</th><th className={thRight}>Jours</th><th className={thRight}>Salaire réel</th></tr></thead>
                <tbody className="divide-y divide-border">{match.entrants.map(x => (
                  <tr key={x.employee.id}>
                    <td className={td}>{x.employee.name}</td>
                    <td className={`${td} font-mono text-xs`}>{cnssDigits(x.employee.cnss) || 'sans n° (000000000)'}</td>
                    <td className={`${td} font-mono text-xs`}>{x.employee.cin || '—'}</td>
                    <td className={td}>{x.employee.hireDate || '—'}</td>
                    <td className={tdNum}>{x.pay.days}</td>
                    <td className={tdNum}>{fmt(x.pay.realSalary)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>

        <section className={panel}>
          <div className="flex flex-wrap items-center gap-3 p-4">
            <label className="flex items-center gap-2 text-sm text-foreground">Fin de ligne
              <select className={fieldAuto} value={lineEnding} onChange={e => setLineEnding(e.target.value as 'LF' | 'CRLF')} aria-label="Fin de ligne">
                <option value="LF">LF (la plupart des sources)</option>
                <option value="CRLF">CR+LF (manuel Infor)</option>
              </select>
            </label>
            <button type="button" onClick={generate} className={btnPrimary}>Générer le fichier de déclaration</button>
          </div>
          {result && 'errors' in result && (
            <div className="px-4 pb-4"><Notice tone="error">Fichier non généré :<ul className="mt-1 list-disc pl-4">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Notice></div>
          )}
          {result && result.warnings.length > 0 && (
            <div className="px-4 pb-4"><Notice><ul className="list-disc pl-4">{result.warnings.map((e, i) => <li key={i}>{e}</li>)}</ul></Notice></div>
          )}
          {result && 'content' in result && (
            <div className="space-y-3 border-t border-border p-4">
              <table className="text-sm">
                <thead><tr className={theadRow}><th className={th}>Totaux de contrôle</th><th className={thRight}>Salariés</th><th className={thRight}>Jours</th><th className={thRight}>Salaire réel</th><th className={thRight}>Plafonné</th><th className={thRight}>Somme des n°</th><th className={thRight}>Contrôle</th></tr></thead>
                <tbody className="divide-y divide-border">{([['B03 existants', result.totals.existing], ['B05 entrants', result.totals.entrants], ['B06 global', result.totals.all]] as const).map(([label, t]) => (
                  <tr key={label}><td className={td}>{label}</td><td className={tdNum}>{t.count}</td><td className={tdNum}>{t.days.toString()}</td>
                    <td className={tdNum}>{fmt(Number(t.real) / 100)}</td><td className={tdNum}>{fmt(Number(t.capped) / 100)}</td>
                    <td className={`${tdNum} font-mono text-xs`}>{t.numberSum.toString()}</td><td className={`${tdNum} font-mono text-xs`}>{t.ctr.toString()}</td></tr>
                ))}</tbody>
              </table>
              <button type="button" onClick={download} className={btnPrimary}><Download className="h-4 w-4" /> Télécharger {result.fileName} (non vérifié)</button>
              <p className="text-xs text-muted-foreground">{EBDS_UNVERIFIED}</p>
            </div>
          )}
        </section>
      </>)}
    </div>
  );
}
