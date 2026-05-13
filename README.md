# ashercarlow-monorepo

Bun-powered monorepo serving the ashercarlow.com properties:

- **Backend** (`apps/backend/`) — Bun + Hono + bun:sqlite, single process, host-based dispatcher, OpenAPI/Swagger at `api.ashercarlow.com/docs`.
- **Resume** (`apps/resume/`) — Vue 3 + Vite. Static SPA. Served on `ashercarlow.com` and `www.ashercarlow.com`.
- **Wedding** (`apps/wedding/`) — Vue 3 + Vite + Vue Router. Static SPA. Served on `paulina.ashercarlow.com`.
- **Starwars** (`apps/starwars/`) — SolidJS + Vite. Two routes: `/` landing and `/tcw` Clone Wars episode tracker. Served on `starwars.ashercarlow.com`.

## Subdomain routing

The backend looks at the incoming `Host` header and dispatches:

| Host                              | Handler                                     |
|-----------------------------------|---------------------------------------------|
| `ashercarlow.com`, `www.*`        | `apps/resume/dist` (SPA fallback)           |
| `paulina.ashercarlow.com`         | `apps/wedding/dist` (SPA fallback)          |
| `starwars.ashercarlow.com`        | `apps/starwars/dist` (SPA fallback)         |
| `api.ashercarlow.com`             | JSON API (music + swtcw), `/docs`, `/openapi.json` |

`localhost` and `127.0.0.1` default to the API host for convenience during local testing.

## Local development

```bash
bun install                    # install all workspaces
bun start                      # run the backend (port 3000)
bun run build:frontends        # build resume + wedding + starwars
```

Then `curl -H 'Host: ashercarlow.com' http://localhost:3000/` etc. to exercise each subdomain.

## Deployment (Docker / Dokploy)

```bash
docker compose up --build
```

Point all four subdomain DNS records at the Dokploy host and configure each domain in Dokploy to proxy to this single container's port 3000. The container reads the upstream `Host` header to choose the right handler.

### Environment variables

| Var                              | Purpose                                                |
|----------------------------------|--------------------------------------------------------|
| `PORT`                           | Listen port (default 3000)                             |
| `APPLE_MUSIC_DEVELOPER_TOKEN`    | Bearer token for Apple Music API (music endpoint)      |
| `ASHERCARLOW_AUTH_TOKEN`         | Bearer token gating SWTCW mutations + import endpoint  |
| `SWTCW_DB_PATH`                  | SQLite path (default `./data/swtcw.sqlite`)            |

### Persisted data

SQLite lives in `/app/data` inside the container, mounted from `./data` on the host. The schema migration runs idempotently on boot.

## SWTCW initial data import

The Clone Wars watch state was historically maintained on `pitwall.ashercarlow.com`. After first deploy, call once via Swagger UI (or curl):

```
POST https://api.ashercarlow.com/swtcw/admin/import-from-pitwall
Authorization: Bearer <ASHERCARLOW_AUTH_TOKEN>
Content-Type: application/json

{}
```

This UPSERTs characters, overlays per-episode `watched`/`classification`/`notes`/timestamps, and rebuilds character tag links — fully idempotent.
