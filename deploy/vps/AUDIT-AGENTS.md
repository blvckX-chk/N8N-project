# Audit des 22 agents Forge IA — rapport maître

Audit en lecture seule des workflows `deploy/vps/workflows/`. Objectif : rendre
le pipeline irréprochable (fonctionnement + fiabilité des verdicts).

Priorités : 🔴 **Bloquant** (fausse un verdict / casse l'exécution) · 🟠 **Important**
(masque un échec / dégrade la fiabilité) · 🟡 **Mineur** (hygiène / dette).

> Contexte : les corrections du jour (clé Tchavi complète, `response_format`
> retiré, body **RAW**, modèle **`claude-sonnet-5`** non-raisonnant) traitent
> déjà les bugs #1, #2 et #3 (modèle à raisonnement) sur les 6 agents LLM.
> Ce rapport liste ce qu'il **reste** à corriger.

---

## 🔴 P0 — Bloquants

| # | Agent | Problème | Correction |
|---|---|---|---|
| 1 | **QA** | `QA Fallback` renvoie `verdict:PASS` + scores `100/100/100` quand le LLM échoue → **certifie du code non audité comme parfait** (le commentaire dit « WARN » mais le code renvoie PASS). Go/No-Go le laisse passer. | `verdict:WARN`/`ERROR`, scores `null`, Go/No-Go traite ce cas comme non-concluant. |
| 2 | **SCA** | Sévérité lue sur `/v1/querybatch` qui ne la renvoie **jamais** → toutes les CVE deviennent « medium » → aucun `critical` → **le SCA ne bloque jamais** un déploiement. | Récupérer la sévérité via `/v1/query` (par paquet) ou `/v1/vulns/{id}`. |
| 3 | **SAST + SCA** | Appels `httpRequest` en body objet brut (non-RAW) → Semgrep **mort en silence** (erreur avalée), OSV **casse le workflow**. Même bug que les agents LLM (déjà corrigé côté LLM). | Passer en RAW : `contentType:raw` + `rawContentType:application/json` + `body:={{ JSON.stringify(...) }}` + `timeout` + `onError`. |
| 4 | **Spec_Normalizer** | `Parse Input` détecte les ressources via `RESOURCE_KEYWORDS`/`ACTOR_WORDS` **figés** (trajet, annonce, officine, voyageur…) → **aveugle à tout nouveau domaine** (cause racine du « domaine bibliothèque absent »). | Détection générique (routes explicites + tables Markdown + heuristiques de nom), retirer les mots-clés d'anciens projets. |
| 5 | **Cost_Performance** / **Runtime_Feedback** | Décalage de champs `Validate`↔`Logic` (`service_url` vs `service.url` ; `incident_type` vs `incident.type`) → **seuils jamais déclenchés** (Cost) / **toujours ESCALATE-FAIL** (Runtime). Logique morte. | Lire les champs imbriqués réels (`input.service.url`, `input.incident.type`…). |
| 6 | **Backend** | Mode `llm_improve` : payload `claude-sonnet-5` construit mais **aucun nœud `httpRequest`** ne l'envoie → branche **morte** (le générateur reçoit un payload au lieu des specs). | Brancher un vrai `httpRequest` RAW (+ merge, comme Frontend) **ou** supprimer la branche morte. |

---

## 🟠 P1 — Importants

| Agent | Problème | Correction |
|---|---|---|
| **Tous les agents LLM** | Failover « 2 clés » **illusoire** : nœud primaire ET retry utilisent la **même** `$env.TCHAVI_API_KEY` (malgré « IF Groq Key1/Key2 »). | Pointer le retry sur une 2ᵉ clé `TCHAVI_API_KEY_2` (ou supprimer le faux failover). |
| **Normalizer / Architect / Frontend** | Fallback **silencieux** (repli déterministe/console.log) masque l'échec LLM. | Aligner sur **Documentation** (déclare `errors[]`/flag de dégradation). |
| **Secrets_Scanning** | Regex « clé AWS » = n'importe quelle chaîne base64 de 40 car. → **faux positifs bloquants**. | Contextualiser (préfixe `aws_secret`) ou rétrograder en warning. |
| **Spec_Linter** | `\b` écrit avec un seul backslash dans le JSON → caractère **backspace (0x08)** au lieu de « frontière de mot » → faux signal permanent. | Écrire `\\b` dans le JSON. |
| **Cost / Monitoring / DAST / DevOps** | Métriques et déploiements **simulés** présentés comme réels. ⚠️ **Sensible pour la soutenance**. | Marquer `simulated:true` en sortie, ou brancher de vraies mesures/exécutions. |
| **Orchestrateur** | OCR image : `gpt-4o-mini` + format image OpenAI envoyés à une passerelle Claude → **échoue**, et `throw` → **crash du pipeline** sur tout input image. | Modèle vision servi par Tchavi + format Claude + try/catch dégradant. |
| **SAST** | Code vide / `valid:false` → **PASS** (pas de chemin ERROR). | Router vers `ERROR` explicite. |
| **Go_NoGo** | Score absent traité comme **100** → un agent non exécuté passe pour parfait. | Distinguer « absent » de « 100 » ; exiger la présence des rapports. |
| **Knowledge_Memory** / **ZIP_Analyzer** | Dégradation (clé Mistral absente / extraction partielle) non propagée en sortie → PASS trompeur. | Exposer `degraded`/`extraction_ok` (rester non bloquant). |

---

## 🟡 P2 — Hygiène / dette

- **`_version` manquant** en sortie de 7 agents (ZIP, Version_Manager, Cost, Monitoring, Runtime, Memory, DevOps) + branches d'erreur SCA/Secrets ; **drift** de version (Normalizer 1.12/1.13, Architect 5.6/5.5, Backend 6.26/6.22/5.8, QA 5.6/5.7).
- **Nommage legacy** : nœuds/variables « Mistral »/« Groq » partout alors que tout pointe vers `tchavi.com`.
- **Placeholders d'anciens projets** : `monprojet.com` (DAST/Cost/Monitoring/Runtime), enums covoiturage + GPS (Version_Manager), `_DOMAINS` (Orchestrateur), heuristiques emoji domaine (Frontend), few-shot pharmacie/covoiturage (Normalizer/Documentation).
- **Vocabulaire de statut incohérent** : `WARN` (SAST/SCA/Secrets) vs `NEEDSIMPROVEMENT` (DAST/Cost/Monitoring).
- **Timeouts/retry HTTP incohérents** : présents sur Architect (300 s) et Frontend (60 s) seulement.
- **Logique morte** : Go_NoGo (`rework_target` constant, filtre `|| true`), code `error_code` jamais posé (Cost/Monitoring/Memory), double routage Switch+Format (Cost/Monitoring).

---

## Le bon gabarit à répliquer : `Agent_Documentation_V5.5`

Seul agent au **bon modèle** (`llama-3.3-70b`, non-raisonnant, max_tokens 8000)
**et** au **fallback honnête** (déclare `errors:[{stage:'...', message:'...'}]`
au lieu de masquer l'échec). À prendre comme référence pour aligner les autres.

---

## Ordre de correction recommandé

1. **Valider d'abord que le pipeline génère le domaine** (Test bibliothèque avec `claude-sonnet-5`).
2. **P0** : QA fallback (sécurité) → RAW SAST/SCA → SCA sévérité → Normalizer détection générique → mismatches Cost/Runtime → Backend branche morte.
3. **P1** : fallbacks honnêtes, failover 2 clés, Secrets regex, Spec_Linter `\b`, OCR Orchestrateur, flags `simulated`.
4. **P2** : `_version`, nommage, placeholders, vocabulaire.

Chaque correction = bump du `_version` de l'agent + entrée au changelog du RUNBOOK.
