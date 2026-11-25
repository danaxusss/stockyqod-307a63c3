// Exports of the reconciliation "stock facturé / stock réel": the title and
// the notes shared by the CSV and the PDF, and the CSV rows (write them with
// ledgerExport's toCsv: ";", BOM, comma decimals). Pure.

import { frDay, VALUATION_METHOD } from './stockValuation';
import { reconTotals, type ReconLine, type Reconciliation } from './invoicedStock';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const clean = (n: number) => Math.round((Number(n) || 0) * 1e6) / 1e6;
const csvAmount = (v: number) => r2(v).toFixed(2).replace('.', ',');
const csvQty = (v: number) => String(clean(v)).replace('.', ',');
const pad = (n: number) => String(n).padStart(2, '0');
// Straight apostrophes: these texts also go into the PDF, whose standard font may drop ’.
const money = (v: number) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(r2(v)).replace(/[\u202f\u00a0]/g, ' ');

export const reconTitle = (day: string) => `Rapprochement stock facturé / stock réel au ${frDay(day)}`;

export const SUPPLIER_CREDIT_NOTE_NOTE = "Les avoirs fournisseurs (retours de marchandises à un fournisseur) ne sont pas encore gérés dans Stocky : rien ne diminue les quantités achetées sur factures.";
export const ISSUER_NOTE = "Les ventes sont comptées dans la société qui a émis la facture, même si le devis ou le bon de livraison dépend d'une autre société du groupe.";
export const GAP_NOTE = 'Écart = stock réel - stock facturé. Valeurs hors taxe au coût moyen pondéré à la date, signées.';

export interface ReconExportContext {
  company: string;
  day: string;
  /** Opening date, or null when the count starts from zero. */
  openingAsOf: string | null;
  producedAt: Date;
  /** Filters applied to the lines, in words ("écarts seulement", "marque ATA"…). */
  filters?: string[];
  /** Credit notes not put back in stock were counted as returns. */
  countUnreturnedCredits?: boolean;
}

/** The notes printed under the table: what the figures do not include. */
export function reconNotes(rec: Pick<Reconciliation, 'uncounted' | 'creditNotes'>, ctx: Pick<ReconExportContext, 'openingAsOf' | 'countUnreturnedCredits'>): string[] {
  const notes: string[] = [];
  notes.push(ctx.openingAsOf
    ? `Ouverture au ${frDay(ctx.openingAsOf)} : les factures datées de ce jour ou avant sont comprises dans l'ouverture.`
    : "Aucune ouverture enregistrée : le stock facturé part de zéro et n'a de sens qu'une fois l'ouverture saisie.");
  const u = rec.uncounted;
  if (u.saleLines > 0) notes.push(`${u.saleLines} ligne(s) de factures sans article du catalogue (${money(u.saleAmountHt)} HT) : non comptées.`);
  if (u.creditLines > 0) notes.push(`${u.creditLines} ligne(s) d'avoirs sans article du catalogue (${money(u.creditAmountHt)} HT) : non comptées.`);
  const un = rec.creditNotes.unreturned;
  if (un.length > 0) {
    const amount = r2(un.reduce((s, c) => s + c.amountHt, 0));
    notes.push(ctx.countUnreturnedCredits
      ? `${un.length} avoir(s) avec des articles non remis en stock (${money(amount)} HT) : comptés comme retours de marchandises, à la demande.`
      : `${un.length} avoir(s) avec des articles non remis en stock (${money(amount)} HT) : traités comme des réductions de prix, non comptés.`);
  }
  if (rec.creditNotes.withoutGoods.length > 0) {
    notes.push(`${rec.creditNotes.withoutGoods.length} avoir(s) sans lignes d'articles (réductions de prix) : non comptés.`);
  }
  notes.push(SUPPLIER_CREDIT_NOTE_NOTE, ISSUER_NOTE);
  return notes;
}

export function reconCsvRows(lines: ReconLine[], rec: Pick<Reconciliation, 'uncounted' | 'creditNotes'>, ctx: ReconExportContext): unknown[][] {
  const at = ctx.producedAt;
  const t = reconTotals(lines);
  const rows: unknown[][] = [
    ['Société', ctx.company],
    ['État', reconTitle(ctx.day)],
    ['Ouverture', ctx.openingAsOf ? `au ${frDay(ctx.openingAsOf)}` : 'aucune (stock facturé depuis zéro)'],
    ['Valorisation', VALUATION_METHOD],
    ['Écart', GAP_NOTE],
    ...(ctx.filters && ctx.filters.length ? [['Filtres', ctx.filters.join(', ')]] : []),
    ['Édité le', `${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()} ${pad(at.getHours())}:${pad(at.getMinutes())}`],
    ['Logiciel', 'Stocky'],
    [],
    ['Référence', 'Désignation', 'Marque', 'Ouverture', 'Acheté (factures fournisseurs)', 'Vendu (factures clients)', 'Retourné (avoirs)',
      'Stock facturé', 'Stock réel', 'Écart', 'Coût unitaire HT', 'Valeur stock facturé HT', 'Valeur stock réel HT', "Valeur de l'écart HT"],
  ];
  for (const l of lines) {
    rows.push([
      l.barcode, l.name, l.brand, csvQty(l.opening), csvQty(l.bought), csvQty(l.sold), csvQty(l.returned),
      csvQty(l.invoiced), csvQty(l.real), csvQty(l.gap), csvAmount(l.unitCost), csvAmount(l.invoicedValue), csvAmount(l.realValue), csvAmount(l.gapValue),
    ]);
  }
  rows.push([]);
  rows.push(['Total', `${t.references} référence(s), ${t.gapLines} avec un écart`, '', csvQty(t.opening), csvQty(t.bought), csvQty(t.sold), csvQty(t.returned),
    csvQty(t.invoiced), csvQty(t.real), csvQty(t.gap), '', csvAmount(t.invoicedValue), csvAmount(t.realValue), csvAmount(t.gapValue)]);
  rows.push([]);
  for (const n of reconNotes(rec, ctx)) rows.push(['Note', n]);
  return rows;
}
