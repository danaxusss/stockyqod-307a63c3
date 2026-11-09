// One way to show money and dates across the app: "12 345,60 Dh".

const moneyFmt = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Amount in dirhams, two decimals, French grouping (regular spaces). */
export function formatMoney(value: number | null | undefined, unit = 'Dh'): string {
  const n = Number(value) || 0;
  return `${moneyFmt.format(n).replace(/[\u202f\u00a0]/g, ' ')}${unit ? ` ${unit}` : ''}`;
}

/** "Aujourd'hui", "Hier", "il y a 5 j" or "3 nov." for recent dates. */
export function formatRelativeDay(date: Date | string, now = new Date()): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days <= 0) return 'Aujourd’hui';
  if (days === 1) return 'Hier';
  if (days < 7) return `il y a ${days} j`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/** Whole days between a date and now. */
export function daysSince(date: Date | string, now = new Date()): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86_400_000));
}
