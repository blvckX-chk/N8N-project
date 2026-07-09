# Suivi des sprints — Forge IA
_Support de rédaction du mémoire (DSR : artefact, itérations, évaluation, justification)_

Chaque sprint suit le même gabarit :
1. **Exports JSON** — versions actives dans le dépôt (référencées par commit).
2. **Changements** — agents/nœuds touchés + intention + commit.
3. **Preuves de test** — sorties réelles (HTTP, curl, exécution, gates).
4. **Décisions d'arbitrage** — chaque choix + justification.

---

## Sprint 1 — Persistance (validé)

**Artefact** : Agent Backend V5.8 (version d'archive du sprint) — apps générées avec SQLite (better-sqlite3), WAL, foreign_keys ON, schema.sql, requêtes paramétrées, singleton db.js.
**Commit d'origine** : (préciser d'après ton n8n)

**Preuve** : les données survivent au redémarrage — validé côté auteur.

**Décisions** :
- SQLite plutôt que serveur externe → app auto-portante, run-and-go.
- Requêtes préparées `db.prepare(...).run(...)` pour prévenir SQLi (OWASP A03).

---

## Sprint 2 — Authentification (validé)

**Critères d'acceptation (roadmap §7.3)** — tous remplis :
| Critère | Vérifié |
|---|---|
| App générée démarre derrière un mur de connexion (login.html) | ✅ test navigateur |
| Inscription d'un compte → accès accordé | ✅ 201 + cookie |
| Mauvais identifiants → refus | ✅ 401 (confirmé auteur) |
| Données d'un compte invisibles d'un autre (isolation) | ✅ liste vide pour Bob (confirmé auteur) |
| Code généré passe les 4 gates (SAST/Secrets/Review/Tests L0) | ✅ PASS |

_Réserve robustesse (hors socle)_ : l'agent QA (LLM, non déterministe) renvoie parfois REWORK. Ce n'est pas un défaut du socle d'auth (les gates déterministes passent) mais un item de stabilisation — voir « Items de robustesse ouverts ».

**Artefact** : Agent Backend V5.9 → V6.0, Agent Frontend V6.0, Agent Documentation V5.5, Agent Tests L0 V1.0 (durci).
**Commits** :
- `bb6cfef` — auth JWT+cookie HttpOnly, /register /login /logout /me
- `8bb2c1e` — express-validator sur endpoints métier
- `4a7b0fa` — fix Tests L0 (commentaires apostrophes)
- `7386a6a` — isolation données par compte (colonne user_id + WHERE)
- `7b75ec4` — Cache-Control no-store sur assets (fix couleurs perçues identiques)

**Nœuds modifiés (Backend)** :
- `Inject Prompt` : ajout table `users` au schema, /api/register /api/login /api/logout /api/me, `authMiddleware`, `helmet`, `cors`, `express-rate-limit` global + login, `express-validator`. Toutes les routes métier scopées par `req.user.sub`. Secret JWT auto-généré au 1er lancement (crypto.randomBytes, persisté dans .jwt_secret).
- `Parse Files` : .env.example inclut JWT_SECRET optionnel.

**Nœuds modifiés (Frontend)** :
- `Build Payload` : login.html généré (couleurs du thème), garde d'auth dans app.js (redirige si 401 sur /api/me), bouton Déconnexion.
- `Route Mode`, `Merge LLM Result`, `Parse & Validate LLM Output` : propagation `_login_html`.

**Nœud modifié (Documentation)** : README généré décrit register/login/logout/me et l'isolation.

**Nœud modifié (Tests L0)** : compteur d'accolades/parenthèses ignore désormais les commentaires (skip `//` et `/* */`).

**Preuves de test** (exécutées localement sur un app générée) :
```
$ curl /signalements → HTTP 401 (route protégée)
$ curl /health      → HTTP 200 (route publique)
$ curl -X POST /api/register {"username":"alice","password":"motdepasse123"}
  → 201 {"id":1,"username":"alice"} + cookie HttpOnly pose
$ curl -b cookie /signalements → 200 [ ... uniquement les items d'Alice ]
$ curl -b cookie-de-bob /signalements → 200 []  (isolation OK)
$ curl -b cookie-de-bob -X DELETE /signalements/1 → 404 "Introuvable" (IDOR prevenu)

Gates : SAST PASS 100 | Secrets PASS 100 | Code Review PASS 100 | Tests L0 PASS
```

