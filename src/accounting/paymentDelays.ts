// Payment delays between businesses (loi 69-21 amending the Code de commerce,
// in force since 1 July 2023). Pure functions: lateness, the fine the BUYER
// owes the Treasury, and the declaration filed on SIMPL-Délais de paiement.
//
// Rules applied:
//  - The delay runs from the invoice date, or from the end of the month of
//    delivery when the invoice was issued after that month (delayStart). It
//    is 60 days when nothing is agreed, 120 days at most when agreed.
//  - Fine on the amount paid late or still unpaid, VAT included: the Bank
//    Al-Maghrib key rate for the first month of delay, plus 0.85 % for each
//    further month or part of a month. The key rate is the one in force when
//    the delay starts (day after the due date), as the DGI announced each
//    change ("taux … pour les retards commençant au …").
//  - Not covered: invoices issued before 1 July 2023 (the SIMPL form refuses
//    them); until 31 December 2024, invoices of 10,000 DH or less (the DGI
//    communiqué: from 1 January 2025 the fine applies "y compris celles dont
//    le montant est inférieur ou égal à 10 000 dirhams"); the part of an
//    invoice in a court dispute (montant objet de litige).
//  - Who declares: companies with a turnover above 2 M MAD excluding VAT
//    (N-1); quarterly from 2026, before the end of the month after the
//    quarter (SIMPL guide); a nil declaration is still due.

import { addDays, addMonths, delayStart, frDay, isDay, r2, remainingOf, today, type Supplier, type SupplierInvoice, type SupplierPayment, type SupplierPaymentMode, NATURE_LABELS } from './supplierInvoices';

export interface KeyRate { from: string; rate: number; label: string }

/**
 * Bank Al-Maghrib key rate by start of delay. Source: Bank Al-Maghrib
 * monetary policy decisions as relayed by the DGI for the 69-21 fine:
 * 3 % until 31 May 2024, 2.75 % from 1 June 2024, 2.5 % from 1 December
 * 2024, 2.25 % from 20 March 2025 (unchanged at the 22 September 2026
 * meeting). A new decision is one line here.
 */
export const KEY_RATES: KeyRate[] = [
  { from: '2000-01-01', rate: 3, label: '3 % (avant le 1er juin 2024)' },
  { from: '2024-06-01', rate: 2.75, label: '2,75 % (depuis le 1er juin 2024)' },
  { from: '2024-12-01', rate: 2.5, label: '2,5 % (depuis le 1er décembre 2024)' },
  { from: '2025-03-20', rate: 2.25, label: '2,25 % (depuis le 20 mars 2025, inchangé au 22 septembre 2026)' },
];
export const KEY_RATE_SOURCE = 'Taux directeur de Bank Al-Maghrib en vigueur au début du retard (décisions de juin 2024, décembre 2024 et mars 2025 ; inchangé au conseil du 22 septembre 2026).';
/** Each further month or part of a month of delay. */
export const EXTRA_MONTH_RATE = 0.85;
export const LAW_START = '2023-07-01';
export const SMALL_INVOICE_LIMIT = 10000;
export const SMALL_INVOICE_COVERED_FROM = '2025-01-01';
export const DECLARATION_TURNOVER_THRESHOLD = 2_000_000;

export function keyRateOn(day: string): KeyRate {
  return [...KEY_RATES].reverse().find(k => k.from <= day) || KEY_RATES[0];
}

/** Months of delay "or part of a month" from the due date to `day`: 0 when not late. */
export function monthsLate(dueDate: string, day: string): number {
  if (!(day > dueDate)) return 0;
  let n = 1;
  while (addMonths(dueDate, n) < day) n += 1;
  return n;
}

/** Fine on an amount late by `months` months, at `keyRate` % for the first one. */
export function fineFor(amount: number, months: number, keyRate: number): number {
  if (months <= 0 || !(amount > 0)) return 0;
  return r2(amount * (keyRate + EXTRA_MONTH_RATE * (months - 1)) / 100);
}

