const express   = require('express');
const nodeFetch = require('node-fetch');
const path      = require('path');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const app  = express();
const PORT = process.env.PORT || 3000;
const APP_VERSION = '5.0.0';
// URLs externalisées — surchargeables via variables d'environnement (fallback sur le VPS)
const N8N_URL    = process.env.N8N_URL    || 'http://167.86.93.31:5688/webhook/pipeline';
const DEPLOY_URL = process.env.DEPLOY_URL || 'http://167.86.93.31:4001';

// ── Sécurité HTTP ─────────────────────────────────────────────────────────
// CSP désactivée : l'UI utilise des styles/scripts inline (SPA mono-fichier).
// Les autres protections helmet (X-Frame-Options, HSTS, noSniff...) restent actives.
app.use(helmet({ contentSecurityPolicy: false }));

// Rate-limit : protège le proxy contre les abus, MAIS ne compte que les
// actions coûteuses (POST/PUT/DELETE : génération, amélioration, déploiement).
// Les GET sont exemptés : le polling interne du résultat (/api/result, 1 appel
// toutes les 5 s pendant jusqu'à 7 min = ~84 requêtes) et les lectures
// (/api/apps, ZIP, statiques) épuisaient sinon le quota — une seule génération
// suivie d'une amélioration dépassait 100 req/15 min → « Trop de requêtes ».
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'GET',
  message: { error: 'Trop de requetes — reessayez dans quelques minutes.' }
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Stockage en mémoire des résultats en attente
const pendingResults = {};

// ── Diagnostic : associe une signature d'erreur à une cause + solution ────
// Objectif : donner le maximum de contexte pour debugger sans ouvrir n8n a l aveugle.
function diagnose(sig) {
  const s = String(sig || '').toLowerCase();
  const R = [
    { m: /(reponse vide|réponse vide|empty|respond final|invalid json in response body|non-json|unexpected end)/,
      cause: "Un agent du pipeline s'est arrete en erreur (souvent un throw dans un noeud Code) : l'execution n'a jamais atteint le noeud Respond Final, donc n8n a renvoye un corps vide/non-JSON.",
      fix: "Ouvre n8n → Executions → la derniere execution en rouge → repere le noeud fautif (surligne) et lis son message. Coupables frequents : DAST (env production), QA, ou un noeud Validate Input qui throw. Corrige le noeud pour qu'il RENVOIE un JSON d'erreur au lieu de throw." },
    { m: /(econnrefused|connect|fetch failed|network|enotfound|socket hang up|getaddrinfo)/,
      cause: "Impossible de joindre un service : n8n (webhook), l'extracteur PDF (3002) ou le service de deploiement (4001) ne repond pas.",
      fix: "Verifie que les conteneurs tournent sur le VPS (docker ps) et que N8N_URL/DEPLOY_URL pointent vers les bons ports. Teste le webhook a la main (curl)." },
    { m: /(etimedout|timeout|delai depasse|délai)/,
      cause: "Le pipeline a depasse le delai : soit un agent LLM est lent, soit un noeud est bloque en boucle.",
      fix: "Regarde si l'execution est encore 'running' dans n8n. Si un agent LLM rame, c'est la latence Mistral ; relance. Si un noeud est bloque, ouvre l'execution pour voir lequel." },
    { m: /(credential|unauthorized|401|forbidden|403|api key|apikey)/,
      cause: "Un appel LLM a ete refuse : credential Mistral non selectionne sur le noeud HTTP, ou cle invalide/expiree.",
      fix: "Ouvre le noeud HTTP LLM concerne dans n8n et re-selectionne le credential (MISTRAL_API_KEY / MISTRAL_API_KEY_2). Verifie que la cle est valide." },
    { m: /(task_id requis|task_id|validation|invalide|required)/,
      cause: "Charge utile mal formee a l'entree du pipeline (champ requis manquant).",
      fix: "Verifie la source d'entree (specs presentes ? ZIP fourni en mode Ameliorer ?). Regarde le noeud Validate Input dans l'orchestrateur." },
    { m: /(rate|429|too many)/,
      cause: "Limite de debit atteinte (rate-limit) cote LLM ou service.",
      fix: "Attends quelques minutes puis relance. Le failover Mistral (2e cle) devrait absorber une partie des refus." }
  ];
  const hit = R.find(x => x.m.test(s));
  return hit ? { cause: hit.cause, fix: hit.fix } : {
    cause: "Erreur non categorisee.",
    fix: "Ouvre n8n → Executions → derniere execution en rouge pour lire le noeud et le message exacts." };
}

