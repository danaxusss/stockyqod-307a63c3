

## Plan: Multiple Enhancements

### 1. Add sector filter to Technical Sheets
Add a new "Secteur" filter dropdown with options: Cafeteria, Restaurant, Patisserie, Boucherie, Hotellerie, Autre.

**Changes:**
- **Migration**: Add `sector` text column to `technical_sheets` table (default `''`)
- **TechnicalSheetsPage.tsx**: Add `SECTORS` constant, add sector filter dropdown, add sector field to upload modal, display sector badge on cards

### 2. Bulk import for Technical Sheets
Allow uploading multiple PDF files at once. Each file creates a technical_sheet entry with the filename as title.

**Changes:**
- **TechnicalSheetsPage.tsx**: Add "Import en masse" button, multi-file input (`multiple` attribute), loop through files to upload each one with shared manufacturer/category/sector metadata

### 3. Multi-select products to link to a sheet
In the sheet detail modal's product search, add checkboxes so users can select multiple products from results and link them all at once (instead of one-by-one which clears search).

**Changes:**
- **TechnicalSheetsPage.tsx**: Add `selectedProductsToLink` state (Set of barcodes), render checkboxes next to search results, add "Lier X produits" bulk action button, keep search results visible after linking

### 4. Remove Lovable branding from public share page loading
Replace the `PageLoader` spinner on the share route with a plain spinner (no Lovable logo).

**Changes:**
- **App.tsx**: Replace `<PageLoader />` fallback for the share route with a simple inline spinner `<div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400" /></div>`

### 5. Fix PDF viewing (Edge blocking)
The "Voir" button opens the raw storage URL which Edge blocks. Instead of `target="_blank"` direct link, use an inline PDF viewer or force download.

**Changes:**
- **TechnicalSheetsPage.tsx** and **PublicSharePage.tsx**: Change "Voir" to download the file (using `fetch` + blob + `URL.createObjectURL`) or embed in an iframe modal. The simplest fix: add `?download=` param or use a download approach. Best approach: open an in-app modal with an `<iframe src={url}>` for PDF preview.

### 6. Add paperclip icon + add-to-cart on Products Catalogue page
**Changes:**
- **ProductsPage.tsx**: 
  - Fetch `technical_sheet_products` junction data on mount to get sheet counts per barcode
  - Show Paperclip icon in the actions column for products with linked sheets
  - Add "Add to cart" (ShoppingCart/Plus icon) button in the actions column
  - Import `useQuoteCart` and `useAuth` for cart + price logic

### 7. Redesign Home page
Reorganize into clear sections with priority-based layout.

**Changes to Home.tsx:**
- **Main navigation cards** (large, prominent): Rechercher, Catalogue Produits, Fiches Techniques, Clients, Devis (history + new), Paramètres
- **Admin tools section** (smaller, at bottom): Synchroniser, Upload Excel, Statistiques
- **Debug/danger section** (smallest, very bottom, collapsible): Debug, Vider la Base
- Keep existing stats bar

### Files Summary

| File | Action |
|------|--------|
| Migration SQL | Add `sector` column to `technical_sheets` |
| `src/pages/TechnicalSheetsPage.tsx` | Sector filter, bulk import, multi-select product linking, PDF viewer modal |
| `src/pages/PublicSharePage.tsx` | PDF viewer fix, remove Lovable branding from loading |
| `src/pages/ProductsPage.tsx` | Add paperclip icon + add-to-cart button |
| `src/pages/Home.tsx` | Redesign with organized sections |
| `src/App.tsx` | Plain spinner for share route fallback |

