import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, FileCode2, Clock } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { useCompactList } from '../../hooks/use-mobile';
import { useToast } from '../../context/ToastContext';
import { btnSecondary, EmptyState, field, fieldAuto, fieldLabel, KpiTile, LoadingState, panel, Segmented, td, tdNum, th, thRight, theadRow, tfootRow } from '../../components/backoffice/BackOfficeUi';
import { formatMoney } from '../../utils/format';
import { exportToCSV } from '../../utils/csvExport';
import { downloadBlob, zipOneFile } from '../../utils/zipStore';
import { getCompanyContext } from '../../utils/supabaseCompanyFilter';
import { SupabaseCompaniesService } from '../../utils/supabaseCompanies';
import { frDay, r2, supplierDisplayName, today, type Supplier, type SupplierInvoice, type SupplierPayment } from '../../accounting/supplierInvoices';
import {
  declarationCsvRows, declarationLines, declarationXml, delayReport, headerMissing, KEY_RATE_SOURCE, KEY_RATES, periodRange,
  type DeclarationPeriod,
} from '../../accounting/paymentDelays';
import { SupplierInvoicesService, SupplierSchemaMissingError, SuppliersService } from '../../utils/supabaseSuppliers';
import { Notice, SchemaMissingNotice, SupplierTabs } from './SupplierUi';
import { SUPPLIER_INVOICES_PATH } from './SupplierInvoicesPage';

const pct = (n: number) => `${n.toLocaleString('fr-FR')} %`;

const currentQuarter = (): DeclarationPeriod => {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3); // the quarter just ended is the one to file
  return q === 0 ? { year: d.getFullYear() - 1, period: 4 } : { year: d.getFullYear(), period: q as 1 | 2 | 3 };
};

