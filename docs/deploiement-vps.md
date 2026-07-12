# Déploiement sur le VPS — panneau ForgeIA + Semgrep

Objectif de cette session VPS :
1. **Migrer le panneau ForgeIA** sur le VPS (à côté de n8n) → règle le bouton Déployer.
2. **Installer le microservice Semgrep** (vraie SAST) → dernier point de S-A.
3. **Câbler l'agent SAST** sur Semgrep (fait après, quand le service répond).

Tout tourne en Docker, comme n8n. Les commandes sont à lancer **sur le VPS** (SSH).

---

## 0. Pré-requis (à vérifier une fois)

```bash
docker --version            # Docker présent
docker compose version      # plugin compose présent
docker ps                   # voir n8n / deploy(4001) / extracteur(3002) qui tournent
```

Récupère le code du dépôt sur le VPS (branche de travail) :

```bash
# si le dépôt n'est pas encore sur le VPS :
git clone <URL_DU_DEPOT> forge-ia && cd forge-ia
git checkout claude/forge-ia-system-twbfql

# s'il y est déjà :
cd forge-ia && git fetch origin && git checkout claude/forge-ia-system-twbfql && git pull
```

---

## 1. Lancer le panneau + Semgrep (une commande)

Depuis la racine du dépôt (là où se trouve `docker-compose.forge.yml`) :

```bash
docker compose -f docker-compose.forge.yml up -d --build
```

Ça construit et démarre **deux conteneurs** :
- `forge-panel` → le panneau, sur le port **3100**
- `forge-semgrep` → le microservice Semgrep, sur le port **8010**

Vérifie qu'ils tournent :

```bash
docker ps --format "table {{.Names}}\t{{.Ports}}\t{{.Status}}"
```

---

## 2. Vérifier chaque service

**Panneau :**
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3100        # attendu : 200
```
Puis dans un navigateur : **http://167.86.93.31:3100** (ouvre le port 3100 au pare-feu si besoin, voir §5).

**Semgrep :**
```bash
curl -s http://localhost:8010/health                                   # {"status":"ok","engine":"semgrep"}

# scan de démonstration : un code volontairement vulnérable (injection SQL)
curl -s -X POST http://localhost:8010/scan -H "Content-Type: application/json" -d '{
  "task_id":"demo",
  "files":[{"path":"server.js","content":"app.get(\"/x\",(req,res)=>{db.exec(\"SELECT * FROM t WHERE n=\"+req.query.q);});"}]
}' | head -40
```
Le premier scan télécharge les règles (quelques secondes). Tu dois voir un `status:"FAIL"` ou `WARN` avec des `critical_issues`/`warnings`.

---

## 3. Le bouton Déployer est maintenant réglé

Le panneau tourne désormais **sur le VPS**, avec `DEPLOY_URL=http://host.docker.internal:4001` (déjà mis dans le compose) → il joint le service de déploiement local. Plus de page Replit.

Teste : ouvre `http://167.86.93.31:3100`, génère une app, clique **Déployer**.
- Si ça marche → ✅.
- Si erreur, le panneau v5.2.1 affiche le détail — envoie-le-moi.

> Note : on n'utilise plus le panneau Replit. C'est celui du VPS (port 3100) qui fait foi désormais.

---

## 4. Câbler l'agent SAST sur Semgrep

Une fois §2 validé (Semgrep répond), **dis-le-moi** : je te livre l'agent **SAST** avec un nœud HTTP qui appelle
`http://host.docker.internal:8010/scan` (même schéma que l'extracteur PDF `:3002`) et fusionne les résultats Semgrep
avec le SAST déterministe. Tu ré-importeras juste cet agent.

*(On procède dans cet ordre pour te livrer un agent déjà testé contre un service qui répond, plutôt qu'à l'aveugle.)*

---

## 5. Pare-feu / ports

Pour accéder au panneau depuis ton navigateur, le port **3100** doit être ouvert. Semgrep (**8010**) n'a
**pas** besoin d'être exposé publiquement (n8n l'appelle en interne via `host.docker.internal`).

```bash
# exemple ufw
sudo ufw allow 3100/tcp
sudo ufw status
```

Si le VPS a un pare-feu cloud (Contabo/Hetzner…), ouvre aussi le 3100 dans leur console.

---

## Commandes utiles

```bash
docker compose -f docker-compose.forge.yml logs -f forge-panel     # logs panneau
docker compose -f docker-compose.forge.yml logs -f semgrep-scanner # logs semgrep
docker compose -f docker-compose.forge.yml restart forge-panel     # redémarrer le panneau
docker compose -f docker-compose.forge.yml up -d --build           # rebuild après un git pull
docker compose -f docker-compose.forge.yml down                    # tout arrêter
```

### Mettre à jour après une nouvelle version
```bash
git pull
docker compose -f docker-compose.forge.yml up -d --build
```
