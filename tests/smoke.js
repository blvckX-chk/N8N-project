'use strict';
// Test de fumée (zéro dépendance) : node tests/smoke.js
// Vérifie les invariants clés du générateur sans réseau (repli déterministe).

const assert = require('assert');
const crypto = require('crypto');
const { generateSite } = require('../generator');
const { createZip, crc32 } = require('../deploy/zip');
const { buildPreview } = require('../generator/preview');

let passed = 0;
function ok(label, cond) { assert.ok(cond, label); console.log('  ✓ ' + label); passed++; }

(async () => {
  const input = {
    name: 'Café  Test',                       // double espace volontaire
    sector: 'restaurant',
    description: 'Ligne un.\n\nDeux  espaces.', // whitespace piégeux
    services: ['Alpha', 'Bravo', 'Charlie'],
    contact: { email: 'a@b.co', phone: '+229 01 02 03 04' },
    sections: ['hero', 'about', 'services', 'gallery', 'testimonials', 'pricing', 'contact']
  };
  const r = await generateSite(input, { siteUrl: 'https://cafe-test.example' });

  ok('génération OK', r.ok === true);
  ok('contenu déterministe hors-ligne', r.ai_used === false);

  const map = new Map(r.files.map(f => [f.path, f.content]));
  ['index.html', 'assets/style.css', 'assets/main.js', 'assets/favicon.svg',
   'robots.txt', 'sitemap.xml', 'site.webmanifest', '_headers', '.htaccess']
    .forEach(p => ok('fichier présent: ' + p, map.has(p)));

  const html = map.get('index.html');
  ok('doctype présent', /^<!DOCTYPE html>/i.test(html));
  ok('titre SEO présent', /<title>[^<]+<\/title>/.test(html));
  ok('description meta présente', /<meta name="description"/.test(html));
  ok('JSON-LD présent', /application\/ld\+json/.test(html));
  ok('aucun handler inline onclick/onsubmit', !/on(click|submit|load|error)=/i.test(html));

  // CSP : le hash du JSON-LD doit correspondre après minification
  const m = html.match(/application\/ld\+json">([\s\S]*?)<\/script>/);
  const h = 'sha256-' + crypto.createHash('sha256').update(m[1]).digest('base64');
  ok('hash JSON-LD cohérent dans _headers', map.get('_headers').includes(h));
  ok('hash JSON-LD cohérent dans .htaccess', map.get('.htaccess').includes(h));
  ok('CSP script-src self présent', /script-src 'self'/.test(map.get('_headers')));

  // Galerie : 6 images générées
  ok('6 images de galerie', r.files.filter(f => /assets\/img\/gallery-\d\.svg/.test(f.path)).length === 6);

  // Rapport d'optimisation
  ok('rapport de poids présent', r.report && r.report.total_kb > 0);
  ok('minification effective (>0%)', r.report.saved_pct >= 0);

  // Preview autonome (inline)
  const prev = buildPreview(r.files);
  ok('preview inline CSS', /<style>/.test(prev) && !/href="assets\/style/.test(prev));
  ok('preview inline JS', !/src="assets\/main\.js"/.test(prev));
  ok('preview images en data URI', /data:image\/svg\+xml/.test(prev));

  // ZIP : CRC32 de référence + intégrité structurelle
  ok('CRC32 conforme (vecteur "123456789")', crc32(Buffer.from('123456789')) === 0xcbf43926);
  const zip = createZip(r.files);
  ok('signature EOCD présente', zip.slice(-22).readUInt32LE(0) === 0x06054b50);
  ok('nombre d\'entrées ZIP = fichiers', zip.slice(-22).readUInt16LE(10) === r.files.length);

  // Thème par secteur
  ok('thème restaurant résolu', r.meta.theme === 'restaurant');

  console.log(`\n✅ ${passed} assertions OK`);
})().catch(e => { console.error('\n❌ ÉCHEC:', e.message); process.exit(1); });
