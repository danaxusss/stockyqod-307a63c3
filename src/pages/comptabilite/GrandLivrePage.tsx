import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Download, FileText, Search } from 'lucide-react';
import type { Account, FiscalYear, Journal } from '../../types';
import { AccountingService } from '../../utils/supabaseAccounting';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { PageHeader } from '../../components/PageHeader';
import { btnSecondary, EmptyState, field, LoadingState, MobileField, panel, td, tdNum, th, theadRow, thRight } from '../../components/backoffice/BackOfficeUi';
import { downloadText, grandLivreRows, reportHeader, toCsv } from '../../accounting/ledgerExport';
import { errorText } from '../../accounting/errors';

function fmt(n: number) { return n === 0 ? '' : new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }

export default function GrandLivrePage() {
  const { showToast } = useToast();
  const { companyName } = useAuth();
  const [fy, setFy] = useState<FiscalYear | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [lines, setLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const year = await AccountingService.ensureCurrentFiscalYear();
      setFy(year);
      const [a, l, j] = await Promise.all([AccountingService.listAccounts(), AccountingService.getPostedLines(year.id), AccountingService.listJournals()]);
      setAccounts(a); setLines(l); setJournals(j);
    } catch (e) { showToast({ type: 'error', message: errorText(e, 'Erreur') }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const accByCode = useMemo(() => new Map(accounts.map(a => [a.code, a])), [accounts]);

  // Accounts that have movements
  const movedCodes = useMemo(() => {
    const s = new Set<string>();
    lines.forEach(l => s.add(l.account_code));
    return Array.from(s).sort();
  }, [lines]);

  const accountLines = useMemo(() => {
    if (!selected) return [];
    return lines
      .filter(l => l.account_code === selected)
      .sort((a, b) => (a.entry_date < b.entry_date ? -1 : a.entry_date > b.entry_date ? 1 : 0));
  }, [lines, selected]);

  const rows = useMemo(() => {
    let solde = 0;
    return accountLines.map(l => {
      solde += (Number(l.debit) || 0) - (Number(l.credit) || 0);
      return { ...l, solde };
    });
  }, [accountLines]);

  // CSV of the displayed account, or of every account that moved, headed by
  // the company, year, date produced and software (CNC avis 24 §2.7).
  const exportCsv = (all: boolean) => {
    if (!fy) return;
    const codes = all ? movedCodes : [selected];
    const journalCode = new Map(journals.map(j => [j.id, j.code]));
    const report = all ? 'Grand livre - tous les comptes' : `Grand livre - compte ${selected} ${accByCode.get(selected)?.label || ''}`.trim();
    const rows = [
      ...reportHeader({ company: companyName || '', report, fiscalYear: fy, producedAt: new Date() }),
      ...grandLivreRows(lines, codes, c => accByCode.get(c)?.label || '', id => journalCode.get(id || '') || ''),
    ];
    downloadText(toCsv(rows), `grand-livre-${all ? 'tous-comptes' : selected}-${fy.label}.csv`, 'text/csv;charset=utf-8;');
  };

  const soldeFmt = (n: number) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n);

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="Grand livre"
        subtitle={`Exercice ${fy?.label ?? ''} · ${movedCodes.length} comptes mouvementés`}
        actions={<>
          <button onClick={() => exportCsv(false)} disabled={!selected || accountLines.length === 0} className={btnSecondary}><Download className="h-4 w-4" /> CSV du compte</button>
          <button onClick={() => exportCsv(true)} disabled={movedCodes.length === 0} className={btnSecondary}><Download className="h-4 w-4" /> CSV tous les comptes</button>
        </>}
      >
        <div className={`${panel} p-3`}>
          <div className="relative sm:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input list="gl-accounts" value={selected} onChange={e => setSelected(e.target.value.split(' ')[0])} placeholder="Choisir un compte…" aria-label="Compte"
              className={`${field} pl-9 font-mono`} />
            <datalist id="gl-accounts">
              {movedCodes.map(c => <option key={c} value={c}>{c} — {accByCode.get(c)?.label || ''}</option>)}
            </datalist>
          </div>
        </div>
      </PageHeader>

      {loading ? (
        <LoadingState />
      ) : !selected ? (
        <div className={panel}>
          <EmptyState icon={FileText} title="Sélectionnez un compte pour afficher son grand livre." hint={`${movedCodes.length} comptes mouvementés.`} />
        </div>
      ) : (
        <section className={`${panel} overflow-hidden`}>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-border px-4 py-3 sm:px-5">
            <h2 className="font-mono font-semibold text-foreground">{selected}</h2>
            <span className="text-sm text-muted-foreground">{accByCode.get(selected)?.label || ''}</span>
          </div>
          {rows.length === 0 ? (
            <EmptyState title="Aucun mouvement" />
          ) : (
            <>
              <ul className="divide-y divide-border md:hidden">
                {rows.map((l, i) => (
                  <li key={l.id || i} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{l.label || l.entry_label || ''}</p>
                        <p className="truncate text-xs text-muted-foreground">{new Date(l.entry_date).toLocaleDateString('fr-FR')} · {l.reference || '—'}</p>
                      </div>
                      <p className={`shrink-0 text-sm font-semibold tabular-nums ${l.solde < 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>{soldeFmt(l.solde)}</p>
                    </div>
                    <dl className="mt-1.5 grid grid-cols-2 gap-x-4">
                      <MobileField label="Débit">{fmt(Number(l.debit)) || '—'}</MobileField>
                      <MobileField label="Crédit">{fmt(Number(l.credit)) || '—'}</MobileField>
                    </dl>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={theadRow}>
                      <th className={th}>Date</th>
                      <th className={th}>Pièce</th>
                      <th className={th}>Libellé</th>
                      <th className={thRight}>Débit</th>
                      <th className={thRight}>Crédit</th>
                      <th className={thRight}>Solde</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((l, i) => (
                      <tr key={l.id || i} className="hover:bg-secondary/40">
                        <td className={`${td} whitespace-nowrap text-muted-foreground`}>{new Date(l.entry_date).toLocaleDateString('fr-FR')}</td>
                        <td className={`${td} font-mono text-xs text-muted-foreground`}>{l.reference || '—'}</td>
                        <td className={`${td} text-foreground`}>{l.label || l.entry_label || ''}</td>
                        <td className={`${tdNum} text-foreground`}>{fmt(Number(l.debit))}</td>
                        <td className={`${tdNum} text-foreground`}>{fmt(Number(l.credit))}</td>
                        <td className={`${tdNum} font-semibold ${l.solde < 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>{soldeFmt(l.solde)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
