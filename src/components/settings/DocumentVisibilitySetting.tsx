import { useEffect, useState } from 'react';
import { FileLock2, Loader } from 'lucide-react';
import { Switch } from '../ui/switch';
import { useToast } from '../../context/ToastContext';
import { SupabaseCompaniesService } from '../../utils/supabaseCompanies';
import { supervisorRoleLabels } from '../../lib/documentVisibility';

/**
 * Company setting "users see only the documents they created". The database
 * applies it (companies.restrict_docs_to_creator); this only switches it.
 */
export function DocumentVisibilitySetting({ companyId }: { companyId?: string | null }) {
  const { showToast } = useToast();
  // null: not loaded; undefined: the database does not have the setting yet.
  const [value, setValue] = useState<boolean | null | undefined>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setValue(null);
    if (!companyId) return;
    SupabaseCompaniesService.getCompanyById(companyId)
      .then(company => {
        if (cancelled) return;
        const setting = (company as { restrict_docs_to_creator?: boolean } | null)?.restrict_docs_to_creator;
        setValue(typeof setting === 'boolean' ? setting : undefined);
      })
      .catch(() => { if (!cancelled) setValue(undefined); });
    return () => { cancelled = true; };
  }, [companyId]);

  if (!companyId) return null;

  const change = async (next: boolean) => {
    setSaving(true);
    try {
      await SupabaseCompaniesService.updateCompany(companyId, { restrict_docs_to_creator: next });
      setValue(next);
      showToast({ type: 'success', message: next ? 'Chacun ne voit plus que ses documents' : 'Les documents de la société sont visibles par tous' });
    } catch (error) {
      showToast({ type: 'error', title: 'Réglage non enregistré', message: (error as { message?: string })?.message || 'Erreur inconnue' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="glass mb-4 rounded-xl p-4 shadow-lg" aria-labelledby="doc-visibility-title">
      <div className="flex items-start gap-3">
        <FileLock2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 id="doc-visibility-title" className="text-sm font-semibold text-foreground">Chacun ne voit que ses documents</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Les commerciaux ne voient alors que les devis, BL, factures et autres documents qu’ils ont créés ou dont ils sont le vendeur,
            même avec un lien. Gardent tous les documents de la société : {supervisorRoleLabels().join(', ')}.
            Les revendeurs ne voient toujours que les leurs.
          </p>
          {value === undefined && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">Disponible après la mise à jour de la base de données.</p>
          )}
        </div>
        {saving || value === null
          ? <Loader className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-label="Chargement" />
          : <Switch checked={value === true} disabled={value === undefined} onCheckedChange={change} aria-labelledby="doc-visibility-title" />}
      </div>
    </section>
  );
}
