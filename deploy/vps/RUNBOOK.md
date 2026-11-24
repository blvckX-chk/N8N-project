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

---

## 9. Changelog des agents (traçabilité des `_version`)

Chaque sortie d'agent porte un champ `_version`. Il est **incrémenté à chaque
changement fonctionnel** de l'agent, pour retracer quelle build a produit une sortie.

| Agent | Version | Date | Changement |
|---|---|---|---|
| Spec_Normalizer | 1.19 | 2026-11-15 | Body LLM = objet `{{ $json }}` (fin du body vide/double-encodé) ; extraction générique d'entités « Nom : champ, champ » (fallback plus jamais aveugle au domaine) |
| Architect | 5.10 | 2026-11-15 | Body `{{ $json }}` ; le validateur d'entrée préserve `structured_context`/`specs_context` (le domaine atteint enfin l'Architect) |
| Backend | 6.30 | 2026-11-15 | Validate Specs préserve stores/data_model/rôles ; branche `llm_improve` morte neutralisée honnêtement ; `package.json name` = slug(project_name) |
| Frontend | 6.25 | 2026-11-15 | Payload LLM inline passé en objet (plus de JSON.stringify) |
| QA | 5.11 | 2026-11-15 | Body `{{ $json }}` ; fallback honnête WARN (plus de faux PASS/100) |
| Documentation | 5.7 | 2026-11-15 | Body `{{ $json }}` (reste sur llama-3.3-70b) |
| SCA | 5.3 | 2026-11-15 | Sévérité réelle par CVE via `/v1/vulns/{id}` (GHSA) ; critical/high bloquent (FAIL) |
| Cost / Runtime | 1.1 | 2026-11-15 | Adaptateurs d'entrée (service{}/incident{}/thresholds imbriqués) — seuils et matrice d'incident opérationnels |
| Revue des agents | — | 2026-11-24 | Banc d'essai `deploy/vps/bench/` (22 workflows exécutés tels qu'importés). Corrections : QA 5.15 (LLM en panne ou illisible ⇒ ERROR, plus jamais 100), Documentation 5.12 (README de secours, WARN), Runtime 1.2 (« aucun incident » ≠ escalade), DAST 1.6 / SAST 5.9 (analyse impossible ⇒ ERROR), Monitoring/Cost/Knowledge (entrée invalide ⇒ ERROR), Linter 1.6 / Tests L0 1.2 / Normalizer 1.22 / Frontend 6.31 (plus de plantage), Backend 6.36 (spec absente ⇒ ERROR), DevOps 1.2 (simulation déclarée), replis sur 11 Switch, délais sur 24 appels HTTP, versions alignées sur 21 agents, Orchestrateur 6.27 |
| Backend | 6.35 | 2026-11-24 | **Phase B · B3** : historique des statuts (`/<r>/:id/historique`) et notifications (`/api/notifications`, relais `NOTIFY_WEBHOOK_URL`) ; pièces jointes réelles (fichier personnel `/api/uploads/<id>` ou https, lisible par qui voit l'enregistrement) ; échéances de la spec (« libéré 48 h après livraison », seulement si payé) ; paiement : simulation par défaut, FedaPay sandbox/live (`PAYMENT_PROVIDER`, `FEDAPAY_SECRET_KEY`), webhook revérifié auprès de l'API ; libellés et genres corrects dans les messages ; `.env.example` complet |
| Frontend | 6.30 | 2026-11-24 | Cloche de notifications, bouton « Joindre un fichier », bouton « Payer », monogramme au lieu d'émoji, colonnes cohérentes (en-tête = lignes) avec champs calculés, libellés humains et valeurs formatées (30 000 FCFA, Payé, Mobile money) |
| Documentation | 5.11 | 2026-11-24 | Variables de configuration = `.env.example` réel (paiement, notifications) |
| QA | 5.14 | 2026-11-24 | Code assemblé par fichier et par priorité (fin de la troncature à 40 000 caractères) ; chaque anomalie doit citer un extrait exact du code, sinon elle est écartée ; couverture **mesurée** sur les tests générés ; score calculé à partir des anomalies prouvées |
| Code Review | 5.1 | 2026-11-24 | Analyse par fichier sans troncature, fichier attribué ; règle XSS limitée aux `innerHTML` alimentés par une donnée non échappée |
| SAST / Secrets / SCA | — | 2026-11-24 | Frontend inclus dans SAST et Secrets ; plus de `package.json` fictif pour la SCA (erreur honnête) |
| DAST / Go/No-Go | 1.5 / 1.6 | 2026-11-24 | Méthode « statique » transmise et affichée dans le panel |
| Documentation | 5.10 | 2026-11-24 | README de projet professionnel (fonctionnalités, démarrage, configuration, règles métier, API, modèle, sécurité, tests, limites) ; plus aucune mention de pipeline ni de prompts |
| Backend | 6.34 | 2026-11-24 | En-tête « Règles métier » rédigé ; test d'accès sur chaque ressource ; jeux de données réalistes ; SECURITY.md/DEPLOY.md accentués et exacts (uploads en BLOB, ressources partagées) |
| Frontend | 6.29 | 2026-11-24 | Pied de page « © année Projet » |
| Orchestrateur | 6.26 | 2026-11-24 | Nœuds « Finition livrable » : retire étiquettes internes, séparateurs, émojis, mentions de l'outil ; accents et typographie dans commentaires, messages et titres de tests |
| Backend | 6.33 | 2026-11-24 | **Phase B · B2** : règles de la spec typées (bornes, plafond « au plus N par X » hors statuts clos, unicité « un seul X par Y », champ calculé = produit de 2 champs du parent, règles non reconnues listées « à traiter à la main ») ; admin automatique si statuts réservés (1er compte) avec vue complète ; `?vue=recues|envoyees` ; `_peut_<statut>` et `_mine` par ligne ; `GET /<r>/:id` systématique ; 404 JSON ; dates d'événement non passées ; montants FCFA entiers ; `GET /api/utilisateurs` ; rôles et règles transmis en sortie |
| Frontend | 6.28 | 2026-11-24 | Badge + menu de changement de statut pour le tiers habilité, filtre « Reçues / Envoyées », actions Éditer/Supprimer masquées sur les lignes d'autrui, choix d'un utilisateur pour `cible_id`, libellés de listes lisibles |
| Orchestrateur | 6.24 | 2026-11-24 | `business_rules` transmises au Backend ; rôles du Backend transmis au Frontend ; REWORK/STOP livrent README (règles, points à reprendre, API) + `start.sh`/`start.bat` |
| Backend | 6.32 | 2026-11-23 | **Phase B · B1 — sémantique métier déduite du modèle** : catalogue partagé (ressource racine référencée, sans données personnelles), acteurs `<personne>_id` imposés = utilisateur connecté, personne héritée du parent, statuts protégés (tiers / admin) + `PATCH /<ressource>/:id/<statut>`, visibilité pour le propriétaire du parent, capacité restante (409), notes d'avis 1..5, accès au parent vérifié ; règles listées en tête de `server.js` ; test métier généré ; `stores[*].server_fields` transmis au Frontend |
| Frontend | 6.27 | 2026-11-23 | Les champs imposés par le serveur (`server_fields`) ne sont plus proposés dans les formulaires |
| Go/No-Go | 1.5 | 2026-11-23 | QA < 50/100 ⇒ REWORK ; QA 50–69, SAST/SCA en WARN ⇒ réserves visibles (`advisories`), le panel affiche « Validé avec réserves » |
| Knowledge Memory | 2.1 | 2026-11-23 | Embeddings : Mistral si la clé fonctionne, sinon vecteur lexical local 512 dims (fin du « 401 » non bloquant) |
| Panel | 7.2 | 2026-11-23 | ZIP conforme : CRC-32, date, noms UTF-8, `start.sh` exécutable, anti zip-slip (avant : CRC 0 ⇒ archive refusée par Windows/7-Zip) |
| Orchestrateur | 6.23 | 2026-11-16 | 13 nœuds Code « Body — X » construisent le corps de chaque appel d'agent (`$('…')` ne se résout pas dans un body HTTP) ; corps HTTP `={{ JSON.stringify($json) }}` ; réponse REWORK/STOP avec matrice, risque et code partiel |
| Go/No-Go | 1.4 | 2026-11-16 | Analyse en ERROR ⇒ REWORK (score ignoré) ; SAST/SCA/Secrets FAIL ⇒ REWORK ; risque ≥ 50 si analyse échouée, ≥ 90 si STOP ; champs `reliable`, `failed_analyses` |
| SAST | 5.8 | 2026-11-16 | Nœud « Semgrep Payload » : le scan Semgrep reçoit enfin les fichiers (objet `{{ $json }}`) |
| Normalizer / Architect / QA / Documentation | 1.21 / 5.12 / 5.13 / 5.9 | 2026-11-16 | Nœud « Fallback Payload » avant le retry Groq (corps non vide, `max_tokens` borné par `FALLBACK_LLM_MAX_TOKENS`, 8000 par défaut) |
| Orchestrateur | 6.19 | 2026-11-15 | Les appels d'agents envoient l'objet complet du nœud « Build X Payload » ; ré-injection des invariants en improve si app existante vide |

### Rappels techniques (appels LLM Tchavi)
- **Clé** : `TCHAVI_API_KEY` doit être la clé COMPLÈTE (~40 car.), pas un placeholder tronqué.
- **Pas de `response_format`** (paramètre OpenAI-only, rejeté par Claude via la passerelle).
- **Body en mode RAW = L'OBJET, jamais `JSON.stringify`** : n8n (1.123.77) sérialise
  déjà la valeur du body. `body: ={{ $json }}` (ou l'objet préparé) → JSON correct ;
  une chaîne pré-sérialisée → double-encodage ; `$('Node').first()` dans un champ
  body → expression non résolue → **body de 0 octet** → 500 trompeur côté API.
  Règles complètes : § 0 de `AUDIT-AGENTS.md` (R1-R7). Le mode « Using JSON »
  reste rejeté même avec une chaîne JSON valide.

### Choix du modèle LLM (important)
`claude-sonnet-5-5` est un modèle à **raisonnement** : via Tchavi il consomme
~90% du budget en `reasoning_tokens` → sorties JSON tronquées, erreurs **500**
sur gros prompts, coût élevé. **Utiliser `claude-sonnet-5` (sans le .5)** :
qualité Claude, **non-raisonnant** (`reasoning_tokens: 0`, `finish_reason: stop`),
JSON complet, ~3 crédits/appel. Alternative moins chère : `gpt-4o` (~1,5 crédit).
Agents concernés : Spec_Normalizer, Architect, Backend, Frontend, QA.
