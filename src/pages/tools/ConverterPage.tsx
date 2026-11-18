import React, { useMemo, useRef, useState } from 'react';
import {
  FileSpreadsheet, Loader, Upload, X, Check, AlertTriangle, RefreshCw,
  Download, FileText, Sparkles, ChevronLeft, Stethoscope, Settings2,
} from 'lucide-react';
import {
  CONVERTER_FN, fileToPageImages, extractPage, isModuleLoadError,
  mergeTables, checkConverterFunctions, exportTableExcel,
  listVisionModels, getPreferredModel, setPreferredModel,
  type TableResult, type HealthReport, type VisionModel,
} from '../../utils/converter';
import { hardReloadApp } from '../../utils/appReload';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { PageHeader } from '../../components/PageHeader';
import { StatusPill } from '../../components/lists/StatusPill';
import { btnPrimary, btnSecondary, field, iconBtn, panel } from '../../components/backoffice/BackOfficeUi';

type PageState = { status: 'pending' | 'running' | 'ok' | 'error'; error?: string; result?: any };
type Phase = 'pick' | 'rendering' | 'extracting' | 'done';

export default function ConverterPage() {
  const { isAdmin, isSuperAdmin } = useAuth();
  const { showToast } = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>('pick');
  const [renderProgress, setRenderProgress] = useState({ done: 0, total: 0 });
  const [images, setImages] = useState<string[]>([]);
  const [pages, setPages] = useState<PageState[]>([]);
  const [staleBuild, setStaleBuild] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [health, setHealth] = useState<HealthReport[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [model, setModel] = useState<string>(() => getPreferredModel());
  const [models, setModels] = useState<VisionModel[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const okPages = pages.filter(p => p.status === 'ok');
  const failedCount = pages.filter(p => p.status === 'error').length;

  const merged = useMemo(
    () => okPages.length ? mergeTables(okPages.map(p => p.result as TableResult)) : null,
    [okPages],
  );

  const reset = () => {
    setFile(null); setImages([]); setPages([]); setPhase('pick');
    setRenderProgress({ done: 0, total: 0 });
  };

  const onFile = (f?: File | null) => {
    if (!f) return;
    const okType = f.type.includes('pdf') || f.type.startsWith('image/');
    if (!okType) { showToast({ type: 'error', message: 'Choisissez un PDF ou une image (JPG/PNG)' }); return; }
    if (f.size > 25 * 1024 * 1024) { showToast({ type: 'error', message: 'Fichier trop volumineux (max 25 Mo)' }); return; }
    setFile(f); setImages([]); setPages([]); setPhase('pick');
  };

  const extractAll = async (imgs: string[], states: PageState[]) => {
    setPhase('extracting');
    const next = [...states];
    for (let i = 0; i < imgs.length; i++) {
      if (next[i].status === 'ok') continue;
      next[i] = { status: 'running' };
      setPages([...next]);
      try {
        const result = await extractPage(imgs[i], model || null);
        next[i] = { status: 'ok', result };
      } catch (e: any) {
        next[i] = { status: 'error', error: e?.message || 'Échec' };
      }
      setPages([...next]);
    }
    setPhase('done');
    const okN = next.filter(p => p.status === 'ok').length;
    if (okN === 0) showToast({ type: 'error', message: 'Aucune page n\'a pu être analysée — voir les erreurs ci-dessous' });
    else if (okN < imgs.length) showToast({ type: 'info', message: `${okN}/${imgs.length} pages analysées — réessayez les pages en échec` });
    else showToast({ type: 'success', message: 'Analyse terminée — vérifiez l\'aperçu avant export' });
  };

  const convert = async () => {
    if (!file) return;
    setStaleBuild(false);
    try {
      setPhase('rendering');
      const imgs = await fileToPageImages(file, (done, total) => setRenderProgress({ done, total }));
      setImages(imgs);
      const states: PageState[] = imgs.map(() => ({ status: 'pending' }));
      setPages(states);
      await extractAll(imgs, states);
    } catch (e: any) {
      // The PDF engine is fetched on demand, so a page left open across a
      // deploy fails here rather than at load time. Offer the actual remedy.
      if (isModuleLoadError(e) || /module de lecture PDF/.test(String(e?.message))) {
        setStaleBuild(true);
      } else {
        showToast({ type: 'error', message: e?.message || 'Échec de la lecture du fichier' });
      }
      setPhase('pick');
    }
  };

  const retryFailed = () => extractAll(images, pages);

  const runHealthCheck = async () => {
    setChecking(true);
    try { setHealth(await checkConverterFunctions()); }
    finally { setChecking(false); }
  };

  const loadModels = async () => {
    setLoadingModels(true); setModelsError(null);
    try { setModels(await listVisionModels()); }
    catch (e: any) { setModelsError(e?.message || 'Liste indisponible'); }
    finally { setLoadingModels(false); }
  };

  const openSettings = () => {
    setShowSettings(s => !s);
    if (!models && !loadingModels) loadModels();
  };

  const chooseModel = (id: string) => { setModel(id); setPreferredModel(id); };

  const exportExcel = async () => {
    if (!merged || !file) return;
    const base = file.name.replace(/\.[^.]+$/, '');
    try {
      await exportTableExcel(merged, `${base}.xlsx`);
      showToast({ type: 'success', message: 'Fichier Excel téléchargé' });
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec de l\'export' }); }
  };

  if (!isAdmin && !isSuperAdmin) return <div className="py-12 text-center text-muted-foreground">Accès réservé aux administrateurs.</div>;

  const busy = phase === 'rendering' || phase === 'extracting';

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="Convertisseur de documents"
        subtitle="PDF ou scan → Excel, lecture par IA (même clé que l'assistant)"
        actions={<>
          <button onClick={openSettings} aria-expanded={showSettings}
            className={`${btnSecondary} ${showSettings ? 'border-primary/40 bg-primary/10 text-primary' : ''}`}
            title="Choisir le modèle IA">
            <Settings2 className="h-4 w-4" /> Modèle
          </button>
          <button onClick={runHealthCheck} disabled={checking}
            className={btnSecondary}
            title="Vérifier que les fonctions IA sont déployées">
            {checking ? <Loader className="h-4 w-4 animate-spin" /> : <Stethoscope className="h-4 w-4" />}
            Diagnostic
          </button>
        </>}
      />

      {showSettings && (
        <section className={`${panel} mb-4 p-4`}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-semibold text-foreground">
              <Settings2 className="h-4 w-4 text-primary" /> Modèle IA
            </h2>
            <div className="flex items-center gap-1">
              <button onClick={loadModels} disabled={loadingModels} className={iconBtn} title="Actualiser la liste" aria-label="Actualiser la liste">
                <RefreshCw className={`h-4 w-4 ${loadingModels ? 'animate-spin' : ''}`} />
              </button>
              <button onClick={() => setShowSettings(false)} className={iconBtn} aria-label="Fermer"><X className="h-4 w-4" /></button>
            </div>
          </div>

          <select value={model} onChange={e => chooseModel(e.target.value)} aria-label="Modèle IA"
            className={field}>
            <option value="">Automatique (essaie les meilleurs, puis les gratuits)</option>
            {models?.filter(m => !m.free).length ? (
              <optgroup label="Payants — meilleure lecture">
                {models.filter(m => !m.free).map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </optgroup>
            ) : null}
            {models?.filter(m => m.free).length ? (
              <optgroup label="Gratuits">
                {models.filter(m => m.free).map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </optgroup>
            ) : null}
          </select>

          <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            {loadingModels && <p className="flex items-center gap-1"><Loader className="h-3 w-3 animate-spin" /> Chargement des modèles disponibles…</p>}
            {modelsError && <p className="text-red-700 dark:text-red-300">{modelsError}</p>}
            {models && !loadingModels && (
              <p>{models.length} modèle(s) capables de lire des images sur votre compte OpenRouter.</p>
            )}
            {model
              ? <p>Modèle imposé : <code className="font-mono">{model}</code>. En cas d'échec, les autres sont essayés en secours.</p>
              : <p>Les modèles payants nécessitent du crédit OpenRouter ; sans crédit, les gratuits prennent le relais automatiquement.</p>}
          </div>
        </section>
      )}

      <div className="mb-4 flex gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm text-muted-foreground">
        <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span>Relevés bancaires, factures, listes de prix, inventaires — le convertisseur lit
        n'importe quel document contenant un tableau et le restitue en Excel.</span>
      </div>

      {/* upload + convert */}
      <section className={`${panel} mb-4 p-4 sm:p-5`}>
        <input ref={fileRef} type="file" accept=".pdf,image/*" className="hidden"
          onChange={e => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
        {!file ? (
          <button onClick={() => fileRef.current?.click()}
            className="w-full rounded-xl border-2 border-dashed border-border p-10 text-center transition-colors hover:border-primary/50 hover:bg-primary/[0.03]">
            <span className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10"><Upload className="h-6 w-6 text-primary" /></span>
            <div className="text-sm font-semibold text-foreground">Choisir un PDF ou une image</div>
            <div className="mt-1 text-xs text-muted-foreground">Relevés scannés ou numériques · multi-pages · max 25 Mo</div>
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10"><FileText className="h-5 w-5 text-primary" /></span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">{file.name}</div>
              <div className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} Mo</div>
            </div>
            {!busy && phase !== 'done' && (
              <>
                <button onClick={reset} className={iconBtn} title="Retirer" aria-label="Retirer"><X className="h-4 w-4" /></button>
                <button onClick={convert} className={btnPrimary}>
                  <Sparkles className="h-4 w-4" /> Convertir
                </button>
              </>
            )}
            {phase === 'done' && (
              <button onClick={reset} className={btnSecondary}>
                <ChevronLeft className="h-4 w-4" /> Autre fichier
              </button>
            )}
          </div>
        )}

        {phase === 'rendering' && (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader className="h-4 w-4 animate-spin" />
            Préparation des pages… {renderProgress.total > 1 ? `${renderProgress.done}/${renderProgress.total}` : ''}
          </div>
        )}

        {/* per-page extraction status */}
        {pages.length > 0 && phase !== 'rendering' && (
          <div className="mt-4 space-y-1.5 border-t border-border pt-3">
            {pages.map((p, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="w-16 shrink-0 text-muted-foreground">Page {i + 1}</span>
                {p.status === 'pending' && <span className="text-muted-foreground">en attente…</span>}
                {p.status === 'running' && <span className="flex items-center gap-1 text-primary"><Loader className="h-3.5 w-3.5 animate-spin" /> analyse IA…</span>}
                {p.status === 'ok' && <StatusPill tone="success" icon={<Check className="h-3 w-3" />}>extraite</StatusPill>}
                {p.status === 'error' && (
                  <span className="flex min-w-0 items-start gap-1 text-red-700 dark:text-red-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {/* full text, wrapped — the reason is the whole point */}
                    <span className="break-words">{p.error}</span>
                  </span>
                )}
              </div>
            ))}
            {phase === 'done' && failedCount > 0 && (
              <button onClick={retryFailed} className={`${btnSecondary} mt-2`}>
                <RefreshCw className="h-4 w-4" /> Réessayer les {failedCount} page(s) en échec
              </button>
            )}
            {phase === 'done' && failedCount === pages.length && (
              <div className="mt-2 space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                <p className="font-medium">Toutes les pages ont échoué.</p>
                <button onClick={runHealthCheck} disabled={checking}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-amber-500/40 bg-card px-3 text-xs font-medium disabled:opacity-60">
                  {checking ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Stethoscope className="h-3.5 w-3.5" />}
                  Diagnostiquer
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {health && (
        <section className={`${panel} mb-4 p-4`}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-semibold text-foreground">
              <Stethoscope className="h-4 w-4 text-primary" /> Diagnostic
            </h2>
            <button onClick={() => setHealth(null)} className={iconBtn} aria-label="Fermer le diagnostic"><X className="h-4 w-4" /></button>
          </div>
          <ul className="space-y-1.5 text-sm">
            {health.map(h => (
              <li key={h.fn} className="flex items-start gap-2">
                {h.state === 'ok'
                  ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />}
                <span className="min-w-0">
                  <code className="font-mono text-xs text-foreground">{h.fn}</code>
                  <span className={`ml-1.5 ${h.state === 'ok' ? 'text-muted-foreground' : 'text-red-700 dark:text-red-300'}`}>{h.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          {health.some(h => h.state !== 'ok') && (
            <div className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Déployer sans installer d'outil :</p>
              <p>1. Tableau de bord Supabase → <b>Edge Functions</b> → <b>Deploy a new function</b></p>
              <p>2. Nommer la fonction exactement comme ci-dessus</p>
              <p>3. Coller le contenu de <code className="font-mono">supabase/functions/&lt;nom&gt;/index.ts</code> puis déployer</p>
              <p className="pt-1">Ou en ligne de commande :
                <code className="font-mono"> npx supabase functions deploy &lt;nom&gt;</code></p>
            </div>
          )}
        </section>
      )}

      {/* preview + export */}
      {phase === 'done' && merged && (
        <section className={`${panel} overflow-hidden`}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3">
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-foreground">Aperçu</h2>
              <p className="text-xs text-muted-foreground">vérifiez les montants avant d'utiliser le fichier — l'OCR peut se tromper</p>
            </div>
            <button onClick={exportExcel} className={`${btnPrimary} w-full sm:w-auto`}>
              <Download className="h-4 w-4" /> Télécharger Excel
            </button>
          </div>
          <div className="max-h-[480px] overflow-auto">
            <TablePreview t={merged} />
          </div>
        </section>
      )}
    </div>
  );
}

/* ── preview ─────────────────────────────────────────────────────────────── */
function TablePreview({ t }: { t: TableResult }) {
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-secondary">
        <tr className="border-b border-border">
          {t.columns.map((c, i) => <th key={i} className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{c}</th>)}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {t.rows.map((r, i) => (
          <tr key={i} className="hover:bg-secondary/40">
            {r.map((v, j) => <td key={j} className="px-3 py-1.5 text-foreground">{String(v ?? '')}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
