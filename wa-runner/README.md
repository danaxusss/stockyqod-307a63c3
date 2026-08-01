# Stocky — Runner WhatsApp

Petit programme qui tourne sur **un poste allumé** (PC du bureau, puis VPS
plus tard) et fait le lien entre Stocky et WhatsApp : il affiche le QR de
connexion, envoie les messages de la file d'attente avec des délais humanisés,
respecte le plafond quotidien / les heures calmes / la liste de désinscription,
et remonte les statuts (envoyé / distribué / lu) et les réponses.

> ⚠ WhatsApp interdit l'automatisation non officielle : **n'utilisez jamais le
> numéro principal de l'entreprise**. Prenez une carte SIM dédiée, montez la
> cadence progressivement (warm-up), et n'écrivez qu'à des contacts qui ont
> consenti. Un numéro peut être banni.

> 🔄 **Mise à jour du moteur (v2).** Le runner utilise désormais
> **whatsapp-web.js** (gratuit, maintenu) au lieu d'open-wa, qui était obsolète
> et ne pouvait pas écrire aux numéros non enregistrés. Si tu utilisais déjà
> l'ancienne version, fais **une fois** sur le PC :
>
> 1. Supprime le dossier **`node_modules`** et le dossier **`.sessions`** dans `wa-runner`.
> 2. Relance **`DEMARRER.bat`** (il réinstalle les dépendances, ~2-3 min).
> 3. **Re-scanne le QR** depuis le Centre de connexion (nouvelle session).
>
> Rien à changer dans Stocky ni dans Supabase : la file, les campagnes, les
> délais et les opt-outs sont conservés.

## Installation (Windows, une fois)

1. Installer **Node.js LTS** : https://nodejs.org/ (bouton « LTS »).
2. Copier `config.example.json` → **`config.json`** et le remplir avec les
   valeurs affichées dans **Stocky → WhatsApp → Centre de connexion** :
   - `supabaseUrl`, `serviceKey` (clé *service_role*, Réglages → API de Supabase)
   - `sessionId`, `companyId` (affichés dans le Centre de connexion)
3. Double-cliquer **`DEMARRER.bat`**. La première fois installe les dépendances
   (~2-3 min) et lance Chromium en arrière-plan.
4. Dans Stocky, le **QR code** apparaît dans le Centre de connexion — scannez-le
   depuis WhatsApp du téléphone dédié (Appareils connectés → Lier un appareil).
5. Le statut passe à **Connecté**. Laissez la fenêtre ouverte.

## Fonctionnement

- Un runner = une session = un numéro. Pour plusieurs numéros, copiez le dossier
  et utilisez un `sessionId` différent dans chaque `config.json`.
- La fenêtre fermée = envoi arrêté (les messages restent en attente et repartent
  au prochain démarrage).
- Les délais, le plafond quotidien et les heures calmes se règlent **dans
  Stocky** (Centre de connexion), pas ici.

## Sécurité

- `config.json` contient la clé service_role : **ne la partagez pas**, gardez-la
  sur le poste uniquement (le `.gitignore` l'exclut déjà).
- Le dossier `.sessions/` contient la session WhatsApp liée — le sauvegarder
  évite de re-scanner le QR à chaque redémarrage.
