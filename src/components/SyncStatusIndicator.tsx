import React from 'react';
import { Wifi, WifiOff, RefreshCw, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import { SyncInfo, SyncState } from '../hooks/useApp';

interface SyncStatusIndicatorProps {
  syncInfo: SyncInfo;
  onSync?: () => void;
  isSyncing?: boolean;
  compact?: boolean;
}

export function SyncStatusIndicator({ 
  syncInfo, 
  onSync, 
  isSyncing = false, 
  compact = false 
}: SyncStatusIndicatorProps) {
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
    if (!syncInfo.isOnline) {
      return { icon: WifiOff, color: 'text-destructive', bgColor: 'bg-destructive/10', text: 'Hors ligne', description: 'Données locales uniquement' };
    }
    if (isSyncing || syncInfo.state === 'syncing') {
      return { icon: RefreshCw, color: 'text-primary', bgColor: 'bg-primary/10', text: 'Synchronisation...', description: 'Mise à jour en cours' };
    }
    if (syncInfo.pendingChanges > 0) {
      return { icon: AlertCircle, color: 'text-orange-500', bgColor: 'bg-orange-500/10', text: 'Changements en attente', description: `${syncInfo.pendingChanges} en attente de sync` };
    }
    if (syncInfo.state === 'error') {
      return { icon: AlertCircle, color: 'text-destructive', bgColor: 'bg-destructive/10', text: 'Erreur de sync', description: 'Réessayez la synchronisation' };
    }
    return { icon: CheckCircle, color: 'text-emerald-500', bgColor: 'bg-emerald-500/10', text: 'À jour', description: `Dernière sync: ${formatLastSync(syncInfo.lastSync)}` };
  };

  const statusInfo = getStatusInfo();
  const Icon = statusInfo.icon;

  if (compact) {
    return (
      <div className="flex items-center space-x-2">
        <div className={`flex items-center space-x-1 px-2 py-1 rounded-full text-xs ${statusInfo.bgColor} ${statusInfo.color}`}>
          <Icon className={`h-3 w-3 ${(isSyncing || syncInfo.state === 'syncing') ? 'animate-spin' : ''}`} />
          <span>{statusInfo.text}</span>
        </div>
        {syncInfo.pendingChanges > 0 && onSync && !isSyncing && (
          <button onClick={onSync} className="px-2 py-1 bg-primary hover:bg-primary/90 text-primary-foreground text-xs rounded-full transition-colors shadow-sm">
            Sync
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`p-4 rounded-lg border border-border/50 ${statusInfo.bgColor}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Icon className={`h-5 w-5 ${statusInfo.color} ${(isSyncing || syncInfo.state === 'syncing') ? 'animate-spin' : ''}`} />
          <div>
            <p className={`font-medium ${statusInfo.color}`}>{statusInfo.text}</p>
            <p className="text-sm text-muted-foreground">{statusInfo.description}</p>
          </div>
        </div>
        {syncInfo.pendingChanges > 0 && onSync && !isSyncing && (
          <button onClick={onSync} className="flex items-center space-x-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-all duration-200 shadow-lg">
            <RefreshCw className="h-4 w-4" /><span>Synchroniser</span>
          </button>
        )}
      </div>
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-muted-foreground">
        <div><span className="font-medium">Dernière synchronisation:</span> <span className="ml-1">{formatLastSync(syncInfo.lastSync)}</span></div>
        <div><span className="font-medium">État:</span> <span className="ml-1">{syncInfo.isOnline ? 'En ligne' : 'Hors ligne'}</span></div>
      </div>
    </div>
  );
}