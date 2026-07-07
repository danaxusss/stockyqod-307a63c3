# Module PAIE — Plan d'approfondissement (benchmark Maroc)

Objectif : passer d'une paie « superficielle » (CRUD employés + bulletin manuel)
à une **solution de paie marocaine complète**, au niveau de Sage Paie Maroc /
Silae / OpenPaye / PayFit, avec intégration profonde à la Comptabilité, aux
Tâches (présence) et aux utilisateurs.

---

## 0. État actuel (ce qui existe)

| Élément | État |
|---|---|
| Employés | CRUD basique : identité, CIN, situation familiale, contrat (CDI/CDD/Intérim), CNSS/CIMR n°, RIB, date d'embauche, salaire de base, actif |
| Bulletins | Création **un par un** (employé × mois) ; items gains/retenues en texte libre |
| Calcul (`payrollCalc.ts`) | CNSS 4.48 % (plafond 6 000), AMO 2.26 %, CIMR optionnel, frais pro 35/25 % (plafond 35 000/an), barème IR LF2025, charges de famille 500/pers (max 6), ancienneté, cotisations patronales CNSS/AMO/AF |
| PDF | Bulletin PDF par société (logo, ICE/RC/IF/CNSS/Patente) |
| Compta | `buildPayslipEntry` existe (À comptabiliser) — écriture de paie générable |

### Ce qui manque (vs concurrents marocains)
Rubriques configurables · éléments variables (heures supp., absences, congés) ·
gestion des congés & soldes · avances/prêts · saisie-arrêt · génération en lot ·
cumuls annuels & régularisation IR · **déclarations** (CNSS/DAMANCOM, IR 9421,
CIMR) · **ordre de virement** bancaire · **livre de paie** & état des charges ·
solde de tout compte (STC) · attestations & documents · **taxe de formation
professionnelle (1,6 %)** · portail employé (self-service) · analytique par
département.

---

## 1. Benchmark — fonctions standard des logiciels de paie au Maroc

Références : Sage Paie Maroc, Silae, OpenPaye, Cegid, PayFit, solutions locales
(Dial, Winpaie, HR Path). Fonctions communes attendues :

1. **Bibliothèque de rubriques** paramétrables (gain/retenue) avec bases,
   formules, et flags *soumis CNSS / soumis IR / soumis CIMR / soumis AMO /
   inclus ancienneté / plafonné*.
2. **Éléments variables mensuels** : heures supplémentaires (majorations Code du
   travail 25/50/100 %), absences, retards, primes ponctuelles, avantages en
   nature, indemnités (transport, panier, représentation…).
3. **Gestion des congés** : acquisition 1,5 j/mois (+ ancienneté), soldes,
   demandes/validation, report, congés payés sur STC.
4. **Avances & prêts** au personnel : échéancier, retenue mensuelle automatique.
5. **Saisie-arrêt / saisie sur salaire** : quotité saisissable.
6. **Génération en lot** : produire tous les bulletins d'un mois en un clic +
   recalcul.
7. **Cumuls** (brut, net, IR, CNSS, plafonds) mensuels et annuels → base de la
   **régularisation IR** annuelle.
8. **Déclarations légales** :
   - **CNSS / DAMANCOM** : bordereau de déclaration des salaires (BDS), plafonds,
     fichier de télédéclaration.
   - **IR** : état 9421 (traitements et salaires) annuel, retenue à la source.
   - **CIMR** : bordereau de cotisations.
   - **Taxe de formation professionnelle** (1,6 % patronal).
9. **Ordre de virement** : état des virements par banque (RIB), fichier de
   virement (format bancaire / CFONB-like).
10. **Livre de paie** mensuel (récap tous salariés) + **état des charges
    sociales** (part salariale/patronale).
11. **Solde de tout compte (STC)** : indemnité de licenciement (barème 96/144/
    192/240 h par année selon ancienneté), préavis, congés non pris.
12. **Documents RH** : bulletin PDF, attestation de salaire, attestation/
    certificat de travail, ordre de virement, contrats.
13. **Portail employé** : consultation des bulletins et soldes de congés.

---

## 2. Cible & conformité marocaine (paramètres statutaires)

À centraliser dans une table `payroll_settings` (par société, versionnée par
année) — **taux confirmés avec l'expert-comptable** avant mise en production :

- **CNSS** : salarié prestations sociales 4,48 % plafonné 6 000 MAD ; AMO
  2,26 % déplafonné.
- **CNSS patronal** : prestations sociales 8,98 % (plafond 6 000), allocations
  familiales 6,40 % (déplafonné), AMO 4,11 %, **taxe de formation pro 1,60 %**.
- **IR** : barème mensuel/annuel LF2025 (déjà en place) ; déductions frais pro
  35 %/25 % (plafond 35 000/an), charges de famille 500/pers/an (max 6).
