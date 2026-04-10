

## Plan: Technical Sheets Management System

### Overview
Build a full technical sheets module with its own storage, many-to-many product linking, and public sharing — all fresh, not reusing Bolt's infrastructure.

---

### 1. Database Migration

**New tables:**

- **`technical_sheets`** — id (uuid), title (text), manufacturer (text), category (text), file_url (text), file_size (bigint), file_type (text), view_count (int default 0), download_count (int default 0), created_at, updated_at
- **`technical_sheet_products`** — id (uuid), sheet_id (uuid FK → technical_sheets), product_barcode (text), created_at. UNIQUE(sheet_id, product_barcode)
- **`sheet_share_links`** — id (uuid), token (text UNIQUE), title (text nullable), sheet_ids (uuid[]), expires_at (timestamptz nullable), view_count (int default 0), created_at

**New storage bucket:** `technical-sheets` (fresh bucket, separate from existing `techsheets`)

All tables get public RLS policies (matching existing app pattern). Bucket gets public read/write/delete policies.

**Data migration:** SQL to migrate existing `products.techsheet` URLs into the new `technical_sheets` table and create corresponding `technical_sheet_products` junction entries.

---

### 2. New Page: Fiches Techniques (`/sheets`)

`src/pages/TechnicalSheetsPage.tsx` — Full management page:
- **List view**: Table/cards of all sheets, searchable by title/manufacturer/category
- **Filters**: By manufacturer, category
- **Upload**: File picker, set title/manufacturer/category metadata on upload
- **Sheet detail modal**: View metadata, see linked products, link/unlink products via product search
- **Share feature**: Select multiple sheets → generate share link with optional title and expiration (Never / 1 day / 7 days / 30 days). Copy link. Manage existing share links.
- **Stats**: View/download counts displayed per sheet

---

### 3. New Page: Public Share (`/share/:token`)

`src/pages/PublicSharePage.tsx`:
- No auth required (route placed before auth gate in App.tsx)
- Displays shared sheets as cards with title, manufacturer, category
- Download individual files
- Shows collection title, expiry status
- Increments view count on load

---

### 4. Product Detail Updates

Replace current single-techsheet upload with a **Linked Sheets** section:
- List all linked sheets (from junction table)
- Search existing sheets and link them
- Upload a new sheet directly (auto-linked to current product)
- Unlink/download sheets
- Remove old single-file upload logic

---

### 5. Search Page Updates

Update paperclip icon to query junction table for linked sheets count. Clicking shows a mini list of linked sheets for quick download.

---

### 6. Navigation & Routing

- Add "Fiches Techniques" nav link in Header (FileText icon, route `/sheets`)
- Add routes: `/sheets`, `/share/:token` (public, before auth gate)

---

### 7. Types

Add to `src/types/index.ts`:
```
TechnicalSheet { id, title, manufacturer, category, file_url, file_size, file_type, view_count, download_count, created_at, updated_at }
SheetShareLink { id, token, title, sheet_ids, expires_at, view_count, created_at }
```

---

### Files Summary

| File | Action |
|------|--------|
| Migration SQL | Create 3 tables + bucket + migrate existing data |
| `src/types/index.ts` | Add TechnicalSheet, SheetShareLink types |
| `src/pages/TechnicalSheetsPage.tsx` | Create — sheets management |
| `src/pages/PublicSharePage.tsx` | Create — public share viewer |
| `src/pages/ProductDetail.tsx` | Modify — linked sheets section |
| `src/pages/Search.tsx` | Modify — multi-sheet paperclip |
| `src/components/Header.tsx` | Modify — add nav link |
| `src/App.tsx` | Modify — add routes |

