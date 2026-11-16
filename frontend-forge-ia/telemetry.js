// Forge IA — télémétrie LLM : solde de crédits Tchavi, consommation par génération,
// détection du failover gratuit. Alimenté par les agents n8n (POST interne), lu par
// l'UI (GET /api/credits). Persisté sur disque (volume) pour survivre aux redémarrages.
'use strict';
const fs   = require('fs');
const path = require('path');

const DATA_DIR  = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE      = path.join(DATA_DIR, 'telemetry.json');
const WARN      = Number(process.env.CREDITS_WARN || 500);
const CRITICAL  = Number(process.env.CREDITS_CRITICAL || 150);
const MAX_EVENTS = 200;
const MAX_GENS   = 30;

let state = {
  credits_remaining: null,     // dernier solde connu (Tchavi)
  credits_updated_at: null,
  credits_source: null,        // 'llm' (lu dans une réponse) | 'manual' (saisi dans le panel)
  events: [],                  // derniers appels LLM
  generations: [],             // consommation par génération
  active: {},                  // générations en cours : task_id -> {...}
  stage_stats: {}              // étape -> dernières durées réelles (ms), pour l'estimation
};

// Progression réelle par tâche (jalons émis par l'Orchestrateur) — en mémoire
const progress = {};           // task_id -> { events: [], llm: [], created: ts }
const MAX_TASKS = 40;

function load() {
  try { state = Object.assign(state, JSON.parse(fs.readFileSync(FILE, 'utf8'))); state.active = {}; state.stage_stats = state.stage_stats || {}; }
  catch (e) { /* premier démarrage : pas de fichier */ }
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, FILE);              // écriture atomique
  } catch (e) { console.warn('[telemetry] sauvegarde impossible :', e.message); }
}

const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;
const str = (v, n) => (v == null ? null : String(v).slice(0, n || 80));

// Événement envoyé par un agent n8n après un appel LLM réussi.
function record(raw) {
  const ev = {
    agent: str(raw.agent, 40) || 'inconnu',
    model: str(raw.model, 80),
    provider: ['tchavi', 'groq', 'fallback'].includes(raw.provider) ? raw.provider : 'inconnu',
    prompt_tokens: num(raw.prompt_tokens) || 0,
    completion_tokens: num(raw.completion_tokens) || 0,
    total_tokens: num(raw.total_tokens) || 0,
    credits_remaining: num(raw.credits_remaining),
    ts: Date.now()
  };
  state.events.push(ev);
  if (state.events.length > MAX_EVENTS) state.events = state.events.slice(-MAX_EVENTS);
  if (ev.credits_remaining !== null) {
    state.credits_remaining = ev.credits_remaining;
    state.credits_updated_at = ev.ts;
    state.credits_source = 'llm';
  }
  // Rattacher l'événement à la génération en cours la plus récente
  const ids = Object.keys(state.active);
  if (ids.length) {
    const g = state.active[ids.sort((a, b) => state.active[b].started_at - state.active[a].started_at)[0]];
    g.calls++; g.tokens += ev.total_tokens;
    const pr = progress[g.task_id];
    if (pr) pr.llm.push(ev);
    if (!g.providers.includes(ev.provider)) g.providers.push(ev.provider);
    if (ev.credits_remaining !== null) g.credits_end = ev.credits_remaining;
  }
  save();
  return ev;
}

function startGeneration(taskId) {
  _task(taskId);
  state.active[taskId] = {
    task_id: taskId, started_at: Date.now(), credits_start: state.credits_remaining,
    credits_end: null, calls: 0, tokens: 0, providers: []
  };
}

function endGeneration(taskId, ok) {
  const g = state.active[taskId];
  if (!g) return;
  delete state.active[taskId];
  const consumed = (g.credits_start !== null && g.credits_end !== null) ? Math.max(0, g.credits_start - g.credits_end) : null;
  state.generations.push({
    task_id: g.task_id, started_at: g.started_at, ended_at: Date.now(), ok: !!ok,
    calls: g.calls, tokens: g.tokens, providers: g.providers, consumed
  });
  if (state.generations.length > MAX_GENS) state.generations = state.generations.slice(-MAX_GENS);
  save();
}

