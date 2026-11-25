import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { dtsTotals, MONTH_NAMES, paidTotal, RECAP_HEADER, recapRows, xmlAmount, type DtsReturn } from './dts9421';

// jsPDF's standard fonts have no narrow no-break space: plain spaces instead.
const plain = (s: string) => s.replace(/[\u202f\u00a0]/g, ' ');
const money = (n: number) => plain(new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0));

/**
 * "État récapitulatif" of the annual salary return for the accountant: the
 * employer, one line per person with the figures of the XML file, the
 * totals of the header and the IR withheld and paid per month.
 */
export function buildDtsRecapPdf(r: DtsReturn, irByMonth: Map<number, number>, producedAt = new Date()): jsPDF {
  const doc = new jsPDF('l', 'mm', 'a4');
  const width = doc.internal.pageSize.getWidth();
  const margin = 10;
  const c = r.company;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(c.companyName || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Société', margin, margin + 2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const ids = [c.taxId && `IF ${c.taxId}`, c.rc && `RC ${c.rc}`, c.tp && `TP ${c.tp}`, c.cnss && `CNSS ${c.cnss}`, c.communeCode && `Commune ${c.communeCode}`].filter(Boolean).join(' · ');
  doc.text(ids, margin, margin + 7);
  if (c.address) doc.text(doc.splitTextToSize(c.address, width / 2), margin, margin + 11);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(`ÉTAT RÉCAPITULATIF DES TRAITEMENTS ET SALAIRES ${r.year}`, width - margin, margin + 2, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`Déclaration 9421 · à déposer avant le 1er mars ${r.year + 1} · édité le ${producedAt.toLocaleDateString('fr-FR')}`, width - margin, margin + 7, { align: 'right' });

  autoTable(doc, {
    startY: margin + 18,
    head: [RECAP_HEADER],
    body: recapRows(r.people).map(row => row.map(v => plain(String(v)))),
    styles: { fontSize: 6.5, cellPadding: 1 },
    headStyles: { fillColor: [30, 58, 138], fontSize: 6.5 },
    margin: { left: margin, right: margin },
  });

  const t = dtsTotals(r.people);
  const after = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? margin + 30;
  autoTable(doc, {
    startY: after + 6,
    head: [['Totaux de la déclaration', 'Montant']],
    body: [
      ['Effectif au 31 décembre (permanents / occasionnels / stagiaires)', `${t.headcount} (${t.permanentCount} / ${t.occasionalCount} / ${t.traineeCount})`],
      ['Revenu brut imposable — personnel permanent', money(t.ppTaxableGross)],
      ['Total des déductions — personnel permanent', money(t.ppDeductions)],
      ['Revenu net imposable — personnel permanent', money(t.ppNetTaxable)],
      ['IR prélevé — personnel permanent', money(t.ppIr)],
      ['Sommes brutes / IR — personnel occasionnel', `${money(t.poGross)} / ${money(t.poIr)}`],
      ['Brut / retenues / net imposable — stagiaires', `${money(t.stgGross)} / ${money(t.stgDeductions)} / ${money(t.stgNetTaxable)}`],
      ['Total des sommes payées (A + B + C)', money(t.totalPaid)],
    ],
    styles: { fontSize: 7.5, cellPadding: 1.2 },
    headStyles: { fillColor: [30, 58, 138] },
    columnStyles: { 1: { halign: 'right' } },
    margin: { left: margin, right: width / 2 },
  });

  const paid = new Map(r.payments.map(m => [m.month, m.details]));
  autoTable(doc, {
    startY: after + 6,
    head: [['Mois', 'IR retenu', 'Principal versé', 'Total versé', 'Dernier versement']],
    body: MONTH_NAMES.map((name, i) => {
      const d = paid.get(i + 1) || [];
      return [name, money(irByMonth.get(i + 1) || 0), money(d.reduce((s, x) => s + x.principal, 0)), money(d.reduce((s, x) => s + paidTotal(x), 0)),
        d.length ? [...d].sort((a, b) => a.date.localeCompare(b.date))[d.length - 1].date : '—'];
    }),
    styles: { fontSize: 7.5, cellPadding: 1.2 },
    headStyles: { fillColor: [30, 58, 138] },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    margin: { left: width / 2 + 4, right: margin },
  });
  return doc;
}

/** The same summary as CSV lines (semicolon, French decimals). */
export function dtsRecapCsv(r: DtsReturn, irByMonth: Map<number, number>): string {
  const lines: string[] = [RECAP_HEADER.join(';'), ...recapRows(r.people).map(row => row.map(v => String(v).replace(/;/g, ',')).join(';'))];
  lines.push('', 'Mois;IR retenu;Principal versé;Total versé');
  const paid = new Map(r.payments.map(m => [m.month, m.details]));
  const n = (v: number) => xmlAmount(v).replace('.', ',');
  MONTH_NAMES.forEach((name, i) => {
    const d = paid.get(i + 1) || [];
    lines.push([name, n(irByMonth.get(i + 1) || 0), n(d.reduce((s, x) => s + x.principal, 0)), n(d.reduce((s, x) => s + paidTotal(x), 0))].join(';'));
  });
  return '\uFEFF' + lines.join('\n') + '\n';
}
