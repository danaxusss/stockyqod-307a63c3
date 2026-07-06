# Module Gestion de Stock (Inventory Management) — Plan de développement

Turn Stocky's **static stock snapshot** into a real, movement-driven inventory
system (Sage/Odoo-inspired), aligned with Moroccan operations (BL as the
stock-out trigger, valorisation CMUP, bons de réception fournisseur).

---

## 0. What exists today (the gap)

| Asset | Where | State |
|---|---|---|
| Stock levels | `products.stock_levels` JSONB `{ location: qty }` | **Static snapshot**, hand-edited via Excel import / product detail |
| Buy price | `products.buyprice`, `reseller_price` | Single current value, no history |
| Locations | `stock_locations` + `sub_stock_locations` (company-scoped) | Managed in Settings → StockLocationsTab |
| Suppliers | `providers` (company-scoped) | Name/abbrev only |
| Per-user location scope | `app_users.allowed_stock_locations TEXT[]` | Controls what a seller sees |
| Documents | `quotes` rows (`document_type` incl. `bl`) | **Do NOT touch stock** on validation |

**The gap:** no movement ledger, no auto stock-out on sale/BL, no receipts,
no transfers, no physical counts, no valuation, no reorder alerts, no
traceability of *why* a quantity changed.

**Core architectural choice:** introduce a **stock movements ledger** as the
source of truth. `products.stock_levels` becomes a **denormalized cache**
recomputed from movements (kept for the existing fast search/filter paths so
nothing else breaks). Every quantity change is an auditable movement.

---

## 1. Scope & Moroccan alignment

1. **BL = déclencheur de sortie de stock.** In Morocco goods physically leave
   on the **Bon de Livraison**, not the invoice. Stock-out posts on BL
   validation; invoice-only flows are a fallback setting.
2. **Bon de réception fournisseur = entrée de stock**, ideally from a **bon de
   commande fournisseur** (purchase order). Ties into the accounting Achats
   journal later.
3. **Valorisation CMUP** (Coût Moyen Unitaire Pondéré / weighted average) — the
   common Moroccan method; FIFO as an optional later mode. Feeds stock value +
   COGS (link to Comptabilité class 6111/6114 & 31xx).
4. **Multi-emplacements / multi-dépôts** with transfers (bon de transfert) —
   reuses existing `stock_locations` + `sub_stock_locations`.
5. **Inventaire physique** (physical count) with écart posting + PV
   d'inventaire — a legal expectation at year-end.
6. **Traçabilité**: every movement stamped with user, date, source document,
   reason. Adjustments require a motif.
7. Multi-tenant: movements keyed by company-scoped `location_id`; products stay
   global by barcode but stock is per-company via location.

Out of v1 (optional later): lot/série/péremption tracking, code-barres douchette
natif, valorisation FIFO, réservations avancées.

---

## 2. Data model (new migrations)

All tables `company_id`-scoped, RLS enabled (mirror existing patterns),
`updated_at` trigger, indexes.

```
warehouses (optional grouping above locations — or reuse stock_locations as-is)
  -- v1 can skip; stock_locations already exists. Add depot_id later if needed.

stock_movements                     -- THE LEDGER (source of truth)
  id, company_id, barcode (fk products), location_id (fk stock_locations),
  sub_location_id null,
  type ('in'|'out'|'transfer_in'|'transfer_out'|'adjustment'|'count'|'return'),
  quantity numeric,                 -- always positive; sign implied by type
  unit_cost numeric null,           -- for valuation (entrées)
  reason text null,                 -- required for adjustment/count
  source_type ('bl'|'invoice'|'receipt'|'transfer'|'count'|'manual'|'return'),
  source_id text null,              -- link to quotes.id / receipt id / etc.
  transfer_group_id uuid null,      -- pairs transfer_out with transfer_in
  created_by, created_at
  INDEX (company_id, barcode, location_id), (source_type, source_id)

stock_snapshots  (optional cache table) OR keep products.stock_levels
  -- Decision: keep products.stock_levels JSONB as the cache, updated by the
  -- apply-movement RPC. No new table; least disruption to search.

purchase_orders                     -- bon de commande fournisseur
  id, company_id, po_number, provider_id, status
  ('draft'|'sent'|'partial'|'received'|'cancelled'),
  order_date, expected_date, total_ht, notes, created_by
purchase_order_items
  id, po_id, barcode, label, qty_ordered, qty_received, unit_cost

stock_receipts                      -- bon de réception (entrée)
  id, company_id, receipt_number, po_id null, provider_id, location_id,
  receipt_date, status ('draft'|'validated'), created_by
stock_receipt_items
  id, receipt_id, barcode, qty, unit_cost   -- validation → 'in' movements

stock_transfers                     -- bon de transfert entre emplacements
  id, company_id, transfer_number, from_location_id, to_location_id,
  transfer_date, status ('draft'|'in_transit'|'received'|'cancelled'), created_by
stock_transfer_items
  id, transfer_id, barcode, qty      -- validation → transfer_out + transfer_in

stock_counts                        -- inventaire physique (session)
  id, company_id, count_number, location_id, count_date,
  status ('open'|'counting'|'validated'), created_by
stock_count_items
  id, count_id, barcode, expected_qty, counted_qty, variance
  -- validation → 'count' adjustment movements for each variance

product_stock_settings              -- reorder rules per product/location
  id, company_id, barcode, location_id null,
  reorder_point numeric, reorder_qty numeric, min_qty, max_qty
```