/** Why an invoice is outside the 69-21 fine, or null. */
export function exclusionReason(inv: Pick<SupplierInvoice, 'status' | 'invoice_date' | 'total_ttc'>): string | null {
  if (inv.status === 'draft') return 'Brouillon';
  if (inv.invoice_date < LAW_START) return 'Facture antérieure au 1er juillet 2023';
  if (inv.invoice_date < SMALL_INVOICE_COVERED_FROM && Number(inv.total_ttc) <= SMALL_INVOICE_LIMIT) return 'Facture de 10 000 DH ou moins émise avant 2025';
  return null;
}

type Pay = Pick<SupplierPayment, 'payment_date' | 'amount' | 'vat_withheld' | 'ir_withheld' | 'mode' | 'reference'>;
/** What a payment settles: cash paid plus what was withheld for the State. */
export const settledBy = (p: Pick<SupplierPayment, 'amount' | 'vat_withheld' | 'ir_withheld'>) =>
  r2((Number(p.amount) || 0) + (Number(p.vat_withheld) || 0) + (Number(p.ir_withheld) || 0));

export interface LatePart { date: string; amount: number; months: number; fine: number; mode: SupplierPaymentMode | string; reference: string | null }

export interface DelayFacts {
  dueDate: string;
  keyRate: KeyRate;
  /** Days past the due date at `asOf` (unpaid) or at the last late payment. */
  daysLate: number;
  unpaid: number;
  unpaidMonths: number;
  /** Unpaid amount the fine applies to (court dispute deducted). */
  unpaidFineBase: number;
  fineUnpaid: number;
  late: LatePart[];
  paidLate: number;
  finePaidLate: number;
  fine: number;
  excluded: string | null;
}

/**
 * Lateness of one invoice at `asOf`: each payment made after the due date,
 * and what is still unpaid. `from` limits the late payments counted to a
 * period (declaration); the unpaid amount is always the one at `asOf`.
 */
export function delayFacts(
  inv: Pick<SupplierInvoice, 'status' | 'invoice_date' | 'due_date' | 'total_ttc' | 'litigation_amount' | 'litigation_date'>,
  payments: Pay[],
  asOf: string,
  from?: string,
): DelayFacts {
  const due = inv.due_date.slice(0, 10);
  const keyRate = keyRateOn(addDays(due, 1));
  const upTo = payments.filter(p => p.payment_date <= asOf);
  const settled = r2(upTo.reduce((s, p) => s + settledBy(p), 0));
  const unpaid = r2(Math.max(0, (Number(inv.total_ttc) || 0) - settled));
  const unpaidMonths = unpaid > 0.005 ? monthsLate(due, asOf) : 0;
  const disputed = isDay(inv.litigation_date) && inv.litigation_date <= asOf ? Number(inv.litigation_amount) || 0 : 0;
  const unpaidFineBase = r2(Math.max(0, unpaid - disputed));
  const late = upTo
    .filter(p => p.payment_date > due && (!from || p.payment_date >= from))
    .sort((a, b) => a.payment_date.localeCompare(b.payment_date))
    .map(p => {
      const months = monthsLate(due, p.payment_date);
      const amount = settledBy(p);
      return { date: p.payment_date, amount, months, fine: fineFor(amount, months, keyRate.rate), mode: p.mode, reference: p.reference };
    });
  const excluded = exclusionReason(inv);
  const fineUnpaid = excluded ? 0 : fineFor(unpaidFineBase, unpaidMonths, keyRate.rate);
  const finePaidLate = excluded ? 0 : r2(late.reduce((s, l) => s + l.fine, 0));
  const lastLate = late[late.length - 1]?.date;
  const daysLate = unpaid > 0.005 && asOf > due ? daysDiff(due, asOf) : lastLate ? daysDiff(due, lastLate) : 0;
  return {
    dueDate: due, keyRate, daysLate, unpaid, unpaidMonths, unpaidFineBase, fineUnpaid, late,
    paidLate: r2(late.reduce((s, l) => s + l.amount, 0)), finePaidLate, fine: r2(fineUnpaid + finePaidLate), excluded,
  };
}

