import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Check, ChevronLeft, ChevronRight, Clipboard, ExternalLink, ImageOff,
  Link2, Loader2, MonitorSmartphone, PackagePlus, Plus, RefreshCw, RotateCw,
  Save, Search, Settings2, ShoppingCart, Trash2, UserRound, X,
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../hooks/useAuth';
import {
  KioskService, type KioskAdminProduct, type KioskAdminProfile, type KioskCompanyOption,
  type KioskRequestDetail, type KioskRequestItem, type KioskRequestStatus,
  type KioskRequestSummary, type KioskUserOption,
} from '../../utils/kioskService';

type Tab = 'requests' | 'settings';

const STATUS_LABELS: Record<KioskRequestStatus, string> = {
  new: 'Nouvelle', assigned: 'Assignée', reviewing: 'En révision', prepared: 'Préparée',
  contacted: 'Client contacté', converted: 'Devis créé', rejected: 'Refusée',
};

const STATUS_STYLES: Record<KioskRequestStatus, string> = {
  new: 'bg-blue-100 text-blue-700', assigned: 'bg-violet-100 text-violet-700',
  reviewing: 'bg-amber-100 text-amber-700', prepared: 'bg-cyan-100 text-cyan-700',
  contacted: 'bg-emerald-100 text-emerald-700', converted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

const EMPTY_PROFILE = (companyId = ''): KioskAdminProfile => ({
  company_id: companyId,
  name: 'Kiosque principal',
  enabled: true,
  greeting_title: 'Bienvenue',
  greeting_message: 'Créez votre demande de devis en quelques étapes.',
  logo_url: null,
  accent_color: '#2563eb',
  language: 'fr',
  show_prices: true,
  price_mode: 'retail',
  require_email: false,
  show_out_of_stock: true,
  show_availability: false,
  inactivity_timeout_seconds: 180,
  default_assignee_id: null,
  visible_family_ids: [],
  visible_brands: [],
  featured_barcodes: [],
});

const money = (value: number) => new Intl.NumberFormat('fr-MA', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(Number(value) || 0);

const dateTime = (value: string) => new Intl.DateTimeFormat('fr-MA', {
  dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(value));

const userLabel = (user?: KioskUserOption | null) =>
  user?.custom_seller_name?.trim() || user?.username || 'Non assigné';

const validPhone = (value: string) => {
  const normalized = value.trim();
  const digitCount = normalized.replace(/\D/g, '').length;
  return /^\+?[0-9\s().-]{7,24}$/.test(normalized) && digitCount >= 7 && digitCount <= 15;
};

const hasCompleteContact = (request: Pick<KioskRequestSummary, 'customer_name' | 'customer_phone' | 'customer_email' | 'kiosk_profile'>) => (
  request.customer_name.trim().length >= 2
  && validPhone(request.customer_phone)
  && (!request.customer_email || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(request.customer_email.trim()))
  && (!request.kiosk_profile?.require_email || !!request.customer_email?.trim())
);

export default function KioskAdminPage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { showToast } = useToast();
  const [tab, setTab] = useState<Tab>('requests');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [profiles, setProfiles] = useState<KioskAdminProfile[]>([]);
  const [companies, setCompanies] = useState<KioskCompanyOption[]>([]);
  const [users, setUsers] = useState<KioskUserOption[]>([]);
  const [canManageProfiles, setCanManageProfiles] = useState(false);
  const [canAssignRequests, setCanAssignRequests] = useState(false);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [requests, setRequests] = useState<KioskRequestSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState<KioskRequestStatus | 'all'>('all');
  const [selectedRequest, setSelectedRequest] = useState<KioskRequestDetail | null>(null);
  const [requestLoading, setRequestLoading] = useState(false);
  const [savingRequest, setSavingRequest] = useState(false);
  const [editingProfile, setEditingProfile] = useState<KioskAdminProfile | null>(null);

  const loadBootstrap = useCallback(async () => {
    setError('');
    const data = await KioskService.adminBootstrap();
    setProfiles(data.profiles);
    setCompanies(data.companies);
    setUsers(data.users);
    setCanManageProfiles(data.permissions.can_manage_profiles);
    setCanAssignRequests(data.permissions.can_assign_requests);
    setIsSuperadmin(data.permissions.is_superadmin);
  }, []);

  const loadRequests = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const data = await KioskService.listRequests({ search: debouncedSearch, status, page, pageSize: 50 });
      setRequests(data.requests);
      setTotal(data.total);
    } finally {
      if (!quiet) setRefreshing(false);
    }
  }, [debouncedSearch, page, status]);

  useEffect(() => {
    Promise.all([loadBootstrap(), KioskService.listRequests({ pageSize: 50 })])
      .then(([, data]) => { setRequests(data.requests); setTotal(data.total); })
      .catch(err => setError(err instanceof Error ? err.message : 'Impossible de charger les demandes kiosque.'))
      .finally(() => setLoading(false));
  }, [loadBootstrap]);

  useEffect(() => {
    const timer = setTimeout(() => { setPage(0); setDebouncedSearch(search.trim()); }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!loading) loadRequests(true).catch(err => setError(err instanceof Error ? err.message : 'Chargement impossible'));
  }, [debouncedSearch, status, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const openRequest = async (requestId: string) => {
    setRequestLoading(true);
    try {
      setSelectedRequest(await KioskService.getRequest(requestId));
    } catch (err) {
      showToast({ type: 'error', title: 'Demande inaccessible', message: err instanceof Error ? err.message : 'Erreur inconnue' });
    } finally {
      setRequestLoading(false);
    }
  };

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadBootstrap(), loadRequests(true)]);
      showToast({ type: 'success', title: 'Données actualisées', message: 'La file kiosque est à jour.' });
    } catch (err) {
      showToast({ type: 'error', title: 'Actualisation impossible', message: err instanceof Error ? err.message : 'Erreur inconnue' });
    } finally {
      setRefreshing(false);
    }
  };

  const saveRequest = async (request = selectedRequest, notify = true) => {
    if (!request) return false;
    if (!request.items.length) {
      showToast({ type: 'error', title: 'Informations manquantes', message: 'Ajoutez au moins un produit à la demande.' });
      return false;
    }
    if (!request.contact_details_pending && !hasCompleteContact(request)) {
      showToast({ type: 'error', title: 'Coordonnées invalides', message: 'Vérifiez le nom, le téléphone et l’adresse e-mail du client.' });
      return false;
    }
    setSavingRequest(true);
    try {
      await KioskService.updateRequest(request.id, request);
      const fresh = await KioskService.getRequest(request.id);
      setSelectedRequest(fresh);
      await loadRequests(true);
      if (notify) showToast({ type: 'success', title: 'Demande enregistrée', message: `${request.request_number} a été mise à jour.` });
      return true;
    } catch (err) {
      showToast({ type: 'error', title: 'Enregistrement impossible', message: err instanceof Error ? err.message : 'Erreur inconnue' });
      return false;
    } finally {
      setSavingRequest(false);
    }
  };

  const convertRequest = async () => {
    if (!selectedRequest || selectedRequest.quote_id) return;
    if (selectedRequest.contact_details_pending || !hasCompleteContact(selectedRequest)) {
      showToast({ type: 'error', title: 'Coordonnées à compléter', message: 'Complétez et vérifiez les coordonnées du client avant de créer le devis.' });
      return;
    }
    if (!window.confirm('Enregistrer les modifications et créer un devis brouillon à partir de cette demande ?')) return;
    const saved = await saveRequest(selectedRequest, false);
    if (!saved) return;
    setSavingRequest(true);
    try {
      const quote = await KioskService.convertRequest(selectedRequest.id);
      showToast({ type: 'success', title: 'Devis créé', message: `${quote.quote_number} est prêt à être finalisé.` });
      navigate(`/quote-cart/${quote.quote_id}`);
    } catch (err) {
      showToast({ type: 'error', title: 'Conversion impossible', message: err instanceof Error ? err.message : 'Erreur inconnue' });
    } finally {
      setSavingRequest(false);
    }
  };

  const beginProfile = (profile?: KioskAdminProfile) => {
    setEditingProfile(profile ? { ...profile } : EMPTY_PROFILE(companies[0]?.id || ''));
  };

  const requiresReconnect = /Reconnectez-vous|Authentication required/i.test(error);
  const reconnect = () => {
    logout();
    navigate('/', { replace: true });
  };

  if (loading) return <PageState><Loader2 className="h-8 w-8 animate-spin text-primary" /><p>Chargement des demandes kiosque…</p></PageState>;

  if (error && !requests.length && !profiles.length) {
    return <PageState><MonitorSmartphone className="h-10 w-10 text-muted-foreground" /><h1 className="text-xl font-bold">Module kiosque indisponible</h1><p className="max-w-lg text-center text-muted-foreground">{error}</p><button onClick={requiresReconnect ? reconnect : () => window.location.reload()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">{requiresReconnect ? 'Se reconnecter' : 'Réessayer'}</button></PageState>;
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 p-4 md:p-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-3"><div className="rounded-xl bg-primary/10 p-2.5 text-primary"><MonitorSmartphone className="h-6 w-6" /></div><div><h1 className="text-2xl font-bold tracking-tight">Demandes Kiosque</h1><p className="text-sm text-muted-foreground">Collectez, attribuez et transformez les sélections clients en devis.</p></div></div>
        </div>
        <button onClick={refreshAll} disabled={refreshing} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border bg-card px-4 text-sm font-medium hover:bg-accent disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />Actualiser</button>
      </div>

      <div className="inline-flex rounded-xl border bg-muted/40 p-1">
        <TabButton active={tab === 'requests'} onClick={() => setTab('requests')} icon={<ShoppingCart className="h-4 w-4" />} label={`Demandes (${total})`} />
        <TabButton active={tab === 'settings'} onClick={() => setTab('settings')} icon={<Settings2 className="h-4 w-4" />} label="Liens & réglages" />
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {tab === 'requests' ? (
        <RequestsPanel
          requests={requests} total={total} page={page} search={search} status={status} loading={refreshing || requestLoading}
          onSearch={setSearch} onStatus={value => { setStatus(value); setPage(0); }} onPage={setPage} onOpen={openRequest}
        />
      ) : (
        <ProfilesPanel profiles={profiles} companies={companies} canManage={canManageProfiles} onEdit={beginProfile} onRotate={async profile => {
          if (!profile.id || !window.confirm('L’ancien lien cessera immédiatement de fonctionner. Générer un nouveau lien ?')) return;
          try {
            const token = await KioskService.rotateToken(profile.id);
            setProfiles(current => current.map(item => item.id === profile.id ? { ...item, public_token: token } : item));
            showToast({ type: 'success', title: 'Lien renouvelé', message: 'L’ancien lien a été désactivé.' });
          } catch (err) {
            showToast({ type: 'error', title: 'Renouvellement impossible', message: err instanceof Error ? err.message : 'Erreur inconnue' });
          }
        }} />
      )}

      {(selectedRequest || requestLoading) && (
        <RequestEditor
          request={selectedRequest} loading={requestLoading} companies={companies} users={users} isSuperadmin={isSuperadmin} canAssign={canAssignRequests}
          saving={savingRequest} onClose={() => setSelectedRequest(null)} onChange={setSelectedRequest}
          onSave={() => saveRequest()} onConvert={convertRequest}
        />
      )}

      {editingProfile && (
        <ProfileEditor
          profile={editingProfile} companies={companies} users={users} isSuperadmin={isSuperadmin}
          onClose={() => setEditingProfile(null)} onSaved={saved => {
            setProfiles(current => {
              const exists = current.some(item => item.id === saved.id);
              return exists ? current.map(item => item.id === saved.id ? saved : item) : [saved, ...current];
            });
            setEditingProfile(null);
            showToast({ type: 'success', title: 'Kiosque enregistré', message: 'Le lien et ses règles sont prêts.' });
          }}
        />
      )}
    </div>
  );
}