- **CIMR** : taux paramétrable, déductible (dans la limite légale).
- **Ancienneté** : 5 % (2 ans), 10 % (5), 15 % (12), 20 % (20), 25 % (25).
- **Congés** : 1,5 j ouvrable/mois (18 j/an), +1,5 j par tranche de 5 ans
  d'ancienneté (plafond légal).
- **Heures supp.** (art. 196) : 25 % (jour ouvrable 6h–21h), 50 % (nuit 21h–6h) ;
  50 % (jour) / 100 % (nuit) les jours de repos/fériés.
- **SMIG/SMAG** : contrôle plancher (≈ 17,10 MAD/h ; à confirmer).
- **Indemnité de licenciement** : 96 h/an (1–5 ans), 144 h (6–10), 192 h (11–15),
  240 h (> 15).

---

## 3. Modèle de données (nouvelles migrations)

Toutes `company_id`-scopées, RLS permissive (comme `paie_tables.sql`), triggers
`updated_at`.

```
payroll_settings            -- paramètres statutaires versionnés
  id, company_id, year, cnss_rate_emp, cnss_cap, amo_rate_emp, cnss_rate_er,
  af_rate, amo_rate_er, tfp_rate, smig_hourly, ir_brackets jsonb,
  frais_pro..., family_ded_per_dep, conges_days_per_month, ...

payroll_rubriques           -- bibliothèque de rubriques
  id, company_id, code, label, type ('gain'|'retenue'),
  base ('fixe'|'pourcentage_base'|'formule'|'heures'), rate, formula,
  soumis_cnss bool, soumis_amo bool, soumis_ir bool, soumis_cimr bool,
  inclus_anciennete bool, plafonne bool, compte_comptable, active, sort_order

employee_contracts          -- contrats & période d'essai
  id, company_id, employee_id, type ('CDI'|'CDD'|'ANAPEC'|'Stage'|'Interim'),
  start_date, end_date, trial_end_date, weekly_hours, job_title, document_url

leave_types                 -- types de congés (payé, maladie, sans solde…)
leave_balances              -- solde par employé/type/année (acquis, pris, restant)
leave_requests              -- demandes : dates, jours, statut, validé_par

payslip_variables           -- éléments variables du mois (par bulletin)
  id, payslip_id, rubrique_id, label, quantity, rate, amount, base

employee_loans              -- avances & prêts
  id, company_id, employee_id, amount, monthly_installment, start_month,
  remaining, active
payroll_garnishments        -- saisies-arrêt (quotité saisissable)

payroll_cumuls              -- cumuls mensuels/annuels par employé
  id, company_id, employee_id, year, month, gross, taxable, ir, cnss_emp,
  amo_emp, cimr, net   (pour régularisation IR + états annuels)

payroll_runs                -- « journée de paie » (lot mensuel)
  id, company_id, period_month, period_year, status ('draft'|'validated'|'paid'),
  total_gross, total_net, journal_entry_id, created_by
  → un payslip.run_id lie chaque bulletin au lot

payroll_declarations        -- CNSS/IR/CIMR générées (période, montants, fichier)
```

Extensions `employees` : `matricule`, `affiliation_cnss`, `mode_paiement`
('virement'|'chèque'|'espèces'), `rib`, `situation` détaillée, `date_sortie`,
`motif_sortie`, `user_id` (lien portail).

---

## 4. Fonctionnalités par phase

### Phase 1 — Rubriques + éléments variables (cœur du calcul)
- Bibliothèque **rubriques configurables** (gains/retenues) avec flags
  CNSS/IR/CIMR/ancienneté + rubriques par défaut marocaines pré-remplies
  (transport, panier, ancienneté, heures supp., absence, avance…).
- Réécrire `payrollCalc` pour consommer les rubriques + `payroll_settings`
  (au lieu des taux en dur) et gérer l'ordre bases → cotisations → IR.
- Bulletin : saisie des **éléments variables** (heures supp. avec majorations,
  absences, primes) au lieu d'items texte libre.
- `payroll_settings` par société/année (taux éditables) + **taxe formation pro**.

### Phase 2 — Génération en lot + cumuls + journal de paie
- **Payroll run** mensuel : sélection employés → génération de tous les bulletins
  → recalcul → validation. Statuts draft/validé/payé.
- **Cumuls** mensuels/annuels alimentés à la validation.
- **Livre de paie** (récap mensuel tous salariés) + **état des charges sociales**.
- **Intégration Compta** : à la validation du run, générer **une écriture de paie
  consolidée** (via le moteur `À comptabiliser` déjà en place) — D 6171/6174,
  C 4432/4441/4443/4452 — avec ventilation analytique par département (option).

### Phase 3 — Congés, avances & prêts, absences
- **Gestion des congés** : acquisition auto (1,5 j/mois + ancienneté), soldes,
  demandes/validation, décompte sur bulletin, congés non pris → STC.
