import React, { useState, useEffect, forwardRef } from 'react';
import {
  Search, RefreshCw, Package, Upload, Bug, Trash2, BarChart3, FileText,
  ShoppingCart, LucideIcon, Users, Settings, FolderOpen, ChevronDown,
  ChevronUp, Receipt, Calculator, Truck, Database, Activity, ArrowRight,
} from 'lucide-react';
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

/* ── Action Card ── */
interface ActionCardProps {
  to?: string;
  onClick?: () => void;
  icon: LucideIcon;
  accent: string;          /* Tailwind bg color class for icon bg */
  iconColor?: string;      /* icon text color, default white */
  title: string;
  desc: string;
  disabled?: boolean;
  size?: 'large' | 'normal' | 'small';
  children?: React.ReactNode;
}

const ActionCard = forwardRef<HTMLDivElement, ActionCardProps>(
  ({ to, onClick, icon: Icon, accent, iconColor = 'text-white', title, desc, disabled, size = 'normal', children }, ref) => {
    const isLarge = size === 'large';
    const isSmall = size === 'small';

    const cls = `
      group relative
      bg-card border border-border/50
      rounded-xl overflow-hidden
      transition-all duration-200
      hover:shadow-[0_4px_20px_rgba(0,0,0,0.09),0_1px_4px_rgba(0,0,0,0.06)]
      dark:hover:shadow-[0_4px_20px_rgba(0,0,0,0.4),0_1px_4px_rgba(0,0,0,0.3)]
      hover:-translate-y-0.5
      active:translate-y-0 active:scale-[0.99]
      shadow-[0_1px_3px_rgba(0,0,0,0.06),0_2px_8px_rgba(0,0,0,0.04)]
      dark:shadow-[0_1px_3px_rgba(0,0,0,0.3),0_2px_8px_rgba(0,0,0,0.25)]
      ${isLarge ? 'p-4' : isSmall ? 'p-3' : 'p-3.5'}
      ${disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer text-left'}
    `;

    const content = (
      <>
        {/* Icon container */}
        <div className={`
          flex items-center justify-center rounded-xl mb-3
          ${accent}
          ${isLarge ? 'w-11 h-11' : isSmall ? 'w-7 h-7 mb-2' : 'w-9 h-9'}
        `}>
          <Icon className={`${iconColor} ${isLarge ? 'h-5 w-5' : isSmall ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} />
        </div>

        <div>
          <h3 className={`
            font-semibold text-foreground leading-tight
            ${isLarge ? 'text-sm mb-0.5' : isSmall ? 'text-xs mb-0.5' : 'text-[13px] mb-0.5'}
          `}>
            {title}
          </h3>
          <p className={`text-muted-foreground leading-snug ${isLarge ? 'text-xs' : 'text-[11px]'}`}>
            {desc}
          </p>
        </div>

        {children}

        {/* Hover arrow — subtle */}
        <ArrowRight className="
          absolute right-3 top-1/2 -translate-y-1/2
          h-3 w-3 text-muted-foreground/30
          opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5
          transition-all duration-200
        " />
      </>
    );

    if (to) return <Link to={to} className={cls}>{content}</Link>;
    return <button onClick={onClick} disabled={disabled} className={cls}>{content}</button>;
  }
);
ActionCard.displayName = 'ActionCard';

/* ── Stat Widget ── */
function StatWidget({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="
      bg-card border border-border/50 rounded-xl p-3.5
      shadow-[0_1px_3px_rgba(0,0,0,0.06),0_2px_8px_rgba(0,0,0,0.04)]
      dark:shadow-[0_1px_3px_rgba(0,0,0,0.3),0_2px_8px_rgba(0,0,0,0.2)]
    ">
      <div className="text-xl font-bold text-foreground tracking-tight leading-none finance-amount">
        {value}
      </div>
      <div className="text-[11px] text-muted-foreground mt-1.5 font-medium">{label}</div>
      {sub && <div className="text-[10px] text-muted-foreground/60 mt-0.5">{sub}</div>}
    </div>
  );
}

/* ── Section Header ── */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.08em]">
        {children}
      </h2>
      <div className="flex-1 h-px bg-border/50" />
    </div>
  );
}

/* ── Main Component ── */
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
    if (finalConfirm !== 'CONFIRMER') {
      showToast({ type: 'warning', title: 'Annulé', message: 'Confirmation incorrecte' });
      return;
    }
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
        // non-critical
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

  /* ── Empty state ── */
  if (state.products.length === 0) {
    return (
      <div className="max-w-sm mx-auto pt-8">
        <div className="
          bg-card border border-border/50 rounded-2xl p-8 text-center
          shadow-[0_4px_24px_rgba(0,0,0,0.08),0_1px_4px_rgba(0,0,0,0.05)]
        ">
          <div className="flex justify-center mb-5">
            <div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center">
              <Package className="h-8 w-8 text-muted-foreground/50" />
            </div>
          </div>
          <h2 className="text-base font-semibold text-foreground mb-1.5">Aucun produit</h2>
          <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
            {state.isOnline
              ? 'Synchronisez ou importez des produits depuis un fichier Excel.'
              : 'Connectez-vous à Internet pour synchroniser.'}
          </p>
          {state.isOnline && isAdmin && (
            <div className="flex flex-col gap-2">
              <button
                onClick={handleSync}
                disabled={isSyncing}
                className="
                  flex items-center justify-center gap-2 px-4 py-2.5
                  bg-primary text-primary-foreground rounded-xl text-sm font-medium
                  hover:bg-primary/90 disabled:opacity-50 transition-colors
                "
              >
                <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? 'Synchronisation...' : 'Synchroniser'}
              </button>
              <button
                onClick={() => setShowUploadModal(true)}
                className="
                  flex items-center justify-center gap-2 px-4 py-2.5
                  bg-secondary text-secondary-foreground rounded-xl text-sm font-medium
                  hover:bg-secondary/80 transition-colors border border-border/50
                "
              >
                <Upload className="h-4 w-4" />
                Importer Excel
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
    <div className="max-w-4xl mx-auto space-y-5">

      {/* ── Stats widgets ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <StatWidget
          label="Produits"
          value={formatNumber(state.products.length)}
          sub="référ. actives"
        />
        <StatWidget
          label="Stock Total"
          value={formatNumber(totalStock)}
          sub="toutes zones"
        />
        <StatWidget
          label="Emplacements"
          value={allLocations.size.toString()}
          sub="zones actives"
        />
        <StatWidget
          label="Connexion"
          value={syncInfo.isOnline ? 'En ligne' : 'Hors ligne'}
          sub={syncInfo.isOnline ? 'Base synchronisée' : 'Mode local'}
        />
      </div>

      {/* ── Primary navigation ── */}
      <section>
        <SectionLabel>Navigation</SectionLabel>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
          <ActionCard
            to="/search"
            icon={Search}
            accent="bg-primary"
            title="Rechercher"
            desc="Nom, marque ou barcode"
            size="large"
          />
          <ActionCard
            to="/products"
            icon={FolderOpen}
            accent="bg-indigo-600"
            title="Catalogue"
            desc="Parcourir et modifier"
            size="large"
          />
          <ActionCard
            to="/sheets"
            icon={FileText}
            accent="bg-teal-600"
            title="Fiches Techniques"
            desc="Documents et partage"
            size="large"
          />
          <ActionCard
            to="/clients"
            icon={Users}
            accent="bg-sky-600"
            title="Clients"
            desc="Gestion des clients"
            size="large"
          />
          {canCreateQuote() && (
            <>
              <ActionCard
                to="/quotes-history"
                icon={FileText}
                accent="bg-emerald-600"
                title="Devis"
                desc="Historique et gestion"
                size="large"
              />
              <ActionCard
                to="/quote-cart"
                icon={ShoppingCart}
                accent="bg-violet-600"
                title="Nouveau Devis"
                desc="Créer un devis"
                size="large"
              />
            </>
          )}
        </div>
      </section>

      {/* ── Facturation ── */}
      {(isCompta || isSuperAdmin) && (
        <section>
          <SectionLabel>Facturation</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
            <ActionCard to="/compta/bls"      icon={Truck}      accent="bg-teal-600"   title="BL"              desc="Livraisons"      size="small" />
            <ActionCard to="/compta/proformas" icon={FileText}   accent="bg-emerald-600" title="Proformas"      desc="Gestion"         size="small" />
            <ActionCard to="/compta/invoices"  icon={Receipt}    accent="bg-blue-600"   title="Factures"        desc="Liste"           size="small" />
            <ActionCard to="/compta/clients"   icon={Calculator} accent="bg-violet-600" title="Clients"         desc="Financier"       size="small" />
            <ActionCard to="/compta/returns"   icon={RefreshCw}  accent="bg-amber-600"  title="Retours"         desc="Gestion"         size="small" />
            <ActionCard to="/compta/avoirs"    icon={Receipt}    accent="bg-rose-600"   title="Avoirs"          desc="Crédits"         size="small" />
          </div>
        </section>
      )}

      {/* ── Admin tools ── */}
      {isSuperAdmin && (
        <section>
          <SectionLabel>Administration</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <ActionCard
              onClick={handleSync}
              disabled={isSyncing || !state.isOnline}
              icon={RefreshCw}
              accent="bg-orange-600"
              title="Synchroniser"
              desc={isSyncing ? 'En cours...' : 'Depuis serveur'}
              size="small"
            />
            <ActionCard
              onClick={() => setShowUploadModal(true)}
              icon={Upload}
              accent="bg-violet-600"
              title="Import Excel"
              desc="Télécharger"
              size="small"
            />
            <ActionCard to="/admin/statistics" icon={BarChart3} accent="bg-primary"   title="Statistiques" desc="Données" size="small" />
            <ActionCard to="/admin/settings"   icon={Settings}  accent="bg-slate-600" title="Paramètres"   desc="Config"  size="small" />
            <ActionCard to="/admin/backup"     icon={Database}  accent="bg-rose-700"  title="Sauvegarde"   desc="Backup"  size="small" />
          </div>
        </section>
      )}

      {/* ── Activity log ── */}
      {isSuperAdmin && (
        <section>
          <button
            onClick={handleToggleActivity}
            className="flex items-center gap-1.5 mb-2.5 group"
          >
            <Activity className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors" />
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.08em] group-hover:text-foreground transition-colors">
              Activité Récente
            </span>
            <div className="flex-1 h-px bg-border/50 ml-1" />
            {showActivitySection
              ? <ChevronUp className="h-3 w-3 text-muted-foreground" />
              : <ChevronDown className="h-3 w-3 text-muted-foreground" />
            }
          </button>

          {showActivitySection && (
            <div className="
              bg-card border border-border/50 rounded-xl overflow-hidden
              shadow-[0_1px_3px_rgba(0,0,0,0.06),0_2px_8px_rgba(0,0,0,0.04)]
              dark:shadow-[0_1px_3px_rgba(0,0,0,0.3),0_2px_8px_rgba(0,0,0,0.2)]
            ">
              {activityLoading ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  Chargement...
                </div>
              ) : activityLogs.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  Aucune activité enregistrée.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-secondary/60">
                      <tr>
                        {['Utilisateur', 'Action', 'Détails', 'Date'].map(h => (
                          <th key={h} className="text-left px-4 py-2.5 font-semibold text-muted-foreground text-[10px] uppercase tracking-wide first:rounded-tl-xl">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {activityLogs.map(log => (
                        <tr key={log.id} className="hover:bg-secondary/30 transition-colors">
                          <td className="px-4 py-2.5 font-medium text-foreground">{log.username}</td>
                          <td className="px-4 py-2.5 text-foreground">{log.action}</td>
                          <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell max-w-[200px] truncate">
                            {log.details || '—'}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                            {new Date(log.created_at).toLocaleString('fr-FR', {
                              day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                            })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── Danger zone ── */}
      {isSuperAdmin && (
        <section>
          <button
            onClick={() => setShowTechnicalSection(!showTechnicalSection)}
            className="flex items-center gap-1.5 mb-2.5 group"
          >
            {showTechnicalSection
              ? <ChevronUp className="h-3 w-3 text-muted-foreground" />
              : <ChevronDown className="h-3 w-3 text-muted-foreground" />
            }
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.08em] group-hover:text-foreground transition-colors">
              Technique & Debug
            </span>
            <div className="flex-1 h-px bg-border/50 ml-1" />
          </button>

          {showTechnicalSection && (
            <div className="grid grid-cols-2 gap-2">
              <ActionCard onClick={handleDebugAnalysis} icon={Bug}   accent="bg-rose-600"    title="Debug"       desc="Analyser la base" size="small" />
              <ActionCard
                onClick={handleClearDatabase}
                disabled={isClearing}
                icon={Trash2}
                accent="bg-red-700"
                title="Vider la Base"
                desc={isClearing ? 'Suppression...' : 'IRRÉVERSIBLE'}
                size="small"
              />
            </div>
          )}
        </section>
      )}

      {/* ── Debug panel ── */}
      {showDebugInfo && debugInfo && isAdmin && (
        <div className="
          bg-card border border-border/50 rounded-xl p-4
          shadow-[0_1px_3px_rgba(0,0,0,0.06),0_2px_8px_rgba(0,0,0,0.04)]
        ">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Bug className="h-3.5 w-3.5" />
              Analyse de Debug
            </h2>
            <button
              onClick={() => setShowDebugInfo(false)}
              className="text-muted-foreground hover:text-foreground text-lg leading-none"
            >
              ×
            </button>
          </div>
          <div className="space-y-1.5 text-sm text-muted-foreground">
            <div>Produits serveur: <span className="font-mono text-foreground">{debugInfo.supabase.totalCount}</span></div>
            <div>Produits invalides: <span className="font-mono text-foreground">{debugInfo.supabase.invalidProducts.length}</span></div>
            <div>Dupliqués: <span className="font-mono text-foreground">{debugInfo.supabase.duplicateBarcodes.length}</span></div>
            <div className="text-xs mt-1 text-muted-foreground/60">
              Analyse: {new Date(debugInfo.timestamp).toLocaleString('fr-FR')}
            </div>
          </div>
        </div>
      )}

      {showUploadModal && (
        <ExcelUploadModal onClose={() => setShowUploadModal(false)} onSuccess={handleUploadSuccess} />
      )}
    </div>
  );
}
