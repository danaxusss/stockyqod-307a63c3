

## Plan: Search by Old Brand Names + Fix Background Contrast

### 1. Make old brand names searchable

**File: `src/hooks/useSearchState.ts`**

Modify `searchProductsLocally` to accept an optional overrides list. When building the searchable text for each product, also append any original brand/provider names from the overrides table so that typing "CHM" finds products now branded "Restom".

**File: `src/hooks/useSearchState.ts` (hook)**

Import and use `useProductOverrides` to pass overrides into the search function.

Alternatively, since `searchProductsLocally` is a pure function called inside the hook, the hook will:
- Load overrides via the existing `useProductOverrides` hook (or inline the same logic)
- Build a lookup map: `custom_name → original_name`
- In the search filter, expand the searchable text to include the original brand name if it exists

The change to `searchProductsLocally`:
```
// Before
const searchableText = `${product.name} ${product.brand || ''}`.toLowerCase();

// After — also include original brand name from overrides
const originalBrand = brandOverrideMap.get((product.brand || '').toLowerCase()) || '';
const searchableText = `${product.name} ${product.brand || ''} ${originalBrand}`.toLowerCase();
```

This also needs to work in `ProductsPage.tsx` if it has its own filtering logic.

**File: `src/pages/ProductsPage.tsx`** — Apply same override-aware search to the catalog filter.

### 2. Fix background/card contrast (global)

The screenshot shows dark mode with background at `240 50% 4%` and cards at `240 40% 8%` — only 4% lightness difference, making cards barely distinguishable.

**File: `src/index.css`** — Increase contrast between background and cards in dark mode:

| Token | Current | New |
|-------|---------|-----|
| `--background` | `240 50% 4%` | `240 50% 3%` (darker) |
| `--card` | `240 40% 8%` | `240 40% 11%` (lighter) |
| `--popover` | `240 40% 8%` | `240 40% 11%` |
| `--secondary` | `240 30% 14%` | `240 30% 16%` |
| `--muted` | `240 30% 12%` | `240 30% 14%` |
| `--border` | `240 30% 16%` | `240 30% 18%` |
| `--input` | `240 30% 16%` | `240 30% 18%` |

This widens the gap from ~4% to ~8% lightness difference, making cards, inputs, and interactive elements clearly stand out from the page background across all pages.

### Files

| File | Action |
|------|--------|
| `src/index.css` | Adjust dark mode HSL values for better contrast |
| `src/hooks/useSearchState.ts` | Include original brand names in searchable text |
| `src/hooks/useProductOverrides.ts` | Add `overrides` array to return value for external use |
| `src/pages/ProductsPage.tsx` | Apply override-aware filtering if local filter exists |

