# Forge IA — Extracteur PDF / DOCX

Microservice d'extraction de texte, **appelé par l'Orchestrateur n8n** pour les
entrées PDF et DOCX. Il est **volontairement externe à n8n** : `pdf-parse`
(pdf.js) et `mammoth` manipulent des binaires qui font planter le task runner de
n8n. En l'isolant ici, n8n reste stable et l'extraction est remplaçable.

## Pourquoi `pdf-parse@1.1.1`
La v2.x de `pdf-parse` tire `@napi-rs/canvas` (binding natif) → crash
`DOMMatrix` / `Failed to load native binding`. La **1.1.1** n'a pas cette
dépendance : extraction stable, sans canvas.

## Contrat (imposé par les nœuds « Extract PDF/DOCX Text »)

| Route | Corps | Réponse |
|---|---|---|
| `POST /extract` | `{ pdf_base64, filename? }` | `{ text, success, num_pages? }` |
| `POST /extract-docx` | `{ docx_base64, filename? }` | `{ text, success }` |
| `GET /health` | — | `{ status: 'OK', version, started_at }` |

Le service répond **toujours 200** avec un drapeau `success` : en cas d'échec
d'extraction, `text` est vide et le pipeline dégrade proprement (STOP « spec trop
courte ») au lieu de casser toute l'exécution.

## Déploiement (VPS)

```bash
cd pdf-extractor
docker compose -f docker-compose.extractor.yml up -d --build
curl -s http://localhost:3002/health
```

Publie le port **3002** sur l'hôte → joignable par `n8n_local` via
`http://host.docker.internal:3002` (résout vers la passerelle Docker `172.17.0.1`).

## Test rapide

```bash
B64=$(base64 -w0 mon_cahier_des_charges.pdf)
curl -s -X POST http://localhost:3002/extract \
  -H 'Content-Type: application/json' \
  -d "{\"pdf_base64\":\"$B64\",\"filename\":\"specs.pdf\"}" | head -c 400
```
