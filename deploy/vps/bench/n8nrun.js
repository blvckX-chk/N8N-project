// Mini-moteur n8n pour le banc d'essai : exécute un workflow (Code, If, Switch, Merge, Wait,
// HTTP simulé, Respond) depuis le webhook, avec la même sémantique de $json / $('Nœud') / $env.
'use strict';
const AsyncF = Object.getPrototypeOf(async function () {}).constructor;
function evalExpr(v, ctx) {
  if (typeof v !== 'string' || !v.startsWith('=')) return v;
  const s = v.slice(1);
  const parts = []; let i = 0, out = ''; let only = null;
  const re = /\{\{([\s\S]*?)\}\}/g; let m; let last = 0; let count = 0;
  while ((m = re.exec(s))) { count++; out += s.slice(last, m.index); const val = new Function('$json', '$', '$env', '$input', 'return (' + m[1] + ');')(ctx.$json, ctx.$, ctx.$env, ctx.$input); if (count === 1 && m.index === 0 && re.lastIndex === s.length) only = val; out += (typeof val === 'object' ? JSON.stringify(val) : String(val)); last = re.lastIndex; }
  if (only !== null && count === 1) return only;
  return count ? out + s.slice(last) : s;
}
function cond(c, ctx) {
  const L = evalExpr(c.leftValue, ctx), R = evalExpr(c.rightValue, ctx), op = (c.operator || {}).operation, ty = (c.operator || {}).type;
  switch (op) {
    case 'equals': return ty === 'number' ? Number(L) === Number(R) : (ty === 'boolean' ? Boolean(L) === (R === true || R === 'true') : String(L) === String(R));
    case 'notEquals': return String(L) !== String(R);
    case 'true': return L === true || L === 'true'; case 'false': return L === false || L === 'false';
    case 'exists': return L !== undefined && L !== null; case 'notExists': return L === undefined || L === null;
    case 'empty': return L === undefined || L === null || L === '' || (Array.isArray(L) && !L.length);
    case 'notEmpty': return !(L === undefined || L === null || L === '' || (Array.isArray(L) && !L.length));
    case 'contains': return String(L).includes(String(R)); case 'notContains': return !String(L).includes(String(R));
    case 'gt': return Number(L) > Number(R); case 'gte': return Number(L) >= Number(R); case 'lt': return Number(L) < Number(R); case 'lte': return Number(L) <= Number(R);
    case 'startsWith': return String(L).startsWith(String(R));
    default: throw new Error('opérateur non géré : ' + op);
  }
}
function evalConds(cs, ctx) { const list = (cs.conditions || []).map(c => cond(c, ctx)); return (cs.combinator || 'and') === 'or' ? list.some(Boolean) : list.every(Boolean); }

async function run(wf, body, opts) {
  opts = opts || {};
  const nodes = Object.fromEntries(wf.nodes.map(n => [n.name, n]));
  const C = wf.connections; const outs = {}; const trace = []; let response = null;
  const $env = opts.env || {};
  const $ = name => ({ first: () => { if (!outs[name]) throw new Error('Node ' + name + ' not executed'); return outs[name][0]; }, all: () => outs[name] || [], item: outs[name] && outs[name][0] });
  const start = wf.nodes.find(n => n.type.endsWith('.webhook'));
  const queue = [[start.name, [{ json: { body: opts.rawBody !== undefined ? opts.rawBody : body, headers: {}, query: {} } }]]];
  let steps = 0;
  while (queue.length) {
    if (++steps > 300) throw new Error('boucle');
    const [name, input] = queue.shift(); const n = nodes[name]; if (!n) continue;
    const t = n.type.split('.').pop(); const ctx = { $json: input[0] && input[0].json, $, $env, $input: { first: () => input[0], all: () => input, item: input[0] } };
    let branches = [input]; let err = null;
    try {
      if (t === 'webhook' || t === 'wait' || t === 'merge' || t === 'noOp') branches = [input];
      else if (t === 'code') { const r = await new AsyncF('$input', '$', '$env', '$json', 'console', n.parameters.jsCode).call({ helpers: { httpRequest: opts.helperHttp || (async () => ({})) } }, ctx.$input, $, $env, ctx.$json, { log() {}, warn() {}, error() {} }); branches = [r]; }
      else if (t === 'if') { const ok = evalConds(n.parameters.conditions, ctx); branches = ok ? [input, null] : [null, input]; }
      else if (t === 'switch') { const rules = (n.parameters.rules || {}).values || []; const idx = rules.findIndex(r => evalConds(r.conditions, ctx)); branches = rules.map((r, i) => i === idx ? input : null); const fb = (n.parameters.options || {}).fallbackOutput; if (idx < 0 && fb !== undefined && fb !== 'none') { const fi = fb === 'extra' ? rules.length : Number(fb); branches[fi] = input; } }
      else if (t === 'httpRequest') {
        const url = evalExpr(n.parameters.url, ctx); const bodyV = evalExpr(n.parameters.body !== undefined ? n.parameters.body : n.parameters.jsonBody, ctx);
        const r = await opts.http(name, url, bodyV, ctx);
        if (r && r.__error) throw new Error(r.__error);
        branches = [[{ json: r }]];
      }
      else if (t === 'respondToWebhook') { const rb = n.parameters.respondWith === 'json' ? evalExpr(n.parameters.responseBody, ctx) : ctx.$json; response = typeof rb === 'string' ? (() => { try { return JSON.parse(rb); } catch (e) { return rb; } })() : rb; trace.push(name); outs[name] = input; break; }
      else throw new Error('type non géré : ' + t);
    } catch (e) { err = e; }
    if (err) {
      trace.push(name + ' ✗ ' + err.message.slice(0, 80));
      if (n.onError === 'continueErrorOutput') branches = [null, [{ json: { error: { message: err.message } } }]];
      else if (n.onError === 'continueRegularOutput') branches = [[{ json: { error: { message: err.message } } }]];
      else return { response: null, trace, crash: name + ' : ' + err.message, outs };
    } else trace.push(name);
    outs[name] = (branches.find(b => b) || []);
    ((C[name] || {}).main || []).forEach((grp, i) => { const b = branches[i]; if (b && b.length) (grp || []).forEach(c => queue.push([c.node, b])); });
  }
  return { response, trace, outs };
}
module.exports = { run };
