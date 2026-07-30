'use strict';
// Tests v2 (zéro dépendance, sans réseau) : node tests/v2.js
// Multi-pages · vrais visuels · override de thème · helpers FTP · modules deploy.

const assert = require('assert');
const crypto = require('crypto');
const { generateSite } = require('../generator');
const { createZip } = require('../deploy/zip');
const { parsePasv, remotePath, dirsFor } = require('../deploy/ftp');

let passed = 0;
function ok(label, cond) { assert.ok(cond, label); console.log('  ✓ ' + label); passed++; }
function hashOf(html) {
  const m = html.match(/application\/ld\+json">([\s\S]*?)<\/script>/);
  return 'sha256-' + crypto.createHash('sha256').update(m[1]).digest('base64');
}
// PNG 1x1 transparent
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

(async () => {
  // ---------------------------------------------------------------- multi-pages
  const multi = await generateSite({
    name: 'Agence Nova', sector: 'business', layout: 'multi',
    services: ['Stratégie', 'Design', 'Développement'],
    sections: ['hero', 'about', 'services', 'gallery', 'testimonials', 'contact'],
    contact: { email: 'hi@nova.co' }
  }, { siteUrl: 'https://nova.example' });

  const map = new Map(multi.files.map(f => [f.path, f.content]));
  ok('layout multi dans meta', multi.meta.layout === 'multi');
  ['index.html', 'about.html', 'services.html', 'gallery.html', 'testimonials.html', 'contact.html']
    .forEach(p => ok('page présente: ' + p, map.has(p)));
  ok('meta.pages = 6', multi.meta.pages === 6);

  const headersCsp = map.get('_headers');
  const home = map.get('index.html');
  ok('accueil : nav vers about.html', /href="about\.html"/.test(home));
  ok('accueil : teasers présents', /class="teaser/.test(home));
  ok('accueil : bande CTA', /class="cta-band/.test(home));
  const about = map.get('about.html');
  ok('page about : lien actif', /class="active" aria-current="page"/.test(about));
  ok('page about : brand -> index.html', /class="brand" href="index\.html"/.test(about));

  // CSP : le hash unique doit couvrir TOUTES les pages HTML
  const htmlPages = multi.files.filter(f => /\.html$/.test(f.path));
  const allMatch = htmlPages.every(f => headersCsp.includes(hashOf(f.content)));
  ok('hash JSON-LD unique valable sur toutes les pages', allMatch);

  // sitemap liste toutes les pages
  const sitemap = map.get('sitemap.xml');
  ok('sitemap : 6 URLs', (sitemap.match(/<url>/g) || []).length === 6);
  ok('sitemap : page about listée', sitemap.includes('/about.html'));

  // ---------------------------------------------------------------- vrais visuels
  const withImg = await generateSite({
    name: 'Studio Pixel', sector: 'portfolio', logo: PNG, images: [PNG, PNG],
    sections: ['hero', 'gallery', 'contact']
  }, {});
  const im = new Map(withImg.files.map(f => [f.path, f.content]));
  ok('logo écrit en fichier', im.has('assets/logo.png') && Buffer.isBuffer(im.get('assets/logo.png')));
  ok('galerie img 1 = png fourni', im.has('assets/img/gallery-1.png'));
  ok('galerie img 2 = png fourni', im.has('assets/img/gallery-2.png'));
  ok('galerie img 3 = repli svg', im.has('assets/img/gallery-3.svg'));
  ok('index utilise le logo', im.get('index.html').includes('assets/logo.png'));
  ok('manifest référence le logo', im.get('site.webmanifest').includes('assets/logo.png'));
  // ZIP avec binaire : intègre et compte correct
  const zip = createZip(withImg.files);
  ok('ZIP (avec binaire) EOCD ok', zip.slice(-22).readUInt32LE(0) === 0x06054b50);
  ok('ZIP entrées = fichiers', zip.slice(-22).readUInt16LE(10) === withImg.files.length);

  // les URLs externes (non data:) sont ignorées (CSP préservée)
  const extImg = await generateSite({ name: 'X', sector: 'tech', logo: 'https://evil.example/l.png' }, {});
  ok('logo URL externe ignoré (repli favicon)', new Map(extImg.files.map(f => [f.path, f.content])).get('index.html').includes('assets/favicon.svg'));

  // ---------------------------------------------------------------- override thème
  const forced = await generateSite({ name: 'Resto', sector: 'restaurant', theme: 'tech' }, {});
  ok('override de thème appliqué (tech sur secteur restaurant)', forced.meta.theme === 'tech');
  const badTheme = await generateSite({ name: 'Resto', sector: 'restaurant', theme: 'inexistant' }, {});
  ok('thème inconnu -> repli secteur', badTheme.meta.theme === 'restaurant');

  // ---------------------------------------------------------------- helpers FTP
  const pasv = parsePasv('227 Entering Passive Mode (192,168,1,10,200,21).');
  ok('parsePasv ip', pasv.ip === '192.168.1.10');
  ok('parsePasv port', pasv.port === 200 * 256 + 21);
  ok('remotePath joint et assainit', remotePath('public_html', 'assets/style.css') === '/public_html/assets/style.css');
  ok('remotePath bloque ..', !remotePath('/', '../../etc/passwd').includes('..'));
  const dirs = dirsFor([{ path: 'assets/img/x.svg' }, { path: 'index.html' }], '/public_html');
  ok('dirsFor ordonne du parent vers enfant', dirs[0].split('/').length <= dirs[dirs.length - 1].split('/').length);
  ok('dirsFor inclut assets/img', dirs.includes('/public_html/assets/img'));

  // ---------------------------------------------------------------- modules deploy
  ok('module netlify chargeable', typeof require('../deploy/netlify').deployNetlify === 'function');
  ok('module vercel chargeable', typeof require('../deploy/vercel').deployVercel === 'function');
  ok('module ftp chargeable', typeof require('../deploy/ftp').deployFtp === 'function');

  console.log(`\n✅ ${passed} assertions v2 OK`);
})().catch(e => { console.error('\n❌ ÉCHEC:', e.stack || e.message); process.exit(1); });