function daysDiff(a: string, b: string) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export interface DelayRow {
  invoice: SupplierInvoice;
  supplier: Supplier | undefined;
  facts: DelayFacts;
}

/** Invoices unpaid past their due date or paid after it, at `asOf`. */
export function delayReport(invoices: SupplierInvoice[], payments: SupplierPayment[], suppliers: Map<string, Supplier>, asOf = today()): DelayRow[] {
  const byInvoice = groupPayments(payments);
  const rows: DelayRow[] = [];
  for (const inv of invoices) {
    if (inv.status === 'draft' || !isDay(inv.due_date)) continue;
    const facts = delayFacts(inv, byInvoice.get(inv.id) || [], asOf);
    if (facts.unpaidMonths === 0 && facts.late.length === 0) continue;
    rows.push({ invoice: inv, supplier: suppliers.get(inv.supplier_id), facts });
  }
  return rows.sort((a, b) => b.facts.daysLate - a.facts.daysLate);
}

function groupPayments(payments: SupplierPayment[]) {
  const m = new Map<string, SupplierPayment[]>();
  for (const p of payments) (m.get(p.invoice_id) || m.set(p.invoice_id, []).get(p.invoice_id)!).push(p);
  return m;
}

// ── Declaration ─────────────────────────────────────────────────────────
/** periode 1–4: quarters; 5: the whole year (annual declarations of 2024 and 2025). */
export interface DeclarationPeriod { year: number; period: 1 | 2 | 3 | 4 | 5 }

export function periodRange(p: DeclarationPeriod): { start: string; end: string; label: string; deadline: string } {
  const y = p.year;
  if (p.period === 5) return { start: `${y}-01-01`, end: `${y}-12-31`, label: `Année ${y}`, deadline: `${y + 1}-03-31` };
  const m0 = (p.period - 1) * 3 + 1;
  const start = `${y}-${String(m0).padStart(2, '0')}-01`;
  const end = addDays(addMonths(start, 3), -1);
  // Before the end of the month following the quarter.
  const deadline = addDays(addMonths(start, 4), -1);
  return { start, end, label: `T${p.period} ${y}`, deadline };
}

/** DGI codes (Annexe 2): 1 espèces, 2 chèque, 3 prélèvement, 4 virement, 5 effets. Others have no code. */
export const DGI_PAYMENT_MODE: Partial<Record<SupplierPaymentMode, string>> = {
  especes: '1', cheque: '2', virement: '4', effet: '5',
};

export interface DeclarationLine {
  invoice: SupplierInvoice;
  supplier: Supplier | undefined;
  facts: DelayFacts;
  /** Fields of the SIMPL form for this invoice, in the XSD order. */
  fields: DeclarationFields;
  missing: string[];
}

export interface DeclarationFields {
  identifiantFiscal: string;
  ice: string;
  numRC: string;
  nom: string;
  prenom: string;
  raisonSociale: string;
  adresseSiegeSocial: string;
  numFacture: string;
  dateEmission: string;
  natureMarchandise: string;
  dateLivraisonMarchandise: string;
  datePrevuePaiement: string;
  dateConvenuePaiementFacture: string;
  montantFactureTtc: number;
  montantNonEncorePaye: number;
  nombreMoisRetardNonPaye: number;
  montantPayeHorsDelai: number;
  datePaiementHorsDelai: string;
  nombreRetardHorsDelai: number;
  montantObjetDeLitige: number;
  dateRecoursJudiciaire: string;
  montantApresJugement: number;
  dateJugementDefinitif: string;
  modePaiement: string;
  referencePaiement: string;
  /** Not in the file: SIMPL computes it ("Calculer"); shown as an estimate. */
  amende: number;
}

