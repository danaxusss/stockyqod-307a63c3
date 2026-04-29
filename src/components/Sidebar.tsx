import React, { useState } from 'react';
import {
  Package, RefreshCw, LogOut, Shield, FileText, User,
  Settings, UserCheck, ShoppingBag, BookOpen, Building2,
  ChevronLeft, ChevronRight, Truck, Receipt, Calculator,
  BarChart3, Users, ShoppingCart, LucideIcon, X,
  RotateCcw, Sun, Moon, Upload, FileX, BookMarked, Home, Images, ClipboardList,
} from 'lucide-react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { useAuth } from '../hooks/useAuth';
import { useUserAuth } from '../hooks/useUserAuth';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../context/ToastContext';

const SIDEBAR_KEY = 'stocky_sidebar_collapsed';

interface NavItem { to: string; icon: LucideIcon; label: string; }
interface NavSection { id: string; label: string; items: NavItem[]; }

function SidebarItem({ item, collapsed, onNavigate }: { item: NavItem; collapsed: boolean; onNavigate?: () => void }) {
  const location = useLocation();
  const isActive = location.pathname === item.to || location.pathname.startsWith(item.to + '/');
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      className={`
        flex items-center gap-2.5 px-2 py-1.5 rounded-lg transition-all duration-100
        ${isActive ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'}
        ${collapsed ? 'justify-center' : ''}
      `}
    >
      <item.icon className={`shrink-0 ${collapsed ? 'h-4 w-4' : 'h-3.5 w-3.5'}`} />
      {!collapsed && <span className="text-xs truncate">{item.label}</span>}
    </NavLink>
  );
}

function SidebarSection({ section, collapsed, onNavigate }: { section: NavSection; collapsed: boolean; onNavigate?: () => void }) {
  return (
    <div className="mb-0.5">
      {collapsed
        ? <div className="h-px bg-border/40 mx-1.5 my-1.5" />
        : <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/50 px-2 pt-2.5 pb-0.5">{section.label}</p>
      }
      <div className="space-y-0.5">
        {section.items.map(item => <SidebarItem key={item.to} item={item} collapsed={collapsed} onNavigate={onNavigate} />)}
      </div>
    </div>
  );
}

