import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  Users, Loader, Search, Plus, Upload, Trash2, Tag, X, Check, Save,
  UserX, Download, ShieldOff, ChevronDown,
} from 'lucide-react';
import { WaContactsService, matchSegment, type WaContact, type WaSegment, type SegmentFilter, type ImportRow, type ImportReport, type EngagementCtx } from '../../utils/supabaseWaContacts';
import { WhatsappService } from '../../utils/supabaseWhatsapp';
import { normalizePhone } from '../../utils/phone';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

const PAGE_SIZE = 60;
const FIELDS = [
  { key: 'phone', label: 'Téléphone *' },
  { key: 'name', label: 'Nom' },
  { key: 'email', label: 'E-mail' },
  { key: 'tags', label: 'Tags (séparés par ;)' },
  { key: 'ignore', label: '— ignorer —' },
  { key: 'custom', label: 'Champ personnalisé' },
];

async function parseFile(file: File): Promise<{ headers: string[]; rows: string[][] }> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim().length);
    const sep = (text.match(/;/g)?.length || 0) > (text.match(/,/g)?.length || 0) ? ';' : ',';
    const parseLine = (l: string) => {
      const out: string[] = []; let cur = '', q = false;
      for (let i = 0; i < l.length; i++) {
        const ch = l[i];
        if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
        else if (ch === '"') q = true; else if (ch === sep) { out.push(cur); cur = ''; } else cur += ch;
      }
      out.push(cur); return out.map(s => s.trim());
    };
    const all = lines.map(parseLine);
    return { headers: all[0] || [], rows: all.slice(1) };
  }
  // xlsx via ExcelJS
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  const rows: string[][] = [];
  ws.eachRow((row) => {
    const vals: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => { vals.push(cell.value == null ? '' : String((cell.value as any).text ?? cell.value)); });
    rows.push(vals);
  });
  return { headers: rows[0] || [], rows: rows.slice(1) };
}

