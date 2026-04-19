# Stocky QOD — Agent Handout

> Complete context for an agent picking up this project cold.
> Owner: Nouredine Harchi — QodWeb, Casablanca.
> Live URL: https://stocky.qodweb.com
> GitHub: danaxusss/stockyqod-307a63c3 (branch: `main`)

---

## 1. What This Is

A **multi-company inventory & commercial PWA** for B2B sales teams in Morocco.
Core flows: browse products → build quotes → export PDF → share via WhatsApp/email.
Extended flow (compta role): Quote → BL → Proforma → Invoice(s).

All UI is in **French**. Currency is **Dirhams (Dh)**. TVA default 20%.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 18 + TypeScript, Vite |
| Routing | React Router v6, all pages lazy-loaded |
| Styling | Tailwind CSS + custom dark theme (Midnight Indigo) |
| Backend | Supabase (PostgreSQL + Storage + RLS) |
| PDF | jsPDF + jsPDF-AutoTable |
| PWA | Vite PWA plugin, service worker |
| Hosting | Hostinger Node.js — auto-deploys from GitHub `main` |
| AI widget | OpenRouter API (configured per company in settings) |

**TypeScript is `@ts-nocheck` on QuoteCartPage only** — do not remove it, the file is too complex to type-check cleanly.

---

## 3. Repository Layout

```
stocky/
├── src/
│   ├── pages/
│   │   ├── Home.tsx                  # Dashboard, role-gated sections
│   │   ├── QuoteCartPage.tsx         # Quote builder (new + edit)
│   │   ├── QuotesHistoryPage.tsx     # Quote list + filters + row actions
│   │   ├── ProductsPage.tsx          # Product catalogue
│   │   ├── ClientsPage.tsx           # CRM
│   │   ├── TechnicalSheetsPage.tsx   # PDF tech-sheet library
│   │   ├── CompanySettingsPage.tsx   # Per-company settings + stamp/logo
│   │   ├── CompaniesPage.tsx         # Superadmin: manage companies
│   │   ├── UserManagementPage.tsx    # Superadmin: manage users
│   │   ├── StatisticsPage.tsx
│   │   ├── BackupPage.tsx            # Superadmin: JSON export/restore + VPS cron guide
│   │   └── compta/
│   │       ├── BLDirectoryPage.tsx   # BL list + multi-select → Proforma
│   │       ├── BLDetailPage.tsx      # BL view/edit + stamp toggle + → Proforma
│   │       ├── ProformaDirectoryPage.tsx
│   │       ├── ProformaDetailPage.tsx  # Proforma + item checkboxes → Invoice
│   │       ├── InvoiceDirectoryPage.tsx
│   │       ├── InvoiceDetailPage.tsx   # Invoice view/edit + payment details + stamp
│   │       └── ClientFinancialPage.tsx # Aggregate by client: total/paid/remaining
│   ├── utils/
│   │   ├── supabaseClient.ts         # Re-exports from integrations/supabase/client.ts
│   │   ├── supabaseCompanyFilter.ts  # Module singleton: companyId, bypassFilter
│   │   ├── supabaseDocuments.ts      # All BL/Proforma/Invoice CRUD + pipeline logic
│   │   ├── supabaseQuotes.ts         # Quote CRUD (filters out BL/proforma/invoice)
│   │   ├── supabaseUsers.ts          # app_users CRUD via safe RPCs
│   │   ├── supabaseCompanies.ts      # companies table CRUD
│   │   ├── supabaseClients.ts        # clients table CRUD
│   │   ├── companySettings.ts        # company_settings CRUD + CompanySettings type
│   │   ├── pdfExport.ts              # jsPDF export — quote/bl/proforma/invoice
│   │   ├── backupService.ts          # JSON export/restore of all 13 tables
│   │   ├── activityLogger.ts         # Write-only activity log
│   │   └── whatsappShare.ts          # WhatsApp URL builder
│   ├── hooks/
│   │   ├── useAuth.ts                # Role, permissions, company context
│   │   └── useUserAuth.ts            # PIN-based user session
│   ├── types/index.ts                # All shared interfaces (source of truth)
│   ├── context/
│   │   ├── AppContext.tsx
│   │   └── ToastContext.tsx
│   ├── components/
│   │   ├── Header.tsx                # Nav dropdowns (Catalogue/Commercial/Comptabilité/Admin)
│   │   ├── ErrorBoundary.tsx         # Auto-reload on chunk-load errors
│   │   └── Layout.tsx
│   └── index.css                     # Tailwind + dark-mode date input fix
├── supabase/patch.sql                # Idempotent schema — run this on any fresh DB
├── .env                              # VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY
└── AGENT_HANDOUT.md                  # This file
```

---

## 4. Environment

```env
VITE_SUPABASE_URL=https://<your-supabase-host>
VITE_SUPABASE_PUBLISHABLE_KEY=<anon key>
```

The app is migrating from Supabase Cloud (`hraxkydlctyoflcilgnz.supabase.co`) to a
self-hosted Supabase instance on a VPS. **Update `.env` and redeploy after migration.**
If Hostinger pulls from GitHub, set env vars in the Hostinger panel — `.env` is gitignored.

