// Moroccan company identifiers printed on invoices (CGI art. 145-III). A
// missing or wrong ICE on an invoice costs 100 DH per omission (art. 198 ter),
// so the forms check its format before it reaches a document.

import { paymentDaysError, DEFAULT_PAYMENT_DAYS } from './documentLines';

export interface BillingIds { ice?: string | null; if_number?: string | null; patente?: string | null }

/** The ICE as stored: digits only (people type it with spaces). */
export function normalizeIce(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, '');
}

/** An ICE is exactly 15 digits, spaces ignored. */
export function isValidIce(value: string | null | undefined): boolean {
  return /^\d{15}$/.test(normalizeIce(value));
}

/** The message to show for an ICE field, or null when it is empty or valid. */
export function iceError(value: string | null | undefined): string | null {
  const v = normalizeIce(value);
  if (!v) return null;
  return isValidIce(v) ? null : `L’ICE doit comporter exactement 15 chiffres (${v.replace(/\D/g, '').length} saisis).`;
}

/** Identifiers the law requires on the seller's invoices that are not filled in. */
export function missingCompanyIds(company: BillingIds | null | undefined): string[] {
  const missing: string[] = [];
  if (!(company?.ice || '').trim()) missing.push('ICE');
  if (!(company?.if_number || '').trim()) missing.push('IF');
  if (!(company?.patente || '').trim()) missing.push('TP (patente)');
  return missing;
}

/** Why a company's billing settings cannot be saved (ICE format, payment delay), or null. */
export function billingSettingsError(s: BillingIds & { payment_terms_days?: number | null }): string | null {
  return iceError(s.ice) || paymentDaysError(Number(s.payment_terms_days ?? DEFAULT_PAYMENT_DAYS));
}