export default function ContactsPage() {
  const { isAdmin, isSuperAdmin } = useAuth();
  const { showToast } = useToast();

  const [tab, setTab] = useState<'contacts' | 'optouts'>('contacts');
  const [contacts, setContacts] = useState<WaContact[]>([]);
  const [segments, setSegments] = useState<WaSegment[]>([]);
  const [optOuts, setOptOuts] = useState<{ phone: string; reason: string; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [behavior, setBehavior] = useState<'' | 'replied'>('');
  const [eng, setEng] = useState<EngagementCtx | null>(null);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [showImport, setShowImport] = useState(false);
  const [dialog, setDialog] = useState<null | { kind: 'add' } | { kind: 'tag'; add: boolean } | { kind: 'segment' } | { kind: 'optout' }>(null);
  const [busy, setBusy] = useState(false);
  const optOutFileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, s, o] = await Promise.all([WaContactsService.list(), WaContactsService.listSegments(), WaContactsService.listOptOuts()]);
      setContacts(c); setSegments(s); setOptOuts(o);
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const optOutSet = useMemo(() => new Set(optOuts.map(o => o.phone)), [optOuts]);
  const allTags = useMemo(() => {
    const s = new Set<string>();
    contacts.forEach(c => c.tags?.forEach(t => s.add(t)));
    return Array.from(s).sort();
  }, [contacts]);

  const filter: SegmentFilter = useMemo(() => ({
    search: query || undefined, tagsAll: tagFilter.length ? tagFilter : undefined,
    behavior: behavior || undefined,
  }), [query, tagFilter, behavior]);

  // engagement sets are only fetched when a behavior filter is first used
  useEffect(() => {
    if (behavior && !eng) WaContactsService.engagement().then(setEng).catch(() => {});
  }, [behavior, eng]);

  const filtered = useMemo(
    () => (behavior && !eng) ? [] : contacts.filter(c => matchSegment(c, filter, eng || undefined)),
    [contacts, filter, behavior, eng]
  );
  useEffect(() => { setPage(0); }, [query, tagFilter, behavior]);
  const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const nPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const reachable = useMemo(() => filtered.filter(c => !optOutSet.has(c.phone)).length, [filtered, optOutSet]);

  // ── actions ───────────────────────────────────────────────────────────────
  const addContact = async (phone: string, name: string, tags: string[]) => {
    await WaContactsService.upsertOne({ phone, name: name || undefined, tags });
    await load();
    showToast({ type: 'success', message: 'Contact ajouté' });
  };

  const bulkDelete = async () => {
    if (!selected.size || !window.confirm(`Supprimer ${selected.size} contact(s) ?`)) return;
    setBusy(true);
    try { await WaContactsService.remove(Array.from(selected)); setSelected(new Set()); await load(); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };

  const bulkTag = async (add: boolean, tag: string) => {
    const updates = contacts.filter(c => selected.has(c.id)).map(c => {
      const tags = add ? Array.from(new Set([...c.tags, tag])) : c.tags.filter(x => x !== tag);
      return { id: c.id, tags };
    });
    setBusy(true);
    try { await WaContactsService.setTags(updates); await load(); showToast({ type: 'success', message: 'Tags mis à jour' }); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };

  const bulkOptOut = async () => {
    const phones = contacts.filter(c => selected.has(c.id)).map(c => c.phone);
    if (!phones.length || !window.confirm(`Désinscrire ${phones.length} contact(s) ? Ils ne recevront plus de messages.`)) return;
    setBusy(true);
    try { for (const p of phones) await WaContactsService.addOptOut(p, 'manual'); await load(); showToast({ type: 'success', message: 'Désinscrits' }); setSelected(new Set()); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };

  const saveSegment = async (name: string) => {
    await WaContactsService.saveSegment(name, filter);
    await load();
    showToast({ type: 'success', message: 'Segment enregistré' });
  };
  const applySegment = (s: WaSegment) => { setQuery(s.filter.search || ''); setTagFilter(s.filter.tagsAll || []); setBehavior((s.filter.behavior as any) || ''); };

  const verifyNumbers = async () => {
    const unchecked = filtered.filter(c => !c.wa_status).map(c => c.phone);
    if (!unchecked.length) { showToast({ type: 'info', message: 'Tous les contacts affichés sont déjà vérifiés' }); return; }
    if (!window.confirm(`Vérifier ${unchecked.length} numéro(s) sur WhatsApp ? Le runner traite ~1 numéro/seconde.`)) return;
    setBusy(true);
    try {
      const session = await WhatsappService.ensureSession();
      await WaContactsService.requestValidation(session.id, unchecked);
      showToast({ type: 'success', message: `Vérification de ${unchecked.length} numéro(s) lancée — rechargez la page dans quelques minutes` });
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };

  const exportCsv = () => {
    const header = ['phone', 'name', 'email', 'tags', 'opted_out'];
    const rows = filtered.map(c => [c.phone, c.name || '', c.email || '', (c.tags || []).join(';'), optOutSet.has(c.phone) ? '1' : '0']);
    const csv = '﻿' + [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = `contacts_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const onOptOutFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const { rows } = await parseFile(file);
      const phones = rows.map(r => r[0]).filter(Boolean);
      const n = await WaContactsService.importOptOuts(phones);
      showToast({ type: 'success', message: `${n} numéro(s) désinscrit(s)` });
      await load();
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };

  if (!isAdmin && !isSuperAdmin) return <div className="text-center py-12 text-muted-foreground">Accès réservé aux administrateurs.</div>;
  if (loading) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>;

  return (
    <div className="max-w-6xl mx-auto py-6 px-3">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10"><Users className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">WhatsApp — Contacts</h1>
            <p className="text-xs text-muted-foreground">{contacts.length} contacts · {optOuts.length} désinscrits</p>
          </div>
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden text-sm">
          <button onClick={() => setTab('contacts')} className={`px-3 py-2 font-medium ${tab === 'contacts' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>Contacts</button>
          <button onClick={() => setTab('optouts')} className={`px-3 py-2 font-medium ${tab === 'optouts' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>Désinscriptions</button>
        </div>
      </div>

      {tab === 'contacts' ? (
        <>
          {showImport && <ImportWizard onClose={() => setShowImport(false)} onDone={async () => { setShowImport(false); await load(); }} />}

          {/* toolbar */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Nom, téléphone, e-mail…"
                className="w-full pl-8 pr-3 py-2 text-sm rounded-lg bg-secondary border border-border" />
            </div>
            {segments.length > 0 && (
              <select onChange={e => { const s = segments.find(x => x.id === e.target.value); if (s) applySegment(s); }} defaultValue=""
                className="px-2 py-2 text-sm rounded-lg bg-secondary border border-border">
                <option value="">Segments…</option>
                {segments.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <select value={behavior} onChange={e => setBehavior(e.target.value as any)}
              className="px-2 py-2 text-sm rounded-lg bg-secondary border border-border" title="Filtrer selon l'engagement passé">
              <option value="">Comportement…</option>
              <option value="replied">A déjà répondu</option>
            </select>
            <button onClick={verifyNumbers} disabled={busy}
              className="flex items-center gap-1 px-2.5 py-2 rounded-lg bg-secondary border border-border text-xs disabled:opacity-50"
              title="Vérifier via le runner quels numéros affichés sont réellement sur WhatsApp">
              <Check className="h-3.5 w-3.5" /> Vérifier
            </button>
            <button onClick={() => {
              if (!query && !tagFilter.length) { showToast({ type: 'info', message: 'Appliquez d\'abord un filtre à enregistrer' }); return; }
              setDialog({ kind: 'segment' });
            }} className="px-2.5 py-2 rounded-lg bg-secondary border border-border text-xs" title="Enregistrer le filtre comme segment"><Save className="h-3.5 w-3.5" /></button>
            <button onClick={exportCsv} className="flex items-center gap-1 px-2.5 py-2 rounded-lg bg-secondary border border-border text-xs"><Download className="h-3.5 w-3.5" /> CSV</button>
            <button onClick={() => setDialog({ kind: 'add' })} className="flex items-center gap-1 px-2.5 py-2 rounded-lg bg-secondary border border-border text-xs"><Plus className="h-3.5 w-3.5" /> Contact</button>
            <button onClick={() => setShowImport(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"><Upload className="h-4 w-4" /> Importer</button>
          </div>

          {/* tag chips */}
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {allTags.map(t => (
                <button key={t} onClick={() => setTagFilter(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])}
                  className={`px-2 py-0.5 rounded-full text-xs border ${tagFilter.includes(t) ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary border-border text-muted-foreground'}`}>
                  <Tag className="h-3 w-3 inline mr-1" />{t}
                </button>
              ))}
              {tagFilter.length > 0 && <button onClick={() => setTagFilter([])} className="text-xs text-muted-foreground hover:text-foreground">effacer</button>}
            </div>
          )}

          <div className="text-xs text-muted-foreground mb-2">
            {filtered.length} contact(s) · <b className="text-emerald-700 dark:text-emerald-400">{reachable} joignables</b> ({filtered.length - reachable} désinscrits)
          </div>

          {selected.size > 0 && (
            <div className="mb-3 bg-primary/5 border border-primary/25 rounded-lg px-3 py-2 flex items-center gap-2 flex-wrap text-xs">
              <span className="font-medium text-foreground">{selected.size} sélectionné(s)</span>
              <button onClick={() => setDialog({ kind: 'tag', add: true })} disabled={busy} className="px-2 py-1 rounded bg-secondary border border-border">+ Tag</button>
              <button onClick={() => setDialog({ kind: 'tag', add: false })} disabled={busy} className="px-2 py-1 rounded bg-secondary border border-border">− Tag</button>
              <button onClick={bulkOptOut} disabled={busy} className="px-2 py-1 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400">Désinscrire</button>
              <button onClick={bulkDelete} disabled={busy} className="px-2 py-1 rounded bg-destructive/10 text-destructive">Supprimer</button>
              <button onClick={() => setSelected(new Set())} className="ml-auto text-muted-foreground hover:text-foreground">Désélectionner</button>
            </div>
          )}

          <div className="bg-card border border-border/60 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary/50 text-xs text-muted-foreground border-b border-border/60">
                  <th className="px-2 py-2 w-8"><input type="checkbox" className="accent-[hsl(var(--primary))]"
                    checked={pageItems.length > 0 && pageItems.every(c => selected.has(c.id))}
                    onChange={e => setSelected(prev => { const n = new Set(prev); pageItems.forEach(c => e.target.checked ? n.add(c.id) : n.delete(c.id)); return n; })} /></th>
                  <th className="text-left font-medium px-3 py-2 w-40">Téléphone</th>
                  <th className="text-left font-medium px-3 py-2">Nom</th>
                  <th className="text-left font-medium px-3 py-2">Tags</th>
                  <th className="text-left font-medium px-3 py-2 w-24">État</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(c => {
                  const out = optOutSet.has(c.phone);
                  return (
                    <tr key={c.id} className={`border-b border-border/40 ${out ? 'opacity-60' : ''}`}>
                      <td className="px-2 py-1.5"><input type="checkbox" checked={selected.has(c.id)} className="accent-[hsl(var(--primary))]"
                        onChange={e => setSelected(prev => { const n = new Set(prev); e.target.checked ? n.add(c.id) : n.delete(c.id); return n; })} /></td>
                      <td className="px-3 py-1.5 font-mono text-xs">{c.phone}</td>
                      <td className="px-3 py-1.5">{c.name || <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-1.5">
                        <div className="flex flex-wrap gap-1">{(c.tags || []).map(t => <span key={t} className="px-1.5 py-0.5 rounded bg-secondary text-[10px]">{t}</span>)}</div>
                      </td>
                      <td className="px-3 py-1.5">
                        {out ? <span className="text-[11px] text-amber-600 dark:text-amber-400">Désinscrit</span>
                          : c.wa_status === 'invalid' ? <span className="text-[11px] text-red-600 dark:text-red-400" title="Ce numéro n'est pas sur WhatsApp">Pas de WhatsApp</span>
                          : c.wa_status === 'valid' ? <span className="text-[11px] text-emerald-700 dark:text-emerald-400" title={`Vérifié sur WhatsApp${c.wa_checked_at ? ' le ' + new Date(c.wa_checked_at).toLocaleDateString('fr-FR') : ''}`}>WhatsApp ✓</span>
                          : <span className="text-[11px] text-muted-foreground" title="Cliquez sur « Vérifier » pour contrôler ce numéro">Non vérifié</span>}
                      </td>
                    </tr>
                  );
                })}
                {pageItems.length === 0 && <tr><td colSpan={5} className="px-3 py-10 text-center text-muted-foreground text-sm">Aucun contact — importez une liste pour commencer.</td></tr>}
              </tbody>
            </table>
            {nPages > 1 && (
              <div className="flex items-center justify-between px-3 py-2 border-t border-border/60 text-xs">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-2 py-1 rounded bg-secondary border border-border disabled:opacity-40">← Précédent</button>
                <span className="text-muted-foreground">Page {page + 1} / {nPages}</span>
                <button onClick={() => setPage(p => Math.min(nPages - 1, p + 1))} disabled={page >= nPages - 1} className="px-2 py-1 rounded bg-secondary border border-border disabled:opacity-40">Suivant →</button>
              </div>
            )}
          </div>
        </>
      ) : (
        /* Opt-outs tab */
        <div>
          <input ref={optOutFileRef} type="file" accept=".csv,.txt,.xlsx" className="hidden" onChange={e => { onOptOutFile(e.target.files?.[0]); e.target.value = ''; }} />
          <div className="flex items-center gap-2 mb-3">
            <button onClick={() => setDialog({ kind: 'optout' })}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"><UserX className="h-4 w-4" /> Ajouter</button>
            <button onClick={() => optOutFileRef.current?.click()} disabled={busy} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary border border-border text-sm"><Upload className="h-3.5 w-3.5" /> Importer une liste</button>
            <span className="text-xs text-muted-foreground ml-auto">Vérifié avant chaque envoi (import, mots-clés STOP, dernier contrôle avant envoi).</span>
          </div>
          <div className="bg-card border border-border/60 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-secondary/50 text-xs text-muted-foreground border-b border-border/60">
                <th className="text-left font-medium px-3 py-2">Téléphone</th>
                <th className="text-left font-medium px-3 py-2 w-32">Motif</th>
                <th className="text-left font-medium px-3 py-2 w-40">Date</th>
                <th className="w-10"></th>
              </tr></thead>
              <tbody>
                {optOuts.map(o => (
                  <tr key={o.phone} className="border-b border-border/40">
                    <td className="px-3 py-1.5 font-mono text-xs">{o.phone}</td>
                    <td className="px-3 py-1.5 text-xs">{o.reason}</td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{new Date(o.created_at).toLocaleDateString('fr-FR')}</td>
                    <td className="px-2 text-center"><button onClick={() => WaContactsService.removeOptOut(o.phone).then(load)} title="Réinscrire" className="p-1 rounded hover:bg-secondary"><ShieldOff className="h-3.5 w-3.5 text-muted-foreground" /></button></td>
                  </tr>
                ))}
                {optOuts.length === 0 && <tr><td colSpan={4} className="px-3 py-10 text-center text-muted-foreground text-sm">Aucune désinscription</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {dialog?.kind === 'add' && (
        <AddContactDialog allTags={allTags} onClose={() => setDialog(null)}
          onSubmit={async (phone, name, tags) => { await addContact(phone, name, tags); setDialog(null); }} />
      )}
      {dialog?.kind === 'tag' && (
        <TagDialog add={dialog.add} count={selected.size} allTags={allTags} onClose={() => setDialog(null)}
          onSubmit={async (tag) => { await bulkTag(dialog.add, tag); setDialog(null); }} />
      )}
      {dialog?.kind === 'segment' && (
        <NameDialog title="Enregistrer le segment" label="Nom du segment" placeholder="ex. Clients Casablanca"
          hint={`${filtered.length} contact(s) correspondent au filtre actuel.`}
          submitLabel="Enregistrer" onClose={() => setDialog(null)}
          onSubmit={async (name) => { await saveSegment(name); setDialog(null); }} />
      )}
      {dialog?.kind === 'optout' && (
        <NameDialog title="Désinscrire un numéro" label="Numéro de téléphone" placeholder="ex. 0612345678"
          hint="Ce numéro ne recevra plus jamais de message, campagnes comprises."
          submitLabel="Désinscrire" validate={(v) => normalizePhone(v) ? null : 'Numéro invalide'}
          onClose={() => setDialog(null)}
          onSubmit={async (phone) => { await WaContactsService.addOptOut(phone, 'manual'); await load(); setDialog(null); }} />
      )}
    </div>
  );
}

/* ── Small dialogs (replace browser prompts) ───────────────────────────────── */
function MiniDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-sm" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function AddContactDialog({ allTags, onClose, onSubmit }: {
  allTags: string[]; onClose: () => void;
  onSubmit: (phone: string, name: string, tags: string[]) => Promise<void>;
}) {
  const { showToast } = useToast();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!normalizePhone(phone)) { showToast({ type: 'error', message: 'Numéro invalide (ex. 0612345678)' }); return; }
    setBusy(true);
    try { await onSubmit(phone, name.trim(), tags); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };
  return (
    <MiniDialog title="Ajouter un contact" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] text-muted-foreground mb-1">Numéro de téléphone *</label>
          <input autoFocus value={phone} onChange={e => setPhone(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder="0612345678" className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" />
        </div>
        <div>
          <label className="block text-[11px] text-muted-foreground mb-1">Nom</label>
          <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder="Ahmed Benali" className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" />
        </div>
        {allTags.length > 0 && (
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Tags</label>
            <div className="flex flex-wrap gap-1.5">
              {allTags.map(t => (
                <button key={t} onClick={() => setTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])}
                  className={`px-2 py-0.5 rounded-full text-xs border ${tags.includes(t) ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary border-border text-muted-foreground'}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}
        <button onClick={submit} disabled={busy}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
          {busy ? <Loader className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Ajouter
        </button>
      </div>
    </MiniDialog>
  );
}

function TagDialog({ add, count, allTags, onClose, onSubmit }: {
  add: boolean; count: number; allTags: string[]; onClose: () => void;
  onSubmit: (tag: string) => Promise<void>;
}) {
  const { showToast } = useToast();
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (t?: string) => {
    const v = (t ?? tag).trim();
    if (!v) return;
    setBusy(true);
    try { await onSubmit(v); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };
  return (
    <MiniDialog title={add ? `Ajouter un tag à ${count} contact(s)` : `Retirer un tag de ${count} contact(s)`} onClose={onClose}>
      <div className="space-y-3">
        {add && (
          <input autoFocus value={tag} onChange={e => setTag(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder="ex. promo-aout" className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" />
        )}
        {allTags.length > 0 && (
          <div>
            <p className="text-[11px] text-muted-foreground mb-1">{add ? 'Ou choisissez un tag existant :' : 'Choisissez le tag à retirer :'}</p>
            <div className="flex flex-wrap gap-1.5">
              {allTags.map(t => (
                <button key={t} onClick={() => submit(t)} disabled={busy}
                  className="px-2 py-0.5 rounded-full text-xs border bg-secondary border-border text-muted-foreground hover:bg-primary/10 hover:border-primary/40">
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}
        {add && (
          <button onClick={() => submit()} disabled={busy || !tag.trim()}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
            {busy ? <Loader className="h-4 w-4 animate-spin" /> : <Tag className="h-4 w-4" />} Appliquer
          </button>
        )}
      </div>
    </MiniDialog>
  );
}

function NameDialog({ title, label, placeholder, hint, submitLabel, validate, onClose, onSubmit }: {
  title: string; label: string; placeholder: string; hint?: string; submitLabel: string;
  validate?: (v: string) => string | null;
  onClose: () => void; onSubmit: (value: string) => Promise<void>;
}) {
  const { showToast } = useToast();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const v = value.trim();
    if (!v) return;
    const err = validate?.(v);
    if (err) { showToast({ type: 'error', message: err }); return; }
    setBusy(true);
    try { await onSubmit(v); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };
  return (
    <MiniDialog title={title} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] text-muted-foreground mb-1">{label}</label>
          <input autoFocus value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder={placeholder} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" />
        </div>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
        <button onClick={submit} disabled={busy || !value.trim()}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
          {busy ? <Loader className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {submitLabel}
        </button>
      </div>
    </MiniDialog>
  );
}

/* ── Import wizard ─────────────────────────────────────────────────────────── */
function ImportWizard({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { showToast } = useToast();
  const [parsed, setParsed] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<string[]>([]);
  const [customNames, setCustomNames] = useState<Record<number, string>>({});
  const [defaultTags, setDefaultTags] = useState('');
  const [state, setState] = useState<{ done: number; total: number } | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  const onFile = async (file?: File) => {
    if (!file) return;
    try {
      const p = await parseFile(file);
      setParsed(p);
      // auto-guess mapping
      setMapping(p.headers.map(h => {
        const l = h.toLowerCase();
        if (/phone|tel|gsm|num|whatsapp|mobile/.test(l)) return 'phone';
        if (/name|nom|client|contact/.test(l)) return 'name';
        if (/mail/.test(l)) return 'email';
        if (/tag|segment|group/.test(l)) return 'tags';
        return 'ignore';
      }));
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Fichier illisible' }); }
  };

  const doImport = async () => {
    if (!parsed) return;
    const phoneCol = mapping.indexOf('phone');
    if (phoneCol < 0) { showToast({ type: 'error', message: 'Associez une colonne au Téléphone' }); return; }
    const extraTags = defaultTags.split(/[;,]/).map(t => t.trim()).filter(Boolean);
    const rows: ImportRow[] = parsed.rows.map(r => {
      const row: ImportRow = { phone: r[phoneCol] || '', tags: [...extraTags], custom: {} };
      mapping.forEach((m, i) => {
        const v = (r[i] || '').trim();
        if (!v) return;
        if (m === 'name') row.name = v;
        else if (m === 'email') row.email = v;
        else if (m === 'tags') row.tags = Array.from(new Set([...(row.tags || []), ...v.split(/[;,]/).map(t => t.trim()).filter(Boolean)]));
        else if (m === 'custom') row.custom![customNames[i] || parsed.headers[i] || `col${i}`] = v;
      });
      return row;
    });
    setState({ done: 0, total: rows.length });
    try {
      const rep = await WaContactsService.import(rows, (done, total) => setState({ done, total }));
      setReport(rep);
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); setState(null); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Importer des contacts</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4">
          {report ? (
            <div className="space-y-3">
              <div className="text-sm bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-lg px-3 py-2 flex items-center gap-1.5">
                <Check className="h-4 w-4" /> {report.inserted} ajoutés · {report.updated} mis à jour
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                {report.optedOut > 0 && <div>⚠ {report.optedOut} ignorés (déjà désinscrits)</div>}
                {report.duplicatesInFile > 0 && <div>{report.duplicatesInFile} doublons fusionnés dans le fichier</div>}
                {report.invalid.length > 0 && <div className="text-amber-600 dark:text-amber-400">{report.invalid.length} numéros invalides ignorés : <span className="font-mono">{report.invalid.slice(0, 10).join(', ')}{report.invalid.length > 10 ? '…' : ''}</span></div>}
              </div>
              <button onClick={onDone} className="w-full px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">Terminer</button>
            </div>
          ) : !parsed ? (
            <label className="block border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50">
              <input type="file" accept=".csv,.txt,.xlsx" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
              <Upload className="h-6 w-6 mx-auto text-primary mb-2" />
              <div className="text-sm font-medium text-foreground">Choisir un fichier CSV ou Excel</div>
              <div className="text-xs text-muted-foreground mt-1">La première ligne doit contenir les en-têtes de colonnes.</div>
            </label>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">{parsed.rows.length} lignes détectées. Associez chaque colonne :</p>
              <div className="border border-border rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                {parsed.headers.map((h, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2 border-b border-border/40 last:border-0">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{h || `Colonne ${i + 1}`}</div>
                      <div className="text-[10px] text-muted-foreground truncate font-mono">{(parsed.rows[0]?.[i] || '').slice(0, 40)}</div>
                    </div>
                    <select value={mapping[i]} onChange={e => setMapping(m => m.map((x, j) => j === i ? e.target.value : x))}
                      className="px-2 py-1 text-xs rounded bg-secondary border border-border">
                      {FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                    {mapping[i] === 'custom' && (
                      <input value={customNames[i] || h} onChange={e => setCustomNames(c => ({ ...c, [i]: e.target.value }))}
                        placeholder="nom du champ" className="w-28 px-1.5 py-1 text-xs rounded bg-secondary border border-border" />
                    )}
                  </div>
                ))}
              </div>
              <div>
                <label className="block text-[11px] text-muted-foreground mb-1">Tags à ajouter à tous (séparés par ;)</label>
                <input value={defaultTags} onChange={e => setDefaultTags(e.target.value)} placeholder="ex. promo-juillet; clients"
                  className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" />
              </div>
              {state && (
                <div><div className="flex justify-between text-xs mb-1"><span className="text-muted-foreground">Import…</span><span>{state.done}/{state.total}</span></div>
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden"><div className="h-full bg-primary" style={{ width: `${Math.round((state.done / Math.max(state.total, 1)) * 100)}%` }} /></div></div>
              )}
              <div className="flex gap-2">
                <button onClick={() => setParsed(null)} className="px-3 py-2 rounded-lg bg-secondary border border-border text-sm">Changer de fichier</button>
                <button onClick={doImport} disabled={!!state} className="flex-1 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60">
                  {state ? 'Import en cours…' : `Importer ${parsed.rows.length} lignes`}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">Les numéros sont normalisés (format international), les doublons fusionnés, et les désinscrits automatiquement exclus.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
