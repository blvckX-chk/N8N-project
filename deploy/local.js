'use strict';
// Écrit les fichiers générés sur le disque (dossier dist/ prêt à héberger).
const fs = require('fs');
const path = require('path');

function writeDist(files, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of files) {
    const dest = path.join(outDir, f.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.content);
  }
  return { outDir, count: files.length };
}

module.exports = { writeDist };
