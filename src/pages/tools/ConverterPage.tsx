import React, { useMemo, useRef, useState } from 'react';
import {
  FileSpreadsheet, Loader, Upload, X, Check, AlertTriangle, RefreshCw,
  Download, FileText, Sparkles, ChevronLeft,
} from 'lucide-react';
import {
  CONVERSIONS, fileToPageImages, extractPage,
  mergeBank, mergeTables, mergeInvoices,
  exportBankExcel, exportTableExcel, exportInvoiceExcel,
  type ConversionKind, type TableResult, type InvoiceResult,
} from '../../utils/converter';
import type { ParsedStatement } from '../../utils/supabaseBank';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

type PageState = { status: 'pending' | 'running' | 'ok' | 'error'; error?: string; result?: any };
type Phase = 'pick' | 'rendering' | 'extracting' | 'done';

export default function ConverterPage() {
  const { isAdmin, isSuperAdmin } = useAuth();
  const { showToast } = useToast();

  const [kind, setKind] = useState<ConversionKind>('bank');
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>('pick');
  const [renderProgress, setRenderProgress] = useState({ done: 0, total: 0 });
  const [images, setImages] = useState<string[]>([]);
  const [pages, setPages] = useState<PageState[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const def = CONVERSIONS.find(c => c.kind === kind)!;
  const okPages = pages.filter(p => p.status === 'ok');
  const failedCount = pages.filter(p => p.status === 'error').length;

  const merged = useMemo(() => {
    if (!okPages.length) return null;
    const results = okPages.map(p => p.result);
    if (kind === 'bank') return mergeBank(results as ParsedStatement[]);
    if (kind === 'invoice') return mergeInvoices(results as InvoiceResult[]);
    return mergeTables(results as TableResult[]);
  }, [okPages, kind]); // eslint-disable-line react-hooks/exhaustive-deps

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
        const result = await extractPage(kind, imgs[i]);
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
    try {
      setPhase('rendering');
      const imgs = await fileToPageImages(file, (done, total) => setRenderProgress({ done, total }));
      setImages(imgs);
      const states: PageState[] = imgs.map(() => ({ status: 'pending' }));
      setPages(states);
      await extractAll(imgs, states);
    } catch (e: any) {
      showToast({ type: 'error', message: e?.message || 'Échec de la lecture du fichier' });
      setPhase('pick');
    }
  };

  const retryFailed = () => extractAll(images, pages);

  const exportExcel = async () => {
    if (!merged || !file) return;
    const base = file.name.replace(/\.[^.]+$/, '');
    try {
      if (kind === 'bank') await exportBankExcel(merged as ParsedStatement, `${base}.xlsx`);
      else if (kind === 'invoice') await exportInvoiceExcel(merged as InvoiceResult, `${base}.xlsx`);
      else await exportTableExcel(merged as TableResult, `${base}.xlsx`);
      showToast({ type: 'success', message: 'Fichier Excel téléchargé' });
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec de l\'export' }); }
  };

  if (!isAdmin && !isSuperAdmin) return <div className="text-center py-12 text-muted-foreground">Accès réservé aux administrateurs.</div>;

  const busy = phase === 'rendering' || phase === 'extracting';

  return (
    <div className="max-w-5xl mx-auto py-6 px-3">
      <div className="flex items-center gap-2 mb-4">
        <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10"><FileSpreadsheet className="h-5 w-5 text-primary" /></div>
        <div>
          <h1 className="text-lg font-bold text-foreground leading-tight">Convertisseur de documents</h1>
          <p className="text-xs text-muted-foreground">PDF ou scan → Excel, lecture par IA (même clé que l'assistant)</p>
        </div>
      </div>

      {/* type picker */}
      <div className="grid sm:grid-cols-3 gap-2 mb-4">
        {CONVERSIONS.map(c => (
          <button key={c.kind} onClick={() => { if (!busy) { setKind(c.kind); setPages([]); setImages([]); setPhase('pick'); } }}
            className={`text-left rounded-lg border p-3 transition-colors ${kind === c.kind ? 'border-primary bg-primary/5' : 'border-border/60 bg-card hover:border-primary/40'}`}>
            <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              {kind === c.kind && <Check className="h-3.5 w-3.5 text-primary" />}{c.label}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">{c.description}</p>
          </button>
        ))}
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
              <div className="text-[11px] text-amber-600 dark:text-amber-400 space-y-0.5">
                <p className="font-medium">Toutes les pages ont échoué — causes les plus fréquentes :</p>
                <p>• La fonction <code className="font-mono">{def.fn}</code> n'est pas déployée :
                  <code className="font-mono"> npx supabase functions deploy {def.fn}</code></p>
                <p>• Le secret <code className="font-mono">OPENROUTER_API_KEY</code> n'est pas configuré côté Supabase</p>
                <p>• Les modèles IA gratuits sont momentanément saturés — réessayez dans quelques minutes</p>
              </div>
            )}
          </div>
        )}
      </div>

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
            {kind === 'bank' && <BankPreview s={merged as ParsedStatement} />}
            {kind === 'table' && <TablePreview t={merged as TableResult} />}
            {kind === 'invoice' && <InvoicePreview inv={merged as InvoiceResult} />}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── previews ─────────────────────────────────────────────────────────────── */
