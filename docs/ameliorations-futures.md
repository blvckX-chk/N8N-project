# Améliorations futures — vers des apps générées plus modernes

_Principe invariant conservé : chaque capacité = **générateur déterministe** qui **passe les 4 axes de sécurité**. « Plus moderne » ne veut jamais dire « moins sûr » ni « écrit par le LLM »._

Feuille de route proposée pour la suite, après l'axe 3 (déploiement clef-en-main, livré). Regroupée par thème, avec priorité (⭐ = quick win à fort impact) et la garantie sécurité associée.

---

## Thème A — UI moderne

- ⭐ **Édition en ligne + actions groupées** : éditer une ligne sans quitter la liste ; cases à cocher pour supprimer/exporter en lot (endpoints déjà scopés user_id → aucune surface nouvelle).
- ⭐ **Filtres par colonne + plage de dates** sur les listes et le tableau de bord (whitelist de colonnes déjà en place → anti-injection préservé).
- **PWA installable** : `manifest.json` + service worker minimal (cache des assets statiques uniquement, jamais de donnée métier → pas de fuite hors ligne). L'app devient installable sur mobile/desktop.
- **Composants plus riches** : en-têtes de tableau collants, états vides illustrés, squelettes de chargement, vue détail imprimable soignée, jeu d'icônes SVG inline par ressource (0 dépendance CDN → CSP stricte préservée).
- **Graphiques temporels** : courbes d'évolution (créations par jour/semaine) en SVG inline, en plus des donuts/barres actuels.

## Thème B — Richesse fonctionnelle

- ⭐ **Champs calculés / dérivés** déterministes : `total = quantite * prix_unitaire`, `age = ...` — calculés côté serveur, non modifiables par l'utilisateur (donc non falsifiables).
- **Workflows de statut (machine à états)** : transitions autorisées déclarées (ex. `nouveau → en_cours → resolu`, jamais `resolu → nouveau`) ; validation serveur des transitions.
- **Relations affichées en ligne** : dans la vue détail d'un enregistrement, lister ses enregistrements liés (ex. les commandes d'un client) — requêtes scopées propriétaire.
- **Suppression douce + corbeille** : `deleted_at` au lieu d'un DELETE dur ; corbeille avec restauration (admin), purge planifiée.
- **Pièces jointes par enregistrement** : lier les uploads (déjà sécurisés) à une ressource précise, pas seulement au panneau global.
- **Export Excel (.xlsx)** en plus du CSV (générateur déterministe, échappement de formule déjà en place).

## Thème C — Qualité API & expérience développeur

- ⭐ **Spéc OpenAPI 3 + page `/docs`** générée déterministement depuis le modèle : documentation interactive de l'API livrée dans le ZIP (aucune dépendance runtime — HTML statique + JSON).
- **Logs structurés (JSON) + identifiant de requête** : chaque requête tracée avec un `request_id`, format exploitable par un agrégateur.
- **En-têtes de cache / ETags** sur les GET de liste et de détail (moins de bande passante, réponses conditionnelles).
- **Concurrence optimiste** : contrôle `updated_at` sur les PUT (évite d'écraser silencieusement la modification d'un autre utilisateur → 409 Conflict).
- **Arrêt gracieux + endpoints `/health` & `/ready`** distincts (déjà `/health` ; ajouter la fermeture propre de la base au SIGTERM).

## Thème D — Sécurité Tier 3 (le différenciateur, suite)

- ⭐ **Double-submit CSRF token** : en défense-en-profondeur du `SameSite=strict` déjà présent (jeton non-HttpOnly comparé à un en-tête `X-CSRF-Token` sur les mutations).
- **Gestion des sessions** : lister ses sessions actives et en révoquer une précise (au-delà du « logout révoque tout » actuel via `token_version`).
- **2FA / TOTP** optionnel (RFC 6238, 0 dépendance : HMAC-SHA1 natif) + codes de secours.
- **Force du mot de passe + vérification hors-ligne** : jauge de robustesse ; refus des mots de passe trop faibles (liste embarquée, aucune requête externe).
- **En-têtes de sécurité — bulletin** : page/section récapitulant les en-têtes actifs (CSP, HSTS, nosniff…) et leur statut, pour l'audit.

---

## Ordre recommandé (prochaines passes)

1. **Thème A quick wins** (édition en ligne + filtres + PWA) — impact utilisateur immédiat, risque faible.
2. **Thème B** (champs calculés + workflows de statut + relations en ligne) — rend les apps « métier » complètes.
3. **Thème C** (OpenAPI + `/docs`, ETags, logs) — crédibilité « app pro » et bon pour le mémoire.
4. **Thème D — Sécurité Tier 3** (CSRF token, gestion de sessions, 2FA) — prolonge l'attestation OWASP/ASVS.

_À arbitrer ensemble : on peut piocher transversalement (ex. « un lot moderne » = édition en ligne + filtres + OpenAPI + CSRF token)._
