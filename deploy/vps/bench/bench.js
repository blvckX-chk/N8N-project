// Banc d'essai des agents : chaque workflow est exécuté tel qu'importé dans n8n.
// Usage : node deploy/vps/bench/bench.js <dossier d'une app générée décompressée> [nom d'agent]
// Rejoue chaque workflow tel qu'importé dans n8n (LLM et services externes simulés) sur une
// entrée réelle, une entrée vide et un corps illisible ; rapport dans report.json.
'use strict';
const fs = require('fs'), path = require('path'); const { run } = require('./n8nrun');
const W = path.join(__dirname, '..', 'workflows') + path.sep;
const APP = process.argv[2];
const files = []; (function walk(d) { fs.readdirSync(d).forEach(f => { const p = path.join(d, f); if (f === 'node_modules' || /\.(db|jar|log|db-wal|db-shm)$/.test(f)) return; if (fs.statSync(p).isDirectory()) walk(p); else files.push({ path: path.relative(APP, p), content: fs.readFileSync(p, 'utf8') }); }); })(APP);
const backendFiles = files.filter(f => !f.path.startsWith('frontend/'));
const code = files.map(f => '// FILE: ' + f.path + '\n' + f.content).join('\n\n');
const SPEC = 'DiaspoKoli — plateforme de transport de colis entre la diaspora et le Bénin.\nEntités :\n- Trajets : ville de départ, ville d’arrivée, date du vol, kilos disponibles, prix par kilo (FCFA)\n- Réservations : trajet, description du colis, poids estimé, statut\n- Transactions : réservation, montant, statut escrow\nRègles : le poids estimé ne peut pas dépasser 30 kg. Les paiements sont libérés 48h après la confirmation de livraison.\nRôles : voyageur, expéditeur, administrateur.';
const T = 'TASK-BENCH';
// Fuite factice assemblée à l'exécution (aucune vraie clé, et rien que les scanners de dépôt confondent)
const FAKE_LEAK = 'const k = "' + ['sk', 'live', '51Hc8fJ2eZvKYlo2C0aBcDeFgHiJkLmNoP'].join('_') + '";\nconst aws="' + 'AKIA' + 'IOSFODNN7EXAMPLE";';
const S = o => JSON.stringify(o), SE = o => '=' + JSON.stringify(o);   // formats réellement envoyés par l'Orchestrateur
const LLM_OK = c => ({ choices: [{ message: { content: typeof c === 'string' ? c : JSON.stringify(c) } }], model: 'claude-sonnet-5', usage: { total_tokens: 1000 } });
const NORM = { project_name: 'DiaspoKoli', resources: [{ name: 'trajet', name_plural: 'trajets', fields: { ville_depart: 'string', ville_arrivee: 'string', date_vol: 'string', kilos_disponibles: 'number', prix_par_kilo: 'number' }, required_fields: ['ville_depart', 'ville_arrivee', 'date_vol'] }, { name: 'reservation', name_plural: 'reservations', fields: { trajet_id: 'number', description_colis: 'string', poids_estime: 'number', statut: 'string' }, required_fields: ['trajet_id', 'poids_estime'] }], routes: [{ method: 'GET', path: '/trajets' }], business_rules: ['Le poids estimé ne peut pas dépasser 30 kg'], actors: ['voyageur', 'expediteur'], permissions: {}, normalized_spec: 'DiaspoKoli' };
const QA_LLM = { issues: [{ severity: 'medium', category: 'quality', file: 'server.js', description: 'x', evidence: "app.use(helmet(" }, { severity: 'high', category: 'security', file: 'server.js', description: 'inventée', evidence: 'eval(req.body)' }], coverage: 10, security_score: 10, quality_score: 10, verdict: 'FAIL', summary: 's' };
const DOC_LLM = { agent: 'documentation', files: [{ path: 'README.md', content: '# DiaspoKoli\n\nApplication.' }], errors: [] };
const ARCH_LLM = { agent: 'architect', artifacts: { project_name: 'DiaspoKoli', stack: 'Node.js / Express / SQLite', stores: { trajet: { store_name: 'trajets', required_fields: ['ville_depart'] } }, data_model: { trajet: { ville_depart: 'string' } }, priority_endpoints: [{ method: 'GET', path: '/trajets' }], mvp_scope: ['trajets'] } };
function httpMock(mode) {
  return async (name, url, body) => {
    url = String(url || '');
    if (/osv\.dev/.test(url)) return { results: [] };
    if (/semgrep|\/scan/.test(url)) return { results: [], errors: [] };
    if (/chat\/completions|tchavi|groq|openai|mistral|anthropic/i.test(url) || /LLM|Mistral|HTTP Request/.test(name)) {
      if (mode === 'llm_down') return { __error: 'HTTP 503 (simulé)' };
      if (mode === 'llm_garbage') return LLM_OK('ceci n’est pas du JSON');
      return LLM_OK(mode);
    }
    return { ok: true };
  };
}
const helperHttp = async (o) => { if (/mistral\.ai/.test(o.url)) throw new Error('401'); if (/forge-memory/.test(o.url)) return /search/.test(o.url) ? { count: 0, results: [] } : { id: 1, dim: 512 }; return {}; };
const AGENTS = {
  'Spec Linter': ['Agent_Spec_Linter_V1.0.json', { ok: SE({ task_id: T, improve_mode: false, userRequest: SPEC }), pauvre: SE({ task_id: T, userRequest: 'fais une app' }) }],
  'Spec Normalizer': ['Agent_Spec_Normalizer_V1.12.json', { ok: S({ task_id: T, userRequest: SPEC, language: 'javascript', framework: 'express' }) }, NORM],
  'Architect': ['Agent_Architect_V5.6.json', { ok: S({ task_id: T, userRequest: SPEC, structured_context: S(NORM), project_name: 'DiaspoKoli' }) }, ARCH_LLM],
  'Code Review': ['Agent_Code_Review_V5.0.json', { ok: S({ task_id: T, language: 'javascript', code, files }) }],
  'SAST': ['Agent_SAST_V5.5.json', { ok: S({ task_id: T, language: 'javascript', code, files }) }],
  'SCA': ['Agent_SCA_V5.1.json', { ok: S({ task_id: T, language: 'javascript', package_json: JSON.parse(files.find(f => f.path === 'package.json').content.replace(/^\/\/.*\n/, '')) }) }],
  'Secrets': ['Agent_Secrets_Scanning_V5.1.json', { ok: S({ task_id: T, language: 'javascript', files }), fuite: S({ task_id: T, language: 'javascript', files: [{ path: 'frontend/app.js', content: FAKE_LEAK }] }) }],
  'QA': ['Agent_QA_V5.7.json', { ok: S({ task_id: T, userRequest: SPEC, language: 'javascript', code, files }) }, QA_LLM],
  'DAST': ['Agent_DAST_V1.4.json', { ok: S({ task_id: T, server_js: files.find(f => f.path === 'server.js').content, environment: 'staging', target_url: 'http://localhost:3000', endpoints: ['/trajets'], simulate: 'pass' }) }],
  'Go/No-Go': ['Agent_Go_NoGo_V1.1.json', { ok: SE({ task_id: T, results: { qa: { status: 'NEEDSIMPROVEMENT', global_score: 90 }, sast: { status: 'PASS', global_score: 100 }, sca: { status: 'PASS', global_score: 100 }, secrets: { status: 'PASS', global_score: 100 }, dast: { status: 'PASS', global_score: 100, simulated: true } } }), erreurs: SE({ task_id: T, results: { qa: { status: 'ERROR', global_score: 100 }, sast: {}, sca: {}, secrets: {}, dast: {} } }) }],
  'DevOps': ['Agent_DevOps_Deploy.json', { ok: S({ task_id: T, environment: 'staging', gonogo_decision: 'CONTINUE', code: { language: 'javascript', framework: 'express', files: backendFiles } }) }],
  'Monitoring': ['Agent_Monitoring.json', { ok: S({ task_id: T, environment: 'staging', service_url: 'https://app.exemple.bj', deployed_at: new Date().toISOString(), simulate: 'healthy' }) }],
  'Cost & Performance': ['Agent_Cost_Performance.json', { ok: S({ task_id: T, environment: 'staging', service: { url: 'https://app.exemple.bj', framework: 'express', language: 'javascript', status: 'HEALTHY' }, thresholds: { max_cost_per_hour_usd: 0.5, max_response_time_ms: 1000, max_cpu_percent: 80, max_memory_percent: 85 }, simulate: '' }) }],
  'Runtime Feedback': ['Agent_Runtime_Feedback.json', { ok: S({ task_id: T, environment: 'staging', incident: { type: 'none', severity: 'low', service_url: 'https://app.exemple.bj', error_message: 'Aucun incident', duration_minutes: 0 }, monitoring_report: { status: 'HEALTHY', violations: [] } }) }],
  'Documentation': ['Agent_Documentation_V5.5.json', { ok: S({ task_id: T, project_name: 'DiaspoKoli', userRequest: SPEC, architecture: { stack: 'Node.js', endpoints: [{ method: 'GET', path: '/trajets' }], data_model: {} }, rules_header: 'Trajets : consultables par tous.', env_example: 'PORT=3000', files }) }, DOC_LLM],
  'Knowledge Memory': ['Agent_Knowledge_Memory_V2.0.json', { ecriture: SE({ task_id: T, operation: 'WRITE', kind: 'generation', project: 'diaspokoli', text: 'DiaspoKoli v1.0 générée' }), lecture: SE({ task_id: T, operation: 'READ', kind: 'generation', project: 'diaspokoli', query: 'DiaspoKoli' }) }],
  'Tests L0': ['Agent_Tests_L0_V1.0.json', { ok: SE({ task_id: T, language: 'javascript', framework: 'express', files }) }],
  'Version Manager': ['Agent_Version_Manager_V1.0.json', { ok: SE({ task_id: T, userRequest: 'Ajoute un champ téléphone aux voyageurs', existing_version: '1.0', existing_stores: { trajet: { store_name: 'trajets' } } }) }],
  'ZIP Analyzer': ['Agent_ZIP_Analyzer_V2.3.json', { vide: SE({ task_id: T, improve_mode: true, existing_zip_base64: '', userRequest: 'x' }) }],
};
(async () => {
  const only = process.argv[3]; const report = {};
  for (const [label, [file, cases, llm]] of Object.entries(AGENTS)) {
    if (only && label !== only) continue;
    const fp = fs.readdirSync(W).find(x => x.startsWith(file.replace(/_V[\d.]+\.json$/, '').replace(/\.json$/, '')) && x.endsWith('.json')) || file;
    const wf = JSON.parse(fs.readFileSync(W + fp, 'utf8'));
    const allCases = Object.assign({}, cases, { vide: cases.vide || S({}), illisible: 'pas du json' });
    const modes = llm ? [['llm_ok', llm], ['llm_down', 'llm_down'], ['llm_garbage', 'llm_garbage']] : [['-', null]];
    report[label] = { workflow: wf.name, runs: [] };
    for (const [cname, body] of Object.entries(allCases)) for (const [mname, mode] of modes) {
      if (cname !== 'ok' && mname !== '-' && mname !== 'llm_ok') continue;
      let r; try { r = await run(wf, null, { rawBody: body, http: httpMock(mode), helperHttp, env: {} }); } catch (e) { r = { crash: e.message, trace: [] }; }
      const resp = r.response || {}; const j = resp.json || resp;
      report[label].runs.push({ cas: cname, llm: mname, crash: r.crash || null, agent: j.agent || null, _version: j._version || null, status: j.status || j.verdict || j.decision || j.operation || null, score: j.global_score != null ? j.global_score : null, degraded: j.degraded || j._llm_fallback || null, cles: Object.keys(j).slice(0, 14).join(','), fin: r.trace.slice(-2).join(' > '), apercu: JSON.stringify(j).slice(0, 160) });
    }
  }
  fs.writeFileSync(path.join(process.env.BENCH_OUT || __dirname, 'report.json'), JSON.stringify(report, null, 1));
  for (const [k, v] of Object.entries(report)) { console.log('### ' + k + ' — ' + v.workflow); v.runs.forEach(x => console.log('  ' + (x.cas + '/' + x.llm).padEnd(22) + (x.crash ? 'CRASH ' + x.crash.slice(0, 90) : ('statut=' + x.status + ' score=' + x.score + ' v=' + x._version + (x.degraded ? ' dégradé' : '') + ' | fin: ' + x.fin)).slice(0, 200))); }
})();
