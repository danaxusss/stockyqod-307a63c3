import React, { useEffect, useState, useCallback } from 'react';
import { Settings, Loader, Check } from 'lucide-react';
import { PayrollSettingsService } from '../../utils/supabasePayrollSettings';
import { DEFAULT_PAYROLL_SETTINGS, type PayrollSettings } from '../../utils/payrollDefaults';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

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

  if (!isPaie && !isSuperAdmin) return <div className="text-center py-12 text-muted-foreground">Accès réservé au rôle Paie.</div>;

  const pct = (k: keyof PayrollSettings) => (
    <input type="number" step="0.0001" value={(s as any)[k]} onChange={e => setS(v => ({ ...v, [k]: Number(e.target.value) }))}
      className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" />
  );
  const val = (k: keyof PayrollSettings) => (
    <input type="number" step="0.01" value={(s as any)[k]} onChange={e => setS(v => ({ ...v, [k]: Number(e.target.value) }))}
      className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" />
  );
  const F = ({ label, node }: { label: string; node: React.ReactNode }) => (
    <div><label className="block text-[11px] text-muted-foreground mb-1">{label}</label>{node}</div>
  );

  return (
    <div className="max-w-3xl mx-auto py-6 px-3">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10"><Settings className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">Paramètres de paie</h1>
            <p className="text-xs text-muted-foreground">Taux statutaires (taux en décimal, ex 0.0448 = 4,48 %)</p>
          </div>
        </div>
        <select value={year} onChange={e => setYear(Number(e.target.value))} className="px-3 py-2 text-sm rounded-lg bg-secondary border border-border">
          {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {loading ? <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div> : (
        <div className="space-y-4">
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

          <div className="flex justify-end">
            <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
              {saving ? <Loader className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Enregistrer {year}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">⚠ Faites valider ces taux par votre expert-comptable. Le barème IR reste celui de la LF2025 par défaut.</p>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border/60 rounded-xl p-4">
      <h2 className="text-sm font-semibold text-foreground mb-3">{title}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{children}</div>
    </div>
  );
}
