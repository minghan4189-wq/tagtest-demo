'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT) || 3789;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');

const MAX_ACCOUNT_LEN = 64;
const MAX_BODY = 50 * 1024 * 1024; // 50MB — state can include base64 images

fs.mkdirSync(DATA, { recursive: true });

function send(res, status, body, headers) {
  const h = Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers || {});
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, h);
  res.end(payload);
}

function sendText(res, status, text, contentType) {
  res.writeHead(status, { 'Content-Type': contentType || 'text/plain; charset=utf-8' });
  res.end(text);
}

/** Normalize + sanitize accountId for filesystem. Rejects path traversal. */
function sanitizeAccountId(raw) {
  if (raw == null) return { error: 'accountId 必填' };
  const id = String(raw).trim();
  if (!id) return { error: 'accountId 不能为空' };
  if (id.length > MAX_ACCOUNT_LEN) return { error: 'accountId 最长 ' + MAX_ACCOUNT_LEN + ' 字符' };
  // Allow letters, numbers, CJK, underscore, hyphen, @, ., space → map to safe dir name
  if (/[\/\\]|\.\./.test(id)) return { error: 'accountId 含非法路径字符' };
  // Encode to a filesystem-safe directory name (preserves uniqueness)
  const safe = Buffer.from(id, 'utf8').toString('hex');
  if (!safe || safe.length > 200) return { error: 'accountId 编码后过长' };
  return { id, safe };
}

function accountDir(safe) {
  const dir = path.join(DATA, safe);
  // Ensure resolved path stays under DATA
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(path.resolve(DATA) + path.sep) && resolved !== path.resolve(DATA)) {
    return null;
  }
  return resolved;
}

function statePath(safe) {
  const dir = accountDir(safe);
  if (!dir) return null;
  return path.join(dir, 'state.json');
}

function metaPath(safe) {
  const dir = accountDir(safe);
  if (!dir) return null;
  return path.join(dir, 'meta.json');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      if (!buf.length) return resolve(null);
      try {
        resolve(JSON.parse(buf.toString('utf8')));
      } catch (e) {
        reject(Object.assign(new Error('JSON 解析失败'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function ensureAccount(id, safe) {
  const dir = accountDir(safe);
  if (!dir) throw Object.assign(new Error('非法 accountId'), { status: 400 });
  fs.mkdirSync(dir, { recursive: true });
  const meta = metaPath(safe);
  if (!fs.existsSync(meta)) {
    fs.writeFileSync(meta, JSON.stringify({ accountId: id, createdAt: new Date().toISOString() }, null, 2), 'utf8');
  }
  return dir;
}

function listAccounts() {
  const out = [];
  if (!fs.existsSync(DATA)) return out;
  for (const name of fs.readdirSync(DATA)) {
    const meta = path.join(DATA, name, 'meta.json');
    try {
      if (fs.existsSync(meta)) {
        const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
        out.push({
          accountId: m.accountId || name,
          createdAt: m.createdAt || null,
          hasState: fs.existsSync(path.join(DATA, name, 'state.json')),
        });
      }
    } catch (_) { /* skip bad dirs */ }
  }
  return out;
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  // Prevent path traversal
  const file = path.resolve(PUBLIC, '.' + rel);
  if (!file.startsWith(path.resolve(PUBLIC))) {
    return sendText(res, 403, 'Forbidden');
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return sendText(res, 404, 'Not Found');
  }
  const ext = path.extname(file).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  };
  const data = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  // CORS for local demo (same-origin normally; keep simple)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const u = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = u.pathname;

  try {
    if (pathname === '/api/login' && req.method === 'POST') {
      const body = await readBody(req);
      const s = sanitizeAccountId(body && body.accountId);
      if (s.error) return send(res, 400, { ok: false, error: s.error });
      ensureAccount(s.id, s.safe);
      return send(res, 200, { ok: true, accountId: s.id });
    }

    if (pathname === '/api/state' && req.method === 'GET') {
      const s = sanitizeAccountId(u.searchParams.get('accountId'));
      if (s.error) return send(res, 400, { ok: false, error: s.error });
      ensureAccount(s.id, s.safe);
      const sp = statePath(s.safe);
      if (!fs.existsSync(sp)) {
        return send(res, 200, { ok: true, accountId: s.id, empty: true, state: null });
      }
      const raw = fs.readFileSync(sp, 'utf8');
      let state;
      try { state = JSON.parse(raw); } catch (e) {
        return send(res, 500, { ok: false, error: 'state.json 损坏' });
      }
      return send(res, 200, { ok: true, accountId: s.id, empty: false, state });
    }

    if (pathname === '/api/state' && req.method === 'PUT') {
      const body = await readBody(req);
      const s = sanitizeAccountId(body && body.accountId);
      if (s.error) return send(res, 400, { ok: false, error: s.error });
      if (!body || body.state == null || typeof body.state !== 'object') {
        return send(res, 400, { ok: false, error: 'state 必须是对象' });
      }
      ensureAccount(s.id, s.safe);
      const sp = statePath(s.safe);
      const tmp = sp + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(body.state), 'utf8');
      fs.renameSync(tmp, sp);
      return send(res, 200, { ok: true, accountId: s.id });
    }

    if (pathname === '/api/accounts' && req.method === 'GET') {
      return send(res, 200, { ok: true, accounts: listAccounts() });
    }

    if (pathname === '/api/health' && req.method === 'GET') {
      return send(res, 200, { ok: true, service: 'tagtest-demo', port: PORT });
    }

    // Static
    if (req.method === 'GET' || req.method === 'HEAD') {
      return serveStatic(req, res, pathname);
    }

    send(res, 404, { ok: false, error: 'Not Found' });
  } catch (e) {
    const status = e.status || 500;
    send(res, status, { ok: false, error: e.message || 'server error' });
  }
});

const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log('[tagtest-demo] http://' + HOST + ':' + PORT + '/');
  console.log('[tagtest-demo] data dir: ' + DATA);
});
