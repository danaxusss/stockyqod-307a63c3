// HR documents as A4 PDFs: the receipt for the final settlement and the
// employment certificates, with the company's identifiers and a number.

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { CompanySettings } from './companySettings';
import type { Employee, Payslip } from '../types';
import { amountInWordsFr } from './amountInWords';

// jsPDF's standard fonts have no narrow no-break space: plain spaces only.
const money = (n: number) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0).replace(/[\u202f\u00a0]/g, ' ');
const day = (s: string | null | undefined) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '…');
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const longDay = (s: string) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return `${d === 1 ? '1er' : d} ${MONTHS[m - 1]} ${y}`; };
const CONTRACT: Record<string, string> = { CDI: 'contrat à durée indéterminée', CDD: 'contrat à durée déterminée', Interim: 'contrat d\'intérim', Stage: 'contrat de stage' };

const DARK: [number, number, number] = [17, 24, 39];
const GRAY: [number, number, number] = [90, 98, 112];
const ACCENT: [number, number, number] = [30, 58, 138];

/** Town of the company: last part of the address ("12 Bd Zerktouni, 20000 Casablanca" → "Casablanca"). */
export function companyTown(address: string | null | undefined): string {
  const parts = (address || '').split(/[,\n]/).map(x => x.replace(/\b\d{5}\b/g, '').trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

/** "Monsieur" / "Madame" and the agreement of "employé(e)". */
export function civility(e: Pick<Employee, 'gender'>) {
  if (e.gender === 'F') return { title: 'Madame', e: 'e', il: 'Elle', le: 'la' };
  if (e.gender === 'M') return { title: 'Monsieur', e: '', il: 'Il', le: 'le' };
  return { title: 'Monsieur / Madame', e: '(e)', il: 'Il / Elle', le: 'le / la' };
}

const lastY = (doc: jsPDF, fallback: number) => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? fallback;

/** Letterhead: company name, address, identifiers; title and number on the right. */
function letterhead(doc: jsPDF, company: CompanySettings | null | undefined, title: string, number: string, provisional: boolean): number {
  const width = doc.internal.pageSize.getWidth();
  const margin = 16;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...DARK);
  doc.text(company?.company_name?.trim() || 'La société', margin, 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  let y = 25;
  const contact = [company?.address, company?.phone, company?.email].filter(Boolean).join(' · ');
  if (contact) { doc.text(doc.splitTextToSize(contact, width / 2 + 10), margin, y); y += 4 * Math.ceil(contact.length / 70); }
  const ids = [
    company?.ice && `ICE : ${company.ice}`, company?.rc && `RC : ${company.rc}`, company?.if_number && `IF : ${company.if_number}`,
    company?.cnss && `CNSS : ${company.cnss}`, company?.patente && `Patente : ${company.patente}`,
  ].filter(Boolean).join(' · ');
  if (ids) { doc.text(doc.splitTextToSize(ids, width / 2 + 10), margin, y); y += 4; }
  doc.setFontSize(9);
  doc.setTextColor(...DARK);
  doc.text(`Réf. ${number}`, width - margin, 20, { align: 'right' });
  if (provisional) {
    doc.setTextColor(185, 28, 28);
    doc.text('PROVISOIRE', width - margin, 25, { align: 'right' });
  }
  y = Math.max(y + 10, 48);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...ACCENT);
  doc.text(title, width / 2, y, { align: 'center' });
  return y + 12;
}

function paragraph(doc: jsPDF, text: string, y: number, size = 10.5): number {
  const width = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(size);
  doc.setTextColor(...DARK);
  const lines = doc.splitTextToSize(text, width - 32);
  doc.text(lines, 16, y);
  return y + lines.length * size * 0.45 + 4;
}

function placeAndSignatures(doc: jsPDF, company: CompanySettings | null | undefined, issuedOn: string, y: number, employeeSigns: string | null): void {
  const width = doc.internal.pageSize.getWidth();
  const town = companyTown(company?.address);
  y = paragraph(doc, `Fait${employeeSigns ? ' en deux exemplaires' : ''} ${town ? `à ${town}, ` : ''}le ${longDay(issuedOn)}.`, Math.max(y + 4, y));
  doc.setFontSize(9.5);
  doc.setTextColor(...DARK);
  if (employeeSigns) {
    doc.text('Le salarié', 16, y + 6);
    doc.setFontSize(8);
    doc.setTextColor(...GRAY);
    doc.text(doc.splitTextToSize(employeeSigns, 80), 16, y + 11);
  }
  doc.setFontSize(9.5);
  doc.setTextColor(...DARK);
  doc.text('Pour la société, la Direction', width - 16, y + 6, { align: 'right' });
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.text('Signature et cachet', width - 16, y + 11, { align: 'right' });
}

function footer(doc: jsPDF, company: CompanySettings | null | undefined, number: string) {
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  doc.text(company?.company_name || '', 16, height - 8);
  doc.text(number, width - 16, height - 8, { align: 'right' });
}

const identity = (e: Employee) => [
  e.cin ? `titulaire de la CIN n° ${e.cin}` : null,
  e.cnss_number ? `immatriculé${civility(e).e} à la CNSS sous le n° ${e.cnss_number}` : null,
].filter(Boolean).join(', ');

// ── Receipt for the final settlement ────────────────────────────────────────

export interface StcPdfData {
  number: string;
  provisional: boolean;
  motifLabel: string;
  exitDate: string;
  service: string;
  elements: { label: string; amount: number; due: boolean; detail: string }[];
  deductions: { label: string; amount: number }[];
  gross: number;
  netToPay: number;
  issuedOn: string;
}

/**
 * "Reçu pour solde de tout compte". The 60-day period to contest it is the
 * Code du travail art. 74 rule as reported (research level, not checked in a
 * text here): it must appear on the receipt.
 */
export function buildStcReceiptPdf(e: Employee, company: CompanySettings | null | undefined, d: StcPdfData): { doc: jsPDF; filename: string } {
  const doc = new jsPDF('p', 'mm', 'a4');
  const c = civility(e);
  const companyName = company?.company_name?.trim() || 'la société';
  let y = letterhead(doc, company, 'REÇU POUR SOLDE DE TOUT COMPTE', d.number, d.provisional);
  y = paragraph(doc, `Je soussigné${c.e} ${e.full_name}${identity(e) ? `, ${identity(e)}` : ''}, employé${c.e} ${e.position ? `en qualité de ${e.position} ` : ''}du ${day(e.hire_date)} au ${day(d.exitDate)} (ancienneté : ${d.service}), motif de la rupture : ${d.motifLabel.toLowerCase()}, reconnais avoir reçu de ${companyName} la somme nette de ${money(d.netToPay)} MAD (${amountInWordsFr(d.netToPay)}) pour solde de tout compte, en paiement des sommes suivantes :`, y);

  const body: (string | { content: string; styles: Record<string, unknown> })[][] = d.elements
    .filter(el => el.due || el.amount > 0)
    .map(el => [el.label, el.detail, money(el.amount)]);
  body.push([{ content: 'TOTAL BRUT', styles: { fontStyle: 'bold' } }, '', { content: money(d.gross), styles: { fontStyle: 'bold', halign: 'right' } }]);
  for (const ded of d.deductions.filter(x => x.amount !== 0)) body.push([`Retenue : ${ded.label}`, '', `-${money(ded.amount)}`]);
  body.push([{ content: 'NET À PAYER', styles: { fontStyle: 'bold' } }, '', { content: `${money(d.netToPay)} MAD`, styles: { fontStyle: 'bold', halign: 'right' } }]);
  autoTable(doc, {
    startY: y, head: [['Élément', 'Calcul', 'Montant (MAD)']], body,
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.8, textColor: DARK },
    headStyles: { fillColor: ACCENT, textColor: [255, 255, 255] },
    columnStyles: { 0: { cellWidth: 62 }, 2: { cellWidth: 32, halign: 'right' } },
    margin: { left: 16, right: 16 },
  });
  y = lastY(doc, y) + 6;
  const notDue = d.elements.filter(el => !el.due && el.amount === 0 && el.detail.startsWith('non due'));
  if (notDue.length) y = paragraph(doc, notDue.map(el => `${el.label} : ${el.detail}.`).join(' '), y, 8.5);
  y = paragraph(doc, 'Le présent reçu, établi en deux exemplaires dont l\'un est remis au salarié, peut être dénoncé par le salarié dans les soixante (60) jours suivant sa signature (Code du travail, article 74). Passé ce délai, il est libératoire pour l\'employeur pour les sommes qui y figurent.', y, 8.5);
  placeAndSignatures(doc, company, d.issuedOn, y, 'Mention manuscrite : « Lu et approuvé, pour solde de tout compte », date et signature');
  footer(doc, company, d.number);
  return { doc, filename: `${d.number.replace(/[^A-Za-z0-9_-]/g, '_')}_solde_${e.full_name.replace(/[^A-Za-z0-9]+/g, '_')}.pdf` };
}

