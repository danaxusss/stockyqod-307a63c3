import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Check, ChevronRight, Expand, Languages, Loader2,
  Package, RotateCcw, Search, ShoppingCart, Star, UserRound, WifiOff, X,
} from 'lucide-react';
import {
  KioskRequestError, KioskService, type KioskCategory, type KioskLanguage, type KioskProduct, type KioskPublicProfile, type KioskSector,
} from '../../utils/kioskService';
import { DEFAULT_KIOSK_ACCENT, isHexColor, readableTextOn } from '../../utils/kioskColors';
import { sectorLabel } from '../../utils/sectorLabel';
import { SHOWCASE_COPY } from '../../utils/kioskShowcase';
import { KioskReviewPage, KioskShowcase, ReviewInvite } from './KioskShowcase';
import { rememberKioskToken } from '../../utils/kioskApp';
import { copy, fmt, LANGUAGE_NAMES, withCount, type KioskCopy } from './kioskCopy';
import {
  Chip, FilterGroup, FiltersButton, FiltersPanel, ImageViewer, KioskInput, ProductCard, ProductDialog, ReviewLine, Steps,
} from './KioskParts';
import { useMediaQuery } from '../../hooks/useMediaQuery';

type Stage = 'welcome' | 'catalog' | 'review' | 'submitted';
type CartLine = { product: KioskProduct; quantity: number };
type FatalState = { kind: 'gone' | 'temporary'; message: string };
type CustomerDetails = { name: string; phone: string; email: string; note: string };
type SavedSession = {
  cart: Record<string, CartLine>;
  customer: CustomerDetails;
  deferContact: boolean;
  stage: Extract<Stage, 'welcome' | 'catalog' | 'review'>;
  language: KioskLanguage | null;
  expiresAt: number;
};

const EMPTY_CUSTOMER: CustomerDetails = { name: '', phone: '', email: '', note: '' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9\s().-]{7,24}$/;
const PAGE_SIZE = 48;
// Products per row on a landscape tablet (lg and up), scaled down on smaller
// screens. 0 keeps the automatic layout that grows with the screen width.
// Automatic: as many ~170 px columns as the screen holds (4 on a portrait
// tablet, 5–6 on a vertical 1080 px display, 7 on a landscape tablet).
const GRID_CLASSES: Record<number, string> = {
  0: 'grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))]',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
  5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
  6: 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-6',
};
// While the welcome screen is idle, pick up settings changed from the admin
// page (disabled kiosk, renewed link, prices, colours) without a reload.
const PROFILE_REFRESH_MS = 5 * 60_000;
const UNAVAILABLE_RETRY_MS = 30_000;

const isValidPhone = (value: string) => {
  const normalized = value.trim();
  const digitCount = normalized.replace(/\D/g, '').length;
  return PHONE_RE.test(normalized) && digitCount >= 7 && digitCount <= 15;
};

/** Translate a failed kiosk call into a message for the customer, in their language. */
function describeKioskError(error: unknown, t: KioskCopy): string {
  const status = error instanceof KioskRequestError ? error.status : null;
  const server = error instanceof KioskRequestError ? error.serverMessage || '' : error instanceof Error ? error.message : '';
  if (status === 429) return t.tooManyRequests;
  if (status === 404) return t.unavailable;
  if (/products? (are|is) unavailable|unavailable products?/i.test(server)) return t.productsUnavailable;
  if (/name and phone|customer name/i.test(server)) return t.required;
  if (/invalid (customer )?phone/i.test(server)) return t.invalidPhone;
  if (/email is required/i.test(server)) return t.emailRequired;
  if (/invalid (customer )?email/i.test(server)) return t.invalidEmail;
  if (status === null || (typeof navigator !== 'undefined' && !navigator.onLine)) return t.networkError;
  return t.genericError;
}

const scrollToY = (y: number) => window.scrollTo({ top: y });

// An accidental reload (or the tablet browser discarding the tab) should not
// lose a selection in progress. The copy lives in sessionStorage — this tab
// only — and expires with the kiosk's inactivity timeout.
const sessionKey = (token: string) => `stocky-kiosk-session:${token}`;

function readSavedSession(token: string): SavedSession | null {
  try {
    const raw = sessionStorage.getItem(sessionKey(token));
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedSession;
    if (!saved || typeof saved.expiresAt !== 'number' || saved.expiresAt < Date.now()) {
      sessionStorage.removeItem(sessionKey(token));
      return null;
    }
    return saved;
  } catch {
    return null;
  }
}

function writeSavedSession(token: string, session: SavedSession | null) {
  try {
    if (session) sessionStorage.setItem(sessionKey(token), JSON.stringify(session));
    else sessionStorage.removeItem(sessionKey(token));
  } catch { /* storage full or disabled: the session simply is not kept */ }
}

