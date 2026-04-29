import React, { useState, useEffect } from 'react';
import {
  Search, RefreshCw, Package, Upload, Bug, Trash2, BarChart3, FileText,
  ShoppingCart, Users, Settings, FolderOpen, ChevronDown, ChevronUp,
  Receipt, Calculator, Truck, Database, Activity, ArrowRight,
  RotateCcw, FileX, ClipboardList, Images, Wifi, WifiOff, Boxes, ChevronRight,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { ExcelUploadModal } from '../components/ExcelUploadModal';
import { ProductUploadService } from '../utils/productUploadService';
import { StorageManager } from '../utils/storage';
import { supabase } from '../utils/supabaseClient';

interface ActivityLog {
  id: string; username: string; action: string; details: string | null;
  entity_type: string | null; entity_id: string | null; created_at: string;
}

/* ─── Circle Nav ─────────────────────────────────────────────────────────────*/
interface NavItem { to: string; icon: React.ElementType; label: string; sub?: string; accent: string; }

function CircleNav({ items }: { items: NavItem[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const navigate = useNavigate();

  const n = items.length;
  const W = 380;
  const cx = W / 2;  // 190
  const cy = W / 2;  // 190
  const r1 = 76;     // inner radius (donut hole edge)
  const r2 = 172;    // outer radius
  const rm = (r1 + r2) / 2;  // 124 — mid-ring, icon anchor
  const gap = 3.5;   // degrees gap between segments
  const span = 360 / n - gap;

  const toRad = (d: number) => d * Math.PI / 180;

  /* annular sector path centred at cDeg (0 = top, clockwise) */
  const segPath = (cDeg: number) => {
    const s = toRad(cDeg - span / 2);
    const e = toRad(cDeg + span / 2);
    const la = span > 180 ? 1 : 0;
    const x1 = cx + r2 * Math.sin(s), y1 = cy - r2 * Math.cos(s);
    const x2 = cx + r2 * Math.sin(e), y2 = cy - r2 * Math.cos(e);
    const x3 = cx + r1 * Math.sin(e), y3 = cy - r1 * Math.cos(e);
    const x4 = cx + r1 * Math.sin(s), y4 = cy - r1 * Math.cos(s);
    return `M ${x1} ${y1} A ${r2} ${r2} 0 ${la} 1 ${x2} ${y2} L ${x3} ${y3} A ${r1} ${r1} 0 ${la} 0 ${x4} ${y4} Z`;
  };

  return (
    <>
      {/* Desktop: donut ring */}
      <div className="hidden md:flex justify-center">
        <div className="relative" style={{ width: W, height: W }}>

          {/* SVG ring — segments */}
          <svg
            width={W} height={W}
            className="absolute inset-0"
            style={{ filter: 'drop-shadow(0 4px 20px rgba(0,0,0,0.10))' }}
          >
            {items.map((item, i) => {
              const cDeg = i * (360 / n);
              const isHov = hovered === i;
              return (
                <path
                  key={i}
                  d={segPath(cDeg)}
                  fill={isHov ? 'hsl(var(--primary))' : 'hsl(var(--card))'}
                  stroke="hsl(var(--background))"
                  strokeWidth={5}
                  style={{ cursor: 'pointer', transition: 'fill 0.15s ease' }}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => navigate(item.to)}
                />
              );
            })}
          </svg>

          {/* Center — Search */}
          <Link
            to="/search"
            className="absolute z-20 flex flex-col items-center justify-center gap-1.5 rounded-full
              bg-gradient-to-br from-primary to-primary/80 text-white
              shadow-[0_4px_24px_rgba(52,121,240,0.40)] hover:scale-105 transition-transform duration-200"
            style={{ width: r1 * 2 - 8, height: r1 * 2 - 8, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
          >
            <Search className="h-5 w-5" />
            <span className="text-[10px] font-semibold tracking-wide">Rechercher</span>
          </Link>

          {/* Icon + label — synced with SVG hover */}
          {items.map((item, i) => {
            const rad = toRad(i * (360 / n));
            const ix = cx + rm * Math.sin(rad);
            const iy = cy - rm * Math.cos(rad);
            const Icon = item.icon;
            const isHov = hovered === i;
            return (
              <Link
                key={item.to}
                to={item.to}
                className="absolute z-10 flex flex-col items-center gap-1 pointer-events-auto"
                style={{ left: ix, top: iy, transform: 'translate(-50%, -50%)', width: 70 }}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              >
                <Icon
                  className="shrink-0 transition-colors duration-150"
                  style={{ width: 22, height: 22, color: isHov ? 'white' : 'hsl(var(--primary))' }}
                />
                <span
                  className="text-[10px] font-semibold text-center leading-tight transition-colors duration-150"
                  style={{ color: isHov ? 'white' : 'hsl(var(--foreground))' }}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Mobile: 2-col grid */}
      <div className="grid grid-cols-2 gap-2.5 md:hidden">
        <Link to="/search"
          className="col-span-2 flex items-center gap-3 p-4 rounded-xl bg-gradient-to-r from-primary to-primary/80
            text-white shadow-lg hover:shadow-primary/30 hover:-translate-y-0.5 transition-all duration-200">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
            <Search className="h-5 w-5" />
          </div>
          <div>
            <div className="font-semibold text-sm">Rechercher</div>
            <div className="text-[11px] text-white/70">Nom, marque ou barcode</div>
          </div>
          <ArrowRight className="h-4 w-4 ml-auto opacity-70" />
        </Link>
        {items.map(item => {
          const Icon = item.icon;
          return (
            <Link key={item.to} to={item.to}
              className="flex items-center gap-2.5 p-3 rounded-xl bg-card border border-border/50
                shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
              <div className={`w-9 h-9 rounded-xl ${item.accent} flex items-center justify-center shrink-0`}>
                <Icon className="h-4 w-4 text-white" />
              </div>
              <div>
                <div className="text-xs font-semibold text-foreground">{item.label}</div>
                {item.sub && <div className="text-[10px] text-muted-foreground">{item.sub}</div>}
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}

/* ─── Pipeline Doc Card ──────────────────────────────────────────────────────*/
interface PipelineItem { to: string; icon: React.ElementType; label: string; sub: string; gradient: string; }

function DocumentPipeline({ items }: { items: PipelineItem[] }) {
  return (
    <div className="relative">
      {/* Desktop horizontal pipeline */}
      <div className="hidden sm:flex items-stretch gap-0 rounded-2xl overflow-hidden border border-border/50 shadow-sm">
        {items.map((item, i) => {
          const Icon = item.icon;
          const isLast = i === items.length - 1;
          return (
            <React.Fragment key={item.to}>
              <Link to={item.to}
                className="flex-1 flex flex-col items-center gap-2 py-4 px-2 bg-card hover:bg-accent/60
                  transition-colors group relative overflow-hidden">
                {/* Subtle gradient top bar */}
                <div className={`absolute top-0 left-0 right-0 h-0.5 ${item.gradient}`} />
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${item.gradient} flex items-center justify-center
                  shadow-sm group-hover:scale-110 transition-transform duration-200`}>
                  <Icon className="h-4.5 w-4.5 text-white h-[18px] w-[18px]" />
                </div>
                <div className="text-center">
                  <div className="text-xs font-semibold text-foreground">{item.label}</div>
                  <div className="text-[10px] text-muted-foreground">{item.sub}</div>
                </div>
              </Link>
              {!isLast && (
                <div className="flex items-center self-stretch px-0 shrink-0 bg-card">
                  <ChevronRight className="h-3.5 w-3.5 text-border" />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Mobile: 2-col grid */}
      <div className="grid grid-cols-2 gap-2 sm:hidden">
        {items.map(item => {
          const Icon = item.icon;
          return (
            <Link key={item.to} to={item.to}
              className="flex items-center gap-2.5 p-3 rounded-xl bg-card border border-border/50 shadow-sm
                hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden relative">
              <div className={`absolute top-0 left-0 bottom-0 w-1 bg-gradient-to-b ${item.gradient}`} />
              <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${item.gradient} flex items-center justify-center shrink-0 ml-1`}>
                <Icon className="h-4 w-4 text-white" />
              </div>
              <div>
                <div className="text-xs font-semibold text-foreground">{item.label}</div>
                <div className="text-[10px] text-muted-foreground">{item.sub}</div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Stat Card ──────────────────────────────────────────────────────────────*/
function StatCard({ label, value, sub, icon: Icon, accent }: {
  label: string; value: string; sub?: string; icon: React.ElementType; accent: string;
}) {
  return (
    <div className="bg-card border border-border/50 rounded-xl p-3.5 flex items-center gap-3
      shadow-[0_1px_3px_rgba(0,0,0,0.06),0_2px_8px_rgba(0,0,0,0.04)]
      dark:shadow-[0_1px_3px_rgba(0,0,0,0.3),0_2px_8px_rgba(0,0,0,0.2)]">
      <div className={`w-10 h-10 rounded-xl ${accent} flex items-center justify-center shrink-0`}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <div className="min-w-0">
        <div className="text-lg font-bold text-foreground tracking-tight leading-none finance-amount">{value}</div>
        <div className="text-[11px] font-medium text-muted-foreground mt-0.5">{label}</div>
        {sub && <div className="text-[10px] text-muted-foreground/60">{sub}</div>}
      </div>
    </div>
  );
}

/* ─── Section Label ──────────────────────────────────────────────────────────*/
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.08em] shrink-0">{children}</h2>
      <div className="flex-1 h-px bg-border/50" />
    </div>
  );
}

/* ─── Small Admin Card ───────────────────────────────────────────────────────*/
function AdminCard({ to, onClick, icon: Icon, label, sub, accent, disabled = false }: {
  to?: string; onClick?: () => void; icon: React.ElementType; label: string; sub: string; accent: string; disabled?: boolean;
}) {
  const cls = `flex flex-col items-center gap-2 p-3 rounded-xl bg-card border border-border/50 text-center
    shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer
    ${disabled ? 'opacity-40 pointer-events-none' : ''}`;
  const content = (
    <>
      <div className={`w-9 h-9 rounded-xl ${accent} flex items-center justify-center`}>
        <Icon className="h-4 w-4 text-white" />
      </div>
      <div>
        <div className="text-xs font-semibold text-foreground">{label}</div>
        <div className="text-[10px] text-muted-foreground">{sub}</div>
      </div>
    </>
  );
  if (to) return <Link to={to} className={cls}>{content}</Link>;
  return <button onClick={onClick} disabled={disabled} className={cls}>{content}</button>;
}

/* ─── Main ───────────────────────────────────────────────────────────────────*/
export function Home() {
  const { isAdmin, isSuperAdmin, isCompta, isFacturation, canAccessStockLocation, authVersion, canCreateQuote } = useAuth();
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
      showToast({ type: hasUpdates ? 'success' : 'info', title: hasUpdates ? 'Synchronisation réussie' : 'Déjà à jour', message: hasUpdates ? 'Base de données mise à jour !' : 'Aucune nouvelle donnée.' });
    } catch (error) {
      showToast({ type: 'error', title: 'Erreur', message: error instanceof Error ? error.message : 'Échec' });
    } finally { setIsSyncing(false); }
  };

  const handleClearDatabase = async () => {
    if (!isAdmin) return;
    if (!window.confirm('Supprimer TOUS les produits ? Cette action est IRRÉVERSIBLE !')) return;
    if (prompt('Tapez exactement: CONFIRMER') !== 'CONFIRMER') { showToast({ type: 'warning', title: 'Annulé', message: 'Confirmation incorrecte' }); return; }
    setIsClearing(true);
    try {
      await ProductUploadService.resetDatabase();
      StorageManager.clearAllData();
      showToast({ type: 'success', title: 'Suppression terminée', message: 'La page va se recharger...' });
      setTimeout(() => window.location.reload(), 2000);
    } catch (error) {
      showToast({ type: 'error', title: 'Erreur', message: `${error instanceof Error ? error.message : 'Erreur'}` });
    } finally { setIsClearing(false); }
  };

  const handleUploadSuccess = () => { showToast({ type: 'success', title: 'Upload réussi', message: 'Produits téléchargés !' }); window.location.reload(); };

  const handleDebugAnalysis = async () => {
    if (!isAdmin) return;
    try { setShowDebugInfo(true); const s = await ProductUploadService.analyzeProducts(); setDebugInfo({ supabase: s, timestamp: new Date().toISOString() }); }
    catch { showToast({ type: 'error', title: 'Erreur', message: 'Analyse échouée' }); }
  };

  const handleToggleActivity = async () => {
    if (!showActivitySection) {
      setActivityLoading(true);
      try { const { data, error } = await (supabase.rpc as any)('get_recent_activity_logs', { p_limit: 30 }); if (!error) setActivityLogs(data || []); }
      catch {} finally { setActivityLoading(false); }
    }
    setShowActivitySection(prev => !prev);
  };

  const formatNumber = (n: number) => new Intl.NumberFormat('fr-FR').format(n);

  const totalStock = state.products.reduce((sum, p) => {
    return sum + Object.entries(p.stock_levels || {})
      .filter(([loc]) => canAccessStockLocation(loc))
      .reduce((s, [, v]) => s + v, 0);
  }, 0);

  const allLocations = new Set<string>();
  state.products.forEach(p => Object.keys(p.stock_levels || {}).forEach(loc => { if (canAccessStockLocation(loc)) allLocations.add(loc); }));

  /* ── Empty state ── */
  if (state.products.length === 0) {
    return (
      <div className="max-w-sm mx-auto pt-8">
        <div className="bg-card border border-border/50 rounded-2xl p-8 text-center shadow-[0_4px_24px_rgba(0,0,0,0.08)]">
          <div className="flex justify-center mb-5">
            <div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center">
              <Package className="h-8 w-8 text-muted-foreground/50" />
            </div>
          </div>
          <h2 className="text-base font-semibold text-foreground mb-1.5">Aucun produit</h2>
          <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
            {state.isOnline ? 'Synchronisez ou importez des produits.' : 'Connectez-vous à Internet pour synchroniser.'}
          </p>
          {state.isOnline && isAdmin && (
            <div className="flex flex-col gap-2">
              <button onClick={handleSync} disabled={isSyncing}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? 'Synchronisation...' : 'Synchroniser'}
              </button>
              <button onClick={() => setShowUploadModal(true)}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-secondary text-secondary-foreground rounded-xl text-sm font-medium hover:bg-secondary/80 transition-colors border border-border/50">
                <Upload className="h-4 w-4" /> Importer Excel
              </button>
            </div>
          )}
        </div>
        {showUploadModal && <ExcelUploadModal onClose={() => setShowUploadModal(false)} onSuccess={handleUploadSuccess} />}
      </div>
    );
  }

  /* ── Data ── */
  const navItems: NavItem[] = [
    { to: '/products',  icon: FolderOpen,   label: 'Catalogue',       sub: 'Parcourir',       accent: 'bg-indigo-500' },
    { to: '/clients',   icon: Users,         label: 'Clients',         sub: 'Gestion',         accent: 'bg-sky-500' },
    { to: '/sheets',    icon: FileText,      label: 'Fiches',          sub: 'Documents',       accent: 'bg-teal-500' },
    { to: '/photos',    icon: Images,        label: 'Galerie',         sub: 'Photos',          accent: 'bg-pink-500' },
    ...(canCreateQuote() ? [
      { to: '/quote-cart',     icon: ShoppingCart, label: 'Nouveau Devis', sub: 'Créer',      accent: 'bg-violet-500' },
      { to: '/quotes-history', icon: FileText,     label: 'Devis',         sub: 'Historique', accent: 'bg-emerald-500' },
    ] : []),
  ];

  const pipelineItems: PipelineItem[] = [
    { to: '/compta/bons-commande', icon: ClipboardList, label: 'BC',       sub: 'Commande',  gradient: 'from-blue-500 to-blue-600' },
    { to: '/compta/bls',           icon: Truck,         label: 'BL',       sub: 'Livraison', gradient: 'from-teal-500 to-teal-600' },
    { to: '/compta/proformas',     icon: FileText,      label: 'Proforma', sub: 'Devis pro', gradient: 'from-emerald-500 to-emerald-600' },
    { to: '/compta/invoices',      icon: Receipt,       label: 'Facture',  sub: 'Facturer',  gradient: 'from-indigo-500 to-indigo-600' },
    { to: '/compta/avoirs',        icon: FileX,         label: 'Avoir',    sub: 'Crédit',    gradient: 'from-rose-500 to-rose-600' },
    { to: '/compta/returns',       icon: RotateCcw,     label: 'Retour',   sub: 'Gestion',   gradient: 'from-amber-500 to-amber-600' },
    { to: '/compta/clients',       icon: Calculator,    label: 'Clients',  sub: 'Financier', gradient: 'from-violet-500 to-violet-600' },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-6">

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <StatCard icon={Boxes}       accent="bg-primary"      label="Produits"     value={formatNumber(state.products.length)} sub="références actives" />
        <StatCard icon={Package}     accent="bg-emerald-500"  label="Stock Total"  value={formatNumber(totalStock)}            sub="toutes zones" />
        <StatCard icon={BarChart3}   accent="bg-indigo-500"   label="Emplacements" value={allLocations.size.toString()}        sub="zones actives" />
        <StatCard icon={syncInfo.isOnline ? Wifi : WifiOff}
                  accent={syncInfo.isOnline ? 'bg-teal-500' : 'bg-muted-foreground'}
                  label="Connexion"
                  value={syncInfo.isOnline ? 'En ligne' : 'Hors ligne'}
                  sub={syncInfo.isOnline ? 'Base synchronisée' : 'Mode local'} />
      </div>

      {/* ── Navigation Hub ── */}
      <section>
        <SectionLabel>Navigation</SectionLabel>
        <CircleNav items={navItems} />
      </section>

      {/* ── Documents Pipeline ── */}
      {(isFacturation || isCompta || isSuperAdmin) && (
        <section>
          <SectionLabel>Documents</SectionLabel>
          <DocumentPipeline items={pipelineItems} />
        </section>
      )}

      {/* ── Administration ── */}
      {isSuperAdmin && (
        <section>
          <SectionLabel>Administration</SectionLabel>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            <AdminCard onClick={handleSync} disabled={isSyncing || !state.isOnline} icon={RefreshCw} accent="bg-orange-500" label="Synchroniser" sub={isSyncing ? 'En cours...' : 'Serveur'} />
            <AdminCard onClick={() => setShowUploadModal(true)} icon={Upload}   accent="bg-violet-500" label="Import Excel"  sub="Télécharger" />
            <AdminCard to="/admin/statistics" icon={BarChart3}  accent="bg-primary"      label="Statistiques" sub="Données" />
            <AdminCard to="/admin/settings"   icon={Settings}   accent="bg-slate-500"    label="Paramètres"   sub="Config" />
            <AdminCard to="/admin/backup"     icon={Database}   accent="bg-rose-700"     label="Sauvegarde"   sub="Backup" />
          </div>
        </section>
      )}

      {/* ── Activity log ── */}
      {isSuperAdmin && (
        <section>
          <button onClick={handleToggleActivity} className="flex items-center gap-1.5 mb-3 group w-full">
            <Activity className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors" />
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.08em] group-hover:text-foreground transition-colors">
              Activité Récente
            </span>
            <div className="flex-1 h-px bg-border/50 ml-1" />
            {showActivitySection ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
          </button>
          {showActivitySection && (
            <div className="bg-card border border-border/50 rounded-xl overflow-hidden shadow-sm">
              {activityLoading ? (
                <div className="p-6 text-center text-xs text-muted-foreground">Chargement...</div>
              ) : activityLogs.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">Aucune activité enregistrée.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-secondary/60">
                      <tr>
                        {['Utilisateur', 'Action', 'Détails', 'Date'].map(h => (
                          <th key={h} className="text-left px-4 py-2.5 font-semibold text-muted-foreground text-[10px] uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {activityLogs.map(log => (
                        <tr key={log.id} className="hover:bg-secondary/30 transition-colors">
                          <td className="px-4 py-2.5 font-medium text-foreground">{log.username}</td>
                          <td className="px-4 py-2.5 text-foreground">{log.action}</td>
                          <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell max-w-[200px] truncate">{log.details || '—'}</td>
                          <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
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
        </section>
      )}

      {/* ── Danger zone ── */}
      {isSuperAdmin && (
        <section>
          <button onClick={() => setShowTechnicalSection(!showTechnicalSection)} className="flex items-center gap-1.5 mb-3 group w-full">
            {showTechnicalSection ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.08em] group-hover:text-foreground transition-colors">Technique & Debug</span>
            <div className="flex-1 h-px bg-border/50 ml-1" />
          </button>
          {showTechnicalSection && (
            <div className="grid grid-cols-2 gap-2">
              <AdminCard onClick={handleDebugAnalysis} icon={Bug}   accent="bg-rose-600" label="Debug"          sub="Analyser la base" />
              <AdminCard onClick={handleClearDatabase} disabled={isClearing} icon={Trash2} accent="bg-red-700" label="Vider la Base"    sub={isClearing ? 'Suppression...' : 'IRRÉVERSIBLE'} />
            </div>
          )}
        </section>
      )}

      {/* ── Debug panel ── */}
      {showDebugInfo && debugInfo && isAdmin && (
        <div className="bg-card border border-border/50 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2"><Bug className="h-3.5 w-3.5" /> Analyse de Debug</h2>
            <button onClick={() => setShowDebugInfo(false)} className="text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
          </div>
          <div className="space-y-1.5 text-sm text-muted-foreground">
            <div>Produits serveur: <span className="font-mono text-foreground">{debugInfo.supabase.totalCount}</span></div>
            <div>Invalides: <span className="font-mono text-foreground">{debugInfo.supabase.invalidProducts.length}</span></div>
            <div>Dupliqués: <span className="font-mono text-foreground">{debugInfo.supabase.duplicateBarcodes.length}</span></div>
            <div className="text-xs mt-1 text-muted-foreground/60">Analyse: {new Date(debugInfo.timestamp).toLocaleString('fr-FR')}</div>
          </div>
        </div>
      )}

      {showUploadModal && <ExcelUploadModal onClose={() => setShowUploadModal(false)} onSuccess={handleUploadSuccess} />}
    </div>
  );
}
