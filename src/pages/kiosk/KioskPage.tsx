import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import {
  ArrowLeft, Check, ChevronRight, Expand, Loader2,
  Minus, Package, Plus, RotateCcw, Search, ShoppingCart, UserRound, WifiOff, X,
} from 'lucide-react';
import {
  KioskService, type KioskCategory, type KioskLanguage, type KioskProduct, type KioskPublicProfile,
} from '../../utils/kioskService';

type Stage = 'welcome' | 'catalog' | 'review' | 'submitted';
type CartLine = { product: KioskProduct; quantity: number };

const copy = {
  fr: {
    start: 'Commencer', details: 'Vos coordonnées', name: 'Nom complet', phone: 'Téléphone', email: 'E-mail',
    note: 'Précision sur votre demande (facultatif)', continue: 'Ouvrir le catalogue', search: 'Rechercher un produit, une marque ou une référence…',
    all: 'Tous', add: 'Ajouter', cart: 'Voir ma demande', products: 'produits', review: 'Vérifier la demande',
    confirm: 'Envoyer la demande', back: 'Retour au catalogue', requestSent: 'Demande envoyée',
    requestMessage: 'Un conseiller vérifiera votre sélection avant de préparer le devis.', requestNumber: 'Numéro de demande',
    reset: 'Nouvelle demande', required: 'Veuillez renseigner votre nom et votre téléphone.', emailRequired: "L'adresse e-mail est obligatoire.",
    invalidPhone: 'Veuillez saisir un numéro de téléphone valide.', invalidEmail: 'Veuillez saisir une adresse e-mail valide.',
    contactPrompt: 'Indiquez vos coordonnées avant l’envoi, ou demandez à un conseiller de les compléter avec vous.',
    detailsLater: 'Je renseignerai mes coordonnées plus tard', detailsLaterHelp: 'La demande sera enregistrée, mais un conseiller devra compléter vos coordonnées avant de créer le devis.',
    empty: 'Votre sélection est vide.', noProducts: 'Aucun produit ne correspond à votre recherche.', loadMore: 'Afficher plus',
    available: 'Disponible', onRequest: 'Sur demande', total: 'Total indicatif', nonBinding: "Cette demande n'est pas encore un devis. Les prix et disponibilités seront confirmés par un conseiller.",
    idleTitle: 'Toujours là ?', idleText: 'Cette session sera effacée dans quelques secondes pour protéger vos informations.', stay: 'Continuer',
    offline: 'Connexion interrompue — votre sélection reste affichée.', loading: 'Chargement du kiosque…', unavailable: 'Ce kiosque est indisponible.',
    privacy: 'Vos coordonnées servent uniquement au traitement de cette demande de devis.',
    categories: 'Type de produit', utensils: 'Ustensiles', furniture: 'Mobilier', equipment: 'Équipement',
    allBrands: 'Toutes les marques', availableOnly: 'Disponibles uniquement', clearFilters: 'Réinitialiser les filtres',
  },
  en: {
    start: 'Start', details: 'Your details', name: 'Full name', phone: 'Phone', email: 'Email',
    note: 'Request details (optional)', continue: 'Open catalogue', search: 'Search product, brand or reference…',
    all: 'All', add: 'Add', cart: 'View request', products: 'products', review: 'Review request',
    confirm: 'Send request', back: 'Back to catalogue', requestSent: 'Request sent',
    requestMessage: 'A sales representative will review your selection before preparing the quote.', requestNumber: 'Request number',
    reset: 'New request', required: 'Please enter your name and phone number.', emailRequired: 'Email is required.',
    invalidPhone: 'Please enter a valid phone number.', invalidEmail: 'Please enter a valid email address.',
    contactPrompt: 'Enter your contact details before sending, or ask a sales representative to complete them with you.',
    detailsLater: 'I will provide my details later', detailsLaterHelp: 'The request will be saved, but a sales representative must complete your details before creating the quote.',
    empty: 'Your selection is empty.', noProducts: 'No products match your search.', loadMore: 'Show more',
    available: 'Available', onRequest: 'On request', total: 'Estimated total', nonBinding: 'This is not a final quote. Prices and availability will be confirmed by a sales representative.',
    idleTitle: 'Still there?', idleText: 'This session will be cleared in a few seconds to protect your information.', stay: 'Continue',
    offline: 'Connection lost — your selection is still displayed.', loading: 'Loading kiosk…', unavailable: 'This kiosk is unavailable.',
    privacy: 'Your contact details are used only to process this quote request.',
    categories: 'Product type', utensils: 'Utensils', furniture: 'Furniture', equipment: 'Equipment',
    allBrands: 'All brands', availableOnly: 'Available only', clearFilters: 'Reset filters',
  },
  ar: {
    start: 'ابدأ', details: 'معلوماتك', name: 'الاسم الكامل', phone: 'الهاتف', email: 'البريد الإلكتروني',
    note: 'تفاصيل الطلب (اختياري)', continue: 'فتح الكتالوج', search: 'ابحث عن منتج أو علامة أو مرجع…',
    all: 'الكل', add: 'إضافة', cart: 'عرض الطلب', products: 'منتجات', review: 'مراجعة الطلب',
    confirm: 'إرسال الطلب', back: 'العودة إلى الكتالوج', requestSent: 'تم إرسال الطلب',
    requestMessage: 'سيراجع مستشار المبيعات اختيارك قبل إعداد عرض السعر.', requestNumber: 'رقم الطلب',
    reset: 'طلب جديد', required: 'يرجى إدخال الاسم ورقم الهاتف.', emailRequired: 'البريد الإلكتروني مطلوب.',
    invalidPhone: 'يرجى إدخال رقم هاتف صالح.', invalidEmail: 'يرجى إدخال بريد إلكتروني صالح.',
    contactPrompt: 'أدخل معلومات الاتصال قبل الإرسال، أو اطلب من مستشار المبيعات إكمالها معك.',
    detailsLater: 'سأضيف معلومات الاتصال لاحقاً', detailsLaterHelp: 'سيتم حفظ الطلب، لكن يجب على مستشار المبيعات إكمال معلوماتك قبل إنشاء عرض السعر.',
    empty: 'اختيارك فارغ.', noProducts: 'لا توجد منتجات مطابقة.', loadMore: 'عرض المزيد',
    available: 'متوفر', onRequest: 'حسب الطلب', total: 'المجموع التقديري', nonBinding: 'هذا ليس عرض سعر نهائياً. سيتم تأكيد الأسعار والتوفر من طرف المستشار.',
    idleTitle: 'هل ما زلت هنا؟', idleText: 'سيتم مسح هذه الجلسة خلال ثوانٍ لحماية معلوماتك.', stay: 'متابعة',
    offline: 'انقطع الاتصال — ما زال اختيارك ظاهراً.', loading: 'جارٍ تحميل الكشك…', unavailable: 'هذا الكشك غير متاح.',
    privacy: 'تُستخدم معلومات الاتصال فقط لمعالجة طلب عرض السعر.',
    categories: 'نوع المنتج', utensils: 'أدوات', furniture: 'أثاث', equipment: 'معدات',
    allBrands: 'كل العلامات التجارية', availableOnly: 'المتوفر فقط', clearFilters: 'إعادة ضبط الفلاتر',
  },
} as const;

