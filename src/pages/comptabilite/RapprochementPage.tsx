import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Landmark, Upload, Loader, Check, ArrowLeft, Sparkles, Trash2, Link2, Zap } from 'lucide-react';
import { BankService, type BankStatement, type BankStatementLine } from '../../utils/supabaseBank';
import { AccountingService } from '../../utils/supabaseAccounting';
import type { Account, FiscalYear, Journal } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

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

  if (loading) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>;

  return (
    <div className="max-w-4xl mx-auto py-6 px-3">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          {view !== 'list' && <button onClick={() => { setView('list'); setDetail(null); load(); }} className="p-1.5 hover:bg-secondary rounded-lg"><ArrowLeft className="h-4 w-4 text-muted-foreground" /></button>}
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10"><Landmark className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">Rapprochement bancaire</h1>
            <p className="text-xs text-muted-foreground">Import de relevé par scan (lecture automatique)</p>
          </div>
        </div>
        {view === 'list' && <button onClick={() => setView('import')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"><Upload className="h-4 w-4" /> Importer un relevé</button>}
      </div>

      {view === 'import' && <ImportView onSaved={() => { setView('list'); load(); }} createdBy={currentUser?.username || null} />}
      {view === 'detail' && detail && <DetailView statement={detail} onReload={() => openDetail(detail.id)} createdBy={currentUser?.username || null} />}
      {view === 'list' && (
        <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
          {statements.length === 0 ? (
            <div className="px-3 py-12 text-center text-sm text-muted-foreground">Aucun relevé. Importez un scan pour commencer.</div>
          ) : statements.map(s => (
            <button key={s.id} onClick={() => openDetail(s.id)} className="w-full flex items-center justify-between px-3 py-3 border-b border-border/40 last:border-0 hover:bg-secondary/30 text-left">
              <div>
                <div className="font-medium text-foreground text-sm">{s.bank_name || s.label || 'Relevé'} · {s.account_code}</div>
                <div className="text-[11px] text-muted-foreground">{s.period_start || '?'} → {s.period_end || '?'}</div>
              </div>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${s.status === 'reconciled' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'}`}>{s.status === 'reconciled' ? 'Rapproché' : 'À rapprocher'}</span>
            </button>
          ))}
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

  return (
    <div className="space-y-4">
      {lines.length === 0 ? (
        <label className="block bg-card border-2 border-dashed border-border rounded-xl p-10 text-center cursor-pointer hover:border-primary/50 transition-colors">
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
          {parsing ? (
            <div className="flex flex-col items-center gap-2 text-muted-foreground"><Loader className="h-6 w-6 animate-spin" /><span className="text-sm">Lecture du relevé par IA…</span></div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10"><Sparkles className="h-6 w-6 text-primary" /></div>
              <span className="text-sm font-medium text-foreground">Prendre en photo / importer le relevé</span>
              <span className="text-xs text-muted-foreground">L'IA extrait automatiquement les opérations (image JPG/PNG)</span>
            </div>
          )}
        </label>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-card border border-border/60 rounded-xl p-3">
            <Field label="Banque" value={header.bank_name} onChange={v => setHeader(h => ({ ...h, bank_name: v }))} />
            <Field label="Compte" value={header.account_code} onChange={v => setHeader(h => ({ ...h, account_code: v }))} />
            <Field label="Du" type="date" value={header.period_start} onChange={v => setHeader(h => ({ ...h, period_start: v }))} />
            <Field label="Au" type="date" value={header.period_end} onChange={v => setHeader(h => ({ ...h, period_end: v }))} />
          </div>
          <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-secondary/50 text-xs text-muted-foreground border-b border-border/60">
                <th className="text-left font-medium px-2 py-1.5 w-28">Date</th>
                <th className="text-left font-medium px-2 py-1.5">Libellé</th>
                <th className="text-right font-medium px-2 py-1.5 w-24">Débit</th>
                <th className="text-right font-medium px-2 py-1.5 w-24">Crédit</th>
                <th className="w-8"></th>
              </tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-border/30">
                    <td className="px-2 py-1"><input type="date" value={l.line_date || ''} onChange={e => setLine(i, 'line_date', e.target.value)} className="w-full px-1.5 py-1 text-xs rounded bg-secondary border border-border" /></td>
                    <td className="px-2 py-1"><input value={l.label || ''} onChange={e => setLine(i, 'label', e.target.value)} className="w-full px-1.5 py-1 text-sm rounded bg-secondary border border-border" /></td>
                    <td className="px-2 py-1"><input type="number" step="0.01" value={l.debit || ''} onChange={e => setLine(i, 'debit', Number(e.target.value))} className="w-full px-1.5 py-1 text-sm text-right rounded bg-secondary border border-border" /></td>
                    <td className="px-2 py-1"><input type="number" step="0.01" value={l.credit || ''} onChange={e => setLine(i, 'credit', Number(e.target.value))} className="w-full px-1.5 py-1 text-sm text-right rounded bg-secondary border border-border" /></td>
                    <td className="px-1 text-center"><button onClick={() => removeLine(i)} className="p-1 text-muted-foreground hover:bg-secondary rounded"><Trash2 className="h-3.5 w-3.5" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end">
            <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
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
    <div><label className="block text-[11px] text-muted-foreground mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" /></div>
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
        { journalType: 'banque', date: bl.line_date || new Date().toISOString().slice(0, 10), reference: bl.reference || '', label: bl.label || 'Opération bancaire', sourceType: 'manual', sourceId: `bank:${bl.id}`, lines },
        fy.id, journals, { post: true, createdBy },
      );
      const full = await AccountingService.getEntry(entry.id);
      const treasuryLine = full?.lines?.find(l => l.account_code === treasury);
      await BankService.setLineReconciled(bl.id!, treasuryLine?.id || null);
      showToast({ type: 'success', message: 'Écriture générée et rapprochée' });
      setGenFor(null); setCounterpart(''); onReload();
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };

  const reconciledCount = (statement.lines || []).filter(l => l.reconciled).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between bg-card border border-border/60 rounded-xl p-3">
        <div className="text-sm">
          <div className="font-semibold text-foreground">{statement.bank_name || 'Relevé'} · {statement.account_code}</div>
          <div className="text-[11px] text-muted-foreground">{reconciledCount}/{(statement.lines || []).length} rapprochées</div>
        </div>
        <button onClick={autoMatch} disabled={busy} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
          {busy ? <Loader className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Rapprochement automatique
        </button>
      </div>

      <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="bg-secondary/50 text-xs text-muted-foreground border-b border-border/60">
            <th className="text-left font-medium px-2 py-1.5 w-24">Date</th>
            <th className="text-left font-medium px-2 py-1.5">Libellé</th>
            <th className="text-right font-medium px-2 py-1.5 w-24">Débit</th>
            <th className="text-right font-medium px-2 py-1.5 w-24">Crédit</th>
            <th className="text-right font-medium px-2 py-1.5 w-32">État</th>
          </tr></thead>
          <tbody>
            {(statement.lines || []).map((l, i) => (
              <React.Fragment key={l.id}>
                <tr className="border-b border-border/30">
                  <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground text-xs">{l.line_date}</td>
                  <td className="px-2 py-1.5">{l.label}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(Number(l.debit))}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(Number(l.credit))}</td>
                  <td className="px-2 py-1.5 text-right">
                    {l.reconciled ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400"><Link2 className="h-3 w-3" />Rapproché</span>
                      : <button onClick={() => { setGenFor(genFor === i ? null : i); setCounterpart(''); }} className="text-[11px] px-2 py-1 rounded-md bg-secondary border border-border">Générer l'écriture</button>}
                  </td>
                </tr>
                {genFor === i && !l.reconciled && (
                  <tr className="bg-secondary/20"><td colSpan={5} className="px-3 py-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-muted-foreground">Contrepartie :</span>
                      <input list="cp-accounts" value={counterpart} onChange={e => setCounterpart(e.target.value.split(' ')[0])} placeholder="compte" className="px-2 py-1 text-sm rounded bg-secondary border border-border font-mono w-40" />
                      <datalist id="cp-accounts">{accounts.map(a => <option key={a.code} value={a.code}>{a.code} — {a.label}</option>)}</datalist>
                      <button onClick={() => generateEntry(l, i)} disabled={busy} className="px-3 py-1 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50">Valider</button>
                    </div>
                  </td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
