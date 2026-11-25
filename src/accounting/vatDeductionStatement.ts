// Relevé de déductions (CGI art. 112-II): one line per purchase invoice whose
// VAT is deducted in the period, and the file SIMPL-TVA imports in EDI mode.
//
// Specification: "Cahier des charges du mode EDI du téléservice SIMPL-TVA –
// Relevé des déductions", version 2.0 of 30/11/2017, annex 1 V4.0 (tag
// table) and annex 2 (example file). What it fixes:
// - root <DeclarationReleveDeduction>: <identifiantFiscal> (string),
//   <annee> (string, e.g. 2017), <periode> (1–12 monthly, 1–4 quarterly),
//   <regime> (1 monthly, 2 quarterly; 3 and 4 are cessation returns), then
//   <releveDeductions> with one <rd> per invoice;
// - <rd>: <ord> integer, <num>, <des>, <mht>, <tva>, <ttc> decimals,
//   <refF><if/><nom/><ice/></refF>, <tx> decimal, <prorata> (optional since
//   V2.0, 100 % when absent), <mp><id/></mp> (1 espèces, 2 chèque,
//   3 prélèvement, 4 virement, 5 effet, 6 compensation, 7 autres),
//   <dpai> and <dfac> as AAAA-MM-JJ;
// - the XML "doit être compressé (sous format .zip)"; "Le nom du fichier est
//   libre" (meaningful names recommended); at most 1 Mo compressed;
// - a draft VAT return for the same IF and period must already exist on
//   SIMPL-TVA, otherwise the file is rejected.
// The example file is UTF-8 with a byte-order mark, CRLF line ends, tabs, no
// XML declaration and amounts with two decimals: the file below follows it.
// No XSD is published.
//
// A payment whose whole VAT was lost to the cash limits deducts nothing and
// gets no line. One <rd> holds one rate and one payment (mode and date): an invoice paid
// in two goes, or with two rates, gives several lines with the same <num>.
// The amounts are those of the part paid and deducted in the period: <tva>
// is the deductible VAT before the prorata (the prorata has its own tag),
// less the VAT lost to the cash limits; <ttc> = <mht> + <tva>.

import { zipSync } from 'fflate';
import { r2 } from './supplierInvoices';
import { PAYMENT_MODE_CODE_LABELS, type DeductionItem, type VatPeriod, type VatReturnResult } from './vatReturn';

export interface DeductionRow {
  ord: number;
  num: string;
  des: string;
  mht: number;
  tva: number;
  ttc: number;
  if: string;
  nom: string;
  ice: string;
  tx: number;
  prorata: number;
  mp: number;
  dpai: string;
  dfac: string;
  /** Not in the file: for the CSV and the checks. */
  registerNumber: string;
  category: DeductionItem['category'];
  late: boolean;
}

/** The relevé lines: deduction items merged per payment and rate, in payment order. */
export function deductionRows(r: Pick<VatReturnResult, 'deductions'>): DeductionRow[] {
  const groups = new Map<string, { first: DeductionItem; ht: number; vat: number }>();
  for (const i of r.deductions.items) {
    const k = `${i.paymentId}|${i.rate}`;
    const g = groups.get(k) || { first: i, ht: 0, vat: 0 };
    g.ht += i.ht; g.vat += i.vat;
    groups.set(k, g);
  }
  return [...groups.values()]
    // A payment whose VAT was all lost (cash limits) deducts nothing: no line.
    .filter(g => Math.abs(r2(g.vat)) >= 0.005)
    .sort((a, b) => a.first.paymentDate.localeCompare(b.first.paymentDate) || a.first.supplierName.localeCompare(b.first.supplierName, 'fr') || a.first.invoiceNumber.localeCompare(b.first.invoiceNumber) || b.first.rate - a.first.rate)
    .map((g, idx) => {
      const i = g.first;
      const mht = r2(g.ht), tva = r2(g.vat);
      return {
        ord: idx + 1, num: i.invoiceNumber, des: i.description || '', mht, tva, ttc: r2(mht + tva),
        if: i.supplierIf, nom: i.supplierName, ice: i.supplierIce, tx: i.rate, prorata: r.deductions.prorata,
        mp: i.modeCode, dpai: i.paymentDate, dfac: i.invoiceDate, registerNumber: i.registerNumber,
        // Lines of one rate in several categories: the file has no category; the CSV shows the first.
        category: i.category, late: !!i.late,
      };
    });
}

export interface StatementIssue { level: 'error' | 'warning'; message: string }

/** What is missing before the file can be sent. Errors block the export. */
export function deductionStatementIssues(rows: DeductionRow[], companyIf: string): StatementIssue[] {
  const out: StatementIssue[] = [];
  const ifn = (companyIf || '').trim();
  if (!ifn) out.push({ level: 'error', message: 'Identifiant fiscal (IF) de la société manquant : renseignez-le dans les paramètres de la société.' });
  else if (!/^\d+$/.test(ifn)) out.push({ level: 'error', message: `Identifiant fiscal de la société « ${ifn} » : chiffres uniquement.` });
  if (!rows.length) out.push({ level: 'warning', message: 'Aucune facture déduite sur la période : pas de relevé à envoyer.' });
  for (const r of rows) {
    const who = `Ligne ${r.ord} (${r.nom || 'fournisseur ?'}, facture ${r.num || '?'})`;
    if (!r.if) out.push({ level: 'error', message: `${who} : IF du fournisseur manquant.` });
    else if (!/^\d+$/.test(r.if)) out.push({ level: 'error', message: `${who} : IF « ${r.if} » non numérique.` });
    if (!r.ice) out.push({ level: 'error', message: `${who} : ICE du fournisseur manquant.` });
    else if (!/^\d{15}$/.test(r.ice)) out.push({ level: 'warning', message: `${who} : ICE « ${r.ice} » sans les 15 chiffres attendus.` });
    if (!r.nom.trim() || r.nom === '—') out.push({ level: 'error', message: `${who} : nom du fournisseur manquant.` });
    if (!r.num.trim()) out.push({ level: 'error', message: `${who} : numéro de facture manquant.` });
    if (!r.des.trim()) out.push({ level: 'warning', message: `${who} : désignation vide (ajoutez une description à la facture).` });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.dfac) || !/^\d{4}-\d{2}-\d{2}$/.test(r.dpai)) out.push({ level: 'error', message: `${who} : date de facture ou de paiement invalide.` });
    if (r.mp === 7) out.push({ level: 'warning', message: `${who} : mode de paiement déclaré « 7 – autres » : à vérifier.` });
    if (r.tva <= 0) out.push({ level: 'warning', message: `${who} : TVA nulle ou négative.` });
  }
  return out;
}

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dec = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
/** The prorata as a plain number ("80", "82.5"): the example writes "70". */
const pct = (n: number) => String(Math.round((Number(n) || 0) * 100) / 100);

