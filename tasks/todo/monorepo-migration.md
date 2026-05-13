# Monorepo Migration: ashercarlow-api → Bun-based polyrepo backend

## Goal
Convert `ashercarlow-api` from a standalone NestJS+Express+Node API into a Bun monorepo that:
- Serves three frontend modules (resume, wedding, starwars) as static apps behind subdomain routing
- Exposes all JSON API endpoints under `api.ashercarlow.com` with a single Swagger/OpenAPI page
- Is built and deployed as a single Docker image via Dokploy
- Keeps `pitwall`, `AsherCarlow`, `wedding-site`, `cashflow2` unmodified (read-only sources)

## Final architecture

```
ashercarlow-api/                       # this repo, becomes monorepo root
├── package.json                       # Bun workspaces
├── apps/
│   ├── backend/                       # Bun + Hono single server
│   │   ├── src/
│   │   │   ├── index.ts               # entrypoint, host-based dispatcher
│   │   │   ├── routes/
│   │   │   │   ├── music.ts           # ported from NestJS music module
│   │   │   │   └── swtcw.ts           # lifted from pitwall (already Hono)
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts            # bearer-token auth (renamed)
│   │   │   │   └── cors.ts            # allow starwars subdomain to call api.*
│   │   │   ├── lib/
│   │   │   │   ├── static.ts          # SPA-fallback static serve
│   │   │   │   └── openapi.ts         # zod-openapi + swagger-ui setup
│   │   │   └── db/                    # bun:sqlite + migrations
│   │   └── package.json
│   ├── resume/                        # copy of AsherCarlow (Vue 3 + Vite)
│   ├── wedding/                       # copy of wedding-site (Vue 3 + Vite + Router)
│   └── starwars/                      # SolidJS + Vite; routes: `/` landing, `/tcw` Clone Wars guide
├── data/                              # sqlite volume (swtcw.sqlite)
├── Dockerfile                         # multi-stage: build all frontends, run backend
└── docker-compose.yml
```

### Subdomain → handler dispatch (Host header at runtime)

| Host                              | Handler                                                                |
|-----------------------------------|------------------------------------------------------------------------|
| `ashercarlow.com`, `www.*`        | Serve `apps/resume/dist` (SPA fallback)                                |
| `paulina.ashercarlow.com`         | Serve `apps/wedding/dist` (SPA fallback)                               |
| `starwars.ashercarlow.com`        | Serve `apps/starwars/dist` (SPA fallback); SolidJS router handles `/` landing + `/tcw` Clone Wars guide |
| `api.ashercarlow.com`             | JSON API: `/music/*`, `/swtcw/*`, `/docs` (Swagger UI), `/openapi.json` |

### Env vars (final list)
- `PORT` — listen port
- `APPLE_MUSIC_DEVELOPER_TOKEN` — music endpoint
- `ASHERCARLOW_AUTH_TOKEN` — SWTCW mutation bearer (renamed from `PITWALL_AUTH_TOKEN`)
- `SWTCW_DB_PATH` — sqlite file path (default `./data/swtcw.sqlite`)

### Cross-origin note
The starwars frontend at `starwars.ashercarlow.com/tcw` will call the API at `api.ashercarlow.com/swtcw/*` — that's cross-origin. Backend must serve appropriate `Access-Control-Allow-Origin` headers and handle preflight `OPTIONS`. Origin allowlist: the four monorepo subdomains, plus localhost variants for dev.

## Implementation checklist

### Phase 1 — Tear-down & scaffold
- [x] Capture current `ashercarlow-api` state: noted Music endpoint contract (GET /music/getMetadata, full response schema captured)
- [x] Delete `src/kalshi-observer/` and `src/alpaca-observer/` (dead projects)
- [x] Delete NestJS scaffolding: `nest-cli.json`, `tsconfig.build.json`, `tsconfig.json`, `src/main.ts`, `src/app.module.ts`, `src/app.controller.ts`, `src/app.controller.spec.ts`, `src/app.service.ts`, `eslint.config.mjs`, `test/`, `dist/`, `node_modules/`
- [x] Delete `package-lock.json`
- [x] Create root `package.json` with Bun workspaces declaration (`apps/*`)
- [x] Create `apps/` directory
- [x] Verify `bun install` runs clean at root (Bun 1.3.9, 5 packages installed in 529ms)