**Applying movements — one RPC.** `apply_stock_movement(...)` (SECURITY
DEFINER): inserts the movement row, updates `products.stock_levels[location]`
atomically, and (for `in`) recomputes CMUP → updates `products.buyprice`.
Everything that changes stock (BL, receipt, transfer, count, manual adjust)
goes through it, so the cache can never drift from the ledger.

---

## 3. Integration with existing documents (auto stock-out)

`src/inventory/lib/stockPosting.ts`:

- **BL validé** (`document_type='bl'`, status→final): for each item →
  `apply_stock_movement(out, source='bl', source_id=quote.id)` from the
  document's location. Guarded by `source_id` to prevent double-posting;
  un-validating / avoir reverses it.
- **Facture directe** (invoice without BL): optional setting
  `stock_out_on_invoice` → same as BL.
- **Avoir / retour**: `return` movement (stock back in).
- **Réception validée** → `in` movements + CMUP recompute.
- **Insufficient stock guard**: on BL validation, warn (block or allow-negative
  is a setting) if a line would drive stock below zero.

This is the payoff: **selling through Facturation now moves real stock**,
instead of the snapshot going stale.

---

## 4. Pages (new section `/inventaire`, Stocky design system)

New folder `src/pages/inventaire/` + `src/inventory/{lib,components,hooks}`.
Nav: new Header dropdown "Stock" (gated for `super_admin`/`admin`/`manager`;
field sellers see read-only stock scoped to `allowed_stock_locations`).

1. **Tableau de bord stock** `/inventaire` — KPIs: valeur du stock (CMUP),
   articles en rupture, sous le seuil, mouvements du jour, top rotations,
   réceptions/transferts en attente. Alertes de réapprovisionnement.
2. **Niveaux de stock** `/inventaire/niveaux` — matrix article × emplacement,
   search/brand/location filters (reuse existing search), quick adjust (opens
   an adjustment with motif), drill to movement history per article.
3. **Mouvements** `/inventaire/mouvements` — the ledger, filterable by type /
   article / emplacement / période / document; export PDF/Excel.
4. **Réceptions** `/inventaire/receptions` — create from PO or blank; scan/enter
   qty + unit cost; validate → entrées + CMUP.
5. **Bons de commande fournisseur** `/inventaire/commandes` — PO lifecycle,
   suggested reorder (from reorder points), receive against PO.
6. **Transferts** `/inventaire/transferts` — move stock between locations,
   in-transit state, receive at destination.
7. **Inventaire physique** `/inventaire/inventaires` — count session per
   location, expected vs counted, variance, validate → count adjustments + PV.
8. **Réapprovisionnement / Alertes** `/inventaire/alertes` — items ≤ reorder
   point, one-click PO draft; reuse the **VAPID push** infra for low-stock
   notifications to managers.
9. **Valorisation & rapports** `/inventaire/rapports` — valeur du stock à date,
   rotation, articles dormants, marge (prix - CMUP), export.

Shared components: `LocationPicker`, `QtyStepper`, `MovementBadge`,
`StockLevelCell`, `ProductScanInput` (barcode). All shadcn/Tailwind tokens.

---

## Build status (branch claude/busy-hawking-qecj8k)

- ✅ **Phase 1** — ledger (`stock_movements`) + `apply_stock_movement` RPC + CMUP
  + backfill; Tableau de bord / Niveaux / Mouvements pages; nav + gating.
