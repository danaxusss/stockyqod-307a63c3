import type { KioskLanguage, KioskPublicProfile, KioskShowcaseSlide } from './kioskService';

type Localized = Record<KioskLanguage, string>;

export type ShowcaseSlideKind = 'intro' | 'media' | 'steps' | 'mosaic' | 'stats' | 'cities' | 'cta' | 'review';

export type ShowcaseStat = { value: number; prefix: string; suffix: string; label: string };

/** A slide ready to draw, in the customer's language. */
export interface ShowcaseSlide {
  id: string;
  kind: ShowcaseSlideKind;
  video?: string;
  image?: string;
  /** Poster shown until the video plays. */
  poster?: string;
  images?: string[];
  kicker: string;
  title: string;
  text: string;
  chips?: string[];
  steps?: string[];
  stats?: ShowcaseStat[];
  cities?: string[];
}

type BuiltinSlide = {
  id: string;
  kind: ShowcaseSlideKind;
  clip?: string;
  image?: string;
  images?: string[];
  kicker: Localized;
  title: Localized;
  text: Localized;
  chips?: Localized[];
  steps?: Localized[];
  stats?: Array<{ value: number; prefix?: string; suffix?: string; label: Localized }>;
  cities?: Localized[];
};

export const showcaseAsset = (file: string) => `${import.meta.env.BASE_URL || '/'}kiosk-showcase/${file}`;
export const CUISIMAT_LOGO = showcaseAsset('cuisimat-groupe-logo-light.png');

/**
 * The Cuisimat Groupe presentation shipped with the app: footage from the
 * group's showroom film and photos of delivered projects (cuisimat-groupe.ma,
 * cuisimat-equipements.ma). Figures are the ones the group publishes.
 */
