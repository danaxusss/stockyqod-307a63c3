import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Megaphone, Plus, Loader, Trash2, X, Play, Pause, StopCircle, Send,
  Users, Clock, CheckCheck, Check, Eye, Image as ImageIcon, FileText, RefreshCw,
  MousePointerClick,
} from 'lucide-react';
import {
  WaCampaignsService, renderMessage, type WaCampaign, type WaTemplate, type CampaignStats,
} from '../../utils/supabaseWaCampaigns';
import { WhatsappService, type WaSession } from '../../utils/supabaseWhatsapp';
import { WaContactsService, matchSegment, type WaSegment, type WaContact, type EngagementCtx } from '../../utils/supabaseWaContacts';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

const SAMPLE = { name: 'Ahmed', phone: '+212612345678', custom: { ville: 'Casablanca' } };

const STATUS: Record<string, { txt: string; cls: string }> = {
  draft: { txt: 'Brouillon', cls: 'bg-secondary text-muted-foreground' },
  scheduled: { txt: 'Planifiée', cls: 'bg-blue-500/15 text-blue-700 dark:text-blue-400' },
  running: { txt: 'En cours', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  paused: { txt: 'En pause', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  done: { txt: 'Terminée', cls: 'bg-primary/15 text-primary' },
  cancelled: { txt: 'Annulée', cls: 'bg-red-500/15 text-red-600 dark:text-red-400' },
};

export default function CampaignsPage() {
  const { isAdmin, isSuperAdmin, currentUser } = useAuth();
  const { showToast } = useToast();

  const [campaigns, setCampaigns] = useState<WaCampaign[]>([]);
  const [sessions, setSessions] = useState<WaSession[]>([]);
  const [segments, setSegments] = useState<WaSegment[]>([]);
  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [contacts, setContacts] = useState<WaContact[]>([]);
  const [optedOut, setOptedOut] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState<Partial<WaCampaign> | null>(null);
  const [detail, setDetail] = useState<WaCampaign | null>(null);

  const loadCampaigns = async () =>
    setCampaigns(await WaCampaignsService.syncStatuses(await WaCampaignsService.listCampaigns()));

  const load = async () => {
    try {
      const [cs, ss, sg, tp, ct, oo] = await Promise.all([
        WaCampaignsService.listCampaigns().then(l => WaCampaignsService.syncStatuses(l)),
        WhatsappService.listSessions(),
        WaContactsService.listSegments(),
        WaCampaignsService.listTemplates(),
        WaContactsService.list(),
        WaContactsService.listOptOuts(),
      ]);
      setCampaigns(cs); setSessions(ss); setSegments(sg); setTemplates(tp);
      setContacts(ct); setOptedOut(new Set(oo.map(o => o.phone)));
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isAdmin && !isSuperAdmin) return <div className="text-center py-12 text-muted-foreground">Accès réservé aux administrateurs.</div>;
  if (loading) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>;

  return (
    <div className="max-w-5xl mx-auto py-6 px-3">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10"><Megaphone className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">Campagnes WhatsApp</h1>
            <p className="text-xs text-muted-foreground">Diffusion segmentée · envois espacés et sécurisés par le runner</p>
          </div>
        </div>
        <button onClick={() => setEditing({ name: '', body: '', media_url: null, cta_label: null, cta_url: null, segment_filter: {}, session_id: sessions[0]?.id ?? null, scheduled_at: null })}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
          <Plus className="h-4 w-4" /> Nouvelle campagne
        </button>
      </div>

      {sessions.length === 0 && (
        <div className="mb-4 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-sm text-amber-700 dark:text-amber-400">
          Aucune session WhatsApp. Configurez d'abord le Centre de connexion.
        </div>
      )}

      {campaigns.length === 0 ? (
        <div className="bg-card border border-border/60 rounded-lg py-16 text-center text-muted-foreground text-sm">
          Aucune campagne pour l'instant.
        </div>
      ) : (
        <div className="space-y-2">
          {campaigns.map(c => {
            const st = STATUS[c.status] || STATUS.draft;
            return (
              <button key={c.id} onClick={() => setDetail(c)}
                className="w-full text-left bg-card border border-border/60 rounded-lg p-3 hover:border-primary/40 transition-colors flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground truncate">{c.name}</h3>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${st.cls}`}>{st.txt}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{c.body || '— média seul —'}</p>
                </div>
                <div className="text-right shrink-0">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground justify-end"><Users className="h-3.5 w-3.5" />{c.total_recipients || 0}</div>
                  {c.scheduled_at && <div className="flex items-center gap-1 text-[10px] text-muted-foreground justify-end mt-0.5"><Clock className="h-3 w-3" />{new Date(c.scheduled_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</div>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {editing && (
        <Editor
          draft={editing} sessions={sessions} segments={segments} templates={templates}
          contacts={contacts} optedOut={optedOut} currentUser={currentUser?.username || null}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); loadCampaigns(); }}
        />
      )}

      {detail && (
        <Detail
          campaign={detail} currentUser={currentUser?.username || null}
          onClose={() => { setDetail(null); loadCampaigns(); }}
          onEdit={c => { setDetail(null); setEditing(c); }}
          onChanged={loadCampaigns}
        />
      )}
    </div>
  );
}

// ── Editor ────────────────────────────────────────────────────────────────
function Editor({ draft, sessions, segments, templates, contacts, optedOut, currentUser, onClose, onSaved }: {
  draft: Partial<WaCampaign>; sessions: WaSession[]; segments: WaSegment[]; templates: WaTemplate[];
  contacts: WaContact[]; optedOut: Set<string>; currentUser: string | null;
  onClose: () => void; onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [c, setC] = useState<Partial<WaCampaign>>(draft);
  const [segId, setSegId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testing, setTesting] = useState(false);

  // behavior filters need engagement sets — fetched once if the segment uses one
  const [eng, setEng] = useState<EngagementCtx | null>(null);
  useEffect(() => {
    if (c.segment_filter?.behavior && !eng) WaContactsService.engagement().then(setEng).catch(() => {});
  }, [c.segment_filter?.behavior, eng]);

  const audience = useMemo(
    () => contacts.filter(ct => !optedOut.has(ct.phone) && ct.wa_status !== 'invalid' && matchSegment(ct, c.segment_filter || {}, eng || undefined)),
    [contacts, optedOut, c.segment_filter, eng]
  );
  const preview = useMemo(
    () => renderMessage(c.body || '', SAMPLE, { label: c.cta_label, url: c.cta_url }),
    [c.body, c.cta_label, c.cta_url]
  );

  const applyTemplate = (id: string) => {
    const t = templates.find(x => x.id === id);
    if (!t) return;
    setC(v => ({ ...v, body: t.body, media_url: t.media_url, cta_label: t.cta_label, cta_url: t.cta_url }));
  };
  const applySegment = (id: string) => {
    setSegId(id);
    const s = segments.find(x => x.id === id);
    setC(v => ({ ...v, segment_filter: s ? s.filter : {} }));
  };

  const upload = async (f: File) => {
    setUploading(true);
    try { const url = await WaCampaignsService.uploadMedia(f); setC(v => ({ ...v, media_url: url })); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setUploading(false); }
  };

  const persist = async (): Promise<WaCampaign> => {
    if (!c.name?.trim()) throw new Error('Nom requis');
    if (!c.body?.trim() && !c.media_url) throw new Error('Message ou média requis');
    if (!c.session_id) throw new Error('Choisissez une session WhatsApp');
    return WaCampaignsService.saveCampaign(c as any);
  };

  const save = async () => {
    setSaving(true);
    try { await persist(); showToast({ type: 'success', message: 'Campagne enregistrée' }); onSaved(); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setSaving(false); }
  };

  const sendTest = async () => {
    if (!c.session_id) { showToast({ type: 'error', message: 'Choisissez une session' }); return; }
    setTesting(true);
    try {
      const body = renderMessage(c.body || '', { name: 'Test', phone: testPhone }, { label: c.cta_label, url: c.cta_url });
      await WhatsappService.sendTest(c.session_id, testPhone, body || '(média)', currentUser);
      showToast({ type: 'success', message: 'Test mis en file' });
      setTestPhone('');
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setTesting(false); }
  };

  const launch = async () => {
    const isScheduled = c.scheduled_at && new Date(c.scheduled_at) > new Date();
    if (!window.confirm(isScheduled
      ? `Planifier l'envoi à ${audience.length} contact(s) ?`
      : `Lancer maintenant vers ${audience.length} contact(s) ? Le runner enverra les messages de façon espacée.`)) return;
    setLaunching(true);
    try {
      const saved = await persist();
      const res = await WaCampaignsService.launch(saved.id, currentUser);
      showToast({ type: 'success', title: isScheduled ? 'Planifiée' : 'Lancée', message: `${res.enqueued} message(s) en file${res.skipped ? `, ${res.skipped} déjà envoyé(s)` : ''}` });
      onSaved();
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setLaunching(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start sm:items-center justify-center p-3 overflow-y-auto" onMouseDown={onClose}>
      <div className="bg-card border border-border rounded-xl w-full max-w-3xl my-4" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
          <h2 className="text-sm font-semibold text-foreground">{c.id ? 'Modifier la campagne' : 'Nouvelle campagne'}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>

        <div className="grid md:grid-cols-2 gap-4 p-4">
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">Nom</label>
              <input value={c.name || ''} onChange={e => setC({ ...c, name: e.target.value })}
                placeholder="Promo rentrée septembre" className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-muted-foreground mb-1">Session</label>
                <select value={c.session_id || ''} onChange={e => setC({ ...c, session_id: e.target.value || null })}
                  className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border">
                  <option value="">— choisir —</option>
                  {sessions.map(s => <option key={s.id} value={s.id}>{s.label} {s.phone_number ? `(${s.phone_number})` : ''}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-muted-foreground mb-1 flex items-center gap-1"><FileText className="h-3 w-3" /> Depuis un modèle</label>
                <select value="" onChange={e => e.target.value && applyTemplate(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border">
                  <option value="">— aucun —</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">Message ({'{{name}}'}, {'{{phone}}'}…)</label>
              <textarea value={c.body || ''} onChange={e => setC({ ...c, body: e.target.value })} rows={5}
                placeholder={'Bonjour {{name}} 👋'} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border resize-none font-mono" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-muted-foreground mb-1">Bouton (CTA)</label>
                <input value={c.cta_label || ''} onChange={e => setC({ ...c, cta_label: e.target.value || null })}
                  placeholder="Voir l'offre" className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" />
              </div>
              <div>
                <label className="block text-[11px] text-muted-foreground mb-1">Lien (CTA)</label>
                <input value={c.cta_url || ''} onChange={e => setC({ ...c, cta_url: e.target.value || null })}
                  placeholder="https://…" className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" />
              </div>
            </div>
            {c.cta_url && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={!!c.track_clicks} onChange={e => setC({ ...c, track_clicks: e.target.checked })}
                  className="accent-[hsl(var(--primary))]" />
                Compter les clics sur le lien
                <span className="text-[10px]">(nécessite la fonction wa-link déployée — le lien passe par un redirecteur)</span>
              </label>
            )}

            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">Média (image)</label>
              {c.media_url ? (
                <div className="relative inline-block">
                  <img src={c.media_url} alt="" className="h-20 rounded border border-border" />
                  <button onClick={() => setC({ ...c, media_url: null })} className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full p-0.5"><X className="h-3 w-3" /></button>
                </div>
              ) : (
                <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary border border-dashed border-border text-sm cursor-pointer w-fit">
                  {uploading ? <Loader className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />} Téléverser
                  <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); }} />
                </label>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">Audience</label>
              <select value={segId} onChange={e => applySegment(e.target.value)}
                className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border">
                <option value="">Tous les contacts joignables</option>
                {segments.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <div className="mt-2 flex items-center gap-2 text-sm bg-primary/5 border border-primary/20 rounded-lg px-3 py-2">
                <Users className="h-4 w-4 text-primary" />
                <b className="text-foreground">{audience.length}</b>
                <span className="text-muted-foreground">contact(s) joignable(s) (désinscrits exclus)</span>
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-muted-foreground mb-1 flex items-center gap-1"><Clock className="h-3 w-3" /> Planifier (optionnel)</label>
              <input type="datetime-local"
                value={c.scheduled_at ? toLocalInput(c.scheduled_at) : ''}
                onChange={e => setC({ ...c, scheduled_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
                className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" />
            </div>

            <div>
              <label className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1"><Eye className="h-3 w-3" /> Aperçu</label>
              <div className="rounded-xl bg-[#e5ddd5] dark:bg-[#0b141a] p-3 min-h-[120px]">
                <div className="ml-auto max-w-[90%] bg-[#dcf8c6] dark:bg-[#005c4b] rounded-lg px-2.5 py-1.5 shadow-sm">
                  {c.media_url && <img src={c.media_url} alt="" className="w-full rounded mb-1.5" />}
                  <p className="text-[13px] text-[#111] dark:text-white whitespace-pre-wrap break-words">{preview || <span className="italic opacity-60">…</span>}</p>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">Envoi de test</label>
              <div className="flex gap-2">
                <input value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="0612345678"
                  className="flex-1 px-2 py-1.5 text-sm rounded bg-secondary border border-border" />
                <button onClick={sendTest} disabled={testing || !testPhone.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary border border-border text-sm disabled:opacity-50">
                  {testing ? <Loader className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Test
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border/60">
          <button onClick={save} disabled={saving} className="px-3 py-1.5 rounded-lg bg-secondary border border-border text-sm disabled:opacity-50">
            {saving ? 'Enregistrement…' : 'Enregistrer le brouillon'}
          </button>
          <button onClick={launch} disabled={launching || audience.length === 0}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
            {launching ? <Loader className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {c.scheduled_at && new Date(c.scheduled_at) > new Date() ? 'Planifier' : 'Lancer maintenant'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Detail (live stats + controls) ──────────────────────────────────────────
function Detail({ campaign, currentUser, onClose, onEdit, onChanged }: {
  campaign: WaCampaign; currentUser: string | null;
  onClose: () => void; onEdit: (c: WaCampaign) => void; onChanged: () => void;
}) {
  const { showToast } = useToast();
  const [c, setC] = useState<WaCampaign>(campaign);
  const [stats, setStats] = useState<CampaignStats | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number | null>(null);

  const refresh = async () => {
    try {
      const [fresh, s] = await Promise.all([WaCampaignsService.getCampaign(c.id), WaCampaignsService.stats(c.id)]);
      if (fresh) setC((await WaCampaignsService.syncStatuses([fresh]))[0]);
      setStats(s);
    } catch { /* ignore transient */ }
  };
  useEffect(() => { refresh(); pollRef.current = window.setInterval(refresh, 5000); return () => { if (pollRef.current) window.clearInterval(pollRef.current); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<any>, msg: string) => {
    setBusy(true);
    try { await fn(); showToast({ type: 'success', message: msg }); await refresh(); onChanged(); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm(`Supprimer la campagne « ${c.name} » ? Les messages en file seront annulés.`)) return;
    await act(() => WaCampaignsService.deleteCampaign(c.id), 'Campagne supprimée');
    onClose();
  };

  const st = STATUS[c.status] || STATUS.draft;
  const canLaunch = c.status === 'draft' || c.status === 'paused' || c.status === 'scheduled';
  const canPause = c.status === 'running' || c.status === 'scheduled';
  const done = stats ? stats.sent + stats.failed + stats.blocked : 0;
  const pct = stats && stats.total ? Math.round((done / stats.total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start sm:items-center justify-center p-3 overflow-y-auto" onMouseDown={onClose}>
      <div className="bg-card border border-border rounded-xl w-full max-w-lg my-4" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-sm font-semibold text-foreground truncate">{c.name}</h2>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${st.cls}`}>{st.txt}</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={refresh} className="p-1 rounded hover:bg-secondary text-muted-foreground" title="Rafraîchir"><RefreshCw className="h-4 w-4" /></button>
            <button onClick={onClose} className="p-1 rounded hover:bg-secondary"><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {c.body && <p className="text-sm text-muted-foreground whitespace-pre-wrap bg-secondary/50 rounded-lg p-3">{c.body}</p>}

          {/* progress */}
          {stats && stats.total > 0 && (
            <div>
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span>{done} / {stats.total} traités</span><span>{pct}%</span>
              </div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>
            </div>
          )}

          {/* stat grid */}
          <div className="grid grid-cols-3 gap-2">
            <Stat label="En file" value={stats?.queued} icon={<Clock className="h-3.5 w-3.5" />} />
            <Stat label="Envoyés" value={stats?.sent} icon={<Check className="h-3.5 w-3.5" />} />
            <Stat label="Distribués" value={stats?.delivered} icon={<CheckCheck className="h-3.5 w-3.5" />} />
            <Stat label="Lus" value={stats?.read} icon={<CheckCheck className="h-3.5 w-3.5 text-blue-500" />} />
            <Stat label="Échecs" value={stats?.failed} tone="red" />
            <Stat label="Bloqués" value={stats?.blocked} tone="amber" />
            {stats?.clicks != null && <Stat label="Clics" value={stats.clicks} icon={<MousePointerClick className="h-3.5 w-3.5" />} />}
          </div>

          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" /> {c.total_recipients || 0} destinataire(s)
            {c.scheduled_at && <span className="ml-2 flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(c.scheduled_at).toLocaleString('fr-FR')}</span>}
          </div>

          {/* actions */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {canLaunch && (
              <button onClick={() => act(() => WaCampaignsService.launch(c.id, currentUser).then(r =>
                showToast({ type: 'success', message: `${r.enqueued} en file${r.skipped ? `, ${r.skipped} déjà envoyé(s)` : ''}` })), c.status === 'paused' ? 'Reprise' : 'Lancée')}
                disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
                <Play className="h-4 w-4" /> {c.status === 'paused' ? 'Reprendre' : c.status === 'scheduled' ? 'Lancer maintenant' : 'Lancer'}
              </button>
            )}
            {canPause && (
              <button onClick={() => act(() => WaCampaignsService.pause(c.id), 'En pause')} disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 text-sm disabled:opacity-50">
                <Pause className="h-4 w-4" /> Pause
              </button>
            )}
            {(c.status === 'running' || c.status === 'paused' || c.status === 'scheduled') && (
              <button onClick={() => act(() => WaCampaignsService.cancel(c.id), 'Annulée')} disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary border border-border text-sm disabled:opacity-50">
                <StopCircle className="h-4 w-4" /> Annuler
              </button>
            )}
            {(c.status === 'draft' || c.status === 'cancelled') && (
              <button onClick={() => onEdit(c)} className="px-3 py-1.5 rounded-lg bg-secondary border border-border text-sm">Modifier</button>
            )}
            <button onClick={remove} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-500/10 text-sm ml-auto disabled:opacity-50">
              <Trash2 className="h-4 w-4" /> Supprimer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, icon, tone }: { label: string; value?: number; icon?: React.ReactNode; tone?: 'red' | 'amber' }) {
  const cls = tone === 'red' ? 'text-red-600 dark:text-red-400' : tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : 'text-foreground';
  return (
    <div className="bg-secondary/50 rounded-lg px-2 py-1.5 text-center">
      <div className={`text-base font-bold ${cls}`}>{value ?? '—'}</div>
      <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5">{icon}{label}</div>
    </div>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}
