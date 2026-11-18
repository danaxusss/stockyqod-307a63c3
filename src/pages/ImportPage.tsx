import React, { useState, useRef } from 'react';
import { Upload, Download, FileText, Users, Truck, Receipt, ArrowLeft, ArrowRight, CheckCircle, AlertCircle, Loader, X, RotateCcw, FileX } from 'lucide-react';
import {
  ImportDocType, TEMPLATES, downloadTemplate, parseCSVFile,
  importClients, importDocuments, importReturns,
  ParsedClient, ParsedDocument, ParsedReturn,
} from '../utils/csvImport';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/lists/StatusPill';
import { btnPrimary, btnSecondary } from '../components/backoffice/BackOfficeUi';

const TYPE_CONFIG: { type: ImportDocType; label: string; icon: React.ElementType; color: string }[] = [
  { type: 'clients',  label: 'Clients',   icon: Users,     color: 'text-primary bg-primary/10 border-primary/30' },
  { type: 'quote',    label: 'Devis',     icon: FileText,  color: 'text-blue-600 bg-blue-500/10 border-blue-500/40 dark:text-blue-300' },
  { type: 'bl',       label: 'BL',        icon: Truck,     color: 'text-sky-600 bg-sky-500/10 border-sky-500/40 dark:text-sky-300' },
  { type: 'proforma', label: 'Proforma',  icon: FileText,  color: 'text-amber-600 bg-amber-500/10 border-amber-500/40 dark:text-amber-300' },
  { type: 'invoice',  label: 'Facture',   icon: Receipt,   color: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/40 dark:text-emerald-300' },
  { type: 'avoir',    label: 'Avoir',     icon: FileX,     color: 'text-rose-600 bg-rose-500/10 border-rose-500/40 dark:text-rose-300' },
  { type: 'retour',   label: 'Retour',    icon: RotateCcw, color: 'text-orange-600 bg-orange-500/10 border-orange-500/40 dark:text-orange-300' },
];

export default function ImportPage() {
  const navigate = useNavigate();
  const { isSuperAdmin, isAdmin } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [docType, setDocType] = useState<ImportDocType | null>(null);
  const [fileName, setFileName] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [parsedClients, setParsedClients] = useState<ParsedClient[]>([]);
  const [parsedDocs, setParsedDocs] = useState<ParsedDocument[]>([]);
  const [parsedReturns, setParsedReturns] = useState<ParsedReturn[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; errors: string[] } | null>(null);

  if (!isAdmin && !isSuperAdmin) return null;

  const isClients = docType === 'clients';
  const isReturns = docType === 'retour';
  const previewCount = isClients ? parsedClients.length : isReturns ? parsedReturns.length : parsedDocs.length;

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !docType) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const result = parseCSVFile(text, docType);
      setWarnings(result.warnings);
      if (docType === 'clients') {
        setParsedClients(result.rows as ParsedClient[]);
        setParsedDocs([]);
        setParsedReturns([]);
      } else if (docType === 'retour') {
        setParsedReturns(result.rows as ParsedReturn[]);
        setParsedClients([]);
        setParsedDocs([]);
      } else {
        setParsedDocs(result.rows as ParsedDocument[]);
        setParsedClients([]);
        setParsedReturns([]);
      }
      if ((result.rows as any[]).length > 0) setStep(2);
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  const handleImport = async () => {
    if (!docType) return;
    setIsImporting(true);
    try {
      let result;
      if (isClients) result = await importClients(parsedClients);
      else if (isReturns) result = await importReturns(parsedReturns);
      else result = await importDocuments(parsedDocs, docType);
      setImportResult(result);
      setStep(3);
    } catch (e: any) {
      setImportResult({ created: 0, errors: [e?.message || 'Erreur inconnue'] });
      setStep(3);
    } finally {
      setIsImporting(false);
    }
  };

  const reset = () => {
    setStep(1);
    setDocType(null);
    setFileName('');
    setWarnings([]);
    setParsedClients([]);
    setParsedDocs([]);
    setParsedReturns([]);
    setImportResult(null);
  };

  const STEP_LABELS = ['Fichier', 'Aperçu', 'Résultat'];

  return (
    <div className="mx-auto max-w-[110rem] space-y-4">
      <button onClick={() => navigate(-1)} aria-label="Page précédente" title="Page précédente"
        className="-mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
      </button>
      <PageHeader
        title="Import CSV"
        subtitle="Importer des données depuis un fichier CSV"
        actions={
          /* Stepper */
          <ol className="flex items-center gap-2 text-xs" aria-label="Étapes">
            {[1, 2, 3].map(s => (
              <React.Fragment key={s}>
                <li className="flex items-center gap-1.5" aria-current={step === s ? 'step' : undefined}>
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full font-semibold ${step >= s ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground ring-1 ring-inset ring-border'}`}>{s}</span>
                  <span className={`hidden font-medium sm:inline ${step >= s ? 'text-foreground' : 'text-muted-foreground'}`}>{STEP_LABELS[s - 1]}</span>
                </li>
                {s < 3 && <li aria-hidden="true" className={`h-px w-6 sm:w-8 ${step > s ? 'bg-primary' : 'bg-border'}`} />}
              </React.Fragment>
            ))}
          </ol>
        }
      />

      {/* ── Step 1: Choose type + upload ── */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
            <h2 className="mb-3 font-semibold text-foreground">1. Choisir le type de données</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
              {TYPE_CONFIG.map(({ type, label, icon: Icon, color }) => (
                <button
                  key={type}
                  onClick={() => { setDocType(type); setFileName(''); setParsedClients([]); setParsedDocs([]); setWarnings([]); }}
                  aria-pressed={docType === type}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 transition-all ${docType === type ? color + ' ring-1 ring-current' : 'border-border bg-card hover:bg-secondary'}`}
                >
                  <Icon className={`h-5 w-5 ${docType === type ? color.split(' ')[0] : 'text-muted-foreground'}`} />
                  <span className="text-xs font-medium text-foreground">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {docType && (
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5 space-y-5">
              {/* Template download */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-foreground">2. Télécharger le modèle</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Remplissez ce modèle CSV puis importez-le</p>
                </div>
                <button
                  onClick={() => downloadTemplate(docType)}
                  className={btnSecondary}
                >
                  <Download className="h-4 w-4" /><span className="font-mono text-xs">template_{docType}.csv</span>
                </button>
              </div>

              {/* Template column reference */}
              <div className="rounded-lg border border-border overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-secondary/40">
                      {TEMPLATES[docType].headers.map(h => (
                        <th key={h} className="whitespace-nowrap border-r border-border px-2.5 py-2 text-left font-mono font-semibold text-foreground last:border-r-0">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {TEMPLATES[docType].rows.map((row, i) => (
                      <tr key={i} className="border-t border-border">
                        {row.map((cell, j) => (
                          <td key={j} className="whitespace-nowrap border-r border-border px-2.5 py-1.5 text-muted-foreground last:border-r-0">{cell || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* File upload */}
              <div>
                <h2 className="mb-2 font-semibold text-foreground">3. Importer votre fichier</h2>
                <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFile} className="hidden" />
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border px-4 py-10 transition-colors hover:border-primary/50 hover:bg-primary/[0.03]"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10"><Upload className="h-6 w-6 text-primary" /></span>
                  <span className="text-sm font-medium text-foreground">Cliquer pour sélectionner un fichier CSV</span>
                  <span className="text-xs text-muted-foreground">Format UTF-8, séparateur virgule</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Step 2: Preview ── */}
      {step === 2 && docType && (
        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate font-semibold text-foreground">Aperçu — {fileName}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {previewCount} {isClients ? 'client(s)' : isReturns ? 'retour(s)' : 'document(s)'} détecté(s)
                  {' '}· <button onClick={() => setStep(1)} className="text-primary hover:underline">Changer de fichier</button>
                </p>
              </div>
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <button onClick={() => setStep(1)} className={`${btnSecondary} flex-1 sm:flex-none`}>
                  <ArrowLeft className="h-4 w-4" />Retour
                </button>
                <button
                  onClick={handleImport}
                  disabled={isImporting || previewCount === 0}
                  className={`${btnPrimary} flex-1 sm:flex-none`}
                >
                  {isImporting ? <Loader className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  {isImporting ? 'Import en cours...' : `Importer ${previewCount} enregistrement(s)`}
                </button>
              </div>
            </div>

            {/* Warnings */}
            {warnings.length > 0 && (
              <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-800 dark:text-amber-200">
                <div className="mb-1.5 flex items-center gap-1.5">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <span className="text-sm font-medium">{warnings.length} avertissement(s)</span>
                </div>
                <ul className="max-h-28 list-disc space-y-0.5 overflow-y-auto pl-6 text-xs">
                  {warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}

            {/* Preview table */}
            <div className="overflow-x-auto rounded-lg border border-border">
              {isClients ? (
                <table className="text-xs w-full">
                  <thead><tr className="border-b border-border bg-secondary/40">
                    {['Code', 'Nom', 'Téléphone', 'Adresse', 'Ville', 'ICE', 'Email'].map(h => (
                      <th key={h} className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {parsedClients.slice(0, 50).map((c, i) => (
                      <tr key={i} className="border-t border-border hover:bg-secondary/40">
                        <td className="px-3 py-1.5">
                          {c.client_code
                            ? <span className="font-mono rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">{c.client_code}</span>
                            : <span className="text-muted-foreground/50">auto</span>}
                        </td>
                        <td className="px-3 py-1.5 text-foreground font-medium">{c.full_name}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{c.phone_number || '—'}</td>
                        <td className="px-3 py-1.5 text-muted-foreground max-w-[120px] truncate">{c.address || '—'}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{c.city || '—'}</td>
                        <td className="px-3 py-1.5 text-muted-foreground font-mono">{c.ice || '—'}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{c.email || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : isReturns ? (
                <table className="text-xs w-full">
                  <thead><tr className="border-b border-border bg-secondary/40">
                    {['Réf.', 'Client', 'Raison', 'Lignes', 'Statut'].map(h => (
                      <th key={h} className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {parsedReturns.slice(0, 50).map((r, i) => (
                      <tr key={i} className="border-t border-border hover:bg-secondary/40">
                        <td className="px-3 py-1.5 text-primary font-medium font-mono">{r.referenceNumber}</td>
                        <td className="px-3 py-1.5 text-foreground">{r.clientName || '—'}</td>
                        <td className="px-3 py-1.5 text-muted-foreground max-w-[160px] truncate">{r.reason || '—'}</td>
                        <td className="px-3 py-1.5 text-center">
                          <span className="inline-flex items-center justify-center h-6 min-w-6 rounded-full bg-primary/10 px-1 text-xs font-bold text-primary">{r.items.length}</span>
                        </td>
                        <td className="px-3 py-1.5">
                          <StatusPill tone={r.status === 'closed' ? 'success' : 'warning'}>{r.status}</StatusPill>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="text-xs w-full">
                  <thead><tr className="border-b border-border bg-secondary/40">
                    {['N°', 'Code Client', 'Client', 'Téléphone', 'Lignes', 'Total HT estimé', 'Statut'].map(h => (
                      <th key={h} className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {parsedDocs.slice(0, 50).map((d, i) => {
                      const totalHT = d.items.reduce((s, it) => s + it.unitPrice * it.quantity * (1 - (it.discount ?? 0) / 100), 0);
                      return (
                        <tr key={i} className="border-t border-border hover:bg-secondary/40">
                          <td className="px-3 py-1.5 text-primary font-medium font-mono">{d.numero}</td>
                          <td className="px-3 py-1.5">
                            {d.clientCode
                              ? <span className="font-mono rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">{d.clientCode}</span>
                              : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="px-3 py-1.5 text-foreground">{d.clientName || '—'}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{d.clientPhone || '—'}</td>
                          <td className="px-3 py-1.5 text-center">
                            <span className="inline-flex items-center justify-center h-6 min-w-6 rounded-full bg-primary/10 px-1 text-xs font-bold text-primary">{d.items.length}</span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-right font-medium tabular-nums text-foreground">
                            {new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(totalHT)} Dh
                          </td>
                          <td className="px-3 py-1.5">
                            <StatusPill tone={d.status === 'final' || d.status === 'solde' ? 'success' : 'warning'}>{d.status}</StatusPill>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {previewCount > 50 && (
                <div className="px-3 py-2 border-t border-border text-xs text-muted-foreground text-center">
                  Aperçu limité à 50 lignes — {previewCount - 50} ligne(s) supplémentaire(s) seront importées
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Step 3: Results ── */}
      {step === 3 && importResult && (
        <div className="mx-auto max-w-2xl space-y-4 rounded-xl border border-border bg-card p-6 text-center shadow-sm">
          <div className={`inline-flex items-center justify-center w-14 h-14 rounded-full ${importResult.errors.length === 0 ? 'bg-emerald-500/10' : 'bg-amber-500/10'}`}>
            {importResult.errors.length === 0
              ? <CheckCircle className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
              : <AlertCircle className="h-8 w-8 text-amber-600 dark:text-amber-400" />}
          </div>

          <div>
            <h2 className="text-lg font-bold text-foreground">Import terminé</h2>
            <p className="text-sm text-muted-foreground mt-1">
              <span className="font-semibold text-emerald-700 dark:text-emerald-300">{importResult.created}</span> enregistrement(s) créé(s)
              {importResult.errors.length > 0 && (
                <> · <span className="text-destructive font-semibold">{importResult.errors.length}</span> erreur(s)</>
              )}
            </p>
          </div>

          {importResult.errors.length > 0 && (
            <div className="text-left p-3 bg-destructive/10 border border-destructive/30 rounded-lg max-h-48 overflow-y-auto">
              <p className="text-xs font-medium text-destructive mb-1.5">Détail des erreurs :</p>
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-destructive">
                {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-center gap-2 pt-2">
            <button onClick={reset} className={btnSecondary}>
              <Upload className="h-4 w-4" />Nouvel import
            </button>
            <button onClick={() => navigate(-1)} className={btnPrimary}>
              <X className="h-4 w-4" />Fermer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
