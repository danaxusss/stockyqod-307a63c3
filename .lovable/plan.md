

## Plan: Show HT Prices in Tables, Calculate TVA and TTC

### Context
Imported product prices (`price`, `reseller_price`) are already TTC (tax-inclusive). Currently the app displays everything as TTC throughout. The goal is to convert prices to HT for display in item tables, then show the TVA breakdown and TTC total at the bottom.

### Formula
Given a TTC price and TVA rate (default 20%):
- **PU HT** = `unitPrice / (1 + tvaRate / 100)`
- **Total HT** = sum of all item subtotals / (1 + tvaRate / 100)
- **TVA** = Total HT × tvaRate / 100
- **Total TTC** = Total HT + TVA (which equals the original sum)

### Changes

**1. `src/pages/QuoteCartPage.tsx`** — Quote creation/edit UI
- Load `companySettings` to get `tva_rate` (already loaded in the component)
- Change table header "Prix Unitaire" → "PU HT" and "Sous-total" → "Total HT"
- Display `item.unitPrice / (1 + tvaRate/100)` in the price column and subtotals accordingly
- In the totals section at the bottom, show three lines: **Total HT**, **TVA X%**, **Total TTC** instead of just "Total"
- The internal `unitPrice` and `subtotal` values stay as TTC for storage — only the display converts to HT

**2. `src/utils/pdfExport.ts`** — PDF export
- Change item table headers from "PU TTC" / "TOTAL TTC" → "PU HT" / "TOTAL HT"
- For each item row, divide `unitPrice` and row total by `(1 + tvaRate/100)` to show HT values
- The totals section already correctly derives HT/TVA/TTC from the TTC total — no change needed there

**3. `src/utils/excelExport.ts`** — Excel export
- Change headers from "PU TTC" / "TOTAL TTC" → "PU HT" / "TOTAL HT"
- Divide item prices by `(1 + tvaRate/100)` when writing to cells
- Totals calculation already works correctly (derives HT from TTC)

### What stays the same
- Stored prices in the database remain TTC (no data migration)
- `unitPrice` and `subtotal` on `QuoteItem` remain TTC internally
- The TVA rate comes from `company_settings.tva_rate` (default 20%)

