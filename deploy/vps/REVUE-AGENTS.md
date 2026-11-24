# Revue des agents Forge IA — 24 novembre 2026

Revue de chacun des 22 workflows : lecture du code, puis **exécution réelle** de chaque workflow
tel qu'il est importé dans n8n, avec le banc d'essai `deploy/vps/bench/` (voir « Méthode »).
Chaque agent est rejoué sur une entrée réelle (application DiaspoKoli générée), une entrée vide
et un corps illisible ; les agents à LLM le sont aussi avec un LLM en panne et un LLM qui répond
n'importe quoi.

## Synthèse

| Mesure | Avant la revue | Après |
|---|---|---|
| Plantages (pas de réponse ou exception) | 3 agents (Linter, Normalizer, Tests L0) + Frontend | 0 |
| Faux succès (PASS sur entrée vide, LLM en panne ou analyse impossible) | 9 agents | 0 |
| Switch sans sortie de repli (webhook muet si statut imprévu) | 11 | 0 |
| `_version` absent ou différent du nom du workflow | 15 agents | 0 |
| Appels HTTP sans délai d'attente | 24 nœuds | 0 |
| Résultats simulés non déclarés | DevOps | 0 (Cost, Monitoring, DAST, DevOps déclarés) |
| URL fictives (`monprojet.com`) | 7 nœuds | 0 |

Règle appliquée partout (R5) : **une analyse qui n'a pas pu s'exécuter n'est jamais un succès** ;
elle répond `ERROR` (ou `WARN` si un livrable de secours existe), et le Go/No-Go la traite comme telle.

## Agent par agent

Note : A = fiable en production · B = fiable, réserves mineures · C = simulé ou à compléter.

### Amont (compréhension de la spécification)

| Agent | Rôle | Constat | Correction | Reste | Note |
|---|---|---|---|---|---|
| **Spec Linter** 1.6 | Bloque une spec inexploitable avant toute dépense LLM | Plantait sur un corps illisible ; réponse sans `agent`/`status`/`_version` | Corps illisible → `FAIL` motivé ; champs standard | — | A |
| **Spec Normalizer** 1.22 | Spec libre → modèle structuré (ressources, champs, règles) | Une réponse LLM illisible donnait `normalized:false` sans ressources (la suite partait à vide) ; plantage sur corps illisible ; LLM sans délai | Réponse illisible → même repli déterministe que LLM en panne, marqué `degraded` ; `status` explicite ; délai 3 min | Spec vide acceptée si le LLM répond (le Linter la bloque en amont) | A |
| **Architect** 5.13 | Modèle → architecture (stores, endpoints) | Chemin déterministe sain (aucun appel LLM quand le contexte est riche) ; prompt LLM encore « auth: none, database: none » ; retry sans délai | Prompt aligné (JWT, SQLite) ; `status` explicite ; délai | Le chemin LLM ne produit pas `architecture.md` / `api_spec.json` (avertissement) | B |
| **Version Manager** 1.2 | Analyse une demande d'amélioration | Sortie sans version ni statut | Version et statut portés par la réponse | — | B |
| **ZIP Analyzer** 2.5 | Lit une app existante (mode amélioration) | Sortie sans version ni statut | Idem | Sans ZIP, répond PASS (n'est appelé qu'avec un ZIP) | B |

### Production du code

| Agent | Rôle | Constat | Correction | Reste | Note |
|---|---|---|---|---|---|
| **Backend** 6.36 | Génère serveur, base, tests (déterministe) | Entrée vide → application générique PASS 100 | Spécification invalide → `ERROR` ; version de l'app générée préservée | — | A |
| **Frontend** 6.31 | Génère l'interface (déterministe) | Exception non rattrapée sans `userRequest` (webhook en 500) ; entrée vide → PASS | Repli sur le nom du projet ; sans spécification → `ERROR` | Chemin « amélioration par LLM » non rejoué au banc | B |
| **Tests L0** 1.2 | Contrôle statique de déployabilité | Plantage sur corps illisible ; pas de champ `status` | Corps illisible → `FAIL` ; `status` standard | — | A |

### Contrôle et sécurité

