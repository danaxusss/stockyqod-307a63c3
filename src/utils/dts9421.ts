// Annual salary return ("déclaration des traitements et salaires", form 9421)
// for the DGI's SIMPL-IR portal, in EDI mode (XML upload).
//
// Source: "Cahier des charges du mode EDI / Simpl-IR – Déclaration des
// traitements et salaires", version 5.1 (27 July 2026), its Annexe 1 (tag ↔
// form field), Annexe 2 (code lists) and the example file
// EDI_DTS_Exemples_V5.1.xml. No XSD is published. Where the annex and the
// example differ, the cahier des charges says the file must match "exactement
// tel que spécifié dans l'exemple": element order and presence inside a record
// follow the example; lists the example does not show (exempt staff) are
// written in the annex's place and only when they have someone in them.
//
// Everything here is pure: the page loads the data and calls these.

import { zipSync } from 'fflate';
import type { Employee, Payslip } from '../types';
import type { PayrollSettings } from './payrollDefaults';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

// ── Categories ──────────────────────────────────────────────────────────────

/**
 * Which list of the return a person goes in: permanent staff (état du
 * personnel permanent), occasional pay (CGI art. 58-C), trainees with the
 * art. 57-16° exemption, employees exempt under art. 57-20° (new companies)
 * or art. 247-XXXIII (first job).
 */
export type DtsCategory = 'permanent' | 'occasionnel' | 'stagiaire' | 'exonere_57_20' | 'exonere_247';

export const DTS_CATEGORY_LABELS: Record<DtsCategory, string> = {
  permanent: 'Personnel permanent',
  occasionnel: 'Personnel occasionnel',
  stagiaire: 'Stagiaire (art. 57-16°)',
  exonere_57_20: 'Exonéré (art. 57-20°)',
  exonere_247: 'Exonéré premier emploi (art. 247-XXXIII)',
};

export type DtsEmployeeFields = Pick<Employee, 'full_name' | 'cin' | 'cnss_number' | 'marital_status' | 'contract_type' | 'hire_date' | 'date_sortie' | 'matricule' | 'position' | 'birth_date'> & {
  last_name?: string | null;
  first_name?: string | null;
  address?: string | null;
  residence_card?: string | null;
  tax_id?: string | null;
  dts_category?: DtsCategory | null;
};

/**
 * The employee's list: the one chosen on the employee, else a "Stage"
 * contract is a trainee (the contract type another change adds) and anyone
 * else permanent staff.
 */
export function dtsCategoryOf(e: Pick<DtsEmployeeFields, 'dts_category' | 'contract_type'>): DtsCategory {
  if (e.dts_category && e.dts_category in DTS_CATEGORY_LABELS) return e.dts_category;
  return (e.contract_type as string) === 'Stage' ? 'stagiaire' : 'permanent';
}

// ── Code lists (Annexe 2) ───────────────────────────────────────────────────

/** Family situation code (Annexe 2 §1): C, M, V, D. */
export function familySituationCode(status: Employee['marital_status'] | null | undefined): 'C' | 'M' | 'V' | 'D' | null {
  switch (status) {
    case 'celibataire': return 'C';
    case 'marie': return 'M';
    case 'veuf': return 'V';
    case 'divorce': return 'D';
    default: return null;
  }
}

export type IrPaymentMode = 'ES' | 'CH' | 'SIR';
export const IR_PAYMENT_MODES: Record<IrPaymentMode, string> = { ES: 'Espèces', CH: 'Chèque', SIR: 'Télépaiement' };

/** Payment mode code (Annexe 2 §4); anything unknown is refused. */
export function paymentModeCode(mode: string | null | undefined): IrPaymentMode | null {
  return mode === 'ES' || mode === 'CH' || mode === 'SIR' ? mode : null;
}

/**
 * Professional-expense rate codes of Annexe 2 §2 for ordinary employees
 * (the TPP.* codes, valid from 2009; TPP.20 ended on 31/12/2022). The TAS.*
 * codes are for sports companies and are not produced here.
 */
const FRAIS_PRO_CODES: { rate: number; code: string; until: number }[] = [
  { rate: 0.20, code: 'TPP.20.2009', until: 2022 },
  { rate: 0.25, code: 'TPP.25.2009', until: 2999 },
  { rate: 0.35, code: 'TPP.35.2009', until: 2999 },
  { rate: 0.40, code: 'TPP.40.2009', until: 2999 },
  { rate: 0.45, code: 'TPP.45.2009', until: 2999 },
];

export function fraisProRateCode(rate: number, year: number): string | null {
  const hit = FRAIS_PRO_CODES.find(c => Math.abs(c.rate - rate) < 1e-9 && year <= c.until);
  return hit ? hit.code : null;
}

/** Rate of CGI art. 59-I-A for an annual gross taxable income. */
export function annualFraisProRate(annualTaxableGross: number, s: Pick<PayrollSettings, 'frais_pro_low' | 'frais_pro_high' | 'frais_pro_threshold'>): number {
  return annualTaxableGross <= s.frais_pro_threshold ? s.frais_pro_low : s.frais_pro_high;
}

