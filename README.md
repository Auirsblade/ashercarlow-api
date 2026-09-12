# ashercarlow-monorepo

Bun-powered monorepo serving the ashercarlow.com properties from a **single process**:

- **Backend** (`apps/backend/`) — Bun + Hono + bun:sqlite, host-based dispatcher, OpenAPI/Swagger at `api.ashercarlow.com/docs`.
- **Resume** (`apps/resume/`) — Vue 3 + Vite. Static SPA. Served on `ashercarlow.com` and `www.ashercarlow.com`.
- **Wedding** (`apps/wedding/`) — Vue 3 + Vite + Vue Router. Static SPA. Served on `paulina.ashercarlow.com`.
- **Starwars** (`apps/starwars/`) — SolidJS + Vite. Two routes: `/` landing and `/tcw` Clone Wars episode tracker. Served on `starwars.ashercarlow.com`.
- **Swdnd** (`apps/swdnd/`) — React 19 + Vite + React Router + Tailwind 4. Star Wars D&D (sw5e) campaign tool: character sheets, tabletop/space maps, DM screen, starships. Served on `swdnd.ashercarlow.com`.

## Subdomain routing

The backend looks at the incoming `Host` header and dispatches:

| Host                              | Handler                                             |
|-----------------------------------|-----------------------------------------------------|
| `ashercarlow.com`, `www.*`        | `apps/resume/dist` (SPA fallback)                   |
| `paulina.ashercarlow.com`         | `apps/wedding/dist` (SPA fallback)                  |
| `starwars.ashercarlow.com`        | `apps/starwars/dist` (SPA fallback)                 |
| `swdnd.ashercarlow.com`           | `apps/swdnd/dist` (SPA fallback)                    |
| `api.ashercarlow.com`             | JSON API (auth + music + swtcw + swdnd), `/docs`, `/openapi.json` |

`localhost`, `127.0.0.1` and `0.0.0.0` default to the API host for convenience during local
testing. An unknown host gets a 404. Each `<NAME>_DIST` env var overrides where that
frontend's bundle is read from.

