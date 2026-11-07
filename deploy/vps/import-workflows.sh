#!/usr/bin/env bash
# Import + activation des 22 workflows Forge dans le n8n du VPS (conteneur forge-n8n).
# À lancer depuis /root/infra/forge-ia :  bash deploy/vps/import-workflows.sh
set -euo pipefail

CT="forge-n8n"
DIR="$(cd "$(dirname "$0")/workflows" && pwd)"

echo "== Copie des workflows dans $CT =="
docker exec "$CT" sh -c 'rm -rf /tmp/wf && mkdir -p /tmp/wf'
for f in "$DIR"/*.json; do
  docker cp "$f" "$CT":/tmp/wf/"$(basename "$f")"
done

echo "== Import (tous les JSON du dossier) =="
docker exec "$CT" n8n import:workflow --separate --input=/tmp/wf

echo "== Activation de tous les workflows =="
docker exec "$CT" n8n list:workflow 2>/dev/null | while IFS='|' read -r id name; do
  id="$(echo "$id" | tr -d ' ')"
  [ -n "$id" ] && docker exec "$CT" n8n update:workflow --id="$id" --active=true >/dev/null 2>&1 && echo "  activé: $name"
done

echo "== Redémarrage de n8n (enregistre les webhooks actifs) =="
docker restart "$CT" >/dev/null
sleep 8
echo "== Workflows actifs =="
docker exec "$CT" n8n list:workflow --active=true 2>/dev/null | wc -l
echo "Terminé."
