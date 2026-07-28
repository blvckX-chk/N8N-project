'use strict';
// Rendu du site vitrine statique : modèle de contenu -> fichiers.
// Sortie : index.html, assets/style.css, assets/main.js, images SVG, SEO
// (sitemap/robots/manifest/favicon) et config d'hébergement (.htaccess, _headers)
// avec une CSP stricte (script-src 'self' + hash du JSON-LD, aucun unsafe-inline).

const crypto = require('crypto');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function attr(s) { return esc(s); }

const SECTION_LABELS = {
  fr: { hero: 'Accueil', about: 'À propos', services: 'Services', gallery: 'Galerie', testimonials: 'Avis', pricing: 'Tarifs', contact: 'Contact' },
  en: { hero: 'Home', about: 'About', services: 'Services', gallery: 'Gallery', testimonials: 'Reviews', pricing: 'Pricing', contact: 'Contact' }
};

// ------------------------------------------------------------------ favicon/img
function faviconSVG(theme, name) {
  const letter = esc((name || '?').trim().charAt(0).toUpperCase() || 'S');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${theme.primary}"/><stop offset="1" stop-color="${theme.accent}"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#g)"/><text x="50%" y="52%" dominant-baseline="central" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="34" font-weight="700" fill="#ffffff">${letter}</text></svg>`;
}
function gallerySVG(theme, i, caption) {
  const a = theme.primary, b = theme.accent;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400" role="img" aria-label="${attr(caption)}"><defs><linearGradient id="g${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="600" height="400" fill="url(#g${i})"/><circle cx="${120 + i * 40}" cy="140" r="90" fill="#ffffff" opacity="0.10"/><circle cx="470" cy="300" r="120" fill="#000000" opacity="0.08"/><text x="50%" y="52%" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="26" font-weight="700" fill="#ffffff" opacity="0.92">${esc(caption)}</text></svg>`;
}