/**
 * What must be declared for a period: each invoice still unpaid after its
 * due date at the end of the period, or paid (wholly or partly) late during
 * it. Invoices outside the law are left out.
 */
export function declarationLines(p: DeclarationPeriod, invoices: SupplierInvoice[], payments: SupplierPayment[], suppliers: Map<string, Supplier>): DeclarationLine[] {
  const { start, end } = periodRange(p);
  const byInvoice = groupPayments(payments);
  const out: DeclarationLine[] = [];
  for (const inv of invoices) {
    if (inv.status === 'draft' || !isDay(inv.due_date) || inv.invoice_date > end) continue;
    if (exclusionReason(inv)) continue;
    const facts = delayFacts(inv, byInvoice.get(inv.id) || [], end, start);
    if (facts.unpaidMonths === 0 && facts.late.length === 0) continue;
    const s = suppliers.get(inv.supplier_id);
    const person = s?.legal_type === 'personne_physique';
    const lastLate = facts.late[facts.late.length - 1];
    const fields: DeclarationFields = {
      identifiantFiscal: (s?.if_number || '').replace(/\D/g, ''),
      ice: (s?.ice || '').replace(/\s+/g, ''),
      numRC: s?.rc || '',
      nom: person ? s?.name || '' : '',
      prenom: person ? s?.first_name || '' : '',
      raisonSociale: person ? '' : s?.name || '',
      adresseSiegeSocial: [s?.address, s?.city].filter(x => (x || '').trim()).join(', '),
      numFacture: inv.supplier_invoice_number,
      dateEmission: inv.invoice_date,
      natureMarchandise: (inv.description || '').trim() || NATURE_LABELS[inv.nature],
      dateLivraisonMarchandise: inv.delivery_date || inv.reception_date || '',
      datePrevuePaiement: inv.due_kind === 'agreed' ? '' : facts.dueDate,
      dateConvenuePaiementFacture: inv.due_kind === 'agreed' ? facts.dueDate : '',
      montantFactureTtc: r2(inv.total_ttc),
      montantNonEncorePaye: facts.unpaidMonths > 0 ? facts.unpaid : 0,
      nombreMoisRetardNonPaye: facts.unpaidMonths,
      montantPayeHorsDelai: facts.paidLate,
      datePaiementHorsDelai: lastLate?.date || '',
      nombreRetardHorsDelai: lastLate?.months || 0,
      montantObjetDeLitige: r2(Number(inv.litigation_amount) || 0),
      dateRecoursJudiciaire: inv.litigation_date || '',
      montantApresJugement: r2(Number(inv.judgment_amount) || 0),
      dateJugementDefinitif: inv.judgment_date || '',
      modePaiement: lastLate ? DGI_PAYMENT_MODE[lastLate.mode as SupplierPaymentMode] || '' : '',
      referencePaiement: lastLate?.reference || '',
      amende: facts.fine,
    };
    const missing: string[] = [];
    if (!fields.identifiantFiscal) missing.push('IF du fournisseur');
    if (!/^\d{15}$/.test(fields.ice)) missing.push('ICE du fournisseur (15 chiffres)');
    if (!fields.numRC) missing.push('RC du fournisseur');
    if (!fields.adresseSiegeSocial) missing.push('adresse du fournisseur');
    if (!fields.dateLivraisonMarchandise) missing.push('date de livraison');
    if (lastLate && !fields.modePaiement) missing.push(`mode de paiement sans code DGI (${lastLate.mode})`);
    out.push({ invoice: inv, supplier: s, facts, fields, missing });
  }
  return out.sort((a, b) => (a.supplier?.name || '').localeCompare(b.supplier?.name || '', 'fr') || a.invoice.invoice_date.localeCompare(b.invoice.invoice_date));
}

export interface DeclarationHeader {
  identifiantFiscal: string;
  year: number;
  period: DeclarationPeriod['period'];
  /** Normal activity, or safeguard / receivership / liquidation proceedings. */
  inProceedings: boolean;
  judgmentDate?: string | null;
  /** Turnover excluding VAT of year N-1, in whole dirhams. */
  turnover: number | null;
}

