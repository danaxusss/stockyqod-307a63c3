import type { Product } from '../types';
import { IMAGE_EXT_RE } from './imageFormats';

export const PRODUCT_IMAGE_BATCH_LIMIT = 1000;
export const PRODUCT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

// Accepts any format the browser can decode (jpg, png, webp, gif, bmp, svg,
// avif, ico…) rather than a narrow allowlist — see imageFormats.ts. A format
// a specific browser can't actually render still fails cleanly later, at
// compression time, with a clear "Image illisible" error.
const IMAGE_EXTENSION = IMAGE_EXT_RE;

export type ProductImageCandidate = {
  file: File;
  product: Product;
  replacesExisting: boolean;
};

export type ProductImageIssue = {
  file: File;
  reason: string;
};

export interface ProductImageBatchAnalysis {
  candidates: ProductImageCandidate[];
  newImages: ProductImageCandidate[];
  replacements: ProductImageCandidate[];
  unmatched: File[];
  invalid: ProductImageIssue[];
  duplicates: File[];
  overflow: File[];
}

export function isSupportedProductImage(filename: string): boolean {
  return IMAGE_EXTENSION.test(filename);
}

export function productBarcodeFromFilename(filename: string): string {
  return filename.trim().replace(/\.[^/.]+$/, '').trim();
}

/**
 * A product code as it can appear in a file name: lower case, letters and
 * digits only. File names cannot hold "/", so "PL1G/130" is saved as
 * "PL1G_130.jpg"; both give "pl1g130".
 */
export function looseProductCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * A product code as a storage file name. Storage refuses keys with "%",
 * so encoding "PL1G/130" as "PL1G%2F130" failed for every code holding a
 * "/" (about 1,160 products); anything other than letters, digits, dot,
 * dash and underscore becomes "_".
 */
export function storageSafeCode(code: string): string {
  return code.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'produit';
}

export function analyzeProductImageFiles(
  files: File[],
  products: Product[],
  limit = PRODUCT_IMAGE_BATCH_LIMIT,
): ProductImageBatchAnalysis {
  const productsByBarcode = new Map(products.map(product => [product.barcode, product]));
  // Second chance for names whose separators differ from the code. Used only
  // when it points to a single product: "157-20" and "15720" both exist.
  const productsByLooseCode = new Map<string, Product[]>();
  for (const product of products) {
    const key = looseProductCode(product.barcode);
    if (!key) continue;
    productsByLooseCode.set(key, [...(productsByLooseCode.get(key) || []), product]);
  }
  const selectedFiles = files.slice(0, limit);
  const seenBarcodes = new Set<string>();
  const candidates: ProductImageCandidate[] = [];
  const unmatched: File[] = [];
  const invalid: ProductImageIssue[] = [];
  const duplicates: File[] = [];

  for (const file of selectedFiles) {
    if (!isSupportedProductImage(file.name)) {
      invalid.push({ file, reason: 'format non pris en charge' });
      continue;
    }
    if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
      invalid.push({ file, reason: 'fichier supérieur à 10 Mo' });
      continue;
    }

    const name = productBarcodeFromFilename(file.name);
    let product = productsByBarcode.get(name);
    if (!product) {
      const loose = productsByLooseCode.get(looseProductCode(name)) || [];
      if (loose.length > 1) {
        invalid.push({ file, reason: `plusieurs produits possibles : ${loose.map(p => p.barcode).join(', ')}` });
        continue;
      }
      product = loose[0];
    }
    if (!product) {
      unmatched.push(file);
      continue;
    }
    if (seenBarcodes.has(product.barcode)) {
      duplicates.push(file);
      continue;
    }

    seenBarcodes.add(product.barcode);
    candidates.push({ file, product, replacesExisting: !!product.image });
  }

  return {
    candidates,
    newImages: candidates.filter(candidate => !candidate.replacesExisting),
    replacements: candidates.filter(candidate => candidate.replacesExisting),
    unmatched,
    invalid,
    duplicates,
    overflow: files.slice(limit),
  };
}
