'use strict';
// Construit un HTML autonome (CSS/JS/images inlinés) pour la prévisualisation
// live dans une iframe. En multi-pages, la preview montre la page d'accueil.

const MIME = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

function asString(c) { return Buffer.isBuffer(c) ? c.toString('utf8') : String(c); }

function dataUri(path, content) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  if (ext === 'svg') return 'data:image/svg+xml;utf8,' + encodeURIComponent(asString(content));
  const b64 = Buffer.isBuffer(content) ? content.toString('base64') : Buffer.from(String(content), 'utf8').toString('base64');
  return `data:${mime};base64,${b64}`;
}

function buildPreview(files) {
  const m = new Map(files.map(f => [f.path, f.content]));
  let html = asString(m.get('index.html') || '');
  html = html.replace(/<link rel="stylesheet" href="assets\/style\.css"\/?>/, `<style>${asString(m.get('assets/style.css') || '')}</style>`);
  html = html.replace(/<script src="assets\/main\.js"><\/script>/, `<script>${asString(m.get('assets/main.js') || '')}</script>`);
  // Inline toutes les images (svg/png/jpg/webp) en data URI
  for (const [path, content] of m) {
    if (/\.(svg|png|jpe?g|webp|gif)$/i.test(path)) html = html.split(path).join(dataUri(path, content));
  }
  html = html.replace(/<link rel="manifest"[^>]*>/, '');
  return html;
}

module.exports = { buildPreview };