// ------------------------------------------------------------------- sections
function renderHero(m, brief) {
  return `<section id="hero" class="hero reveal">
      <div class="container hero-inner">
        <h1>${esc(m.hero.title)}</h1>
        <p class="lead">${esc(m.hero.subtitle)}</p>
        <div class="hero-cta">
          <a class="btn btn-primary" href="${attr(brief.cta.href)}">${esc(brief.cta.label)}</a>
          ${brief.contact.phone ? `<a class="btn btn-ghost" href="tel:${attr(brief.contact.phone.replace(/\s+/g, ''))}">${esc(brief.language === 'en' ? 'Call us' : 'Appeler')}</a>` : ''}
        </div>
      </div>
    </section>`;
}
function renderAbout(m) {
  return `<section id="about" class="section reveal">
      <div class="container">
        <h2 class="section-title">${esc(m.about.heading)}</h2>
        <div class="about-grid">
          <div class="about-text">${m.about.paragraphs.map(p => `<p>${esc(p)}</p>`).join('\n          ')}</div>
          <div class="about-badge" aria-hidden="true"><span>${esc((m.about.heading || '').slice(0, 1) || '★')}</span></div>
        </div>
      </div>
    </section>`;
}
function renderServices(m) {
  const cards = m.services.items.map(it => `<article class="card reveal">
            <div class="card-icon" aria-hidden="true">${esc(it.icon || '✦')}</div>
            <h3>${esc(it.title)}</h3>
            <p>${esc(it.description)}</p>
          </article>`).join('\n          ');
  return `<section id="services" class="section section-alt">
      <div class="container">
        <h2 class="section-title">${esc(m.services.heading)}</h2>
        <div class="cards">
          ${cards}
        </div>
      </div>
    </section>`;
}
function renderGallery(m) {
  const items = m.gallery.items.map((it, i) => `<figure class="gallery-item reveal">
            <img src="assets/img/gallery-${i + 1}.svg" alt="${attr(it.caption)}" loading="lazy" width="600" height="400"/>
            <figcaption>${esc(it.caption)}</figcaption>
          </figure>`).join('\n          ');
  return `<section id="gallery" class="section">
      <div class="container">
        <h2 class="section-title">${esc(m.gallery.heading)}</h2>
        <div class="gallery">
          ${items}
        </div>
      </div>
    </section>`;
}
function renderTestimonials(m) {
  const items = m.testimonials.items.map(it => `<blockquote class="quote reveal">
            <p>“${esc(it.quote)}”</p>
            <footer><strong>${esc(it.author)}</strong>${it.role ? ` · <span>${esc(it.role)}</span>` : ''}</footer>
          </blockquote>`).join('\n          ');
  return `<section id="testimonials" class="section section-alt">
      <div class="container">
        <h2 class="section-title">${esc(m.testimonials.heading)}</h2>
        <div class="quotes">
          ${items}
        </div>
      </div>
    </section>`;
}
function renderPricing(m) {
  const plans = m.pricing.plans.map(p => `<div class="plan${p.featured ? ' plan-featured' : ''} reveal">
            <h3>${esc(p.name)}</h3>
            <div class="plan-price">${esc(p.price)}${p.period ? `<span>/${esc(p.period)}</span>` : ''}</div>
            <ul>${(p.features || []).map(f => `<li>${esc(f)}</li>`).join('')}</ul>
          </div>`).join('\n          ');
  return `<section id="pricing" class="section">
      <div class="container">
        <h2 class="section-title">${esc(m.pricing.heading)}</h2>
        <div class="plans">
          ${plans}
        </div>
      </div>
    </section>`;
}
function renderContact(m, brief) {
  const L = brief.language;
  const c = brief.contact;
  const info = [];
  if (c.email) info.push(`<a href="mailto:${attr(c.email)}">✉ ${esc(c.email)}</a>`);
  if (c.phone) info.push(`<a href="tel:${attr(c.phone.replace(/\s+/g, ''))}">☎ ${esc(c.phone)}</a>`);
  if (c.address) info.push(`<span>📍 ${esc(c.address)}</span>`);
  const formAttrs = brief.formAction
    ? `action="${attr(brief.formAction)}" method="POST"`
    : `data-mailto="${attr(c.email || '')}"`;
  return `<section id="contact" class="section section-alt">
      <div class="container contact-grid">
        <div class="contact-info">
          <h2 class="section-title">${esc(m.contact.heading)}</h2>
          <p>${esc(m.contact.intro)}</p>
          <div class="contact-list">${info.join('\n          ')}</div>
        </div>
        <form class="contact-form" ${formAttrs}>
          <label>${t(L, 'Nom', 'Name')}<input type="text" name="name" required autocomplete="name"/></label>
          <label>${t(L, 'Email', 'Email')}<input type="email" name="email" required autocomplete="email"/></label>
          <label>${t(L, 'Message', 'Message')}<textarea name="message" rows="4" required></textarea></label>
          <button type="submit" class="btn btn-primary">${t(L, 'Envoyer', 'Send')}</button>
          <p class="form-note" role="status" aria-live="polite"></p>
        </form>
      </div>
    </section>`;
}
function t(lang, fr, en) { return lang === 'en' ? en : fr; }

const RENDERERS = { hero: renderHero, about: renderAbout, services: renderServices, gallery: renderGallery, testimonials: renderTestimonials, pricing: renderPricing, contact: renderContact };

