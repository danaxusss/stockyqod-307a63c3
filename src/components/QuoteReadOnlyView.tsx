import { Eye, FileDown, Loader, Lock } from 'lucide-react';
import { formatMoney } from '../utils/format';

export interface ReadOnlyQuoteLine {
  id: string;
  name: string;
  brand?: string;
  barcode?: string;
  quantity: number;
  unitPriceTTC: number;
  totalTTC: number;
}

const STATUS_LABEL: Record<string, string> = { draft: 'En attente', pending: 'Envoyé', final: 'Confirmé' };

/**
 * Another salesperson's quote, opened by its link: shown read-only, with the
 * PDF as the only action. Nothing here edits, saves or sends the quote.
 */
export function QuoteReadOnlyView({
  quoteNumber, quoteDate, status, customer, lines, totalTTC, tvaRate, isExporting, onExport, onPreview,
}: {
  quoteNumber: string;
  quoteDate?: string;
  status: string;
  customer: { fullName?: string; phoneNumber?: string; address?: string; salesPerson?: string };
  lines: ReadOnlyQuoteLine[];
  totalTTC: number;
  tvaRate: number;
  isExporting: boolean;
  onExport: () => void;
  onPreview?: () => void;
}) {
  const totalHT = totalTTC / (1 + tvaRate / 100);
  const date = quoteDate ? new Date(`${quoteDate.slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR') : '';
  const panel = 'rounded-xl border border-border bg-card shadow-sm';
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">Devis {quoteNumber}</h1>
        <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-muted-foreground">{STATUS_LABEL[status] || status}</span>
        {date && <span className="text-sm text-muted-foreground">du {date}</span>}
      </div>

      <p className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
        <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
        Devis de {customer.salesPerson || 'un autre vendeur'} — lecture seule. Vous pouvez seulement télécharger le PDF.
      </p>

      <section className={`${panel} p-4 sm:p-5`} aria-label="Client">
        <p className="text-lg font-semibold text-foreground">{customer.fullName || 'Client'}</p>
        <p className="mt-1 text-sm text-muted-foreground">{[customer.phoneNumber, customer.address].filter(Boolean).join(' · ')}</p>
      </section>

      <section className={panel} aria-label="Articles">
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <h2 className="font-semibold text-foreground">Articles <span className="text-sm font-normal text-muted-foreground">{lines.length} ligne{lines.length !== 1 ? 's' : ''}</span></h2>
        </div>
        <ul className="divide-y divide-border">
          {lines.map(line => (
            <li key={line.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">{line.name}</p>
                <p className="truncate text-sm text-muted-foreground">{[line.brand, line.barcode].filter(Boolean).join(' · ')}</p>
                <p className="text-sm tabular-nums text-muted-foreground">{line.quantity} × {formatMoney(line.unitPriceTTC)} TTC</p>
              </div>
              <p className="shrink-0 font-semibold tabular-nums text-foreground">{formatMoney(line.totalTTC)}</p>
            </li>
          ))}
        </ul>
        <dl className="space-y-1 border-t border-border px-4 py-3 text-sm sm:px-5">
          <div className="flex justify-between"><dt className="text-muted-foreground">Total HT</dt><dd className="tabular-nums text-foreground">{formatMoney(totalHT)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">TVA {tvaRate} %</dt><dd className="tabular-nums text-foreground">{formatMoney(totalTTC - totalHT)}</dd></div>
          <div className="flex justify-between pt-1 text-base"><dt className="font-semibold text-foreground">Total TTC</dt><dd className="font-bold tabular-nums text-foreground">{formatMoney(totalTTC)}</dd></div>
        </dl>
      </section>

      <div className="flex flex-wrap justify-end gap-2">
        {onPreview && (
          <button type="button" onClick={onPreview} disabled={isExporting}
            className="flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-secondary disabled:opacity-60">
            <Eye className="h-4 w-4" />Aperçu
          </button>
        )}
        <button type="button" onClick={onExport} disabled={isExporting}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
          {isExporting ? <Loader className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}Télécharger le PDF
        </button>
      </div>
    </div>
  );
}
