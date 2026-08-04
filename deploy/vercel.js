'use strict';
// Déploiement statique sur Vercel via l'API.
// 1) upload de chaque fichier (/v2/files, empreinte SHA1) ;
// 2) création du déploiement (/v13/deployments) référençant les SHA.
// Requiert VERCEL_TOKEN (et VERCEL_TEAM_ID optionnel).

const crypto = require('crypto');
const API = 'https://api.vercel.com';

function sha1(buf) { return crypto.createHash('sha1').update(buf).digest('hex'); }

async function deployVercel(files, opts = {}) {
  const token = opts.token || process.env.VERCEL_TOKEN;
  if (!token) throw new Error('VERCEL_TOKEN manquant');
  const teamQ = (opts.teamId || process.env.VERCEL_TEAM_ID) ? `?teamId=${opts.teamId || process.env.VERCEL_TEAM_ID}` : '';
  const auth = { Authorization: `Bearer ${token}` };

  // 1) Upload des fichiers
  const manifest = [];
  for (const f of files) {
    const buf = Buffer.isBuffer(f.content) ? f.content : Buffer.from(String(f.content), 'utf8');
    const digest = sha1(buf);
    const p = f.path.replace(/^\/+/, '');
    const res = await fetch(`${API}/v2/files${teamQ}`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/octet-stream', 'x-vercel-digest': digest, 'Content-Length': String(buf.length) },
      body: buf
    });
    if (!res.ok && res.status !== 200) {
      const txt = await res.text();
      throw new Error(`Vercel upload ${p} -> HTTP ${res.status}: ${txt.slice(0, 160)}`);
    }
    manifest.push({ file: p, sha: digest, size: buf.length });
  }

  // 2) Création du déploiement (fichiers statiques, aucun build)
  const name = (opts.name || 'vitrine').replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 52) || 'vitrine';
  const res = await fetch(`${API}/v13/deployments${teamQ ? teamQ + '&forceNew=1' : '?forceNew=1'}`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, files: manifest, target: 'production', projectSettings: { framework: null } })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Vercel deploy -> HTTP ${res.status}: ${data.error && data.error.message || JSON.stringify(data).slice(0, 200)}`);

  return {
    site_id: data.projectId || name,
    deploy_id: data.id,
    url: data.url ? `https://${data.url}` : null,
    files_total: files.length,
    files_uploaded: manifest.length,
    state: data.readyState || data.status || 'QUEUED'
  };
}

module.exports = { deployVercel };
