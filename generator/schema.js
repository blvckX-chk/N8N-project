'use strict';
// Validation + normalisation de l'entrée utilisateur (brief du site vitrine).
// L'entrée est volontairement tolérante : quelques champs suffisent, le reste a
// des valeurs par défaut raisonnables. On renvoie un "brief" propre et sûr.

const ALL_SECTIONS = ['hero', 'about', 'services', 'gallery', 'testimonials', 'pricing', 'contact'];
const LANGS = ['fr', 'en'];

function str(v, max) {
  if (v == null) return '';
  const s = String(v).trim();
  return max ? s.slice(0, max) : s;
}
function slugify(s) {
  return str(s).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'site';
}
function arr(v, max) {
  if (!Array.isArray(v)) {
    if (typeof v === 'string' && v.trim()) return v.split(/[\n,;]+/).map(x => x.trim()).filter(Boolean).slice(0, max);
    return [];
  }
  return v.map(x => str(x, 120)).filter(Boolean).slice(0, max);
}

function normalizeBrief(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const name = str(raw.name || raw.entreprise || raw.title, 80) || 'Mon Entreprise';
  const sector = str(raw.sector || raw.secteur, 40).toLowerCase() || 'business';
  let language = str(raw.language || raw.langue, 5).toLowerCase();
  if (!LANGS.includes(language)) language = 'fr';

  let sections = arr(raw.sections, 12).map(s => s.toLowerCase()).filter(s => ALL_SECTIONS.includes(s));
  if (!sections.length) sections = ['hero', 'about', 'services', 'gallery', 'testimonials', 'contact'];
  // hero et contact toujours présents, dans un ordre cohérent
  if (!sections.includes('hero')) sections.unshift('hero');
  if (!sections.includes('contact')) sections.push('contact');
  sections = ALL_SECTIONS.filter(s => sections.includes(s));

  const contact = raw.contact && typeof raw.contact === 'object' ? raw.contact : {};
  const social = raw.social && typeof raw.social === 'object' ? raw.social : {};

  return {
    name,
    slug: slugify(raw.slug || name),
    sector,
    language,
    tagline: str(raw.tagline || raw.slogan, 140),
    description: str(raw.description || raw.about, 1200),
    services: arr(raw.services, 8),
    sections,
    cta: {
      label: str(raw.cta && raw.cta.label, 40) || (language === 'en' ? 'Get in touch' : 'Nous contacter'),
      href: str(raw.cta && raw.cta.href, 120) || '#contact'
    },
    contact: {
      email: str(contact.email, 120),
      phone: str(contact.phone, 40),
      address: str(contact.address, 160)
    },
    social: {
      facebook: str(social.facebook, 200),
      instagram: str(social.instagram, 200),
      linkedin: str(social.linkedin, 200),
      whatsapp: str(social.whatsapp, 200)
    },
    // override palette éventuel : {primary, accent}
    palette: raw.palette && typeof raw.palette === 'object' ? raw.palette : null,
    // action de formulaire (Formspree, etc.). Sinon fallback mailto.
    formAction: str(raw.formAction, 200)
  };
}

module.exports = { normalizeBrief, slugify, ALL_SECTIONS, LANGS };
