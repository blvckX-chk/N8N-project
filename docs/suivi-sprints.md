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
| Alignement sécurité pour le mode additif (§5.5) | Sprint 5 : les incréments sont **déterministes** (mêmes patterns sûrs que le socle — requêtes préparées, `user_id`, validation), donc sécurisés par construction sans SAST par-run ; l'existant conserve ses attestations d'origine. **Reste** : brancher SAST/QA sur les `modules/*.routes.js` générés pour une preuve explicite (aujourd'hui SAST scanne le `server.js` régénéré par l'agent Backend). | Moyenne (v2) |
| Multi-acteurs / ressources partagées | **LIVRÉ (Sprint 6, mode partagé)** — ressource `shared` = lecture non filtrée + provenance `created_by`. Voir section Sprint 6. | ✅ |

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

### Défaut corrigé — DAST crashait le pipeline en `production` (Agent DAST → V1.1)

**Symptôme** : run en environnement `production` bloqué à l'agent DAST ; nœud HTTP `Agent DAST` de l'Orchestrateur en erreur `Invalid JSON in response body`, puis frontend « n8n a retourné une réponse vide ».

**Cause racine** : `Validate Input` (DAST) faisait un `throw` dur si `environment === 'production'`. Un `throw` dans un nœud Code fait renvoyer au webhook une réponse d'erreur non-JSON → le nœud HTTP appelant échoue → le pipeline s'arrête avant `Respond Final`. Défaut **latent** exposé par le Sprint « environment réel » : `environment` traverse désormais le pipeline (`Build DAST Payload` → `initial.environment`) et l'utilisateur a testé `production`.

**Correctif** : DAST **saute proprement** l'analyse en production (bonne pratique : pas de tests dynamiques intrusifs sur la prod) et renvoie `status:PASS` + `dast_skipped:true` + note explicite, au lieu de `throw`. Le pipeline continue.

**Preuve** (simulation des 2 nœuds, entrée `environment:production`) : `Validate Input` ne throw plus (`dast_skipped:true`) → `Normalize` → `status:PASS`, `approved_for_pipeline:true`, summary « DAST non execute : tests dynamiques interdits en environnement production ».

| Décision | Arbitrage |
|---|---|
| Skip PASS plutôt que FAIL en production | Ne pas exécuter de DAST sur la prod est la bonne pratique ; bloquer le pipeline serait un faux négatif. La note `dast_skipped` garde la traçabilité. |
| Corriger le `throw` plutôt que retirer le garde | Le garde reste utile (empêche tout test intrusif prod), mais doit répondre proprement, pas crasher. |

---

## Sprint sécurité S-B — Durcissement des apps générées (livré)

**Artefacts** : Agent Frontend V6.2, Agent Backend V6.3.

**Défaut corrigé** : les apps générées désactivaient la CSP (`helmet({ contentSecurityPolicy: false })`) → aucune défense XSS (OWASP A03).

**Changements** :
- **Backend (`Inject Prompt`)** : CSP stricte via helmet — `default-src 'self'`, **`script-src 'self'`** (aucun inline), `style-src 'self' 'unsafe-inline'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'`, `img-src 'self' data:` + `Referrer-Policy: no-referrer`, HSTS, `X-Content-Type-Options`, `X-Frame-Options` (défauts helmet). Route dédiée `GET /login.html` qui sert la page avec une **CSP par nonce** (nonce cryptographique régénéré à chaque requête, injecté dans le `<script>`), placée avant `express.static`.
- **Frontend (`Build Payload`)** : suppression de **tout le JS inline** de l'app principale (handlers `onclick` refresh/logout/suppression, `onsubmit="return false;"`) remplacé par de la **délégation d'événements** (`data-refresh` / `data-del` + `data-id` / `#btn-logout`) dans `app.js`. L'app respecte donc `script-src 'self'` sans `unsafe-inline`.

**Preuves (génération réelle CrimeStopper via harness + runtime helmet)** :
```
/            -> Content-Security-Policy: ... script-src 'self' ...  + HSTS, nosniff, X-Frame-Options, no-referrer
/login.html  -> script-src 'nonce-u05niBi79mCHBMAiewBfeA=='   (req 1)
/login.html  -> script-src 'nonce-KbFD49zl0oUTzlD7bJbf3g=='   (req 2, nonce different)
login.html   -> <script nonce="TgqqGPHHZ/NEXQEcp7iwLg==">   (nonce injecte dans la balise)
index.html   -> 0 onclick, 0 onsubmit, 3 data-refresh, 1 #btn-logout
app.js       -> 0 onclick, delegation presente ; node --check OK
server.js    -> node --check OK
```