/** <regime> of the file: 1 monthly, 2 quarterly. */
export const edRegime = (p: Pick<VatPeriod, 'type'>) => (p.type === 'M' ? 1 : 2);

/** The XML of the relevé, as in the specification's example (BOM, CRLF, tabs). */
export function deductionStatementXml(rows: DeductionRow[], companyIf: string, period: Pick<VatPeriod, 'type' | 'year' | 'index'>): string {
  const L: string[] = [];
  L.push('<DeclarationReleveDeduction>');
  L.push(`\t<identifiantFiscal>${esc((companyIf || '').trim())}</identifiantFiscal>`);
  L.push(`\t<annee>${period.year}</annee>`);
  L.push(`\t<periode>${period.index}</periode>`);
  L.push(`\t<regime>${edRegime(period)}</regime>`);
  L.push('\t<releveDeductions>');
  for (const r of rows) {
    L.push('\t\t<rd>');
    L.push(`\t\t\t<ord>${r.ord}</ord>`);
    L.push(`\t\t\t<num>${esc(r.num)}</num>`);
    L.push(`\t\t\t<des>${esc(r.des)}</des>`);
    L.push(`\t\t\t<mht>${dec(r.mht)}</mht>`);
    L.push(`\t\t\t<tva>${dec(r.tva)}</tva>`);
    L.push(`\t\t\t<ttc>${dec(r.ttc)}</ttc>`);
    L.push('\t\t\t<refF>');
    L.push(`\t\t\t\t<if>${esc(r.if)}</if>`);
    L.push(`\t\t\t\t<nom>${esc(r.nom)}</nom>`);
    L.push(`\t\t\t\t<ice>${esc(r.ice)}</ice>`);
    L.push('\t\t\t</refF>');
    L.push(`\t\t\t<tx>${dec(r.tx)}</tx>`);
    L.push(`\t\t\t<prorata>${pct(r.prorata)}</prorata>`);
    L.push('\t\t\t<mp>');
    L.push(`\t\t\t\t<id>${r.mp}</id>`);
    L.push('\t\t\t</mp>');
    L.push(`\t\t\t<dpai>${r.dpai}</dpai>`);
    L.push(`\t\t\t<dfac>${r.dfac}</dfac>`);
    L.push('\t\t</rd>');
  }
  L.push('\t</releveDeductions>');
  L.push('</DeclarationReleveDeduction>');
  return '﻿' + L.join('\r\n');
}

/** File name (free per the specification): form, IF, year and period. */
export function deductionStatementFileName(companyIf: string, period: Pick<VatPeriod, 'type' | 'year' | 'index'>, ext: 'xml' | 'zip' | 'csv'): string {
  const id = (companyIf || '').replace(/[^0-9A-Za-z]/g, '') || 'IF';
  return `ReleveDeductions_${id}_${period.year}_${period.type === 'M' ? 'M' : 'T'}${String(period.index).padStart(2, '0')}.${ext}`;
}

/** The specification's limit: 1 Mo once compressed. */
export const RD_MAX_ZIP_BYTES = 1024 * 1024;

/** The XML zipped, as SIMPL-TVA requires. Bytes copied into this realm's Uint8Array (fflate checks instanceof). */
export function zipDeductionStatement(xml: string, xmlName: string): Uint8Array {
  return zipSync({ [xmlName]: new Uint8Array(new TextEncoder().encode(xml)) });
}

const CATEGORY_SHORT: Record<DeductionItem['category'], string> = { achats: 'Achats', services: 'Services', immobilisations: 'Immobilisation' };

/** CSV rows (French headers) of the relevé, in the order of the file. */
export function deductionCsvRows(rows: DeductionRow[]): Record<string, string | number>[] {
  const fr = (d: string) => d.split('-').reverse().join('/');
  return rows.map(r => ({
    'N° ordre': r.ord,
    'N° facture': r.num,
    'Désignation': r.des,
    'Montant HT': r.mht,
    'TVA': r.tva,
    'TTC': r.ttc,
    'IF fournisseur': r.if,
    'Fournisseur': r.nom,
    'ICE fournisseur': r.ice,
    'Taux %': r.tx,
    'Prorata %': r.prorata,
    'Mode de paiement': `${r.mp} - ${PAYMENT_MODE_CODE_LABELS[r.mp] || ''}`,
    'Date de paiement': fr(r.dpai),
    'Date de facture': fr(r.dfac),
    'Catégorie': CATEGORY_SHORT[r.category],
    'N° registre': r.registerNumber,
    'Reprise période antérieure': r.late ? 'oui' : '',
  }));
}