/**
 * The rate code of a person's year: the rate the payslips actually applied
 * (professional expenses ÷ taxable gross), so the file agrees with the
 * amounts withheld. The payroll applies the rate month by month on the
 * annualised salary, so a partial year can differ from the annual rule.
 * When the amounts hit the annual cap, the high rate; when no single rate
 * fits (it changed during the year), the annual rule, flagged.
 */
export function rateCodeFor(fraisPro: number, taxableGross: number, year: number, s: Pick<PayrollSettings, 'frais_pro_low' | 'frais_pro_high' | 'frais_pro_threshold' | 'frais_pro_cap'>): { code: string | null; mixed: boolean } {
  const annual = annualFraisProRate(taxableGross, s);
  if (taxableGross <= 0) return { code: fraisProRateCode(annual, year), mixed: false };
  const effective = fraisPro / taxableGross;
  const hit = FRAIS_PRO_CODES.find(c => year <= c.until && Math.abs(effective - c.rate) < 0.005);
  if (hit) return { code: hit.code, mixed: false };
  if (fraisPro >= s.frais_pro_cap - 1) return { code: fraisProRateCode(s.frais_pro_high, year), mixed: false };
  return { code: fraisProRateCode(annual, year), mixed: true };
}

// ── Figures of the year ─────────────────────────────────────────────────────

/** What the return needs from one validated payslip. */
export interface DtsPayslipFigures {
  month: number;
  gross: number;
  taxableGross: number;
  netTaxable: number;
  fraisPro: number;
  /** CNSS + AMO + CIMR employee contributions (art. 79-I-8°). */
  contributions: number;
  ir: number;
  days: number;
  dependents: number | null;
  /** Taxable bases worked out again from the payslip's lines (older payslip). */
  rebuilt: boolean;
}

/** Bases a payslip saved before 2026 did not store, worked out from its lines. */
export interface RebuiltBases { brut_imposable: number; net_imposable: number; cnss_base: number }

/**
 * The figures of a validated payslip: its stored amounts, and for an older
 * payslip without stored bases, the bases worked out from its own lines.
 */
export function payslipFigures(p: Payslip, rebuilt?: RebuiltBases | null): DtsPayslipFigures {
  const missing = p.ir_taxable_gross == null || p.net_taxable == null;
  const taxableGross = p.ir_taxable_gross ?? rebuilt?.brut_imposable ?? p.total_gross;
  const netTaxable = p.net_taxable ?? rebuilt?.net_imposable
    ?? Math.max(0, r2(taxableGross - p.frais_pro - p.cnss_employee - p.amo_employee - p.cimr_employee));
  return {
    month: p.period_month,
    gross: r2(p.total_gross),
    taxableGross: r2(taxableGross),
    netTaxable: r2(netTaxable),
    fraisPro: r2(p.frais_pro),
    contributions: r2(p.cnss_employee + p.amo_employee + p.cimr_employee),
    ir: r2(p.ir_amount),
    days: Number(p.cnss_days ?? 26),
    dependents: p.dependents_count ?? null,
    rebuilt: missing,
  };
}

/** One person's line of the return, before it is written out. */
export interface DtsPerson {
  employeeId: string;
  category: DtsCategory;
  lastName: string;
  firstName: string;
  /** True when the surname / first name were split from the full name. */
  nameSplit: boolean;
  address: string;
  cin: string;
  residenceCard: string;
  cnss: string;
  taxId: string;
  matricule: string;
  profession: string;
  hireDate: string | null;
  exitDate: string | null;
  birthDate: string | null;
  familyCode: 'C' | 'M' | 'V' | 'D' | null;
  dependents: number;
  /** Gross salaries, wages and allowances paid (art. 79-I-4° and 5°). */
  gross: number;
  /** Exempt part of the gross (gross − taxable gross). */
  exempt: number;
  taxableGross: number;
  fraisPro: number;
  contributions: number;
  /** Other deductions from taxable income: none in this payroll. */
  otherDeductions: number;
  /** Social-housing loan instalments (art. 79-I-10°): not recorded by this payroll. */
  housingLoan: number;
  netTaxable: number;
  ir: number;
  days: number;
  rateCode: string | null;
  /** No single professional-expense rate fits the year's amounts. */
  rateMixed: boolean;
  months: number[];
  rebuiltMonths: number[];
  /** Present on 31 December (headcount of the return). */
  presentAtYearEnd: boolean;
}

/**
 * Surname and first name. Stored separately when filled in on the employee;
 * otherwise the full name is split: first word = first name, rest = surname
 * (the usual "Prénom Nom" order of the employee list), flagged for checking.
 */
