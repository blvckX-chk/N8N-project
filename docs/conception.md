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

## Décisions (tranchées — MVP livré)

| Sujet | Choix | Justification |
|---|---|---|
| Moteur de génération | **Service Node autonome, zéro dépendance** | Self-contained, démontrable sans infra n8n ; `fetch` natif pour l'IA/déploiement |
| Contenu | **IA Mistral si clé, sinon repli déterministe** | Run-and-go : marche hors-ligne, l'IA enrichit quand disponible (avec retry) |
| Rendu | **Templates statiques paramétrés** (HTML/CSS/JS déterministes) + contenu IA | Contrôle total du markup (SEO/CSP/perf/accessibilité), pas de HTML LLM imprévisible |
| Formulaire de contact | **`mailto` par défaut**, action serveur optionnelle (Formspree…) | 100 % statique par défaut ; pas de backend requis pour héberger |
| Déploiement démo | **Netlify (API)** + artefact **ZIP** pour FTP mutualisé | Netlify = automatisé en 1 clic ; ZIP = proche de l'hébergement classique |

## État — MVP livré ✅

Générateur complet (`generator/`), 3 cibles de déploiement (`deploy/`), panneau web
(`public/index.html` + `server.js`), CLI (`cli.js`), tests (`tests/smoke.js`, 29
assertions). Site généré : responsive, SEO (JSON-LD, sitemap, robots), CSP stricte par
hash, config d'hébergement (`.htaccess`/`_headers`), rapport d'optimisation.

## v2 — livré ✅

- **Multi-pages** avec navigation réelle (`layout: multi`) : accueil (hero + teasers + CTA)
  + une page par section, sitemap multi-URL, CSP par hash unique valable sur toutes les pages.
- **Upload de logo/images réelles** (data URI → fichiers), repli SVG ; URLs externes
  ignorées pour préserver la CSP.
- **Comparateur de thèmes** côte à côte dans le panneau + override manuel de thème.
- **Cibles de déploiement** : Vercel (API) et **FTP direct** (zéro dépendance) en plus
  de Netlify et du ZIP.

Tests : `tests/smoke.js` (29) + `tests/v2.js` (36) = 65 assertions. Le flux FTP réel est
validé contre un serveur FTP mock (transfert binaire + chemins).

## Pistes v3 (restantes)

- SFTP (nécessite une lib crypto SSH — hors zéro-dépendance).
- Cloudflare Pages / GitHub Pages.
- Multi-pages : blog / pages libres au-delà des sections type.
- Optimisation images (conversion WebP, redimensionnement) à l'upload.

## Réutilisable depuis Forge IA

Orchestration multi-agents, polling + progression frontend, historique, mode
« améliorer », packaging ZIP, `Sanitize Input` (anti prompt-injection), failover
Mistral, mécanique de gates/scoring.

## À construire (nouveau)

Modèle éditorial (Normalizer/Architect « vitrine »), générateur Frontend statique
+ thèmes, volet optimisation SEO/perf, backends de déploiement statique.
