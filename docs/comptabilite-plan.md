# Module Comptabilité (Comptabilité Générale) — Plan de développement

Sage-inspired double-entry general ledger, aligned with the Moroccan
**CGNC / Plan Comptable Marocain (PCM)** and DGI obligations. Lives at
`/comptabilite` (today a "Coming Soon" stub). Distinct from the existing
`/compta/*` routes, which are actually **Facturation** (billing documents).

---

## 0. What already exists (reuse, don't rebuild)

| Asset | Where | Reuse for accounting |
|---|---|---|
| Invoices / avoirs / BLs | `quotes` table, `document_type` JSONB rows | Source for **auto journal entries** (ventes, avoirs) |
| Payments | `quotes.payment_*`, `payment_methods_json`, `paid_amount` | Source for **journal banque/caisse** + lettrage |
| Clients | `clients` table (has `ice`) | Comptes auxiliaires clients (3421) |
| Payslips | `payslips` / `payslip_items` (PAIE) | Auto journal de paie (644/443/444…) |
| Company fiscal identity | `company_settings` (`ice`, `rc`, `if_number`, `patente`, `cnss`, `tva_rate`) | Header of états de synthèse + TVA + IS |
| Multi-tenant | `company_id` everywhere + `getCompanyContext()` | Every accounting table scoped by `company_id` |
| Role gate | `isCompta` / `canAccessCompta` in `src/lib/permissions.ts` | Flip on to grant access |
| Coming-soon pillars | `ComptabiliteComingSoon.tsx` | Confirms the intended feature set |

**Key architectural choice:** accounting is a **posting layer on top of
existing operational data**, not a parallel data entry system. Invoices,
payments and payslips *generate* draft écritures; the accountant reviews,
adjusts and validates. Manual écritures (OD) remain fully available.

---

## 1. Scope & Moroccan compliance target

**Régime:** Comptabilité d'engagement (accrual), **régime normal** — the
Sage-equivalent. Cash accounting is a later toggle, not v1.

Must-have Moroccan specifics (what makes it "aligned with Moroccan needs",
not just a generic Sage clone):

1. **Plan Comptable Marocain (PCM / CGNC)** — 8 classes, 5-digit accounts:
   - Classe 1 Financement permanent · 2 Actif immobilisé · 3 Actif circulant
     (hors trésorerie) · 4 Passif circulant (hors trésorerie) · 5 Trésorerie
   - Classe 6 Charges · 7 Produits (→ CPC)
   - Classe 8 Résultats · (9 analytique / 0 spéciaux — optional later)
2. **États de synthèse (modèle normal)**: Bilan (Actif/Passif), CPC (Compte
   de Produits et Charges), ESG (État des Soldes de Gestion), Tableau de
   Financement, ETIC. v1 targets **Bilan + CPC**; ESG/TF/ETIC later.
3. **TVA marocaine**: taux 20 / 14 / 10 / 7 / 0 / exonéré; régime
   **débit vs encaissement**; déclaration mensuelle/trimestrielle; TVA due /
   crédit de TVA reportable; comptes 3455 (TVA récupérable), 4455 (TVA
   facturée), 3456/4456. Génération d'un **relevé de déductions**.
4. **Journaux obligatoires**: Ventes, Achats, Banque, Caisse, OD, À-nouveaux,
   Paie. Journal centralisateur + Grand livre + Balance (générale & auxiliaire).
5. **Numérotation & intangibilité**: écritures validées non modifiables
   (contre-passation only), séquence continue par journal/exercice, clôture
   d'exercice verrouillée. (Loi comptable 9-88.)
6. **Amortissements** immobilisations (linéaire; dégressif optionnel) + tableau
   d'amortissement (classe 28 / dotation 619).
7. **Liasse fiscale / IS**: cotisation minimale, acomptes provisionnels,
   résultat fiscal (réintégrations/déductions) — **later phase**, but schema
   leaves room.
8. **Exports**: Grand livre / Balance / Journaux en PDF + Excel; format
   d'échange compatible import expert-comptable (CSV/Sage-like). SIMPL/EDI
   télédéclaration is out of v1 scope (manual re-keying on DGI portal).