- ✅ **Phase 2** — auto stock-out on BL (`Décompter le stock`, idempotent) +
  Réception (goods-in + CMUP).
- ✅ **Phase 3** — Transfert entre emplacements; Inventaire physique (écarts);
  reorder-point editing + dashboard alerts + **low-stock push** notifications
  (reuses send-push; alerts managers when an item hits its seuil).
- ✅ **Phase 4** — Valorisation & rotation reports (CMUP value, margin, dormant,
  sold/period, CSV export) + **purchase-order lifecycle** (BC → réception,
  CMUP-aware, draft→partial→received).
- ◻︎ **Phase 5** — lot/série/péremption, FIFO, native scanning, COGS↔Comptabilité.

**⚠ Manual step:** run BOTH migrations in the Supabase SQL editor — nothing
works until the tables + RPC exist:
- `supabase/migrations/20260705120000_inventory_stock_movements.sql`
- `supabase/migrations/20260705130000_purchase_orders.sql`

## 5. Phasing / milestones

**Phase 1 — Ledger foundation.** `stock_movements` + `apply_stock_movement`
RPC + backfill (seed one `count`/adjustment movement per existing
`stock_levels` entry so history starts consistent). Niveaux de stock page +
manual adjustments (with motif) + per-article movement history. Nav entry.
→ *Every quantity change is now audited; snapshot derived from the ledger.*

**Phase 2 — Auto stock-out + receipts.** BL/invoice → `out` movements
(§3); `stock_receipts` → `in` + CMUP valuation. Insufficient-stock guard.
→ *Selling and receiving move real stock; buyprice reflects CMUP.*

**Phase 3 — Transfers, counts, reorder.** `stock_transfers`,
`stock_counts` (inventaire physique with variance), `product_stock_settings`
+ low-stock alerts (push) + réapprovisionnement suggestions.

**Phase 4 — Purchasing + reports + valuation.** `purchase_orders` lifecycle
(reorder → PO → receipt), valorisation & rotation reports, exports.

**Phase 5 (later).** Lot/série/péremption, FIFO valuation option, native
barcode scanning UX, tie COGS/stock value into the Comptabilité module
(6111/6114 ↔ 31xx), advanced reservations.

---

## 6. Cross-cutting

- **Snapshot integrity:** only `apply_stock_movement` writes `stock_levels`;
  a periodic (or on-demand) `recompute_stock_from_ledger(barcode)` reconciles.
- **Multi-tenant & scope:** movements company-scoped by `location_id`; sellers
  read-only and filtered by `allowed_stock_locations` (already in app_users).
- **Permissions:** managers/admins write; add a `canManageStock` helper in
  `src/lib/permissions.ts` (super_admin, admin, manager). Field staff read-only.
- **Reuse:** existing `stock_locations`/`providers`/`sub_stock_locations`,
  search/filter in `useSearchState.ts` + `database.ts`, Excel import path,
  push infra (`send-push`), jsPDF/Excel exporters.
- **Products stay global (PK barcode):** do NOT add `company_id` to products;
  tenancy flows through location. Confirm this holds for negative-stock and
  valuation (CMUP is per-product-global today — decide if CMUP should be
  per-company; see decisions).
- **Deployment:** frontend ships on merge (Hostinger); **migrations + RPC are
  manual** (SQL editor / CLI) — each phase ships with the exact SQL, as with
  PAIE/Tasks.

---

## 7. Open decisions (confirm before Phase 1)

1. **Stock-out trigger** — on **BL validation** (recommended, matches MA
   practice) vs on invoice vs a per-company setting?
2. **Negative stock** — block a BL that would go negative, or allow with a
   warning (common for businesses that invoice ahead of receipt)?
3. **Valorisation** — **CMUP** (recommended) vs FIFO; and is cost tracked
   **per-product-global** (as `buyprice` is today) or **per-company**? Since
   products are global, per-company valuation would need a new cost table.
4. **Purchase orders scope** — full PO→réception lifecycle in v1, or start with
   direct **réceptions** only and add POs in Phase 4?
5. **Lot / série / péremption** — needed for this business (kitchen equipment
   suggests no), or safe to defer to Phase 5?
6. **Backfill** — seed current `stock_levels` as opening balances via one
   adjustment movement each (recommended) so the ledger and reports are
   consistent from day one — confirm OK.
