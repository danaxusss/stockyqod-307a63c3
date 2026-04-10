import React, { useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title?: string;
  message: string;
  duration?: number;
  autoClose?: boolean;
}

interface ToastProps {
  toast: ToastMessage;
  onClose: (id: string) => void;
}

export function Toast({ toast, onClose }: ToastProps) {
  const { id, type, message, duration = 4000, autoClose = true } = toast;

  useEffect(() => {
    if (autoClose) {
      const timer = setTimeout(() => onClose(id), duration);
      return () => clearTimeout(timer);
    }
  }, [id, duration, autoClose, onClose]);

  const config = {
    success: { bg: 'bg-emerald-500/15 border-emerald-500/30', icon: CheckCircle, color: 'text-emerald-500' },
    error: { bg: 'bg-destructive/15 border-destructive/30', icon: AlertCircle, color: 'text-destructive' },
    warning: { bg: 'bg-amber-500/15 border-amber-500/30', icon: AlertTriangle, color: 'text-amber-500' },
    info: { bg: 'bg-primary/15 border-primary/30', icon: Info, color: 'text-primary' },
  }[type];

  const Icon = config.icon;

  return (
    <div className={`flex items-center space-x-2 px-3 py-2 rounded-lg border backdrop-blur-md shadow-lg ${config.bg} animate-in slide-in-from-top-2 duration-200`}>
      <Icon className={`h-4 w-4 flex-shrink-0 ${config.color}`} />
      <p className="text-xs font-medium text-foreground flex-1 truncate">{message}</p>
      <button onClick={() => onClose(id)} className="flex-shrink-0 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10">
        <X className="h-3 w-3 text-muted-foreground" />
      </button>
    </div>
  );
}
