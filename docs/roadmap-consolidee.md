# Roadmap consolidée — Forge IA

_Fusion de la roadmap de base (V1.0 §12.1) et de la trajectoire « niveau Base44 »._
_Principe invariant : chaque capacité = **générateur déterministe** qui **passe les 4 axes de sécurité** (SAST/SCA/DAST/Secrets + OWASP/ASVS). « Plus riche » ne veut jamais dire « moins sûr »._

## ✅ Fait

**Socle applicatif**
- S1 Persistance (SQLite/WAL, requêtes paramétrées) · S2 Authentification (JWT cookie HttpOnly, bcrypt) ·
  S3 Architecture extensible (migrations versionnées + module loader + `/api/_meta`) ·
  S4 Introspection (statique ZIP + runtime) · S5 Mode différentiel (Approche A + section frontend) ·
  S6 Ressources partagées (multi-acteurs) · **RBAC & comptes à rôles** (admin/acteurs, matrice de permissions).

**Sécurité (les 4 axes)**
- S-A : SAST (Semgrep) + SCA réel (OSV) + Secrets (entropie) + SBOM (CycloneDX).
- S-B : durcissement des apps générées (CSP stricte, rate-limit, validation, en-têtes).
- S-C : attestation OWASP Top 10 / ASVS + DAST réel sur le vrai code.
- S-D : sécurité du pipeline (OWASP LLM Top 10 : anti-injection, neutralisation).

**Robustesse & UX**
- Specs longues (Sanitize 2 Mo + **compacteur déterministe** > 38 Ko) · personnalisation visuelle par app ·
  identification admin (badge doré + panneau Comptes) · **backlog de ressources** (prévu-non-implémenté + ajout libre) ·
  amélioration d'une app **déployée** (sans re-upload du ZIP) · sortie du **diff** d'amélioration ·
  P1 CRUD complet + listes pro · P2 dashboard + agrégats + relations FK · P3 navigation multi-pages + toasts + états ·
  P4 **uploads sécurisés** (validation type/taille/magic-bytes/anti-traversal, stockage BLOB) ·
  P5 **champs riches** (dates/enums/booléens/texte long, validation typée) ·
  P6 **temps réel** (SSE, signaux d'invalidation only) · P7 **export CSV** (anti-injection de formule) + PDF imprimable + tri multi-colonnes ·
  **enrichissement du Spec Normalizer** (extraction déterministe des enums depuis la prose → V1.10, Architect V5.5) ·
  **versionnage complet** : les 13 agents émettent `_version` → tableau des versions dans SECURITY.md (fini les `n/a`) ·
  **design system** des apps générées (tokens tonaux, thème clair/sombre, table triable, modale détail, dashboard donut + métriques) ·
  **mode amélioration intelligent** : propositions déterministes (structurelles + compagnes par domaine), aperçu du diff avant application, historique des versions V1→Vn ·
  **Tier 1 sécurité** : **journal d'audit** (événements sensibles tracés en base + panneau admin) · **suite de tests de sécurité auto-générée** (node --test + supertest : 401/403/400, anti-IDOR, whitelist de tri, audit) — exécutée et **9/9 verte** · correctif **moindre privilège** (l'auto-inscription ne donne plus jamais `admin`, détecté par le test généré) ·
  **précision des générations (Backend V6.16 + Frontend V6.16)** : (1) **migrations de champ** — schéma auto-cicatrisant (`PRAGMA table_info` + `ALTER TABLE ADD COLUMN`) : une app re-générée avec de nouveaux champs migre sa base existante sans perte de données ; (2) **relations N-N** — un champ nommé `<autre>_ids` produit une table de jointure `<ressource>_<autre>` (clé composite, scopée `user_id`) + endpoints attacher/détacher/lister, requêtes paramétrées ; **UI de liaison** (Frontend V6.17) : les champs `_ids` sont exclus du formulaire et une multi-sélection (cases à cocher) apparaît dans la modale détail, branchée sur les endpoints `POST`/`DELETE /<from>/:id/<autre>` par délégation d'évènements (aucun handler inline → CSP stricte préservée) ; (3) **types riches honorés** — un type explicite `{ type:'number', min, max, unit, default }` du modèle pilote les bornes (`min`/`max` HTML + `CHECK` SQL + validation serveur), l'unité (affichée dans le libellé, ex. « Prix (€) ») et la valeur par défaut (`DEFAULT` SQL + pré-remplissage du formulaire) ; (4) **détection de domaine élargie** (10 domaines : santé, logistique, éducation, immobilier, hôtellerie/tourisme, agriculture, sport, juridique, événementiel, RH) pour la palette et le logo. ·
  **champs optionnels (Backend + Frontend V6.18)** : tout champ non déclaré dans `required_fields` devient **optionnel** — colonne SQL *nullable*, **validé et inséré côté serveur uniquement s'il est fourni** (INSERT dynamique à liste blanche de colonnes + placeholders `?`), et **rendu dans le formulaire** (marqué « (optionnel) », non bloquant, FK avec choix « — aucun — »). Les champs requis gardent un comportement strictement identique (repli déterministe = tous requis). Vérifié : tests fonctionnels (omis→NULL, fourni→persisté, fourni-invalide→400), suite de sécurité 9/9, SAST 0 critique. ·
  **correctif SAST RAND-001 (Backend V6.17)** : la suite de tests auto-générée n'utilise plus `Math.random` (suffixe unique déterministe) — supprime un faux positif « critique » qui pouvait stopper le pipeline. ·
  **Sécurité Tier 2 (Backend + Frontend V6.19)** : **verrouillage de compte** (5 échecs → 15 min, `locked_until`) ; **révocation de session** côté serveur via `token_version` (vérifié à chaque requête ; le logout incrémente → invalide toutes les sessions) ; **changement de mot de passe** authentifié (`POST /api/change-password`, vérifie l'ancien, révoque les autres sessions, conserve la session courante). Migration auto-cicatrisante des colonnes `users` (apps existantes). **3 tests de sécurité supplémentaires auto-générés** (verrouillage, révocation, changement) → suite **12/12**. Côté CSRF : cookie JWT déjà en `SameSite=strict` (protection de fond) ; le jeton double-submit reste une option de défense-en-profondeur. ·
  **afficher/masquer le mot de passe** (œil) sur l'écran de connexion et le panneau « Mon compte » des apps générées (délégation d'évènements → CSP stricte préservée).