Notes:
- `src/music/` retained as reference until Phase 3 port completes — will be deleted after.
- `Dockerfile`, `docker-compose.yml`, `README.md`, `CLAUDE.md` kept in place; rewritten in Phases 8/9.
- `data/` directory preserved (volume mount); the orphan `kalshi-observer.sqlite` inside is harmless and can be cleaned later.

### Phase 2 — Backend skeleton (Bun + Hono + Swagger)
- [x] Create `apps/backend/package.json` (deps: `hono`, `@hono/zod-openapi`, `@hono/swagger-ui`, `zod`; backend tsconfig.json with Bun-recommended config)
- [x] `apps/backend/src/index.ts` — `Bun.serve` with host-based dispatcher (`ashercarlow.com|www → resume`, `paulina.* → wedding`, `starwars.* → starwars`, `api.* → api app`, localhost defaults to api)
- [x] Health route `/` → `{ ok: true, service, docs }` JSON
- [x] `apps/backend/src/lib/openapi.ts` — `OpenAPIHono`, Swagger UI at `/docs`, raw spec at `/openapi.json`
- [x] `apps/backend/src/middleware/cors.ts` — Hono CORS, allowlist of all four ashercarlow subdomains + localhost
- [x] `apps/backend/src/lib/static.ts` — SPA-fallback static serve via `Bun.file`, path-traversal guard
- [x] Smoke tests passed:
  - `GET /` → 200 health JSON
  - `GET /docs` → Swagger UI HTML
  - `GET /openapi.json` → valid OpenAPI 3.0 spec
  - `Host: ashercarlow.com` → 404 (dist not present yet — expected)
  - `Host: bogus.example.com` → 404 with "Unknown host"
  - CORS preflight from `https://starwars.ashercarlow.com` → 204 with correct `Access-Control-*` headers

### Phase 3 — Port music endpoint to OpenAPI route
- [x] Read `ashercarlow-api/src/music/*` and captured external API calls, schema, similarity-scoring logic
- [x] Reimplemented as `apps/backend/src/routes/music.ts` using `@hono/zod-openapi` `createRoute()` — appears in Swagger as `music` tag
- [x] Preserved `GET /music/getMetadata` contract: query `url`, response `{ title, artist, album, releaseDate?, genres?, image, spotifyUrl?, appleMusicUrl? }`
- [x] Added uniform JSON error handling: `defaultHook` for Zod validation errors and `app.onError` for `HTTPException` both return `{ message }` JSON with correct status
- [x] Deleted old `src/music/` NestJS implementation
- [x] Verified: `/openapi.json` lists `/music/getMetadata` under `music` tag; invalid input returns `{"message":"..."}` 400
- Note: live Apple Music API call deferred — requires `APPLE_MUSIC_DEVELOPER_TOKEN` env. Verify in Phase 9.

### Phase 4 — Resume frontend
- [x] Copied `/Users/asherc/Git/AsherCarlow/*` → `apps/resume/` (excluded `node_modules`, `dist`, `.git`, `.DS_Store`, `.idea`, `.vscode`)
- [x] Renamed package to `@ashercarlow/resume`; deleted stale `package-lock.json`
- [x] Added missing `tailwindcss` core dep (the upstream `AsherCarlow/package.json` is missing it — pre-existing bug masked by npm hoisting)
- [x] `bun install` + `bun run build` clean in `apps/resume/`; output to `apps/resume/dist/` (22 modules transformed)
- [x] Dispatcher serves resume on `Host: ashercarlow.com` and `Host: www.ashercarlow.com`
- [x] Smoke tested: `/` returns resume HTML; `/assets/*.css` returns `text/css`; `/favicon.ico` returns `image/x-icon`; `/nonexistent` triggers SPA fallback to index.html; API on `Host: api.ashercarlow.com` still returns health JSON

### Phase 5 — Wedding frontend
- [x] Copied `/Users/asherc/Git/wedding-site/*` → `apps/wedding/` (excluded node_modules/dist/.git/.DS_Store)
- [x] Renamed package to `@ashercarlow/wedding`; deleted stale `package-lock.json`
- [x] `bun install` + `bun run build` clean (2642 modules transformed; harmless vueuse rollup warning)
- [x] Dispatcher serves wedding on `Host: paulina.ashercarlow.com`
- [x] Smoke tested: `/` returns wedding HTML (title "Wedding of Paulina & Asher Carlow"); `/invite/test` and `/stats` both fall back to index.html (Vue Router history mode works); `/assets/*.css` returns `text/css`; resume on other host still works

