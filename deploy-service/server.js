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

    await npmInstall(dir);
    startApp(name, dir, port);
    const ready = await waitReady(port, 15000);

    state[name] = {
      name: name, port: port, url: urlOf(port),
      status: ready ? 'running' : 'started (santé non confirmée)',
      files_count: files.length,
      created_at: (state[name] && state[name].created_at) || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    saveState();
    return res.json({ name: name, url: urlOf(port), deployment_url: urlOf(port), port: port, status: state[name].status });
  } catch (e) {
    console.error('[deploy]', e.message);
    return res.status(500).json({ error: String(e.message || e) });
  }
}

app.get('/health', function (req, res) { res.json({ status: 'OK', apps: Object.keys(state).length }); });
app.get('/apps', function (req, res) { res.json(Object.keys(state).map(function (k) { return state[k]; })); });
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
