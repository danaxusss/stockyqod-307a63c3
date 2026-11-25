import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { LEGAL_TVA_RATES, isLegalTvaRate, paymentDaysError, DEFAULT_PAYMENT_DAYS, MAX_PAYMENT_DAYS, localDay, taxAttestationStatus } from '../../utils/documentLines';
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

const MIGRATION_HINT = 'Réglage non enregistré tant que la mise à jour 20261126130000 de la base n’est pas exécutée.';

/**
 * Date of the attestation de régularité fiscale. Under 6 months old, the
 * company's VAT-registered clients pay its invoices VAT included; otherwise
 * they withhold the VAT (CGI art. 117-IV).
 */
export function TaxAttestationField({ value, onChange, className, available = true }: { value: string | undefined; onChange: (day: string) => void; className: string; available?: boolean }) {
  const status = taxAttestationStatus(value);
  const tone = status.state === 'valid' ? 'text-muted-foreground' : status.state === 'expiring' ? 'text-amber-700 dark:text-amber-300' : 'text-destructive';
  return (
    <div>
      <label htmlFor="tax-attestation-date" className="block text-xs font-medium text-foreground mb-1">Attestation de régularité fiscale (date)</label>
      <input id="tax-attestation-date" type="date" value={value || ''} max={localDay()} onChange={e => onChange(e.target.value)} className={className} />
      <p className={`mt-1 text-[11px] ${tone}`}>{status.message}</p>
      {!available && <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">{MIGRATION_HINT}</p>}
    </div>
  );
}

/** Opt-in: 0.25 % stamp duty collected on top of cash settlements (CGI art. 252-I-B). */
export function CashStampDutyField({ value, onChange, available = true }: { value: boolean | undefined; onChange: (on: boolean) => void; available?: boolean }) {
  return (
    <div>
      <label className="flex items-start gap-2 text-xs font-medium text-foreground">
        <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 rounded accent-primary" />
        <span>Appliquer le droit de timbre sur les règlements en espèces</span>
      </label>
      <p className="mt-1 text-[11px] text-muted-foreground">
        0,25 % du montant réglé en espèces, encaissé en plus du règlement et reversé à l’État avant la fin du mois suivant (art. 252 et 254 CGI). Le total des factures ne change pas.
      </p>
      {!available && <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">{MIGRATION_HINT}</p>}
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