type KioskCopy = Record<keyof typeof copy.fr, string>;

const fmt = (value: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9\s().-]{7,24}$/;

const isValidPhone = (value: string) => {
  const normalized = value.trim();
  const digitCount = normalized.replace(/\D/g, '').length;
  return PHONE_RE.test(normalized) && digitCount >= 7 && digitCount <= 15;
};

export default function KioskPage() {
  const { token = '' } = useParams();
  const [profile, setProfile] = useState<KioskPublicProfile | null>(null);
  const [brands, setBrands] = useState<string[]>([]);
  const [stage, setStage] = useState<Stage>('welcome');
  const [customer, setCustomer] = useState({ name: '', phone: '', email: '', note: '' });
  const [deferContact, setDeferContact] = useState(false);
  const [formError, setFormError] = useState('');
  const [products, setProducts] = useState<KioskProduct[]>([]);
  const [totalProducts, setTotalProducts] = useState(0);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [category, setCategory] = useState<KioskCategory | null>(null);
  const [brand, setBrand] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [selectedProduct, setSelectedProduct] = useState<KioskProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fatalError, setFatalError] = useState('');
  const [requestNumber, setRequestNumber] = useState('');
  const [idleWarning, setIdleWarning] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const idleWarningTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const language: KioskLanguage = profile?.language || 'fr';
  const t = copy[language];
  const dir = language === 'ar' ? 'rtl' : 'ltr';
  const accent = profile?.accent_color || '#2563eb';

  const clearIdleTimers = useCallback(() => {
    if (idleWarningTimer.current) clearTimeout(idleWarningTimer.current);
    if (idleResetTimer.current) clearTimeout(idleResetTimer.current);
  }, []);

  const resetSession = useCallback(() => {
    clearIdleTimers();
    setCustomer({ name: '', phone: '', email: '', note: '' });
    setDeferContact(false);
    setCart({});
    setQuery('');
    setCategory(null);
    setBrand('');
    setOnlyAvailable(false);
    setSelectedProduct(null);
    setRequestNumber('');
    setIdleWarning(false);
    setFormError('');
    setStage('welcome');
  }, [clearIdleTimers]);

  const armIdleReset = useCallback(() => {
    clearIdleTimers();
    setIdleWarning(false);
    if (!profile || stage === 'welcome' || stage === 'submitted') return;
    const totalMs = profile.inactivity_timeout_seconds * 1000;
    const warningMs = Math.max(10_000, totalMs - 20_000);
    idleWarningTimer.current = setTimeout(() => setIdleWarning(true), warningMs);
    idleResetTimer.current = setTimeout(resetSession, totalMs);
  }, [clearIdleTimers, profile, resetSession, stage]);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    KioskService.loadPublic(token)
      .then(data => {
        if (cancelled) return;
        setProfile(data.profile);
        setBrands(data.brands || []);
      })
      .catch(error => { if (!cancelled) setFatalError(error instanceof Error ? error.message : 'Kiosk unavailable'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!profile || stage !== 'catalog') return;
    let cancelled = false;
    setCatalogLoading(true);
    setPage(0);
    KioskService.listPublicProducts(token, { search: debouncedQuery, category, brand, onlyAvailable, page: 0, pageSize: 48 })
      .then(data => {
        if (cancelled) return;
        setProducts(data.products);
        setTotalProducts(data.total);
      })
      .catch(error => { if (!cancelled) setFatalError(error instanceof Error ? error.message : 'Catalogue unavailable'); })
      .finally(() => { if (!cancelled) setCatalogLoading(false); });
    return () => { cancelled = true; };
  }, [brand, category, debouncedQuery, onlyAvailable, profile, stage, token]);

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

  useEffect(() => {
    if (stage !== 'submitted') return;
    const timer = setTimeout(resetSession, 20_000);
    return () => clearTimeout(timer);
  }, [resetSession, stage]);

  const cartLines = useMemo(() => Object.values(cart), [cart]);
  const cartQuantity = useMemo(() => cartLines.reduce((sum, line) => sum + line.quantity, 0), [cartLines]);
  const cartTotal = useMemo(() => cartLines.reduce((sum, line) => sum + (line.product.price || 0) * line.quantity, 0), [cartLines]);

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
    const nextPage = page + 1;
    setCatalogLoading(true);
    try {
      const data = await KioskService.listPublicProducts(token, {
        search: debouncedQuery, category, brand, onlyAvailable, page: nextPage, pageSize: 48,
      });
      setProducts(current => [...current, ...data.products]);
      setPage(nextPage);
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : 'Catalogue unavailable');
    } finally {
      setCatalogLoading(false);
    }
  };

  const submit = async () => {
    if (!cartLines.length || submitting) return;
    if (!deferContact) {
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
      const submissionCustomer = deferContact
        ? { name: '', phone: '', email: '', note: customer.note }
        : customer;
      const result = await KioskService.submit(token, submissionCustomer, cartLines.map(line => ({
        barcode: line.product.barcode, quantity: line.quantity,
      })), deferContact);
      setRequestNumber(result.request_number);
      setStage('submitted');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  const requestFullscreen = () => document.documentElement.requestFullscreen?.().catch(() => {});

  if (loading) return <KioskCentered><Loader2 className="h-10 w-10 animate-spin text-slate-400" /><p>{t.loading}</p></KioskCentered>;
  if (fatalError || !profile) return <KioskCentered><WifiOff className="h-12 w-12 text-slate-400" /><h1 className="text-2xl font-bold">{t.unavailable}</h1><p className="text-slate-500">{fatalError}</p></KioskCentered>;

  return (
    <div dir={dir} className="min-h-screen bg-slate-50 text-slate-900 select-none" style={{ '--kiosk-accent': accent } as CSSProperties}>
      {!online && (
        <div className="fixed inset-x-0 top-0 z-[70] flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-sm font-semibold text-white">
          <WifiOff className="h-4 w-4" /> {t.offline}
        </div>
      )}

      {stage === 'welcome' && (
        <main className="min-h-screen flex flex-col items-center justify-center px-6 py-12 text-center bg-gradient-to-br from-white via-slate-50 to-slate-100">
          <button onClick={requestFullscreen} className="absolute top-5 end-5 h-12 w-12 rounded-2xl bg-white shadow-sm border border-slate-200 flex items-center justify-center" aria-label="Fullscreen">
            <Expand className="h-5 w-5" />
          </button>
          {profile.logo_url ? <img src={profile.logo_url} alt={profile.company_name} className="mb-8 h-28 w-56 object-contain" /> : <div className="mb-8 h-24 w-24 rounded-3xl flex items-center justify-center text-white shadow-xl" style={{ backgroundColor: accent }}><Package className="h-12 w-12" /></div>}
          <p className="mb-3 text-lg font-semibold tracking-wide text-slate-500">{profile.company_name}</p>
          <h1 className="max-w-3xl text-4xl md:text-6xl font-black tracking-tight">{profile.greeting_title}</h1>
          <p className="mt-5 max-w-2xl text-xl md:text-2xl leading-relaxed text-slate-600">{profile.greeting_message}</p>
          <button onClick={() => setStage('catalog')} className="mt-12 min-h-16 min-w-64 rounded-2xl px-10 text-xl font-bold text-white shadow-xl active:scale-[0.98] transition" style={{ backgroundColor: accent }}>
            {t.start} <ChevronRight className="inline h-6 w-6 ms-2" />
          </button>
        </main>
      )}

      {stage === 'catalog' && (
        <div className="min-h-screen pb-28">
          <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
            <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-3">
              <button onClick={() => setStage('welcome')} className="h-12 w-12 shrink-0 rounded-xl border border-slate-200 flex items-center justify-center"><ArrowLeft className="h-5 w-5" /></button>
              {profile.logo_url ? <img src={profile.logo_url} alt="" className="hidden sm:block h-10 w-28 object-contain" /> : <Package className="hidden sm:block h-8 w-8" style={{ color: accent }} />}
              <div className="relative flex-1"><Search className="absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder={t.search} className="h-14 w-full rounded-2xl border-2 border-slate-200 bg-slate-50 ps-12 pe-12 text-lg outline-none focus:bg-white focus:border-[var(--kiosk-accent)]" />{query && <button onClick={() => setQuery('')} className="absolute end-2 top-1/2 h-10 w-10 -translate-y-1/2 flex items-center justify-center"><X className="h-5 w-5" /></button>}</div>
              <button onClick={requestFullscreen} className="hidden sm:flex h-12 w-12 rounded-xl border border-slate-200 items-center justify-center"><Expand className="h-5 w-5" /></button>
            </div>
            <div className="mx-auto max-w-[1600px] px-4 pb-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">{t.categories}</p>
              <div className="overflow-x-auto"><div className="flex min-w-max gap-2">
                <FilterButton active={!category} label={t.all} onClick={() => setCategory(null)} accent={accent} />
                <FilterButton active={category === 'utensils'} label={t.utensils} onClick={() => setCategory('utensils')} accent={accent} />
                <FilterButton active={category === 'furniture'} label={t.furniture} onClick={() => setCategory('furniture')} accent={accent} />
                <FilterButton active={category === 'equipment'} label={t.equipment} onClick={() => setCategory('equipment')} accent={accent} />
              </div></div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <select aria-label={t.allBrands} value={brand} onChange={event => setBrand(event.target.value)} className="min-h-12 flex-1 rounded-xl border-2 border-slate-200 bg-white px-4 text-base font-semibold outline-none focus:border-[var(--kiosk-accent)]">
                  <option value="">{t.allBrands}</option>
                  {brands.map(value => <option key={value} value={value}>{value}</option>)}
                </select>
                <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border-2 border-slate-200 bg-white px-4 font-semibold">
                  <input type="checkbox" checked={onlyAvailable} onChange={event => setOnlyAvailable(event.target.checked)} className="h-5 w-5" />
                  {t.availableOnly}
                </label>
                {(category || brand || onlyAvailable) && <button onClick={() => { setCategory(null); setBrand(''); setOnlyAvailable(false); }} className="min-h-12 rounded-xl px-4 text-sm font-bold text-slate-500 active:bg-slate-100">{t.clearFilters}</button>}
              </div>
            </div>
          </header>

          <main className="mx-auto max-w-[1600px] p-4 md:p-6">
            <div className="mb-4 flex items-center justify-between"><p className="text-sm font-semibold text-slate-500">{totalProducts} {t.products}</p>{catalogLoading && <Loader2 className="h-5 w-5 animate-spin" style={{ color: accent }} />}</div>
            {!catalogLoading && products.length === 0 ? (
              <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-white py-24 text-center"><Search className="mx-auto h-12 w-12 text-slate-300" /><p className="mt-4 text-xl font-semibold text-slate-500">{t.noProducts}</p></div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {products.map(product => <ProductCard key={product.barcode} product={product} quantity={cart[product.barcode]?.quantity || 0} showPrice={profile.show_prices} showAvailability={profile.show_availability} placeholderLogo={profile.logo_url} t={t} accent={accent} onOpen={() => setSelectedProduct(product)} onChange={delta => changeQuantity(product, delta)} />)}
              </div>
            )}
            {products.length < totalProducts && <button onClick={loadMore} disabled={catalogLoading} className="mx-auto mt-8 flex min-h-14 min-w-52 items-center justify-center rounded-2xl border-2 border-slate-300 bg-white px-8 text-lg font-bold disabled:opacity-50">{catalogLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : t.loadMore}</button>}
          </main>

          {cartQuantity > 0 && <button onClick={() => setStage('review')} className="fixed bottom-4 start-1/2 z-50 flex min-h-16 w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 items-center justify-between rounded-2xl px-5 text-white shadow-2xl active:scale-[0.99]" style={{ backgroundColor: accent }}><span className="flex items-center gap-3 text-lg font-bold"><span className="h-10 min-w-10 rounded-xl bg-white/20 px-2 flex items-center justify-center">{cartQuantity}</span><ShoppingCart className="h-6 w-6" />{t.cart}</span>{profile.show_prices && <strong className="text-lg">{fmt(cartTotal)} DH</strong>}</button>}
        </div>
      )}

      {stage === 'review' && (
        <main className="mx-auto min-h-screen max-w-5xl p-4 pb-32 md:p-8">
          <button onClick={() => setStage('catalog')} className="mb-6 min-h-12 inline-flex items-center gap-2 rounded-xl bg-white border border-slate-200 px-4 font-semibold"><ArrowLeft className="h-5 w-5" /> {t.back}</button>
          <h1 className="text-3xl md:text-4xl font-black">{t.review}</h1>
          <div className="mt-8 space-y-3">
            {cartLines.map(line => <ReviewLine key={line.product.barcode} line={line} showPrice={profile.show_prices} placeholderLogo={profile.logo_url} accent={accent} onSet={quantity => setQuantity(line.product, quantity)} />)}
          </div>
          {!cartLines.length && <div className="mt-8 rounded-2xl bg-white p-12 text-center text-lg text-slate-500">{t.empty}</div>}
          <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-5 md:p-7">
            <div className="flex items-center gap-4"><div className="h-12 w-12 shrink-0 rounded-2xl flex items-center justify-center text-white" style={{ backgroundColor: accent }}><UserRound className="h-6 w-6" /></div><div><h2 className="text-2xl font-black">{t.details}</h2><p className="mt-1 text-slate-500">{t.contactPrompt}</p></div></div>
            <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-slate-200 bg-slate-50 p-4">
              <input type="checkbox" checked={deferContact} onChange={event => { setDeferContact(event.target.checked); setFormError(''); }} className="mt-1 h-6 w-6 shrink-0" />
              <span><span className="block text-base font-bold">{t.detailsLater}</span><span className="mt-1 block text-sm leading-relaxed text-slate-500">{t.detailsLaterHelp}</span></span>
            </label>
            <div className={`mt-6 grid gap-5 md:grid-cols-2 ${deferContact ? 'opacity-45' : ''}`}>
              <KioskInput label={t.name} value={customer.name} onChange={name => { setCustomer(c => ({ ...c, name })); setFormError(''); }} required={!deferContact} disabled={deferContact} autoFocus={!deferContact} />
              <KioskInput label={t.phone} value={customer.phone} onChange={phone => { setCustomer(c => ({ ...c, phone })); setFormError(''); }} required={!deferContact} disabled={deferContact} inputMode="tel" />
              <KioskInput label={t.email} value={customer.email} onChange={email => { setCustomer(c => ({ ...c, email })); setFormError(''); }} required={!deferContact && profile.require_email} disabled={deferContact} inputMode="email" />
            </div>
            <label className="mt-5 block"><span className="mb-2 block text-base font-bold">{t.note}</span><textarea value={customer.note} onChange={e => setCustomer(c => ({ ...c, note: e.target.value.slice(0, 500) }))} rows={3} className="w-full rounded-2xl border-2 border-slate-200 bg-white px-5 py-4 text-lg outline-none focus:border-[var(--kiosk-accent)]" /></label>
            <p className="mt-5 text-sm leading-relaxed text-slate-500">{t.privacy}</p>
          </section>
          {formError && <p className="mt-5 rounded-xl bg-red-50 p-4 font-semibold text-red-700">{formError}</p>}
          <div className="mt-8 rounded-2xl bg-white border border-slate-200 p-5">
            {profile.show_prices && <div className="flex items-center justify-between text-xl font-black"><span>{t.total}</span><span>{fmt(cartTotal)} DH</span></div>}
            <p className={`${profile.show_prices ? 'mt-4' : ''} text-sm leading-relaxed text-slate-500`}>{t.nonBinding}</p>
          </div>
          <button onClick={submit} disabled={!cartLines.length || submitting || !online} className="mt-7 min-h-16 w-full rounded-2xl px-6 text-xl font-bold text-white disabled:opacity-40" style={{ backgroundColor: accent }}>{submitting ? <Loader2 className="mx-auto h-7 w-7 animate-spin" /> : <><Check className="inline h-6 w-6 me-2" />{t.confirm}</>}</button>
        </main>
      )}

      {stage === 'submitted' && (
        <main className="min-h-screen flex items-center justify-center p-6 text-center">
          <section className="w-full max-w-2xl rounded-3xl bg-white p-8 md:p-12 shadow-xl border border-slate-200">
            <div className="mx-auto h-24 w-24 rounded-full flex items-center justify-center text-white" style={{ backgroundColor: accent }}><Check className="h-12 w-12" /></div>
            <h1 className="mt-7 text-4xl font-black">{t.requestSent}</h1>
            <p className="mt-4 text-xl leading-relaxed text-slate-600">{t.requestMessage}</p>
            <div className="mx-auto mt-8 max-w-md rounded-2xl bg-slate-100 p-6"><p className="text-sm font-bold uppercase tracking-wider text-slate-500">{t.requestNumber}</p><p className="mt-2 text-3xl font-black tracking-wide">{requestNumber}</p></div>
            <button onClick={resetSession} className="mt-8 min-h-14 rounded-2xl px-8 text-lg font-bold text-white" style={{ backgroundColor: accent }}><RotateCcw className="inline h-5 w-5 me-2" />{t.reset}</button>
          </section>
        </main>
      )}

      {selectedProduct && <ProductDialog product={selectedProduct} quantity={cart[selectedProduct.barcode]?.quantity || 0} showPrice={profile.show_prices} showAvailability={profile.show_availability} placeholderLogo={profile.logo_url} t={t} accent={accent} onClose={() => setSelectedProduct(null)} onChange={delta => changeQuantity(selectedProduct, delta)} />}

      {idleWarning && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/65 p-5 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl bg-white p-8 text-center shadow-2xl"><RotateCcw className="mx-auto h-12 w-12 text-amber-500" /><h2 className="mt-5 text-3xl font-black">{t.idleTitle}</h2><p className="mt-3 text-lg text-slate-600">{t.idleText}</p><button onClick={armIdleReset} className="mt-7 min-h-14 w-full rounded-2xl text-lg font-bold text-white" style={{ backgroundColor: accent }}>{t.stay}</button></div>
        </div>
      )}
    </div>
  );
}

