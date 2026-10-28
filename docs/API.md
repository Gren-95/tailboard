# API

All endpoints require authentication when `AUTH_USER`/`AUTH_PASS` are set.

| Method | Path                              | Description                          |
|--------|-----------------------------------|--------------------------------------|
| GET    | `/api/config`                     | Load full config                     |
| PUT    | `/api/config`                     | Update global settings               |
| GET    | `/api/config/export`              | Download config as JSON              |
| POST   | `/api/config/import`              | Restore config from JSON             |
| GET    | `/api/status`                     | Ping status and resolved active URL per link |
| GET    | `/api/weather`                    | Proxied OpenWeatherMap data          |
| GET    | `/api/rss?url=<url>`              | Proxied and parsed RSS/Atom feed     |
| GET    | `/api/ical?url=<url>`            | Proxied and parsed iCal feed         |
| GET    | `/api/icon/:slug`                 | Dashboard icon (cached SVG)          |
| GET    | `/api/favicon`                    | Current favicon (uploaded, or bundled default) |
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
| PUT    | `/api/widgetColumns`              | Update the grid column layout        |
| GET    | `/health`                         | Health check (always public)         |

## Link failover URLs

Each link may define up to 5 alternative URLs in addition to its primary `url`. The
server pings the primary and alternatives in order and reports, in `/api/status`, the
first reachable URL as `activeUrl` (or the primary when none respond). Clients open
`activeUrl`, so a link stays usable when its primary address is down.
