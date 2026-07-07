import React, { useEffect, useState, useCallback } from 'react';
import { FileCheck2, Loader, Printer } from 'lucide-react';
import { SupabaseEmployeesService } from '../../utils/supabaseEmployees';
import { CompanySettingsService, type CompanySettings } from '../../utils/companySettings';
import { getCompanyContext } from '../../utils/supabaseCompanyFilter';
import type { Employee } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

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
  const genre = emp?.gender === 'F' ? 'Madame' : 'Monsieur';
  const hire = emp?.hire_date ? new Date(emp.hire_date).toLocaleDateString('fr-FR') : '…';

  if (!isPaie && !isSuperAdmin) return <div className="text-center py-12 text-muted-foreground">Accès réservé au rôle Paie.</div>;
  if (loading) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>;

  const title = docType === 'salaire' ? 'ATTESTATION DE SALAIRE' : docType === 'travail' ? 'ATTESTATION DE TRAVAIL' : 'CERTIFICAT DE TRAVAIL';

  return (
    <div className="max-w-3xl mx-auto py-6 px-3">
      <div className="flex items-center justify-between mb-4 print:hidden">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10"><FileCheck2 className="h-5 w-5 text-primary" /></div>
          <div><h1 className="text-lg font-bold text-foreground leading-tight">Attestations</h1><p className="text-xs text-muted-foreground">Documents RH imprimables</p></div>
        </div>
        {emp && <button onClick={() => window.print()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary border border-border text-sm"><Printer className="h-3.5 w-3.5" /> Imprimer</button>}
      </div>

      <div className="bg-card border border-border/60 rounded-xl p-4 mb-4 flex items-end gap-2 flex-wrap print:hidden">
        <div className="flex-1 min-w-[180px]"><label className="block text-[11px] text-muted-foreground mb-1">Employé</label>
          <select value={employeeId} onChange={e => setEmployeeId(e.target.value)} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border"><option value="">—</option>{employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select></div>
        <div><label className="block text-[11px] text-muted-foreground mb-1">Type</label>
          <select value={docType} onChange={e => setDocType(e.target.value as DocType)} className="px-2 py-1.5 text-sm rounded bg-secondary border border-border"><option value="travail">Attestation de travail</option><option value="salaire">Attestation de salaire</option><option value="certificat">Certificat de travail</option></select></div>
      </div>

      {emp && (
        <div id="print-area" className="bg-white text-black rounded-xl p-8 shadow print:shadow-none print:p-0 leading-relaxed" style={{ minHeight: 400 }}>
          <div className="flex justify-between items-start mb-8">
            <div>
              <div className="font-bold text-lg">{company}</div>
              {settings?.address && <div className="text-xs text-gray-600">{settings.address}</div>}
              {settings?.ice && <div className="text-xs text-gray-600">ICE : {settings.ice}</div>}
            </div>
            <div className="text-xs text-gray-600 text-right">{settings?.city || ''}, le {today()}</div>
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