// ── Pipeline asynchrone : lance + stocke le résultat ──────────────────────
app.post('/api/pipeline', async (req, res) => {
  const taskId = req.body.task_id || ('TASK-' + Date.now());
  // Répondre immédiatement avec le task_id
  res.json({ pending: true, task_id: taskId });
  // Lancer la requête n8n en arrière-plan
  const _t0 = Date.now();
  const store = (error, detail, status) => {
    const d = diagnose(error + ' ' + (detail || ''));
    pendingResults[taskId] = {
      error, detail: detail || null, status: status || null,
      cause: d.cause, fix: d.fix,
      elapsed_ms: Date.now() - _t0, ts: Date.now()
    };
  };
  try {
    const r = await nodeFetch(N8N_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      timeout: 360000
    });
    const text = await r.text();
    if (!text || !text.trim()) {
      store('n8n a retourne une reponse vide (HTTP ' + r.status + ').',
            'Le webhook a repondu sans corps. Cela arrive quand un agent throw avant le noeud Respond Final.', r.status);
      return;
    }
    let data;
    try { data = JSON.parse(text); }
    catch(pe) {
      store('Reponse non-JSON de n8n (HTTP ' + r.status + ').',
            'Extrait brut : ' + text.substring(0, 500), r.status);
      return;
    }
    pendingResults[taskId] = { data, ts: Date.now() };
    setTimeout(() => { delete pendingResults[taskId]; }, 600000);
  } catch(e) {
    store('Echec de l appel au pipeline n8n : ' + e.message, (e && e.code) ? ('code=' + e.code) : null, null);
  }
});

// ── Poll : Forge IA interroge toutes les 5s ───────────────────────────────
app.get('/api/result/:taskId', (req, res) => {
  const result = pendingResults[req.params.taskId];
  if (!result) return res.json({ pending: true });
  if (result.error) return res.json({
    error: result.error, detail: result.detail || null, status: result.status || null,
    cause: result.cause || null, fix: result.fix || null, elapsed_ms: result.elapsed_ms || null
  });
  res.json({ pending: false, data: result.data });
});

// Proxy vers le service de deploiement (VPS:4001) tolerant au non-JSON : on remonte
// l extrait brut + une cause probable au lieu de casser sur "Unexpected token <".
async function proxyDeploy(pathName, req, res) {
  // Le deploiement prend 6-15s (npm install) -> timeout genereux via AbortController.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    // Le service de deploiement exige task_id (il renvoie 400 sinon).
    const payload = (req.body && req.body.task_id)
      ? req.body
      : { ...(req.body || {}), task_id: 'TASK-' + Date.now() };
    const r = await nodeFetch(DEPLOY_URL + pathName, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const t = await r.text();
    try { return res.json(JSON.parse(t)); }
    catch(pe) {
      return res.status(502).json({
        success: false,
        error: 'Le service de deploiement (' + DEPLOY_URL + ') a renvoye une reponse non-JSON (HTTP ' + r.status + ').',
        detail: (t || '').slice(0, 300),
        fix: 'Verifie que ' + DEPLOY_URL + ' est joignable depuis le panneau (pas seulement depuis le VPS) : reseau/pare-feu, bind sur 0.0.0.0 et non localhost. Si le panneau tourne sur Replit, son egress vers cette IP peut etre bloque.'
      });
    }
  } catch(e) {
    const _msg = (e.name === 'AbortError')
      ? 'Le service de deploiement a depasse le delai de 120s.'
      : e.message;
    const d = diagnose(_msg);
    res.status(500).json({ success: false, error: _msg, cause: d.cause, fix: d.fix });
  } finally {
    clearTimeout(timer);
  }
}
app.post('/api/deploy',  (req, res) => proxyDeploy('/deploy',  req, res));
app.post('/api/improve', (req, res) => proxyDeploy('/improve', req, res));
app.get('/api/apps', async (req, res) => {
  try { const r = await nodeFetch(DEPLOY_URL+'/apps'); res.json(await r.json()); } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/apps/:name', async (req, res) => {
  try { const r = await nodeFetch(DEPLOY_URL+'/apps/'+req.params.name, { method:'DELETE' }); res.json(await r.json()); } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/apps/:name/files', async (req, res) => {
  try { const r = await nodeFetch(DEPLOY_URL+'/apps/'+req.params.name+'/files'); res.json(await r.json()); } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Construction ZIP (STORED, méthode 0) — compatible ZIP Analyzer V2.3 ────
// Extrait en helper pour être réutilisé par /api/create-zip ET par le flux
// « Améliorer une app déployée » (récupère les fichiers du service de déploiement).
function buildZipBuffer(files) {
  const enc = (s) => Buffer.from(s, 'utf8');
  let offset = 0;
  const chunks = [];
  const entries = [];
  files.forEach(f => {
    // Robustesse : ignorer les entrées sans chemin valide et coercer tout
    // contenu non-string en chaîne (une entrée malformée ne doit jamais faire
    // planter la génération du ZIP — cf. sortie différentielle d'amélioration).
    if (!f || typeof f.path !== 'string' || !f.path) return;
    let content = (typeof f.content === 'string') ? f.content : String(f.content == null ? '' : f.content);
    content = content.replace(/^\/\/ FILE:.*\n/, '').replace(/^<!-- FILE:.*-->\n/, '').replace(/^\/\* FILE:.*\*\/\n/, '');
    const fileData = enc(content);
    const fileName = enc(f.path);
    const header = Buffer.alloc(30 + fileName.length);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10); header.writeUInt16LE(0, 12);
    header.writeUInt32LE(0, 14);
    header.writeUInt32LE(fileData.length, 18);
    header.writeUInt32LE(fileData.length, 22);
    header.writeUInt16LE(fileName.length, 26);
    header.writeUInt16LE(0, 28);
    fileName.copy(header, 30);
    entries.push({ header, data: fileData, name: fileName, offset });
    offset += header.length + fileData.length;
    chunks.push(header, fileData);
  });
  const cdChunks = [];
  let cdSize = 0;
  entries.forEach(e => {
    const cd = Buffer.alloc(46 + e.name.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8); cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(0, 16);
    cd.writeUInt32LE(e.data.length, 20);
    cd.writeUInt32LE(e.data.length, 24);
    cd.writeUInt16LE(e.name.length, 28);
    cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32); cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(e.offset, 42);
    e.name.copy(cd, 46);
    cdChunks.push(cd);
    cdSize += cd.length;
  });
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, ...cdChunks, eocd]);
}