---

## 2. Data model (new migrations)

All tables: `company_id UUID NOT NULL`, RLS enabled, `company_id`-scoped
policies (mirror `paie_tables.sql` pattern), `updated_at` trigger, indexes.

```
accounting_fiscal_years
  id, company_id, label (e.g. "2026"), start_date, end_date,
  status ('open'|'closed'), closed_at, closed_by

accounts                         -- Plan comptable (per company, seeded from PCM)
  id, company_id, code (varchar 8), label, class (1..8),
  type ('bilan_actif'|'bilan_passif'|'charge'|'produit'|'tresorerie'),
  parent_code, is_auxiliary bool, aux_kind ('client'|'fournisseur'|null),
  vat_rate numeric null, lettrable bool, active bool, is_system bool
  UNIQUE(company_id, code)

journals                         -- VT, AC, BQ, CS, OD, AN, PAIE
  id, company_id, code, label, type, counterpart_account_code null

journal_entries                  -- écriture (balanced header)
  id, company_id, fiscal_year_id, journal_id, entry_number (seq/journal/year),
  entry_date, reference, label, status ('draft'|'posted'|'reversed'),
  source_type ('manual'|'invoice'|'payment'|'payslip'|'reversal'|'depreciation'),
  source_id (fk to quotes/payslip/etc.), posted_at, posted_by, reversed_by
  CHECK sum(debit)=sum(credit) enforced at post-time (app + RPC)

journal_entry_lines
  id, entry_id, company_id, account_code, aux_account_id null,
  label, debit numeric, credit numeric, vat_rate null,
  lettrage_code text null, lettered_at null,
  analytic_code null   -- room for comptabilité analytique later

bank_accounts
  id, company_id, label, account_code (512.x), bank_name, rib, currency

bank_statements / bank_statement_lines   -- rapprochement bancaire
  statement: id, company_id, bank_account_id, period, opening/closing balance
  line: id, statement_id, date, label, amount, matched_entry_line_id null,
        reconciled bool

fixed_assets  (immobilisations)
  id, company_id, label, account_code (2x), acquisition_date, amount,
  method ('lineaire'|'degressif'), duration_years, rate, salvage,
  depreciation_account_code (28x), expense_account_code (619x)
fixed_asset_depreciations  -- generated schedule rows per fiscal year

vat_declarations
  id, company_id, fiscal_year_id, period_type ('M'|'T'), period,
  regime ('debit'|'encaissement'), tva_facturee, tva_recuperable_biens,
  tva_recuperable_charges, tva_due, credit_report, status, filed_at
```

**Numbering & integrity:** `entry_number` allocated by a `SECURITY DEFINER`
RPC `post_journal_entry(entry_id)` that (a) checks the FY is open, (b) checks
debit=credit, (c) assigns the next sequence for that journal+FY, (d) flips
status to `posted`. Posted entries are immutable (RLS `UPDATE` policy blocks
posted rows except the `reversed_*` columns via the reversal RPC).

---

## 3. Chart of accounts (PCM seed)

Ship a **`accounting_pcm_seed.ts`** with the standard Moroccan PCGE accounts
(the ~200 most-used, not all 700+). On first entry to `/comptabilite` for a
company, offer **"Initialiser le plan comptable marocain"** → bulk-insert
system accounts. Accountant can add/rename non-system accounts and create
auxiliaries (clients 3421xxxx, fournisseurs 4411xxxx) — auto-created from the
`clients` table on demand.

Core accounts the auto-posting engine relies on (defaults, editable in a
**"Comptes par défaut"** settings screen):

| Usage | Compte |
|---|---|
| Clients | 3421 |
| Ventes de marchandises | 7111 / 7112 |
| Prestations de services | 7124 |
| TVA facturée (20%) | 4455 |
| TVA récupérable / charges | 34552 |
| Banque | 5141 · Caisse 5161 · Chèques à encaisser 5111 |
| Fournisseurs | 4411 |
| Achats revendus | 6111 · Achats consommés 6121 |
| Rémunérations dues | 4432 · CNSS 4441 · IR retenue 4452 |
| Charges de personnel | 6171 (salaires) · 6174 (CNSS patronale) |

