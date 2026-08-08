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
  P4 **uploads sécurisés** (validation type/taille/magic-bytes/anti-traversal, stockage BLOB).

## 🔜 Reste à faire — trajectoire « niveau Base44 » (ordre proposé)

Chaque phase liste sa **contrainte sécurité** (le différenciateur vs Base44, qui génère au LLM sans garantie).

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

### P5 — Champs riches
- Dates (picker), enums (select), booléens (toggle), texte long — avec **validation par type côté serveur**.

### P6 — Temps réel (WebSocket)  *(reste de la base — S7)*
- Mises à jour live des listes.
- **Sécurité** : **authentification du handshake WebSocket** (même JWT cookie), autorisation par rôle sur les canaux, rate-limit des messages — travail sécurité dédié, d'où le placement tardif.

### P7 — Export CSV/PDF + finitions
- Export des listes.
- **Sécurité** : **échappement anti-injection de formule** CSV (préfixer `= + - @`), pagination avancée, tri multi-colonnes.

## Rôle de l'IA (LLM) dans le système — pourquoi et où

**L'IA sert à COMPRENDRE, pas à écrire le code sensible.** C'est le choix architectural central, et la raison de la sécurité par construction.

| Étape | IA ? | Rôle |
|---|---|---|
| **Spec Normalizer** | ✅ LLM (codestral) | **Cœur** : lit une spec en langage naturel / PDF / DOCX (prose, tables, ambiguë) et en extrait un **modèle structuré** (ressources, champs, types, routes, règles, acteurs, permissions, deferred). Irremplaçable : un parseur déterministe ne comprend pas du texte humain libre. |
| **Architect** | ✅ LLM + **repli déterministe** | Dérive l'architecture (endpoints, data model). Quand la spec est déjà bien structurée, le **chemin déterministe** prend le relais. |
| **Amélioration** | ✅ LLM | Interprète un prompt libre (« ajoute une ressource avis avec note ») → intention structurée. |
| **Documentation / QA / Code Review** | ✅ LLM | README, revue, contrôle qualité. |
| **Backend (code)** | ❌ Déterministe | Le `server.js`, `schema.sql`, l'auth, le RBAC, les incréments = **générateurs déterministes vérifiés**. |
| **Sécurité (SAST/SCA/Secrets/DAST)** | ❌ Déterministe + outils | Scanners déterministes + Semgrep + OSV. |
| **Compacteur, linter, différentiel** | ❌ Déterministe | 100 % code. |

**En une phrase (pour le mémoire)** : *Forge IA place le LLM en « front de compréhension » du besoin humain — là où il est irremplaçable — et confie la génération du code et la sécurité à des générateurs déterministes vérifiés. C'est l'inverse de Base44 (LLM pour tout), et c'est ce qui rend les apps reproductibles, auditables et sûres par construction.*