## ✅ Trajectoire « niveau Base44 » — P1 → P7 toutes livrées

Chaque phase liste sa **contrainte sécurité** (le différenciateur vs Base44, qui génère au LLM sans garantie). **Les sept phases sont désormais livrées et vérifiées** (générateurs testés, `node --check`, schéma SQLite, SAST 0 critique).

### P1 — CRUD complet + listes « pro »  ✅ LIVRÉ (Backend V6.8 + Frontend V6.5)
- Backend : `PUT /res/:id` (édition) ; `GET /res?q=&sort=&order=&page=&limit=` (recherche/tri/filtre/pagination).
- Frontend : bouton Éditer + formulaire pré-rempli, barre de recherche, en-têtes triables, pagination.
- **Sécurité** : update scopé user/rôle + validé ; **requêtes paramétrées** ; `sort` sur **liste blanche** de colonnes (anti-injection) ; `limit` **plafonné** (anti-DoS).
- *Transforme toutes les apps « démo » en apps « utilisables » d'un coup.*

### P2 — Dashboard + Agrégation + relations  ✅ LIVRÉ (Backend V6.10 + Frontend V6.7)
- Page d'accueil : compteurs (`COUNT`/`SUM`), **graphiques SVG inline** (barres/donut) ; vue détail ; résolution des FK (afficher le libellé, pas l'id).
- **Sécurité** : agrégations **scopées** (user_id/rôle) ; SVG **inline** (pas de lib CDN → CSP stricte préservée) ; sortie encodée (anti-XSS).

### P3 — Navigation multi-pages + design system  ✅ LIVRÉ (Frontend V6.9)
- Sidebar + une page par ressource + **états riches** (vide/recherche-vide/chargement à spinner/erreur avec bouton Réessayer) + **toasts** globaux (succès/erreur, `aria-live`) + responsive.
- **Sécurité** : routage **client** sur la même API (aucune surface nouvelle) ; toasts/états 100 % DOM (aucun handler inline → CSP stricte préservée).

