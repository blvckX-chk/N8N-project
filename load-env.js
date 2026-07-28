'use strict';
// Chargeur .env minimal (zéro dépendance). Ne remplace pas une variable déjà
// définie dans l'environnement. Silencieux si le fichier n'existe pas.
const fs = require('fs');
const path = require('path');

try {
  const p = path.join(__dirname, '.env');
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const s = line.trim();
      if (!s || s.startsWith('#')) continue;
      const i = s.indexOf('=');
      if (i === -1) continue;
      const key = s.slice(0, i).trim();
      let val = s.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !(key in process.env)) process.env[key] = val;
    }
  }
} catch (_) { /* ignore */ }
