'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const { randomUUID, timingSafeEqual, randomBytes } = require('crypto');
const http  = require('node:http');
const https = require('node:https');

const app = express();
const PORT       = process.env.PORT       || 3000;
const DATA_FILE  = process.env.DATA_FILE  || '/data/config.json';
const DATA_TEMP  = DATA_FILE + '.tmp';
const ICONS_DIR  = process.env.ICONS_DIR  || '/data/icons';
const FAVICON_FILE = '/data/favicon';
const FAVICON_MIME = '/data/favicon.mime';

// ─── Auth (optional, session-cookie based) ────────────────────────────────────

const AUTH_USER = (process.env.AUTH_USER || '').trim();
const AUTH_PASS = (process.env.AUTH_PASS || '').trim();

function safeEq(a, b) {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const SESSION_COOKIE  = 'tbsession';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // seconds — 7 days

/** token → expiry epoch ms */
const sessions = new Map();

// Prune expired sessions hourly
setInterval(() => {
  const now = Date.now();
  for (const [tok, exp] of sessions) { if (exp < now) sessions.delete(tok); }
}, 3_600_000);

function getCookie(req, name) {
  for (const chunk of (req.headers.cookie || '').split(';')) {
    const eq = chunk.indexOf('=');
    if (eq === -1) continue;
    if (chunk.slice(0, eq).trim() === name) return chunk.slice(eq + 1).trim();
  }
  return null;
}

function isAuthenticated(req) {
  if (!AUTH_USER || !AUTH_PASS) return true;
  const tok = getCookie(req, SESSION_COOKIE);
  const exp = tok && sessions.get(tok);
  return !!(exp && exp > Date.now());
}

function loginHtml(errorMsg) {
  const errBlock = errorMsg
    ? `<div style="background:#450a0a;border:1px solid #7f1d1d;color:#fca5a5;border-radius:.5rem;padding:.625rem .75rem;font-size:.875rem;margin-bottom:1rem">${errorMsg}</div>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Sign in — Tailboard</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0c0a09;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}
    .card{background:#1c1917;border:1px solid #292524;border-radius:1rem;padding:2rem;width:100%;max-width:360px;box-shadow:0 25px 50px -12px rgba(0,0,0,.6)}
    h1{color:#f5f5f4;font-size:1.25rem;font-weight:700;text-align:center;margin-bottom:.25rem}
    .sub{color:#78716c;font-size:.875rem;text-align:center;margin-bottom:1.75rem}
    label{display:block;font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#a8a29e;margin-bottom:.4rem}
    input{display:block;width:100%;padding:.625rem .75rem;background:#292524;border:1px solid #44403c;border-radius:.5rem;color:#f5f5f4;font-size:.9rem;outline:none;transition:border-color .15s;margin-bottom:1.1rem}
    input:focus{border-color:#6366f1;box-shadow:0 0 0 2px rgba(99,102,241,.2)}
    button{width:100%;padding:.7rem;background:#6366f1;color:#fff;font-size:.9rem;font-weight:600;border:none;border-radius:.5rem;cursor:pointer;transition:background .15s;letter-spacing:.01em}
    button:hover{background:#4f46e5}
    button:active{background:#4338ca}
  </style>
</head>
<body>
  <div class="card">
    <h1>Tailboard</h1>
    <p class="sub">Sign in to continue</p>
    ${errBlock}
    <form method="POST" action="/login" autocomplete="on">
      <label for="u">Username</label>
      <input id="u" name="username" type="text" autocomplete="username" autofocus required>
      <label for="p">Password</label>
      <input id="p" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Sign in</button>
    </form>
  </div>
</body>
</html>`;
}

// Login / logout routes registered BEFORE auth middleware so they're always reachable
app.get('/login', (req, res) => {
  if (!AUTH_USER || !AUTH_PASS) return res.redirect('/');
  if (isAuthenticated(req)) return res.redirect('/');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(loginHtml(''));
});

app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  const u = String(req.body.username || '');
  const p = String(req.body.password || '');
  if (safeEq(u, AUTH_USER) && safeEq(p, AUTH_PASS)) {
    const token = randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_MAX_AGE * 1000);
    res.setHeader('Set-Cookie',
      `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE}`);
    return res.redirect('/');
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(loginHtml('Invalid username or password.'));
});

