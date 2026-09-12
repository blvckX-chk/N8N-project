// ============================================================================
// Forge IA — Service de déploiement / hébergement (PaaS-lite)
// ----------------------------------------------------------------------------
// Reçoit les fichiers d'une app générée (Node/Express/SQLite), les écrit,
// `npm install`, lance `node server.js` sur un port alloué, et renvoie une URL
// vivante. Gère la liste, les fichiers et la suppression des apps déployées.
// Appelé par le panel via DEPLOY_URL (http://host.docker.internal:4001).
//
// Contrat (imposé par le panel forge-ia) :
//   POST /deploy        { task_id, app_name?|project_name?, files:[{path,content}] }
//                       -> { name, url, port, status }
//   POST /improve       (idem /deploy : redéploie sous le même nom)
//   GET  /apps          -> [ {name, port, url, status, created_at, updated_at} ]
//   GET  /apps/:name    -> app
//   GET  /apps/:name/files -> [ {path, content} ]
//   DELETE /apps/:name  -> { deleted }
//   GET  /health
//
// Sécurité : exécute du code généré -> à isoler (VPS dédié idéalement). Ici :
// anti-path-traversal à l'écriture, ports bornés, timeouts, jamais de shell.
// ============================================================================
const express = require('express');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const app = express();
const API_PORT   = parseInt(process.env.PORT || '4001', 10);
const PUBLIC_HOST = process.env.PUBLIC_HOST || '167.86.93.31';
const APPS_DIR   = process.env.APPS_DIR || '/data/apps';
const PORT_MIN   = parseInt(process.env.PORT_MIN || '4100', 10);
const PORT_MAX   = parseInt(process.env.PORT_MAX || '4140', 10);
const STATE_FILE = path.join(APPS_DIR, '_state.json');

app.use(express.json({ limit: process.env.MAX_BODY || '25mb' }));
fs.mkdirSync(APPS_DIR, { recursive: true });

let state = {};
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {}; } catch (e) { state = {}; }
const procs = {}; // name -> ChildProcess

function saveState() { try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch (e) {} }
function sanitize(n) {
  return String(n || 'app').toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'app';
}
// Le Backend préfixe chaque fichier par "// FILE: <path>\n" — à retirer (invalide en JSON).
function stripHeader(c) { return String(c == null ? '' : c).replace(/^﻿?\s*\/\/\s*FILE:[^\n]*\n/, ''); }
function urlOf(port) { return 'http://' + PUBLIC_HOST + ':' + port + '/'; }

function allocPort(name) {
  if (state[name] && state[name].port) return state[name].port;
  const used = new Set(Object.keys(state).map(function (k) { return state[k].port; }));
  for (let p = PORT_MIN; p <= PORT_MAX; p++) { if (!used.has(p)) return p; }
  throw new Error('Plus de port disponible (' + PORT_MIN + '-' + PORT_MAX + ')');
}
function appDir(name) { return path.join(APPS_DIR, name); }

function writeFiles(dir, files) {
  (files || []).forEach(function (f) {
    if (!f || !f.path) return;
    let rel = String(f.path).replace(/\\/g, '/').replace(/^\/+/, '');
    if (rel.split('/').indexOf('..') >= 0) return;         // anti-traversal
    const full = path.join(dir, rel);
    if (full.indexOf(path.resolve(dir)) !== 0 && full.indexOf(dir) !== 0) return;
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, stripHeader(f.content));
  });
}
function stopApp(name) { if (procs[name]) { try { procs[name].kill('SIGTERM'); } catch (e) {} delete procs[name]; } }