---

## 4. Auto-posting engine (the integration that makes it Stocky-native)

`src/comptabilite/lib/postingRules.ts` — pure functions that turn an
operational document into a balanced écriture proposal:

- **Facture de vente** (`document_type='invoice'`): 
  D 3421 (TTC) / C 7111 (HT) / C 4455 (TVA). Multi-rate → one TVA line per rate.
- **Avoir**: mirrored (contre-passation).
- **Encaissement** (payment on invoice): D 5141/5161/5111 / C 3421;
  auto-**lettrage** of the client line against the invoice line.
- **Achat / dépense** (if a purchases capture is added): D 611x + D 3455 / C 4411.
- **Décaissement fournisseur**: D 4411 / C 5141.
- **Paie** (from `payslips`): D 6171 / C 4432, 4441, 4452; then payment
  D 4432 / C 5141. One consolidated OD per period.

Flow: a **"Journal des ventes → à comptabiliser"** inbox lists un-posted
invoices; accountant clicks **"Générer les écritures"** → draft entries;
review → **Valider (poster)**. Nothing posts silently. A `source_id` link
prevents double-posting and lets you drill from écriture back to the invoice.

---

## 5. Pages (Sage-inspired UX, Stocky design system)

Route tree under `/comptabilite`, gated by `canAccessCompta`. New folder
`src/pages/comptabilite/` + `src/comptabilite/{lib,components,hooks}`.

1. **Tableau de bord** `/comptabilite` — KPIs (résultat, trésorerie nette,
   TVA due, créances/dettes), mini P&L, top comptes, alertes (FY à clôturer,
   TVA à déclarer, écritures déséquilibrées). Replaces the coming-soon page.
2. **Plan comptable** `/comptabilite/plan` — tree of accounts, search, edit,
   init PCM, comptes par défaut.
3. **Saisie / Journaux** `/comptabilite/journaux` — journal picker + fast
   grid entry (Sage "saisie par journal"): date, pièce, compte (autocomplete
   on code/label), libellé, débit, crédit, running balance, **auto-balance
   helper**, TVA auto-line. Draft → post.
4. **À comptabiliser** `/comptabilite/a-comptabiliser` — the auto-posting
   inbox (ventes, paie, encaissements) from §4.
5. **Grand livre** `/comptabilite/grand-livre` — par compte / auxiliaire,
   filtres période, solde progressif, drill to écriture.
6. **Balance** `/comptabilite/balance` — générale & auxiliaire, N vs N-1,
   filtrable par classe, export.
7. **Lettrage** `/comptabilite/lettrage` — clients/fournisseurs, match
   débits/crédits, auto-lettrage par montant/référence.
8. **Rapprochement bancaire** `/comptabilite/banque` — import relevé (CSV),
   pointage automatique + manuel, état de rapprochement.
9. **TVA** `/comptabilite/tva` — assistant de déclaration (débit/encaissement),
   relevé de déductions, TVA due / crédit reporté, génération écriture de TVA.
10. **Immobilisations** `/comptabilite/immobilisations` — fiche immo, calcul
    & génération des dotations.
11. **États de synthèse** `/comptabilite/etats` — Bilan + CPC (modèle normal),
    export PDF/Excel; ESG/TF/ETIC later.
12. **Clôture** `/comptabilite/cloture` — contrôles pré-clôture (balance
    équilibrée, journaux validés), écritures de clôture/à-nouveaux, verrou FY.

Shared: `AccountPicker`, `AmountInput` (MAD, 2 dec), `JournalEntryGrid`,
`PeriodFilter`, `BalanceIndicator`. All using existing shadcn/Tailwind tokens.

---

## Build status (branch claude/busy-hawking-qecj8k)

- ✅ **Phase 1 — Foundation** (done). Migration `20260706120000_accounting_core.sql`
  (fiscal years, accounts, journals, écritures + lignes, `post_journal_entry` +
  `reverse_journal_entry` RPCs). PCM seed (~70 CGNC accounts) + default journaux.
  Pages: Tableau de bord (+ init PCM), Plan comptable, Saisie/Journaux, Grand
  livre, Balance (+CSV). Access = super_admin/admin/compta; nav dropdown.
  Régime: engagement/normal. Defaults per the open decisions below.