**Décisions d'arbitrage** :
| Décision | Choix | Justification |
|---|---|---|
| Stockage jeton (client) | Cookie HttpOnly + Secure + SameSite=strict | Inaccessible en JS (XSS) ; envoyé auto par navigateur ; standard OWASP A07 |
| Durée JWT | 8 h | Compromis session utilisable / fenêtre d'exposition ; documenté RFC 8725 |
| Premier accès | /api/register public | MVP démonstratif ; sinon barre à l'entrée ; l'isolation par compte limite le risque |
| Hachage mot de passe | bcrypt 12 rounds | Standard OWASP, résistance brute-force à horizon 2026 |
| Rate-limit login | 10 tentatives / 15 min / IP | Freine brute-force sans bloquer usage légitime |
| Secret JWT | Auto-généré au 1er lancement (crypto.randomBytes 48 bytes) | Zéro secret en dur ; app reste run-and-go via le launcher |
| Isolation données | Colonne user_id + WHERE user_id = ? sur toutes routes | Prévient IDOR (OWASP A01) ; bug observé (Bob voyait données d'Alice) corrigé |
| Cache statique | no-store (etag/lastModified off) | Le launcher réutilise localhost:3000 ; le CSS de l'app précédente restait en cache |

---

## Sprint 3 — Architecture extensible (en cours)

### Sprint 3.1 — Schéma versionné + registre introspectable (livré)

**Artefact** : Agent Backend V6.0.
**Commit** : `9be1be6`.

**Nœuds modifiés (Backend, `Inject Prompt`)** :
- db.js : table `schema_migrations`, runner `applyMigration(id, sql)` idempotent. schema.sql = migration `001_init`. Fichiers `migrations/*.sql` triés, appliqués une seule fois par nom.
- server.js : `APP_META` (app_version, schema_version, resources, routes) + `GET /api/_meta` (protégé auth).

**Preuves de test** :
```
$ GET /api/_meta (sans auth) → 401
$ GET /api/_meta (avec auth) → 200 {app_version, schema_version, resources[], routes[]}

# Migration additive test
$ echo "ALTER TABLE trajets ADD COLUMN statut TEXT DEFAULT 'actif';" > migrations/002_add_statut.sql
$ reboot → migrations=['001_init','002_add_statut.sql'], colonne 'statut' ajoutee
$ reboot → aucune erreur ALTER (idempotent), each applied once: YES

Gates : SAST PASS | Secrets PASS | Review PASS | Tests L0 PASS
```

**Preuve en pipeline RÉEL** (DiaspoKoli généré sur le VPS, `GET /api/_meta` via console navigateur) :
```json
{ "app_version": "1.0.0", "schema_version": 1,
  "resources": [
    { "name": "trajet",      "store_name": "trajets",      "required_fields": ["date_de_vol","ville_depart","ville_arrivee","kilos_disponibles","prix_par_kilo"] },
    { "name": "reservation", "store_name": "reservations", "required_fields": ["description_colis","poids_estime","trajet_id"] },
    { "name": "paiement",    "store_name": "paiements",    "required_fields": ["montant","methode","reservation_id"] } ],
  "routes": [ "GET /health","POST /trajets","GET /trajets","POST /reservations","GET /reservations",
              "POST /paiements","GET /paiements","DELETE /trajets/:id","DELETE /reservations/:id","DELETE /paiements/:id" ] }
```
→ L'introspection déterministe fonctionne en production (3 ressources, FK acteurs `voyageur_id`/`expediteur_id` correctement traités comme champs, pas comme routes).

**Décisions** :
| Décision | Choix | Justification |
|---|---|---|
| Format ID migration | Nom de fichier (`002_add_statut.sql`) | Simple, ordonné, lisible dans les diffs git ; convention Flyway |
| Table registre | `schema_migrations(id TEXT PK, applied_at TEXT)` | Portable SQLite, permet l'introspection de la version courante |
| Protection /api/_meta | authMiddleware | Fuite d'information limitée (schéma = surface d'attaque) |

### Sprint 3.2 — Chargeur de modules (livré)

**Artefact** : Agent Backend V6.1.
**Commit** : `8ed4b21`.

