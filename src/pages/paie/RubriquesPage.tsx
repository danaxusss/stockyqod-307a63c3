import React, { useEffect, useState, useCallback } from 'react';
import { FileText, Plus, Sparkles, Trash2, Check, X, Pencil } from 'lucide-react';
import { RubriquesService, type Rubrique } from '../../utils/supabaseRubriques';
import type { ExemptionCeiling } from '../../utils/payrollDefaults';
import { fmt } from '../../utils/payrollFormat';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { PageHeader } from '../../components/PageHeader';
import { StatusPill } from '../../components/lists/StatusPill';
import { btnPrimary, btnSecondary, checkbox, EmptyState, field, fieldLabel, iconBtn, iconBtnDanger, LoadingState, panel, td, th, theadRow } from '../../components/backoffice/BackOfficeUi';

const BASE_LABELS: Record<Rubrique['base'], string> = { fixe: 'Montant fixe', pourcentage_base: '% du salaire de base', heures: 'Heures', formule: 'Saisie libre' };
const errMsg = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message || 'Échec');

type CeilingKind = '' | 'amount' | 'percent';
interface Form {
  code: string; label: string; type: 'gain' | 'retenue'; base: Rubrique['base']; rate: string;
  soumis_cnss: boolean; soumis_amo: boolean; soumis_ir: boolean; soumis_cimr: boolean; inclus_anciennete: boolean;
  ir_kind: CeilingKind; ir_value: string; cnss_kind: CeilingKind; cnss_value: string;
}
const EMPTY: Form = {
  code: '', label: '', type: 'gain', base: 'fixe', rate: '0',
  soumis_cnss: true, soumis_amo: true, soumis_ir: true, soumis_cimr: false, inclus_anciennete: false,
  ir_kind: '', ir_value: '', cnss_kind: '', cnss_value: '',
};

const toForm = (r: Rubrique): Form => ({
  code: r.code, label: r.label, type: r.type, base: r.base || 'fixe', rate: String(r.rate ?? 0),
  soumis_cnss: r.soumis_cnss, soumis_amo: r.soumis_amo, soumis_ir: r.soumis_ir, soumis_cimr: r.soumis_cimr, inclus_anciennete: r.inclus_anciennete,
  ir_kind: r.ir_ceiling?.type || '', ir_value: r.ir_ceiling ? String(r.ir_ceiling.value) : '',
  cnss_kind: r.cnss_ceiling?.type || '', cnss_value: r.cnss_ceiling ? String(r.cnss_ceiling.value) : '',
});
const ceilingOf = (kind: CeilingKind, value: string): ExemptionCeiling | null => (kind ? { type: kind, value: Number(value) || 0 } : null);
const ceilingText = (c: ExemptionCeiling | null) => (c ? (c.type === 'percent' ? `${c.value} % du base` : `${fmt(c.value)} MAD`) : '');