// ── Certificates ────────────────────────────────────────────────────────────

export type CertificateKind = 'attestation_travail' | 'attestation_salaire' | 'certificat_travail';

export interface SalaryMonth { label: string; gross: number; net: number }
export interface SalaryYear { year: number; months: number; gross: number; netTaxable: number; ir: number; net: number }

export interface CertificateData {
  kind: CertificateKind;
  number: string;
  provisional: boolean;
  issuedOn: string;
  /** Certificat de travail: last day of the contract. */
  exitDate?: string | null;
  /** Attestation de salaire. */
  lastMonths?: SalaryMonth[];
  annual?: SalaryYear | null;
}

const TITLES: Record<CertificateKind, string> = {
  attestation_travail: 'ATTESTATION DE TRAVAIL',
  attestation_salaire: 'ATTESTATION DE SALAIRE',
  certificat_travail: 'CERTIFICAT DE TRAVAIL',
};

/** The sentences of a certificate (also shown on screen before printing). */
export function certificateText(e: Employee, companyName: string, d: CertificateData): string[] {
  const c = civility(e);
  const id = identity(e) ? `, ${identity(e)},` : '';
  const contract = CONTRACT[e.contract_type] || 'contrat de travail';
  if (d.kind === 'certificat_travail') {
    // Code du travail art. 72 (as reported): the certificate states the entry
    // and exit dates and the positions held, nothing else unless both agree.
    return [
      `Nous soussignés, ${companyName}, certifions que ${c.title} ${e.full_name}${id} a été employé${c.e} dans notre société du ${day(e.hire_date)} au ${day(d.exitDate)}.`,
      `Poste(s) occupé(s) : ${e.position || '…'}.`,
      'Le présent certificat est délivré pour servir et valoir ce que de droit.',
    ];
  }
  const head = `Nous soussignés, ${companyName}, attestons que ${c.title} ${e.full_name}${id} est employé${c.e} au sein de notre société depuis le ${day(e.hire_date)}${e.position ? `, en qualité de ${e.position}` : ''}, dans le cadre d'un ${contract}.`;
  if (d.kind === 'attestation_travail') {
    return [head, `La présente attestation est délivrée à l'intéressé${c.e}, sur sa demande, pour servir et valoir ce que de droit.`];
  }
  return [
    head,
    `${c.il} a perçu les rémunérations indiquées ci-dessous (bulletins de paie validés).`,
    `La présente attestation est délivrée à l'intéressé${c.e}, sur sa demande, pour servir et valoir ce que de droit.`,
  ];
}