### P4 — Uploads fichiers/images sécurisés  ✅ LIVRÉ (Backend V6.11 + Frontend V6.9)  *(fonctionnalité-vitrine sécurité)*
- Upload JSON base64 (pas de multipart → surface réduite, **0 dépendance ajoutée**) ; validation **extension (liste blanche) + MIME + taille (limite de route 8 Mo + plafond 5 Mo après décodage, anti-DoS) + magic bytes (signature réelle du contenu) + anti-path-traversal (`_safeName` : basename, neutralisation `../`)**.
- Stockage **en BLOB SQLite** (aucun chemin disque → pas de path traversal au repos, hors webroot par construction). Table `uploads` scopée `user_id`.
- Service des fichiers : `Content-Type` **dérivé de la valeur validée stockée** (jamais l'entrée brute), `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cache-Control: private, no-store` ; lecture/suppression **scopées propriétaire** (anti-IDOR).
- UI : panneau **📎 Fichiers** (input filtré, liste avec vignettes images / icône PDF, ouvrir, supprimer).

### P5 — Champs riches  ✅ LIVRÉ (Backend V6.12 + Frontend V6.10)
- Classification sémantique **déterministe** partagée backend/frontend (`classifyField`) : honore un type explicite `{ type, values }` (forward-compat avec un normaliseur plus riche) sinon infère par le nom.
- Widgets : **date** (`type=date`) / **datetime** (`datetime-local`) / **enum** (`select` avec valeurs) / **booléen** (toggle) / **texte long** (`textarea`, `maxlength`). Affichage liste : booléen → badge **Oui/Non**, pré-remplissage d'édition adapté (checkbox).
- **Validation par type côté serveur** (POST + PUT) : booléen coercé en 0/1 (`_toBool`), date/datetime au format vérifié (`_isDate`/`_isDateTime`), enum **sur liste blanche** (rejet hors valeurs), texte long plafonné (5000). Colonnes booléennes en `INTEGER NOT NULL DEFAULT 0`.
- Prudence : la table d'enums par défaut est limitée à des cas quasi-universels (priorité, niveau, genre…) — **on ne devine jamais des valeurs métier fragiles**.

### P6 — Temps réel  ✅ LIVRÉ (Backend V6.13 + Frontend V6.11)  *(réalisé en SSE, pas WebSocket)*
- Mises à jour **live** des listes et du tableau de bord : à chaque mutation (create/update/delete), un signal d'invalidation est poussé aux clients concernés, qui rafraîchissent la vue visible.
- **Choix de conception (sécurité)** : **SSE (Server-Sent Events)** plutôt que WebSocket. Justification secure-by-construction :
  - **0 dépendance** ajoutée (pas de lib `ws` et sa surface CVE) ; fonctionne dans la **CSP stricte** existante (`connect-src 'self'`).
  - **Auth = même cookie JWT** (authMiddleware) — pas de handshake séparé à sécuriser.
  - Le canal **ne transporte jamais de donnée métier**, seulement `{ resource, action }` : l'autorisation reste assurée par la **route REST existante** (scoping user_id/rôle) au moment du re-fetch → **aucun IDOR possible via le flux**.
  - **Anti-DoS** : plafonds de connexions **global (500)** et **par utilisateur (5)**, heartbeat + nettoyage à la déconnexion.

### P7 — Export CSV/PDF + finitions  ✅ LIVRÉ (Backend V6.13 + Frontend V6.11)
- Export **CSV** des listes (scopé propriétaire, respecte recherche + tri) ; **PDF** via vue imprimable (`@media print` + `window.print()` → « Enregistrer en PDF ») — **0 dépendance PDF, 0 surface CVE**.
- Finitions : **tri multi-colonnes** (`sort=a,b`, liste blanche stricte) ; **sélecteur de taille de page** (10/25/50).
- **Sécurité** : **neutralisation de l'injection de formule CSV** (`_csvCell` : préfixe `'` si la cellule commence par `= + - @ TAB CR`) + échappement RFC 4180 ; en-têtes `text/csv`, `nosniff`, `attachment`, `no-store` ; BOM UTF-8 pour Excel ; export **plafonné (10 000 lignes)** anti-DoS.

## Rôle de l'IA (LLM) dans le système — pourquoi et où

**L'IA sert à COMPRENDRE, pas à écrire le code sensible.** C'est le choix architectural central, et la raison de la sécurité par construction.

| Étape | IA ? | Rôle |
|---|---|---|
| **Spec Normalizer** | ✅ LLM (codestral) + **enrichissement déterministe** | **Cœur** : lit une spec en langage naturel / PDF / DOCX (prose, tables, ambiguë) et en extrait un **modèle structuré** (ressources, champs, types, routes, règles, acteurs, permissions, deferred). Irremplaçable : un parseur déterministe ne comprend pas du texte humain libre. **V1.10** : un passage déterministe détecte en plus les **énumérations dans la prose** (« statut : en attente, expédiée, livrée » → `{type:'enum', values:[...]}`), attachées au modèle de données → formulaires plus riches (vraies listes déroulantes) + validation serveur sur liste blanche. Prudence : uniquement sur des noms de champs candidats et 2–12 valeurs, jamais de faux enum sur du texte libre. |
| **Architect** | ✅ LLM + **repli déterministe** | Dérive l'architecture (endpoints, data model). Quand la spec est déjà bien structurée, le **chemin déterministe** prend le relais. |
| **Amélioration** | ✅ LLM | Interprète un prompt libre (« ajoute une ressource avis avec note ») → intention structurée. |
| **Documentation / QA / Code Review** | ✅ LLM | README, revue, contrôle qualité. |
| **Backend (code)** | ❌ Déterministe | Le `server.js`, `schema.sql`, l'auth, le RBAC, les incréments = **générateurs déterministes vérifiés**. |
| **Sécurité (SAST/SCA/Secrets/DAST)** | ❌ Déterministe + outils | Scanners déterministes + Semgrep + OSV. |
| **Compacteur, linter, différentiel** | ❌ Déterministe | 100 % code. |

**En une phrase (pour le mémoire)** : *Forge IA place le LLM en « front de compréhension » du besoin humain — là où il est irremplaçable — et confie la génération du code et la sécurité à des générateurs déterministes vérifiés. C'est l'inverse de Base44 (LLM pour tout), et c'est ce qui rend les apps reproductibles, auditables et sûres par construction.*
