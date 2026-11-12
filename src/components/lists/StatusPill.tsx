import type { ReactNode } from 'react';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONES: Record<StatusTone, string> = {
  success: 'bg-emerald-500/10 text-emerald-700 ring-emerald-600/20 dark:text-emerald-300',
  warning: 'bg-amber-500/10 text-amber-800 ring-amber-600/20 dark:text-amber-300',
  danger: 'bg-red-500/10 text-red-700 ring-red-600/20 dark:text-red-300',
  info: 'bg-blue-500/10 text-blue-700 ring-blue-600/20 dark:text-blue-300',
  neutral: 'bg-secondary text-muted-foreground ring-border',
};

/** A document status, the same look in every list. */
export function StatusPill({ tone, icon, children }: { tone: StatusTone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      {icon}{children}
    </span>
  );
}