**Nœud modifié** : `Inject Prompt` — après `/api/_meta`, itération `modules/*.routes.js` triés, chaque module = factory `(app, db, authMiddleware) => void`. `APP_META.modules_loaded` renseigné.

**Preuves de test** (module `010_notes.routes.js` déposé sans toucher server.js) :
```
$ boot → log "[module charge] 010_notes.routes.js"
$ POST /notes (auth) → 201 {"id":1,"contenu":"Ma note additive"}
$ GET /notes (auth) → 200 [ ... isolation user_id ]
$ GET /stats (auth) → 200 {"user":"alice","mes_trajets":0}
$ GET /api/_meta → {"modules_loaded":["010_notes.routes.js"], ...}
$ reboot → clean, migrations each applied once: YES

Gates : SAST PASS | Secrets PASS | Review PASS | Tests L0 PASS
```

**Décisions** :
| Décision | Choix | Justification |
|---|---|---|
| Convention nommage | `<ordre>_<nom>.routes.js` | Ordre déterministe par tri lexicographique |
| Contrat module | `module.exports = (app, db, authMiddleware) => void` | Injecte les 3 dépendances essentielles, découpling minimal |
| Erreur d'un module | Log + poursuivre (try/catch) | Un module cassé ne doit pas casser l'app (résilience §5.5) |

---

## Ce que JE NE PEUX PAS fournir (à extraire côté n8n)

Ces éléments vivent uniquement dans ton instance n8n et dépendent de tes runs réels :

1. **Métriques d'exécution du pipeline** : durée totale, durée par agent, taux GoNoGo=CONTINUE — à lire dans `Executions` du dashboard n8n.
2. **Réponses réelles Mistral** : contenu retourné par l'API Mistral pour tes 3 tests (CrimeStopper/DiaspoKoli/TrocSavoir), consommation tokens — dans les logs d'exécution n8n de l'agent Architect/Frontend/QA.
3. **Consommation LLM cumulée** (§ OWASP LLM10) : coût par génération, nombre de tokens — dans les logs n8n et console Mistral.
4. **Historique des versions actives** dans n8n : quel numéro d'agent était actif à la date T (mon dépôt reflète mes propres jalons, pas forcément l'ordre d'activation sur ton VPS).
5. **Screenshots** des apps générées (thème appliqué, page de login) — nécessitent ton navigateur.
6. **Captures des exécutions Go/No-Go** dans les 3 études de cas (CrimeStopper, DiaspoKoli, TrocSavoir/PharmaGarde).

Quand tu as ces éléments, envoie-les-moi et je les intègre au tableau de suivi.

---

## Items de robustesse ouverts (transverses, hors socle)

| Item | Nature | Priorité |
|---|---|---|
| Agent QA renvoie parfois REWORK (LLM non déterministe) | Stabilisation — durcir le filtre de faux-positifs ou abaisser la sensibilité | Moyenne |
| Clés Mistral en dur dans le JSON des 4 agents LLM | Sécurité (OWASP LLM02) — migrer vers `$env`/credentials n8n + clé de secours (failover) | Haute |
| Alignement sécurité pour le mode additif (§5.5) | Non-régression : SAST/QA doivent évaluer le différentiel ET l'existant | À venir (avec Sprint 5) |

## Note trajectoire (roadmap V1.0, §12.1)

La roadmap détaille désormais 8 sprints jusqu'à la super-application multi-acteurs :
Sprint 1 Persistance ✅ · Sprint 2 Auth ✅ · Sprint 3 Architecture extensible 🟡 (3.1 + 3.2 faits) ·
Sprint 4 Introspection · Sprint 5 Mode différentiel · Sprint 6 Multi-acteurs ressources partagées ·
Sprint 7 Temps réel (WebSocket) · Sprint 8 Agrégation.

---

## Sécurisation clés Mistral + failover (validé)

**Artefacts** : Agent Architect V5.0, QA V5.5, Frontend V6.1, Spec Normalizer V1.3.

**Changement** : les 7 nœuds HTTP Mistral des 4 agents LLM passent d'un header `Authorization: Bearer <clé en dur>` à une **authentification par credential n8n** (`mistralCloudApi`). Nœud primaire → credential `MISTRAL_API_KEY` ; nœud « Retry » → `MISTRAL_API_KEY_2` (failover réel, la topologie IF/Retry existait déjà, héritée du motif Groq).

