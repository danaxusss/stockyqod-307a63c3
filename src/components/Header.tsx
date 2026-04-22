import React, { useState, useRef, useEffect } from 'react';
import {
  Package, RefreshCw, LogOut, Shield, FileText, User, Cloud, CloudOff,
  Settings, UserCheck, ShoppingBag, BookOpen, Building2, ChevronDown,
  Truck, Receipt, Calculator, BarChart3, Users, ShoppingCart, LucideIcon,
  RotateCcw, Sun, Moon, Upload, FileX,
} from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useUserAuth } from '../hooks/useUserAuth';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../context/ToastContext';

type DropdownId = 'catalogue' | 'devis' | 'compta' | 'admin';
interface NavItem { to: string; icon: LucideIcon; label: string; }

function NavDropdown({
  id, icon: Icon, label, items, openId, onToggle,
}: {
  id: DropdownId; icon: LucideIcon; label: string; items: NavItem[];
  openId: DropdownId | null; onToggle: (id: DropdownId) => void;
}) {
  const location = useLocation();
  const isOpen = openId === id;
  const isActive = items.some(i =>
    location.pathname === i.to || location.pathname.startsWith(i.to + '/')
  );

  return (
    <div className="relative">
      <button
        onClick={e => { e.stopPropagation(); onToggle(id); }}
        className={`
          group flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium
          transition-all duration-150
          ${isActive
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'
          }
        `}
        title={label}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="hidden sm:inline">{label}</span>
        <ChevronDown
          className={`h-2.5 w-2.5 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div
          className="
            absolute top-full right-0 mt-2 z-50
            min-w-[200px] py-1
            bg-card border border-border/60
            rounded-xl overflow-hidden
            shadow-[0_8px_30px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.07)]
            dark:shadow-[0_8px_30px_rgba(0,0,0,0.5),0_2px_8px_rgba(0,0,0,0.35)]
            animate-in fade-in-0 zoom-in-95 duration-150
          "
          onClick={e => e.stopPropagation()}
        >
          {/* Section header */}
          <div className="px-3 pt-2 pb-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
              {label}
            </p>
          </div>

          <div className="h-px bg-border/50 mx-2 mb-1" />

          {items.map(({ to, icon: ItemIcon, label: itemLabel }) => {
            const active = location.pathname === to || location.pathname.startsWith(to + '/');
            return (
              <Link
                key={to}
                to={to}
                onClick={() => onToggle(id)}
                className={`
                  flex items-center gap-2.5 mx-1 px-2.5 py-2 rounded-lg text-sm
                  transition-colors duration-100
                  ${active
                    ? 'bg-primary/8 text-primary font-medium'
                    : 'text-foreground hover:bg-secondary'
                  }
                `}
              >
                <div className={`
                  flex items-center justify-center w-6 h-6 rounded-md
                  ${active ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground'}
                `}>
                  <ItemIcon className="h-3 w-3" />
                </div>
                {itemLabel}
              </Link>
            );
          })}

          <div className="h-1" />
        </div>
      )}
    </div>
  );
}

export function Header() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<DropdownId | null>(null);
  const navRef = useRef<HTMLDivElement>(null);

  const { theme, toggle: toggleTheme } = useTheme();
  const { isAdmin, isSuperAdmin, isCompta, companyName, currentUser, canCreateQuote, logout: adminLogout } = useAuth();
  const { isAuthenticated: isUserAuthenticated, authenticatedUser, logout: userLogout } = useUserAuth();
  const { syncInfo, syncData, openLoginModal } = useAppContext();
  const { showToast } = useToast();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggleDropdown = (id: DropdownId) =>
    setOpenDropdown(prev => (prev === id ? null : id));

  const handleSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const hasUpdates = await syncData(true);
      showToast({
        type: 'success',
        title: hasUpdates ? 'Synchronisation réussie' : 'Déjà à jour',
        message: hasUpdates ? 'Base de données mise à jour !' : 'La base de données est déjà à jour.',
      });
    } catch (error) {
      showToast({ type: 'error', title: 'Erreur de synchronisation', message: error instanceof Error ? error.message : 'Échec' });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleLogout = () => { adminLogout(); userLogout(); };

  const displayName = currentUser?.username || authenticatedUser?.username || null;
  const showLogoutButton = isAdmin || isUserAuthenticated;
  const isOnline = syncInfo.isOnline;

  return (
    <header className="
      sticky top-0 z-40
      bg-card/90 backdrop-blur-2xl
      border-b border-border/40
      shadow-[0_1px_0_rgba(0,0,0,0.05),0_2px_12px_rgba(0,0,0,0.04)]
      dark:shadow-[0_1px_0_rgba(255,255,255,0.04),0_2px_12px_rgba(0,0,0,0.35)]
    ">
      <div className="container mx-auto px-3">
        <div className="flex items-center justify-between h-12">

          {/* ── Logo ── */}
          <Link
            to="/"
            className="flex items-center gap-2.5 hover:opacity-80 transition-opacity duration-150 shrink-0"
          >
            {/* Status dot + icon */}
            <div className="relative">
              <div className="
                w-7 h-7 rounded-lg flex items-center justify-center
                bg-gradient-to-br from-primary to-primary/70
                shadow-[0_2px_8px_rgba(52,121,240,0.35)]
              ">
                <Package className="h-3.5 w-3.5 text-white" />
              </div>
              {/* Online/offline indicator */}
              <div className={`
                absolute -bottom-0.5 -right-0.5
                w-2 h-2 rounded-full border-[1.5px] border-card
                ${isOnline ? 'bg-emerald-500' : 'bg-red-500'}
              `} />
            </div>

            {/* Wordmark */}
            <div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-sm font-bold tracking-tight text-foreground leading-none">Stocky</span>
                <span className="text-[9px] font-medium text-muted-foreground/60 leading-none">by QodWeb</span>
              </div>
              {syncInfo.pendingChanges > 0 && (
                <span className="text-[9px] px-1 bg-amber-500/15 text-amber-600 dark:text-amber-400 rounded font-medium">
                  {syncInfo.pendingChanges} en attente
                </span>
              )}
            </div>
          </Link>

          {/* ── Company badge ── */}
          {companyName && (
            <div className="
              hidden md:flex items-center gap-1.5
              px-2.5 py-1 rounded-full
              bg-primary/8 dark:bg-primary/10
              border border-primary/15
            ">
              {isSuperAdmin && (
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              )}
              <span className="text-[11px] font-semibold text-primary max-w-[140px] truncate">
                {companyName}
              </span>
            </div>
          )}

          {/* ── Navigation + Controls ── */}
          <div ref={navRef} className="flex items-center gap-0.5">

            {/* Sync button */}
            {isOnline && (
              <button
                onClick={handleSync}
                disabled={isSyncing}
                className="
                  p-1.5 rounded-lg text-muted-foreground
                  hover:text-foreground hover:bg-secondary
                  transition-all duration-150 disabled:opacity-40
                "
                title="Rafraîchir les données"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              </button>
            )}

            {/* Divider */}
            <div className="w-px h-4 bg-border/60 mx-1" />

            {/* Catalogue */}
            <NavDropdown
              id="catalogue"
              icon={ShoppingBag}
              label="Catalogue"
              openId={openDropdown}
              onToggle={toggleDropdown}
              items={[
                { to: '/products', icon: ShoppingBag, label: 'Produits' },
                { to: '/clients', icon: UserCheck, label: 'Clients' },
                { to: '/sheets', icon: BookOpen, label: 'Fiches Techniques' },
              ]}
            />

            {/* Commercial */}
            {canCreateQuote() && (
              <NavDropdown
                id="devis"
                icon={FileText}
                label="Commercial"
                openId={openDropdown}
                onToggle={toggleDropdown}
                items={[
                  { to: '/quotes-history', icon: FileText, label: 'Historique Devis' },
                  { to: '/quote-cart', icon: ShoppingCart, label: 'Nouveau Devis' },
                ]}
              />
            )}

            {/* Comptabilité */}
            {(isCompta || isSuperAdmin) && (
              <NavDropdown
                id="compta"
                icon={Receipt}
                label="Comptabilité"
                openId={openDropdown}
                onToggle={toggleDropdown}
                items={[
                  { to: '/compta/bls', icon: Truck, label: 'Bons de Livraison' },
                  { to: '/compta/proformas', icon: FileText, label: 'Proformas' },
                  { to: '/compta/invoices', icon: Receipt, label: 'Factures' },
                  { to: '/compta/clients', icon: Calculator, label: 'Clients (financier)' },
                  { to: '/compta/returns', icon: RotateCcw, label: 'Retours' },
                  { to: '/compta/avoirs', icon: FileX, label: 'Avoirs' },
                ]}
              />
            )}

            {/* Admin */}
            {isSuperAdmin && (
              <NavDropdown
                id="admin"
                icon={Settings}
                label="Admin"
                openId={openDropdown}
                onToggle={toggleDropdown}
                items={[
                  { to: '/admin/settings', icon: Settings, label: 'Paramètres' },
                  { to: '/admin/statistics', icon: BarChart3, label: 'Statistiques' },
                  { to: '/companies', icon: Building2, label: 'Sociétés' },
                  { to: '/admin/users', icon: Users, label: 'Utilisateurs' },
                  { to: '/admin/import', icon: Upload, label: 'Import CSV' },
                ]}
              />
            )}

            {/* Divider */}
            <div className="w-px h-4 bg-border/60 mx-1" />

            {/* User indicator */}
            {isAdmin && (
              <div
                className="
                  flex items-center gap-1.5 px-2 py-1 rounded-lg
                  bg-primary/10 border border-primary/20
                "
                title={displayName ? `Admin: ${displayName}` : 'Administrateur'}
              >
                <Shield className="h-3 w-3 text-primary" />
                {displayName && (
                  <span className="hidden sm:inline text-[10px] font-semibold text-primary max-w-[70px] truncate">
                    {displayName}
                  </span>
                )}
              </div>
            )}
            {!isAdmin && isUserAuthenticated && displayName && (
              <div
                className="
                  flex items-center gap-1.5 px-2 py-1 rounded-lg
                  bg-secondary border border-border
                "
                title={`Utilisateur: ${displayName}`}
              >
                <User className="h-3 w-3 text-muted-foreground" />
                <span className="hidden sm:inline text-[10px] font-medium text-muted-foreground max-w-[70px] truncate">
                  {displayName}
                </span>
              </div>
            )}

            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="
                p-1.5 rounded-lg text-muted-foreground
                hover:text-foreground hover:bg-secondary
                transition-all duration-150
              "
              title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
            >
              {theme === 'dark'
                ? <Sun className="h-3.5 w-3.5" />
                : <Moon className="h-3.5 w-3.5" />
              }
            </button>

            {/* Logout */}
            {showLogoutButton && (
              <button
                onClick={handleLogout}
                className="
                  p-1.5 rounded-lg
                  text-muted-foreground hover:text-destructive
                  hover:bg-destructive/8
                  transition-all duration-150
                "
                title={displayName ? `Se déconnecter (${displayName})` : 'Se déconnecter'}
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