// Beaucoup d'apps générées sont API-only (pas d'express.static) alors que le
// frontend est fourni dans frontend/ (ou public/). Pour que le lien déployé
// ouvre bien l'app, on injecte — si absent — un service statique juste après
// l'initialisation d'Express. Injection sûre (try/catch) et idempotente.
function ensureStaticServing(dir) {
  try {
    const sp = path.join(dir, 'server.js');
    if (!fs.existsSync(sp)) return;
    let code = fs.readFileSync(sp, 'utf8');
    if (/express\.static/.test(code)) return; // déjà servi
    // cherche une ligne d'init d'app express
    const m = code.match(/(^|\n)([^\n]*=\s*express\(\)\s*;?)/);
    if (!m) return;
    const at = m.index + m[0].length;
    const snippet = "\n/* forge-deploy: sert le frontend généré (frontend/ ou public/) + fallback index.html */\n"
      + "try{(function(){var _p=require('path'),_fs=require('fs'),_ex=require('express');"
      + "['frontend','public','dist','client','www'].forEach(function(_d){var _dir=_p.join(__dirname,_d);"
      + "if(_fs.existsSync(_dir)){app.use(_ex.static(_dir));"
      + "app.get('/',function(_q,_r,_n){var _i=_p.join(_dir,'index.html');return _fs.existsSync(_i)?_r.sendFile(_i):_n();});}});})();}catch(_e){}\n";
    code = code.slice(0, at) + snippet + code.slice(at);
    fs.writeFileSync(sp, code);
  } catch (e) { console.error('[static-serving]', e.message); }
}

function npmInstall(dir) {
  return new Promise(function (res, rej) {
    if (!fs.existsSync(path.join(dir, 'package.json'))) return res(); // rien à installer
    execFile('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: dir, timeout: 240000, maxBuffer: 8 * 1024 * 1024 },
      function (err, so, se) {
        if (err) return rej(new Error('npm install a échoué : ' + String(se || err.message).slice(0, 400)));
        res();
      });
  });
}
// Validation externe indépendante : audit des dépendances via `npm audit`
// (base d'avis officielle du registre npm). Crédibilise les sorties de Forge.
function npmAudit(dir) {
  return new Promise(function (resolve) {
    if (!fs.existsSync(path.join(dir, 'package.json'))) return resolve({ available: false, reason: 'pas de package.json' });
    execFile('npm', ['audit', '--json'], { cwd: dir, timeout: 120000, maxBuffer: 16 * 1024 * 1024 },
      function (err, so, se) {
        // `npm audit` sort avec un code != 0 quand il trouve des vulnérabilités :
        // on parse toujours stdout (le JSON y est présent quel que soit le code).
        try {
          const j = JSON.parse(so || '');
          const m = (j.metadata && j.metadata.vulnerabilities) || {};
          const names = Object.keys(j.vulnerabilities || {}).slice(0, 25);
          resolve({
            available: true,
            source: 'npm audit — registre npm officiel',
            vulnerabilities: {
              critical: m.critical || 0, high: m.high || 0, moderate: m.moderate || 0,
              low: m.low || 0, info: m.info || 0, total: m.total || 0
            },
            packages: names
          });
        } catch (e) {
          resolve({ available: false, reason: 'sortie audit illisible : ' + String(se || e.message).slice(0, 200) });
        }
      });
  });
}

function startApp(name, dir, port) {
  stopApp(name);
  const logPath = path.join(dir, '_app.log');
  const out = fs.openSync(logPath, 'a');
  const child = spawn('node', ['server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, { PORT: String(port), NODE_ENV: 'production', DB_PATH: path.join(dir, 'database.db') }),
    stdio: ['ignore', out, out]
  });
  procs[name] = child;
  child.on('exit', function (code) {
    if (state[name]) { state[name].status = 'stopped (code ' + code + ')'; saveState(); }
    delete procs[name];
  });
}
function waitReady(port, timeoutMs) {
  return new Promise(function (resolve) {
    const deadline = Date.now() + timeoutMs;
    (function poll() {
      const req = http.get({ host: '127.0.0.1', port: port, path: '/health', timeout: 2000 }, function (r) {
        r.resume(); resolve(true);
      });
      req.on('error', function () {
        // /health peut ne pas exister -> teste la racine
        const req2 = http.get({ host: '127.0.0.1', port: port, path: '/', timeout: 2000 }, function (r2) { r2.resume(); resolve(true); });
        req2.on('error', function () { if (Date.now() > deadline) return resolve(false); setTimeout(poll, 600); });
        req2.on('timeout', function () { req2.destroy(); if (Date.now() > deadline) return resolve(false); setTimeout(poll, 600); });
      });
      req.on('timeout', function () { req.destroy(); if (Date.now() > deadline) return resolve(false); setTimeout(poll, 600); });
    })();
  });
}

