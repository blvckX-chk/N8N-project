// ============================================================================
// SPRINT 5 — Générateur d'incréments (mode différentiel) — Approche A + frontend
// ----------------------------------------------------------------------------
// Entrée  : current_state (introspection Sprint 4) + target (spec cible)
// Sortie  : uniquement le DELTA, sous forme de fichiers additifs
//           - migrations/NNN_add_<store>.sql        (nouvelle table)
//           - modules/NNN_<store>.routes.js         (routes CRUD scopées user_id)
//           - frontend/ui_<store>.js                (section UI additive, CSP-safe)
//           + injection <section> + <script> dans frontend/index.html (existant)
//           + plan du diff (resources ajoutées / inchangées / routes ajoutées)
// Principe : purement additif (sûr). On ne réécrit jamais un fichier métier existant.
//            index.html est seulement AUGMENTÉ (section + script), jamais réécrit.
//            S'appuie sur le socle Sprint 3 (migrations versionnées + module loader)
//            et sur les conventions de app.js (globals escapeHtml/showFeedback,
//            délégation d'événements data-refresh / data-del).
//
// Fonctions exportées :
//   computeIncrements(current_state, target) -> { mode, diff, increment_files,
//                                                 frontend_files, html_injection, new_resources }
//   mergeFiles(existingFiles, result)        -> tableau complet [{path, content}]
//                                                (existant passthrough + incréments
//                                                 backend + frontend + index.html augmenté)
// ============================================================================