app.get('/logout', (req, res) => {
  if (!AUTH_USER || !AUTH_PASS) return res.redirect('/');
  const tok = getCookie(req, SESSION_COOKIE);
  if (tok) sessions.delete(tok);
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  res.redirect('/login');
});

// ─── Auth middleware ───────────────────────────────────────────────────────────

if (AUTH_USER && AUTH_PASS) {
  app.use((req, res, next) => {
    if (req.path === '/health') return next();
    if (isAuthenticated(req)) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
    res.redirect('/login');
  });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Config helpers ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  version: 1,
  title: 'My Dashboard',
  basePalette: 'stone',
  darkMode: true,
  groups: [],
};

function loadConfig() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch {
    // fall through to default
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_TEMP, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(DATA_TEMP, DATA_FILE);
}

function findGroup(cfg, groupId) {
  return cfg.groups.find(g => g.id === groupId);
}

// ─── Service status ───────────────────────────────────────────────────────────

/** linkId → 'up' | 'down' (in-memory only, resets on restart) */
const statusCache = new Map();

/**
 * Ping a URL via HEAD using node:http/https directly so we can set
 * rejectUnauthorized:false — self-signed certs are common in homelabs.
 * Never rejects; resolves to 'up' or 'down'.
 */
function checkLink(url) {
  return new Promise(resolve => {
    let settled = false;
    const done = result => { if (!settled) { settled = true; resolve(result); } };

    let parsed;
    try { parsed = new URL(url); } catch { return done('down'); }

    const isHttps = parsed.protocol === 'https:';
    const mod     = isHttps ? https : http;
    const port    = parsed.port ? Number(parsed.port) : (isHttps ? 443 : 80);

    const req = mod.request({
      method:             'HEAD',
      hostname:           parsed.hostname,
      port,
      path:               parsed.pathname + parsed.search,
      timeout:            5000,
      rejectUnauthorized: false,
    }, res => {
      res.resume(); // drain socket
      done(res.statusCode < 500 ? 'up' : 'down');
    });

    req.on('timeout', () => { req.destroy(); done('down'); });
    req.on('error',   () => done('down'));
    req.end();
  });
}

async function refreshAllStatuses() {
  const cfg   = loadConfig();
  const links = cfg.groups.flatMap(g => g.links);
  await Promise.all(
    links.map(async link => {
      statusCache.set(link.id, await checkLink(link.url));
    })
  );
}

// Check 2 s after startup (give server time to settle), then every 60 s
setTimeout(() => {
  refreshAllStatuses();
  setInterval(refreshAllStatuses, 60_000);
}, 2_000);

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/api/status', (req, res) => {
  res.json(Object.fromEntries(statusCache));
});

app.get('/api/auth', (req, res) => {
  res.json({ enabled: !!(AUTH_USER && AUTH_PASS) });
});

// ─── Config ───────────────────────────────────────────────────────────────────

app.get('/api/config', (req, res) => {
  res.json(loadConfig());
});

app.put('/api/config', (req, res) => {
  const cfg = loadConfig();
  const { title, basePalette, darkMode } = req.body;
  if (title !== undefined) cfg.title = String(title).trim().slice(0, 100);
  if (basePalette !== undefined) cfg.basePalette = String(basePalette);
  if (darkMode !== undefined) cfg.darkMode = Boolean(darkMode);
  saveConfig(cfg);
  res.json(cfg);
});

app.get('/api/config/export', (req, res) => {
  const cfg = loadConfig();
  res.setHeader('Content-Disposition', 'attachment; filename="tailboard-config.json"');
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(cfg, null, 2));
});

app.post('/api/config/import', (req, res) => {
  const body = req.body;
  if (!body || !Array.isArray(body.groups)) {
    return res.status(400).json({ error: 'invalid config: groups array required' });
  }
  const current = loadConfig();
  const merged = {
    ...current,
    title:       typeof body.title       === 'string'  ? body.title       : current.title,
    basePalette: typeof body.basePalette === 'string'  ? body.basePalette : current.basePalette,
    darkMode:    typeof body.darkMode    === 'boolean' ? body.darkMode    : current.darkMode,
    groups:      body.groups,
  };
  saveConfig(merged);
  res.json({ ok: true });
});

