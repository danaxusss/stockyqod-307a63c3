import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Database, Images, Loader, Check, AlertTriangle } from 'lucide-react';
import { CatalogService, type ImportReport, type PhotoReport } from '../../utils/supabaseCatalog';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

async function loadSeed() {
  return (await import('../../data/cataloguePmSeed.json')).default as {
    families: { name: string; sort_order: number }[];
    products: any[];
  };
}

export default function CatalogueImportPage() {
  const navigate = useNavigate();
  const { isAdmin, isSuperAdmin } = useAuth();
  const { showToast } = useToast();
  const [state, setState] = useState<{ msg: string; pct: number } | null>(null);
  const [dataReport, setDataReport] = useState<ImportReport | null>(null);
  const [photoReport, setPhotoReport] = useState<PhotoReport | null>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const importData = async () => {
    if (!confirm('Importer le catalogue « petit matériel » (2 705 produits, 642 familles) ?\n\nProduits déjà présents dans Stocky : seule la famille et les métadonnées catalogue sont attachées (prix et noms Stocky conservés). Produits absents : créés avec le prix du catalogue et un stock à 0.')) return;
    setState({ msg: 'Chargement des données…', pct: 0 });
    try {
      const seed = await loadSeed();
      const report = await CatalogService.importSeed(seed, (msg, pct) => setState({ msg, pct }));
      setDataReport(report);
      showToast({ type: 'success', title: 'Import terminé', message: `${report.productsMatched} associés · ${report.productsCreated} créés` });
    } catch (e: any) {
      showToast({ type: 'error', title: 'Erreur', message: e?.message || 'Échec de l\'import' });
    } finally { setState(null); }
  };

  const importPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setState({ msg: 'Préparation des photos…', pct: 0 });
    try {
      const seed = await loadSeed();
      const report = await CatalogService.importPhotos(Array.from(files), seed, (msg, pct) => setState({ msg, pct }));
      setPhotoReport(report);
      showToast({ type: 'success', title: 'Photos importées', message: `${report.uploaded} envoyée(s), ${report.unmatched.length} non reconnues` });
    } catch (e: any) {
      showToast({ type: 'error', title: 'Erreur', message: e?.message || 'Échec' });
    } finally { setState(null); }
  };

  if (!isAdmin && !isSuperAdmin) return <div className="text-center py-12 text-muted-foreground">Accès réservé aux administrateurs.</div>;

  return (
    <div className="max-w-2xl mx-auto py-6 px-3">
      <div className="flex items-center gap-2 mb-5">
        <button onClick={() => navigate('/catalogue-pdf')} className="p-1.5 hover:bg-secondary rounded-lg"><ArrowLeft className="h-4 w-4 text-muted-foreground" /></button>
        <div>
          <h1 className="text-lg font-bold text-foreground leading-tight">Import initial du catalogue</h1>
          <p className="text-xs text-muted-foreground">Migration unique depuis l'outil « catalogue-pm »</p>
        </div>
      </div>

      {state && (
        <div className="mb-4 bg-card border border-border rounded-lg p-3">
          <div className="flex justify-between text-xs mb-1"><span className="text-muted-foreground">{state.msg}</span><span className="tabular-nums">{state.pct}%</span></div>
          <div className="h-1.5 bg-secondary rounded-full overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${state.pct}%` }} /></div>
        </div>
      )}

      {/* Step 1 — data */}
      <div className="bg-card border border-border/60 rounded-lg p-4 mb-4">
        <div className="flex items-start gap-3">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 shrink-0"><Database className="h-5 w-5 text-primary" /></div>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-foreground">1. Familles, produits & photos</h2>
            <p className="text-xs text-muted-foreground mt-0.5 mb-3">
              Les données du catalogue (2 705 produits, 642 familles) <b>et les photos</b> sont embarquées
              dans l'application — un seul clic suffit. Les références déjà présentes dans Stocky gardent
              leur prix et leur nom — seules la famille, la photo et les métadonnées catalogue sont
              attachées. Relançable sans doublons.
            </p>
            {dataReport ? (
              <div className="text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-md px-3 py-2 inline-flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5" />
                {dataReport.familiesCreated} familles créées · {dataReport.productsMatched} produits associés · {dataReport.productsCreated} créés
              </div>
            ) : (
              <button onClick={importData} disabled={!!state}
                className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60">
                Importer les données
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Step 2 — photos */}
      <div className="bg-card border border-border/60 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 shrink-0"><Images className="h-5 w-5 text-primary" /></div>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-foreground">2. Photos supplémentaires <span className="font-normal text-muted-foreground">(optionnel)</span></h2>
            <p className="text-xs text-muted-foreground mt-0.5 mb-3">
              Les ~1 700 photos du catalogue sont déjà incluses et liées par l'étape 1 — <b>rien à faire ici</b>.
              Ce bouton sert uniquement à importer des photos additionnelles depuis un dossier local
              (fichiers nommés par référence, ex. <code className="px-1 rounded bg-secondary">BRP-YL.jpg</code>) ;
              elles sont envoyées dans le stockage et remplacent la photo embarquée.
            </p>
            <input ref={folderRef} type="file" multiple className="hidden"
              // @ts-expect-error non-standard folder-picker attribute
              webkitdirectory=""
              onChange={e => { importPhotos(e.target.files); e.target.value = ''; }} />
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => folderRef.current?.click()} disabled={!!state}
                className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60">
                Choisir le dossier images/
              </button>
              <span className="text-[11px] text-muted-foreground">ou sélectionnez tous les fichiers du dossier</span>
            </div>
            {photoReport && (
              <div className="mt-3 space-y-1.5">
                <div className="text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-md px-3 py-2 inline-flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5" /> {photoReport.uploaded} photo(s) envoyée(s){photoReport.failed ? ` · ${photoReport.failed} échec(s)` : ''}
                </div>
                {photoReport.unmatched.length > 0 && (
                  <div className="text-xs bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-md px-3 py-2">
                    <div className="flex items-center gap-1.5 font-medium mb-1"><AlertTriangle className="h-3.5 w-3.5" /> {photoReport.unmatched.length} fichier(s) non reconnu(s)</div>
                    <div className="max-h-24 overflow-y-auto font-mono text-[10px]">{photoReport.unmatched.slice(0, 60).join(', ')}{photoReport.unmatched.length > 60 ? '…' : ''}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground mt-4">
        Une fois l'import terminé, la gestion courante (familles, masquage, photos, génération du PDF)
        se fait depuis la page <b>Catalogue PDF</b>. L'outil local catalogue-pm peut être retiré.
      </p>
    </div>
  );
}
