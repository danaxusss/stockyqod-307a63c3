import type { Product } from '../types';
import { extensionFor } from './imageFormats';

export type ImageSearchResult = {
  url: string;
  thumbnail: string;
  width: number | null;
  height: number | null;
  title: string;
  source: string;
  page: string | null;
};

const EAN_RE = /^\d{8,14}$/;

/** "Brand + product name" without repeating the brand when the name already contains it. */
export function buildImageQuery(product: Pick<Product, 'name' | 'brand'>): string {
  const name = (product.name || '').replace(/\s+/g, ' ').trim();
  const brand = (product.brand || '').replace(/\s+/g, ' ').trim();
  if (!brand || name.toLowerCase().includes(brand.toLowerCase())) return name;
  return `${brand} ${name}`.trim();
}

/** A barcode is worth searching on its own only when it looks like an EAN/UPC. */
export function barcodeQuery(barcode: string): string | null {
  const value = barcode.trim();
  return EAN_RE.test(value) ? value : null;
}

export function googleImagesUrl(query: string): string {
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`;
}

/** Text pasted by the user that is a web address (e.g. "Copy image address" in Google Images). */
export function pastedImageUrl(text: string): string | null {
  const value = text.trim();
  if (!/^https?:\/\/\S+$/i.test(value)) return null;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

export function base64ToFile(data: string, contentType: string, baseName: string): File {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  const extension = extensionFor(new File([], baseName, { type: contentType }));
  return new File([bytes], `${baseName}.${extension}`, { type: contentType });
}

export function sizeLabel(result: Pick<ImageSearchResult, 'width' | 'height'>): string {
  return result.width && result.height ? `${result.width}×${result.height}` : '';
}

/** Products to work through in the image finder, in catalogue order. */
export function imageQueue(products: Product[], options: {
  missingOnly: boolean;
  brand: string;
  search: string;
  images: Record<string, string | null | undefined>;
}): Product[] {
  const search = options.search.trim().toLowerCase();
  return products.filter(product => {
    const image = product.barcode in options.images ? options.images[product.barcode] : product.image;
    if (options.missingOnly && image) return false;
    if (options.brand && product.brand !== options.brand) return false;
    if (search && !product.name.toLowerCase().includes(search) && !product.barcode.toLowerCase().includes(search)) return false;
    return true;
  });
}

