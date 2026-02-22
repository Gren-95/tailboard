'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || '/data/config.json';
const DATA_TEMP = DATA_FILE + '.tmp';
const ICONS_DIR = process.env.ICONS_DIR || '/data/icons';

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

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ ok: true }));

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

// ─── Groups ───────────────────────────────────────────────────────────────────

app.post('/api/groups', (req, res) => {
  const cfg = loadConfig();
  const { name, accent } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const group = {
    id: randomUUID(),
    name: String(name).trim().slice(0, 80),
    accent: String(accent || 'slate'),
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
  const { name, accent, collapsed } = req.body;
  if (name !== undefined) group.name = String(name).trim().slice(0, 80);
  if (accent !== undefined) group.accent = String(accent);
  if (collapsed !== undefined) group.collapsed = Boolean(collapsed);
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
