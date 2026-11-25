import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, FileArchive, FileText, Plus, Save, Trash2 } from 'lucide-react';
import type { Employee } from '../../../types';
import { SupabaseEmployeesService } from '../../../utils/supabaseEmployees';
import { PayrollSettingsService } from '../../../utils/supabasePayrollSettings';
import { CompanySettingsService, type CompanySettings } from '../../../utils/companySettings';
import { officialSettingsFor, type PayrollSettings } from '../../../utils/payrollDefaults';
import {
  DECLARATIONS_MIGRATION, EMPTY_DECLARATION_SETTINGS, PayrollDeclarationsService, type DeclarationSettings, type IrPayment,
} from '../../../utils/supabasePayrollDeclarations';
import {
  buildDtsXml, DTS_CATEGORY_LABELS, DTS_MAX_BYTES, dtsCompleteness, dtsFileName, dtsWarnings, IR_PAYMENT_MODES, irChecks, missingMonths,
  MONTH_NAMES, paidTotal, peopleOfYear, totalDeduction, zipDtsXml, type DtsCompany, type DtsIssue, type DtsMonthPayments, type DtsReturn, type IrPaymentMode,
  type RebuiltBases,
} from '../../../utils/dts9421';
import { buildDtsRecapPdf, dtsRecapCsv } from '../../../utils/dts9421Pdf';
import type { Payslip } from '../../../types';
import { useAuth } from '../../../hooks/useAuth';
import { useToast } from '../../../context/ToastContext';
import { btnPrimary, btnSecondary, checkbox, field, fieldLabel, fieldSm, iconBtnDanger, LoadingState, panel, td, tdNum, tfootRow, th, theadRow, thRight } from '../../../components/backoffice/BackOfficeUi';
import { Notice } from '../payrollUi';
import { downloadBlob } from './download';

const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

interface Loaded {
  employees: Map<string, Employee>;
  payslips: Payslip[];
  rebuilt: Map<string, RebuiltBases>;
  settings: PayrollSettings;
  company: CompanySettings | null;
  decl: { available: boolean; settings: DeclarationSettings };
  payments: { available: boolean; payments: IrPayment[] };
}

const FIX_LINKS: Record<DtsIssue['fix'], { to: string; label: string } | null> = {
  company: { to: '/admin/settings', label: 'Paramètres société' },
  declaration: null,
  employee: { to: '/paie/employes', label: 'Fiche employé' },
  payslips: { to: '/paie/bulletins', label: 'Bulletins' },
  payments: null,
};

