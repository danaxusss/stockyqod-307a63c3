import React, { useState } from 'react';
import { Package, RefreshCw, LogOut, Shield, FileText, Users, User } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useUserAuth } from '../hooks/useUserAuth';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { SyncStatusIndicator } from './SyncStatusIndicator';

export function Header() {
  const [isSyncing, setIsSyncing] = useState(false);
  const { isAdmin, currentUser, canCreateQuote, logout: adminLogout } = useAuth();
  const { isAuthenticated: isUserAuthenticated, authenticatedUser, logout: userLogout } = useUserAuth();
  const { syncStatus, syncData, openLoginModal } = useAppContext();
  const { showToast } = useToast();
  const location = useLocation();

  // Debug logging for admin status
  console.log('Header render - Auth status:', {
    isAdmin,
    currentUser: currentUser ? {
      username: currentUser.username,
      is_admin: currentUser.is_admin
    } : null,
    isUserAuthenticated,
    authenticatedUser: authenticatedUser ? {
      username: authenticatedUser.username,
      is_admin: authenticatedUser.is_admin
    } : null
  });
  const handleSync = async () => {
    if (isSyncing) return;
    
    setIsSyncing(true);
    try {
      const hasUpdates = await syncData(true); // Force sync
      if (hasUpdates) {
        showToast({
          type: 'success',
          title: 'Synchronisation réussie',
          message: 'Base de données mise à jour avec succès !'
        });
      } else {
        showToast({
          type: 'info',
          title: 'Déjà à jour',
          message: 'La base de données est déjà à jour.'
        });
      }
    } catch (error) {
      console.error('Sync failed:', error);
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
    // Log out from both admin and user sessions
    adminLogout();
    userLogout();
  };

  // Show logout button if either admin or user is authenticated
  const showLogoutButton = isAdmin || isUserAuthenticated;

  // Get display name for current user
  const getDisplayName = () => {
    if (currentUser) return currentUser.username;
    if (authenticatedUser) return authenticatedUser.username;
    return null;
  };

  const displayName = getDisplayName();
  return (
    <header className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm shadow-lg border-b border-white/20">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Link to="/" className="flex items-center space-x-3 hover:opacity-80 transition-opacity">
              <div className="p-2 bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg">
                <Package className="h-6 w-6 text-white" />
              </div>
              <div>
                <div className="flex items-baseline space-x-2">
                  <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                    Stocky
                  </h1>
                  <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                    By QodWeb
                  </span>
                </div>
                
                {/* Sync Status Indicator */}
                <SyncStatusIndicator 
                  syncStatus={syncStatus}
                  onSync={handleSync}
                  isSyncing={isSyncing}
                  compact={true}
                />
              </div>
            </Link>
          </div>

          <div className="flex items-center space-x-4">
            {/* Quotes History Link - Only for users with quote permissions */}
            {canCreateQuote() && (
              <Link
                to="/quotes-history"
                className={`p-2 rounded-lg transition-colors ${
                  location.pathname === '/quotes-history'
                    ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
                title="Historique des devis"
              >
                <FileText className="h-5 w-5" />
              </Link>
            )}

            {/* User Management Link - Admin Only */}
            {isAdmin && (
              <Link
                to="/admin/users"
                className={`p-2 rounded-lg transition-colors ${
                  location.pathname === '/admin/users'
                    ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
                title="Gestion des utilisateurs"
              >
                <Users className="h-5 w-5" />
              </Link>
            )}

            {/* Admin Status Badge - Icon Only with Shield */}
            {isAdmin && (
              <div className="p-2 bg-gradient-to-r from-amber-500 to-amber-600 dark:from-amber-600 dark:to-amber-700 text-white rounded-lg shadow-md" title={displayName ? `Admin: ${displayName}` : 'Administrateur'}>
                <Shield className="h-5 w-5" />
              </div>
            )}

            {/* User Status Badge - Show for non-admin authenticated users */}
            {!isAdmin && isUserAuthenticated && displayName && (
              <div className="p-2 bg-gradient-to-r from-blue-500 to-blue-600 dark:from-blue-600 dark:to-blue-700 text-white rounded-lg shadow-md" title={`Utilisateur: ${displayName}`}>
                <User className="h-5 w-5" />
              </div>
            )}

            {/* Unified Logout Button - Icon Only */}
            {showLogoutButton && (
              <button
                onClick={handleLogout}
                className="p-2 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 rounded-lg transition-colors"
                title={displayName ? `Se déconnecter (${displayName})` : 'Se déconnecter'}
              >
                <LogOut className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}