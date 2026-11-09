# Runbook de déploiement — Forge IA (VPS)

Procédure complète de déploiement et d'exploitation de Forge IA sur un VPS,
derrière Caddy + Cloudflare. Rédigé à partir du déploiement réel (toutes les
embûches rencontrées sont documentées dans « Dépannage »).

- **Panel** : `https://forge.<domaine>` → conteneur `forge-panel`
- **Apps générées** : `https://app.<domaine>` → `forge-deploy` (proxy « app active »)
- **Réseau privé** : `forge_net` (aucun port applicatif publié ; seul Caddy expose 80/443)

---

## 1. Architecture

```
Navigateur ──HTTPS──> Cloudflare (proxied) ──TLS──> Caddy (videos-gen-caddy-1)
                                                       │  tls internal (Full mode)
                                   ┌───────────────────┼─────────────────────┐
                                   │                   │                     │
                         forge.<domaine>       app.<domaine>         kora.<domaine>
                                   │                   │                     │
                            forge-panel:3000   forge-deploy:4099        web:80
                                   │                   │
                         (réseau forge_net)   (proxy -> app active 4100-4140)
```

Services sur `forge_net` (définis dans `docker-compose.vps.yml`) :
`forge-n8n` (orchestrateur + 22 agents), `forge-memory`, `forge-extractor`,
`forge-semgrep`, `forge-deploy`, `forge-panel`.

---

## 2. Pré-requis

- Docker + Docker Compose sur le VPS.
- Un domaine géré par **Cloudflare** (proxied / nuage orange), mode SSL/TLS = **Full**.
- Deux enregistrements DNS **proxied** vers l'IP du VPS :
  - `forge.<domaine>` (panel)
  - `app.<domaine>` (apps déployées)
- Le réseau `forge_net` doit exister (créé par `docker-compose.vps.yml`).

### 2.1 Fichier `.env.vps` (NE JAMAIS committer)

```bash
# Générer les secrets : openssl rand -hex 24
N8N_ENCRYPTION_KEY=   # STABLE — ne plus jamais changer après le 1er démarrage
TCHAVI_API_KEY=       # clé passerelle Tchavi (sk-tch-...)
MISTRAL_API_KEY=      # optionnel : uniquement pour les embeddings RAG
GROQ_API_KEY=         # optionnel (non utilisé par défaut)
MEMORY_TOKEN=
FORGE_USER=forge
FORGE_PASS=           # mot de passe du panel
FORGE_DOMAIN=forge.<domaine>
FORGE_APP_DOMAIN=app.<domaine>
```

⚠️ `--env-file` refuse les lignes de commentaire et les espaces : **que des `CLÉ=VALEUR`**.
Vérifier le nombre de clés : `grep -c '=' .env.vps`.

---

## 3. Déploiement initial

```bash
cd /root/infra/forge-ia
git pull origin <branche>

# Construire et démarrer tous les services
docker compose -f docker-compose.vps.yml --env-file .env.vps up -d --build

# Importer + activer les 22 workflows
bash deploy/vps/import-workflows.sh
```

Le script `import-workflows.sh` : copie les JSON → `n8n import:workflow` →
active chaque workflow → **redémarre n8n** (obligatoire pour enregistrer les
webhooks de production, dont `/webhook/pipeline`).

### 3.1 Re-déploiement des workflows (mise à jour)

Les workflows ont des **IDs stables** → ré-importer **met à jour** (pas de doublon).
Simplement :
```bash
git pull origin <branche>
bash deploy/vps/import-workflows.sh
```

> **Wipe du volume n8n** : nécessaire UNIQUEMENT si un ancien import a créé des
> workflows à IDs aléatoires (doublons). Sinon, ne pas vider le volume.
> ```bash
> docker compose -f docker-compose.vps.yml --env-file .env.vps stop forge-n8n
> docker compose -f docker-compose.vps.yml --env-file .env.vps rm -f forge-n8n
> docker volume rm forge-ia_forge_n8n_data   # confirmer le nom : docker volume ls | grep n8n
> docker compose -f docker-compose.vps.yml --env-file .env.vps up -d forge-n8n
> # ATTENDRE ~10s puis réimporter
> bash deploy/vps/import-workflows.sh
> ```

---

## 4. Caddy (reverse-proxy TLS)

Caddy tourne dans un **autre projet** (ici `videos-gen`, conteneur
`videos-gen-caddy-1`). Le Caddyfile est **monté** depuis
`/root/infra/kora/videos-gen/Caddyfile`.

### 4.1 Blocs à ajouter au Caddyfile

```caddyfile
forge.<domaine> {
    encode zstd gzip
    request_body {
        max_size 50MB
    }
    tls internal
    reverse_proxy forge-panel:3000
}

app.<domaine> {
    encode zstd gzip
    request_body {
        max_size 50MB
    }
    tls internal
    reverse_proxy forge-deploy:4099
}
```

⚠️ **PIÈGES CADDY (vécus)** :
1. **`request_body` DOIT être multi-ligne.** `request_body { max_size 50MB }`
   sur une seule ligne → `Unexpected next token after '{' on same line` → Caddy
   **crash-loop silencieux** (lit la config, sort en code 1, sans erreur dans
   `docker logs --tail`). Diagnostiquer avec :
   `docker run --rm -e DOMAIN=<kora> -v .../Caddyfile:/etc/caddy/Caddyfile:ro caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`
