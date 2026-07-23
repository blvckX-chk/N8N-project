// ============================================================================
// SPRINT 5 — Générateur d'incréments (mode différentiel)
// ----------------------------------------------------------------------------
// Entrée  : current_state (introspection Sprint 4) + target (spec cible)
// Sortie  : uniquement le DELTA, sous forme de fichiers additifs
//           - migrations/NNN_add_<store>.sql        (nouvelle table)
//           - modules/NNN_<store>.routes.js         (routes CRUD scopées user_id)
//           + plan du diff (resources ajoutées / inchangées / routes ajoutées)
// Principe : purement additif (sûr). On ne réécrit jamais l'existant.
//            S'appuie sur le socle Sprint 3 (migrations versionnées + module loader).
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
  var files = [];

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

    // ---- migration SQL (colonnes métier + user_id + created_at) ----
    migNum += 1;
    var migName = 'migrations/' + pad(migNum) + '_add_' + store + '.sql';
    var cols = [];
    cols.push('  id INTEGER PRIMARY KEY AUTOINCREMENT');
    fieldNames.forEach(function (f) {
      var notNull = (required.indexOf(f) >= 0) ? ' NOT NULL' : '';
      cols.push('  ' + f + ' ' + sqlType(fields[f]) + notNull);
    });
    cols.push('  user_id INTEGER NOT NULL REFERENCES users(id)');
    cols.push("  created_at TEXT DEFAULT (datetime('now'))");
    var sql = '-- Increment Sprint 5 : table ' + store + '\n' +
      'CREATE TABLE IF NOT EXISTS ' + store + ' (\n' + cols.join(',\n') + '\n);\n';
    files.push({ path: migName, content: sql });

    // ---- module routes.js (factory chargée par le socle Sprint 3) ----
    modNum += 1;
    var modName = 'modules/' + pad(modNum) + '_' + store + '.routes.js';
    var insCols = ['user_id'].concat(fieldNames);
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
    L.push("    try { res.json(db.prepare('SELECT * FROM " + store + " WHERE user_id = ? ORDER BY id ASC').all(req.user.sub)); }");
    L.push("    catch (e) { console.error('[GET /" + store + "]', e.message); res.status(500).json({ message: 'Erreur interne' }); }");
    L.push('  });');
    L.push("  app.delete('/" + store + "/:id', authMiddleware, function (req, res) {");
    L.push('    try {');
    L.push('      var id = parseInt(req.params.id, 10);');
    L.push("      var found = db.prepare('SELECT id FROM " + store + " WHERE id = ? AND user_id = ?').get(id, req.user.sub);");
    L.push("      if (!found) return res.status(404).json({ message: 'Introuvable' });");
    L.push("      db.prepare('DELETE FROM " + store + " WHERE id = ? AND user_id = ?').run(id, req.user.sub);");
    L.push("      res.json({ message: 'Supprime' });");
    L.push("    } catch (e) { console.error('[DELETE /" + store + "]', e.message); res.status(500).json({ message: 'Erreur interne' }); }");
    L.push('  });');
    L.push('};');
    files.push({ path: modName, content: L.join('\n') });

    newResources.push({ name: r.name || store.replace(/s$/, ''), store_name: store, fields: fields, required_fields: required, migration: migName, module: modName });
  });

  var unchanged = curResources.map(function (r) { return r.store_name; });

  return {
    mode: newResources.length ? 'differential' : 'noop',
    diff: {
      added_resources: newResources.map(function (r) { return r.store_name; }),
      unchanged_resources: unchanged,
      files_generated: files.map(function (f) { return f.path; })
    },
    increment_files: files,
    new_resources: newResources
  };
}

// Export pour test Node ; en n8n on colle le corps dans un Code node.
if (typeof module !== 'undefined' && module.exports) module.exports = { computeIncrements: computeIncrements };