function KioskCentered({ children }: { children: ReactNode }) {
  return <main className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-center text-slate-600">{children}</main>;
}

function KioskInput({ label, value, onChange, required, disabled, inputMode, autoFocus }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; disabled?: boolean; inputMode?: 'text' | 'tel' | 'email'; autoFocus?: boolean }) {
  return <label className="block"><span className="mb-2 block text-base font-bold">{label}{required && <span className="text-red-500"> *</span>}</span><input autoFocus={autoFocus} disabled={disabled} inputMode={inputMode} type={inputMode === 'email' ? 'email' : 'text'} value={value} onChange={e => onChange(e.target.value)} className="h-16 w-full rounded-2xl border-2 border-slate-200 bg-white px-5 text-xl outline-none focus:border-[var(--kiosk-accent)] disabled:cursor-not-allowed disabled:bg-slate-100" /></label>;
}

function FilterButton({ active, label, onClick, accent }: { active: boolean; label: string; onClick: () => void; accent: string }) {
  return <button onClick={onClick} className={`min-h-12 rounded-xl border-2 px-5 text-base font-bold transition active:scale-95 ${active ? 'text-white' : 'border-slate-200 bg-white text-slate-700'}`} style={active ? { backgroundColor: accent, borderColor: accent } : undefined}>{label}</button>;
}

