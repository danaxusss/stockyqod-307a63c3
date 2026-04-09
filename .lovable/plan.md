

## Plan: Replace Excel Export with PDF Quote Generation + Company Settings

### Summary
Remove the Excel template system entirely. Replace it with a professional PDF quote generator (client-side using `jsPDF` + `jspdf-autotable`). Add a Company Settings page where admins configure company details, logo, and choose which elements appear on the quote. The PDF design follows the uploaded reference (clean, professional French "devis" layout).

### Database Changes

**New table: `company_settings`** (single-row config table)
- `id` (uuid, PK)
- `company_name` (text)
- `address` (text)
- `phone` (text)
- `email` (text)
- `website` (text)
- `ice` (text) — company tax ID
- `logo_url` (text, nullable) — stored in Supabase Storage
- `quote_visible_fields` (jsonb) — toggles for which elements show on the quote: `{ showLogo, showCompanyAddress, showCompanyPhone, showCompanyEmail, showCompanyWebsite, showCompanyICE, showClientICE, showTVA, showNotes, showPaymentTerms, showValidityDate }`
- `payment_terms` (text, default "30 jours")
- `tva_rate` (numeric, default 20)
- `quote_validity_days` (integer, default 30)
- `updated_at` (timestamptz)

RLS: readable by all authenticated (anon), writable by admin users only.

**New storage bucket: `company-assets`** for logo uploads.

### Files to Create/Modify

1. **`src/utils/pdfExport.ts`** (NEW)
   - Uses `jsPDF` + `jspdf-autotable` (lightweight, no exceljs dependency for export)
   - Generates a professional PDF matching the reference design:
     - Company logo + name (top-left), "DEVIS" title (top-right)
     - Company details below logo
     - Client info in a bordered box
     - Subject line
     - Product table: Description, QTÉ, Prix U. HT, TVA%, TVA €, Total HT
     - Totals section: Total HT, Total TVA, Total TTC (highlighted)
     - Footer: payment terms, conditions, company legal info
   - Respects `quote_visible_fields` settings

2. **`src/pages/CompanySettingsPage.tsx`** (NEW)
   - Admin-only settings page
   - Form fields: company name, address, phone, email, website, ICE
   - Logo upload (drag & drop or file picker) → stored in Supabase Storage
   - Toggle checkboxes for each quote element visibility
   - TVA rate, payment terms, quote validity days
   - Live preview thumbnail of the quote layout

3. **`src/utils/companySettings.ts`** (NEW)
   - CRUD service for `company_settings` table
   - Logo upload/delete via Supabase Storage

4. **`src/pages/QuoteCartPage.tsx`** (MODIFY)
   - Remove all template-related state, useEffects, and UI (template upload, active template info, "Gérer Templates" button)
   - Replace `handleExport` to call `PdfExportService.exportQuoteToPdf()` instead of `ExcelExportService.exportQuoteToExcel()`
   - Change "Export Excel" section to "Export PDF"
   - Load company settings on mount to pass to PDF generator

5. **`src/pages/QuotesHistoryPage.tsx`** (MODIFY)
   - Update `handleExport` to use PDF export instead of Excel

6. **`src/App.tsx`** (MODIFY)
   - Add route `/admin/settings` → `CompanySettingsPage`

7. **`src/components/Header.tsx`** or navigation (MODIFY)
   - Add "Paramètres" link for admin users

8. **`src/utils/excelExport.ts`** (MODIFY)
   - Keep only `generateQuoteNumber`, `formatDate`, `formatCurrency`, `calculateTotals`, `exportItemsToExcel`, `generateCopyText`
   - Remove `exportQuoteToExcel`, `createDefaultTemplateWithExcelJS`, `populateWorksheetWithExcelJS`, `validateTemplate`

9. **`src/types/index.ts`** (MODIFY)
   - Remove `QuoteTemplate` interface
   - Add `CompanySettings` and `QuoteVisibleFields` interfaces

### PDF Design (matching reference screenshot)
- Blue accent color (`#3B82F6`) for headers and highlighted rows
- Company logo top-left, "DEVIS" in large blue text top-right
- Quote number, date, validity date aligned right
- Client box with light border
- Table with blue header row, alternating light gray rows
- Totals right-aligned with "TOTAL TTC" in blue highlight
- Footer with payment terms and legal text

### Dependencies
- Install `jspdf` and `jspdf-autotable` (small, client-side PDF generation)