function IssueList({ issues }: { issues: DtsIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="divide-y divide-border text-sm">
      {issues.map((i, k) => {
        const link = FIX_LINKS[i.fix];
        return (
          <li key={k} className="flex flex-wrap items-baseline gap-x-2 px-3 py-1.5">
            <span className={`text-xs font-semibold uppercase ${i.level === 'error' ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}`}>{i.level === 'error' ? 'Manquant' : 'À vérifier'}</span>
            <span className="font-medium text-foreground">{i.who}</span>
            <span className="text-muted-foreground">{i.message}</span>
            {link && <Link to={link.to} className="text-xs font-medium text-primary hover:underline">{link.label}</Link>}
          </li>
        );
      })}
    </ul>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

export function Dts9421Tab({ year }: { year: number }) {
  const { companyId } = useAuth();
  const { showToast } = useToast();
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [decl, setDecl] = useState<DeclarationSettings>(EMPTY_DECLARATION_SETTINGS);
  const [communes, setCommunes] = useState<readonly (readonly [string, string])[]>([]);
  const [force, setForce] = useState(false);
  const [newPay, setNewPay] = useState({ month: 1, payment_date: today(), principal: '', penalty: '', surcharge: '', reference: '', receipt_number: '', payment_mode: 'SIR' as IrPaymentMode });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [emps, settings, company, declRes, paymentsRes] = await Promise.all([
        SupabaseEmployeesService.list(),
        PayrollSettingsService.get(year).catch(() => officialSettingsFor(year)),
        companyId ? CompanySettingsService.getSettings(companyId).catch(() => null) : Promise.resolve(null),
        PayrollDeclarationsService.getSettings(),
        PayrollDeclarationsService.listPayments(year),
      ]);
      const employees = new Map(emps.map(e => [e.id, e]));
      const { payslips, rebuilt } = await PayrollDeclarationsService.yearPayslips(year, employees, settings);
      setData({ employees, payslips, rebuilt, settings, company, decl: declRes, payments: paymentsRes });
      setDecl(declRes.settings);
    } catch (e) {
      showToast({ type: 'error', message: (e as Error)?.message || 'Erreur' });
    } finally { setLoading(false); }
  }, [year, companyId, showToast]);
  useEffect(() => { load(); }, [load]);
  // The DGI commune list (≈1,500 codes) is loaded only with this tab.
  useEffect(() => { import('../../../data/dgiCommunes').then(m => setCommunes(m.DGI_COMMUNES)).catch(() => setCommunes([])); }, []);

  const computed = useMemo(() => {
    if (!data) return null;
    const yearData = peopleOfYear(year, data.payslips, data.employees, data.rebuilt, data.settings);
    const c = data.company;
    const company: DtsCompany = {
      taxId: (c?.if_number || '').trim(), companyName: (c?.company_name || '').trim(),
      lastName: decl.taxpayer_last_name, firstName: decl.taxpayer_first_name, cin: decl.taxpayer_cin,
      communeCode: decl.commune_code, address: c?.address || '', cnss: c?.cnss || '', rc: c?.rc || '', tp: c?.patente || '',
      fax: decl.fax, phone: c?.phone || '', email: c?.email || '',
    };
    const byMonth = new Map<number, DtsMonthPayments>();
    for (const p of data.payments.payments) {
      const m = byMonth.get(p.month) || { month: p.month, details: [] };
      m.details.push({ reference: p.reference, receiptNumber: p.receipt_number, date: p.payment_date, principal: p.principal, penalty: p.penalty, surcharge: p.surcharge, mode: p.payment_mode });
      byMonth.set(p.month, m);
    }
    const official = officialSettingsFor(year);
    const r: DtsReturn = {
      year, company, people: yearData.people, payments: [...byMonth.values()],
      familyFieldAsAmount: decl.family_field_as_amount, familyDeductionPerDependant: official.family_ded_per_dep,
    };
    return {
      ...yearData, r,
      completeness: dtsCompleteness(r),
      warnings: dtsWarnings(r, yearData.irByMonth, official),
      ir: irChecks(yearData.people, official).filter(x => Math.abs(x.diff) >= 1),
      gaps: missingMonths(year, yearData.lastMonth, yearData.people.filter(p => p.category !== 'occasionnel')),
    };
  }, [data, decl, year]);

  if (loading) return <LoadingState />;
  if (!data || !computed) return null;

  const errors = computed.completeness.filter(i => i.level === 'error');
  const migrationMissing = !data.decl.available || !data.payments.available;
  const canExport = computed.people.length > 0 && (errors.length === 0 || force);

  const saveDecl = async () => {
    try { await PayrollDeclarationsService.saveSettings(decl); showToast({ type: 'success', message: 'Paramètres de la déclaration enregistrés.' }); await load(); }
    catch (e) { showToast({ type: 'error', message: (e as Error).message }); }
  };
  const addPayment = async () => {
    try {
      await PayrollDeclarationsService.addPayment({
        year, month: newPay.month, payment_date: newPay.payment_date, reference: newPay.reference, receipt_number: newPay.receipt_number,
        principal: Number(newPay.principal.replace(',', '.')) || 0, penalty: Number(newPay.penalty.replace(',', '.')) || 0,
        surcharge: Number(newPay.surcharge.replace(',', '.')) || 0, payment_mode: newPay.payment_mode,
      });
      setNewPay(p => ({ ...p, principal: '', penalty: '', surcharge: '', reference: '', receipt_number: '' }));
      await load();
    } catch (e) { showToast({ type: 'error', message: (e as Error).message }); }
  };
  const removePayment = async (id: string) => {
    if (!confirm('Supprimer ce versement ?')) return;
    try { await PayrollDeclarationsService.deletePayment(id); await load(); }
    catch (e) { showToast({ type: 'error', message: (e as Error).message }); }
  };

  const xml = () => buildDtsXml(computed.r);
  const exportXml = (zip: boolean) => {
    const text = xml();
    const bytes = new TextEncoder().encode(text);
    if (bytes.length > DTS_MAX_BYTES) showToast({ type: 'error', message: 'Fichier de plus de 15 Mo : SIMPL le refusera.' });
    const name = dtsFileName(computed.r.company.taxId, year);
    if (zip) downloadBlob(dtsFileName(computed.r.company.taxId, year, 'zip'), new Blob([zipDtsXml(text, name)], { type: 'application/zip' }));
    else downloadBlob(name, new Blob([bytes], { type: 'application/xml' }));
  };
  const exportCsv = () => downloadBlob(dtsFileName(computed.r.company.taxId, year, 'csv'), new Blob([dtsRecapCsv(computed.r, computed.irByMonth)], { type: 'text/csv;charset=utf-8' }));
  const exportPdf = () => downloadBlob(dtsFileName(computed.r.company.taxId, year, 'pdf'), buildDtsRecapPdf(computed.r, computed.irByMonth).output('blob'));

  const c = computed.r.company;
  const sum = (f: (p: typeof computed.people[number]) => number) => computed.people.reduce((s, p) => s + f(p), 0);
  const communeLabel = communes.find(([code]) => code === decl.commune_code)?.[1];

  return (
    <div className="space-y-4">
      <Notice tone="info">
        Déclaration des traitements et salaires {year} (modèle 9421) : à déposer sur SIMPL-IR <strong>avant le 1er mars {year + 1}</strong>.
        Le fichier XML est chargé en brouillon sur SIMPL : contrôlez-le sur SIMPL avant de le valider et de le déposer.
        Format : cahier des charges DGI EDI DTS version 5.1 (juillet 2026) ; la DGI ne publie pas le fichier de validation (XSD).
      </Notice>
      {migrationMissing && (
        <Notice tone="error">
          Base de données pas à jour : exécutez la migration {DECLARATIONS_MIGRATION} dans Supabase. En attendant, le code commune, les versements IR
          et les nouvelles informations des employés ne peuvent pas être enregistrés.
        </Notice>
      )}

      <section className={panel}>
        <h3 className="border-b border-border px-4 py-3 font-semibold text-foreground">Employeur</h3>
        <div className="grid gap-4 p-4 lg:grid-cols-2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            {([['Raison sociale', c.companyName], ['IF', c.taxId], ['N° CNSS', c.cnss], ['RC', c.rc], ['Taxe professionnelle', c.tp], ['Adresse', c.address], ['Téléphone', c.phone], ['E-mail', c.email]] as const).map(([k, v]) => (
              <React.Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd className="text-foreground">{v || '—'}</dd></React.Fragment>
            ))}
            <dt />
            <dd><Link to="/admin/settings" className="text-xs font-medium text-primary hover:underline">Modifier dans les paramètres société</Link></dd>
          </dl>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={fieldLabel} htmlFor="dts-commune">Code commune DGI *</label>
              <input id="dts-commune" list="dts-communes" className={`${field} font-mono`} placeholder="141.01.01" value={decl.commune_code}
                onChange={e => setDecl(d => ({ ...d, commune_code: (/^(\d{3}\.\d{2}\.\d{2})/.exec(e.target.value)?.[1]) || e.target.value }))} />
              <datalist id="dts-communes">{communes.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</datalist>
              <p className="mt-1 text-xs text-muted-foreground">{communeLabel || 'Liste de l\'annexe 2 de la DGI : tapez le code ou le nom de la commune.'}</p>
            </div>
            <div>
              <label className={fieldLabel} htmlFor="dts-fax">Fax</label>
              <input id="dts-fax" className={field} value={decl.fax} onChange={e => setDecl(d => ({ ...d, fax: e.target.value }))} />
            </div>
            <div className="flex items-end">
              <label className="flex items-start gap-2 text-xs text-foreground">
                <input type="checkbox" className={`${checkbox} mt-0.5`} checked={decl.family_field_as_amount} onChange={e => setDecl(d => ({ ...d, family_field_as_amount: e.target.checked }))} />
                Charges de famille en montant (600 MAD par personne, 3 600 au plus) au lieu du nombre de personnes
              </label>
            </div>
            <details className="sm:col-span-2">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Entrepreneur individuel (déclaration à son nom)</summary>
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div><label className={fieldLabel} htmlFor="dts-tp-last">Nom</label><input id="dts-tp-last" className={field} value={decl.taxpayer_last_name} onChange={e => setDecl(d => ({ ...d, taxpayer_last_name: e.target.value }))} /></div>
                <div><label className={fieldLabel} htmlFor="dts-tp-first">Prénom</label><input id="dts-tp-first" className={field} value={decl.taxpayer_first_name} onChange={e => setDecl(d => ({ ...d, taxpayer_first_name: e.target.value }))} /></div>
                <div><label className={fieldLabel} htmlFor="dts-tp-cin">CIN</label><input id="dts-tp-cin" className={field} value={decl.taxpayer_cin} onChange={e => setDecl(d => ({ ...d, taxpayer_cin: e.target.value }))} /></div>
              </div>
            </details>
            <div className="sm:col-span-2">
              <button type="button" onClick={saveDecl} disabled={!data.decl.available} className={btnSecondary}><Save className="h-4 w-4" /> Enregistrer</button>
            </div>
          </div>
        </div>
      </section>

      <section className={panel}>
        <h3 className="border-b border-border px-4 py-3 font-semibold text-foreground">Contrôles avant export</h3>
        <div className="space-y-3 p-4">
          {computed.completeness.length === 0 && computed.warnings.length === 0 && computed.ir.length === 0 && computed.gaps.length === 0 && computed.drafts.length === 0
            ? <p className="text-sm text-emerald-700 dark:text-emerald-300">Aucun manque ni écart détecté.</p> : null}
          {computed.completeness.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-semibold text-foreground">Informations manquantes ({errors.length} bloquante(s))</h4>
              <div className="rounded-lg border border-border"><IssueList issues={computed.completeness} /></div>
            </div>
          )}
          {computed.drafts.length > 0 && (
            <Notice>
              {computed.drafts.length} bulletin(s) de {year} encore en brouillon, non compris dans la déclaration :{' '}
              {[...new Set(computed.drafts.map(p => p.period_month))].sort((a, b) => a - b).map(m => MONTH_NAMES[m - 1]).join(', ')}.{' '}
              <Link to="/paie/bulletins" className="font-medium underline">Valider les bulletins</Link>
            </Notice>
          )}
          {computed.gaps.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-semibold text-foreground">Mois sans bulletin validé</h4>
              <ul className="rounded-lg border border-border text-sm">
                {computed.gaps.map(g => <li key={g.employeeId} className="border-b border-border px-3 py-1.5 last:border-0"><span className="font-medium">{g.who}</span> : {g.months.map(m => MONTH_NAMES[m - 1]).join(', ')}</li>)}
              </ul>
            </div>
          )}
          {computed.ir.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-semibold text-foreground">IR annuel recalculé (barème officiel {year}) et IR retenu</h4>
              <p className="mb-1 text-xs text-muted-foreground">Écart affiché, non corrigé : la régularisation se fait depuis la <Link to="/paie/journee" className="text-primary hover:underline">journée de paie</Link>.</p>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead><tr className={theadRow}><th className={th}>Employé</th><th className={thRight}>IR recalculé</th><th className={thRight}>IR retenu</th><th className={thRight}>Écart</th></tr></thead>
                  <tbody className="divide-y divide-border">{computed.ir.map(x => (
                    <tr key={x.employeeId}><td className={td}>{x.who}</td><td className={tdNum}>{fmt(x.recomputed)}</td><td className={tdNum}>{fmt(x.withheld)}</td>
                      <td className={`${tdNum} font-semibold`}>{x.diff > 0 ? `${fmt(x.diff)} retenu en trop` : `${fmt(-x.diff)} manquant`}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
          {computed.warnings.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-semibold text-foreground">Autres points à vérifier</h4>
              <div className="rounded-lg border border-border"><IssueList issues={computed.warnings} /></div>
            </div>
          )}
        </div>
      </section>

      <section className={`${panel} overflow-hidden`}>
        <h3 className="border-b border-border px-4 py-3 font-semibold text-foreground">Montants annuels par personne ({computed.people.length})</h3>
        {computed.people.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Aucun bulletin validé pour {year}.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className={theadRow}>
                <th className={th}>Nom</th><th className={th}>Liste</th><th className={thRight}>Jours</th><th className={thRight}>Brut</th><th className={thRight}>Exonéré</th>
                <th className={thRight}>Brut imposable</th><th className={thRight}>Déductions</th><th className={thRight}>Net imposable</th><th className={thRight}>Charges fam.</th><th className={thRight}>IR retenu</th><th className={th}>Taux</th>
              </tr></thead>
              <tbody className="divide-y divide-border">{computed.people.map(p => (
                <tr key={p.employeeId} className="hover:bg-secondary/40">
                  <td className={`${td} font-medium text-foreground`}>{p.lastName} {p.firstName}</td>
                  <td className={`${td} text-xs text-muted-foreground`}>{DTS_CATEGORY_LABELS[p.category]}</td>
                  <td className={tdNum}>{p.days}</td><td className={tdNum}>{fmt(p.gross)}</td><td className={tdNum}>{fmt(p.exempt)}</td>
                  <td className={tdNum}>{fmt(p.taxableGross)}</td><td className={tdNum}>{fmt(totalDeduction(p))}</td><td className={tdNum}>{fmt(p.netTaxable)}</td>
                  <td className={tdNum}>{p.dependents}</td><td className={tdNum}>{fmt(p.ir)}</td><td className={`${td} font-mono text-xs`}>{p.rateCode || '—'}</td>
                </tr>
              ))}</tbody>
              <tfoot><tr className={tfootRow}>
                <td className={td} colSpan={2}>Total</td><td className={tdNum}>{sum(p => p.days)}</td><td className={tdNum}>{fmt(sum(p => p.gross))}</td><td className={tdNum}>{fmt(sum(p => p.exempt))}</td>
                <td className={tdNum}>{fmt(sum(p => p.taxableGross))}</td><td className={tdNum}>{fmt(sum(totalDeduction))}</td><td className={tdNum}>{fmt(sum(p => p.netTaxable))}</td>
                <td /><td className={tdNum}>{fmt(sum(p => p.ir))}</td><td />
              </tr></tfoot>
            </table>
          </div>
        )}
      </section>

      <section className={`${panel} overflow-hidden`}>
        <h3 className="border-b border-border px-4 py-3 font-semibold text-foreground">IR retenu et versé par mois</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className={theadRow}><th className={th}>Mois</th><th className={thRight}>IR retenu</th><th className={th}>Versements (date · mode · quittance)</th><th className={thRight}>Total versé</th></tr></thead>
            <tbody className="divide-y divide-border">{MONTH_NAMES.map((name, i) => {
              const ps = data.payments.payments.filter(p => p.month === i + 1);
              return (
                <tr key={name}>
                  <td className={td}>{name}</td>
                  <td className={tdNum}>{fmt(computed.irByMonth.get(i + 1) || 0)}</td>
                  <td className={td}>{ps.length === 0 ? <span className="text-muted-foreground">—</span> : ps.map(p => (
                    <div key={p.id} className="flex items-center gap-2 text-xs">
                      <span>{p.payment_date} · {IR_PAYMENT_MODES[p.payment_mode]} · {p.receipt_number || 'sans n°'} · principal {fmt(p.principal)}</span>
                      <button type="button" onClick={() => removePayment(p.id)} className={iconBtnDanger} aria-label={`Supprimer le versement du ${p.payment_date}`}><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}</td>
                  <td className={tdNum}>{fmt(ps.reduce((s, p) => s + paidTotal(p), 0))}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-border p-3 sm:grid-cols-4 lg:grid-cols-9">
          <select aria-label="Mois du versement" className={fieldSm} value={newPay.month} onChange={e => setNewPay(p => ({ ...p, month: Number(e.target.value) }))}>{MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
          <input aria-label="Date du versement" type="date" className={fieldSm} value={newPay.payment_date} onChange={e => setNewPay(p => ({ ...p, payment_date: e.target.value }))} />
          <input aria-label="Principal" inputMode="decimal" placeholder="Principal" className={fieldSm} value={newPay.principal} onChange={e => setNewPay(p => ({ ...p, principal: e.target.value }))} />
          <input aria-label="Pénalité" inputMode="decimal" placeholder="Pénalité" className={fieldSm} value={newPay.penalty} onChange={e => setNewPay(p => ({ ...p, penalty: e.target.value }))} />
          <input aria-label="Majorations" inputMode="decimal" placeholder="Majorations" className={fieldSm} value={newPay.surcharge} onChange={e => setNewPay(p => ({ ...p, surcharge: e.target.value }))} />
          <select aria-label="Mode de paiement" className={fieldSm} value={newPay.payment_mode} onChange={e => setNewPay(p => ({ ...p, payment_mode: e.target.value as IrPaymentMode }))}>{Object.entries(IR_PAYMENT_MODES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input aria-label="Référence" placeholder="Référence" className={fieldSm} value={newPay.reference} onChange={e => setNewPay(p => ({ ...p, reference: e.target.value }))} />
          <input aria-label="N° de quittance" placeholder="N° quittance" className={fieldSm} value={newPay.receipt_number} onChange={e => setNewPay(p => ({ ...p, receipt_number: e.target.value }))} />
          <button type="button" onClick={addPayment} disabled={!data.payments.available} className={btnSecondary}><Plus className="h-4 w-4" /> Ajouter</button>
        </div>
      </section>

      <section className={panel}>
        <h3 className="border-b border-border px-4 py-3 font-semibold text-foreground">Export</h3>
        <div className="space-y-3 p-4">
          {errors.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" className={checkbox} checked={force} onChange={e => setForce(e.target.checked)} />
              Générer malgré {errors.length} information(s) manquante(s) (à compléter sur SIMPL)
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => exportXml(true)} disabled={!canExport} className={btnPrimary}><FileArchive className="h-4 w-4" /> Fichier SIMPL (XML zippé)</button>
            <button type="button" onClick={() => exportXml(false)} disabled={!canExport} className={btnSecondary}><Download className="h-4 w-4" /> XML seul</button>
            <button type="button" onClick={exportCsv} disabled={computed.people.length === 0} className={btnSecondary}><Download className="h-4 w-4" /> État récapitulatif (CSV)</button>
            <button type="button" onClick={exportPdf} disabled={computed.people.length === 0} className={btnSecondary}><FileText className="h-4 w-4" /> État récapitulatif (PDF)</button>
          </div>
          <p className="text-xs text-muted-foreground">
            Non pris en charge : sociétés CFC, stock-options, plan d'épargne entreprise, doctorants, échéances de prêt logement, cas sportif.
            Le brut est déclaré en un seul montant (indemnités et avantages non détaillés) ; la partie exonérée est dans « éléments exonérés ».
          </p>
        </div>
      </section>
    </div>
  );
}
