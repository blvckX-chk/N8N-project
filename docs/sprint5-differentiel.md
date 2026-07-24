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

## Cœur déterministe (fait + testé) — Approche A + section frontend
`workflows/_sprint5_increment_generator.js` expose deux fonctions :

**`computeIncrements(current_state, target)`** renvoie :
```json
{
  "mode": "differential | noop",
  "diff": { "added_resources": [...], "unchanged_resources": [...], "files_generated": [...] },
  "increment_files":  [ { "path": "migrations/003_add_commentaires.sql", "content": "..." },
                        { "path": "modules/011_commentaires.routes.js",  "content": "..." } ],
  "frontend_files":   [ { "path": "frontend/ui_commentaires.js", "content": "..." } ],
  "html_injection":   { "sections": [ {store, html} ], "scripts": [ {store, tag} ] },
  "new_resources":    [ ... ]
}
```

**`mergeFiles(existingFiles, result)`** (Approche A) reconstitue **l'app complète** :
existant préservé **passthrough** + incréments backend + `frontend/ui_<store>.js` +
`index.html` **augmenté** (la `<section>` est insérée avant `</main>`, le `<script>` avant
`</body>`). `index.html` n'est **jamais réécrit**, seulement augmenté. Idempotent (ne
réinjecte pas une ressource déjà présente).

