'use strict';
// Déploiement FTP direct (zéro dépendance, protocole FTP sur net.Socket) — pour
// hébergement mutualisé (cPanel, OVH…). Mode passif, un transfert par fichier.
// Les fonctions pures (parsePasv, remotePath, dirsFor) sont testées unitairement ;
// le flux réseau est best-effort (dépend du serveur FTP cible).

const net = require('net');
const path = require('path');

// ------------------------------------------------------------- helpers (purs)
function parsePasv(line) {
  const m = /\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/.exec(line);
  if (!m) throw new Error('Réponse PASV illisible: ' + line);
  const ip = `${m[1]}.${m[2]}.${m[3]}.${m[4]}`;
  const port = (parseInt(m[5], 10) << 8) + parseInt(m[6], 10);
  return { ip, port };
}
function remotePath(base, p) {
  const clean = String(p).replace(/^\/+/, '').replace(/\.\.+/g, '');
  const joined = path.posix.join('/', String(base || '/').replace(/^\/?/, '/'), clean);
  return joined;
}
function dirsFor(files, base) {
  const set = new Set();
  for (const f of files) {
    const full = remotePath(base, f.path);
    const dir = path.posix.dirname(full);
    // ajoute chaque préfixe de répertoire (du plus court au plus long)
    const parts = dir.split('/').filter(Boolean);
    let acc = '';
    for (const part of parts) { acc += '/' + part; set.add(acc); }
  }
  return [...set].sort((a, b) => a.split('/').length - b.split('/').length);
}

// ------------------------------------------------------------- flux réseau
function makeControl(socket, timeoutMs) {
  let buffer = '';
  const queue = [];
  function tryResolve() {
    // Une réponse est complète dès qu'une ligne commence par "NNN " (code + espace).
    const lines = buffer.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const mm = /^(\d{3}) /.exec(lines[i]);
      if (mm && queue.length) {
        const consumed = lines.slice(0, i + 1).join('\n');
        buffer = lines.slice(i + 1).join('\n');
        const w = queue.shift();
        return w.resolve({ code: parseInt(mm[1], 10), text: consumed });
      }
    }
  }
  socket.setEncoding('utf8');
  socket.on('data', d => { buffer += d; tryResolve(); });
  function read() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout FTP')), timeoutMs);
      queue.push({ resolve: v => { clearTimeout(timer); resolve(v); }, reject });
      tryResolve();
    });
  }
  function cmd(line) { socket.write(line + '\r\n'); return read(); }
  return { read, cmd };
}

function expect(resp, codes, what) {
  const ok = Array.isArray(codes) ? codes.includes(resp.code) : resp.code === codes;
  if (!ok) throw new Error(`FTP ${what}: attendu ${codes}, reçu ${resp.code} (${(resp.text || '').trim()})`);
  return resp;
}

async function deployFtp(files, cfg = {}) {
  const host = cfg.host;
  const port = cfg.port || 21;
  const user = cfg.user;
  const password = cfg.password;
  const base = cfg.remoteDir || '/';
  const timeoutMs = cfg.timeoutMs || 20000;

  const control = await new Promise((resolve, reject) => {
    const s = net.createConnection({ host, port }, () => resolve(s));
    s.once('error', reject);
    s.setTimeout(timeoutMs, () => { s.destroy(); reject(new Error('Timeout connexion FTP')); });
  });
  const c = makeControl(control, timeoutMs);

  let uploaded = 0;
  try {
    expect(await c.read(), 220, 'bannière');
    expect(await c.cmd('USER ' + user), [331, 230], 'USER');
    expect(await c.cmd('PASS ' + password), [230, 202], 'PASS');
    expect(await c.cmd('TYPE I'), 200, 'TYPE');

    // Création des répertoires (idempotent : 550 = existe déjà, on ignore)
    for (const dir of dirsFor(files, base)) {
      const r = await c.cmd('MKD ' + dir);
      if (![257, 550].includes(r.code)) throw new Error(`MKD ${dir} -> ${r.code}`);
    }

    for (const f of files) {
      const buf = Buffer.isBuffer(f.content) ? f.content : Buffer.from(String(f.content), 'utf8');
      const dest = remotePath(base, f.path);
      const pasv = parsePasv(expect(await c.cmd('PASV'), 227, 'PASV').text);
      const dataSock = net.createConnection({ host: pasv.ip, port: pasv.port });
      const dataReady = new Promise((res, rej) => { dataSock.once('connect', res); dataSock.once('error', rej); });
      await dataReady;
      expect(await c.cmd('STOR ' + dest), [150, 125], 'STOR ' + dest);
      await new Promise((res, rej) => { dataSock.end(buf, err => err ? rej(err) : res()); });
      expect(await c.read(), [226, 250], 'transfert ' + dest);
      uploaded++;
    }
    await c.cmd('QUIT').catch(() => {});
  } finally {
    control.destroy();
  }

  return { host, remoteDir: base, files_total: files.length, files_uploaded: uploaded };
}

module.exports = { deployFtp, parsePasv, remotePath, dirsFor };
