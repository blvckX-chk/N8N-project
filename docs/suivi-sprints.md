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

## Sprint 2 — Authentification (livré)

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
