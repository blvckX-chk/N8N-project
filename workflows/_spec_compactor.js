// ============================================================================
// Compacteur déterministe de spec — distille un long document en un extrait
// centré sur ce qui sert à GÉNÉRER (ressources, champs, types, routes, règles,
// acteurs, permissions), en jetant le bruit (juridique, glossaire, références,
// prose de justification, en-têtes/pieds de page répétés).
// Ne s'active qu'au-delà de THRESHOLD ; sinon renvoie le texte intact.
// Aucun appel LLM : 100% déterministe.
// ============================================================================
function compactSpec(raw, opts) {
  opts = opts || {};
  var TARGET = opts.target || 36000;      // taille cible de l'extrait gardé
  var THRESHOLD = opts.threshold || 38000; // en dessous : on ne touche à rien

  raw = String(raw || '');
  var originalLen = raw.length;

  // Nettoyage léger des caractères de contrôle
  raw = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  if (raw.length <= THRESHOLD) {
    return { text: raw, compacted: false, original_len: originalLen, kept_len: raw.length,
             dropped_len: 0, reason: 'sous le seuil (' + THRESHOLD + '), spec envoyée intégralement' };
  }

  var lines = raw.split(/\r?\n/);

  // 1) Retirer les lignes répétées trop souvent (en-têtes/pieds de PDF, numéros de page)
  var freq = {};
  lines.forEach(function (l) { var t = l.trim(); if (t) freq[t] = (freq[t] || 0) + 1; });
  var deNoised = lines.filter(function (l) {
    var t = l.trim();
    if (!t) return true;
    // une ligne répétée >5 fois = redondance (en-tête/pied de PDF, glossaire,
    // prose juridique dupliquée...). On la retire quelle que soit sa longueur ;
    // une vraie déclaration (champ/route/règle) ne se répète pas 5 fois.
    if (freq[t] > 5 && t.length >= 3) return false;
    return true;
  });

  // 2) Détecteurs de lignes "signal" (à garder)
  var reHeadingMd  = /^#{1,6}\s+\S/;
  var reHeadingNum = /^\s*\d+(?:\.\d+)*\.?\s+[A-Za-zÀ-ÿ]/;
  var reTableRow   = /\|/;
  var reRoute      = /\b(GET|POST|PUT|PATCH|DELETE)\s+\/\S/i;
  var reFieldType  = /\b[a-zA-Z_][a-zA-Z0-9_]*\s*[:|]\s*(string|number|text|integer|int|real|float|bool|boolean|date|datetime)\b/i;
  var reJsonField  = /"[a-zA-Z_][a-zA-Z0-9_]*"\s*:/;
  var reBullet     = /^\s*[-*•]\s+/;
  var reRuleKw     = /\b(doit|must|obligatoire|required|requis|unique|entre|between|positif|positive|sup[ée]rieur|inf[ée]rieur|minimum|maximum|\bmin\b|\bmax\b|>=|<=|coh[ée]rent|valide|validation|parmi|among|format|au moins|at least|ne peut|référ|foreign|cl[ée] [ée]trang)/i;
  var reResourceKw = /\b(ressource|resource|entit[ée]|table|champ|field|acteur|actor|r[ôo]le|permission|route|endpoint|point d.acc|schema|mod[èe]le de donn)/i;

  var GENERIC_HEADING_NOISE = /glossaire|glossary|r[ée]f[ée]rence|bibliograph|annexe|appendix|stride|menace|threat|juridique|r[ée]glementaire|\blegal\b|rgpd|\bloi\b|sanction|\bdroit\b|remerciement|sommaire|table des mati|contents|historique|introduction|contexte/i;

  function isHeading(l) { return reHeadingMd.test(l) || reHeadingNum.test(l); }
  function isSignal(l) {
    var t = l.trim();
    if (!t) return false;
    if (reTableRow.test(t)) return true;
    if (reRoute.test(t)) return true;
    if (reFieldType.test(t)) return true;
    if (reJsonField.test(t)) return true;
    if (reBullet.test(t) && reRuleKw.test(t)) return true;
    if (reResourceKw.test(t) && t.length <= 180) return true;
    return false;
  }

  // 3) Toujours garder l'en-tête du doc (titre / nom de projet) : 12 premières non-vides
  var head = [];
  for (var i = 0; i < deNoised.length && head.length < 12; i++) {
    if (deNoised[i].trim()) head.push(deNoised[i]);
  }

  // 4) Parcours : garder titres + lignes de signal. Les titres "bruit" sont
  //    conservés seulement s'ils encadrent du signal (on garde le titre juste
  //    au-dessus d'une ligne signal pour le contexte).
  var kept = [];
  var keptSet = {};
  function push(l) {
    var key = l.trim();
    if (key && keptSet[key] && key.length < 60) return; // évite les doublons courts
    keptSet[key] = true;
    kept.push(l);
  }
  head.forEach(push);

  var headingsKept = 0, headingsDropped = 0, signalKept = 0;
  var pendingHeading = null;
  for (var j = 0; j < deNoised.length; j++) {
    var l = deNoised[j];
    var t = l.trim();
    if (!t) continue;
    if (isHeading(l)) {
      // on mémorise le dernier titre ; on ne le pousse que s'il précède du signal
      var noise = GENERIC_HEADING_NOISE.test(t) && !reResourceKw.test(t);
      pendingHeading = noise ? null : l;      // titre bruit -> pas de contexte
      if (noise) headingsDropped++;
      continue;
    }
    if (isSignal(l)) {
      if (pendingHeading) { push(''); push(pendingHeading); pendingHeading = null; headingsKept++; }
      push(l);
      signalKept++;
    }
    // sinon : prose -> jetée
  }

  var text = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  // 5) Si encore trop long, on tronque en gardant le début (structure + data model
  //    + API arrivent tôt) et on signale.
  var hardTruncated = false;
  if (text.length > TARGET) { text = text.slice(0, TARGET); hardTruncated = true; }

  return {
    text: text,
    compacted: true,
    original_len: originalLen,
    kept_len: text.length,
    dropped_len: originalLen - text.length,
    headings_kept: headingsKept,
    headings_dropped: headingsDropped,
    signal_lines: signalKept,
    hard_truncated: hardTruncated,
    reason: 'spec > ' + THRESHOLD + ' : compactée aux lignes utiles (ressources/champs/routes/règles/acteurs/permissions)'
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { compactSpec: compactSpec };
