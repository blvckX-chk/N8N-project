# Feuille de route Forge IA — version consolidée (24 novembre 2026)

Fusion de toutes les listes précédentes : P0/P1/P2 de l'audit, roadmap « L99 » (phases A à E),
lots B1 à B4, et reste de la revue des agents (`REVUE-AGENTS.md`). Chaque ligne a un statut vérifié.

## 1. Bilan de ce qui est fait

| Domaine | Livré | Preuve |
|---|---|---|
| **A · Fiabilité du pipeline** | Transport des appels d'agents (nœuds « Body »), failover LLM gratuit, Go/No-Go honnête, ZIP conforme (CRC), noms de paquets, mode amélioration protégé, SCA à sévérité réelle, adaptateurs Cost/Runtime, Normalizer générique | Générations DiaspoKoli réelles + banc d'essai |
| **Revue des 22 agents** | 0 plantage, 0 faux succès, versions alignées, délais, replis de Switch, simulations déclarées | `REVUE-AGENTS.md`, 68 exécutions au banc |
| **Contrôles fiables** | QA sur le code complet avec preuves et couverture mesurée ; Code Review par fichier ; SAST/Secrets sur le frontend | Anomalies inventées écartées au rejeu |
| **B1 · Sémantique métier** | Catalogue partagé, acteurs imposés, statuts protégés, visibilité du tiers, capacité, notes bornées | 15 scénarios rejoués |
| **B2 · Interactions** | Statut changé par le tiers, vues reçues/envoyées, admin automatique, règles de la spec typées, REWORK livrable | Parcours navigateur |
| **B3 · Suivi et paiement** | Notifications, historique, pièces jointes, échéances, paiement simulé et FedaPay | Parcours navigateur complet |
| **Livrables sans traces de fabrication** | Finition automatique, README professionnel, SECURITY.md exact, libellés humains | 0 étiquette, 0 émoji, 0 mention de l'outil |
| **E · Panel** | Refonte v7 clair/sombre, suivi réel par étape, verdicts honnêtes, crédits Tchavi | Panel 7.2 |

## 2. Reste à faire, par priorité

### Priorité 1 — Preuves en conditions réelles (prochain lot)
| # | Tâche | Origine | Effort |
|---|---|---|---|
| 1.1 | **Exécuter `npm test` dans le conteneur du service de déploiement** et remonter le résultat au Go/No-Go (la QA devient prouvée par exécution) | B4, roadmap B | M |
| 1.2 | **DAST dynamique** sur l'instance déployée (en-têtes, authentification, IDOR, injection sur les vraies routes) au lieu des motifs statiques | B4, revue (DAST note C) | M |
| 1.3 | Brancher **Monitoring / Cost / Runtime** sur l'instance déployée (`/health`, temps de réponse, mémoire) : fin des données simulées | revue (notes C) | M |
| 1.4 | **Valider FedaPay en sandbox** avec ta clé ; ajouter Kkiapay ou Mobile Money si nécessaire | B4 | S |
| 1.5 | Rejouer une génération DiaspoKoli **réelle** après import et la comparer au banc | revue | S |

### Priorité 2 — Qualité des applications générées
| # | Tâche | Origine | Effort |
|---|---|---|---|
| 2.1 | Rôles exclusifs déclarés dans la spec (voyageur / expéditeur) et écrans dédiés | B4 | M |
| 2.2 | Règles « avant » (annulation gratuite 24 h avant le départ) et remboursements | B4 | M |
| 2.3 | **OpenAPI généré** (`openapi.json` + page de documentation interactive) | roadmap B, revue Architect | S |
| 2.4 | i18n français / anglais des interfaces générées | roadmap B | M |
| 2.5 | Vrai job CI dans le dépôt généré (tests, construction d'image, déploiement) à la place de `echo Deploy` | revue DevOps | S |

### Priorité 3 — Robustesse et hygiène du pipeline
| # | Tâche | Origine | Effort |
|---|---|---|---|
| 3.1 | Vocabulaire de statut unique PASS / WARN / FAIL / ERROR (+ champ métier : HEALTHY, REWORK…) | P2 audit, revue | S |
| 3.2 | Passer les 6 appels `=={{ JSON.stringify(...) }}` au format « Body » | revue Orchestrateur | S |
| 3.3 | Renommer les nœuds historiques « Mistral / Groq » en « LLM principal / secours » (références `$()` comprises) | P2 audit | S |
| 3.4 | Banc d'essai **de bout en bout** : Orchestrateur complet avec agents simulés | revue | M |
| 3.5 | Intégration continue GitHub : banc + tests des générateurs à chaque push | revue | S |
| 3.6 | Mémoire : réindexer si la clé d'embeddings revient (vecteurs Mistral et locaux non comparables) | revue Knowledge | S |
| 3.7 | Rejouer au banc le chemin « amélioration par LLM » du Frontend | revue Frontend | S |

### Priorité 4 — Multi-plateforme (phase C)
| # | Tâche | Effort |
|---|---|---|
| 4.1 | PWA installable de première classe : cache hors ligne en lecture, icônes adaptatives, ergonomie tactile | M |
| 4.2 | Option « API seule » (backend sans interface) pour Flutter / React Native | S |
| 4.3 | Export Capacitor (application mobile native) comme artefact optionnel | L |
| 4.4 | Piles TypeScript (NestJS) et Python (FastAPI) annoncées dans le panel | L |

### Priorité 5 — Efficience (phase D)
| # | Tâche | Effort |
|---|---|---|
| 5.1 | Cache de normalisation : même spec → réutiliser le modèle structuré (économie de crédits) | S |
| 5.2 | Paralléliser QA et Documentation avec les scanners | M |
| 5.3 | Budget de jetons par agent, documenté et affiché dans le panel | S |
| 5.4 | Profils « rapide » (démonstration) et « qualité » dans le panel | S |

### Priorité 6 — Panel (phase E, reste)
| # | Tâche | Effort |
|---|---|---|
| 6.1 | Lien d'aperçu de l'app déployée directement dans le livrable | S |
| 6.2 | Comparaison de deux versions d'une application (ce qui a changé) | M |
| 6.3 | Affichage du résultat de `npm test` et du DAST dynamique (après 1.1 et 1.2) | S |

### Priorité 7 — Mémoire de Master
| # | Tâche | Effort |
|---|---|---|
| 7.1 | Jeu de spécifications de référence (bibliothèque, DiaspoKoli, marketplace, tâches) et tableau de mesures : durée, crédits, tests, scores, défauts trouvés | M |
| 7.2 | Chapitre méthode : règles d'ingénierie R1–R7, principe « LLM = compréhension, déterministe = code sûr », banc d'essai | M |
| 7.3 | Chapitre résultats : avant / après de la revue (tableau de synthèse de `REVUE-AGENTS.md`) | S |

Effort : S ≈ une demi-journée, M ≈ un à deux jours, L ≈ plus de deux jours.

## 3. Ordre conseillé

1. **1.5** (vérifier l'état réel après import), puis **1.1 → 1.3** : le pipeline passe de « contrôlé
   par analyse » à « prouvé par exécution » — c'est l'argument le plus fort pour la soutenance.
2. **3.4 + 3.5** : filet de sécurité automatique avant d'élargir le périmètre.
3. **2.3, 2.1, 2.2** : qualité perçue des applications générées.
4. **7.x** en continu, alimenté par les mesures des étapes précédentes.
5. Phases C et D selon le temps restant avant la soutenance.
