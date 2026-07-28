'use strict';
// Thèmes par secteur d'activité. Chaque thème = palette + typographie (piles
// système, zéro requête externe → meilleure perf/SEO et hébergement sans CDN).

const SYSTEM_SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SYSTEM_SERIF = "Georgia,Cambria,'Times New Roman',Times,serif";

const THEMES = {
  restaurant: {
    primary: '#b91c1c', primaryDark: '#7f1d1d', accent: '#f59e0b',
    bg: '#fffaf5', surface: '#ffffff', text: '#2a1a12', muted: '#7c6a5f',
    headingFont: SYSTEM_SERIF, bodyFont: SYSTEM_SANS, radius: '14px'
  },
  business: {
    primary: '#1d4ed8', primaryDark: '#1e3a8a', accent: '#06b6d4',
    bg: '#f7f9fc', surface: '#ffffff', text: '#0f1a2b', muted: '#5b6b82',
    headingFont: SYSTEM_SANS, bodyFont: SYSTEM_SANS, radius: '12px'
  },
  tech: {
    primary: '#7c3aed', primaryDark: '#5b21b6', accent: '#22d3ee',
    bg: '#0b0b14', surface: '#14141f', text: '#e7e7f2', muted: '#9aa0b4',
    headingFont: SYSTEM_SANS, bodyFont: SYSTEM_SANS, radius: '14px', dark: true
  },
  portfolio: {
    primary: '#111827', primaryDark: '#000000', accent: '#ec4899',
    bg: '#0f0f12', surface: '#17171c', text: '#f2f2f5', muted: '#9a9aa6',
    headingFont: SYSTEM_SANS, bodyFont: SYSTEM_SANS, radius: '10px', dark: true
  },
  health: {
    primary: '#0d9488', primaryDark: '#115e59', accent: '#3b82f6',
    bg: '#f5fbfa', surface: '#ffffff', text: '#10241f', muted: '#5a7169',
    headingFont: SYSTEM_SANS, bodyFont: SYSTEM_SANS, radius: '14px'
  },
  education: {
    primary: '#2563eb', primaryDark: '#1e40af', accent: '#16a34a',
    bg: '#f8fafc', surface: '#ffffff', text: '#0f172a', muted: '#556074',
    headingFont: SYSTEM_SERIF, bodyFont: SYSTEM_SANS, radius: '12px'
  },
  beauty: {
    primary: '#be185d', primaryDark: '#831843', accent: '#a855f7',
    bg: '#fdf6fa', surface: '#ffffff', text: '#2a121f', muted: '#8a6577',
    headingFont: SYSTEM_SERIF, bodyFont: SYSTEM_SANS, radius: '18px'
  },
  realestate: {
    primary: '#0f766e', primaryDark: '#134e4a', accent: '#ca8a04',
    bg: '#f7f8f6', surface: '#ffffff', text: '#1a231f', muted: '#5e6b62',
    headingFont: SYSTEM_SERIF, bodyFont: SYSTEM_SANS, radius: '10px'
  },
  default: {
    primary: '#4f46e5', primaryDark: '#3730a3', accent: '#06b6d4',
    bg: '#f7f8fc', surface: '#ffffff', text: '#111827', muted: '#5b6478',
    headingFont: SYSTEM_SANS, bodyFont: SYSTEM_SANS, radius: '12px'
  }
};

// Aliases : mots-clés secteur -> thème
const ALIASES = {
  restaurant: 'restaurant', food: 'restaurant', cuisine: 'restaurant', cafe: 'restaurant', bar: 'restaurant', traiteur: 'restaurant',
  business: 'business', entreprise: 'business', corporate: 'business', consulting: 'business', conseil: 'business', finance: 'business', ong: 'business',
  tech: 'tech', startup: 'tech', saas: 'tech', logiciel: 'tech', informatique: 'tech', digital: 'tech', ia: 'tech',
  portfolio: 'portfolio', photographe: 'portfolio', artiste: 'portfolio', creatif: 'portfolio', design: 'portfolio', freelance: 'portfolio',
  health: 'health', sante: 'health', clinique: 'health', pharmacie: 'health', medical: 'health', hopital: 'health', dentiste: 'health',
  education: 'education', ecole: 'education', formation: 'education', universite: 'education', cours: 'education',
  beauty: 'beauty', beaute: 'beauty', salon: 'beauty', spa: 'beauty', coiffure: 'beauty', esthetique: 'beauty', mode: 'beauty',
  realestate: 'realestate', immobilier: 'realestate', agence: 'realestate', construction: 'realestate', btp: 'realestate'
};

function resolveTheme(sector, override) {
  const key = ALIASES[String(sector || '').toLowerCase()] || 'default';
  const base = { ...THEMES[key], name: key };
  if (override && typeof override === 'object') {
    if (override.primary) base.primary = override.primary;
    if (override.accent) base.accent = override.accent;
    if (override.primaryDark) base.primaryDark = override.primaryDark;
  }
  return base;
}

module.exports = { resolveTheme, THEMES, ALIASES };