---

## 5. Database Schema (public schema)

All tables live in `supabase/patch.sql` which is **idempotent** (safe to re-run).

### Key tables

| Table | Purpose |
|---|---|
| `quotes` | All documents — quotes, BLs, proformas, invoices. Distinguished by `document_type` |
| `companies` | Sub-companies (multi-tenant). Each user belongs to one |
| `company_settings` | Per-company PDF style, logo, stamp, TVA, payment terms |
| `app_users` | Custom auth — PIN-based, not Supabase Auth |
| `clients` | CRM — upserted from customer info on quote save |
| `products` | Product catalogue (synced from Excel) |
| `document_counters` | Per-company atomic sequential numbering (BL/PRO/FAC) |
| `technical_sheets` | PDF tech-sheet metadata |
| `technical_sheet_products` | Sheet ↔ product barcode links |
| `product_name_overrides` | Per-company display name overrides for products |
| `quote_templates` | PDF template files |
| `sheet_share_links` | Expiring public share tokens |
| `activity_logs` | Append-only audit log |

### `quotes` table — document pipeline fields

```sql
document_type        text    -- 'quote' | 'bl' | 'proforma' | 'invoice'
parent_document_id   uuid    -- invoice → proforma, bl → quote
source_bl_ids        uuid[]  -- proforma → list of source BLs
paid_amount          numeric -- sum of invoices generated from this proforma
issuing_company_id   uuid    -- company that issued an invoice
company_id           uuid    -- company the document belongs to
payment_date         date
payment_method       text
payment_reference    text    -- cheque no., wire ref, etc.
payment_bank         text
status               text    -- 'draft' | 'pending' | 'final' | 'solde'
```

Items are stored as **JSONB** in the `items` column. Each item has:
- `quoteName`, `quoteBrand`, `quoteBarcode` — display overrides (may be empty; fall back to `product.name/.brand/.barcode`)
- `is_billed` — true once an invoice has been generated for this item (on proforma)
- `billed_by_company_id` — which company invoiced this item

### Sequential numbering RPC

```sql
-- Returns next integer for (company, type). Thread-safe upsert.
SELECT next_document_number('company-uuid', 'bl');   -- → 1, 2, 3 ...
-- Frontend formats: BL-0001, PRO-0042, FAC-0007
```

### Safe RPCs (no PIN exposure)

`get_app_users_safe()`, `get_app_user_by_id_safe(uuid)`,
`get_app_user_by_username_safe(text)` — SECURITY DEFINER, return user rows
**without the `pin` column**.

---

## 6. Authentication & Roles

Authentication is **custom PIN-based**, not Supabase Auth.

### Two-layer auth
1. **User gate** (`useUserAuth`) — any `app_users` record with matching PIN gets in
2. **Role permissions** (`useAuth`) — determines what they can see/do

### Roles (not stored as a string — derived from boolean columns)

| Column | Role name | Access |
|---|---|---|
| `is_superadmin = true` | SuperAdmin | Everything. Cross-company. `/companies`, `/admin/users`, `/admin/backup` |
| `is_admin = true` | Admin | Company-scoped admin. Settings, statistics |
| `is_compta = true` | Compta | Cross-company accounting. BL/Proforma/Invoice pipeline |
| `can_create_quote = true` | Sales | Quote builder + history |
| (none of above) | Viewer | Browse products only |

`is_compta` is **mutually exclusive** with `is_admin`/`is_superadmin` by convention (UI enforces it).

### Company filter singleton

`src/utils/supabaseCompanyFilter.ts` — module-level singleton set on login.

```typescript
getCompanyContext().bypassFilter  // true for superAdmin or compta
```

All service queries that are company-scoped check `bypassFilter`. If false, they
add `.eq('company_id', companyId)`. Always check this pattern before adding new queries.

---

## 7. Document Pipeline

```
Quote ──→ BL (Bon de Livraison) ──→ Proforma ──→ Invoice(s)
```

- **Quote → BL**: `SupabaseDocumentsService.createBLFromQuote(quoteId)` — copies the quote, sets original status = `'final'`, gets next `BL-XXXX` number
- **BL → Proforma**: `createProformaFromBLs(blIds[], companyId)` — merges items (same barcode = summed qty), auto-note lists source BLs, sets BLs status = `'final'`
- **Proforma → Invoice**: `createInvoiceFromProforma(proformaId, itemIds[], issuingCompanyId)` — creates invoice for selected items, marks them `is_billed=true` on proforma, recalculates `paid_amount`, auto-sets proforma `status='solde'` when all items billed

All implemented in `src/utils/supabaseDocuments.ts`.

The "→ BL" shortcut also exists inside `QuoteCartPage` (visible to compta/superadmin).

---

## 8. PDF Export

`src/utils/pdfExport.ts` — single function `PdfExportService.exportQuoteToPdf()`

```typescript
exportQuoteToPdf(
  quote: Quote,
  settings?: CompanySettings | null,
  techSheetsUrl?: string,
  techSheetsExpiryLabel?: string,
  useStamp?: boolean,
  documentType: 'quote' | 'bl' | 'proforma' | 'invoice' = 'quote'
)
```

