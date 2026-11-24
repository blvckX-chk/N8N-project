# Audit Forge IA — rapport maître (mis à jour 15 nov. 2026)

Objectif : un pipeline **irréprochable** qui produit les meilleures apps possibles,
quel que soit le domaine et la plateforme cible (web d'abord, mobile/PWA ensuite).

---

## 0. Règles d'ingénierie n8n (apprises en débogage, à respecter PARTOUT)

Ces règles sortent de la traque du bug « domaine jamais généré » (capture des
octets au serveur témoin). Elles sont **non négociables** pour tout nœud futur :

| # | Règle | Pourquoi |
|---|---|---|
| R1 | Body httpRequest = **l'objet**, jamais `JSON.stringify(...)` | n8n sérialise déjà la valeur ; une chaîne pré-sérialisée est ré-encodée (double-encodage), un objet donne le bon JSON. |
| R2 | Dans un champ **body** d'httpRequest : **uniquement `$json`**. Toute référence `$('Nœud')` se construit dans un **nœud Code « Body — X »** placé juste avant l'appel | `$('Node').first()` ne se résout pas dans un body (0 octet, prouvé par capture) ; dans un nœud Code il fonctionne. Appels d'agents : `={{ JSON.stringify($json) }}` en raw (format lu par tous les agents) ; appels LLM/services : `={{ $json }}` (objet). |
| R3 | Un nœud « Validation / sanitize » doit **préserver** les champs pipeline | Deux validateurs (Architect, Backend) jetaient `structured_context` / `stores` : le domaine mourait en silence. Toujours lister explicitement les champs transmis. |
| R4 | L'appel d'un agent envoie **l'objet complet du nœud « Build X Payload »** | Les bodies qui re-construisaient un payload minimal depuis `Validate Input` jetaient le travail du Build node (cas Architect : seul {task_id, userRequest} partait). |
| R5 | Jamais de fallback qui **ment** (PASS/100 par défaut) | Un échec LLM doit produire WARN/ERROR + `errors[]`, et Go/No-Go doit le traiter comme non concluant. |
| R6 | Chaque agent émet `_version` ; le `name` du workflow porte la version | Traçabilité : on doit voir dans la liste n8n ET dans les sorties quelle version a tourné. Id top-level stable → mise à jour en place. |
| R7 | Modèles : `claude-sonnet-5` (non-raisonnant) pour le code, `llama-3.3-70b` pour la doc ; jamais `response_format` sur la passerelle Tchavi | `claude-sonnet-5-5` (raisonnant) brûle ~90 % du budget en reasoning_tokens ; `response_format` est rejeté pour les modèles Claude. |

## 1. Chaîne causale du « domaine jamais généré » (résolue)

1. ~~Clé Tchavi tronquée (placeholder 10 car.)~~ ✓
2. ~~`response_format` rejeté par Tchavi (6 agents)~~ ✓
3. ~~Modèle raisonnant (`-5-5`) → troncature~~ ✓ (→ `claude-sonnet-5`)
4. ~~Body httpRequest vide : expression `.first()` + `.replace(function)` cassant le parseur~~ ✓ (→ `{{ $json }}`, R1/R2)
5. ~~Architect : validateur d'entrée jetait `structured_context`~~ ✓ (R3)
6. ~~Backend : « Validate Specs » jetait les `stores` top-level~~ ✓ (R3)
7. ~~Orchestrateur : appels agents avec payload minimal (Architect : sans `structured_context`)~~ ✓ (R4, V6.18)
7b. ~~V6.18 utilisait `$('Build X Payload').first().json` **dans le body** : 13 appels d'agents partaient vides
   (Backend sans stores → tables users/uploads/audit_log ; QA/SCA/Secrets en ERROR, SAST en FAIL)
   et le Go/No-Go V1.3 validait quand même (scores 100 par défaut des rapports en erreur)~~ ✓
   (Orchestrateur V6.23 : 13 nœuds « Body — X » ; retries Groq et appel Semgrep idem ; Go/No-Go V1.4 :
   analyse en ERROR ⇒ REWORK, score ignoré, risque ≥ 50 ; panel 7.1 : jamais « Validé » si une analyse a échoué)
8. **Piège restant côté usage** : regénérer le même projet ⇒ **mode improve** ⇒ les
   invariants déterministes sont sautés ⇒ une v1.0 vide se propage à ses v1.0.x.
   → Après un fix de pipeline, TOUJOURS régénérer en **frais** (nouveau nom de projet),
   puis seulement itérer en improve.

Versions courantes : Orchestrateur **V6.24**, Normalizer **V1.21**, Architect **V5.12**,
Backend **V6.33**, Frontend **V6.28**, QA **V5.13**, Documentation **V5.9**, SAST **V5.8**,
Go/No-Go **V1.5**, Knowledge Memory **V2.1**, panel **7.2**.

## 2. 🔴 P0 restants (bloquants pour des verdicts fiables)

| # | Agent | Problème | Correction |
|---|---|---|---|
| 1 | **SCA** | Sévérité lue sur `/v1/querybatch` qui ne la renvoie jamais → tout devient « medium » → **ne bloque jamais**. | Résoudre la sévérité via `/v1/vulns/{id}` (ou table CVSS locale), seuil bloquant sur critical/high. |
| 2 | **Cost / Runtime** | Champs `Validate`↔`Logic` décalés (`service_url` vs `service.url`, `incident_type` vs `incident.type`) → seuils jamais déclenchés / toujours ESCALATE. | Lire les champs imbriqués réels. |
| 3 | **Backend** | Branche `llm_improve` morte (payload construit, jamais envoyé). | Brancher un httpRequest réel (règles R1/R2) ou supprimer la branche. |
| 4 | **Normalizer** | `RESOURCE_KEYWORDS`/`ACTOR_WORDS` figés (covoiturage, pharmacie…) dans le fallback déterministe → aveugle aux nouveaux domaines quand le LLM échoue. | Détection générique (tables Markdown, « Entités : », heuristiques) sans mots-clés projet. |
| 5 | **Mode improve** | Si l'app existante n'a pas de resources, l'improve les perd pour toujours (invariants sautés + Architect sans contexte). | En improve : si `existing_stores` vide **et** `structured_context` riche → ré-injecter les invariants du Normalizer. |
| 6 | **ZIP** | CRC=0 (zip streaming) → `unzip` râle partout ; `package.json name: "api-api"`. | Générer le zip avec CRC corrects ; `name` = slug du `project_name`. |

## 3. 🟠 P1 (fiabilité / honnêteté des sorties)

- Fallbacks silencieux (Normalizer/Architect/Frontend) → aligner sur le modèle Documentation (`errors[]`, flag `degraded`).
- Faux failover « 2 clés » (retry = même clé) → 2ᵉ clé `TCHAVI_API_KEY_2` ou simplifier.
- Nœuds Retry : `$('Build …').item.json` encore non validé en conditions réelles → vérifier, sinon `retryOnFail` natif.
- Secrets_Scanning : regex AWS = toute chaîne base64 de 40 car. → contextualiser.
- Spec_Linter : `\b` simple backslash = backspace → `\\b`.
- Orchestrateur OCR image : modèle/format incompatibles + `throw` → vision Tchavi + dégradation douce.
- SAST : code vide → PASS → router en ERROR.
- Go/No-Go : score absent ≠ 100 ; exiger la présence des rapports.
- Métriques simulées (Cost/Monitoring/DAST/DevOps) → `simulated: true` explicite (important pour la soutenance).

## 4. 🟡 P2 (hygiène)

`_version` manquants (7 agents), nommage « Mistral/Groq » → « LLM/Tchavi »,
placeholders d'anciens projets (monprojet.com, enums covoiturage, few-shots pharmacie),
vocabulaire de statut unifié (PASS/WARN/FAIL/ERROR partout), timeouts/retry homogènes.

## 5. Roadmap « L99 » — vers les meilleures générations possibles

**Phase A — Fiabilité (en cours)** : P0 ci-dessus + une génération fraîche de
référence (bibliothèque) qui sert de test de non-régression.

**Phase B — Qualité de génération**
- Normalizer : few-shots neutres multi-domaines, enums/`longtext`/dates typés, relations N-N.
- Architect : exploiter `business_rules` → contraintes SQL (CHECK, UNIQUE) + middlewares générés (ex. « max 3 emprunts » → garde applicative réelle).
- Backend : règles métier traduites en code (validations croisées, transitions d'état), pagination/tri/recherche systématiques, OpenAPI généré.
- Frontend : vues par ressource riches (listes filtrables, formulaires typés par champ, relations en `<select>` alimentés), i18n fr/en.
- QA : vrais tests exécutés (node --test dans le conteneur deploy) au lieu d'une revue statique seule.

**Phase C — Multi-plateforme**
- La PWA existante (manifest + sw.js) devient installable mobile de 1ʳᵉ classe : offline readcache, icônes adaptatives, écrans tactiles.
- Option de sortie « API seule » (backend headless) pour brancher Flutter/React Native.
- Cible additionnelle : export Capacitor (wrapper natif) comme artefact optionnel du DevOps.

**Phase D — Efficience**
- Profils de vitesse : `switch-llm.sh fast` (démo) vs qualité ; parallélisation des agents indépendants (SAST/SCA/Secrets déjà en parallèle — étendre à QA/Docs).
- Cache de normalisation (même spec → réutiliser structured_context, économie de crédits).
- Budget tokens par agent documenté + alerte crédits Tchavi dans le panneau.

**Phase E — Panneau Forge** (design skills : landing-page-design, design-direction-advisor,
graphic-design-fundamentals) : suivi réel par étape du pipeline (webhook de progression),
affichage des verdicts sécurité, noms d'app parlants, téléchargement + lien preview.

---

## Gabarit de référence
`Agent_Documentation` reste le modèle : bon modèle LLM, fallback honnête (`errors[]`).
Toute correction = bump `name` + `_version` + entrée au changelog du RUNBOOK.


## Phase B — qualité métier des applications générées

Constat (DiaspoKoli v1.0, 23 nov.) : domaine correct (6 tables) mais **CRUD isolé par utilisateur** —
une place de marché sans marché. Rejoué en exécution : un expéditeur ne voyait aucun trajet ;
`voyageur_id`/`expediteur_id` falsifiables ; réservation de 50 kg sur un trajet de 10 kg acceptée ;
le voyageur ne voyait pas les réservations sur son trajet ; KYC auto-validé (`statut: verifie`) ;
escrow auto-libéré ; transaction créée sur la réservation d'un autre ; note d'avis 999.

### B1 (fait, Backend V6.32) — règles déduites du modèle, jamais du LLM
| Règle | Déclencheur | Effet |
|---|---|---|
| Catalogue partagé | ressource racine référencée par une autre (ou avis/annonces/produits…), sans email/téléphone/adresse | lecture par tous, écriture par l'auteur (`created_by`) |
| Acteur | `<personne>_id` sans table dédiée (voyageur, expéditeur, auteur, utilisateur…) | valeur = utilisateur connecté, ignorée dans le corps, immuable |
| Personne héritée | même rôle que l'acteur du parent (vendeur_id d'une commande) | recopiée depuis le propriétaire du parent |
| Statut protégé | statut/état d'une ressource liée à un tiers (parent partagé en amont) ou sensible (KYC, transaction, paiement, litige) | valeur initiale imposée ; changement par le tiers (ou admin) via `PATCH /<r>/:id/<statut>` ; 403 sinon |
| Visibilité | enfant d'un parent partagé | visible par son auteur et par le propriétaire du parent (chaîne ≤ 2) |
| Accès au parent | création/modification d'un enfant | le parent doit être partagé ou appartenir à la chaîne de l'utilisateur |
| Capacité | 1 champ quantité (poids, quantité, places…) ↔ 1 champ capacité du parent (disponible, stock, capacité…) | 409 si dépassement du restant (hors statuts refusés/annulés) |
| Notes | `note/rating/etoiles` d'une ressource avis | bornée 1..5 (+ CHECK SQL) ; pas d'auto-évaluation |

Vérifié en exécution : DiaspoKoli 12/12 tests (dont test métier généré) + 15 scénarios manuels ;
non-régression bibliothèque 11/11 et app personnelle (statut libre pour le propriétaire) 11/11 ; SAST 100.

### B2 (fait, Backend 6.33 · Frontend 6.28 · Orchestrateur 6.24)
| Point | Réalisation | Preuve |
|---|---|---|
| Statut par le tiers | `_peut_<statut>` par ligne ; badge + menu dans la liste ; filtre « Reçues / Envoyées » (`?vue=`) | navigateur : le voyageur passe une réservation « en attente » → « acceptee », 0 erreur console |
| Rôle admin | activé seul si un statut est réservé à un admin (KYC, escrow) ; 1er compte = admin ; l'admin voit toutes les lignes concernées | admin valide un KYC (200), l'utilisatrice elle-même (403), test généré |
| REWORK livrable | README déterministe (points à reprendre, règles, API) + scripts de démarrage | rejeu du nœud Respond STOP |
| Socle | `GET /<r>/:id`, 404 JSON, date d'événement passée refusée, montants FCFA entiers | rejeu HTTP |
| Règles de la spec | bornes, plafond par entité (hors statuts clos), unicité, champ calculé ; non reconnues listées | DiaspoKoli : montant = 6 × 5 000 = 30 000 imposé ; 6e trajet refusé ; 35 kg refusé (≤ 30) ; bibliothèque : 4e emprunt refusé, accepté après un retour |

Non-régression : DiaspoKoli 14/14, bibliothèque 11/11, app personnelle 11/11, SAST 100, 149 nœuds compilés.

### B3 (prochain lot)
1. Paiement réel (sandbox Mobile Money / FedaPay / Kkiapay) derrière l'escrow ; libération conditionnée à la livraison confirmée.
2. Délais (« libéré 48 h après livraison », « annulation gratuite 24 h avant ») : règles temporelles et tâche planifiée.
3. Notifications (e-mail / WhatsApp) sur changement de statut ; historique des statuts.
4. Rôles métier exclusifs déclarés dans la spec (voyageur vs expéditeur) quand la spec l'exige.
5. Pièces jointes liées (photo du colis, document KYC) via `/api/uploads` au lieu d'URL libres.