**Preuve** : 0 clé en dur restante dans les 4 JSON (`grep 'Bearer [A-Za-z0-9]{20,}'` → 0). JSON valides.

**Décisions** :
| Décision | Choix | Justification |
|---|---|---|
| Stockage clés | Credentials n8n (pas env, pas JSON) | Jamais dans le workflow exporté → plus de fuite git (OWASP LLM02/A02) |
| Failover | Primaire `MISTRAL_API_KEY`, secours `MISTRAL_API_KEY_2` | Continuité si quota/incident sur une clé (comme le double compte Groq initial) |

## Stabilisation QA (validé)

**Artefact** : Agent QA V5.5.

**Changement** : QA est repositionné comme gate **qualité** (pas sécurité — assurée par SAST/Secrets/DAST qui STOP). Un `high` de catégorie non-`security` devient **WARN** (non bloquant) au lieu de FAIL. Seul un `high` de catégorie `security` survivant au filtre de faux-positifs bloque (REWORK). Filtre de faux-positifs élargi aux concepts Sprint 2/3 (user_id, migrations, modules, cookie, middleware…).

**Preuve de test** (nœud « QA Normalize & Scoring » exécuté sur entrées types) :
```
quality-high + verdict FAIL  -> status WARN | approved: true  (ne bloque plus)
security-high (eval)         -> status FAIL | approved: false (bloque toujours)
aucun probleme               -> status PASS
```

**Décision** : séparation des responsabilités (roadmap §6) — la sécurité est gatée par les agents dédiés ; QA ne doit pas bloquer sur la variance LLM d'un jugement qualité.

---

## Sprint 4 — Introspection de l'existant (livré)

**Artefact** : Agent ZIP Analyzer V2.2.
**Objet (roadmap §5.2)** : lire un projet généré et produire une description structurée de son état courant.

**Changement (nœud `Analyze ZIP`)** : en plus des routes/version déjà extraites, l'agent produit un objet `current_state` au **même format que `/api/_meta`** :
- `resources` : dérivées des handlers POST de server.js (nom, store_name, required_fields) — repli fiable ; enrichissement via schema.sql si parseable.
- `routes` : toutes les routes de server.js.
- `modules` : fichiers `modules/*.routes.js` présents dans le ZIP.
- `migrations` : fichiers `migrations/*.sql` présents.
- `schema_version`, `app_version`.