| Décision | Arbitrage |
|---|---|
| `script-src 'self'` (pas `unsafe-inline`) | Vraie défense XSS ; impose de retirer le JS inline — fait via délégation |
| `style-src` garde `'unsafe-inline'` | Les styles inline (attributs `style=`, `<style>` de login) sont à faible risque ; les retirer tous serait coûteux pour un gain marginal. Documenté. |
| login.html en **nonce** plutôt qu'externalisé | Page servie statiquement ; le nonce par requête donne une CSP stricte sans toucher l'assemblage des fichiers (moins de surface de régression) |
| Route login avant `express.static` | Sinon le fichier statique serait servi en premier et la CSP par nonce ignorée |

---

## Sprint sécurité S-C — Attestation OWASP/ASVS + DAST réel (livré)

**Artefacts** : Agent Backend V6.4 (SECURITY.md), Agent DAST V1.2 (analyse du vrai code), Orchestrateur V6.2 (wiring server.js → DAST).

**1. Attestation `SECURITY.md`** (Backend `Parse Files`, déterministe) : chaque app générée embarque un rapport mappant ses contrôles réels sur **OWASP Top 10 2021** + **ASVS 4.0**. L'analyse est faite **sur le code généré** (regex sur `server.js`), pas sur des hypothèses — donc l'attestation reflète l'app réelle.

**2. DAST réel** : l'agent DAST n'est plus « simulé » (mot-clé `simulate`). L'Orchestrateur (`Build DAST Payload`) lui transmet le `server.js` généré (`$('Agent Backend').json.files`), et `DAST Normalize & Scoring` inspecte 10 contrôles concrets, chacun mappé OWASP :

**Preuve (2 apps réelles passées au nœud DAST)** :
```
HARDENED (S-B)  -> status PASS,  score 100, 0 finding
VULNERABLE      -> status FAIL,  score 14
   CRITIQUES : A01 authMiddleware absent, A01 isolation user_id absente,
               A03 SQL non parametree, A05 CSP desactivee, A07 cookie sans HttpOnly,
               A02 secret JWT en dur
   WARNINGS  : A07 SameSite, A07 rate-limit, A03 validation
```

| Décision | Arbitrage |
|---|---|
| DAST par analyse du code plutôt que live HTTP | La DAST tourne comme gate AVANT déploiement ; analyser le server.js généré donne un verdict réel sans dépendre d'une URL déployée |
| Attestation basée sur regex du code réel | Reflète l'app effectivement générée (pas un template figé) ; traçable |

## Sprint sécurité S-D — Sécurité du pipeline (OWASP LLM Top 10 2025) (livré)

**Artefact** : Orchestrateur V6.2 (`Sanitize Input` durci).

