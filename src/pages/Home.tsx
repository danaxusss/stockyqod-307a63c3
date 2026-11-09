import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Search, Plus, Receipt, Send, CircleAlert, Truck, Wrench, PackageX, ArrowRight, ChevronRight, MessageCircle,
  ShoppingBag, Users, BookMarked, BookOpen, Package, RefreshCw, type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useAccess } from '../hooks/useAccess';
import { useHomeData } from '../hooks/useHomeData';
import { useAccessibleLocations } from '../inventory/hooks/useAccessibleLocations';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { Panel } from '../components/PageHeader';
import { StockService } from '../utils/supabaseStock';
import { SupabaseDocumentsService } from '../utils/supabaseDocuments';
import { getCompanyContext } from '../utils/supabaseCompanyFilter';
import { resolveProductImageUrl } from '../utils/productImages';
import { normalizePhone } from '../utils/phone';
import { openSearch } from '../utils/searchEvents';
import { formatMoney, formatRelativeDay, daysSince } from '../utils/format';
import { DOC_LABEL, docPath, docStatus, type HomeDoc, type Tone } from '../utils/homeData';
import type { Product, ProductStockSetting } from '../types';

const TONE: Record<Tone, string> = {
  red: 'bg-red-500/10 text-red-700 ring-red-600/20 dark:text-red-300',
  amber: 'bg-amber-500/10 text-amber-800 ring-amber-600/20 dark:text-amber-300',
  blue: 'bg-blue-500/10 text-blue-700 ring-blue-600/20 dark:text-blue-300',
  green: 'bg-emerald-500/10 text-emerald-700 ring-emerald-600/20 dark:text-emerald-300',
  gray: 'bg-secondary text-foreground/80 ring-border',
};
const DOC_TONE: Record<string, string> = {
  quote: 'bg-primary/10 text-primary', invoice: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  bl: 'bg-teal-500/10 text-teal-700 dark:text-teal-300', proforma: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  avoir: 'bg-rose-500/10 text-rose-700 dark:text-rose-300', bon_commande: 'bg-amber-500/10 text-amber-800 dark:text-amber-300',
};

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONE[tone]}`}>{children}</span>;
}

function Kpi({ to, icon: Icon, tone, label, value, sub, cta, loading }: {
  to: string; icon: LucideIcon; tone: string; label: string; value: ReactNode; sub: ReactNode; cta: string; loading: boolean;
}) {
  return (
    <Link to={to} className="group flex min-w-0 flex-col rounded-xl border border-border bg-card p-3 shadow-sm transition hover:border-primary/40 hover:shadow-md sm:p-4">
      <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-muted-foreground sm:text-sm">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tone}`}><Icon className="h-4 w-4" aria-hidden="true" /></span>
        <span className="truncate">{label}</span>
      </span>
      {loading
        ? <span className="mt-3 h-7 w-24 animate-pulse rounded bg-secondary" aria-hidden="true" />
        : <span className="mt-2 truncate text-lg font-bold tabular-nums tracking-tight text-foreground sm:mt-3 sm:text-2xl">{value}</span>}
      <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground sm:text-sm">{loading ? ' ' : sub}</span>
      <span className="mt-3 hidden items-center gap-1 text-sm font-semibold text-primary sm:flex">{cta}<ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" aria-hidden="true" /></span>
    </Link>
  );
}

