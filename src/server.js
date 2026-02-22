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
  pingInterval: 60,
  viewMode: 'grid',
  showClock: false,
  sharpCorners: false,
  customCss: '',
  weather: { apiKey: '', city: '', units: 'metric' },
  background: { type: 'none', value: '' },
  notes:      [],
  feeds:      [],
  iframes:    [],
  countdowns: [],
  calendars:  [],
  groups:     [],
  widgetOrder:   [],
  widgetColumns: [],   // 2-D: array of columns, each column is an array of widget IDs
  colSpan:       {},
};

function loadConfig() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      // Merge with DEFAULT_CONFIG so new fields are always present
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
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

// Weather proxy cache
let weatherCache     = null;
let weatherCacheTime = 0;
const WEATHER_TTL    = 10 * 60 * 1000; // 10 minutes

const rssCache = new Map(); // url → { items, time }
const RSS_TTL  = 15 * 60 * 1000;

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
      if (link.ping === false) {
        statusCache.delete(link.id); // clear any stale status
      } else {
        statusCache.set(link.id, await checkLink(link.pingUrl || link.url));
      }
    })
  );
}

// Self-rescheduling: reads pingInterval from config after each cycle so
// changes take effect on the next tick without a container restart.
async function schedulePingCycle() {
  await refreshAllStatuses();
  const cfg     = loadConfig();
  const seconds = cfg.pingInterval ?? 60;
  if (seconds > 0) setTimeout(schedulePingCycle, seconds * 1000);
}
setTimeout(schedulePingCycle, 2_000);

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
  const { title, basePalette, darkMode, pingInterval, viewMode, showClock, sharpCorners, customCss, weather, background, widgetOrder, colSpan } = req.body;
  if (title        !== undefined) cfg.title        = String(title).trim().slice(0, 100);
  if (basePalette  !== undefined) cfg.basePalette  = String(basePalette);
  if (darkMode     !== undefined) cfg.darkMode     = Boolean(darkMode);
  if (pingInterval !== undefined) cfg.pingInterval = Math.max(0, Number(pingInterval) || 0);
  if (viewMode     !== undefined) cfg.viewMode     = ['grid', 'list'].includes(viewMode) ? viewMode : 'grid';
  if (showClock    !== undefined) cfg.showClock    = Boolean(showClock);
  if (sharpCorners !== undefined) cfg.sharpCorners = Boolean(sharpCorners);
  if (customCss    !== undefined) cfg.customCss    = String(customCss).slice(0, 50000);
  if (weather !== undefined && weather !== null && typeof weather === 'object') {
    cfg.weather = {
      apiKey: String(weather.apiKey || '').trim().slice(0, 300),
      city:   String(weather.city   || '').trim().slice(0, 100),
      units:  ['metric', 'imperial'].includes(weather.units) ? weather.units : 'metric',
    };
    weatherCache = null; // invalidate on config change
  }
  if (background !== undefined && background !== null && typeof background === 'object') {
    cfg.background = {
      type:  ['none','gradient','image'].includes(background.type) ? background.type : 'none',
      value: String(background.value || '').trim().slice(0, 500),
    };
  }
  if (Array.isArray(widgetOrder)) cfg.widgetOrder = widgetOrder;
  if (colSpan && typeof colSpan === 'object' && !Array.isArray(colSpan)) cfg.colSpan = colSpan;
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
    title:        typeof body.title        === 'string'  ? body.title        : current.title,
    basePalette:  typeof body.basePalette  === 'string'  ? body.basePalette  : current.basePalette,
    darkMode:     typeof body.darkMode     === 'boolean' ? body.darkMode     : current.darkMode,
    pingInterval: typeof body.pingInterval === 'number'  ? body.pingInterval : current.pingInterval,
    viewMode:     typeof body.viewMode     === 'string'  ? body.viewMode     : current.viewMode,
    showClock:    typeof body.showClock    === 'boolean' ? body.showClock    : current.showClock,
    weather: (body.weather && typeof body.weather === 'object') ? {
      apiKey: String(body.weather.apiKey || '').trim().slice(0, 300),
      city:   String(body.weather.city   || '').trim().slice(0, 100),
      units:  ['metric', 'imperial'].includes(body.weather.units) ? body.weather.units : 'metric',
    } : current.weather,
    background: (body.background && typeof body.background === 'object') ? body.background : current.background,
    sharpCorners: typeof body.sharpCorners === 'boolean' ? body.sharpCorners : current.sharpCorners,
    customCss:   typeof body.customCss   === 'string'  ? body.customCss.slice(0, 50000) : current.customCss,
    notes:      Array.isArray(body.notes)      ? body.notes      : current.notes,
    feeds:      Array.isArray(body.feeds)      ? body.feeds      : current.feeds,
    iframes:    Array.isArray(body.iframes)    ? body.iframes    : current.iframes,
    countdowns: Array.isArray(body.countdowns) ? body.countdowns : current.countdowns,
    calendars:  Array.isArray(body.calendars)  ? body.calendars  : current.calendars,
    groups:       body.groups,
    widgetOrder:   Array.isArray(body.widgetOrder)   ? body.widgetOrder   : current.widgetOrder,
    widgetColumns: Array.isArray(body.widgetColumns) ? body.widgetColumns : current.widgetColumns,
    colSpan:     (body.colSpan && typeof body.colSpan === 'object' && !Array.isArray(body.colSpan)) ? body.colSpan : current.colSpan,
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

