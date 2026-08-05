# Vérifier les Sprints 5, 6 et 7 — après génération et déploiement (VPS)

Ce guide donne des contrôles **reproductibles** (pour le mémoire : preuve empirique, pas revue de code).
Trois niveaux : (A) dans le **ZIP généré**, (B) dans les **nœuds n8n**, (C) sur l'**app déployée** (curl).

Exemple pris sur PharmaGarde avec RBAC (`pharmacien`, `gestionnaire`) + ressources partagées.
Adapte `BASE` au port réel de l'app déployée (visible dans la réponse du bouton Déployer ou via `GET /apps`).

```bash
BASE=http://167.86.93.31:5101        # <-- adapte le port
```

---

## A. Dans le ZIP généré (avant/après déploiement)

Dézippe et inspecte. Ce sont les empreintes déterministes des 3 sprints.

```bash
unzip -o ForgeIA-PharmaGarde-v1_0.zip -d app && cd app
```

**Sprint 7 (RBAC)** — dans `schema.sql` et `server.js` :
```bash
grep "role TEXT NOT NULL DEFAULT" schema.sql          # colonne role sur users
grep -n "function requireRole"      server.js          # middleware d'autorisation
grep -n "_uCount === 0 ? 'admin'"   server.js          # 1er compte = admin
grep -n "/api/users"                server.js          # endpoints admin de gestion des comptes
grep -n "requireRole('admin', 'gestionnaire')" server.js   # matrice §3.1 (POST /medicaments)
grep -n "requireRole('admin', 'pharmacien')"   server.js   # matrice §3.1 (POST /dispensations)
```

**Sprint 6 (ressources partagées)** — colonne `created_by` (pas `user_id`) + lecture non filtrée :
```bash
grep -n "created_by INTEGER NOT NULL" schema.sql       # provenance au lieu de cloisonnement
grep -n "SELECT \* FROM stocks ORDER BY id ASC"  server.js   # GET sans WHERE user_id (partagé)
# Contraste : une ressource privée aurait "WHERE user_id = ?"
```

**Sprint 5 (différentiel)** — visible seulement en mode **Améliorer**. Le ZIP de sortie doit contenir
l'app **complète** (existant intact) **+** les incréments :
```bash
ls migrations/     # 001_init.sql + 00N_add_<nouvelle_ressource>.sql (numérotée à la suite)
ls modules/        # 01N_<nouvelle_ressource>.routes.js
ls frontend/       # ui_<nouvelle_ressource>.js  (nouveau) ; index.html AUGMENTÉ
grep -c "section-create-" frontend/index.html          # +1 section vs l'app d'origine
git diff --stat    # si tu versionnes : server.js/db.js INCHANGÉS, seuls des fichiers AJOUTÉS
```

---

## B. Dans n8n (sorties de nœuds, après un run)

Ouvre l'exécution et regarde la sortie JSON de :

- **`Build Backend Payload`** → doit contenir `shared_resources: [...]`, `roles: [...]`, `permissions: {...}`
  (preuve que Normalizer→Architect ont bien extrait acteurs/permissions/partage).
- **`Inject Prompt`** (Agent Backend) → `_schema_sql` avec `role`/`created_by` ; `_server_js` avec `requireRole`.
- **`Build Differential Output`** (mode Améliorer) → `differential: true`,
  `diff.added_resources: ["<nouvelle>"]`, `diff.unchanged_resources: [...]` (les autres préservées).
- **`Format Standard Output`** (chaque agent) → `_version` (`6.7`, `5.3`, etc.) pour tracer la version active.

> Astuce : si `differential:false` en mode Améliorer, c'est le garde-fou — soit pas de nouvelle
> ressource (changement non-additif → régénération complète), soit `current_state` vide.

---

## C. Sur l'app déployée (curl) — la vraie preuve empirique

### C.1 Sprint 7 — RBAC (comptes admin / acteurs)