const num = (v: number | null | undefined) =>
  v == null ? '' : v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function BankPreview({ s }: { s: ParsedStatement }) {
  return (
    <div>
      <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border/40 flex gap-4 flex-wrap">
        {s.bank_name && <span className="font-medium text-foreground">{s.bank_name}</span>}
        {s.rib && <span>RIB {s.rib}</span>}
        {(s.period_start || s.period_end) && <span>{s.period_start || '?'} → {s.period_end || '?'}</span>}
        {s.opening_balance != null && <span>Initial : <b>{num(s.opening_balance)}</b></span>}
        {s.closing_balance != null && <span>Final : <b>{num(s.closing_balance)}</b></span>}
      </div>
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-secondary/80">
          <tr className="text-muted-foreground">
            <th className="text-left font-medium px-3 py-1.5 w-24">Date</th>
            <th className="text-left font-medium px-3 py-1.5">Libellé</th>
            <th className="text-left font-medium px-3 py-1.5 w-24">Réf.</th>
            <th className="text-right font-medium px-3 py-1.5 w-24">Débit</th>
            <th className="text-right font-medium px-3 py-1.5 w-24">Crédit</th>
            <th className="text-right font-medium px-3 py-1.5 w-24">Solde</th>
          </tr>
        </thead>
        <tbody>
          {s.lines.map((l, i) => (
            <tr key={i} className="border-b border-border/30">
              <td className="px-3 py-1">{l.date}</td>
              <td className="px-3 py-1">{l.label}</td>
              <td className="px-3 py-1 text-muted-foreground">{l.reference || ''}</td>
              <td className="px-3 py-1 text-right text-red-600 dark:text-red-400">{l.debit ? num(l.debit) : ''}</td>
              <td className="px-3 py-1 text-right text-emerald-700 dark:text-emerald-400">{l.credit ? num(l.credit) : ''}</td>
              <td className="px-3 py-1 text-right">{num(l.balance)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold bg-secondary/40">
            <td className="px-3 py-1.5" colSpan={3}>{s.lines.length} opérations</td>
            <td className="px-3 py-1.5 text-right">{num(s.lines.reduce((t, l) => t + (l.debit || 0), 0))}</td>
            <td className="px-3 py-1.5 text-right">{num(s.lines.reduce((t, l) => t + (l.credit || 0), 0))}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

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

function InvoicePreview({ inv }: { inv: InvoiceResult }) {
  return (
    <div>
      <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border/40 flex gap-4 flex-wrap">
        {inv.supplier && <span className="font-medium text-foreground">{inv.supplier}</span>}
        {inv.invoice_number && <span>N° {inv.invoice_number}</span>}
        {inv.invoice_date && <span>{inv.invoice_date}</span>}
        {inv.total_ht != null && <span>HT : <b>{num(inv.total_ht)}</b></span>}
        {inv.total_tva != null && <span>TVA : <b>{num(inv.total_tva)}</b></span>}
        {inv.total_ttc != null && <span>TTC : <b>{num(inv.total_ttc)}</b></span>}
      </div>
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-secondary/80">
          <tr className="text-muted-foreground">
            <th className="text-left font-medium px-3 py-1.5">Description</th>
            <th className="text-right font-medium px-3 py-1.5 w-20">Qté</th>
            <th className="text-right font-medium px-3 py-1.5 w-28">PU</th>
            <th className="text-right font-medium px-3 py-1.5 w-28">Total</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l, i) => (
            <tr key={i} className="border-b border-border/30">
              <td className="px-3 py-1">{l.description}</td>
              <td className="px-3 py-1 text-right">{l.quantity ?? ''}</td>
              <td className="px-3 py-1 text-right">{num(l.unit_price)}</td>
              <td className="px-3 py-1 text-right">{num(l.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
