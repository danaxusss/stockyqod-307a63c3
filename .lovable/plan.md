

## Plan: Embed Technical Sheets Share Link in Quote PDF

### Summary
When exporting a quote to PDF, automatically detect which products have linked technical sheets, generate a share link for those sheets, and embed a clickable link in the PDF. Add an expiry option on the quote page and make the link section non-printable in the digital PDF.

### Changes

#### 1. QuoteCartPage.tsx — Add tech sheets toggle & expiry option

- Before the export button area, add a collapsible section:
  - **"Joindre fiches techniques"** checkbox/toggle (default: on if any items have linked sheets)
  - **Expiry dropdown**: Never / 7 jours / 30 jours / 90 jours
- On export, if toggle is on:
  - Query `technical_sheet_products` for all product barcodes in the quote
  - Collect unique sheet IDs
  - Create a `sheet_share_links` entry with those sheet IDs, the chosen expiry, and title = quote number
  - Pass the generated share URL to `PdfExportService.exportQuoteToPdf()`

#### 2. PdfExportService (pdfExport.ts) — Render link in PDF

- Add optional `techSheetsUrl?: string` parameter to `exportQuoteToPdf`
- After the notes section (before page number fix), if `techSheetsUrl` is provided:
  - Draw a small section with text: "📎 Fiches techniques : " followed by a clickable link (using `doc.textWithLink()`)
  - Use a light gray color and small font (6-7pt) so it's subtle
  - jsPDF supports clickable links via `doc.textWithLink()` which work in digital PDFs
  - Add a small italic note: "(lien valable X jours)" or "(lien permanent)"

### Technical Details

- `doc.textWithLink(text, x, y, { url })` creates a clickable hyperlink in jsPDF — works in all PDF viewers digitally
- When printed, the link text will still appear but won't be clickable (inherent PDF behavior) — this is acceptable. To minimize print clutter, use small/subtle styling.
- The share URL format: `{window.location.origin}/share/{token}`
- The share link creation reuses existing `sheet_share_links` table logic from TechnicalSheetsPage

### Files

| File | Action |
|------|--------|
| `src/pages/QuoteCartPage.tsx` | Add toggle + expiry UI, generate share link on export |
| `src/utils/pdfExport.ts` | Accept optional URL, render clickable link after notes |

