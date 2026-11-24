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

Versions courantes (voir aussi REVUE-AGENTS.md) : Orchestrateur **V6.27**, Normalizer **V1.21**, Architect **V5.12**,
Backend **V6.35**, Frontend **V6.30**, QA **V5.14**, Documentation **V5.11**, SAST **V5.8**,
Go/No-Go **V1.6**, Knowledge Memory **V2.1**, panel **7.2**.

## 2. Listes P0 / P1 / P2 et roadmap « L99 »

Toutes traitées ou reprises : voir **`FEUILLE-DE-ROUTE.md`** (statuts vérifiés, priorités, ordre conseillé)
et **`REVUE-AGENTS.md`** (revue agent par agent du 24 novembre, banc d'essai).

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

### Contrôles (24 nov.) — agents d'audit remis d'aplomb
| Agent | Défaut constaté | Correction |
|---|---|---|
| QA | code tronqué à 40 000 caractères (moitié de server.js) ; couverture inventée par le LLM | assemblage par fichier ; preuve exacte exigée par anomalie (sinon écartée) ; couverture mesurée sur les tests |
| Code Review | tronqué à 50 000 caractères ; fichier « ? » ; règle innerHTML qui aurait tout classé XSS | analyse par fichier sans troncature ; règle XSS sur données non échappées |
| SAST / Secrets | frontend non analysé | backend + frontend |
| SCA | package.json fictif en cas d'échec | erreur honnête (R5) |
| DAST | présenté comme dynamique | étiqueté « statique » jusqu'au panel |

### Livrables sans traces de fabrication
Nœuds « Finition livrable » de l'Orchestrateur + générateurs corrigés à la source : plus d'étiquettes de lots
(P5, B1, Tier 2…), de séparateurs décoratifs, d'émojis, de mention de l'outil ni de messages sans accents ;
en-tête « Règles métier » rédigé ; README de projet ; SECURITY.md exact ; jeux de test réalistes.

### B3 (fait, Backend 6.35 · Frontend 6.30)
| Point | Preuve (navigateur + HTTP, DiaspoKoli) |
|---|---|
| Notifications + historique | « Nouvelle réservation sur votre trajet n°1 » dans la cloche ; historique de statut 200 pour les parties, 404 pour un tiers |
| Pièces jointes | photo du colis téléversée et jointe ; visible du voyageur (200), invisible d'un intrus (404) ; fichier d'autrui ou `javascript:` refusés (400) |
| Échéances | « libérés 48 h après livraison » reconnu ; escrow passé à « libéré » après 49 h simulées, uniquement si payé |
| Paiement | « Payer » → 30 000 FCFA payé (simulation) ; double paiement 409 ; FedaPay : création + jeton de paiement + webhook revérifié (à valider avec une clé sandbox) |

Non-régression : DiaspoKoli 16/16, bibliothèque 12/12, tâches 12/12 ; SAST, Code Review, Secrets 100 ; 0 erreur console.

### B4 (prochain lot)
1. Exécuter les tests générés (`npm test`) et un vrai DAST sur l'instance déployée par le service de déploiement ; remonter les résultats au Go/No-Go.
2. Valider FedaPay avec une clé sandbox réelle ; ajouter Kkiapay / Mobile Money si besoin.
3. Rôles exclusifs déclarés dans la spec (voyageur / expéditeur) et écrans dédiés.
4. Règles « avant » (annulation gratuite 24 h avant le départ) et remboursements.
5. Pile TypeScript (NestJS) et Python (FastAPI) annoncées dans le panel.
