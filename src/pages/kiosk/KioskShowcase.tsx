import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'framer-motion';
import { ChevronRight, Expand, Languages, MapPin, Smartphone, Star, X } from 'lucide-react';
import type { KioskLanguage, KioskPublicProfile } from '../../utils/kioskService';
import { useQrCode } from '../../hooks/useQrCode';
import {
  CUISIMAT_LOGO, SHOWCASE_COPY, buildShowcase, slideMedia, type ShowcaseCopy, type ShowcaseSlide,
} from '../../utils/kioskShowcase';

const LANGUAGE_NAMES: Record<KioskLanguage, string> = { fr: 'FR', en: 'EN', ar: 'ع' };
// Thousands grouped with a space (8 000), Latin digits as used in Morocco; fr-MA and ar-MA use a dot.
const NUMBER_LOCALES: Record<KioskLanguage, string> = { fr: 'fr-FR', en: 'en-US', ar: 'fr-FR' };
// The review page needs time to take out a phone and scan.
const REVIEW_MIN_MS = 15_000;
const EASE = [0.22, 1, 0.36, 1] as const;

type Dir = 'ltr' | 'rtl';

/**
 * The kiosk's attract loop: full-screen slides of the company's products and
 * services. Touching the screen (or the call to action) opens the catalogue.
 */
