'use strict';
// Orchestrateur du générateur : brief -> contenu (IA/déterministe) -> thème ->
// rendu -> optimisation. Renvoie les fichiers prêts à héberger + un rapport.

const { normalizeBrief } = require('./schema');
const { resolveTheme } = require('./themes');
const { buildContent } = require('./content');
const { renderSite } = require('./render');
const { optimize } = require('./optimize');

async function generateSite(input, opts = {}) {
  const brief = normalizeBrief(input);
  const theme = resolveTheme(brief.sector, brief.palette, opts.theme || brief.theme);
  const { model, source, ai, error } = await buildContent(brief, opts);
  const rendered = renderSite(brief, theme, model, { siteUrl: opts.siteUrl, ai });
  const optimized = opts.optimize === false
    ? { files: rendered.files.map(f => ({ ...f, bytes: Buffer.byteLength(f.content, 'utf8') })), report: null }
    : optimize(rendered.files);

  return {
    ok: true,
    slug: brief.slug,
    name: brief.name,
    files: optimized.files,
    report: optimized.report,
    content_source: source,
    ai_used: ai,
    ai_error: error || null,
    meta: { ...rendered.meta, theme: theme.name }
  };
}

module.exports = { generateSite };
