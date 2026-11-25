import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { CATEGORY_LABELS, PAYMENT_MODE_CODE_LABELS, type SaleItem, type VatReturnResult } from '../accounting/vatReturn';
import type { DeductionRow } from '../accounting/vatDeductionStatement';

// The VAT return on paper, for the accountant's file: the figures in the
// order of art. 112-I CGI, then every line they come from. It is a working
// document: the return itself is filed on SIMPL-TVA.

// jsPDF's standard fonts have no narrow no-break space: plain spaces instead.
const plain = (s: string) => s.replace(/[\u202f\u00a0]/g, ' ');
const money = (n: number) => plain(new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0));
const fr = (d: string) => (d ? d.split('-').reverse().join('/') : '—');

export const SALE_KIND_LABELS: Record<SaleItem['kind'], string> = {
  encaissement: 'Encaissement', retenue: 'Retenue à la source (client)', facture: 'Facture', avance: 'Avance avant facture', avoir: 'Avoir',
};

export const rateLabel = (rate: number, legal: boolean) => (rate === 0 ? 'Exonéré / 0 %' : `${rate} %${legal ? '' : ' (taux supprimé)'}`);

export function buildVatReturnPdf(r: VatReturnResult, releve: DeductionRow[], company: { name: string; if: string; ice: string }, opts: { status: 'calcul' | 'draft' | 'filed'; producedAt?: Date } = { status: 'calcul' }): jsPDF {
  const doc = new jsPDF('p', 'mm', 'a4');
  const width = doc.internal.pageSize.getWidth();
  const m = 12;
  const head = { fillColor: [30, 58, 138] as [number, number, number], fontSize: 8 };
  const after = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 40;
  const title = (text: string, y: number) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(text, m, y); doc.setFont('helvetica', 'normal'); };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(plain(company.name || 'Société'), m, m + 2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text([company.if && `IF ${company.if}`, company.ice && `ICE ${company.ice}`].filter(Boolean).join(' · ') || 'IF et ICE à renseigner', m, m + 7);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(`DÉCLARATION DE TVA — ${r.period.label.toUpperCase()}`, width - m, m + 2, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const state = opts.status === 'filed' ? 'déposée' : opts.status === 'draft' ? 'brouillon enregistré' : 'calcul non enregistré';
  doc.text(`Régime ${r.settings.regime === 'encaissement' ? 'de l’encaissement' : 'des débits'} · ${r.period.type === 'M' ? 'mensuelle' : 'trimestrielle'} · ${state}`, width - m, m + 7, { align: 'right' });
  doc.text(`Du ${fr(r.period.start)} au ${fr(r.period.end)} · à déposer et payer au plus tard le ${fr(r.deadline.electronic)} (télédéclaration)`, width - m, m + 11, { align: 'right' });
  doc.setFontSize(7.5);
  doc.setTextColor(150, 70, 0);
  doc.text('Document de travail établi par Stocky : les montants sont à saisir ou importer sur SIMPL-TVA et à y vérifier avant le dépôt.', m, m + 16);
  doc.setTextColor(0, 0, 0);
  doc.text(`Édité le ${(opts.producedAt || new Date()).toLocaleDateString('fr-FR')}`, width - m, m + 16, { align: 'right' });

  // A. Turnover and VAT due by rate (art. 112-I-2° to 6°)
  title('A. Chiffre d’affaires et TVA exigible', m + 23);
  autoTable(doc, {
    startY: m + 25,
    head: [['Taux', 'Base HT', 'TVA exigible']],
    body: [
      ...r.sales.byRate.map(l => [rateLabel(l.rate, l.legal), money(l.base), money(l.vat)]),
      [{ content: 'dont avoirs de la période', styles: { fontStyle: 'italic' } }, money(r.sales.creditNotes.base), money(r.sales.creditNotes.vat)],
      [{ content: 'Total', styles: { fontStyle: 'bold' } }, { content: money(r.sales.totalBase), styles: { fontStyle: 'bold' } }, { content: money(r.sales.totalVat), styles: { fontStyle: 'bold' } }],
    ],
    styles: { fontSize: 8, cellPadding: 1.3 }, headStyles: head, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } }, margin: { left: m, right: m },
  });

  // B. Deductions (art. 112-I-8°)
  title('B. TVA déductible', after() + 7);
  autoTable(doc, {
    startY: after() + 9,
    head: [['Nature', 'Base HT', 'TVA payée', `Après prorata ${r.deductions.prorata} %`]],
    body: [
      ...r.deductions.byCategory.map(c => [CATEGORY_LABELS[c.category], money(c.base), money(c.vat), money(c.vatAfterProrata)]),
      [{ content: 'Total des déductions', styles: { fontStyle: 'bold' } }, money(r.deductions.totalBase), money(r.deductions.totalVat), { content: money(r.deductions.totalAfterProrata), styles: { fontStyle: 'bold' } }],
    ],
    styles: { fontSize: 8, cellPadding: 1.3 }, headStyles: head, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } }, margin: { left: m, right: m },
  });

  // C–D. Credit and net (art. 112-I-7° and 9°)
  title('C. Crédit, retenues et résultat', after() + 7);
  autoTable(doc, {
    startY: after() + 9,
    body: [
      ['TVA exigible', money(r.sales.totalVat)],
      ['- TVA déductible après prorata', money(r.deductions.totalAfterProrata)],
      [`- Crédit de la période précédente (${plain(r.credit.message)})`, money(r.credit.amount)],
      ['- TVA retenue à la source par les clients (art. 117 et 103-6° CGI)', money(r.clientWithholdings.total)],
      [{ content: r.toPay > 0 ? 'TVA à payer' : 'Crédit de TVA à reporter', styles: { fontStyle: 'bold' } }, { content: money(r.toPay > 0 ? r.toPay : r.creditToCarry), styles: { fontStyle: 'bold' } }],
      ...(r.refundableCredit > 0 ? [['dont remboursable sur demande (TVA retenue par les clients, art. 103-6°)', money(r.refundableCredit)]] : []),
    ],
    styles: { fontSize: 8, cellPadding: 1.3 }, columnStyles: { 1: { halign: 'right', cellWidth: 35 } }, margin: { left: m, right: m },
  });

  if (r.supplierWithholdings.total > 0) {
    title('À verser à part : TVA retenue à la source sur vos fournisseurs (art. 117 CGI)', after() + 7);
    autoTable(doc, {
      startY: after() + 9,
      head: [['Mois de versement', 'Montant']],
      body: r.supplierWithholdings.byMonth.map(x => [`Avant la fin de ${x.month.slice(5)}/${x.month.slice(0, 4)}`, money(x.amount)]),
      styles: { fontSize: 8, cellPadding: 1.3 }, headStyles: head, columnStyles: { 1: { halign: 'right' } }, margin: { left: m, right: m },
    });
  }

  if (r.warnings.length) {
    title('Points à vérifier', after() + 7);
    autoTable(doc, {
      startY: after() + 9,
      body: r.warnings.map(w => [w.level === 'error' ? 'À corriger' : w.level === 'warning' ? 'À vérifier' : 'Information', plain(w.message + (w.refs?.length ? ` (${w.refs.slice(0, 8).join(', ')}${w.refs.length > 8 ? '…' : ''})` : ''))]),
      styles: { fontSize: 7, cellPadding: 1.1 }, columnStyles: { 0: { cellWidth: 22 } }, margin: { left: m, right: m },
    });
  }

  // Lists behind the figures
  doc.addPage('a4', 'l');
  const lw = doc.internal.pageSize.getWidth();
  title(`Détail du chiffre d’affaires et de la TVA exigible — ${r.period.label}`, m);
  autoTable(doc, {
    startY: m + 2,
    head: [['Date', 'Nature', 'Pièce', 'Facture du', 'Client', 'Taux', 'TTC compté', 'HT', 'TVA']],
    body: r.sales.byRate.flatMap(l => l.items).map(i => [fr(i.date), SALE_KIND_LABELS[i.kind], i.number + (i.invoiceNumber ? ` (sur ${i.invoiceNumber})` : ''), fr(i.invoiceDate), plain(i.client), `${i.rate} %`, money(i.ttc), money(i.ht), money(i.vat)]),
    styles: { fontSize: 7, cellPadding: 1 }, headStyles: { ...head, fontSize: 7 },
    columnStyles: { 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' } }, margin: { left: m, right: m },
  });
  if (r.clientWithholdings.items.length) {
    title('TVA retenue à la source par les clients', after() + 7);
    autoTable(doc, {
      startY: after() + 9,
      head: [['Date', 'Facture', 'Client', 'ICE', 'Part retenue', 'Montant']],
      body: r.clientWithholdings.items.map(w => [fr(w.date), w.number, plain(w.client), w.clientIce || '—', `${w.share} %`, money(w.amount)]),
      styles: { fontSize: 7, cellPadding: 1 }, headStyles: { ...head, fontSize: 7 }, columnStyles: { 5: { halign: 'right' } }, margin: { left: m, right: m },
    });
  }
  title('Relevé de déductions (art. 112-II CGI)', after() + 7);
  autoTable(doc, {
    startY: after() + 9,
    head: [['N°', 'Facture', 'Désignation', 'HT', 'TVA', 'TTC', 'IF', 'Fournisseur', 'ICE', 'Taux', 'Prorata', 'Mode', 'Payée le', 'Facture du']],
    body: releve.map(x => [x.ord, x.num, plain(x.des).slice(0, 60), money(x.mht), money(x.tva), money(x.ttc), x.if || '—', plain(x.nom), x.ice || '—', `${x.tx} %`, `${x.prorata} %`, `${x.mp} ${PAYMENT_MODE_CODE_LABELS[x.mp] || ''}`, fr(x.dpai), fr(x.dfac)]),
    styles: { fontSize: 6.5, cellPadding: 0.9 }, headStyles: { ...head, fontSize: 6.5 },
    columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } }, margin: { left: m, right: m },
  });
  doc.setFontSize(7);
  doc.text(`Stocky — déclaration de TVA ${r.period.key}`, lw - m, doc.internal.pageSize.getHeight() - 5, { align: 'right' });
  return doc;
}
