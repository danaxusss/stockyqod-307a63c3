import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { BookMarked, Search, Plus, X, Check } from 'lucide-react';
import type { Account } from '../../types';
import { AccountingService } from '../../utils/supabaseAccounting';
import { useToast } from '../../context/ToastContext';
import { PageHeader } from '../../components/PageHeader';
import { StatusPill } from '../../components/lists/StatusPill';
import { btnPrimary, btnSecondary, EmptyState, field, fieldLabel, LoadingState, panel } from '../../components/backoffice/BackOfficeUi';

const CLASS_LABELS: Record<number, string> = {
  1: 'Financement permanent', 2: 'Actif immobilisé', 3: 'Actif circulant',
  4: 'Passif circulant', 5: 'Trésorerie', 6: 'Charges', 7: 'Produits', 8: 'Résultats',
};

export default function PlanComptablePage() {
  const { showToast } = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ code: '', label: '', vat_rate: '', lettrable: false });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setAccounts(await AccountingService.listAccounts()); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? accounts.filter(a => a.code.includes(q) || a.label.toLowerCase().includes(q)) : accounts;
    const byClass = new Map<number, Account[]>();
    list.forEach(a => { if (!byClass.has(a.class)) byClass.set(a.class, []); byClass.get(a.class)!.push(a); });
    return Array.from(byClass.entries()).sort((a, b) => a[0] - b[0]);
  }, [accounts, query]);

  const save = async () => {
    if (!/^\d{3,8}$/.test(form.code.trim())) { showToast({ type: 'error', message: 'Code invalide (3 à 8 chiffres)' }); return; }
    if (!form.label.trim()) { showToast({ type: 'error', message: 'Libellé requis' }); return; }
    const cls = Number(form.code.trim()[0]);
    const type = cls === 1 || cls === 4 ? 'bilan_passif' : cls === 2 || cls === 3 ? 'bilan_actif' : cls === 5 ? 'tresorerie' : cls === 6 ? 'charge' : 'produit';
    setSaving(true);
    try {
      await AccountingService.upsertAccount({
        code: form.code.trim(), label: form.label.trim(), class: cls, type,
        vat_rate: form.vat_rate ? Number(form.vat_rate) : null, lettrable: form.lettrable,
      } as any);
      showToast({ type: 'success', message: 'Compte enregistré' });
      setAdding(false); setForm({ code: '', label: '', vat_rate: '', lettrable: false });
      await load();
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setSaving(false); }
  };

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="Plan comptable"
        subtitle={`${accounts.length} comptes (CGNC)`}
        actions={
          <button onClick={() => setAdding(v => !v)} aria-expanded={adding} className={btnPrimary}>
            <Plus className="h-4 w-4" /> Compte
          </button>
        }
      >
        <div className={`${panel} p-3`}>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Code ou libellé…" aria-label="Rechercher un compte"
              className={`${field} pl-9`} />
          </div>
        </div>
      </PageHeader>

      {adding && (
        <div className={`${panel} mb-4 border-primary/40 p-4`}>
          <h2 className="mb-3 text-sm font-semibold text-foreground">Nouveau compte</h2>
          <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[8rem_1fr_7rem_auto]">
            <div><label className={fieldLabel} htmlFor="pc-code">Code</label>
              <input id="pc-code" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="ex: 6182" className={`${field} font-mono`} /></div>
            <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto"><label className={fieldLabel} htmlFor="pc-label">Libellé</label>
              <input id="pc-label" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} className={field} /></div>
            <div><label className={fieldLabel} htmlFor="pc-tva">TVA %</label>
              <input id="pc-tva" value={form.vat_rate} onChange={e => setForm(f => ({ ...f, vat_rate: e.target.value }))} placeholder="—" className={`${field} tabular-nums`} /></div>
            <div className="col-span-2 flex gap-2 sm:col-span-1">
              <button onClick={() => setAdding(false)} className={`${btnSecondary} flex-1 sm:flex-none`} aria-label="Annuler"><X className="h-4 w-4" /><span className="sm:hidden">Annuler</span></button>
              <button onClick={save} disabled={saving} className={`${btnPrimary} flex-1 sm:flex-none`} aria-label="Enregistrer le compte">{saving ? '…' : <Check className="h-4 w-4" />}<span className="sm:hidden">Enregistrer</span></button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <LoadingState />
      ) : filtered.length === 0 ? (
        <div className={panel}><EmptyState icon={BookMarked} title={query ? 'Aucun compte ne correspond à la recherche' : 'Aucun compte'} /></div>
      ) : (
        <div className="space-y-4">
          {filtered.map(([cls, list]) => (
            <section key={cls} className={`${panel} overflow-hidden`}>
              <div className="flex items-center justify-between gap-3 border-b border-border bg-secondary/40 px-4 py-2.5">
                <h2 className="text-sm font-semibold text-foreground">
                  <span className="mr-2 inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-primary/10 px-1.5 text-xs font-bold text-primary">{cls}</span>
                  Classe {cls} — {CLASS_LABELS[cls] || ''}
                </h2>
                <span className="text-xs tabular-nums text-muted-foreground">{list.length}</span>
              </div>
              <ul className="divide-y divide-border">
                {list.map(a => (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/40">
                    <span className="w-20 shrink-0 font-mono text-sm font-semibold text-foreground">{a.code}</span>
                    <span className="min-w-0 flex-1 text-sm text-foreground">{a.label}</span>
                    <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                      {a.vat_rate != null && <StatusPill tone="info">TVA {a.vat_rate}%</StatusPill>}
                      {a.lettrable && <StatusPill tone="neutral">lettrable</StatusPill>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
