import { describe, expect, it } from 'vitest';
import type { Supplier, SupplierInvoice, SupplierPayment } from '../accounting/supplierInvoices';
import {
  declarationCsvRows, declarationLines, declarationXml, delayFacts, delayReport, exclusionReason, fineFor, headerMissing, keyRateOn,
  monthsLate, periodRange,
} from '../accounting/paymentDelays';
import { crc32, zipOneFile } from '../utils/zipStore';

const inv = (p: Partial<SupplierInvoice> = {}): SupplierInvoice => ({
  id: 'i1', company_id: 'c1', supplier_id: 's1', number: 'FF-2026-0001', supplier_invoice_number: 'FA-77', invoice_date: '2026-01-10',
  reception_date: '2026-01-08', delivery_date: '2026-01-08', due_date: '2026-03-11', due_kind: 'legal', nature: 'marchandises', is_works: false,
  description: 'Fours mixtes', status: 'validated', total_ht: 100000, total_vat: 20000, total_ttc: 120000, total_nondeductible_vat: 0, paid_amount: 0,
  ir_rate: null, ir_amount: 0, litigation_amount: null, litigation_date: null, judgment_amount: null, judgment_date: null, cash_over_limit: false,
  source_po_id: null, source_receipt_id: null, notes: null, created_by: null, ...p,
});
const pay = (p: Partial<SupplierPayment>): SupplierPayment => ({
  id: 'p1', company_id: 'c1', invoice_id: 'i1', supplier_id: 's1', payment_date: '2026-04-15', amount: 0, mode: 'virement', reference: 'VIR-1', bank: null,
  vat_withholding_rate: 0, vat_withheld: 0, ir_withheld: 0, cash_vat_nondeductible: 0, cash_expense_nondeductible: 0, notes: null, created_by: null, ...p,
});
const supplier: Supplier = { id: 's1', company_id: 'c1', name: 'Inox Maroc', legal_type: 'societe', ice: '001234567000089', if_number: '1234567', rc: '4521 Casablanca', address: '12 rue X', city: 'Casablanca', payment_days: 60 };
const suppliers = new Map([['s1', supplier]]);

describe('Bank Al-Maghrib key rate by start of delay', () => {
  it('uses the dated table', () => {
    expect(keyRateOn('2024-05-31').rate).toBe(3);
    expect(keyRateOn('2024-06-01').rate).toBe(2.75);
    expect(keyRateOn('2024-12-01').rate).toBe(2.5);
    expect(keyRateOn('2025-03-19').rate).toBe(2.5);
    expect(keyRateOn('2025-03-20').rate).toBe(2.25);
    expect(keyRateOn('2026-11-25').rate).toBe(2.25);
  });
});

