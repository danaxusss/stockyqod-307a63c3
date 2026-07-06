import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { FileText, Loader, Search } from 'lucide-react';
import type { Account, FiscalYear } from '../../types';
import { AccountingService } from '../../utils/supabaseAccounting';
import { useToast } from '../../context/ToastContext';

function fmt(n: number) { return n === 0 ? '' : new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }

export default function GrandLivrePage() {
  const { showToast } = useToast();
  const [fy, setFy] = useState<FiscalYear | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [lines, setLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>('');

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

  return (
    <div className="max-w-5xl mx-auto py-6 px-3">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10"><FileText className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">Grand livre</h1>
            <p className="text-xs text-muted-foreground">Exercice {fy?.label}</p>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input list="gl-accounts" value={selected} onChange={e => setSelected(e.target.value.split(' ')[0])} placeholder="Choisir un compte…"
            className="pl-8 pr-3 py-2 text-sm rounded-lg bg-secondary border border-border w-72 font-mono focus:outline-none focus:ring-2 focus:ring-primary/30" />
          <datalist id="gl-accounts">
            {movedCodes.map(c => <option key={c} value={c}>{c} — {accByCode.get(c)?.label || ''}</option>)}
          </datalist>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>
      ) : !selected ? (
        <div className="bg-card border border-border/60 rounded-xl p-8 text-center text-sm text-muted-foreground">
          Sélectionnez un compte pour afficher son grand livre. {movedCodes.length} comptes mouvementés.
        </div>
      ) : (
        <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
          <div className="px-3 py-2 bg-secondary/50 border-b border-border/60 text-sm font-semibold text-foreground">
            {selected} — {accByCode.get(selected)?.label || ''}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-xs text-muted-foreground">
                  <th className="text-left font-medium px-3 py-2">Date</th>
                  <th className="text-left font-medium px-3 py-2">Pièce</th>
                  <th className="text-left font-medium px-3 py-2">Libellé</th>
                  <th className="text-right font-medium px-3 py-2">Débit</th>
                  <th className="text-right font-medium px-3 py-2">Crédit</th>
                  <th className="text-right font-medium px-3 py-2">Solde</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l, i) => (
                  <tr key={l.id || i} className="border-b border-border/40">
                    <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{new Date(l.entry_date).toLocaleDateString('fr-FR')}</td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{l.reference || '—'}</td>
                    <td className="px-3 py-1.5">{l.label || l.entry_label || ''}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(Number(l.debit))}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(Number(l.credit))}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${l.solde < 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>{new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(l.solde)}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">Aucun mouvement</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