function ProductImage({ image, name, placeholderLogo }: { image: string | null; name: string; placeholderLogo?: string | null }) {
  const url = KioskService.imageUrl(image);
  return <div className="aspect-square w-full overflow-hidden rounded-2xl bg-white border border-slate-100 flex items-center justify-center">{url ? <img src={url} alt={name} loading="lazy" className="h-full w-full object-contain p-3" /> : placeholderLogo ? <img src={placeholderLogo} alt="" className="h-1/2 w-1/2 object-contain opacity-30 grayscale" /> : <img src={`${import.meta.env.BASE_URL || '/'}stocky-logo.png`} alt="" className="h-1/2 w-1/2 object-contain opacity-25 grayscale" />}</div>;
}

function ProductCard({ product, quantity, showPrice, showAvailability, placeholderLogo, t, accent, onOpen, onChange }: { product: KioskProduct; quantity: number; showPrice: boolean; showAvailability: boolean; placeholderLogo?: string | null; t: KioskCopy; accent: string; onOpen: () => void; onChange: (delta: number) => void }) {
  return <article className="rounded-3xl border border-slate-200 bg-white p-2.5 shadow-sm flex flex-col"><button onClick={onOpen} className="text-start"><ProductImage image={product.image} name={product.name} placeholderLogo={placeholderLogo} /><div className="px-1 pt-3"><p className="min-h-5 truncate text-xs font-bold uppercase tracking-wide text-slate-400">{product.brand || '—'}</p><h2 className="mt-1 line-clamp-2 min-h-12 text-base sm:text-lg font-bold leading-snug">{product.name}</h2><p className="mt-1 truncate font-mono text-xs text-slate-400">{product.barcode}</p>{showAvailability && <p className={`mt-2 text-xs font-bold ${product.available ? 'text-emerald-600' : 'text-amber-600'}`}>{product.available ? t.available : t.onRequest}</p>}{showPrice && <p className="mt-2 text-lg font-black" style={{ color: accent }}>{fmt(product.price || 0)} DH</p>}</div></button><div className="mt-auto pt-3">{quantity > 0 ? <QuantityStepper quantity={quantity} onMinus={() => onChange(-1)} onPlus={() => onChange(1)} accent={accent} /> : <button onClick={() => onChange(1)} className="min-h-12 w-full rounded-xl text-base font-bold text-white" style={{ backgroundColor: accent }}><Plus className="inline h-5 w-5 me-1" />{t.add}</button>}</div></article>;
}

