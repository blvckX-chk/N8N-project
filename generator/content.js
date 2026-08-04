'use strict';
// Génération du CONTENU éditorial (copywriting) du site vitrine.
// Stratégie run-and-go : on construit d'abord un modèle déterministe complet
// (toujours valide, hors-ligne), puis — si une clé Mistral est présente — on
// l'enrichit avec des textes rédigés par l'IA. Toute erreur LLM => on garde le
// déterministe (aucune panne). Inspiré du failover Mistral de Forge IA.

const ICONS = ['✦', '◈', '❖', '➤', '✧', '◆', '❥', '✚'];

function t(lang, fr, en) { return lang === 'en' ? en : fr; }

// ---------------------------------------------------------------- déterministe
function fallbackModel(brief) {
  const L = brief.language;
  const name = brief.name;
  const sector = brief.sector;
  const desc = brief.description ||
    t(L, `${name} met son savoir-faire au service de ses clients.`,
         `${name} brings its expertise to every client.`);

  const services = (brief.services.length ? brief.services : [
    t(L, 'Conseil', 'Consulting'),
    t(L, 'Réalisation', 'Delivery'),
    t(L, 'Accompagnement', 'Support')
  ]).map((s, i) => ({
    title: s,
    icon: ICONS[i % ICONS.length],
    description: t(L,
      `Une prestation « ${s.toLowerCase()} » soignée, adaptée à vos besoins et à votre budget.`,
      `A polished "${s.toLowerCase()}" service, tailored to your needs and budget.`)
  }));

  const model = {
    seo: {
      title: brief.tagline ? `${name} — ${brief.tagline}` : `${name} — ${sectorLabel(sector, L)}`,
      description: (desc).slice(0, 155),
      keywords: dedupe([name, sector, ...brief.services, t(L, 'site vitrine', 'website')])
    },
    hero: {
      title: brief.tagline || t(L, `Bienvenue chez ${name}`, `Welcome to ${name}`),
      subtitle: desc.slice(0, 180)
    },
    about: {
      heading: t(L, 'À propos', 'About us'),
      paragraphs: splitParagraphs(desc, L, name)
    },
    services: {
      heading: t(L, 'Nos services', 'Our services'),
      items: services
    },
    gallery: {
      heading: t(L, 'Galerie', 'Gallery'),
      items: Array.from({ length: 6 }, (_, i) => ({
        caption: t(L, `Réalisation ${i + 1}`, `Project ${i + 1}`)
      }))
    },
    testimonials: {
      heading: t(L, 'Ils nous font confiance', 'What clients say'),
      items: [
        { quote: t(L, 'Un travail sérieux et un vrai sens du détail. Je recommande.', 'Serious work and great attention to detail. Highly recommended.'), author: 'A. Koudjo', role: t(L, 'Cliente', 'Client') },
        { quote: t(L, 'Équipe réactive et à l’écoute, résultat à la hauteur.', 'Responsive, attentive team — results beyond expectations.'), author: 'M. Dossou', role: t(L, 'Partenaire', 'Partner') },
        { quote: t(L, 'Rapport qualité-prix imbattable, je reviendrai.', 'Unbeatable value, I’ll be back.'), author: 'S. Adjovi', role: t(L, 'Client', 'Client') }
      ]
    },
    pricing: {
      heading: t(L, 'Nos formules', 'Our plans'),
      plans: [
        { name: t(L, 'Essentiel', 'Starter'), price: '—', period: '', featured: false, features: brief.services.slice(0, 2) },
        { name: t(L, 'Standard', 'Standard'), price: '—', period: '', featured: true, features: brief.services.slice(0, 3) },
        { name: t(L, 'Premium', 'Premium'), price: '—', period: '', featured: false, features: brief.services }
      ]
    },
    contact: {
      heading: t(L, 'Contactez-nous', 'Get in touch'),
      intro: t(L, 'Une question, un projet ? Écrivez-nous, nous répondons rapidement.',
                  'A question or a project? Write to us, we reply quickly.')
    }
  };
  return model;
}

function sectorLabel(sector, L) {
  return sector.charAt(0).toUpperCase() + sector.slice(1);
}
function dedupe(a) { return [...new Set(a.map(x => String(x).trim()).filter(Boolean))].slice(0, 12); }
function splitParagraphs(desc, L, name) {
  const parts = String(desc).split(/(?<=[.!?])\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return [desc, t(L,
      `Depuis notre création, nous plaçons la satisfaction client au cœur de notre travail.`,
      `Since day one, client satisfaction has been at the heart of what we do.`)];
  }
  const mid = Math.ceil(parts.length / 2);
  return [parts.slice(0, mid).join(' '), parts.slice(mid).join(' ')];
}

