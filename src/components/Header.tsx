import React, { useState } from 'react';
import { Package, RefreshCw, LogOut, Shield, FileText, Users, User, Wifi, WifiOff, Cloud, CloudOff } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useUserAuth } from '../hooks/useUserAuth';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../context/ToastContext';

export function Header() {
  const [isSyncing, setIsSyncing] = useState(false);
  const { isAdmin, currentUser, canCreateQuote, logout: adminLogout } = useAuth();
  const { isAuthenticated: isUserAuthenticated, authenticatedUser, logout: userLogout } = useUserAuth();
  const { syncInfo, syncData, openLoginModal } = useAppContext();
  const { showToast } = useToast();
  const location = useLocation();

  const handleSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const hasUpdates = await syncData(true);
      showToast({
        type: 'success',
        title: hasUpdates ? 'Synchronisation réussie' : 'Déjà à jour',
        message: hasUpdates ? 'Base de données mise à jour !' : 'La base de données est déjà à jour.'
      });
    } catch (error) {
      showToast({
        type: 'error',
        title: 'Erreur de synchronisation',
        message: error instanceof Error ? error.message : 'Échec de la synchronisation'
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleLogout = () => {
    adminLogout();
    userLogout();
  };

  const showLogoutButton = isAdmin || isUserAuthenticated;

  const getDisplayName = () => {
    if (currentUser) return currentUser.username;
    if (authenticatedUser) return authenticatedUser.username;
    return null;
  };

  const displayName = getDisplayName();

  const navLinkClass = (path: string) =>
    `p-2 rounded-lg transition-all duration-200 ${
      location.pathname === path
        ? 'bg-primary/20 text-primary'
        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
    }`;

  return (
    <header className="bg-card/80 backdrop-blur-xl border-b border-border/50 sticky top-0 z-40">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-3 hover:opacity-80 transition-opacity">
            <div className="p-2 bg-primary rounded-xl shadow-lg" style={{ boxShadow: 'var(--shadow-glow)' }}>
              <Package className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <div className="flex items-baseline space-x-2">
                <h1 className="text-lg font-bold text-foreground">Stocky</h1>
                <span className="text-[10px] text-muted-foreground font-medium">By QodWeb</span>
              </div>
              {/* Compact sync status */}
              <div className="flex items-center space-x-1.5 mt-0.5">
                {syncInfo.isOnline ? (
                  <Cloud className="h-3 w-3 text-primary" />
                ) : (
                  <CloudOff className="h-3 w-3 text-destructive" />
                )}
                <span className="text-[10px] text-muted-foreground">
                  {isSyncing ? 'Synchronisation...' : syncInfo.isOnline ? 'En ligne' : 'Hors ligne'}
                </span>
                {syncInfo.pendingChanges > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-destructive/20 text-destructive rounded-full font-medium">
                    {syncInfo.pendingChanges} en attente
                  </span>
                )}
              </div>
            </div>
          </Link>

          {/* Nav Actions */}
          <div className="flex items-center space-x-2">
            {/* Sync button */}
            {syncInfo.isOnline && (
              <button
                onClick={handleSync}
                disabled={isSyncing}
                className="p-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-all duration-200 disabled:opacity-50"
                title="Rafraîchir les données"
              >
                <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
              </button>
            )}

            {canCreateQuote() && (
              <Link to="/quotes-history" className={navLinkClass('/quotes-history')} title="Historique des devis">
                <FileText className="h-4 w-4" />
              </Link>
            )}

            {isAdmin && (
              <Link to="/admin/users" className={navLinkClass('/admin/users')} title="Gestion des utilisateurs">
                <Users className="h-4 w-4" />
              </Link>
            )}

            {isAdmin && (
              <div className="p-2 bg-primary rounded-lg text-primary-foreground shadow-md" title={displayName ? `Admin: ${displayName}` : 'Administrateur'}>
                <Shield className="h-4 w-4" />
              </div>
            )}

            {!isAdmin && isUserAuthenticated && displayName && (
              <div className="p-2 bg-secondary rounded-lg text-secondary-foreground" title={`Utilisateur: ${displayName}`}>
                <User className="h-4 w-4" />
              </div>
            )}

            {showLogoutButton && (
              <button
                onClick={handleLogout}
                className="p-2 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded-lg transition-all duration-200"
                title={displayName ? `Se déconnecter (${displayName})` : 'Se déconnecter'}
              >
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
