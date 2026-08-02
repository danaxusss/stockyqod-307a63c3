import React, { useEffect, useMemo, useState } from 'react';
import {
  FileText, Plus, Loader, Trash2, Save, X, Image as ImageIcon,
  Link2, Eye, Variable, Send,
} from 'lucide-react';
import { WaCampaignsService, renderMessage, extractVars, type WaTemplate } from '../../utils/supabaseWaCampaigns';
import { WhatsappService } from '../../utils/supabaseWhatsapp';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

const SAMPLE = { name: 'Ahmed', phone: '+212612345678', custom: { ville: 'Casablanca', société: 'CUISIMAT' } };
const VAR_CHIPS = ['{{name}}', '{{phone}}', '{{ville}}'];

export default function StudioPage() {
  const { isAdmin, isSuperAdmin, currentUser } = useAuth();
  const { showToast } = useToast();

  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<WaTemplate> | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [testPhone, setTestPhone] = useState(() => localStorage.getItem('wa_test_phone') || '');
  const [testing, setTesting] = useState(false);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);

  const load = async () => {
    try { setTemplates(await WaCampaignsService.listTemplates()); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const preview = useMemo(
    () => editing ? renderMessage(editing.body || '', SAMPLE, { label: editing.cta_label, url: editing.cta_url }) : '',
    [editing]
  );
  const vars = useMemo(() => editing ? extractVars(editing.body || '') : [], [editing]);

  const insertVar = (chip: string) => {
    const ta = bodyRef.current;
    const cur = editing?.body || '';
    if (!ta) { setEditing(e => ({ ...e!, body: cur + chip })); return; }
    const start = ta.selectionStart, end = ta.selectionEnd;
    const next = cur.slice(0, start) + chip + cur.slice(end);
    setEditing(e => ({ ...e!, body: next }));
    requestAnimationFrame(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = start + chip.length; });
  };

  const upload = async (f: File) => {
    setUploading(true);
    try { const url = await WaCampaignsService.uploadMedia(f); setEditing(e => ({ ...e!, media_url: url })); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec du téléversement' }); }
    finally { setUploading(false); }
  };

  const save = async () => {
    if (!editing?.name?.trim()) { showToast({ type: 'error', message: 'Nom requis' }); return; }
    if (!editing.body?.trim() && !editing.media_url) { showToast({ type: 'error', message: 'Message ou média requis' }); return; }
    setSaving(true);
    try {
      await WaCampaignsService.saveTemplate(editing as any);
      showToast({ type: 'success', message: 'Modèle enregistré' });
      setEditing(null);
      load();
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setSaving(false); }
  };

  const sendTest = async () => {
    if (!editing) return;
    if (!testPhone.trim()) { showToast({ type: 'error', message: 'Entrez votre numéro pour recevoir le test' }); return; }
    setTesting(true);
    try {
      const session = await WhatsappService.ensureSession();
      const body = renderMessage(editing.body || '', SAMPLE, { label: editing.cta_label, url: editing.cta_url });
      await WhatsappService.sendTest(session.id, testPhone, body, currentUser?.username || null, editing.media_url || null);
      localStorage.setItem('wa_test_phone', testPhone);
      showToast({ type: 'success', message: 'Test en file — vous le recevrez dans quelques secondes' });
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec du test' }); }
    finally { setTesting(false); }
  };

  const remove = async (t: WaTemplate) => {
    if (!window.confirm(`Supprimer le modèle « ${t.name} » ?`)) return;
    try { await WaCampaignsService.deleteTemplate(t.id); load(); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
  };

  if (!isAdmin && !isSuperAdmin) return <div className="text-center py-12 text-muted-foreground">Accès réservé aux administrateurs.</div>;
  if (loading) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>;

  return (
    <div className="max-w-5xl mx-auto py-6 px-3">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10"><FileText className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">Studio de contenu</h1>
            <p className="text-xs text-muted-foreground">Modèles de message réutilisables · variables · média · lien d'action</p>
          </div>
        </div>
        <button onClick={() => setEditing({ name: '', body: '', media_url: null, cta_label: null, cta_url: null })}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
          <Plus className="h-4 w-4" /> Nouveau modèle
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="bg-card border border-border/60 rounded-lg py-16 text-center text-muted-foreground text-sm">
          Aucun modèle. Créez-en un pour l'utiliser dans vos campagnes.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {templates.map(t => (
            <div key={t.id} className="bg-card border border-border/60 rounded-lg p-3 flex flex-col">
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <h3 className="text-sm font-semibold text-foreground truncate">{t.name}</h3>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => setEditing(t)} className="p-1 rounded hover:bg-secondary text-muted-foreground" title="Modifier"><Save className="h-3.5 w-3.5" /></button>
                  <button onClick={() => remove(t)} className="p-1 rounded hover:bg-secondary text-red-600 dark:text-red-400" title="Supprimer"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
              {t.media_url && <img src={t.media_url} alt="" className="w-full h-24 object-cover rounded mb-1.5 border border-border/60" />}
              <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4 flex-1">{t.body || <span className="italic">— média seul —</span>}</p>
              {t.cta_url && <div className="mt-1.5 flex items-center gap-1 text-[11px] text-primary truncate"><Link2 className="h-3 w-3 shrink-0" />{t.cta_label || t.cta_url}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Editor modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start sm:items-center justify-center p-3 overflow-y-auto" onMouseDown={() => setEditing(null)}>
          <div className="bg-card border border-border rounded-xl w-full max-w-3xl my-4" onMouseDown={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
              <h2 className="text-sm font-semibold text-foreground">{editing.id ? 'Modifier le modèle' : 'Nouveau modèle'}</h2>
              <button onClick={() => setEditing(null)} className="p-1 rounded hover:bg-secondary"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid md:grid-cols-2 gap-4 p-4">
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] text-muted-foreground mb-1">Nom du modèle</label>
                  <input value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })}
                    placeholder="Promo rentrée" className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] text-muted-foreground">Message</label>
                    <div className="flex items-center gap-1">
                      {VAR_CHIPS.map(c => (
                        <button key={c} onClick={() => insertVar(c)} className="px-1.5 py-0.5 rounded bg-secondary border border-border text-[10px] font-mono hover:bg-primary/10">{c}</button>
                      ))}
                    </div>
                  </div>
                  <textarea ref={bodyRef} value={editing.body || ''} onChange={e => setEditing({ ...editing, body: e.target.value })}
                    rows={7} placeholder={'Bonjour {{name}} 👋\nDécouvrez notre nouvelle offre…'}
                    className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border resize-none font-mono" />
                  {vars.length > 0 && (
                    <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1 flex-wrap">
                      <Variable className="h-3 w-3" /> Variables : {vars.map(v => <code key={v} className="px-1 rounded bg-secondary">{v}</code>)}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-1">Texte du bouton (CTA)</label>
                    <input value={editing.cta_label || ''} onChange={e => setEditing({ ...editing, cta_label: e.target.value || null })}
                      placeholder="Voir l'offre" className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-1">Lien (CTA)</label>
                    <input value={editing.cta_url || ''} onChange={e => setEditing({ ...editing, cta_url: e.target.value || null })}
                      placeholder="https://…" className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] text-muted-foreground mb-1">Média (image)</label>
                  {editing.media_url ? (
                    <div className="relative inline-block">
                      <img src={editing.media_url} alt="" className="h-24 rounded border border-border" />
                      <button onClick={() => setEditing({ ...editing, media_url: null })}
                        className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full p-0.5"><X className="h-3 w-3" /></button>
                    </div>
                  ) : (
                    <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary border border-dashed border-border text-sm cursor-pointer w-fit">
                      {uploading ? <Loader className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />} Téléverser
                      <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); }} />
                    </label>
                  )}
                </div>
              </div>

              {/* Preview */}
              <div>
                <label className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1"><Eye className="h-3 w-3" /> Aperçu (contact exemple : Ahmed)</label>
                <div className="rounded-xl bg-[#e5ddd5] dark:bg-[#0b141a] p-3 min-h-[220px]">
                  <div className="ml-auto max-w-[85%] bg-[#dcf8c6] dark:bg-[#005c4b] rounded-lg px-2.5 py-1.5 shadow-sm">
                    {editing.media_url && <img src={editing.media_url} alt="" className="w-full rounded mb-1.5" />}
                    <p className="text-[13px] text-[#111] dark:text-white whitespace-pre-wrap break-words">{preview || <span className="italic opacity-60">…</span>}</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 px-4 py-3 border-t border-border/60 flex-wrap">
              <div className="flex items-center gap-1.5 mr-auto">
                <input value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="Votre numéro"
                  className="w-36 px-2 py-1.5 text-sm rounded bg-secondary border border-border" />
                <button onClick={sendTest} disabled={testing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary border border-border text-sm disabled:opacity-50"
                  title="Recevoir ce message sur votre WhatsApp, variables remplies avec le contact exemple">
                  {testing ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} M'envoyer un test
                </button>
              </div>
              <button onClick={() => setEditing(null)} className="px-3 py-1.5 rounded-lg bg-secondary border border-border text-sm">Annuler</button>
              <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
                {saving ? <Loader className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