function computeIncrements(current_state, target) {
  current_state = current_state || {};
  target = target || {};
  var curResources = current_state.resources || [];
  var curMigrations = current_state.migrations || [];   // ex: ['migrations/002_add_notes.sql']
  var curModules = current_state.modules || [];          // ex: ['modules/010_notes.routes.js']
  var tgtResources = target.resources || [];

  // -- Index des stores existants
  var existingStores = {};
  curResources.forEach(function (r) { if (r && r.store_name) existingStores[r.store_name] = true; });

  // -- Numéros de départ (on incrémente à partir du max existant)
  function maxNum(list, re) {
    var m = 1; // 001_init occupe toujours le 1 pour les migrations
    (list || []).forEach(function (p) {
      var mm = String(p).match(re);
      if (mm) { var n = parseInt(mm[1], 10); if (n > m) m = n; }
    });
    return m;
  }
  var migNum = Math.max(1, maxNum(curMigrations, /(\d+)_/));      // migrations : 001_init -> suivant
  var modNum = maxNum(curModules, /(\d+)_/);                       // modules : 000 si aucun
  if (modNum < 10) modNum = 9;                                     // convention : modules démarrent à 010

  // -- Type SQLite depuis un type logique
  function sqlType(t) {
    t = String(t || 'string').toLowerCase();
    if (t === 'number' || t === 'integer' || t === 'int') return 'INTEGER';
    if (t === 'real' || t === 'float' || t === 'decimal') return 'REAL';
    return 'TEXT';
  }
  function pad(n) { return (n < 10 ? '00' : (n < 100 ? '0' : '')) + n; }

  var newResources = [];
  var files = [];            // incréments backend (migrations + modules)
  var frontendFiles = [];    // frontend/ui_<store>.js (nouveaux fichiers autonomes)
  var injSections = [];      // sections HTML à injecter dans index.html
  var injScripts = [];       // balises <script> à injecter dans index.html

  tgtResources.forEach(function (r) {
    if (!r || !r.store_name) return;
    if (existingStores[r.store_name]) return; // déjà présent -> préservé, aucun incrément

    var store = r.store_name;
    var fields = r.fields || {};
    var required = r.required_fields || [];
    var fieldNames = Object.keys(fields);
    // fallback : si pas de fields détaillés, on part des required_fields (type string par défaut)
    if (fieldNames.length === 0 && required.length) {
      required.forEach(function (f) { fields[f] = 'string'; });
      fieldNames = required.slice();
    }
    // Mode partagé (Sprint 6) : ressource référentiel/inventaire consultable par tous
    // les acteurs authentifiés. Colonne de provenance `created_by`, lecture non filtrée,
    // suppression réservée au créateur. Sinon (défaut) : isolation par `user_id`.
    var shared = (r.shared === true) ||
      (Array.isArray(target.shared_resources) && target.shared_resources.indexOf(store) >= 0);
    var ownerCol = shared ? 'created_by' : 'user_id';

    // ---- migration SQL (colonnes métier + colonne propriétaire + created_at) ----
    migNum += 1;
    var migName = 'migrations/' + pad(migNum) + '_add_' + store + '.sql';
    var cols = [];
    cols.push('  id INTEGER PRIMARY KEY AUTOINCREMENT');
    fieldNames.forEach(function (f) {
      var notNull = (required.indexOf(f) >= 0) ? ' NOT NULL' : '';
      cols.push('  ' + f + ' ' + sqlType(fields[f]) + notNull);
    });
    cols.push('  ' + ownerCol + ' INTEGER NOT NULL REFERENCES users(id)');
    cols.push("  created_at TEXT DEFAULT (datetime('now'))");
    var sql = '-- Increment Sprint 5 : table ' + store + '\n' +
      'CREATE TABLE IF NOT EXISTS ' + store + ' (\n' + cols.join(',\n') + '\n);\n';
    files.push({ path: migName, content: sql });

    // ---- module routes.js (factory chargée par le socle Sprint 3) ----
    modNum += 1;
    var modName = 'modules/' + pad(modNum) + '_' + store + '.routes.js';
    var insCols = [ownerCol].concat(fieldNames);
    var insPlace = insCols.map(function () { return '?'; }).join(', ');
    var insVals = ['req.user.sub'].concat(fieldNames.map(function (f) { return 'req.body.' + f; }));
    var reqCheck = required.length
      ? ('    var _miss = [' + required.map(function (f) { return "'" + f + "'"; }).join(', ') +
         '].filter(function(k){ return req.body[k] === undefined || req.body[k] === null || req.body[k] === ""; });\n' +
         '    if (_miss.length) return res.status(400).json({ message: "Champs requis manquants : " + _miss.join(", ") });\n')
      : '';

    var L = [];
    L.push('// Module additif genere par Forge IA (Sprint 5) pour la ressource ' + store);
    L.push('// Charge automatiquement par le socle : factory app, db, authMiddleware');
    L.push('module.exports = function (app, db, authMiddleware) {');
    L.push("  app.post('/" + store + "', authMiddleware, function (req, res) {");
    L.push('    try {');
    if (reqCheck) L.push(reqCheck.replace(/\n$/, ''));
    L.push("      var stmt = db.prepare('INSERT INTO " + store + " (" + insCols.join(', ') + ") VALUES (" + insPlace + ")');");
    L.push('      var result = stmt.run(' + insVals.join(', ') + ');');
    L.push("      var item = db.prepare('SELECT * FROM " + store + " WHERE id = ?').get(result.lastInsertRowid);");
    L.push('      res.status(201).json(item);');
    L.push("    } catch (e) { console.error('[POST /" + store + "]', e.message); res.status(500).json({ message: 'Erreur interne' }); }");
    L.push('  });');
    L.push("  app.get('/" + store + "', authMiddleware, function (req, res) {");
    if (shared) {
      L.push("    try { res.json(db.prepare('SELECT * FROM " + store + " ORDER BY id ASC').all()); }");
    } else {
      L.push("    try { res.json(db.prepare('SELECT * FROM " + store + " WHERE user_id = ? ORDER BY id ASC').all(req.user.sub)); }");
    }
    L.push("    catch (e) { console.error('[GET /" + store + "]', e.message); res.status(500).json({ message: 'Erreur interne' }); }");
    L.push('  });');
    L.push("  app.delete('/" + store + "/:id', authMiddleware, function (req, res) {");
    L.push('    try {');
    L.push('      var id = parseInt(req.params.id, 10);');
    L.push("      var found = db.prepare('SELECT id FROM " + store + " WHERE id = ? AND " + ownerCol + " = ?').get(id, req.user.sub);");
    L.push("      if (!found) return res.status(404).json({ message: 'Introuvable' });");
    L.push("      db.prepare('DELETE FROM " + store + " WHERE id = ? AND " + ownerCol + " = ?').run(id, req.user.sub);");
    L.push("      res.json({ message: 'Supprime' });");
    L.push("    } catch (e) { console.error('[DELETE /" + store + "]', e.message); res.status(500).json({ message: 'Erreur interne' }); }");
    L.push('  });');
    L.push('};');
    files.push({ path: modName, content: L.join('\n') });

    // ---- frontend : frontend/ui_<store>.js (CSP-safe, additif) ----
    // Aucun gestionnaire inline : on définit window.loadItems_<store> /
    // window.deleteItem_<store> et on branche le formulaire via addEventListener.
    // La délégation data-refresh / data-del est déjà gérée par app.js existant.
    var uiName = 'frontend/ui_' + store + '.js';
    var singular = String(r.name || store.replace(/s$/, ''));
    var label = store.charAt(0).toUpperCase() + store.slice(1);
    var titleField = fieldNames[0] || 'id';
    var metaFields = fieldNames.slice(1);

    var U = [];
    U.push('// Module frontend additif genere par Forge IA (Sprint 5) pour la ressource ' + store);
    U.push('// CSP-safe : aucun handler inline. Reutilise app.js (escapeHtml, showFeedback, delegation data-*).');
    U.push('(function () {');
    U.push('  var STORE = "' + store + '";');
    U.push('  var API = "/' + store + '";');
    U.push('  function esc(s) {');
    U.push('    if (typeof window.escapeHtml === "function") return window.escapeHtml(s);');
    U.push('    return String(s == null ? "" : s).replace(/[&<>"\']/g, function (c) {');
    U.push('      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\"": "&quot;", "\'": "&#39;" })[c];');
    U.push('    });');
    U.push('  }');
    U.push('  function fb(msg, type) { if (typeof window.showFeedback === "function") window.showFeedback(STORE, msg, type); }');
    // ---- loadItems ----
    U.push('  window.loadItems_' + store + ' = async function () {');
    U.push('    var list = document.getElementById("list-' + store + '");');
    U.push('    if (!list) return;');
    U.push('    list.innerHTML = "<div class=\'loading\'>Chargement...</div>";');
    U.push('    try {');
    U.push('      var res = await fetch(API, { headers: { "Accept": "application/json" } });');
    U.push('      if (!res.ok) { list.innerHTML = "<div class=\'empty-state\'>Erreur de chargement</div>"; return; }');
    U.push('      var items = await res.json();');
    U.push('      if (!Array.isArray(items) || !items.length) { list.innerHTML = "<div class=\'empty-state\'>Aucun element</div>"; return; }');
    U.push('      var html = "";');
    U.push('      items.forEach(function (item) {');
    U.push('        var title = esc(item.' + titleField + ' != null ? item.' + titleField + ' : ("#" + item.id));');
    U.push('        var _meta = [];');
    metaFields.forEach(function (f) {
      U.push('        if (item.' + f + ' != null && item.' + f + ' !== "") _meta.push("' + f + ' : " + esc(item.' + f + '));');
    });
    U.push('        var meta = _meta.join(" | ");');
    U.push('        html += "<div class=\'item-card\'><div class=\'item-info\'>" +');
    U.push('          "<div class=\'item-title\'>" + title + "</div>" +');
    U.push('          "<div class=\'item-meta\'>" + meta + "</div></div>" +');
    U.push('          "<button class=\'btn-danger\' data-del=\'" + STORE + "\' data-id=\'" + item.id + "\'>Supprimer</button></div>";');
    U.push('      });');
    U.push('      list.innerHTML = html;');
    U.push('    } catch (err) { console.error("[loadItems_' + store + ']", err.message); list.innerHTML = "<div class=\'empty-state\'>Erreur</div>"; }');
    U.push('  };');
    // ---- deleteItem ----
    U.push('  window.deleteItem_' + store + ' = async function (id) {');
    U.push('    try { await fetch(API + "/" + id, { method: "DELETE" }); window.loadItems_' + store + '(); }');
    U.push('    catch (err) { console.error("[deleteItem_' + store + ']", err.message); }');
    U.push('  };');
    // ---- init (formulaire + premier chargement) ----
    U.push('  document.addEventListener("DOMContentLoaded", function () {');
    U.push('    var form = document.getElementById("form-create-' + store + '");');
    U.push('    if (form) {');
    U.push('      form.addEventListener("submit", async function (e) {');
    U.push('        e.preventDefault();');
    U.push('        var payload = {};');
    fieldNames.forEach(function (f) {
      var isNum = sqlType(fields[f]) !== 'TEXT';
      U.push('        var _el_' + f + ' = document.getElementById("field-' + store + '-' + f + '");');
      U.push('        if (_el_' + f + ') payload.' + f + ' = ' + (isNum ? 'Number(_el_' + f + '.value)' : '_el_' + f + '.value') + ';');
    });
    U.push('        try {');
    U.push('          var res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });');
    U.push('          if (res.ok) { form.reset(); fb("Cree avec succes", "success"); window.loadItems_' + store + '(); }');
    U.push('          else { var d = await res.json().catch(function () { return {}; }); fb(d.message || "Erreur", "error"); }');
    U.push('        } catch (err) { fb(err.message, "error"); }');
    U.push('      });');
    U.push('    }');
    U.push('    window.loadItems_' + store + '();');
    U.push('  });');
    U.push('})();');
    frontendFiles.push({ path: uiName, content: U.join('\n') });

    // ---- section HTML à injecter dans index.html (attributs double-quote, style existant) ----
    var S = [];
    S.push('    <section class="card" id="section-create-' + store + '">');
    S.push('      <h2 class="card-title">Creer ' + singular + '</h2>');
    S.push('      <form id="form-create-' + store + '" class="create-form">');
    fieldNames.forEach(function (f) {
      var inputType = (sqlType(fields[f]) !== 'TEXT') ? 'number' : 'text';
      var reqAttr = (required.indexOf(f) >= 0) ? ' required' : '';
      S.push('        <div class="form-group">');
      S.push('          <label for="field-' + store + '-' + f + '">' + f + '</label>');
      S.push('          <input type="' + inputType + '" id="field-' + store + '-' + f + '" name="' + f + '" placeholder="' + f + '" class="form-input"' + reqAttr + '>');
      S.push('        </div>');
    });
    S.push('        <button type="submit" class="btn btn-primary">Creer</button>');
    S.push('      </form>');
    S.push('      <div id="feedback-' + store + '" class="feedback"></div>');
    S.push('    </section>');
    S.push('    <section class="card" id="section-list-' + store + '">');
    S.push('      <div class="section-header">');
    S.push('        <h2 class="card-title">Liste ' + label + '</h2>');
    S.push('        <button data-refresh="' + store + '" class="btn btn-secondary">Actualiser</button>');
    S.push('      </div>');
    S.push('      <div id="list-' + store + '"></div>');
    S.push('    </section>');
    injSections.push({ store: store, html: S.join('\n') });
    injScripts.push({ store: store, tag: '  <script src="ui_' + store + '.js"></script>' });

    newResources.push({ name: r.name || store.replace(/s$/, ''), store_name: store, fields: fields, required_fields: required, migration: migName, module: modName, ui: uiName });
  });

  var unchanged = curResources.map(function (r) { return r.store_name; });
  var allGenerated = files.map(function (f) { return f.path; })
    .concat(frontendFiles.map(function (f) { return f.path; }));

  return {
    mode: newResources.length ? 'differential' : 'noop',
    diff: {
      added_resources: newResources.map(function (r) { return r.store_name; }),
      unchanged_resources: unchanged,
      files_generated: allGenerated
    },
    increment_files: files,            // backend : migrations + modules
    frontend_files: frontendFiles,     // frontend : ui_<store>.js
    html_injection: { sections: injSections, scripts: injScripts },
    new_resources: newResources
  };
}