function QuantityStepper({ quantity, onMinus, onPlus, accent }: { quantity: number; onMinus: () => void; onPlus: () => void; accent: string }) {
  return <div className="grid min-h-12 grid-cols-[48px_1fr_48px] overflow-hidden rounded-xl border-2" style={{ borderColor: accent }}><button onClick={onMinus} className="flex items-center justify-center bg-white"><Minus className="h-5 w-5" /></button><span className="flex items-center justify-center text-lg font-black text-white" style={{ backgroundColor: accent }}>{quantity}</span><button onClick={onPlus} className="flex items-center justify-center bg-white"><Plus className="h-5 w-5" /></button></div>;
}

function ReviewLine({ line, showPrice, placeholderLogo, accent, onSet }: { line: CartLine; showPrice: boolean; placeholderLogo?: string | null; accent: string; onSet: (quantity: number) => void }) {
  return <div className="grid grid-cols-[88px_1fr] gap-4 rounded-2xl border border-slate-200 bg-white p-3 sm:grid-cols-[100px_1fr_auto] sm:items-center"><ProductImage image={line.product.image} name={line.product.name} placeholderLogo={placeholderLogo} /><div><p className="text-xs font-bold uppercase text-slate-400">{line.product.brand}</p><h2 className="mt-1 text-lg font-bold">{line.product.name}</h2><p className="mt-1 font-mono text-xs text-slate-400">{line.product.barcode}</p>{showPrice && <p className="mt-2 font-black" style={{ color: accent }}>{fmt((line.product.price || 0) * line.quantity)} DH</p>}</div><div className="col-span-2 sm:col-span-1 sm:w-44"><div className="grid h-14 grid-cols-[52px_1fr_52px] overflow-hidden rounded-xl border-2" style={{ borderColor: accent }}><button onClick={() => onSet(line.quantity - 1)} className="flex items-center justify-center"><Minus className="h-5 w-5" /></button><input type="number" min={1} max={999} value={line.quantity} onChange={e => onSet(Number(e.target.value) || 1)} className="w-full text-center text-xl font-black text-white outline-none" style={{ backgroundColor: accent }} /><button onClick={() => onSet(line.quantity + 1)} className="flex items-center justify-center"><Plus className="h-5 w-5" /></button></div></div></div>;
}