function setManual(credits) {
  const c = num(Number(credits));
  if (c === null || c < 0) return false;
  state.credits_remaining = c;
  state.credits_updated_at = Date.now();
  state.credits_source = 'manual';
  save();
  return true;
}

function summary() {
  const withCost = state.generations.filter(g => g.ok && g.consumed !== null && g.consumed > 0);
  const recent = withCost.slice(-5);
  const avg = recent.length ? Math.round(recent.reduce((a, g) => a + g.consumed, 0) / recent.length) : null;
  const c = state.credits_remaining;
  const last = state.generations[state.generations.length - 1] || null;
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  return {
    credits_remaining: c,
    credits_updated_at: state.credits_updated_at,
    credits_source: state.credits_source,
    level: c === null ? 'unknown' : c <= CRITICAL ? 'critical' : c <= WARN ? 'warning' : 'ok',
    thresholds: { warning: WARN, critical: CRITICAL },
    avg_credits_per_generation: avg,
    est_generations_left: (c !== null && avg) ? Math.floor(c / avg) : null,
    failover_used_24h: state.events.some(e => e.ts > dayAgo && (e.provider === 'groq' || e.provider === 'fallback')),
    last_generation: last,
    generations: state.generations.slice(-10).reverse(),
    recent_events: state.events.slice(-15).reverse(),
    running: Object.keys(state.active).length
  };
}

const STAGES = ['extraction','lint','normalizer','architect','analysis','backend','frontend','tests','verification','security','gonogo','monitoring','docs','done'];
const KINDS = ['start','end','fail','stop'];

function _task(id) {
  if (!progress[id]) {
    progress[id] = { events: [], llm: [], created: Date.now() };
    const ids = Object.keys(progress);
    if (ids.length > MAX_TASKS) ids.sort((a, b) => progress[a].created - progress[b].created).slice(0, ids.length - MAX_TASKS).forEach(k => delete progress[k]);
  }
  return progress[id];
}

// Jalon envoyé par l'Orchestrateur : une étape commence (start), le pipeline
// se termine (end), échoue (fail) ou est stoppé par le Go/No-Go (stop).
function recordProgress(raw) {
  const id = str(raw.task_id, 80);
  if (!id || !STAGES.includes(raw.stage) || !KINDS.includes(raw.kind)) return null;
  let extra = null;
  try { if (raw.extra && typeof raw.extra === 'object') { const j = JSON.stringify(raw.extra); if (j.length <= 4000) extra = JSON.parse(j); } } catch (e) {}
  const ev = { stage: raw.stage, kind: raw.kind, ts: num(raw.ts) || Date.now(),
    prev_status: str(raw.prev_status, 40), prev_summary: str(raw.prev_summary, 200), extra };
  const t = _task(id);
  t.events.push(ev);
  if (ev.kind !== 'start') _learnDurations(t.events);
  return ev;
}

// Durées réelles par étape (début -> jalon suivant), conservées pour l'estimation.
function _learnDurations(events) {
  const starts = events.filter(e => e.kind === 'start');
  const endTs = events[events.length - 1].ts;
  starts.forEach((e, i) => {
    const next = starts[i + 1] ? starts[i + 1].ts : endTs;
    const d = next - e.ts;
    if (d > 0 && d < 30 * 60 * 1000) {
      const arr = state.stage_stats[e.stage] = state.stage_stats[e.stage] || [];
      arr.push(d); if (arr.length > 10) arr.shift();
    }
  });
  save();
}

function _median(a) { if (!a || !a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }

function getProgress(id) {
  const t = progress[id];
  const typical = {};
  Object.keys(state.stage_stats).forEach(k => { typical[k] = _median(state.stage_stats[k]); });
  return { task_id: id, known: !!t, events: t ? t.events : [], llm: t ? t.llm : [], typical, now: Date.now() };
}

load();
module.exports = { record, startGeneration, endGeneration, setManual, summary, recordProgress, getProgress };
