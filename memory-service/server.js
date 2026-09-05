// ============================================================================
// Forge IA — Couche mémoire / RAG (microservice)
// ----------------------------------------------------------------------------
// Stockage vectoriel sur SQLite + recherche par similarité cosinus. Sert de
// mémoire à long terme au pipeline : specs, décisions d'agents, patterns validés,
// rapports de sécurité — réutilisables par l'Architect/Backend via l'agent
// Knowledge/Memory (qui calcule les embeddings côté n8n avec la credential Mistral
// et n'envoie ici que le VECTEUR + le texte + les métadonnées).
//
// L'accès vectoriel est isolé derrière deux routes (POST /store, POST /search) :
// le backend de stockage (SQLite ici) est donc REMPLAÇABLE par Qdrant sans
// changer les agents. Choix SQLite : zéro dépendance nouvelle, cohérent avec le
// reste du système, suffisant pour le volume d'un mémoire (recherche cosinus en
// mémoire, instantanée à cette échelle).
//
// SÉCURITÉ : accès protégé par un jeton partagé (en-tête X-Memory-Token) ; aucun
// secret n'est censé transiter (l'agent scrubbe en amont) — en défense, le service
// refuse de stocker un texte qui ressemble à un secret courant.
// ============================================================================
const express  = require('express');
const Database = require('better-sqlite3');
const path     = require('path');
const crypto   = require('crypto');

const app  = express();
const PORT  = process.env.PORT || 4002;
const DB_PATH = process.env.MEMORY_DB_PATH || path.join(__dirname, 'memory.db');
const TOKEN  = process.env.MEMORY_TOKEN || '';   // si vide -> accès ouvert (dev local seulement)
const MAX_DIM = 4096;                            // garde-fou taille vecteur
const APP_VERSION = '1.0.0';
const START_TIME = new Date().toISOString();

app.use(express.json({ limit: '4mb' }));

