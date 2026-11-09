import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Upload, Database, Bug, Trash2, Activity, BarChart3, Settings, type LucideIcon } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { ExcelUploadModal } from '../components/ExcelUploadModal';
import { PageHeader, Panel } from '../components/PageHeader';
import { ProductUploadService } from '../utils/productUploadService';
import { StorageManager } from '../utils/storage';
import { supabase } from '../utils/supabaseClient';

interface ActivityLog { id: string; username: string; action: string; details: string | null; created_at: string; }
interface DebugInfo { totalCount: number; invalidProducts: unknown[]; duplicateBarcodes: unknown[]; at: string; }

function Tool({ icon: Icon, label, sub, onClick, to, danger = false, disabled = false, busy = false }: {
  icon: LucideIcon; label: string; sub: string; onClick?: () => void; to?: string; danger?: boolean; disabled?: boolean; busy?: boolean;
}) {
  const cls = `flex items-center gap-3 rounded-xl border bg-card p-4 text-left shadow-sm transition hover:shadow-md disabled:opacity-50 ${danger ? 'border-destructive/30 hover:border-destructive/60' : 'border-border hover:border-primary/40'}`;
  const body = (
    <>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${danger ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}`}>
        <Icon className={`h-5 w-5 ${busy ? 'animate-spin' : ''}`} />
      </span>
      <span className="min-w-0">
        <span className={`block text-sm font-semibold ${danger ? 'text-destructive' : 'text-foreground'}`}>{label}</span>
        <span className="block text-xs text-muted-foreground">{sub}</span>
      </span>
    </>
  );
  return to ? <Link to={to} className={cls}>{body}</Link> : <button type="button" onClick={onClick} disabled={disabled} className={cls}>{body}</button>;
}

/** System tools for the super admin (moved here from the home page). */
export default function AdminToolsPage() {
  const { isSuperAdmin } = useAuth();
  const { state, syncData } = useAppContext();
  const { showToast } = useToast();
  const [syncing, setSyncing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [upload, setUpload] = useState(false);
  const [debug, setDebug] = useState<DebugInfo | null>(null);
  const [logs, setLogs] = useState<ActivityLog[] | null>(null);

  if (!isSuperAdmin) return <p className="py-12 text-center text-muted-foreground">Accès réservé au super administrateur.</p>;

  const sync = async () => {
    setSyncing(true);
    try {
      const updated = await syncData(true);
      showToast({ type: updated ? 'success' : 'info', title: updated ? 'Synchronisation réussie' : 'Déjà à jour', message: updated ? 'Base de données mise à jour.' : 'Aucune nouvelle donnée.' });
    } catch (error) {
      showToast({ type: 'error', title: 'Erreur', message: error instanceof Error ? error.message : 'Échec' });
    } finally { setSyncing(false); }
  };

  const analyse = async () => {
    try {
      const s = await ProductUploadService.analyzeProducts();
      setDebug({ totalCount: s.totalCount, invalidProducts: s.invalidProducts, duplicateBarcodes: s.duplicateBarcodes, at: new Date().toISOString() });
    } catch { showToast({ type: 'error', title: 'Erreur', message: 'Analyse échouée' }); }
  };

  const clearAll = async () => {
    if (!window.confirm('Supprimer TOUS les produits ? Cette action est IRRÉVERSIBLE !')) return;
    if (prompt('Tapez exactement : CONFIRMER') !== 'CONFIRMER') { showToast({ type: 'warning', title: 'Annulé', message: 'Confirmation incorrecte' }); return; }
    setClearing(true);
    try {
      await ProductUploadService.resetDatabase();
      StorageManager.clearAllData();
      showToast({ type: 'success', title: 'Suppression terminée', message: 'La page va se recharger…' });
      setTimeout(() => window.location.reload(), 2000);
    } catch (error) {
      showToast({ type: 'error', title: 'Erreur', message: error instanceof Error ? error.message : 'Erreur' });
    } finally { setClearing(false); }
  };

  const loadLogs = async () => {
    try {
      // Not in the generated types yet.
      const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args: object) => Promise<{ data: ActivityLog[] | null; error: unknown }>;
      const { data, error } = await rpc('get_recent_activity_logs', { p_limit: 30 });
      setLogs(error ? [] : (data || []));
    } catch { setLogs([]); }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Outils système" subtitle={`${new Intl.NumberFormat('fr-FR').format(state.products.length)} produits dans la base`} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Tool icon={RefreshCw} label="Synchroniser" sub="Recharger les produits du serveur" onClick={sync} disabled={syncing || !state.isOnline} busy={syncing} />
        <Tool icon={Upload} label="Importer Excel" sub="Ajouter ou mettre à jour des produits" onClick={() => setUpload(true)} />
        <Tool icon={Database} label="Sauvegarde" sub="Exporter ou restaurer les données" to="/admin/backup" />
        <Tool icon={BarChart3} label="Statistiques" sub="Activité et chiffres" to="/admin/statistics" />
        <Tool icon={Settings} label="Paramètres" sub="Société, documents, IA" to="/admin/settings" />
        <Tool icon={Activity} label="Activité récente" sub="30 dernières actions" onClick={loadLogs} />
        <Tool icon={Bug} label="Analyser la base" sub="Produits invalides ou en double" onClick={analyse} />
        <Tool icon={Trash2} label="Vider la base produits" sub={clearing ? 'Suppression…' : 'Irréversible'} onClick={clearAll} disabled={clearing} danger />
      </div>

      {debug && (
        <Panel title="Analyse de la base" className="mt-5">
          <dl className="grid grid-cols-3 gap-4 p-5 text-sm">
            <div><dt className="text-muted-foreground">Produits sur le serveur</dt><dd className="text-lg font-semibold tabular-nums">{debug.totalCount}</dd></div>
            <div><dt className="text-muted-foreground">Invalides</dt><dd className="text-lg font-semibold tabular-nums">{debug.invalidProducts.length}</dd></div>
            <div><dt className="text-muted-foreground">Codes-barres en double</dt><dd className="text-lg font-semibold tabular-nums">{debug.duplicateBarcodes.length}</dd></div>
          </dl>
        </Panel>
      )}

      {logs && (
        <Panel title="Activité récente" className="mt-5">
          {logs.length === 0 ? <p className="p-5 text-sm text-muted-foreground">Aucune activité enregistrée.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr><th className="px-5 py-2.5">Utilisateur</th><th className="px-5 py-2.5">Action</th><th className="px-5 py-2.5">Détails</th><th className="px-5 py-2.5">Date</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {logs.map(log => (
                    <tr key={log.id}>
                      <td className="px-5 py-2.5 font-medium">{log.username}</td>
                      <td className="px-5 py-2.5">{log.action}</td>
                      <td className="max-w-xs truncate px-5 py-2.5 text-muted-foreground">{log.details || '—'}</td>
                      <td className="whitespace-nowrap px-5 py-2.5 text-muted-foreground">{new Date(log.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {upload && <ExcelUploadModal onClose={() => setUpload(false)} onSuccess={() => { showToast({ type: 'success', title: 'Import réussi', message: 'Produits importés.' }); window.location.reload(); }} />}
    </div>
  );
}
