const express        = require('express');
const nodeFetch      = require('node-fetch');
const path           = require('path');
const helmet         = require('helmet');
const rateLimit      = require('express-rate-limit');
const cookieParser   = require('cookie-parser');
const cors           = require('cors');
const jwt            = require('jsonwebtoken');
const bcrypt         = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const app  = express();
const PORT = process.env.PORT || 3000;
const APP_VERSION = '4.8.0';
// URLs externalisées — surchargeables via variables d'environnement (fallback sur le VPS)
const N8N_URL    = process.env.N8N_URL    || 'http://167.86.93.31:5688/webhook/pipeline';
const DEPLOY_URL = process.env.DEPLOY_URL || 'http://167.86.93.31:4001';

// ── Authentification (Sprint 2) — zero secret en dur, echec au demarrage si absent ──
const JWT_SECRET          = process.env.JWT_SECRET;
const ADMIN_USERNAME      = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
if (!JWT_SECRET || !ADMIN_USERNAME || !ADMIN_PASSWORD_HASH) {
  console.error('[ERREUR] JWT_SECRET, ADMIN_USERNAME et ADMIN_PASSWORD_HASH doivent etre definis (voir .env.example).');
  console.error('  Generer le hash : npm run hash-password -- "VotreMotDePasse"');
  process.exit(1);
}
const COOKIE_NAME = 'forge_token';

// ── Sécurité HTTP ─────────────────────────────────────────────────────────
// CSP désactivée : l'UI utilise des styles/scripts inline (SPA mono-fichier).
// Les autres protections helmet (X-Frame-Options, HSTS, noSniff...) restent actives.
app.use(helmet({ contentSecurityPolicy: false }));

// CORS : aucune origine cross-site autorisee par defaut (outil mono-origine).
// CORS_ORIGIN (liste separee par virgules) permet d'ouvrir explicitement si besoin.
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origine non autorisee (CORS)'));
  },
  credentials: true
}));

// Rate-limit global : protège le proxy contre les abus (100 req / 15 min / IP)
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requetes — reessayez dans quelques minutes.' }
}));

// Rate-limit dedie a la connexion : freine le brute-force sur le mot de passe admin
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de connexion — reessayez dans 15 minutes.' }
});

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ── Middleware d'authentification ─────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Non authentifie' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.clearCookie(COOKIE_NAME);
    return res.status(401).json({ error: 'Session invalide ou expiree' });
  }
}

// ── Routes d'authentification ─────────────────────────────────────────────
app.post('/api/auth/login',
  loginLimiter,
  body('username').isString().trim().isLength({ min: 1, max: 100 }),
  body('password').isString().isLength({ min: 1, max: 200 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Identifiants invalides' });

    const { username, password } = req.body;
    if (username !== ADMIN_USERNAME) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }
    const match = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    if (!match) return res.status(401).json({ error: 'Identifiants incorrects' });

    const token = jwt.sign({ sub: username }, JWT_SECRET, { expiresIn: '8h' });
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 8 * 60 * 60 * 1000
    });
    res.json({ ok: true });
  }
);

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ username: req.user.sub });
});

// Stockage en mémoire des résultats en attente
const pendingResults = {};

// ── Pipeline asynchrone : lance + stocke le résultat ──────────────────────
app.post('/api/pipeline', authMiddleware, async (req, res) => {
  const taskId = req.body.task_id || ('TASK-' + Date.now());
  // Répondre immédiatement avec le task_id
  res.json({ pending: true, task_id: taskId });
  // Lancer la requête n8n en arrière-plan
  try {
    const r = await nodeFetch(N8N_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      timeout: 360000
    });
    const text = await r.text();
    if (!text || !text.trim()) {
      pendingResults[taskId] = { error: 'n8n a retourné une réponse vide. Vérifier le noeud Respond Final dans l orchestrateur.', ts: Date.now() };
      return;
    }
    let data;
    try { data = JSON.parse(text); }
    catch(pe) { pendingResults[taskId] = { error: 'Réponse non-JSON: ' + text.substring(0,300), ts: Date.now() }; return; }
    pendingResults[taskId] = { data, ts: Date.now() };
    setTimeout(() => { delete pendingResults[taskId]; }, 600000);
  } catch(e) {
    pendingResults[taskId] = { error: e.message, ts: Date.now() };
  }
});

// ── Poll : Forge IA interroge toutes les 5s ───────────────────────────────
app.get('/api/result/:taskId', authMiddleware, (req, res) => {
  const result = pendingResults[req.params.taskId];
  if (!result) return res.json({ pending: true });
  if (result.error) return res.json({ error: result.error });
  res.json({ pending: false, data: result.data });
});

app.post('/api/deploy', authMiddleware, async (req, res) => {
  try { const r = await nodeFetch(DEPLOY_URL+'/deploy', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(req.body), timeout:120000 }); res.json(await r.json()); } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/improve', authMiddleware, async (req, res) => {
  try { const r = await nodeFetch(DEPLOY_URL+'/improve', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(req.body), timeout:120000 }); res.json(await r.json()); } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/apps', authMiddleware, async (req, res) => {
  try { const r = await nodeFetch(DEPLOY_URL+'/apps'); res.json(await r.json()); } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/apps/:name', authMiddleware, async (req, res) => {
  try { const r = await nodeFetch(DEPLOY_URL+'/apps/'+req.params.name, { method:'DELETE' }); res.json(await r.json()); } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/apps/:name/files', authMiddleware, async (req, res) => {
  try { const r = await nodeFetch(DEPLOY_URL+'/apps/'+req.params.name+'/files'); res.json(await r.json()); } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Création ZIP côté serveur (sans dépendance CDN) ───────────────────────
