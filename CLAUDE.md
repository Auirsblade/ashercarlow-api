# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## Project Overview

Bun-based monorepo that serves all of the ashercarlow.com properties from a single Hono backend. The backend reads the incoming `Host` header and dispatches to one of three static frontend bundles or to the JSON API.

## Layout

```
apps/
├── backend/    Bun + Hono + bun:sqlite + zod-openapi   (the only process at runtime)
├── resume/     Vue 3 + Vite, static SPA                 (ashercarlow.com, www)
├── wedding/    Vue 3 + Vite + Vue Router, static SPA    (paulina.ashercarlow.com)
└── starwars/   SolidJS + Vite, two routes (/ + /tcw)    (starwars.ashercarlow.com)
```

The backend itself is what services `api.ashercarlow.com` — music + SWTCW JSON endpoints, plus `/docs` Swagger UI and `/openapi.json`.

## Subdomain dispatch

`apps/backend/src/index.ts` switches on the `Host` header:

- `ashercarlow.com` / `www.ashercarlow.com` → serve `apps/resume/dist` (SPA fallback)
- `paulina.ashercarlow.com` → serve `apps/wedding/dist` (SPA fallback — Vue Router history mode needs this for `/invite/:name`, `/stats`)
- `starwars.ashercarlow.com` → serve `apps/starwars/dist` (SPA fallback covers `/` and `/tcw`)
- `api.ashercarlow.com` → the `OpenAPIHono` app (music + SWTCW routes)
- `localhost` / `127.0.0.1` / `0.0.0.0` → treated as the API host (dev convenience)

## Commands

```bash
bun install                    # workspace install
bun start                      # run backend (apps/backend/src/index.ts on port 3000)
bun run dev                    # backend with --hot reload
bun run build:resume           # build resume → apps/resume/dist
bun run build:wedding          # build wedding → apps/wedding/dist
bun run build:starwars         # build starwars → apps/starwars/dist
bun run build:frontends        # all three above, sequentially

docker compose up --build      # production-style image
```

The starwars frontend is SolidJS — use `bun --cwd apps/starwars run dev` for the Vite dev server. By default it calls `https://api.ashercarlow.com` cross-origin; set `VITE_API_BASE=http://localhost:3000` in `apps/starwars/.env.development` to point at a local backend.

## Backend conventions

- **Runtime**: Bun, not Node. Use `Bun.serve`, `Bun.file`, `bun:sqlite`, `import.meta.dir`.
- **Validation + OpenAPI**: every JSON route is defined via `createRoute` from `@hono/zod-openapi` and registered with `app.openapi(route, handler)`. Schemas live next to the route. Single Swagger UI at `/docs`.
- **Errors**: `throw new HTTPException(status, { message })`. The global `onError` formats them as `{ message }` JSON. `defaultHook` does the same for Zod validation failures.
- **Auth**: bearer token in `ASHERCARLOW_AUTH_TOKEN`. Inline `authGate` in `apps/backend/src/routes/swtcw.ts` gates non-GET requests on `/swtcw/*`; when the env var is unset, requests pass through (dev mode).
- **SQLite**: stored at `SWTCW_DB_PATH` (defaults to `./data/swtcw.sqlite`). WAL + foreign-keys on. Schema migrations live in `apps/backend/src/db/migrations/` and are applied via `schema_migrations` bookkeeping on every boot.
- **Timestamps**: ISO 8601 UTC strings.

## Adding a new API route

1. Drop a file in `apps/backend/src/routes/`.
2. Define Zod schemas + a `createRoute` config (tags, request, responses).
3. Export a `register*Routes(app: OpenAPIHono)` function and call it from `apps/backend/src/lib/openapi.ts`.
4. If the route mutates state and should require auth, place it under a path covered by an existing `app.use(...)` middleware (e.g. `/swtcw/*`) or add a new one.

## Adding a new frontend module

1. Create `apps/<name>/` with its own `package.json` (name `@ashercarlow/<name>`) and Vite config.
2. Add a `build:<name>` script to the root `package.json`.
3. Add a new case to the host dispatcher in `apps/backend/src/index.ts` and a corresponding `<NAME>_DIST` env override.
4. Add the subdomain to the CORS allowlist in `apps/backend/src/middleware/cors.ts` if the new frontend will call the JSON API.
5. Update the Dockerfile to build it in stage 1 and copy `dist/` in stage 2.

## SWTCW data sync (one-shot)

The Clone Wars watch state used to live in pitwall. To pull current state from the live deploy into the new backend's SQLite, call `POST /swtcw/admin/import-from-pitwall` (auth required, callable from Swagger UI). It's idempotent — UPSERTs characters, overlays per-episode watch/notes/classification/timestamps, rebuilds character tag links inside a transaction.

## Out-of-scope notes

- `cashflow2` and `pitwall` remain their own repos and deployments; they are **not** absorbed here.
- The legacy NestJS kalshi-observer and alpaca-observer modules were deleted as dead code during the migration.
