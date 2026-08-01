import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  MessageCircle, Loader, RefreshCw, Power, PauseCircle, PlayCircle, QrCode,
  Send, Wifi, WifiOff, Settings2, Copy, ShieldAlert, CheckCheck, Check,
} from 'lucide-react';
import { WhatsappService, runnerOnline, type WaSession, type WaOutbox } from '../../utils/supabaseWhatsapp';
import { getCompanyContext } from '../../utils/supabaseCompanyFilter';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

const ackLabel = (a: number) => a >= 3 ? 'Lu' : a === 2 ? 'Distribué' : a === 1 ? 'Envoyé' : '';

export default function ConnectionCenterPage() {
  const { isAdmin, isSuperAdmin, currentUser } = useAuth();
  const { showToast } = useToast();

  const [session, setSession] = useState<WaSession | null>(null);
  const [outbox, setOutbox] = useState<WaOutbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testBody, setTestBody] = useState('Bonjour 👋 ceci est un test depuis Stocky.');
  const [sending, setSending] = useState(false);
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async (initial = false) => {
    try {
      const s = initial ? await WhatsappService.ensureSession() : (session ? await WhatsappService.getSession(session.id) : await WhatsappService.ensureSession());
      if (s) {
        setSession(s);
        setOutbox(await WhatsappService.recentOutbox(s.id));
      }
    } catch (e: any) {
      if (initial) showToast({ type: 'error', message: e?.message || 'Erreur' });
    } finally { if (initial) setLoading(false); }
  }, [session, showToast]);

  useEffect(() => { load(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // live polling (QR + status + acks)
  useEffect(() => {
    pollRef.current = window.setInterval(() => load(false), 4000);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [load]);

  const online = session ? runnerOnline(session) : false;
  const status = session?.status || 'disconnected';
  const { companyId } = getCompanyContext();

  const patchSession = async (patch: Partial<WaSession>) => {
    if (!session) return;
    setSession({ ...session, ...patch });
    try { await WhatsappService.updateSession(session.id, patch); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); load(false); }
  };

  const relink = async () => {
    if (!session) return;
    if (!window.confirm('Redemander le QR ? La session actuelle sera déliée au prochain scan.')) return;
    await WhatsappService.requestRelink(session.id);
    showToast({ type: 'info', message: 'Un nouveau QR apparaîtra une fois le runner prêt' });
    load(false);
  };

  const sendTest = async () => {
    if (!session) return;
    setSending(true);
    try {
      await WhatsappService.sendTest(session.id, testPhone, testBody, currentUser?.username || null);
      showToast({ type: 'success', title: 'En file d\'attente', message: 'Le runner enverra le message sous peu' });
      setTestPhone('');
      setOutbox(await WhatsappService.recentOutbox(session.id));
    } catch (e: any) {
      showToast({ type: 'error', title: 'Erreur', message: e?.message || 'Échec' });
    } finally { setSending(false); }
  };

  const copy = (t: string) => { navigator.clipboard?.writeText(t); showToast({ type: 'success', message: 'Copié' }); };

  if (!isAdmin && !isSuperAdmin) return <div className="text-center py-12 text-muted-foreground">Accès réservé aux administrateurs.</div>;
  if (loading) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>;

  const statusBadge = status === 'connected'
    ? { txt: 'Connecté', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' }
    : status === 'pairing'
      ? { txt: 'En attente de scan', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' }
      : { txt: 'Déconnecté', cls: 'bg-red-500/15 text-red-600 dark:text-red-400' };

  return (
    <div className="max-w-4xl mx-auto py-6 px-3">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10"><MessageCircle className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">WhatsApp — Centre de connexion</h1>
            <p className="text-xs text-muted-foreground">{session?.label} · {session?.phone_number || 'non lié'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${statusBadge.cls}`}>
            {status === 'connected' ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {statusBadge.txt}
          </span>
          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${online ? 'bg-secondary text-foreground' : 'bg-red-500/10 text-red-600 dark:text-red-400'}`}>
            {online ? 'Runner en ligne' : 'Runner hors ligne'}
          </span>
          <button onClick={() => setShowSettings(v => !v)} className="p-2 rounded-lg bg-secondary border border-border" title="Réglages d'envoi"><Settings2 className="h-4 w-4" /></button>
        </div>
      </div>

      {!online && (
        <div className="mb-4 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-sm text-amber-700 dark:text-amber-400 flex items-start gap-2">
          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            Le <b>runner</b> n'est pas en ligne. Lancez <code className="px-1 rounded bg-amber-500/15">DEMARRER.bat</code> (dossier
            <code className="px-1 rounded bg-amber-500/15">wa-runner</code>) sur le poste dédié. Les envois reprennent dès qu'il est actif.
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {/* Connection / QR */}
        <div className="bg-card border border-border/60 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5"><QrCode className="h-4 w-4 text-primary" /> Liaison du numéro</h2>
          {status === 'connected' ? (
            <div className="text-center py-6">
              <CheckCheck className="h-10 w-10 text-emerald-600 dark:text-emerald-400 mx-auto mb-2" />
              <p className="text-sm font-medium text-foreground">{session?.phone_number}</p>
              <p className="text-xs text-muted-foreground">lié et prêt à envoyer</p>
            </div>
          ) : session?.qr_data_url ? (
            <div className="text-center">
              <img src={session.qr_data_url} alt="QR WhatsApp" className="w-52 h-52 mx-auto rounded-lg border border-border bg-white p-2" />
              <p className="text-xs text-muted-foreground mt-2">WhatsApp → Appareils connectés → Lier un appareil, puis scannez.</p>
            </div>
          ) : (
            <div className="text-center py-8 text-sm text-muted-foreground">
              {online ? 'En attente du QR depuis le runner…' : 'Démarrez le runner pour obtenir le QR.'}
              <div className="mt-2"><Loader className="h-4 w-4 animate-spin inline text-muted-foreground" /></div>
            </div>
          )}
          <div className="flex items-center justify-center gap-2 mt-4">
            <button onClick={relink} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary border border-border text-sm"><RefreshCw className="h-3.5 w-3.5" /> Re-scanner</button>
            <button onClick={() => patchSession({ paused: !session!.paused })}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border ${session?.paused ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400' : 'bg-secondary border-border'}`}>
              {session?.paused ? <><PlayCircle className="h-3.5 w-3.5" /> Reprendre</> : <><PauseCircle className="h-3.5 w-3.5" /> Pause</>}
            </button>
          </div>
        </div>

        {/* Test send */}
        <div className="bg-card border border-border/60 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5"><Send className="h-4 w-4 text-primary" /> Envoi de test</h2>
          <label className="block text-[11px] text-muted-foreground mb-1">Numéro (ex. 0612345678)</label>
          <input value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="+212 6 12 34 56 78"
            className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border mb-2" />
          <label className="block text-[11px] text-muted-foreground mb-1">Message</label>
          <textarea value={testBody} onChange={e => setTestBody(e.target.value)} rows={3}
            className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border resize-none mb-3" />
          <button onClick={sendTest} disabled={sending || status !== 'connected'}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
            {sending ? <Loader className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {status === 'connected' ? 'Mettre en file' : 'Liez d\'abord le numéro'}
          </button>
          <p className="text-[11px] text-muted-foreground mt-2">La liste de désinscription est vérifiée avant l'envoi.</p>
        </div>
      </div>

      {/* Sending settings */}
      {showSettings && session && (
        <div className="mt-4 bg-card border border-primary/25 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-foreground mb-3">Réglages d'envoi (anti-blocage)</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <Field label="Plafond / jour" value={session.daily_cap} onChange={v => patchSession({ daily_cap: v })} />
            <Field label="Délai moyen (s)" value={session.delay_mean_sec} onChange={v => patchSession({ delay_mean_sec: v })} />
            <Field label="Variation délai (s)" value={session.delay_std_sec} onChange={v => patchSession({ delay_std_sec: v })} />
            <Field label="Heure calme début" value={session.quiet_start} onChange={v => patchSession({ quiet_start: v })} />
            <Field label="Heure calme fin" value={session.quiet_end} onChange={v => patchSession({ quiet_end: v })} />
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">
            Nouveau numéro : commencez bas (30-50/jour) et augmentez progressivement. Heures calmes = pas d'envoi dans cette plage (heure du poste runner).
          </p>
        </div>
      )}

      {/* Runner setup — session identifiers */}
      <details className="mt-4 bg-card border border-border/60 rounded-lg p-4">
        <summary className="text-sm font-semibold text-foreground cursor-pointer">Configurer le runner (poste bureau)</summary>
        <p className="text-xs text-muted-foreground mt-2">
          Copiez ces valeurs dans <code className="px-1 rounded bg-secondary">wa-runner/config.json</code> sur le poste, avec l'URL et la clé <i>service_role</i> de Supabase.
        </p>
        <div className="mt-2 space-y-1.5 text-xs font-mono">
          <IdRow label="sessionId" value={session?.id || ''} onCopy={copy} />
          <IdRow label="companyId" value={companyId || ''} onCopy={copy} />
        </div>
      </details>

      {/* Recent outbox */}
      <div className="mt-4 bg-card border border-border/60 rounded-lg overflow-hidden">
        <div className="px-3 py-2 bg-secondary/50 border-b border-border/60 text-sm font-semibold">Derniers messages</div>
        <table className="w-full text-sm">
          <tbody>
            {outbox.map(m => (
              <tr key={m.id} className="border-b border-border/40 last:border-0">
                <td className="px-3 py-2 font-mono text-xs">{m.to_phone}</td>
                <td className="px-3 py-2 text-muted-foreground truncate max-w-[260px]">{m.body}</td>
                <td className="px-3 py-2 text-right">
                  {m.status === 'sent'
                    ? <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">{m.ack >= 2 ? <CheckCheck className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}{ackLabel(m.ack) || 'Envoyé'}</span>
                    : m.status === 'failed' ? <span className="text-[11px] text-red-600 dark:text-red-400" title={m.last_error || ''}>Échec</span>
                    : m.status === 'blocked' ? <span className="text-[11px] text-amber-600 dark:text-amber-400">Bloqué (opt-out)</span>
                    : <span className="text-[11px] text-muted-foreground">En file…</span>}
                </td>
              </tr>
            ))}
            {outbox.length === 0 && <tr><td colSpan={3} className="px-3 py-8 text-center text-muted-foreground text-sm">Aucun message pour l'instant</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="block text-[11px] text-muted-foreground mb-1">{label}</label>
      <input type="number" value={value} onChange={e => onChange(Number(e.target.value))}
        className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" />
    </div>
  );
}

function IdRow({ label, value, onCopy }: { label: string; value: string; onCopy: (t: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground w-20">{label}</span>
      <code className="flex-1 px-2 py-1 rounded bg-secondary border border-border truncate">{value}</code>
      <button onClick={() => onCopy(value)} className="p-1 rounded hover:bg-secondary"><Copy className="h-3.5 w-3.5" /></button>
    </div>
  );
}
