# EPITNET — Générateur de sites vitrines par l'IA

> Conception et déploiement automatisé d'un générateur de sites vitrines par l'IA,
> optimisé pour l'hébergement web.
> — Hackathon EPITNET (ITNET Technologies / iWey School / Epitech Bénin), 03–05 août 2026.

## Objectif

Produire, à partir d'une simple description (nom, secteur, offre, coordonnées), un
**site vitrine statique** — présentation d'entreprise, portfolio, landing page — puis le
**déployer automatiquement** sur un hébergement web (mutualisé FTP/SFTP ou static hosting
type Netlify / Vercel / GitHub Pages).

La sortie est **100 % statique et optimisée** (HTML/CSS/JS minifiés, images WebP, SEO,
bon score Lighthouse) : légère à héberger, rapide à charger.

## Positionnement vs Forge IA

Ce dépôt/branche réutilise l'**ossature d'orchestration multi-agents** issue de Forge IA
(pipeline, gates, mode « améliorer », packaging) mais change le **modèle métier** et la
**cible de sortie** :

| | Forge IA (existant) | Ce projet (sites vitrines) |
|---|---|---|
| Sortie | App full-stack Node/Express + SQLite + auth | Site statique HTML/CSS/JS |
| Modèle | Ressources / CRUD / schéma BDD | Pages / sections / contenu éditorial |
| Déploiement | Process Node sur port VPS | Hébergement statique (FTP / Netlify / Vercel / Pages) |
| Qualité | OWASP app (SAST/DAST/IDOR…) | SEO / perf / accessibilité (Lighthouse) |

## Structure (amorce)

```
docs/         Conception, décisions, suivi
generator/    Générateurs de site (contenu, thèmes, assets)
deploy/       Cibles de déploiement statique (FTP, Netlify, Vercel, Pages)
```

## État

Amorçage du projet. Voir `docs/conception.md`.