```bash
# 1) Le 1er compte inscrit devient ADMIN (bootstrap)
curl -s -c ck_admin.txt -X POST $BASE/api/register \
  -H 'Content-Type: application/json' -d '{"username":"admin1","password":"Passw0rd!"}'
curl -s -b ck_admin.txt $BASE/api/me            # -> { ..., "role": "admin" }

# 2) L'admin crée un pharmacien et un gestionnaire (POST /api/users réservé admin)
curl -s -b ck_admin.txt -X POST $BASE/api/users -H 'Content-Type: application/json' \
  -d '{"username":"pharma","password":"Passw0rd!","role":"pharmacien"}'
curl -s -b ck_admin.txt -X POST $BASE/api/users -H 'Content-Type: application/json' \
  -d '{"username":"gest","password":"Passw0rd!","role":"gestionnaire"}'

# 3) Un non-admin ne peut PAS créer de compte -> 403
curl -s -c ck_ph.txt -X POST $BASE/api/login -H 'Content-Type: application/json' \
  -d '{"username":"pharma","password":"Passw0rd!"}'
curl -s -o /dev/null -w "%{http_code}\n" -b ck_ph.txt -X POST $BASE/api/users \
  -H 'Content-Type: application/json' -d '{"username":"x","password":"Passw0rd!","role":"admin"}'   # -> 403

# 4) Matrice §3.1 : le pharmacien ne peut PAS créer un médicament -> 403
curl -s -o /dev/null -w "%{http_code}\n" -b ck_ph.txt -X POST $BASE/medicaments \
  -H 'Content-Type: application/json' -d '{"denomination":"Doliprane","forme":"comprime","sous_ordonnance":0}'   # -> 403

# 5) Aucune route sans jeton -> 401
curl -s -o /dev/null -w "%{http_code}\n" $BASE/medicaments        # -> 401
```

Attendu : `admin` au 1er compte, `403` quand le rôle n'a pas le droit, `401` sans session,
`201` quand le bon rôle agit.

### C.2 Sprint 6 — Ressources partagées (multi-acteurs)

```bash
# Le gestionnaire alimente le référentiel
curl -s -c ck_gest.txt -X POST $BASE/api/login -H 'Content-Type: application/json' \
  -d '{"username":"gest","password":"Passw0rd!"}'
curl -s -b ck_gest.txt -X POST $BASE/medicaments -H 'Content-Type: application/json' \
  -d '{"denomination":"Amoxicilline","forme":"gelule","sous_ordonnance":1}'
curl -s -b ck_gest.txt -X POST $BASE/stocks -H 'Content-Type: application/json' \
  -d '{"medicament_id":1,"quantite":50,"date_peremption":"2027-01-01"}'

# LE PHARMACIEN (autre compte) VOIT le stock créé par le gestionnaire  <-- preuve du partage
curl -s -b ck_ph.txt $BASE/stocks        # -> le stock apparaît (isolation user_id aurait renvoyé [])
```

Attendu : le pharmacien voit les stocks du gestionnaire. En modèle privé (isolation `user_id`),
la liste serait **vide** — c'est le contraste qui prouve le mode partagé.

### C.3 Sprint 5 — Différentiel (mode Améliorer)

1. Génère PharmaGarde, **récupère le ZIP**.
2. Onglet **Améliorer** : redonne la spec + le ZIP + « Ajoute une ressource *commentaires* (texte, note) ».
3. Vérifie le ZIP de sortie (section A, Sprint 5) : `server.js`/`db.js`/`schema.sql` **inchangés**,
   `migrations/00N_add_commentaires.sql` + `modules/01N_commentaires.routes.js` + `frontend/ui_commentaires.js`
   **ajoutés**, `index.html` avec **une section de plus**.
4. Redéploie et teste le nouveau point d'accès `/commentaires`.

### C.4 Introspection runtime (bonus, Sprint 4)

```bash
curl -s -b ck_admin.txt $BASE/api/_meta    # resources, schema_version, modules_loaded
```

---

## D. Améliorer après déploiement : état actuel et évolution

**État actuel (honnête).** Le mode **Améliorer** exige aujourd'hui de **fournir le ZIP** de l'app
existante (onglet Améliorer → upload `.zip`). Donc oui : **après un déploiement via le bouton, pour
améliorer, il faut d'abord récupérer le ZIP puis le resoumettre.** Le bouton Déployer ne réinjecte pas
automatiquement l'app dans le pipeline.

**Pourquoi le ZIP et pas seulement `/api/_meta` ?** L'introspection runtime (`/api/_meta`) donne la
*métadonnée* (routes, version de schéma, entités) mais **pas le contenu des fichiers**. Or l'Approche A
(Sprint 5) ré-émet l'app **complète** = fichiers existants **préservés** + incréments : il lui faut donc
le **contenu réel** des fichiers, que seul le ZIP (ou le dossier déployé) fournit.

**Évolution possible (sans téléchargement manuel).** Le service de déploiement expose déjà
`GET /apps` (liste) et `GET /apps/:name/files` (fichiers d'une app déployée). On peut donc ajouter au
panneau un flux **« Améliorer une app déployée »** : choisir l'app dans une liste → le panneau récupère
ses fichiers via `/api/apps/:name/files`, reconstruit le ZIP côté serveur (la logique `/api/create-zip`
existe déjà) et le soumet en mode Améliorer — **zéro upload manuel**. À implémenter si souhaité
(dépend du format retourné par `/apps/:name/files` du service de déploiement).
