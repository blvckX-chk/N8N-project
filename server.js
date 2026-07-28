#!/usr/bin/env node
'use strict';
// Panneau web + API du générateur de sites vitrines (http natif, zéro dépendance).
//
//   node server.js            (PORT=3200 par défaut)
//
// Routes :
//   GET  /                 -> panneau
//   POST /api/generate     -> { files, report, meta, preview }
//   POST /api/zip          -> archive .zip (à uploader par FTP)
//   POST /api/deploy       -> déploiement Netlify (NETLIFY_AUTH_TOKEN requis)

require('./load-env');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { generateSite } = require('./generator');
const { buildPreview } = require('./generator/preview');
const { createZip } = require('./deploy/zip');

const PORT = process.env.PORT || 3200;
const MAX_BODY = 6 * 1024 * 1024; // 6 Mo

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new Error('Corps trop volumineux')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(new Error('JSON invalide')); } });
    req.on('error', reject);
  });
}

function safeFiles(input) {
  if (!Array.isArray(input)) throw new Error('files manquant');
  return input.filter(f => f && typeof f.path === 'string' && typeof f.content === 'string')
    .map(f => ({ path: f.path.replace(/^\/+/, '').replace(/\.\.+/g, ''), content: f.content }));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
      return send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8' });
    }

    if (req.method === 'POST' && req.url === '/api/generate') {
      const body = await readBody(req);
      const result = await generateSite(body, { siteUrl: body.siteUrl || '' });
      const preview = buildPreview(result.files);
      return send(res, 200, {
        ok: true, name: result.name, slug: result.slug,
        files: result.files.map(f => ({ path: f.path, content: f.content })),
        report: result.report, meta: result.meta,
        content_source: result.content_source, ai_used: result.ai_used, ai_error: result.ai_error,
        preview
      });
    }

    if (req.method === 'POST' && req.url === '/api/zip') {
      const body = await readBody(req);
      const files = safeFiles(body.files);
      const name = (body.filename || 'site').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/\.zip$/i, '') || 'site';
      const zip = createZip(files);
      return send(res, 200, zip, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${name}.zip"`
      });
    }

    if (req.method === 'POST' && req.url === '/api/deploy') {
      const body = await readBody(req);
      const target = body.target || 'netlify';
      if (target !== 'netlify') return send(res, 400, { ok: false, error: `Cible non supportée: ${target}` });
      if (!process.env.NETLIFY_AUTH_TOKEN) return send(res, 400, { ok: false, error: 'NETLIFY_AUTH_TOKEN non configuré sur le serveur', fix: 'Définis la variable d\'environnement NETLIFY_AUTH_TOKEN puis relance le serveur.' });
      const files = safeFiles(body.files);
      const { deployNetlify } = require('./deploy/netlify');
      const dep = await deployNetlify(files, { siteName: body.siteName, siteId: body.siteId });
      return send(res, 200, { ok: true, ...dep });
    }

    return send(res, 404, { ok: false, error: 'Not found' });
  } catch (e) {
    return send(res, 500, { ok: false, error: String(e.message || e) });
  }
});

server.listen(PORT, () => console.log(`🌐 Panneau vitrine sur http://localhost:${PORT}`));
