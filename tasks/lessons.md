# Lessons

Reusable gotchas for this repo (Bun + Hono monorepo). Add to this as corrections come up.

## Testing

- **A module-level DB singleton is shared across all `bun test` files in one process.**
  `apps/backend/src/db/swdnd` exports `swdndDb`, opened from `SWDND_DB_PATH` at import time. When several test files each set a unique `SWDND_DB_PATH` and dynamically `import('../../db/swdnd')`, only the *first* import wins — every file gets that same instance. Each file passes in isolation but they collide when run together (e.g. `UNIQUE constraint failed: campaign.id` from duplicate seed ids). Fix: in every route test's `beforeAll`, after obtaining the singleton, reset the tables before seeding:
  `swdndDb.exec('DELETE FROM character; DELETE FROM player; DELETE FROM campaign;')`.
  Always verify a new test passes **with the whole suite** (`bun test apps/backend`), not just alone.

- **Mocking a Hono `Context` for code that reads cookies needs `req.raw.headers`.**
  `getCookie(c, ...)` (and anything via `isCookieAuthed`) reads `c.req.raw.headers`. A minimal `{ req: { header, url, method } }` mock crashes with `undefined is not an object (evaluating 'c.req.raw.headers')`. Add `raw: { headers: new Headers(headers) }` to the mock.

## Frontend build

- **`*.test.ts` files under a Vite app's `src/` break `tsc -b && vite build`.**
  They import `bun:test` (no types in the Vite/tsc context) and shouldn't ship in the bundle. Exclude them in the app's `tsconfig.app.json`: `"exclude": ["src/**/*.test.ts", "src/**/*.test.tsx"]`. Bun still runs them regardless of tsconfig include/exclude.

## sw5e data (swdnd)

- **Casting lives under `system.powercasting.{force,tech}`** (values `"full" | "3/4" | "half" | "arch" | "none"`), NOT `system.casterType`/`casterRatio` (those fields don't exist in the real Foundry data — they import as NULL).
- **The point-pool / max-power-level / powers-known / superiority tables are in `vendor/sw5e/module/config.mjs`** and the multiclass derivation is in `vendor/sw5e/module/documents/actor/actor.mjs` — they are computed in code, not stored in the `packs/` data. Cross-check engine constants against those files.
- **Packs are nested** (`forcepowers/level-1/*.json`, `armor/medium/*.json`, `archetypes/<class>/*.json`) and several fields are free-text prose (backgrounds' skill/tool proficiencies), so the builder is "assisted" (player chooses) rather than fully auto-parsed.

## 2026-07-24 — running backend tests destroyed dev data
- `bun test` for the swdnd route tests DELETEd whole tables and ran against
  the real `./data/swdnd.sqlite` (the default path) when invoked from the
  repo root. This wiped the local dev campaigns before anyone noticed.
- Rule: never run a test suite that mutates a database without first checking
  which database it points at. If tests share the app's default DB path, fix
  the isolation first (done: swdnd DB now defaults to a temp file under
  NODE_ENV=test), then run them.
