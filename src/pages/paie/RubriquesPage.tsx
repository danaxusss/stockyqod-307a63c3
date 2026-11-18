import React, { useEffect, useState, useCallback } from 'react';
import { FileText, Plus, Sparkles, Trash2, Check, X } from 'lucide-react';
import { RubriquesService, type Rubrique } from '../../utils/supabaseRubriques';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { PageHeader } from '../../components/PageHeader';
import { StatusPill } from '../../components/lists/StatusPill';
import { btnPrimary, btnSecondary, checkbox, EmptyState, field, fieldLabel, iconBtnDanger, LoadingState, panel, td, th, theadRow } from '../../components/backoffice/BackOfficeUi';

const BASE_LABELS: Record<string, string> = { fixe: 'Fixe', pourcentage_base: '% du base', heures: 'Heures', formule: 'Formule' };

export default function RubriquesPage() {
  const { isPaie, isSuperAdmin } = useAuth();
  const { showToast } = useToast();
  const [rubriques, setRubriques] = useState<Rubrique[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ code: '', label: '', type: 'gain', base: 'fixe', rate: '0', soumis_cnss: true, soumis_ir: true, soumis_cimr: false, inclus_anciennete: false });

  const load = useCallback(async () => {
    setLoading(true);
    try { setRubriques(await RubriquesService.list()); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const initDefaults = async () => {
    setBusy(true);
    try { const n = await RubriquesService.initDefaults(); showToast({ type: 'success', message: `${n} rubrique(s) ajoutée(s)` }); await load(); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };

  const save = async () => {
    if (!form.code.trim() || !form.label.trim()) { showToast({ type: 'error', message: 'Code et libellé requis' }); return; }
    setBusy(true);
    try {
      await RubriquesService.upsert({ code: form.code.trim().toUpperCase(), label: form.label.trim(), type: form.type as any, base: form.base as any, rate: Number(form.rate) || 0, soumis_cnss: form.soumis_cnss, soumis_amo: form.soumis_cnss, soumis_ir: form.soumis_ir, soumis_cimr: form.soumis_cimr, inclus_anciennete: form.inclus_anciennete });
      showToast({ type: 'success', message: 'Rubrique enregistrée' });
      setAdding(false); setForm({ ...form, code: '', label: '' }); await load();
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };

  if (!isPaie && !isSuperAdmin) return <div className="py-12 text-center text-muted-foreground">Accès réservé au rôle Paie.</div>;

  const typePill = (r: Rubrique) => r.type === 'gain' ? <StatusPill tone="success">Gain</StatusPill> : <StatusPill tone="danger">Retenue</StatusPill>;
  const subjects = (r: Rubrique) => [r.soumis_cnss && 'CNSS', r.soumis_ir && 'IR', r.soumis_cimr && 'CIMR', r.inclus_anciennete && 'Anc.'].filter(Boolean).join(' · ') || '—';
  const deleteButton = (r: Rubrique) => (
    <button onClick={() => RubriquesService.remove(r.id).then(load)} aria-label={`Supprimer ${r.label}`} title="Supprimer" className={iconBtnDanger}><Trash2 className="h-4 w-4" /></button>
  );
  const check = 'flex min-h-9 items-center gap-2 text-sm text-foreground';

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="Rubriques de paie"
        subtitle={`${rubriques.length} rubrique(s)`}
        actions={<>
          {rubriques.length === 0 && <button onClick={initDefaults} disabled={busy} className={btnSecondary}><Sparkles className="h-4 w-4" /> Rubriques par défaut</button>}
          <button onClick={() => setAdding(v => !v)} aria-expanded={adding} className={btnPrimary}><Plus className="h-4 w-4" /> Rubrique</button>
        </>}
      />

      {adding && (
        <section className={`${panel} mb-4 space-y-3 border-primary/40 p-4`}>
          <h2 className="text-sm font-semibold text-foreground">Nouvelle rubrique</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[8rem_minmax(0,1fr)_10rem]">
            <div><label className={fieldLabel} htmlFor="rub-code">Code</label><input id="rub-code" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} className={`${field} font-mono`} /></div>
            <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto"><label className={fieldLabel} htmlFor="rub-label">Libellé</label><input id="rub-label" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} className={field} /></div>
            <div><label className={fieldLabel} htmlFor="rub-type">Type</label>
              <select id="rub-type" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className={field}><option value="gain">Gain</option><option value="retenue">Retenue</option></select></div>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <label className={check}><input type="checkbox" checked={form.soumis_cnss} onChange={e => setForm(f => ({ ...f, soumis_cnss: e.target.checked }))} className={checkbox} /> Soumis CNSS/AMO</label>
            <label className={check}><input type="checkbox" checked={form.soumis_ir} onChange={e => setForm(f => ({ ...f, soumis_ir: e.target.checked }))} className={checkbox} /> Soumis IR</label>
            <label className={check}><input type="checkbox" checked={form.soumis_cimr} onChange={e => setForm(f => ({ ...f, soumis_cimr: e.target.checked }))} className={checkbox} /> Soumis CIMR</label>
            <label className={check}><input type="checkbox" checked={form.inclus_anciennete} onChange={e => setForm(f => ({ ...f, inclus_anciennete: e.target.checked }))} className={checkbox} /> Inclus ancienneté</label>
            <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
              <button onClick={() => setAdding(false)} aria-label="Annuler" className={`${btnSecondary} flex-1`}><X className="h-4 w-4" /><span className="sm:hidden">Annuler</span></button>
              <button onClick={save} disabled={busy} aria-label="Enregistrer la rubrique" className={`${btnPrimary} flex-1`}>{busy ? '…' : <Check className="h-4 w-4" />}<span className="sm:hidden">Enregistrer</span></button>
            </div>
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
                      <p className="text-xs text-muted-foreground">Soumis à : {subjects(r)}</p>
                    </div>
                    {deleteButton(r)}
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead><tr className={theadRow}>
                    <th className={th}>Code</th>
                    <th className={th}>Libellé</th>
                    <th className={th}>Type</th>
                    <th className={th}>Soumis à</th>
                    <th className={`${th} w-12`}><span className="sr-only">Actions</span></th>
                  </tr></thead>
                  <tbody className="divide-y divide-border">
                    {rubriques.map(r => (
                      <tr key={r.id} className="hover:bg-secondary/40">
                        <td className={`${td} font-mono font-semibold text-foreground`}>{r.code}</td>
                        <td className={`${td} text-foreground`}>{r.label}</td>
                        <td className={td}>{typePill(r)}</td>
                        <td className={`${td} text-xs text-muted-foreground`}>{subjects(r)}</td>
                        <td className={`${td} py-1.5 text-center`}>{deleteButton(r)}</td>
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
