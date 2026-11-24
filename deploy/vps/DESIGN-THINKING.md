# Design thinking appliqué à Forge IA

Jusqu'ici, le système a progressé **en réaction aux défauts** : chaque capture ou ZIP révélait un
problème, on le corrigeait. Ce document inverse la démarche : on part des personnes qui utilisent
Forge, de ce qu'elles vivent, puis on décide quoi construire. Il suit les cinq étapes classiques
(comprendre, définir, imaginer, prototyper, tester) et alimente `FEUILLE-DE-ROUTE.md`.

## 1. Comprendre — qui utilise Forge, et ce qu'on a observé

Les douleurs ci-dessous ne sont pas supposées : elles ont toutes été **constatées** pendant les
générations réelles de novembre 2026 (bibliothèque, marketplace, DiaspoKoli).

| Persona | Ce qu'il veut | Douleurs observées |
|---|---|---|
| **Awa, porteuse de projet** — dépose un cahier des charges (PDF) pour une plateforme | Une application qui fait ce qu'elle a décrit, sans savoir coder | Domaine vide (tables `users/uploads` au lieu de ses entités) ; 5 à 20 min d'attente avant de découvrir que Forge a mal compris ; crédits consommés pour rien ; aucun moyen de corriger avant de payer |
| **Koffi, utilisateur final** — voyageur ou expéditeur sur l'app générée | Une app qui suit les vraies règles de son métier | CRUD isolé : il ne voyait pas les trajets des autres ; statuts falsifiables ; libellés techniques (`mobile_money`, `RESERVATION ID`) |
| **Sènan, développeur** — reprend le code généré | Un code lisible, documenté, sans surprise | Commentaires « P5 / B1 / Tier 2 », émojis, messages sans accents, README parlant de « pipeline » et de « prompts » |
| **Le jury** — évalue le mémoire | Des preuves mesurables, pas des affirmations | « Validé » affiché alors que trois analyses avaient échoué ; simulations non déclarées ; QA qui ne lisait que la moitié du code |

**Moment de vérité commun :** tout le monde découvre la qualité *à la fin*. Awa voit le résultat
après 20 minutes ; le jury voit un verdict sans preuve ; Sènan ouvre un ZIP déjà livré.

## 2. Définir — trois problèmes à résoudre

1. **Comment Awa peut-elle savoir, avant de dépenser ses crédits et 20 minutes, ce que Forge a compris
   de sa spécification — et le corriger ?**
2. **Comment Koffi peut-il recevoir une application organisée autour de son rôle et de son parcours,
   et pas autour des tables de la base ?**
3. **Comment le jury (et Awa) peut-il voir la preuve de chaque verdict, et pas seulement le verdict ?**

## 3. Imaginer — pistes retenues

| Piste | Problème traité | Gain attendu | Décision |
|---|---|---|---|
| **A. « Ce que Forge a compris »** : aperçu de la compréhension avant génération, corrigeable | 1 | Erreurs de domaine détectées en 30 s au lieu de 20 min ; la génération confirmée ne refait pas l'analyse | **Prototypé (ci-dessous)** |
| B. Parcours par rôle : l'app générée s'ouvre sur « Mes trajets / Réservations reçues » selon le rôle | 2 | L'utilisateur final comprend l'app sans formation | À prototyper |
| C. Page « Preuves » dans le livrable : tests exécutés, DAST, règles appliquées ou non | 3 | Verdict vérifiable par le jury | Après B4 (exécution réelle) |
| D. Exemples de spécifications guidées (gabarits par domaine) | 1 | Moins de specs trop pauvres | Plus tard |
| E. Estimation du coût et de la durée avant lancement | 1 | Décision éclairée | Plus tard (données de télémétrie disponibles) |

Écartées pour l'instant : assistant conversationnel complet (coût LLM élevé, valeur proche de A) ;
édition visuelle des écrans générés (trop large pour le calendrier du mémoire).

## 4. Prototyper — piste A, réalisée

**Parcours :** Awa écrit (ou dépose un PDF/DOCX) → « Vérifier ce que Forge a compris » → Forge
affiche le nom du projet, les ressources et leurs champs (type, obligatoire), les rôles et les
règles métier → Awa corrige (renomme, retire, ajoute) → « Générer avec cette compréhension ».

**Sous le capot :**
- Panel 7.3 : route `/api/preview` = extraction du document (service `forge-extractor`) → Spec Linter
  (gratuit) → Spec Normalizer (un seul appel LLM). Aucun autre agent, aucun code généré.
- La structure confirmée est jointe à la spécification dans un bloc `STRUCTURE CONFIRMÉE` (JSON).
- Normalizer 1.23 : un aiguillage `IF Structure confirmée ?` envoie ce cas sur le chemin
  déterministe. **La génération confirmée ne refait aucun appel LLM pour comprendre la spec** :
  ce que l'utilisatrice a validé est exactement ce qui est généré.

**Vérifié (navigateur, vrais workflows exécutés par le banc, LLM simulé) :** ressource retirée
(« avis »), champ ajouté et rendu obligatoire, ressource ajoutée (« paiements »), règle ajoutée ;
le pipeline reçoit la structure et le Normalizer la reprend telle quelle avec **0 appel LLM** ;
clair, sombre et mobile (390 px) sans débordement ; 0 erreur console.

## 5. Tester — protocole avec de vraies personnes

**Participants :** 5 personnes — 2 porteurs de projet non développeurs, 2 utilisateurs finaux
(rôles voyageur et expéditeur), 1 développeur.

**Tâches (chronométrées, à voix haute) :**
| # | Tâche | Mesure |
|---|---|---|
| T1 | À partir d'une spec fournie, vérifier ce que Forge a compris et corriger une erreur volontaire (ressource manquante) | Temps, erreur détectée oui/non |
| T2 | Lancer la génération et dire, pendant l'attente, à quelle étape on est | Compréhension du suivi |
| T3 | Dans l'app générée : publier un trajet, réserver, accepter la réservation (deux comptes) | Taux de réussite sans aide |
| T4 | Dans le ZIP : trouver où sont décrites les règles métier et comment lancer les tests | Temps |
| T5 | Dire si l'application est « prête à être déployée » et pourquoi | Le verdict est-il compris et justifié ? |

**Questionnaire :** SUS (10 questions, échelle 1–5) + 3 questions ouvertes
(ce qui a surpris, ce qui a bloqué, ce qui donnerait confiance).

**Critères de réussite :** T1 réussie par 4/5 en moins de 3 min ; T3 réussie sans aide par 4/5 ;
SUS ≥ 70. Les résultats alimentent le chapitre « résultats » du mémoire et réordonnent la feuille
de route (pistes B à E).
