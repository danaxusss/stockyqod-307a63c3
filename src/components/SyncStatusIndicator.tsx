import React from 'react';
import { Wifi, WifiOff, RefreshCw, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import { SyncStatus } from '../utils/syncManager';

interface SyncStatusIndicatorProps {
  syncStatus: SyncStatus | null;
  onSync?: () => void;
  isSyncing?: boolean;
  compact?: boolean;
}

export function SyncStatusIndicator({ 
  syncStatus, 
  onSync, 
  isSyncing = false, 
  compact = false 
}: SyncStatusIndicatorProps) {
  if (!syncStatus) {
    return null;
  }

  const formatLastSync = (date: Date | null) => {
    if (!date) return 'Jamais';
    
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'À l\'instant';
    if (diffMins < 60) return `Il y a ${diffMins} min`;
    if (diffHours < 24) return `Il y a ${diffHours}h`;
    if (diffDays < 7) return `Il y a ${diffDays}j`;
    
    return date.toLocaleDateString('fr-FR');
  };

  const getStatusInfo = () => {
    if (!syncStatus.isOnline) {
      return {
        icon: WifiOff,
        color: 'text-red-500',
        bgColor: 'bg-red-50 dark:bg-red-900/20',
        borderColor: 'border-red-200 dark:border-red-800',
        text: 'Hors ligne',
        description: 'Données locales uniquement'
      };
    }

    if (isSyncing) {
      return {
        icon: RefreshCw,
        color: 'text-blue-500',
        bgColor: 'bg-blue-50 dark:bg-blue-900/20',
        borderColor: 'border-blue-200 dark:border-blue-800',
        text: 'Synchronisation...',
        description: 'Mise à jour en cours'
      };
    }

    if (syncStatus.needsSync) {
      return {
        icon: AlertCircle,
        color: 'text-orange-500',
        bgColor: 'bg-orange-50 dark:bg-orange-900/20',
        borderColor: 'border-orange-200 dark:border-orange-800',
        text: 'Mise à jour disponible',
        description: 'Nouvelles données sur le serveur'
      };
    }

    if (syncStatus.isUpToDate && syncStatus.hasLocalData) {
      return {
        icon: CheckCircle,
        color: 'text-green-500',
        bgColor: 'bg-green-50 dark:bg-green-900/20',
        borderColor: 'border-green-200 dark:border-green-800',
        text: 'À jour',
        description: `Dernière sync: ${formatLastSync(syncStatus.lastSyncTime)}`
      };
    }

    if (!syncStatus.hasLocalData && syncStatus.hasServerData) {
      return {
        icon: AlertCircle,
        color: 'text-yellow-500',
        bgColor: 'bg-yellow-50 dark:bg-yellow-900/20',
        borderColor: 'border-yellow-200 dark:border-yellow-800',
        text: 'Synchronisation requise',
        description: 'Aucune donnée locale'
      };
    }

    return {
      icon: Clock,
      color: 'text-gray-500',
      bgColor: 'bg-gray-50 dark:bg-gray-900/20',
      borderColor: 'border-gray-200 dark:border-gray-800',
      text: 'État inconnu',
      description: 'Vérification en cours...'
    };
  };

  const statusInfo = getStatusInfo();
  const Icon = statusInfo.icon;

  if (compact) {
    return (
      <div className="flex items-center space-x-2">
        <div className={`flex items-center space-x-1 px-2 py-1 rounded-full text-xs ${statusInfo.bgColor} ${statusInfo.color}`}>
          <Icon className={`h-3 w-3 ${isSyncing ? 'animate-spin' : ''}`} />
          <span>{statusInfo.text}</span>
        </div>
        
        {syncStatus.needsSync && onSync && !isSyncing && (
          <button
            onClick={onSync}
            className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-full transition-colors shadow-sm hover:shadow-md transform hover:scale-105"
          >
            Sync
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`p-4 rounded-lg border ${statusInfo.bgColor} ${statusInfo.borderColor}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Icon className={`h-5 w-5 ${statusInfo.color} ${isSyncing ? 'animate-spin' : ''}`} />
          <div>
            <p className={`font-medium ${statusInfo.color}`}>
              {statusInfo.text}
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {statusInfo.description}
            </p>
          </div>
        </div>

        {syncStatus.needsSync && onSync && !isSyncing && (
          <button
            onClick={onSync}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Synchroniser</span>
          </button>
        )}
      </div>

      {/* Additional sync info - Show for all users */}
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600 dark:text-gray-400">
        <div>
          <span className="font-medium">Dernière synchronisation:</span>
          <span className="ml-1">{formatLastSync(syncStatus.lastSyncTime)}</span>
        </div>
        <div>
          <span className="font-medium">État:</span>
          <span className="ml-1">
            {syncStatus.isOnline ? 'En ligne' : 'Hors ligne'}
            {syncStatus.hasLocalData && ' • Données disponibles'}
          </span>
        </div>
      </div>
    </div>
  );
}