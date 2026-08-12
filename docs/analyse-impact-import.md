# Analyse d'impact — import groupé des agents (session en cours)

Analyse « senior » avant d'importer d'un coup tous les agents modifiés. Objectif :
garantir qu'aucun **contrat inter-agents** n'est cassé et qu'aucun agent non modifié
ne doit l'être.

## 1. Agents à importer (dernières versions)

| Ordre | Agent | Version | Chemin webhook | Rôle du changement |
|---|---|---|---|---|
| 1 | **Agent Spec Linter** | **V1.4** | `spec-linter` | règles advisory (ne bloque plus /clients, MAX_6, accents) |
| 2 | **Agent Spec Normalizer** | **V1.12** | `spec-normalizer` | extraction prose : bornes/unités/défauts + requis/optionnel ; **fix** : la liste d'enum `parmi : a, b, c` s'arrête à la frontière de champ (plus d'absorption des champs suivants séparés par virgules) |
| 3 | **Agent Backend** | **V6.23** | `developer` | 4 points + optionnels + Tier 2 + fixes SAST/Secrets + déploiement + garde-fou SAST amélioration ; **SECURITY.md complété** (atteste Tier 2, RBAC, partage, uploads, déploiement) |
| 4 | **Agent Frontend** | **V6.19** | `frontend` | N-N UI, optionnels, afficher/masquer mdp, Mon compte |
| 5 | **Agent QA** | **V5.7** | `agent-qa` | strictement advisory (ne bloque plus) |
| 6 | **Orchestrateur** | **V6.16** | (webhook `pipeline`) | transmet `improve_mode` au linter (corps HTTP) |

_(Agent Tests L0 V1.1 : déjà livré plus tôt ; réimporter seulement s'il n'est pas déjà en place.)_
_(Agent SAST **V5.4** : déjà en place sur l'instance — **aucun import**. La règle SQLI-001 y est déjà restreinte aux entrées `req.*`, donc pas de faux positif sur les concaténations déterministes.)_

**Vérification faite** : les 6 chemins webhook des nouveaux agents sont **identiques** à ceux appelés par l'orchestrateur → l'orchestrateur les retrouve sans reconfiguration.

## 2. Impact inter-agents (ce que j'ai changé × qui le consomme)

| Agent modifié | Sortie modifiée | Consommateurs | Verdict |
|---|---|---|---|
| Backend V6.23 | `files[]` (+ Dockerfile/compose/nginx/DEPLOY.md, **SECURITY.md complété**), `data_model`, `stores` | SAST, Secrets, SCA, DAST, Tests L0, QA, Code Review, Frontend (via orch.), Documentation, ZIP, Build Final Response | ✅ **compatible** : seule la génération de `SECURITY.md` change (texte statique d'attestation, aucune ligne de code exécutable → **0 règle SAST/Secrets déclenchée** ; vérifié) ; forme de `data_model` inchangée ; fichiers de déploiement propres ; Tests L0 ne cible que `server.js`/`package.json`/`index.html` |
| Frontend V6.19 | `_app_js`, `_login_html`, `html/css` | ZIP, Build Final Response | ✅ fichiers front autonomes, aucun agent aval ne les re-parse |
| Normalizer V1.12 | `data_model` enrichi `{type:'number', min, max, unit, default}` + `required_fields` | **Architect** → Backend → Frontend | ✅ **vérifié** : l'Architect fait `Object.assign({id,created_at}, res.fields)` → les objets enrichis sont **préservés par référence** ; `classifyField` (Backend + Frontend) les honore |
| QA V5.7 | `status` (jamais `FAIL`) | Go/No-Go | ✅ Go/No-Go ne fait REWORK que sur `QA=FAIL` → plus de REWORK QA ; `WARN`/`PASS` déjà gérés |
| Spec Linter V1.4 | `errors[]` (moins d'erreurs) | orchestrateur `IF LINTER PASS?` | ✅ forme inchangée, juste moins de blocages |
| Orchestrateur V6.16 | corps HTTP du linter | interne | ✅ webhooks stables |

## 3. Agents NON impactés — aucune action

- **Architect V5.5** : *inchangé*. C'est lui qui propage l'enrichissement du Normalizer, et il le fait déjà (`Object.assign`). **Ne pas modifier.**
- **SAST V5.4 / SCA V5.1 / Secrets V5.1 / DAST V1.4** : déjà en place, scannent les fichiers backend. Le `SECURITY.md` complété est du texte statique (aucune ligne exécutable) → 0 règle déclenchée ; les fichiers de déploiement sont propres ; les endpoints Tier 2 sont sûrs (requêtes paramétrées, bcrypt, révocation). Aucun changement.
- **Code Review V5.0** : LLM advisory. Aucun changement.
- **Documentation V5.5** : n'itère pas les types de champs → insensible aux champs-objets. Aucun changement.
- **Go/No-Go V1.1** : gère `WARN`/`PASS` de QA. Aucun changement.
- **Monitoring / Cost / Runtime Feedback / Knowledge / Version Manager / ZIP Analyzer / DevOps-Deploy** : hors du périmètre de mes changements de contrat.

## 4. Couplages

- **Aucun couplage bloquant** : chaque agent peut être importé indépendamment.
- Pour la fonctionnalité **complète** (amélioration en place + enrichissement + Tier 2 + déploiement + sécurité de l'amélioration), importer les **6**.
- L'**amélioration en place** exige spécifiquement **Orchestrateur V6.16** (corps `improve_mode`) **+** un Spec Linter ≥ V1.3 (bypass présent ; V1.4 recommandé).

## 5. Procédure d'import (n8n)

Pour **chaque** agent :
1. Importer le nouveau JSON.
2. **Désactiver l'ancienne version** du même agent (sinon **deux workflows actifs sur le même chemin webhook** → conflit).
3. **Activer** la nouvelle version.
4. **Re-sélectionner la credential Mistral** sur les nœuds LLM — nécessaire pour : **Backend** (amélioration LLM), **Frontend** (amélioration LLM), **Normalizer** (LLM), **QA** (LLM). _(Le Linter, Tests L0 et l'Orchestrateur n'ont pas de credential Mistral directe.)_

Ordre conseillé : les **agents d'abord**, l'**orchestrateur en dernier**. Comme les webhooks sont stables, l'ordre n'est pas critique, mais c'est plus propre.

## 6. Hors n8n (VPS)

- `frontend-forge-ia/public/index.html` → **UI v6.19** (champ + modale lisibles) : `docker cp` (statique, sans restart).
- `frontend-forge-ia/server.js` → ZIP robuste (V3) : `docker cp` **+ `docker restart forge-panel`**.

## Conclusion

Import **sans risque de régression inter-agents** : tous les changements sont soit internes à un agent, soit des extensions d'une forme déjà gérée (champs-objets présents depuis les enums V1.10), soit des fichiers scannés propres. Aucun agent non listé ne doit être modifié.
