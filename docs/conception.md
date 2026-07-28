# Conception — Générateur de sites vitrines (EPITNET)

## Thème

« Conception et déploiement automatisé d'un générateur de sites vitrines par l'IA
optimisé pour l'hébergement web. »

## Périmètre

1. **Entrée** : description en langage naturel ou formulaire (nom, secteur, offre,
   services, coordonnées, palette, langue, sections voulues).
2. **Génération IA** :
   - déduction d'un **plan de site** (pages + sections : hero, à-propos, services,
     galerie, témoignages, tarifs, contact) ;
   - **rédaction du contenu** (copywriting adapté au secteur) ;
   - **rendu statique** responsive + thème selon le secteur.
3. **Optimisation hébergement web** : minification HTML/CSS/JS, images WebP,
   critical CSS, `sitemap.xml`, `robots.txt`, balises SEO / Open Graph,
   lazy-loading — artefact `dist/` léger.
4. **Déploiement automatisé** : FTP/SFTP mutualisé **ou** API static hosting
   (Netlify / Vercel / Cloudflare Pages / GitHub Pages).

## Décisions ouvertes

| Sujet | Options | À trancher |
|---|---|---|
| Moteur de génération | Pipeline n8n (réutiliser Forge IA) vs service Node autonome | — |
| Rendu | Templates statiques paramétrés vs génération LLM du HTML complet | — |
| Formulaire de contact | Service tiers (Formspree) vs fonction serverless vs mail PHP | — |
| Cible de déploiement prioritaire pour la démo | Netlify (API simple) vs FTP mutualisé | — |

## Réutilisable depuis Forge IA

Orchestration multi-agents, polling + progression frontend, historique, mode
« améliorer », packaging ZIP, `Sanitize Input` (anti prompt-injection), failover
Mistral, mécanique de gates/scoring.

## À construire (nouveau)

Modèle éditorial (Normalizer/Architect « vitrine »), générateur Frontend statique
+ thèmes, volet optimisation SEO/perf, backends de déploiement statique.
