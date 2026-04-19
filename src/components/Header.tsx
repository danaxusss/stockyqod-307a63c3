import React, { useState, useRef, useEffect } from 'react';
import {
  Package, RefreshCw, LogOut, Shield, FileText, User, Cloud, CloudOff,
  Settings, UserCheck, ShoppingBag, BookOpen, Building2, ChevronDown,
  Truck, Receipt, Calculator, BarChart3, Users, ShoppingCart, LucideIcon,
} from 'lucide-react';
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
        className={`flex items-center gap-0.5 p-1.5 rounded-lg transition-all duration-200 ${
          isActive
            ? 'bg-primary/20 text-primary'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
        }`}
        title={label}
      >
        <Icon className="h-3.5 w-3.5" />
        <ChevronDown className={`h-2.5 w-2.5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          className="absolute top-full right-0 mt-1.5 bg-card border border-border rounded-xl shadow-xl py-1 min-w-[190px] z-50"
          onClick={e => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 border-b border-border mb-1">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
          </div>
          {items.map(({ to, icon: ItemIcon, label: itemLabel }) => (
            <Link
              key={to}
              to={to}
              onClick={() => onToggle(id)}
              className={`flex items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-accent ${
                location.pathname === to || location.pathname.startsWith(to + '/')
                  ? 'text-primary font-medium bg-primary/5'
                  : 'text-foreground'
              }`}
            >
              <ItemIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {itemLabel}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function Header() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<DropdownId | null>(null);
  const navRef = useRef<HTMLDivElement>(null);

  const { isAdmin, isSuperAdmin, isCompta, companyName, currentUser, canCreateQuote, logout: adminLogout } = useAuth();
  const { isAuthenticated: isUserAuthenticated, authenticatedUser, logout: userLogout } = useUserAuth();
  const { syncInfo, syncData, openLoginModal } = useAppContext();
  const { showToast } = useToast();

  // Close dropdown on outside click
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

  return (
    <header className="bg-card/80 backdrop-blur-xl border-b border-border/50 sticky top-0 z-40">
      <div className="container mx-auto px-3 py-2">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-2 hover:opacity-80 transition-opacity">
            <div className="p-1.5 bg-primary rounded-lg shadow" style={{ boxShadow: 'var(--shadow-glow)' }}>
              <Package className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <div className="flex items-baseline space-x-1.5">
                <h1 className="text-base font-bold text-foreground">Stocky</h1>
                <span className="text-[9px] text-muted-foreground font-medium">By QodWeb</span>
              </div>
              <div className="flex items-center space-x-1 mt-0">
                {syncInfo.isOnline ? (
                  <Cloud className="h-2.5 w-2.5 text-primary" />
                ) : (
                  <CloudOff className="h-2.5 w-2.5 text-destructive" />
                )}
                <span className="text-[9px] text-muted-foreground">
                  {isSyncing ? 'Sync...' : syncInfo.isOnline ? 'En ligne' : 'Hors ligne'}
                </span>
                {syncInfo.pendingChanges > 0 && (
                  <span className="text-[9px] px-1 py-0 bg-destructive/20 text-destructive rounded-full font-medium">
                    {syncInfo.pendingChanges}
                  </span>
                )}
              </div>
            </div>
          </Link>

          {/* Company Badge */}
          {companyName && (
            <span className="hidden sm:inline-flex items-center px-2 py-0.5 text-[10px] font-medium bg-primary/10 text-primary border border-primary/20 rounded-full max-w-[120px] truncate">
              {isSuperAdmin ? '★ ' : ''}{companyName}
            </span>
          )}

          {/* Nav */}
          <div ref={navRef} className="flex items-center space-x-1.5">
            {/* Sync */}
            {syncInfo.isOnline && (
              <button
                onClick={handleSync}
                disabled={isSyncing}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-all duration-200 disabled:opacity-50"
                title="Rafraîchir les données"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              </button>
            )}

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

            {/* Devis / Commercial */}
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
                ]}
              />
            )}

            {/* Admin */}
            {isSuperAdmin && (
              <NavDropdown
                id="admin"
                icon={Settings}
                label="Administration"
                openId={openDropdown}
                onToggle={toggleDropdown}
                items={[
                  { to: '/admin/settings', icon: Settings, label: 'Paramètres' },
                  { to: '/admin/statistics', icon: BarChart3, label: 'Statistiques' },
                  { to: '/companies', icon: Building2, label: 'Sociétés' },
                  { to: '/admin/users', icon: Users, label: 'Utilisateurs' },
                ]}
              />
            )}

            {/* User badge */}
            {isAdmin && (
              <div className="p-1.5 bg-primary rounded-lg text-primary-foreground shadow-sm" title={displayName ? `Admin: ${displayName}` : 'Administrateur'}>
                <Shield className="h-3.5 w-3.5" />
              </div>
            )}
            {!isAdmin && isUserAuthenticated && displayName && (
              <div className="p-1.5 bg-secondary rounded-lg text-secondary-foreground" title={`Utilisateur: ${displayName}`}>
                <User className="h-3.5 w-3.5" />
              </div>
            )}

            {/* Logout */}
            {showLogoutButton && (
              <button
                onClick={handleLogout}
                className="p-1.5 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded-lg transition-all duration-200"
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
