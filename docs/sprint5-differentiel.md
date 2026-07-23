# Sprint 5 — Mode différentiel d'orchestration

## Objectif
En mode **Améliorer**, ne plus tout régénérer : comparer le `current_state` (introspection Sprint 4)
à la spec cible et ne produire que le **delta**, sous forme d'**incréments additifs** que le
socle extensible (Sprint 3) charge sans modifier l'existant.

## Principe (purement additif = sûr)
```
current_state (ZIP Analyzer)      spec cible (Normalizer + Architect)
        │                                   │
        └───────────────┬───────────────────┘
                        ▼
              Calcul du diff (déterministe)
                        │
      ┌─────────────────┴──────────────────┐
   ressources nouvelles              ressources existantes
      │                                     │
      ▼                                     ▼
  incréments générés :                 PRÉSERVÉES telles quelles
   - migrations/NNN_add_<store>.sql       (server.js, db.js, schema.sql,
   - modules/NNN_<store>.routes.js         frontend/*, modules/migrations existants)
```
- **On ne réécrit jamais** un fichier existant → zéro risque de régression.
- Les incréments respectent le format du **module loader** et des **migrations versionnées** du Sprint 3 :
  chaque `modules/*.routes.js` = factory `(app, db, authMiddleware) => void` ; chaque `migrations/*.sql`
  est appliquée une seule fois. Au redémarrage, l'app charge la nouvelle table + les nouvelles routes.
- Toutes les routes générées sont **scopées `user_id`** (isolation Sprint 2) et validées.

## Cœur déterministe (fait + testé)
`workflows/_sprint5_increment_generator.js` — `computeIncrements(current_state, target)` renvoie :
```json
{
  "mode": "differential | noop",
  "diff": { "added_resources": [...], "unchanged_resources": [...], "files_generated": [...] },
  "increment_files": [ { "path": "migrations/002_add_commentaires.sql", "content": "..." },
                       { "path": "modules/010_commentaires.routes.js",  "content": "..." } ],
  "new_resources": [ ... ]
}
```
**Preuve** : CrimeStopper (signalements/interventions/typologies) + spec ajoutant `commentaire`
→ 1 migration + 1 module pour `commentaires` uniquement ; 3 ressources marquées inchangées ;
module généré valide (`node --check`). Cas noop → 0 fichier.

## Intégration dans le pipeline (à câbler — 2 approches)

Le générateur consomme `current_state` (déjà produit) et une spec cible `target = { resources:[{name, store_name, fields, required_fields}] }` (dérivée de l'Architect/Normalizer). Reste à décider **la forme de la sortie** en mode Améliorer :

### Approche A — ZIP complet (meilleure UX, recommandée)
Le pipeline ré-émet **l'app entière** = fichiers existants (passthrough du ZIP uploadé) **+** incréments.
- Nécessite d'étendre le **ZIP Analyzer** pour extraire **tous** les fichiers de l'existant (aujourd'hui il n'en extrait qu'un sous-ensemble pour l'analyse).
- Le bouton Déployer et le launcher continuent de fonctionner tels quels (app complète).

### Approche B — Incrément seul (patch, plus proche de l'esprit socle)
Le pipeline émet **uniquement** les fichiers d'incrément (migration + module). L'utilisateur les
**dépose** dans l'app existante (ou le service de déploiement les ajoute au dossier déployé).
- Plus simple, aucune modification du ZIP Analyzer.
- UX moins « clé en main » (il faut fusionner côté utilisateur / déploiement).

## Décisions d'arbitrage
| Décision | Choix | Justification |
|---|---|---|
| Portée du diff | Additif (nouvelles ressources) | Sûr, déterministe ; pas de suppression/renommage risqué en v1 |
| Support des incréments | migrations/*.sql + modules/*.routes.js | Réutilise le socle Sprint 3 (chargé sans toucher server.js) |
| Isolation | `user_id` + `WHERE user_id = ?` sur toutes les routes générées | Cohérent avec Sprint 2 (anti-IDOR) |
| Numérotation | max existant + 1 (migrations/modules) | Ordonné, idempotent, lisible |

## Suite (après choix A/B)
1. Câbler `computeIncrements` dans un nœud de l'Orchestrateur (branche `improve_mode` + `current_state` présent).
2. (Approche A) étendre le ZIP Analyzer : extraire tous les fichiers pour le passthrough.
3. Fusionner (existant + incréments) → sortie ; contourner la régénération complète Backend/Frontend.
4. Ajouter (option) une **section frontend** par ressource nouvelle (formulaire + liste), sur le même principe additif.
