# Forge IA — Service de déploiement

Reconstruit (perdu sur le VPS, non versionné). Reçoit les fichiers d'une app
générée, l'installe, la lance et renvoie une **URL vivante**. Appelé par le panel
via `DEPLOY_URL=http://host.docker.internal:4001`.

## Contrat
| Route | Corps | Réponse |
|---|---|---|
| `POST /deploy` | `{ task_id, app_name?, files:[{path,content}] }` | `{ name, url, port, status }` |
| `POST /improve` | idem | idem (redéploie sous le même nom) |
| `GET /apps` | — | `[ {name, port, url, status, ...} ]` |
| `GET /apps/:name/files` | — | `[ {path, content} ]` |
| `DELETE /apps/:name` | — | `{ deleted }` |
| `GET /health` | — | `{ status:'OK', apps }` |

- API sur **4001**, apps hébergées sur **4100-4140** (publiés sur l'hôte).
- Persistance : volume `forge_deploy_apps` (`/data/apps` + `_state.json`) ; les
  apps sont **relancées au démarrage** du service.
- Retire le préfixe `// FILE: <path>` que le Backend ajoute (sinon `package.json` invalide).

## Déploiement
```bash
cd deploy-service
docker compose -f docker-compose.deploy.yml up -d --build
curl -s http://localhost:4001/health
```

## Sécurité
Ce service **exécute du code généré**. L'isolation réelle est le conteneur
(idéalement un VPS dédié — cf. cloisonnement des locataires). Anti-path-traversal
à l'écriture, ports bornés, timeouts, aucun appel shell.