app.post('/api/favicon', express.raw({ type: 'image/*', limit: '2mb' }), (req, res) => {
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
  cfg.widgetOrder = [...(cfg.widgetOrder || []), group.id];
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
  cfg.widgetOrder = (cfg.widgetOrder || []).filter(id => id !== req.params.id);
  if (cfg.colSpan) delete cfg.colSpan[req.params.id];
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
    ping:    req.body.ping !== false,
    pingUrl: String(req.body.pingUrl || '').trim().slice(0, 2000),
    pinned:  Boolean(req.body.pinned),
    hotkey:   String(req.body.hotkey || '').trim().slice(0,1).toLowerCase().replace(/[^a-z0-9]/g,''),
    tags:     Array.isArray(req.body.tags) ? req.body.tags.map(t => String(t).trim().slice(0, 30)).filter(Boolean).slice(0, 10) : [],
    openMode: ['tab','self','modal'].includes(req.body.openMode) ? req.body.openMode : 'tab',
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
  if (name        !== undefined) link.name        = String(name).trim().slice(0, 80);
  if (url         !== undefined) link.url         = String(url).trim().slice(0, 2000);
  if (icon        !== undefined) link.icon        = String(icon).trim().slice(0, 80).replace(/[^a-z0-9-]/g, '');
  if (req.body.iconBg     !== undefined) link.iconBg     = String(req.body.iconBg).trim().slice(0, 30);
  if (description !== undefined) link.description = String(description).trim().slice(0, 200);
  if (req.body.ping       !== undefined) link.ping       = req.body.ping !== false;
  if (req.body.pingUrl    !== undefined) link.pingUrl    = String(req.body.pingUrl).trim().slice(0, 2000);
  if (req.body.pinned     !== undefined) link.pinned     = Boolean(req.body.pinned);
  if (req.body.hotkey     !== undefined) link.hotkey     = String(req.body.hotkey || '').trim().slice(0,1).toLowerCase().replace(/[^a-z0-9]/g,'');
  if (req.body.tags       !== undefined) link.tags       = Array.isArray(req.body.tags) ? req.body.tags.map(t => String(t).trim().slice(0, 30)).filter(Boolean).slice(0, 10) : [];
  if (req.body.openMode   !== undefined) link.openMode   = ['tab','self','modal'].includes(req.body.openMode) ? req.body.openMode : 'tab';
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

// ─── Weather proxy ────────────────────────────────────────────────────────────

app.get('/api/weather', async (req, res) => {
  const cfg = loadConfig();
  const { apiKey, city, units } = cfg.weather || {};
  if (!apiKey || !city) return res.status(204).send('');

  if (weatherCache && Date.now() - weatherCacheTime < WEATHER_TTL)
    return res.json(weatherCache);

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather`
              + `?q=${encodeURIComponent(city)}&appid=${apiKey}&units=${units || 'metric'}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error(`OpenWeather ${resp.status}`);
    const d = await resp.json();
    weatherCache = {
      temp:        Math.round(d.main.temp),
      feels:       Math.round(d.main.feels_like),
      humidity:    d.main.humidity,
      description: d.weather[0].description,
      icon:        d.weather[0].icon,
      city:        d.name,
      units:       units || 'metric',
    };
    weatherCacheTime = Date.now();
    res.json(weatherCache);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ─── RSS parser ───────────────────────────────────────────────────────────────

function parseRss(xml) {
  function cdata(s) { return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim(); }
  function tag(t, s)  { const m = s.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${t}>`)); return m ? cdata(m[1]) : ''; }
  function attr(t, a, s) { const m = s.match(new RegExp(`<${t}[^>]+${a}=["']([^"']+)["']`)); return m ? m[1] : ''; }
  const isAtom = /<feed[\s>]/.test(xml);
  const rx = isAtom ? /<entry>([\s\S]*?)<\/entry>/g : /<item>([\s\S]*?)<\/item>/g;
  const items = [];
  for (const [, chunk] of xml.matchAll(rx)) {
    const title = tag('title', chunk);
    const link  = isAtom ? (attr('link','href',chunk) || tag('link',chunk)) : (tag('link',chunk) || tag('guid',chunk));
    const date  = isAtom ? (tag('published',chunk) || tag('updated',chunk)) : tag('pubDate',chunk);
    if (title && link) items.push({ title, link: link.trim(), date });
  }
  return items;
}

// ─── PWA manifest ─────────────────────────────────────────────────────────────

const PALETTE_HEX = { stone:'#57534e', gray:'#4b5563', zinc:'#52525b', slate:'#475569',
  neutral:'#525252', red:'#dc2626', orange:'#f97316', amber:'#d97706', yellow:'#ca8a04',
  lime:'#65a30d', green:'#16a34a', emerald:'#059669', teal:'#0d9488', cyan:'#0891b2',
  sky:'#0284c7', blue:'#2563eb', indigo:'#4f46e5', violet:'#7c3aed', purple:'#9333ea',
  fuchsia:'#a21caf', pink:'#db2777', rose:'#e11d48' };

app.get('/manifest.json', (req, res) => {
  const cfg = loadConfig();
  res.json({
    name: cfg.title || 'Tailboard', short_name: cfg.title || 'Tailboard',
    start_url: '/', display: 'standalone',
    theme_color: PALETTE_HEX[cfg.basePalette] || '#57534e',
    background_color: cfg.darkMode ? '#0c0a09' : '#ffffff',
    icons: [{ src: '/api/favicon', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
  });
});

// ─── RSS proxy ────────────────────────────────────────────────────────────────

app.get('/api/rss', async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!url) return res.status(400).json({ error: 'url required' });
  const cached = rssCache.get(url);
  if (cached && Date.now() - cached.time < RSS_TTL) return res.json(cached);
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Tailboard/1.0' } });
    if (!resp.ok) throw new Error(`upstream ${resp.status}`);
    const items = parseRss(await resp.text()).slice(0, 10);
    const result = { items, time: Date.now() };
    rssCache.set(url, result);
    res.json(result);
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// ─── iCal proxy ───────────────────────────────────────────────────────────────

const icalCache = new Map(); // url → { events, time }
const ICAL_TTL  = 15 * 60 * 1000;

function parseIcal(text) {
  const events = [];
  const blocks = text.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  for (const block of blocks) {
    const prop = name => {
      const m = block.match(new RegExp(`${name}(?:;[^:\\r\\n]*)?:([^\\r\\n]+)`));
      return m ? m[1].trim() : '';
    };
    const unescape = s => s.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
    const parseDate = s => {
      const d = s.replace(/[TZ]/g, '');
      return new Date(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${d.slice(8,10)||'00'}:${d.slice(10,12)||'00'}:00`);
    };
    const summary = unescape(prop('SUMMARY'));
    const dtstart = prop('DTSTART');
    if (!summary || !dtstart) continue;
    events.push({
      summary,
      date:        parseDate(dtstart).toISOString(),
      description: unescape(prop('DESCRIPTION')).slice(0, 200),
      location:    unescape(prop('LOCATION')).slice(0, 100),
    });
  }
  return events.sort((a, b) => new Date(a.date) - new Date(b.date));
}

app.get('/api/ical', async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!url) return res.status(400).json({ error: 'url required' });
  const cached = icalCache.get(url);
  if (cached && Date.now() - cached.time < ICAL_TTL) return res.json(cached);
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Tailboard/1.0' } });
    if (!resp.ok) throw new Error(`upstream ${resp.status}`);
    const events = parseIcal(await resp.text());
    const result = { events, time: Date.now() };
    icalCache.set(url, result);
    res.json(result);
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// ─── Countdowns CRUD ──────────────────────────────────────────────────────────

app.post('/api/countdowns', (req, res) => {
  const cfg = loadConfig();
  if (!req.body.targetDate) return res.status(400).json({ error: 'targetDate required' });
  const cd = {
    id:          randomUUID(),
    title:       String(req.body.title       || 'Countdown').trim().slice(0, 80),
    targetDate:  String(req.body.targetDate  || '').trim().slice(0, 30),
    description: String(req.body.description || '').trim().slice(0, 200),
  };
  cfg.countdowns = cfg.countdowns || [];
  cfg.countdowns.push(cd);
  cfg.widgetOrder = [...(cfg.widgetOrder || []), cd.id];
  saveConfig(cfg);
  res.status(201).json(cd);
});

app.put('/api/countdowns/:id', (req, res) => {
  const cfg = loadConfig();
  cfg.countdowns = cfg.countdowns || [];
  const cd = cfg.countdowns.find(c => c.id === req.params.id);
  if (!cd) return res.status(404).json({ error: 'countdown not found' });
  if (req.body.title       !== undefined) cd.title       = String(req.body.title).trim().slice(0, 80);
  if (req.body.targetDate  !== undefined) cd.targetDate  = String(req.body.targetDate).trim().slice(0, 30);
  if (req.body.description !== undefined) cd.description = String(req.body.description).trim().slice(0, 200);
  saveConfig(cfg);
  res.json(cd);
});

app.delete('/api/countdowns/:id', (req, res) => {
  const cfg = loadConfig();
  cfg.countdowns = cfg.countdowns || [];
  const idx = cfg.countdowns.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'countdown not found' });
  cfg.countdowns.splice(idx, 1);
  cfg.widgetOrder = (cfg.widgetOrder || []).filter(id => id !== req.params.id);
  if (cfg.colSpan) delete cfg.colSpan[req.params.id];
  saveConfig(cfg);
  res.json({ ok: true });
});