export default function RubriquesPage() {
  const { isPaie, isSuperAdmin } = useAuth();
  const { showToast } = useToast();
  const [rubriques, setRubriques] = useState<Rubrique[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // null: closed; '' : a new rubrique; an id: editing that rubrique.
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRubriques(await RubriquesService.list()); }
    catch (e) { showToast({ type: 'error', message: errMsg(e) }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const initDefaults = async () => {
    setBusy(true);
    try { const n = await RubriquesService.initDefaults(); showToast({ type: 'success', message: `${n} rubrique(s) ajoutée(s)` }); await load(); }
    catch (e) { showToast({ type: 'error', message: errMsg(e) }); }
    finally { setBusy(false); }
  };

  const openNew = () => { setForm(EMPTY); setEditing(''); };
  const openEdit = (r: Rubrique) => { setForm(toForm(r)); setEditing(r.id); };

  const save = async () => {
    if (!form.code.trim() || !form.label.trim()) { showToast({ type: 'error', message: 'Code et libellé requis' }); return; }
    const patch = {
      code: form.code.trim().toUpperCase(), label: form.label.trim(), type: form.type, base: form.base, rate: Number(form.rate) || 0,
      soumis_cnss: form.soumis_cnss, soumis_amo: form.soumis_amo, soumis_ir: form.soumis_ir, soumis_cimr: form.soumis_cimr,
      inclus_anciennete: form.inclus_anciennete,
      // A ceiling only matters when the line is not fully subject.
      ir_ceiling: form.soumis_ir ? null : ceilingOf(form.ir_kind, form.ir_value),
      cnss_ceiling: form.soumis_cnss && form.soumis_amo ? null : ceilingOf(form.cnss_kind, form.cnss_value),
    };
    setBusy(true);
    try {
      if (editing) await RubriquesService.update(editing, patch);
      else await RubriquesService.upsert(patch);
      showToast({ type: 'success', message: 'Rubrique enregistrée' });
      setEditing(null); await load();
    } catch (e) { showToast({ type: 'error', message: errMsg(e) }); }
    finally { setBusy(false); }
  };

  if (!isPaie && !isSuperAdmin) return <div className="py-12 text-center text-muted-foreground">Accès réservé au rôle Paie.</div>;

  const typePill = (r: Rubrique) => r.type === 'gain' ? <StatusPill tone="success">Gain</StatusPill> : <StatusPill tone="danger">Retenue</StatusPill>;
  const subjects = (r: Rubrique) => [r.soumis_cnss && 'CNSS', r.soumis_amo && 'AMO', r.soumis_ir && 'IR', r.soumis_cimr && 'CIMR', r.inclus_anciennete && 'Anc.'].filter(Boolean).join(' · ') || '—';
  const ceilings = (r: Rubrique) => [r.ir_ceiling && `IR ${ceilingText(r.ir_ceiling)}`, r.cnss_ceiling && `CNSS ${ceilingText(r.cnss_ceiling)}`].filter(Boolean).join(' · ');
  const rule = (r: Rubrique) => (r.base === 'heures' ? `Heures × ${String(r.rate).replace('.', ',')}` : r.base === 'pourcentage_base' ? `${r.rate} % du base` : BASE_LABELS[r.base] || '—');
  const rowActions = (r: Rubrique) => (
    <span className="flex justify-end gap-0.5">
      <button onClick={() => openEdit(r)} aria-label={`Modifier ${r.label}`} title="Modifier" className={iconBtn}><Pencil className="h-4 w-4" /></button>
      <button onClick={() => { if (confirm(`Supprimer la rubrique ${r.label} ?`)) RubriquesService.remove(r.id).then(load).catch(e => showToast({ type: 'error', message: errMsg(e) })); }} aria-label={`Supprimer ${r.label}`} title="Supprimer" className={iconBtnDanger}><Trash2 className="h-4 w-4" /></button>
    </span>
  );
  const check = 'flex min-h-9 items-center gap-2 text-sm text-foreground';
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => ({ ...f, [k]: v }));

  const ceilingEditor = (label: string, kindKey: 'ir_kind' | 'cnss_kind', valueKey: 'ir_value' | 'cnss_value', disabled: boolean) => (
    <div className="min-w-0">
      <label className={fieldLabel} htmlFor={`rub-${kindKey}`}>{label}</label>
      <div className="flex gap-2">
        <select id={`rub-${kindKey}`} value={form[kindKey]} disabled={disabled} onChange={e => set(kindKey, e.target.value as CeilingKind)} className={field}>
          <option value="">Aucun (tout exonéré)</option>
          <option value="amount">Montant mensuel</option>
          <option value="percent">% du salaire de base</option>
        </select>
        {form[kindKey] && !disabled && (
          <input type="number" min={0} step={0.01} aria-label={`${label} : valeur`} value={form[valueKey]} onChange={e => set(valueKey, e.target.value)} className={`${field} w-28 tabular-nums`} />
        )}
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="Rubriques de paie"
        subtitle={`${rubriques.length} rubrique(s)`}
        actions={<>
          {rubriques.length === 0 && <button onClick={initDefaults} disabled={busy} className={btnSecondary}><Sparkles className="h-4 w-4" /> Rubriques par défaut</button>}
          <button onClick={openNew} aria-expanded={editing === ''} className={btnPrimary}><Plus className="h-4 w-4" /> Rubrique</button>
        </>}
      />

      {editing !== null && (
        <section className={`${panel} mb-4 space-y-3 border-primary/40 p-4`}>
          <h2 className="text-sm font-semibold text-foreground">{editing ? `Modifier — ${form.label}` : 'Nouvelle rubrique'}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[8rem_minmax(0,1fr)_10rem_12rem_8rem]">
            <div><label className={fieldLabel} htmlFor="rub-code">Code</label><input id="rub-code" value={form.code} onChange={e => set('code', e.target.value)} className={`${field} font-mono`} /></div>
            <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto"><label className={fieldLabel} htmlFor="rub-label">Libellé</label><input id="rub-label" value={form.label} onChange={e => set('label', e.target.value)} className={field} /></div>
            <div><label className={fieldLabel} htmlFor="rub-type">Type</label>
              <select id="rub-type" value={form.type} onChange={e => set('type', e.target.value as Form['type'])} className={field}><option value="gain">Gain</option><option value="retenue">Retenue</option></select></div>
            <div><label className={fieldLabel} htmlFor="rub-base">Calcul</label>
              <select id="rub-base" value={form.base} onChange={e => set('base', e.target.value as Form['base'])} className={field}>
                {(Object.keys(BASE_LABELS) as Rubrique['base'][]).map(k => <option key={k} value={k}>{BASE_LABELS[k]}</option>)}
              </select></div>
            {(form.base === 'heures' || form.base === 'pourcentage_base') && (
              <div><label className={fieldLabel} htmlFor="rub-rate">{form.base === 'heures' ? 'Coefficient' : 'Taux (%)'}</label>
                <input id="rub-rate" type="number" min={0} step={0.01} value={form.rate} onChange={e => set('rate', e.target.value)} className={`${field} tabular-nums`} /></div>
            )}
          </div>
          {form.base === 'heures' && <p className="text-xs text-muted-foreground">Montant = heures × (salaire de base / 191) × coefficient (ex. 1,25 pour +25 %).</p>}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <label className={check}><input type="checkbox" checked={form.soumis_cnss} onChange={e => set('soumis_cnss', e.target.checked)} className={checkbox} /> Soumis CNSS</label>
            <label className={check}><input type="checkbox" checked={form.soumis_amo} onChange={e => set('soumis_amo', e.target.checked)} className={checkbox} /> Soumis AMO</label>
            <label className={check}><input type="checkbox" checked={form.soumis_ir} onChange={e => set('soumis_ir', e.target.checked)} className={checkbox} /> Soumis IR</label>
            <label className={check}><input type="checkbox" checked={form.soumis_cimr} onChange={e => set('soumis_cimr', e.target.checked)} className={checkbox} /> Soumis CIMR</label>
            {form.type === 'gain' && <label className={check}><input type="checkbox" checked={form.inclus_anciennete} onChange={e => set('inclus_anciennete', e.target.checked)} className={checkbox} /> Inclus ancienneté</label>}
          </div>
          {form.type === 'gain' && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {ceilingEditor('Plafond d\'exonération IR', 'ir_kind', 'ir_value', form.soumis_ir)}
                {ceilingEditor('Plafond d\'exonération CNSS / AMO', 'cnss_kind', 'cnss_value', form.soumis_cnss && form.soumis_amo)}
              </div>
              <p className="text-xs text-muted-foreground">Plafond : la part au-dessus est soumise, la part en dessous reste exonérée.</p>
            </>
          )}
          <div className="flex w-full gap-2 sm:justify-end">
            <button onClick={() => setEditing(null)} className={`${btnSecondary} flex-1 sm:flex-none`}><X className="h-4 w-4" />Annuler</button>
            <button onClick={save} disabled={busy} className={`${btnPrimary} flex-1 sm:flex-none`}>{busy ? '…' : <Check className="h-4 w-4" />}Enregistrer</button>
          </div>
        </section>
      )}

      {loading ? (
        <LoadingState />
      ) : (
        <div className={`${panel} overflow-hidden`}>
          {rubriques.length === 0 ? (
            <EmptyState icon={FileText} title="Aucune rubrique — cliquez « Rubriques par défaut »" />
          ) : (
            <>
              <ul className="divide-y divide-border md:hidden">
                {rubriques.map(r => (
                  <li key={r.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-muted-foreground">{r.code}</span>
                        {typePill(r)}
                      </div>
                      <p className="mt-0.5 truncate font-medium text-foreground">{r.label}</p>
                      <p className="text-xs text-muted-foreground">{rule(r)} · Soumis à : {subjects(r)}</p>
                      {ceilings(r) && <p className="text-xs text-muted-foreground">Exonéré jusqu'à : {ceilings(r)}</p>}
                    </div>
                    {rowActions(r)}
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead><tr className={theadRow}>
                    <th className={th}>Code</th>
                    <th className={th}>Libellé</th>
                    <th className={th}>Type</th>
                    <th className={th}>Calcul</th>
                    <th className={th}>Soumis à</th>
                    <th className={th}>Exonéré jusqu'à</th>
                    <th className={`${th} w-24`}><span className="sr-only">Actions</span></th>
                  </tr></thead>
                  <tbody className="divide-y divide-border">
                    {rubriques.map(r => (
                      <tr key={r.id} className="hover:bg-secondary/40">
                        <td className={`${td} font-mono font-semibold text-foreground`}>{r.code}</td>
                        <td className={`${td} text-foreground`}>{r.label}</td>
                        <td className={td}>{typePill(r)}</td>
                        <td className={`${td} text-xs text-muted-foreground`}>{rule(r)}</td>
                        <td className={`${td} text-xs text-muted-foreground`}>{subjects(r)}</td>
                        <td className={`${td} text-xs text-muted-foreground`}>{ceilings(r) || '—'}</td>
                        <td className={`${td} py-1.5`}>{rowActions(r)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
