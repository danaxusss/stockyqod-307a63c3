/**
 * Shared image-format helpers for every place that imports, stores, or
 * re-embeds product images (product image upload, catalogue, printable
 * catalogue PDF). Centralised so "support this format too" only needs to
 * change here.
 *
 * Supported for import/matching: any raster or vector format a browser can
 * decode into an <img> — jpg, png, webp, gif, bmp, svg, avif, ico, and (where
 * the browser itself can decode them) heic/heif/tiff. A format a given
 * browser can't actually decode still fails cleanly at compress/upload time
 * with a clear error, rather than being rejected upfront by an over-narrow
 * extension allowlist.
 */

/** MIME → canonical file extension used when writing to storage. */
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/pjpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/x-ms-bmp': 'bmp',
  'image/x-windows-bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/tiff': 'tiff',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

/** Extension → MIME, used to recover a type when `File.type` is empty (some
 *  browsers leave it blank for bmp/tiff/heic picked via drag & drop). */
const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif',
  ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff',
  heic: 'image/heic', heif: 'image/heif',
};

/** Filename extensions accepted by bulk import / ref-matching. */
export const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|bmp|svg|avif|ico|tiff?|heic|heif)$/i;

function extOfName(name: string): string | null {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : null;
}

/** Best-guess file extension for a File: its MIME type first, then its
 *  existing filename extension, then 'jpg' as a last resort. */
export function extensionFor(file: File): string {
  const byMime = MIME_TO_EXT[(file.type || '').toLowerCase()];
  if (byMime) return byMime;
  const ext = extOfName(file.name);
  if (ext) return ext === 'jpeg' ? 'jpg' : ext;
  return 'jpg';
}

/** Best-guess MIME type for a File: its own `.type` first, then whatever its
 *  filename extension implies, then 'image/jpeg'. */
export function mimeFor(file: File): string {
  if (file.type) return file.type;
  const ext = extOfName(file.name);
  return (ext && EXT_TO_MIME[ext]) || 'image/jpeg';
}