// ============================================================================
// mergeFiles — Approche A : reconstitue l'app COMPLÈTE.
//   existingFiles : tous les fichiers de l'app existante (passthrough ZIP Analyzer)
//   result        : sortie de computeIncrements
// Renvoie le tableau complet [{path, content}] :
//   existant (inchangé) + incréments backend + frontend/ui_*.js + index.html augmenté.
// index.html n'est jamais réécrit : on insère la <section> avant </main> (repli </body>)
// et le <script> avant </body>. Idempotent : ne réinjecte pas une ressource déjà présente.
// ============================================================================
function mergeFiles(existingFiles, result) {
  existingFiles = existingFiles || [];
  result = result || {};
  var out = existingFiles.map(function (f) { return { path: f.path, content: f.content }; });
  var byPath = {};
  out.forEach(function (f) { byPath[f.path] = f; });

  function addOrKeep(f) {
    if (byPath[f.path]) { byPath[f.path].content = f.content; }  // ne devrait pas arriver (incrément = nouveau)
    else { out.push(f); byPath[f.path] = f; }
  }
  (result.increment_files || []).forEach(addOrKeep);
  (result.frontend_files || []).forEach(addOrKeep);

  var inj = result.html_injection || {};
  var sections = inj.sections || [];
  var scripts = inj.scripts || [];
  if (sections.length || scripts.length) {
    // Repérer index.html (priorité à frontend/index.html)
    var idx = null;
    out.forEach(function (f) {
      if (/(^|\/)index\.html$/i.test(f.path)) {
        if (!idx || /(^|\/)frontend\/index\.html$/i.test(f.path)) idx = f;
      }
    });
    if (idx) {
      var html = idx.content || '';
      sections.forEach(function (s) {
        if (html.indexOf('id="section-create-' + s.store + '"') !== -1) return; // déjà injectée
        if (html.indexOf('</main>') !== -1) html = html.replace('</main>', s.html + '\n  </main>');
        else if (html.indexOf('</body>') !== -1) html = html.replace('</body>', s.html + '\n</body>');
        else html = html + '\n' + s.html;
      });
      scripts.forEach(function (s) {
        if (html.indexOf(s.tag.trim()) !== -1) return; // déjà présent
        if (html.indexOf('</body>') !== -1) html = html.replace('</body>', s.tag + '\n</body>');
        else html = html + '\n' + s.tag;
      });
      idx.content = html;
    }
  }
  return out;
}

// Export pour test Node ; en n8n on colle le corps dans un Code node.
if (typeof module !== 'undefined' && module.exports) module.exports = { computeIncrements: computeIncrements, mergeFiles: mergeFiles };