export default function PaymentDelaysPage() {
  const { showToast } = useToast();
  const compact = useCompactList();
  const [view, setView] = useState<'report' | 'declaration'>('report');
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [payments, setPayments] = useState<SupplierPayment[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [companyIf, setCompanyIf] = useState('');
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [asOf, setAsOf] = useState(today());
  const [period, setPeriod] = useState<DeclarationPeriod>(currentQuarter);
  const [turnover, setTurnover] = useState('');
  const [proceedings, setProceedings] = useState(false);
  const [judgmentDate, setJudgmentDate] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { companyId } = getCompanyContext();
      const [inv, pay, sup, company] = await Promise.all([
        SupplierInvoicesService.list(), SupplierInvoicesService.payments(), SuppliersService.list(),
        companyId ? SupabaseCompaniesService.getCompanyById(companyId).catch(() => null) : Promise.resolve(null),
      ]);
      setInvoices(inv); setPayments(pay); setSuppliers(sup); setCompanyIf(company?.if_number || ''); setMissing(false);
    } catch (e) {
      if (e instanceof SupplierSchemaMissingError) setMissing(true);
      else showToast({ type: 'error', title: 'Erreur', message: (e as Error).message });
    } finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const supplierMap = useMemo(() => new Map(suppliers.map(s => [s.id, s])), [suppliers]);
  const report = useMemo(() => delayReport(invoices, payments, supplierMap, asOf), [invoices, payments, supplierMap, asOf]);
  const lines = useMemo(() => declarationLines(period, invoices, payments, supplierMap), [period, invoices, payments, supplierMap]);
  const range = periodRange(period);
  const header = { identifiantFiscal: companyIf, year: period.year, period: period.period, inProceedings: proceedings, judgmentDate, turnover: turnover === '' ? null : Math.round(Number(turnover)) };
  const headerProblems = headerMissing(header);
  const reportTotals = useMemo(() => ({
    unpaid: r2(report.reduce((s, r) => s + (r.facts.unpaidMonths > 0 ? r.facts.unpaid : 0), 0)),
    paidLate: r2(report.reduce((s, r) => s + r.facts.paidLate, 0)),
    fine: r2(report.reduce((s, r) => s + r.facts.fine, 0)),
  }), [report]);
  const declTotals = useMemo(() => ({ fine: r2(lines.reduce((s, l) => s + l.fields.amende, 0)), incomplete: lines.filter(l => l.missing.length).length }), [lines]);

  const reportCsv = () => exportToCSV(report.map(r => ({
    'Fournisseur': supplierDisplayName(r.supplier), 'IF': r.supplier?.if_number || '', 'ICE': r.supplier?.ice || '',
    'N° facture': r.invoice.supplier_invoice_number, 'Date facture': frDay(r.invoice.invoice_date), 'Échéance': frDay(r.facts.dueDate),
    'Jours de retard': r.facts.daysLate, 'Mois de retard': r.facts.unpaidMonths || r.facts.late[r.facts.late.length - 1]?.months || 0,
    'TTC': r.invoice.total_ttc, 'Non payé': r.facts.unpaid, 'Payé en retard': r.facts.paidLate,
    'Taux directeur appliqué (%)': r.facts.keyRate.rate, 'Amende estimée': r.facts.fine, 'Hors champ': r.facts.excluded || '',
  })), `retards-paiement-${asOf}`);

  const xml = () => declarationXml(header, lines);
  const fileBase = `delais-paiement-${period.year}-${period.period === 5 ? 'annuel' : `T${period.period}`}`;

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader title="Délais de paiement" subtitle="Loi 69-21 : factures fournisseurs payées en retard, amende due par l’acheteur, déclaration SIMPL">
        <div className="flex flex-wrap items-center gap-3">
          <SupplierTabs current="delays" />
          <Segmented<'report' | 'declaration'> label="Vue" value={view} onChange={setView} options={[{ value: 'report', label: 'Retards' }, { value: 'declaration', label: 'Déclaration' }]} />
        </div>
      </PageHeader>

      {loading ? <LoadingState /> : missing ? <SchemaMissingNotice /> : view === 'report' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile label="Factures en retard" value={report.length} />
            <KpiTile label="Non payé, échu" value={formatMoney(reportTotals.unpaid)} />
            <KpiTile label="Payé en retard" value={formatMoney(reportTotals.paidLate)} />
            <KpiTile label="Amende estimée" value={formatMoney(reportTotals.fine)} valueClassName={reportTotals.fine > 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground'} />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm text-muted-foreground">Situation au <input type="date" value={asOf} onChange={e => setAsOf(e.target.value || today())} className={`${fieldAuto} ml-1`} /></label>
            <button onClick={reportCsv} disabled={report.length === 0} className={btnSecondary}><Download className="h-4 w-4" />CSV</button>
          </div>
          <Notice>
            Amende = taux directeur de Bank Al-Maghrib pour le 1er mois de retard, puis 0,85 % par mois ou fraction de mois supplémentaire, sur le montant TTC payé en retard ou non payé.
            Le retard court de l’échéance : date de facture (ou fin du mois de livraison si la facture est plus tardive) + 60 jours, ou le délai convenu (120 jours au plus).
            Hors champ : factures avant le 1er juillet 2023, factures de 10 000 DH ou moins émises avant 2025, montants en litige.
            <span className="mt-1 block text-xs">{KEY_RATE_SOURCE} Taux : {KEY_RATES.map(k => k.label).join(' ; ')}.</span>
          </Notice>
          <div className={`${panel} overflow-hidden`}>
            {report.length === 0 ? <EmptyState icon={Clock} title="Aucune facture en retard" /> : compact ? (
              <ul className="divide-y divide-border">
                {report.map(r => (
                  <li key={r.invoice.id}><Link to={`${SUPPLIER_INVOICES_PATH}/${r.invoice.id}`} className="block px-4 py-3 active:bg-secondary">
                    <div className="flex justify-between gap-2"><span className="truncate font-medium text-foreground">{supplierDisplayName(r.supplier)}</span><span className="font-semibold tabular-nums text-red-600 dark:text-red-400">{formatMoney(r.facts.fine)}</span></div>
                    <p className="text-xs text-muted-foreground">Facture {r.invoice.supplier_invoice_number} · échéance {frDay(r.facts.dueDate)} · {r.facts.daysLate} j · taux {pct(r.facts.keyRate.rate)}{r.facts.excluded ? ` · ${r.facts.excluded}` : ''}</p>
                  </Link></li>
                ))}
              </ul>
            ) : (
              <table className="w-full text-sm">
                <thead className={theadRow}><tr>
                  <th className={th}>Fournisseur</th><th className={th}>Facture</th><th className={th}>Échéance</th><th className={thRight}>Retard</th>
                  <th className={thRight}>Non payé</th><th className={thRight}>Payé en retard</th><th className={thRight}>Taux directeur</th><th className={thRight}>Amende estimée</th>
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {report.map(r => (
                    <tr key={r.invoice.id}>
                      <td className={td}>{supplierDisplayName(r.supplier)}</td>
                      <td className={td}><Link to={`${SUPPLIER_INVOICES_PATH}/${r.invoice.id}`} className="text-primary hover:underline">{r.invoice.supplier_invoice_number}</Link> <span className="text-xs text-muted-foreground">du {frDay(r.invoice.invoice_date)}</span></td>
                      <td className={`${td} whitespace-nowrap`}>{frDay(r.facts.dueDate)}</td>
                      <td className={tdNum}>{r.facts.daysLate} j</td>
                      <td className={tdNum}>{r.facts.unpaidMonths > 0 ? formatMoney(r.facts.unpaid) : '—'}</td>
                      <td className={tdNum}>{r.facts.paidLate > 0 ? formatMoney(r.facts.paidLate) : '—'}</td>
                      <td className={tdNum}>{pct(r.facts.keyRate.rate)}</td>
                      <td className={`${tdNum} font-semibold`}>{r.facts.excluded ? <span className="text-xs font-normal text-muted-foreground">{r.facts.excluded}</span> : formatMoney(r.facts.fine)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className={tfootRow}><td className={td} colSpan={4}>Total</td><td className={tdNum}>{formatMoney(reportTotals.unpaid)}</td><td className={tdNum}>{formatMoney(reportTotals.paidLate)}</td><td className={td} /><td className={tdNum}>{formatMoney(reportTotals.fine)}</td></tr></tfoot>
              </table>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Notice>
            Déclaration obligatoire pour les entreprises dont le chiffre d’affaires HT de l’année précédente dépasse 2 millions de dirhams : trimestrielle à partir de 2026,
            à déposer sur SIMPL-Délais de paiement avant la fin du mois qui suit le trimestre (ici : au plus tard le {frDay(range.deadline)}). À déposer même sans facture en retard.
            L’état doit être visé par un expert-comptable ou comptable agréé (commissaire aux comptes au-delà de 50 M MAD).
          </Notice>
          <section className={`${panel} grid gap-3 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-5`}>
            <div>
              <label htmlFor="dp-year" className={fieldLabel}>Année</label>
              <input id="dp-year" type="number" value={period.year} onChange={e => setPeriod(p => ({ ...p, year: Number(e.target.value) || p.year }))} className={field} />
            </div>
            <div>
              <label htmlFor="dp-period" className={fieldLabel}>Période</label>
              <select id="dp-period" value={period.period} onChange={e => setPeriod(p => ({ ...p, period: Number(e.target.value) as DeclarationPeriod['period'] }))} className={field}>
                {[1, 2, 3, 4].map(q => <option key={q} value={q}>Trimestre {q}</option>)}
                <option value={5}>Année (déclarations 2024 et 2025)</option>
              </select>
            </div>
            <div>
              <label htmlFor="dp-ca" className={fieldLabel}>CA HT de {period.year - 1} (DH)</label>
              <input id="dp-ca" type="number" min={0} value={turnover} onChange={e => setTurnover(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="dp-activity" className={fieldLabel}>Activité</label>
              <select id="dp-activity" value={proceedings ? '2' : '1'} onChange={e => setProceedings(e.target.value === '2')} className={field}>
                <option value="1">Activité normale</option>
                <option value="2">Procédure de sauvegarde, redressement ou liquidation</option>
              </select>
            </div>
            {proceedings && (
              <div>
                <label htmlFor="dp-judgment" className={fieldLabel}>Date du jugement d’ouverture</label>
                <input id="dp-judgment" type="date" value={judgmentDate} onChange={e => setJudgmentDate(e.target.value)} className={field} />
              </div>
            )}
          </section>

          {(headerProblems.length > 0 || declTotals.incomplete > 0) && (
            <Notice tone="warning">
              <span className="font-semibold">À compléter avant le dépôt :</span>
              <ul className="mt-1 list-disc pl-5">
                {headerProblems.map(p => <li key={p}>{p}</li>)}
                {lines.filter(l => l.missing.length).map(l => <li key={l.invoice.id}>{supplierDisplayName(l.supplier)}, facture {l.invoice.supplier_invoice_number} : {l.missing.join(', ')}</li>)}
              </ul>
            </Notice>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">{range.label} : {lines.length} facture(s) à déclarer · amende estimée {formatMoney(declTotals.fine)} (SIMPL calcule le montant définitif)</span>
            <button onClick={() => exportToCSV(declarationCsvRows(lines), fileBase)} disabled={lines.length === 0} className={btnSecondary}><Download className="h-4 w-4" />CSV</button>
            <button onClick={() => downloadBlob(zipOneFile(`${fileBase}.xml`, xml()), `${fileBase}.zip`, 'application/zip')} className={btnSecondary}><FileCode2 className="h-4 w-4" />Fichier XML (zip) — à vérifier sur SIMPL</button>
          </div>
          <p className="text-xs text-muted-foreground">Le fichier XML suit le schéma XSD publié par la DGI ; l’exemple officiel s’en écarte par endroits. Déposez-le d’abord en mode EDI pour contrôle, et vérifiez la déclaration obtenue sur le portail SIMPL avant de la valider.</p>

          <div className={`${panel} overflow-x-auto`}>
            {lines.length === 0 ? <EmptyState icon={Clock} title="Aucune facture à déclarer pour cette période" hint="La déclaration reste due : déposez-la sur SIMPL sans facture." /> : (
              <table className="w-full text-sm">
                <thead className={theadRow}><tr>
                  <th className={th}>IF / ICE</th><th className={th}>Fournisseur</th><th className={th}>Facture</th><th className={th}>Livraison</th><th className={th}>Échéance</th>
                  <th className={thRight}>TTC</th><th className={thRight}>Non payé</th><th className={thRight}>Mois</th><th className={thRight}>Payé hors délai</th><th className={th}>Payé le</th><th className={thRight}>Mois</th><th className={th}>Mode</th><th className={thRight}>Amende</th>
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {lines.map(l => (
                    <tr key={l.invoice.id} className={l.missing.length ? 'bg-amber-500/5' : ''}>
                      <td className={`${td} font-mono text-xs`}>{l.fields.identifiantFiscal || '—'}<br />{l.fields.ice || '—'}</td>
                      <td className={td}>{supplierDisplayName(l.supplier)}</td>
                      <td className={td}>{l.fields.numFacture}<br /><span className="text-xs text-muted-foreground">{frDay(l.fields.dateEmission)}</span></td>
                      <td className={`${td} whitespace-nowrap`}>{frDay(l.fields.dateLivraisonMarchandise || null)}</td>
                      <td className={`${td} whitespace-nowrap`}>{frDay(l.fields.datePrevuePaiement || l.fields.dateConvenuePaiementFacture)}<br /><span className="text-xs text-muted-foreground">{l.fields.dateConvenuePaiementFacture ? 'convenue' : 'prévue'}</span></td>
                      <td className={tdNum}>{formatMoney(l.fields.montantFactureTtc)}</td>
                      <td className={tdNum}>{formatMoney(l.fields.montantNonEncorePaye)}</td>
                      <td className={tdNum}>{l.fields.nombreMoisRetardNonPaye || '—'}</td>
                      <td className={tdNum}>{formatMoney(l.fields.montantPayeHorsDelai)}</td>
                      <td className={`${td} whitespace-nowrap`}>{l.fields.datePaiementHorsDelai ? frDay(l.fields.datePaiementHorsDelai) : '—'}</td>
                      <td className={tdNum}>{l.fields.nombreRetardHorsDelai || '—'}</td>
                      <td className={td}>{l.fields.modePaiement || '—'}</td>
                      <td className={`${tdNum} font-semibold`}>{formatMoney(l.fields.amende)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
