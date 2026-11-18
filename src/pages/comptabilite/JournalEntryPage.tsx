import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { BookOpen, Plus, Loader, Trash2, Check, X, RotateCcw, Lock } from 'lucide-react';
import type { Account, FiscalYear, Journal, JournalEntry, JournalEntryLine } from '../../types';
import { AccountingService } from '../../utils/supabaseAccounting';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { PageHeader } from '../../components/PageHeader';
import { StatusPill } from '../../components/lists/StatusPill';
import { btnPrimary, btnSecondary, EmptyState, field, fieldAuto, fieldLabel, fieldSm, iconBtn, iconBtnDanger, LoadingState, panel, td, th, theadRow } from '../../components/backoffice/BackOfficeUi';
import { localDay } from '../../utils/documentLines';

function fmt(n: number) { return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }
const todayStr = () => localDay();

type Editing = { entry: JournalEntry | null; date: string; reference: string; label: string; lines: JournalEntryLine[] } | null;

export default function JournalEntryPage() {
  const { currentUser } = useAuth();
  const { showToast } = useToast();

  const [fy, setFy] = useState<FiscalYear | null>(null);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journalId, setJournalId] = useState('');
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);

  const accByCode = useMemo(() => new Map(accounts.map(a => [a.code, a])), [accounts]);
  const journalById = useMemo(() => new Map(journals.map(j => [j.id, j])), [journals]);

  const loadEntries = useCallback(async (jid: string, fyId: string) => {
    setEntries(await AccountingService.listEntries({ fiscalYearId: fyId, journalId: jid, limit: 200 }));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const year = await AccountingService.ensureCurrentFiscalYear();
      setFy(year);
      const [j, a] = await Promise.all([AccountingService.listJournals(), AccountingService.listAccounts()]);
      setJournals(j); setAccounts(a);
      const jid = j[0]?.id || '';
      setJournalId(jid);
      if (jid) await loadEntries(jid, year.id);
    } catch (e: any) {
      showToast({ type: 'error', message: e?.message || 'Erreur de chargement' });
    } finally { setLoading(false); }
  }, [showToast, loadEntries]);

  useEffect(() => { load(); }, [load]);

  const onJournalChange = async (jid: string) => {
    setJournalId(jid);
    if (fy) await loadEntries(jid, fy.id);
  };

  const blankLines = (): JournalEntryLine[] => ([
    { account_code: '', label: '', debit: 0, credit: 0 },
    { account_code: '', label: '', debit: 0, credit: 0 },
  ]);

  const startNew = () => setEditing({ entry: null, date: todayStr(), reference: '', label: '', lines: blankLines() });

  const startEdit = async (e: JournalEntry) => {
    const full = await AccountingService.getEntry(e.id);
    if (!full) return;
    if (full.status !== 'draft') { showToast({ type: 'info', message: 'Écriture validée — lecture seule' }); return; }
    setEditing({ entry: full, date: full.entry_date, reference: full.reference || '', label: full.label || '', lines: full.lines && full.lines.length ? full.lines : blankLines() });
  };

  const totals = useMemo(() => {
    if (!editing) return { d: 0, c: 0 };
    return editing.lines.reduce((acc, l) => ({ d: acc.d + (Number(l.debit) || 0), c: acc.c + (Number(l.credit) || 0) }), { d: 0, c: 0 });
  }, [editing]);
  const balanced = Math.abs(totals.d - totals.c) < 0.005 && totals.d > 0;

  const setLine = (i: number, field: keyof JournalEntryLine, value: any) =>
    setEditing(prev => prev ? { ...prev, lines: prev.lines.map((l, idx) => idx === i ? { ...l, [field]: value } : l) } : prev);
  const addLine = () => setEditing(prev => prev ? { ...prev, lines: [...prev.lines, { account_code: '', label: '', debit: 0, credit: 0 }] } : prev);
  const removeLine = (i: number) => setEditing(prev => prev ? { ...prev, lines: prev.lines.filter((_, idx) => idx !== i) } : prev);

  const persistDraft = async (): Promise<string | null> => {
    if (!editing || !fy || !journalId) return null;
    const lines = editing.lines.filter(l => l.account_code && (Number(l.debit) > 0 || Number(l.credit) > 0));
    if (lines.length < 2) { showToast({ type: 'error', message: 'Au moins deux lignes mouvementées' }); return null; }
    const bad = lines.find(l => !accByCode.has(l.account_code));
    if (bad) { showToast({ type: 'error', message: `Compte inconnu: ${bad.account_code}` }); return null; }
    if (editing.entry) {
      await AccountingService.updateEntryDraft(editing.entry.id, { entry_date: editing.date, reference: editing.reference || null, label: editing.label || null }, lines);
      return editing.entry.id;
    }
    const created = await AccountingService.createEntry(
      { journal_id: journalId, entry_date: editing.date, reference: editing.reference || null, label: editing.label || null, created_by: currentUser?.username || null },
      lines,
    );
    return created.id;
  };

  const saveDraft = async () => {
    setBusy(true);
    try {
      const id = await persistDraft();
      if (id) { showToast({ type: 'success', message: 'Brouillon enregistré' }); setEditing(null); await loadEntries(journalId, fy!.id); }
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };

  const saveAndPost = async () => {
    if (!balanced) { showToast({ type: 'error', message: 'Écriture déséquilibrée' }); return; }
    setBusy(true);
    try {
      const id = await persistDraft();
      if (!id) return;
      await AccountingService.postEntry(id, currentUser?.username || null);
      showToast({ type: 'success', title: 'Écriture validée', message: 'Comptabilisée' });
      setEditing(null); await loadEntries(journalId, fy!.id);
    } catch (e: any) { showToast({ type: 'error', title: 'Erreur', message: e?.message || 'Échec de la validation' }); }
    finally { setBusy(false); }
  };

  const reverse = async (e: JournalEntry) => {
    if (!confirm(`Contre-passer l'écriture ${e.entry_number} ?`)) return;
    setBusy(true);
    try {
      await AccountingService.reverseEntry(e.id, currentUser?.username || null);
      showToast({ type: 'success', message: 'Écriture contre-passée' });
      await loadEntries(journalId, fy!.id);
    } catch (err: any) { showToast({ type: 'error', message: err?.message || 'Échec' }); }
    finally { setBusy(false); }
  };

  const deleteDraft = async (e: JournalEntry) => {
    if (!confirm('Supprimer ce brouillon ?')) return;
    try { await AccountingService.deleteDraft(e.id); await loadEntries(journalId, fy!.id); }
    catch (err: any) { showToast({ type: 'error', message: err?.message || 'Échec' }); }
  };

  if (loading) return <LoadingState />;

  if (journals.length === 0 || accounts.length === 0) {
    return (
      <div className="mx-auto max-w-[110rem]">
        <PageHeader title="Saisie / Journaux" />
        <div className={panel}>
          <EmptyState icon={BookOpen} title="Le plan comptable n'est pas encore initialisé pour cette société.">
            <a href="/comptabilite" className={btnPrimary}>Aller au tableau de bord</a>
          </EmptyState>
        </div>
      </div>
    );
  }

  const statusPill = (e: JournalEntry) => e.status === 'posted'
    ? <StatusPill tone="success" icon={<Lock className="h-3 w-3" />}>Validée</StatusPill>
    : e.status === 'reversed' ? <StatusPill tone="neutral">Contre-passée</StatusPill>
    : <StatusPill tone="warning">Brouillon</StatusPill>;
  const rowActions = (e: JournalEntry) => <>
    {e.status === 'posted' && <button onClick={() => reverse(e)} title="Contre-passer" aria-label={`Contre-passer l'écriture ${e.entry_number ?? ''}`} className={iconBtn}><RotateCcw className="h-4 w-4" /></button>}
    {e.status === 'draft' && <button onClick={() => deleteDraft(e)} title="Supprimer" aria-label="Supprimer le brouillon" className={iconBtnDanger}><Trash2 className="h-4 w-4" /></button>}
  </>;
  const lineGrid = 'md:grid-cols-[11rem_minmax(0,1fr)_9rem_9rem_2.75rem]';

  return (
    <div className="mx-auto max-w-[110rem]">
      <datalist id="acc-list">
        {accounts.map(a => <option key={a.code} value={a.code}>{a.code} — {a.label}</option>)}
      </datalist>

      <PageHeader
        title="Saisie / Journaux"
        subtitle={`Exercice ${fy?.label ?? ''} · ${entries.length} écriture${entries.length !== 1 ? 's' : ''}`}
        actions={<>
          <select value={journalId} onChange={e => onJournalChange(e.target.value)} aria-label="Journal"
            className={`${fieldAuto} min-w-0 sm:min-w-[14rem]`}>
            {journals.map(j => <option key={j.id} value={j.id}>{j.code} — {j.label}</option>)}
          </select>
          {!editing && <button onClick={startNew} className={btnPrimary}><Plus className="h-4 w-4" /> Écriture</button>}
        </>}
      />

      {editing ? (
        <section className={`${panel} mb-4 border-primary/40`} aria-label="Écriture en cours">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-3 sm:px-5">
            <h2 className="font-semibold text-foreground">{editing.entry ? 'Brouillon' : 'Nouvelle écriture'}</h2>
            <span className="text-xs text-muted-foreground">{journalById.get(journalId)?.code} — {journalById.get(journalId)?.label}</span>
          </div>
          <div className="p-4 sm:p-5">
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div><label className={fieldLabel} htmlFor="je-date">Date</label>
                <input id="je-date" type="date" value={editing.date} onChange={e => setEditing(p => p && { ...p, date: e.target.value })} className={field} /></div>
              <div><label className={fieldLabel} htmlFor="je-ref">Pièce / référence</label>
                <input id="je-ref" value={editing.reference} onChange={e => setEditing(p => p && { ...p, reference: e.target.value })} className={field} /></div>
              <div><label className={fieldLabel} htmlFor="je-label">Libellé</label>
                <input id="je-label" value={editing.label} onChange={e => setEditing(p => p && { ...p, label: e.target.value })} className={field} /></div>
            </div>

            <div className="overflow-hidden rounded-lg border border-border">
              <div className={`hidden gap-2 border-b border-border bg-secondary/40 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid ${lineGrid}`}>
                <span className="px-1">Compte</span>
                <span className="px-1">Libellé</span>
                <span className="px-1 text-right">Débit</span>
                <span className="px-1 text-right">Crédit</span>
                <span />
              </div>
              <ul className="divide-y divide-border">
                {editing.lines.map((l, i) => (
                  <li key={i} className={`grid grid-cols-2 gap-2 px-3 py-3 md:items-start md:px-2 md:py-2 ${lineGrid}`}>
                    <div className="col-span-2 min-w-0 md:col-span-1">
                      <input list="acc-list" value={l.account_code} onChange={e => setLine(i, 'account_code', e.target.value.split(' ')[0])}
                        placeholder="compte" aria-label={`Compte, ligne ${i + 1}`} className={`${fieldSm} font-mono`} />
                      <div className="mt-0.5 truncate px-1 text-xs text-muted-foreground">{accByCode.get(l.account_code)?.label || ''}</div>
                    </div>
                    <input value={l.label || ''} onChange={e => setLine(i, 'label', e.target.value)} placeholder="Libellé" aria-label={`Libellé, ligne ${i + 1}`} className={`${fieldSm} col-span-2 md:col-span-1`} />
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:sr-only">Débit</span>
                      <input type="number" min={0} step="0.01" value={l.debit || ''} onChange={e => setLine(i, 'debit', Number(e.target.value))} className={`${fieldSm} text-right tabular-nums`} />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:sr-only">Crédit</span>
                      <input type="number" min={0} step="0.01" value={l.credit || ''} onChange={e => setLine(i, 'credit', Number(e.target.value))} className={`${fieldSm} text-right tabular-nums`} />
                    </label>
                    <div className="col-span-2 flex justify-end md:col-span-1">
                      <button onClick={() => removeLine(i)} aria-label={`Supprimer la ligne ${i + 1}`} title="Supprimer la ligne" className={iconBtnDanger}><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className={`grid grid-cols-2 items-center gap-2 border-t border-border bg-secondary/40 px-3 py-2.5 text-sm font-semibold md:px-2 ${lineGrid}`}>
                <button onClick={addLine} className="col-span-2 inline-flex min-h-9 items-center gap-1 justify-self-start rounded-md px-2 text-sm font-semibold text-primary hover:bg-primary/10 md:col-span-1"><Plus className="h-4 w-4" />Ligne</button>
                <span className="hidden text-right text-xs uppercase tracking-wide text-muted-foreground md:block">Totaux</span>
                <span className="px-1 text-right tabular-nums text-foreground"><span className="mr-1 text-xs font-medium text-muted-foreground md:hidden">Débit</span>{fmt(totals.d)}</span>
                <span className="px-1 text-right tabular-nums text-foreground"><span className="mr-1 text-xs font-medium text-muted-foreground md:hidden">Crédit</span>{fmt(totals.c)}</span>
                <span className="hidden md:block" />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <StatusPill tone={balanced ? 'success' : 'warning'} icon={balanced ? <Check className="h-3 w-3" /> : undefined}>
                {balanced ? 'Équilibrée' : `Écart : ${fmt(Math.abs(totals.d - totals.c))}`}
              </StatusPill>
              <div className="flex w-full gap-2 sm:w-auto">
                <button onClick={() => setEditing(null)} className={`${btnSecondary} flex-1 sm:flex-none`}>Annuler</button>
                <button onClick={saveDraft} disabled={busy} className={`${btnSecondary} flex-1 sm:flex-none`}>Brouillon</button>
                <button onClick={saveAndPost} disabled={busy || !balanced} className={`${btnPrimary} flex-1 sm:flex-none`}>
                  {busy ? <Loader className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Valider
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* Entries list */}
      <div className={`${panel} overflow-hidden`}>
        {entries.length === 0 ? (
          <EmptyState icon={BookOpen} title="Aucune écriture dans ce journal" />
        ) : (
          <>
            <ul className="divide-y divide-border md:hidden">
              {entries.map(e => (
                <li key={e.id} className="flex items-start gap-2 px-4 py-3">
                  <button onClick={() => startEdit(e)} className="min-w-0 flex-1 text-left">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm font-semibold text-muted-foreground">N° {e.entry_number ?? '—'}</span>
                      {statusPill(e)}
                    </span>
                    <span className="mt-1 block truncate font-medium text-foreground">{e.label || '(sans libellé)'}</span>
                    <span className="block truncate text-xs text-muted-foreground">{new Date(e.entry_date).toLocaleDateString('fr-FR')} · {e.reference || '—'}</span>
                  </button>
                  <div className="flex shrink-0">{rowActions(e)}</div>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className={theadRow}>
                    <th className={`${th} w-20`}>N°</th>
                    <th className={th}>Date</th>
                    <th className={th}>Pièce</th>
                    <th className={th}>Libellé</th>
                    <th className={th}>Statut</th>
                    <th className={`${th} w-24`}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {entries.map(e => (
                    <tr key={e.id} className="hover:bg-secondary/40">
                      <td className={`${td} font-mono text-muted-foreground`}>{e.entry_number ?? '—'}</td>
                      <td className={`${td} whitespace-nowrap text-foreground`}>{new Date(e.entry_date).toLocaleDateString('fr-FR')}</td>
                      <td className={`${td} text-muted-foreground`}>{e.reference || '—'}</td>
                      <td className={td}>
                        <button onClick={() => startEdit(e)} className="text-left font-medium text-foreground hover:text-primary hover:underline">{e.label || '(sans libellé)'}</button>
                      </td>
                      <td className={td}>{statusPill(e)}</td>
                      <td className={`${td} py-1.5`}><div className="flex justify-end">{rowActions(e)}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
