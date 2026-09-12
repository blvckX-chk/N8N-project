# État du système Forge IA

> Instantané de l'architecture **livrée et active**. Sert de référence pour la rédaction
> (chap. 2 architecture, chap. 3 implémentation) et pour l'exploitation.

Forge IA est un pipeline multi-agents (n8n) qui transforme un **cahier des charges**
(texte, PDF ou DOCX) en une **application Node.js / Express / SQLite sécurisée**,
dockerisée, **déployée** et **testée dynamiquement**.

---

## 1. Pipeline de génération (cœur)

- **Entrées acceptées** : Texte, **PDF**, **DOCX** — les trois opérationnels.
- **22 agents** orchestrés par l'**Orchestrateur V6.17** (webhook `pipeline`).
- **Extraction PDF/DOCX** : microservice dédié (`pdf-parse` + `mammoth`), **isolé de n8n**
  (les bindings natifs faisaient planter le moteur d'exécution de n8n).
- **Socle d'exécution durci** : n8n **1.123.77** (exécution interne), appels inter-agents
  en réseau **interne** (`localhost`), nœuds HTTP en version compatible.

**Séquence réelle** : Spec Linter → Spec Normalizer → (ZIP Analyzer si « améliorer ») →
Version Manager → Architect (LLM) → Backend → Frontend → Tests L0 →
[SAST · Code Review · QA] → [SCA · Secrets · DAST] → Go/No-Go → DevOps →
Monitoring → [Cost · Runtime] → Documentation → Knowledge/Memory.

---

## 2. Couche mémoire / RAG (couche 4) — *actif*

- **Service mémoire vectoriel** : stockage SQLite + recherche par **similarité cosinus**,
  persistant, remplaçable par Qdrant sans toucher aux agents.
- **Agent Knowledge/Memory V2.0** : calcule les **embeddings (Mistral)** et effectue
  store/search ; secrets via variables d'environnement de n8n (jamais dans le code).
- **Écriture** : l'Orchestrateur mémorise la **spec de chaque run**.
- **Lecture** : l'**Architect V5.6** interroge la mémoire (top-k, seuil de similarité)
  et injecte le contexte pertinent dans son prompt — **best-effort, non bloquant**.

*Vérifié de bout en bout* : écriture (`entry_id` créé) et lecture (résultats pertinents).

---

## 3. Boucle de remédiation — *actif* (interne au Backend)

- Nœud **« Security Remediation (L0) »** : après génération, **auto-vérifie** le code
  contre l'esprit des règles SAST déterministes et applique **uniquement des correctifs
  additifs sûrs** (helmet/CSP, rate-limit, PORT dynamique, `/health`), **≤ 3 passes**,
  jamais de réécriture de logique métier.
- Expose un **`remediation_report`** (passes, trouvées/corrigées, convergence).
- Choix d'architecture : portée **dans le Backend** (et non dans l'orchestrateur) pour
  éviter le recâblage fragile du flux de contrôle — même résultat, testable, sans risque.

*Vérifié* : sur un code non conforme, ajoute le durcissement manquant et **converge** ;
sur un code déjà conforme, **0 correctif** (idempotent).

---

## 4. Déploiement réel — *actif*

- **Service de déploiement/hébergement** (PaaS-lite) appelé par le panel :
  écrit les fichiers, `npm install`, lance l'application sur un **port alloué**, renvoie
  une **URL vivante**. Sert aussi le **frontend** de l'app (service statique injecté si
  le backend ne le fait pas).
- **API** : `POST /deploy` · `POST /improve` · `GET /apps` · `GET /apps/:name/files` ·
  `DELETE /apps/:name` · `GET /apps/:name/scan`.
- **Persistance** : les apps déployées et leur base survivent au redémarrage du service.

---

## 5. Test dynamique réel — *actif* (fin des métriques simulées)

Au déploiement, l'application **réellement lancée** est sondée :

- **DAST réel** : présence des en-têtes de sécurité (nosniff, CSP/anti-clickjacking,
  absence de `X-Powered-By`), **contrôle d'accès** (routes protégées → 401 attendu),
  **injection SQL** sur l'authentification (test de bypass), **limitation de débit**
  (rafale → 429), **fuite de trace** sur erreur → **statut + score + findings**.
- **Monitoring réel** : santé (`/health`), **latence** mesurée, **uptime**.
- **Coût/Performance réel** : temps de réponse, taille de charge.

Exposé via `GET /apps/:name/scan` et **affiché dans le panel** après déploiement.

> Conséquence pour la rédaction : le DAST n'est plus statique — conformément à l'état de
> l'art, le **test dynamique s'exécute contre l'instance déployée**. Le pipeline conserve
> ses **pré-vérifications statiques** (SAST, Secrets, SCA, Tests L0).

---

## 6. Interface (panel) — *actif*

- Génération (Texte/PDF/DOCX), suivi des agents, visionneur de fichiers, historique
  versionné, mode **Améliorer**, **déploiement en un clic** avec affichage du **scan
  dynamique**, liste des apps déployées, **nommage** assisté.

---

## Cartographie des services

| Service | Rôle |
|---|---|
| n8n | Orchestrateur + 22 agents |
| Panel | Interface SaaS |
| Extracteur | Extraction PDF/DOCX |
| Mémoire | Stockage vectoriel (RAG) |
| Déploiement | Déploiement + hébergement + scan dynamique |
| Semgrep | SAST complémentaire (posture *advisory*) |

---

## Nature des agents (déterministe vs LLM)

- **LLM** : Architect (spécification + abuse cases), Backend & Frontend *en mode
  amélioration uniquement*, QA, Documentation (Groq). Le **code n'est jamais écrit par un
  LLM** en génération initiale — invariant de conception.
- **Déterministes** : Backend & Frontend (génération), SAST, SCA (source **OSV.dev**),
  Secrets, Code Review (heuristiques OWASP), Tests L0, Go/No-Go, Version Manager, etc.

## Go/No-Go (décision)

- **STOP** (bloquant) dès qu'un agent remonte un finding **critique**
  (Secrets, SAST, DAST, SCA).
- **REWORK** (correction demandée) sur seuils de score/couverture.
- **CONTINUE** sinon. Produit un **score de risque composite**.

---

## Sécurité des applications générées (synthèse)

Authentification **JWT en cookie HttpOnly** + **bcrypt**, durcissement « Tier 2 »
(verrouillage de compte, révocation de session par `token_version`, changement de mot de
passe), **helmet/CSP**, **requêtes SQL paramétrées**, validation d'entrées, journal
d'audit, conteneur **non-root**, base isolée en volume. Attesté par un `SECURITY.md`
généré (mappage OWASP Top 10 / ASVS) **et** confirmé par le **scan dynamique** au
déploiement.

---

## Points ouverts (perspectives)

- **Validation externe** des sorties par des services officiels (crédibilité — voir
  pistes d'évaluation).
- **Détection de stack polyglotte** dans l'analyse ZIP (au-delà de Node).
- **Documentation d'API** (OpenAPI/Swagger) en complément du README.
- **Cloisonnement d'exécution** renforcé (idéalement instance dédiée) : le service de
  déploiement exécute du code généré ; l'isolation réelle est le conteneur.