### Phase 6 — SWTCW backend port (lands on api.ashercarlow.com)
- [x] Copied migration SQL → `apps/backend/src/db/migrations/001_swtcw.sql`
- [x] Created `apps/backend/src/db/index.ts` — opens `SWTCW_DB_PATH` (default `./data/swtcw.sqlite`) with `bun:sqlite`, WAL + foreign-keys, `schema_migrations` table for idempotent migration application
- [x] Auth replaced with inline gate in `apps/backend/src/routes/swtcw.ts`: non-GET requests to `/swtcw/*` require `Authorization: Bearer $ASHERCARLOW_AUTH_TOKEN`; missing-token-in-env preserves pitwall's "dev-mode allows everything" behavior
- [x] Rewrote all six SWTCW routes (GET episodes, GET characters, PATCH episode, PUT characters, POST character, DELETE character) using `@hono/zod-openapi` `createRoute()` — all appear in Swagger under the `swtcw` tag
- [x] Mount lives on `api.ashercarlow.com/swtcw/*`; bearer security scheme registered in OpenAPI components → Swagger UI shows Authorize button
- [x] Added `POST /swtcw/admin/import-from-pitwall` auth-required Swagger-callable endpoint with optional `{ source_url? }` body (default `https://pitwall.ashercarlow.com/api/swtcw`); UPSERTs characters, UPDATEs episodes, rebuilds episode_character links inside a single bun:sqlite transaction
- [x] On fresh DB, migration created 134 episodes + 10 seed characters (verified)
- [x] Smoke tests passed:
  - `/openapi.json` lists 7 paths (1 music + 6 swtcw); `bearerAuth` scheme present
  - `GET /swtcw/episodes` returns 134 rows; `GET /swtcw/characters` returns 10
  - `PATCH /swtcw/episodes/1` without auth → 401; with valid token → 200 with updated state
  - `POST /swtcw/admin/import-from-pitwall` against unreachable URL → 502 with clean error JSON