- ✅ **Phase 2 — auto-posting** (done). `postingRules.ts` (factures/avoirs/
  encaissements/paie → écritures) + "À comptabiliser" inbox (draft-by-default,
  optional auto-validate, double-post guard). No new migration.
  ◻︎ *Remaining:* lettrage clients/fournisseurs.
- ✅ **Phase 2b — lettrage** (done). Clients/fournisseurs matching with auto
  letter codes + délettrage.
- ◑ **Phase 3** — ✅ TVA declaration (compute + écriture + persist, migration
  `vat_declarations`). ◻︎ *Remaining:* rapprochement bancaire.
- ◑ **Phase 4** — ✅ États de synthèse (Bilan + CPC, modèle simplifié) + ✅
  clôture d'exercice + à-nouveaux. ◻︎ *Remaining:* immobilisations/amortissements,
  ESG/TF/ETIC, résultat fiscal/IS.

**⚠ Manual step:** run these migrations in the Supabase SQL editor before using
`/comptabilite`:
- `supabase/migrations/20260706120000_accounting_core.sql`
- `supabase/migrations/20260706130000_vat_declarations.sql`

## 6. Phasing / milestones

**Phase 1 — Foundation (ledger core).** Migrations (FY, accounts, journals,
entries, lines) + RLS + posting RPC; PCM seed + init; Plan comptable page;
manual Saisie/Journaux; Grand livre; Balance. Flip `canAccessCompta` on +
Header nav. → *A real double-entry ledger you can keep books in.*

**Phase 2 — Stocky integration.** Auto-posting engine (ventes, avoirs,
encaissements) + "À comptabiliser" inbox; lettrage clients; paie → OD.
→ *Books fill themselves from Facturation + PAIE.*

**Phase 3 — TVA & banque.** TVA declaration assistant + relevé de déductions
+ écriture de TVA; rapprochement bancaire (CSV import + pointage).

**Phase 4 — États & clôture.** Bilan + CPC (modèle normal), exports;
immobilisations + dotations; clôture d'exercice + à-nouveaux.

**Phase 5 (later).** ESG/TF/ETIC, comptabilité analytique, résultat fiscal/IS
+ cotisation minimale, régime encaissement, format export expert-comptable.

---

## 7. Cross-cutting

- **Multi-tenant:** every table `company_id`; every query via
  `getCompanyContext()`; RLS `company_id`-scoped like `paie_tables.sql`.
- **Permissions:** enable `canAccessCompta` for `super_admin`, `admin`,
  `compta`. Add a `/comptabilite` guard (mirror the PAIE access-gate pattern,
  hooks-before-return to avoid the React #310 bug hit earlier).
- **Integrity:** posted écritures immutable; reversal-only corrections;
  sequence continuity; FY lock. Enforced in RPC + RLS, not just UI.
- **Exports:** reuse jsPDF/autotable (`pdfExport.ts` patterns) + the Excel
  vendor chunk already bundled.
- **Deployment reality:** frontend ships on merge (Hostinger); **migrations +
  RPCs are manual** (SQL editor / Supabase CLI) — each phase ships with the
  exact SQL to run, as done for PAIE and Tasks.

---

## 8. Open decisions (confirm before Phase 1)

1. **Target user** — a real accountant keeping full books (full PCM, états de
   synthèse, intangibilité) **[assumed]**, or a business owner wanting a
   simplified financial view? Changes how much manual saisie UI to build.
2. **Régime comptable** — engagement/normal **[assumed]** vs option
   trésorerie/simplifié.
3. **TVA régime** — débit or encaissement default (encaissement is common for
   services in MA)?
4. **Purchases/expenses capture** — do we add a supplier-invoice/expense entry
   screen in Phase 2 (needed for real Achats journal + TVA récupérable), or
   keep achats manual (OD) for now?
5. **Expert-comptable hand-off** — is the goal in-house full accounting, or
   feeding a external accountant (then Balance/GL export format matters more
   than états de synthèse)?
