// Annual salary return (9421, SIMPL-IR EDI V5.1): figures of the year, code
// lists, the XML file, completeness and consistency checks.
import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import type { Payslip } from '../types';
import { officialSettingsFor } from '../utils/payrollDefaults';
import {
  annualIr, buildDtsXml, buildPerson, dtsCategoryOf, dtsCompleteness, dtsFileName, dtsTotals, dtsWarnings, familyFieldValue,
  familySituationCode, fraisProRateCode, irChecks, missingMonths, paymentModeCode, payslipFigures, peopleOfYear, rateCodeFor,
  recapRows, splitName, xmlText, zipDtsXml, type DtsCompany, type DtsEmployeeFields, type DtsReturn,
} from '../utils/dts9421';
import { buildDtsRecapPdf, dtsRecapCsv } from '../utils/dts9421Pdf';

const s2026 = officialSettingsFor(2026);

function slip(id: string, employee_id: string, month: number, f: Partial<Payslip>): Payslip {
  return {
    id, company_id: 'c1', employee_id, period_month: month, period_year: 2026, payslip_number: `PAIE-2026-${id}`, hours_worked: 191,
    base_salary: 0, anciennete_rate: 0, anciennete_amount: 0, other_earnings: 0, total_gross: 0, cnss_employee: 0, amo_employee: 0,
    cimr_employee: 0, frais_pro: 0, ir_amount: 0, other_deductions: 0, total_deductions: 0, net_salary: 0, cnss_employer: 0,
    amo_employer: 0, alloc_familiales: 0, ir_taxable_gross: null, net_taxable: null, cnss_base: null, cnss_days: 26,
    dependents_count: null, ir_regularisation: 0, is_locked: true, items: [], created_at: '', updated_at: '', ...f,
  };
}

const employees = new Map<string, DtsEmployeeFields>([
  ['e1', { full_name: 'Ali Amrani', last_name: 'AMRANI', first_name: 'Ali', cin: 'AB123456', cnss_number: '123456785', marital_status: 'marie',
    contract_type: 'CDI', hire_date: '2020-03-01', matricule: 'M001', address: '1 rue A, Casablanca', position: 'Magasinier' }],
  ['e2', { full_name: 'Sara Bennani', cin: 'BE987654', cnss_number: '', contract_type: 'Stage' as never, hire_date: null, address: '' }],
  ['e3', { full_name: 'Omar Idrissi', last_name: 'IDRISSI', first_name: 'Omar', residence_card: 'E12345', contract_type: 'CDD', dts_category: 'occasionnel',
    position: 'Consultant', address: '3 avenue C, Rabat', hire_date: '2026-01-05' }],
]);

// e1: 10,000 gross with 500 exempt transport, 2 months; 25 % professional expenses.
const e1 = (id: string, m: number, locked = true) => slip(id, 'e1', m, {
  total_gross: 10000, ir_taxable_gross: 9500, frais_pro: 2375, cnss_employee: 268.8, amo_employee: 214.7, net_taxable: 6641.5,
  ir_amount: 800, dependents_count: 2, cnss_base: 9500, is_locked: locked,
});
const payslips: Payslip[] = [
  e1('p1', 1), e1('p2', 2), e1('p3', 3, false),
  slip('p4', 'e2', 2, { total_gross: 3000, ir_taxable_gross: 3000, frais_pro: 1050, cnss_employee: 134.4, amo_employee: 67.8, net_taxable: 1747.8, cnss_days: 20, cnss_base: 3000 }),
  slip('p5', 'e3', 1, { total_gross: 5000, ir_taxable_gross: 5000, frais_pro: 1250, net_taxable: 3750, ir_amount: 1500 }),
];

const company: DtsCompany = {
  taxId: '12345678', companyName: 'Société Test & Fils', lastName: '', firstName: '', cin: '', communeCode: '141.01.01',
  address: '12 Rue <Atlas>', cnss: '1234567', rc: 'RC123', tp: '45678901', fax: '', phone: '0522000000', email: 'paie@test.ma',
};