export function KioskShowcase({ profile, language, languages, accent, onAccent, onLanguage, onStart, onReview }: {
  profile: KioskPublicProfile;
  language: KioskLanguage;
  languages: KioskLanguage[];
  accent: string;
  onAccent: string;
  onLanguage: (language: KioskLanguage) => void;
  onStart: () => void;
  onReview: () => void;
}) {
  const slides = useMemo(
    () => buildShowcase(profile, language),
    [language, profile],
  );
  const [index, setIndex] = useState(0);
  const current = slides[index % slides.length];
  const next = slides[(index + 1) % slides.length];
  const dir: Dir = language === 'ar' ? 'rtl' : 'ltr';
  const t = SHOWCASE_COPY[language];
  const slideMs = Math.max(4, profile.showcase_slide_seconds || 8) * 1000;
  const duration = current.kind === 'review' ? Math.max(REVIEW_MIN_MS, slideMs * 2) : slideMs;
  const hasReview = !!profile.google_review_url;

  // Settings refreshed in the background can change the number of slides.
  useEffect(() => { if (index >= slides.length) setIndex(0); }, [index, slides.length]);

  useEffect(() => {
    const timer = setTimeout(() => setIndex(value => (value + 1) % slides.length), duration);
    return () => clearTimeout(timer);
  }, [duration, index, slides.length]);

  // Warm the next slide's pictures so it does not open on a blank frame.
  useEffect(() => {
    slideMedia(next).images.forEach(src => { const image = new Image(); image.src = src; });
  }, [next]);

  const stop = (event: MouseEvent) => event.stopPropagation();
  const requestFullscreen = (event: MouseEvent) => {
    event.stopPropagation();
    document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const logo = profile.logo_url;

  return (
    <MotionConfig reducedMotion="user">
      {/* Touching anywhere starts; the start button below is the accessible way in. */}
      <div
        role="region" aria-roledescription="showcase" aria-label={profile.company_name} onClick={onStart}
        className="fixed inset-0 z-30 cursor-pointer overflow-hidden bg-slate-950 text-white"
        style={{ '--kiosk-accent': accent, '--kiosk-on-accent': onAccent } as CSSProperties}
      >
        <AnimatePresence initial={false}>
          <motion.div
            key={current.id}
            className="absolute inset-0"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 1, ease: 'easeInOut' }}
          >
            <Slide slide={current} dir={dir} language={language} accent={accent} onAccent={onAccent} copy={t}
              durationMs={duration} reviewUrl={profile.google_review_url || null} onStart={onStart} />
          </motion.div>
        </AnimatePresence>

        {/* Next slide's video, buffering out of sight. */}
        {next.video && next.id !== current.id && <video key={`preload-${next.id}`} src={next.video} preload="auto" muted playsInline className="hidden" aria-hidden />}

        <header className="absolute inset-x-0 top-0 z-20 flex items-start gap-4 bg-gradient-to-b from-black/60 to-transparent px-6 pb-10 pt-5 md:px-10">
          {/* The intro slide shows the logo large already. */}
          <div className={`shrink-0 transition-opacity duration-700 ${current.kind === 'intro' ? 'opacity-0' : 'opacity-100'}`}>
            {logo
              ? <img src={logo} alt={profile.company_name} className="h-12 w-auto max-w-40 rounded-xl bg-white/95 object-contain px-3 py-1.5 shadow-lg" />
              : <img src={CUISIMAT_LOGO} alt={profile.company_name} className="h-12 w-auto object-contain drop-shadow-lg" />}
          </div>
          <div className="mt-5 flex flex-1 gap-1.5" aria-hidden>
            {slides.map((slide, position) => (
              <div key={slide.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
                {position < index % slides.length && <div className="h-full w-full bg-white" />}
                {position === index % slides.length && (
                  <motion.div key={`${slide.id}-${index}`} className="h-full origin-left bg-white rtl:origin-right"
                    initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: duration / 1000, ease: 'linear' }} />
                )}
              </div>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-2" onClick={stop}>
            {languages.length > 1 && (
              <div role="group" aria-label="Language" className="flex items-center gap-1 rounded-2xl bg-black/35 p-1 backdrop-blur">
                <Languages className="mx-1.5 h-4 w-4 text-white/70" />
                {languages.map(code => (
                  <button key={code} lang={code} onClick={() => onLanguage(code)} aria-pressed={language === code}
                    className={`min-h-10 min-w-10 rounded-xl px-2 text-sm font-bold ${language === code ? 'bg-white text-slate-900' : 'text-white/80'}`}>
                    {LANGUAGE_NAMES[code]}
                  </button>
                ))}
              </div>
            )}
            <button onClick={requestFullscreen} aria-label={t.fullscreen} className="flex h-12 w-12 items-center justify-center rounded-2xl bg-black/35 backdrop-blur"><Expand className="h-5 w-5" /></button>
          </div>
        </header>

        {current.kind !== 'cta' && (
          <footer className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-stretch gap-3 bg-gradient-to-t from-black/75 to-transparent px-6 pb-6 pt-14 sm:flex-row sm:items-center sm:justify-end md:px-10 md:pb-8">
            <motion.p className="hidden flex-1 text-lg font-semibold text-white/80 lg:block"
              animate={{ opacity: [0.45, 1, 0.45] }} transition={{ duration: 2.4, repeat: Infinity }}>
              {t.touch}
            </motion.p>
            {hasReview && current.kind !== 'review' && (
              <button onClick={event => { stop(event); onReview(); }}
                className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 border-white/40 bg-white/10 px-6 text-lg font-bold backdrop-blur active:scale-[0.98]">
                <Star className="h-5 w-5 fill-amber-400 text-amber-400" />{t.review}
              </button>
            )}
            <StartButton label={t.start} accent={accent} onAccent={onAccent} onClick={event => { stop(event); onStart(); }} />
          </footer>
        )}
      </div>
    </MotionConfig>
  );
}

function StartButton({ label, accent, onAccent, onClick, large = false }: { label: string; accent: string; onAccent: string; onClick: (event: MouseEvent) => void; large?: boolean }) {
  return (
    <span className="relative inline-flex">
      <motion.span aria-hidden className="absolute inset-0 rounded-2xl" style={{ backgroundColor: accent }}
        animate={{ scale: [1, 1.12], opacity: [0.55, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }} />
      <button onClick={onClick}
        className={`relative flex w-full items-center justify-center gap-3 rounded-2xl font-black shadow-2xl active:scale-[0.98] ${large ? 'min-h-20 px-10 text-2xl md:text-3xl' : 'min-h-14 px-7 text-lg'}`}
        style={{ backgroundColor: accent, color: onAccent }}>
        {label}
        {/* The flip sits on a wrapper: framer-motion's inline transform would override it. */}
        <span className="inline-flex rtl:-scale-x-100">
          <motion.span animate={{ x: [0, 6, 0] }} transition={{ duration: 1.4, repeat: Infinity }} className="inline-flex">
            <ChevronRight className={large ? 'h-8 w-8' : 'h-6 w-6'} />
          </motion.span>
        </span>
      </button>
    </span>
  );
}

function Slide({ slide, dir, language, accent, onAccent, copy, durationMs, reviewUrl, onStart }: {
  slide: ShowcaseSlide; dir: Dir; language: KioskLanguage; accent: string; onAccent: string; copy: ShowcaseCopy;
  durationMs: number; reviewUrl: string | null; onStart: () => void;
}) {
  if (slide.kind === 'review') return <ReviewContent copy={copy} url={reviewUrl} accent={accent} dir={dir} />;
  if (slide.kind === 'mosaic') return <MosaicSlide slide={slide} dir={dir} accent={accent} />;
  const centered = slide.kind === 'intro' || slide.kind === 'cta';
  return (
    <>
      <Backdrop slide={slide} durationMs={durationMs} />
      <div className={`absolute inset-0 ${centered ? 'bg-black/55' : 'bg-gradient-to-t from-black/90 via-black/40 to-black/10'}`} />
      {!centered && <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/10 to-transparent rtl:bg-gradient-to-l" />}
      {slide.kind === 'intro' && <IntroContent slide={slide} accent={accent} />}
      {slide.kind === 'cta' && <CtaContent slide={slide} dir={dir} accent={accent} onAccent={onAccent} copy={copy} onStart={onStart} />}
      {!centered && (
        <div className="absolute inset-x-0 bottom-0 px-6 pb-32 md:px-12 md:pb-36">
          <div className="max-w-5xl">
            <Heading slide={slide} dir={dir} accent={accent} />
            {slide.chips && <Chips values={slide.chips} />}
            {slide.steps && <Steps values={slide.steps} accent={accent} onAccent={onAccent} />}
            {slide.stats && <Stats values={slide.stats} language={language} accent={accent} />}
            {slide.cities && <Cities values={slide.cities} accent={accent} />}
          </div>
        </div>
      )}
    </>
  );
}

/** Full-bleed video or photo with a slow push-in. */
function Backdrop({ slide, durationMs }: { slide: ShowcaseSlide; durationMs: number }) {
  return (
    <motion.div className="absolute inset-0" initial={{ scale: 1.12 }} animate={{ scale: 1 }}
      transition={{ duration: durationMs / 1000 + 1, ease: 'linear' }}>
      {slide.video
        ? <video src={slide.video} poster={slide.poster} autoPlay muted loop playsInline preload="auto" className="h-full w-full object-cover" />
        : slide.image ? <img src={slide.image} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full bg-slate-900" />}
    </motion.div>
  );
}

/** Words rising one after another from behind a mask. */
function RevealWords({ text, className, delay = 0.35 }: { text: string; className: string; delay?: number }) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <h2 className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {words.map((word, position) => (
          <span key={`${word}-${position}`} className="inline-block overflow-hidden pb-[0.12em] align-bottom">
            <motion.span className="inline-block" initial={{ y: '110%' }} animate={{ y: '0%' }}
              transition={{ duration: 0.8, delay: delay + position * 0.07, ease: EASE }}>
              {word}{position < words.length - 1 ? ' ' : ''}
            </motion.span>
          </span>
        ))}
      </span>
    </h2>
  );
}

function Kicker({ text, dir, accent, center = false, className = '' }: { text: string; dir: Dir; accent: string; center?: boolean; className?: string }) {
  if (!text) return null;
  const from = dir === 'rtl' ? 24 : -24;
  return (
    <div className={`mb-4 flex items-center gap-3 ${center ? 'justify-center' : ''} ${className}`}>
      <motion.span className="h-1 w-14 origin-left rounded-full rtl:origin-right" style={{ backgroundColor: accent }}
        initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.7, delay: 0.15, ease: EASE }} />
      <motion.span className="text-base font-bold uppercase tracking-[0.2em] text-white/85 md:text-lg"
        initial={{ opacity: 0, x: from }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.7, delay: 0.25, ease: EASE }}>
        {text}
      </motion.span>
    </div>
  );
}

