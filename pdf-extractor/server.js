// ============================================================================
// Forge IA — Service d'extraction de documents (PDF / DOCX)
// ----------------------------------------------------------------------------
// Isolé hors de n8n À DESSEIN : l'extraction PDF (pdf-parse / pdf.js) et DOCX
// (mammoth) manipule des binaires et des bindings natifs qui font planter le
// task runner de n8n. On l'externalise donc dans ce microservice, appelé par
// l'Orchestrateur via http://host.docker.internal:3002.
//
// Contrat (imposé par les nœuds « Extract PDF/DOCX Text » de l'Orchestrateur) :
//   POST /extract       { pdf_base64, filename? }   -> { text, success, num_pages? }
//   POST /extract-docx  { docx_base64, filename? }  -> { text, success }
//   GET  /health                                    -> { status: 'OK', ... }
//
// Robustesse : on répond TOUJOURS 200 avec un drapeau `success`. Le nœud n8n
// `throw` uniquement si la réponse n'est pas 200 ; en renvoyant 200 même en
// échec d'extraction, on dégrade proprement (texte vide -> STOP « spec trop
// courte » côté Spec Linter) au lieu de casser toute l'exécution.
// ============================================================================
const express  = require('express');
const pdfParse = require('pdf-parse');
const mammoth  = require('mammoth');

const app  = express();
const PORT = process.env.PORT || 3002;
const APP_VERSION = '1.0.0';
const START_TIME  = new Date().toISOString();

app.use(express.json({ limit: process.env.MAX_BODY || '30mb' }));

// Décode un base64 éventuellement préfixé par une data-URI (data:...;base64,XXXX)
function decodeBase64(s) {
  if (typeof s !== 'string' || !s) return null;
  let c = s.startsWith('data:') ? s.slice(s.indexOf(',') + 1) : s;
  c = c.replace(/\s/g, '');
  try { const b = Buffer.from(c, 'base64'); return b.length ? b : null; }
  catch (e) { return null; }
}

app.get('/health', function (req, res) {
  res.json({ status: 'OK', service: 'forge-extractor', version: APP_VERSION, started_at: START_TIME });
});

// ── PDF ───────────────────────────────────────────────────────────────────────
app.post('/extract', async function (req, res) {
  try {
    const b = req.body || {};
    const buf = decodeBase64(b.pdf_base64);
    if (!buf) return res.json({ text: '', success: false, error: 'pdf_base64 manquant ou invalide' });
    const data = await pdfParse(buf);
    const text = String(data.text || '').trim();
    return res.json({
      text: text,
      success: text.length > 0,
      num_pages: data.numpages || null,
      filename: b.filename || null
    });
  } catch (e) {
    console.error('[POST /extract]', e.message);
    return res.json({ text: '', success: false, error: 'Extraction PDF échouée : ' + e.message });
  }
});

// ── DOCX ──────────────────────────────────────────────────────────────────────
app.post('/extract-docx', async function (req, res) {
  try {
    const b = req.body || {};
    const buf = decodeBase64(b.docx_base64);
    if (!buf) return res.json({ text: '', success: false, error: 'docx_base64 manquant ou invalide' });
    const result = await mammoth.extractRawText({ buffer: buf });
    const text = String(result.value || '').trim();
    return res.json({ text: text, success: text.length > 0, filename: b.filename || null });
  } catch (e) {
    console.error('[POST /extract-docx]', e.message);
    return res.json({ text: '', success: false, error: 'Extraction DOCX échouée : ' + e.message });
  }
});

app.listen(PORT, function () {
  console.log('✅ Forge Extractor v' + APP_VERSION + ' sur le port ' + PORT);
});