// ── DB ──────────────────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`CREATE TABLE IF NOT EXISTS memory (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,               -- 'spec' | 'decision' | 'pattern' | 'security' | ...
  project    TEXT NOT NULL DEFAULT '',    -- cloisonnement logique par projet
  text       TEXT NOT NULL,
  embedding  BLOB NOT NULL,               -- Float32 normalisé (norme 1) -> cosinus = produit scalaire
  dim        INTEGER NOT NULL,
  meta       TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_project ON memory(project);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_kind ON memory(kind);`);

// ── Utilitaires vecteurs ──────────────────────────────────────────────────────
function toFloat32Normalized(vec) {
  const n = vec.length;
  const f = new Float32Array(n);
  let norm = 0;
  for (let i = 0; i < n; i++) { const v = Number(vec[i]) || 0; f[i] = v; norm += v * v; }
  norm = Math.sqrt(norm);
  if (norm > 0) { for (let i = 0; i < n; i++) f[i] = f[i] / norm; }  // normalise -> cosinus = dot
  return f;
}
function bufToFloat32(buf) {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}
function dot(a, b) {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

// ── Anti-secret (défense en profondeur) ───────────────────────────────────────
const SECRET_RE = [
  /\bAKIA[0-9A-Z]{16}\b/,                       // AWS access key
  /\bsk-[A-Za-z0-9]{20,}\b/,                    // OpenAI-like
  /\bgsk_[A-Za-z0-9]{20,}\b/,                   // Groq-like
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,         // PEM
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ // JWT
];
function looksLikeSecret(s) { return SECRET_RE.some(function (re) { return re.test(String(s || '')); }); }

// ── Auth ──────────────────────────────────────────────────────────────────────
app.use(function (req, res, next) {
  if (req.path === '/health') return next();
  if (!TOKEN) return next(); // dev local sans jeton
  const t = req.get('X-Memory-Token') || '';
  // comparaison à temps constant
  const a = Buffer.from(t); const b = Buffer.from(TOKEN);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Jeton mémoire invalide' });
  }
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/health', function (req, res) {
  res.json({ status: 'OK', version: APP_VERSION, started_at: START_TIME });
});

app.get('/stats', function (req, res) {
  try {
    const total = db.prepare('SELECT COUNT(*) AS n FROM memory').get().n;
    const byKind = db.prepare('SELECT kind, COUNT(*) AS n FROM memory GROUP BY kind').all();
    const byProject = db.prepare('SELECT project, COUNT(*) AS n FROM memory GROUP BY project').all();
    res.json({ total: total, by_kind: byKind, by_project: byProject });
  } catch (e) { res.status(500).json({ error: 'Erreur interne' }); }
});

// POST /store {kind, project?, text, vector:[...], meta?}
app.post('/store', function (req, res) {
  try {
    const b = req.body || {};
    const kind = String(b.kind || '').trim();
    const text = String(b.text || '').trim();
    const project = String(b.project || '').trim();
    const vector = b.vector;
    if (!kind) return res.status(400).json({ error: 'kind requis' });
    if (!text) return res.status(400).json({ error: 'text requis' });
    if (!Array.isArray(vector) || vector.length === 0) return res.status(400).json({ error: 'vector (tableau) requis' });
    if (vector.length > MAX_DIM) return res.status(400).json({ error: 'vecteur trop grand' });
    if (looksLikeSecret(text)) return res.status(422).json({ error: 'Contenu ressemblant à un secret — stockage refusé' });
    let meta = {};
    if (b.meta && typeof b.meta === 'object') meta = b.meta;
    const f = toFloat32Normalized(vector);
    const buf = Buffer.from(f.buffer, f.byteOffset, f.byteLength);
    const info = db.prepare('INSERT INTO memory (kind, project, text, embedding, dim, meta) VALUES (?, ?, ?, ?, ?, ?)')
      .run(kind, project, text, buf, f.length, JSON.stringify(meta));
    res.status(201).json({ id: info.lastInsertRowid, kind: kind, project: project, dim: f.length });
  } catch (e) { console.error('[POST /store]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

// POST /search {vector:[...], k?, project?, kind?, min_score?}
app.post('/search', function (req, res) {
  try {
    const b = req.body || {};
    const vector = b.vector;
    if (!Array.isArray(vector) || vector.length === 0) return res.status(400).json({ error: 'vector (tableau) requis' });
    const k = Math.min(Math.max(parseInt(b.k, 10) || 5, 1), 50);
    const minScore = (typeof b.min_score === 'number') ? b.min_score : -1;
    const q = toFloat32Normalized(vector);

    // Sélection des candidats (filtrée par project/kind si fournis) — liste blanche stricte.
    const where = []; const params = [];
    if (b.project !== undefined && b.project !== null && String(b.project) !== '') { where.push('project = ?'); params.push(String(b.project)); }
    if (b.kind !== undefined && b.kind !== null && String(b.kind) !== '') { where.push('kind = ?'); params.push(String(b.kind)); }
    const whereSql = where.length ? (' WHERE ' + where.join(' AND ')) : '';
    const rows = db.prepare('SELECT id, kind, project, text, embedding, dim, meta, created_at FROM memory' + whereSql).all.apply(
      db.prepare('SELECT id, kind, project, text, embedding, dim, meta, created_at FROM memory' + whereSql), params);

    const scored = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.dim !== q.length) continue; // dimensions incompatibles -> ignore
      const v = bufToFloat32(r.embedding);
      const score = dot(q, v); // vecteurs normalisés -> cosinus
      if (score < minScore) continue;
      scored.push({ id: r.id, kind: r.kind, project: r.project, text: r.text, score: score, meta: safeJson(r.meta), created_at: r.created_at });
    }
    scored.sort(function (a, c) { return c.score - a.score; });
    res.json({ count: scored.length, results: scored.slice(0, k) });
  } catch (e) { console.error('[POST /search]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

function safeJson(s) { try { return JSON.parse(s); } catch (e) { return {}; } }

// DELETE /memory/:id — purge ponctuelle (maintenance)
app.delete('/memory/:id', function (req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'id invalide' });
    const info = db.prepare('DELETE FROM memory WHERE id = ?').run(id);
    if (!info.changes) return res.status(404).json({ error: 'Introuvable' });
    res.json({ deleted: id });
  } catch (e) { res.status(500).json({ error: 'Erreur interne' }); }
});

app.listen(PORT, function () { console.log('✅ Forge IA Memory v' + APP_VERSION + ' sur le port ' + PORT); });