2. **Ne PAS éditer le Caddyfile avec `sed -i` ou un éditeur qui réécrit le
   fichier** : un bind-mount de **fichier unique** s'attache à l'inode. `sed -i`
   change l'inode → le conteneur reste collé à l'ANCIEN contenu. Éditer avec
   `cat > fichier <<'EOF' … EOF` (tronque sur place, préserve l'inode) **ou**
   recréer le conteneur après édition.
3. **Pas de doublon de bloc** (`ambiguous site definition`). `{$DOMAIN}` se
   résout aussi en un domaine — ne pas le redéfinir explicitement.

### 4.2 Attacher Caddy au réseau `forge_net` (permanent)

Sinon : Caddy sert le TLS mais renvoie **502** (upstreams `forge-panel`/`forge-deploy`
injoignables). Rendre permanent dans le compose de Caddy (`docker-compose.prod.yml`) :

```yaml
  caddy:
    # ... (reste inchangé)
    networks:
      - default
      - forge_net

networks:
  forge_net:
    external: true
```

Puis : `docker compose up -d --force-recreate caddy`.

Vérifier : `docker inspect videos-gen-caddy-1 --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'`
→ doit afficher `forge_net videos-gen_default`.

### 4.3 Recharger Caddy après modif du Caddyfile

```bash
docker exec videos-gen-caddy-1 caddy validate --config /etc/caddy/Caddyfile
docker exec videos-gen-caddy-1 caddy reload --config /etc/caddy/Caddyfile
```

---

## 5. Moteurs LLM (switch-llm.sh)

```bash
bash deploy/vps/switch-llm.sh tchavi    # QUALITÉ — Claude Sonnet 5.5 (défaut)
bash deploy/vps/switch-llm.sh fast      # RAPIDE — gpt-4o-mini (démo live courte)
bash deploy/vps/switch-llm.sh mistral   # SECOURS — Mistral (si plus de crédit Tchavi)
bash deploy/vps/import-workflows.sh     # TOUJOURS réimporter après un switch
```

- Agents critiques (Architecte, Backend, Frontend, QA) : `claude-sonnet-5-5`.
- Léger (Spec_Normalizer, OCR) : `gpt-4o-mini`. Documentation : `llama-3.3-70b`.
- Embeddings RAG : `mistral-embed` (api.mistral.ai) — **jamais** touché par le
  switch (Tchavi n'expose pas d'embeddings ; RAG en mode dégradé si Mistral absent).

---

## 6. Stratégie soutenance

- **Pré-générer** la veille une app complexe sur **Sonnet** (preuve de qualité :
  ZIP + app déployée + scores de sécurité).
- Pour un **run live court** (< 3 min) : profil `fast` (`switch-llm.sh fast`).
- Une génération Sonnet complète peut dépasser 7 min → le panel attend **20 min**
  (ne jamais dépendre d'un run live long pendant la soutenance).

---

## 7. Dépannage

| Symptôme | Cause | Remède |
|---|---|---|
| Panel : `webhook "POST pipeline" is not registered` (404) | Orchestrateur inactif ou n8n non redémarré | `bash deploy/vps/import-workflows.sh` (ré-importe + active + redémarre) |
| Panel : « délai dépassé » mais ZIP généré | Sonnet > 7 min | Déjà corrigé (timeouts 20 min). Sinon profil `fast`. |
| `app.<domaine>` → **525** (SSL handshake failed) | Caddy ne sert pas ce domaine (bloc non chargé / reload échoué) | Vérifier nom conteneur Caddy, `validate`, `reload` |
| `app.<domaine>` → **502** | Caddy up mais upstream injoignable | Attacher Caddy à `forge_net` (§4.2) |
| Tous domaines → **521** | Caddy down (crash-loop) | Voir §4.1 piège 1 (`request_body` multi-ligne), `validate` |
| Caddy `Restarting (1)` sans erreur visible | Erreur d'adaptation avalée par `caddy run` | Lancer `caddy validate` (affiche l'erreur exacte) |
| `ambiguous site definition` | Bloc en double, ou `{$DOMAIN}` == domaine explicite | Dé-dupliquer le Caddyfile |
| App déployée : lien interne au lieu de `app.<domaine>` | App déployée avant l'ajout du proxy | Re-générer, ou `POST forge-deploy:4001/preview {"name":"..."}` |

### Commandes de diagnostic utiles
```bash
# Workflows actifs
docker exec forge-n8n n8n list:workflow --active=true
# Proxy preview actif ?
docker logs --tail 5 forge-deploy | grep 4099
# Logs n8n en direct pendant une génération
docker logs -f forge-n8n
# Tester les domaines
curl -s -o /dev/null -w "%{http_code}\n" https://forge.<domaine>
curl -s -o /dev/null -w "%{http_code}\n" https://app.<domaine>
```

---

## 8. Sécurité

- Aucun port applicatif publié (uniquement 80/443 via Caddy).
- Secrets uniquement dans `.env.vps` (gitignored) et lus par `$env` dans n8n.
- Cloudflare proxied → l'IP d'origine est masquée ; `tls internal` côté origine.
- **Durcissement SSH** (à faire en dernier, ordre anti-lockout) :
  1. Installer sa clé publique dans `~/.ssh/authorized_keys`.
  2. **Tester** une connexion par clé dans une 2e session.
  3. **Seulement ensuite** désactiver l'auth par mot de passe
     (`PasswordAuthentication no` dans `/etc/ssh/sshd_config`), puis
     `systemctl restart ssh`.