interface SidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps = {}) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === 'true'; } catch { return false; }
  });
  const [isSyncing, setIsSyncing] = useState(false);

  const { theme, toggle: toggleTheme } = useTheme();
  const { isAdmin, isSuperAdmin, isFacturation, companyName, currentUser, canCreateQuote, logout: adminLogout } = useAuth();
  const { isAuthenticated: isUserAuthenticated, authenticatedUser, logout: userLogout } = useUserAuth();
  const { syncInfo, syncData } = useAppContext();
  const { showToast } = useToast();

  const toggle = () => setCollapsed(c => {
    const next = !c;
    try { localStorage.setItem(SIDEBAR_KEY, String(next)); } catch {}
    return next;
  });

  const handleSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const hasUpdates = await syncData(true);
      showToast({ type: 'success', title: hasUpdates ? 'Synchronisation réussie' : 'Déjà à jour', message: hasUpdates ? 'Base de données mise à jour !' : 'La base de données est déjà à jour.' });
    } catch (error) {
      showToast({ type: 'error', title: 'Erreur de synchronisation', message: error instanceof Error ? error.message : 'Échec' });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleLogout = () => { adminLogout(); userLogout(); };

  const displayName = currentUser?.custom_seller_name?.trim() || currentUser?.username ||
    authenticatedUser?.custom_seller_name?.trim() || authenticatedUser?.username || null;
  const showLogoutButton = isAdmin || isUserAuthenticated;
  const isOnline = syncInfo.isOnline;

  // On mobile overlay: always show expanded; on desktop: respect collapsed state
  const showExpanded = mobileOpen || !collapsed;

  const sections: NavSection[] = [
    {
      id: 'catalogue',
      label: 'Catalogue',
      items: [
        { to: '/products', icon: ShoppingBag, label: 'Produits' },
        { to: '/clients', icon: UserCheck, label: 'Clients' },
        { to: '/sheets', icon: BookOpen, label: 'Fiches Techniques' },
        { to: '/photos', icon: Images, label: 'Galerie Photos' },
      ],
    },
    ...(canCreateQuote() ? [{
      id: 'commercial',
      label: 'Commercial',
      items: [
        { to: '/quote-cart', icon: ShoppingCart, label: 'Nouveau Devis' },
        { to: '/quotes-history', icon: FileText, label: 'Historique Devis' },
      ],
    }] : []),
    ...((isFacturation || isSuperAdmin) ? [{
      id: 'documents',
      label: 'Documents',
      items: [
        { to: '/compta/bons-commande', icon: ClipboardList, label: 'Bons de Commande' },
        { to: '/compta/bls', icon: Truck, label: 'Bons de Livraison' },
        { to: '/compta/proformas', icon: FileText, label: 'Proformas' },
        { to: '/compta/invoices', icon: Receipt, label: 'Factures' },
        { to: '/compta/avoirs', icon: FileX, label: 'Avoirs' },
        { to: '/compta/returns', icon: RotateCcw, label: 'Retours' },
        { to: '/compta/clients', icon: Calculator, label: 'Clients (financier)' },
      ],
    }] : []),
    ...(isSuperAdmin ? [{
      id: 'admin',
      label: 'Administration',
      items: [
        { to: '/admin/statistics', icon: BarChart3, label: 'Statistiques' },
        { to: '/admin/settings', icon: Settings, label: 'Paramètres' },
        { to: '/admin/users', icon: Users, label: 'Utilisateurs' },
        { to: '/companies', icon: Building2, label: 'Sociétés' },
        { to: '/admin/import', icon: Upload, label: 'Import CSV' },
      ],
    }] : []),
  ];

  return (
    <aside className={`
      flex flex-col h-full overflow-hidden
      bg-card border-r border-border/40
      fixed inset-y-0 left-0 z-50
      md:relative md:z-auto md:shrink-0
      w-64 md:w-auto
      transition-transform md:transition-[width] duration-200 ease-in-out
      ${mobileOpen
        ? 'translate-x-0 shadow-[4px_0_24px_rgba(0,0,0,0.12)]'
        : '-translate-x-full md:translate-x-0 md:shadow-[1px_0_0_rgba(0,0,0,0.04)] dark:md:shadow-[1px_0_0_rgba(255,255,255,0.03)]'}
      ${collapsed ? 'md:w-14' : 'md:w-52'}
    `}>
      {/* Logo + toggle */}
      <div className="flex items-center h-12 px-2 border-b border-border/40 shrink-0 gap-1">
        <Link
          to="/"
          onClick={onMobileClose}
          className={`flex items-center gap-2 flex-1 min-w-0 hover:opacity-80 transition-opacity ${!showExpanded ? 'justify-center' : ''}`}
        >
          <div className="relative shrink-0">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-gradient-to-br from-primary to-primary/70 shadow-[0_2px_8px_rgba(52,121,240,0.35)]">
              <Package className="h-3.5 w-3.5 text-white" />
            </div>
            <div className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border-[1.5px] border-card ${isOnline ? 'bg-emerald-500' : 'bg-red-500'}`} />
          </div>
          {showExpanded && (
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1">
                <span className="text-sm font-bold tracking-tight text-foreground leading-none">Stocky</span>
                <span className="text-[9px] font-medium text-muted-foreground/60 leading-none">by QodWeb</span>
              </div>
              {syncInfo.pendingChanges > 0 && (
                <span className="text-[9px] px-1 bg-amber-500/15 text-amber-600 dark:text-amber-400 rounded font-medium">
                  {syncInfo.pendingChanges} en attente
                </span>
              )}
            </div>
          )}
        </Link>
        {/* Desktop: collapse/expand toggle */}
        <button
          onClick={toggle}
          className="hidden md:flex p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-all shrink-0"
          title={collapsed ? 'Développer' : 'Réduire'}
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
        {/* Mobile: close button */}
        <button
          onClick={onMobileClose}
          className="md:hidden p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-all shrink-0"
          title="Fermer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Company badge */}
      {companyName && showExpanded && (
        <div className="px-2 py-2 border-b border-border/40 shrink-0">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-primary/8 border border-primary/15">
            {isSuperAdmin && <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />}
            <span className="text-[11px] font-semibold text-primary truncate">{companyName}</span>
          </div>
        </div>
      )}

      {/* Nav — scrollable; click bubbles up to close mobile sidebar */}
      <nav className="flex-1 overflow-y-auto py-1.5 px-1.5 space-y-0.5">
        {/* Home */}
        <NavLink
          to="/"
          end
          onClick={onMobileClose}
          title={!showExpanded ? 'Accueil' : undefined}
          className={({ isActive }) => `
            flex items-center gap-2.5 px-2 py-1.5 rounded-lg transition-all duration-100
            ${isActive ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'}
            ${!showExpanded ? 'justify-center' : ''}
          `}
        >
          <Home className={`shrink-0 ${!showExpanded ? 'h-4 w-4' : 'h-3.5 w-3.5'}`} />
          {showExpanded && <span className="text-xs">Accueil</span>}
        </NavLink>

        {sections.map(section => (
          <SidebarSection key={section.id} section={section} collapsed={!showExpanded} onNavigate={onMobileClose} />
        ))}

        {/* Comptabilité — coming soon */}
        {(isFacturation || isSuperAdmin) && (
          <>
            {!showExpanded && <div className="h-px bg-border/40 mx-1.5 my-1.5" />}
            <NavLink
              to="/comptabilite"
              onClick={onMobileClose}
              title={!showExpanded ? 'Comptabilité (Bientôt)' : undefined}
              className={({ isActive }) => `
                flex items-center gap-2.5 px-2 py-1.5 rounded-lg transition-all duration-100
                ${isActive ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'}
                ${!showExpanded ? 'justify-center' : ''}
              `}
            >
              <BookMarked className={`shrink-0 ${!showExpanded ? 'h-4 w-4' : 'h-3.5 w-3.5'}`} />
              {showExpanded && (
                <span className="flex items-center gap-1.5 text-xs">
                  Comptabilité
                  <span className="text-[8px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400 bg-amber-500/12 px-1 py-0.5 rounded">Bientôt</span>
                </span>
              )}
            </NavLink>
          </>
        )}
      </nav>

      {/* Bottom controls */}
      <div className="border-t border-border/40 p-1.5 shrink-0 space-y-0.5">
        {isAdmin && (
          <div
            className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-primary/10 border border-primary/20 ${!showExpanded ? 'justify-center' : ''}`}
            title={!showExpanded ? (displayName || 'Admin') : undefined}
          >
            <Shield className="h-3 w-3 text-primary shrink-0" />
            {showExpanded && <span className="text-[10px] font-semibold text-primary truncate">{displayName || 'Admin'}</span>}
          </div>
        )}
        {!isAdmin && isUserAuthenticated && displayName && (
          <div
            className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-secondary border border-border ${!showExpanded ? 'justify-center' : ''}`}
            title={!showExpanded ? displayName : undefined}
          >
            <User className="h-3 w-3 text-muted-foreground shrink-0" />
            {showExpanded && <span className="text-[10px] font-medium text-muted-foreground truncate">{displayName}</span>}
          </div>
        )}
        {isOnline && (
          <button
            onClick={handleSync}
            disabled={isSyncing}
            title="Rafraîchir les données"
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-all disabled:opacity-40 ${!showExpanded ? 'justify-center' : ''}`}
          >
            <RefreshCw className={`h-3.5 w-3.5 shrink-0 ${isSyncing ? 'animate-spin' : ''}`} />
            {showExpanded && <span className="text-xs">Synchroniser</span>}
          </button>
        )}
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-all ${!showExpanded ? 'justify-center' : ''}`}
        >
          {theme === 'dark' ? <Sun className="h-3.5 w-3.5 shrink-0" /> : <Moon className="h-3.5 w-3.5 shrink-0" />}
          {showExpanded && <span className="text-xs">{theme === 'dark' ? 'Mode clair' : 'Mode sombre'}</span>}
        </button>
        {showLogoutButton && (
          <button
            onClick={handleLogout}
            title={displayName ? `Se déconnecter (${displayName})` : 'Se déconnecter'}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/8 transition-all ${!showExpanded ? 'justify-center' : ''}`}
          >
            <LogOut className="h-3.5 w-3.5 shrink-0" />
            {showExpanded && <span className="text-xs">Se déconnecter</span>}
          </button>
        )}
      </div>
    </aside>
  );
}