// ─── Calendars CRUD ───────────────────────────────────────────────────────────

app.post('/api/calendars', (req, res) => {
  const cfg = loadConfig();
  if (!req.body.url) return res.status(400).json({ error: 'url required' });
  const cal = {
    id:       randomUUID(),
    title:    String(req.body.title || 'Calendar').trim().slice(0, 80),
    url:      String(req.body.url   || '').trim().slice(0, 2000),
    maxItems: Math.min(20, Math.max(1, Number(req.body.maxItems) || 10)),
  };
  cfg.calendars = cfg.calendars || [];
  cfg.calendars.push(cal);
  cfg.widgetOrder = [...(cfg.widgetOrder || []), cal.id];
  saveConfig(cfg);
  res.status(201).json(cal);
});

app.put('/api/calendars/:id', (req, res) => {
  const cfg = loadConfig();
  cfg.calendars = cfg.calendars || [];
  const cal = cfg.calendars.find(c => c.id === req.params.id);
  if (!cal) return res.status(404).json({ error: 'calendar not found' });
  if (req.body.title    !== undefined) cal.title    = String(req.body.title).trim().slice(0, 80);
  if (req.body.url      !== undefined) { icalCache.delete(cal.url); cal.url = String(req.body.url).trim().slice(0, 2000); }
  if (req.body.maxItems !== undefined) cal.maxItems = Math.min(20, Math.max(1, Number(req.body.maxItems) || 10));
  saveConfig(cfg);
  res.json(cal);
});