function Lead({ text, center = false, delay = 0.9 }: { text: string; center?: boolean; delay?: number }) {
  if (!text) return null;
  return (
    <motion.p className={`mt-5 max-w-3xl text-xl leading-relaxed text-white/85 md:text-2xl ${center ? 'mx-auto' : ''}`}
      initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay, ease: EASE }}>
      {text}
    </motion.p>
  );
}

function Heading({ slide, dir, accent }: { slide: ShowcaseSlide; dir: Dir; accent: string }) {
  return (
    <>
      <Kicker text={slide.kicker} dir={dir} accent={accent} />
      {slide.title && <RevealWords text={slide.title} className="text-4xl font-black leading-[1.05] tracking-tight drop-shadow-lg md:text-6xl lg:text-7xl" />}
      <Lead text={slide.text} />
    </>
  );
}

function IntroContent({ slide, accent }: { slide: ShowcaseSlide; accent: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-6 pb-24 text-center">
      <motion.img src={CUISIMAT_LOGO} alt={slide.kicker} className="mb-8 w-[min(70vw,560px)] drop-shadow-2xl"
        initial={{ opacity: 0, scale: 0.85, filter: 'blur(12px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
        transition={{ duration: 1.2, ease: EASE }} />
      <motion.span className="mb-6 h-1 w-24 rounded-full" style={{ backgroundColor: accent }}
        initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.8, delay: 0.8, ease: EASE }} />
      <RevealWords text={slide.title} delay={1} className="max-w-5xl text-4xl font-black leading-tight md:text-6xl" />
      <Lead text={slide.text} center delay={1.6} />
    </div>
  );
}