export function splitName(e: Pick<DtsEmployeeFields, 'full_name' | 'last_name' | 'first_name'>): { lastName: string; firstName: string; split: boolean } {
  const last = (e.last_name || '').trim();
  const first = (e.first_name || '').trim();
  if (last || first) return { lastName: last, firstName: first, split: false };
  const words = (e.full_name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return { lastName: words[0] || '', firstName: '', split: true };
  return { firstName: words[0], lastName: words.slice(1).join(' '), split: true };
}

/** End of a year, as an ISO date. */
const yearEnd = (year: number) => `${year}-12-31`;

/**
 * One person's annual figures from the year's validated payslips (sorted by
 * month). The frais-pro rate code comes from the annual taxable gross.
 */
export function buildPerson(employeeId: string, e: DtsEmployeeFields, figures: DtsPayslipFigures[], year: number, settings: PayrollSettings): DtsPerson {
  const sorted = [...figures].sort((a, b) => a.month - b.month);
  const sum = (f: (x: DtsPayslipFigures) => number) => r2(sorted.reduce((s, x) => s + f(x), 0));
  const gross = sum(x => x.gross);
  const taxableGross = sum(x => x.taxableGross);
  const name = splitName(e);
  const lastDependents = [...sorted].reverse().find(x => x.dependents != null)?.dependents;
  const dependents = Math.min(Math.max(0, Number(lastDependents ?? 0)), settings.family_ded_max);
  const exit = e.date_sortie ? e.date_sortie.slice(0, 10) : null;
  const fraisPro = sum(x => x.fraisPro);
  const rate = rateCodeFor(fraisPro, taxableGross, year, settings);
  return {
    employeeId,
    category: dtsCategoryOf(e),
    lastName: name.lastName,
    firstName: name.firstName,
    nameSplit: name.split,
    address: (e.address || '').trim(),
    cin: (e.cin || '').trim(),
    residenceCard: (e.residence_card || '').trim(),
    cnss: (e.cnss_number || '').trim(),
    taxId: (e.tax_id || '').trim(),
    matricule: (e.matricule || '').trim(),
    profession: (e.position || '').trim(),
    hireDate: e.hire_date ? e.hire_date.slice(0, 10) : null,
    exitDate: exit,
    birthDate: e.birth_date ? e.birth_date.slice(0, 10) : null,
    familyCode: familySituationCode(e.marital_status),
    dependents,
    gross,
    exempt: Math.max(0, r2(gross - taxableGross)),
    taxableGross,
    fraisPro,
    contributions: sum(x => x.contributions),
    otherDeductions: 0,
    housingLoan: 0,
    netTaxable: sum(x => x.netTaxable),
    ir: sum(x => x.ir),
    days: sorted.reduce((s, x) => s + (Number(x.days) || 0), 0),
    rateCode: rate.code,
    rateMixed: rate.mixed,
    months: sorted.map(x => x.month),
    rebuiltMonths: sorted.filter(x => x.rebuilt).map(x => x.month),
    presentAtYearEnd: !exit || exit >= yearEnd(year),
  };
}

/** Total deductions of a permanent employee (annex: frais pro + pensions + other + loan instalments). */
export const totalDeduction = (p: Pick<DtsPerson, 'fraisPro' | 'contributions' | 'otherDeductions' | 'housingLoan'>) =>
  r2(p.fraisPro + p.contributions + p.otherDeductions + p.housingLoan);

// ── Company and payments ────────────────────────────────────────────────────

export interface DtsCompany {
  taxId: string;
  companyName: string;
  /** Sole trader filing in their own name; empty for a company. */
  lastName: string;
  firstName: string;
  cin: string;
  communeCode: string;
  address: string;
  cnss: string;
  rc: string;
  tp: string;
  fax: string;
  phone: string;
  email: string;
}

export interface DtsPaymentDetail {
  reference: string;
  receiptNumber: string;
  date: string;
  principal: number;
  penalty: number;
  surcharge: number;
  mode: IrPaymentMode;
}

export interface DtsMonthPayments { month: number; details: DtsPaymentDetail[] }

export interface DtsReturn {
  year: number;
  company: DtsCompany;
  people: DtsPerson[];
  payments: DtsMonthPayments[];
  /**
   * Annexe 2 §5 (2026) caps the family field at 3,600: when SIMPL reads it as
   * the deduction amount, write min(dependants, max) × amount instead of the
   * number of dependants.
   */
  familyFieldAsAmount?: boolean;
  familyDeductionPerDependant?: number;
}

// ── Totals of the header ────────────────────────────────────────────────────

export interface DtsTotals {
  headcount: number;
  permanentCount: number;
  occasionalCount: number;
  traineeCount: number;
  ppTaxableGross: number;
  ppNetTaxable: number;
  ppDeductions: number;
  ppIr: number;
  poGross: number;
  poIr: number;
  stgGross: number;
  stgAllowances: number;
  stgDeductions: number;
  stgNetTaxable: number;
  amountPermanent: number;
  amountOccasional: number;
  amountTrainees: number;
  totalPaid: number;
}

const isExempt = (c: DtsCategory) => c === 'exonere_57_20' || c === 'exonere_247';

/**
 * Header totals. Headcounts are people present on 31 December (annex:
 * "Effectif total (au 31 décembre)"); exempt employees count as permanent
 * staff and their pay is in amount (A), but not in the totals "du tableau du
 * personnel permanent", which they are not in.
 */
export function dtsTotals(people: DtsPerson[]): DtsTotals {
  const sum = (ps: DtsPerson[], f: (p: DtsPerson) => number) => r2(ps.reduce((s, p) => s + f(p), 0));
  const pp = people.filter(p => p.category === 'permanent');
  const ex = people.filter(p => isExempt(p.category));
  const po = people.filter(p => p.category === 'occasionnel');
  const stg = people.filter(p => p.category === 'stagiaire');
  const present = (ps: DtsPerson[]) => ps.filter(p => p.presentAtYearEnd).length;
  const amountPermanent = sum([...pp, ...ex], p => p.gross);
  const amountOccasional = sum(po, p => p.gross);
  const amountTrainees = sum(stg, p => p.gross);
  return {
    headcount: present(people),
    permanentCount: present([...pp, ...ex]),
    occasionalCount: present(po),
    traineeCount: present(stg),
    ppTaxableGross: sum(pp, p => p.taxableGross),
    ppNetTaxable: sum(pp, p => p.netTaxable),
    ppDeductions: sum(pp, totalDeduction),
    ppIr: sum(pp, p => p.ir),
    poGross: amountOccasional,
    poIr: sum(po, p => p.ir),
    stgGross: amountTrainees,
    stgAllowances: 0,
    stgDeductions: sum(stg, p => p.contributions),
    stgNetTaxable: sum(stg, p => p.netTaxable),
    amountPermanent,
    amountOccasional,
    amountTrainees,
    totalPaid: r2(amountPermanent + amountOccasional + amountTrainees),
  };
}

// ── XML ─────────────────────────────────────────────────────────────────────

/** XML text: special characters escaped, control characters dropped. */
export function xmlText(v: string | number | null | undefined): string {
  return String(v ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    .replace(/\s+/g, ' ').trim();
}

/** Amounts: dot as decimal separator, two decimals (as in the example). */
export const xmlAmount = (n: number) => r2(n).toFixed(2);

const NL = '\r\n';

class XmlWriter {
  private out: string[] = [];
  private depth = 0;
  private pad() { return '\t'.repeat(this.depth); }
  open(tag: string) { this.out.push(`${this.pad()}<${tag}>`); this.depth += 1; }
  close(tag: string) { this.depth -= 1; this.out.push(`${this.pad()}</${tag}>`); }
  leaf(tag: string, value: string) { this.out.push(`${this.pad()}<${tag}>${value}</${tag}>`); }
  text(tag: string, v: string | null | undefined) { this.leaf(tag, xmlText(v)); }
  amount(tag: string, v: number) { this.leaf(tag, xmlAmount(v)); }
  int(tag: string, v: number) { this.leaf(tag, String(Math.round(Number(v) || 0))); }
  /** A date element, left out when there is no date (an empty xs:date is invalid). */
  date(tag: string, v: string | null | undefined) { if (v) this.leaf(tag, v.slice(0, 10)); }
  code(tag: string, v: string) { this.open(tag); this.text('code', v); this.close(tag); }
  /** An empty list wrapper, written as an open and a close tag. */
  emptyList(tag: string) { this.out.push(`${this.pad()}<${tag}></${tag}>`); }
  raw(line: string) { this.out.push(line); }
  /** A tag written as is (the root, with its attributes), children indented under it. */
  openRaw(line: string) { this.out.push(line); this.depth += 1; }
  closeRaw(line: string) { this.depth -= 1; this.out.push(line); }
  toString() { return this.out.join(NL) + NL; }
}

/** Value of the family field: the number of dependants, or the deduction amount (see DtsReturn). */
export function familyFieldValue(p: Pick<DtsPerson, 'dependents'>, r: Pick<DtsReturn, 'familyFieldAsAmount' | 'familyDeductionPerDependant'>): number {
  return r.familyFieldAsAmount ? Math.round(p.dependents * (r.familyDeductionPerDependant || 0)) : p.dependents;
}

function writeIdentity(w: XmlWriter, p: DtsPerson, withCnss: boolean, withPpr: boolean) {
  w.text('nom', p.lastName);
  w.text('prenom', p.firstName);
  w.text('adressePersonnelle', p.address);
  w.text('numCNI', p.cin);
  w.text('numCE', p.residenceCard);
  if (withPpr) w.text('numPPR', '');
  if (withCnss) w.text('numCNSS', p.cnss);
  w.text('ifu', p.taxId);
}

/**
 * The XML file of the return. Element names, order and formats follow the
 * example of the specification (UTF-8, dates AAAA-MM-JJ, amounts with a dot
 * and two decimals, CRLF line ends and tab indentation like the example).
 */
export function buildDtsXml(r: DtsReturn): string {
  const t = dtsTotals(r.people);
  const c = r.company;
  const w = new XmlWriter();
  w.raw('<?xml version="1.0" encoding="UTF-8"?>');
  w.openRaw('<TraitementEtSalaire xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="traitementSalaire.xsd">');
  w.text('identifiantFiscal', c.taxId);
  w.text('nom', c.lastName);
  w.text('prenom', c.firstName);
  w.text('raisonSociale', c.companyName);
  w.leaf('exerciceFiscalDu', `${r.year}-01-01`);
  w.leaf('exerciceFiscalAu', `${r.year}-12-31`);
  w.int('annee', r.year);
  w.code('commune', c.communeCode);
  w.text('adresse', c.address);
  w.text('numeroCIN', c.cin);
  w.text('numeroCNSS', c.cnss);
  w.text('numeroCE', '');
  w.text('numeroRC', c.rc);
  w.text('identifiantTP', c.tp);
  w.text('numeroFax', c.fax);
  w.text('numeroTelephone', c.phone);
  w.text('email', c.email);
  w.int('effectifTotal', t.headcount);
  w.int('nbrPersoPermanent', t.permanentCount);
  w.int('nbrPersoOccasionnel', t.occasionalCount);
  w.int('nbrStagiaires', t.traineeCount);
  // dateObtentionStatusCFC: only for "Casablanca Finance City" companies, not supported.
  w.amount('totalMtRevenuBrutImposablePP', t.ppTaxableGross);
  w.amount('totalMtRevenuNetImposablePP', t.ppNetTaxable);
  w.amount('totalMtTotalDeductionPP', t.ppDeductions);
  w.amount('totalMtIrPrelevePP', t.ppIr);
  w.amount('totalMtBrutSommesPO', t.poGross);
  w.amount('totalIrPrelevePO', t.poIr);
  w.amount('totalMtBrutTraitSalaireSTG', t.stgGross);
  w.amount('totalMtBrutIndemnitesSTG', t.stgAllowances);
  w.amount('totalMtRetenuesSTG', t.stgDeductions);
  w.amount('totalMtRevenuNetImpSTG', t.stgNetTaxable);
  w.amount('totalSommePayeRTS', t.totalPaid);
  w.amount('totalmtAnuuelRevenuSalarial', 0);
  w.amount('totalmtAbondement', 0);
  w.amount('montantPermanent', t.amountPermanent);
  w.amount('montantOccasionnel', t.amountOccasional);
  w.amount('montantStagiaire', t.amountTrainees);

  const byCat = (cat: DtsCategory) => r.people.filter(p => p.category === cat);

  const pp = byCat('permanent');
  if (pp.length === 0) w.emptyList('listPersonnelPermanent');
  else {
    w.open('listPersonnelPermanent');
    for (const p of pp) {
      w.open('PersonnelPermanent');
      writeIdentity(w, p, true, true);
      w.amount('mtBrutTraitementSalaire', p.gross);
      w.int('periode', p.days);
      w.amount('mtExonere', p.exempt);
      w.amount('mtEcheances', p.housingLoan);
      w.int('nbrReductions', familyFieldValue(p, r));
      w.amount('mtIndemnite', 0);
      w.amount('mtAvantages', 0);
      w.amount('mtRevenuBrutImposable', p.taxableGross);
      w.amount('mtFraisProfess', p.fraisPro);
      w.amount('mtCotisationAssur', p.contributions);
      w.amount('mtAutresRetenues', p.otherDeductions);
      w.amount('mtRevenuNetImposable', p.netTaxable);
      w.amount('mtTotalDeduction', totalDeduction(p));
      w.amount('irPreleve', p.ir);
      w.leaf('casSportif', 'false');
      w.leaf('isSocieteSportif', 'false');
      w.text('numMatricule', p.matricule);
      // datePermis / dateAutorisation: housing-loan case only, not recorded.
      w.code('refSituationFamiliale', p.familyCode || '');
      w.code('refTaux', p.rateCode || '');
      w.close('PersonnelPermanent');
    }
    w.close('listPersonnelPermanent');
  }

  // Exempt staff: lists of Annexe 1, not shown in the example; written in the
  // annex's place, only when someone is in them.
  for (const [cat, list, item] of [['exonere_247', 'listPersonnelExonere5725', 'PersonnelExonere5725'], ['exonere_57_20', 'listPersonnelExonere', 'PersonnelExonere']] as const) {
    const ps = byCat(cat);
    if (ps.length === 0) continue;
    w.open(list);
    for (const p of ps) {
      w.open(item);
      writeIdentity(w, p, true, false);
      w.date('dateRecrutement', p.hireDate);
      if (cat === 'exonere_247') {
        w.date('dateNaissance', p.birthDate);
        // datePerteEmploi: art. 247 bis (job loss) only, not recorded.
      }
      w.amount('mtBrutTraitementSalaire', p.gross);
      w.amount('mtIndemniteArgentNature', 0);
      w.amount('mtIndemniteFraisPro', 0);
      w.amount('mtRevenuBrutImposable', p.taxableGross);
      w.amount('mtRetenuesOperees', p.contributions);
      w.amount('mtRevenuNetImposable', p.netTaxable);
      w.int('periode', p.days);
      w.close(item);
    }
    w.close(list);
  }

  const po = byCat('occasionnel');
  if (po.length === 0) w.emptyList('listPersonnelOccasionnel');
  else {
    w.open('listPersonnelOccasionnel');
    for (const p of po) {
      w.open('PersonnelOccasionnel');
      w.text('nom', p.lastName);
      w.text('prenom', p.firstName);
      w.text('adressePersonnelle', p.address);
      w.text('numCNI', p.cin);
      w.text('numCE', p.residenceCard);
      w.text('ifu', p.taxId);
      w.amount('mtBrutSommes', p.gross);
      w.amount('irPreleve', p.ir);
      w.text('profession', p.profession);
      w.close('PersonnelOccasionnel');
    }
    w.close('listPersonnelOccasionnel');
  }

  w.emptyList('listSalariesCFC');

  const stg = byCat('stagiaire');
  if (stg.length === 0) w.emptyList('listStagiaires');
  else {
    w.open('listStagiaires');
    for (const p of stg) {
      w.open('Stagiaire');
      writeIdentity(w, p, true, false);
      w.amount('mtBrutTraitementSalaire', p.gross);
      w.amount('mtBrutIndemnites', 0);
      w.amount('mtRetenues', p.contributions);
      w.amount('mtRevenuNetImposable', p.netTaxable);
      w.int('periode', p.days);
      w.close('Stagiaire');
    }
    w.close('listStagiaires');
  }

  w.emptyList('listBeneficiaires');
  w.emptyList('listBeneficiairesPlanEpargne');

  const months = r.payments.filter(m => m.details.length > 0).sort((a, b) => a.month - b.month);
  if (months.length === 0) w.emptyList('listVersements');
  else {
    w.open('listVersements');
    for (const m of months) {
      const details = [...m.details].sort((a, b) => a.date.localeCompare(b.date));
      w.open('VersementTraitementSalaire');
      w.int('mois', m.month);
      w.amount('totalVersement', details.reduce((s, d) => s + paidTotal(d), 0));
      w.leaf('dateDerniereVersment', details[details.length - 1].date.slice(0, 10));
      w.open('listDetailPaiement');
      for (const d of details) {
        w.open('DetailPaiementTraitementSalaire');
        w.text('reference', d.reference);
        w.amount('totalVerse', paidTotal(d));
        w.amount('principal', d.principal);
        w.amount('penalite', d.penalty);
        w.amount('majorations', d.surcharge);
        w.leaf('dateVersement', d.date.slice(0, 10));
        w.code('refMoyenPaiement', d.mode);
        w.text('numQuittance', d.receiptNumber);
        w.close('DetailPaiementTraitementSalaire');
      }
      w.close('listDetailPaiement');
      w.close('VersementTraitementSalaire');
    }
    w.close('listVersements');
  }
  w.closeRaw('</TraitementEtSalaire>');
  return w.toString();
}

/** Amount of one payment: principal + penalty + surcharge. */
export const paidTotal = (d: Pick<DtsPaymentDetail, 'principal' | 'penalty' | 'surcharge'>) => r2(d.principal + d.penalty + d.surcharge);

/** File name: free per the specification; this one names the form, the IF and the year. */
export function dtsFileName(taxId: string, year: number, ext: 'xml' | 'zip' | 'csv' | 'pdf' = 'xml'): string {
  const id = (taxId || 'IF').replace(/[^0-9A-Za-z]/g, '') || 'IF';
  return `DTS_9421_${id}_${year}.${ext}`;
}

/**
 * The XML in a zip (the DGI's DTS user guide uploads a zipped XML; the
 * specification itself does not mention zipping). The bytes are copied into
 * this realm's Uint8Array, which fflate checks with instanceof.
 */
export function zipDtsXml(xml: string, fileName: string): Uint8Array {
  return zipSync({ [fileName]: new Uint8Array(new TextEncoder().encode(xml)) });
}

/** The specification's size limit for the XML file. */
export const DTS_MAX_BYTES = 15 * 1024 * 1024;

// ── Completeness ────────────────────────────────────────────────────────────

export type IssueLevel = 'error' | 'warning';
export interface DtsIssue {
  level: IssueLevel;
  /** Where to fix it. */
  fix: 'company' | 'declaration' | 'employee' | 'payslips' | 'payments';
  employeeId?: string;
  who: string;
  message: string;
}

const displayName = (p: Pick<DtsPerson, 'lastName' | 'firstName'>) => [p.firstName, p.lastName].filter(Boolean).join(' ') || '—';

/**
 * What the return is missing, company first. Errors are what the
 * specification or CGI art. 79 require (an IF and a name, the commune code,
 * an identity number, address, CNSS number, family situation…); warnings are
 * values to check.
 */
export function dtsCompleteness(r: Pick<DtsReturn, 'company' | 'people'>): DtsIssue[] {
  const out: DtsIssue[] = [];
  const c = r.company;
  const company = (fix: DtsIssue['fix'], level: IssueLevel, message: string) => out.push({ level, fix, who: 'Société', message });
  if (!c.taxId.trim()) company('company', 'error', 'Identifiant fiscal (IF) manquant.');
  else if (!/^\d+$/.test(c.taxId.trim())) company('company', 'warning', `Identifiant fiscal « ${c.taxId} » : attendu en chiffres.`);
  if (!c.companyName.trim() && !(c.lastName.trim() && c.firstName.trim())) company('company', 'error', 'Raison sociale manquante.');
  if (!c.communeCode.trim()) company('declaration', 'error', 'Code commune DGI manquant.');
  else if (!/^\d{3}\.\d{2}\.\d{2}$/.test(c.communeCode.trim())) company('declaration', 'error', `Code commune « ${c.communeCode} » : format attendu 000.00.00.`);
  if (!c.address.trim()) company('company', 'warning', 'Adresse du siège manquante.');
  if (!c.cnss.trim()) company('company', 'warning', 'N° d\'affiliation CNSS manquant.');
  if (!c.rc.trim()) company('company', 'warning', 'N° RC manquant.');
  if (!c.tp.trim()) company('company', 'warning', 'N° de taxe professionnelle (patente) manquant.');

  for (const p of r.people) {
    const add = (level: IssueLevel, message: string, fix: DtsIssue['fix'] = 'employee') =>
      out.push({ level, fix, employeeId: p.employeeId, who: displayName(p), message });
    if (!p.lastName || !p.firstName) add('error', 'Nom et prénom à renseigner séparément.');
    else if (p.nameSplit) add('warning', `Nom « ${p.lastName} » et prénom « ${p.firstName} » déduits du nom complet : à vérifier.`);
    if (!p.address) add('error', 'Adresse personnelle manquante.');
    if (!p.cin && !p.residenceCard) add('error', 'N° CIN ou de carte de séjour manquant.');
    if (p.category === 'occasionnel') {
      if (!p.profession) add('warning', 'Profession (poste) manquante.');
      continue;
    }
    if (!p.cnss) add('error', 'N° CNSS manquant.');
    if (p.category === 'permanent') {
      if (!p.familyCode) add('error', 'Situation familiale manquante.');
      if (!p.rateCode) add('error', 'Taux de frais professionnels sans code DGI.');
    }
    if ((p.category === 'exonere_57_20' || p.category === 'exonere_247') && !p.hireDate) add('error', 'Date d\'embauche manquante.');
    if (p.category === 'exonere_247' && !p.birthDate) add('error', 'Date de naissance manquante.');
    if (!p.hireDate && p.category !== 'exonere_57_20' && p.category !== 'exonere_247') add('warning', 'Date d\'embauche manquante.');
  }
  return out;
}

// ── Consistency ─────────────────────────────────────────────────────────────

/** Annual IR from an annual net taxable income: the year's scale, less family deductions. */
export function annualIr(netTaxable: number, dependents: number, s: Pick<PayrollSettings, 'ir_brackets' | 'family_ded_max' | 'family_ded_per_dep'>): number {
  let gross = 0;
  for (const [, hi, rate, ded] of s.ir_brackets) {
    if (netTaxable <= hi) { gross = Math.max(0, netTaxable * rate - ded); break; }
  }
  const family = Math.min(Math.max(0, dependents), s.family_ded_max) * s.family_ded_per_dep;
  return r2(Math.max(0, gross - family));
}

export interface IrCheck {
  employeeId: string;
  who: string;
  recomputed: number;
  withheld: number;
  /** withheld − recomputed: positive when too much was withheld. */
  diff: number;
}

/**
 * IR withheld over the year against the IR of the annual net taxable income
 * with the year's official scale (permanent and exempt staff). Shown, never
 * corrected here: the regularisation of the payroll run does that.
 */
export function irChecks(people: DtsPerson[], officialSettings: PayrollSettings): IrCheck[] {
  return people
    .filter(p => p.category === 'permanent')
    .map(p => {
      const recomputed = annualIr(p.netTaxable, p.dependents, officialSettings);
      return { employeeId: p.employeeId, who: displayName(p), recomputed, withheld: p.ir, diff: r2(p.ir - recomputed) };
    });
}

export interface MonthGap { employeeId: string; who: string; months: number[] }

const monthStart = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}-01`;
const monthEnd = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

/**
 * Months up to `lastMonth` in which an employee was present (hired, not yet
 * left) but has no validated payslip. Without a hire date, presence starts
 * at the first payslip of the year.
 */
export function missingMonths(year: number, lastMonth: number, people: Pick<DtsPerson, 'employeeId' | 'firstName' | 'lastName' | 'hireDate' | 'exitDate' | 'months'>[]): MonthGap[] {
  const out: MonthGap[] = [];
  for (const p of people) {
    const have = new Set(p.months);
    const first = p.hireDate || (p.months.length ? monthStart(year, Math.min(...p.months)) : null);
    if (!first) continue;
    const gaps: number[] = [];
    for (let m = 1; m <= lastMonth; m++) {
      const present = first <= monthEnd(year, m) && (!p.exitDate || p.exitDate >= monthStart(year, m));
      if (present && !have.has(m)) gaps.push(m);
    }
    if (gaps.length) out.push({ employeeId: p.employeeId, who: displayName(p), months: gaps });
  }
  return out;
}

/** Other checks of the figures, per person and for the IR payments. */
export function dtsWarnings(r: Pick<DtsReturn, 'people' | 'payments'>, irByMonth: Map<number, number>, settings: Pick<PayrollSettings, 'frais_pro_cap'>): DtsIssue[] {
  const out: DtsIssue[] = [];
  const money = (n: number) => xmlAmount(n).replace('.', ',');
  for (const p of r.people) {
    const add = (message: string, fix: DtsIssue['fix'] = 'payslips') => out.push({ level: 'warning', fix, employeeId: p.employeeId, who: displayName(p), message });
    const expected = Math.max(0, r2(p.taxableGross - totalDeduction(p)));
    if (Math.abs(expected - p.netTaxable) > 0.05 && p.netTaxable > 0) add(`Net imposable (${money(p.netTaxable)}) différent de brut imposable − déductions (${money(expected)}).`);
    if (p.fraisPro > settings.frais_pro_cap + 0.05) add(`Frais professionnels (${money(p.fraisPro)}) au-dessus du plafond annuel (${money(settings.frais_pro_cap)}).`);
    if (p.category === 'stagiaire' && p.ir > 0) add(`IR retenu (${money(p.ir)}) sur un stagiaire : la liste des stagiaires n'a pas de case IR.`);
    if ((p.category === 'exonere_57_20' || p.category === 'exonere_247') && p.ir > 0) add(`IR retenu (${money(p.ir)}) sur un salarié déclaré exonéré.`);
    if (p.category === 'permanent' && p.rateMixed) add(`Frais professionnels de ${money(p.fraisPro)} sur ${money(p.taxableGross)} : aucun taux unique, code ${p.rateCode || '—'} retenu.`);
    if (p.rebuiltMonths.length) add(`Bases imposables reconstituées depuis les lignes des bulletins (${p.rebuiltMonths.length} mois).`);
  }
  const paid = new Map(r.payments.map(m => [m.month, r2(m.details.reduce((s, d) => s + d.principal, 0))]));
  for (const [month, ir] of [...irByMonth.entries()].sort((a, b) => a[0] - b[0])) {
    const p = paid.get(month) ?? 0;
    const label = MONTH_NAMES[month - 1];
    if (ir > 0 && p === 0) out.push({ level: 'warning', fix: 'payments', who: label, message: `IR retenu ${money(ir)} : aucun versement saisi.` });
    else if (Math.abs(p - ir) > 0.05) out.push({ level: 'warning', fix: 'payments', who: label, message: `Principal versé ${money(p)} pour un IR retenu de ${money(ir)}.` });
  }
  return out;
}