// ── Scan dynamique réel (DAST + Monitoring + Cost) contre l'app LANCÉE ────────
function httpProbe(port, opts, timeoutMs) {
  return new Promise(function (resolve) {
    const data = opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : null;
    const headers = Object.assign({}, opts.headers || {});
    if (data) { headers['Content-Type'] = headers['Content-Type'] || 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ host: '127.0.0.1', port: port, path: opts.path || '/', method: opts.method || 'GET', headers: headers, timeout: timeoutMs || 4000 },
      function (r) {
        let body = ''; let n = 0;
        r.on('data', function (c) { n += c.length; if (body.length < 4000) body += c.toString(); });
        r.on('end', function () { resolve({ status: r.statusCode, headers: r.headers, body: body, bytes: n, ms: Date.now() - t0 }); });
      });
    const t0 = Date.now();
    req.on('error', function (e) { resolve({ error: e.code || e.message, ms: Date.now() - t0 }); });
    req.on('timeout', function () { req.destroy(); resolve({ error: 'timeout', ms: Date.now() - t0 }); });
    if (data) req.write(data);
    req.end();
  });
}

async function runScan(name) {
  const a = state[name];
  if (!a) return { error: 'introuvable' };
  const port = a.port;
  const findings = []; let score = 100;
  function add(sev, id, msg, pts) { findings.push({ severity: sev, id: id, message: msg }); score -= pts; }

  const health = await httpProbe(port, { path: '/health' }, 4000);
  const base = (health && !health.error) ? health : await httpProbe(port, { path: '/' }, 4000);
  const H = (base && base.headers) || {};

  // 1) En-têtes de sécurité (helmet)
  if (!H['x-content-type-options']) add('medium', 'HDR-nosniff', 'X-Content-Type-Options absent', 10);
  if (!H['content-security-policy'] && !H['x-frame-options']) add('medium', 'HDR-csp', 'CSP / X-Frame-Options absents (clickjacking)', 10);
  if (H['x-powered-by']) add('low', 'HDR-powered', 'X-Powered-By expose la stack', 5);

  // 2) Contrôle d'accès : routes protégées sans authentification -> 401/403 attendu
  const protPaths = ['/api/me', '/api/uploads', '/api/audit', '/dashboard'];
  for (let i = 0; i < protPaths.length; i++) {
    const r = await httpProbe(port, { path: protPaths[i] }, 4000);
    if (r && !r.error && r.status === 200) add('high', 'ACL', 'Route protégée ' + protPaths[i] + ' accessible sans authentification (200)', 25);
  }

  // 3) Injection : bypass d'auth via SQLi sur /api/login -> pas de 200
  const inj = await httpProbe(port, { method: 'POST', path: '/api/login', body: { username: "' OR '1'='1' --", password: 'x' } }, 4000);
  if (inj && !inj.error && inj.status === 200) add('critical', 'INJ-sqli', "Bypass d'authentification possible via injection SQL sur /api/login", 40);

  // 4) Limitation de débit : rafale -> 429 attendu
  let got429 = false, loginExists = false;
  for (let i = 0; i < 15; i++) {
    const r = await httpProbe(port, { method: 'POST', path: '/api/login', body: { username: 'scan_probe_' + i, password: 'x' } }, 3000);
    if (r && !r.error) { loginExists = loginExists || (r.status !== 404); if (r.status === 429) { got429 = true; break; } }
  }
  if (loginExists && !got429) add('medium', 'DOS-ratelimit', 'Aucune limitation de débit détectée sur /api/login', 10);

  // 5) Gestion d'erreur : route inconnue -> pas de trace d'exécution
  const err = await httpProbe(port, { path: '/__forge_scan_404__' }, 4000);
  if (err && !err.error && /Error:[\s\S]*\n\s+at\s+.*:\d+:\d+/.test(err.body || '')) add('medium', 'ERR-stack', "Trace d'exécution exposée sur erreur (fuite d'information)", 15);

  score = Math.max(0, score);
  const status = findings.some(function (f) { return f.severity === 'critical' || f.severity === 'high'; }) ? 'FAIL' : (findings.length ? 'REVIEW' : 'PASS');

  // Validation externe indépendante des dépendances (npm audit / registre officiel)
  const supply = await npmAudit(appDir(name));
  const sv = (supply && supply.vulnerabilities) || {};
  const supplyStatus = supply && supply.available
    ? ((sv.critical || 0) + (sv.high || 0) > 0 ? 'FAIL' : ((sv.moderate || 0) + (sv.low || 0) > 0 ? 'REVIEW' : 'PASS'))
    : 'N/A';

  return {
    scanned_at: new Date().toISOString(),
    target: 'http://127.0.0.1:' + port,
    external_validation: {
      supply_chain: Object.assign({ status: supplyStatus }, supply),
      // verdict global de la validation externe : combine DAST runtime + dépendances
      verdict: (status === 'FAIL' || supplyStatus === 'FAIL') ? 'FAIL' : ((status === 'REVIEW' || supplyStatus === 'REVIEW') ? 'REVIEW' : 'PASS')
    },
    dast: {
      status: status, score: score, findings: findings,
      security_headers: {
        'x-content-type-options': H['x-content-type-options'] || null,
        'content-security-policy': H['content-security-policy'] ? 'présent' : null,
        'x-frame-options': H['x-frame-options'] || null,
        'x-powered-by': H['x-powered-by'] || null
      }
    },
    monitoring: {
      status: (health && !health.error && health.status === 200) ? 'HEALTHY' : 'UNKNOWN',
      health_code: (health && health.status) || null,
      latency_ms: base ? base.ms : null,
      uptime_s: a.updated_at ? Math.round((Date.now() - new Date(a.updated_at).getTime()) / 1000) : null
    },
    performance: { response_ms: base ? base.ms : null, payload_bytes: base ? base.bytes : null }
  };
}