export function headerMissing(h: DeclarationHeader): string[] {
  const out: string[] = [];
  if (!/^\d+$/.test((h.identifiantFiscal || '').trim())) out.push('IF de la société (paramètres de la société)');
  if (h.turnover == null || !(h.turnover >= 0)) out.push('chiffre d’affaires HT de l’année précédente');
  if (h.inProceedings && !isDay(h.judgmentDate)) out.push('date du jugement d’ouverture de la procédure');
  return out;
}

/** One CSV row per declared invoice (French headers). */
export function declarationCsvRows(lines: DeclarationLine[]): Record<string, unknown>[] {
  return lines.map(l => ({
    'IF fournisseur': l.fields.identifiantFiscal,
    'ICE': l.fields.ice,
    'RC': l.fields.numRC,
    'Nom': l.fields.nom,
    'Prénom': l.fields.prenom,
    'Raison sociale': l.fields.raisonSociale,
    'Adresse du siège': l.fields.adresseSiegeSocial,
    'N° facture': l.fields.numFacture,
    'Date d’émission': frDay(l.fields.dateEmission),
    'Nature': l.fields.natureMarchandise,
    'Date de livraison': frDay(l.fields.dateLivraisonMarchandise || null),
    'Date prévue de paiement': l.fields.datePrevuePaiement ? frDay(l.fields.datePrevuePaiement) : '',
    'Date convenue de paiement': l.fields.dateConvenuePaiementFacture ? frDay(l.fields.dateConvenuePaiementFacture) : '',
    'Montant TTC': l.fields.montantFactureTtc,
    'Non encore payé': l.fields.montantNonEncorePaye,
    'Mois de retard (non payé)': l.fields.nombreMoisRetardNonPaye,
    'Payé hors délai': l.fields.montantPayeHorsDelai,
    'Date du paiement hors délai': l.fields.datePaiementHorsDelai ? frDay(l.fields.datePaiementHorsDelai) : '',
    'Mois de retard (payé hors délai)': l.fields.nombreRetardHorsDelai,
    'Montant en litige': l.fields.montantObjetDeLitige,
    'Date du recours': l.fields.dateRecoursJudiciaire ? frDay(l.fields.dateRecoursJudiciaire) : '',
    'Mode de paiement (code DGI)': l.fields.modePaiement,
    'Référence du paiement': l.fields.referencePaiement,
    'Taux directeur appliqué (%)': l.facts.keyRate.rate,
    'Amende estimée': l.fields.amende,
    'Données manquantes': l.missing.join(', '),
  }));
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const dec = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);

/**
 * The XML of the declaration, per the official XSD (Annexe 4, element names
 * and order, header activiteNormale / procSauvRedressLiquid). Where the XSD
 * cannot be met (it requires every element, typed, and a single invoice),
 * the official example is followed: dates and transaction month/year without
 * a value are left out, text elements are written empty, and every late
 * invoice gets its own <FactureHorsDelai>. To be checked on SIMPL before
 * filing.
 */
