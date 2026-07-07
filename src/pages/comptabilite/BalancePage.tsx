import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Scale, Loader, Download } from 'lucide-react';
import type { Account, FiscalYear } from '../../types';
import { AccountingService } from '../../utils/supabaseAccounting';
import { useToast } from '../../context/ToastContext';

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
    <div className="max-w-4xl mx-auto py-6 px-3">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10"><Scale className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">Balance générale</h1>
            <p className="text-xs text-muted-foreground">Exercice {fy?.label}</p>
          </div>
        </div>
        <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary border border-border text-sm"><Download className="h-3.5 w-3.5" /> CSV</button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>
      ) : (
        <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-secondary/50 text-xs text-muted-foreground">
                  <th className="text-left font-medium px-3 py-2">Compte</th>
                  <th className="text-left font-medium px-3 py-2">Libellé</th>
                  <th className="text-right font-medium px-3 py-2">Débit</th>
                  <th className="text-right font-medium px-3 py-2">Crédit</th>
                  <th className="text-right font-medium px-3 py-2">Solde D.</th>
                  <th className="text-right font-medium px-3 py-2">Solde C.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.code} className="border-b border-border/40">
                    <td className="px-3 py-1.5 font-mono">{r.code}</td>
                    <td className="px-3 py-1.5 truncate max-w-[220px]">{r.label}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.debit)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.credit)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.soldeD)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.soldeC)}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">Aucun mouvement comptabilisé</td></tr>}
              </tbody>
              <tfoot>
                <tr className="bg-secondary/40 font-semibold border-t border-border/60">
                  <td colSpan={2} className="px-3 py-2 text-right text-xs text-muted-foreground">Totaux</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(totals.debit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(totals.credit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(totals.soldeD)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(totals.soldeC)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
