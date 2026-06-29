# swdnd — Foundation Design

> **Status:** Approved (foundation scope). Date: 2026-06-28.
> **Scope:** Foundation only — scaffolding, backend plumbing, real-time backbone, the sw5e data layer, auth model, and documentation. The three user-facing features each get their own brainstorm → spec → plan cycle afterward.

## 1. Overview

`swdnd` is a new module in the `ashercarlow-api` monorepo — a web app to run a **Star Wars themed D&D campaign** using the [sw5e.com](https://sw5e.com) (Star Wars 5e) conversion of D&D 5e. It sits alongside the existing `resume`, `wedding`, and `starwars` frontends and is served by the same single Bun + Hono backend via `Host`-header dispatch.

It has three planned features, each built as a self-contained, composable **panel**:

1. **Character Sheets** — build and play sw5e characters from the ingested rules data.
2. **Tabletop / Map** — a real-time shared map.
3. **DM Screen** — the DM's campaign control surface.

The app ships as a unit: nothing is used in anger until all three features exist. This relaxes pressure to make any single feature independently shippable and lets the foundation be built for the whole.

This tool is the intended ruleset implementation for the DM's existing campaign (the "Unnamed Star Wars" Obsidian vault, whose `System/ruleset` is currently `TBD`). sw5e is that ruleset.

## 2. Confirmed decisions

| Decision | Choice |
|---|---|
| Frontend framework | **React + Vite + Tailwind v4** |
| Real-time | **WebSockets live from the start** (Bun native) |
| Auth model | **DM cookie admin + lightweight player profiles** (link-based, no passwords) |
| Subdomain | **swdnd.ashercarlow.com** |
| Database | **Separate `swdnd.sqlite`** with its own migrations (shared runner) |
| Module path | `apps/swdnd` |

## 3. Frontend: `apps/swdnd`

React + Vite + Tailwind v4. Chosen over Solid (the `starwars` stack) for ecosystem depth on a VTT-style app — drag/drop (`dnd-kit`), map canvas (`react-konva` / `tldraw`), and data-heavy sheets (`@tanstack/react-query`, `@tanstack/react-table`). The monorepo is already polyglot (2 Vue, 1 Solid), so a third stack is consistent with existing practice.

```
apps/swdnd/
├── package.json            name: @ashercarlow/swdnd
├── vite.config.ts          react() + @tailwindcss/vite, server.port 5175
├── index.html
├── tsconfig*.json
└── src/
    ├── main.tsx            entry (render <App/>)
    ├── App.tsx             React Router routes
    ├── index.css           tailwind entry
    ├── lib/
    │   ├── api.ts          REST client — ported from apps/starwars/src/lib/api.ts
    │   │                   (credentials: include, 401 handling, auth signal)
    │   ├── ws.ts           WebSocket client — room join, reconnect/backoff, typed envelope
    │   └── auth.tsx        auth context provider (DM vs player identity)
    ├── panels/             ← the three features, each self-contained & container-agnostic
    │   ├── CharacterSheet/
    │   ├── Tabletop/
    │   └── DMScreen/
    ├── layouts/
    │   ├── SinglePanel.tsx     one panel full-screen
    │   └── SplitView.tsx       two panels side-by-side, resizable
    └── pages/                  thin route wrappers that mount panels into layouts
```

### Routing & composition

Each feature is a **panel component** that makes no assumptions about its container, so the same `<CharacterSheet>` renders standalone or inside the split view. This satisfies the "each feature reachable by URL in its own tab, or two on one tab" requirement.

| Route | Renders |
|---|---|
| `/sheet/:characterId` | CharacterSheet panel, full-screen |
| `/map/:campaignId` | Tabletop panel, full-screen |
| `/dm/:campaignId` | DM Screen panel, full-screen (DM-only) |
| `/play/:characterId` | SplitView: CharacterSheet + Tabletop together |

Exact panel internals and additional routes are deferred to each feature's own spec.

## 4. Backend additions (same single process)

All changes follow the existing conventions in `apps/backend`.

### 4.1 Static serving
- Add a `swdnd.ashercarlow.com` case to the host switch in `apps/backend/src/index.ts` → `serveStaticSpa(req, SWDND_DIST)`.
- Add `SWDND_DIST` env var (default `apps/swdnd/dist`).
- Add `swdnd.ashercarlow.com` to `FRONTEND_HOSTS` (so the shared `/login` page is served there too).
- Add `swdnd.ashercarlow.com` to the CORS allowlist in `apps/backend/src/middleware/cors.ts`.
- Add a build stage + `dist` copy to the `Dockerfile`, and a `build:swdnd` script + `build:frontends` update in the root `package.json`.

### 4.2 API routes
- New directory `apps/backend/src/routes/swdnd/` (this will grow large — sheets, campaigns, players, sw5e content), each file exporting a `register*Routes(app)` registered on the shared `OpenAPIHono` from `apps/backend/src/lib/openapi.ts`.
- All routes live under `/swdnd/*`. Non-GET (mutating) routes are auth-gated following the `swtcw` `authGate` pattern; DM-only operations require the admin cookie.

### 4.3 Real-time backbone
- Bun's native WebSocket support at the `Bun.serve` level in `index.ts` (`server.upgrade(req, { data })`) for a `/swdnd/ws` path on the api host. The WebSocket handler lives in a dedicated module (e.g. `apps/backend/src/lib/swdnd-realtime.ts`) so `index.ts` stays a thin dispatcher.
- **Room = a campaign.** Clients join a room on connect; the server tracks room membership and uses Bun's native pub/sub (`ws.subscribe(room)` / `server.publish(room, msg)`).
- **Message envelope:** `{ type: string, room: string, payload: unknown }` with a discriminated-union of typed messages.
- **Write path:** mutations go through REST (validated, persisted to SQLite), then the handler broadcasts the resulting change to the room. WS is for fan-out of authoritative state, not the source of truth — so a refresh always recovers correct state from SQLite. (Feature specs may add direct WS writes for ephemeral state like cursor/drag previews.)
- The Character Sheets feature uses this immediately (e.g. live HP / condition updates); Map and DM Screen build on the same channel.

## 5. Data & SQLite

### 5.1 Separate database + shared migration runner
- New database file `swdnd.sqlite` at `SWDND_DB_PATH` (default `./data/swdnd.sqlite`), WAL + foreign-keys on, alongside the existing `swtcw.sqlite`.
- Refactor `apps/backend/src/db/index.ts` (currently hardcoded to one DB) into a small reusable helper: `openDatabase(path)` and `runMigrations(db, migrations, migrationsDir)`. Instantiate two databases: `swtcw` (existing, behavior unchanged) and `swdnd` (new). This is a targeted improvement that serves the new work without disturbing existing behavior.
- swdnd migrations live in `apps/backend/src/db/migrations/swdnd/` with their own `schema_migrations` bookkeeping in `swdnd.sqlite`.
- Add `SWDND_DB_PATH=/app/data/swdnd.sqlite` to `docker-compose.yml` (the existing named volume already persists `/app/data`).

### 5.2 Table groups
Two logical groups of tables in `swdnd.sqlite`:

- **sw5e reference content** (read-mostly, populated by an import script): the sw5e taxonomy — species, classes, archetypes, backgrounds, feats, powers (Force/Tech), equipment, starships, etc. Exact tables finalized from the deep-dive (§5.3).
- **campaign state** (read/write at runtime): campaigns, players, characters (referencing reference content), map/scene state, and DM-screen state. Detailed per-feature schema is deferred to each feature spec; the foundation creates the core `campaign`, `player`, and `character` tables that everything else hangs off.

### 5.3 sw5e ingestion — *finalized from the deep-dive*

**Source (primary): the Foundry VTT system repo [`sw5e-foundry/sw5e`](https://github.com/sw5e-foundry/sw5e), `packs/` directory.** It is per-record JSON (one file per entity across 48 category directories), **GPL-3.0 licensed**, and version-pinnable to a commit — the cleanest *licensed*, versioned source. The live website API (`https://sw5eapi.azurewebsites.net/api/`) is more normalized but carries **no license**, so it is used only as a secondary cross-check, never redistributed.

**Mechanism: a one-shot, idempotent import script** (`apps/backend/src/db/import/swdnd-sw5e.ts` or similar), mirroring the existing `POST /swtcw/admin/import-from-pitwall` pattern:
1. Clone/download `sw5e-foundry/sw5e` **at a fixed commit** (vendored or fetched at a pinned ref — builds stay reproducible and don't depend on a live site).
2. Walk `packs/*/**.json`; each is a Foundry document (`_id, name, type, img, system, flags, …`).
3. Map each document into our schema, inside a single `db.transaction()` with prepared statements (the whole corpus imports in well under a second).
4. Store the raw Foundry JSON in a `raw_json` TEXT column on every reference row, so fields we haven't modeled yet are never lost.
5. Record the source repo + **commit hash** + import timestamp in a `data_version` row.

Re-run manually to bump the sw5e version; the commit hash makes it auditable.

**Reference tables** (each carries `content_source`, `content_type`, `raw_json`):

```
species  species_features        classes  class_features  archetypes  archetype_features
backgrounds  feats  conditions  skills  abilities
fighting_styles  fighting_masteries  maneuvers  lightsaber_forms  invocations
powers      -- power_type discriminates Force vs Tech; level 0 = at-will (cantrip analog)
weapons  weapon_properties  armor  armor_properties
gear        -- ammo/adventuring/consumables/explosives/kits/implements/etc., typed by category
modifications  enhanced_items
starship_sizes  starship_equipment  starship_weapons  starship_armor
starship_modifications  starship_features  starship_actions
deployments  deployment_features  ventures  starship_roles
monsters  monster_traits  reference_tables
data_version  -- source repo + commit hash + import timestamp
```

Plus join tables as relationships get modeled explicitly (e.g. `class_archetypes`, `species_traits`, `weapon_modes`). `caster_type` / `caster_ratio` are stored on **both** `classes` and `archetypes` (an archetype can grant casting), and the multiclass caster level is computed at runtime.

### 5.4 Licensing & attribution

Bake these into the repo (e.g. a `NOTICE`/`LICENSES` note and the import script header), per the deep-dive:
- Attribute sw5e and link the source repo.
- Honor **GPL-3.0** obligations for redistributed data files / derivative code.
- The content rests on **unlicensed Star Wars IP** → keep the app **personal / non-commercial** and include a standard "not affiliated with Disney / Lucasfilm / Wizards of the Coast" disclaimer.

## 6. Auth / player model

- The existing centralized cookie login (`/auth/*`, scoped to `.ashercarlow.com`) remains the **admin / DM** identity.
- Add a lightweight **player** concept: a named profile row linked to one or more characters, reached via a per-player link (an unguessable token), **no passwords**.
- Gating:
  - **DM-only** operations (campaign edits, DM Screen, map authoring) require the admin cookie.
  - **Player** links scope read/write to that player's own character(s).
- This is deliberately minimal; real per-player accounts can be layered on later without reworking the data model.

## 7. Documentation (Mount Tantiss vault)

A new `swdnd/` folder under `ashercarlow.com/` in the Mount Tantiss Obsidian vault, using the vault's Obsidian conventions so it cross-links to the campaign docs.

```
ashercarlow.com/swdnd/
├── swdnd Index.md           hub — links out to everything
├── Architecture.md          living architecture (this design, kept current)
├── sw5e Rules Reference.md   the deep-dive report (the sw5e ruleset reference)
├── Data Model.md            swdnd.sqlite schema + sw5e ingestion detail
├── Roadmap.md               the 3-feature decomposition + build order
└── Features/
    ├── Character Sheets.md
    ├── Tabletop & Map.md
    └── DM Screen.md          (stubs now; each filled during its feature cycle)
```

This is documentation, created alongside the spec — distinct from the repo's `docs/superpowers/specs/` artifact (this file).

## 8. Roadmap (decomposition)

1. **Foundation** (this spec) — scaffold `apps/swdnd`, backend static + API + WS plumbing, separate `swdnd.sqlite` + migration-runner refactor, sw5e ingestion, vault docs.
2. **Character Sheets** — build sw5e characters from the data layer; first consumer of the WS backbone.
3. **Tabletop / Map** — real-time shared map on the WS backbone.
4. **DM Screen** — campaign control surface.

Each later item gets its own brainstorm → spec → plan cycle.

## 9. Out of scope (this foundation)

- Detailed UI / internals of any of the three panels.
- Map rendering tech choice (Konva vs tldraw vs custom) — decided in the Map spec.
- Full per-player accounts / real authentication.
- Any feature-specific WS message types beyond the generic envelope + room model.
- Per-feature campaign-state tables beyond the core `campaign` / `player` / `character` tables.
