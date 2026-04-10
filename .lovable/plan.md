

## Plan: Client Management, Product Browser, Quote Sharing, and Toast Improvements

This is a large, multi-feature request. Here is the structured plan:

---

### 1. Client Management System

**Database**: Create a `clients` table with columns: `id` (uuid), `full_name`, `phone_number` (unique, used as identifier), `address`, `city`, `ice`, `email`, `created_at`, `updated_at`. RLS policies for public read/insert/update.

**Client list page** (`/clients`): Browse all clients with search, pagination, and sorting. Edit client details inline or via modal. Add new clients manually.

**Quote integration**: In `QuoteCartPage`, when typing a client name or phone, show autocomplete suggestions from the `clients` table. Selecting a client auto-fills all fields. On quote save, upsert the client record (create if new, update if phone exists).

**Navigation**: Add "Clients" link to the header/nav.

---

### 2. Product Browser Page

**New page** (`/products`): Full product catalog with:
- Paginated table/grid of all products
- Search by name, barcode, brand
- Filters: brand, provider, stock location
- Sorting: name, price, stock, brand
- Inline editing of product details (name, price, buy price, reseller price, provider)
- Save edits to the database

**Navigation**: Add "Produits" link to the header/nav.

---

### 3. Send Quote via WhatsApp/Email

On the quote detail and quotes history pages, add "Send" buttons:
- **WhatsApp**: Open `https://wa.me/{phone}?text={encodedMessage}` with a formatted message including quote number, total, and a friendly greeting.
- **Email**: Open `mailto:{email}?subject={subject}&body={encodedBody}` with a similar formatted message.

Both use the client's phone/email from the quote's customer info.

---

### 4. Toast Notification Changes

- **Position**: Move from `top-4 right-4` to `top-4 left-1/2 -translate-x-1/2` (top center)
- **Size**: Reduce padding, font sizes, and max-width. Remove title for shorter toasts. Make them more compact single-line style.
- **Animation**: Change from `slide-in-from-right` to `slide-in-from-top`

---

### 5. Quote Page Optimization

Apply the same compact, efficient layout patterns used in other pages (consistent spacing, glass cards, responsive grids) to the quote creation page.

---

### Technical Details

- **New migration**: `clients` table with unique constraint on `phone_number`
- **New files**: `src/pages/ClientsPage.tsx`, `src/pages/ProductsPage.tsx`
- **Modified files**: `src/App.tsx` (routes), `src/components/Header.tsx` (nav links), `src/pages/QuoteCartPage.tsx` (client autocomplete + share buttons), `src/pages/QuotesHistoryPage.tsx` (share buttons), `src/context/ToastContext.tsx` (position), `src/components/Toast.tsx` (compact size)
- **New utility**: Client service in `src/utils/supabaseClients.ts`