| Agent | Rôle | Constat | Correction | Reste | Note |
|---|---|---|---|---|---|
| **Code Review** 5.2 | Règles OWASP par fichier | (déjà corrigé le 24 : troncature, fichier « ? », XSS) ; repli Switch absent | Repli sur la sortie `error` | — | A |
| **QA** 5.15 | Revue qualité par LLM, preuves exigées | **LLM en panne → 100/100 ; LLM illisible → PASS 100** ; versions 5.6 dans les sorties | Analyse non exécutée → `ERROR`, score nul, message explicite ; versions alignées | Délai LLM 3 min (borne de coût) | A |
| **SAST** 5.9 | Règles + Semgrep | Code absent → `FAIL` (« vulnérabilités ») au lieu d'analyse impossible | → `ERROR` | — | A |
| **SCA** 5.5 | CVE des dépendances (OSV) | Appel OSV sans délai | Délai 20 s | — | A |
| **Secrets** 5.3 | Secrets dans le code (backend + frontend) | Fuite détectée → FAIL 52, Go/No-Go STOP : conforme | Repli Switch | — | A |
| **DAST** 1.6 | Motifs OWASP sur `server.js` | Sans code → PASS 100 ; `ERROR` n'avait aucune sortie (webhook muet) | Sans code → `ERROR` ; repli Switch ; méthode « statique » affichée | Pas de test dynamique réel (B4) | C |
| **Go/No-Go** 1.7 | Décision CONTINUE / REWORK / STOP | Conforme sur tous les cas (sain → CONTINUE, analyse en erreur → REWORK, secret → STOP) | Repli Switch ; version | — | A |

### Exploitation (après décision)

| Agent | Rôle | Constat | Correction | Reste | Note |
|---|---|---|---|---|---|
| **DevOps** 1.2 | Prépare Dockerfile, CI, variables | Annonçait « Déploiement réussi » sans rien déployer ; CI `echo Deploy` | Déclaré `simulated`, résumé exact (configuration préparée, déploiement via le service du panel) | Vrai job CI (B4) | C |
| **Monitoring** 1.2 | Santé du service | Entrée vide → PASS 100 ; URL fictive | Validation → `ERROR` ; URL réelle (`PUBLIC_APP_URL`) | Simulé : brancher sur l'instance déployée (B4) | C |
| **Cost & Performance** 1.2 | Coût et performances | Idem | Idem | Simulé (B4) | C |
| **Runtime Feedback** 1.2 | Réaction aux incidents | **« Aucun incident » → FAIL / ESCALATE à chaque génération** ; entrée vide → PASS | Aucun incident → surveillance normale (PASS) ; validation → `ERROR` | Simulé (B4) | C |
| **Knowledge Memory** 2.2 | Mémoire vectorielle des générations | Entrée vide → PASS ; opération inconnue traitée comme une écriture | `operation` READ/WRITE exigée ; validation → `ERROR` | Vecteurs Mistral et locaux non comparables (réindexer si la clé revient) | B |
| **Documentation** 5.12 | README professionnel | LLM en panne → `FAIL` mais score 100 ; LLM illisible → **aucun README** | README de secours dans les deux cas, `WARN` 50, `degraded` ; message sans « clés Groq » | — | A |

### Orchestrateur 6.27

Délais d'attente sur les 22 appels d'agents (15 min) ; URL fictives remplacées par `PUBLIC_APP_URL`.
Reste : 6 appels envoient encore `=={{ JSON.stringify(...) }}` (préfixe « = » toléré par les agents
mais fragile) ; vocabulaire de statut encore hétérogène entre agents d'exploitation
(`HEALTHY`, `NEEDSIMPROVEMENT`…).

## Méthode : le banc d'essai

```bash
# 1. Décompresser une app générée (ZIP du panel) dans un dossier
# 2. Rejouer tous les agents (ou un seul)
node deploy/vps/bench/bench.js /chemin/vers/app
node deploy/vps/bench/bench.js /chemin/vers/app "QA"
```

`bench/n8nrun.js` exécute les workflows avec la sémantique de n8n (nœuds Code, If, Switch avec repli,
Merge, Wait, Respond ; `$json`, `$('Nœud')`, `$env`), les LLM et services externes étant simulés
(réponse valide, panne 503, réponse illisible). Résultat final de la revue : **68 exécutions, 0 plantage,
0 faux succès**. Le banc sert de test de non-régression avant chaque import.
