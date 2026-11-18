import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Landmark, Upload, Loader, Check, ArrowLeft, Sparkles, Trash2, Link2, Zap, ChevronRight } from 'lucide-react';
import { BankService, type BankStatement, type BankStatementLine } from '../../utils/supabaseBank';
import { AccountingService } from '../../utils/supabaseAccounting';
import type { Account, FiscalYear, Journal } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { localDay } from '../../utils/documentLines';
import { PageHeader } from '../../components/PageHeader';
import { StatusPill } from '../../components/lists/StatusPill';
import { btnPrimary, btnSoft, EmptyState, field, fieldLabel, fieldSm, iconBtnDanger, LoadingState, panel } from '../../components/backoffice/BackOfficeUi';

function fmt(n: number) { return n ? new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n) : ''; }
const readAsDataURL = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(f); });

export default function RapprochementPage() {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const [statements, setStatements] = useState<BankStatement[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'import' | 'detail'>('list');
  const [detail, setDetail] = useState<BankStatement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setStatements(await BankService.list()); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const openDetail = async (id: string) => {
    const s = await BankService.get(id);
    if (s) { setDetail(s); setView('detail'); }
  };

  if (loading) return <LoadingState />;

  const statusPill = (s: BankStatement) => s.status === 'reconciled' ? <StatusPill tone="success">Rapproché</StatusPill> : <StatusPill tone="warning">À rapprocher</StatusPill>;

  return (
    <div className="mx-auto max-w-[110rem]">
      {view !== 'list' && (
        <button onClick={() => { setView('list'); setDetail(null); load(); }} aria-label="Retour aux relevés"
          className="mb-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />Relevés
        </button>
      )}
      <PageHeader
        title="Rapprochement bancaire"
        subtitle="Import de relevé par scan (lecture automatique)"
        actions={view === 'list' && <button onClick={() => setView('import')} className={btnPrimary}><Upload className="h-4 w-4" /> Importer un relevé</button>}
      />

      {view === 'import' && <ImportView onSaved={() => { setView('list'); load(); }} createdBy={currentUser?.username || null} />}
      {view === 'detail' && detail && <DetailView statement={detail} onReload={() => openDetail(detail.id)} createdBy={currentUser?.username || null} />}
      {view === 'list' && (
        <div className={`${panel} overflow-hidden`}>
          {statements.length === 0 ? (
            <EmptyState icon={Landmark} title="Aucun relevé. Importez un scan pour commencer." />
          ) : (
            <ul className="divide-y divide-border">
              {statements.map(s => (
                <li key={s.id}>
                  <button onClick={() => openDetail(s.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-secondary/40 sm:px-5">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10"><Landmark className="h-5 w-5 text-primary" aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-foreground">{s.bank_name || s.label || 'Relevé'} · <span className="font-mono">{s.account_code}</span></span>
                      <span className="block text-xs tabular-nums text-muted-foreground">{s.period_start || '?'} → {s.period_end || '?'}</span>
                      <span className="mt-1 block sm:hidden">{statusPill(s)}</span>
                    </span>
                    <span className="hidden sm:block">{statusPill(s)}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ── Import: upload scan → AI extract → review → save ─────────────────────────
function ImportView({ onSaved, createdBy }: { onSaved: () => void; createdBy: string | null }) {
  const { showToast } = useToast();
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [header, setHeader] = useState({ bank_name: '', account_code: '5141', period_start: '', period_end: '', opening_balance: '', closing_balance: '' });
  const [lines, setLines] = useState<BankStatementLine[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const onFile = async (file: File) => {
    if (!file.type.startsWith('image/')) { showToast({ type: 'error', message: 'Choisissez une image (photo/scan). Les PDF ne sont pas encore pris en charge.' }); return; }
    setParsing(true);
    try {
      const dataUrl = await readAsDataURL(file);
      setPreviewUrl(dataUrl);
      const { data } = await BankService.parseScan(dataUrl, file.type);
      setHeader({
        bank_name: data.bank_name || '', account_code: data.account_code || '5141',
        period_start: data.period_start || '', period_end: data.period_end || '',
        opening_balance: data.opening_balance != null ? String(data.opening_balance) : '',
        closing_balance: data.closing_balance != null ? String(data.closing_balance) : '',
      });
      setLines((data.lines || []).map((l, i) => ({ line_date: l.date || null, label: l.label || '', reference: l.reference || null, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, balance: l.balance ?? null, sort_order: i })));
      showToast({ type: 'success', title: 'Relevé analysé', message: `${(data.lines || []).length} opération(s) détectée(s) — vérifiez avant d'enregistrer` });
    } catch (e: any) {
      showToast({ type: 'error', title: 'Analyse échouée', message: e?.message || 'Réessayez avec une image plus nette' });
    } finally { setParsing(false); }
  };

  const setLine = (i: number, f: keyof BankStatementLine, v: any) => setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [f]: v } : l));
  const removeLine = (i: number) => setLines(prev => prev.filter((_, idx) => idx !== i));

  const save = async () => {
    if (lines.length === 0) { showToast({ type: 'error', message: 'Aucune ligne à enregistrer' }); return; }
    setSaving(true);
    try {
      await BankService.save({
        bank_name: header.bank_name || null, account_code: header.account_code || '5141',
        period_start: header.period_start || null, period_end: header.period_end || null,
        opening_balance: header.opening_balance ? Number(header.opening_balance) : null,
        closing_balance: header.closing_balance ? Number(header.closing_balance) : null, created_by: createdBy,
      }, lines);
      showToast({ type: 'success', message: 'Relevé enregistré' });
      onSaved();
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setSaving(false); }
  };

  const lineGrid = 'md:grid-cols-[10rem_minmax(0,1fr)_8rem_8rem_2.75rem]';

  return (
    <div className="space-y-4">
      {lines.length === 0 ? (
        <label className="block cursor-pointer rounded-xl border-2 border-dashed border-border bg-card p-10 text-center shadow-sm transition-colors hover:border-primary/50 hover:bg-primary/[0.03]">
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
          {parsing ? (
            <div className="flex flex-col items-center gap-2 text-muted-foreground"><Loader className="h-6 w-6 animate-spin" /><span className="text-sm">Lecture du relevé par IA…</span></div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10"><Sparkles className="h-6 w-6 text-primary" /></span>
              <span className="text-sm font-semibold text-foreground">Prendre en photo / importer le relevé</span>
              <span className="text-xs text-muted-foreground">L'IA extrait automatiquement les opérations (image JPG/PNG)</span>
            </div>
          )}
        </label>
      ) : (
        <>
          <div className={`${panel} grid grid-cols-2 gap-3 p-4 sm:grid-cols-4`}>
            <Field label="Banque" value={header.bank_name} onChange={v => setHeader(h => ({ ...h, bank_name: v }))} />
            <Field label="Compte" value={header.account_code} onChange={v => setHeader(h => ({ ...h, account_code: v }))} />
            <Field label="Du" type="date" value={header.period_start} onChange={v => setHeader(h => ({ ...h, period_start: v }))} />
            <Field label="Au" type="date" value={header.period_end} onChange={v => setHeader(h => ({ ...h, period_end: v }))} />
          </div>
          <div className={`${panel} overflow-hidden`}>
            <div className={`hidden gap-2 border-b border-border bg-secondary/40 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid ${lineGrid}`}>
              <span>Date</span><span>Libellé</span><span className="text-right">Débit</span><span className="text-right">Crédit</span><span />
            </div>
            <ul className="divide-y divide-border">
              {lines.map((l, i) => (
                <li key={i} className={`grid grid-cols-2 gap-2 px-3 py-3 md:items-center md:py-2 ${lineGrid}`}>
                  <input type="date" value={l.line_date || ''} onChange={e => setLine(i, 'line_date', e.target.value)} aria-label={`Date, ligne ${i + 1}`} className={fieldSm} />
                  <input value={l.label || ''} onChange={e => setLine(i, 'label', e.target.value)} aria-label={`Libellé, ligne ${i + 1}`} placeholder="Libellé" className={`${fieldSm} col-span-2 row-start-2 md:col-span-1 md:row-start-auto`} />
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:sr-only">Débit</span>
                    <input type="number" step="0.01" value={l.debit || ''} onChange={e => setLine(i, 'debit', Number(e.target.value))} className={`${fieldSm} text-right tabular-nums`} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:sr-only">Crédit</span>
                    <input type="number" step="0.01" value={l.credit || ''} onChange={e => setLine(i, 'credit', Number(e.target.value))} className={`${fieldSm} text-right tabular-nums`} />
                  </label>
                  <div className="col-start-2 row-start-1 flex justify-end md:col-start-auto md:row-start-auto">
                    <button onClick={() => removeLine(i)} aria-label={`Supprimer la ligne ${i + 1}`} title="Supprimer la ligne" className={iconBtnDanger}><Trash2 className="h-4 w-4" /></button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex justify-end">
            <button onClick={save} disabled={saving} className={`${btnPrimary} w-full sm:w-auto`}>
              {saving ? <Loader className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Enregistrer le relevé
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block min-w-0"><span className={fieldLabel}>{label}</span>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} className={field} /></label>
  );
}

// ── Detail: reconcile against the ledger ─────────────────────────────────────
function DetailView({ statement, onReload, createdBy }: { statement: BankStatement; onReload: () => void; createdBy: string | null }) {
  const { showToast } = useToast();
  const [fy, setFy] = useState<FiscalYear | null>(null);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [ledger, setLedger] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [genFor, setGenFor] = useState<number | null>(null);
  const [counterpart, setCounterpart] = useState('');

  useEffect(() => {
    (async () => {
      const year = await AccountingService.ensureCurrentFiscalYear();
      setFy(year);
      const [j, a, l] = await Promise.all([
        AccountingService.listJournals(), AccountingService.listAccounts(),
        AccountingService.getAccountLines(statement.account_code, year.id),
      ]);
      setJournals(j); setAccounts(a); setLedger(l);
    })().catch(() => {});
  }, [statement.account_code]);

  const usedLedger = useMemo(() => new Set((statement.lines || []).map(l => l.matched_entry_line_id).filter(Boolean)), [statement.lines]);

  const autoMatch = async () => {
    setBusy(true);
    try {
      let matched = 0;
      const used = new Set(usedLedger);
      for (const bl of (statement.lines || [])) {
        if (bl.reconciled) continue;
        const wantDebit = bl.credit > 0;               // money in → ledger debit on treasury
        const amount = wantDebit ? bl.credit : bl.debit;
        const cand = ledger.find(ll => {
          if (used.has(ll.id)) return false;
          const amt = wantDebit ? Number(ll.debit) : Number(ll.credit);
          if (Math.abs(amt - amount) > 0.01) return false;
          if (bl.line_date && ll.entry_date) { const dd = Math.abs(new Date(bl.line_date).getTime() - new Date(ll.entry_date).getTime()) / 86400000; if (dd > 7) return false; }
          return true;
        });
        if (cand) { await BankService.setLineReconciled(bl.id!, cand.id); used.add(cand.id); matched++; }
      }
      if (matched > 0) await BankService.syncStatus(statement.id);
      showToast({ type: matched ? 'success' : 'info', message: matched ? `${matched} ligne(s) rapprochée(s)` : 'Aucune correspondance trouvée' });
      onReload();
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };

  const generateEntry = async (bl: BankStatementLine, idx: number) => {
    if (!fy) return;
    if (!counterpart || !accounts.find(a => a.code === counterpart)) { showToast({ type: 'error', message: 'Choisissez un compte de contrepartie valide' }); return; }
    setBusy(true);
    try {
      const isIn = bl.credit > 0;
      const amount = isIn ? bl.credit : bl.debit;
      const treasury = statement.account_code;
      const lines = isIn
        ? [{ account_code: treasury, label: bl.label || 'Encaissement', debit: amount, credit: 0 }, { account_code: counterpart, label: bl.label || '', debit: 0, credit: amount }]
        : [{ account_code: counterpart, label: bl.label || 'Décaissement', debit: amount, credit: 0 }, { account_code: treasury, label: bl.label || '', debit: 0, credit: amount }];
      const entry = await AccountingService.createFromDraft(
        { journalType: 'banque', date: bl.line_date || localDay(), reference: bl.reference || '', label: bl.label || 'Opération bancaire', sourceType: 'manual', sourceId: `bank:${bl.id}`, lines },
        journals, { post: true, createdBy },
      );
      const full = await AccountingService.getEntry(entry.id);
      const treasuryLine = full?.lines?.find(l => l.account_code === treasury);
      await BankService.setLineReconciled(bl.id!, treasuryLine?.id || null);
      await BankService.syncStatus(statement.id);
      showToast({ type: 'success', message: 'Écriture générée et rapprochée' });
      setGenFor(null); setCounterpart(''); onReload();
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };

  const reconciledCount = (statement.lines || []).filter(l => l.reconciled).length;

  const total = (statement.lines || []).length;

  return (
    <div className="space-y-4">
      <div className={`${panel} flex flex-wrap items-center justify-between gap-3 p-4`}>
        <div className="min-w-0">
          <div className="truncate font-semibold text-foreground">{statement.bank_name || 'Relevé'} · <span className="font-mono">{statement.account_code}</span></div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
              <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${total ? (reconciledCount / total) * 100 : 0}%` }} />
            </span>
            <span className="tabular-nums">{reconciledCount}/{total} rapprochées</span>
          </div>
        </div>
        <button onClick={autoMatch} disabled={busy} className={`${btnPrimary} w-full sm:w-auto`}>
          {busy ? <Loader className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Rapprochement automatique
        </button>
      </div>

      <div className={`${panel} overflow-hidden`}>
        <div className="hidden grid-cols-[7rem_minmax(0,1fr)_8rem_8rem_11rem] gap-3 border-b border-border bg-secondary/40 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid">
          <span>Date</span><span>Libellé</span><span className="text-right">Débit</span><span className="text-right">Crédit</span><span className="text-right">État</span>
        </div>
        <ul className="divide-y divide-border">
          {(statement.lines || []).map((l, i) => (
            <li key={l.id}>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 md:grid-cols-[7rem_minmax(0,1fr)_8rem_8rem_11rem]">
                <span className="hidden whitespace-nowrap text-xs tabular-nums text-muted-foreground md:block">{l.line_date}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-foreground">{l.label}</span>
                  <span className="block text-xs tabular-nums text-muted-foreground md:hidden">
                    {l.line_date}{Number(l.debit) ? ` · Débit ${fmt(Number(l.debit))}` : ''}{Number(l.credit) ? ` · Crédit ${fmt(Number(l.credit))}` : ''}
                  </span>
                </span>
                <span className="hidden text-right text-sm tabular-nums text-foreground md:block">{fmt(Number(l.debit))}</span>
                <span className="hidden text-right text-sm tabular-nums text-foreground md:block">{fmt(Number(l.credit))}</span>
                <span className="text-right">
                  {l.reconciled ? <StatusPill tone="success" icon={<Link2 className="h-3 w-3" />}>Rapproché</StatusPill>
                    : <button onClick={() => { setGenFor(genFor === i ? null : i); setCounterpart(''); }} aria-expanded={genFor === i} className={btnSoft}>Générer l'écriture</button>}
                </span>
              </div>
              {genFor === i && !l.reconciled && (
                <div className="flex flex-wrap items-center gap-2 border-t border-border bg-secondary/40 px-4 py-3">
                  <label htmlFor={`cp-${i}`} className="text-xs font-semibold text-muted-foreground">Contrepartie :</label>
                  <input id={`cp-${i}`} list="cp-accounts" value={counterpart} onChange={e => setCounterpart(e.target.value.split(' ')[0])} placeholder="compte" className={`${fieldSm} w-40 font-mono`} />
                  <datalist id="cp-accounts">{accounts.map(a => <option key={a.code} value={a.code}>{a.code} — {a.label}</option>)}</datalist>
                  <button onClick={() => generateEntry(l, i)} disabled={busy} className={`${btnPrimary} min-h-9`}>Valider</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