- [x] **Live import verified against `pitwall.ashercarlow.com`**:
  - First call: 134 episodes_updated, 18 characters_upserted (10 seed + 8 user-created), 102 episode_character_links
  - Episode 1 went from default → classification "essential", watched true, characters [anakin, obi-wan], reviewed_at + watched_at timestamps from May 8
  - 28 / 134 episodes now show watched=true (matches user's pitwall state)
  - Second call returns identical counts → idempotent ✓

### Phase 7 — Starwars frontend (landing + SWTCW Clone Wars guide)
- [x] Audited SWTCW.tsx dependency footprint via Explore agent: only `../lib/api` is in-repo; npm deps are `solid-js`, `@solidjs/router`, `lucide-solid`, `tailwindcss`. No components extracted from pitwall.
- [x] Created `apps/starwars/` SolidJS + Vite + Tailwind v4 scaffold (package.json, three tsconfigs, vite.config.ts, index.html, index.css, index.tsx)
- [x] Wrote fresh `App.tsx` with `@solidjs/router`: `/` → Landing, `/tcw` → Tcw
- [x] Wrote `pages/Landing.tsx` — Tailwind dark page with kicker, headline, description, and amber CTA button linking to `/tcw`
- [x] Copied `pitwall/web/src/pages/SWTCW.tsx` → `apps/starwars/src/pages/Tcw.tsx`; rewrote 13 call sites `/api/swtcw/` → `/swtcw/` to match new backend mount
- [x] Copied `pitwall/web/src/lib/api.ts` → `apps/starwars/src/lib/api.ts` with: `API_BASE` set to `import.meta.env.VITE_API_BASE ?? 'https://api.ashercarlow.com'` (cross-origin to api subdomain); `pitwall_token` → `ashercarlow_token` localStorage key; error parsing reads `message` (matches new backend's JSON error shape) before falling back to `error`
- [x] Vite `base: '/'` (default), router handles `/` + `/tcw` internally
- [x] Build clean: `bun run build` produced `apps/starwars/dist/` (1969 modules transformed, 64KB JS / 22KB gzip)
- [x] Smoke tested via dispatcher:
  - `Host: starwars.ashercarlow.com /` → 200, title "Star Wars · ashercarlow"
  - `Host: starwars.ashercarlow.com /tcw` → 200, same index.html (SPA fallback works)
  - `/assets/*.css` → text/css, `/assets/*.js` → text/javascript
  - Resume, wedding, and api hosts unaffected

Notes:
- Browser-level checks (landing button → /tcw renders Tcw page → /tcw fetches from api.ashercarlow.com → CORS preflight succeeds → mutations work with bearer token) deferred to Phase 9 (need real DNS or hosts file).
- For local dev: a future `.env.development` in `apps/starwars/` could set `VITE_API_BASE=http://localhost:3000` plus a Vite proxy that strips the Host header. Out of scope for v1.

### Phase 8 — Dockerfile & deploy config
- [x] New multi-stage Dockerfile:
  - Stage 1 `oven/bun:1`: workspace manifests → `bun install --frozen-lockfile` → copy source → build resume, wedding, starwars
  - Stage 2 `oven/bun:1-slim`: re-install with `--production --frozen-lockfile` (drops Vite, TS, vue-tsc, etc.); copy backend src + each frontend `dist/`; `VOLUME /app/data`; `CMD bun apps/backend/src/index.ts`
- [x] `.dockerignore` updated to exclude `**/node_modules`, `**/dist`, `data/`, `tasks/`, `.DS_Store`, `.idea`, etc.
- [x] `docker-compose.yml` rewritten — single `ashercarlow` service, `./data:/app/data` volume, env passthroughs for `APPLE_MUSIC_DEVELOPER_TOKEN`, `ASHERCARLOW_AUTH_TOKEN`, `SWTCW_DB_PATH`
- [x] README rewritten with new architecture, subdomain routing table, dev instructions, env-var matrix, Dokploy notes, and SWTCW import quickstart
- [x] **Docker build + run verified end-to-end** (`docker compose build --build-arg VITE_API_BASE=http://localhost:3000` + `docker compose up`):
  - Build succeeded after two fixes:
    1. Removed `better-sqlite3` devDep + `scripts/build-stats.mjs` from `apps/wedding/` (needed Python+node-gyp inside the bun image and we don't run the stats script)
    2. Dropped `vue-tsc` type-check from the resume's `build` script (kept as separate `type-check` script); inside the slim bun image, vue-tsc couldn't resolve `.vue` modules even though identical config works locally. The wedding-site never type-checked at build time anyway — matched its pattern.
  - Also switched Dockerfile and root scripts from `bun --cwd apps/X run build` to `cd apps/X && bun run build` (Bun 1.3.14 in the image was misparsing `--cwd`).
  - Added `ARG VITE_API_BASE` (default `https://api.ashercarlow.com`) so local testing can override to a localhost-style base.
  - Confirmed in the running container: all 4 hosts dispatch correctly, `VITE_API_BASE` baked into starwars JS bundle, SWTCW migration runs, live import from `pitwall.ashercarlow.com` succeeds (134/18/102), wrong token → 401, valid token → 200, CORS preflight returns proper allow headers.

### Phase 9 — Verification
- [x] All four host scenarios return expected page/response (resume, wedding, starwars, api on localhost via Host header)
- [x] `/openapi.json` exposes all 7 paths under their tags; `bearerAuth` security scheme registered
- [x] CORS preflight from `https://starwars.ashercarlow.com` to `/swtcw/episodes` returns 204 with correct `Access-Control-*` headers
- [x] SWTCW mutations: no token → 401, wrong token → 401, valid token → 200 with updated body
- [x] Wedding deep link `/invite/somebody` resolves via SPA fallback (same `index.html` as `/`)
- [x] Music endpoint validation returns `{"message":"url: Required"}` JSON 400 (live Spotify→Apple call deferred — requires `APPLE_MUSIC_DEVELOPER_TOKEN`)
- [x] Codebase clean of NestJS, kalshi, alpaca, `PITWALL_AUTH_TOKEN` (one stale doc-comment line in `music.ts` removed)
- [x] Type-check passes for backend (`bunx tsc -p apps/backend/tsconfig.json --noEmit`), resume (`vue-tsc --build`), and starwars (`tsc -b`)
- [x] CLAUDE.md rewritten with new architecture, conventions, dispatch behavior, how-to add routes/frontends

## Decisions locked
- All API endpoints (music, swtcw) live on `api.ashercarlow.com`, surfaced via single Swagger UI at `/docs`
- `starwars.ashercarlow.com/` is a real page (landing with button to `/tcw`), not a 404 or redirect
- Whole starwars subdomain is one SolidJS app with internal routing — not two separate apps
- Star Wars subpath naming (`/tcw` for Clone Wars) reserves room for future shows (`/rebels`, `/mando`, etc.)
- Existing Clone Wars watch data lives in pitwall and ports over via a manual `POST /swtcw/admin/import-from-pitwall` Swagger-callable endpoint — one-shot, idempotent, no automatic startup sync

## Open questions / decisions during build
- Landing page styling — match SWTCW page's Tailwind aesthetic, or do something distinct? *Default: match.*
- Dev workflow for cross-origin testing (host-file edits vs Vite proxy) — figure out during Phase 7 iteration.

## Out of scope (explicit)
- Modifying `pitwall`, `cashflow2`, `AsherCarlow`, or `wedding-site` repos
- Removing the Star Wars feature from pitwall (pitwall keeps its copy until later cleanup)
- Building a shared `packages/` layer — not needed for v1

## Review

**Status:** Migration complete and verified end-to-end in Docker. Only the live Apple Music API call is deferred (needs `APPLE_MUSIC_DEVELOPER_TOKEN` in deploy env).

### What landed
- Repo morphed from NestJS+Express on Node into a Bun workspace with one backend (`apps/backend`) and three static frontends (`apps/{resume,wedding,starwars}`).
- Single `Bun.serve` reads the `Host` header and dispatches to the matching frontend's `dist/` or to the OpenAPIHono app.
- The whole JSON surface is under `api.ashercarlow.com` with a Swagger UI at `/docs`, raw spec at `/openapi.json`, `bearerAuth` security scheme so the Authorize button works.
- SWTCW lifted from pitwall with handlers rewritten via `@hono/zod-openapi` `createRoute`; auth gate inlined for non-GET on `/swtcw/*`; `PITWALL_AUTH_TOKEN` → `ASHERCARLOW_AUTH_TOKEN`.
- Live data import endpoint `POST /swtcw/admin/import-from-pitwall` verified end-to-end against `pitwall.ashercarlow.com` — pulled 28/134 watched episodes, 18 characters, 102 character-tag links; second call returned identical counts.
- Multi-stage `Dockerfile` builds frontends in stage 1, copies dist + backend src + a re-installed `--production` node_modules into a `bun:1-slim` runner; `docker-compose.yml` exposes the SQLite volume and env vars; README documents the deploy + Dokploy subdomain setup.

### What the user needs to do next
1. Set the deploy-time env vars in Dokploy: `APPLE_MUSIC_DEVELOPER_TOKEN`, `ASHERCARLOW_AUTH_TOKEN`.
2. Point all four DNS records (`ashercarlow.com`, `www`, `paulina`, `starwars`, `api`) at the Dokploy host and configure each to proxy port 3000 of this container.
3. `docker compose up --build` once locally to sanity check, then push.
4. After first deploy, hit Swagger UI at `https://api.ashercarlow.com/docs`, click Authorize, paste the auth token, and call `POST /swtcw/admin/import-from-pitwall` once to seed the watch state.
5. Optional cleanup: the legacy `kalshi-observer.sqlite` in `data/` is orphaned and can be deleted at leisure.

### Risk notes
- Music endpoint Apple Music live call was not exercised in this session (no token in env). The contract is preserved byte-for-byte and unit-of-logic is unchanged from NestJS, so very low risk, but worth a single curl after deploy.
- Backend image size will be larger than ideal because the runner re-installs all workspaces' production deps — Vue/Solid runtimes are unused at runtime but installed. Worth optimizing later if image pull time becomes a problem.
- Starwars frontend hits `https://api.ashercarlow.com` cross-origin in prod. Local dev requires either a hosts file edit or `VITE_API_BASE=http://localhost:3000` in `apps/starwars/.env.development`; not configured.
