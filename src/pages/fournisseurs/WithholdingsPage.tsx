import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Receipt } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../context/ToastContext';
import { btnSecondary, EmptyState, fieldAuto, KpiTile, LoadingState, panel, td, tdNum, th, thRight, theadRow, tfootRow } from '../../components/backoffice/BackOfficeUi';
import { formatMoney } from '../../utils/format';
import { exportToCSV } from '../../utils/csvExport';
import { frDay, today, type Supplier, type SupplierInvoice, type SupplierPayment } from '../../accounting/supplierInvoices';
import { remittanceMonth, withholdingStatement, type WithholdingRow } from '../../accounting/supplierWithholding';
import { SupplierInvoicesService, SupplierSchemaMissingError, SuppliersService } from '../../utils/supabaseSuppliers';
import { Notice, SchemaMissingNotice, SupplierTabs } from './SupplierUi';

const monthLabel = (m: string) => new Date(`${m}-01T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

export default function WithholdingsPage() {
  const { showToast } = useToast();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [payments, setPayments] = useState<SupplierPayment[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [inv, pay, sup] = await Promise.all([SupplierInvoicesService.list(), SupplierInvoicesService.payments(), SuppliersService.list()]);
      setInvoices(inv); setPayments(pay); setSuppliers(sup); setMissing(false);
    } catch (e) {
      if (e instanceof SupplierSchemaMissingError) setMissing(true);
      else showToast({ type: 'error', title: 'Erreur', message: (e as Error).message });
    } finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const statement = useMemo(() => {
    const sup = new Map(suppliers.map(s => [s.id, s]));
    const inv = new Map(invoices.map(i => {
      const s = sup.get(i.supplier_id);
      return [i.id, { ...i, supplier: { name: s ? (s.legal_type === 'personne_physique' && s.first_name ? `${s.name} ${s.first_name}` : s.name) : '—', if_number: s?.if_number, ice: s?.ice } }];
    }));
    return withholdingStatement(month, payments, inv);
  }, [month, payments, invoices, suppliers]);

  const csv = (rows: WithholdingRow[], kind: string) => exportToCSV(rows.map(r => ({
    'Retenue': r.kind, 'Fournisseur': r.supplier, 'IF': r.if_number, 'ICE': r.ice, 'N° facture': r.invoice_number,
    'Date facture': frDay(r.invoice_date), 'Date de paiement': frDay(r.payment_date),
    [r.kind === 'TVA' ? 'TVA de la part réglée' : 'Base HT de la part réglée']: r.base, 'Taux (%)': r.rate, 'Montant retenu': r.amount,
  })), `retenues-${kind}-${month}`);

  const table = (rows: WithholdingRow[], total: number, kind: 'TVA' | 'IR/IS') => (
    <section className={`${panel} overflow-hidden`}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <h2 className="font-semibold text-foreground">{kind === 'TVA' ? 'TVA retenue à la source (art. 117)' : 'IR / IS retenus à la source (art. 15 bis, 157)'}</h2>
        <button onClick={() => csv(rows, kind === 'TVA' ? 'tva' : 'ir')} disabled={rows.length === 0} className={btnSecondary}><Download className="h-4 w-4" />CSV</button>
      </div>
      {rows.length === 0 ? <EmptyState icon={Receipt} title="Aucune retenue ce mois" /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={theadRow}><tr>
              <th className={th}>Fournisseur</th><th className={th}>IF</th><th className={th}>ICE</th><th className={th}>Facture</th><th className={th}>Payée le</th>
              <th className={thRight}>{kind === 'TVA' ? 'TVA réglée' : 'Base HT'}</th><th className={thRight}>Taux</th><th className={thRight}>Retenu</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className={td}>{r.supplier}</td><td className={`${td} font-mono text-xs`}>{r.if_number || '—'}</td><td className={`${td} font-mono text-xs`}>{r.ice || '—'}</td>
                  <td className={td}>{r.invoice_number}<br /><span className="text-xs text-muted-foreground">{frDay(r.invoice_date)}</span></td>
                  <td className={`${td} whitespace-nowrap`}>{frDay(r.payment_date)}</td>
                  <td className={tdNum}>{formatMoney(r.base)}</td><td className={tdNum}>{r.rate} %</td><td className={`${tdNum} font-semibold`}>{formatMoney(r.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className={tfootRow}><td className={td} colSpan={7}>Total à verser</td><td className={tdNum}>{formatMoney(total)}</td></tr></tfoot>
          </table>
        </div>
      )}
    </section>
  );

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader title="Retenues à la source" subtitle="État mensuel des retenues sur paiements fournisseurs, pour le bordereau-avis">
        <SupplierTabs current="withholdings" />
      </PageHeader>
      {loading ? <LoadingState /> : missing ? <SchemaMissingNotice /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm text-muted-foreground">Mois des paiements <input type="month" value={month} onChange={e => setMonth(e.target.value || month)} className={`${fieldAuto} ml-1`} /></label>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile label="TVA retenue" value={formatMoney(statement.totalVat)} hint={`${statement.vat.length} paiement(s)`} />
            <KpiTile label="IR / IS retenus" value={formatMoney(statement.totalIr)} hint={`${statement.ir.length} paiement(s)`} />
          </div>
          <Notice>Paiements de {monthLabel(month)} : les montants retenus sont à verser au receveur des impôts au cours de {monthLabel(remittanceMonth(`${month}-01`))}, avec le bordereau-avis (TVA et IR/IS séparément).</Notice>
          {table(statement.vat, statement.totalVat, 'TVA')}
          {table(statement.ir, statement.totalIr, 'IR/IS')}
        </div>
      )}
    </div>
  );
}
