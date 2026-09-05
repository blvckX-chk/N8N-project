# Forge IA — Couche mémoire / RAG (microservice)

Mémoire à long terme du pipeline : **stockage vectoriel SQLite + recherche par
similarité cosinus**. L'accès est isolé derrière deux routes → le backend de
stockage est **remplaçable par Qdrant** sans toucher aux agents.

## Rôle dans l'architecture (couche 4)
- L'agent **Knowledge/Memory** (n8n) calcule les embeddings (Mistral `mistral-embed`,
  credential existante) et n'envoie ici que **vecteur + texte + métadonnées**.
- Ce service ne détient **aucune clé d'API** : il ne fait que stocker et classer.

## API
| Méthode | Route | Corps | Effet |
|---|---|---|---|
| GET | `/health` | — | statut + version |
| GET | `/stats` | — | volumétrie (total, par kind, par projet) |
| POST | `/store` | `{kind, project?, text, vector[], meta?}` | embed normalisé + insertion |
| POST | `/search` | `{vector[], k?, project?, kind?, min_score?}` | top-k cosinus (filtré) |
| DELETE | `/memory/:id` | — | purge ponctuelle |

## Sécurité
- Jeton partagé obligatoire en production : en-tête `X-Memory-Token` (env `MEMORY_TOKEN`),
  comparaison à temps constant.
- **Anti-secret** : refuse de stocker un texte ressemblant à une clé (AWS/OpenAI/Groq/PEM/JWT) → 422.
- Vecteurs normalisés (norme 1) → cosinus = produit scalaire ; dimensions incompatibles ignorées.

## Déploiement (VPS, comme les autres services)
```bash
docker build -t forge-memory .
docker run -d --name forge-memory -p 4002:4002 \
  -e MEMORY_TOKEN=<jeton-partagé-avec-n8n> \
  -v forge_memory_data:/data forge-memory
```
La base vit dans le volume `forge_memory_data` (`/data/memory.db`).
