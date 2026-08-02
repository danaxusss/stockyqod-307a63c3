import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3, Loader, Check, CheckCheck, Inbox, UserX, AlertTriangle,
  Send, MousePointerClick, RefreshCw,
} from 'lucide-react';
import { supabase } from '../../utils/supabaseClient';
import { getCompanyContext } from '../../utils/supabaseCompanyFilter';
import { WaCampaignsService, type WaCampaign } from '../../utils/supabaseWaCampaigns';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

interface OutRow { status: string; ack: number; sent_at: string | null; created_at: string; campaign_id: string | null }

const DAYS = 30;

export default function AnalyticsPage() {
  const { isAdmin, isSuperAdmin } = useAuth();
  const { showToast } = useToast();

  const [rows, setRows] = useState<OutRow[]>([]);
  const [campaigns, setCampaigns] = useState<WaCampaign[]>([]);
  const [optOuts30, setOptOuts30] = useState(0);
  const [replies30, setReplies30] = useState(0);
  const [clicksByCampaign, setClicksByCampaign] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { companyId } = getCompanyContext();
      const since = new Date(Date.now() - DAYS * 86400_000).toISOString();

      const [outRes, camps, ooRes, inbRes, linksRes] = await Promise.all([
        (supabase as any).from('wa_outbox')
          .select('status, ack, sent_at, created_at, campaign_id')
          .eq('company_id', companyId).gte('created_at', since).limit(10000),
        WaCampaignsService.listCampaigns(),
        (supabase as any).from('wa_opt_outs')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', companyId).gte('created_at', since),
        (supabase as any).from('wa_events')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', companyId).eq('type', 'inbound').gte('created_at', since),
        (supabase as any).from('wa_links')
          .select('id, campaign_id').eq('company_id', companyId),
      ]);

      setRows((outRes.data || []) as OutRow[]);
      setCampaigns(camps);
      setOptOuts30(ooRes.count || 0);
      setReplies30(inbRes.count || 0);

      const links = (linksRes.data || []) as { id: string; campaign_id: string | null }[];
      if (links.length) {
        const { data: clicks } = await (supabase as any).from('wa_link_clicks')
          .select('link_id').in('link_id', links.map(l => l.id)).limit(10000);
        const byLink = new Map<string, number>();
        for (const c of (clicks || [])) byLink.set(c.link_id, (byLink.get(c.link_id) || 0) + 1);
        const byCampaign = new Map<string, number>();
        for (const l of links) if (l.campaign_id) byCampaign.set(l.campaign_id, (byCampaign.get(l.campaign_id) || 0) + (byLink.get(l.id) || 0));
        setClicksByCampaign(byCampaign);
      } else setClicksByCampaign(new Map());
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const kpi = useMemo(() => {
    const sent = rows.filter(r => r.status === 'sent');
    const delivered = sent.filter(r => r.ack >= 2).length;
    const read = sent.filter(r => r.ack >= 3).length;
    const failed = rows.filter(r => r.status === 'failed').length;
    return {
      sent: sent.length,
      deliveredPct: sent.length ? Math.round((delivered / sent.length) * 100) : 0,
      readPct: sent.length ? Math.round((read / sent.length) * 100) : 0,
      failed,
    };
  }, [rows]);

  // sends per day, most recent 14 days
  const perDay = useMemo(() => {
    const days: { label: string; count: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      const next = new Date(d); next.setDate(next.getDate() + 1);
      const count = rows.filter(r => r.sent_at && new Date(r.sent_at) >= d && new Date(r.sent_at) < next).length;
      days.push({ label: d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }), count });
    }
    return days;
  }, [rows]);
  const maxDay = Math.max(1, ...perDay.map(d => d.count));

  // per-campaign performance (only campaigns that actually sent something)
  const perCampaign = useMemo(() => {
    const byId = new Map<string, { sent: number; delivered: number; read: number; failed: number }>();
    for (const r of rows) {
      if (!r.campaign_id) continue;
      const a = byId.get(r.campaign_id) || { sent: 0, delivered: 0, read: 0, failed: 0 };
      if (r.status === 'sent') { a.sent++; if (r.ack >= 2) a.delivered++; if (r.ack >= 3) a.read++; }
      else if (r.status === 'failed') a.failed++;
      byId.set(r.campaign_id, a);
    }
    return campaigns
      .filter(c => byId.has(c.id))
      .map(c => ({ c, ...byId.get(c.id)!, clicks: clicksByCampaign.get(c.id) }))
      .sort((a, b) => new Date(b.c.created_at).getTime() - new Date(a.c.created_at).getTime());
  }, [rows, campaigns, clicksByCampaign]);

  if (!isAdmin && !isSuperAdmin) return <div className="text-center py-12 text-muted-foreground">Accès réservé aux administrateurs.</div>;
  if (loading) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>;

  const pct = (n: number, d: number) => d ? `${Math.round((n / d) * 100)}%` : '—';

  return (
    <div className="max-w-5xl mx-auto py-6 px-3">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10"><BarChart3 className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">WhatsApp — Analyse</h1>
            <p className="text-xs text-muted-foreground">Performance des {DAYS} derniers jours</p>
          </div>
        </div>
        <button onClick={load} className="p-2 rounded-lg bg-secondary border border-border" title="Actualiser"><RefreshCw className="h-4 w-4" /></button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
        <Kpi icon={<Send className="h-3.5 w-3.5" />} label="Envoyés" value={String(kpi.sent)} />
        <Kpi icon={<CheckCheck className="h-3.5 w-3.5" />} label="Taux de distribution" value={`${kpi.deliveredPct}%`}
          warn={kpi.sent > 10 && kpi.deliveredPct < 70 ? 'Bas — vérifiez la qualité de la liste' : undefined} />
        <Kpi icon={<CheckCheck className="h-3.5 w-3.5 text-blue-500" />} label="Taux de lecture" value={`${kpi.readPct}%`} />
        <Kpi icon={<Inbox className="h-3.5 w-3.5" />} label="Réponses" value={String(replies30)} />
        <Kpi icon={<UserX className="h-3.5 w-3.5" />} label="Désinscriptions" value={String(optOuts30)}
          warn={kpi.sent > 20 && optOuts30 / Math.max(kpi.sent, 1) > 0.02 ? 'Élevé — risque pour le numéro' : undefined} />
        <Kpi icon={<AlertTriangle className="h-3.5 w-3.5" />} label="Échecs" value={String(kpi.failed)} />
      </div>

      {/* sends per day */}
      <div className="bg-card border border-border/60 rounded-lg p-3 mb-4">
        <div className="text-xs font-semibold text-foreground mb-2">Envois par jour (14 derniers jours)</div>
        <div className="flex items-end gap-1" style={{ height: 72 }}>
          {perDay.map((d, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${d.label} : ${d.count} envoi(s)`}>
              <span className="text-[9px] text-muted-foreground leading-none">{d.count || ''}</span>
              <div className="w-full rounded-t bg-primary/70" style={{ height: `${Math.round((d.count / maxDay) * 48) + (d.count ? 4 : 1)}px` }} />
              <span className="text-[8px] text-muted-foreground leading-none truncate w-full text-center">{i % 2 === 0 ? d.label : ''}</span>
            </div>
          ))}
        </div>
      </div>

      {/* per campaign */}
      <div className="bg-card border border-border/60 rounded-lg overflow-hidden">
        <div className="px-3 py-2 bg-secondary/50 border-b border-border/60 text-sm font-semibold">Performance par campagne</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary/30 text-xs text-muted-foreground border-b border-border/60">
                <th className="text-left font-medium px-3 py-2">Campagne</th>
                <th className="text-right font-medium px-3 py-2"><Check className="h-3.5 w-3.5 inline" /> Envoyés</th>
                <th className="text-right font-medium px-3 py-2">Distribués</th>
                <th className="text-right font-medium px-3 py-2">Lus</th>
                <th className="text-right font-medium px-3 py-2"><MousePointerClick className="h-3.5 w-3.5 inline" /> Clics</th>
                <th className="text-right font-medium px-3 py-2">Échecs</th>
              </tr>
            </thead>
            <tbody>
              {perCampaign.map(({ c, sent, delivered, read, failed, clicks }) => (
                <tr key={c.id} className="border-b border-border/40">
                  <td className="px-3 py-1.5">
                    <div className="font-medium text-foreground truncate max-w-[220px]">{c.name}</div>
                    <div className="text-[10px] text-muted-foreground">{new Date(c.created_at).toLocaleDateString('fr-FR')}</div>
                  </td>
                  <td className="px-3 py-1.5 text-right">{sent}</td>
                  <td className="px-3 py-1.5 text-right">{delivered} <span className="text-[10px] text-muted-foreground">({pct(delivered, sent)})</span></td>
                  <td className="px-3 py-1.5 text-right">{read} <span className="text-[10px] text-muted-foreground">({pct(read, sent)})</span></td>
                  <td className="px-3 py-1.5 text-right">{clicks == null ? <span className="text-muted-foreground">—</span> : clicks}</td>
                  <td className={`px-3 py-1.5 text-right ${failed ? 'text-red-600 dark:text-red-400' : ''}`}>{failed}</td>
                </tr>
              ))}
              {perCampaign.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground text-sm">Aucune campagne envoyée sur les {DAYS} derniers jours.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground mt-3">
        « Lus » dépend des confirmations de lecture des destinataires — un taux réel toujours un peu plus haut que l'affiché.
        Les taux se mettent à jour au fil des accusés de réception remontés par le runner.
      </p>
    </div>
  );
}

function Kpi({ icon, label, value, warn }: { icon: React.ReactNode; label: string; value: string; warn?: string }) {
  return (
    <div className={`bg-card border rounded-lg px-3 py-2 ${warn ? 'border-amber-500/40' : 'border-border/60'}`}>
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">{icon} {label}</div>
      <div className="text-base font-bold text-foreground">{value}</div>
      {warn && <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">{warn}</p>}
    </div>
  );
}