// ---------------------------------------------------------------------- style
function renderCSS(theme) {
  const dark = !!theme.dark;
  return `:root{
  --primary:${theme.primary};--primary-d:${theme.primaryDark};--accent:${theme.accent};
  --bg:${theme.bg};--surface:${theme.surface};--text:${theme.text};--muted:${theme.muted};
  --radius:${theme.radius};--maxw:1120px;
  --hfont:${theme.headingFont};--bfont:${theme.bodyFont};
  --border:${dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.08)'};
  --shadow:0 10px 30px -12px rgba(0,0,0,${dark ? '.6' : '.18'});
}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:var(--bfont);color:var(--text);background:var(--bg);line-height:1.6;-webkit-font-smoothing:antialiased}
img{max-width:100%;display:block}
a{color:inherit;text-decoration:none}
.container{width:100%;max-width:var(--maxw);margin:0 auto;padding:0 20px}
h1,h2,h3{font-family:var(--hfont);line-height:1.15;letter-spacing:-.01em}
.section{padding:72px 0}
.section-alt{background:${dark ? 'rgba(255,255,255,.03)' : 'rgba(0,0,0,.025)'}}
.section-title{font-size:clamp(24px,4vw,34px);margin-bottom:28px;position:relative;padding-bottom:12px}
.section-title::after{content:"";position:absolute;left:0;bottom:0;width:56px;height:4px;border-radius:3px;background:linear-gradient(90deg,var(--primary),var(--accent))}
.btn{display:inline-block;padding:12px 22px;border-radius:var(--radius);font-weight:700;cursor:pointer;border:1px solid transparent;transition:transform .15s ease,box-shadow .15s ease;font-family:var(--bfont);font-size:15px}
.btn-primary{background:linear-gradient(135deg,var(--primary),var(--primary-d));color:#fff;box-shadow:var(--shadow)}
.btn-primary:hover{transform:translateY(-2px)}
.btn-ghost{background:transparent;border-color:var(--border);color:var(--text)}
.btn-ghost:hover{border-color:var(--primary)}

/* header */
.site-header{position:sticky;top:0;z-index:50;background:${dark ? 'rgba(11,11,20,.72)' : 'rgba(255,255,255,.78)'};backdrop-filter:blur(10px);border-bottom:1px solid var(--border)}
.nav{display:flex;align-items:center;gap:16px;padding:14px 20px;max-width:var(--maxw);margin:0 auto}
.brand{display:flex;align-items:center;gap:10px;font-family:var(--hfont);font-weight:800;font-size:18px}
.brand img{width:30px;height:30px}
.nav-links{margin-left:auto;display:flex;gap:6px;align-items:center}
.nav-links a{padding:8px 12px;border-radius:9px;font-size:14px;color:var(--muted);transition:color .15s,background .15s}
.nav-links a:hover{color:var(--text);background:${dark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)'}}
.nav-toggle{display:none;margin-left:auto;background:none;border:1px solid var(--border);border-radius:9px;padding:8px 10px;cursor:pointer;color:var(--text);font-size:18px}

/* hero */
.hero{position:relative;padding:104px 0 92px;text-align:center;background:
  radial-gradient(900px 420px at 80% -10%,color-mix(in srgb,var(--primary) 22%,transparent),transparent 60%),
  radial-gradient(700px 380px at -10% 10%,color-mix(in srgb,var(--accent) 18%,transparent),transparent 55%),var(--bg)}
.hero-inner{max-width:820px}
.hero h1{font-size:clamp(32px,6vw,56px);margin-bottom:18px;background:linear-gradient(135deg,var(--primary),var(--accent));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.hero .lead{font-size:clamp(16px,2.4vw,20px);color:var(--muted);max-width:640px;margin:0 auto 28px}
.hero-cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}

/* about */
.about-grid{display:grid;grid-template-columns:1.5fr 1fr;gap:32px;align-items:center}
.about-text p{margin-bottom:14px;color:var(--muted)}
.about-badge{aspect-ratio:1;border-radius:24px;background:linear-gradient(135deg,var(--primary),var(--accent));display:flex;align-items:center;justify-content:center;box-shadow:var(--shadow)}
.about-badge span{font-family:var(--hfont);font-size:96px;font-weight:800;color:#fff;opacity:.9}

/* cards */
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:24px;box-shadow:var(--shadow);transition:transform .18s ease}
.card:hover{transform:translateY(-4px)}
.card-icon{width:46px;height:46px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;color:#fff;background:linear-gradient(135deg,var(--primary),var(--accent));margin-bottom:14px}
.card h3{margin-bottom:8px;font-size:19px}
.card p{color:var(--muted);font-size:15px}

/* gallery */
.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}
.gallery-item{border-radius:var(--radius);overflow:hidden;border:1px solid var(--border);background:var(--surface);position:relative}
.gallery-item img{width:100%;height:auto;transition:transform .3s ease}
.gallery-item:hover img{transform:scale(1.04)}
.gallery-item figcaption{position:absolute;left:0;right:0;bottom:0;padding:10px 12px;font-size:13px;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.55))}

/* testimonials */
.quotes{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}
.quote{background:var(--surface);border:1px solid var(--border);border-left:4px solid var(--primary);border-radius:var(--radius);padding:22px}
.quote p{font-style:italic;margin-bottom:12px}
.quote footer{font-size:14px;color:var(--muted)}

/* pricing */
.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px;align-items:stretch}
.plan{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:26px;text-align:center}
.plan-featured{border-color:var(--primary);box-shadow:var(--shadow);transform:scale(1.03)}
.plan-price{font-family:var(--hfont);font-size:34px;font-weight:800;margin:12px 0;color:var(--primary)}
.plan-price span{font-size:14px;color:var(--muted);font-weight:400}
.plan ul{list-style:none;text-align:left;margin-top:12px}
.plan li{padding:7px 0 7px 24px;position:relative;color:var(--muted);font-size:14px;border-top:1px solid var(--border)}
.plan li::before{content:"✓";position:absolute;left:0;color:var(--primary);font-weight:700}

/* contact */
.contact-grid{display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:start}
.contact-info p{color:var(--muted);margin-bottom:16px}
.contact-list{display:flex;flex-direction:column;gap:10px}
.contact-list a,.contact-list span{color:var(--text);font-size:15px}
.contact-form{display:flex;flex-direction:column;gap:12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:22px;box-shadow:var(--shadow)}
.contact-form label{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:600;color:var(--muted)}
.contact-form input,.contact-form textarea{font-family:var(--bfont);font-size:15px;padding:11px 12px;border:1px solid var(--border);border-radius:10px;background:var(--bg);color:var(--text);outline:none}
.contact-form input:focus,.contact-form textarea:focus{border-color:var(--primary)}
.form-note{font-size:13px;min-height:16px;color:var(--primary)}

/* footer */
.site-footer{padding:34px 0;border-top:1px solid var(--border);text-align:center;color:var(--muted);font-size:14px}
.site-footer .socials{display:flex;gap:14px;justify-content:center;margin-bottom:12px}
.site-footer .socials a{color:var(--muted)}
.site-footer .socials a:hover{color:var(--primary)}

/* reveal animation */
.reveal{opacity:0;transform:translateY(18px);transition:opacity .6s ease,transform .6s ease}
.reveal.visible{opacity:1;transform:none}
@media(prefers-reduced-motion:reduce){.reveal{opacity:1;transform:none;transition:none}}

@media(max-width:820px){
  .about-grid,.contact-grid{grid-template-columns:1fr}
  .about-badge{max-width:220px;margin:0 auto}
  .nav-links{position:fixed;inset:60px 12px auto 12px;flex-direction:column;align-items:stretch;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:10px;box-shadow:var(--shadow);display:none}
  .nav-links.open{display:flex}
  .nav-toggle{display:block}
}
`;
}