function CtaContent({ slide, dir, accent, onAccent, copy, onStart }: { slide: ShowcaseSlide; dir: Dir; accent: string; onAccent: string; copy: ShowcaseCopy; onStart: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
      <Kicker text={slide.kicker} dir={dir} accent={accent} center />
      <RevealWords text={slide.title} className="max-w-5xl text-5xl font-black leading-tight md:text-7xl" />
      <Lead text={slide.text} center />
      <motion.div className="mt-10" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, delay: 1.3, ease: EASE }}>
        <StartButton large label={copy.start} accent={accent} onAccent={onAccent} onClick={event => { event.stopPropagation(); onStart(); }} />
      </motion.div>
      <motion.p className="mt-6 text-lg font-semibold text-white/75" animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 2.4, repeat: Infinity }}>
        {copy.touch}
      </motion.p>
    </div>
  );
}

function Chips({ values }: { values: string[] }) {
  return (
    <div className="mt-7 flex flex-wrap gap-2.5">
      {values.map((value, position) => (
        <motion.span key={value} className="rounded-full border border-white/30 bg-white/10 px-5 py-2 text-lg font-semibold backdrop-blur"
          initial={{ opacity: 0, scale: 0.8, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 1.2 + position * 0.1, ease: EASE }}>
          {value}
        </motion.span>
      ))}
    </div>
  );
}