### Section frontend générée (CSP-safe)
`frontend/ui_<store>.js` est un fichier **autonome, servi depuis 'self'** (compatible CSP stricte
`script-src 'self'` du Backend V6.5, aucun handler inline). Il :
- définit `window.loadItems_<store>` / `window.deleteItem_<store>` ;
- branche le formulaire `#form-create-<store>` via `addEventListener` (pas d'`onsubmit`) ;
- réutilise les globals de `app.js` (`escapeHtml`, `showFeedback`) et la **délégation
  d'événements existante** (`data-refresh` / `data-del`) — `app.js` n'est pas touché ;
- appelle les routes `/<store>` (mêmes conventions que le Backend, sans préfixe `/api`).

La `<section>` injectée reprend les classes du thème (`card`, `create-form`, `form-group`,
`form-input`, `section-header`, `feedback`, `list-<store>`), donc identique visuellement au reste.

**Preuves (tests Node, `node --check` + assertions)** :
- CrimeStopper (signalements/interventions/typologies) + spec ajoutant `commentaire`
  → 1 migration `003_add_commentaires.sql` + 1 module `011_commentaires.routes.js` +
  1 `frontend/ui_commentaires.js` ; 3 ressources inchangées ; `mergeFiles` → app complète
  (10 fichiers existants + 3 nouveaux) avec `index.html` augmenté et sections existantes intactes.
- `ui_<store>.js` : 0 handler inline, boutons via `data-del`, champs numériques coercés en `Number`.
- Idempotence merge, cas `noop`, champ `INTEGER`/`TEXT NOT NULL`, isolation `user_id` : vérifiés.

## Intégration dans le pipeline — Approche A (LIVRÉE, testée)

Choix retenu : **Approche A avec section frontend**. Le pipeline ré-émet **l'app entière** =
fichiers existants (passthrough) **+** incréments backend **+** section frontend. Le bouton
Déployer et le launcher fonctionnent tels quels (app complète, clé en main).

### Pièces livrées
1. **`workflows/Agent_ZIP_Analyzer_V2.3.json`** — extraction **de TOUS les fichiers** du ZIP
   (parcours du *central directory*, STORED + DEFLATE). Nouvelles sorties :
   `all_files: [{path, content}]` (top-level **et** dans `current_state`), `files_count`.
   `current_state.resources` est désormais **complet** : union de `schema.sql` + **toutes les
   migrations** + routes `server.js` (dédupliqué par `store_name`). → une table déjà créée par
   une migration n'est plus vue comme « nouvelle » (zéro incrément en double).
2. **`workflows/Orchestrateur_V6.6.json`** — nœud **`Build Differential Output`** inséré entre
   `Agent Knowledge/Memory` et `Build Final Response`. Il lit `current_state` (ZIP Analyzer) +
   `artifacts.stores`/`data_model` (Architect), calcule le diff et **fusionne** (Approche A).
   `Build Final Response` est patché : si `differential === true`, `allFiles` = fichiers fusionnés
   (au lieu de `backend.files + frontend.files`), en conservant la doc et `start.sh`/`start.bat`.
3. **`workflows/_sprint5_orchestrator_diff_node.js`** — source autonome du nœud (référence /
   ré-import), avec `deriveTarget(architect)` + `computeIncrements` + `mergeFiles` embarqués.

### Garde-fous (testés)
- **Génération neuve** (pas d'`improve_mode` / aucun fichier existant) → `differential:false`,
  passthrough → **régénération complète normale** (le nœud ne détourne jamais une création).
- **Amélioration non-additive** (aucune nouvelle ressource : nouveau champ, renommage, UI…) →
  `differential:false` → régénération complète LLM (sûr : l'additif v1 ne couvre que l'ajout de
  ressources). Seul l'**ajout de ressources** prend le raccourci différentiel.

### Approche B (non retenue) — pour mémoire
Émettre uniquement les fichiers d'incrément (migration + module) et les déposer côté utilisateur /
déploiement. Plus simple mais UX moins « clé en main ». Écartée au profit de A.

## Décisions d'arbitrage
| Décision | Choix | Justification |
|---|---|---|
| Portée du diff | Additif (nouvelles ressources) | Sûr, déterministe ; pas de suppression/renommage risqué en v1 |
| Support des incréments | migrations/*.sql + modules/*.routes.js | Réutilise le socle Sprint 3 (chargé sans toucher server.js) |
| Isolation | `user_id` + `WHERE user_id = ?` sur toutes les routes générées | Cohérent avec Sprint 2 (anti-IDOR) |
| Numérotation | max existant + 1 (migrations/modules) | Ordonné, idempotent, lisible |
| Sortie | Approche A (ZIP complet) | UX « clé en main » : Déployer/launcher inchangés |
| Section frontend | `frontend/ui_<store>.js` autonome + injection `index.html` | CSP-safe (`'self'`, 0 inline), réutilise `app.js` (délégation `data-*`) |
| Complétude de l'état | `resources` = schema + migrations + routes (dédupliqué) | Évite de régénérer une ressource déjà créée par un incrément |

## État (DSR) — LIVRÉ & testé
- ✅ `computeIncrements` + `mergeFiles` (générateur additif + section frontend) — tests Node OK.
- ✅ ZIP Analyzer **V2.3** : extraction de tous les fichiers + `resources` complet.
- ✅ Orchestrateur **V6.6** : nœud `Build Differential Output` câblé + `Build Final Response` patché.
- ✅ Garde-fous : création neuve et changement non-additif → régénération complète (jamais détournée).

### À importer dans n8n (par l'utilisateur)
1. Ré-importer `Agent_ZIP_Analyzer_V2.3.json` (remplace V2.2).
2. Ré-importer `Orchestrateur_V6.6.json` (remplace V6.5) — **re-sélectionner les credentials
   Mistral** (`mistralCloudApi`) après import, comme d'habitude.
3. Test : améliorer une app existante en **ajoutant une ressource** → vérifier dans
   `Build Differential Output` : `differential: true`, `diff.added_resources` = la nouvelle
   ressource seule, `diff.unchanged_resources` = les autres. Le ZIP final contient l'app complète
   (existant intact + `migrations/NNN_add_*.sql` + `modules/NNN_*.routes.js` + `frontend/ui_*.js`
   + `index.html` augmenté).

### Limites v1 (assumées, documentées thèse)
Additif **uniquement** (ajout de ressources). Modifs non-additives (nouveau champ sur une table
existante, renommage, suppression, refonte UI) → régénération complète LLM. Piste v2 :
migrations `ALTER TABLE` additives pour l'ajout de champ (toujours sans réécrire l'existant).