export function declarationXml(h: DeclarationHeader, lines: DeclarationLine[]): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', '<DeclarationDelaiPaiement>'];
  const el = (indent: string, name: string, value: string | number | null | undefined, kind: 'text' | 'date' | 'int' | 'dec') => {
    if (kind === 'date') { if (isDay(value as string)) out.push(`${indent}<${name}>${String(value).slice(0, 10)}</${name}>`); return; }
    if (kind === 'int') { out.push(`${indent}<${name}>${Math.round(Number(value) || 0)}</${name}>`); return; }
    if (kind === 'dec') { out.push(`${indent}<${name}>${dec(Number(value))}</${name}>`); return; }
    out.push(`${indent}<${name}>${esc(String(value ?? ''))}</${name}>`);
  };
  const i1 = '\t';
  out.push(`${i1}<identifiantFiscal>${(h.identifiantFiscal || '').replace(/\D/g, '')}</identifiantFiscal>`);
  el(i1, 'annee', h.year, 'int');
  el(i1, 'periode', h.period, 'int');
  el(i1, 'activiteNormale', h.inProceedings ? 2 : 1, 'int');
  el(i1, 'procSauvRedressLiquid', h.inProceedings ? 1 : 0, 'int');
  if (h.inProceedings) el(i1, 'dateJugementOuvrProc', h.judgmentDate, 'date');
  el(i1, 'chiffreAffaire', Math.round(Number(h.turnover) || 0), 'int');
  if (lines.length === 0) {
    out.push(`${i1}<listeFacturesHorsDelai/>`);
  } else {
    out.push(`${i1}<listeFacturesHorsDelai>`);
    const i2 = '\t\t', i3 = '\t\t\t';
    for (const l of lines) {
      const f = l.fields;
      out.push(`${i2}<FactureHorsDelai>`);
      el(i3, 'identifiantFiscal', f.identifiantFiscal, 'text');
      el(i3, 'ice', f.ice, 'text');
      el(i3, 'numRC', f.numRC, 'text');
      el(i3, 'nom', f.nom, 'text');
      el(i3, 'prenom', f.prenom, 'text');
      el(i3, 'raisonSociale', f.raisonSociale, 'text');
      el(i3, 'adresseSiegeSocial', f.adresseSiegeSocial, 'text');
      el(i3, 'numFacture', f.numFacture, 'text');
      el(i3, 'dateEmission', f.dateEmission, 'date');
      el(i3, 'natureMarchandise', f.natureMarchandise, 'text');
      el(i3, 'dateLivraisonMarchandise', f.dateLivraisonMarchandise, 'date');
      // moisTransaction / anneeTransaction / dateConstatation: recurring
      // monthly transactions and public bodies, not handled here.
      el(i3, 'datePrevuePaiement', f.datePrevuePaiement, 'date');
      el(i3, 'dateConvenuePaiementFacture', f.dateConvenuePaiementFacture, 'date');
      el(i3, 'delaiPaiementSecteurActivite', '', 'text');
      el(i3, 'montantFactureTtc', f.montantFactureTtc, 'dec');
      el(i3, 'montantNonEncorePaye', f.montantNonEncorePaye, 'dec');
      el(i3, 'nombreMoisRetardNonPaye', f.nombreMoisRetardNonPaye, 'int');
      el(i3, 'montantPayeHorsDelai', f.montantPayeHorsDelai, 'dec');
      el(i3, 'datePaiementHorsDelai', f.datePaiementHorsDelai, 'date');
      el(i3, 'nombreRetardHorsDelai', f.nombreRetardHorsDelai, 'int');
      el(i3, 'montantObjetDeLitige', f.montantObjetDeLitige, 'dec');
      el(i3, 'dateRecoursJudiciaire', f.dateRecoursJudiciaire, 'date');
      el(i3, 'montantApresJugement', f.montantApresJugement, 'dec');
      el(i3, 'dateJugementDefinitif', f.dateJugementDefinitif, 'date');
      el(i3, 'nombreMoisSuspension', 0, 'int');
      el(i3, 'modePaiement', f.modePaiement, 'text');
      el(i3, 'referencePaiement', f.referencePaiement, 'text');
      out.push(`${i2}</FactureHorsDelai>`);
    }
    out.push(`${i1}</listeFacturesHorsDelai>`);
  }
  out.push('</DeclarationDelaiPaiement>');
  return out.join('\n') + '\n';
}

/** Overdue unpaid amount of a list (for the list's totals). */
export function overdueTotal(invoices: SupplierInvoice[], asOf = today()): number {
  return r2(invoices.filter(i => i.status !== 'draft' && isDay(i.due_date) && i.due_date < asOf).reduce((s, i) => s + remainingOf(i), 0));
}

export { delayStart };
