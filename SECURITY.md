# Sécurité — état des lieux et procédures

Ce document décrit ce qui est protégé, ce qui ne l'est pas encore, et les
étapes de déploiement. Il est volontairement franc : un point non couvert est
listé comme tel plutôt que passé sous silence.

---

## 1. Limitation de débit (rate limiting) — EN PLACE

Chaque fonction Edge applique désormais des quotas. Les compteurs vivent dans
Postgres (table `rate_limits` + fonction `check_rate_limit`), car les fonctions
Edge sont sans état et réparties sur plusieurs instances : un compteur en
mémoire serait remis à zéro en permanence et contournable trivialement.

L'incrément et le verdict se font en **une seule instruction atomique**
(`INSERT … ON CONFLICT DO UPDATE … RETURNING`), donc aucune requête ne peut
passer entre les mailles en cas d'appels simultanés.

| Fonction | Quotas (par IP sauf mention) |
|---|---|
| `verify-pin` (`verify`) | 30 / 15 min · 300 / jour · **8 / 15 min par nom d'utilisateur** |
| `verify-pin` (`verify-pin-only`) | 10 / 15 min · 60 / jour |
| `verify-pin` (`hash`) | 20 / heure (PBKDF2 = coûteux en CPU) |
| `ai-product-suggest` (assistant) | 15 / min · 150 / h · 1000 / jour |
| `ai-extract-table` (convertisseur) | 12 / min · 120 / h · 600 / jour |
| `parse-bank-statement` | 12 / min · 120 / h · 600 / jour |
| `admin-users` | 60 / min · 600 / h · **10 échecs d'autorisation / 15 min** |
| `send-push` | 30 / min · 300 / h · max 500 destinataires par appel |
| `task-reminders` | 12 / min + secret partagé requis |

**Choix de conception :**

- Les limites échouent **ouvert** (`fail open`) si la base est injoignable : une
  panne du limiteur ne doit pas mettre l'application à l'arrêt.
  **Exception :** `verify-pin` et les échecs d'autorisation de `admin-users`
  échouent **fermé** — pour la vérification d'identifiants, mieux vaut bloquer
  que d'autoriser des tentatives illimitées.
- Sur `admin-users`, seules les autorisations **échouées** consomment le budget
  serré : un administrateur légitime très actif n'est jamais bloqué, alors
  qu'une attaque par devinette d'UUID est coupée en 10 essais.
- La table des compteurs est en RLS **sans aucune policy** et les droits sont
  révoqués pour `anon`/`authenticated` : seule la `service_role` (utilisée par
  les fonctions Edge) y accède. Un client ne peut ni lire, ni gonfler, ni
  remettre à zéro les compteurs.

**Vérifié par des tests réels** (Postgres 16) : application exacte du quota,
isolation entre IP et entre compartiments, réinitialisation de fenêtre,
purge, refus effectif du rôle `anon`, et **60 appels concurrents depuis 12
clients parallèles → compteur exact, aucune perte de mise à jour**.

### Ce que le rate limiting corrige concrètement

Avant ce changement, `verify-pin` n'avait **aucune** protection contre la force
brute, et l'action `verify-pin-only` compare le code saisi à **tous** les
utilisateurs : il suffisait donc de deviner *n'importe quel* PIN. Un PIN à
6 chiffres pouvait être épuisé automatiquement en quelques heures. Avec
10 essais / 15 min, la même attaque demanderait des années.

---

## 2. Clés et secrets — CORRECT

- Aucune clé API n'est présente dans le dépôt (vérifié sur l'ensemble des
  fichiers suivis : aucun JWT, aucune clé `sk-…`).
- `.env` et `wa-runner/config.json` (qui contient la **clé de service**) sont
  bien exclus par `.gitignore`.
- Les clés IA (`OPENROUTER_API_KEY`) restent côté serveur, dans les secrets des
  fonctions Edge : elles ne sont jamais exposées au navigateur.
