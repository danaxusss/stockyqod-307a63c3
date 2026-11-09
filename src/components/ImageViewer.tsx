import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

/**
 * Full-screen view of an image (product posters are 4:5 with text, so they
 * need the whole screen to be read). Tap the image to zoom on that point and
 * again to zoom out; tap outside, Escape or the close button to leave.
 */
export function ImageViewer({ src, alt, title, closeLabel = 'Fermer', onClose }: {
  src: string;
  alt: string;
  title?: string;
  closeLabel?: string;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div role="dialog" aria-label={title || alt} className="fixed inset-0 z-[200] flex flex-col bg-slate-950/95" onClick={onClose}>
      <div className="flex items-center justify-between gap-4 px-5 py-4 text-white">
        <p className="line-clamp-2 text-lg font-bold">{title || alt}</p>
        <button ref={closeRef} onClick={onClose} aria-label={closeLabel} className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/15 active:bg-white/25 hover:bg-white/25"><X className="h-7 w-7" /></button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
        <img
          src={src}
          alt={alt}
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