Key behaviours by `documentType`:
- `'bl'` — header reads "BON DE LIVRAISON", prices (PU HT / Total HT) hidden
- `'proforma'` — header reads "PROFORMA", full price columns
- `'invoice'` — header reads "FACTURE", payment details block + "Arrêté" block with amount in French words (`numberToWordsFr`)
- All non-quote types skip the validity date

**Always use `CompanySettingsService.getSettings(companyId)` to get settings for export** — never build a settings object manually from Company fields (it's missing stamp_url, stamp_size, use_stamp).

---

## 9. Multi-Company Architecture

- `companies` table holds all sub-companies
- Each `company_settings` row is scoped to a company (has `company_id` FK)
- `company_settings` stores: logo, stamp image, PDF accent colour, font, TVA rate, payment terms, AI model config
- SuperAdmin and Compta see all companies' data; regular users see only their own
- The `document_counters` table is per `(company_id, document_type)` — BL-0001 resets per company

---

## 10. Navigation (Header.tsx)

Four dropdown groups:
- **Catalogue** — Search, Products, Tech Sheets, Clients
- **Commercial** — Quotes history, New Quote (gated by `canCreateQuote`)
- **Comptabilité** — BLs, Proformas, Invoices, Clients financier (gated by `isCompta || isSuperAdmin`)
- **Administration** — Statistics, Settings, Companies, Users, Backup (gated by `isSuperAdmin`)

---

## 11. Backup System

**In-app** (`/admin/backup`, superadmin only):
- Export: fetches all 13 tables paginated → downloads timestamped JSON
- Restore: upload JSON → upsert in FK-safe order → per-table result report
- Does NOT include Supabase Storage files (logos, stamps)

**VPS cron** (shown on backup page):
- `pg_dump --schema=public` daily at 3 AM, keeps 30 days
- Full SQL dump including everything
- Restore: `pg_restore --clean`

---

## 12. Deployment

Push to `main` → Hostinger auto-pulls and redeploys.
Build command: `npm run build` (Vite → `dist/`)

**After deploy, old chunk URLs 404** — handled by `ErrorBoundary.tsx` which
auto-reloads once on chunk-load errors (sessionStorage guard prevents loops).

Performance indexes to apply on any fresh DB (not yet in patch.sql):
```sql
CREATE INDEX IF NOT EXISTS idx_quotes_document_type  ON public.quotes(document_type);
CREATE INDEX IF NOT EXISTS idx_quotes_company_id     ON public.quotes(company_id);
CREATE INDEX IF NOT EXISTS idx_quotes_created_at     ON public.quotes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_dtype_company  ON public.quotes(document_type, company_id);
CREATE INDEX IF NOT EXISTS idx_quotes_dtype_status   ON public.quotes(document_type, status);
```

---

## 13. Patterns & Conventions

### Service classes
All Supabase calls go through static service classes in `src/utils/`. Never call
`supabase.from(...)` directly from a page component.

### Edit mode pattern (all detail pages)
```
view state → startEdit() copies to draft* states → edit fields bind to draft* →
handleSave() calls SupabaseDocumentsService.updateDocument() → reload()
```
`startEdit()` **must** normalise item display fields:
```typescript
quoteName: i.quoteName || i.product?.name || '',
quoteBrand: i.quoteBrand || i.product?.brand || '',
quoteBarcode: i.quoteBarcode || i.product?.barcode || '',
```
Items from the catalogue store names in `product.name`; only manually typed names
use `quoteName`. Always apply the fallback or edit inputs appear empty.

### Page width standard
All pages use `max-w-7xl mx-auto`. Do not use `max-w-4xl` for any full page.

### Date inputs
All `<input type="date">` must render inside a relative wrapper with a `Calendar`
icon on the left (`pl-6` on input). Dark mode handled globally in `index.css`
with `color-scheme: dark` and `filter: invert(1)` on the picker icon.

### Toast notifications
```typescript
const { showToast } = useToast();
showToast({ type: 'success' | 'error' | 'warning', title: '...', message: '...' });
```

### Company settings for PDF
```typescript
// Always fetch fresh — never build settings object manually from Company fields
const settings = await CompanySettingsService.getSettings(companyId);
await PdfExportService.exportQuoteToPdf(doc, settings, undefined, undefined, useStamp, 'invoice');
```

---

## 14. Known Quirks

- `QuoteCartPage.tsx` has `// @ts-nocheck` at line 1 — leave it
- `quotes.quote_number` had a global UNIQUE constraint that was dropped (per-company sequential numbering requires it to be non-unique globally). Do not re-add it
- Some older quotes have `company_id = null`. `createBLFromQuote` falls back to `getCompanyContext().companyId` for these
- `supabase.rpc(...)` is cast as `(supabase.rpc as any)(...)` throughout — the generated types don't include custom RPCs
- `useAuth` and `useUserAuth` are two separate hooks. `useUserAuth` handles the PIN login session; `useAuth` derives role/permissions from the logged-in user record. Don't conflate them
- Activity logs use a SECURITY DEFINER RPC (`insert_activity_log`) to bypass RLS from the client