const BUILTIN: BuiltinSlide[] = [
  {
    id: 'cuisimat-intro', kind: 'intro', clip: 'intro',
    kicker: { fr: 'Cuisimat Groupe', en: 'Cuisimat Groupe', ar: 'Cuisimat Groupe' },
    title: {
      fr: 'Le partenaire des professionnels de la restauration',
      en: 'The partner of food-service professionals',
      ar: 'شريك مهنيي المطاعم والمقاهي والفنادق',
    },
    text: {
      fr: 'Équipements, ustensiles, mobilier et accompagnement 360° pour cafés, hôtels et restaurants depuis plus de 25 ans.',
      en: 'Equipment, utensils, furniture and end-to-end support for cafés, hotels and restaurants for more than 25 years.',
      ar: 'تجهيزات وأدوات وأثاث ومواكبة شاملة للمقاهي والفنادق والمطاعم منذ أكثر من 25 سنة.',
    },
  },
  {
    id: 'cuisimat-equipment', kind: 'media', clip: 'showroom',
    kicker: { fr: 'Équipements professionnels', en: 'Professional equipment', ar: 'تجهيزات احترافية' },
    title: { fr: '+8 000 références en stock', en: '8,000+ items in stock', ar: 'أكثر من 8000 مرجع في المخزون' },
    text: {
      fr: 'Cuisson, froid, préparation, lavage, caféterie : tout le matériel CHR sous un même toit.',
      en: 'Cooking, refrigeration, preparation, dishwashing and coffee: all your food-service equipment under one roof.',
      ar: 'الطهي والتبريد والتحضير والغسيل ومعدات المقهى: كل التجهيزات المهنية تحت سقف واحد.',
    },
    chips: [
      { fr: 'Cuisson', en: 'Cooking', ar: 'الطهي' },
      { fr: 'Froid', en: 'Refrigeration', ar: 'التبريد' },
      { fr: 'Préparation', en: 'Preparation', ar: 'التحضير' },
      { fr: 'Lavage', en: 'Dishwashing', ar: 'الغسيل' },
      { fr: 'Caféterie', en: 'Coffee', ar: 'المقهى' },
    ],
  },
  {
    id: 'cuisimat-utensils', kind: 'media', clip: 'utensils',
    kicker: { fr: 'Ustensiles & art de la table', en: 'Utensils & tableware', ar: 'الأواني وفن المائدة' },
    title: { fr: 'Tout pour la cuisine et la salle', en: 'Everything for the kitchen and the dining room', ar: 'كل ما تحتاجه للمطبخ وقاعة الطعام' },
    text: {
      fr: 'Petit matériel, vaisselle, verrerie et accessoires sélectionnés pour les professionnels.',
      en: 'Small equipment, tableware, glassware and accessories chosen for professionals.',
      ar: 'معدات صغيرة وأوانٍ وأكواب وإكسسوارات مختارة للمهنيين.',
    },
  },
  {
    id: 'cuisimat-furniture', kind: 'media', clip: 'furniture',
    kicker: { fr: 'Mobilier', en: 'Furniture', ar: 'الأثاث' },
    title: { fr: 'Fabricant de mobilier CHR', en: 'Food-service furniture maker', ar: 'مصنع أثاث للمقاهي والمطاعم والفنادق' },
    text: {
      fr: 'Tables, chaises et agencements conçus et fabriqués pour l’identité de votre établissement.',
      en: 'Tables, chairs and fit-outs designed and built around your venue’s identity.',
      ar: 'طاولات وكراسي وتجهيزات مصممة ومصنوعة لتناسب هوية مؤسستك.',
    },
  },
  {
    id: 'cuisimat-design', kind: 'steps', clip: 'design',
    kicker: { fr: 'Étude & aménagement', en: 'Design & fit-out', ar: 'الدراسة والتهيئة' },
    title: { fr: 'De l’idée à l’ouverture, on vous accompagne', en: 'From idea to opening day, we are with you', ar: 'نرافقك من الفكرة إلى يوم الافتتاح' },
    text: {
      fr: 'Conseil, plans 2D et 3D, installation aux normes d’hygiène et de sécurité, maintenance.',
      en: 'Advice, 2D and 3D plans, installation to hygiene and safety standards, maintenance.',
      ar: 'استشارة ومخططات ثنائية وثلاثية الأبعاد وتركيب وفق معايير النظافة والسلامة وصيانة.',
    },
    steps: [
      { fr: 'Étude', en: 'Study', ar: 'الدراسة' },
      { fr: 'Plans 2D & 3D', en: '2D & 3D plans', ar: 'مخططات ثنائية وثلاثية الأبعاد' },
      { fr: 'Installation', en: 'Installation', ar: 'التركيب' },
      { fr: 'Maintenance', en: 'Maintenance', ar: 'الصيانة' },
    ],
  },
  {
    id: 'cuisimat-projects', kind: 'mosaic',
    images: ['project-coffee-shop.jpg', 'project-street-food.jpg', 'project-butcher.jpg', 'project-cafe-bar.jpg', 'project-juice-bar.jpg', 'project-snack.jpg'],
    kicker: { fr: 'Nos réalisations', en: 'Our projects', ar: 'إنجازاتنا' },
    title: { fr: '+360 projets réalisés', en: '360+ completed projects', ar: 'أكثر من 360 مشروعاً منجزاً' },
    text: {
      fr: 'Cafés, snacks, boucheries, boulangeries, hôtels… partout au Maroc.',
      en: 'Cafés, snack bars, butchers, bakeries, hotels… all over Morocco.',
      ar: 'مقاهٍ ومطاعم سريعة ومجازر ومخابز وفنادق… في جميع أنحاء المغرب.',
    },
  },
  {
    id: 'cuisimat-numbers', kind: 'stats', clip: 'displays',
    kicker: { fr: 'Cuisimat en chiffres', en: 'Cuisimat in numbers', ar: 'Cuisimat بالأرقام' },
    title: { fr: 'Une expertise reconnue', en: 'Proven expertise', ar: 'خبرة معترف بها' },
    text: { fr: '', en: '', ar: '' },
    stats: [
      { value: 25, prefix: '+', label: { fr: 'ans d’expérience', en: 'years of experience', ar: 'سنة من الخبرة' } },
      { value: 8000, prefix: '+', label: { fr: 'références', en: 'items', ar: 'مرجع' } },
      { value: 800, prefix: '+', suffix: ' m²', label: { fr: 'd’exposition', en: 'of showroom', ar: 'مساحة العرض' } },
      { value: 96, suffix: ' %', label: { fr: 'de clients satisfaits', en: 'satisfied clients', ar: 'عملاء راضون' } },
    ],
  },
  {
    id: 'cuisimat-presence', kind: 'cities', clip: 'warehouse',
    kicker: { fr: 'Partout au Maroc', en: 'Across Morocco', ar: 'في جميع أنحاء المغرب' },
    title: { fr: 'Présents dans 8 villes', en: 'In 8 cities', ar: 'حاضرون في 8 مدن' },
    text: {
      fr: 'Stock permanent, livraison et service technique près de chez vous.',
      en: 'Permanent stock, delivery and technical service near you.',
      ar: 'مخزون دائم وتوصيل وخدمة تقنية بالقرب منك.',
    },
    cities: [
      { fr: 'Casablanca', en: 'Casablanca', ar: 'الدار البيضاء' },
      { fr: 'Tanger', en: 'Tangier', ar: 'طنجة' },
      { fr: 'Fès', en: 'Fez', ar: 'فاس' },
      { fr: 'Oujda', en: 'Oujda', ar: 'وجدة' },
      { fr: 'Kénitra', en: 'Kenitra', ar: 'القنيطرة' },
      { fr: 'Marrakech', en: 'Marrakesh', ar: 'مراكش' },
      { fr: 'Agadir', en: 'Agadir', ar: 'أكادير' },
      { fr: 'Laâyoune', en: 'Laayoune', ar: 'العيون' },
    ],
  },
];

const CTA: BuiltinSlide = {
  id: 'showcase-cta', kind: 'cta', image: 'showroom-casablanca.jpg',
  kicker: { fr: 'Demande de devis', en: 'Quote request', ar: 'طلب عرض سعر' },
  title: { fr: 'Votre devis, ici et maintenant', en: 'Your quote, right here, right now', ar: 'عرض سعرك، هنا والآن' },
  text: {
    fr: 'Parcourez nos produits, composez votre sélection et envoyez-la : un conseiller vous recontacte rapidement.',
    en: 'Browse our products, build your selection and send it: an advisor will get back to you quickly.',
    ar: 'تصفح منتجاتنا واختر ما يناسبك ثم أرسل طلبك: سيتواصل معك مستشار بسرعة.',
  },
};