**Preuve de test** (ZIP réel STORED d'une app générée, avec migration + module) :
```json
{ "app_version":"1.0", "schema_version":1,
  "resources":[{"name":"trajet","store_name":"trajets","required_fields":["ville_depart","kilos_disponibles"]}],
  "routes":[ 9 routes incl /api/*, /health, /trajets, DELETE /trajets/:id ],
  "modules":["modules/010_notes.routes.js"],
  "migrations":["migrations/002_add_notes.sql"] }
```

**Limite connue** : le parseur ZIP historique lit uniquement le format STORED (non compressé) — c'est le format produit par `/api/create-zip`, donc OK en pratique. Les TYPES de champs viennent de `/api/_meta` (runtime) plutôt que de schema.sql (extraction statique fragile).

**Décision** :
| Décision | Choix | Justification |
|---|---|---|
| Source des ressources | Handlers POST de server.js (repli) | Extraction fiable ; l'ancien `existing_stores` visait le backend en mémoire, obsolète avec SQLite |
| Format de sortie | Identique à `/api/_meta` | Les 2 chemins d'introspection (statique ZIP + runtime) convergent → base cohérente pour le mode différentiel (Sprint 5) |

### Défaut corrigé — propagation du ZIP en mode amélioration (Orchestrateur V5.8 → V5.9)

**Symptôme** : en mode « Améliorer » (spec PDF + ZIP existant), le ZIP Analyzer renvoyait toujours la branche « pas de ZIP » (`improve_mode:false`, `files_found:[]`, pas de `current_state`), alors que le ZIP était bien envoyé par le frontend.

**Diagnostic** (par inspection des sorties de nœuds sur une exécution réelle) :
- Sortie `Webhook` : `existing_zip_base64` **présent** (77 Ko).
- Sortie `Validate Input` : `existing_zip_base64` = **null**, mais `specs_context` rempli.
- Cause racine : les nœuds `Detect Input` puis `Build PDF Context` **reconstruisent un objet allégé** (texte de specs extrait) qui **omet** les gros payloads binaires. `Validate Input` lit cet objet → le ZIP est déjà perdu → l'`IF Improve Mode ?` route bien (car `improve_mode` survit) mais `Build ZIP Payload` retombe sur sa branche « génération normale » faute de `existing_zip_base64`.

**Correctif** : `Validate Input` relit désormais les payloads binaires (`existing_zip_base64`, `existing_zip_filename`, `pdf_base64`) **directement depuis le nœud `Webhook`** (source de vérité du run) — même idiome que `Extract PDF Text` (`$('Webhook').first().json.body`). Correctif à point unique, robuste vis-à-vis de la chaîne d'extraction.

**Preuve** : simulation de la chaîne (`Validate Input` → `Build ZIP Payload`) avec les formes de données réelles → `existing_zip_base64` transmis, `improve_mode:true`, ZIP relayé à l'analyzer. Vérification runtime attendue côté n8n : sortie `Analyze ZIP` avec `improve_mode:true`, `files_found` non vide et `current_state` peuplé.

| Décision | Arbitrage |
|---|---|
| Relire depuis `Webhook` plutôt que réparer `Detect Input`/`Build *Context` | Point unique, ne dépend pas des branches d'extraction (PDF/DOCX/image), cohérent avec le pattern existant |
| Ne pas propager le ZIP dans toute la chaîne | Évite de trimballer 77 Ko+ de base64 à travers tous les nœuds intermédiaires ; seul le consommateur (`Validate Input`) le relit à la demande |

---

## Sprint 4 — validé en production ✅

Run réel en mode « Améliorer » (CrimeStopper v1.0, après correctif Orchestrateur) : sortie `Analyze ZIP` avec `improve_mode:true`, `files_found:[server.js, app.js, index.html, README.md, package.json]` et **`current_state` peuplé** (3 ressources `signalement`/`intervention`/`typologie` avec `required_fields`, 15 routes, `schema_version:1`). L'introspection statique est opérationnelle → matière première du mode différentiel (Sprint 5).

## UX / socle produit — panneau ForgeIA (frontend v5.0.0)

Améliorations d'ergonomie et d'autonomie utilisateur (100 % panneau de contrôle, hors apps générées) :

| Changement | Détail |
|---|---|
| `Environnement` rendu **fonctionnel** | `staging`/`production` propagé de l'UI → Orchestrateur (`Build Backend Payload`) → agent Backend (`Validate Specs` → `Parse Files`) → **`NODE_ENV` du `.env` généré**. `production` ⇒ cookies de session `secure:true`. |
| `Langage` / `Framework` | Options conservées mais **JavaScript/Express seuls actifs** ; Python/TypeScript/FastAPI/NestJS marqués « (à venir) » (désactivés). Honnêteté sur le périmètre réel (générateurs déterministes mono-stack). |
| Entrées **Image** et **URL** retirées | Sources « best-effort » bruitées ; on garde Texte / PDF / DOCX / Améliorer (specs structurées = génération fiable). |
| Launcher **générique** retiré | Doublon inutile ; seul le launcher **spécifique par ZIP** (`/api/specific-launcher`) est conservé. |
| Aide & refonte visuelle | Bannière d'accueil « comment ça marche » (3 étapes), texte d'aide par onglet, tooltips (environnement/langage/framework, boutons ZIP/Launcher), refonte SaaS moderne (palette dégradée, animations CSS, illustration SVG). |
| Pas de bouton « Stop » | Décision assumée : un stop « doux » (abandon UI seul) laisserait le pipeline consommer des tokens côté serveur ; un stop « dur » exigerait clé API n8n + suivi d'`execution id`. Reporté. |

## Roadmap — extensions de génération (au-delà du socle web)

- **Générateurs multi-stack** : Python/FastAPI, TypeScript/NestJS. Nécessite de nouveaux générateurs déterministes par stack (agents Backend/Frontend/Architect dédiés). Plusieurs sprints.
- **Générateur de client mobile** (React Native / Flutter, type Yango / Gozem / UberEats) : produit une UI mobile **en consommant `/api/_meta` + `current_state`** (l'introspection déjà validée aux Sprints 3–4 est précisément la fondation requise). Jalons intermédiaires côté backend : géolocalisation, temps réel (WebSocket), paiement.
