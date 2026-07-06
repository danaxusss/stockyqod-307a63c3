import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Link2, Loader, Check, Unlink } from 'lucide-react';
import type { Account, FiscalYear } from '../../types';
import { AccountingService } from '../../utils/supabaseAccounting';
import { useToast } from '../../context/ToastContext';

function fmt(n: number) { return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n); }

/** Next lettrage code from existing ones: A, B, … Z, AA, AB … */
function nextCode(existing: string[]): string {
  const set = new Set(existing);
  let i = 0;
  const toCode = (n: number) => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  while (set.has(toCode(i))) i++;
  return toCode(i);
}

export default function LettragePage() {
  const { showToast } = useToast();
  const [fy, setFy] = useState<FiscalYear | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountCode, setAccountCode] = useState('');
  const [lines, setLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [linesLoading, setLinesLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const year = await AccountingService.ensureCurrentFiscalYear();
      setFy(year);
      const a = await AccountingService.listAccounts();
      setAccounts(a);
      const first = a.find(x => x.lettrable);
      if (first) { setAccountCode(first.code); }
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const loadLines = useCallback(async (code: string, fyId: string) => {
    setLinesLoading(true); setSelected(new Set());
    try { setLines(await AccountingService.getAccountLines(code, fyId)); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLinesLoading(false); }
  }, [showToast]);

  useEffect(() => { if (accountCode && fy) loadLines(accountCode, fy.id); }, [accountCode, fy, loadLines]);

  const lettrable = useMemo(() => accounts.filter(a => a.lettrable), [accounts]);
  const unlettered = useMemo(() => lines.filter(l => !l.lettrage_code), [lines]);
  const groups = useMemo(() => {
    const m = new Map<string, any[]>();
    lines.filter(l => l.lettrage_code).forEach(l => { if (!m.has(l.lettrage_code)) m.set(l.lettrage_code, []); m.get(l.lettrage_code)!.push(l); });
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [lines]);

  const selTotals = useMemo(() => {
    let d = 0, c = 0;
    unlettered.forEach(l => { if (selected.has(l.id)) { d += Number(l.debit) || 0; c += Number(l.credit) || 0; } });
    return { d, c, balanced: Math.abs(d - c) < 0.005 && (d > 0 || c > 0) };
  }, [unlettered, selected]);

  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const doLetter = async () => {
    if (!selTotals.balanced) { showToast({ type: 'error', message: 'Sélection déséquilibrée (débit ≠ crédit)' }); return; }
    setBusy(true);
    try {
      const code = nextCode(lines.filter(l => l.lettrage_code).map(l => l.lettrage_code));
      await AccountingService.letterLines(Array.from(selected), code);
      showToast({ type: 'success', message: `Lettré (${code})` });
      if (fy) await loadLines(accountCode, fy.id);
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };

  const doUnletter = async (code: string) => {
    setBusy(true);
    try { await AccountingService.unletter(code, accountCode); if (fy) await loadLines(accountCode, fy.id); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>;

  return (
    <div className="max-w-4xl mx-auto py-6 px-3">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10"><Link2 className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">Lettrage</h1>
            <p className="text-xs text-muted-foreground">Rapprocher débits et crédits · exercice {fy?.label}</p>
          </div>
        </div>
        <select value={accountCode} onChange={e => setAccountCode(e.target.value)}
          className="px-3 py-2 text-sm rounded-lg bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/30">
          {lettrable.map(a => <option key={a.code} value={a.code}>{a.code} — {a.label}</option>)}
        </select>
      </div>

      {linesLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>
      ) : (
        <>
          <div className="bg-card border border-border/60 rounded-xl overflow-hidden mb-4">
            <div className="flex items-center justify-between px-3 py-2 bg-secondary/50 border-b border-border/60">
              <span className="text-sm font-semibold text-foreground">Non lettré</span>
              <div className="flex items-center gap-3 text-xs">
                {selected.size > 0 && (
                  <span className={selTotals.balanced ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                    D {fmt(selTotals.d)} · C {fmt(selTotals.c)}
                  </span>
                )}
                <button onClick={doLetter} disabled={busy || !selTotals.balanced}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary text-primary-foreground font-medium disabled:opacity-40">
                  <Check className="h-3.5 w-3.5" /> Lettrer
                </button>
              </div>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {unlettered.map(l => (
                  <tr key={l.id} onClick={() => toggle(l.id)} className={`border-b border-border/40 cursor-pointer ${selected.has(l.id) ? 'bg-primary/[0.06]' : 'hover:bg-secondary/30'}`}>
                    <td className="px-3 py-1.5 w-8"><input type="checkbox" readOnly checked={selected.has(l.id)} className="accent-[hsl(var(--primary))]" /></td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">{new Date(l.entry_date).toLocaleDateString('fr-FR')}</td>
                    <td className="px-2 py-1.5 text-xs text-muted-foreground">{l.reference || '—'}</td>
                    <td className="px-2 py-1.5">{l.label || l.entry_label || ''}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{Number(l.debit) ? fmt(Number(l.debit)) : ''}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{Number(l.credit) ? fmt(Number(l.credit)) : ''}</td>
                  </tr>
                ))}
                {unlettered.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">Tout est lettré</td></tr>}
              </tbody>
            </table>
          </div>

          {groups.length > 0 && (
            <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
              <div className="px-3 py-2 bg-secondary/50 border-b border-border/60 text-sm font-semibold text-foreground">Lettré</div>
              {groups.map(([code, ls]) => (
                <div key={code} className="border-b border-border/40 last:border-0">
                  <div className="flex items-center justify-between px-3 py-1.5 bg-secondary/20">
                    <span className="text-xs font-semibold text-foreground">Lettrage {code}</span>
                    <button onClick={() => doUnletter(code)} disabled={busy} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-red-600 dark:hover:text-red-400"><Unlink className="h-3 w-3" /> Délettrer</button>
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {ls.map(l => (
                        <tr key={l.id} className="border-t border-border/30">
                          <td className="px-3 py-1 whitespace-nowrap text-muted-foreground text-xs">{new Date(l.entry_date).toLocaleDateString('fr-FR')}</td>
                          <td className="px-2 py-1 text-xs">{l.label || l.entry_label || ''}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-xs">{Number(l.debit) ? fmt(Number(l.debit)) : ''}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-xs">{Number(l.credit) ? fmt(Number(l.credit)) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