function RequestsPanel({ requests, total, page, search, status, loading, onSearch, onStatus, onPage, onOpen }: {
  requests: KioskRequestSummary[]; total: number; page: number; search: string; status: KioskRequestStatus | 'all'; loading: boolean;
  onSearch: (value: string) => void; onStatus: (value: KioskRequestStatus | 'all') => void; onPage: (page: number) => void; onOpen: (id: string) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / 50));
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={e => onSearch(e.target.value)} placeholder="Numéro, client ou téléphone…" className="h-10 w-full rounded-lg border bg-background pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" /></div>
        <select value={status} onChange={e => onStatus(e.target.value as KioskRequestStatus | 'all')} className="h-10 rounded-lg border bg-background px-3 text-sm"><option value="all">Tous les statuts</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Demande</th><th className="px-4 py-3">Client</th><th className="px-4 py-3">Kiosque</th><th className="px-4 py-3">Attribution</th><th className="px-4 py-3 text-right">Montant</th><th className="px-4 py-3">Statut</th><th className="px-4 py-3" /></tr></thead>
          <tbody className="divide-y">
            {requests.map(request => (
              <tr key={request.id} className="hover:bg-muted/30">
                <td className="px-4 py-3"><button onClick={() => onOpen(request.id)} className="font-semibold text-primary hover:underline">{request.request_number}</button><div className="mt-1 text-xs text-muted-foreground">{dateTime(request.submitted_at)}</div></td>
                <td className="px-4 py-3">{request.contact_details_pending ? <><span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">Coordonnées à compléter</span><div className="mt-1 text-xs text-muted-foreground">Le client les fournira plus tard</div></> : <><div className="font-medium">{request.customer_name}</div><div className="text-xs text-muted-foreground">{request.customer_phone}</div></>}</td>
                <td className="px-4 py-3">{request.kiosk_profile?.name || '—'}<div className="text-xs text-muted-foreground">{request.kiosk_request_items?.[0]?.count || 0} produit(s)</div></td>
                <td className="px-4 py-3">{request.assigned_company?.name || '—'}<div className="text-xs text-muted-foreground">{request.assigned_user?.custom_seller_name || request.assigned_user?.username || 'Non assigné'}</div></td>
                <td className="px-4 py-3 text-right font-semibold">{money(request.total_amount)} DH</td>
                <td className="px-4 py-3"><StatusBadge status={request.status} /></td>
                <td className="px-4 py-3 text-right"><button onClick={() => onOpen(request.id)} className="rounded-lg border px-3 py-2 text-xs font-medium hover:bg-accent">Ouvrir</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!requests.length && <div className="py-20 text-center text-muted-foreground"><ShoppingCart className="mx-auto mb-3 h-9 w-9 opacity-40" /><p>{loading ? 'Chargement…' : 'Aucune demande trouvée.'}</p></div>}
      <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground"><span>{total} demande(s)</span><div className="flex items-center gap-2"><button disabled={page === 0} onClick={() => onPage(page - 1)} className="rounded-lg border p-2 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button><span>{page + 1} / {pages}</span><button disabled={page + 1 >= pages} onClick={() => onPage(page + 1)} className="rounded-lg border p-2 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button></div></div>
    </section>
  );
}

function ProfilesPanel({ profiles, companies, canManage, onEdit, onRotate }: {
  profiles: KioskAdminProfile[]; companies: KioskCompanyOption[]; canManage: boolean;
  onEdit: (profile?: KioskAdminProfile) => void; onRotate: (profile: KioskAdminProfile) => void;
}) {
  const copyLink = async (profile: KioskAdminProfile) => {
    if (!profile.public_token) return;
    await navigator.clipboard.writeText(KioskService.publicUrl(profile.public_token));
  };
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">Liens kiosque</h2><p className="text-sm text-muted-foreground">Créez un lien distinct par tablette, magasin ou point d’accueil.</p></div>{canManage && <button onClick={() => onEdit()} disabled={!companies.length} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"><Plus className="h-4 w-4" />Nouveau kiosque</button>}</div>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {profiles.map(profile => (
          <article key={profile.id} className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="font-semibold">{profile.name}</h3><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${profile.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{profile.enabled ? 'Actif' : 'Désactivé'}</span></div><p className="mt-1 text-sm text-muted-foreground">{profile.company?.name || companies.find(c => c.id === profile.company_id)?.name}</p></div><div className="h-9 w-9 rounded-lg border-4" style={{ borderColor: profile.accent_color || '#2563eb' }} /></div>
            <div className="mt-4 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground"><div className="truncate font-mono">{profile.public_token ? KioskService.publicUrl(profile.public_token) : 'Lien en attente'}</div></div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => copyLink(profile)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium hover:bg-accent"><Clipboard className="h-3.5 w-3.5" />Copier</button>
              {profile.public_token && <a href={KioskService.publicUrl(profile.public_token)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium hover:bg-accent"><ExternalLink className="h-3.5 w-3.5" />Ouvrir</a>}
              {canManage && <><button onClick={() => onEdit(profile)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium hover:bg-accent"><Settings2 className="h-3.5 w-3.5" />Régler</button><button onClick={() => onRotate(profile)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium text-amber-700 hover:bg-amber-50"><RotateCw className="h-3.5 w-3.5" />Renouveler</button></>}
            </div>
          </article>
        ))}
      </div>
      {!profiles.length && <div className="rounded-xl border-2 border-dashed py-20 text-center text-muted-foreground"><Link2 className="mx-auto mb-3 h-10 w-10 opacity-40" /><p>Aucun kiosque configuré.</p></div>}
    </section>
  );
}

function RequestEditor({ request, loading, companies, users, isSuperadmin, canAssign, saving, onClose, onChange, onSave, onConvert }: {
  request: KioskRequestDetail | null; loading: boolean; companies: KioskCompanyOption[]; users: KioskUserOption[]; isSuperadmin: boolean; canAssign: boolean; saving: boolean;
  onClose: () => void; onChange: (request: KioskRequestDetail) => void; onSave: () => void; onConvert: () => void;
}) {
  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState<KioskAdminProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const converted = !!request?.quote_id;
  const availableUsers = users.filter(user => !request || user.company_id === request.assigned_company_id || (isSuperadmin && !user.company_id));

  useEffect(() => {
    if (!request || productSearch.trim().length < 2 || converted) { setProductResults([]); return; }
    const timer = setTimeout(() => {
      setSearching(true);
      KioskService.searchProducts(request.assigned_company_id, productSearch.trim())
        .then(setProductResults).catch(() => setProductResults([])).finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [converted, productSearch, request?.assigned_company_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (values: Partial<KioskRequestDetail>) => request && onChange({ ...request, ...values });
  const patchContact = (values: Partial<Pick<KioskRequestDetail, 'customer_name' | 'customer_phone' | 'customer_email'>>) => {
    if (!request) return;
    const next = { ...request, ...values };
    onChange({ ...next, contact_details_pending: !hasCompleteContact(next) });
  };
  const patchItem = (index: number, values: Partial<KioskRequestItem>) => {
    if (!request) return;
    patch({ items: request.items.map((item, i) => i === index ? { ...item, ...values } : item) });
  };
  const addProduct = (product: KioskAdminProduct) => {
    if (!request) return;
    const existing = request.items.findIndex(item => item.product_barcode === product.barcode);
    if (existing >= 0) patchItem(existing, { quantity: Math.min(999, request.items[existing].quantity + 1) });
    else patch({ items: [...request.items, {
      product_barcode: product.barcode, product_name: product.name, product_brand: product.brand,
      product_image: product.image, quantity: 1, unit_price: product.retail_price,
      price_mode: 'retail', subtotal: product.retail_price,
    }] });
    setProductSearch(''); setProductResults([]);
  };

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/45" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}>
      <aside className="flex h-full w-full max-w-4xl flex-col overflow-hidden bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b px-4 py-3 md:px-6"><button onClick={onClose} className="inline-flex items-center gap-2 text-sm font-medium"><ArrowLeft className="h-4 w-4" />Retour</button>{request && <div className="flex items-center gap-2"><StatusBadge status={request.status} /><button onClick={onClose} className="rounded-lg p-2 hover:bg-accent"><X className="h-5 w-5" /></button></div>}</div>
        {loading || !request ? <PageState><Loader2 className="h-7 w-7 animate-spin" /></PageState> : (
          <>
            <div className="flex-1 overflow-y-auto p-4 md:p-6">
              <div className="mb-6 flex flex-col justify-between gap-2 sm:flex-row"><div><h2 className="text-2xl font-bold">{request.request_number}</h2><p className="text-sm text-muted-foreground">Reçue le {dateTime(request.submitted_at)}</p></div>{converted && <div className="rounded-lg bg-green-50 px-3 py-2 text-sm font-semibold text-green-700">Devis déjà créé</div>}</div>

              <fieldset disabled={converted} className="space-y-6 disabled:opacity-75">
                {request.contact_details_pending && <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"><strong className="block">Coordonnées client à compléter</strong><span className="mt-1 block">La demande peut être modifiée et enregistrée, mais le devis ne pourra être créé qu’après validation du nom, du téléphone et de l’e-mail requis.</span></div>}
                <Section title="Client" icon={<UserRound className="h-4 w-4" />}>
                  <div className="grid gap-4 md:grid-cols-2"><Field label="Nom complet"><input value={request.customer_name} onChange={e => patchContact({ customer_name: e.target.value })} className="field" /></Field><Field label="Téléphone"><input value={request.customer_phone} onChange={e => patchContact({ customer_phone: e.target.value })} className="field" /></Field><Field label={`E-mail${request.kiosk_profile?.require_email ? ' (obligatoire)' : ''}`}><input value={request.customer_email || ''} onChange={e => patchContact({ customer_email: e.target.value })} className="field" /></Field><Field label="Statut"><select value={request.status} onChange={e => patch({ status: e.target.value as KioskRequestStatus })} className="field">{Object.entries(STATUS_LABELS).filter(([value]) => value !== 'converted').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div>
                  <Field label="Note du client"><textarea rows={2} value={request.customer_note || ''} onChange={e => patch({ customer_note: e.target.value })} className="field py-2" /></Field>
                </Section>

                <Section title="Attribution" icon={<Check className="h-4 w-4" />}>
                  <div className="grid gap-4 md:grid-cols-2"><Field label="Société responsable"><select disabled={!isSuperadmin} value={request.assigned_company_id} onChange={e => patch({ assigned_company_id: e.target.value, assigned_user_id: null })} className="field">{companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></Field><Field label="Commercial / responsable"><select disabled={!canAssign} value={request.assigned_user_id || ''} onChange={e => patch({ assigned_user_id: e.target.value || null })} className="field"><option value="">Non assigné</option>{availableUsers.map(user => <option key={user.id} value={user.id}>{userLabel(user)}</option>)}</select></Field></div>
                  <Field label="Notes internes"><textarea rows={3} value={request.internal_notes || ''} onChange={e => patch({ internal_notes: e.target.value })} className="field py-2" placeholder="Instructions de suivi, disponibilité, remise…" /></Field>
                </Section>

                <Section title={`Produits (${request.items.length})`} icon={<ShoppingCart className="h-4 w-4" />}>
                  <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder="Ajouter par nom, marque ou référence…" className="field pl-10" />{searching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin" />}</div>
                  {productResults.length > 0 && <div className="max-h-64 overflow-y-auto rounded-lg border">{productResults.map(product => <button key={product.barcode} type="button" onClick={() => addProduct(product)} className="flex w-full items-center gap-3 border-b p-3 text-left last:border-0 hover:bg-accent"><ProductImage image={product.image} name={product.name} size="sm" /><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{product.name}</div><div className="text-xs text-muted-foreground">{product.brand} · {product.barcode}</div></div><Plus className="h-4 w-4" /></button>)}</div>}
                  <div className="space-y-3">{request.items.map((item, index) => <div key={item.product_barcode} className="grid items-center gap-3 rounded-xl border p-3 md:grid-cols-[56px_minmax(0,1fr)_90px_130px_40px]"><ProductImage image={item.product_image} name={item.product_name} /><div className="min-w-0"><div className="font-medium leading-tight">{item.product_name}</div><div className="mt-1 text-xs text-muted-foreground">{item.product_brand} · {item.product_barcode}</div></div><Field label="Qté" compact><input type="number" min={1} max={999} value={item.quantity} onChange={e => patchItem(index, { quantity: Math.max(1, Math.min(999, Number(e.target.value) || 1)) })} className="field" /></Field><Field label="Prix unitaire" compact><div className="relative"><input type="number" min={0} step="0.01" value={item.unit_price} onChange={e => patchItem(index, { unit_price: Math.max(0, Number(e.target.value) || 0) })} className="field pr-9" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">DH</span></div></Field><button type="button" onClick={() => patch({ items: request.items.filter((_, i) => i !== index) })} className="mt-5 rounded-lg p-2 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button></div>)}</div>
                  <div className="flex justify-end border-t pt-4 text-lg font-bold">Total : {money(request.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0))} DH</div>
                </Section>
              </fieldset>
            </div>
            <div className="flex flex-col-reverse gap-3 border-t bg-card p-4 sm:flex-row sm:justify-end md:px-6">
              <button onClick={onClose} className="h-11 rounded-lg border px-5 text-sm font-medium">Fermer</button>
              {!converted && <><button onClick={onSave} disabled={saving} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border px-5 text-sm font-semibold disabled:opacity-50"><Save className="h-4 w-4" />Enregistrer</button><button onClick={onConvert} disabled={saving || request.status === 'rejected' || !request.items.length || request.contact_details_pending} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}Créer le devis</button></>}
              {converted && <button onClick={() => window.location.assign(`/quote-cart/${request.quote_id}`)} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground"><ExternalLink className="h-4 w-4" />Ouvrir le devis</button>}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function ProfileEditor({ profile: initial, companies, users, isSuperadmin, onClose, onSaved }: {
  profile: KioskAdminProfile; companies: KioskCompanyOption[]; users: KioskUserOption[]; isSuperadmin: boolean;
  onClose: () => void; onSaved: (profile: KioskAdminProfile) => void;
}) {
  const [profile, setProfile] = useState(initial);
  const [brands, setBrands] = useState<string[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const patch = (values: Partial<KioskAdminProfile>) => setProfile(current => ({ ...current, ...values }));
  const profileUsers = users.filter(user => user.company_id === profile.company_id || (isSuperadmin && !user.company_id));

  useEffect(() => {
    if (!profile.company_id) return;
    setLoadingOptions(true);
    KioskService.companyOptions(profile.company_id)
      .then(data => setBrands(data.brands))
      .catch(err => setError(err instanceof Error ? err.message : 'Options indisponibles'))
      .finally(() => setLoadingOptions(false));
  }, [profile.company_id]);

  const toggleBrand = (value: string) => {
    const current = profile.visible_brands;
    patch({ visible_brands: current.includes(value) ? current.filter(item => item !== value) : [...current, value] });
  };
  const save = async () => {
    if (!profile.company_id || !profile.name.trim()) { setError('La société et le nom sont obligatoires.'); return; }
    setSaving(true); setError('');
    try { onSaved(await KioskService.saveProfile(profile)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Enregistrement impossible'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-0 sm:p-5" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}>
      <div className="flex h-full w-full max-w-4xl flex-col overflow-hidden bg-background shadow-2xl sm:h-[92vh] sm:rounded-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="text-xl font-bold">{profile.id ? 'Réglages du kiosque' : 'Nouveau kiosque'}</h2><p className="text-sm text-muted-foreground">Le kiosque utilise la liste complète des produits Stocky.</p></div><button onClick={onClose} className="rounded-lg p-2 hover:bg-accent"><X className="h-5 w-5" /></button></div>
        <div className="flex-1 space-y-6 overflow-y-auto p-5 md:p-6">
          {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          <Section title="Identité & accueil" icon={<MonitorSmartphone className="h-4 w-4" />}>
            <div className="grid gap-4 md:grid-cols-2"><Field label="Société"><select disabled={!isSuperadmin || !!profile.id} value={profile.company_id} onChange={e => patch({ company_id: e.target.value, default_assignee_id: null, visible_family_ids: [], visible_brands: [] })} className="field">{companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></Field><Field label="Nom interne"><input value={profile.name} onChange={e => patch({ name: e.target.value })} className="field" /></Field><Field label="Titre d’accueil"><input value={profile.greeting_title} onChange={e => patch({ greeting_title: e.target.value })} className="field" /></Field><Field label="Langue"><select value={profile.language} onChange={e => patch({ language: e.target.value as KioskAdminProfile['language'] })} className="field"><option value="fr">Français</option><option value="en">English</option><option value="ar">العربية</option></select></Field><Field label="URL du logo (facultatif)"><input value={profile.logo_url || ''} onChange={e => patch({ logo_url: e.target.value || null })} className="field" placeholder="https://…" /></Field><Field label="Couleur principale"><div className="flex gap-2"><input type="color" value={profile.accent_color || '#2563eb'} onChange={e => patch({ accent_color: e.target.value })} className="h-10 w-14 rounded-lg border bg-background p-1" /><input value={profile.accent_color || ''} onChange={e => patch({ accent_color: e.target.value })} className="field" /></div></Field></div>
            <Field label="Message d’accueil"><textarea rows={3} value={profile.greeting_message} onChange={e => patch({ greeting_message: e.target.value })} className="field py-2" /></Field>
          </Section>

          <Section title="Parcours client" icon={<ShoppingCart className="h-4 w-4" />}>
            <div className="grid gap-3 sm:grid-cols-2"><Toggle label="Kiosque actif" description="Le lien accepte les visites et les demandes." checked={profile.enabled} onChange={enabled => patch({ enabled })} /><Toggle label="Afficher les prix" description="Masque entièrement les montants si désactivé." checked={profile.show_prices} onChange={show_prices => patch({ show_prices })} /><Toggle label="E-mail obligatoire" description="Le client doit fournir une adresse e-mail." checked={profile.require_email} onChange={require_email => patch({ require_email })} /><Toggle label="Afficher la disponibilité" description="Indique disponible ou sur demande." checked={profile.show_availability} onChange={show_availability => patch({ show_availability })} /><Toggle label="Inclure les ruptures" description="Autorise les produits sans stock actuel." checked={profile.show_out_of_stock} onChange={show_out_of_stock => patch({ show_out_of_stock })} /></div>
            <div className="grid gap-4 md:grid-cols-3"><Field label="Tarif affiché"><select disabled={!profile.show_prices} value={profile.price_mode} onChange={e => patch({ price_mode: e.target.value as KioskAdminProfile['price_mode'] })} className="field"><option value="retail">Prix de vente</option><option value="reseller">Prix revendeur</option></select></Field><Field label="Effacement automatique"><select value={profile.inactivity_timeout_seconds} onChange={e => patch({ inactivity_timeout_seconds: Number(e.target.value) })} className="field"><option value={60}>1 minute</option><option value={120}>2 minutes</option><option value={180}>3 minutes</option><option value={300}>5 minutes</option><option value={600}>10 minutes</option><option value={900}>15 minutes</option></select></Field><Field label="Assignation par défaut"><select value={profile.default_assignee_id || ''} onChange={e => patch({ default_assignee_id: e.target.value || null })} className="field"><option value="">File non assignée</option>{profileUsers.map(user => <option key={user.id} value={user.id}>{userLabel(user)}</option>)}</select></Field></div>
          </Section>

          <Section title="Produits visibles" icon={<Search className="h-4 w-4" />}>
            <p className="text-sm text-muted-foreground">Tous les produits Stocky sont inclus. Laissez la liste des marques vide pour toutes les afficher. Les types kiosque (ustensiles, mobilier, équipement) se définissent depuis la liste ou la fiche produit.</p>
            {loadingOptions ? <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Chargement des marques…</div> : <ChoiceList title="Marques" values={brands.map(value => ({ value, label: value }))} selected={profile.visible_brands} onToggle={toggleBrand} />}
            <Field label="Produits mis en avant (codes-barres, un par ligne — maximum 24)"><textarea rows={4} value={profile.featured_barcodes.join('\n')} onChange={e => patch({ featured_barcodes: e.target.value.split(/[,\n]/).map(value => value.trim()).filter(Boolean).slice(0, 24) })} className="field py-2 font-mono text-xs" placeholder="6112345678901" /></Field>
          </Section>
        </div>
        <div className="flex justify-end gap-3 border-t bg-card p-4 md:px-6"><button onClick={onClose} className="h-10 rounded-lg border px-5 text-sm font-medium">Annuler</button><button onClick={save} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Enregistrer</button></div>
      </div>
    </div>
  );
}

function ProductImage({ image, name, size = 'md' }: { image: string | null; name: string; size?: 'sm' | 'md' }) {
  const url = KioskService.imageUrl(image);
  return <div className={`${size === 'sm' ? 'h-10 w-10' : 'h-14 w-14'} shrink-0 overflow-hidden rounded-lg border bg-white`}>{url ? <img src={url} alt={name} className="h-full w-full object-contain p-1" /> : <div className="flex h-full w-full items-center justify-center"><ImageOff className="h-4 w-4 text-muted-foreground/50" /></div>}</div>;
}

function ChoiceList({ title, values, selected, onToggle }: { title: string; values: Array<{ value: string; label: string }>; selected: string[]; onToggle: (value: string) => void }) {
  return <div><div className="mb-2 flex items-center justify-between"><h4 className="text-sm font-semibold">{title}</h4><span className="text-xs text-muted-foreground">{selected.length ? `${selected.length} sélectionné(s)` : 'Toutes'}</span></div><div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-2">{values.map(item => <label key={item.value} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"><input type="checkbox" checked={selected.includes(item.value)} onChange={() => onToggle(item.value)} className="h-4 w-4 rounded" /><span className="truncate">{item.label}</span></label>)}{!values.length && <p className="p-3 text-center text-xs text-muted-foreground">Aucune valeur</p>}</div></div>;
}

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border p-3"><span><span className="block text-sm font-medium">{label}</span><span className="mt-0.5 block text-xs text-muted-foreground">{description}</span></span><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="mt-1 h-4 w-4" /></label>;
}

function StatusBadge({ status }: { status: KioskRequestStatus }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[status]}`}>{STATUS_LABELS[status]}</span>;
}

function TabButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return <button onClick={onClick} className={`inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium transition ${active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{icon}{label}</button>;
}

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return <section className="space-y-4 rounded-xl border bg-card p-4"><h3 className="flex items-center gap-2 font-semibold">{icon}{title}</h3>{children}</section>;
}

function Field({ label, children, compact = false }: { label: string; children: ReactNode; compact?: boolean }) {
  return <label className="block"><span className={`${compact ? 'text-[11px]' : 'text-sm'} mb-1.5 block font-medium text-muted-foreground`}>{label}</span>{children}</label>;
}

function PageState({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[55vh] flex-col items-center justify-center gap-3 p-6 text-muted-foreground">{children}</div>;
}
