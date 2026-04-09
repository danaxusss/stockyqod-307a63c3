import React, { useState, useEffect } from 'react';
import { Search, RefreshCw, Package, Upload, Bug, Trash2, TrendingUp, BarChart3, FileText, ShoppingCart } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { ExcelUploadModal } from '../components/ExcelUploadModal';
import { SyncStatusIndicator } from '../components/SyncStatusIndicator';
import { ProductUploadService } from '../utils/productUploadService';
import { StorageManager } from '../utils/storage';

export function Home() {
  const { isAdmin, canAccessStockLocation, authVersion, canCreateQuote } = useAuth();
  const { state, syncStatus, syncData } = useAppContext();
  const { showToast } = useToast();
  const [isSyncing, setIsSyncing] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const [debugInfo, setDebugInfo] = useState<any>(null);

  // Debug logging for admin status on Home page
  console.log('Home page render - Admin status:', {
    isAdmin,
    authVersion
  });
  // React to auth changes
  useEffect(() => {
    // This effect will run whenever authVersion changes, ensuring the component re-renders
    // when admin status changes
    console.log('Home page - Auth version changed:', authVersion, 'isAdmin:', isAdmin);
  }, [authVersion, isAdmin]);

  const handleSync = async () => {
    if (!isAdmin) return;
    
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
          message: 'La base de données est déjà à jour - aucune nouvelle mise à jour disponible.'
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Échec de la synchronisation';
      showToast({
        type: 'error',
        title: 'Erreur de synchronisation',
        message
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleClearDatabase = async () => {
    if (!isAdmin) return;

    const confirmed = window.confirm(
      'Êtes-vous sûr de vouloir supprimer TOUS les produits de la base de données ?\n\n' +
      'Cette action va :\n' +
      '• Supprimer TOUS les produits de Supabase\n' +
      '• Supprimer TOUTES les données locales (IndexedDB)\n' +
      '• Réinitialiser toutes les préférences\n\n' +
      'Cette action est IRRÉVERSIBLE !'
    );

    if (!confirmed) return;

    const doubleConfirm = window.confirm(
      'DERNIÈRE CONFIRMATION !\n\n' +
      'Vous êtes sur le point de DÉTRUIRE toutes les données.\n' +
      'Tapez "CONFIRMER" dans la prochaine boîte de dialogue pour continuer.'
    );

    if (!doubleConfirm) return;

    const finalConfirm = prompt(
      'Pour confirmer la suppression complète, tapez exactement: CONFIRMER'
    );

    if (finalConfirm !== 'CONFIRMER') {
      showToast({
        type: 'warning',
        title: 'Suppression annulée',
        message: 'Confirmation incorrecte'
      });
      return;
    }

    setIsClearing(true);

    try {
      console.log('Starting complete database reset...');

      // Step 1: Clear Supabase database
      showToast({
        type: 'info',
        message: 'Étape 1/3: Suppression des produits Supabase...'
      });
      await ProductUploadService.resetDatabase();

      // Step 2: Clear local IndexedDB
      showToast({
        type: 'info',
        message: 'Étape 2/3: Réinitialisation des préférences...'
      });

      // Step 3: Clear localStorage
      showToast({
        type: 'info',
        message: 'Étape 3/3: Réinitialisation des préférences...'
      });
      StorageManager.clearAllData();

      showToast({
        type: 'success',
        title: 'Suppression terminée',
        message: 'Base de données complètement vidée ! La page va se recharger...'
      });

      // Reload the page after a short delay
      setTimeout(() => {
        window.location.reload();
      }, 2000);

    } catch (error) {
      console.error('Failed to clear database:', error);
      showToast({
        type: 'error',
        title: 'Erreur de suppression',
        message: `Échec de la suppression: ${error instanceof Error ? error.message : 'Erreur inconnue'}`
      });
    } finally {
      setIsClearing(false);
    }
  };

  const handleUploadSuccess = () => {
    showToast({
      type: 'success',
      title: 'Upload réussi',
      message: 'Produits téléchargés avec succès !'
    });
    // Trigger a refresh of the app state if needed
    window.location.reload();
  };

  const handleDebugAnalysis = async () => {
    if (!isAdmin) return;
    
    try {
      setShowDebugInfo(true);
      
      const supabaseStats = await ProductUploadService.analyzeProducts();
      
      setDebugInfo({
        supabase: supabaseStats,
        timestamp: new Date().toISOString()
      });
      
      console.log('Debug Analysis:', {
        supabase: supabaseStats
      });
      
    } catch (error) {
      console.error('Debug analysis failed:', error);
      showToast({
        type: 'error',
        title: 'Erreur d\'analyse',
        message: `Analyse de débogage échouée: ${error instanceof Error ? error.message : 'Erreur inconnue'}`
      });
    }
  };

  // Helper function to format numbers with separators
  const formatNumber = (num: number): string => {
    return new Intl.NumberFormat('fr-FR').format(num);
  };

  // Calculate total stock across accessible locations only
  const totalStock = state.products.reduce((sum, product) => {
    const productTotal = Object.entries(product.stock_levels || {})
      .filter(([location]) => canAccessStockLocation(location))
      .reduce((s, [, level]) => s + level, 0);
    return sum + productTotal;
  }, 0);

  // Get unique accessible stock locations
  const allLocations = new Set<string>();
  state.products.forEach(product => {
    Object.keys(product.stock_levels || {}).forEach(location => {
      if (canAccessStockLocation(location)) {
        allLocations.add(location);
      }
    });
  });

  // Show empty state with sync option if no products
  if (state.products.length === 0) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-blue-500 to-blue-600 rounded-2xl mb-4">
            <Package className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Gestion d'Inventaire
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Recherchez et gérez votre inventaire facilement
          </p>
        </div>

        <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-2xl shadow-xl p-8 text-center">
          <div className="flex justify-center mb-6">
            <div className="p-4 bg-gradient-to-r from-orange-100 to-red-100 dark:from-orange-900/30 dark:to-red-900/30 rounded-2xl">
              <Package className="h-16 w-16 text-orange-600 dark:text-orange-400" />
            </div>
          </div>
          
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
            Aucun Produit Trouvé
          </h2>
          
          <p className="text-gray-600 dark:text-gray-400 mb-6 leading-relaxed">
            {state.isOnline 
              ? "Votre inventaire semble vide. Synchronisez avec la base de données ou téléchargez des produits depuis un fichier Excel."
              : "Aucun produit en cache. Veuillez vous connecter à Internet pour synchroniser les données."
            }
          </p>

          {state.isOnline && isAdmin && (
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button
                onClick={handleSync}
                disabled={isSyncing}
                className="flex items-center justify-center space-x-2 px-4 py-2 sm:px-6 sm:py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg transition-colors"
              >
                <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'Synchronisation...' : 'Synchroniser Maintenant'}</span>
              </button>
              
              <button
                onClick={() => setShowUploadModal(true)}
                className="flex items-center justify-center space-x-2 px-4 py-2 sm:px-6 sm:py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
              >
                <Upload className="h-4 w-4" />
                <span>Télécharger Excel</span>
              </button>
            </div>
          )}
        </div>

        {/* Sync Status at bottom for empty state */}
        <div className="mt-8">
          <SyncStatusIndicator 
            syncStatus={syncStatus}
            onSync={handleSync}
            isSyncing={isSyncing}
          />
        </div>

        {showUploadModal && (
          <ExcelUploadModal
            onClose={() => setShowUploadModal(false)}
            onSuccess={handleUploadSuccess}
          />
        )}
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-blue-500 to-blue-600 rounded-2xl mb-4">
          <Package className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          Gestion d'Inventaire
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Recherchez et gérez votre inventaire facilement
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        <Link 
          to="/search"
          className="group bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-2xl p-4 sm:p-6 shadow-lg hover:shadow-xl transition-all duration-300 border border-white/20 hover:scale-105"
        >
          <div className="flex items-center justify-center w-12 h-12 bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl mb-4 group-hover:from-blue-600 group-hover:to-blue-700 transition-all">
            <Search className="h-6 w-6 text-white" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Rechercher Produits
          </h3>
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            Cherchez par nom, marque ou barcode
          </p>
        </Link>

        {/* Quote shortcuts - Only for non-admin users with quote permissions */}
        {canCreateQuote() && !isAdmin && (
          <>
            <Link 
              to="/quotes-history"
              className="group bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-2xl p-4 sm:p-6 shadow-lg hover:shadow-xl transition-all duration-300 border border-white/20 hover:scale-105"
            >
              <div className="flex items-center justify-center w-12 h-12 bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-xl mb-4 group-hover:from-emerald-600 group-hover:to-emerald-700 transition-all">
                <FileText className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Historique des Devis
              </h3>
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                Consultez et gérez vos devis
              </p>
            </Link>

            <Link 
              to="/quote-cart"
              className="group bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-2xl p-4 sm:p-6 shadow-lg hover:shadow-xl transition-all duration-300 border border-white/20 hover:scale-105"
            >
              <div className="flex items-center justify-center w-12 h-12 bg-gradient-to-r from-purple-500 to-purple-600 rounded-xl mb-4 group-hover:from-purple-600 group-hover:to-purple-700 transition-all">
                <ShoppingCart className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Nouveau Devis
              </h3>
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                Créer un nouveau devis
              </p>
            </Link>
          </>
        )}
        {isAdmin && (
          <>
            <button
              onClick={handleSync}
              disabled={isSyncing || !state.isOnline}
              className="group bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-2xl p-4 sm:p-6 shadow-lg hover:shadow-xl transition-all duration-300 border border-white/20 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 text-left"
            >
              <div className="flex items-center justify-center w-12 h-12 bg-gradient-to-r from-orange-500 to-orange-600 rounded-xl mb-4 group-hover:from-orange-600 group-hover:to-orange-700 transition-all">
                <RefreshCw className={`h-6 w-6 text-white ${isSyncing ? 'animate-spin' : ''}`} />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Synchroniser Données
              </h3>
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                {isSyncing ? 'Synchronisation...' : 'Mettre à jour l\'inventaire depuis le serveur'}
              </p>
            </button>

            <button
              onClick={() => setShowUploadModal(true)}
              className="group bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-2xl p-4 sm:p-6 shadow-lg hover:shadow-xl transition-all duration-300 border border-white/20 hover:scale-105 text-left"
            >
              <div className="flex items-center justify-center w-12 h-12 bg-gradient-to-r from-purple-500 to-purple-600 rounded-xl mb-4 group-hover:from-purple-600 group-hover:to-purple-700 transition-all">
                <Upload className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Télécharger Excel
              </h3>
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                Importer des produits depuis Excel
              </p>
            </button>

            <button
              onClick={handleDebugAnalysis}
              className="group bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-2xl p-4 sm:p-6 shadow-lg hover:shadow-xl transition-all duration-300 border border-white/20 hover:scale-105 text-left"
            >
              <div className="flex items-center justify-center w-12 h-12 bg-gradient-to-r from-red-500 to-red-600 rounded-xl mb-4 group-hover:from-red-600 group-hover:to-red-700 transition-all">
                <Bug className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Analyse Debug
              </h3>
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                Analyser les données pour identifier les problèmes
              </p>
            </button>

            <button
              onClick={handleClearDatabase}
              disabled={isClearing}
              className="group bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-2xl p-4 sm:p-6 shadow-lg hover:shadow-xl transition-all duration-300 border border-white/20 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 text-left"
            >
              <div className="flex items-center justify-center w-12 h-12 bg-gradient-to-r from-red-600 to-red-700 rounded-xl mb-4 group-hover:from-red-700 group-hover:to-red-800 transition-all">
                <Trash2 className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Vider Base de Données
              </h3>
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                {isClearing ? 'Suppression en cours...' : 'Supprimer TOUS les produits (IRRÉVERSIBLE)'}
              </p>
            </button>

            <Link
              to="/admin/statistics"
              className="group bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-2xl p-4 sm:p-6 shadow-lg hover:shadow-xl transition-all duration-300 border border-white/20 hover:scale-105 text-left"
            >
              <div className="flex items-center justify-center w-12 h-12 bg-gradient-to-r from-indigo-500 to-indigo-600 rounded-xl mb-4 group-hover:from-indigo-600 group-hover:to-indigo-700 transition-all">
                <BarChart3 className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Statistiques Générales
              </h3>
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                Voir les statistiques détaillées du système
              </p>
            </Link>
          </>
        )}
      </div>

      {/* Debug Information */}
      {showDebugInfo && debugInfo && isAdmin && (
        <div className="mb-8 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center space-x-2">
              <Bug className="h-5 w-5" />
              <span>Analyse de Debug</span>
            </h2>
            <button
              onClick={() => setShowDebugInfo(false)}
              className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              ✕
            </button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Base de Données Locale (IndexedDB)</h3>
              <div className="space-y-2 text-sm">
                <div>Produits: <span className="font-mono">{debugInfo.local.productsCount}</span></div>
                <div>Meta: <span className="font-mono">{debugInfo.local.metaCount}</span></div>
                <div>Identifiants dupliqués: <span className="font-mono">{debugInfo.local.duplicateBarcodes.length}</span></div>
                {debugInfo.local.duplicateBarcodes.length > 0 && (
                  <div className="text-red-600 dark:text-red-400">
                    Dupliqués: {debugInfo.local.duplicateBarcodes.slice(0, 5).join(', ')}
                    {debugInfo.local.duplicateBarcodes.length > 5 && '...'}
                  </div>
                )}
              </div>
            </div>
            
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Base de Données Serveur (Supabase)</h3>
              <div className="space-y-2 text-sm">
                <div>Produits: <span className="font-mono">{debugInfo.supabase.totalCount}</span></div>
                <div>Produits invalides: <span className="font-mono">{debugInfo.supabase.invalidProducts.length}</span></div>
                <div>Identifiants dupliqués: <span className="font-mono">{debugInfo.supabase.duplicateBarcodes.length}</span></div>
                {debugInfo.supabase.duplicateBarcodes.length > 0 && (
                  <div className="text-red-600 dark:text-red-400">
                    Dupliqués: {debugInfo.supabase.duplicateBarcodes.slice(0, 5).join(', ')}
                    {debugInfo.supabase.duplicateBarcodes.length > 5 && '...'}
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <div className="mt-4 p-3 bg-gray-50 dark:bg-slate-700 rounded-lg">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              <strong>Différence:</strong> {Math.abs(debugInfo.supabase.totalCount - debugInfo.local.productsCount)} produits
              <br />
              <strong>Analyse effectuée:</strong> {new Date(debugInfo.timestamp).toLocaleString('fr-FR')}
            </div>
          </div>
        </div>
      )}

      {/* Sync Status moved to bottom */}
      <div className="mb-6">
        <SyncStatusIndicator 
          syncStatus={syncStatus}
          onSync={handleSync}
          isSyncing={isSyncing}
        />
      </div>

      {showUploadModal && (
        <ExcelUploadModal
          onClose={() => setShowUploadModal(false)}
          onSuccess={handleUploadSuccess}
        />
      )}
    </div>
  );
}