// ------------------------------------------------------------------------- js
function renderJS(lang) {
  const sent = lang === 'en'
    ? { sending: 'Opening your email app…', ok: 'Thanks! We will get back to you.', fill: 'Please fill in all fields.' }
    : { sending: 'Ouverture de votre messagerie…', ok: 'Merci ! Nous revenons vers vous.', fill: 'Merci de remplir tous les champs.' };
  return `// main.js — CSP-safe (aucun handler inline, tout en addEventListener)
(function(){
  'use strict';
  // Menu mobile
  var toggle = document.querySelector('.nav-toggle');
  var links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', function(){
      var open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    links.addEventListener('click', function(e){ if (e.target.tagName === 'A') links.classList.remove('open'); });
  }
  // Révélation au scroll
  var els = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(en){ if (en.isIntersecting){ en.target.classList.add('visible'); io.unobserve(en.target); } });
    }, { threshold: 0.12 });
    els.forEach(function(el){ io.observe(el); });
  } else { els.forEach(function(el){ el.classList.add('visible'); }); }
  // Formulaire de contact : si pas d'action serveur -> fallback mailto (100% statique)
  var form = document.querySelector('.contact-form');
  if (form && !form.getAttribute('action')) {
    form.addEventListener('submit', function(e){
      e.preventDefault();
      var note = form.querySelector('.form-note');
      var name = form.name && form.name.value.trim();
      var email = form.email && form.email.value.trim();
      var msg = form.message && form.message.value.trim();
      if (!name || !email || !msg) { if (note) note.textContent = ${JSON.stringify(sent.fill)}; return; }
      var to = form.getAttribute('data-mailto') || '';
      var subject = encodeURIComponent('Contact site — ' + name);
      var body = encodeURIComponent(name + ' (' + email + ')\\n\\n' + msg);
      if (note) note.textContent = ${JSON.stringify(sent.sending)};
      window.location.href = 'mailto:' + to + '?subject=' + subject + '&body=' + body;
      setTimeout(function(){ if (note) note.textContent = ${JSON.stringify(sent.ok)}; form.reset(); }, 400);
    });
  }
  // Année du footer
  var y = document.querySelector('[data-year]'); if (y) y.textContent = new Date().getFullYear();
})();
`;
}