const year = () => peopleOfYear(2026, payslips, employees, new Map(), s2026, new Date('2026-11-25'));
const theReturn = (): DtsReturn => ({
  year: 2026, company, people: year().people,
  payments: [{ month: 1, details: [{ reference: 'REF1', receiptNumber: 'Q1', date: '2026-02-10', principal: 2300, penalty: 0, surcharge: 0, mode: 'SIR' }] }],
});

const EXPECTED = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<TraitementEtSalaire xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="traitementSalaire.xsd">',
  '\t<identifiantFiscal>12345678</identifiantFiscal>',
  '\t<nom></nom>',
  '\t<prenom></prenom>',
  '\t<raisonSociale>Société Test &amp; Fils</raisonSociale>',
  '\t<exerciceFiscalDu>2026-01-01</exerciceFiscalDu>',
  '\t<exerciceFiscalAu>2026-12-31</exerciceFiscalAu>',
  '\t<annee>2026</annee>',
  '\t<commune>',
  '\t\t<code>141.01.01</code>',
  '\t</commune>',
  '\t<adresse>12 Rue &lt;Atlas&gt;</adresse>',
  '\t<numeroCIN></numeroCIN>',
  '\t<numeroCNSS>1234567</numeroCNSS>',
  '\t<numeroCE></numeroCE>',
  '\t<numeroRC>RC123</numeroRC>',
  '\t<identifiantTP>45678901</identifiantTP>',
  '\t<numeroFax></numeroFax>',
  '\t<numeroTelephone>0522000000</numeroTelephone>',
  '\t<email>paie@test.ma</email>',
  '\t<effectifTotal>3</effectifTotal>',
  '\t<nbrPersoPermanent>1</nbrPersoPermanent>',
  '\t<nbrPersoOccasionnel>1</nbrPersoOccasionnel>',
  '\t<nbrStagiaires>1</nbrStagiaires>',
  '\t<totalMtRevenuBrutImposablePP>19000.00</totalMtRevenuBrutImposablePP>',
  '\t<totalMtRevenuNetImposablePP>13283.00</totalMtRevenuNetImposablePP>',
  '\t<totalMtTotalDeductionPP>5717.00</totalMtTotalDeductionPP>',
  '\t<totalMtIrPrelevePP>1600.00</totalMtIrPrelevePP>',
  '\t<totalMtBrutSommesPO>5000.00</totalMtBrutSommesPO>',
  '\t<totalIrPrelevePO>1500.00</totalIrPrelevePO>',
  '\t<totalMtBrutTraitSalaireSTG>3000.00</totalMtBrutTraitSalaireSTG>',
  '\t<totalMtBrutIndemnitesSTG>0.00</totalMtBrutIndemnitesSTG>',
  '\t<totalMtRetenuesSTG>202.20</totalMtRetenuesSTG>',
  '\t<totalMtRevenuNetImpSTG>1747.80</totalMtRevenuNetImpSTG>',
  '\t<totalSommePayeRTS>28000.00</totalSommePayeRTS>',
  '\t<totalmtAnuuelRevenuSalarial>0.00</totalmtAnuuelRevenuSalarial>',
  '\t<totalmtAbondement>0.00</totalmtAbondement>',
  '\t<montantPermanent>20000.00</montantPermanent>',
  '\t<montantOccasionnel>5000.00</montantOccasionnel>',
  '\t<montantStagiaire>3000.00</montantStagiaire>',
  '\t<listPersonnelPermanent>',
  '\t\t<PersonnelPermanent>',
  '\t\t\t<nom>AMRANI</nom>',
  '\t\t\t<prenom>Ali</prenom>',
  '\t\t\t<adressePersonnelle>1 rue A, Casablanca</adressePersonnelle>',
  '\t\t\t<numCNI>AB123456</numCNI>',
  '\t\t\t<numCE></numCE>',
  '\t\t\t<numPPR></numPPR>',
  '\t\t\t<numCNSS>123456785</numCNSS>',
  '\t\t\t<ifu></ifu>',
  '\t\t\t<mtBrutTraitementSalaire>20000.00</mtBrutTraitementSalaire>',
  '\t\t\t<periode>52</periode>',
  '\t\t\t<mtExonere>1000.00</mtExonere>',
  '\t\t\t<mtEcheances>0.00</mtEcheances>',
  '\t\t\t<nbrReductions>2</nbrReductions>',
  '\t\t\t<mtIndemnite>0.00</mtIndemnite>',
  '\t\t\t<mtAvantages>0.00</mtAvantages>',
  '\t\t\t<mtRevenuBrutImposable>19000.00</mtRevenuBrutImposable>',
  '\t\t\t<mtFraisProfess>4750.00</mtFraisProfess>',
  '\t\t\t<mtCotisationAssur>967.00</mtCotisationAssur>',
  '\t\t\t<mtAutresRetenues>0.00</mtAutresRetenues>',
  '\t\t\t<mtRevenuNetImposable>13283.00</mtRevenuNetImposable>',
  '\t\t\t<mtTotalDeduction>5717.00</mtTotalDeduction>',
  '\t\t\t<irPreleve>1600.00</irPreleve>',
  '\t\t\t<casSportif>false</casSportif>',
  '\t\t\t<isSocieteSportif>false</isSocieteSportif>',
  '\t\t\t<numMatricule>M001</numMatricule>',
  '\t\t\t<refSituationFamiliale>',
  '\t\t\t\t<code>M</code>',
  '\t\t\t</refSituationFamiliale>',
  '\t\t\t<refTaux>',
  '\t\t\t\t<code>TPP.25.2009</code>',
  '\t\t\t</refTaux>',
  '\t\t</PersonnelPermanent>',
  '\t</listPersonnelPermanent>',
  '\t<listPersonnelOccasionnel>',
  '\t\t<PersonnelOccasionnel>',
  '\t\t\t<nom>IDRISSI</nom>',
  '\t\t\t<prenom>Omar</prenom>',
  '\t\t\t<adressePersonnelle>3 avenue C, Rabat</adressePersonnelle>',
  '\t\t\t<numCNI></numCNI>',
  '\t\t\t<numCE>E12345</numCE>',
  '\t\t\t<ifu></ifu>',
  '\t\t\t<mtBrutSommes>5000.00</mtBrutSommes>',
  '\t\t\t<irPreleve>1500.00</irPreleve>',
  '\t\t\t<profession>Consultant</profession>',
  '\t\t</PersonnelOccasionnel>',
  '\t</listPersonnelOccasionnel>',
  '\t<listSalariesCFC></listSalariesCFC>',
  '\t<listStagiaires>',
  '\t\t<Stagiaire>',
  '\t\t\t<nom>Bennani</nom>',
  '\t\t\t<prenom>Sara</prenom>',
  '\t\t\t<adressePersonnelle></adressePersonnelle>',
  '\t\t\t<numCNI>BE987654</numCNI>',
  '\t\t\t<numCE></numCE>',
  '\t\t\t<numCNSS></numCNSS>',
  '\t\t\t<ifu></ifu>',
  '\t\t\t<mtBrutTraitementSalaire>3000.00</mtBrutTraitementSalaire>',
  '\t\t\t<mtBrutIndemnites>0.00</mtBrutIndemnites>',
  '\t\t\t<mtRetenues>202.20</mtRetenues>',
  '\t\t\t<mtRevenuNetImposable>1747.80</mtRevenuNetImposable>',
  '\t\t\t<periode>20</periode>',
  '\t\t</Stagiaire>',
  '\t</listStagiaires>',
  '\t<listBeneficiaires></listBeneficiaires>',
  '\t<listBeneficiairesPlanEpargne></listBeneficiairesPlanEpargne>',
  '\t<listVersements>',
  '\t\t<VersementTraitementSalaire>',
  '\t\t\t<mois>1</mois>',
  '\t\t\t<totalVersement>2300.00</totalVersement>',
  '\t\t\t<dateDerniereVersment>2026-02-10</dateDerniereVersment>',
  '\t\t\t<listDetailPaiement>',
  '\t\t\t\t<DetailPaiementTraitementSalaire>',
  '\t\t\t\t\t<reference>REF1</reference>',
  '\t\t\t\t\t<totalVerse>2300.00</totalVerse>',
  '\t\t\t\t\t<principal>2300.00</principal>',
  '\t\t\t\t\t<penalite>0.00</penalite>',
  '\t\t\t\t\t<majorations>0.00</majorations>',
  '\t\t\t\t\t<dateVersement>2026-02-10</dateVersement>',
  '\t\t\t\t\t<refMoyenPaiement>',
  '\t\t\t\t\t\t<code>SIR</code>',
  '\t\t\t\t\t</refMoyenPaiement>',
  '\t\t\t\t\t<numQuittance>Q1</numQuittance>',
  '\t\t\t\t</DetailPaiementTraitementSalaire>',
  '\t\t\t</listDetailPaiement>',
  '\t\t</VersementTraitementSalaire>',
  '\t</listVersements>',
  '</TraitementEtSalaire>',
].join('\r\n') + '\r\n';