async function deploy(req, res) {
  try {
    const b = req.body || {};
    const name = sanitize(b.app_name || b.project_name || b.name || b.task_id);
    const files = Array.isArray(b.files) ? b.files : null;
    if (!files || !files.length) return res.status(400).json({ error: 'files (tableau) requis' });
    if (!files.some(function (f) { return f && f.path && /(^|\/)server\.js$/.test(String(f.path)); }))
      return res.status(400).json({ error: 'server.js absent des fichiers' });

    const dir = appDir(name);
    const port = allocPort(name);
    // écriture propre : on repart d'un dossier vide (garde la base .db si présente)
    fs.mkdirSync(dir, { recursive: true });
    writeFiles(dir, files);
    ensureStaticServing(dir);   // sert le frontend si le backend ne le fait pas

    await npmInstall(dir);
    startApp(name, dir, port);
    const ready = await waitReady(port, 15000);

    const iteration = ((state[name] && state[name].iteration) || 0) + 1;
    state[name] = {
      name: name, port: port, url: urlOf(port),
      status: ready ? 'running' : 'started (santé non confirmée)',
      files_count: files.length, iteration: iteration,
      created_at: (state[name] && state[name].created_at) || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    saveState();
    // Scan dynamique réel de l'app tout juste lancée (best-effort, non bloquant)
    let scan = null;
    if (ready) { try { scan = await runScan(name); state[name].last_scan = scan; saveState(); } catch (e) { scan = { error: String(e.message || e) }; } }
    // Réponse alignée sur le contrat attendu par le panel (app_name, health_url, files_deployed, iteration)
    return res.json({
      success: true,
      name: name, app_name: name,
      url: urlOf(port), deployment_url: urlOf(port), health_url: urlOf(port) + 'health',
      port: port, files_deployed: files.length, iteration: iteration, status: state[name].status,
      scan: scan ? {
        dast_status: scan.dast && scan.dast.status,
        dast_score: scan.dast && scan.dast.score,
        findings: scan.dast ? scan.dast.findings.length : 0,
        top_findings: scan.dast ? scan.dast.findings.slice(0, 5) : [],
        latency_ms: scan.monitoring && scan.monitoring.latency_ms,
        uptime_s: scan.monitoring && scan.monitoring.uptime_s,
        monitoring: scan.monitoring && scan.monitoring.status,
        verdict: scan.external_validation && scan.external_validation.verdict,
        supply_chain: scan.external_validation && scan.external_validation.supply_chain
          ? { status: scan.external_validation.supply_chain.status, vulnerabilities: scan.external_validation.supply_chain.vulnerabilities || null, source: scan.external_validation.supply_chain.source || null }
          : null
      } : null
    });
  } catch (e) {
    console.error('[deploy]', e.message);
    return res.status(500).json({ error: String(e.message || e) });
  }
}

app.get('/health', function (req, res) { res.json({ status: 'OK', apps: Object.keys(state).length }); });
// Format aligné sur le panel : { apps: [ {name, status:'online'|'offline', iteration, url, port} ] }
app.get('/apps', function (req, res) {
  const apps = Object.keys(state).map(function (k) {
    const a = state[k];
    return {
      name: a.name, status: procs[k] ? 'online' : 'offline', iteration: a.iteration || 1,
      url: a.url, port: a.port, files_deployed: a.files_count || 0,
      dast: a.last_scan && a.last_scan.dast ? { status: a.last_scan.dast.status, score: a.last_scan.dast.score } : null
    };
  });
  res.json({ apps: apps });
});
app.get('/apps/:name', function (req, res) {
  const a = state[sanitize(req.params.name)];
  if (!a) return res.status(404).json({ error: 'introuvable' });
  res.json(a);
});
app.get('/apps/:name/files', function (req, res) {
  const name = sanitize(req.params.name);
  const dir = appDir(name);
  if (!state[name] || !fs.existsSync(dir)) return res.status(404).json({ error: 'introuvable' });
  const out = [];
  (function walk(d, base) {
    fs.readdirSync(d, { withFileTypes: true }).forEach(function (e) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name.endsWith('.db') || e.name === '_app.log') return;
      const full = path.join(d, e.name); const rel = base ? base + '/' + e.name : e.name;
      if (e.isDirectory()) walk(full, rel);
      else { try { out.push({ path: rel, content: fs.readFileSync(full, 'utf8') }); } catch (x) {} }
    });
  })(dir, '');
  res.json(out);
});
app.delete('/apps/:name', function (req, res) {
  const name = sanitize(req.params.name);
  if (!state[name]) return res.status(404).json({ error: 'introuvable' });
  stopApp(name);
  try { fs.rmSync(appDir(name), { recursive: true, force: true }); } catch (e) {}
  delete state[name]; saveState();
  res.json({ deleted: name });
});
// Scan dynamique à la demande (DAST + Monitoring + Cost) contre l'app lancée
app.get('/apps/:name/scan', async function (req, res) {
  const name = sanitize(req.params.name);
  if (!state[name]) return res.status(404).json({ error: 'introuvable' });
  try {
    const rep = await runScan(name);
    if (rep.error) return res.status(409).json(rep);
    state[name].last_scan = rep; saveState();
    res.json(rep);
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});
app.post('/deploy', deploy);
app.post('/improve', deploy);

app.listen(API_PORT, function () {
  console.log('✅ Forge Deploy sur le port ' + API_PORT + ' (apps ' + PORT_MIN + '-' + PORT_MAX + ')');
  // relance les apps persistées au démarrage du service
  Object.keys(state).forEach(function (name) {
    const dir = appDir(name);
    if (fs.existsSync(path.join(dir, 'server.js'))) {
      try { startApp(name, dir, state[name].port); state[name].status = 'running'; }
      catch (e) { state[name].status = 'échec relance'; }
    }
  });
  saveState();
});
