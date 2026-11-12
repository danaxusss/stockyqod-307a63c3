import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * A document in a phone list: number and status, client, then date and
 * amount. The whole card opens the document; `menu` sits beside it.
 */
export function DocumentCard({ to, number, status, title, subtitle, date, amount, note, menu, leading }: {
  to: string;
  number: ReactNode;
  status?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  date?: ReactNode;
  amount?: ReactNode;
  /** A line under the amount, e.g. "reste 1 200,00 Dh". */
  note?: ReactNode;
  menu?: ReactNode;
  /** Before the card, e.g. a selection checkbox. */
  leading?: ReactNode;
}) {
  return (
    <li className="flex items-stretch gap-1">
      {leading && <div className="flex items-center pl-3">{leading}</div>}
      <Link to={to} className="block min-w-0 flex-1 px-4 py-3 active:bg-secondary">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-sm font-semibold text-primary">{number}</span>
          {status}
        </div>
        <p className="mt-1 truncate font-medium text-foreground">{title}</p>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        <div className="mt-1.5 flex items-end justify-between gap-2">
          <span className="text-xs text-muted-foreground">{date}</span>
          <span className="text-right">
            {amount && <span className="block font-semibold tabular-nums text-foreground">{amount}</span>}
            {note && <span className="block text-xs tabular-nums">{note}</span>}
          </span>
        </div>
      </Link>
      {menu && <div className="flex items-start pr-2 pt-2">{menu}</div>}
    </li>
  );
}
