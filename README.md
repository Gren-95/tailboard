# Tailboard

A self-hosted homelab dashboard. Organize links into groups, monitor service uptime, and embed widgets — all from a single Docker container.

## Features

- **Link groups** — organize services into collapsible, color-accented groups with drag-to-reorder
- **Service ping** — periodic HEAD-request uptime checks with green/red indicators; tolerates self-signed TLS certs
- **Pinned bar** — pin frequently-used links to a persistent top bar
- **Hotkeys** — assign a single-character hotkey to any link; press it on the dashboard to open the link instantly
- **Link tags** — tag links with comma-separated labels; a filter bar appears automatically to show only matching groups
- **Keyboard navigation** — Tab through link rows, Enter to open; `Ctrl+K` / `/` for search; `Esc` to close
- **Zoom** — `Ctrl+`/`Ctrl-`/`Ctrl+0` or the hamburger menu controls to scale the entire dashboard
- **Widgets** — notes (Markdown), RSS feeds, iframes, countdown timers, and iCal calendars alongside link groups; all draggable
- **Countdown widget** — live days/hours/minutes/seconds timer to any target date
- **Calendar widget** — fetches any iCal/ICS URL and shows upcoming events (15-minute server-side cache)
- **Clock & weather** — optional clock with OpenWeatherMap integration
- **Themes** — 22 Tailwind color palettes, dark/light mode, gradient or image backgrounds
- **Sharp corners** — toggle to remove all border-radius for a flat UI aesthetic
- **Custom CSS** — inject arbitrary CSS from the settings panel
- **Dashboard icons** — auto-fetched from [homarr-labs/dashboard-icons](https://github.com/homarr-labs/dashboard-icons) and cached locally
- **Sort links** — sort any group alphabetically A–Z in one click (edit mode)
- **PWA** — installable as a progressive web app
- **Config export/import** — full JSON backup and restore
- **Optional auth** — session-cookie login (7-day sessions) enabled by setting `AUTH_USER`/`AUTH_PASS`

## Quick Start

```bash
docker compose up -d
```

Open `http://localhost:3000`.

## Docker Compose

```yaml
services:
  tailboard:
    build: .
    container_name: tailboard
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - tailboard-data:/data
    environment:
      - NODE_ENV=production
      - AUTH_USER=admin      # optional — omit to disable auth
      - AUTH_PASS=changeme

volumes:
  tailboard-data:
```

## Environment Variables

| Variable       | Default              | Description                                      |
|----------------|----------------------|--------------------------------------------------|
| `PORT`         | `3000`               | HTTP port to listen on                           |
| `DATA_FILE`    | `/data/config.json`  | Path to the persisted config file                |
| `ICONS_DIR`    | `/data/icons`        | Directory for cached dashboard icons             |
| `AUTH_USER`    | _(unset)_            | Login username — auth disabled when blank        |
| `AUTH_PASS`    | _(unset)_            | Login password — auth disabled when blank        |

## Keyboard Shortcuts

| Key                  | Action                          |
|----------------------|---------------------------------|
| `Ctrl+K` / `⌘K` / `/` | Open search                   |
| `Esc`                | Close modal / search / menu     |
| `Ctrl+=` / `⌘=`      | Zoom in                         |
| `Ctrl+-` / `⌘-`      | Zoom out                        |
| `Ctrl+0` / `⌘0`      | Reset zoom                      |
| `Enter`              | Open focused link               |
| Any hotkey letter    | Open assigned link              |

## Data Persistence

Everything is stored in the `/data` volume:

| Path                 | Contents                        |
|----------------------|---------------------------------|
| `/data/config.json`  | Full dashboard configuration    |
| `/data/icons/`       | Cached SVG icons                |
| `/data/favicon`      | Custom favicon (binary)         |
| `/data/favicon.mime` | MIME type of the custom favicon |

## API

All endpoints require authentication when `AUTH_USER`/`AUTH_PASS` are set.

| Method | Path                              | Description                          |
|--------|-----------------------------------|--------------------------------------|
| GET    | `/api/config`                     | Load full config                     |
| PUT    | `/api/config`                     | Update global settings               |
| GET    | `/api/config/export`              | Download config as JSON              |
| POST   | `/api/config/import`              | Restore config from JSON             |
| GET    | `/api/status`                     | Current ping status for all links    |
| GET    | `/api/weather`                    | Proxied OpenWeatherMap data          |
| GET    | `/api/rss?url=<url>`              | Proxied & parsed RSS/Atom feed       |
| GET    | `/api/ical?url=<url>`             | Proxied & parsed iCal feed           |
| GET    | `/api/icon/:slug`                 | Dashboard icon (cached SVG)          |
| POST   | `/api/favicon`                    | Upload custom favicon                |
| DELETE | `/api/favicon`                    | Remove custom favicon                |
| POST   | `/api/groups`                     | Create a link group                  |
| PUT    | `/api/groups/:id`                 | Update a link group                  |
| DELETE | `/api/groups/:id`                 | Delete a link group                  |
| PUT    | `/api/groups/reorder`             | Reorder groups                       |
| POST   | `/api/groups/:id/links`           | Add a link to a group                |
| PUT    | `/api/groups/:gid/links/:lid`     | Update a link                        |
| DELETE | `/api/groups/:gid/links/:lid`     | Delete a link                        |
| PUT    | `/api/groups/:gid/links/reorder`  | Reorder links within a group         |
| POST   | `/api/links/move`                 | Move a link between groups           |
| POST   | `/api/notes`                      | Create a notes widget                |
| PUT    | `/api/notes/:id`                  | Update a notes widget                |
| DELETE | `/api/notes/:id`                  | Delete a notes widget                |
| POST   | `/api/feeds`                      | Create an RSS feed widget            |
| PUT    | `/api/feeds/:id`                  | Update an RSS feed widget            |
| DELETE | `/api/feeds/:id`                  | Delete an RSS feed widget            |
| POST   | `/api/iframes`                    | Create an iframe widget              |
| PUT    | `/api/iframes/:id`                | Update an iframe widget              |
| DELETE | `/api/iframes/:id`                | Delete an iframe widget              |
| POST   | `/api/countdowns`                 | Create a countdown widget            |
| PUT    | `/api/countdowns/:id`             | Update a countdown widget            |
| DELETE | `/api/countdowns/:id`             | Delete a countdown widget            |
| POST   | `/api/calendars`                  | Create a calendar widget             |
| PUT    | `/api/calendars/:id`              | Update a calendar widget             |
| DELETE | `/api/calendars/:id`              | Delete a calendar widget             |
| PUT    | `/api/widgetOrder`                | Update widget order                  |
| GET    | `/health`                         | Health check (always public)         |

## Development

```bash
npm install
npm run build:css   # compile Tailwind CSS
npm start           # start the server on port 3000
```

Node.js 18+ is required (uses native `fetch` and `node:http`/`node:https`).