`/login` is a special case: it serves a standalone login page on **every** frontend host, so any
subdomain can be the landing point for signing in (see [Auth](#auth)).

## API surface

| Prefix        | What                                                                       |
|---------------|----------------------------------------------------------------------------|
| `/auth/*`     | `login` / `logout` / `me` — session cookie scoped to `.ashercarlow.com`     |
| `/music/*`    | `getMetadata` — resolves a Spotify or Apple Music URL to track metadata     |
| `/swtcw/*`    | Clone Wars episode + character tracker                                      |
| `/swdnd/*`    | sw5e campaigns, characters, players, scenes, tokens, templates, encounters, rolls, starships, reference content, uploads |
| `/swdnd/ws`   | WebSocket, one room per campaign (`?campaign=<id>`) — see [Realtime](#realtime) |

Every JSON route is declared with `createRoute` from `@hono/zod-openapi`, so `/docs` (Swagger UI)
and `/openapi.json` are always in sync with the code.

## Auth

Two credential types, both optional in dev:

- **Admin** — the `ASHERCARLOW_AUTH_TOKEN` bearer token, or the `ashercarlow_auth` session cookie
  obtained by POSTing that token to `/auth/login`. The cookie is `HttpOnly`, `SameSite=Lax`, and
  scoped to `.ashercarlow.com` so it works across every subdomain.
- **Player** — an unguessable per-player `access_token`, passed as the `X-Player-Token` header or a
  `?token=` query param. Lets a player edit their own character, move their own tokens, and fly a
  ship they crew, without handing out admin rights.

Mutations on `/swtcw/*` and `/swdnd/*` are gated; GETs are open. Some `/swdnd/*` paths opt out of
the blanket admin gate and run their own player-or-admin check in-handler (see `selfGated()` in
`apps/backend/src/routes/swdnd/index.ts`).

> **Dev mode:** when `ASHERCARLOW_AUTH_TOKEN` is unset, every access check passes. Always set it in
> production.

## Realtime

swdnd clients open a WebSocket to `/swdnd/ws?campaign=<id>` on the API host. The upgrade is
authenticated with the same admin or player credentials as above, and each campaign is a pub/sub
room — REST handlers broadcast changes (token moves, fog, initiative, rolls) to everyone in it.

## Data

Two SQLite databases, both WAL-mode with foreign keys on, migrated idempotently on boot via
`schema_migrations` bookkeeping:

| DB           | Default path             | Migrations                                |
|--------------|--------------------------|-------------------------------------------|
| swtcw        | `./data/swtcw.sqlite`    | `apps/backend/src/db/migrations/`         |
| swdnd        | `./data/swdnd.sqlite`    | `apps/backend/src/db/migrations/swdnd/`   |

Uploaded map and token images land in `./data/uploads/swdnd` and are served from
`/swdnd/uploads/{file}`.

Under `bun test` the swdnd DB defaults to a throwaway file in `$TMPDIR`, so tests can never touch
`./data/swdnd.sqlite`. An explicit `SWDND_DB_PATH` always wins.

### sw5e reference content

swdnd's rules content (species, classes, powers, gear, starship parts…) is imported from the upstream
[sw5e-foundry/sw5e](https://github.com/sw5e-foundry/sw5e) packs.

- **Production** — the Docker build checks out a pinned commit and bakes a seed DB into the image.
  On boot, `seedContentFromImage()` merges it into the live DB if content is missing or the pinned
  commit changed, leaving user data alone. Restarting the same image is a no-op.
- **Local** — run the one-shot importer against a checkout of the packs:

  ```bash
  SW5E_PACKS_DIR=/path/to/sw5e/packs bun run apps/backend/src/db/import/sw5e-import.ts
  ```

## Local development

```bash
bun install                    # install all workspaces
mkdir -p data                  # SQLite lives here; gitignored, not auto-created
bun start                      # run the backend (port 3000)
bun run dev                    # same, with --hot reload
bun test                       # run the full test suite
bun run build:frontends        # build all four frontends
```

Individual frontend builds: `bun run build:resume`, `build:wedding`, `build:starwars`, `build:swdnd`.

Then `curl -H 'Host: ashercarlow.com' http://localhost:3000/` etc. to exercise each subdomain.

### Frontend dev servers

Each frontend has its own Vite dev server:

```bash
bun --cwd apps/swdnd run dev       # likewise resume / wedding / starwars
```

They call `https://api.ashercarlow.com` cross-origin by default. To point at a local backend, set
`VITE_API_BASE=http://localhost:3000` in that app's `.env.development`. `localhost` and `127.0.0.1`
are already in the backend's CORS allowlist.

## Deployment (Docker / Dokploy)

```bash
docker compose up --build
```

The compose service deliberately declares no `ports:` — Dokploy routes traffic to the container
over its internal Traefik network. To exercise the image locally:

```bash
docker compose run --rm --service-ports ashercarlow
```

Point all six hostnames (apex, `www`, `paulina`, `starwars`, `swdnd`, `api`) at the Dokploy host and
configure each domain to proxy to this single container's port 3000. The container reads the
upstream `Host` header to choose the right handler.

### Build args

| Arg              | Purpose                                                             |
|------------------|---------------------------------------------------------------------|
| `VITE_API_BASE`  | API base URL baked into the frontend bundles (default prod API)      |
| `SW5E_REF`       | Upstream sw5e commit to build the reference-content seed DB from     |

### Environment variables

| Var                              | Purpose                                                     |
|----------------------------------|--------------------------------------------------------------|
| `PORT`                           | Listen port (default 3000)                                   |
| `APPLE_MUSIC_DEVELOPER_TOKEN`    | Bearer token for Apple Music API (music endpoint)            |
| `ASHERCARLOW_AUTH_TOKEN`         | Admin token — gates mutations; unset means dev mode          |
| `SWTCW_DB_PATH`                  | swtcw SQLite path (default `./data/swtcw.sqlite`)            |
| `SWDND_DB_PATH`                  | swdnd SQLite path (default `./data/swdnd.sqlite`)            |
| `SWDND_SEED_PATH`                | Baked-in sw5e seed DB; set by the image, unset locally       |
| `SWDND_UPLOADS_DIR`              | Map/token image uploads (default `./data/uploads/swdnd`)     |
| `SW5E_PACKS_DIR`                 | sw5e packs checkout for the one-shot importer                |
| `RESUME_DIST` … `SWDND_DIST`     | Override where each frontend bundle is served from           |

### Persisted data

Both SQLite databases and the uploads directory live under `/app/data` in the container, backed by
the `ashercarlow-data` volume. Migrations and content seeding run idempotently on every boot.

## SWTCW initial data import

The Clone Wars watch state was historically maintained on `pitwall.ashercarlow.com`. After first
deploy, call once via Swagger UI (or curl):

```
POST https://api.ashercarlow.com/swtcw/admin/import-from-pitwall
Authorization: Bearer <ASHERCARLOW_AUTH_TOKEN>
Content-Type: application/json

{}
```

This UPSERTs characters, overlays per-episode `watched`/`classification`/`notes`/timestamps, and
rebuilds character tag links — fully idempotent.

## Repo layout

```
apps/
├── backend/    Bun + Hono + bun:sqlite + zod-openapi   (the only process at runtime)
├── resume/     Vue 3 + Vite
├── wedding/    Vue 3 + Vite + Vue Router
├── starwars/   SolidJS + Vite
└── swdnd/      React 19 + Vite + React Router + Tailwind
docs/           Design specs and implementation plans
tasks/          Working notes
```

See `CLAUDE.md` for backend conventions and the checklists for adding a new API route or frontend
module.
