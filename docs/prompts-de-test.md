# Prompts de test — Forge IA

Batterie de prompts pour éprouver les aspects les plus complexes du pipeline.
Chaque prompt est calibré pour **passer le Spec Linter** (nom de projet, ressources
typées, routes CRUD, ≥ 150 caractères) et **cibler une fonctionnalité précise**.

**Mode d'emploi** : onglet **Texte** → coller le prompt → **Générer**. Vérifier les
points listés sous « ✅ À vérifier ». Pour les tests d'amélioration, générer d'abord
puis cliquer **« ✨ Appliquer »** sur une proposition.

---

## 1 — Types riches complets (Normalizer V1.11 : bornes / unités / défauts / enum / optionnel)
```
Application GestionStock pour une petite boutique. Ressource produit : nom (obligatoire), prix en euros entre 0 et 100000, quantite en stock (positif), categorie parmi : alimentaire, hygiene, boisson, disponible (booléen, par défaut vrai), description (facultative). Ressource fournisseur : nom (obligatoire), email, telephone (facultatif). Routes CRUD pour produits et fournisseurs.
```
✅ À vérifier : `prix` libellé « Prix (€) » avec min/max ; `quantite` min 0 ; `categorie` en liste déroulante ; `disponible` toggle coché par défaut ; `description`/`telephone` marqués « (optionnel) » ; validation serveur (prix hors bornes → 400).