export const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

// ── Summary for the accountant ──────────────────────────────────────────────

export const RECAP_HEADER = [
  'Liste', 'Nom', 'Prénom', 'CIN / carte séjour', 'N° CNSS', 'Matricule', 'Entrée', 'Sortie', 'Situation', 'Personnes à charge',
  'Jours', 'Brut', 'Exonéré', 'Brut imposable', 'Frais pro.', 'Cotisations', 'Net imposable', 'IR retenu', 'Taux frais pro.',
];

/** One line per person, then the totals: the same figures as the XML. */
export function recapRows(people: DtsPerson[]): (string | number)[][] {
  const order: DtsCategory[] = ['permanent', 'exonere_57_20', 'exonere_247', 'occasionnel', 'stagiaire'];
  const sorted = [...people].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.lastName.localeCompare(b.lastName, 'fr'));
  const n = (v: number) => xmlAmount(v).replace('.', ',');
  const rows: (string | number)[][] = sorted.map(p => [
    DTS_CATEGORY_LABELS[p.category], p.lastName, p.firstName, p.cin || p.residenceCard, p.cnss, p.matricule, p.hireDate || '', p.exitDate || '',
    p.familyCode || '', p.dependents, p.days, n(p.gross), n(p.exempt), n(p.taxableGross), n(p.fraisPro), n(p.contributions), n(p.netTaxable), n(p.ir), p.rateCode || '',
  ]);
  const sum = (f: (p: DtsPerson) => number) => n(people.reduce((s, p) => s + f(p), 0));
  rows.push(['Total', '', '', '', '', '', '', '', '', '', people.reduce((s, p) => s + p.days, 0),
    sum(p => p.gross), sum(p => p.exempt), sum(p => p.taxableGross), sum(p => p.fraisPro), sum(p => p.contributions), sum(p => p.netTaxable), sum(p => p.ir), '']);
  return rows;
}

