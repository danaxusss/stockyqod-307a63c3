import React, { useEffect, useState, useCallback } from 'react';
import { Loader, Check, Plus, Trash2, RotateCcw, FileWarning } from 'lucide-react';
import { PayrollSettingsService } from '../../utils/supabasePayrollSettings';
import {
  officialSettingsFor, plf2027SettingsFor, settingsStatus, smigMonthly, validateIrBrackets, withIrDeductions,
  type IrBracket, type PayrollSettings,
} from '../../utils/payrollDefaults';
import { fmt, payrollYears } from '../../utils/payrollFormat';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { PageHeader } from '../../components/PageHeader';
import { StatusPill } from '../../components/lists/StatusPill';
import { btnPrimary, btnSecondary, field, fieldAuto, fieldLabel, fieldSm, iconBtnDanger, LoadingState, panel, PhoneActionBar } from '../../components/backoffice/BackOfficeUi';
import { Notice } from './payrollUi';

const currentYear = new Date().getFullYear();
const errMsg = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message || 'Échec');

export default function ParametresPaiePage() {
  const { isPaie, isSuperAdmin } = useAuth();
  const { showToast } = useToast();
  const years = payrollYears();
  const [year, setYear] = useState(currentYear);
  const [s, setS] = useState<PayrollSettings>(officialSettingsFor(currentYear));
  const [saved, setSaved] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async (y: number) => {
    setLoading(true);
    try {
      const [settings, isSaved] = await Promise.all([PayrollSettingsService.get(y), PayrollSettingsService.isSaved(y)]);
      setS(settings); setSaved(isSaved); setDirty(false);
    } catch (e) { showToast({ type: 'error', message: errMsg(e) }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(year); }, [year, load]);

  const bracketErrors = validateIrBrackets(s.ir_brackets);

  const save = async () => {
    if (bracketErrors.length) { showToast({ type: 'error', title: 'Barème IR invalide', message: bracketErrors[0] }); return; }
    setSaving(true);
    try {
      // The "amount to deduct" is always recomputed from the bands and rates.
      await PayrollSettingsService.upsert(year, { ...s, ir_brackets: withIrDeductions(s.ir_brackets) });
      showToast({ type: 'success', message: `Paramètres ${year} enregistrés` });
      setSaved(true); setDirty(false);
    } catch (e) { showToast({ type: 'error', message: errMsg(e) }); }
    finally { setSaving(false); }
  };

  const change = (patch: Partial<PayrollSettings>) => { setS(v => ({ ...v, ...patch })); setDirty(true); };
  const setBrackets = (b: IrBracket[]) => change({ ir_brackets: withIrDeductions(b) });

  const restoreOfficial = () => {
    if (!confirm(`Remplacer les paramètres ${year} par les valeurs officielles ${settingsStatus(s, year).officialYear} ? Pensez à enregistrer ensuite.`)) return;
    setS(officialSettingsFor(year)); setDirty(true);
  };
  const applyPlf2027 = () => {
    const ok = confirm(
      'Le projet de loi de finances 2027 n\'est pas encore adopté. Il prévoit pour 2027 : tranche exonérée jusqu\'à 60 000 MAD, '
      + 'puis 10 %, 20 %, 34 % et 37 %, et des frais professionnels de 45 % plafonnés à 35 000 MAD.\n\n'
      + 'Ces valeurs peuvent changer d\'ici l\'adoption : vérifiez-les dès la publication de la loi au Bulletin officiel. Appliquer quand même ?',
    );
    if (!ok) return;
    setS(plf2027SettingsFor(year)); setDirty(true);
  };

  if (!isPaie && !isSuperAdmin) return <div className="py-12 text-center text-muted-foreground">Accès réservé au rôle Paie.</div>;

  const status = settingsStatus(s, year);
  const statusPill = status.kind === 'official'
    ? <StatusPill tone="success">Conforme au barème officiel {status.officialYear}</StatusPill>
    : status.kind === 'plf2027'
      ? <StatusPill tone="warning">Projet de loi de finances 2027 (pas encore adopté)</StatusPill>
      : <StatusPill tone="warning">Valeurs modifiées</StatusPill>;

  const pctField = (k: keyof PayrollSettings) => (
    <input type="number" step="0.0001" value={s[k] as number} onChange={e => change({ [k]: Number(e.target.value) } as Partial<PayrollSettings>)}
      className={`${field} tabular-nums`} />
  );
  const val = (k: keyof PayrollSettings) => (
    <input type="number" step="0.01" value={s[k] as number} onChange={e => change({ [k]: Number(e.target.value) } as Partial<PayrollSettings>)}
      className={`${field} tabular-nums`} />
  );
  // A plain function, not a component: inputs keep focus while typing.
  const F = (label: string, node: React.ReactNode, hint?: string) => (
    <label className="block min-w-0"><span className={fieldLabel}>{label}</span>{node}{hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}</label>
  );
  const saveButton = (
    <button onClick={save} disabled={saving || bracketErrors.length > 0} className={btnPrimary}>
      {saving ? <Loader className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Enregistrer {year}
    </button>
  );

  // IR scale editing: the upper bound of a band is the lower bound of the next.
  const b = s.ir_brackets;
  const setUpper = (i: number, v: string) => {
    const hi = v.trim() === '' ? Infinity : Number(v);
    setBrackets(b.map((x, j) => (j === i ? [x[0], hi, x[2], x[3]] : j === i + 1 ? [Number.isFinite(hi) ? hi : x[0], x[1], x[2], x[3]] : x) as IrBracket));
  };
  const setRate = (i: number, v: string) => setBrackets(b.map((x, j) => (j === i ? [x[0], x[1], (Number(v) || 0) / 100, x[3]] : x) as IrBracket));
  const addBand = () => {
    const last = b[b.length - 1];
    const lo = last ? last[0] : 0;
    const split = Number.isFinite(last?.[1]) ? last[1] : lo + 20000;
    setBrackets([...b.slice(0, -1), [lo, split, last?.[2] ?? 0, 0], [split, Infinity, last?.[2] ?? 0, 0]]);
  };
  const removeBand = (i: number) => {
    const next = b.filter((_, j) => j !== i);
    // Keep the scale contiguous and open-ended.
    const fixed = next.map((x, j) => [j === 0 ? 0 : next[j - 1][1], j === next.length - 1 ? Infinity : x[1], x[2], 0] as IrBracket);
    setBrackets(fixed);
  };

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="Paramètres de paie"
        subtitle="Taux statutaires (taux en décimal, ex 0.0448 = 4,48 %)"
        actions={<>
          <select value={year} onChange={e => setYear(Number(e.target.value))} aria-label="Année" className={fieldAuto}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {!loading && <span className="hidden md:inline-flex">{saveButton}</span>}
        </>}
      />

      {loading ? <LoadingState /> : (
        <div className="space-y-4">
          <section className={`${panel} flex flex-wrap items-center gap-3 p-4`} aria-label="Conformité">
            {statusPill}
            {!saved && <span className="text-xs text-muted-foreground">Aucun paramètre enregistré pour {year} : valeurs officielles utilisées.</span>}
            {dirty && <StatusPill tone="warning">Non enregistré</StatusPill>}
            <span className="flex flex-wrap gap-2 sm:ml-auto">
              {status.kind !== 'official' && <button onClick={restoreOfficial} className={btnSecondary}><RotateCcw className="h-4 w-4" /> Rétablir les valeurs officielles</button>}
              {year >= 2027 && status.kind !== 'plf2027' && (
                <button onClick={applyPlf2027} className={btnSecondary}><FileWarning className="h-4 w-4" /> Appliquer le projet de loi de finances 2027 (pas encore adopté)</button>
              )}
            </span>
          </section>

          <div className="grid items-start gap-4 xl:grid-cols-2">
            <Section title="Cotisations salariales">
              {F("CNSS salariale", pctField('cnss_rate_emp'))}
              {F("Plafond CNSS (MAD)", val('cnss_cap'))}
              {F("AMO salariale", pctField('amo_rate_emp'))}
            </Section>
            <Section title="Cotisations patronales">
              {F("CNSS patronale", pctField('cnss_rate_er'))}
              {F("Allocations familiales", pctField('af_rate'))}
              {F("AMO patronale", pctField('amo_rate_er'))}
              {F("Taxe formation pro.", pctField('tfp_rate'))}
            </Section>
            <Section title="Frais professionnels & famille">
              {F("Taux frais pro (bas)", pctField('frais_pro_low'))}
              {F("Taux frais pro (haut)", pctField('frais_pro_high'))}
              {F("Seuil annuel frais pro", val('frais_pro_threshold'))}
              {F("Plafond annuel frais pro", val('frais_pro_cap'))}
              {F("Déduction/personne à charge (an)", val('family_ded_per_dep'))}
              {F("Nb max de personnes", val('family_ded_max'))}
            </Section>
            <Section title="Divers">
              {F("SMIG horaire (MAD)", val('smig_hourly'), `Soit ${fmt(smigMonthly(s))} MAD pour 191 h`)}
              {F("Congés acquis / mois (jours)", val('conges_days_per_month'))}
            </Section>
          </div>

          <section className={`${panel} overflow-hidden`} aria-label="Barème IR">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
              <div>
                <h2 className="font-semibold text-foreground">Barème IR {year} (annuel)</h2>
                <p className="text-xs text-muted-foreground">La somme à déduire est calculée à partir des tranches et des taux.</p>
              </div>
              <button onClick={addBand} className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-sm font-semibold text-primary hover:bg-primary/10"><Plus className="h-4 w-4" /> Tranche</button>
            </div>
            <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem_minmax(0,1fr)_2.75rem] gap-2 border-b border-border bg-secondary/40 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:grid sm:px-5">
              <span>De (MAD)</span><span>À (MAD)</span><span className="text-right">Taux</span><span className="text-right">Somme à déduire</span><span />
            </div>
            <ul className="divide-y divide-border">
              {b.map((x, i) => (
                <li key={i} className="grid grid-cols-2 items-center gap-2 px-4 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem_minmax(0,1fr)_2.75rem] sm:px-5">
                  <span className="text-sm tabular-nums text-muted-foreground">{fmt(x[0])}</span>
                  {i === b.length - 1
                    ? <span className="text-sm text-muted-foreground">et plus</span>
                    : <input type="number" min={0} step={1000} aria-label={`Borne haute de la tranche ${i + 1}`} className={`${fieldSm} tabular-nums`} value={x[1]} onChange={e => setUpper(i, e.target.value)} />}
                  <span className="flex items-center gap-1">
                    <input type="number" min={0} max={100} step={1} aria-label={`Taux de la tranche ${i + 1}`} className={`${fieldSm} text-right tabular-nums`} value={Math.round(x[2] * 10000) / 100} onChange={e => setRate(i, e.target.value)} />
                    <span className="text-xs text-muted-foreground">%</span>
                  </span>
                  <span className="text-right text-sm tabular-nums text-foreground">{fmt(x[3])}</span>
                  <span className="flex justify-end">{b.length > 1 && <button onClick={() => removeBand(i)} aria-label={`Supprimer la tranche ${i + 1}`} className={iconBtnDanger}><Trash2 className="h-4 w-4" /></button>}</span>
                </li>
              ))}
            </ul>
            {bracketErrors.length > 0 && (
              <div className="border-t border-border p-4 sm:px-5">
                <Notice tone="error"><ul className="list-disc pl-4">{bracketErrors.map(e => <li key={e}>{e}</li>)}</ul></Notice>
              </div>
            )}
          </section>

          <Notice>
            Valeurs officielles intégrées : 2025 et 2026 (barème IR art. 73 CGI, frais professionnels 35 % / 25 % plafonnés à 35 000 MAD, déduction de 600 MAD par personne à charge dès 2026, SMIG 17,92 MAD/h dès 2026). Une année suivante reprend les dernières valeurs adoptées. Vérifiez chaque année après la loi de finances et faites valider par votre expert-comptable.
          </Notice>
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