## 2 — Relations FK multiples + dates + statut enum
```
Application CliniqueRDV pour un cabinet médical. Ressource patient : nom (obligatoire), date de naissance, telephone. Ressource medecin : nom (obligatoire), specialite parmi : generaliste, cardiologue, pediatre. Ressource rendezvous : date du rendez-vous, patient_id, medecin_id, statut parmi : planifie, confirme, annule, motif (facultatif). Routes CRUD pour patients, medecins et rendezvous.
```
✅ À vérifier : `patient_id`/`medecin_id` en menus déroulants montrant le **libellé** (pas l'id) ; `specialite`/`statut` en enums ; `date` en sélecteur natif ; la liste résout les FK.

## 3 — Relation N-N (multi-sélection dans la modale détail)
```
Application BiblioPlus pour une bibliothèque. Ressource livre : titre (obligatoire), auteur, annee entre 1900 et 2025, disponible (booléen). Ressource categorie : nom (obligatoire). Un livre peut appartenir à plusieurs categories (categorie_ids). Ressource emprunt : livre_id, emprunteur, date d'emprunt, date de retour (facultative), rendu (booléen). Routes CRUD pour livres, categories et emprunts.
```
✅ À vérifier : `categorie_ids` **exclu du formulaire** ; en cliquant une ligne « livre », la **modale détail** montre une **multi-sélection** des catégories (cocher/décocher relie/détache) ; `annee` bornée 1900–2025.

## 4 — Note « sur N », pourcentage, devise FCFA (cas limites du Normalizer)
```
Application EvalProf pour noter des formations. Ressource formation : titre (obligatoire), formateur, duree en heures, tarif en FCFA. Ressource evaluation : formation_id, note sur 5, pourcentage_recommandation, commentaire (facultatif), recommande (booléen). Routes CRUD pour formations et evaluations.
```
✅ À vérifier : `note` bornée 0–5 ; `pourcentage_recommandation` borné 0–100 avec « (%) » ; `tarif` libellé « (FCFA) ».

## 5 — RBAC multi-acteurs (rôles + permissions + premier compte admin)
```
Application GestionEcole avec trois rôles : admin, enseignant, eleve. Ressource cours : titre (obligatoire), matiere, enseignant_id. Ressource note : eleve_id, cours_id, valeur entre 0 et 20, appreciation (facultative). Les enseignants créent des cours et des notes, les eleves consultent. Routes CRUD pour cours et notes.
```
✅ À vérifier : premier inscrit = **admin** (badge doré + panneau Comptes) ; les inscriptions suivantes = rôle non-admin ; un non-admin ne peut pas créer de compte (403) ; `valeur` bornée 0–20.

## 6 — Uploads fichiers / images sécurisés
```
Application PortfolioPro pour gérer des projets créatifs. Ressource projet : titre (obligatoire), description, categorie parmi : design, photo, video, publie (booléen). L'application doit permettre de téléverser des images et des documents PDF associés aux projets. Routes CRUD pour projets.
```
✅ À vérifier : panneau **📎 Fichiers** actif ; upload PNG/JPG/PDF accepté, autre extension refusée ; un fichier trop gros → message clair ; vignettes images / icône PDF.

## 7 — Ressources partagées (multi-acteurs, `created_by`)
```
Application SignalVille pour signaler des problèmes urbains. Les citoyens créent des signalements visibles par tous les agents municipaux. Ressource signalement : titre (obligatoire), description, type parmi : voirie, eclairage, proprete, dechets, statut parmi : nouveau, en cours, resolu, latitude, longitude, urgent (booléen). Routes CRUD pour signalements.
```
✅ À vérifier : les signalements sont **partagés** (tous les comptes les voient) et non cloisonnés par utilisateur ; `type`/`statut` en enums ; `latitude`/`longitude` bornées ; `urgent` toggle.

## 8 — Beaucoup de ressources (> 6 : avertissement MAX_6, compaction, l'Architect garde les principales)
```
Application ERPArtisan complète pour un artisan. Ressources : client (nom obligatoire, telephone, email), devis (client_id, montant en euros, statut parmi : envoye, accepte, refuse), facture (devis_id, montant, payee booléen), produit (nom, prix en euros), stock (produit_id, quantite positif), fournisseur (nom, email), commande (fournisseur_id, montant, recue booléen), depense (libelle, montant en euros, date). Routes CRUD pour toutes les ressources.
```
✅ À vérifier : le pipeline **ne stoppe pas** (MAX_6 est un avertissement) ; les 6 ressources principales sont générées ; navigation multi-pages cohérente.

## 9 — Booléens, valeurs par défaut, date-heure
```
Application EventFlow pour organiser des évènements. Ressource evenement : titre (obligatoire), date_heure de début, lieu, capacite entre 1 et 5000, gratuit (booléen, par défaut faux), publie (booléen, par défaut faux). Ressource inscription : evenement_id, participant (obligatoire), email, present (booléen, par défaut faux). Routes CRUD pour evenements et inscriptions.
```
✅ À vérifier : `date_heure` en `datetime-local` ; `gratuit`/`publie`/`present` en toggles avec l'état par défaut correct ; `capacite` bornée 1–5000 ; badges Oui/Non dans les listes.

## 10 — Validation serveur stricte (bornes, requis, enum whitelist, longueur)
```
Application ControleQualite pour des inspections. Ressource inspection : reference (obligatoire), score entre 0 et 100, niveau parmi : critique, majeur, mineur, conforme (booléen), commentaire (facultatif), date d'inspection. Chaque score doit être un entier entre 0 et 100 et le niveau doit être une des valeurs autorisées. Routes CRUD pour inspections.
```
✅ À vérifier (via l'API ou le formulaire) : `score` hors 0–100 → 400 ; `niveau` hors liste → 400 ; `reference` vide → 400 ; `commentaire` optionnel accepté vide.

## 11 — Détection de domaine (santé/pharmacie → palette + logo + ressources compagnes)
```
Application PharmaSuivi pour une pharmacie. Ressource ordonnance : patient (obligatoire), medecin, date de prescription, statut parmi : en attente, preparee, delivree. Ressource medicament : nom (obligatoire), dosage, prix en euros, stock positif, sur_ordonnance (booléen). Routes CRUD pour ordonnances et medicaments.
```
✅ À vérifier : palette/logo cohérents « santé » ; après génération, les **propositions** suggèrent des ressources compagnes pertinentes (ex. rendez-vous, stock) ; enums `statut`.

## 12 — Chaîne d'amélioration V1 → V2 → V3 (mode différentiel + migrations)
```
Application TaskBoard simple. Ressource tache : titre (obligatoire), description (facultative), priorite parmi : basse, moyenne, haute, terminee (booléen). Routes CRUD pour taches.
```
✅ Séquence à tester :
1. **Générer** (V1) — vérifier la base.
2. Cliquer **« ✨ Appliquer »** sur une proposition (ex. « Ajouter un statut ») → **V2** : voir le **diff** (« ✨ Ce qui a été amélioré ») et l'historique V1→V2.
3. Cliquer une autre proposition → **V3** : la chaîne se poursuit sans erreur (ZIP re-préparé), les fichiers existants sont préservés, l'incrément est ajouté.
4. Ajouter un **champ** via l'ajout libre (« Ajoute un champ echeance de type date à tache ») → au redéploiement, la base migre (ALTER TABLE) **sans perte de données**.

---

## Autres vérifications transverses (sur n'importe quelle app générée)
- **Thème clair/sombre** : bouton 🌓 → bascule + persistance.
- **Recherche / tri / pagination** : barre de recherche, en-têtes triables, sélecteur 10/25/50.
- **Export CSV / PDF** : bouton export (respecte recherche + tri) ; impression PDF.
- **Sécurité Tier 2** : « 🔑 Mon compte » → changer le mot de passe (révoque les autres sessions) ; œil afficher/masquer sur login et Mon compte ; 5 échecs de connexion → compte verrouillé 15 min.
- **Temps réel (SSE)** : ouvrir deux onglets, créer dans l'un → l'autre se rafraîchit.
- **Journal d'audit** (admin) : connexions, créations, suppressions tracées.
- **SECURITY.md** dans le ZIP : attestation OWASP/ASVS + tableau des versions d'agents.
