import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Landmark, Loader, FileCheck } from 'lucide-react';
import type { FiscalYear, Journal, JournalEntryLine } from '../../types';
import { AccountingService } from '../../utils/supabaseAccounting';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

function fmtMad(n: number) { return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n) + ' MAD'; }
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

export default function TvaPage() {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const [fy, setFy] = useState<FiscalYear | null>(null);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [lines, setLines] = useState<any[]>([]);
  const [decls, setDecls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [periodType, setPeriodType] = useState<'M' | 'T'>('M');
  const [month, setMonth] = useState(new Date().getMonth());
  const [quarter, setQuarter] = useState(Math.floor(new Date().getMonth() / 3));
  const [regime, setRegime] = useState<'debit' | 'encaissement'>('encaissement');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const year = await AccountingService.ensureCurrentFiscalYear();
      setFy(year);
      const [j, l, d] = await Promise.all([
        AccountingService.listJournals(),
        AccountingService.getPostedLines(year.id),
        AccountingService.listVatDeclarations().catch(() => []),
      ]);
      setJournals(j); setLines(l); setDecls(d);
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const year = fy ? Number(fy.label) : new Date().getFullYear();
  const range = useMemo(() => {
    if (periodType === 'M') {
      const start = new Date(year, month, 1), end = new Date(year, month + 1, 0);
      return { start, end, label: `${year}-${String(month + 1).padStart(2, '0')}`, human: `${MONTHS[month]} ${year}` };
    }
    const start = new Date(year, quarter * 3, 1), end = new Date(year, quarter * 3 + 3, 0);
    return { start, end, label: `${year}-T${quarter + 1}`, human: `T${quarter + 1} ${year}` };
  }, [periodType, month, quarter, year]);

  const calc = useMemo(() => {
    const inRange = (d: string) => { const t = new Date(d); return t >= range.start && t <= range.end; };
    let facturee = 0, recupBiens = 0, recupCharges = 0;
    for (const l of lines) {
      if (!l.entry_date || !inRange(l.entry_date)) continue;
      const code = String(l.account_code);
      const d = Number(l.debit) || 0, c = Number(l.credit) || 0;
      if (code.startsWith('4455')) facturee += c - d;
      else if (code.startsWith('34551')) recupBiens += d - c;
      else if (code.startsWith('3455')) recupCharges += d - c;
    }
    const recup = recupBiens + recupCharges;
    const net = facturee - recup;
    return { facturee, recupBiens, recupCharges, recup, due: net > 0 ? net : 0, credit: net < 0 ? -net : 0, net };
  }, [lines, range]);

  const existing = useMemo(() => decls.find(d => d.period === range.label), [decls, range]);

  const generate = async () => {
    if (!fy) return;
    if (Math.abs(calc.net) < 0.005 && calc.facturee === 0 && calc.recup === 0) { showToast({ type: 'error', message: 'Aucune TVA sur la période' }); return; }
    setBusy(true);
    try {
      const lines2: JournalEntryLine[] = [];
      if (calc.facturee > 0) lines2.push({ account_code: '4455', label: 'TVA facturée', debit: Math.round(calc.facturee * 100) / 100, credit: 0 });
      if (calc.recupBiens > 0) lines2.push({ account_code: '34551', label: 'TVA récup. immobilisations', debit: 0, credit: Math.round(calc.recupBiens * 100) / 100 });
      if (calc.recupCharges > 0) lines2.push({ account_code: '34552', label: 'TVA récup. charges', debit: 0, credit: Math.round(calc.recupCharges * 100) / 100 });
      if (calc.net > 0) lines2.push({ account_code: '4456', label: 'TVA due', debit: 0, credit: Math.round(calc.net * 100) / 100 });
      else if (calc.net < 0) lines2.push({ account_code: '4456', label: 'Crédit de TVA', debit: Math.round(-calc.net * 100) / 100, credit: 0 });

      const entry = await AccountingService.createFromDraft(
        { journalType: 'od', date: range.end.toISOString().slice(0, 10), reference: `TVA ${range.label}`, label: `Déclaration TVA ${range.human}`, sourceType: 'manual', sourceId: `tva:${range.label}`, lines: lines2 },
        fy.id, journals, { post: false, createdBy: currentUser?.username || null },
      );

      await AccountingService.saveVatDeclaration({
        fiscal_year_id: fy.id, period_type: periodType, period: range.label, regime,
        tva_facturee: calc.facturee, tva_recuperable_biens: calc.recupBiens, tva_recuperable_charges: calc.recupCharges,
        tva_due: calc.due, credit_report: calc.credit, entry_id: entry.id, status: 'draft',
      });
      showToast({ type: 'success', title: 'Déclaration générée', message: 'Écriture de TVA en brouillon — validez-la dans Saisie/Journaux' });
      await load();
    } catch (e: any) {
      showToast({ type: 'error', title: 'Erreur', message: e?.message || 'Échec' });
    } finally { setBusy(false); }
  };

  if (loading) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>;

  const kpis = [
    { label: 'TVA facturée', value: fmtMad(calc.facturee), tone: 'text-blue-600 dark:text-blue-400' },
    { label: 'TVA récupérable', value: fmtMad(calc.recup), tone: 'text-emerald-600 dark:text-emerald-400' },
    calc.due > 0
      ? { label: 'TVA due', value: fmtMad(calc.due), tone: 'text-amber-600 dark:text-amber-400' }
      : { label: 'Crédit de TVA', value: fmtMad(calc.credit), tone: 'text-primary' },
  ];

  return (
    <div className="max-w-3xl mx-auto py-6 px-3">
      <div className="flex items-center gap-2 mb-4">
        <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10"><Landmark className="h-5 w-5 text-primary" /></div>
        <div>
          <h1 className="text-lg font-bold text-foreground leading-tight">Déclaration de TVA</h1>
          <p className="text-xs text-muted-foreground">Exercice {fy?.label} · base comptable</p>
        </div>
      </div>

      <div className="bg-card border border-border/60 rounded-xl p-4 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] text-muted-foreground mb-1">Périodicité</label>
          <select value={periodType} onChange={e => setPeriodType(e.target.value as 'M' | 'T')} className="px-3 py-2 text-sm rounded-lg bg-secondary border border-border">
            <option value="M">Mensuelle</option>
            <option value="T">Trimestrielle</option>
          </select>
        </div>
        {periodType === 'M' ? (
          <div><label className="block text-[11px] text-muted-foreground mb-1">Mois</label>
            <select value={month} onChange={e => setMonth(Number(e.target.value))} className="px-3 py-2 text-sm rounded-lg bg-secondary border border-border">
              {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select></div>
        ) : (
          <div><label className="block text-[11px] text-muted-foreground mb-1">Trimestre</label>
            <select value={quarter} onChange={e => setQuarter(Number(e.target.value))} className="px-3 py-2 text-sm rounded-lg bg-secondary border border-border">
              {[0, 1, 2, 3].map(q => <option key={q} value={q}>T{q + 1}</option>)}
            </select></div>
        )}
        <div><label className="block text-[11px] text-muted-foreground mb-1">Régime</label>
          <select value={regime} onChange={e => setRegime(e.target.value as any)} className="px-3 py-2 text-sm rounded-lg bg-secondary border border-border">
            <option value="encaissement">Encaissement</option>
            <option value="debit">Débit</option>
          </select>
        </div>
        <div className="ml-auto text-xs text-muted-foreground self-center">{range.human}{existing ? ' · déjà déclarée' : ''}</div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        {kpis.map((k, i) => (
          <div key={i} className="bg-card border border-border/60 rounded-xl p-3">
            <div className={`text-base font-bold tabular-nums ${k.tone}`}>{k.value}</div>
            <div className="text-[11px] text-muted-foreground">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-card border border-border/60 rounded-xl p-4 mb-4 text-sm">
        <div className="flex justify-between py-1"><span className="text-muted-foreground">TVA facturée (comptes 4455…)</span><span className="tabular-nums">{fmtMad(calc.facturee)}</span></div>
        <div className="flex justify-between py-1"><span className="text-muted-foreground">TVA récupérable / immobilisations (34551)</span><span className="tabular-nums">{fmtMad(calc.recupBiens)}</span></div>
        <div className="flex justify-between py-1"><span className="text-muted-foreground">TVA récupérable / charges (34552…)</span><span className="tabular-nums">{fmtMad(calc.recupCharges)}</span></div>
        <div className="flex justify-between py-2 border-t border-border/60 mt-1 font-semibold">
          <span>{calc.net >= 0 ? 'TVA due' : 'Crédit de TVA reportable'}</span>
          <span className="tabular-nums">{fmtMad(Math.abs(calc.net))}</span>
        </div>
      </div>

      {regime === 'encaissement' && (
        <p className="text-[11px] text-muted-foreground mb-3">
          ⚠ Calcul sur base comptable (timing débit). En régime encaissement, la TVA facturée est exigible à l'encaissement — ajustez manuellement les factures non encaissées si nécessaire.
        </p>
      )}

      <button onClick={generate} disabled={busy}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
        {busy ? <Loader className="h-4 w-4 animate-spin" /> : <FileCheck className="h-4 w-4" />}
        {existing ? 'Régénérer la déclaration' : 'Générer la déclaration & l\'écriture'}
      </button>
    </div>
  );
}
