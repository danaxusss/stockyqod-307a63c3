import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Link2, Check, Unlink } from 'lucide-react';
import type { Account, FiscalYear } from '../../types';
import { AccountingService } from '../../utils/supabaseAccounting';
import { useToast } from '../../context/ToastContext';
import { PageHeader } from '../../components/PageHeader';
import { StatusPill } from '../../components/lists/StatusPill';
import { btnPrimary, checkbox, EmptyState, fieldAuto, LoadingState, panel, PhoneActionBar } from '../../components/backoffice/BackOfficeUi';

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
      // Codes used on this account in any fiscal year stay unique.
      const code = nextCode(await AccountingService.usedLettrageCodes(accountCode));
      await AccountingService.letterLines(Array.from(selected), code);
      showToast({ type: 'success', message: `Lettré (${code})` });
      if (fy) await loadLines(accountCode, fy.id);
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };

  const doUnletter = async (code: string) => {
    setBusy(true);
    // Only this group's lines: the same code may exist in another year.
    const ids = lines.filter(l => l.lettrage_code === code).map(l => l.id);
    try { await AccountingService.unletterLines(ids); if (fy) await loadLines(accountCode, fy.id); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };

  if (loading) return <LoadingState />;

  const amount = (n: unknown) => Number(n) ? fmt(Number(n)) : '';
  const selectionSummary = selected.size > 0 && (
    <StatusPill tone={selTotals.balanced ? 'success' : 'warning'}>
      <span className="tabular-nums">D {fmt(selTotals.d)} · C {fmt(selTotals.c)}</span>
    </StatusPill>
  );
  const letterButton = (
    <button onClick={doLetter} disabled={busy || !selTotals.balanced} className={btnPrimary}>
      <Check className="h-4 w-4" /> Lettrer
    </button>
  );
  const rowGrid = 'md:grid md:grid-cols-[6.5rem_9rem_minmax(0,1fr)] md:items-center md:gap-3';

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="Lettrage"
        subtitle={`Rapprocher débits et crédits · exercice ${fy?.label ?? ''}`}
        actions={
          <select value={accountCode} onChange={e => setAccountCode(e.target.value)} aria-label="Compte lettrable"
            className={`${fieldAuto} min-w-0 sm:min-w-[16rem]`}>
            {lettrable.map(a => <option key={a.code} value={a.code}>{a.code} — {a.label}</option>)}
          </select>
        }
      />

      {linesLoading ? (
        <LoadingState />
      ) : (
        <div className="space-y-4">
          <section className={`${panel} overflow-hidden`}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
              <h2 className="font-semibold text-foreground">Non lettré <span className="ml-1 text-sm font-normal text-muted-foreground">({unlettered.length})</span></h2>
              <div className="hidden items-center gap-3 md:flex">
                {selectionSummary}
                {letterButton}
              </div>
            </div>
            {unlettered.length === 0 ? (
              <EmptyState icon={Link2} title="Tout est lettré" />
            ) : (
              <>
                <div className="hidden items-center gap-3 border-b border-border bg-secondary/40 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-5 md:flex">
                  <span className="w-4" />
                  <span className={`min-w-0 flex-1 ${rowGrid}`}><span>Date</span><span>Pièce</span><span>Libellé</span></span>
                  <span className="w-32 text-right">Débit</span>
                  <span className="w-32 text-right">Crédit</span>
                </div>
                <ul className="divide-y divide-border">
                  {unlettered.map(l => (
                    <li key={l.id} onClick={() => toggle(l.id)} className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 sm:px-5 ${selected.has(l.id) ? 'bg-primary/[0.06]' : 'hover:bg-secondary/40'}`}>
                      <input type="checkbox" readOnly checked={selected.has(l.id)} className={checkbox} aria-label={`Sélectionner ${l.label || l.entry_label || l.reference || 'la ligne'}`} />
                      <span className={`min-w-0 flex-1 ${rowGrid}`}>
                        <span className="hidden whitespace-nowrap text-sm text-muted-foreground md:block">{new Date(l.entry_date).toLocaleDateString('fr-FR')}</span>
                        <span className="hidden truncate font-mono text-xs text-muted-foreground md:block">{l.reference || '—'}</span>
                        <span className="block truncate text-sm text-foreground">{l.label || l.entry_label || ''}</span>
                        <span className="block truncate text-xs text-muted-foreground md:hidden">{new Date(l.entry_date).toLocaleDateString('fr-FR')} · {l.reference || '—'}</span>
                      </span>
                      <span className="hidden w-32 text-right text-sm tabular-nums text-foreground md:block">{amount(l.debit)}</span>
                      <span className="hidden w-32 text-right text-sm tabular-nums text-foreground md:block">{amount(l.credit)}</span>
                      <span className="shrink-0 text-right text-sm tabular-nums text-foreground md:hidden">
                        {Number(l.debit) ? <><span className="text-xs text-muted-foreground">D </span>{amount(l.debit)}</> : <><span className="text-xs text-muted-foreground">C </span>{amount(l.credit)}</>}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {groups.length > 0 && (
            <section className={`${panel} overflow-hidden`}>
              <div className="border-b border-border px-4 py-3 sm:px-5">
                <h2 className="font-semibold text-foreground">Lettré <span className="ml-1 text-sm font-normal text-muted-foreground">({groups.length})</span></h2>
              </div>
              <div className="divide-y divide-border">
                {groups.map(([code, ls]) => (
                  <div key={code}>
                    <div className="flex items-center justify-between gap-3 bg-secondary/40 px-4 py-1.5 sm:px-5">
                      <span className="inline-flex items-center gap-2 text-xs font-semibold text-foreground">
                        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-primary/10 px-1.5 font-mono text-primary">{code}</span>
                        Lettrage {code}
                      </span>
                      <button onClick={() => doUnletter(code)} disabled={busy} className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"><Unlink className="h-3.5 w-3.5" /> Délettrer</button>
                    </div>
                    <ul className="divide-y divide-border">
                      {ls.map(l => (
                        <li key={l.id} className="flex items-center gap-3 px-4 py-2 text-sm sm:px-5">
                          <span className="hidden w-[6.5rem] shrink-0 whitespace-nowrap text-xs text-muted-foreground sm:block">{new Date(l.entry_date).toLocaleDateString('fr-FR')}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-foreground">{l.label || l.entry_label || ''}</span>
                            <span className="block text-xs text-muted-foreground sm:hidden">{new Date(l.entry_date).toLocaleDateString('fr-FR')}</span>
                          </span>
                          <span className="w-24 text-right tabular-nums text-foreground sm:w-32">{amount(l.debit)}</span>
                          <span className="w-24 text-right tabular-nums text-foreground sm:w-32">{amount(l.credit)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}

          <PhoneActionBar>
            {selected.size > 0 && <span className="flex !flex-none items-center">{selectionSummary}</span>}
            {letterButton}
          </PhoneActionBar>
        </div>
      )}
    </div>
  );
}
