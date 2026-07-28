'use strict';
// Construit un HTML autonome (CSS/JS/images inlinés) pour la prévisualisation
// live dans une iframe. Les fichiers livrables restent séparés/optimisés ;
// seule la preview est inlinée (les chemins relatifs ne résolvent pas en srcdoc).

function fileMap(files) {
  const m = new Map();
  for (const f of files) m.set(f.path, f.content);
  return m;
}

function buildPreview(files) {
  const m = fileMap(files);
  let html = m.get('index.html') || '';
  const css = m.get('assets/style.css') || '';
  const js = m.get('assets/main.js') || '';

  // Inline CSS
  html = html.replace(/<link rel="stylesheet" href="assets\/style\.css"\/?>/, `<style>${css}</style>`);
  // Inline JS
  html = html.replace(/<script src="assets\/main\.js"><\/script>/, `<script>${js}</script>`);
  // Inline images SVG (favicon + galerie) en data URI
  for (const [path, content] of m) {
    if (/\.svg$/.test(path)) {
      const dataUri = 'data:image/svg+xml;utf8,' + encodeURIComponent(content);
      html = html.split(path).join(dataUri);
    }
  }
  // manifest non pertinent en preview
  html = html.replace(/<link rel="manifest"[^>]*>/, '');
  return html;
}

module.exports = { buildPreview };
