import React, { useState, useEffect, forwardRef } from 'react';
import { Search, RefreshCw, Package, Upload, Bug, Trash2, BarChart3, FileText, ShoppingCart, LucideIcon, Users, Settings, FolderOpen, ChevronDown, ChevronUp, Receipt, Calculator, Truck, Database, Activity } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { ExcelUploadModal } from '../components/ExcelUploadModal';
import { ProductUploadService } from '../utils/productUploadService';
import { StorageManager } from '../utils/storage';
import { supabase } from '../utils/supabaseClient';

interface ActivityLog {
  id: string;
  username: string;
  action: string;
  details: string | null;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
}

interface ActionCardProps {
  to?: string;
  onClick?: () => void;
  icon: LucideIcon;
  iconGradient: string;
  title: string;
  desc: string;
  disabled?: boolean;
  size?: 'large' | 'normal' | 'small';
  children?: React.ReactNode;
}

const ActionCard = forwardRef<HTMLDivElement, ActionCardProps>(
  ({ to, onClick, icon: Icon, iconGradient, title, desc, disabled, size = 'normal', children }, ref) => {
    const sizeClasses = {
      large: 'p-5',
      normal: 'p-3.5',
      small: 'p-2.5',
    };
    const iconSizeClasses = {
      large: 'w-11 h-11 mb-3',
      normal: 'w-9 h-9 mb-2',
      small: 'w-7 h-7 mb-1.5',
    };
    const titleClasses = {
      large: 'text-base font-bold mb-1',
      normal: 'text-sm font-semibold mb-0.5',
      small: 'text-xs font-semibold mb-0.5',
    };
    const descClasses = {
      large: 'text-sm',
      normal: 'text-xs',
      small: 'text-[11px]',
    };
    const iconInner = {
      large: 'h-5 w-5',
      normal: 'h-4 w-4',
      small: 'h-3.5 w-3.5',
    };

    const cls = `group glass rounded-xl ${sizeClasses[size]} shadow hover:shadow-lg transition-all duration-300 hover:scale-[1.02] text-left ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`;
    const content = (
      <>
        <div className={`flex items-center justify-center ${iconSizeClasses[size]} ${iconGradient} rounded-lg transition-all`}>
          <Icon className={`${iconInner[size]} text-primary-foreground`} />
        </div>
        <h3 className={`${titleClasses[size]} text-foreground`}>{title}</h3>
        <p className={`text-muted-foreground ${descClasses[size]}`}>{desc}</p>
        {children}
      </>
    );

    if (to) return <Link to={to} className={cls}>{content}</Link>;
    return <button onClick={onClick} disabled={disabled} className={cls}>{content}</button>;
  }
);
ActionCard.displayName = 'ActionCard';