// ─── Icon proxy + cache ───────────────────────────────────────────────────────

app.get('/api/icon/:slug', async (req, res) => {
  const slug = req.params.slug.replace(/[^a-z0-9-]/g, '');
  if (!slug) return res.status(400).send('');

  const cached = path.join(ICONS_DIR, `${slug}.svg`);

  if (fs.existsSync(cached)) {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(cached);
  }

  try {
    const upstream = `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/${slug}.svg`;
    const resp = await fetch(upstream, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error(`upstream ${resp.status}`);
    const svg = await resp.text();
    if (!svg.includes('<svg')) throw new Error('not an svg');
    fs.mkdirSync(ICONS_DIR, { recursive: true });
    fs.writeFileSync(cached, svg, 'utf8');
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(svg);
  } catch {
    res.status(404).send('');
  }
});

// ─── Favicon ──────────────────────────────────────────────────────────────────

app.get(['/favicon.ico', '/api/favicon'], (req, res) => {
  if (!fs.existsSync(FAVICON_FILE)) return res.status(404).send('');
  let mime = 'image/x-icon';
  try { mime = fs.readFileSync(FAVICON_MIME, 'utf8').trim(); } catch {}
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(FAVICON_FILE);
});

app.post('/api/favicon', express.raw({ type: /^image\//, limit: '2mb' }), (req, res) => {
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'no image data' });
  const mime = (req.headers['content-type'] || 'image/x-icon').split(';')[0].trim();
  fs.mkdirSync(path.dirname(FAVICON_FILE), { recursive: true });
  fs.writeFileSync(FAVICON_FILE, req.body);
  fs.writeFileSync(FAVICON_MIME, mime, 'utf8');
  res.json({ ok: true });
});

app.delete('/api/favicon', (req, res) => {
  try { fs.unlinkSync(FAVICON_FILE); } catch {}
  try { fs.unlinkSync(FAVICON_MIME); } catch {}
  res.json({ ok: true });
});

// ─── Groups ───────────────────────────────────────────────────────────────────

app.post('/api/groups', (req, res) => {
  const cfg = loadConfig();
  const { name, accent, icon } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const group = {
    id: randomUUID(),
    name: String(name).trim().slice(0, 80),
    accent: String(accent || 'slate'),
    icon: String(icon || '').trim().slice(0, 80).replace(/[^a-z0-9-]/g, ''),
    collapsed: false,
    links: [],
  };
  cfg.groups.push(group);
  saveConfig(cfg);
  res.status(201).json(group);
});

// NOTE: /reorder must be registered before /:id to avoid Express matching "reorder" as an id param
app.put('/api/groups/reorder', (req, res) => {
  const cfg = loadConfig();
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be array' });
  const map = new Map(cfg.groups.map(g => [g.id, g]));
  cfg.groups = order.filter(id => map.has(id)).map(id => map.get(id));
  saveConfig(cfg);
  res.json(cfg.groups);
});

app.put('/api/groups/:id', (req, res) => {
  const cfg = loadConfig();
  const group = findGroup(cfg, req.params.id);
  if (!group) return res.status(404).json({ error: 'group not found' });
  const { name, accent, collapsed, icon } = req.body;
  if (name !== undefined)      group.name      = String(name).trim().slice(0, 80);
  if (accent !== undefined)    group.accent    = String(accent);
  if (collapsed !== undefined) group.collapsed = Boolean(collapsed);
  if (icon !== undefined)      group.icon      = String(icon).trim().slice(0, 80).replace(/[^a-z0-9-]/g, '');
  saveConfig(cfg);
  res.json(group);
});

app.delete('/api/groups/:id', (req, res) => {
  const cfg = loadConfig();
  const idx = cfg.groups.findIndex(g => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'group not found' });
  cfg.groups.splice(idx, 1);
  saveConfig(cfg);
  res.json({ ok: true });
});

// ─── Links ────────────────────────────────────────────────────────────────────