/** Text of the showcase and of the review page, in the kiosk languages. */
export const SHOWCASE_COPY = {
  fr: {
    start: 'Découvrir nos produits & demander un devis', touch: 'Touchez l’écran pour commencer', review: 'Laisser un avis',
    reviewKicker: 'Avis Google', reviewTitle: 'Votre avis compte !',
    reviewText: 'Scannez ce code avec l’appareil photo de votre téléphone pour laisser un avis Google en moins d’une minute.',
    reviewSteps: ['Ouvrez l’appareil photo', 'Visez le code', 'Donnez votre note'], reviewThanks: 'Merci pour votre confiance',
    reviewInvite: 'Satisfait de votre visite ? Laissez-nous un avis Google.', close: 'Fermer', fullscreen: 'Plein écran',
  },
  en: {
    start: 'Browse products & request a quote', touch: 'Touch the screen to start', review: 'Leave a review',
    reviewKicker: 'Google reviews', reviewTitle: 'Your opinion matters!',
    reviewText: 'Scan this code with your phone’s camera to leave a Google review in under a minute.',
    reviewSteps: ['Open your camera', 'Point it at the code', 'Rate your visit'], reviewThanks: 'Thank you for your trust',
    reviewInvite: 'Enjoyed your visit? Leave us a Google review.', close: 'Close', fullscreen: 'Full screen',
  },
  ar: {
    start: 'تصفح المنتجات واطلب عرض سعر', touch: 'المس الشاشة للبدء', review: 'اترك تقييماً',
    reviewKicker: 'تقييمات Google', reviewTitle: 'رأيك يهمنا!',
    reviewText: 'امسح هذا الرمز بكاميرا هاتفك لترك تقييم على Google في أقل من دقيقة.',
    reviewSteps: ['افتح الكاميرا', 'وجّهها نحو الرمز', 'قيّم زيارتك'], reviewThanks: 'شكراً على ثقتكم',
    reviewInvite: 'هل أعجبتك زيارتك؟ اترك لنا تقييماً على Google.', close: 'إغلاق', fullscreen: 'ملء الشاشة',
  },
} as const;

export type ShowcaseCopy = (typeof SHOWCASE_COPY)[KioskLanguage];

function fromBuiltin(slide: BuiltinSlide, language: KioskLanguage): ShowcaseSlide {
  const pick = (value: Localized) => value[language] || value.fr;
  return {
    id: slide.id,
    kind: slide.kind,
    video: slide.clip ? showcaseAsset(`${slide.clip}.mp4`) : undefined,
    poster: slide.clip ? showcaseAsset(`${slide.clip}.jpg`) : undefined,
    image: slide.image ? showcaseAsset(slide.image) : undefined,
    images: slide.images?.map(showcaseAsset),
    kicker: pick(slide.kicker),
    title: pick(slide.title),
    text: pick(slide.text),
    chips: slide.chips?.map(pick),
    steps: slide.steps?.map(pick),
    stats: slide.stats?.map(stat => ({ value: stat.value, prefix: stat.prefix || '', suffix: stat.suffix || '', label: pick(stat.label) })),
    cities: slide.cities?.map(pick),
  };
}

function fromCustom(slide: KioskShowcaseSlide): ShowcaseSlide {
  return {
    id: `custom-${slide.id}`,
    kind: 'media',
    video: slide.media_type === 'video' && slide.media_url ? slide.media_url : undefined,
    image: slide.media_type === 'image' && slide.media_url ? slide.media_url : undefined,
    kicker: slide.kicker,
    title: slide.title,
    text: slide.text,
  };
}

/**
 * The showcase loop: the built-in presentation (unless turned off), the
 * kiosk's own slides, the call to action, then the Google review page when a
 * review link is set.
 */
export function buildShowcase(
  profile: Pick<KioskPublicProfile, 'showcase_builtin' | 'showcase_slides' | 'google_review_url'>,
  language: KioskLanguage,
): ShowcaseSlide[] {
  const slides: ShowcaseSlide[] = [];
  if (profile.showcase_builtin !== false) slides.push(...BUILTIN.map(slide => fromBuiltin(slide, language)));
  slides.push(...(profile.showcase_slides || []).map(fromCustom));
  slides.push(fromBuiltin(CTA, language));
  if (profile.google_review_url) {
    const copy = SHOWCASE_COPY[language];
    slides.push({ id: 'showcase-review', kind: 'review', kicker: copy.reviewKicker, title: copy.reviewTitle, text: copy.reviewText });
  }
  return slides;
}

/** Media files of a slide, to warm the cache before it shows. */
export function slideMedia(slide: ShowcaseSlide): { videos: string[]; images: string[] } {
  return {
    videos: slide.video ? [slide.video] : [],
    images: [slide.poster, slide.image, ...(slide.images || [])].filter((value): value is string => !!value),
  };
}