app.delete('/api/calendars/:id', (req, res) => {
  const cfg = loadConfig();
  cfg.calendars = cfg.calendars || [];
  const idx = cfg.calendars.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'calendar not found' });
  icalCache.delete(cfg.calendars[idx].url);
  cfg.calendars.splice(idx, 1);
  cfg.widgetOrder = (cfg.widgetOrder || []).filter(id => id !== req.params.id);
  if (cfg.colSpan) delete cfg.colSpan[req.params.id];
  saveConfig(cfg);
  res.json({ ok: true });
});

// ─── Notes CRUD ───────────────────────────────────────────────────────────────

app.post('/api/notes', (req, res) => {
  const cfg = loadConfig();
  const note = {
    id: randomUUID(),
    title: String(req.body.title || 'Notes').trim().slice(0, 80),
    content: String(req.body.content || '').trim().slice(0, 10000),
  };
  cfg.notes = cfg.notes || [];
  cfg.notes.push(note);
  cfg.widgetOrder = [...(cfg.widgetOrder || []), note.id];
  saveConfig(cfg);
  res.status(201).json(note);
});

app.put('/api/notes/:id', (req, res) => {
  const cfg = loadConfig();
  cfg.notes = cfg.notes || [];
  const note = cfg.notes.find(n => n.id === req.params.id);
  if (!note) return res.status(404).json({ error: 'note not found' });
  if (req.body.title   !== undefined) note.title   = String(req.body.title).trim().slice(0, 80);
  if (req.body.content !== undefined) note.content = String(req.body.content).trim().slice(0, 10000);
  saveConfig(cfg);
  res.json(note);
});