- Les codes PIN sont hachés en PBKDF2 (100 000 itérations) et la colonne `pin`
  n'est **pas** lisible publiquement : l'accès passe par la fonction
  `get_app_users_safe()` qui ne renvoie jamais ce champ.

> ⚠️ La clé de service dans `wa-runner/config.json` contourne toute sécurité
> base de données. Elle ne doit rester que sur le PC du runner, ne jamais être
> envoyée par message, et être régénérée si elle a pu fuiter.

---

## 3. ⚠️ Limite connue : les politiques RLS sont permissives

**C'est le point de sécurité le plus important de ce document, et il n'est pas
corrigé par cette modification — volontairement.**

L'application authentifie par PIN (logique applicative), et non via Supabase
Auth. Il n'existe donc aucune session base de données : sur 103 politiques RLS,
**aucune** ne référence `auth.uid()`, et 76 sont en `USING (true)`.

Conséquence concrète : la clé publique `anon` (présente par nature dans le code
JavaScript livré au navigateur) donne un accès **lecture et écriture** à la
plupart des tables — clients, employés, bulletins de paie, relevés bancaires,
contacts WhatsApp — pour qui sait s'en servir.

**Pourquoi ce n'est pas corrigé ici :** réécrire ces politiques exige de migrer
l'authentification vers Supabase Auth (vraies sessions JWT). C'est un chantier
structurant : fait à l'aveugle, il rendrait l'application inutilisable
instantanément. Ce n'est pas une décision à prendre dans un correctif de rate
limiting.

**Options, de la plus rapide à la plus solide :**

1. **Restreindre l'accès réseau** (rapide) — si l'application n'est utilisée
   que depuis les locaux, restreindre l'accès au projet Supabase par IP.
2. **Passerelle par fonctions Edge** (intermédiaire) — faire transiter les
   tables sensibles (paie, compta, clients) par des fonctions Edge qui
   vérifient l'identité, puis retirer les droits directs à `anon`.
3. **Migrer vers Supabase Auth** (solution de fond) — chaque utilisateur reçoit
   une vraie session ; les politiques deviennent
   `USING (company_id = auth.jwt() ->> 'company_id')`. C'est la seule option qui
   ferme réellement la porte.

Dites-moi laquelle vous voulez engager et je la prépare séparément.

---

## 4. Déploiement

```bash
# 1. Appliquer la migration (éditeur SQL Supabase ou CLI)
#    supabase/migrations/20260803120000_rate_limiting.sql

# 2. Redéployer toutes les fonctions (elles partagent _shared/security.ts)
supabase functions deploy verify-pin
supabase functions deploy admin-users
supabase functions deploy ai-product-suggest
supabase functions deploy parse-bank-statement
supabase functions deploy ai-extract-table
supabase functions deploy send-push
supabase functions deploy task-reminders
```

### Secrets recommandés

```bash
# Protège task-reminders (appelée uniquement par le planificateur).
# Tant qu'il n'est pas défini, l'appel reste autorisé mais journalisé
# en avertissement — le planificateur ne casse donc jamais en silence.
supabase secrets set CRON_SECRET="$(openssl rand -hex 32)"

# Verrouille le CORS sur votre domaine (sinon "*" est conservé).
supabase secrets set ALLOWED_ORIGINS="https://votre-domaine.app"
```

Après avoir défini `CRON_SECRET`, ajoutez l'en-tête à la tâche planifiée :

```
x-cron-secret: <valeur du secret>
```

---

## 5. Surveillance

Les blocages sont journalisés dans les logs des fonctions :

- `[rate-limit] blocked <bucket> id=<ip>` — quota dépassé
- `[verify-pin] failed login user=… ip=…` — échec d'authentification
- `[admin-users] unauthorized attempt ip=…` — tentative d'accès admin
- `[security] CRON_SECRET not set` — secret à configurer

Une répétition de `failed login` depuis une même IP indique une attaque en
cours : bloquez l'IP côté Supabase et faites changer les PIN concernés.