function SeeAll({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className="text-sm font-semibold text-primary hover:underline">{children}</Link>;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-center text-sm text-muted-foreground sm:px-5">{children}</p>;
}

function Failed() {
  return <Empty>Impossible de charger cette liste pour le moment.</Empty>;
}

function whatsappFollowUp(doc: HomeDoc): string | null {
  const phone = normalizePhone(doc.phone);
  if (!phone) return null;
  const text = `Bonjour ${doc.client}, nous revenons vers vous au sujet de notre devis ${doc.number} (${formatMoney(doc.total)}). Avez-vous pu l’étudier ?`;
  return `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}

/** Products under their reorder point, in the user's stock locations. */
function useStockWatch(enabled: boolean, products: Product[]) {
  const { filterLevels } = useAccessibleLocations();
  const [settings, setSettings] = useState<ProductStockSetting[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    StockService.getStockSettings().then(setSettings).catch(() => setFailed(true));
  }, [enabled]);
  return useMemo(() => {
    if (!enabled) return null;
    if (failed) return { failed: true as const };
    if (!settings) return null;
    const reorder = new Map<string, number>();
    settings.filter(s => !s.location_key).forEach(s => reorder.set(s.barcode, s.reorder_point));
    const low = products
      .map(p => ({ p, stock: Object.values(filterLevels(p.stock_levels || {})).reduce((s, v) => s + (Number(v) || 0), 0), min: reorder.get(p.barcode) }))
      .filter((x): x is { p: Product; stock: number; min: number } => x.min != null && x.stock <= x.min)
      .sort((a, b) => a.stock - b.stock || a.p.name.localeCompare(b.p.name, 'fr'));
    return { failed: false as const, low, out: low.filter(x => x.stock <= 0).length, thresholds: reorder.size };
  }, [enabled, failed, settings, products, filterLevels]);
}

export function Home() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { access } = useAccess();
  const { data, loading } = useHomeData();
  const { state } = useAppContext();
  const { showToast } = useToast();
  const stock = useStockWatch(access.stock, state.products);
  const [creatingInvoice, setCreatingInvoice] = useState(false);

  const firstName = (currentUser?.custom_seller_name?.trim() || currentUser?.username || '').split(' ')[0];
  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  const followUps = data?.followUps;
  const unpaid = data?.unpaid;
  const tasks = data?.tasks;
  const recent = data?.recent;
  const followTotal = followUps?.reduce((s, d) => s + d.total, 0) ?? 0;
  const unpaidTotal = unpaid?.reduce((s, d) => s + d.total - d.paid, 0) ?? 0;
  const deliveries = tasks?.filter(t => t.type === 'delivery').length ?? 0;

  const newInvoice = async () => {
    const { companyId } = getCompanyContext();
    if (!companyId) { navigate('/compta/invoices'); return; }
    setCreatingInvoice(true);
    try {
      const doc = await SupabaseDocumentsService.createEmptyDocument('invoice', companyId);
      navigate(`/compta/invoices/${doc.id}?new=1`);
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally { setCreatingInvoice(false); }
  };

  const kpis: ReactNode[] = [];
  if (access.quotes) kpis.push(<Kpi key="f" to="/quotes-history" icon={Send} tone="bg-amber-500/15 text-amber-700 dark:text-amber-300" label="Devis à relancer" loading={loading && !followUps}
    value={followUps ? followUps.length : '—'} sub={followUps ? `${formatMoney(followTotal)} en attente` : 'Liste indisponible'} cta="Relancer" />);
  if (access.billing) kpis.push(<Kpi key="u" to="/compta/invoices" icon={CircleAlert} tone="bg-red-500/10 text-red-700 dark:text-red-300" label="Factures impayées" loading={loading && !unpaid}
    value={unpaid ? formatMoney(unpaidTotal) : '—'} sub={unpaid ? (unpaid.length ? `${unpaid.length} facture${unpaid.length > 1 ? 's' : ''} · la plus ancienne ${daysSince(unpaid[0].createdAt)} j` : 'Tout est encaissé') : 'Liste indisponible'} cta="Encaisser" />);
  if (access.tasks) kpis.push(<Kpi key="t" to={access.ownTasksOnly ? '/tasks/mine' : '/tasks'} icon={Truck} tone="bg-blue-500/10 text-blue-700 dark:text-blue-300" label="Tâches ouvertes" loading={loading && !tasks}
    value={tasks ? `${tasks.length} tâche${tasks.length > 1 ? 's' : ''}` : '—'} sub={tasks ? `${deliveries} livraison${deliveries > 1 ? 's' : ''} · ${tasks.length - deliveries} intervention${tasks.length - deliveries > 1 ? 's' : ''}` : 'Liste indisponible'} cta="Planning" />);
  if (access.stock) kpis.push(<Kpi key="s" to="/inventaire/niveaux" icon={PackageX} tone="bg-secondary text-foreground/70" label="Stock à surveiller" loading={!stock}
    value={stock && !stock.failed ? `${stock.low.length} produit${stock.low.length > 1 ? 's' : ''}` : '—'}
    sub={stock && !stock.failed ? (stock.thresholds ? `${stock.out} en rupture · sous le seuil` : 'Aucun seuil défini') : 'Liste indisponible'} cta="Réapprovisionner" />);

  const quickLinks: { to: string; label: string; icon: LucideIcon }[] = [
    { to: '/products', label: 'Produits', icon: ShoppingBag },
    { to: '/clients', label: 'Clients', icon: Users },
    { to: '/catalogue', label: 'Catalogue', icon: BookMarked },
    { to: '/sheets', label: 'Fiches techniques', icon: BookOpen },
  ];

  const mainColumn: ReactNode[] = [];
  const sideColumn: ReactNode[] = [];

  if (access.quotes) {
    mainColumn.push(
      <Panel key="follow" title="Devis à relancer" action={<SeeAll to="/quotes-history">Tout voir</SeeAll>}>
        {followUps === null ? <Failed /> : !followUps ? <Empty>Chargement…</Empty> : followUps.length === 0 ? <Empty>Aucun devis en attente de réponse.</Empty> : (
          <ul className="divide-y divide-border">
            {followUps.slice(0, 5).map(d => {
              const wa = whatsappFollowUp(d);
              return (
                <li key={d.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <Link to={docPath(d)} className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-foreground">{d.client}</span>
                    <span className="block truncate text-sm text-muted-foreground">{d.number} · envoyé il y a {daysSince(d.updatedAt)} j</span>
                  </Link>
                  <span className="hidden w-32 shrink-0 text-right font-semibold tabular-nums text-foreground sm:block">{formatMoney(d.total)}</span>
                  {wa && (
                    <a href={wa} target="_blank" rel="noopener noreferrer" aria-label={`Relancer ${d.client} sur WhatsApp`}
                      className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-semibold text-foreground hover:bg-secondary">
                      <MessageCircle className="h-4 w-4 text-emerald-600" aria-hidden="true" /><span className="hidden sm:inline">Relancer</span>
                    </a>
                  )}
                  <Link to={docPath(d)} aria-label={`Ouvrir ${d.number}`} className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary sm:flex">
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>,
    );
  }
  if (access.billing) {
    mainColumn.push(
      <Panel key="unpaid" title="Factures à encaisser" action={<SeeAll to="/compta/invoices">Factures</SeeAll>}>
        {unpaid === null ? <Failed /> : !unpaid ? <Empty>Chargement…</Empty> : unpaid.length === 0 ? <Empty>Toutes les factures sont encaissées.</Empty> : (
          <ul className="divide-y divide-border">
            {unpaid.slice(0, 5).map(d => (
              <li key={d.id}>
                <Link to={docPath(d)} className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/50 sm:px-5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-foreground">{d.client}</span>
                    <span className="block truncate text-sm text-muted-foreground">{d.number} · émise il y a {daysSince(d.createdAt)} j</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-semibold tabular-nums text-foreground">{formatMoney(d.total - d.paid)}</span>
                    <span className="block text-xs text-muted-foreground">{d.paid > 0 ? `sur ${formatMoney(d.total)}` : 'reste à payer'}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>,
    );
  }
  if (access.quotes || access.billing) {
    mainColumn.push(
      <Panel key="recent" title="Documents récents" action={<SeeAll to={access.quotes ? '/quotes-history' : '/compta/invoices'}>Historique</SeeAll>}>
        {recent === null ? <Failed /> : !recent ? <Empty>Chargement…</Empty> : recent.length === 0 ? <Empty>Aucun document pour le moment.</Empty> : (
          <ul className="divide-y divide-border">
            {recent.map(d => {
              const st = docStatus(d);
              return (
                <li key={d.id}>
                  <Link to={docPath(d)} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-secondary/50 sm:px-5">
                    <span className={`w-[4.5rem] shrink-0 rounded-md px-2 py-0.5 text-center text-xs font-bold ${DOC_TONE[d.type] || DOC_TONE.quote}`}>{DOC_LABEL[d.type]}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">{d.client}</span>
                      <span className="block truncate text-xs text-muted-foreground tabular-nums">{d.number} · {formatRelativeDay(d.createdAt)}</span>
                    </span>
                    <span className="hidden shrink-0 font-semibold tabular-nums text-foreground sm:block">{formatMoney(d.total)}</span>
                    <Pill tone={st.tone}>{st.label}</Pill>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>,
    );
  }
  if (access.tasks) {
    sideColumn.push(
      <Panel key="tasks" title="Tâches à faire" action={<SeeAll to={access.ownTasksOnly ? '/tasks/mine' : '/tasks'}>Tâches</SeeAll>}>
        {tasks === null ? <Failed /> : !tasks ? <Empty>Chargement…</Empty> : tasks.length === 0 ? <Empty>Aucune tâche en cours.</Empty> : (
          <ul className="divide-y divide-border">
            {tasks.slice(0, 5).map(t => {
              const delivery = t.type === 'delivery';
              const Icon = delivery ? Truck : Wrench;
              const late = t.dueDate && new Date(t.dueDate) < new Date(new Date().toDateString());
              return (
                <li key={t.id} className="flex gap-3 px-4 py-3 sm:px-5">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${delivery ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'}`}><Icon className="h-4 w-4" aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">{t.client || (delivery ? 'Livraison' : 'Intervention')}</span>
                    <span className="block truncate text-sm text-muted-foreground">{delivery ? 'Livraison' : 'Intervention'}{t.details ? ` · ${t.details}` : t.address ? ` · ${t.address}` : ''}</span>
                  </span>
                  {t.dueDate && <span className={`shrink-0 text-xs font-semibold ${late ? 'text-red-700 dark:text-red-300' : 'text-muted-foreground'}`}>{late ? 'En retard' : new Date(t.dueDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>}
                  {t.status === 'doing' && !t.dueDate && <Pill tone="blue">En cours</Pill>}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>,
    );
  }
  if (access.stock) {
    sideColumn.push(
      <Panel key="stock" title="Stock à surveiller" action={<SeeAll to="/inventaire">Stock</SeeAll>}>
        {!stock ? <Empty>Chargement…</Empty> : stock.failed ? <Failed /> : !stock.thresholds ? (
          <Empty>Définissez des seuils de réapprovisionnement dans <Link to="/inventaire/niveaux" className="font-semibold text-primary hover:underline">Niveaux de stock</Link> pour être alerté ici.</Empty>
        ) : stock.low.length === 0 ? <Empty>Aucun produit sous son seuil.</Empty> : (
          <ul className="divide-y divide-border">
            {stock.low.slice(0, 5).map(({ p, stock: qty, min }) => {
              const img = resolveProductImageUrl(p.image);
              return (
                <li key={p.barcode}>
                  <Link to={`/product/${encodeURIComponent(p.barcode)}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/50 sm:px-5">
                    <span className="flex h-10 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-white">
                      {img ? <img src={img} alt="" className="h-full w-full object-contain" loading="lazy" /> : <Package className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{p.name}</span>
                    {qty <= 0 ? <Pill tone="red">Rupture</Pill> : <Pill tone="amber">{qty} / {min}</Pill>}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>,
    );
  }

  // Users without any of these lists (catalogue access only) get shortcuts.
  if (!mainColumn.length && !sideColumn.length) {
    mainColumn.push(
      <Panel key="links" title="Accès rapide">
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
          {quickLinks.map(l => (
            <Link key={l.to} to={l.to} className="flex flex-col items-center gap-2 bg-card px-3 py-5 text-sm font-semibold text-foreground hover:bg-secondary/50">
              <l.icon className="h-6 w-6 text-primary" aria-hidden="true" />{l.label}
            </Link>
          ))}
        </div>
      </Panel>,
    );
  }

  if (state.products.length === 0 && access.superAdmin) {
    mainColumn.unshift(
      <Panel key="empty">
        <div className="flex flex-wrap items-center gap-4 p-5">
          <Package className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-foreground">Aucun produit chargé</p>
            <p className="text-sm text-muted-foreground">{state.isOnline ? 'Synchronisez ou importez le catalogue depuis les outils système.' : 'Connectez-vous à Internet pour synchroniser.'}</p>
          </div>
          <Link to="/admin/tools" className="flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground"><RefreshCw className="h-4 w-4" aria-hidden="true" />Outils système</Link>
        </div>
      </Panel>,
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">Bonjour{firstName ? ` ${firstName}` : ''}</h1>
          <p className="mt-1 text-sm text-muted-foreground first-letter:uppercase">{today}<span className="hidden sm:inline"> · voici ce qui demande votre attention</span></p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          {access.billing && (
            <button type="button" onClick={newInvoice} disabled={creatingInvoice} className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-semibold text-foreground hover:bg-secondary disabled:opacity-60 sm:flex-none">
              <Receipt className="h-4 w-4" aria-hidden="true" />Nouvelle facture
            </button>
          )}
          {access.quotes && (
            <Link to="/quote-cart" className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 sm:flex-none">
              <Plus className="h-4 w-4" aria-hidden="true" />Nouveau devis
            </Link>
          )}
        </div>
      </div>

      <button type="button" onClick={openSearch}
        className="mt-4 flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 text-left shadow-sm hover:border-primary/40">
        <Search className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[15px] text-muted-foreground"><span className="sm:hidden">Produit, client, document…</span><span className="hidden sm:inline">Chercher un produit, un client ou un document…</span></span>
        <kbd className="hidden rounded border border-border bg-secondary px-2 py-0.5 text-xs font-semibold text-muted-foreground md:inline">Ctrl K</kbd>
      </button>

      {/* One card would only repeat the list under it. */}
      {kpis.length > 1 && <div className={`mt-4 grid grid-cols-2 gap-3 ${kpis.length >= 4 ? 'lg:grid-cols-4' : kpis.length === 3 ? 'lg:grid-cols-3' : ''}`}>{kpis}</div>}

      <div className={`mt-5 grid gap-5 ${sideColumn.length && mainColumn.length ? 'lg:grid-cols-3' : ''}`}>
        {mainColumn.length > 0 && <div className={`space-y-5 ${sideColumn.length ? 'lg:col-span-2' : ''}`}>{mainColumn}</div>}
        {sideColumn.length > 0 && <div className="space-y-5">{sideColumn}</div>}
      </div>

    </div>
  );
}