// Normalise différentes formes de réponse de /apps/:name/files vers [{path, content}]
function normalizeFiles(raw) {
  let arr = raw;
  if (raw && !Array.isArray(raw)) arr = raw.files || raw.data || raw.tree || null;
  if (!Array.isArray(arr)) {
    // forme map { "server.js": "..." }
    if (raw && typeof raw === 'object') {
      return Object.keys(raw).map(k => ({ path: k, content: raw[k] }))
        .filter(f => typeof f.content === 'string');
    }
    return [];
  }
  return arr.map(f => ({
    path: f.path || f.name || f.filename || f.file,
    content: (typeof f.content === 'string') ? f.content
           : (typeof f.data === 'string') ? f.data
           : (typeof f.text === 'string') ? f.text : ''
  })).filter(f => f.path);
}

// POST /api/zip-base64 — construit un ZIP base64 depuis des fichiers fournis
// (sert le flux "ajouter une ressource" : on rezippe l'app courante du panneau).
app.post('/api/zip-base64', (req, res) => {
  try {
    const files = (req.body && req.body.files) || [];
    if (!files.length) return res.status(400).json({ error: 'Aucun fichier fourni' });
    const zip = buildZipBuffer(files);
    res.json({ zip_base64: zip.toString('base64'), files_count: files.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/apps/:name/zip-base64 — récupère les fichiers de l'app déployée et
// renvoie le ZIP en base64 (pour pré-remplir le mode Améliorer sans télécharger).
app.get('/api/apps/:name/zip-base64', async (req, res) => {
  try {
    const r = await nodeFetch(DEPLOY_URL + '/apps/' + req.params.name + '/files');
    const raw = await r.json();
    const files = normalizeFiles(raw);
    if (!files.length) {
      return res.status(502).json({
        error: 'Le service de déploiement n\'a renvoyé aucun fichier exploitable pour « ' + req.params.name + ' ».',
        fix: 'Vérifie que ' + DEPLOY_URL + '/apps/' + req.params.name + '/files renvoie bien une liste [{path, content}].',
        detail: JSON.stringify(raw).slice(0, 300)
      });
    }
    const zip = buildZipBuffer(files);
    const safe = String(req.params.name).replace(/[^a-zA-Z0-9-_.]/g, '-');
    res.json({ zip_base64: zip.toString('base64'), filename: safe + '.zip', files_count: files.length });
  } catch (e) {
    const d = diagnose(e.message);
    res.status(500).json({ error: e.message, cause: d.cause, fix: d.fix });
  }
});

// ── Création ZIP côté serveur (sans dépendance CDN) ───────────────────────
app.post('/api/create-zip', (req, res) => {
  try {
    const { files, filename } = req.body;
    if (!files || !files.length) return res.status(400).json({ error: 'Aucun fichier' });
    const zipBuffer = buildZipBuffer(files);
    const safe = (filename || 'projet').replace(/[^a-zA-Z0-9-_.]/g, '-');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="' + safe + '.zip"');
    res.send(zipBuffer);
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── Launcher spécifique par génération ────────────────────────────────────
app.get('/api/specific-launcher', (req, res) => {
  // IMPORTANT : conserver le point de version (v1.0) — meme assainissement que
  // /api/create-zip, sinon le .bat cherche "...-v10.zip" au lieu de "...-v1.0.zip".
  const zipName = (req.query.zipname || 'ForgeIA-app-v1.0').replace(/[^a-zA-Z0-9\-_.]/g, '-');
  const dn = zipName.replace(/^(?:ForgeIA|MVP)-/, '').replace(/-v[0-9._]+$/i, '');
  const lines = [
    '@echo off',
    'SETLOCAL',
    'REM Forge IA - Launcher : ' + zipName,
    'SET FORGE_DIR=C:\\ForgeApp',
    'SET TARGET_ZIP=' + zipName + '.zip',
    '',
    'echo.',
    'echo  Forge IA - ' + dn,
    'echo.',
    'IF NOT EXIST "%USERPROFILE%\\Downloads\\%TARGET_ZIP%" (',
    '  echo  [ERREUR] %TARGET_ZIP% introuvable dans Downloads.',
    '  echo  Telechargez le ZIP depuis Forge IA puis relancez.',
    '  pause & exit /b 1',
    ')',
    'SET ZIP_PATH=%USERPROFILE%\\Downloads\\%TARGET_ZIP%',
    'echo  [OK] %ZIP_PATH%',
    'IF EXIST "%FORGE_DIR%" RMDIR /S /Q "%FORGE_DIR%"',
    'powershell -NoProfile -Command "Expand-Archive -Path \'%ZIP_PATH%\' -DestinationPath \'%FORGE_DIR%\' -Force"',
    'IF NOT EXIST "%FORGE_DIR%\\server.js" (',
    '  FOR /F "tokens=* delims=" %%D IN (\'dir /b /ad "%FORGE_DIR%" 2^>nul\') DO (',
    '    XCOPY "%FORGE_DIR%\\%%D\\*" "%FORGE_DIR%\\" /E /I /Y /Q >nul 2>nul',
    '    RMDIR /S /Q "%FORGE_DIR%\\%%D" >nul 2>nul',
    '  )',
    ')',
    'IF NOT EXIST "%FORGE_DIR%\\server.js" ( echo [ERREUR] server.js introuvable. & pause & exit /b 1 )',
    'WHERE node >nul 2>nul',
    'IF ERRORLEVEL 1 ( start https://nodejs.org & pause & exit /b 1 )',
    'FOR /F "tokens=*" %%V IN (\'node -v\') DO echo  [OK] Node.js %%V',
    'cd /d "%FORGE_DIR%"',
    'call npm install --loglevel error',
    'IF ERRORLEVEL 1 ( echo [ERREUR] npm install & pause & exit /b 1 )',
    'start "ForgeIA-Server" /min node server.js',
    ':WAIT_PORT',
    'powershell -NoProfile -Command "try{$t=New-Object Net.Sockets.TcpClient;$t.Connect(\'localhost\',3000);$t.Close();exit 0}catch{exit 1}" 2>nul',
    'IF ERRORLEVEL 1 (timeout /t 1 /nobreak >nul & goto WAIT_PORT)',
    'start http://localhost:3000',
    'echo.  ' + dn + '  http://localhost:3000  Appuyez sur une touche pour arreter.',
    'pause >nul',
    'taskkill /F /FI "WINDOWTITLE eq ForgeIA-Server" >nul 2>nul',
    'ENDLOCAL',
  ];
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}-launcher.bat"`);
  res.send(lines.join('\r\n'));
});

app.listen(PORT, () => console.log('✅ Forge IA v' + APP_VERSION + ' on port ' + PORT));