function Steps({ values, accent, onAccent }: { values: string[]; accent: string; onAccent: string }) {
  return (
    <ol className="relative mt-9 grid max-w-4xl gap-4" style={{ gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` }}>
      <motion.span aria-hidden className="absolute top-6 h-0.5 origin-left bg-white/40 rtl:origin-right"
        style={{ insetInlineStart: '1.5rem', insetInlineEnd: `calc(100% / ${values.length} - 1.5rem)` }}
        initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 1.4, delay: 1.1, ease: 'easeInOut' }} />
      {values.map((value, position) => (
        <motion.li key={value} className="relative" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 1.1 + position * 0.32, ease: EASE }}>
          <span className="flex h-12 w-12 items-center justify-center rounded-full text-xl font-black shadow-lg ring-4 ring-black/30"
            style={{ backgroundColor: accent, color: onAccent }}>{position + 1}</span>
          <span className="mt-3 block text-lg font-bold leading-tight md:text-xl">{value}</span>
        </motion.li>
      ))}
    </ol>
  );
}

function CountUp({ value, delay, locale }: { value: number; delay: number; locale: string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  useEffect(() => {
    if (reduce) { setShown(value); return; }
    let frame = 0;
    const start = performance.now() + delay * 1000;
    const tick = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - start) / 1600));
      setShown(Math.round(value * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [delay, reduce, value]);
  return <>{new Intl.NumberFormat(locale).format(shown)}</>;
}

function Stats({ values, language, accent }: { values: NonNullable<ShowcaseSlide['stats']>; language: KioskLanguage; accent: string }) {
  return (
    <div className="mt-9 grid grid-cols-2 gap-x-8 gap-y-6 lg:w-[min(1100px,calc(100vw-6rem))] lg:grid-cols-4">
      {values.map((stat, position) => (
        <motion.div key={stat.label} initial={{ opacity: 0, y: 26 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.8 + position * 0.15, ease: EASE }}
          className="border-s-4 ps-4" style={{ borderColor: accent }}>
          <p className="whitespace-nowrap text-5xl font-black tabular-nums tracking-tight xl:text-6xl" dir="ltr">
            {stat.prefix}<CountUp value={stat.value} delay={0.8 + position * 0.15} locale={NUMBER_LOCALES[language]} />{stat.suffix}
          </p>
          <p className="mt-1 text-lg font-semibold text-white/80 md:text-xl">{stat.label}</p>
        </motion.div>
      ))}
    </div>
  );
}

function Cities({ values, accent }: { values: string[]; accent: string }) {
  return (
    <div className="mt-8 grid max-w-4xl grid-cols-2 gap-2.5 sm:grid-cols-4">
      {values.map((city, position) => (
        <motion.span key={city} className="flex items-center gap-2 rounded-xl bg-black/35 px-4 py-3 text-lg font-bold backdrop-blur"
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 1.1 + position * 0.12, ease: EASE }}>
          <motion.span className="inline-flex" animate={{ y: [0, -3, 0] }} transition={{ duration: 1.6, repeat: Infinity, delay: position * 0.2 }}>
            <MapPin className="h-5 w-5 shrink-0" style={{ color: accent }} />
          </motion.span>
          {city}
        </motion.span>
      ))}
    </div>
  );
}

/** Projects: photos tiling in one after another, behind the slide's text. */
function MosaicSlide({ slide, dir, accent }: { slide: ShowcaseSlide; dir: Dir; accent: string }) {
  const images = slide.images || [];
  return (
    <>
      <div className="absolute inset-0 grid grid-cols-2 grid-rows-3 gap-1.5 bg-slate-950 p-1.5 md:grid-cols-3 md:grid-rows-2">
        {images.map((src, position) => (
          <motion.div key={src} className="relative overflow-hidden rounded-lg"
            initial={{ opacity: 0, scale: 0.86 }} animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.1 + position * 0.18, ease: EASE }}>
            <motion.img src={src} alt="" className="h-full w-full object-cover"
              initial={{ scale: 1.15 }} animate={{ scale: 1 }} transition={{ duration: 9, ease: 'linear' }} />
          </motion.div>
        ))}
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/45 to-black/10" />
      <div className="absolute inset-x-0 bottom-0 px-6 pb-32 md:px-12 md:pb-36">
        <div className="max-w-5xl"><Heading slide={slide} dir={dir} accent={accent} /></div>
      </div>
    </>
  );
}

function Stars({ size = 'h-10 w-10', delay = 0.8 }: { size?: string; delay?: number }) {
  return (
    <div className="flex justify-center gap-1.5" aria-hidden>
      {[0, 1, 2, 3, 4].map(position => (
        <motion.span key={position} className="inline-flex" initial={{ opacity: 0, scale: 0.3, rotate: -40 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 14, delay: delay + position * 0.15 }}>
          <Star className={`${size} fill-amber-400 text-amber-400 drop-shadow`} />
        </motion.span>
      ))}
    </div>
  );
}

/** Google review invitation: big QR code, three steps, animated stars. */
function ReviewContent({ copy, url, accent, dir, children }: { copy: ShowcaseCopy; url: string | null; accent: string; dir: Dir; children?: ReactNode }) {
  const qr = useQrCode(url);
  return (
    <div className="absolute inset-0 overflow-hidden bg-slate-950">
      <motion.div aria-hidden className="absolute -top-1/3 start-1/4 h-[80vh] w-[80vh] rounded-full opacity-40 blur-3xl"
        style={{ backgroundColor: accent }} animate={{ scale: [1, 1.15, 1], opacity: [0.3, 0.45, 0.3] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }} />
      <motion.div aria-hidden className="absolute -bottom-1/3 end-0 h-[70vh] w-[70vh] rounded-full bg-amber-400/20 blur-3xl"
        animate={{ scale: [1.1, 1, 1.1] }} transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }} />
      <div className="relative flex h-full flex-col items-center justify-center gap-10 px-6 pb-28 pt-24 md:px-14 lg:flex-row lg:gap-16">
        <div className="max-w-xl text-center lg:text-start">
          <Kicker text={copy.reviewKicker} dir={dir} accent={accent} className="justify-center lg:justify-start" />
          <RevealWords text={copy.reviewTitle} className="text-5xl font-black leading-tight md:text-7xl" />
          <Lead text={copy.reviewText} />
          <ol className="mt-8 hidden space-y-3 lg:block">
            {copy.reviewSteps.map((step, position) => (
              <motion.li key={step} className="flex items-center gap-4 text-xl font-semibold"
                initial={{ opacity: 0, x: dir === 'rtl' ? 24 : -24 }} animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: 1.2 + position * 0.25, ease: EASE }}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 text-lg font-black">{position + 1}</span>
                {step}
              </motion.li>
            ))}
          </ol>
          {children}
        </div>
        <motion.div className="relative w-[min(78vw,380px)] shrink-0 rounded-[2rem] bg-white p-6 text-center text-slate-900 shadow-2xl"
          initial={{ opacity: 0, y: 40, rotate: dir === 'rtl' ? -4 : 4 }} animate={{ opacity: 1, y: 0, rotate: 0 }}
          transition={{ duration: 0.9, delay: 0.4, ease: EASE }}>
          <Stars />
          <div className="relative mx-auto mt-5 aspect-square w-full overflow-hidden rounded-2xl">
            {qr ? <img src={qr} alt="QR code" className="h-full w-full" /> : <div className="h-full w-full animate-pulse bg-slate-100" />}
            <motion.span aria-hidden className="absolute inset-x-0 h-1/5 bg-gradient-to-b from-transparent via-amber-300/40 to-transparent"
              animate={{ top: ['-20%', '100%'] }} transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut', repeatDelay: 0.8 }} />
          </div>
          <p className="mt-4 flex items-center justify-center gap-2 text-base font-bold text-slate-600"><Smartphone className="h-5 w-5" />Google</p>
          <p className="mt-1 text-sm font-semibold text-slate-400">{copy.reviewThanks}</p>
        </motion.div>
      </div>
    </div>
  );
}

/** The review page opened on demand (from the showcase or the welcome screen). */
export function KioskReviewPage({ url, language, accent, onAccent, onClose, autoCloseMs = 90_000 }: {
  url: string; language: KioskLanguage; accent: string; onAccent: string; onClose: () => void; autoCloseMs?: number;
}) {
  const copy = SHOWCASE_COPY[language];
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const timer = setTimeout(() => closeRef.current(), autoCloseMs);
    return () => clearTimeout(timer);
  }, [autoCloseMs]);
  return (
    <MotionConfig reducedMotion="user">
      <motion.div role="dialog" aria-modal="true" aria-label={copy.reviewTitle} dir={language === 'ar' ? 'rtl' : 'ltr'}
        className="fixed inset-0 z-[90] text-white" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
        <ReviewContent copy={copy} url={url} accent={accent} dir={language === 'ar' ? 'rtl' : 'ltr'}>
          <button onClick={onClose} className="mt-10 min-h-14 rounded-2xl px-8 text-lg font-bold" style={{ backgroundColor: accent, color: onAccent }}>{copy.close}</button>
        </ReviewContent>
        <button onClick={onClose} aria-label={copy.close} className="absolute end-5 top-5 z-10 flex h-14 w-14 items-center justify-center rounded-full bg-white/15 backdrop-blur"><X className="h-7 w-7" /></button>
      </motion.div>
    </MotionConfig>
  );
}

/** Small review invitation for the "request sent" screen. */
export function ReviewInvite({ url, language }: { url: string; language: KioskLanguage }) {
  const qr = useQrCode(url, 360);
  const copy = SHOWCASE_COPY[language];
  return (
    <div className="mx-auto mt-8 flex max-w-md items-center gap-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-start">
      {qr ? <img src={qr} alt="QR code" className="h-28 w-28 shrink-0 rounded-xl bg-white p-1" /> : <div className="h-28 w-28 shrink-0 animate-pulse rounded-xl bg-white" />}
      <div>
        <Stars size="h-5 w-5" delay={0.3} />
        <p className="mt-2 text-base font-bold text-slate-800">{copy.reviewInvite}</p>
      </div>
    </div>
  );
}