describe('9421 XML', () => {
  it('writes the whole file as the specification\'s example does', () => {
    expect(buildDtsXml(theReturn())).toBe(EXPECTED);
  });

  it('follows the element order of the official example for the header and a permanent employee', () => {
    const xml = buildDtsXml(theReturn());
    const tags = (from: string, to: string) => {
      const part = xml.slice(xml.indexOf(from), xml.indexOf(to));
      return [...part.matchAll(/<(\w+)>/g)].map(m => m[1]);
    };
    // Example EDI_DTS_Exemples_V5.1.xml, header up to the first list (the example also has dateObtentionStatusCFC, CFC companies only).
    expect(tags('<identifiantFiscal>', '<listPersonnelPermanent>').filter(t => t !== 'code')).toEqual([
      'identifiantFiscal', 'nom', 'prenom', 'raisonSociale', 'exerciceFiscalDu', 'exerciceFiscalAu', 'annee', 'commune', 'adresse', 'numeroCIN',
      'numeroCNSS', 'numeroCE', 'numeroRC', 'identifiantTP', 'numeroFax', 'numeroTelephone', 'email', 'effectifTotal', 'nbrPersoPermanent',
      'nbrPersoOccasionnel', 'nbrStagiaires', 'totalMtRevenuBrutImposablePP', 'totalMtRevenuNetImposablePP', 'totalMtTotalDeductionPP',
      'totalMtIrPrelevePP', 'totalMtBrutSommesPO', 'totalIrPrelevePO', 'totalMtBrutTraitSalaireSTG', 'totalMtBrutIndemnitesSTG',
      'totalMtRetenuesSTG', 'totalMtRevenuNetImpSTG', 'totalSommePayeRTS', 'totalmtAnuuelRevenuSalarial', 'totalmtAbondement',
      'montantPermanent', 'montantOccasionnel', 'montantStagiaire',
    ]);
    // The example's PersonnelPermanent, without datePermis / dateAutorisation (no housing loan).
    expect(tags('<PersonnelPermanent>', '</PersonnelPermanent>').filter(t => t !== 'code')).toEqual([
      'PersonnelPermanent', 'nom', 'prenom', 'adressePersonnelle', 'numCNI', 'numCE', 'numPPR', 'numCNSS', 'ifu', 'mtBrutTraitementSalaire',
      'periode', 'mtExonere', 'mtEcheances', 'nbrReductions', 'mtIndemnite', 'mtAvantages', 'mtRevenuBrutImposable', 'mtFraisProfess',
      'mtCotisationAssur', 'mtAutresRetenues', 'mtRevenuNetImposable', 'mtTotalDeduction', 'irPreleve', 'casSportif', 'isSocieteSportif',
      'numMatricule', 'refSituationFamiliale', 'refTaux',
    ]);
  });

  it('writes the exempt lists of the annex only when someone is in them, in the annex\'s place', () => {
    const r = theReturn();
    r.people.push({ ...r.people[0], employeeId: 'e9', category: 'exonere_57_20', lastName: 'NOUVEAU', firstName: 'Nadia', hireDate: '2025-06-01', ir: 0 });
    r.people.push({ ...r.people[0], employeeId: 'e8', category: 'exonere_247', lastName: 'JEUNE', firstName: 'Jad', hireDate: '2025-02-01', birthDate: '2001-04-02', ir: 0 });
    const xml = buildDtsXml(r);
    const at = (t: string) => xml.indexOf(t);
    expect(at('</listPersonnelPermanent>')).toBeLessThan(at('<listPersonnelExonere5725>'));
    expect(at('</listPersonnelExonere5725>')).toBeLessThan(at('<listPersonnelExonere>'));
    expect(at('</listPersonnelExonere>')).toBeLessThan(at('<listPersonnelOccasionnel>'));
    const exempt = xml.slice(at('<PersonnelExonere>'), at('</PersonnelExonere>'));
    expect([...exempt.matchAll(/<(\w+)>/g)].map(m => m[1])).toEqual([
      'PersonnelExonere', 'nom', 'prenom', 'adressePersonnelle', 'numCNI', 'numCE', 'numCNSS', 'ifu', 'dateRecrutement', 'mtBrutTraitementSalaire',
      'mtIndemniteArgentNature', 'mtIndemniteFraisPro', 'mtRevenuBrutImposable', 'mtRetenuesOperees', 'mtRevenuNetImposable', 'periode',
    ]);
    expect(xml.slice(at('<PersonnelExonere5725>'), at('</PersonnelExonere5725>'))).toContain('<dateNaissance>2001-04-02</dateNaissance>');
    // Exempt staff count as permanent staff and their pay is in amount (A), not in the permanent table's totals.
    expect(xml).toContain('<nbrPersoPermanent>3</nbrPersoPermanent>');
    expect(xml).toContain('<montantPermanent>60000.00</montantPermanent>');
    expect(xml).toContain('<totalMtRevenuBrutImposablePP>19000.00</totalMtRevenuBrutImposablePP>');
    expect(buildDtsXml(theReturn())).not.toContain('PersonnelExonere');
  });

  it('writes empty lists, no payment list content and no date element when there is no date', () => {
    const r: DtsReturn = { year: 2026, company, people: [], payments: [] };
    const xml = buildDtsXml(r);
    for (const t of ['listPersonnelPermanent', 'listPersonnelOccasionnel', 'listSalariesCFC', 'listStagiaires', 'listBeneficiaires', 'listBeneficiairesPlanEpargne', 'listVersements']) {
      expect(xml).toContain(`\t<${t}></${t}>\r\n`);
    }
    expect(xml).not.toContain('dateObtentionStatusCFC');
    expect(xml).toContain('<effectifTotal>0</effectifTotal>');
  });

  it('sums several payments of a month and keeps the latest date', () => {
    const r = theReturn();
    r.payments = [{ month: 3, details: [
      { reference: 'B', receiptNumber: 'Q3b', date: '2026-04-28', principal: 100, penalty: 10, surcharge: 5.5, mode: 'CH' },
      { reference: 'A', receiptNumber: 'Q3a', date: '2026-04-10', principal: 700, penalty: 0, surcharge: 0, mode: 'ES' },
    ] }];
    const xml = buildDtsXml(r);
    expect(xml).toContain('<mois>3</mois>\r\n\t\t\t<totalVersement>815.50</totalVersement>\r\n\t\t\t<dateDerniereVersment>2026-04-28</dateDerniereVersment>');
    expect(xml.indexOf('<reference>A</reference>')).toBeLessThan(xml.indexOf('<reference>B</reference>'));
    expect(xml).toContain('<totalVerse>115.50</totalVerse>');
  });

  it('can write the family field as the deduction amount (2026 annex: capped at 3 600)', () => {
    const r = { ...theReturn(), familyFieldAsAmount: true, familyDeductionPerDependant: 600 };
    expect(buildDtsXml(r)).toContain('<nbrReductions>1200</nbrReductions>');
    expect(familyFieldValue({ dependents: 6 }, r)).toBe(3600);
    expect(familyFieldValue({ dependents: 6 }, {})).toBe(6);
  });

  it('escapes text and keeps the file UTF-8', () => {
    expect(xmlText('A & B <c> "d" \'e\'\u0001')).toBe('A &amp; B &lt;c&gt; &quot;d&quot; &apos;e&apos;');
    expect(xmlText(' Profession 1\n\t\t\t')).toBe('Profession 1');
    const bytes = new TextEncoder().encode(buildDtsXml(theReturn()));
    expect(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toContain('Société');
  });

  it('names the file and zips it (the DGI guide asks for a zipped XML)', () => {
    expect(dtsFileName('12 345 678', 2026)).toBe('DTS_9421_12345678_2026.xml');
    expect(dtsFileName('', 2026, 'zip')).toBe('DTS_9421_IF_2026.zip');
    const xml = buildDtsXml(theReturn());
    const zip = zipDtsXml(xml, dtsFileName(company.taxId, 2026));
    const back = unzipSync(zip);
    expect(new TextDecoder().decode(back['DTS_9421_12345678_2026.xml'])).toBe(xml);
  });
});

describe('9421 code lists and figures', () => {
  it('maps family situations, payment modes and professional-expense rates to the annex codes', () => {
    expect(['celibataire', 'marie', 'veuf', 'divorce', undefined].map(s => familySituationCode(s as never))).toEqual(['C', 'M', 'V', 'D', null]);
    expect(['ES', 'CH', 'SIR', 'VIR', null].map(m => paymentModeCode(m))).toEqual(['ES', 'CH', 'SIR', null, null]);
    expect(fraisProRateCode(0.35, 2026)).toBe('TPP.35.2009');
    expect(fraisProRateCode(0.25, 2026)).toBe('TPP.25.2009');
    expect(fraisProRateCode(0.45, 2027)).toBe('TPP.45.2009');
    expect(fraisProRateCode(0.20, 2022)).toBe('TPP.20.2009');
    expect(fraisProRateCode(0.20, 2026)).toBeNull(); // ended 31/12/2022
    expect(fraisProRateCode(0.30, 2026)).toBeNull();
  });

  it('takes the rate the payslips applied, the high rate at the cap, and flags a year with two rates', () => {
    expect(rateCodeFor(4750, 19000, 2026, s2026)).toEqual({ code: 'TPP.25.2009', mixed: false });
    expect(rateCodeFor(21000, 60000, 2026, s2026)).toEqual({ code: 'TPP.35.2009', mixed: false });
    expect(rateCodeFor(35000, 200000, 2026, s2026)).toEqual({ code: 'TPP.25.2009', mixed: false });
    // 35 % on half the year, 25 % on the rest: no single rate.
    expect(rateCodeFor(30000 * 0.35 + 70000 * 0.25, 100000, 2026, s2026)).toEqual({ code: 'TPP.25.2009', mixed: true });
  });

  it('puts a Stage contract in the trainees and respects a chosen list', () => {
    expect(dtsCategoryOf({ contract_type: 'Stage' as never })).toBe('stagiaire');
    expect(dtsCategoryOf({ contract_type: 'CDI' })).toBe('permanent');
    expect(dtsCategoryOf({ contract_type: 'Interim' })).toBe('permanent');
    expect(dtsCategoryOf({ contract_type: 'CDI', dts_category: 'exonere_57_20' })).toBe('exonere_57_20');
  });

  it('splits a full name only when surname and first name are not stored', () => {
    expect(splitName({ full_name: 'Mohamed Amine El Alaoui' })).toEqual({ firstName: 'Mohamed', lastName: 'Amine El Alaoui', split: true });
    expect(splitName({ full_name: 'X', last_name: 'EL ALAOUI', first_name: 'Mohamed Amine' })).toEqual({ lastName: 'EL ALAOUI', firstName: 'Mohamed Amine', split: false });
  });

  it('sums only validated payslips and keeps drafts apart', () => {
    const y = year();
    expect(y.people.map(p => p.employeeId).sort()).toEqual(['e1', 'e2', 'e3']);
    expect(y.drafts.map(p => p.id)).toEqual(['p3']);
    expect([...y.irByMonth.entries()]).toEqual([[1, 2300], [2, 800]]);
    expect(y.lastMonth).toBe(3);
    expect(peopleOfYear(2025, [], employees, new Map(), s2026, new Date('2026-11-25')).lastMonth).toBe(12);
    const ali = y.people.find(p => p.employeeId === 'e1')!;
    expect(ali).toMatchObject({ gross: 20000, exempt: 1000, taxableGross: 19000, fraisPro: 4750, contributions: 967, netTaxable: 13283, ir: 1600, days: 52, dependents: 2, months: [1, 2] });
  });

  it('works out the bases of an older payslip from its lines', () => {
    const old = slip('o1', 'e1', 1, { total_gross: 8000, frais_pro: 2000, cnss_employee: 268.8, amo_employee: 180.8, ir_amount: 300 });
    const f = payslipFigures(old, { brut_imposable: 7500, net_imposable: 5050.4, cnss_base: 7500 });
    expect(f).toMatchObject({ gross: 8000, taxableGross: 7500, netTaxable: 5050.4, rebuilt: true });
    // Without lines either: the gross, less the deductions.
    expect(payslipFigures(old, null)).toMatchObject({ taxableGross: 8000, netTaxable: 5550.4, rebuilt: true });
    expect(payslipFigures(e1('x', 1), null).rebuilt).toBe(false);
  });

  it('counts headcounts at 31 December', () => {
    const left = buildPerson('e1', { ...employees.get('e1')!, date_sortie: '2026-06-30' }, [payslipFigures(e1('a', 1))], 2026, s2026);
    expect(left.presentAtYearEnd).toBe(false);
    expect(dtsTotals([left]).headcount).toBe(0);
    expect(dtsTotals([left]).amountPermanent).toBe(10000);
  });
});

describe('9421 checks', () => {
  it('lists what is missing for the company and each person', () => {
    const issues = dtsCompleteness({ company: { ...company, communeCode: '', taxId: '', rc: '' }, people: year().people });
    const text = issues.map(i => `${i.level}|${i.who}|${i.message}`);
    expect(text).toContain('error|Société|Identifiant fiscal (IF) manquant.');
    expect(text).toContain('error|Société|Code commune DGI manquant.');
    expect(text).toContain('warning|Société|N° RC manquant.');
    expect(text).toContain('error|Sara Bennani|Adresse personnelle manquante.');
    expect(text).toContain('error|Sara Bennani|N° CNSS manquant.');
    expect(text).toContain('warning|Sara Bennani|Nom « Bennani » et prénom « Sara » déduits du nom complet : à vérifier.');
    // The occasional employee has a residence card instead of a CIN, and no CNSS number is asked.
    expect(text.filter(t => t.includes('Omar Idrissi'))).toEqual([]);
    expect(issues.find(i => i.who === 'Sara Bennani')?.fix).toBe('employee');
    expect(dtsCompleteness({ company, people: year().people.filter(p => p.employeeId !== 'e2') })).toEqual([]);
  });

  it('flags a bad commune code and a missing family situation', () => {
    const p = year().people.find(x => x.employeeId === 'e1')!;
    const issues = dtsCompleteness({ company: { ...company, communeCode: '141-01-01' }, people: [{ ...p, familyCode: null, cin: '', residenceCard: '' }] });
    expect(issues.map(i => i.message)).toEqual(expect.arrayContaining([
      'Code commune « 141-01-01 » : format attendu 000.00.00.', 'Situation familiale manquante.', 'N° CIN ou de carte de séjour manquant.',
    ]));
  });

  it('recomputes the annual IR with the official scale and shows the difference', () => {
    // 13,283 net taxable is under the 40,000 exempt band: nothing due, 1,600 withheld.
    expect(irChecks(year().people, s2026)).toEqual([{ employeeId: 'e1', who: 'Ali AMRANI', recomputed: 0, withheld: 1600, diff: 1600 }]);
    // 120,000: 120,000 × 34 % − 22,000 = 18,800, less 2 × 600; family deductions capped at 3,600.
    expect(annualIr(120000, 2, s2026)).toBe(17600);
    expect(annualIr(120000, 9, s2026)).toBe(18800 - 3600);
  });

  it('finds months without a validated payslip while the employee was present', () => {
    const y = year();
    const gaps = missingMonths(2026, y.lastMonth, y.people.filter(p => p.category !== 'occasionnel'));
    // Ali: March is still a draft; Sara has no hire date: from her first payslip (February).
    expect(gaps).toEqual([{ employeeId: 'e1', who: 'Ali AMRANI', months: [3] }, { employeeId: 'e2', who: 'Sara Bennani', months: [3] }]);
    const left = { ...y.people[0], exitDate: '2026-02-15', months: [1, 2] };
    expect(missingMonths(2026, 12, [left])).toEqual([]);
  });

  it('checks the figures and the IR payments', () => {
    const r = theReturn();
    const warn = dtsWarnings(r, year().irByMonth, s2026).map(w => `${w.who}|${w.message}`);
    expect(warn).toEqual(['Février|IR retenu 800,00 : aucun versement saisi.']);
    const trainee = { ...r.people.find(p => p.category === 'stagiaire')!, ir: 120 };
    const off = { ...r.people.find(p => p.category === 'permanent')!, netTaxable: 15000, fraisPro: 36000 };
    const more = dtsWarnings({ people: [trainee, off], payments: [{ month: 1, details: [{ reference: '', receiptNumber: '', date: '2026-02-01', principal: 2000, penalty: 0, surcharge: 0, mode: 'SIR' }] }] }, new Map([[1, 2300]]), s2026).map(w => w.message);
    expect(more).toEqual(expect.arrayContaining([
      'IR retenu (120,00) sur un stagiaire : la liste des stagiaires n\'a pas de case IR.',
      'Frais professionnels (36000,00) au-dessus du plafond annuel (35000,00).',
      'Principal versé 2000,00 pour un IR retenu de 2300,00.',
    ]));
    expect(more.some(m => m.startsWith('Net imposable (15000,00) différent'))).toBe(true);
  });
});

describe('9421 summary for the accountant', () => {
  it('has one line per person and the totals, as CSV and PDF', async () => {
    const rows = recapRows(theReturn().people);
    expect(rows).toHaveLength(4);
    expect(rows[0].slice(0, 3)).toEqual(['Personnel permanent', 'AMRANI', 'Ali']);
    expect(rows[3]).toEqual(['Total', '', '', '', '', '', '', '', '', '', 98, '28000,00', '1000,00', '27000,00', '7050,00', '1169,20', '18780,80', '3100,00', '']);
    const csv = dtsRecapCsv(theReturn(), year().irByMonth);
    expect(csv.split('\n')[0]).toContain('Liste;Nom;Prénom');
    expect(csv).toContain('Janvier;2300,00;2300,00;2300,00');
    expect(csv).toContain('Février;800,00;0,00;0,00');
    const pdf = buildDtsRecapPdf(theReturn(), year().irByMonth, new Date('2026-11-25'));
    expect(pdf.getNumberOfPages()).toBeGreaterThan(0);
    expect(pdf.output('arraybuffer').byteLength).toBeGreaterThan(1000);
  });
});