app.post('/api/groups/:id/links', (req, res) => {
  const cfg = loadConfig();
  const group = findGroup(cfg, req.params.id);
  if (!group) return res.status(404).json({ error: 'group not found' });
  const { name, url, icon, description } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  if (!url) return res.status(400).json({ error: 'url required' });
  const link = {
    id: randomUUID(),
    name: String(name).trim().slice(0, 80),
    url: String(url).trim().slice(0, 2000),
    icon: String(icon || '').trim().slice(0, 80).replace(/[^a-z0-9-]/g, ''),
    iconBg: String(req.body.iconBg || 'none').trim().slice(0, 30),
    description: String(description || '').trim().slice(0, 200),
  };
  group.links.push(link);
  saveConfig(cfg);
  res.status(201).json(link);
});

// NOTE: /reorder must be registered before /:linkId
app.put('/api/groups/:gid/links/reorder', (req, res) => {
  const cfg = loadConfig();
  const group = findGroup(cfg, req.params.gid);
  if (!group) return res.status(404).json({ error: 'group not found' });
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be array' });
  const map = new Map(group.links.map(l => [l.id, l]));
  group.links = order.filter(id => map.has(id)).map(id => map.get(id));
  saveConfig(cfg);
  res.json(group.links);
});

app.put('/api/groups/:gid/links/:lid', (req, res) => {
  const cfg = loadConfig();
  const group = findGroup(cfg, req.params.gid);
  if (!group) return res.status(404).json({ error: 'group not found' });
  const link = group.links.find(l => l.id === req.params.lid);
  if (!link) return res.status(404).json({ error: 'link not found' });
  const { name, url, icon, description } = req.body;
  if (name !== undefined) link.name = String(name).trim().slice(0, 80);
  if (url !== undefined) link.url = String(url).trim().slice(0, 2000);
  if (icon !== undefined) link.icon = String(icon).trim().slice(0, 80).replace(/[^a-z0-9-]/g, '');
  if (req.body.iconBg !== undefined) link.iconBg = String(req.body.iconBg).trim().slice(0, 30);
  if (description !== undefined) link.description = String(description).trim().slice(0, 200);
  saveConfig(cfg);
  res.json(link);
});

app.delete('/api/groups/:gid/links/:lid', (req, res) => {
  const cfg = loadConfig();
  const group = findGroup(cfg, req.params.gid);
  if (!group) return res.status(404).json({ error: 'group not found' });
  const idx = group.links.findIndex(l => l.id === req.params.lid);
  if (idx === -1) return res.status(404).json({ error: 'link not found' });
  group.links.splice(idx, 1);
  saveConfig(cfg);
  res.json({ ok: true });
});

// ─── Move link between groups ─────────────────────────────────────────────────

// POST /api/links/move
// Body: { linkId, sourceGroupId, targetGroupId, targetLinkId?, position? }
// position: 'before' | 'after' (relative to targetLinkId); omit to append
app.post('/api/links/move', (req, res) => {
  const cfg = loadConfig();
  const { linkId, sourceGroupId, targetGroupId, targetLinkId, position } = req.body;
  if (!linkId || !sourceGroupId || !targetGroupId) {
    return res.status(400).json({ error: 'linkId, sourceGroupId, targetGroupId required' });
  }
  const src = findGroup(cfg, sourceGroupId);
  const tgt = findGroup(cfg, targetGroupId);
  if (!src || !tgt) return res.status(404).json({ error: 'group not found' });

  const linkIdx = src.links.findIndex(l => l.id === linkId);
  if (linkIdx === -1) return res.status(404).json({ error: 'link not found' });

  const [link] = src.links.splice(linkIdx, 1);

  if (targetLinkId) {
    const tgtIdx = tgt.links.findIndex(l => l.id === targetLinkId);
    if (tgtIdx !== -1) {
      tgt.links.splice(position === 'before' ? tgtIdx : tgtIdx + 1, 0, link);
    } else {
      tgt.links.push(link);
    }
  } else {
    tgt.links.push(link);
  }

  saveConfig(cfg);
  res.json(link);
});

// ─── SPA fallback ─────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`tailboard running on http://0.0.0.0:${PORT}`);
});
