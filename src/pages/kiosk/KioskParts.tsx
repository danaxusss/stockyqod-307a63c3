import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Maximize2, Minus, Plus, SlidersHorizontal, Star, Trash2, X } from 'lucide-react';
import { KioskService, type KioskProduct } from '../../utils/kioskService';
import { fmt, type KioskCopy } from './kioskCopy';

// Presentational pieces of the customer kiosk. Colour roles: the kiosk accent
// is for actions (add, cart, send); selection states are dark slate, prices
// black, so the accent keeps pointing at what to do next.

export type CartLine = { product: KioskProduct; quantity: number };

export function Chip({ active, label, onClick }: { active: boolean; label: ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-11 shrink-0 rounded-xl border-2 px-4 text-base font-bold transition active:scale-95 ${active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700'}`}
    >
      {label}
    </button>
  );
}

export function FiltersButton({ count, label, onClick }: { count: number; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`relative flex h-14 shrink-0 items-center gap-2 rounded-2xl border-2 px-4 text-base font-bold ${count ? 'border-slate-900 text-slate-900' : 'border-slate-200 text-slate-700'} bg-white`}>
      <SlidersHorizontal className="h-5 w-5" />
      <span className="hidden sm:inline">{label}</span>
      {count > 0 && <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-900 px-1.5 text-sm text-white">{count}</span>}
    </button>
  );
}

/** Catalogue → request → sent. */
export function Steps({ current, t, accent, onAccent }: { current: 0 | 1 | 2; t: KioskCopy; accent: string; onAccent: string }) {
  const labels = [t.stepCatalog, t.stepRequest, t.stepSent];
  return (
    <ol aria-label={t.progress} className="flex items-center gap-2 text-sm font-bold">
      {labels.map((label, i) => (
        <li key={label} aria-current={i === current ? 'step' : undefined} className="flex items-center gap-2">
          {i > 0 && <span className="h-0.5 w-5 rounded bg-slate-200" />}
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-full text-xs ${i < current ? 'bg-slate-900 text-white' : i === current ? '' : 'bg-slate-200 text-slate-500'}`}
            style={i === current ? { backgroundColor: accent, color: onAccent } : undefined}
          >
            {i < current ? <Check className="h-4 w-4" /> : i + 1}
          </span>
          <span className={i === current ? 'text-slate-900' : 'text-slate-400'}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

export function ProductImage({ image, name, placeholderLogo, className = '' }: { image: string | null; name: string; placeholderLogo?: string | null; className?: string }) {
  const url = KioskService.imageUrl(image);
  const fallback = placeholderLogo || `${import.meta.env.BASE_URL || '/'}stocky-logo.png`;
  return (
    <div className={`aspect-square w-full overflow-hidden rounded-xl bg-slate-50 flex items-center justify-center ${className}`}>
      {url
        ? <img src={url} alt={name} loading="lazy" className="h-full w-full object-contain p-2" />
        : <img src={fallback} alt="" className="h-2/5 w-2/5 object-contain opacity-25 grayscale" />}
    </div>
  );
}

function Availability({ available, t }: { available: boolean; t: KioskCopy }) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold ${available ? 'text-emerald-700' : 'text-amber-700'}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${available ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      {available ? t.available : t.onRequest}
    </span>
  );
}

export function QuantityStepper({ quantity, onMinus, onPlus, accent, tall }: { quantity: number; onMinus: () => void; onPlus: () => void; accent: string; tall?: boolean }) {
  return (
    <div className={`grid ${tall ? 'min-h-14' : 'min-h-11'} grid-cols-[44px_1fr_44px] overflow-hidden rounded-xl border-2`} style={{ borderColor: accent }}>
      <button onClick={onMinus} aria-label="−" className="flex items-center justify-center bg-white active:bg-slate-100"><Minus className="h-5 w-5" /></button>
      <span className="flex items-center justify-center bg-[var(--kiosk-accent)] text-lg font-black tabular-nums text-[color:var(--kiosk-on-accent)]">{quantity}</span>
      <button onClick={onPlus} aria-label="+" className="flex items-center justify-center bg-white active:bg-slate-100"><Plus className="h-5 w-5" /></button>
    </div>
  );
}

function AddButton({ label, onClick, tall }: { label: string; onClick: () => void; tall?: boolean }) {
  return (
    <button onClick={onClick} className={`${tall ? 'min-h-14 rounded-2xl text-lg' : 'min-h-11 rounded-xl text-base'} w-full font-bold bg-[var(--kiosk-accent)] text-[color:var(--kiosk-on-accent)] active:scale-[0.98] transition`}>
      <Plus className="inline h-5 w-5 me-1" />{label}
    </button>
  );
}

/** Round "enlarge" button laid over a product photo. */
function ZoomButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={label} className="absolute end-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-slate-700 shadow-md active:scale-95">
      <Maximize2 className="h-5 w-5" />
    </button>
  );
}

export function ProductCard({ product, quantity, showPrice, showAvailability, placeholderLogo, t, accent, onOpen, onZoom, onChange }: {
  product: KioskProduct; quantity: number; showPrice: boolean; showAvailability: boolean; placeholderLogo?: string | null;
  t: KioskCopy; accent: string; onOpen: () => void; onZoom: () => void; onChange: (delta: number) => void;
}) {
  const hasImage = !!KioskService.imageUrl(product.image);
  return (
    <article className="relative flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button onClick={onOpen} className="flex flex-1 flex-col p-2 text-start">
        <span className="relative block w-full">
          <ProductImage image={product.image} name={product.name} placeholderLogo={placeholderLogo} className="!aspect-[4/3]" />
          {showAvailability && (
            <span className="absolute bottom-1.5 start-1.5 rounded-full bg-white/95 px-2 py-0.5 text-[11px] shadow-sm"><Availability available={product.available} t={t} /></span>
          )}
        </span>
        <p className="mt-2 min-h-4 truncate px-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">{product.brand || ''}</p>
        <h2 className="mt-0.5 line-clamp-2 min-h-[2.5rem] px-0.5 text-[0.95rem] font-bold leading-5">{product.name}</h2>
        {showPrice && <p className="mt-1.5 px-0.5 text-lg font-black tabular-nums text-slate-900">{fmt(product.price || 0)} DH</p>}
      </button>
      <div className="mt-auto px-2 pb-2">
        {quantity > 0
          ? <QuantityStepper quantity={quantity} onMinus={() => onChange(-1)} onPlus={() => onChange(1)} accent={accent} />
          : <AddButton label={t.add} onClick={() => onChange(1)} />}
      </div>
      {product.featured && (
        <span className="pointer-events-none absolute start-3 top-3 z-10 inline-flex items-center gap-1 rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-bold text-white">
          <Star className="h-3 w-3 fill-amber-400 text-amber-400" />{t.featured}
        </span>
      )}
      {hasImage && <ZoomButton label={t.zoom} onClick={onZoom} />}
    </article>
  );
}

export function ProductDialog({ product, quantity, showPrice, showAvailability, placeholderLogo, t, accent, onClose, onZoom, onChange }: {
  product: KioskProduct; quantity: number; showPrice: boolean; showAvailability: boolean; placeholderLogo?: string | null;
  t: KioskCopy; accent: string; onClose: () => void; onZoom: () => void; onChange: (delta: number) => void;
}) {
  const hasImage = !!KioskService.imageUrl(product.image);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/60 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <section role="dialog" aria-label={product.name} className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <p className="truncate text-sm font-bold uppercase tracking-wide text-slate-500">{product.brand || ''}</p>
          <button onClick={onClose} aria-label={t.close} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-100 active:bg-slate-200"><X className="h-6 w-6" /></button>
        </div>
        {/* Side by side on a landscape screen, stacked on a vertical one. */}
        <div className="grid gap-5 overflow-y-auto p-5 landscape:grid-cols-2">
          <div className="relative">
            {hasImage
              ? <button onClick={onZoom} aria-label={t.zoom} className="block w-full"><ProductImage image={product.image} name={product.name} placeholderLogo={placeholderLogo} className="portrait:max-h-[45vh] portrait:aspect-auto portrait:h-[45vh]" /></button>
              : <ProductImage image={product.image} name={product.name} placeholderLogo={placeholderLogo} className="portrait:max-h-[35vh] portrait:aspect-auto portrait:h-[35vh]" />}
            {hasImage && <span className="pointer-events-none absolute end-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-slate-700 shadow-md"><Maximize2 className="h-5 w-5" /></span>}
          </div>
          <div className="flex flex-col">
            <h2 className="text-2xl font-black leading-tight md:text-3xl">{product.name}</h2>
            <p className="mt-2 font-mono text-sm text-slate-400">{t.reference} {product.barcode}</p>
            {showAvailability && <p className="mt-3 text-base"><Availability available={product.available} t={t} /></p>}
            {showPrice && <p className="mt-4 text-3xl font-black tabular-nums text-slate-900">{fmt(product.price || 0)} DH</p>}
            <div className="mt-auto pt-6">
              {quantity
                ? <QuantityStepper quantity={quantity} onMinus={() => onChange(-1)} onPlus={() => onChange(1)} accent={accent} tall />
                : <AddButton label={t.add} onClick={() => onChange(1)} tall />}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * Full-screen photo. Tap the photo to zoom in on that point and again to zoom
 * out; tap outside or the close button to leave.
 */
export function ImageViewer({ product, t, onClose }: { product: KioskProduct; t: KioskCopy; onClose: () => void }) {
  const url = KioskService.imageUrl(product.image);
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!url) return null;
  return (
    <div role="dialog" aria-label={product.name} className="fixed inset-0 z-[90] flex flex-col bg-slate-950/95" onClick={onClose}>
      <div className="flex items-center justify-between gap-4 px-5 py-4 text-white">
        <p className="line-clamp-2 text-lg font-bold">{product.name}</p>
        <button ref={closeRef} onClick={onClose} aria-label={t.close} className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/15 active:bg-white/25"><X className="h-7 w-7" /></button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
        <img
          src={url}
          alt={product.name}
          onClick={e => {
            e.stopPropagation();
            if (zoom) { setZoom(null); return; }
            const box = e.currentTarget.getBoundingClientRect();
            setZoom({ x: ((e.clientX - box.left) / box.width) * 100, y: ((e.clientY - box.top) / box.height) * 100 });
          }}
          className={`h-full w-full object-contain transition-transform duration-300 ${zoom ? 'cursor-zoom-out' : 'cursor-zoom-in'}`}
          style={zoom ? { transform: 'scale(2.2)', transformOrigin: `${zoom.x}% ${zoom.y}%` } : undefined}
        />
      </div>
    </div>
  );
}

export function FiltersPanel({ open, title, closeLabel, onClose, onReset, resetLabel, showLabel, children }: {
  open: boolean; title: string; closeLabel: string; onClose: () => void; onReset: () => void; resetLabel: string; showLabel: string; children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/50 backdrop-blur-sm landscape:items-center landscape:p-6" onClick={onClose}>
      <section role="dialog" aria-label={title} className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-t-3xl bg-white shadow-2xl landscape:rounded-3xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-xl font-black">{title}</h2>
          <button onClick={onClose} aria-label={closeLabel} className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100"><X className="h-6 w-6" /></button>
        </div>
        <div className="space-y-6 overflow-y-auto px-5 py-5">{children}</div>
        <div className="flex gap-3 border-t border-slate-100 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <button onClick={onReset} className="min-h-14 flex-1 rounded-2xl border-2 border-slate-200 px-4 text-base font-bold text-slate-700">{resetLabel}</button>
          <button onClick={onClose} className="min-h-14 flex-[2] rounded-2xl bg-slate-900 px-4 text-base font-bold text-white">{showLabel}</button>
        </div>
      </section>
    </div>
  );
}

export function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-sm font-bold text-slate-500">{label}</p>
      <div role="group" aria-label={label} className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export function ReviewLine({ line, showPrice, placeholderLogo, accent, removeLabel, zoomLabel, onSet, onZoom }: {
  line: CartLine; showPrice: boolean; placeholderLogo?: string | null; accent: string; removeLabel: string; zoomLabel: string;
  onSet: (quantity: number) => void; onZoom: () => void;
}) {
  const hasImage = !!KioskService.imageUrl(line.product.image);
  const image = <ProductImage image={line.product.image} name={line.product.name} placeholderLogo={placeholderLogo} />;
  return (
    <div className="grid grid-cols-[72px_1fr] items-center gap-x-3 gap-y-3 rounded-2xl border border-slate-200 bg-white p-3 sm:grid-cols-[80px_1fr_auto_auto]">
      {hasImage ? <button onClick={onZoom} aria-label={zoomLabel}>{image}</button> : image}
      <div className="min-w-0">
        <p className="truncate text-xs font-bold uppercase text-slate-400">{line.product.brand}</p>
        <h2 className="mt-0.5 line-clamp-2 text-base font-bold leading-snug">{line.product.name}</h2>
        {showPrice && <p className="mt-1 font-black tabular-nums text-slate-900">{fmt((line.product.price || 0) * line.quantity)} DH</p>}
      </div>
      <div className="col-span-2 grid grid-cols-[1fr_56px] gap-3 sm:col-span-2 sm:grid-cols-[160px_56px]">
        <div className="grid h-14 grid-cols-[52px_1fr_52px] overflow-hidden rounded-xl border-2" style={{ borderColor: accent }}>
          <button onClick={() => onSet(line.quantity - 1)} aria-label="−" className="flex items-center justify-center active:bg-slate-100"><Minus className="h-5 w-5" /></button>
          <input type="number" min={1} max={999} value={line.quantity} onChange={e => onSet(Number(e.target.value) || 1)} className="w-full bg-[var(--kiosk-accent)] text-center text-xl font-black text-[color:var(--kiosk-on-accent)] outline-none" />
          <button onClick={() => onSet(line.quantity + 1)} aria-label="+" className="flex items-center justify-center active:bg-slate-100"><Plus className="h-5 w-5" /></button>
        </div>
        <button onClick={() => onSet(0)} aria-label={removeLabel} className="flex h-14 items-center justify-center rounded-xl border-2 border-red-200 text-red-600 active:bg-red-50"><Trash2 className="h-5 w-5" /></button>
      </div>
    </div>
  );
}

export function KioskInput({ label, value, onChange, required, disabled, inputMode }: {
  label: string; value: string; onChange: (value: string) => void; required?: boolean; disabled?: boolean; inputMode?: 'text' | 'tel' | 'email';
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-base font-bold">{label}{required && <span className="text-red-500"> *</span>}</span>
      <input
        disabled={disabled} inputMode={inputMode} type={inputMode === 'email' ? 'email' : 'text'} value={value} onChange={e => onChange(e.target.value)}
        className="h-14 w-full rounded-2xl border-2 border-slate-200 bg-white px-4 text-lg outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-900/10 disabled:cursor-not-allowed disabled:bg-slate-100"
      />
    </label>
  );
}