const MONTHS_CAP = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Last 3 validated payslips and a year's totals, for the salary attestation. */
export function salaryFigures(payslips: Payslip[], year: number): { lastMonths: SalaryMonth[]; annual: SalaryYear | null } {
  const locked = payslips.filter(p => p.is_locked).sort((a, b) => (b.period_year * 12 + b.period_month) - (a.period_year * 12 + a.period_month));
  const lastMonths = locked.slice(0, 3).reverse().map(p => ({ label: `${MONTHS_CAP[p.period_month - 1]} ${p.period_year}`, gross: p.total_gross, net: p.net_salary }));
  const ofYear = locked.filter(p => p.period_year === year);
  const sum = (f: (p: Payslip) => number) => r2(ofYear.reduce((s, p) => s + (Number(f(p)) || 0), 0));
  const annual = ofYear.length ? {
    year, months: ofYear.length, gross: sum(p => p.total_gross),
    // Older payslips did not store the net taxable salary: gross − professional expenses − employee contributions.
    netTaxable: sum(p => p.net_taxable ?? (p.total_gross - p.frais_pro - p.cnss_employee - p.amo_employee - p.cimr_employee)),
    ir: sum(p => p.ir_amount), net: sum(p => p.net_salary),
  } : null;
  return { lastMonths, annual };
}

export function buildCertificatePdf(e: Employee, company: CompanySettings | null | undefined, d: CertificateData): { doc: jsPDF; filename: string } {
  const doc = new jsPDF('p', 'mm', 'a4');
  const companyName = company?.company_name?.trim() || 'la société';
  let y = letterhead(doc, company, TITLES[d.kind], d.number, d.provisional);
  const text = certificateText(e, companyName, d);
  const last = text.pop() as string;
  for (const t of text) y = paragraph(doc, t, y);
  if (d.kind === 'attestation_salaire') {
    autoTable(doc, {
      startY: y, head: [['Mois', 'Salaire brut (MAD)', 'Net payé (MAD)']],
      body: (d.lastMonths || []).map(m => [m.label, money(m.gross), money(m.net)]),
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.8, textColor: DARK },
      headStyles: { fillColor: ACCENT, textColor: [255, 255, 255] },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      margin: { left: 16, right: 16 },
    });
    y = lastY(doc, y) + 5;
    if (d.annual) {
      autoTable(doc, {
        startY: y,
        head: [[`Année ${d.annual.year} (${d.annual.months} mois)`, 'Montant (MAD)']],
        body: [
          ['Salaire brut', money(d.annual.gross)],
          ['Salaire net imposable', money(d.annual.netTaxable)],
          ['Impôt sur le revenu retenu', money(d.annual.ir)],
          ['Net payé', money(d.annual.net)],
        ],
        styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.8, textColor: DARK },
        headStyles: { fillColor: ACCENT, textColor: [255, 255, 255] },
        columnStyles: { 1: { halign: 'right' } },
        margin: { left: 16, right: 16 },
      });
      y = lastY(doc, y) + 5;
    }
  }
  y = paragraph(doc, last, y + 2);
  placeAndSignatures(doc, company, d.issuedOn, y + 4, null);
  footer(doc, company, d.number);
  return { doc, filename: `${d.number.replace(/[^A-Za-z0-9_-]/g, '_')}_${d.kind}_${e.full_name.replace(/[^A-Za-z0-9]+/g, '_')}.pdf` };
}
