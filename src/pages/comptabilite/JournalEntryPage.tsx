import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { BookOpen, Plus, Loader, Trash2, Check, X, RotateCcw, Lock } from 'lucide-react';
import type { Account, FiscalYear, Journal, JournalEntry, JournalEntryLine } from '../../types';
import { AccountingService } from '../../utils/supabaseAccounting';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

function fmt(n: number) { return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }
const todayStr = () => new Date().toISOString().slice(0, 10);

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
      { fiscal_year_id: fy.id, journal_id: journalId, entry_date: editing.date, reference: editing.reference || null, label: editing.label || null, created_by: currentUser?.username || null },
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

  if (loading) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>;

  return (
    <div className="max-w-5xl mx-auto py-6 px-3">
      <datalist id="acc-list">
        {accounts.map(a => <option key={a.code} value={a.code}>{a.code} — {a.label}</option>)}
      </datalist>

      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10"><BookOpen className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">Saisie / Journaux</h1>
            <p className="text-xs text-muted-foreground">Exercice {fy?.label}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select value={journalId} onChange={e => onJournalChange(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/30">
            {journals.map(j => <option key={j.id} value={j.id}>{j.code} — {j.label}</option>)}
          </select>
          {!editing && <button onClick={startNew} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"><Plus className="h-4 w-4" /> Écriture</button>}
        </div>
      </div>

      {editing ? (
        <div className="bg-card border border-primary/30 rounded-xl p-4 mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
            <div><label className="block text-[11px] text-muted-foreground mb-1">Date</label>
              <input type="date" value={editing.date} onChange={e => setEditing(p => p && { ...p, date: e.target.value })} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" /></div>
            <div><label className="block text-[11px] text-muted-foreground mb-1">Pièce / référence</label>
              <input value={editing.reference} onChange={e => setEditing(p => p && { ...p, reference: e.target.value })} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" /></div>
            <div><label className="block text-[11px] text-muted-foreground mb-1">Libellé</label>
              <input value={editing.label} onChange={e => setEditing(p => p && { ...p, label: e.target.value })} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" /></div>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b border-border/60">
                <th className="text-left font-medium px-1 py-1.5 w-40">Compte</th>
                <th className="text-left font-medium px-1 py-1.5">Libellé</th>
                <th className="text-right font-medium px-1 py-1.5 w-28">Débit</th>
                <th className="text-right font-medium px-1 py-1.5 w-28">Crédit</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {editing.lines.map((l, i) => (
                <tr key={i} className="border-b border-border/30">
                  <td className="px-1 py-1">
                    <input list="acc-list" value={l.account_code} onChange={e => setLine(i, 'account_code', e.target.value.split(' ')[0])}
                      placeholder="compte" className="w-full px-2 py-1 text-sm rounded bg-secondary border border-border font-mono" />
                    <div className="text-[9px] text-muted-foreground truncate max-w-[150px]">{accByCode.get(l.account_code)?.label || ''}</div>
                  </td>
                  <td className="px-1 py-1"><input value={l.label || ''} onChange={e => setLine(i, 'label', e.target.value)} className="w-full px-2 py-1 text-sm rounded bg-secondary border border-border" /></td>
                  <td className="px-1 py-1"><input type="number" min={0} step="0.01" value={l.debit || ''} onChange={e => setLine(i, 'debit', Number(e.target.value))} className="w-full px-2 py-1 text-sm text-right rounded bg-secondary border border-border" /></td>
                  <td className="px-1 py-1"><input type="number" min={0} step="0.01" value={l.credit || ''} onChange={e => setLine(i, 'credit', Number(e.target.value))} className="w-full px-2 py-1 text-sm text-right rounded bg-secondary border border-border" /></td>
                  <td className="px-1 text-center"><button onClick={() => removeLine(i)} className="p-1 text-muted-foreground hover:bg-secondary rounded"><Trash2 className="h-3.5 w-3.5" /></button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="text-sm font-semibold">
                <td colSpan={2} className="px-1 py-2 text-right">
                  <button onClick={addLine} className="text-xs font-normal text-primary hover:underline">+ Ligne</button>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt(totals.d)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt(totals.c)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>

          <div className="flex items-center justify-between mt-3">
            <span className={`text-xs font-medium ${balanced ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
              {balanced ? '✓ Équilibrée' : `Écart : ${fmt(Math.abs(totals.d - totals.c))}`}
            </span>
            <div className="flex gap-2">
              <button onClick={() => setEditing(null)} className="px-3 py-2 rounded-lg bg-secondary border border-border text-sm">Annuler</button>
              <button onClick={saveDraft} disabled={busy} className="px-3 py-2 rounded-lg bg-secondary border border-border text-sm disabled:opacity-50">Brouillon</button>
              <button onClick={saveAndPost} disabled={busy || !balanced} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
                {busy ? <Loader className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Valider
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Entries list */}
      <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 bg-secondary/50 text-xs text-muted-foreground">
              <th className="text-left font-medium px-3 py-2.5 w-16">N°</th>
              <th className="text-left font-medium px-3 py-2.5">Date</th>
              <th className="text-left font-medium px-3 py-2.5">Pièce</th>
              <th className="text-left font-medium px-3 py-2.5">Libellé</th>
              <th className="text-left font-medium px-3 py-2.5">Statut</th>
              <th className="w-20"></th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id} className="border-b border-border/40 hover:bg-secondary/30">
                <td className="px-3 py-2 font-mono text-muted-foreground">{e.entry_number ?? '—'}</td>
                <td className="px-3 py-2">{new Date(e.entry_date).toLocaleDateString('fr-FR')}</td>
                <td className="px-3 py-2 text-muted-foreground">{e.reference || '—'}</td>
                <td className="px-3 py-2">
                  <button onClick={() => startEdit(e)} className="text-foreground hover:underline text-left">{e.label || '(sans libellé)'}</button>
                </td>
                <td className="px-3 py-2">
                  {e.status === 'posted' ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400"><Lock className="h-3 w-3" />Validée</span>
                    : e.status === 'reversed' ? <span className="text-[11px] font-semibold text-muted-foreground">Contre-passée</span>
                    : <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">Brouillon</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  {e.status === 'posted' && <button onClick={() => reverse(e)} title="Contre-passer" className="p-1 text-muted-foreground hover:bg-secondary rounded"><RotateCcw className="h-3.5 w-3.5" /></button>}
                  {e.status === 'draft' && <button onClick={() => deleteDraft(e)} title="Supprimer" className="p-1 text-muted-foreground hover:bg-secondary rounded"><Trash2 className="h-3.5 w-3.5" /></button>}
                </td>
              </tr>
            ))}
            {entries.length === 0 && <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">Aucune écriture dans ce journal</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
