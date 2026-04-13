import { QuoteItem } from '../types';

export type QuoteItemDisplayField = 'quoteName' | 'quoteBrand' | 'quoteBarcode';

function getOriginalFieldValue(item: QuoteItem, field: QuoteItemDisplayField): string {
  switch (field) {
    case 'quoteName':
      return item.product.name;
    case 'quoteBrand':
      return item.product.brand;
    case 'quoteBarcode':
      return item.product.barcode;
    default:
      return '';
  }
}

export function getQuoteItemName(item: QuoteItem): string {
  return item.quoteName ?? item.product.name;
}

export function getQuoteItemBrand(item: QuoteItem): string {
  return item.quoteBrand ?? item.product.brand;
}

export function getQuoteItemBarcode(item: QuoteItem): string {
  return item.quoteBarcode ?? item.product.barcode;
}

export function applyQuoteItemDisplayOverride(
  item: QuoteItem,
  field: QuoteItemDisplayField,
  value: string,
): QuoteItem {
  const originalValue = getOriginalFieldValue(item, field);
  const nextValue = value === originalValue ? undefined : value;

  return {
    ...item,
    [field]: nextValue,
  } as QuoteItem;
}