// ------------------------------------------------------------------------ LLM
async function callMistral(brief, apiKey, { model = 'mistral-small-latest', retries = 2 } = {}) {
  const sys = 'Tu es un rédacteur web spécialisé en sites vitrines. Tu renvoies UNIQUEMENT du JSON valide, sans texte autour, sans markdown.';
  const schema = `{"seo":{"title":"","description":"","keywords":[""]},"hero":{"title":"","subtitle":""},"about":{"heading":"","paragraphs":[""]},"services":{"heading":"","items":[{"title":"","description":""}]},"testimonials":{"heading":"","items":[{"quote":"","author":"","role":""}]},"contact":{"heading":"","intro":""}}`;
  const user = [
    `Rédige le contenu (langue: ${brief.language}) d'un site vitrine pour :`,
    `- Nom: ${brief.name}`,
    `- Secteur: ${brief.sector}`,
    brief.tagline ? `- Slogan: ${brief.tagline}` : '',
    brief.description ? `- Description: ${brief.description}` : '',
    brief.services.length ? `- Services: ${brief.services.join(', ')}` : '',
    '',
    `Renvoie STRICTEMENT ce JSON (remplis chaque champ, textes persuasifs et professionnels, 3 services min, 3 témoignages) : ${schema}`
  ].filter(Boolean).join('\n');

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
          temperature: 0.7,
          response_format: { type: 'json_object' }
        }),
        signal: ctrl.signal
      }).finally(() => clearTimeout(to));
      if (!res.ok) throw new Error(`Mistral HTTP ${res.status}`);
      const data = await res.json();
      const txt = data.choices && data.choices[0] && data.choices[0].message.content;
      return JSON.parse(txt);
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

// Fusionne l'enrichissement LLM par-dessus le déterministe (sans casser la forme)
function mergeLLM(base, llm) {
  if (!llm || typeof llm !== 'object') return base;
  const out = JSON.parse(JSON.stringify(base));
  const put = (obj, path, val) => { if (val != null && val !== '') obj[path] = val; };
  if (llm.seo) { put(out.seo, 'title', llm.seo.title); put(out.seo, 'description', llm.seo.description);
    if (Array.isArray(llm.seo.keywords) && llm.seo.keywords.length) out.seo.keywords = dedupe([...out.seo.keywords, ...llm.seo.keywords]); }
  if (llm.hero) { put(out.hero, 'title', llm.hero.title); put(out.hero, 'subtitle', llm.hero.subtitle); }
  if (llm.about) { put(out.about, 'heading', llm.about.heading);
    if (Array.isArray(llm.about.paragraphs) && llm.about.paragraphs.length) out.about.paragraphs = llm.about.paragraphs.map(String); }
  if (llm.services && Array.isArray(llm.services.items) && llm.services.items.length) {
    put(out.services, 'heading', llm.services.heading);
    out.services.items = llm.services.items.slice(0, 8).map((it, i) => ({
      title: String(it.title || out.services.items[i] && out.services.items[i].title || `Service ${i + 1}`),
      description: String(it.description || ''),
      icon: ICONS[i % ICONS.length]
    }));
  }
  if (llm.testimonials && Array.isArray(llm.testimonials.items) && llm.testimonials.items.length) {
    put(out.testimonials, 'heading', llm.testimonials.heading);
    out.testimonials.items = llm.testimonials.items.slice(0, 6).map(it => ({
      quote: String(it.quote || ''), author: String(it.author || 'Client'), role: String(it.role || '')
    }));
  }
  if (llm.contact) { put(out.contact, 'heading', llm.contact.heading); put(out.contact, 'intro', llm.contact.intro); }
  return out;
}

async function buildContent(brief, opts = {}) {
  const base = fallbackModel(brief);
  const apiKey = opts.apiKey || process.env.MISTRAL_API_KEY;
  if (!apiKey) return { model: base, source: 'deterministic', ai: false };
  try {
    const llm = await callMistral(brief, apiKey, opts);
    return { model: mergeLLM(base, llm), source: 'mistral', ai: true };
  } catch (e) {
    return { model: base, source: 'deterministic-fallback', ai: false, error: String(e.message || e) };
  }
}

module.exports = { buildContent, fallbackModel, mergeLLM };
