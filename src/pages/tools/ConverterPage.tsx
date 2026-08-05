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

  if (!isAdmin && !isSuperAdmin) return <div className="text-center py-12 text-muted-foreground">Accès réservé aux administrateurs.</div>;

  const busy = phase === 'rendering' || phase === 'extracting';

  return (
    <div className="max-w-5xl mx-auto py-6 px-3">
      <div className="flex items-center gap-2 mb-4">
        <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10"><FileSpreadsheet className="h-5 w-5 text-primary" /></div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-foreground leading-tight">Convertisseur de documents</h1>
          <p className="text-xs text-muted-foreground">PDF ou scan → Excel, lecture par IA (même clé que l'assistant)</p>
        </div>
        <button onClick={openSettings}
          className={`shrink-0 flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs ${showSettings ? 'bg-primary/10 border-primary/40' : 'bg-secondary border-border'}`}
          title="Choisir le modèle IA">
          <Settings2 className="h-3.5 w-3.5" /> Modèle
        </button>
        <button onClick={runHealthCheck} disabled={checking}
          className="shrink-0 flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-secondary border border-border text-xs disabled:opacity-60"
          title="Vérifier que les fonctions IA sont déployées">
          {checking ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Stethoscope className="h-3.5 w-3.5" />}
          Diagnostic
        </button>
      </div>

      {showSettings && (
        <div className="mb-4 bg-card border border-border/60 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <Settings2 className="h-4 w-4 text-primary" /> Modèle IA
            </h2>
            <div className="flex items-center gap-1">
              <button onClick={loadModels} disabled={loadingModels} className="p-1 rounded hover:bg-secondary disabled:opacity-50" title="Actualiser la liste">
                <RefreshCw className={`h-3.5 w-3.5 ${loadingModels ? 'animate-spin' : ''}`} />
              </button>
              <button onClick={() => setShowSettings(false)} className="p-1 rounded hover:bg-secondary"><X className="h-3.5 w-3.5" /></button>
            </div>
          </div>

          <select value={model} onChange={e => chooseModel(e.target.value)}
            className="w-full px-2 py-2 text-sm rounded-lg bg-secondary border border-border">
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

          <div className="mt-1.5 text-[11px] text-muted-foreground space-y-0.5">
            {loadingModels && <p className="flex items-center gap-1"><Loader className="h-3 w-3 animate-spin" /> Chargement des modèles disponibles…</p>}
            {modelsError && <p className="text-red-600 dark:text-red-400">{modelsError}</p>}
            {models && !loadingModels && (
              <p>{models.length} modèle(s) capables de lire des images sur votre compte OpenRouter.</p>
            )}
            {model
              ? <p>Modèle imposé : <code className="font-mono">{model}</code>. En cas d'échec, les autres sont essayés en secours.</p>
              : <p>Les modèles payants nécessitent du crédit OpenRouter ; sans crédit, les gratuits prennent le relais automatiquement.</p>}
          </div>
        </div>
      )}

      <div className="mb-4 bg-primary/5 border border-primary/20 rounded-lg px-3 py-2 text-xs text-muted-foreground">
        Relevés bancaires, factures, listes de prix, inventaires — le convertisseur lit
        n'importe quel document contenant un tableau et le restitue en Excel.
      </div>

      {/* upload + convert */}
      <div className="bg-card border border-border/60 rounded-lg p-4 mb-4">
        <input ref={fileRef} type="file" accept=".pdf,image/*" className="hidden"
          onChange={e => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
        {!file ? (
          <button onClick={() => fileRef.current?.click()}
            className="w-full border-2 border-dashed border-border rounded-lg p-10 text-center hover:border-primary/50 transition-colors">
            <Upload className="h-6 w-6 mx-auto text-primary mb-2" />
            <div className="text-sm font-medium text-foreground">Choisir un PDF ou une image</div>
            <div className="text-xs text-muted-foreground mt-1">Relevés scannés ou numériques · multi-pages · max 25 Mo</div>
          </button>
        ) : (
          <div className="flex items-center gap-3 flex-wrap">
            <FileText className="h-5 w-5 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-foreground truncate">{file.name}</div>
              <div className="text-[11px] text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} Mo</div>
            </div>
            {!busy && phase !== 'done' && (
              <>
                <button onClick={reset} className="p-1.5 rounded-lg hover:bg-secondary" title="Retirer"><X className="h-4 w-4" /></button>
                <button onClick={convert}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
                  <Sparkles className="h-4 w-4" /> Convertir
                </button>
              </>
            )}
            {phase === 'done' && (
              <button onClick={reset} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-secondary border border-border text-sm">
                <ChevronLeft className="h-4 w-4" /> Autre fichier
              </button>
            )}
          </div>
        )}

        {phase === 'rendering' && (
          <div className="mt-3 text-sm text-muted-foreground flex items-center gap-2">
            <Loader className="h-4 w-4 animate-spin" />
            Préparation des pages… {renderProgress.total > 1 ? `${renderProgress.done}/${renderProgress.total}` : ''}
          </div>
        )}

        {/* per-page extraction status */}
        {pages.length > 0 && phase !== 'rendering' && (
          <div className="mt-3 space-y-1">
            {pages.map((p, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="w-14 text-muted-foreground">Page {i + 1}</span>
                {p.status === 'pending' && <span className="text-muted-foreground">en attente…</span>}
                {p.status === 'running' && <span className="flex items-center gap-1 text-primary"><Loader className="h-3 w-3 animate-spin" /> analyse IA…</span>}
                {p.status === 'ok' && <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><Check className="h-3 w-3" /> extraite</span>}
                {p.status === 'error' && (
                  <span className="flex items-start gap-1 text-red-600 dark:text-red-400 min-w-0">
                    <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                    {/* full text, wrapped — the reason is the whole point */}
                    <span className="break-words">{p.error}</span>
                  </span>
                )}
              </div>
            ))}
            {phase === 'done' && failedCount > 0 && (
              <button onClick={retryFailed} className="mt-1 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-secondary border border-border text-xs">
                <RefreshCw className="h-3.5 w-3.5" /> Réessayer les {failedCount} page(s) en échec
              </button>
            )}
            {phase === 'done' && failedCount === pages.length && (
              <div className="text-[11px] text-amber-600 dark:text-amber-400 space-y-1">
                <p className="font-medium">Toutes les pages ont échoué.</p>
                <button onClick={runHealthCheck} disabled={checking}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/40 text-xs font-medium disabled:opacity-60">
                  {checking ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Stethoscope className="h-3.5 w-3.5" />}
                  Diagnostiquer
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {health && (
        <div className="mb-4 bg-card border border-border/60 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <Stethoscope className="h-4 w-4 text-primary" /> Diagnostic
            </h2>
            <button onClick={() => setHealth(null)} className="p-1 rounded hover:bg-secondary"><X className="h-3.5 w-3.5" /></button>
          </div>
          <ul className="space-y-1 text-xs">
            {health.map(h => (
              <li key={h.fn} className="flex items-start gap-2">
                {h.state === 'ok'
                  ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  : <AlertTriangle className="h-3.5 w-3.5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />}
                <span className="min-w-0">
                  <code className="font-mono text-[11px]">{h.fn}</code>
                  <span className={`ml-1.5 ${h.state === 'ok' ? 'text-muted-foreground' : 'text-red-600 dark:text-red-400'}`}>{h.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          {health.some(h => h.state !== 'ok') && (
            <div className="mt-2 pt-2 border-t border-border/60 text-[11px] text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Déployer sans installer d'outil :</p>
              <p>1. Tableau de bord Supabase → <b>Edge Functions</b> → <b>Deploy a new function</b></p>
              <p>2. Nommer la fonction exactement comme ci-dessus</p>
              <p>3. Coller le contenu de <code className="font-mono">supabase/functions/&lt;nom&gt;/index.ts</code> puis déployer</p>
              <p className="pt-1">Ou en ligne de commande :
                <code className="font-mono"> npx supabase functions deploy &lt;nom&gt;</code></p>
            </div>
          )}
        </div>
      )}

      {/* preview + export */}
      {phase === 'done' && merged && (
        <div className="bg-card border border-border/60 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-secondary/50 border-b border-border/60 flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">Aperçu</span>
            <span className="text-[11px] text-muted-foreground">vérifiez les montants avant d'utiliser le fichier — l'OCR peut se tromper</span>
            <button onClick={exportExcel}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
              <Download className="h-4 w-4" /> Télécharger Excel
            </button>
          </div>
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <TablePreview t={merged} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ── preview ─────────────────────────────────────────────────────────────── */
function TablePreview({ t }: { t: TableResult }) {
  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-secondary/80">
        <tr className="text-muted-foreground">
          {t.columns.map((c, i) => <th key={i} className="text-left font-medium px-3 py-1.5">{c}</th>)}
        </tr>
      </thead>
      <tbody>
        {t.rows.map((r, i) => (
          <tr key={i} className="border-b border-border/30">
            {r.map((v, j) => <td key={j} className="px-3 py-1">{String(v ?? '')}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