export function Home() {
  const { isAdmin, isSuperAdmin, isCompta, canAccessStockLocation, authVersion, canCreateQuote } = useAuth();
  const { state, syncData, syncInfo } = useAppContext();
  const { showToast } = useToast();
  const [isSyncing, setIsSyncing] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [showTechnicalSection, setShowTechnicalSection] = useState(false);
  const [showActivitySection, setShowActivitySection] = useState(false);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  useEffect(() => {
    console.log('Home page - Auth version changed:', authVersion, 'isAdmin:', isAdmin);
  }, [authVersion, isAdmin]);

  const handleSync = async () => {
    if (!isAdmin) return;
    setIsSyncing(true);
    try {
      const hasUpdates = await syncData(true);
      showToast({
        type: hasUpdates ? 'success' : 'info',
        title: hasUpdates ? 'Synchronisation réussie' : 'Déjà à jour',
        message: hasUpdates ? 'Base de données mise à jour !' : 'Aucune nouvelle donnée.'
      });
    } catch (error) {
      showToast({ type: 'error', title: 'Erreur', message: error instanceof Error ? error.message : 'Échec' });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleClearDatabase = async () => {
    if (!isAdmin) return;
    const confirmed = window.confirm('Supprimer TOUS les produits ? Cette action est IRRÉVERSIBLE !');
    if (!confirmed) return;
    const finalConfirm = prompt('Tapez exactement: CONFIRMER');
    if (finalConfirm !== 'CONFIRMER') { showToast({ type: 'warning', title: 'Annulé', message: 'Confirmation incorrecte' }); return; }

    setIsClearing(true);
    try {
      await ProductUploadService.resetDatabase();
      StorageManager.clearAllData();
      showToast({ type: 'success', title: 'Suppression terminée', message: 'La page va se recharger...' });
      setTimeout(() => window.location.reload(), 2000);
    } catch (error) {
      showToast({ type: 'error', title: 'Erreur', message: `${error instanceof Error ? error.message : 'Erreur'}` });
    } finally {
      setIsClearing(false);
    }
  };

  const handleUploadSuccess = () => {
    showToast({ type: 'success', title: 'Upload réussi', message: 'Produits téléchargés !' });
    window.location.reload();
  };

  const handleDebugAnalysis = async () => {
    if (!isAdmin) return;
    try {
      setShowDebugInfo(true);
      const supabaseStats = await ProductUploadService.analyzeProducts();
      setDebugInfo({ supabase: supabaseStats, timestamp: new Date().toISOString() });
    } catch (error) {
      showToast({ type: 'error', title: 'Erreur', message: 'Analyse échouée' });
    }
  };

  const handleToggleActivity = async () => {
    if (!showActivitySection) {
      setActivityLoading(true);
      try {
        const { data, error } = await (supabase.rpc as any)('get_recent_activity_logs', { p_limit: 30 });
        if (!error) setActivityLogs(data || []);
      } catch {
        // silently ignore — non-critical
      } finally {
        setActivityLoading(false);
      }
    }
    setShowActivitySection(prev => !prev);
  };

  const formatNumber = (num: number): string => new Intl.NumberFormat('fr-FR').format(num);

  const totalStock = state.products.reduce((sum, product) => {
    const productTotal = Object.entries(product.stock_levels || {})
      .filter(([location]) => canAccessStockLocation(location))
      .reduce((s, [, level]) => s + level, 0);
    return sum + productTotal;
  }, 0);

  const allLocations = new Set<string>();
  state.products.forEach(product => {
    Object.keys(product.stock_levels || {}).forEach(location => {
      if (canAccessStockLocation(location)) allLocations.add(location);
    });
  });

  if (state.products.length === 0) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-5">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-primary rounded-xl mb-3" style={{ boxShadow: 'var(--shadow-glow)' }}>
            <Package className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-1">Gestion d'Inventaire</h1>
          <p className="text-muted-foreground text-sm">Recherchez et gérez votre inventaire facilement</p>
        </div>

        <div className="glass rounded-xl shadow-lg p-6 text-center">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-destructive/10 rounded-xl">
              <Package className="h-12 w-12 text-destructive" />
            </div>
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">Aucun Produit Trouvé</h2>
          <p className="text-muted-foreground mb-4 text-sm leading-relaxed">
            {state.isOnline 
              ? "Synchronisez ou téléchargez des produits depuis un fichier Excel."
              : "Aucun produit en cache. Connectez-vous à Internet pour synchroniser."}
          </p>

          {state.isOnline && isAdmin && (
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button onClick={handleSync} disabled={isSyncing}
                className="flex items-center justify-center space-x-2 px-5 py-2.5 bg-primary hover:bg-primary/90 disabled:bg-muted text-primary-foreground rounded-lg transition-colors text-sm">
                <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'Synchronisation...' : 'Synchroniser'}</span>
              </button>
              <button onClick={() => setShowUploadModal(true)}
                className="flex items-center justify-center space-x-2 px-5 py-2.5 bg-accent hover:bg-accent/80 text-accent-foreground rounded-lg transition-colors text-sm">
                <Upload className="h-4 w-4" />
                <span>Télécharger Excel</span>
              </button>
            </div>
          )}
        </div>

        {showUploadModal && (
          <ExcelUploadModal onClose={() => setShowUploadModal(false)} onSuccess={handleUploadSuccess} />
        )}
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="text-center mb-5">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-primary rounded-xl mb-3" style={{ boxShadow: 'var(--shadow-glow)' }}>
          <Package className="h-6 w-6 text-primary-foreground" />
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-1">Gestion d'Inventaire</h1>
        <p className="text-muted-foreground text-sm">Recherchez et gérez votre inventaire facilement</p>
      </div>

      {/* Main Navigation - Primary Actions */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <ActionCard to="/search" icon={Search} iconGradient="bg-primary" title="Rechercher" desc="Nom, marque ou barcode" size="large" />
        <ActionCard to="/products" icon={FolderOpen} iconGradient="bg-indigo-600" title="Catalogue Produits" desc="Parcourir et modifier" size="large" />
        <ActionCard to="/sheets" icon={FileText} iconGradient="bg-teal-600" title="Fiches Techniques" desc="Documents et partage" size="large" />
        <ActionCard to="/clients" icon={Users} iconGradient="bg-sky-600" title="Clients" desc="Gestion des clients" size="large" />
        {canCreateQuote() && (
          <>
            <ActionCard to="/quotes-history" icon={FileText} iconGradient="bg-emerald-600" title="Devis" desc="Historique et gestion" size="large" />
            <ActionCard to="/quote-cart" icon={ShoppingCart} iconGradient="bg-violet-600" title="Nouveau Devis" desc="Créer un devis" size="large" />
          </>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Produits', value: formatNumber(state.products.length) },
          { label: 'Stock Total', value: formatNumber(totalStock) },
          { label: 'Emplacements', value: allLocations.size.toString() },
          { label: 'Statut', value: syncInfo.isOnline ? 'En ligne' : 'Hors ligne' },
        ].map(({ label, value }) => (
          <div key={label} className="glass rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-foreground">{value}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Comptabilité Section */}
      {(isCompta || isSuperAdmin) && (
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Comptabilité</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <ActionCard to="/compta/bls" icon={Truck} iconGradient="bg-teal-600" title="BL" desc="Bons de livraison" size="normal" />
            <ActionCard to="/compta/proformas" icon={FileText} iconGradient="bg-emerald-600" title="Proformas" desc="Liste et gestion" size="normal" />
            <ActionCard to="/compta/invoices" icon={Receipt} iconGradient="bg-blue-600" title="Factures" desc="Liste et gestion" size="normal" />
            <ActionCard to="/compta/clients" icon={Calculator} iconGradient="bg-violet-600" title="Clients (financier)" desc="Suivi par client" size="normal" />
          </div>
        </div>
      )}

      {/* Admin Tools */}
      {isSuperAdmin && (
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Outils Admin</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <ActionCard onClick={handleSync} disabled={isSyncing || !state.isOnline} icon={RefreshCw} iconGradient="bg-orange-600"
              title="Synchroniser" desc={isSyncing ? 'Sync...' : 'Serveur'} size="small" />
            <ActionCard onClick={() => setShowUploadModal(true)} icon={Upload} iconGradient="bg-violet-600" title="Upload Excel" desc="Importer" size="small" />
            <ActionCard to="/admin/statistics" icon={BarChart3} iconGradient="bg-primary" title="Statistiques" desc="Données" size="small" />
            <ActionCard to="/admin/settings" icon={Settings} iconGradient="bg-gray-600" title="Paramètres" desc="Configuration" size="small" />
            <ActionCard to="/admin/backup" icon={Database} iconGradient="bg-rose-700" title="Sauvegarde" desc="Backup & Restore" size="small" />
          </div>
        </div>
      )}

      {/* Activity Log - Collapsible */}
      {isSuperAdmin && (
        <div className="mb-4">
          <button onClick={handleToggleActivity}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2">
            <Activity className="h-3 w-3" />
            <span className="uppercase tracking-wider font-semibold">Activité Récente</span>
            {showActivitySection ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {showActivitySection && (
            <div className="glass rounded-xl p-3 shadow">
              {activityLoading ? (
                <div className="text-xs text-muted-foreground text-center py-4">Chargement...</div>
              ) : activityLogs.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-4">Aucune activité enregistrée.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-muted-foreground border-b border-border/40">
                        <th className="text-left pb-1.5 pr-3 font-semibold">Utilisateur</th>
                        <th className="text-left pb-1.5 pr-3 font-semibold">Action</th>
                        <th className="text-left pb-1.5 pr-3 font-semibold hidden sm:table-cell">Détails</th>
                        <th className="text-left pb-1.5 font-semibold">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activityLogs.map(log => (
                        <tr key={log.id} className="border-b border-border/20 last:border-0">
                          <td className="py-1.5 pr-3 font-medium text-foreground">{log.username}</td>
                          <td className="py-1.5 pr-3 text-foreground">{log.action}</td>
                          <td className="py-1.5 pr-3 text-muted-foreground hidden sm:table-cell max-w-[200px] truncate">{log.details || '—'}</td>
                          <td className="py-1.5 text-muted-foreground whitespace-nowrap">
                            {new Date(log.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Debug / Danger Zone - Collapsible */}
      {isSuperAdmin && (
        <div className="mb-4">
          <button onClick={() => setShowTechnicalSection(!showTechnicalSection)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2">
            {showTechnicalSection ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            <span className="uppercase tracking-wider font-semibold">Technique & Debug</span>
          </button>
          {showTechnicalSection && (
            <div className="grid grid-cols-2 gap-2">
              <ActionCard onClick={handleDebugAnalysis} icon={Bug} iconGradient="bg-rose-600" title="Debug" desc="Analyse" size="small" />
              <ActionCard onClick={handleClearDatabase} disabled={isClearing} icon={Trash2} iconGradient="bg-red-700"
                title="Vider la Base" desc={isClearing ? 'Suppression...' : 'IRRÉVERSIBLE'} size="small" />
            </div>
          )}
        </div>
      )}

      {/* Debug Information */}
      {showDebugInfo && debugInfo && isAdmin && (
        <div className="mb-5 glass rounded-xl p-4 shadow">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-foreground flex items-center space-x-2">
              <Bug className="h-4 w-4" />
              <span>Analyse de Debug</span>
            </h2>
            <button onClick={() => setShowDebugInfo(false)} className="text-muted-foreground hover:text-foreground">✕</button>
          </div>
          <div className="space-y-1 text-sm text-muted-foreground">
            <div>Produits serveur: <span className="font-mono text-foreground">{debugInfo.supabase.totalCount}</span></div>
            <div>Produits invalides: <span className="font-mono text-foreground">{debugInfo.supabase.invalidProducts.length}</span></div>
            <div>Dupliqués: <span className="font-mono text-foreground">{debugInfo.supabase.duplicateBarcodes.length}</span></div>
            <div className="text-xs mt-1">Analyse: {new Date(debugInfo.timestamp).toLocaleString('fr-FR')}</div>
          </div>
        </div>
      )}

      {showUploadModal && (
        <ExcelUploadModal onClose={() => setShowUploadModal(false)} onSuccess={handleUploadSuccess} />
      )}
    </div>
  );
}