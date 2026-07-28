# EPITNET — Générateur de sites vitrines par l'IA

> Conception et déploiement automatisé d'un générateur de sites vitrines par l'IA,
> optimisé pour l'hébergement web.
> — Hackathon EPITNET (ITNET Technologies / iWey School / Epitech Bénin), 03–05 août 2026.

À partir d'un simple brief (nom, secteur, description, services, contact), l'outil
génère un **site vitrine statique** — présentation d'entreprise, portfolio, restaurant,
landing — puis le **déploie automatiquement** sur un hébergement web.

La sortie est **100 % statique et optimisée** (HTML/CSS/JS minifiés, images SVG légères,
SEO complet, CSP stricte) : légère à héberger, rapide à charger, sans base de données.

## Démarrage rapide

```bash
# 1. (optionnel) configurer les clés
cp .env.example .env    # MISTRAL_API_KEY, NETLIFY_AUTH_TOKEN

# 2. Panneau web (recommandé)
npm start               # http://localhost:3200

# 3. …ou en ligne de commande
node cli.js --input examples/chez-amina.json --out dist
node cli.js --input examples/chez-amina.json --zip site.zip
node cli.js --input examples/chez-amina.json --deploy netlify --site-name mon-site

# 4. tests
npm test
```

Aucune dépendance npm : Node ≥ 18 suffit (utilise `fetch` natif).

## Comment ça marche

```
Brief (form / JSON)
   │
   ├─▶ 1. Contenu    generator/content.js   IA Mistral (si clé) → sinon repli déterministe
   ├─▶ 2. Thème      generator/themes.js    palette + typo selon le secteur
   ├─▶ 3. Rendu      generator/render.js    HTML/CSS/JS + SEO + CSP + config hébergement
   ├─▶ 4. Optimise   generator/optimize.js  minification + rapport de poids
   │
   └─▶ Fichiers prêts à héberger
        ├─ dist/          (deploy/local.js)
        ├─ site.zip       (deploy/zip.js — pour FTP mutualisé)
        └─ Netlify        (deploy/netlify.js — déploiement automatisé)
```

**Run-and-go** : sans clé Mistral, un contenu de qualité est généré de façon
déterministe → l'outil marche toujours, hors-ligne. Avec une clé, l'IA rédige un
contenu sur-mesure (avec retry + repli en cas d'échec).

## Ce que contient le site généré

| Aspect | Détail |
|---|---|
| Structure | Single-page responsive : hero, à-propos, services, galerie, avis, tarifs, contact (au choix) |
| SEO | `<title>`/meta description/keywords, Open Graph, **JSON-LD LocalBusiness**, `sitemap.xml`, `robots.txt`, canonical |
| Performance | CSS/JS minifiés, images SVG légères, `loading="lazy"`, polices système (zéro CDN) |
| Sécurité | **CSP stricte** (`script-src 'self'` + hash du JSON-LD, aucun `unsafe-inline`), `rel=noopener`, headers durcis |
| Hébergement | `.htaccess` (Apache/cPanel : cache + gzip) et `_headers` (Netlify) générés |
| Accessibilité | HTML sémantique, `alt`, `aria-*`, `prefers-reduced-motion` |
| Formulaire | `mailto` par défaut (100 % statique) ou action serveur (Formspree…) |

## Sécurité intégrée

- **CSP par hash** : le seul script inline (JSON-LD) est autorisé par son empreinte
  SHA-256 dans la CSP — pas de `unsafe-inline`. Le hash est recalculé **après**
  minification pour rester cohérent.
- **Aucun handler inline** dans le JS généré (délégation via `addEventListener`).
- **Échappement HTML** systématique du contenu injecté (brief, IA).
- Panneau : limite de taille de corps, chemins de fichiers assainis (anti path-traversal).

## Positionnement vs Forge IA

Ce projet réutilise l'esprit d'orchestration multi-agents de Forge IA (contenu →
rendu → optimisation → déploiement, avec repli/robustesse) mais change le **modèle
métier** et la **cible de sortie** : d'une app full-stack Node/SQLite vers un **site
statique optimisé pour l'hébergement web**. Voir `docs/conception.md`.

## Structure

```
generator/   schema · themes · content(IA) · render · optimize · preview · index
deploy/      local(dist) · zip(FTP) · netlify(API)
public/      index.html  (panneau web)
examples/    briefs d'exemple
tests/       smoke.js
cli.js       ligne de commande      server.js  panneau + API      load-env.js
```