Renforcement de la défense **anti-prompt-injection** (OWASP LLM01) : patterns élargis (override d'instructions, changement de rôle/DAN, exfiltration de prompt/clé/secret, accès `process.env`/`require`/`child_process`, délimiteurs de prompt, jailbreak). L'entrée suspecte est **rejetée avant tout appel LLM**.

**Preuve (unitaire sur la fonction)** :
```
Attaques    : 6/6 REJETE  (ignore previous instructions, disregard/print api key,
              DAN, new system prompt, process.env.MISTRAL_API_KEY, --- END OF SYSTEM PROMPT ---)
Legitimes   : 3/3 ACCEPTE (specs signalements / covoiturage / liste deroulante)
```
→ Zéro faux positif sur des specs métier réelles.

---

## Corrections & consolidation (retours de test)

**Orchestrateur V6.3, Agent DAST V1.3.**

1. **Sanitize Input ne crashe plus le pipeline** (défaut du même type que DAST-prod) : sur détection d'injection il faisait un `throw` → réponse webhook vide → « réponse vide » côté panneau. Désormais il **neutralise** les motifs d'injection (remplacés par `[filtre]`) et **continue** (OWASP LLM01 : défense sans interruption de service), avec `security_flags: ['prompt_injection_neutralized']`. Testé : injection → neutralisée (pas de crash), spec légitime → intacte.
2. **Rapport de sécurité consolidé** : `Build Final Response` agrège les verdicts de **tous les gates** (SAST, SCA, Secrets, Code Review, DAST, QA, Tests L0, Go/No-Go) et les **annexe au `SECURITY.md`** de l'app. Le rapport final = attestation OWASP/ASVS (contrôles code) **+** tableau des résultats de gates du pipeline.
3. **DAST auditable** : la sortie expose `analysis_mode` (`code_analysis` si le vrai `server.js` a été analysé, `skipped_production`, ou `heuristic` en repli) → on peut confirmer qu'un PASS vient bien d'une analyse du code réel.

---

## Défaut corrigé — DAST n'analysait jamais le vrai code (Orchestrateur V6.5)

**Symptôme** : malgré `Build DAST Payload` correct (transmettant `server_js`), l'agent DAST restait en `analysis_mode: heuristic` — il n'analysait pas le code réel.

**Cause racine** : le nœud HTTP `Agent DAST` de l'Orchestrateur avait un **body figé** qui reconstruisait sa charge utile depuis `$('Validate Input')` (`simulate:'pass'`, endpoints en dur) et **ignorait totalement `Build DAST Payload`** — donc `server_js` n'était jamais envoyé.

**Correctif** : body du nœud `Agent DAST` = `={{ JSON.stringify($json) }}` → transmet la sortie de `Build DAST Payload` (avec `server_js`). Prouvé : DAST → `analysis_mode: code_analysis`, `server_js_len: 371`, PASS.

## Registre des versions d'agents (demandé pour la traçabilité)

- **DAST V1.4** : expose `_version` + `server_js_len` reçu (auto-diagnostic).
- **Orchestrateur V6.5** (`Build Final Response`) : agrège le `_version` de chaque agent (défensif, `n/a` si absent) → `metrics.agent_versions` dans la réponse finale **et** une section « Versions des agents » dans `SECURITY.md`. Permet de vérifier les versions actives directement dans la sortie du pipeline (le nom du workflow dans n8n ne change pas à l'import de nœuds — le registre est la source fiable).

---

## Sprint sécurité S-A — Vrais outils (partie 1 : SCA réel + SBOM)

**Découverte** : l'agent SCA était **déjà branché sur l'API publique OSV.dev** (`/v1/querybatch`) et correctement câblé (son nœud HTTP référence bien `Build SCA Payload`). Donc la SCA fait déjà de la **détection de CVE réelles**, sans Docker.

**Artefacts** : Agent SCA V5.1, Agent Backend V6.5.

**1. SCA améliorée (V5.1)** : `querybatch` ne renvoyant que l'`id`, on retrouve le **paquet et la version réels** en alignant les résultats sur l'ordre des requêtes ; chaque finding porte désormais `package`, `version`, l'`id` CVE/GHSA et le lien **advisory OSV** (`https://osv.dev/vulnerability/<id>`). Testé (réponse OSV mockée au format réel) : `jsonwebtoken@8.5.1` → finding avec paquet/version/lien corrects.
> Limite connue : `querybatch` ne fournit pas la sévérité → findings en « medium » par défaut. Enrichissement possible via `/v1/vulns/{id}` (futur).

**2. SBOM CycloneDX (Backend V6.5)** : chaque app générée embarque un **`bom.json`** au format **CycloneDX 1.5** (déterministe depuis `package.json`, avec `purl` `pkg:npm/<name>@<version>`). OWASP A06 (transparence chaîne d'approvisionnement). Testé : 5 composants, purls valides.

**Pourquoi n8n plutôt que Docker pour ces deux-là** : SCA = API OSV (données CVE réelles, aucune install) ; SBOM = génération déterministe standard. Restent pour Docker (fidélité max) : **Semgrep** (SAST). Secrets = upgrade entropie possible sans Docker.

## S-A partie 2 — Secrets (entropie) + SAST renforcé (déterministe, sans Docker)

**Artefacts** : Agent Secrets Scanning V5.1, Agent SAST V5.2.

**Secrets V5.1** : ajout d'une **détection par entropie de Shannon** (approche gitleaks) — repère les littéraux à forte entropie (≥ 4.0 bits/car, longueur ≥ 20) affectés à une variable sensible, en plus des ~18 patterns nommés existants. Placeholders (`changeme`, `your_key`, `${...}`) exclus. Testé : secret réel (entropie 5.0) détecté, **code généré propre reste PASS (0 faux positif)**.

**SAST V5.2** : ajout des règles manquantes majeures — **A03 Injection SQL** (concaténation/interpolation dans une requête), **A03 eval / new Function**, **A03 XSS réfléchi** (`res.send(req...)`), **A02 secret JWT en dur**. S'ajoutent aux règles existantes (SSRF, prototype pollution, path traversal, crypto faible, command injection, CORS, helmet…). Testé : app durcie (requêtes paramétrées) → PASS 0 FP ; code vulnérable → FAIL (SQLI-001 + EVAL-001 + XSS-001).

`_version` ajouté à SCA, Secrets, SAST, Backend, DAST (le registre se remplit).

**État S-A** : SCA (OSV réel) ✅, SBOM ✅, Secrets (entropie) ✅, SAST déterministe renforcé ✅. Reste **Semgrep en Docker** (fidélité max) — à faire avec la gestion du bouton Déployer / VPS.

## S-A partie 3 — Semgrep (vraie SAST) + fix timeout Déploiement

**Artefacts** : `frontend-forge-ia/server.js` (timeout), Agent SAST V5.3, microservice Semgrep (déjà livré).

**1. Fix timeout Déployer** : `proxyDeploy` (/api/deploy, /api/improve) utilise désormais un **AbortController à 120s** (le déploiement prend 6-15s : npm install) au lieu de l'option `timeout` de node-fetch, et **garantit `task_id`** dans le corps transmis (le service renvoie 400 sinon).

**2. SAST V5.3 — câblage Semgrep** : nœud HTTP `Semgrep Scan` (`http://host.docker.internal:8010/scan`) + nœud `Merge SAST` :
- **Union + dédoublonnage** des findings ; Semgrep **en complément**, n'enlève jamais un finding déterministe (SQLI-001 garanti, car Semgrep communautaire rate la SQLi Express).
- **Score = min** des deux moteurs.
- **Repli** : Semgrep injoignable → déterministe seul, pas de blocage (`onError: continueRegularOutput`, `alwaysOutputData`).

**Preuve (merge testé)** : Semgrep OK → SQLI-001 conservé + eval ajouté + doublon dédoublonné, score = min(70,40)=40. Semgrep KO → repli déterministe, `semgrep_available:false`, pas de blocage.

→ **S-A complet** : SCA (OSV) · SBOM · Secrets (entropie) · SAST (déterministe + Semgrep). Sécurité (S-A/B/C/D) bouclée.

## Robustesse LLM + nom d'app déployée (retours de test)

**Nom d'app déployée** (panneau v5.2.2) : `deployApp` utilise désormais **`getProjectName()`** (ex. `diaspokoli`) au lieu du `task_id` pour `app_name`.

**Failover Mistral** : le câblage est **correct** (vérifié : primaire échec/invalide → retry clé 2 → succès rejoint le flux principal ; deux clés épuisées → fallback). Le relais ne « soulage » pas un **rate-limit** si les deux clés sont sur le **même compte Mistral** (limite partagée). Amélioration livrée : **`retryOnFail` (3 essais, 3 s)** sur tous les nœuds Mistral (Architect V5.1, QA V5.6, Frontend V6.3 — qui gagne aussi la résilience, Normalizer V1.4) → un 429 transitoire se rejoue avant de basculer sur la 2ᵉ clé. **Note** : pour que la 2ᵉ clé ajoute réellement du quota, elle doit venir d'un **compte Mistral distinct** (ou d'un palier payant) ; deux clés d'un même compte partagent la même limite.

---

## Sprint 5 — Mode différentiel (Approche A + section frontend) — LIVRÉ ✅

**Artefacts** : `workflows/_sprint5_increment_generator.js` (générateur + `mergeFiles`),
`workflows/_sprint5_orchestrator_diff_node.js` (nœud Orchestrateur, source), 
`workflows/Agent_ZIP_Analyzer_V2.3.json`, `workflows/Orchestrateur_V6.6.json`,
`docs/sprint5-differentiel.md` (conception + câblage).

**Principe** : en mode Améliorer, comparer `current_state` (Sprint 4) à la spec cible et ne générer que le **delta** en **incréments additifs**, chargés par le socle Sprint 3 sans toucher au code existant. **Décision : Approche A** (ré-émission de l'app complète = existant préservé + incréments) **avec section frontend**.

**Cœur déterministe** :
- `computeIncrements(current_state, target)` → diff (ajoutées/inchangées) + `migrations/NNN_add_<store>.sql` + `modules/NNN_<store>.routes.js` (CRUD scopé `user_id`, validé) + `frontend/ui_<store>.js` + plan d'injection `index.html`.
- `mergeFiles(existingFiles, result)` → **app complète** : passthrough existant + incréments backend + fichiers frontend + `index.html` **augmenté** (`<section>` avant `</main>`, `<script>` avant `</body>` ; jamais réécrit ; idempotent).
- **Section frontend CSP-safe** : `ui_<store>.js` autonome servi depuis `'self'` (0 handler inline), réutilise `escapeHtml`/`showFeedback` et la délégation `data-refresh`/`data-del` de `app.js` (non modifié) ; routes `/<store>` (conventions Backend).

**Câblage pipeline** :
- **ZIP Analyzer V2.3** : extrait **tous** les fichiers (central directory, STORED+DEFLATE) → `all_files` (+ dans `current_state`) ; `resources` complet = schema + **toutes migrations** + routes (dédup) → une table déjà créée par un incrément n'est plus vue comme neuve.
- **Orchestrateur V6.6** : nœud `Build Differential Output` entre `Agent Knowledge/Memory` et `Build Final Response` ; `Build Final Response` patché (si `differential`, `allFiles` = fusion). Garde-fous : création neuve ou changement non-additif → régénération complète (jamais détournée).

**Preuves (tests Node, `node --check` + assertions)** : CrimeStopper + spec ajoutant une ressource (avec champ numérique) → 1 migration `003_add_*` + 1 module `011_*` + 1 `ui_*.js` ; ressources existantes (dont une créée par migration) inchangées ; `mergeFiles` → app complète (10 existants + 3 nouveaux), `index.html` augmenté, sections existantes intactes ; `ui_*.js` sans inline, boutons `data-del`, numériques coercés `Number` ; STORED **et** DEFLATE extraits à 10/10 avec contenu intact ; garde-fous création/non-additif validés ; override `Build Final Response` (existant préservé, doc + `start.sh/.bat` conservés). Cas `noop` → régénération complète.

**À importer côté n8n** : `Agent_ZIP_Analyzer_V2.3.json` puis `Orchestrateur_V6.7.json` (re-sélectionner credentials Mistral après import).

**Limites v1 (assumées)** : additif seul (ajout de ressources). Non-additif (nouveau champ, renommage, refonte UI) → régénération complète LLM. Piste v2 : `ALTER TABLE` additif pour l'ajout de champ.

## Sprint 6 — Ressources partagées (multi-acteurs) — LIVRÉ ✅

**Motivation** : le socle isole par défaut chaque donnée par `user_id` (Sprint 2, anti-IDOR).
Or certaines specs décrivent un **inventaire/référentiel partagé** entre plusieurs acteurs
(ex. PharmaGarde : le gestionnaire alimente médicaments/stocks, le pharmacien les consulte pour
dispenser). L'isolation `user_id` casse alors le scénario (le pharmacien ne verrait pas les stocks
du gestionnaire). Sprint 6 introduit un **mode partagé par ressource**.

**Sémantique du mode partagé** (`shared: true` sur une ressource) :
- Schéma : colonne de **provenance `created_by INTEGER NOT NULL REFERENCES users(id)`** (au lieu de la colonne de cloisonnement `user_id`).
- Lecture (`GET` liste et `/:id`) : **non filtrée** → tous les acteurs authentifiés voient toutes les lignes.
- Écriture (`POST`) : enregistre `created_by = req.user.sub` (traçabilité, conforme §8.4 du doc).
- Suppression (`DELETE`) : **réservée au créateur** (`WHERE id = ? AND created_by = ?`) — conservateur pour des données de santé.
- Par **défaut `shared:false`** → comportement historique inchangé (isolation `user_id`). Rétro-compatible.

**Plumbing (bout en bout)** :
- **Normalizer V1.5** : nouvelle règle de prompt — le LLM pose `shared:true` pour un référentiel/inventaire/catalogue lu par tous les acteurs, `false` pour une donnée privée du créateur. Le champ transite automatiquement via `structured_context` (résources passées telles quelles).
- **Architect V5.2** : propage `shared` dans `stores[<res>].shared` + expose `artifacts.shared_resources`.
- **Backend V6.6** : `cfg.shared` (depuis `stores[].shared` **ou** l'override `shared_resources`) branche schéma + 4 routes.
- **Orchestrateur V6.7** : `Build Backend Payload` transmet `shared_resources` (override déterministe possible via webhook, ceinture + bretelles).
- **Sprint 5 (générateur d'incréments)** : les incréments sur une ressource partagée sont eux aussi partagés (migration `created_by`, `GET` non filtré, `DELETE` créateur-seul).

**Preuves (tests Node, `node --check` + assertions)** :
- Backend V6.6 partagé : `stocks` → `created_by`, `GET /stocks` sans filtre `user_id`, `POST` insère `created_by`, `DELETE` créateur-seul ; contrôle **rétro-compat** (sans flag → `user_id` partout) ; FK→404 et positivité conservés ; `server.js` valide.
- Chaîne **auto** Normalizer(shared) → Architect V5.2 → Backend V6.6 : les 3 tables PharmaGarde en `created_by`, **`GET /stocks` renvoie tous les stocks** (scénario 4.3 débloqué), sans override manuel.
- Générateur d'incréments : ressource partagée vs privée dans la même passe → branchement correct ; modules valides.

**À importer côté n8n** : `Agent_Spec_Normalizer_V1.5.json`, `Agent_Architect_V5.2.json`, `Agent_Backend_V6.6.json`, `Orchestrateur_V6.7.json` (re-sélectionner credentials Mistral après import).

**Note (correctifs d'évaluation)** : la revue du code Backend a confirmé deux points **déjà couverts** (contrairement à une première estimation) : la **vérification d'existence FK → 404** (contrôle `SELECT id FROM <parent> WHERE id=?` avant insert) et la **positivité des nombres → 400**. Restent non couverts (cross-entité/temporel) : cohérence `sous_ordonnance` dispensation/médicament, `date_peremption` future, `quantite_delivree <= stock disponible`, décrément de stock, 2FA.

## Sprint 7 — RBAC & comptes à rôles (admin / acteurs) — LIVRÉ ✅

**Motivation** : le socle avait un modèle utilisateur **plat** — table `users` sans colonne
`role`, `/api/register` ouvert, JWT `{sub, username}`, un seul `authMiddleware` sur toutes les
routes. Impossible donc de créer un **admin** vs un **utilisateur simple**, ni d'appliquer la
matrice acteur × point d'accès (PharmaGarde §3.1). Sprint 7 introduit le RBAC, **opt-in** et
**rétro-compatible** (sans rôles → comportement historique inchangé).

**Ce qui est généré quand des rôles sont fournis** :
- `users.role TEXT NOT NULL DEFAULT '<1er rôle>'`.
- **1er compte inscrit = `admin`** (bootstrap déterministe) ; inscriptions suivantes = rôle par défaut.
- `role` embarqué dans le **JWT** ; `/api/me` renvoie le rôle.
- middleware **`requireRole(...)`** (403 si rôle non autorisé, 401 si non authentifié).
- **`GET /api/users`** et **`POST /api/users`** réservés à `admin` (créer un compte + rôle, rôle validé contre `ALLOWED_ROLES = ['admin', ...acteurs]`).
- **autorisation par route** depuis la matrice de permissions : `requireRole('admin', ...rôles autorisés)` injecté sur chaque point d'accès listé ; `admin` a toujours accès ; route absente de la matrice = tout utilisateur authentifié.

**Plumbing (bout en bout)** :
- **Normalizer V1.6** : règles de prompt — extraire `actors` (rôles internes, pas des ressources) et `permissions` (matrice `{ "METHODE /chemin": [rôles] }`) ; transitent via `structured_context` (cap relevé à 8000).
- **Architect V5.3** : propage `artifacts.roles` (= actors) et `artifacts.permissions`.
- **Backend V6.7** : `cfg`/intake lisent `roles`/`permissions` (depuis artifacts **ou** override webhook) et génèrent tout le RBAC ci-dessus.
- **Orchestrateur V6.8** : `Build Backend Payload` transmet `roles`/`permissions` (override déterministe via webhook possible).

**Preuves (tests Node, `node --check` + assertions + runtime)** :
- Backend V6.7 (PharmaGarde) : colonne `role`, 1er compte admin, JWT+role, `requireRole` défini, `ALLOWED_ROLES=['admin','pharmacien','gestionnaire']`, endpoints `/api/users` admin, `/api/me` renvoie role ; **matrice** appliquée (`POST /medicaments`→admin+gestionnaire, `POST /dispensations`→admin+pharmacien, `GET`→lecture partagée) ; `server.js` valide.
- **Rétro-compat** : sans rôles → aucune colonne `role`, aucun `requireRole`, aucun `/api/users`, JWT inchangé.
- Chaîne **auto** Normalizer(actors+permissions) → Architect V5.3 → Backend V6.7 : la matrice `server.js` est générée **sans override manuel**.
- **Runtime** : la `requireRole` générée renvoie `next()` pour le rôle autorisé, **403** pour un rôle non autorisé, **401** sans session, et `admin` passe partout.

**À importer côté n8n** : `Agent_Spec_Normalizer_V1.6.json`, `Agent_Architect_V5.3.json`, `Agent_Backend_V6.7.json`, `Orchestrateur_V6.8.json` (re-sélectionner credentials Mistral après import). Ces versions incluent aussi Sprint 5 (différentiel) et Sprint 6 (partagé).

**Limites restantes après Sprint 7** : **2FA** (§8.2) ; règles métier **cross-entité/temporelles** (cohérence `sous_ordonnance` dispensation↔médicament, `date_peremption` future, `quantite_delivree ≤ stock`, décrément de stock). Prochaine cible logique : moteur de **règles métier déterministes** (bornes, comparaisons de dates, contrôles de cohérence inter-ressources) piloté par `business_rules`.

## Robustesse — specs longues (jusqu'à ~500 Ko et au-delà)

**Problème** : le nœud `Sanitize Input` faisait `throw` dès 8000 caractères → toute spec
un peu longue (PharmaGarde ~20 Ko) crashait le pipeline (réponse vide), quel que soit le
format d'entrée. De plus le Normalizer ne montrait que 5000 chars à l'IA.

**Correctifs livrés** :
- `Sanitize Input` (Orchestrateur V6.9) : plus de `throw`. Plafond anti-DoS relevé à **2 Mo**,
  au-delà **troncature explicite** (flag `spec_truncated` + `security_flags`). L'anti-injection
  tourne sur le texte complet.
- Caps LLM relevés : Normalizer **5000 → 40000**, Architect **2000 → 24000**.
- **Compacteur déterministe** (`workflows/_spec_compactor.js`, intégré au Normalizer V1.8,
  nœud `Build Mistral Payload`) : au-delà de ~38 Ko, distille la spec aux **lignes utiles**
  (titres, tables, `champ: type`, `VERBE /route`, matrice de permissions, règles, acteurs) et
  **jette le bruit** (juridique, glossaire, références, prose de justification, en-têtes/pieds
  de PDF répétés). Aucun appel LLM supplémentaire (pas de coût, pas de rate-limit).

**Pourquoi le compactage plutôt que le chunking** : la fenêtre de contexte du LLM (codestral
~32k tokens ≈ 120 Ko) interdit d'envoyer 500 Ko en une passe. Le chunking multiplierait les
appels LLM (coût + latence + rate-limit Mistral). Le compactage réduit en un seul passage
déterministe, et **améliore la qualité** (l'IA se concentre sur l'essentiel).

**Preuves (tests Node)** : spec synthétique de **500 Ko** → compactée < 40 Ko, ressources /
champs / routes / acteurs / règles **tous conservés**, juridique + glossaire + en-têtes répétés
**jetés** ; payload envoyé à Mistral **propre** (aucun champ parasite) ; **spec normale (< 38 Ko)
passée intacte** (compacteur inactif) ; Sanitize laisse passer 560 Ko sans troncature.

**À importer** : `Orchestrateur_V6.9.json`, `Agent_Spec_Normalizer_V1.8.json`,
`Agent_Architect_V5.4.json` (+ panneau `index.html`).