app.delete('/api/notes/:id', (req, res) => {
  const cfg = loadConfig();
  cfg.notes = cfg.notes || [];
  const idx = cfg.notes.findIndex(n => n.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'note not found' });
  cfg.notes.splice(idx, 1);
  cfg.widgetOrder = (cfg.widgetOrder || []).filter(id => id !== req.params.id);
  if (cfg.colSpan) delete cfg.colSpan[req.params.id];
  saveConfig(cfg);
  res.json({ ok: true });
});

// ─── Feeds CRUD ───────────────────────────────────────────────────────────────

app.post('/api/feeds', (req, res) => {
  const cfg = loadConfig();
  const feed = {
    id: randomUUID(),
    title: String(req.body.title || 'Feed').trim().slice(0, 80),
    url: String(req.body.url || '').trim().slice(0, 2000),
    maxItems: Math.min(20, Math.max(1, Number(req.body.maxItems) || 5)),
  };
  if (!feed.url) return res.status(400).json({ error: 'url required' });
  cfg.feeds = cfg.feeds || [];
  cfg.feeds.push(feed);
  cfg.widgetOrder = [...(cfg.widgetOrder || []), feed.id];
  saveConfig(cfg);
  res.status(201).json(feed);
});

app.put('/api/feeds/:id', (req, res) => {
  const cfg = loadConfig();
  cfg.feeds = cfg.feeds || [];
  const feed = cfg.feeds.find(f => f.id === req.params.id);
  if (!feed) return res.status(404).json({ error: 'feed not found' });
  if (req.body.title    !== undefined) feed.title    = String(req.body.title).trim().slice(0, 80);
  if (req.body.url      !== undefined) {
    rssCache.delete(feed.url);
    feed.url = String(req.body.url).trim().slice(0, 2000);
  }
  if (req.body.maxItems !== undefined) feed.maxItems = Math.min(20, Math.max(1, Number(req.body.maxItems) || 5));
  saveConfig(cfg);
  res.json(feed);
});

