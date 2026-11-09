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
    // Errors interrupt a screen reader; other toasts wait their turn. The
    // message wraps instead of being cut, so long errors stay readable.
    <div role={type === 'error' ? 'alert' : 'status'} className={`pointer-events-auto flex items-start gap-2 rounded-lg border py-2 pl-3 pr-1 shadow-lg backdrop-blur-md ${config.bg} animate-in slide-in-from-top-2 duration-200`}>
      <Icon aria-hidden="true" className={`mt-0.5 h-4 w-4 flex-shrink-0 ${config.color}`} />
      <p className="flex-1 break-words py-0.5 text-[13px] font-medium leading-snug text-foreground line-clamp-4">{message}</p>
      <button onClick={() => onClose(id)} aria-label="Fermer la notification" className="-my-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-black/10 hover:text-foreground dark:hover:bg-white/10">
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
}