export default function KioskPage() {
  const { token = '' } = useParams();
  const [saved] = useState(() => readSavedSession(token));
  const [profile, setProfile] = useState<KioskPublicProfile | null>(null);
  const [brands, setBrands] = useState<string[]>([]);
  const [sectors, setSectors] = useState<KioskSector[]>([]);
  const [featured, setFeatured] = useState<KioskProduct[]>([]);
  const [stage, setStage] = useState<Stage>(saved?.stage || 'welcome');
  const [chosenLanguage, setChosenLanguage] = useState<KioskLanguage | null>(saved?.language || null);
  const [customer, setCustomer] = useState<CustomerDetails>(saved?.customer || EMPTY_CUSTOMER);
  const [deferContact, setDeferContact] = useState(saved?.deferContact || false);
  const [formError, setFormError] = useState('');
  const [products, setProducts] = useState<KioskProduct[]>([]);
  const [totalProducts, setTotalProducts] = useState(0);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [category, setCategory] = useState<KioskCategory | null>(null);
  const [brand, setBrand] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [sector, setSector] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, CartLine>>(saved?.cart || {});
  const [selectedProduct, setSelectedProduct] = useState<KioskProduct | null>(null);
  const [zoomProduct, setZoomProduct] = useState<KioskProduct | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [resetSecondsLeft, setResetSecondsLeft] = useState(0);
  // Two-column review only on a wide landscape screen; vertical screens get
  // one column and a send bar pinned to the bottom.
  const wideReview = useMediaQuery('(orientation: landscape) and (min-width: 1024px)');
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [catalogReload, setCatalogReload] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [fatal, setFatal] = useState<FatalState | null>(null);
  const [requestNumber, setRequestNumber] = useState('');
  const [idleWarning, setIdleWarning] = useState(false);
  const [idleSecondsLeft, setIdleSecondsLeft] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  // Showcase ("vitrine"): the attract loop shown over an idle welcome screen.
  const [showcase, setShowcase] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const showcaseStarted = useRef(false);
  const showcaseEnabled = useRef(false);
  const idleWarningTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleDeadline = useRef(0);
  // Filters of the page currently on screen, so returning from the review
  // step keeps the loaded pages instead of starting over at page one.
  const loadedCatalogKey = useRef<string | null>(null);
  const catalogRequest = useRef(0);
  const catalogScroll = useRef(0);

  const customerLanguages: KioskLanguage[] = profile?.customer_languages?.length ? profile.customer_languages : [profile?.language || 'fr'];
  const language: KioskLanguage = chosenLanguage && customerLanguages.includes(chosenLanguage) ? chosenLanguage : profile?.language || 'fr';
  const t = copy[language];
  const dir = language === 'ar' ? 'rtl' : 'ltr';
  const accent = profile && isHexColor(profile.accent_color) ? profile.accent_color : DEFAULT_KIOSK_ACCENT;
  const onAccent = readableTextOn(accent);

  const cartLines = useMemo(() => Object.values(cart), [cart]);
  const cartQuantity = useMemo(() => cartLines.reduce((sum, line) => sum + line.quantity, 0), [cartLines]);
  const cartTotal = useMemo(() => cartLines.reduce((sum, line) => sum + (line.product.price || 0) * line.quantity, 0), [cartLines]);
  const sessionDirty = cartLines.length > 0 || Object.values(customer).some(value => value.trim() !== '');
  const canDeferContact = profile?.allow_deferred_contact !== false;
  const deferring = canDeferContact && deferContact;
  showcaseEnabled.current = profile?.showcase_enabled === true;
  const reviewUrl = profile?.google_review_url || null;

  const loadProfile = useCallback(async (quiet: boolean) => {
    if (!quiet) setLoading(true);
    try {
      const data = await KioskService.loadPublic(token);
      setProfile(data.profile);
      // An app installed from this page starts on /kiosk/app and reopens this kiosk.
      rememberKioskToken(token);
      setBrands(data.brands || []);
      setSectors(data.sectors || []);
      setFatal(null);
      // Featured products are a bonus: the kiosk works the same without them.
      KioskService.listPublicProducts(token, { featuredOnly: true, page: 0, pageSize: 24 })
        .then(result => setFeatured(result.products))
        .catch(() => undefined);
    } catch (error) {
      const gone = error instanceof KioskRequestError && error.status === 404;
      // A quiet background refresh that fails transiently keeps the kiosk
      // running on the settings it already has.
      if (gone) setFatal({ kind: 'gone', message: '' });
      else if (!quiet) setFatal({ kind: 'temporary', message: error instanceof Error ? error.message : '' });
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [token]);

  const clearIdleTimers = useCallback(() => {
    if (idleWarningTimer.current) clearTimeout(idleWarningTimer.current);
    if (idleResetTimer.current) clearTimeout(idleResetTimer.current);
  }, []);

  const resetSession = useCallback(() => {
    clearIdleTimers();
    setCustomer(EMPTY_CUSTOMER);
    setDeferContact(false);
    setCart({});
    setChosenLanguage(null);
    setFeaturedOnly(false);
    setSector(null);
    setQuery('');
    setDebouncedQuery('');
    setCategory(null);
    setBrand('');
    setOnlyAvailable(false);
    setSelectedProduct(null);
    setZoomProduct(null);
    setFiltersOpen(false);
    setRequestNumber('');
    setReviewOpen(false);
    setShowcase(showcaseEnabled.current);
    setIdleWarning(false);
    setFormError('');
    setCatalogError('');
    setProducts([]);
    setTotalProducts(0);
    loadedCatalogKey.current = null;
    catalogScroll.current = 0;
    setStage('welcome');
    scrollToY(0);
    loadProfile(true);
  }, [clearIdleTimers, loadProfile]);

  const armIdleReset = useCallback(() => {
    clearIdleTimers();
    setIdleWarning(false);
    if (!profile || stage === 'submitted') return;
    // The welcome screen is safe to leave alone only when nothing has been
    // entered yet; otherwise a customer who tapped back and walked away
    // would hand their selection to the next person.
    if (stage === 'welcome' && !sessionDirty) return;
    const totalMs = profile.inactivity_timeout_seconds * 1000;
    const warningMs = Math.max(10_000, totalMs - 20_000);
    idleDeadline.current = Date.now() + totalMs;
    idleWarningTimer.current = setTimeout(() => setIdleWarning(true), warningMs);
    idleResetTimer.current = setTimeout(resetSession, totalMs);
    const kept = readSavedSession(token);
    if (kept) writeSavedSession(token, { ...kept, expiresAt: idleDeadline.current });
  }, [clearIdleTimers, profile, resetSession, sessionDirty, stage, token]);

  useEffect(() => {
    if (!idleWarning) return;
    const tick = () => setIdleSecondsLeft(Math.max(0, Math.ceil((idleDeadline.current - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [idleWarning]);

  useEffect(() => {
    if (!profile) return;
    if (!sessionDirty || stage === 'submitted') { writeSavedSession(token, null); return; }
    writeSavedSession(token, {
      cart, customer, deferContact, language: chosenLanguage,
      stage: stage === 'review' || stage === 'catalog' ? stage : 'welcome',
      expiresAt: Date.now() + profile.inactivity_timeout_seconds * 1000,
    });
  }, [cart, chosenLanguage, customer, deferContact, profile, sessionDirty, stage, token]);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);

  useEffect(() => { loadProfile(false); }, [loadProfile]);

  // The showcase opens with the kiosk (unless a saved session is being
  // resumed) and stops as soon as it is turned off from the settings.
  useEffect(() => {
    if (!profile) return;
    if (!profile.showcase_enabled) { setShowcase(false); return; }
    if (showcaseStarted.current) return;
    showcaseStarted.current = true;
    if (stage === 'welcome' && !sessionDirty) setShowcase(true);
  }, [profile]); // eslint-disable-line react-hooks/exhaustive-deps

  // Back to the showcase once the welcome screen has been left untouched,
  // through a full reset: the language, search and filters picked by the
  // previous visitor must not greet the next one.
  const showcaseIdleSeconds = profile?.showcase_idle_seconds || 45;
  const showcaseAllowed = profile?.showcase_enabled === true;
  useEffect(() => {
    if (!showcaseAllowed || showcase || reviewOpen || stage !== 'welcome' || sessionDirty) return;
    let timer = setTimeout(resetSession, showcaseIdleSeconds * 1000);
    const restart = () => {
      clearTimeout(timer);
      timer = setTimeout(resetSession, showcaseIdleSeconds * 1000);
    };
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart'];
    events.forEach(event => window.addEventListener(event, restart, { passive: true }));
    return () => {
      clearTimeout(timer);
      events.forEach(event => window.removeEventListener(event, restart));
    };
  }, [resetSession, reviewOpen, sessionDirty, showcase, showcaseAllowed, showcaseIdleSeconds, stage]);

  // An unattended tablet must recover by itself: keep retrying while the
  // kiosk is unavailable (network down, kiosk re-enabled later…).
  useEffect(() => {
    if (!fatal) return;
    const timer = setInterval(() => loadProfile(true), UNAVAILABLE_RETRY_MS);
    return () => clearInterval(timer);
  }, [fatal, loadProfile]);

  useEffect(() => {
    // A refreshed profile re-arms the idle timer, so never refresh while an
    // abandoned selection is still waiting to be cleared.
    if (fatal || stage !== 'welcome' || sessionDirty) return;
    const timer = setInterval(() => loadProfile(true), PROFILE_REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') loadProfile(true); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [fatal, loadProfile, sessionDirty, stage]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const catalogKey = JSON.stringify([debouncedQuery, category, brand, onlyAvailable, featuredOnly, sector, catalogReload]);

  useEffect(() => {
    if (!profile || stage !== 'catalog' || loadedCatalogKey.current === catalogKey) return;
    const requestId = ++catalogRequest.current;
    setCatalogLoading(true);
    setCatalogError('');
    KioskService.listPublicProducts(token, { search: debouncedQuery, category, brand, onlyAvailable, featuredOnly, sector, page: 0, pageSize: PAGE_SIZE })
      .then(data => {
        if (requestId !== catalogRequest.current) return;
        loadedCatalogKey.current = catalogKey;
        setProducts(data.products);
        setTotalProducts(data.total);
        setPage(0);
      })
      .catch(error => { if (requestId === catalogRequest.current) setCatalogError(describeKioskError(error, t)); })
      .finally(() => { if (requestId === catalogRequest.current) setCatalogLoading(false); });
    // `t` only changes with the profile language, which already re-runs this.
  }, [brand, catalogKey, category, debouncedQuery, featuredOnly, onlyAvailable, profile, sector, stage, token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (stage === 'catalog') {
      const y = catalogScroll.current;
      requestAnimationFrame(() => scrollToY(y));
    }
  }, [stage]);

  useEffect(() => {
    armIdleReset();
    const activity = () => armIdleReset();
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart'];
    events.forEach(event => window.addEventListener(event, activity, { passive: true }));
    return () => {
      events.forEach(event => window.removeEventListener(event, activity));
      clearIdleTimers();
    };
  }, [armIdleReset, clearIdleTimers]);

  const successSeconds = profile?.success_screen_seconds || 20;
  useEffect(() => {
    if (stage !== 'submitted') return;
    const deadline = Date.now() + successSeconds * 1000;
    const timer = setTimeout(resetSession, successSeconds * 1000);
    // Visible countdown, so the next customer knows the screen clears itself.
    const tick = () => setResetSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const ticker = setInterval(tick, 1000);
    return () => { clearTimeout(timer); clearInterval(ticker); };
  }, [successSeconds, resetSession, stage]);

  const changeQuantity = (product: KioskProduct, delta: number) => {
    setCart(current => {
      const existing = current[product.barcode]?.quantity || 0;
      const quantity = Math.min(999, Math.max(0, existing + delta));
      if (quantity === 0) {
        const next = { ...current };
        delete next[product.barcode];
        return next;
      }
      return { ...current, [product.barcode]: { product, quantity } };
    });
  };

  const setQuantity = (product: KioskProduct, value: number) => {
    const current = cart[product.barcode]?.quantity || 0;
    changeQuantity(product, Math.min(999, Math.max(0, value)) - current);
  };

  const loadMore = async () => {
    if (catalogLoading || products.length >= totalProducts) return;
    const requestId = ++catalogRequest.current;
    const nextPage = page + 1;
    setCatalogLoading(true);
    setCatalogError('');
    try {
      const data = await KioskService.listPublicProducts(token, {
        search: debouncedQuery, category, brand, onlyAvailable, featuredOnly, sector, page: nextPage, pageSize: PAGE_SIZE,
      });
      // Filters changed while this page was loading: it belongs to another list.
      if (requestId !== catalogRequest.current) return;
      setProducts(current => [...current, ...data.products]);
      setPage(nextPage);
    } catch (error) {
      if (requestId === catalogRequest.current) setCatalogError(describeKioskError(error, t));
    } finally {
      if (requestId === catalogRequest.current) setCatalogLoading(false);
    }
  };

  const retryCatalog = () => {
    if (products.length && loadedCatalogKey.current === catalogKey) loadMore();
    else setCatalogReload(value => value + 1);
  };

  const openReview = () => {
    catalogScroll.current = window.scrollY;
    setStage('review');
    scrollToY(0);
  };

  const submit = async () => {
    if (!cartLines.length || submitting) return;
    if (!deferring) {
      if (customer.name.trim().length < 2 || !customer.phone.trim()) {
        setFormError(t.required);
        return;
      }
      if (!isValidPhone(customer.phone)) {
        setFormError(t.invalidPhone);
        return;
      }
      if (profile?.require_email && !customer.email.trim()) {
        setFormError(t.emailRequired);
        return;
      }
      if (customer.email.trim() && !EMAIL_RE.test(customer.email.trim())) {
        setFormError(t.invalidEmail);
        return;
      }
    }
    setFormError('');
    setSubmitting(true);
    try {
      const submissionCustomer = deferring
        ? { name: '', phone: '', email: '', note: customer.note }
        : customer;
      const result = await KioskService.submit(token, submissionCustomer, cartLines.map(line => ({
        barcode: line.product.barcode, quantity: line.quantity,
      })), deferring);
      setRequestNumber(result.request_number);
      setStage('submitted');
    } catch (error) {
      setFormError(describeKioskError(error, t));
    } finally {
      setSubmitting(false);
    }
  };

  const selectCategory = (value: KioskCategory | null, featuredSelection = false) => {
    setCategory(value);
    setFeaturedOnly(featuredSelection);
  };

  const requestFullscreen = () => document.documentElement.requestFullscreen?.().catch(() => {});

  if (loading) return <KioskCentered><Loader2 className="h-10 w-10 animate-spin text-slate-400" /><p>{t.loading}</p></KioskCentered>;
  if (fatal || !profile) {
    const temporary = fatal?.kind !== 'gone';
    return (
      <KioskCentered>
        <WifiOff className="h-12 w-12 text-slate-400" />
        <h1 className="text-2xl font-bold">{t.unavailable}</h1>
        {temporary && <p className="max-w-md text-slate-500">{t.temporarilyUnavailable}</p>}
        <button onClick={() => loadProfile(false)} className="mt-2 min-h-14 rounded-2xl border-2 border-slate-300 bg-white px-8 text-lg font-bold">
          <RotateCcw className="inline h-5 w-5 me-2" />{t.retry}
        </button>
      </KioskCentered>
    );
  }

  const sendButton = (
    <button onClick={submit} disabled={!cartLines.length || submitting || !online} className="min-h-16 w-full rounded-2xl px-6 text-xl font-bold disabled:opacity-40 active:scale-[0.99]" style={{ backgroundColor: accent, color: onAccent }}>
      {submitting ? <Loader2 className="mx-auto h-7 w-7 animate-spin" /> : <><Check className="inline h-6 w-6 me-2" />{t.confirm}</>}
    </button>
  );

  const activeFilterCount = (sector ? 1 : 0) + (brand ? 1 : 0) + (onlyAvailable ? 1 : 0);
  const clearFilters = () => { selectCategory(null); setSector(null); setBrand(''); setOnlyAvailable(false); };
  const sectorName = (id: string) => { const item = sectors.find(s => s.id === id); return item ? sectorLabel(item, language) : ''; };

  return (
    <div dir={dir} className="min-h-screen bg-slate-50 text-slate-900 select-none" style={{ '--kiosk-accent': accent, '--kiosk-on-accent': onAccent } as CSSProperties}>
      {!online && (
        <div className="fixed inset-x-0 top-0 z-[70] flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-sm font-semibold text-white">
          <WifiOff className="h-4 w-4" /> {t.offline}
        </div>
      )}

      {stage === 'welcome' && showcase && showcaseAllowed && (
        <KioskShowcase
          profile={profile} language={language} languages={customerLanguages} accent={accent} onAccent={onAccent}
          onLanguage={setChosenLanguage}
          onStart={() => { setShowcase(false); setStage('catalog'); }}
          onReview={() => setReviewOpen(true)}
        />
      )}

      {stage === 'welcome' && !(showcase && showcaseAllowed) && (
        <main className="relative min-h-screen flex flex-col items-center justify-center px-6 py-16 text-center bg-gradient-to-br from-white via-slate-50 to-slate-100">
          {/* Staff control, kept out of the customer's way. */}
          <button onClick={requestFullscreen} className="absolute top-5 end-5 h-12 w-12 rounded-2xl flex items-center justify-center text-slate-300 active:bg-slate-100" aria-label="Fullscreen">
            <Expand className="h-5 w-5" />
          </button>
          {customerLanguages.length > 1 && (
            <div role="group" aria-label={t.language} className="absolute top-5 start-5 flex items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
              <Languages className="mx-2 h-5 w-5 text-slate-400" />
              {customerLanguages.map(code => <button key={code} lang={code} onClick={() => setChosenLanguage(code)} aria-pressed={language === code} className={`min-h-11 rounded-xl px-3 text-base font-bold ${language === code ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>{LANGUAGE_NAMES[code]}</button>)}
            </div>
          )}
          {profile.logo_url ? <img src={profile.logo_url} alt={profile.company_name} className="mb-8 h-28 w-56 object-contain" /> : <div className="mb-8 h-24 w-24 rounded-3xl flex items-center justify-center shadow-xl" style={{ backgroundColor: accent, color: onAccent }}><Package className="h-12 w-12" /></div>}
          <p className="mb-3 text-lg font-semibold tracking-wide text-slate-500">{profile.company_name}</p>
          <h1 className="max-w-3xl text-4xl md:text-6xl font-black tracking-tight">{profile.greeting_title}</h1>
          <p className="mt-5 max-w-2xl text-xl md:text-2xl leading-relaxed text-slate-600">{profile.greeting_message}</p>
          <ol className="mt-10 grid w-full max-w-3xl gap-3 text-start sm:grid-cols-3">
            {[t.how1, t.how2, t.how3].map((step, i) => (
              <li key={step} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/80 p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-base font-black text-white">{i + 1}</span>
                <span className="text-base font-bold leading-snug text-slate-700">{step}</span>
              </li>
            ))}
          </ol>
          <button onClick={() => setStage('catalog')} className="mt-10 min-h-16 min-w-64 rounded-2xl px-10 text-xl font-bold shadow-xl active:scale-[0.98] transition" style={{ backgroundColor: accent, color: onAccent }}>
            {t.start} <ChevronRight className="inline h-6 w-6 ms-2 rtl:rotate-180" />
          </button>
          {reviewUrl && (
            <button onClick={() => setReviewOpen(true)} className="mt-4 inline-flex min-h-14 items-center gap-2 rounded-2xl border-2 border-slate-200 bg-white px-7 text-lg font-bold text-slate-700 shadow-sm active:scale-[0.98]">
              <Star className="h-5 w-5 fill-amber-400 text-amber-400" />{SHOWCASE_COPY[language].review}
            </button>
          )}
        </main>
      )}

      {stage === 'catalog' && (
        <div className="min-h-screen pb-[calc(6.5rem+env(safe-area-inset-bottom))]">
          {/* Compact sticky header: search and product type stay at hand,
              the other filters live in a panel so products fill the screen. */}
          <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
            <div className="mx-auto flex max-w-[1800px] items-center gap-2 px-3 pt-3 sm:gap-3">
              <button onClick={() => setStage('welcome')} aria-label={t.home} className="h-14 w-14 shrink-0 rounded-2xl border-2 border-slate-200 bg-white flex items-center justify-center"><ArrowLeft className="h-6 w-6 rtl:rotate-180" /></button>
              {profile.logo_url && <img src={profile.logo_url} alt="" className="hidden md:block h-10 w-24 object-contain" />}
              <div className="relative min-w-0 flex-1">
                <Search className="absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t.search} className="h-14 w-full rounded-2xl border-2 border-slate-200 bg-slate-50 ps-12 pe-12 text-lg outline-none focus:bg-white focus:border-slate-900" />
                {query && <button onClick={() => setQuery('')} aria-label={t.close} className="absolute end-2 top-1/2 h-10 w-10 -translate-y-1/2 flex items-center justify-center"><X className="h-5 w-5" /></button>}
              </div>
              <FiltersButton count={activeFilterCount} label={t.filters} onClick={() => setFiltersOpen(true)} />
              <div className="hidden xl:block ps-2"><Steps current={0} t={t} accent={accent} onAccent={onAccent} /></div>
            </div>
            <div className="mx-auto max-w-[1800px] overflow-x-auto px-3 py-2.5">
              <div role="group" aria-label={t.categories} className="flex min-w-max gap-2">
                <Chip active={!category && !featuredOnly} label={t.all} onClick={() => selectCategory(null)} />
                {featured.length > 0 && <Chip active={featuredOnly} label={`★ ${t.featured}`} onClick={() => selectCategory(null, true)} />}
                <Chip active={category === 'utensils'} label={t.utensils} onClick={() => selectCategory('utensils')} />
                <Chip active={category === 'furniture'} label={t.furniture} onClick={() => selectCategory('furniture')} />
                <Chip active={category === 'equipment'} label={t.equipment} onClick={() => selectCategory('equipment')} />
              </div>
            </div>
          </header>

          <main className="mx-auto max-w-[1800px] px-3 pt-3">
            <div className="mb-3 flex min-h-9 flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-slate-500">{totalProducts} {t.products}</p>
              {sector && <ActivePill label={sectorName(sector)} onRemove={() => setSector(null)} removeLabel={t.remove} />}
              {brand && <ActivePill label={brand} onRemove={() => setBrand('')} removeLabel={t.remove} />}
              {onlyAvailable && <ActivePill label={t.availableOnly} onRemove={() => setOnlyAvailable(false)} removeLabel={t.remove} />}
              {(category || featuredOnly || activeFilterCount > 0) && <button onClick={clearFilters} className="min-h-9 rounded-lg px-2 text-sm font-bold text-slate-500 underline-offset-2 active:bg-slate-100">{t.clearFilters}</button>}
              {catalogLoading && <Loader2 className="ms-auto h-5 w-5 animate-spin" style={{ color: accent }} />}
            </div>
            {catalogError && (
              <div role="alert" className="mb-3 flex flex-col gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-amber-900 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-3 font-semibold"><AlertTriangle className="h-6 w-6 shrink-0" />{products.length ? catalogError : `${t.catalogError} ${catalogError}`}</p>
                <button onClick={retryCatalog} disabled={catalogLoading} className="min-h-12 shrink-0 rounded-xl bg-amber-600 px-6 font-bold text-white disabled:opacity-50"><RotateCcw className="inline h-5 w-5 me-2" />{t.retry}</button>
              </div>
            )}
            {!catalogLoading && !catalogError && products.length === 0 ? (
              <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-white py-24 text-center"><Search className="mx-auto h-12 w-12 text-slate-300" /><p className="mt-4 text-xl font-semibold text-slate-500">{t.noProducts}</p></div>
            ) : (
              <div data-testid="kiosk-grid" className={`grid gap-2.5 ${GRID_CLASSES[profile.grid_columns] || GRID_CLASSES[0]}`}>
                {products.map(product => (
                  <ProductCard
                    key={product.barcode} product={product} quantity={cart[product.barcode]?.quantity || 0}
                    showPrice={profile.show_prices} showAvailability={profile.show_availability} placeholderLogo={profile.logo_url}
                    t={t} accent={accent}
                    onOpen={() => setSelectedProduct(product)} onZoom={() => setZoomProduct(product)}
                    onChange={delta => changeQuantity(product, delta)}
                  />
                ))}
              </div>
            )}
            {products.length < totalProducts && <button onClick={loadMore} disabled={catalogLoading} className="mx-auto mt-6 flex min-h-14 min-w-52 items-center justify-center rounded-2xl border-2 border-slate-300 bg-white px-8 text-lg font-bold disabled:opacity-50">{catalogLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : t.loadMore}</button>}
          </main>

          <FiltersPanel
            open={filtersOpen} title={t.filters} closeLabel={t.close}
            onClose={() => setFiltersOpen(false)} onReset={clearFilters}
            resetLabel={t.clearFilters} showLabel={withCount(t.showResults, totalProducts)}
          >
            {sectors.length > 0 && (
              <FilterGroup label={t.sector}>
                <Chip active={!sector} label={t.allSectors} onClick={() => setSector(null)} />
                {sectors.map(item => <Chip key={item.id} active={sector === item.id} label={sectorLabel(item, language)} onClick={() => setSector(item.id)} />)}
              </FilterGroup>
            )}
            {brands.length > 0 && (
              <FilterGroup label={t.brand}>
                <Chip active={!brand} label={t.allBrands} onClick={() => setBrand('')} />
                {brands.map(value => <Chip key={value} active={brand === value} label={value} onClick={() => setBrand(value)} />)}
              </FilterGroup>
            )}
            <label className="flex min-h-14 cursor-pointer items-center justify-between gap-4 rounded-2xl border-2 border-slate-200 px-4 text-base font-bold">
              {t.availableOnly}
              <input type="checkbox" checked={onlyAvailable} onChange={event => setOnlyAvailable(event.target.checked)} className="h-6 w-6 accent-slate-900" />
            </label>
          </FiltersPanel>

          {cartQuantity > 0 && <button onClick={openReview} className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-50 mx-auto flex min-h-16 max-w-2xl items-center justify-between rounded-2xl px-5 shadow-2xl active:scale-[0.99]" style={{ backgroundColor: accent, color: onAccent }}><span className="flex items-center gap-3 text-lg font-bold"><span className="h-10 min-w-10 rounded-xl bg-white/20 px-2 flex items-center justify-center">{cartQuantity}</span><ShoppingCart className="h-6 w-6" />{t.cart}</span>{profile.show_prices && <strong className="text-lg tabular-nums">{fmt(cartTotal)} DH</strong>}</button>}
        </div>
      )}

      {stage === 'review' && (
        <div className="min-h-screen">
          <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
            <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-3">
              <button onClick={() => setStage('catalog')} className="min-h-14 inline-flex items-center gap-2 rounded-2xl border-2 border-slate-200 bg-white px-4 text-base font-bold"><ArrowLeft className="h-5 w-5 rtl:rotate-180" /> {t.back}</button>
              <div className="hidden sm:block"><Steps current={1} t={t} accent={accent} onAccent={onAccent} /></div>
            </div>
          </header>
          {/* Landscape: selection on the left, details and sending on the right.
              Vertical screens: one column with the send button pinned below. */}
          <main className={`mx-auto max-w-[1400px] p-4 md:p-6 ${wideReview ? 'grid grid-cols-[minmax(0,1fr)_460px] items-start gap-6' : 'pb-[calc(9rem+env(safe-area-inset-bottom))]'}`}>
            <section>
              <h1 className="text-3xl md:text-4xl font-black">{t.review}</h1>
              <p className="mt-1 text-base font-semibold text-slate-500">{t.selection} · {cartQuantity} {t.items}</p>
              <div className="mt-5 space-y-2.5">
                {cartLines.map(line => <ReviewLine key={line.product.barcode} line={line} showPrice={profile.show_prices} placeholderLogo={profile.logo_url} accent={accent} removeLabel={t.remove} zoomLabel={t.zoom} onSet={quantity => setQuantity(line.product, quantity)} onZoom={() => setZoomProduct(line.product)} />)}
              </div>
              {!cartLines.length && <div className="mt-5 rounded-2xl bg-white p-12 text-center text-lg text-slate-500">{t.empty}</div>}
            </section>

            <aside className={wideReview ? 'sticky top-24 flex max-h-[calc(100vh-7.5rem)] flex-col gap-4' : 'mt-6 space-y-4'}>
              <section className={`rounded-3xl border border-slate-200 bg-white p-5 ${wideReview ? 'min-h-0 overflow-y-auto' : ''}`}>
                <div className="flex items-center gap-3"><div className="h-11 w-11 shrink-0 rounded-2xl bg-slate-900 text-white flex items-center justify-center"><UserRound className="h-5 w-5" /></div><h2 className="text-xl font-black">{t.details}</h2></div>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{t.contactPrompt}</p>
                <div className={`mt-4 grid gap-4 sm:grid-cols-2 ${deferring ? 'opacity-45' : ''}`}>
                  <KioskInput label={t.name} value={customer.name} onChange={name => { setCustomer(c => ({ ...c, name })); setFormError(''); }} required={!deferring} disabled={deferring} />
                  <KioskInput label={t.phone} value={customer.phone} onChange={phone => { setCustomer(c => ({ ...c, phone })); setFormError(''); }} required={!deferring} disabled={deferring} inputMode="tel" />
                  <div className={wideReview ? 'sm:col-span-2' : ''}><KioskInput label={t.email} value={customer.email} onChange={email => { setCustomer(c => ({ ...c, email })); setFormError(''); }} required={!deferring && profile.require_email} disabled={deferring} inputMode="email" /></div>
                </div>
                <label className="mt-4 block"><span className="mb-1.5 block text-base font-bold">{t.note}</span><textarea value={customer.note} onChange={e => setCustomer(c => ({ ...c, note: e.target.value.slice(0, 500) }))} rows={2} className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-lg outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-900/10" /></label>
                {canDeferContact && (
                  <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl p-1">
                    <input type="checkbox" checked={deferContact} onChange={event => { setDeferContact(event.target.checked); setFormError(''); }} className="mt-0.5 h-6 w-6 shrink-0 accent-slate-900" />
                    <span><span className="block text-sm font-bold text-slate-700">{t.detailsLater}</span><span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{t.detailsLaterHelp}</span></span>
                  </label>
                )}
                <p className="mt-4 text-xs leading-relaxed text-slate-400">{t.privacy}</p>
              </section>

              {wideReview ? (
                <section className="shrink-0 rounded-3xl border border-slate-200 bg-white p-5">
                  {profile.show_prices && <div className="flex items-center justify-between text-xl font-black"><span>{t.total}</span><span className="tabular-nums">{fmt(cartTotal)} DH</span></div>}
                  <p className={`${profile.show_prices ? 'mt-2' : ''} text-xs leading-relaxed text-slate-500`}>{t.nonBinding}</p>
                  {formError && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 font-semibold text-red-700">{formError}</p>}
                  <div className="mt-4">{sendButton}</div>
                </section>
              ) : (
                <p className="px-1 text-xs leading-relaxed text-slate-500">{t.nonBinding}</p>
              )}
            </aside>
          </main>

          {!wideReview && (
            <div className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur">
              <div className="mx-auto max-w-3xl">
                {formError && <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 font-semibold text-red-700">{formError}</p>}
                <div className="flex items-center gap-4">
                  {profile.show_prices && <div className="shrink-0"><p className="text-xs font-bold uppercase text-slate-500">{t.total}</p><p className="text-xl font-black tabular-nums">{fmt(cartTotal)} DH</p></div>}
                  <div className="flex-1">{sendButton}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {stage === 'submitted' && (
        <main className="min-h-screen flex items-center justify-center p-6 text-center">
          <section className="w-full max-w-2xl rounded-3xl bg-white p-8 md:p-12 shadow-xl border border-slate-200">
            <div className="mx-auto mb-6 flex justify-center"><Steps current={2} t={t} accent={accent} onAccent={onAccent} /></div>
            <div className="mx-auto h-24 w-24 rounded-full flex items-center justify-center" style={{ backgroundColor: accent, color: onAccent }}><Check className="h-12 w-12" /></div>
            <h1 className="mt-7 text-4xl font-black">{t.requestSent}</h1>
            <p className="mt-4 text-xl leading-relaxed text-slate-600">{t.requestMessage}</p>
            <div className="mx-auto mt-8 max-w-md rounded-2xl bg-slate-100 p-6"><p className="text-sm font-bold uppercase tracking-wider text-slate-500">{t.requestNumber}</p><p className="mt-2 text-3xl font-black tracking-wide">{requestNumber}</p></div>
            {reviewUrl && <ReviewInvite url={reviewUrl} language={language} />}
            <button onClick={resetSession} className="mt-8 min-h-14 rounded-2xl px-8 text-lg font-bold" style={{ backgroundColor: accent, color: onAccent }}><RotateCcw className="inline h-5 w-5 me-2" />{t.reset}</button>
            <p className="mt-4 text-sm font-semibold text-slate-400" aria-live="off">{withCount(t.resetIn, resetSecondsLeft)}</p>
            <div className="mx-auto mt-2 h-1 max-w-xs overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-slate-300 transition-[width] duration-1000 ease-linear" style={{ width: `${(resetSecondsLeft / successSeconds) * 100}%` }} />
            </div>
          </section>
        </main>
      )}

      {selectedProduct && <ProductDialog product={selectedProduct} quantity={cart[selectedProduct.barcode]?.quantity || 0} showPrice={profile.show_prices} showAvailability={profile.show_availability} placeholderLogo={profile.logo_url} t={t} accent={accent} onClose={() => setSelectedProduct(null)} onZoom={() => setZoomProduct(selectedProduct)} onChange={delta => changeQuantity(selectedProduct, delta)} />}

      {zoomProduct && <ImageViewer product={zoomProduct} t={t} onClose={() => setZoomProduct(null)} />}

      {reviewOpen && reviewUrl && <KioskReviewPage url={reviewUrl} language={language} accent={accent} onAccent={onAccent} onClose={() => setReviewOpen(false)} />}

      {idleWarning && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/65 p-5 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl bg-white p-8 text-center shadow-2xl"><div aria-live="polite" className="mx-auto flex h-24 w-24 items-center justify-center rounded-full border-4 border-amber-400 text-4xl font-black tabular-nums text-amber-600">{idleSecondsLeft}<span className="ms-0.5 text-lg">{t.seconds}</span></div><h2 className="mt-5 text-3xl font-black">{t.idleTitle}</h2><p className="mt-3 text-lg text-slate-600">{t.idleText}</p><button onClick={armIdleReset} className="mt-7 min-h-14 w-full rounded-2xl text-lg font-bold" style={{ backgroundColor: accent, color: onAccent }}>{t.stay}</button></div>
        </div>
      )}
    </div>
  );
}

function ActivePill({ label, onRemove, removeLabel }: { label: string; onRemove: () => void; removeLabel: string }) {
  return (
    <span className="inline-flex min-h-9 items-center gap-1 rounded-full bg-slate-900 ps-3 pe-1 text-sm font-bold text-white">
      {label}
      <button onClick={onRemove} aria-label={`${removeLabel} ${label}`} className="flex h-7 w-7 items-center justify-center rounded-full active:bg-white/20"><X className="h-4 w-4" /></button>
    </span>
  );
}

function KioskCentered({ children }: { children: ReactNode }) {
  return <main className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-center text-slate-600">{children}</main>;
}