- **Avances & prêts** : échéancier, retenue mensuelle automatique sur bulletin.
- **Absences/retards** : saisie, impact prorata du brut.
- **Intégration Tâches** : import des `task_checkins` (présence terrain) →
  proposer les absences/présences des techniciens/livreurs.

### Phase 4 — Déclarations & virements
- **CNSS / DAMANCOM** : bordereau BDS mensuel + export (format télédéclaration).
- **IR** : retenue à la source mensuelle + **état 9421** annuel (régularisation
  via cumuls).
- **CIMR** : bordereau de cotisations.
- **Ordre de virement** : état par banque + fichier de virement (RIB employés).
- Exports PDF + Excel de tous les états.

### Phase 5 — RH & self-service
- **Solde de tout compte** (STC) : indemnité de licenciement (barème horaire),
  préavis, congés non pris, reçu STC PDF.
- **Documents** : attestation de salaire, attestation/certificat de travail,
  contrats (upload + génération).
- **Portail employé** : lien `employees.user_id` ↔ `app_users` ; un salarié
  consulte ses bulletins et son solde de congés (rôle restreint).
- **13ᵉ mois / primes annuelles**, avantages en nature.

---

## 5. Intégrations transverses (la « profondeur » demandée)

- **Comptabilité** : run de paie → écriture consolidée + ventilation par compte
  de charge/analytique ; règlement (virement) → écriture de décaissement.
- **Tâches** : `task_checkins` → présence/absences des employés terrain.
- **Utilisateurs** : `employees.user_id` → portail employé (bulletins, congés).
- **Multi-société** : tout `company_id`-scopé (déjà le socle).
- **PDF** : réutiliser `buildPayslipPdf` ; ajouter STC / attestations / OV.

---

## 6. Conformité & risques
- Les taux (CNSS, AMO, TFP, IR, SMIG, plafonds) doivent être **validés par
  l'expert-comptable** et versionnés par année (`payroll_settings`).
- DAMANCOM / SIMPL : on génère les **bordereaux et fichiers** ; la
  télétransmission reste sur les portails officiels (pas d'EDI direct en v1).
- Intangibilité : un bulletin d'un run **validé** devient non modifiable
  (recalcul = nouveau run / régularisation).

---

## 7. Déploiement
Comme pour Stock/Compta : le frontend part au merge (Hostinger) ; **migrations +
éventuelles edge functions manuelles** (SQL editor / CLI), livrées phase par
phase avec le SQL exact à exécuter.

---

## Build status (branch claude/busy-hawking-qecj8k)

- ✅ **Phase 1** — `payroll_settings` (taux versionnés), `payroll_rubriques`
  (bibliothèque + défauts marocains), moteur de calcul piloté par les paramètres
  + **taxe formation pro (1,6 %)**, **Simulateur** (brut↔net, coût employeur),
  page Paramètres, page Rubriques.
- ✅ **Phase 2** — **Journée de paie** (génération en lot), livre de paie,
  cumuls, **écriture de paie consolidée** vers la Compta.
- ✅ **Phase 3** — congés (demandes + soldes) & avances/prêts (retenue auto +
  remboursement à la validation du lot).
- ✅ **Phase 4** — déclarations CNSS/BDS, IR, CIMR + ordre de virement (CSV).
  ◻︎ *Remaining:* fichier DAMANCOM/virement au format bancaire natif ; 9421 annuel.
- ◑ **Phase 5** — ✅ STC (solde de tout compte) + ✅ attestations (travail/
  salaire/certificat, imprimables). ◻︎ *Remaining:* portail employé
  (employees.user_id ↔ app_users) ; wiring du bulletin détaillé sur les
  rubriques/variables ; 13ᵉ mois.

**⚠ Migrations à exécuter** (SQL editor) :
- `20260707120000_payroll_deep.sql` (fait ✓)
- `20260707130000_leave_loans.sql` (congés + avances/prêts)

## 8. Décisions à confirmer (avant Phase 1)
1. **Périmètre prioritaire** — recommander **Phase 1 + 2** d'abord (rubriques +
   run + cumuls + intégration compta), car c'est le socle qui rend la paie
   « réelle » et exploitable comptablement. OK ?
2. **Congés** — acquisition légale simple (1,5 j/mois) suffisante en v1, ou règles
   internes personnalisées (types multiples, RTT) dès le départ ?
3. **DAMANCOM** — quel format de fichier CNSS cible (saisie manuelle sur le
   portail vs fichier d'import) ? À préciser avec le client.
4. **Portail employé** — souhaité (lien employé↔utilisateur) ou hors périmètre
   pour l'instant ?
5. **Taux statutaires** — qui fournit/valide la grille (TFP 1,6 %, SMIG, barème) ?
