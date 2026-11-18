import React, { useEffect, useState, useCallback } from 'react';
import { Loader, Check, AlertTriangle } from 'lucide-react';
import { PayrollSettingsService } from '../../utils/supabasePayrollSettings';
import { DEFAULT_PAYROLL_SETTINGS, type PayrollSettings } from '../../utils/payrollDefaults';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { PageHeader } from '../../components/PageHeader';
import { btnPrimary, field, fieldAuto, fieldLabel, LoadingState, panel, PhoneActionBar } from '../../components/backoffice/BackOfficeUi';

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 4 }, (_, i) => currentYear - i + 1);

export default function ParametresPaiePage() {
  const { isPaie, isSuperAdmin } = useAuth();
  const { showToast } = useToast();
  const [year, setYear] = useState(currentYear);
  const [s, setS] = useState<PayrollSettings>(DEFAULT_PAYROLL_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (y: number) => {
    setLoading(true);
    try { setS(await PayrollSettingsService.get(y)); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(year); }, [year, load]);

  const save = async () => {
    setSaving(true);
    try { await PayrollSettingsService.upsert(year, s); showToast({ type: 'success', message: `Paramètres ${year} enregistrés` }); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setSaving(false); }
  };

  if (!isPaie && !isSuperAdmin) return <div className="py-12 text-center text-muted-foreground">Accès réservé au rôle Paie.</div>;

  const pct = (k: keyof PayrollSettings) => (
    <input type="number" step="0.0001" value={(s as any)[k]} onChange={e => setS(v => ({ ...v, [k]: Number(e.target.value) }))}
      className={`${field} tabular-nums`} />
  );
  const val = (k: keyof PayrollSettings) => (
    <input type="number" step="0.01" value={(s as any)[k]} onChange={e => setS(v => ({ ...v, [k]: Number(e.target.value) }))}
      className={`${field} tabular-nums`} />
  );
  const F = ({ label, node }: { label: string; node: React.ReactNode }) => (
    <label className="block min-w-0"><span className={fieldLabel}>{label}</span>{node}</label>
  );
  const saveButton = (
    <button onClick={save} disabled={saving} className={btnPrimary}>
      {saving ? <Loader className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Enregistrer {year}
    </button>
  );

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="Paramètres de paie"
        subtitle="Taux statutaires (taux en décimal, ex 0.0448 = 4,48 %)"
        actions={<>
          <select value={year} onChange={e => setYear(Number(e.target.value))} aria-label="Année" className={fieldAuto}>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {!loading && <span className="hidden md:inline-flex">{saveButton}</span>}
        </>}
      />

      {loading ? <LoadingState /> : (
        <div className="space-y-4">
          <div className="grid items-start gap-4 xl:grid-cols-2">
            <Section title="Cotisations salariales">
              <F label="CNSS salariale" node={pct('cnss_rate_emp')} />
              <F label="Plafond CNSS (MAD)" node={val('cnss_cap')} />
              <F label="AMO salariale" node={pct('amo_rate_emp')} />
            </Section>
            <Section title="Cotisations patronales">
              <F label="CNSS patronale" node={pct('cnss_rate_er')} />
              <F label="Allocations familiales" node={pct('af_rate')} />
              <F label="AMO patronale" node={pct('amo_rate_er')} />
              <F label="Taxe formation pro." node={pct('tfp_rate')} />
            </Section>
            <Section title="Frais professionnels & famille">
              <F label="Taux frais pro (bas)" node={pct('frais_pro_low')} />
              <F label="Taux frais pro (haut)" node={pct('frais_pro_high')} />
              <F label="Seuil annuel frais pro" node={val('frais_pro_threshold')} />
              <F label="Plafond annuel frais pro" node={val('frais_pro_cap')} />
              <F label="Déduction/personne à charge (an)" node={val('family_ded_per_dep')} />
              <F label="Nb max de personnes" node={val('family_ded_max')} />
            </Section>
            <Section title="Divers">
              <F label="SMIG horaire (MAD)" node={val('smig_hourly')} />
              <F label="Congés acquis / mois (jours)" node={val('conges_days_per_month')} />
            </Section>
          </div>

          <p className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Faites valider ces taux par votre expert-comptable. Le barème IR reste celui de la LF2025 par défaut.</span>
          </p>
          <PhoneActionBar>{saveButton}</PhoneActionBar>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={`${panel} overflow-hidden`}>
      <h2 className="border-b border-border px-4 py-3 font-semibold text-foreground sm:px-5">{title}</h2>
      <div className="grid grid-cols-1 items-end gap-3 p-4 xs:grid-cols-2 sm:grid-cols-3 sm:p-5">{children}</div>
    </section>
  );
}
