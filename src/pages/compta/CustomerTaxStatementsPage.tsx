import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import type { Quote } from '../../types';
import { SupabaseDocumentsService } from '../../utils/supabaseDocuments';
import { CompanySettingsService } from '../../utils/companySettings';
import { getCompanyContext } from '../../utils/supabaseCompanyFilter';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { exportToCSV } from '../../utils/csvExport';
import { formatMoney } from '../../utils/format';
import { formatDay, localDay } from '../../utils/documentLines';
import { stampDutyCsvRows, stampDutyStatement, sumBy, withholdingCsvRows, withholdingStatement } from '../../utils/customerTaxStatements';
import { PageHeader, Panel } from '../../components/PageHeader';
import { btnSecondary, field, fieldLabel, LoadingState, td, tdNum, th, theadRow, thRight, tfootRow } from '../../components/backoffice/BackOfficeUi';

/**
 * The two statements built from customer settlements: VAT withheld at
 * source by clients over a period (for the VAT return and the refund claim)
 * and stamp duty collected on cash in a month (for its declaration).
 */
export default function CustomerTaxStatementsPage() {
  const { isSuperAdmin, isCompta } = useAuth();
  const { showToast } = useToast();
  const today = localDay();
  const [invoices, setInvoices] = useState<Quote[]>([]);
  const [companyRate, setCompanyRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { companyId } = getCompanyContext();
      setInvoices(companyId ? await SupabaseDocumentsService.getIssuedInvoicesWithDrafts(companyId) : await SupabaseDocumentsService.getAllByType('invoice'));
      const settings = companyId ? await CompanySettingsService.getSettings(companyId).catch(() => null) : null;
      setCompanyRate(settings?.tva_rate ?? null);
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const withheld = useMemo(() => withholdingStatement(invoices, from, to, companyRate), [invoices, from, to, companyRate]);
  const stamps = useMemo(() => stampDutyStatement(invoices, month), [invoices, month]);

  if (!isSuperAdmin && !isCompta) return <div className="py-12 text-center text-muted-foreground">Accès réservé au rôle Comptabilité.</div>;
  if (loading) return <LoadingState />;

  return (
    <div className="mx-auto max-w-[110rem] space-y-5">
      <PageHeader title="Retenue de TVA et droit de timbre" subtitle="Établis depuis les règlements des factures clients, chacun à sa date." />

      <Panel title="TVA retenue à la source par les clients (art. 117-IV CGI)"
        action={<button type="button" className={btnSecondary} disabled={!withheld.length}
          onClick={() => exportToCSV(withholdingCsvRows(withheld), `tva-retenue-clients-${from}-${to}`)}><Download className="h-4 w-4" />CSV</button>}>
        <div className="flex flex-wrap gap-3 px-4 pt-3 sm:px-5">
          <label className="w-40"><span className={fieldLabel}>Du</span><input type="date" value={from} onChange={e => setFrom(e.target.value)} className={field} /></label>
          <label className="w-40"><span className={fieldLabel}>Au</span><input type="date" value={to} onChange={e => setTo(e.target.value)} className={field} /></label>
        </div>
        <p className="px-4 pt-2 text-xs text-muted-foreground sm:px-5">
          À joindre à la déclaration de TVA. La TVA retenue s’impute sur la TVA due ; le crédit qui en résulte est remboursable (art. 103-6° CGI). Compte 34581.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={theadRow}>
              <tr>
                <th className={th}>Date</th><th className={th}>Client</th><th className={th}>ICE</th><th className={th}>Facture</th>
                <th className={thRight}>Base HT</th><th className={thRight}>Taux</th><th className={thRight}>TVA retenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {withheld.map((r, i) => (
                <tr key={`${r.invoice}-${r.date}-${i}`}>
                  <td className={td}>{formatDay(r.date)}</td>
                  <td className={td}>{r.client || '—'}</td>
                  <td className={`${td} font-mono text-xs`}>{r.ice || <span className="text-amber-700 dark:text-amber-300">manquant</span>}</td>
                  <td className={td}>{r.invoice} <span className="text-xs text-muted-foreground">du {formatDay(r.invoiceDate)}</span></td>
                  <td className={tdNum}>{formatMoney(r.base)}</td>
                  <td className={tdNum}>{r.tvaRate} %{r.share !== 100 ? ` × ${r.share} %` : ''}</td>
                  <td className={`${tdNum} font-semibold`}>{formatMoney(r.withheld)}</td>
                </tr>
              ))}
              {!withheld.length && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Aucune retenue sur la période.</td></tr>}
            </tbody>
            {withheld.length > 0 && (
              <tfoot><tr className={tfootRow}>
                <td className={td} colSpan={4}>Total</td><td className={tdNum}>{formatMoney(sumBy(withheld, r => r.base))}</td><td />
                <td className={tdNum}>{formatMoney(sumBy(withheld, r => r.withheld))}</td>
              </tr></tfoot>
            )}
          </table>
        </div>
      </Panel>

      <Panel title="Droit de timbre sur règlements en espèces (art. 252-I-B CGI)"
        action={<button type="button" className={btnSecondary} disabled={!stamps.length}
          onClick={() => exportToCSV(stampDutyCsvRows(stamps), `droit-timbre-especes-${month}`)}><Download className="h-4 w-4" />CSV</button>}>
        <div className="flex flex-wrap gap-3 px-4 pt-3 sm:px-5">
          <label className="w-44"><span className={fieldLabel}>Mois</span><input type="month" value={month} onChange={e => setMonth(e.target.value)} className={field} /></label>
        </div>
        <p className="px-4 pt-2 text-xs text-muted-foreground sm:px-5">
          Droits perçus dans le mois, à déclarer et verser avant la fin du mois suivant (art. 254-II CGI). Compte 44578.
          Le réglage se trouve dans les <Link to="/admin/settings" className="text-primary hover:underline">paramètres de la société</Link>.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={theadRow}>
              <tr><th className={th}>Date</th><th className={th}>Client</th><th className={th}>Facture</th><th className={thRight}>Espèces</th><th className={thRight}>Droit de timbre</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stamps.map((r, i) => (
                <tr key={`${r.invoice}-${r.date}-${i}`}>
                  <td className={td}>{formatDay(r.date)}</td><td className={td}>{r.client || '—'}</td><td className={td}>{r.invoice}</td>
                  <td className={tdNum}>{formatMoney(r.cash)}</td><td className={`${tdNum} font-semibold`}>{formatMoney(r.duty)}</td>
                </tr>
              ))}
              {!stamps.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Aucun droit de timbre ce mois-ci.</td></tr>}
            </tbody>
            {stamps.length > 0 && (
              <tfoot><tr className={tfootRow}>
                <td className={td} colSpan={3}>Total</td><td className={tdNum}>{formatMoney(sumBy(stamps, r => r.cash))}</td>
                <td className={tdNum}>{formatMoney(sumBy(stamps, r => r.duty))}</td>
              </tr></tfoot>
            )}
          </table>
        </div>
      </Panel>
    </div>
  );
}
