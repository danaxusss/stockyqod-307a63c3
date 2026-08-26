import type { Product } from '../types';

export const PRODUCT_IMAGE_BATCH_LIMIT = 100;
export const PRODUCT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

const IMAGE_EXTENSION = /\.(jpe?g|png|webp)$/i;

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

export function analyzeProductImageFiles(
  files: File[],
  products: Product[],
  limit = PRODUCT_IMAGE_BATCH_LIMIT,
): ProductImageBatchAnalysis {
  const productsByBarcode = new Map(products.map(product => [product.barcode, product]));
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

    const barcode = productBarcodeFromFilename(file.name);
    const product = productsByBarcode.get(barcode);
    if (!product) {
      unmatched.push(file);
      continue;
    }
    if (seenBarcodes.has(barcode)) {
      duplicates.push(file);
      continue;
    }

    seenBarcodes.add(barcode);
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