app.delete('/api/feeds/:id', (req, res) => {
  const cfg = loadConfig();
  cfg.feeds = cfg.feeds || [];
  const idx = cfg.feeds.findIndex(f => f.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'feed not found' });
  rssCache.delete(cfg.feeds[idx].url);
  cfg.feeds.splice(idx, 1);
  cfg.widgetOrder = (cfg.widgetOrder || []).filter(id => id !== req.params.id);
  if (cfg.colSpan) delete cfg.colSpan[req.params.id];
  saveConfig(cfg);
  res.json({ ok: true });
});

// ─── iFrames CRUD ─────────────────────────────────────────────────────────────

app.post('/api/iframes', (req, res) => {
  const cfg = loadConfig();
  const iframe = {
    id: randomUUID(),
    title: String(req.body.title || 'Embed').trim().slice(0, 80),
    url: String(req.body.url || '').trim().slice(0, 2000),
    height: Math.min(2000, Math.max(100, Number(req.body.height) || 300)),
  };
  if (!iframe.url) return res.status(400).json({ error: 'url required' });
  cfg.iframes = cfg.iframes || [];
  cfg.iframes.push(iframe);
  cfg.widgetOrder = [...(cfg.widgetOrder || []), iframe.id];
  saveConfig(cfg);
  res.status(201).json(iframe);
});

app.put('/api/iframes/:id', (req, res) => {
  const cfg = loadConfig();
  cfg.iframes = cfg.iframes || [];
  const iframe = cfg.iframes.find(i => i.id === req.params.id);
  if (!iframe) return res.status(404).json({ error: 'iframe not found' });
  if (req.body.title  !== undefined) iframe.title  = String(req.body.title).trim().slice(0, 80);
  if (req.body.url    !== undefined) iframe.url    = String(req.body.url).trim().slice(0, 2000);
  if (req.body.height !== undefined) iframe.height = Math.min(2000, Math.max(100, Number(req.body.height) || 300));
  saveConfig(cfg);
  res.json(iframe);
});

app.delete('/api/iframes/:id', (req, res) => {
  const cfg = loadConfig();
  cfg.iframes = cfg.iframes || [];
  const idx = cfg.iframes.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'iframe not found' });
  cfg.iframes.splice(idx, 1);
  cfg.widgetOrder = (cfg.widgetOrder || []).filter(id => id !== req.params.id);
  if (cfg.colSpan) delete cfg.colSpan[req.params.id];
  saveConfig(cfg);
  res.json({ ok: true });
});

// ─── Widget order ─────────────────────────────────────────────────────────────

app.put('/api/widgetOrder', (req, res) => {
  const cfg = loadConfig();
  const { order, colSpan } = req.body;
  if (Array.isArray(order)) cfg.widgetOrder = order;
  if (colSpan && typeof colSpan === 'object' && !Array.isArray(colSpan)) {
    cfg.colSpan = { ...(cfg.colSpan || {}), ...colSpan };
  }
  saveConfig(cfg);
  res.json({ ok: true });
});

app.put('/api/widgetColumns', (req, res) => {
  const cfg = loadConfig();
  const { columns } = req.body;
  if (!Array.isArray(columns)) return res.status(400).json({ error: 'columns must be an array' });
  cfg.widgetColumns = columns;
  saveConfig(cfg);
  res.json({ ok: true });
});

// ─── SPA fallback ─────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`tailboard running on http://0.0.0.0:${PORT}`);
});
