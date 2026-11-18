import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Scale, Download } from 'lucide-react';
import type { Account, FiscalYear } from '../../types';
import { AccountingService } from '../../utils/supabaseAccounting';
import { useToast } from '../../context/ToastContext';
import { PageHeader } from '../../components/PageHeader';
import { btnSecondary, EmptyState, LoadingState, MobileField, panel, td, tdNum, tfootRow, th, theadRow, thRight } from '../../components/backoffice/BackOfficeUi';

function fmt(n: number) { return n === 0 ? '' : new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }

interface Row { code: string; label: string; debit: number; credit: number; soldeD: number; soldeC: number; }

export default function BalancePage() {
  const { showToast } = useToast();
  const [fy, setFy] = useState<FiscalYear | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [lines, setLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const year = await AccountingService.ensureCurrentFiscalYear();
      setFy(year);
      const [a, l] = await Promise.all([AccountingService.listAccounts(), AccountingService.getPostedLines(year.id)]);
      setAccounts(a); setLines(l);
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const accByCode = useMemo(() => new Map(accounts.map(a => [a.code, a])), [accounts]);

  const rows = useMemo<Row[]>(() => {
    const agg = new Map<string, { debit: number; credit: number }>();
    for (const l of lines) {
      const cur = agg.get(l.account_code) || { debit: 0, credit: 0 };
      cur.debit += Number(l.debit) || 0;
      cur.credit += Number(l.credit) || 0;
      agg.set(l.account_code, cur);
    }
    return Array.from(agg.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([code, v]) => {
      const net = v.debit - v.credit;
      return { code, label: accByCode.get(code)?.label || '', debit: v.debit, credit: v.credit, soldeD: net > 0 ? net : 0, soldeC: net < 0 ? -net : 0 };
    });
  }, [lines, accByCode]);

  const totals = useMemo(() => rows.reduce((t, r) => ({
    debit: t.debit + r.debit, credit: t.credit + r.credit, soldeD: t.soldeD + r.soldeD, soldeC: t.soldeC + r.soldeC,
  }), { debit: 0, credit: 0, soldeD: 0, soldeC: 0 }), [rows]);

  const exportCsv = () => {
    const header = ['Compte', 'Libellé', 'Débit', 'Crédit', 'Solde débiteur', 'Solde créditeur'];
    const body = rows.map(r => [r.code, `"${r.label.replace(/"/g, '""')}"`, r.debit.toFixed(2), r.credit.toFixed(2), r.soldeD.toFixed(2), r.soldeC.toFixed(2)].join(';'));
    const csv = '﻿' + [header.join(';'), ...body].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = `balance-${fy?.label || ''}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="Balance générale"
        subtitle={`Exercice ${fy?.label ?? ''} · ${rows.length} compte${rows.length !== 1 ? 's' : ''} mouvementé${rows.length !== 1 ? 's' : ''}`}
        actions={<button onClick={exportCsv} className={btnSecondary}><Download className="h-4 w-4" /> CSV</button>}
      />

      {loading ? (
        <LoadingState />
      ) : (
        <div className={`${panel} overflow-hidden`}>
          {rows.length === 0 ? (
            <EmptyState icon={Scale} title="Aucun mouvement comptabilisé" hint="Les comptes apparaissent ici dès qu’une écriture est validée." />
          ) : (
            <>
              {/* Phones: one card per account. */}
              <ul className="divide-y divide-border md:hidden">
                {rows.map(r => (
                  <li key={r.code} className="px-4 py-3">
                    <p className="flex items-baseline gap-2"><span className="font-mono text-sm font-semibold text-foreground">{r.code}</span><span className="truncate text-sm text-muted-foreground">{r.label}</span></p>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
                      <MobileField label="Débit">{fmt(r.debit) || '—'}</MobileField>
                      <MobileField label="Crédit">{fmt(r.credit) || '—'}</MobileField>
                      <MobileField label="Solde D.">{fmt(r.soldeD) || '—'}</MobileField>
                      <MobileField label="Solde C.">{fmt(r.soldeC) || '—'}</MobileField>
                    </dl>
                  </li>
                ))}
                <li className="bg-secondary/40 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Totaux</p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 font-semibold">
                    <MobileField label="Débit">{fmt(totals.debit) || '—'}</MobileField>
                    <MobileField label="Crédit">{fmt(totals.credit) || '—'}</MobileField>
                    <MobileField label="Solde D.">{fmt(totals.soldeD) || '—'}</MobileField>
                    <MobileField label="Solde C.">{fmt(totals.soldeC) || '—'}</MobileField>
                  </dl>
                </li>
              </ul>

              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={theadRow}>
                      <th className={th}>Compte</th>
                      <th className={th}>Libellé</th>
                      <th className={thRight}>Débit</th>
                      <th className={thRight}>Crédit</th>
                      <th className={thRight}>Solde D.</th>
                      <th className={thRight}>Solde C.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map(r => (
                      <tr key={r.code} className="hover:bg-secondary/40">
                        <td className={`${td} font-mono font-semibold text-foreground`}>{r.code}</td>
                        <td className={`${td} max-w-[28rem] truncate text-foreground`}>{r.label}</td>
                        <td className={`${tdNum} text-foreground`}>{fmt(r.debit)}</td>
                        <td className={`${tdNum} text-foreground`}>{fmt(r.credit)}</td>
                        <td className={`${tdNum} text-foreground`}>{fmt(r.soldeD)}</td>
                        <td className={`${tdNum} text-foreground`}>{fmt(r.soldeC)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className={tfootRow}>
                      <td colSpan={2} className={`${td} text-right text-xs uppercase tracking-wide text-muted-foreground`}>Totaux</td>
                      <td className={`${tdNum} text-foreground`}>{fmt(totals.debit)}</td>
                      <td className={`${tdNum} text-foreground`}>{fmt(totals.credit)}</td>
                      <td className={`${tdNum} text-foreground`}>{fmt(totals.soldeD)}</td>
                      <td className={`${tdNum} text-foreground`}>{fmt(totals.soldeC)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
