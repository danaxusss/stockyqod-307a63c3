import React, { useState, useRef } from 'react';
import { Upload, Download, FileText, Users, Truck, Receipt, ArrowLeft, ArrowRight, CheckCircle, AlertCircle, Loader, X, RotateCcw, FileX } from 'lucide-react';
import {
  ImportDocType, TEMPLATES, downloadTemplate, parseCSVFile,
  importClients, importDocuments, importReturns,
  ParsedClient, ParsedDocument, ParsedReturn,
} from '../utils/csvImport';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const TYPE_CONFIG: { type: ImportDocType; label: string; icon: React.ElementType; color: string }[] = [
  { type: 'clients',  label: 'Clients',   icon: Users,     color: 'text-violet-400 bg-violet-500/10 border-violet-500/30' },
  { type: 'quote',    label: 'Devis',     icon: FileText,  color: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
  { type: 'bl',       label: 'BL',        icon: Truck,     color: 'text-teal-400 bg-teal-500/10 border-teal-500/30' },
  { type: 'proforma', label: 'Proforma',  icon: FileText,  color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  { type: 'invoice',  label: 'Facture',   icon: Receipt,   color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
  { type: 'avoir',    label: 'Avoir',     icon: FileX,     color: 'text-rose-400 bg-rose-500/10 border-rose-500/30' },
  { type: 'retour',   label: 'Retour',    icon: RotateCcw, color: 'text-orange-400 bg-orange-500/10 border-orange-500/30' },
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

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-1.5 hover:bg-accent rounded-lg text-muted-foreground">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-base font-bold text-foreground">Import CSV</h1>
          <p className="text-xs text-muted-foreground">Importer des données depuis un fichier CSV</p>
        </div>
        {/* Stepper */}
        <div className="ml-auto flex items-center gap-1.5 text-xs">
          {[1, 2, 3].map(s => (
            <React.Fragment key={s}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center font-medium ${step >= s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{s}</div>
              {s < 3 && <div className={`w-8 h-px ${step > s ? 'bg-primary' : 'bg-border'}`} />}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* ── Step 1: Choose type + upload ── */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="glass rounded-xl p-4">
            <h2 className="text-sm font-semibold text-foreground mb-3">1. Choisir le type de données</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
              {TYPE_CONFIG.map(({ type, label, icon: Icon, color }) => (
                <button
                  key={type}
                  onClick={() => { setDocType(type); setFileName(''); setParsedClients([]); setParsedDocs([]); setWarnings([]); }}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all ${docType === type ? color + ' ring-1 ring-current' : 'border-border hover:bg-accent'}`}
                >
                  <Icon className={`h-5 w-5 ${docType === type ? color.split(' ')[0] : 'text-muted-foreground'}`} />
                  <span className="text-xs font-medium text-foreground">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {docType && (
            <div className="glass rounded-xl p-4 space-y-4">
              {/* Template download */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">2. Télécharger le modèle</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Remplissez ce modèle CSV puis importez-le</p>
                </div>
                <button
                  onClick={() => downloadTemplate(docType)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-secondary hover:bg-accent border border-border rounded-lg text-foreground"
                >
                  <Download className="h-3.5 w-3.5" />template_{docType}.csv
                </button>
              </div>

              {/* Template column reference */}
              <div className="rounded-lg border border-border overflow-x-auto">
                <table className="text-[11px] w-full">
                  <thead>
                    <tr className="bg-muted">
                      {TEMPLATES[docType].headers.map(h => (
                        <th key={h} className="px-2 py-1.5 text-left font-medium text-foreground border-r border-border last:border-r-0 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {TEMPLATES[docType].rows.map((row, i) => (
                      <tr key={i} className="border-t border-border">
                        {row.map((cell, j) => (
                          <td key={j} className="px-2 py-1 text-muted-foreground border-r border-border last:border-r-0 whitespace-nowrap">{cell || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* File upload */}
              <div>
                <h2 className="text-sm font-semibold text-foreground mb-2">3. Importer votre fichier</h2>
                <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFile} className="hidden" />
                <button
                  onClick={() => fileRef.current?.click()}
                  className="w-full flex flex-col items-center gap-2 px-4 py-8 border-2 border-dashed border-border rounded-xl hover:bg-accent transition-colors"
                >
                  <Upload className="h-8 w-8 text-muted-foreground" />
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
          <div className="glass rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Aperçu — {fileName}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {previewCount} {isClients ? 'client(s)' : isReturns ? 'retour(s)' : 'document(s)'} détecté(s)
                  {' '}· <button onClick={() => setStep(1)} className="text-primary hover:underline">Changer de fichier</button>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setStep(1)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-accent text-foreground">
                  <ArrowLeft className="h-3.5 w-3.5" />Retour
                </button>
                <button
                  onClick={handleImport}
                  disabled={isImporting || previewCount === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg disabled:opacity-50"
                >
                  {isImporting ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                  {isImporting ? 'Import en cours...' : `Importer ${previewCount} enregistrement(s)`}
                </button>
              </div>
            </div>

            {/* Warnings */}
            {warnings.length > 0 && (
              <div className="mb-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <AlertCircle className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />
                  <span className="text-xs font-medium text-amber-400">{warnings.length} avertissement(s)</span>
                </div>
                <ul className="text-[11px] text-amber-300 space-y-0.5 max-h-24 overflow-y-auto">
                  {warnings.map((w, i) => <li key={i}>• {w}</li>)}
                </ul>
              </div>
            )}

            {/* Preview table */}
            <div className="overflow-x-auto rounded-lg border border-border">
              {isClients ? (
                <table className="text-xs w-full">
                  <thead><tr className="bg-muted">
                    {['Code', 'Nom', 'Téléphone', 'Adresse', 'Ville', 'ICE', 'Email'].map(h => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-foreground border-r border-border last:border-r-0">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {parsedClients.slice(0, 50).map((c, i) => (
                      <tr key={i} className="border-t border-border hover:bg-accent/50">
                        <td className="px-3 py-1.5">
                          {c.client_code
                            ? <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">{c.client_code}</span>
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
                  <thead><tr className="bg-muted">
                    {['Réf.', 'Client', 'Raison', 'Lignes', 'Statut'].map(h => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-foreground border-r border-border last:border-r-0 whitespace-nowrap">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {parsedReturns.slice(0, 50).map((r, i) => (
                      <tr key={i} className="border-t border-border hover:bg-accent/50">
                        <td className="px-3 py-1.5 text-primary font-medium font-mono">{r.referenceNumber}</td>
                        <td className="px-3 py-1.5 text-foreground">{r.clientName || '—'}</td>
                        <td className="px-3 py-1.5 text-muted-foreground max-w-[160px] truncate">{r.reason || '—'}</td>
                        <td className="px-3 py-1.5 text-center">
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">{r.items.length}</span>
                        </td>
                        <td className="px-3 py-1.5">
                          <span className={`inline-flex px-1.5 py-0.5 text-[10px] rounded-full font-medium ${r.status === 'closed' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                            {r.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="text-xs w-full">
                  <thead><tr className="bg-muted">
                    {['N°', 'Code Client', 'Client', 'Téléphone', 'Lignes', 'Total HT estimé', 'Statut'].map(h => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-foreground border-r border-border last:border-r-0 whitespace-nowrap">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {parsedDocs.slice(0, 50).map((d, i) => {
                      const totalHT = d.items.reduce((s, it) => s + it.unitPrice * it.quantity * (1 - (it.discount ?? 0) / 100), 0);
                      return (
                        <tr key={i} className="border-t border-border hover:bg-accent/50">
                          <td className="px-3 py-1.5 text-primary font-medium font-mono">{d.numero}</td>
                          <td className="px-3 py-1.5">
                            {d.clientCode
                              ? <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">{d.clientCode}</span>
                              : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="px-3 py-1.5 text-foreground">{d.clientName || '—'}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{d.clientPhone || '—'}</td>
                          <td className="px-3 py-1.5 text-center">
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">{d.items.length}</span>
                          </td>
                          <td className="px-3 py-1.5 text-foreground font-mono">
                            {new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(totalHT)} Dh
                          </td>
                          <td className="px-3 py-1.5">
                            <span className={`inline-flex px-1.5 py-0.5 text-[10px] rounded-full font-medium ${d.status === 'final' || d.status === 'solde' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                              {d.status}
                            </span>
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
        <div className="glass rounded-xl p-6 text-center space-y-4">
          <div className={`inline-flex items-center justify-center w-14 h-14 rounded-full ${importResult.errors.length === 0 ? 'bg-emerald-500/10' : 'bg-amber-500/10'}`}>
            {importResult.errors.length === 0
              ? <CheckCircle className="h-8 w-8 text-emerald-400" />
              : <AlertCircle className="h-8 w-8 text-amber-400" />}
          </div>

          <div>
            <h2 className="text-base font-bold text-foreground">Import terminé</h2>
            <p className="text-sm text-muted-foreground mt-1">
              <span className="text-emerald-400 font-semibold">{importResult.created}</span> enregistrement(s) créé(s)
              {importResult.errors.length > 0 && (
                <> · <span className="text-destructive font-semibold">{importResult.errors.length}</span> erreur(s)</>
              )}
            </p>
          </div>

          {importResult.errors.length > 0 && (
            <div className="text-left p-3 bg-destructive/10 border border-destructive/30 rounded-lg max-h-48 overflow-y-auto">
              <p className="text-xs font-medium text-destructive mb-1.5">Détail des erreurs :</p>
              <ul className="text-[11px] text-destructive/80 space-y-0.5">
                {importResult.errors.map((e, i) => <li key={i}>• {e}</li>)}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-center gap-2 pt-2">
            <button onClick={reset} className="flex items-center gap-1.5 px-4 py-2 text-sm border border-border rounded-lg hover:bg-accent text-foreground">
              <Upload className="h-3.5 w-3.5" />Nouvel import
            </button>
            <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg">
              <X className="h-3.5 w-3.5" />Fermer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
