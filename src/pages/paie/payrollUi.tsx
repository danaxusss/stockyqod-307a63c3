import React from 'react';
import { AlertTriangle, Info, XCircle } from 'lucide-react';

const TONES = {
  warning: { cls: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200', Icon: AlertTriangle },
  error: { cls: 'border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-200', Icon: XCircle },
  info: { cls: 'border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-200', Icon: Info },
};

/** A short message box (warning, blocking error or information). */
export function Notice({ tone = 'warning', children, className = '' }: { tone?: keyof typeof TONES; children: React.ReactNode; className?: string }) {
  const { cls, Icon } = TONES[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex gap-2 rounded-lg border px-3 py-2.5 text-xs ${cls} ${className}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
