#!/usr/bin/env node
'use strict';
// CLI : génère un site vitrine et l'écrit dans dist/ (option ZIP, option deploy).
//
//   node cli.js --input brief.json --out dist
//   node cli.js --input brief.json --zip site.zip
//   node cli.js --input brief.json --deploy netlify --site-name mon-site
//   echo '{"name":"...","sector":"..."}' | node cli.js --out dist

require('./load-env');
const fs = require('fs');
const path = require('path');
const { generateSite } = require('./generator');
const { writeDist } = require('./deploy/local');
const { createZip } = require('./deploy/zip');

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) { const key = k.slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; a[key] = v; }
  }
  return a;
}

function readInput(a) {
  if (a.input) return JSON.parse(fs.readFileSync(a.input, 'utf8'));
  if (!process.stdin.isTTY) {
    const raw = fs.readFileSync(0, 'utf8').trim();
    if (raw) return JSON.parse(raw);
  }
  throw new Error('Aucune entrée. Utilise --input <fichier.json> ou passe du JSON via stdin.');
}

(async () => {
  try {
    const a = parseArgs(process.argv);
    const input = readInput(a);
    const result = await generateSite(input, { siteUrl: a['site-url'] || a.url || '' });

    const outDir = a.out ? String(a.out) : 'dist';
    writeDist(result.files, outDir);

    console.log(`✅ Site "${result.name}" généré → ${outDir}/`);
    console.log(`   thème: ${result.meta.theme} · sections: ${result.meta.sections.join(', ')}`);
    console.log(`   contenu: ${result.content_source}${result.ai_used ? ' (IA)' : ''}`);
    if (result.report) console.log(`   ${result.report.files} fichiers · ${result.report.total_kb} Ko · -${result.report.saved_pct}% après minification`);
    if (result.ai_error) console.log(`   ⚠️ IA indisponible (repli déterministe): ${result.ai_error}`);

    if (a.zip) {
      const zipPath = a.zip === true ? `${result.slug}.zip` : String(a.zip);
      fs.writeFileSync(zipPath, createZip(result.files));
      console.log(`📦 Archive → ${zipPath}`);
    }

    if (a.deploy === 'netlify') {
      const { deployNetlify } = require('./deploy/netlify');
      const dep = await deployNetlify(result.files, { siteName: a['site-name'], siteId: a['site-id'] });
      console.log(`🚀 Déployé sur Netlify → ${dep.url || '(voir dashboard)'}`);
      console.log(`   ${dep.files_uploaded}/${dep.files_total} fichiers uploadés · site ${dep.site_id}`);
    }
  } catch (e) {
    console.error('❌ ' + (e.message || e));
    process.exit(1);
  }
})();