app.post('/api/create-zip', authMiddleware, (req, res) => {
  try {
    const { files, filename } = req.body;
    if (!files || !files.length) return res.status(400).json({ error: 'Aucun fichier' });
    const enc = (s) => Buffer.from(s, 'utf8');
    let offset = 0;
    const chunks = [];
    const entries = [];
    files.forEach(f => {
      let content = f.content || '';
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
    const zipBuffer = Buffer.concat([...chunks, ...cdChunks, eocd]);
    const safe = (filename || 'projet').replace(/[^a-zA-Z0-9-_.]/g, '-');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="' + safe + '.zip"');
    res.send(zipBuffer);
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── Launcher universel ────────────────────────────────────────────────────
app.get('/api/launcher', authMiddleware, (req, res) => {
  const lines = [
    '@echo off',
    'SETLOCAL ENABLEDELAYEDEXPANSION',
    'REM Forge IA - Lanceur universel',
    'SET FORGE_DIR=C:\\ForgeApp',
    'echo.',
    'echo  ==========================================',
    'echo   Forge IA - Lanceur universel',
    'echo  ==========================================',
    'echo.',
    'SET COUNT=0',
    'FOR /F "tokens=* delims=" %%f IN (\'dir /b /o-d "%USERPROFILE%\\Downloads\\ForgeIA-*.zip" 2^>nul\') DO (',
    '  SET /A COUNT+=1',
    '  SET ZIP_NAME_!COUNT!=%%f',
    '  echo  [!COUNT!] %%f',
    ')',
    'IF !COUNT!==0 (',
    '  echo  [ERREUR] Aucun ZIP ForgeIA- trouve dans Downloads.',
    '  pause & exit /b 1',
    ')',
    'IF !COUNT!==1 (',
    '  SET CHOICE=1',
    '  GOTO EXTRACT',
    ')',
    'echo.',
    'SET /P CHOICE="  Entrez le numero [1-!COUNT!] : "',
    'SET /A CHOICE_NUM=CHOICE 2>nul',
    'IF !CHOICE_NUM! LSS 1 ( echo  Choix invalide. & pause & exit /b 1 )',
    'IF !CHOICE_NUM! GTR !COUNT! ( echo  Choix invalide. & pause & exit /b 1 )',
    'SET CHOICE=!CHOICE_NUM!',
    '',
    'REM FIX: chercher par position pour eviter la double expansion',
    ':EXTRACT',
    'SET ZIP_FILE=',
    'SET SCAN=0',
    'FOR /F "tokens=* delims=" %%f IN (\'dir /b /o-d "%USERPROFILE%\\Downloads\\ForgeIA-*.zip" 2^>nul\') DO (',
    '  SET /A SCAN+=1',
    '  IF !SCAN!==!CHOICE! SET ZIP_FILE=%%f',
    ')',
    'IF "!ZIP_FILE!"=="" ( echo  [ERREUR] ZIP introuvable. & pause & exit /b 1 )',
    'SET ZIP_PATH=%USERPROFILE%\\Downloads\\!ZIP_FILE!',
    'echo  [OK] !ZIP_FILE!',
    '',
    'IF EXIST "%FORGE_DIR%" RMDIR /S /Q "%FORGE_DIR%"',
    'powershell -NoProfile -Command "Expand-Archive -Path \'!ZIP_PATH!\' -DestinationPath \'%FORGE_DIR%\' -Force"',
    '',
    'IF NOT EXIST "%FORGE_DIR%\\server.js" (',
    '  FOR /F "tokens=* delims=" %%D IN (\'dir /b /ad "%FORGE_DIR%" 2^>nul\') DO (',
    '    XCOPY "%FORGE_DIR%\\%%D\\*" "%FORGE_DIR%\\" /E /I /Y /Q >nul 2>nul',
    '    RMDIR /S /Q "%FORGE_DIR%\\%%D" >nul 2>nul',
    '  )',
    ')',
    'IF NOT EXIST "%FORGE_DIR%\\server.js" ( echo  [ERREUR] server.js introuvable. & pause & exit /b 1 )',
    'WHERE node >nul 2>nul',
    'IF ERRORLEVEL 1 ( start https://nodejs.org & pause & exit /b 1 )',
    'FOR /F "tokens=*" %%V IN (\'node -v\') DO echo  [OK] Node.js %%V',
    'cd /d "%FORGE_DIR%"',
    'call npm install --loglevel error',
    'IF ERRORLEVEL 1 ( echo  [ERREUR] npm install & pause & exit /b 1 )',
    'start "ForgeIA-Server" /min node server.js',
    ':WAIT_PORT',
    'powershell -NoProfile -Command "try{$t=New-Object Net.Sockets.TcpClient;$t.Connect(\'localhost\',3000);$t.Close();exit 0}catch{exit 1}" 2>nul',
    'IF ERRORLEVEL 1 (timeout /t 1 /nobreak >nul & goto WAIT_PORT)',
    'start http://localhost:3000',
    'echo.  http://localhost:3000  Appuyez sur une touche pour arreter.',
    'pause >nul',
    'taskkill /F /FI "WINDOWTITLE eq ForgeIA-Server" >nul 2>nul',
    'ENDLOCAL'
  ];
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 'attachment; filename="forge_ia_launcher.bat"');
  res.send(lines.join('\r\n'));
});

// ── Launcher spécifique par génération ────────────────────────────────────
app.get('/api/specific-launcher', authMiddleware, (req, res) => {
  const zipName = (req.query.zipname || 'ForgeIA-app-v1_0').replace(/[^a-zA-Z0-9\-_]/g, '');
  const dn = zipName.replace(/^(?:ForgeIA|MVP)-/, '').replace(/-v[0-9_]+$/, '');
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