describe('fine (loi 69-21)', () => {
  it('counts months of delay, a part of a month counting as a month', () => {
    expect(monthsLate('2026-03-11', '2026-03-11')).toBe(0);
    expect(monthsLate('2026-03-11', '2026-03-12')).toBe(1);
    expect(monthsLate('2026-03-11', '2026-04-11')).toBe(1);
    expect(monthsLate('2026-03-11', '2026-04-12')).toBe(2);
    expect(monthsLate('2026-01-31', '2026-03-01')).toBe(2);
  });

  it('key rate for the first month, then 0.85 % per further month', () => {
    expect(fineFor(120000, 1, 2.25)).toBe(2700);
    expect(fineFor(120000, 3, 2.25)).toBe(4740);
    expect(fineFor(120000, 0, 2.25)).toBe(0);
  });

  it('fines the late payments and the unpaid rest, VAT included, at the rate of the start of delay', () => {
    const f = delayFacts(inv(), [pay({ payment_date: '2026-03-01', amount: 20000 }), pay({ id: 'p2', payment_date: '2026-04-15', amount: 50000 })], '2026-06-30');
    expect(f.keyRate.rate).toBe(2.25);
    expect(f.late).toEqual([expect.objectContaining({ date: '2026-04-15', amount: 50000, months: 2, fine: Math.round(50000 * 3.1) / 100 })]);
    expect(f.unpaid).toBe(50000);
    expect(f.unpaidMonths).toBe(4);
    expect(f.fineUnpaid).toBe(Math.round(50000 * (2.25 + 0.85 * 3)) / 100);
    expect(f.fine).toBe(1550 + 2400);
  });

  it('withheld VAT and IR count as paid, a disputed amount is not fined', () => {
    const f = delayFacts(inv({ litigation_amount: 20000, litigation_date: '2026-03-20' }), [pay({ payment_date: '2026-03-01', amount: 80000, vat_withheld: 20000 })], '2026-04-30');
    expect(f.unpaid).toBe(20000);
    expect(f.unpaidFineBase).toBe(0);
    expect(f.fine).toBe(0);
  });

  it('leaves out invoices before 1 July 2023 and small ones issued before 2025', () => {
    expect(exclusionReason(inv({ invoice_date: '2023-06-30' }))).toMatch(/1er juillet 2023/);
    expect(exclusionReason(inv({ invoice_date: '2024-12-31', total_ttc: 10000 }))).toMatch(/10 000/);
    expect(exclusionReason(inv({ invoice_date: '2025-01-01', total_ttc: 10000 }))).toBeNull();
    expect(exclusionReason(inv({ invoice_date: '2024-12-31', total_ttc: 10000.01 }))).toBeNull();
    const old = delayFacts(inv({ invoice_date: '2024-10-01', due_date: '2024-11-30', total_ttc: 9000 }), [], '2026-01-01');
    expect(old.unpaidMonths).toBeGreaterThan(0);
    expect(old.fine).toBe(0);
  });

  it('reports invoices unpaid after their due date or paid late, not the others', () => {
    const rows = delayReport([
      inv(),
      inv({ id: 'i2', due_date: '2026-12-31' }),
      inv({ id: 'i3', status: 'draft' }),
      inv({ id: 'i4', paid_amount: 120000 }),
    ], [pay({ invoice_id: 'i4', payment_date: '2026-03-01', amount: 120000 })], suppliers, '2026-04-01');
    expect(rows.map(r => r.invoice.id)).toEqual(['i1']);
    expect(rows[0].facts.daysLate).toBe(21);
  });
});