function ProductDialog({ product, quantity, showPrice, showAvailability, placeholderLogo, t, accent, onClose, onChange }: { product: KioskProduct; quantity: number; showPrice: boolean; showAvailability: boolean; placeholderLogo?: string | null; t: KioskCopy; accent: string; onClose: () => void; onChange: (delta: number) => void }) {
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onClick={onClose}><section className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}><button onClick={onClose} className="absolute end-4 top-4 z-10 h-12 w-12 rounded-full bg-white/95 shadow flex items-center justify-center"><X className="h-6 w-6" /></button><div className="grid gap-6 sm:grid-cols-2"><ProductImage image={product.image} name={product.name} placeholderLogo={placeholderLogo} /><div className="flex flex-col"><p className="text-sm font-bold uppercase tracking-wide text-slate-400">{product.brand}</p><h2 className="mt-2 text-3xl font-black leading-tight">{product.name}</h2><p className="mt-3 font-mono text-sm text-slate-400">{product.barcode}</p>{showAvailability && <p className={`mt-4 font-bold ${product.available ? 'text-emerald-600' : 'text-amber-600'}`}>{product.available ? t.available : t.onRequest}</p>}{showPrice && <p className="mt-4 text-3xl font-black" style={{ color: accent }}>{fmt(product.price || 0)} DH</p>}<div className="mt-auto pt-8">{quantity ? <QuantityStepper quantity={quantity} onMinus={() => onChange(-1)} onPlus={() => onChange(1)} accent={accent} /> : <button onClick={() => onChange(1)} className="min-h-14 w-full rounded-2xl text-lg font-bold text-white" style={{ backgroundColor: accent }}><Plus className="inline h-5 w-5 me-2" />{t.add}</button>}</div></div></div></section></div>;
}