// ── The year, from the payslips ─────────────────────────────────────────────

export interface DtsYear {
  people: DtsPerson[];
  /** Payslips of the year not validated yet (left out of the return). */
  drafts: Payslip[];
  /** IR withheld per month on validated payslips. */
  irByMonth: Map<number, number>;
  /** Last month the checks look at: December for a past year, else the last month with a payslip. */
  lastMonth: number;
}

/**
 * The people of the return from the year's payslips: only validated
 * payslips count; drafts are listed apart.
 */
export function peopleOfYear(
  year: number,
  payslips: Payslip[],
  employees: Map<string, DtsEmployeeFields>,
  rebuilt: Map<string, RebuiltBases>,
  settings: PayrollSettings,
  today: Date = new Date(),
): DtsYear {
  const ofYear = payslips.filter(p => p.period_year === year);
  const locked = ofYear.filter(p => p.is_locked);
  const byEmployee = new Map<string, DtsPayslipFigures[]>();
  const irByMonth = new Map<number, number>();
  for (const p of locked) {
    const f = payslipFigures(p, rebuilt.get(p.id));
    byEmployee.set(p.employee_id, [...(byEmployee.get(p.employee_id) || []), f]);
    irByMonth.set(p.period_month, r2((irByMonth.get(p.period_month) || 0) + f.ir));
  }
  const people: DtsPerson[] = [];
  for (const [id, figures] of byEmployee) {
    const e = employees.get(id) || ({ full_name: locked.find(p => p.employee_id === id)?.employee?.full_name || '', contract_type: 'CDI' } as DtsEmployeeFields);
    people.push(buildPerson(id, e, figures, year, settings));
  }
  people.sort((a, b) => a.lastName.localeCompare(b.lastName, 'fr') || a.firstName.localeCompare(b.firstName, 'fr'));
  const lastMonth = year < today.getFullYear() ? 12 : Math.max(0, ...ofYear.map(p => p.period_month));
  return { people, drafts: ofYear.filter(p => !p.is_locked), irByMonth, lastMonth };
}