describe('quarterly declaration', () => {
  it('gives the period and its deadline (end of the month after the quarter)', () => {
    expect(periodRange({ year: 2026, period: 2 })).toEqual({ start: '2026-04-01', end: '2026-06-30', label: 'T2 2026', deadline: '2026-07-31' });
    expect(periodRange({ year: 2026, period: 4 }).deadline).toBe('2027-01-31');
  });

  it('declares invoices unpaid at the quarter end and payments made late during it', () => {
    const invoices = [
      inv(),
      inv({ id: 'i2', supplier_invoice_number: 'FA-78', due_kind: 'agreed', due_date: '2026-05-10' }),
      inv({ id: 'i3', supplier_invoice_number: 'FA-79', due_date: '2026-07-15' }),
      inv({ id: 'i4', supplier_invoice_number: 'FA-80', due_date: '2026-02-01' }),
    ];
    const payments = [
      pay({ invoice_id: 'i1', payment_date: '2026-04-15', amount: 120000, mode: 'cheque', reference: 'CHQ-7' }),
      pay({ id: 'p4', invoice_id: 'i4', payment_date: '2026-03-01', amount: 120000 }),
    ];
    const lines = declarationLines({ year: 2026, period: 2 }, invoices, payments, suppliers);
    expect(lines.map(l => l.invoice.id)).toEqual(['i1', 'i2']);
    const [a, b] = lines;
    expect(a.fields).toMatchObject({
      identifiantFiscal: '1234567', ice: '001234567000089', raisonSociale: 'Inox Maroc', nom: '', numFacture: 'FA-77', dateEmission: '2026-01-10',
      natureMarchandise: 'Fours mixtes', dateLivraisonMarchandise: '2026-01-08', datePrevuePaiement: '2026-03-11', dateConvenuePaiementFacture: '',
      montantFactureTtc: 120000, montantNonEncorePaye: 0, montantPayeHorsDelai: 120000, datePaiementHorsDelai: '2026-04-15', nombreRetardHorsDelai: 2,
      modePaiement: '2', referencePaiement: 'CHQ-7',
    });
    expect(b.fields).toMatchObject({ datePrevuePaiement: '', dateConvenuePaiementFacture: '2026-05-10', montantNonEncorePaye: 120000, nombreMoisRetardNonPaye: 2 });
    expect(a.missing).toEqual([]);
  });

  it('lists the missing data per invoice and in the header', () => {
    const bare = new Map([['s1', { ...supplier, if_number: null, ice: '12', rc: null, address: null, city: null }]]);
    const [l] = declarationLines({ year: 2026, period: 2 }, [inv({ delivery_date: null, reception_date: null })], [pay({ payment_date: '2026-04-15', amount: 1000, mode: 'carte' })], bare);
    expect(l.missing).toEqual(['IF du fournisseur', 'ICE du fournisseur (15 chiffres)', 'RC du fournisseur', 'adresse du fournisseur', 'date de livraison', 'mode de paiement sans code DGI (carte)']);
    expect(headerMissing({ identifiantFiscal: '', year: 2026, period: 2, inProceedings: true, turnover: null })).toEqual([
      'IF de la société (paramètres de la société)', 'chiffre d’affaires HT de l’année précédente', 'date du jugement d’ouverture de la procédure',
    ]);
    expect(declarationCsvRows([l])[0]).toMatchObject({ 'N° facture': 'FA-77', 'Taux directeur appliqué (%)': 2.25 });
  });

  it('writes the XML in the XSD order, one FactureHorsDelai per invoice', () => {
    const lines = declarationLines({ year: 2026, period: 2 }, [inv(), inv({ id: 'i2', supplier_invoice_number: 'A&B <2>' })], [], suppliers);
    const xml = declarationXml({ identifiantFiscal: '84016950', year: 2026, period: 2, inProceedings: false, turnover: 80000000.4 }, lines);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<DeclarationDelaiPaiement>')).toBe(true);
    const header = ['identifiantFiscal', 'annee', 'periode', 'activiteNormale', 'procSauvRedressLiquid', 'chiffreAffaire', 'listeFacturesHorsDelai'];
    const positions = header.map(t => xml.indexOf(`<${t}>`));
    expect(positions.every((p, i) => p > 0 && (i === 0 || p > positions[i - 1]))).toBe(true);
    expect(xml).toContain('<activiteNormale>1</activiteNormale>');
    expect(xml).not.toContain('dateJugementOuvrProc');
    expect(xml).toContain('<chiffreAffaire>80000000</chiffreAffaire>');
    expect(xml.match(/<FactureHorsDelai>/g)).toHaveLength(2);
    expect(xml).toContain('<numFacture>A&amp;B &lt;2&gt;</numFacture>');
    expect(xml).toContain('<montantNonEncorePaye>120000.00</montantNonEncorePaye>');
    expect(xml).not.toContain('<datePaiementHorsDelai>');
    const row = ['identifiantFiscal', 'ice', 'numRC', 'nom', 'prenom', 'raisonSociale', 'adresseSiegeSocial', 'numFacture', 'dateEmission', 'natureMarchandise',
      'dateLivraisonMarchandise', 'datePrevuePaiement', 'delaiPaiementSecteurActivite', 'montantFactureTtc', 'montantNonEncorePaye', 'nombreMoisRetardNonPaye',
      'montantPayeHorsDelai', 'nombreRetardHorsDelai', 'montantObjetDeLitige', 'montantApresJugement', 'nombreMoisSuspension', 'modePaiement', 'referencePaiement'];
    const first = xml.slice(xml.indexOf('<FactureHorsDelai>'), xml.indexOf('</FactureHorsDelai>'));
    const pos = row.map(t => first.indexOf(`<${t}>`));
    expect(pos.every((p, i) => p > 0 && (i === 0 || p > pos[i - 1]))).toBe(true);
  });

  it('a nil declaration still has its header; proceedings carry the judgment date', () => {
    const xml = declarationXml({ identifiantFiscal: '1', year: 2026, period: 1, inProceedings: true, judgmentDate: '2026-02-01', turnover: 3000000 }, []);
    expect(xml).toContain('<listeFacturesHorsDelai/>');
    expect(xml).toContain('<activiteNormale>2</activiteNormale>\n\t<procSauvRedressLiquid>1</procSauvRedressLiquid>\n\t<dateJugementOuvrProc>2026-02-01</dateJugementOuvrProc>');
  });
});

describe('zip for SIMPL', () => {
  it('stores one UTF-8 file with a correct CRC', () => {
    expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610a686);
    const z = zipOneFile('déclaration.xml', '<a>é</a>', new Date(2026, 10, 25, 10, 0, 0));
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint32(14, true)).toBe(crc32(new TextEncoder().encode('<a>é</a>')));
    expect(v.getUint32(z.length - 22, true)).toBe(0x06054b50);
    expect(v.getUint16(z.length - 12 + 2, true)).toBeGreaterThan(0);
  });
});
