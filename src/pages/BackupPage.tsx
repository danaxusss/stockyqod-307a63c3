import React, { useState, useRef, useEffect } from 'react';
import { Download, Upload, Database, CheckCircle, AlertCircle, Loader, RotateCcw, FileJson, ChevronDown, ChevronUp, Trash2, Archive } from 'lucide-react';
import { BackupService, BackupData, BackupProgress } from '../utils/backupService';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../context/ToastContext';
import { getCompanyContext } from '../utils/supabaseCompanyFilter';

const LAST_BACKUP_KEY = 'stocky_last_backup';
const RESET_PHRASE = 'RÉINITIALISER TOUTES LES DONNÉES';

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(2)} Mo`;
}

function fmtTable(t: string): string {
  const labels: Record<string, string> = {
    companies: 'Sociétés', company_settings: 'Paramètres sociétés', app_users: 'Utilisateurs',
    clients: 'Clients', document_counters: 'Compteurs documents', products: 'Produits',
    product_name_overrides: 'Noms personnalisés', quote_templates: 'Modèles devis',
    technical_sheets: 'Fiches techniques', technical_sheet_products: 'Produits fiches',
    quotes: 'Devis / BL / Proformas / Factures', sheet_share_links: 'Liens partage',
    activity_logs: 'Journaux d\'activité',
  };
  return labels[t] || t;
}

export default function BackupPage() {
  const { isSuperAdmin } = useAuth();
  const { showToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  // Export state
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<BackupProgress | null>(null);

  // Restore state
  const [pendingFile, setPendingFile] = useState<BackupData | null>(null);
  const [pendingFileName, setPendingFileName] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<BackupProgress | null>(null);
  const [restoreResults, setRestoreResults] = useState<Record<string, { upserted: number; errors: number }> | null>(null);
  const [showSummary, setShowSummary] = useState(false);

  // Reset state
  const [resetPhrase, setResetPhrase] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState('');

  // Archive state
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [archiveMsg, setArchiveMsg] = useState('');
  const [archiveDownloaded, setArchiveDownloaded] = useState(false);

  const lastBackup = localStorage.getItem(LAST_BACKUP_KEY);

  useEffect(() => {
    if (!isSuperAdmin) return;
    const { companyId, isSuperAdmin: sa } = getCompanyContext();
    BackupService.getAvailableYears(companyId, sa).then(years => {
      setAvailableYears(years);
      if (years.length > 0) setSelectedYear(years[0]);
    }).catch(() => {});
  }, [isSuperAdmin]);

  if (!isSuperAdmin) {
    return <div className="text-center py-12 text-muted-foreground">Accès réservé au Super Admin.</div>;
  }

  const handleExport = async () => {
    setIsExporting(true);
    setExportProgress(null);
    try {
      const data = await BackupService.export(p => setExportProgress(p));
      BackupService.download(data);
      const now = new Date().toISOString();
      localStorage.setItem(LAST_BACKUP_KEY, now);
      showToast({ type: 'success', title: 'Sauvegarde téléchargée', message: 'Fichier JSON téléchargé avec succès' });
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur sauvegarde', message: String(e) });
    } finally {
      setIsExporting(false);
      setExportProgress(null);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await BackupService.parseFile(file);
      setPendingFile(data);
      setPendingFileName(file.name);
      setRestoreResults(null);
    } catch (err) {
      showToast({ type: 'error', title: 'Fichier invalide', message: String(err) });
    }
    e.target.value = '';
  };

  const handleRestore = async () => {
    if (!pendingFile) return;
    if (!window.confirm('Confirmer la restauration ? Les données existantes seront écrasées avec le contenu de la sauvegarde.')) return;
    setIsRestoring(true);
    setRestoreProgress(null);
    try {
      const results = await BackupService.restore(pendingFile, p => setRestoreProgress(p));
      setRestoreResults(results);
      const totalErrors = Object.values(results).reduce((s, r) => s + r.errors, 0);
      if (totalErrors === 0) {
        showToast({ type: 'success', title: 'Restauration réussie', message: 'Toutes les données ont été restaurées' });
      } else {
        showToast({ type: 'error', title: 'Restauration partielle', message: `${totalErrors} erreur(s) — vérifiez les détails` });
      }
      setPendingFile(null);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur restauration', message: String(e) });
    } finally {
      setIsRestoring(false);
      setRestoreProgress(null);
    }
  };

  const progressPct = (p: BackupProgress) =>
    p.total === 0 ? 0 : Math.round((p.done / p.total) * 100);

  const handleReset = async () => {
    if (resetPhrase !== RESET_PHRASE) return;
    setIsResetting(true);
    setResetMsg('');
    const { companyId, isSuperAdmin: sa } = getCompanyContext();
    try {
      await BackupService.resetAllData(companyId, sa, msg => setResetMsg(msg));
      setResetMsg('');
      setResetPhrase('');
      showToast({ type: 'success', title: 'Réinitialisation terminée', message: 'Toutes les données transactionnelles ont été supprimées.' });
      // Refresh available years
      const years = await BackupService.getAvailableYears(companyId, sa);
      setAvailableYears(years);
      setSelectedYear(years[0] ?? null);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur réinitialisation', message: String(e) });
    } finally {
      setIsResetting(false);
      setResetMsg('');
    }
  };

  const handleArchiveExport = async () => {
    if (!selectedYear) return;
    setIsArchiving(true);
    setArchiveMsg('');
    setArchiveDownloaded(false);
    const { companyId, isSuperAdmin: sa } = getCompanyContext();
    try {
      const data = await BackupService.exportDocumentsByYear(selectedYear, companyId, sa, msg => setArchiveMsg(msg));
      BackupService.downloadArchive(data, selectedYear);
      setArchiveDownloaded(true);
      setArchiveMsg('');
      showToast({ type: 'success', title: `Archive ${selectedYear} téléchargée`, message: `${(data.tables.quotes || []).length} document(s) exporté(s)` });
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur export archive', message: String(e) });
    } finally {
      setIsArchiving(false);
      setArchiveMsg('');
    }
  };

  const handleArchiveDelete = async () => {
    if (!selectedYear || !archiveDownloaded) return;
    if (!window.confirm(`Supprimer définitivement tous les documents de ${selectedYear} de la base de données ?\n\nCes données ont été exportées dans stocky-archive-${selectedYear}.json — conservez ce fichier pour les restaurer en cas de besoin.`)) return;
    setIsArchiving(true);
    setArchiveMsg('');
    const { companyId, isSuperAdmin: sa } = getCompanyContext();
    try {
      await BackupService.deleteDocumentsByYear(selectedYear, companyId, sa, msg => setArchiveMsg(msg));
      setArchiveDownloaded(false);
      setArchiveMsg('');
      showToast({ type: 'success', title: `Documents ${selectedYear} supprimés`, message: 'Les données ont été retirées de la base.' });
      const years = await BackupService.getAvailableYears(companyId, sa);
      setAvailableYears(years);
      setSelectedYear(years[0] ?? null);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur suppression archive', message: String(e) });
    } finally {
      setIsArchiving(false);
      setArchiveMsg('');
    }
  };

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center space-x-3">
        <div className="p-2 bg-primary/10 rounded-lg">
          <Database className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground">Sauvegarde & Restauration</h1>
          <p className="text-xs text-muted-foreground">
            {lastBackup
              ? `Dernière sauvegarde : ${new Date(lastBackup).toLocaleString('fr-FR')}`
              : 'Aucune sauvegarde effectuée depuis ce navigateur'}
          </p>
        </div>
      </div>

      {/* Export card */}
      <div className="glass rounded-xl shadow-lg p-5 space-y-4">
        <div className="flex items-center space-x-2">
          <Download className="h-4 w-4 text-emerald-500" />
          <h2 className="text-sm font-semibold text-foreground">Créer une sauvegarde</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Exporte toutes les tables de la base de données dans un fichier JSON.
          Ce fichier peut être utilisé pour restaurer les données en cas d'urgence.
        </p>

        {isExporting && exportProgress && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{exportProgress.table ? `Chargement : ${fmtTable(exportProgress.table)}` : 'Finalisation…'}</span>
              <span>{progressPct(exportProgress)}%</span>
            </div>
            <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                style={{ width: `${progressPct(exportProgress)}%` }}
              />
            </div>
          </div>
        )}

        <button
          onClick={handleExport}
          disabled={isExporting}
          className="flex items-center space-x-2 px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg transition-colors font-medium"
        >
          {isExporting ? <Loader className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          <span>{isExporting ? 'Export en cours…' : 'Télécharger la sauvegarde'}</span>
        </button>
      </div>

      {/* Restore card */}
      <div className="glass rounded-xl shadow-lg p-5 space-y-4">
        <div className="flex items-center space-x-2">
          <RotateCcw className="h-4 w-4 text-amber-500" />
          <h2 className="text-sm font-semibold text-foreground">Restaurer une sauvegarde</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Importez un fichier de sauvegarde. Les enregistrements existants seront mis à jour,
          les nouveaux seront ajoutés. Rien n'est supprimé.
        </p>

        <input ref={fileRef} type="file" accept=".json" onChange={handleFileSelect} className="hidden" />

        {!pendingFile ? (
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center space-x-2 px-4 py-2 text-sm border border-dashed border-amber-500/40 hover:border-amber-500 text-amber-500 hover:bg-amber-500/10 rounded-lg transition-colors"
          >
            <Upload className="h-4 w-4" />
            <span>Choisir un fichier de sauvegarde…</span>
          </button>
        ) : (
          <div className="space-y-3">
            {/* File info */}
            <div className="flex items-start space-x-3 p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg">
              <FileJson className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{pendingFileName}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Sauvegarde du {new Date(pendingFile.created_at).toLocaleString('fr-FR')} · v{pendingFile.version}
                </p>
                <button
                  onClick={() => setShowSummary(v => !v)}
                  className="flex items-center space-x-1 text-[10px] text-primary hover:underline mt-1"
                >
                  {showSummary ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  <span>{showSummary ? 'Masquer' : 'Voir'} le contenu</span>
                </button>
                {showSummary && (
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5">
                    {BackupService.summary(pendingFile).map(({ table, rows }) => (
                      <div key={table} className="flex justify-between text-[10px] text-muted-foreground">
                        <span>{fmtTable(table)}</span>
                        <span className="font-mono font-semibold text-foreground">{rows.toLocaleString('fr-FR')}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {isRestoring && restoreProgress && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{restoreProgress.table ? `Restauration : ${fmtTable(restoreProgress.table)}` : 'Finalisation…'}</span>
                  <span>{progressPct(restoreProgress)}%</span>
                </div>
                <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 rounded-full transition-all duration-300"
                    style={{ width: `${progressPct(restoreProgress)}%` }}
                  />
                </div>
              </div>
            )}

            <div className="flex space-x-2">
              <button
                onClick={() => { setPendingFile(null); setPendingFileName(''); }}
                disabled={isRestoring}
                className="px-3 py-1.5 text-sm border border-input rounded-lg hover:bg-accent disabled:opacity-50 text-foreground"
              >
                Annuler
              </button>
              <button
                onClick={handleRestore}
                disabled={isRestoring}
                className="flex items-center space-x-2 px-4 py-1.5 text-sm bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg transition-colors font-medium"
              >
                {isRestoring ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                <span>{isRestoring ? 'Restauration…' : 'Restaurer maintenant'}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Restore results */}
      {restoreResults && (
        <div className="glass rounded-xl shadow-lg p-5 space-y-3">
          <div className="flex items-center space-x-2">
            <CheckCircle className="h-4 w-4 text-emerald-500" />
            <h2 className="text-sm font-semibold text-foreground">Résultat de la restauration</h2>
          </div>
          <div className="divide-y divide-border">
            {Object.entries(restoreResults).map(([table, { upserted, errors }]) => (
              <div key={table} className="flex items-center justify-between py-1.5">
                <span className="text-xs text-foreground">{fmtTable(table)}</span>
                <div className="flex items-center space-x-3">
                  <span className="text-[10px] text-emerald-500">{upserted} restauré{upserted !== 1 ? 's' : ''}</span>
                  {errors > 0 && (
                    <span className="flex items-center space-x-1 text-[10px] text-destructive">
                      <AlertCircle className="h-3 w-3" />
                      <span>{errors} erreur{errors !== 1 ? 's' : ''}</span>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Archive by year */}
      <div className="glass rounded-xl shadow-lg p-5 space-y-4">
        <div className="flex items-center space-x-2">
          <Archive className="h-4 w-4 text-blue-500" />
          <h2 className="text-sm font-semibold text-foreground">Archiver par année</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Exporte tous les documents d'une année dans un fichier JSON, puis les retire de la base active.
          Ce fichier peut être ré-importé à tout moment via le bouton "Restaurer" en cas de besoin.
        </p>

        {availableYears.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">Aucune donnée documentaire disponible.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-xs font-medium text-foreground whitespace-nowrap">Année à archiver :</label>
              <select
                value={selectedYear ?? ''}
                onChange={e => { setSelectedYear(Number(e.target.value)); setArchiveDownloaded(false); }}
                className="px-3 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring"
              >
                {availableYears.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>

            {archiveMsg && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader className="h-3 w-3 animate-spin" />{archiveMsg}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleArchiveExport}
                disabled={isArchiving || !selectedYear}
                className="flex items-center space-x-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors font-medium"
              >
                {isArchiving && !archiveDownloaded ? <Loader className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                <span>Exporter {selectedYear}</span>
              </button>

              {archiveDownloaded && (
                <button
                  onClick={handleArchiveDelete}
                  disabled={isArchiving}
                  className="flex items-center space-x-2 px-4 py-2 text-sm bg-destructive hover:bg-destructive/90 disabled:opacity-50 text-white rounded-lg transition-colors font-medium"
                >
                  {isArchiving ? <Loader className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  <span>Supprimer {selectedYear} de la base</span>
                </button>
              )}
            </div>

            {archiveDownloaded && (
              <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-700 dark:text-amber-400">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Archive téléchargée. Conservez ce fichier en lieu sûr — il est la seule copie des données {selectedYear} après suppression.</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Reset all data */}
      <div className="glass rounded-xl shadow-lg p-5 space-y-4 border border-destructive/20">
        <div className="flex items-center space-x-2">
          <Trash2 className="h-4 w-4 text-destructive" />
          <h2 className="text-sm font-semibold text-destructive">Réinitialisation complète</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Supprime <strong>définitivement</strong> tous les devis, BLs, proformas, factures, avoirs, retours et clients.
          Les produits, paramètres, modèles et utilisateurs ne sont <strong>pas</strong> affectés.
          Cette action est irréversible — effectuez une sauvegarde avant de continuer.
        </p>

        <div className="space-y-2">
          <label className="block text-xs font-medium text-foreground">
            Pour confirmer, tapez exactement : <span className="font-mono text-destructive select-all">{RESET_PHRASE}</span>
          </label>
          <input
            type="text"
            value={resetPhrase}
            onChange={e => setResetPhrase(e.target.value)}
            placeholder="Tapez la phrase de confirmation…"
            className="w-full px-3 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring font-mono"
            disabled={isResetting}
            autoComplete="off"
          />
        </div>

        {resetMsg && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Loader className="h-3 w-3 animate-spin" />{resetMsg}
          </p>
        )}

        <button
          onClick={handleReset}
          disabled={isResetting || resetPhrase !== RESET_PHRASE}
          className="flex items-center space-x-2 px-4 py-2 text-sm bg-destructive hover:bg-destructive/90 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium"
        >
          {isResetting ? <Loader className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          <span>{isResetting ? 'Réinitialisation en cours…' : 'Réinitialiser maintenant'}</span>
        </button>
      </div>

      {/* Info box */}
      <div className="rounded-lg border border-border p-4 space-y-2 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground text-[11px] uppercase tracking-wide">À savoir</p>
        <ul className="space-y-1 list-disc list-inside">
          <li>La sauvegarde inclut toutes les tables : devis, BL, proformas, factures, produits, clients, utilisateurs, paramètres.</li>
          <li>Les fichiers uploadés (logos, tampons, fiches) sont dans le stockage Supabase et ne sont pas inclus dans ce fichier.</li>
          <li>La restauration ne supprime rien — elle ajoute ou met à jour les enregistrements existants.</li>
          <li>Pour une sauvegarde automatique quotidienne, configurez le cron sur votre VPS (voir ci-dessous).</li>
        </ul>
      </div>

      {/* VPS cron info */}
      <div className="glass rounded-xl shadow-lg p-5 space-y-3">
        <div className="flex items-center space-x-2">
          <Database className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Sauvegarde automatique VPS</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Exécutez ces commandes une seule fois sur votre VPS pour activer les sauvegardes SQL quotidiennes automatiques.
          Ces sauvegardes sont complètes (y compris les fichiers stockés) et peuvent restaurer l'état exact de la base.
        </p>
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase">1 — Créer le dossier de sauvegardes</p>
          <pre className="bg-secondary rounded-lg p-3 text-[11px] font-mono text-foreground overflow-x-auto whitespace-pre-wrap">
{`mkdir -p /var/backups/stocky
chmod 700 /var/backups/stocky`}
          </pre>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase">2 — Créer le script de sauvegarde</p>
          <pre className="bg-secondary rounded-lg p-3 text-[11px] font-mono text-foreground overflow-x-auto whitespace-pre-wrap">
{`cat > /var/backups/stocky/backup.sh << 'EOF'
#!/bin/bash
FILE="/var/backups/stocky/stocky_$(date +%Y%m%d_%H%M).dump"
pg_dump -U postgres -d postgres --format=custom --compress=9 -f "$FILE"
# Garder seulement les 30 dernières sauvegardes
ls -t /var/backups/stocky/*.dump 2>/dev/null | tail -n +31 | xargs rm -f
echo "Sauvegarde OK : $FILE"
EOF
chmod +x /var/backups/stocky/backup.sh`}
          </pre>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase">3 — Planifier à 3h du matin chaque jour</p>
          <pre className="bg-secondary rounded-lg p-3 text-[11px] font-mono text-foreground overflow-x-auto whitespace-pre-wrap">
{`(crontab -l 2>/dev/null; echo "0 3 * * * /var/backups/stocky/backup.sh >> /var/log/stocky-backup.log 2>&1") | crontab -`}
          </pre>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase">Pour restaurer depuis un fichier .dump</p>
          <pre className="bg-secondary rounded-lg p-3 text-[11px] font-mono text-foreground overflow-x-auto whitespace-pre-wrap">
{`pg_restore -U postgres -d postgres --clean /var/backups/stocky/stocky_20260419_0300.dump`}
          </pre>
        </div>
      </div>
    </div>
  );
}