// -------------------------------------------------------------------- assembly
function renderSite(brief, theme, model, opts = {}) {
  const L = brief.language;
  const labels = SECTION_LABELS[L] || SECTION_LABELS.fr;
  const siteUrl = (opts.siteUrl || '').replace(/\/+$/, '');
  const files = [];

  // JSON-LD (SEO structuré) — inline, sécurisé par hash dans la CSP
  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: brief.name,
    description: model.seo.description,
    ...(brief.contact.phone ? { telephone: brief.contact.phone } : {}),
    ...(brief.contact.email ? { email: brief.contact.email } : {}),
    ...(brief.contact.address ? { address: brief.contact.address } : {}),
    ...(siteUrl ? { url: siteUrl } : {})
  };
  const jsonldStr = JSON.stringify(jsonld);
  const jsonldHash = 'sha256-' + crypto.createHash('sha256').update(jsonldStr).digest('base64');

  const nav = brief.sections.map(s => `<a href="#${s}">${esc(labels[s] || s)}</a>`).join('');
  const sectionsHtml = brief.sections.map(s => (RENDERERS[s] ? RENDERERS[s](model, brief) : '')).join('\n    ');

  const socials = [];
  const S = brief.social;
  if (S.facebook) socials.push(`<a href="${attr(S.facebook)}" rel="noopener" target="_blank" aria-label="Facebook">Facebook</a>`);
  if (S.instagram) socials.push(`<a href="${attr(S.instagram)}" rel="noopener" target="_blank" aria-label="Instagram">Instagram</a>`);
  if (S.linkedin) socials.push(`<a href="${attr(S.linkedin)}" rel="noopener" target="_blank" aria-label="LinkedIn">LinkedIn</a>`);
  if (S.whatsapp) socials.push(`<a href="${attr(S.whatsapp)}" rel="noopener" target="_blank" aria-label="WhatsApp">WhatsApp</a>`);

  const html = `<!DOCTYPE html>
<html lang="${attr(L)}">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${esc(model.seo.title)}</title>
  <meta name="description" content="${attr(model.seo.description)}"/>
  <meta name="keywords" content="${attr(model.seo.keywords.join(', '))}"/>
  <meta name="theme-color" content="${attr(theme.primary)}"/>
  ${siteUrl ? `<link rel="canonical" href="${attr(siteUrl)}/"/>` : ''}
  <meta property="og:type" content="website"/>
  <meta property="og:title" content="${attr(model.seo.title)}"/>
  <meta property="og:description" content="${attr(model.seo.description)}"/>
  ${siteUrl ? `<meta property="og:url" content="${attr(siteUrl)}/"/>` : ''}
  <meta name="twitter:card" content="summary_large_image"/>
  <link rel="icon" type="image/svg+xml" href="assets/favicon.svg"/>
  <link rel="manifest" href="site.webmanifest"/>
  <link rel="stylesheet" href="assets/style.css"/>
  <script type="application/ld+json">${jsonldStr}</script>
</head>
<body>
  <header class="site-header">
    <nav class="nav" aria-label="Navigation principale">
      <a class="brand" href="#hero"><img src="assets/favicon.svg" alt="" width="30" height="30"/>${esc(brief.name)}</a>
      <button class="nav-toggle" aria-label="Menu" aria-expanded="false">☰</button>
      <div class="nav-links">${nav}</div>
    </nav>
  </header>
  <main>
    ${sectionsHtml}
  </main>
  <footer class="site-footer">
    <div class="container">
      ${socials.length ? `<div class="socials">${socials.join('')}</div>` : ''}
      <p>© <span data-year>${new Date().getFullYear()}</span> ${esc(brief.name)}. ${t(L, 'Tous droits réservés.', 'All rights reserved.')}</p>
      <p style="opacity:.7;font-size:12px;margin-top:6px">${t(L, 'Site généré avec', 'Site generated with')} EPITNET Vitrine Generator</p>
    </div>
  </footer>
  <script src="assets/main.js"></script>
</body>
</html>
`;

  files.push({ path: 'index.html', content: html });
  files.push({ path: 'assets/style.css', content: renderCSS(theme) });
  files.push({ path: 'assets/main.js', content: renderJS(L) });
  files.push({ path: 'assets/favicon.svg', content: faviconSVG(theme, brief.name) });

  // Images de galerie (si section présente)
  if (brief.sections.includes('gallery')) {
    model.gallery.items.forEach((it, i) => {
      files.push({ path: `assets/img/gallery-${i + 1}.svg`, content: gallerySVG(theme, i + 1, it.caption) });
    });
  }

  // SEO : robots, sitemap, manifest
  files.push({ path: 'robots.txt', content: `User-agent: *\nAllow: /\n${siteUrl ? `Sitemap: ${siteUrl}/sitemap.xml\n` : ''}` });
  files.push({ path: 'sitemap.xml', content: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${esc(siteUrl || 'https://example.com')}/</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>\n</urlset>\n` });
  files.push({ path: 'site.webmanifest', content: JSON.stringify({
    name: brief.name, short_name: brief.name.slice(0, 12), start_url: '.', display: 'standalone',
    background_color: theme.bg, theme_color: theme.primary,
    icons: [{ src: 'assets/favicon.svg', sizes: 'any', type: 'image/svg+xml' }]
  }, null, 2) });

  // Config d'hébergement (optimisation) — CSP stricte via hash du JSON-LD
  const csp = `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self' '${jsonldHash}'; base-uri 'self'; form-action 'self' mailto:; frame-ancestors 'none'; object-src 'none'`;
  files.push({ path: '_headers', content: netlifyHeaders(csp) });
  files.push({ path: '.htaccess', content: apacheHtaccess(csp) });

  return { files, jsonldHash, meta: { theme: theme.name, sections: brief.sections, ai: !!opts.ai } };
}

function netlifyHeaders(csp) {
  return `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Content-Security-Policy: ${csp}
  Permissions-Policy: geolocation=(), microphone=(), camera=()

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;
}
function apacheHtaccess(csp) {
  return `# Optimisation hébergement mutualisé (Apache/cPanel)
<IfModule mod_headers.c>
  Header set X-Content-Type-Options "nosniff"
  Header set X-Frame-Options "DENY"
  Header set Referrer-Policy "no-referrer"
  Header set Content-Security-Policy "${csp}"
  <FilesMatch "\\.(css|js|svg|png|jpg|jpeg|webp|woff2)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
</IfModule>
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css application/javascript image/svg+xml application/json
</IfModule>
<IfModule mod_mime.c>
  AddType image/svg+xml .svg
</IfModule>
ErrorDocument 404 /index.html
`;
}

module.exports = { renderSite, esc };
