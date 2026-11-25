import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { LEGAL_TVA_RATES, isLegalTvaRate, paymentDaysError, DEFAULT_PAYMENT_DAYS, MAX_PAYMENT_DAYS } from '../../utils/documentLines';
import { iceError, missingCompanyIds, type BillingIds } from '../../utils/legalIds';

// Billing settings shared by the company settings page and the companies
// page: VAT rate, payment delay, exemption mention, and the warnings about the
// identifiers every invoice must carry (CGI art. 145-III).

const RATE_LABELS: Record<number, string> = { 20: '20 % (taux normal)', 10: '10 % (taux réduit)', 0: '0 % (exonéré)' };

/** VAT rate: one of the rates in force; an old 7 % or 14 % stays shown until changed. */
export function TvaRateField({ value, onChange, className }: { value: number; onChange: (rate: number) => void; className: string }) {
  const legacy = !isLegalTvaRate(value);
  return (
    <div>
      <label className="block text-xs font-medium text-foreground mb-1">Taux de TVA</label>
      <select value={String(value)} onChange={e => onChange(Number(e.target.value))} className={className}>
        {legacy && <option value={String(value)}>{value} % (taux supprimé)</option>}
        {LEGAL_TVA_RATES.map(rate => <option key={rate} value={String(rate)}>{RATE_LABELS[rate]}</option>)}
      </select>
      {legacy && (
        <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
          Les taux de 7 % et 14 % n’existent plus depuis le 1er janvier 2026 : choisissez 20 %, 10 % ou 0 %.
        </p>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">Un changement de taux ne s’applique qu’aux nouveaux documents.</p>
    </div>
  );
}

export function PaymentDaysField({ value, onChange, className }: { value: number | undefined; onChange: (days: number) => void; className: string }) {
  const days = value ?? DEFAULT_PAYMENT_DAYS;
  const error = paymentDaysError(Number(days));
  return (
    <div>
      <label className="block text-xs font-medium text-foreground mb-1">Délai de paiement des factures (jours)</label>
      <input type="number" min="0" max={MAX_PAYMENT_DAYS} step="1" value={Number.isFinite(days) ? days : ''}
        onChange={e => onChange(e.target.value === '' ? NaN : Number(e.target.value))} className={className} />
      <p className={`mt-1 text-[11px] ${error ? 'text-destructive' : 'text-muted-foreground'}`}>
        {error || 'Échéance = date de facture + ce délai. 60 jours sans accord, 120 au maximum (loi 69-21).'}
      </p>
    </div>
  );
}

export function VatExemptionField({ value, onChange, className }: { value: string | undefined; onChange: (text: string) => void; className: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-foreground mb-1">Mention d’exonération</label>
      <input type="text" value={value || ''} onChange={e => onChange(e.target.value)} className={className}
        placeholder="Ex. : article 91 du CGI" />
      <p className="mt-1 text-[11px] text-muted-foreground">Imprimée après « Exonéré de TVA » sur les documents à 0 %.</p>
    </div>
  );
}

/** Identifiers missing for the invoices, and an ICE in the wrong format. */
export function LegalIdsWarning({ settings }: { settings: BillingIds }) {
  const missing = missingCompanyIds(settings);
  const ice = iceError(settings.ice);
  if (!missing.length && !ice) return null;
  return (
    <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <div className="space-y-0.5">
        {missing.length > 0 && <p>À renseigner, obligatoire sur chaque facture (art. 145 CGI) : {missing.join(', ')}.</p>}
        {ice && <p>{ice}</p>}
      </div>
    </div>
  );
}
