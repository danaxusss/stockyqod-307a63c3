import React, { useEffect, useState, useCallback } from 'react';
import { FileCheck2, Printer } from 'lucide-react';
import { SupabaseEmployeesService } from '../../utils/supabaseEmployees';
import { CompanySettingsService, type CompanySettings } from '../../utils/companySettings';
import { getCompanyContext } from '../../utils/supabaseCompanyFilter';
import type { Employee } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { PageHeader } from '../../components/PageHeader';
import { btnPrimary, EmptyState, field, fieldLabel, LoadingState, panel } from '../../components/backoffice/BackOfficeUi';

function fmt(n: number) { return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n); }
const today = () => new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const CONTRACT: Record<string, string> = { CDI: 'contrat à durée indéterminée', CDD: 'contrat à durée déterminée', Interim: 'contrat d\'intérim' };

type DocType = 'salaire' | 'travail' | 'certificat';

export default function AttestationsPage() {
  const { isPaie, isSuperAdmin } = useAuth();
  const { showToast } = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [employeeId, setEmployeeId] = useState('');
  const [docType, setDocType] = useState<DocType>('travail');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const emps = await SupabaseEmployeesService.list();
      setEmployees(emps);
      const { companyId } = getCompanyContext();
      if (companyId) setSettings(await CompanySettingsService.getSettings(companyId).catch(() => null));
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const emp = employees.find(e => e.id === employeeId);
  const company = settings?.company_name || 'La société';
  // Companies have no city field: the town is the last part of the address
  // ("12 Bd Zerktouni, 20000 Casablanca" → "Casablanca").
  const addressParts = (settings?.address || '').split(/[,\n]/).map(x => x.replace(/\b\d{5}\b/g, '').trim()).filter(Boolean);
  const town = addressParts.length > 1 ? addressParts[addressParts.length - 1] : '';
  const genre = emp?.gender === 'F' ? 'Madame' : 'Monsieur';
  const hire = emp?.hire_date ? new Date(emp.hire_date).toLocaleDateString('fr-FR') : '…';

  if (!isPaie && !isSuperAdmin) return <div className="py-12 text-center text-muted-foreground">Accès réservé au rôle Paie.</div>;
  if (loading) return <LoadingState />;

  const title = docType === 'salaire' ? 'ATTESTATION DE SALAIRE' : docType === 'travail' ? 'ATTESTATION DE TRAVAIL' : 'CERTIFICAT DE TRAVAIL';

  return (
    <div className="mx-auto max-w-[110rem]">
      <div className="print:hidden">
        <PageHeader
          title="Attestations"
          subtitle="Documents RH imprimables"
          actions={emp && <button onClick={() => window.print()} className={btnPrimary}><Printer className="h-4 w-4" /> Imprimer</button>}
        />
      </div>

      <div className={`${panel} mb-4 grid grid-cols-1 items-end gap-3 p-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] print:hidden`}>
        <div><label className={fieldLabel} htmlFor="att-employee">Employé</label>
          <select id="att-employee" value={employeeId} onChange={e => setEmployeeId(e.target.value)} className={field}><option value="">—</option>{employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select></div>
        <div><label className={fieldLabel} htmlFor="att-type">Type</label>
          <select id="att-type" value={docType} onChange={e => setDocType(e.target.value as DocType)} className={field}><option value="travail">Attestation de travail</option><option value="salaire">Attestation de salaire</option><option value="certificat">Certificat de travail</option></select></div>
      </div>

      {!emp && (
        <div className={`${panel} print:hidden`}>
          <EmptyState icon={FileCheck2} title="Choisissez un employé pour préparer le document." />
        </div>
      )}

      {emp && (
        <div id="print-area" className="mx-auto max-w-3xl rounded-xl border border-border bg-white p-6 leading-relaxed text-black shadow-sm sm:p-10 print:max-w-none print:border-0 print:p-0 print:shadow-none" style={{ minHeight: 400 }}>
          <div className="flex justify-between items-start mb-8">
            <div>
              <div className="font-bold text-lg">{company}</div>
              {settings?.address && <div className="text-xs text-gray-600">{settings.address}</div>}
              {settings?.ice && <div className="text-xs text-gray-600">ICE : {settings.ice}</div>}
            </div>
            <div className="text-xs text-gray-600 text-right">{town ? `${town}, le ${today()}` : `Le ${today()}`}</div>
          </div>

          <h2 className="text-center font-bold text-base underline mb-8 tracking-wide">{title}</h2>

          <div className="text-sm space-y-4">
            <p>Nous soussignés, <b>{company}</b>, attestons que {genre} <b>{emp.full_name}</b>
              {emp.cin ? <>, titulaire de la CIN n° <b>{emp.cin}</b>,</> : ''} est employé(e) au sein de notre société
              {emp.position ? <> en qualité de <b>{emp.position}</b></> : ''} depuis le <b>{hire}</b>
              {emp.contract_type ? <> dans le cadre d'un <b>{CONTRACT[emp.contract_type] || 'contrat'}</b></> : ''}.</p>

            {docType === 'salaire' && (
              <p>{genre} {emp.full_name} perçoit à ce titre un salaire mensuel brut de <b>{fmt(emp.base_salary)} MAD</b>
                {emp.cnss_number ? <> (n° CNSS : {emp.cnss_number})</> : ''}.</p>
            )}
            {docType === 'certificat' && (
              <p>{genre} {emp.full_name} nous a quittés le <b>{emp.date_sortie ? new Date(emp.date_sortie).toLocaleDateString('fr-FR') : '…'}</b>,
                libre de tout engagement. Nous lui délivrons le présent certificat pour servir et valoir ce que de droit.</p>
            )}
            {docType !== 'certificat' && (
              <p>La présente attestation est délivrée à l'intéressé(e) pour servir et valoir ce que de droit.</p>
            )}
          </div>

          <div className="mt-16 text-right text-sm">
            <div>La Direction</div>
            <div className="mt-16 text-xs text-gray-500">Signature & cachet</div>
          </div>
        </div>
      )}
    </div>
  );
}
