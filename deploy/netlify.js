'use strict';
// Déploiement statique sur Netlify via l'API (digest deploy).
// Requiert un token (NETLIFY_AUTH_TOKEN). Crée le site si besoin, puis pousse
// uniquement les fichiers dont l'empreinte SHA1 manque côté Netlify.

const crypto = require('crypto');
const API = 'https://api.netlify.com/api/v1';

function sha1(buf) { return crypto.createHash('sha1').update(buf).digest('hex'); }

async function jsonReq(url, opts, token) {
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`Netlify HTTP ${res.status}: ${data.message || text.slice(0, 200)}`);
  return data;
}

async function deployNetlify(files, opts = {}) {
  const token = opts.token || process.env.NETLIFY_AUTH_TOKEN;
  if (!token) throw new Error('NETLIFY_AUTH_TOKEN manquant');

  // 1) Site : réutiliser ou créer
  let siteId = opts.siteId;
  let siteInfo;
  if (!siteId) {
    siteInfo = await jsonReq(`${API}/sites`, {
      method: 'POST',
      body: JSON.stringify(opts.siteName ? { name: opts.siteName } : {})
    }, token);
    siteId = siteInfo.id;
  }

  // 2) Empreintes SHA1 (chemins commençant par /)
  const buffers = new Map();
  const digest = {};
  for (const f of files) {
    const p = '/' + f.path.replace(/^\/+/, '');
    const buf = Buffer.isBuffer(f.content) ? f.content : Buffer.from(String(f.content), 'utf8');
    buffers.set(p, buf);
    digest[p] = sha1(buf);
  }

  // 3) Créer le déploiement -> Netlify renvoie les fichiers à uploader
  const deploy = await jsonReq(`${API}/sites/${siteId}/deploys`, {
    method: 'POST',
    body: JSON.stringify({ files: digest })
  }, token);

  // 4) Uploader les fichiers requis
  const required = deploy.required || [];
  const byHash = new Map();
  for (const [p, buf] of buffers) byHash.set(digest[p], p);
  let uploaded = 0;
  for (const hash of required) {
    const p = byHash.get(hash);
    if (!p) continue;
    const res = await fetch(`${API}/deploys/${deploy.id}/files${p}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
      body: buffers.get(p)
    });
    if (!res.ok) throw new Error(`Upload ${p} -> HTTP ${res.status}`);
    uploaded++;
  }

  return {
    ok: true,
    site_id: siteId,
    deploy_id: deploy.id,
    url: deploy.ssl_url || deploy.url || (siteInfo && siteInfo.ssl_url) || (siteInfo && siteInfo.url) || null,
    admin_url: siteInfo && siteInfo.admin_url,
    files_total: files.length,
    files_uploaded: uploaded
  };
}

module.exports = { deployNetlify };
