import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, Users, X, Loader, Check, Pencil, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { StatusPill } from '../../components/lists/StatusPill';
import { RowMenu } from '../../components/lists/RowMenu';
import { useCompactList } from '../../hooks/use-mobile';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { btnPrimary, btnSecondary, checkbox, EmptyState, field, fieldLabel, LoadingState, panel, td, th, theadRow } from '../../components/backoffice/BackOfficeUi';
import {
  certificateValidOn, DEFAULT_PAYMENT_DAYS, frDay, supplierDisplayName, supplierErrors, supplierNameCandidates, today, type Supplier,
} from '../../accounting/supplierInvoices';
import { SupplierSchemaMissingError, SuppliersService } from '../../utils/supabaseSuppliers';
import { SchemaMissingNotice, SupplierTabs } from './SupplierUi';

const empty = (): Partial<Supplier> => ({ name: '', legal_type: 'societe', payment_days: DEFAULT_PAYMENT_DAYS, active: true });

export default function SuppliersPage() {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const compact = useCompactList();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [names, setNames] = useState<{ poNames: string[]; providerNames: string[] }>({ poNames: [], providerNames: [] });
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Partial<Supplier> | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, n] = await Promise.all([SuppliersService.list(), SuppliersService.usedNames()]);
      setSuppliers(s); setNames(n); setMissing(false);
    } catch (e) {
      if (e instanceof SupplierSchemaMissingError) setMissing(true);
      else showToast({ type: 'error', title: 'Erreur', message: (e as Error).message });
    } finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const candidates = useMemo(() => supplierNameCandidates(names.poNames, names.providerNames, suppliers), [names, suppliers]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? suppliers.filter(s => [s.name, s.first_name, s.ice, s.if_number, s.city].some(v => (v || '').toLowerCase().includes(q))) : suppliers;
  }, [suppliers, search]);

  const createFromNames = async () => {
    setBusy(true);
    try {
      for (const name of picked) await SuppliersService.save({ name, legal_type: 'societe', payment_days: DEFAULT_PAYMENT_DAYS }, currentUser?.username);
      showToast({ type: 'success', title: 'Fiches créées', message: `${picked.size} fournisseur(s). Complétez leur ICE et IF.` });
      setPicked(new Set());
      await load();
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: (e as Error).message });
    } finally { setBusy(false); }
  };

  const remove = async (s: Supplier) => {
    if (!confirm(`Supprimer la fiche « ${s.name} » ?`)) return;
    try { await SuppliersService.remove(s.id); await load(); }
    catch (e) { showToast({ type: 'error', title: 'Suppression impossible', message: (e as Error).message }); }
  };

  const today0 = today();
  const certPill = (s: Supplier) => s.tax_certificate_date
    ? (certificateValidOn(s.tax_certificate_date, today0)
      ? <StatusPill tone="success">Attestation valide</StatusPill>
      : <StatusPill tone="warning">Attestation expirée</StatusPill>)
    : <StatusPill tone="neutral">Sans attestation</StatusPill>;

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader title="Fournisseurs" subtitle="Fiches fournisseurs : ICE, IF, délai de paiement, attestation de régularité fiscale"
        actions={!missing && <button onClick={() => setEditing(empty())} className={btnPrimary}><Plus className="h-4 w-4" />Nouveau fournisseur</button>}>
        <SupplierTabs current="suppliers" />
      </PageHeader>

      {loading ? <LoadingState /> : missing ? <SchemaMissingNotice /> : (
        <div className="space-y-4">
          {candidates.length > 0 && (
            <section className={`${panel} p-4`}>
              <h2 className="font-semibold text-foreground">Fournisseurs déjà utilisés sans fiche</h2>
              <p className="mt-1 text-sm text-muted-foreground">Noms trouvés sur les bons de commande et la liste des fournisseurs du stock. Cochez ceux à créer ; les bons de commande ne sont pas modifiés.</p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {candidates.map(c => (
                  <li key={c.name}>
                    <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                      <input type="checkbox" className={checkbox} checked={picked.has(c.name)}
                        onChange={e => setPicked(prev => { const n = new Set(prev); if (e.target.checked) n.add(c.name); else n.delete(c.name); return n; })} />
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{c.name}</span>
                      {c.orders > 0 && <span className="shrink-0 text-xs text-muted-foreground">{c.orders} commande{c.orders > 1 ? 's' : ''}</span>}
                    </label>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => setPicked(new Set(candidates.map(c => c.name)))} className={btnSecondary}>Tout cocher</button>
                <button onClick={createFromNames} disabled={busy || picked.size === 0} className={btnPrimary}>
                  {busy ? <Loader className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Créer {picked.size || ''} fiche{picked.size > 1 ? 's' : ''}
                </button>
              </div>
            </section>
          )}

          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Nom, ICE, IF, ville…" aria-label="Rechercher un fournisseur" className={`${field} pl-9`} />
          </div>

          <div className={`${panel} overflow-hidden`}>
            {shown.length === 0 ? (
              <EmptyState icon={Users} title="Aucun fournisseur" hint="Créez une fiche par fournisseur : elle sert aux factures, aux retenues et à la déclaration des délais de paiement." />
            ) : compact ? (
              <ul className="divide-y divide-border">
                {shown.map(s => (
                  <li key={s.id} className="flex items-start gap-2 px-4 py-3">
                    <button type="button" onClick={() => setEditing(s)} className="min-w-0 flex-1 text-left">
                      <p className="truncate font-medium text-foreground">{supplierDisplayName(s)}</p>
                      <p className="truncate text-xs text-muted-foreground">ICE {s.ice || '—'} · IF {s.if_number || '—'} · {s.payment_days} j</p>
                      <div className="mt-1.5">{certPill(s)}</div>
                    </button>
                    <RowMenu label={`Actions ${s.name}`} items={[
                      { label: 'Modifier', icon: <Pencil className="h-4 w-4" />, onSelect: () => setEditing(s) },
                      { label: 'Supprimer', icon: <Trash2 className="h-4 w-4" />, onSelect: () => remove(s), danger: true, separated: true },
                    ]} />
                  </li>
                ))}
              </ul>
            ) : (
              <table className="w-full text-sm">
                <thead className={theadRow}>
                  <tr><th className={th}>Fournisseur</th><th className={th}>Type</th><th className={th}>ICE</th><th className={th}>IF</th><th className={th}>Ville</th><th className={th}>Délai</th><th className={th}>Attestation</th><th className={th} aria-label="Actions" /></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {shown.map(s => (
                    <tr key={s.id} className="hover:bg-secondary/60">
                      <td className={td}><button type="button" onClick={() => setEditing(s)} className="font-medium text-primary hover:underline">{supplierDisplayName(s)}</button>{s.active === false && <span className="ml-2 text-xs text-muted-foreground">(inactif)</span>}</td>
                      <td className={td}>{s.legal_type === 'personne_physique' ? 'Personne physique' : 'Société'}</td>
                      <td className={`${td} font-mono text-xs`}>{s.ice || '—'}</td>
                      <td className={`${td} font-mono text-xs`}>{s.if_number || '—'}</td>
                      <td className={td}>{s.city || '—'}</td>
                      <td className={td}>{s.payment_days} j</td>
                      <td className={td}>{certPill(s)}{s.tax_certificate_date && <span className="ml-2 text-xs text-muted-foreground">{frDay(s.tax_certificate_date)}</span>}</td>
                      <td className={`${td} text-right`}>
                        <RowMenu label={`Actions ${s.name}`} items={[
                          { label: 'Modifier', icon: <Pencil className="h-4 w-4" />, onSelect: () => setEditing(s) },
                          { label: 'Supprimer', icon: <Trash2 className="h-4 w-4" />, onSelect: () => remove(s), danger: true, separated: true },
                        ]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {editing && <SupplierForm initial={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} user={currentUser?.username || null} />}
    </div>
  );
}

export function SupplierForm({ initial, onClose, onSaved, user }: { initial: Partial<Supplier>; onClose: () => void; onSaved: (s: Supplier) => void; user: string | null }) {
  const { showToast } = useToast();
  const [s, setS] = useState<Partial<Supplier>>(initial);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Supplier>(k: K, v: Supplier[K]) => setS(prev => ({ ...prev, [k]: v }));
  const errors = supplierErrors(s);
  const person = s.legal_type === 'personne_physique';

  const save = async () => {
    if (errors.length) { showToast({ type: 'error', message: errors[0] }); return; }
    setSaving(true);
    try {
      const saved = await SuppliersService.save({ ...s, name: s.name || '' }, user);
      showToast({ type: 'success', message: 'Fournisseur enregistré' });
      onSaved(saved);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: (e as Error).message });
    } finally { setSaving(false); }
  };

  const input = (id: keyof Supplier, label: string, props: Record<string, unknown> = {}) => (
    <div>
      <label htmlFor={`sup-${String(id)}`} className={fieldLabel}>{label}</label>
      <input id={`sup-${String(id)}`} value={String(s[id] ?? '')} onChange={e => set(id, e.target.value as never)} className={field} {...props} />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-3" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div role="dialog" aria-modal="true" aria-labelledby="supplier-form-title" onClick={e => e.stopPropagation()}
        className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 id="supplier-form-title" className="font-semibold text-foreground">{initial.id ? 'Modifier le fournisseur' : 'Nouveau fournisseur'}</h2>
          <button onClick={onClose} aria-label="Fermer" className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid flex-1 grid-cols-1 gap-3 overflow-y-auto p-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <span className={fieldLabel}>Type</span>
            <div className="flex gap-2">
              {(['societe', 'personne_physique'] as const).map(t => (
                <label key={t} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm">
                  <input type="radio" name="legal_type" checked={s.legal_type === t} onChange={() => set('legal_type', t)} />
                  {t === 'societe' ? 'Société' : 'Personne physique'}
                </label>
              ))}
            </div>
          </div>
          {input('name', person ? 'Nom' : 'Raison sociale')}
          {person ? input('first_name', 'Prénom') : <div className="hidden sm:block" />}
          {input('ice', 'ICE (15 chiffres)', { inputMode: 'numeric' })}
          {input('if_number', 'Identifiant fiscal (IF)', { inputMode: 'numeric' })}
          {input('rc', 'Registre de commerce (RC)')}
          {input('city', 'Ville')}
          <div className="sm:col-span-2">{input('address', 'Adresse du siège')}</div>
          {input('phone', 'Téléphone', { inputMode: 'tel' })}
          {input('email', 'E-mail', { type: 'email' })}
          <div>
            <label htmlFor="sup-days" className={fieldLabel}>Délai de paiement convenu (jours)</label>
            <input id="sup-days" type="number" min={0} max={120} value={s.payment_days ?? DEFAULT_PAYMENT_DAYS} onChange={e => set('payment_days', Number(e.target.value))} className={field} />
            <p className="mt-1 text-xs text-muted-foreground">60 jours sans accord écrit, 120 au plus (loi 69-21).</p>
          </div>
          <div>
            <label htmlFor="sup-cert" className={fieldLabel}>Attestation de régularité fiscale du</label>
            <input id="sup-cert" type="date" value={s.tax_certificate_date || ''} onChange={e => set('tax_certificate_date', e.target.value || null)} className={field} />
            <p className="mt-1 text-xs text-muted-foreground">Valable 6 mois. Sans elle, la TVA des biens d’équipement et travaux est retenue (art. 117).</p>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="sup-notes" className={fieldLabel}>Notes</label>
            <textarea id="sup-notes" value={s.notes || ''} onChange={e => set('notes', e.target.value)} rows={2} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          {initial.id && (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" className={checkbox} checked={s.active !== false} onChange={e => set('active', e.target.checked)} />Fournisseur actif
            </label>
          )}
          {errors.length > 0 && <p role="alert" className="text-sm text-destructive sm:col-span-2">{errors[0]}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button onClick={onClose} className={btnSecondary}>Annuler</button>
          <button onClick={save} disabled={saving || errors.length > 0} className={btnPrimary}>
            {saving ? <Loader className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
