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
const { THEME_NAMES } = require('./generator/themes');

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

// Transport JSON des fichiers : le binaire (images) voyage en base64.
function encodeFiles(files) {
  return files.map(f => Buffer.isBuffer(f.content)
    ? { path: f.path, content: f.content.toString('base64'), binary: true }
    : { path: f.path, content: String(f.content), binary: false });
}
function safeFiles(input) {
  if (!Array.isArray(input)) throw new Error('files manquant');
  return input.filter(f => f && typeof f.path === 'string' && typeof f.content === 'string')
    .map(f => ({
      path: f.path.replace(/^\/+/, '').replace(/\.\.+/g, ''),
      content: f.binary ? Buffer.from(f.content, 'base64') : f.content
    }));
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
        files: encodeFiles(result.files),
        report: result.report, meta: result.meta,
        content_source: result.content_source, ai_used: result.ai_used, ai_error: result.ai_error,
        preview
      });
    }

    if (req.method === 'GET' && req.url === '/api/themes') {
      return send(res, 200, { ok: true, themes: THEME_NAMES });
    }

    if (req.method === 'POST' && req.url === '/api/preview-themes') {
      const body = await readBody(req);
      const names = Array.isArray(body.themes) && body.themes.length ? body.themes : THEME_NAMES;
      const out = [];
      for (const name of names.slice(0, 8)) {
        const r = await generateSite({ ...body, theme: name, layout: 'single' }, { siteUrl: '', theme: name });
        out.push({ theme: name, preview: buildPreview(r.files) });
      }
      return send(res, 200, { ok: true, previews: out });
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
      const files = safeFiles(body.files);

      if (target === 'netlify') {
        if (!process.env.NETLIFY_AUTH_TOKEN) return send(res, 400, { ok: false, error: 'NETLIFY_AUTH_TOKEN non configuré sur le serveur', fix: 'Définis NETLIFY_AUTH_TOKEN dans .env puis relance le serveur.' });
        const { deployNetlify } = require('./deploy/netlify');
        return send(res, 200, { ok: true, target, ...(await deployNetlify(files, { siteName: body.siteName, siteId: body.siteId })) });
      }
      if (target === 'vercel') {
        if (!process.env.VERCEL_TOKEN) return send(res, 400, { ok: false, error: 'VERCEL_TOKEN non configuré sur le serveur', fix: 'Définis VERCEL_TOKEN dans .env puis relance le serveur.' });
        const { deployVercel } = require('./deploy/vercel');
        return send(res, 200, { ok: true, target, ...(await deployVercel(files, { name: body.siteName })) });
      }
      if (target === 'ftp') {
        const { deployFtp } = require('./deploy/ftp');
        const cfg = body.ftp || {};
        if (!cfg.host || !cfg.user || !cfg.password) return send(res, 400, { ok: false, error: 'Paramètres FTP manquants (host, user, password).' });
        return send(res, 200, { ok: true, target, ...(await deployFtp(files, cfg)) });
      }
      return send(res, 400, { ok: false, error: `Cible non supportée: ${target}` });
    }

    return send(res, 404, { ok: false, error: 'Not found' });
  } catch (e) {
    return send(res, 500, { ok: false, error: String(e.message || e) });
  }
});

server.listen(PORT, () => console.log(`🌐 Panneau vitrine sur http://localhost:${PORT}`));
