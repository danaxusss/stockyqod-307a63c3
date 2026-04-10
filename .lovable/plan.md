

## Plan: Show Original Brand Name as Internal Reference

### Summary
When a brand has been renamed via product settings, show the original name as a subtle tooltip/badge next to the custom name — visible only to internal users (search, catalogue, quote cart), but hidden from client-facing outputs (PDF exports, public share pages).

### Changes

#### 1. Create a shared hook: `useProductOverrides`
- New file `src/hooks/useProductOverrides.ts`
- Loads `product_name_overrides` from the database once, caches in state
- Exposes a helper: `getOriginalName(type: 'brand'|'provider', currentName: string) => string | null`
- Returns the `original_name` if `currentName` matches any `custom_name` in the overrides table

#### 2. Search page (`Search.tsx`)
- Import `useProductOverrides`
- Next to the brand badge, if `getOriginalName('brand', product.brand)` returns a value, show a small muted text like `(ex: CHM)` or a tooltip on the brand badge

#### 3. Products Catalogue (`ProductsPage.tsx`)
- Same approach: in the brand column, append `(ex: CHM)` in smaller muted text when an override exists

#### 4. Quote Cart page (`QuoteCartPage.tsx`)
- In the cart item display where `product.brand` is shown, append the original name hint
- **Not** included in the PDF export — only in the on-screen cart view

#### 5. Product Detail page (`ProductDetail.tsx`)
- In the brand badge area, show the original name as a subtitle or tooltip

### Visual Design
The original name will appear as a small, muted annotation — e.g.:
```
[Restom] (ex: CHM)
```
Using `text-muted-foreground text-[10px]` styling so it's clearly secondary information.

### Files

| File | Action |
|------|--------|
| `src/hooks/useProductOverrides.ts` | Create — shared hook to load overrides and resolve original names |
| `src/pages/Search.tsx` | Add original brand hint next to brand badge |
| `src/pages/ProductsPage.tsx` | Add original brand hint in brand column |
| `src/pages/QuoteCartPage.tsx` | Add original brand hint in cart items (screen only) |
| `src/pages/ProductDetail.tsx` | Add original brand hint in header |

