# Space Map Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SW5E space encounters playable on the existing hex tabletop — a per-scene ground/space mode (5 ft vs 50 ft per hex), tokens bound to `starship` rows with shields-over-hull double rings, 60° hex facing, multi-hex footprints, crew-based move access, grouped initiative, and the space condition vocabulary.

**Architecture:** One migration adds `scene.mode`, `token.ship_id` and `token.facing`; all new rules live in small pure modules under `apps/swdnd/src/lib/` (`shipTokens.ts` facing/footprint/vocabulary, `shipVitals.ts` hull+shield vitals, `shipPlay.ts` play-document edits, `initiative.ts` crew nesting) so the SVG layer stays dumb. `useTabletop` mirrors the existing character-vitals pattern for ships (lazy load → `buildShipVitals` → live `ship:updated` merge → optimistic whole-document PATCH). Ship conditions live on the ship document, never on the token. Distance already generalizes through `GridConfig.unitsPerHex`, so space mode is a grid recalibration plus a mode flag, not a new coordinate system.

**Tech Stack:** Bun + Hono + @hono/zod-openapi + bun:sqlite / React + Vite + Tailwind v4 / bun:test.

**Spec:** `docs/superpowers/specs/2026-08-12-starship-spine-design.md` — sub-project **3** of the decomposition ("Space map mode"). Depends on sub-projects 1 (starship spine) and 2 (crew layer) being merged. Suggested branch: `swdnd-space-map`.

## Design decisions embedded in this plan (not yet individually approved)

1. **Facing is an integer 0–5 on the token**, not degrees and not a ship-document field. It indexes `AXIAL_DIRS` in `lib/hex.ts`, so the same six directions already used by cone templates (`hexWedge`) drive the bow marker — one vocabulary, no conversion table. Screen angle is derived (never stored) by `facingAngle(facing, grid)`, which reads the geometry from `hexToPixel` so it can never drift from the grid orientation. **Write path consequence:** `PATCH /swdnd/tokens/{id}` is `assertAdmin`-gated, so a crew player could not rotate their own ship through it. This plan therefore adds `facing` to **both** `PATCH /swdnd/tokens/{id}` (DM edit, as briefed) **and** `PATCH /swdnd/tokens/{id}/position` (the move-access-gated route), and makes `q`/`r` optional there so a rotation never rewrites position from a stale local copy.
2. **Ship conditions live on the ship, not the token.** The right-click menu on a ship token writes `ShipPlayState.conditions` / `systemDamage` via `PATCH /swdnd/starships/{id}`; `token.conditions_json` stays untouched on ship tokens. Rationale: two tokens of the same ship (or the ShipSheet open beside the map) must agree, and `ship:updated` already broadcasts `play`. Cost: the condition ring for a ship token renders from `shipVitals`, not `tokenVitals`.
3. **Grouped initiative is optional `crew?: string[]` nesting** on the existing entry shape — crew *token ids* listed under a ship entry — rather than a new nested document type. Legacy entries (no `crew` key) parse unchanged. The ship slot's roll follows the SOTG rule (lowest crew roll) and is computed at group time; the DM still types every value by hand (no auto-roll).
4. **Footprint rides the existing `scale` column, whose meaning stays "hexes across".** The official scaled footprints are *cell counts* (Tiny/Small 1, Medium 2, Large 4, Huge 8, Gargantuan 16); `TokenGlyph` renders `radius = hexSize * 0.72 * scale`, i.e. `scale` is a span, so storing the raw cell count would draw a Gargantuan ship as a 23-hex-radius disc. `footprintScale(cells) = ceil(sqrt(cells))` converts area → span at spawn time (1, 1, 2, 2, 3, 4). Accepted wart: Medium and Large both land on span 2; the DM can override with the size select. The zod cap is still raised `3 → 16` so house-ruled spans and hand-set cell counts validate, and the existing radius formula is already linear in `scale`, so **no geometry rewrite is needed** — only the editor's option list and the validation cap.
5. **`unitsPerHex` wins; `ftPerHex` is NOT added.** Verified by reading `lib/hex.ts` and `SceneCanvas.tsx:468`: `GridConfig` already carries `unitsPerHex` + `unitLabel`, the ruler already computes `hexDistance(a, b) * g.unitsPerHex` and labels with `g.unitLabel`, and `GridCalibrator` already edits it. A second field would be a duplicate source of truth for the same number. Space mode therefore PATCHes `{ mode: 'space', grid: { …grid, unitsPerHex: 50 } }` in one write. A new tolerant reader `gridUnits(grid)` (default 5 ft) centralizes legacy/partial grid JSON and is reused by the ruler, the toolbar readout, and the new AoE size labels.
6. **Spawn-ship entry point is the map toolbar, not the DM screen.** The DM is already on the map when placing ships, `POST /swdnd/scenes/{id}/tokens` needs the active scene id, and the toolbar already hosts the ad-hoc token input. A new `ShipSpawner` panel lists campaign ships; the DM screen keeps its current surface (sub-project 4 owns the stock-ship browser).

## Global Constraints

- **Existing tests stay green.** Baseline at plan time: `bun test` → 329 pass / 0 fail across 54 files (sub-projects 1–2 will raise this; whatever the count is when you start, it must not drop).
- **Tolerant parsing of legacy scene / initiative / grid JSON.** Pre-migration scenes have no `mode`, pre-space grids may lack `unitsPerHex`, and pre-grouping initiative entries have no `crew` — every reader defaults instead of throwing.
- **DM-only scene PATCH is preserved.** Do NOT add `/swdnd/scenes` to `selfGated()` in `apps/backend/src/routes/swdnd/index.ts`; scene mode/grid/initiative writes stay behind the blanket admin gate.
- **Timestamps are ISO 8601 UTC strings** (`new Date().toISOString()`) on every row touched.

## Verified facts (read before implementing)

- **Build/typecheck:** `cd apps/swdnd && bun run build` (tsc `-b`, `noUnusedLocals`/`noUnusedParameters`; NEVER `bun --cwd`). `bun test` does not typecheck. Test files are excluded from `tsconfig.app.json`, so casts in tests are free.
- **Root `bun test` is safe now** — `apps/backend/src/db/swdnd/index.ts` routes to a temp DB when `NODE_ENV === 'test'` (commit 8f50deb). Scoping to file paths is still faster.
- **`ALTER TABLE … ADD COLUMN … REFERENCES … ON DELETE CASCADE` works in bun:sqlite** and the cascade fires (verified experimentally against `PRAGMA foreign_keys = ON`; SQLite requires the added column's default to be NULL, which it is).
- **Migrations run inside a transaction** keyed by `schema_migrations.version` (`apps/backend/src/db/runner.ts`), file list in `apps/backend/src/db/swdnd/index.ts`.
- **`/swdnd/tokens` is `selfGated`** (so the position route reaches its own check) but `patchRoute`/`deleteRoute` call `assertAdmin(c)` in-handler. Token **create** is NOT selfGated → spawning is DM-only, as intended.
- **Commit discipline:** `git add` explicit paths only, never `-A`.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `apps/backend/src/db/migrations/swdnd/007_swdnd_space_scenes.sql` | create | `scene.mode`, `token.ship_id`, `token.facing`, ship index |
| `apps/backend/src/db/swdnd/index.ts` | modify | register migration 007 |
| `apps/backend/src/routes/swdnd/scenes.ts` | modify | `mode` in row/schema/PATCH; `crew` in the initiative schema |
| `apps/backend/src/routes/swdnd/scenes.test.ts` | modify | mode defaults/flip/reject; grouped initiative round-trip |
| `apps/backend/src/routes/swdnd/tokens.ts` | modify | `ship_id` + `facing` columns, scale cap, rotate-via-position |
| `apps/backend/src/routes/swdnd/tokens.test.ts` | modify | ship token create/rotate/cascade/scale-cap + crew move |
| `apps/backend/src/routes/swdnd/access.ts` | modify | crew-aware `assertTokenMoveAccess`, `playerCrewsShip` |
| `apps/backend/src/routes/swdnd/access.test.ts` | modify | crew access matrix |
| `apps/swdnd/src/lib/hex.ts` | modify | `gridUnits`, `hexesToUnits` |
| `apps/swdnd/src/lib/hex.test.ts` | modify | unit-scale tests |
| `apps/swdnd/src/lib/shipTokens.ts` | create | space vocabulary, footprint scale, facing math |
| `apps/swdnd/src/lib/shipTokens.test.ts` | create | ” |
| `apps/swdnd/src/lib/shipVitals.ts` | create | hull/shield/condition vitals for ship tokens |
| `apps/swdnd/src/lib/shipVitals.test.ts` | create | ” |
| `apps/swdnd/src/lib/shipPlay.ts` | create | pure edits to a ship's play document |
| `apps/swdnd/src/lib/shipPlay.test.ts` | create | ” |
| `apps/swdnd/src/lib/initiative.ts` | modify | `crew?`, `parseInitiative`, `groupCrew`, `ungroupCrew` |
| `apps/swdnd/src/lib/initiative.test.ts` | modify | ” |
| `apps/swdnd/src/lib/scenes.ts` | modify | DTO fields + `rotateToken` |
| `apps/swdnd/src/lib/visibility.ts` | modify | own-ship visibility, `isOwnToken` |
| `apps/swdnd/src/lib/visibility.test.ts` | modify | ” |
| `apps/swdnd/src/hooks/useTabletop.ts` | modify | ship load/merge, crew `canMove`, new actions |
| `apps/swdnd/src/panels/Tabletop/TokenGlyph.tsx` | modify | shields-over-hull rings, bow marker, rotate handles |
| `apps/swdnd/src/panels/Tabletop/SceneCanvas.tsx` | modify | ship vitals, rotate hit-test, unit-aware ruler |
| `apps/swdnd/src/panels/Tabletop/ShipSpawner.tsx` | create | DM ship list → spawn token |
| `apps/swdnd/src/panels/Tabletop/ShipConditionsMenu.tsx` | create | space conditions + system-damage stepper |
| `apps/swdnd/src/panels/Tabletop/TokenEditor.tsx` | modify | wider size options |
| `apps/swdnd/src/panels/Tabletop/InitiativeEditor.tsx` | modify | group/ungroup crew |
| `apps/swdnd/src/panels/Tabletop/InitiativeStrip.tsx` | modify | crew names inside the ship slot |
| `apps/swdnd/src/panels/Tabletop/index.tsx` | modify | space toggle, spawner, ship context menu, wiring |

Execution order: Tasks 1–3 (backend) → 4–6 (pure frontend) → 7–8 (client plumbing) → 9–11 (UI) → 12 (verification).

## Explicitly OUT of scope

State these as non-goals if asked to "finish" them:

- **Movement validation / turn-cost enforcement** — no speed budget, no turn-cost-per-facing-change accounting. Honor system, exactly like ground movement today.
- **Firing-arc overlays** — the existing cone templates (`hexWedge`, 60° wedges aligned to the same `AXIAL_DIRS` as facing) are the arc tool. No auto-drawn per-mount arcs.
- **Line of sight / walls / blockers.**
- **Bomb (or any template) auto-advance** between turns.
- **Scale conversion ×10 / ÷10** between ground and space scenes — the DM re-calibrates the grid; tokens are not rescaled.
- **Server-side fog filtering** — the client-side trust model of `lib/visibility.ts` is unchanged.

---

### Task 1: migration 007 + scene `mode`

**Files:**
- Create: `apps/backend/src/db/migrations/swdnd/007_swdnd_space_scenes.sql`
- Modify: `apps/backend/src/db/swdnd/index.ts`
- Modify: `apps/backend/src/routes/swdnd/scenes.ts`
- Modify: `apps/backend/src/routes/swdnd/scenes.test.ts`

**Interfaces:**

*Consumes:* `starship(id …)` table from migration `006_swdnd_starships.sql` (sub-project 1) — referenced by the `token.ship_id` FK added in the same migration file. `runMigrations(db, migrations, dir)` from `apps/backend/src/db/runner.ts`.

*Produces:*
- SQL: `scene.mode TEXT NOT NULL DEFAULT 'ground'`, `token.ship_id TEXT NULL REFERENCES starship(id) ON DELETE CASCADE`, `token.facing INTEGER NOT NULL DEFAULT 0`, `INDEX idx_token_ship(token.ship_id)`.
- `interface SceneRow` gains `mode: string`.
- `sceneOut(row: SceneRow): { …row; grid_json: object; fog_json: string[]; initiative_json: unknown | null; mode: 'ground' | 'space' }` (exported, existing symbol — return type widened).
- Zod `Scene` gains `mode: z.enum(['ground', 'space'])`; `PatchBody` gains `mode: z.enum(['ground', 'space']).optional()`.

- [ ] **Step 1: Write the failing tests.** Append to `apps/backend/src/routes/swdnd/scenes.test.ts`:

```ts
describe('space mode', () => {
  it('new scenes default to ground', async () => {
    const sc = await (await app.request(`/swdnd/campaigns/${campaignId}/scenes`, json('POST', { name: 'Ground' }))).json() as any;
    expect(sc.mode).toBe('ground');
  });

  it('one PATCH flips to space and recalibrates the grid to 50 ft/hex', async () => {
    const sc = await (await app.request(`/swdnd/campaigns/${campaignId}/scenes`, json('POST', { name: 'Void' }))).json() as any;
    const res = await app.request(`/swdnd/scenes/${sc.id}`, json('PATCH', {
      mode: 'space',
      grid: { orientation: 'pointy', hexSize: 32, originX: 0, originY: 0, unitsPerHex: 50, unitLabel: 'ft' },
    }));
    expect(res.status).toBe(200);
    const s = (await res.json()) as any;
    expect(s.mode).toBe('space');
    expect(s.grid_json.unitsPerHex).toBe(50);
  });

  it('a later PATCH that omits mode leaves it alone', async () => {
    const sc = await (await app.request(`/swdnd/campaigns/${campaignId}/scenes`, json('POST', { name: 'Void 2' }))).json() as any;
    await app.request(`/swdnd/scenes/${sc.id}`, json('PATCH', { mode: 'space' }));
    const again = await (await app.request(`/swdnd/scenes/${sc.id}`, json('PATCH', { name: 'Void 2 — Battle' }))).json() as any;
    expect(again.mode).toBe('space');
    expect(again.name).toBe('Void 2 — Battle');
  });

  it('rejects an unknown mode', async () => {
    const sc = await (await app.request(`/swdnd/campaigns/${campaignId}/scenes`, json('POST', { name: 'Bad mode' }))).json() as any;
    expect((await app.request(`/swdnd/scenes/${sc.id}`, json('PATCH', { mode: 'hyperspace' }))).status).toBe(400);
  });

  it('legacy rows with a NULL mode read back as ground', async () => {
    const sc = await (await app.request(`/swdnd/campaigns/${campaignId}/scenes`, json('POST', { name: 'Legacy' }))).json() as any;
    swdndDb.run('UPDATE scene SET mode = NULL WHERE id = ?', [sc.id]);
    const got = await (await app.request(`/swdnd/scenes/${sc.id}`)).json() as any;
    expect(got.mode).toBe('ground');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test apps/backend/src/routes/swdnd/scenes.test.ts` — FAIL (`expect(sc.mode).toBe('ground')` gets `undefined`; the mode PATCH 400s on an unknown key or silently drops it).

- [ ] **Step 3: Implement the migration.** Create `apps/backend/src/db/migrations/swdnd/007_swdnd_space_scenes.sql`:

```sql
-- Space encounters (sub-project 3): per-scene ground/space mode and ship-bound
-- tokens with a hex facing. `mode` drives UI affordances only — distance still
-- comes from grid_json.unitsPerHex (5 ft ground / 50 ft space).
ALTER TABLE scene ADD COLUMN mode TEXT NOT NULL DEFAULT 'ground';

-- Nullable, so SQLite accepts the REFERENCES clause on ADD COLUMN. Deleting a
-- starship removes its map tokens.
ALTER TABLE token ADD COLUMN ship_id TEXT REFERENCES starship(id) ON DELETE CASCADE;
-- 0-5, an index into the six axial hex directions (lib/hex.ts AXIAL_DIRS).
ALTER TABLE token ADD COLUMN facing INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_token_ship ON token(ship_id);
```

- [ ] **Step 4: Register it.** In `apps/backend/src/db/swdnd/index.ts`, extend `MIGRATIONS` (after the `006_swdnd_starships` entry added by sub-project 1):

```ts
  { version: '007_swdnd_space_scenes', file: '007_swdnd_space_scenes.sql' },
```

- [ ] **Step 5: Implement the scene route changes.** In `apps/backend/src/routes/swdnd/scenes.ts`:

Add `mode` to the response schema — inside the `Scene` object, after `grid_json`:

```ts
  mode: z.enum(['ground', 'space']),
```

Add `mode` to the row interface — inside `interface SceneRow`, after `grid_json`:

```ts
  mode: string;
```

Add `mode` to `PatchBody`:

```ts
const PatchBody = z.object({
  name: z.string().min(1).optional(),
  grid: Grid.optional(),
  mode: z.enum(['ground', 'space']).optional(),
  sort: z.number().optional(),
}).openapi('SwdndPatchScene');
```

Make `sceneOut` tolerant (legacy/NULL rows read as ground) — replace the body:

```ts
/** Parse a DB row's JSON columns into the API shape. */
export function sceneOut(row: SceneRow) {
  return {
    ...row,
    grid_json: JSON.parse(row.grid_json || '{}'),
    fog_json: JSON.parse(row.fog_json || '[]'),
    initiative_json: row.initiative_json ? JSON.parse(row.initiative_json) : null,
    // Pre-007 rows (and any hand-edited NULL) read as ground.
    mode: row.mode === 'space' ? ('space' as const) : ('ground' as const),
  };
}
```

Persist it in the PATCH handler — replace the `UPDATE scene SET …` call in `app.openapi(patchRoute, …)`:

```ts
    swdndDb.run(
      'UPDATE scene SET name = ?, grid_json = ?, mode = ?, sort = ?, updated_at = ? WHERE id = ?',
      [
        body.name ?? row.name,
        body.grid ? JSON.stringify(body.grid) : row.grid_json,
        body.mode ?? (row.mode === 'space' ? 'space' : 'ground'),
        body.sort ?? row.sort,
        now, id,
      ],
    );
```

(The `createSceneRoute` INSERT needs no change — the column default supplies `'ground'`.)

- [ ] **Step 6: Run to verify pass**

Run: `bun test apps/backend/src/routes/swdnd/scenes.test.ts` — all PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/db/migrations/swdnd/007_swdnd_space_scenes.sql apps/backend/src/db/swdnd/index.ts apps/backend/src/routes/swdnd/scenes.ts apps/backend/src/routes/swdnd/scenes.test.ts
git commit -m "feat(swdnd): scene ground/space mode + space-scene migration"
```

---

### Task 2: ship-bound tokens — `ship_id`, `facing`, wider `scale`

**Files:**
- Modify: `apps/backend/src/routes/swdnd/tokens.ts`
- Modify: `apps/backend/src/routes/swdnd/tokens.test.ts`

**Interfaces:**

*Consumes:* columns from Task 1's migration; `getSceneRow(id)` from `./scenes`; `assertAdmin(c)` / `assertTokenMoveAccess(c, token)` from `./access`; `publishToRoom` / `roomForCampaign` from `../../lib/swdnd-realtime`.

*Produces:*
- `interface TokenRow` gains `ship_id: string | null; facing: number`.
- Zod `Token` gains `ship_id: z.string().nullable()`, `facing: z.number()`.
- `PostBody` gains `ship_id: z.string().nullable().optional()`, `facing: z.number().int().min(0).max(5).optional()`; `scale` cap widened to `.max(16)`. `PatchBody` inherits both (it is `PostBody.partial().extend(…)`).
- `PositionBody` becomes `z.object({ q: z.number().int().optional(), r: z.number().int().optional(), facing: z.number().int().min(0).max(5).optional() })` — omitted fields keep their stored value, so a pure rotation cannot rewrite position from a stale client copy.
- `tokenOut(row)` (existing) now carries `ship_id` and `facing` by row spread; no signature change.

- [ ] **Step 1: Write the failing tests.** Append to `apps/backend/src/routes/swdnd/tokens.test.ts` (before the trailing `afterAll`):

```ts
describe('ship tokens', () => {
  let shipId: string;
  let shipTokenId: string;

  beforeAll(() => {
    shipId = crypto.randomUUID();
    const now = new Date().toISOString();
    swdndDb.run(
      'INSERT INTO starship (id, campaign_id, name, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [shipId, campaignId, 'Krayt', '{}', now, now],
    );
  });

  it('creates a ship token with ship_id, facing and a multi-hex footprint', async () => {
    const res = await app.request(`/swdnd/scenes/${sceneId}/tokens`, json('POST', {
      name: 'Krayt', ship_id: shipId, faction: 'friendly', scale: 4, facing: 2, q: 3, r: -1,
    }));
    expect(res.status).toBe(201);
    const t = (await res.json()) as any;
    shipTokenId = t.id;
    expect(t.ship_id).toBe(shipId);
    expect(t.facing).toBe(2);
    expect(t.scale).toBe(4);
  });

  it('plain tokens report ship_id null and facing 0', async () => {
    const t = (await (await app.request(`/swdnd/scenes/${sceneId}/tokens`, json('POST', { name: 'Rock' }))).json()) as any;
    expect(t.ship_id).toBeNull();
    expect(t.facing).toBe(0);
  });

  it('position PATCH rotates without moving, and moves without resetting facing', async () => {
    let res = await app.request(`/swdnd/tokens/${shipTokenId}/position`, json('PATCH', { facing: 5 }));
    expect(res.status).toBe(200);
    let t = (await res.json()) as any;
    expect(t.facing).toBe(5);
    expect(t.q).toBe(3);
    expect(t.r).toBe(-1);

    res = await app.request(`/swdnd/tokens/${shipTokenId}/position`, json('PATCH', { q: 0, r: 0 }));
    t = (await res.json()) as any;
    expect(t.q).toBe(0);
    expect(t.facing).toBe(5);
  });

  it('rejects out-of-range facing and scale', async () => {
    expect((await app.request(`/swdnd/tokens/${shipTokenId}/position`, json('PATCH', { facing: 6 }))).status).toBe(400);
    expect((await app.request(`/swdnd/scenes/${sceneId}/tokens`, json('POST', { name: 'Too big', scale: 17 }))).status).toBe(400);
    expect((await app.request(`/swdnd/scenes/${sceneId}/tokens`, json('POST', { name: 'Gargantuan', scale: 16 }))).status).toBe(201);
  });

  it('deleting the starship cascades its tokens away', async () => {
    const doomedShip = crypto.randomUUID();
    const now = new Date().toISOString();
    swdndDb.run(
      'INSERT INTO starship (id, campaign_id, name, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [doomedShip, campaignId, 'Doomed', '{}', now, now],
    );
    const t = (await (await app.request(`/swdnd/scenes/${sceneId}/tokens`, json('POST', { name: 'Doomed', ship_id: doomedShip }))).json()) as any;
    swdndDb.run('DELETE FROM starship WHERE id = ?', [doomedShip]);
    const list = (await (await app.request(`/swdnd/scenes/${sceneId}/tokens`)).json()) as any[];
    expect(list.map((x) => x.id)).not.toContain(t.id);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test apps/backend/src/routes/swdnd/tokens.test.ts` — FAIL (`ship_id` is stripped by zod, `facing` undefined, `scale: 16` 400s).

- [ ] **Step 3: Implement.** In `apps/backend/src/routes/swdnd/tokens.ts`:

Response schema — inside `const Token = z.object({ … })`, after `character_id`:

```ts
  ship_id: z.string().nullable(),
```

and after `scale`:

```ts
  facing: z.number(),
```

Row interface — replace `interface TokenRow`:

```ts
interface TokenRow {
  id: string; scene_id: string; character_id: string | null; ship_id: string | null;
  name: string; color: string; faction: string; q: number; r: number; scale: number;
  facing: number; hp: number | null; max_hp: number | null;
  conditions_json: string; hidden: number; image_path: string | null; created_at: string; updated_at: string;
}
```

Request bodies — replace `PostBody` and `PositionBody`:

```ts
const PostBody = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
  faction: z.enum(['friendly', 'hostile', 'neutral']).optional(),
  character_id: z.string().nullable().optional(),
  /** Binds this token's vitals to a starship (hull/shields/conditions live on the ship). */
  ship_id: z.string().nullable().optional(),
  q: z.number().int().optional(),
  r: z.number().int().optional(),
  /** Hexes across. Ship footprints convert cells → span client-side (footprintScale). */
  scale: z.number().int().min(1).max(16).optional(),
  /** 0-5: index into the six axial hex directions. */
  facing: z.number().int().min(0).max(5).optional(),
  hp: z.number().nullable().optional(),
  max_hp: z.number().nullable().optional(),
}).openapi('SwdndPostToken');
```

```ts
/** Move and/or rotate. Omitted fields keep their stored value, so a pure
 *  rotation can't rewrite position from a stale client copy. */
const PositionBody = z.object({
  q: z.number().int().optional(),
  r: z.number().int().optional(),
  facing: z.number().int().min(0).max(5).optional(),
}).openapi('SwdndTokenPosition');
```

Route summary — in `positionRoute`, replace the `summary`:

```ts
  summary: 'Move or rotate a token (DM any; a player their own character’s or crewed ship’s token)',
```

Create handler — replace the `swdndDb.run(…)` INSERT inside `app.openapi(createTokenRoute, …)`:

```ts
    swdndDb.run(
      `INSERT INTO token (id, scene_id, character_id, ship_id, name, color, faction, q, r, scale, facing, hp, max_hp, conditions_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`,
      [id, sceneId, b.character_id ?? null, b.ship_id ?? null, b.name, b.color ?? '#4dd0e1', b.faction ?? 'friendly',
       b.q ?? 0, b.r ?? 0, b.scale ?? 1, b.facing ?? 0, b.hp ?? null, b.max_hp ?? null, now, now],
    );
```

Patch handler — replace the `swdndDb.run(…)` UPDATE inside `app.openapi(patchRoute, …)`:

```ts
    swdndDb.run(
      `UPDATE token SET name = ?, color = ?, faction = ?, character_id = ?, ship_id = ?, q = ?, r = ?, scale = ?,
         facing = ?, hp = ?, max_hp = ?, conditions_json = ?, hidden = ?, updated_at = ? WHERE id = ?`,
      [b.name ?? row.name, b.color ?? row.color, b.faction ?? row.faction,
       b.character_id === undefined ? row.character_id : b.character_id,
       b.ship_id === undefined ? row.ship_id : b.ship_id,
       b.q ?? row.q, b.r ?? row.r, b.scale ?? row.scale, b.facing ?? row.facing,
       b.hp === undefined ? row.hp : b.hp, b.max_hp === undefined ? row.max_hp : b.max_hp,
       b.conditions ? JSON.stringify(b.conditions) : row.conditions_json,
       b.hidden ?? row.hidden, now, id],
    );
```

Position handler — replace the body of `app.openapi(positionRoute, …)` after `assertTokenMoveAccess`:

```ts
    const { q, r, facing } = c.req.valid('json');
    const now = new Date().toISOString();
    swdndDb.run(
      'UPDATE token SET q = ?, r = ?, facing = ?, updated_at = ? WHERE id = ?',
      [q ?? row.q, r ?? row.r, facing ?? row.facing, now, id],
    );
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test apps/backend/src/routes/swdnd/tokens.test.ts` — all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/routes/swdnd/tokens.ts apps/backend/src/routes/swdnd/tokens.test.ts
git commit -m "feat(swdnd): ship-bound tokens with facing and multi-hex footprints"
```

---

### Task 3: crew-aware token move access

**Files:**
- Modify: `apps/backend/src/routes/swdnd/access.ts`
- Modify: `apps/backend/src/routes/swdnd/access.test.ts`
- Modify: `apps/backend/src/routes/swdnd/tokens.test.ts`

**Interfaces:**

*Consumes:* `starship_crew(ship_id, character_id, role)` with `PRIMARY KEY (ship_id, character_id, role)` (sub-project 1) — the PK's leading `ship_id` column makes the crew lookup an index scan; `character.player_id`; `resolvePlayerByToken`, `playerTokenFrom`, `isAdmin` (module-private) already in `access.ts`; **`playerCrewsShip(playerId, shipId): boolean` — already exported from `access.ts` by sub-project 1** (its `assertShipWriteAccess` is built on it). This task reuses it and must NOT re-declare it.

*Produces:*
- `export function assertTokenMoveAccess(c: Context, token: { character_id: string | null; ship_id?: string | null }): void` — widened parameter type; throws `HTTPException(403)` otherwise. Dev mode (no `ASHERCARLOW_AUTH_TOKEN`) and admin still short-circuit.

- [ ] **Step 1: Write the failing tests.** Append to `apps/backend/src/routes/swdnd/access.test.ts`:

```ts
describe('assertTokenMoveAccess — ship crew', () => {
  beforeAll(() => {
    const now = new Date().toISOString();
    dbMod.swdndDb.run('INSERT OR REPLACE INTO campaign (id,name,created_at,updated_at) VALUES (?,?,?,?)', ['c-ship', 'Ships', now, now]);
    dbMod.swdndDb.run('INSERT OR REPLACE INTO player (id,campaign_id,name,access_token,created_at) VALUES (?,?,?,?,?)', ['pl-crew', 'c-ship', 'Crew', 'tok-crew', now]);
    dbMod.swdndDb.run('INSERT OR REPLACE INTO player (id,campaign_id,name,access_token,created_at) VALUES (?,?,?,?,?)', ['pl-out', 'c-ship', 'Outsider', 'tok-out', now]);
    dbMod.swdndDb.run(
      'INSERT OR REPLACE INTO character (id,campaign_id,player_id,name,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
      ['ch-crew', 'c-ship', 'pl-crew', 'Pilot', '{}', now, now],
    );
    dbMod.swdndDb.run(
      'INSERT OR REPLACE INTO starship (id,campaign_id,name,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?)',
      ['sh-1', 'c-ship', 'Krayt', '{}', now, now],
    );
    dbMod.swdndDb.run('INSERT OR REPLACE INTO starship_crew (ship_id,character_id,role) VALUES (?,?,?)', ['sh-1', 'ch-crew', 'pilot']);
  });

  // playerCrewsShip itself ships with sub-project 1; this re-checks it against
  // this describe's fixtures because assertTokenMoveAccess now leans on it.
  it('playerCrewsShip is true only for a player owning a crew character', () => {
    expect(mod.playerCrewsShip('pl-crew', 'sh-1')).toBe(true);
    expect(mod.playerCrewsShip('pl-out', 'sh-1')).toBe(false);
    expect(mod.playerCrewsShip('pl-crew', 'sh-nope')).toBe(false);
  });

  it('a crew member may move the ship token; a non-crew player may not', () => {
    process.env.ASHERCARLOW_AUTH_TOKEN = 'admin-secret';
    try {
      const shipToken = { character_id: null, ship_id: 'sh-1' };
      expect(() => mod.assertTokenMoveAccess(reqWith({ 'x-player-token': 'tok-crew' }), shipToken)).not.toThrow();
      expect(() => mod.assertTokenMoveAccess(reqWith({ 'x-player-token': 'tok-out' }), shipToken)).toThrow();
      expect(() => mod.assertTokenMoveAccess(reqWith({}), shipToken)).toThrow();
      expect(() => mod.assertTokenMoveAccess(reqWith({ authorization: 'Bearer admin-secret' }), shipToken)).not.toThrow();
    } finally { delete process.env.ASHERCARLOW_AUTH_TOKEN; }
  });

  it('character ownership still works, and a plain token stays locked', () => {
    process.env.ASHERCARLOW_AUTH_TOKEN = 'admin-secret';
    try {
      expect(() => mod.assertTokenMoveAccess(reqWith({ 'x-player-token': 'tok-crew' }), { character_id: 'ch-crew', ship_id: null })).not.toThrow();
      expect(() => mod.assertTokenMoveAccess(reqWith({ 'x-player-token': 'tok-crew' }), { character_id: null, ship_id: null })).toThrow();
    } finally { delete process.env.ASHERCARLOW_AUTH_TOKEN; }
  });
});
```

Also append an end-to-end case to `apps/backend/src/routes/swdnd/tokens.test.ts`, inside the existing `describe('ship tokens', …)` block (it reuses `playerToken` / `otherToken` / `withAuthEnv` already defined in that file):

```ts
  it('a crewing player may move the ship token over HTTP; a stranger 403s', async () => {
    const charId = ((await (await app.request(`/swdnd/campaigns/${campaignId}/characters`)).json()) as any[])[0].id;
    swdndDb.run('INSERT OR REPLACE INTO starship_crew (ship_id, character_id, role) VALUES (?, ?, ?)', [shipId, charId, 'pilot']);
    await withAuthEnv(async () => {
      const ok = await app.request(`/swdnd/tokens/${shipTokenId}/position`, json('PATCH', { q: 2, r: 2 }, { 'X-Player-Token': playerToken }));
      expect(ok.status).toBe(200);
      const nope = await app.request(`/swdnd/tokens/${shipTokenId}/position`, json('PATCH', { q: 4, r: 4 }, { 'X-Player-Token': otherToken }));
      expect(nope.status).toBe(403);
    });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test apps/backend/src/routes/swdnd/access.test.ts apps/backend/src/routes/swdnd/tokens.test.ts` — FAIL (the ship-token move 403s; `assertTokenMoveAccess` still takes a `character_id`-only token).

- [ ] **Step 3: Implement.** In `apps/backend/src/routes/swdnd/access.ts`, replace `assertTokenMoveAccess` with the version below. `playerCrewsShip` already lives in this file (sub-project 1) — reuse it, do not add a second copy:

```ts
/**
 * Throw 403 unless the requester may move this token: dev mode, the admin, the
 * player owning the token's linked character, or — for a ship token — a player
 * with any of their characters on that ship's crew (crew flies the ship).
 */
export function assertTokenMoveAccess(
  c: Context,
  token: { character_id: string | null; ship_id?: string | null },
): void {
  if (!process.env.ASHERCARLOW_AUTH_TOKEN) return; // dev mode
  if (isAdmin(c)) return;
  const player = resolvePlayerByToken(playerTokenFrom(c));
  if (player) {
    if (token.character_id) {
      const owner = swdndDb
        .query<{ player_id: string | null }, [string]>('SELECT player_id FROM character WHERE id = ?')
        .get(token.character_id);
      if (owner?.player_id && owner.player_id === player.id) return;
    }
    if (token.ship_id && playerCrewsShip(player.id, token.ship_id)) return;
  }
  throw new HTTPException(403, { message: 'Not allowed to move this token' });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test apps/backend/src/routes/swdnd/access.test.ts apps/backend/src/routes/swdnd/tokens.test.ts` — all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/routes/swdnd/access.ts apps/backend/src/routes/swdnd/access.test.ts apps/backend/src/routes/swdnd/tokens.test.ts
git commit -m "feat(swdnd): crew members may move their ship's token"
```

---

### Task 4: pure grid units + ship-token math

**Files:**
- Modify: `apps/swdnd/src/lib/hex.ts`
- Modify: `apps/swdnd/src/lib/hex.test.ts`
- Create: `apps/swdnd/src/lib/shipTokens.ts`
- Create: `apps/swdnd/src/lib/shipTokens.test.ts`

**Interfaces:**

*Consumes:* `GridConfig`, `Hex`, `AXIAL_DIRS`, `hexToPixel`, `hexDistance` from `apps/swdnd/src/lib/hex.ts`; **`shipConditionOptions()` and `MAX_SYSTEM_DAMAGE` from `apps/swdnd/src/lib/shipRules/constants.ts`** (sub-project 1 owns the ship condition vocabulary — see below).

*Produces:*
- `export function gridUnits(cfg: Pick<GridConfig, 'unitsPerHex' | 'unitLabel'> | null | undefined): { per: number; label: string }` — tolerant reader, defaults `{ per: 5, label: 'ft' }`.
- `export function hexesToUnits(hexes: number, cfg: Pick<GridConfig, 'unitsPerHex' | 'unitLabel'> | null | undefined): number`.
- `export const SHIP_CONDITIONS: readonly string[]` — **not a new list**: `shipConditionOptions()` from the spine's `shipRules/constants.ts`, i.e. `['Ionized','Shocked','Slowed 1','Slowed 2','Slowed 3','Slowed 4','Stalled','Tractored']` (plain conditions plus the levelled Slowed 1–4, alphabetically sorted). The ShipSheet's conditions menu writes exactly these strings into `ShipPlayState.conditions`, and the map writes to the same array — a second lowercase vocabulary here would silently produce two spellings of the same condition on one ship.
- `export type ShipCondition = string` — the vocabulary is a runtime list on the spine side, so no literal union.
- `export { MAX_SYSTEM_DAMAGE }` — re-exported from `shipRules/constants.ts` so map modules keep one import surface without a second `= 6` to drift.
- `export const SHIP_SIZE_CELLS: Record<string, number>` — official scaled footprints in cells.
- `export function shipSizeCells(size: string | null | undefined): number` — case/space tolerant, unknown → 2.
- `export function footprintScale(cells: number): number` — `ceil(sqrt(cells))`, min 1.
- `export function shipTokenScale(size: string | null | undefined): number` — `footprintScale(shipSizeCells(size))`.
- `export function normalizeFacing(facing: number): number` — into 0–5.
- `export function rotateFacing(facing: number, delta: number): number`.
- `export function facingAngle(facing: number, cfg: GridConfig): number` — screen degrees in `[0, 360)`, 0 = +x (east), clockwise (SVG y-down).

- [ ] **Step 1: Write the failing tests.** Append to `apps/swdnd/src/lib/hex.test.ts`:

```ts
test('gridUnits reads calibration and defaults tolerantly', () => {
  expect(gridUnits({ unitsPerHex: 50, unitLabel: 'ft' })).toEqual({ per: 50, label: 'ft' });
  expect(gridUnits(null)).toEqual({ per: 5, label: 'ft' });
  expect(gridUnits(undefined)).toEqual({ per: 5, label: 'ft' });
  // legacy / hand-edited grid JSON
  expect(gridUnits({ unitsPerHex: 0, unitLabel: '' } as any)).toEqual({ per: 5, label: 'ft' });
  expect(gridUnits({ unitsPerHex: Number.NaN, unitLabel: 'm' } as any)).toEqual({ per: 5, label: 'm' });
});

test('hexesToUnits scales hex distance into grid units', () => {
  expect(hexesToUnits(3, { unitsPerHex: 50, unitLabel: 'ft' })).toBe(150);
  expect(hexesToUnits(3, undefined)).toBe(15);
});
```

and extend that file's import list with `gridUnits, hexesToUnits`.

Create `apps/swdnd/src/lib/shipTokens.test.ts`:

```ts
// apps/swdnd/src/lib/shipTokens.test.ts
import { describe, expect, test } from 'bun:test';
import type { GridConfig } from './hex';
import {
  MAX_SYSTEM_DAMAGE, SHIP_CONDITIONS, facingAngle, footprintScale, normalizeFacing,
  rotateFacing, shipSizeCells, shipTokenScale,
} from './shipTokens';
import { shipConditionOptions } from './shipRules/constants';

const pointy: GridConfig = { orientation: 'pointy', hexSize: 32, originX: 120, originY: -40, unitsPerHex: 50, unitLabel: 'ft' };
const flat: GridConfig = { ...pointy, orientation: 'flat' };

describe('space vocabulary', () => {
  test('the condition list is the spine engine list, not a second vocabulary', () => {
    // Same strings the ShipSheet conditions menu writes into ShipPlayState.conditions.
    expect([...SHIP_CONDITIONS]).toEqual(shipConditionOptions());
    expect([...SHIP_CONDITIONS]).toEqual([
      'Ionized', 'Shocked', 'Slowed 1', 'Slowed 2', 'Slowed 3', 'Slowed 4', 'Stalled', 'Tractored',
    ]);
    expect(MAX_SYSTEM_DAMAGE).toBe(6);
  });
});

describe('footprints', () => {
  test('official scaled footprints, in cells', () => {
    expect(shipSizeCells('tiny')).toBe(1);
    expect(shipSizeCells('small')).toBe(1);
    expect(shipSizeCells('medium')).toBe(2);
    expect(shipSizeCells('large')).toBe(4);
    expect(shipSizeCells('huge')).toBe(8);
    expect(shipSizeCells('gargantuan')).toBe(16);
  });

  test('size lookup is case/space tolerant and defaults to medium', () => {
    expect(shipSizeCells('  Large ')).toBe(4);
    expect(shipSizeCells('GARGANTUAN')).toBe(16);
    expect(shipSizeCells(undefined)).toBe(2);
    expect(shipSizeCells('colossal')).toBe(2);
  });

  test('footprintScale converts a cell count to hexes across', () => {
    expect(footprintScale(1)).toBe(1);
    expect(footprintScale(2)).toBe(2);
    expect(footprintScale(4)).toBe(2);
    expect(footprintScale(8)).toBe(3);
    expect(footprintScale(16)).toBe(4);
    expect(footprintScale(0)).toBe(1);
    expect(footprintScale(Number.NaN)).toBe(1);
  });

  test('shipTokenScale composes the two', () => {
    expect(shipTokenScale('small')).toBe(1);
    expect(shipTokenScale('huge')).toBe(3);
    expect(shipTokenScale(null)).toBe(2);
  });
});

describe('facing', () => {
  test('normalizeFacing wraps in both directions', () => {
    expect(normalizeFacing(0)).toBe(0);
    expect(normalizeFacing(6)).toBe(0);
    expect(normalizeFacing(7)).toBe(1);
    expect(normalizeFacing(-1)).toBe(5);
    expect(normalizeFacing(-7)).toBe(5);
    expect(normalizeFacing(2.7)).toBe(2);
  });

  test('rotateFacing steps 60° at a time', () => {
    expect(rotateFacing(0, 1)).toBe(1);
    expect(rotateFacing(5, 1)).toBe(0);
    expect(rotateFacing(0, -1)).toBe(5);
    expect(rotateFacing(3, 3)).toBe(0);
  });

  test('facingAngle matches the pointy-top neighbor geometry (0 = east, clockwise)', () => {
    expect(facingAngle(0, pointy)).toBeCloseTo(0);
    expect(facingAngle(1, pointy)).toBeCloseTo(300);
    expect(facingAngle(2, pointy)).toBeCloseTo(240);
    expect(facingAngle(3, pointy)).toBeCloseTo(180);
    expect(facingAngle(4, pointy)).toBeCloseTo(120);
    expect(facingAngle(5, pointy)).toBeCloseTo(60);
  });

  test('flat-top grids are rotated 30°, and the origin offset is irrelevant', () => {
    expect(facingAngle(0, flat)).toBeCloseTo(30);
    expect(facingAngle(1, flat)).toBeCloseTo(330);
    expect(facingAngle(3, flat)).toBeCloseTo(210);
    expect(facingAngle(0, { ...pointy, originX: 0, originY: 0 })).toBeCloseTo(facingAngle(0, pointy));
  });

  test('out-of-range facings normalize rather than throw', () => {
    expect(facingAngle(6, pointy)).toBeCloseTo(0);
    expect(facingAngle(-1, pointy)).toBeCloseTo(60);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test apps/swdnd/src/lib/hex.test.ts apps/swdnd/src/lib/shipTokens.test.ts` — FAIL (`gridUnits` is not exported; `./shipTokens` module missing).

- [ ] **Step 3: Implement `gridUnits` / `hexesToUnits`.** Append to `apps/swdnd/src/lib/hex.ts`:

```ts
/**
 * Distance calibration for a grid, tolerant of legacy or partial grid JSON.
 * `unitsPerHex` is the single source of truth for scale: 5 ft/hex on ground
 * scenes, 50 ft/hex in space (the SOTG grid variant). There is deliberately no
 * separate ftPerHex field.
 */
export function gridUnits(
  cfg: Pick<GridConfig, 'unitsPerHex' | 'unitLabel'> | null | undefined,
): { per: number; label: string } {
  const raw = cfg?.unitsPerHex;
  const per = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 5;
  const label = typeof cfg?.unitLabel === 'string' && cfg.unitLabel ? cfg.unitLabel : 'ft';
  return { per, label };
}

/** Hex count → grid units (e.g. 3 hexes at 50 ft/hex = 150). */
export const hexesToUnits = (
  hexes: number,
  cfg: Pick<GridConfig, 'unitsPerHex' | 'unitLabel'> | null | undefined,
): number => hexes * gridUnits(cfg).per;
```

- [ ] **Step 4: Implement `lib/shipTokens.ts`.** Create:

```ts
// apps/swdnd/src/lib/shipTokens.ts — pure ship-token rules: footprint sizing and
// hex facing, plus the map's import surface for the ship condition vocabulary.
// No React, no IO.
import { AXIAL_DIRS, hexToPixel, type GridConfig } from './hex';
import { shipConditionOptions } from './shipRules/constants';

/**
 * The SOTG space conditions, taken from the spine's engine constants rather than
 * redeclared: plain conditions plus the levelled 'Slowed 1'…'Slowed 4'. Both the
 * ShipSheet menu and the map's right-click menu write into the same
 * ShipPlayState.conditions array, so they must offer identical strings.
 */
export const SHIP_CONDITIONS: readonly string[] = shipConditionOptions();
export type ShipCondition = string;

/** System damage is a 0-6 counter on the ship, not a condition string. */
export { MAX_SYSTEM_DAMAGE } from './shipRules/constants';

/** Official scaled footprints, in grid cells, keyed by chassis size. */
export const SHIP_SIZE_CELLS: Record<string, number> = {
  tiny: 1, small: 1, medium: 2, large: 4, huge: 8, gargantuan: 16,
};

/** Cells for a chassis size string; unknown/missing sizes fall back to medium. */
export function shipSizeCells(size: string | null | undefined): number {
  const key = String(size ?? '').trim().toLowerCase();
  return SHIP_SIZE_CELLS[key] ?? SHIP_SIZE_CELLS.medium;
}

/**
 * Cells (an area) → token `scale` (hexes across), because TokenGlyph draws
 * radius = hexSize * 0.72 * scale. Storing the raw cell count would render a
 * Gargantuan ship as a 23-hex-radius disc.
 */
export const footprintScale = (cells: number): number =>
  (Number.isFinite(cells) && cells > 0 ? Math.max(1, Math.ceil(Math.sqrt(cells))) : 1);

/** The token `scale` a ship of this chassis size should spawn with. */
export const shipTokenScale = (size: string | null | undefined): number =>
  footprintScale(shipSizeCells(size));

/** Any integer (or junk) → a facing in 0-5. */
export function normalizeFacing(facing: number): number {
  const n = Number.isFinite(facing) ? Math.trunc(facing) : 0;
  return ((n % 6) + 6) % 6;
}

/** Rotate by whole 60° steps. */
export const rotateFacing = (facing: number, delta: number): number =>
  normalizeFacing(normalizeFacing(facing) + Math.trunc(delta));

/**
 * Screen angle of a facing, in degrees within [0, 360): 0 = +x (east),
 * increasing clockwise (SVG y-down). Derived from the grid's own neighbor
 * geometry so it can never drift from hexToPixel or the orientation setting.
 */
export function facingAngle(facing: number, cfg: GridConfig): number {
  const dir = AXIAL_DIRS[normalizeFacing(facing)];
  const p = hexToPixel(dir, { ...cfg, originX: 0, originY: 0 });
  const deg = (Math.atan2(p.y, p.x) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `bun test apps/swdnd/src/lib/hex.test.ts apps/swdnd/src/lib/shipTokens.test.ts` — all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/swdnd/src/lib/hex.ts apps/swdnd/src/lib/hex.test.ts apps/swdnd/src/lib/shipTokens.ts apps/swdnd/src/lib/shipTokens.test.ts
git commit -m "feat(swdnd): pure grid-unit reader and ship-token facing/footprint math"
```

---

### Task 5: ship vitals + ship play-document edits (pure)

**Files:**
- Create: `apps/swdnd/src/lib/shipVitals.ts`
- Create: `apps/swdnd/src/lib/shipVitals.test.ts`
- Create: `apps/swdnd/src/lib/shipPlay.ts`
- Create: `apps/swdnd/src/lib/shipPlay.test.ts`

**Interfaces:**

*Consumes:* `TokenDto` from `./scenes` (gains `ship_id` in Task 7 — this task only reads `token.ship_id`, so land Task 7's DTO change first if `tsc` complains; `bun test` does not typecheck). `MAX_SYSTEM_DAMAGE` from `./shipTokens`; `LEVELED_SHIP_CONDITIONS` from `./shipRules/constants` (a leaf constants module — which conditions carry a level is the spine's data, and both write paths must agree on it). **Deliberately not** `computeShip` — maxima are injected, so these modules never depend on sub-project 1's engine shape or its reference data.

*Produces (shipVitals.ts):*
- `export interface ShipPlayLike { hull: number; shields: number; conditions: string[]; systemDamage: number }` — structural subset of `ShipPlayState`.
- `export interface ShipVitals { hull: number; maxHull: number; shields: number; maxShields: number; conditions: string[]; systemDamage: number }`.
- `export interface ShipSource { id: string; data_json: { play: ShipPlayLike } }` — structural subset of `StarshipDto`.
- `export type ShipMaxima = { maxHull: number; maxShields: number }`.
- `export type PendingShipPlays = Record<string, ShipPlayLike>`.
- `export function shipVitalsFrom(play: Partial<ShipPlayLike> | null | undefined, max: Partial<ShipMaxima> | null | undefined): ShipVitals`.
- `export function buildShipVitals<S extends ShipSource>(ships: S[], maxima: (ship: S) => ShipMaxima): Record<string, ShipVitals>`.
- `export function addShipVitals<S extends ShipSource>(vitals: Record<string, ShipVitals>, ship: S, maxima: (ship: S) => ShipMaxima): Record<string, ShipVitals>`.
- `export function mergeShipPlay(vitals: Record<string, ShipVitals>, shipId: string, play: Partial<ShipPlayLike>): Record<string, ShipVitals>`.
- `export function applyPendingShipPlays(vitals: Record<string, ShipVitals>, pending: PendingShipPlays): Record<string, ShipVitals>`.
- `export function tokenShipVitals(token: Pick<TokenDto, 'ship_id'>, vitals: Record<string, ShipVitals>): ShipVitals | null`.
- `export function crewedShipIds(ships: { id: string; crew?: { character_id: string }[] }[], ownCharacterIds: Set<string>): Set<string>`.
- `export function shipStatusNames(vitals: ShipVitals): string[]` — conditions plus a `sys N` chip when system damage > 0.

*Produces (shipPlay.ts):*
- `export interface ShipDocLike { play: { conditions?: string[]; systemDamage?: number; [k: string]: unknown }; [k: string]: unknown }`.
- `export function toggleShipCondition<T extends ShipDocLike>(doc: T, name: string): T` — **family-aware**, matching `addCondition` in the spine's `lib/shipPlayState.ts`: picking a levelled condition (`'Slowed 1'`…`'Slowed 4'`) evicts any other member of its family, picking the currently-active value clears it, and plain conditions toggle as before. The two write paths edit the same `ShipPlayState.conditions` array, so a ship can never end up with two Slowed levels depending on which UI set them.
- `export function setSystemDamage<T extends ShipDocLike>(doc: T, value: number): T` — clamped 0…`MAX_SYSTEM_DAMAGE`.

- [ ] **Step 1: Write the failing tests.** Create `apps/swdnd/src/lib/shipVitals.test.ts`:

```ts
// apps/swdnd/src/lib/shipVitals.test.ts
import { describe, expect, it } from 'bun:test';
import {
  addShipVitals, applyPendingShipPlays, buildShipVitals, crewedShipIds, mergeShipPlay,
  shipStatusNames, shipVitalsFrom, tokenShipVitals, type ShipSource, type ShipVitals,
} from './shipVitals';
import type { TokenDto } from './scenes';

const ship = (id: string, play: Record<string, unknown>): ShipSource =>
  ({ id, data_json: { play } } as unknown as ShipSource);

const maxima = () => ({ maxHull: 40, maxShields: 12 });

const token = (over: Partial<TokenDto>): TokenDto => ({
  id: 't1', scene_id: 's1', character_id: null, ship_id: null, name: 'X', color: '#fff',
  faction: 'friendly', q: 0, r: 0, scale: 1, facing: 0, hp: null, max_hp: null,
  conditions_json: [], hidden: 0, image_path: null, created_at: '', updated_at: '',
  ...over,
} as TokenDto);

describe('shipVitalsFrom', () => {
  it('reads a well-formed play document', () => {
    expect(shipVitalsFrom({ hull: 31, shields: 6, conditions: ['Ionized'], systemDamage: 2 }, { maxHull: 40, maxShields: 12 }))
      .toEqual({ hull: 31, maxHull: 40, shields: 6, maxShields: 12, conditions: ['Ionized'], systemDamage: 2 });
  });

  it('tolerates missing / junk fields on legacy documents', () => {
    expect(shipVitalsFrom(undefined, undefined))
      .toEqual({ hull: 0, maxHull: 0, shields: 0, maxShields: 0, conditions: [], systemDamage: 0 });
    expect(shipVitalsFrom({ hull: '31' as any, conditions: 'nope' as any }, { maxHull: Number.NaN } as any))
      .toEqual({ hull: 0, maxHull: 0, shields: 0, maxShields: 0, conditions: [], systemDamage: 0 });
  });

  it('clamps system damage to 0-6 and drops non-string conditions', () => {
    expect(shipVitalsFrom({ systemDamage: 99, conditions: ['Shocked', 7 as any] } as any, maxima()).systemDamage).toBe(6);
    expect(shipVitalsFrom({ systemDamage: -3 } as any, maxima()).systemDamage).toBe(0);
    expect(shipVitalsFrom({ conditions: ['Shocked', 7 as any] } as any, maxima()).conditions).toEqual(['Shocked']);
  });
});

describe('buildShipVitals / addShipVitals', () => {
  it('keys by ship id and injects the computed maxima', () => {
    const v = buildShipVitals([ship('s1', { hull: 20, shields: 4, conditions: [], systemDamage: 0 })], maxima);
    expect(v.s1).toEqual({ hull: 20, maxHull: 40, shields: 4, maxShields: 12, conditions: [], systemDamage: 0 });
  });

  it('addShipVitals folds one ship in without touching the rest', () => {
    const v = buildShipVitals([ship('s1', { hull: 20, shields: 4 })], maxima);
    const next = addShipVitals(v, ship('s2', { hull: 1, shields: 0 }), maxima);
    expect(Object.keys(next).sort()).toEqual(['s1', 's2']);
    expect(next.s1).toBe(v.s1);
  });
});

describe('mergeShipPlay', () => {
  it('updates play fields, keeps cached maxima, and is immutable', () => {
    const v: Record<string, ShipVitals> = { s1: { hull: 40, maxHull: 40, shields: 12, maxShields: 12, conditions: [], systemDamage: 0 } };
    const next = mergeShipPlay(v, 's1', { hull: 9, shields: 0, conditions: ['Stalled'], systemDamage: 3 });
    expect(next.s1).toEqual({ hull: 9, maxHull: 40, shields: 0, maxShields: 12, conditions: ['Stalled'], systemDamage: 3 });
    expect(v.s1.hull).toBe(40);
  });

  it('ignores unknown ship ids', () => {
    const v: Record<string, ShipVitals> = {};
    expect(mergeShipPlay(v, 'nope', { hull: 1 })).toBe(v);
  });
});

describe('applyPendingShipPlays', () => {
  it('overlays buffered payloads and ignores unknown ids', () => {
    const v = buildShipVitals([ship('s1', { hull: 40, shields: 12 })], maxima);
    const next = applyPendingShipPlays(v, { s1: { hull: 5, shields: 0, conditions: ['Ionized'], systemDamage: 1 }, ghost: { hull: 0, shields: 0, conditions: [], systemDamage: 0 } });
    expect(next.s1.hull).toBe(5);
    expect(next.s1.maxHull).toBe(40);
    expect(next.ghost).toBeUndefined();
  });

  it('empty pending is identity', () => {
    const v = buildShipVitals([ship('s1', { hull: 40 })], maxima);
    expect(applyPendingShipPlays(v, {})).toBe(v);
  });
});

describe('tokenShipVitals', () => {
  it('returns null for non-ship tokens and for unloaded ships', () => {
    expect(tokenShipVitals(token({}), {})).toBeNull();
    expect(tokenShipVitals(token({ ship_id: 's-unloaded' }), {})).toBeNull();
  });

  it('resolves a ship token to its ship vitals', () => {
    const v = buildShipVitals([ship('s1', { hull: 12, shields: 3 })], maxima);
    expect(tokenShipVitals(token({ ship_id: 's1' }), v)?.hull).toBe(12);
  });
});

describe('crewedShipIds', () => {
  it('selects ships crewed by any owned character', () => {
    const ships = [
      { id: 's1', crew: [{ character_id: 'c1' }, { character_id: 'c9' }] },
      { id: 's2', crew: [{ character_id: 'c9' }] },
      { id: 's3' },
    ];
    const got = crewedShipIds(ships, new Set(['c1']));
    expect([...got]).toEqual(['s1']);
  });

  it('empty ownership selects nothing', () => {
    expect(crewedShipIds([{ id: 's1', crew: [{ character_id: 'c1' }] }], new Set()).size).toBe(0);
  });
});

describe('shipStatusNames', () => {
  it('appends a system-damage chip only when damaged', () => {
    const base = shipVitalsFrom({ conditions: ['Ionized'], systemDamage: 0 } as any, maxima());
    expect(shipStatusNames(base)).toEqual(['Ionized']);
    expect(shipStatusNames({ ...base, systemDamage: 4 })).toEqual(['Ionized', 'sys 4']);
  });
});
```

Create `apps/swdnd/src/lib/shipPlay.test.ts`:

```ts
// apps/swdnd/src/lib/shipPlay.test.ts
import { describe, expect, it } from 'bun:test';
import { setSystemDamage, toggleShipCondition } from './shipPlay';

const doc = (play: Record<string, unknown>) =>
  ({ schemaVersion: 1, identity: { name: 'Krayt' }, play } as any);

describe('toggleShipCondition', () => {
  it('adds, then removes, leaving the rest of the document intact', () => {
    const a = toggleShipCondition(doc({ hull: 20, conditions: [], systemDamage: 0 }), 'Ionized');
    expect(a.play.conditions).toEqual(['Ionized']);
    expect(a.play.hull).toBe(20);
    expect(a.identity.name).toBe('Krayt');
    const b = toggleShipCondition(a, 'Ionized');
    expect(b.play.conditions).toEqual([]);
  });

  it('is immutable and tolerates a missing conditions array', () => {
    const before = doc({ hull: 20 });
    const after = toggleShipCondition(before, 'Stalled');
    expect(after.play.conditions).toEqual(['Stalled']);
    expect(before.play.conditions).toBeUndefined();
  });

  it('leaves unrelated conditions alone', () => {
    const d = toggleShipCondition(doc({ conditions: ['Tractored', 'Slowed 2'] }), 'Slowed 2');
    expect(d.play.conditions).toEqual(['Tractored']);
  });

  it('a levelled condition replaces its own family, as addCondition does on the sheet', () => {
    const d = toggleShipCondition(doc({ conditions: ['Tractored', 'Slowed 1'] }), 'Slowed 3');
    expect(d.play.conditions).toEqual(['Tractored', 'Slowed 3']);
    // …and stepping down a level is the same single-entry replacement.
    expect(toggleShipCondition(d, 'Slowed 2').play.conditions).toEqual(['Tractored', 'Slowed 2']);
  });

  it('picking the active level again clears the family', () => {
    expect(toggleShipCondition(doc({ conditions: ['Slowed 3'] }), 'Slowed 3').play.conditions).toEqual([]);
  });
});

describe('setSystemDamage', () => {
  it('clamps to 0-6 and keeps conditions untouched', () => {
    expect(setSystemDamage(doc({ conditions: ['Shocked'], systemDamage: 0 }), 3).play.systemDamage).toBe(3);
    expect(setSystemDamage(doc({ systemDamage: 0 }), 99).play.systemDamage).toBe(6);
    expect(setSystemDamage(doc({ systemDamage: 4 }), -2).play.systemDamage).toBe(0);
    expect(setSystemDamage(doc({ conditions: ['Shocked'] }), 2).play.conditions).toEqual(['Shocked']);
  });

  it('rounds junk input to a valid counter', () => {
    expect(setSystemDamage(doc({}), 2.6 as number).play.systemDamage).toBe(3);
    expect(setSystemDamage(doc({}), Number.NaN).play.systemDamage).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test apps/swdnd/src/lib/shipVitals.test.ts apps/swdnd/src/lib/shipPlay.test.ts` — FAIL (both modules missing).

- [ ] **Step 3: Implement `lib/shipVitals.ts`.** Create:

```ts
// apps/swdnd/src/lib/shipVitals.ts — live hull/shields/conditions for ship-bound
// tokens. The character-side twin of lib/vitals.ts: maxima are computed once at
// load and cached; ship:updated then tracks the play document.
// Maxima are INJECTED (never imported from shipRules) so this module stays pure
// and testable without a ShipReferenceData fixture.
import { MAX_SYSTEM_DAMAGE } from './shipTokens';
import type { TokenDto } from './scenes';

/** The slice of ShipPlayState the map cares about. */
export interface ShipPlayLike { hull: number; shields: number; conditions: string[]; systemDamage: number }
export interface ShipVitals {
  hull: number; maxHull: number; shields: number; maxShields: number;
  conditions: string[]; systemDamage: number;
}
/** The slice of StarshipDto the map cares about. */
export interface ShipSource { id: string; data_json: { play: ShipPlayLike } }
export interface ShipMaxima { maxHull: number; maxShields: number }
export type PendingShipPlays = Record<string, ShipPlayLike>;

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const strings = (v: unknown): string[] =>
  (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const counter = (v: unknown): number =>
  Math.min(MAX_SYSTEM_DAMAGE, Math.max(0, Math.round(num(v))));

/** Build one vitals record, tolerating legacy or partial play documents. */
export function shipVitalsFrom(
  play: Partial<ShipPlayLike> | null | undefined,
  max: Partial<ShipMaxima> | null | undefined,
): ShipVitals {
  return {
    hull: num(play?.hull),
    maxHull: Math.max(0, num(max?.maxHull)),
    shields: num(play?.shields),
    maxShields: Math.max(0, num(max?.maxShields)),
    conditions: strings(play?.conditions),
    systemDamage: counter(play?.systemDamage),
  };
}

/** Initial snapshot: `maxima` supplies computeShip's maxHull/maxShields per ship. */
export function buildShipVitals<S extends ShipSource>(
  ships: S[],
  maxima: (ship: S) => ShipMaxima,
): Record<string, ShipVitals> {
  const out: Record<string, ShipVitals> = {};
  for (const s of ships) out[s.id] = shipVitalsFrom(s.data_json?.play, maxima(s));
  return out;
}

/** Adopt one ship (e.g. created after load) without disturbing the others. */
export function addShipVitals<S extends ShipSource>(
  vitals: Record<string, ShipVitals>,
  ship: S,
  maxima: (ship: S) => ShipMaxima,
): Record<string, ShipVitals> {
  return { ...vitals, [ship.id]: shipVitalsFrom(ship.data_json?.play, maxima(ship)) };
}

/**
 * Merge a `ship:updated` play payload. Maxima stay as computed at load — a
 * mid-session refit won't refresh them until reload (same accepted trade-off
 * as character maxHp in lib/vitals.ts).
 */
export function mergeShipPlay(
  vitals: Record<string, ShipVitals>,
  shipId: string,
  play: Partial<ShipPlayLike>,
): Record<string, ShipVitals> {
  const cur = vitals[shipId];
  if (!cur) return vitals;
  return {
    ...vitals,
    [shipId]: { ...shipVitalsFrom(play, cur), maxHull: cur.maxHull, maxShields: cur.maxShields },
  };
}

/** Overlay payloads buffered while the ship load was in flight. Unknown ids are no-ops. */
export function applyPendingShipPlays(
  vitals: Record<string, ShipVitals>,
  pending: PendingShipPlays,
): Record<string, ShipVitals> {
  let out = vitals;
  for (const [id, play] of Object.entries(pending)) out = mergeShipPlay(out, id, play);
  return out;
}

/** A ship token's vitals, or null when it isn't one (or its ship isn't loaded). */
export function tokenShipVitals(
  token: Pick<TokenDto, 'ship_id'>,
  vitals: Record<string, ShipVitals>,
): ShipVitals | null {
  return token.ship_id ? vitals[token.ship_id] ?? null : null;
}

/** Ships this player crews — the client mirror of access.ts's playerCrewsShip. */
export function crewedShipIds(
  ships: { id: string; crew?: { character_id: string }[] }[],
  ownCharacterIds: Set<string>,
): Set<string> {
  const out = new Set<string>();
  for (const s of ships) {
    if ((s.crew ?? []).some((c) => ownCharacterIds.has(c.character_id))) out.add(s.id);
  }
  return out;
}

/** Status-ring labels for a ship: its conditions plus a `sys N` chip when damaged. */
export const shipStatusNames = (vitals: ShipVitals): string[] =>
  (vitals.systemDamage > 0 ? [...vitals.conditions, `sys ${vitals.systemDamage}`] : [...vitals.conditions]);
```

- [ ] **Step 4: Implement `lib/shipPlay.ts`.** Create:

```ts
// apps/swdnd/src/lib/shipPlay.ts — pure edits to a ship's play document.
// PATCH /swdnd/starships/{id} is a whole-document write, so map-side condition
// and system-damage edits produce a new ShipBuild rather than a field patch.
import { LEVELED_SHIP_CONDITIONS } from './shipRules/constants';
import { MAX_SYSTEM_DAMAGE } from './shipTokens';

/** The slice of ShipBuild these edits touch; extra keys pass through untouched. */
export interface ShipDocLike {
  play: { conditions?: string[]; systemDamage?: number; [k: string]: unknown };
  [k: string]: unknown;
}

/**
 * 'Slowed 3' -> 'Slowed'; a plain condition returns itself.
 *
 * PARITY REQUIREMENT: this must behave exactly like the module-private
 * conditionFamily() in lib/shipPlayState.ts (the ShipSheet's write path). The
 * spine does not export its copy, so the rule is duplicated here — but the
 * DATA it reads (LEVELED_SHIP_CONDITIONS) is shared, and both paths edit the
 * same ShipPlayState.conditions array. If the spine ever exports its helper,
 * delete this one and import it instead.
 */
function conditionFamily(c: string): string {
  const family = c.replace(/\s+\d+$/, '');
  return LEVELED_SHIP_CONDITIONS.includes(family) ? family : c;
}

/**
 * Add or remove one space condition ('Ionized', 'Slowed 3', … — SHIP_CONDITIONS).
 * A levelled condition replaces its own family, so 'Slowed 3' picked while
 * 'Slowed 1' is set leaves only 'Slowed 3'; picking the active value clears it.
 * Same eviction rule as the sheet's addCondition/removeCondition pair.
 */
export function toggleShipCondition<T extends ShipDocLike>(doc: T, name: string): T {
  const cur = Array.isArray(doc.play?.conditions) ? doc.play.conditions : [];
  const family = conditionFamily(name);
  const next = cur.includes(name)
    ? cur.filter((c) => c !== name)
    : [...cur.filter((c) => conditionFamily(c) !== family), name];
  return { ...doc, play: { ...doc.play, conditions: next } } as T;
}

/** Set the 0-6 system-damage counter (clamped and rounded). */
export function setSystemDamage<T extends ShipDocLike>(doc: T, value: number): T {
  const n = Number.isFinite(value) ? Math.round(value) : 0;
  const clamped = Math.min(MAX_SYSTEM_DAMAGE, Math.max(0, n));
  return { ...doc, play: { ...doc.play, systemDamage: clamped } } as T;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `bun test apps/swdnd/src/lib/shipVitals.test.ts apps/swdnd/src/lib/shipPlay.test.ts` — all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/swdnd/src/lib/shipVitals.ts apps/swdnd/src/lib/shipVitals.test.ts apps/swdnd/src/lib/shipPlay.ts apps/swdnd/src/lib/shipPlay.test.ts
git commit -m "feat(swdnd): pure ship vitals and play-document edits for the map"
```

---

### Task 6: grouped initiative (schema + pure ops)

**Files:**
- Modify: `apps/swdnd/src/lib/initiative.ts`
- Modify: `apps/swdnd/src/lib/initiative.test.ts`
- Modify: `apps/backend/src/routes/swdnd/scenes.ts`
- Modify: `apps/backend/src/routes/swdnd/scenes.test.ts`

**Interfaces:**

*Consumes:* the existing `initiative_json` contract — `{ order: {tokenId, name, roll}[], activeIndex, round }` — persisted by `PATCH /swdnd/scenes/{id}/initiative` (DM only) and read by `useTabletop`/`Tabletop`.

*Produces:*
- `export interface InitiativeEntry { tokenId: string; name: string; roll: number; crew?: string[] }` — `crew` holds nested character-token ids under a ship entry.
- `export function parseInitiative(raw: unknown): Initiative | null` — tolerant reader for legacy/hand-edited documents; clamps `activeIndex`, floors `round` at 1, drops junk entries.
- `export function groupCrew(init: Initiative, shipTokenId: string, crewTokenIds: string[]): Initiative` — nests entries under the ship slot; the slot's roll becomes the lowest crew roll (SOTG), or `min(currentSlotRoll, …newRolls)` when the ship already had crew.
- `export function ungroupCrew(init: Initiative, shipTokenId: string, nameFor: (tokenId: string) => string): Initiative` — re-promotes nested crew as top-level entries right after the ship slot, each carrying the slot's roll.
- `export function removeEntry(init: Initiative, tokenId: string): Initiative` — existing symbol, now also strips the id out of every `crew` array.
- Backend zod `InitiativeEntry` gains `crew: z.array(z.string()).optional()`.

- [ ] **Step 1: Write the failing tests.** Append to `apps/swdnd/src/lib/initiative.test.ts` (and extend its import list with `groupCrew, parseInitiative, ungroupCrew`):

```ts
describe('parseInitiative', () => {
  it('accepts legacy documents with no crew key', () => {
    const parsed = parseInitiative({ order: [{ tokenId: 'a', name: 'A', roll: 12 }], activeIndex: 0, round: 3 });
    expect(parsed).toEqual({ order: [{ tokenId: 'a', name: 'A', roll: 12 }], activeIndex: 0, round: 3 });
  });

  it('keeps crew arrays and drops junk members', () => {
    const parsed = parseInitiative({ order: [{ tokenId: 'ship', name: 'Krayt', roll: 9, crew: ['c1', 7, '', 'c2'] }], activeIndex: 0, round: 1 });
    expect(parsed!.order[0].crew).toEqual(['c1', 'c2']);
  });

  it('drops malformed entries and defaults missing fields', () => {
    const parsed = parseInitiative({ order: [null, { name: 'no id' }, { tokenId: 'a' }], activeIndex: 9, round: 0 });
    expect(parsed).toEqual({ order: [{ tokenId: 'a', name: '', roll: 0 }], activeIndex: 0, round: 1 });
  });

  it('clamps activeIndex into range and returns null for non-documents', () => {
    const parsed = parseInitiative({ order: [{ tokenId: 'a', name: 'A', roll: 1 }, { tokenId: 'b', name: 'B', roll: 2 }], activeIndex: 5, round: 2 });
    expect(parsed!.activeIndex).toBe(1);
    expect(parseInitiative(null)).toBeNull();
    expect(parseInitiative({ order: 'nope' })).toBeNull();
    expect(parseInitiative('{}')).toBeNull();
  });
});

describe('groupCrew', () => {
  const base = () => ({
    order: [
      { tokenId: 'ship', name: 'Krayt', roll: 20 },
      { tokenId: 'pilot', name: 'Pilot', roll: 14 },
      { tokenId: 'gunner', name: 'Gunner', roll: 9 },
      { tokenId: 'droid', name: 'Droid', roll: 4 },
    ],
    activeIndex: 0,
    round: 1,
  });

  it('nests crew under the ship and takes the lowest crew roll as the slot', () => {
    const next = groupCrew(base(), 'ship', ['pilot', 'gunner']);
    expect(next.order.map((e) => e.tokenId)).toEqual(['ship', 'droid']);
    expect(next.order[0].crew).toEqual(['pilot', 'gunner']);
    expect(next.order[0].roll).toBe(9);
  });

  it('a second grouping keeps the running minimum', () => {
    const once = groupCrew(base(), 'ship', ['gunner']);
    expect(once.order[0].roll).toBe(9);
    const twice = groupCrew(once, 'ship', ['pilot']);
    expect(twice.order[0].roll).toBe(9);
    expect(twice.order[0].crew).toEqual(['gunner', 'pilot']);
  });

  it('keeps the same combatant active across the reshuffle', () => {
    const init = { ...base(), activeIndex: 3 }; // droid
    const next = groupCrew(init, 'ship', ['pilot', 'gunner']);
    expect(next.order[next.activeIndex].tokenId).toBe('droid');
  });

  it('an active crew member hands the turn to its ship slot', () => {
    const init = { ...base(), activeIndex: 1 }; // pilot
    const next = groupCrew(init, 'ship', ['pilot']);
    expect(next.order[next.activeIndex].tokenId).toBe('ship');
  });

  it('is a no-op for an unknown ship, an empty list, or self-grouping', () => {
    const init = base();
    expect(groupCrew(init, 'nope', ['pilot'])).toBe(init);
    expect(groupCrew(init, 'ship', [])).toBe(init);
    expect(groupCrew(init, 'ship', ['ship'])).toBe(init);
  });
});

describe('ungroupCrew', () => {
  it('re-promotes crew right after the ship, carrying the slot roll', () => {
    const grouped = groupCrew(
      { order: [{ tokenId: 'ship', name: 'Krayt', roll: 20 }, { tokenId: 'pilot', name: 'Pilot', roll: 14 }, { tokenId: 'z', name: 'Z', roll: 1 }], activeIndex: 0, round: 1 },
      'ship', ['pilot'],
    );
    const back = ungroupCrew(grouped, 'ship', (id) => (id === 'pilot' ? 'Pilot' : id));
    expect(back.order.map((e) => e.tokenId)).toEqual(['ship', 'pilot', 'z']);
    expect(back.order[1]).toEqual({ tokenId: 'pilot', name: 'Pilot', roll: 14 });
    expect(back.order[0].crew).toBeUndefined();
  });

  it('is a no-op when the ship has no crew', () => {
    const init = { order: [{ tokenId: 'ship', name: 'Krayt', roll: 20 }], activeIndex: 0, round: 1 };
    expect(ungroupCrew(init, 'ship', () => 'x')).toBe(init);
  });
});

describe('removeEntry with crew', () => {
  it('strips a removed token out of crew arrays too', () => {
    const init = { order: [{ tokenId: 'ship', name: 'Krayt', roll: 9, crew: ['pilot', 'gunner'] }], activeIndex: 0, round: 1 };
    const next = removeEntry(init, 'gunner');
    expect(next.order[0].crew).toEqual(['pilot']);
  });

  it('removing the ship removes its whole slot', () => {
    const init = { order: [{ tokenId: 'ship', name: 'Krayt', roll: 9, crew: ['pilot'] }, { tokenId: 'z', name: 'Z', roll: 1 }], activeIndex: 0, round: 1 };
    expect(removeEntry(init, 'ship').order.map((e) => e.tokenId)).toEqual(['z']);
  });
});
```

Append to `apps/backend/src/routes/swdnd/scenes.test.ts`, inside the existing `describe('initiative', …)`:

```ts
  it('round-trips grouped crew entries', async () => {
    const sc = await (await app.request(`/swdnd/campaigns/${campaignId}/scenes`, json('POST', { name: 'Grouped' }))).json() as any;
    const init = {
      order: [{ tokenId: 'ship', name: 'Krayt', roll: 9, crew: ['pilot', 'gunner'] }, { tokenId: 'foe', name: 'Foe', roll: 7 }],
      activeIndex: 0, round: 1,
    };
    const res = await app.request(`/swdnd/scenes/${sc.id}/initiative`, json('PATCH', { initiative: init }));
    expect(res.status).toBe(200);
    expect((await res.json() as any).initiative_json).toEqual(init);
  });

  it('rejects a non-string crew member', async () => {
    const sc = await (await app.request(`/swdnd/campaigns/${campaignId}/scenes`, json('POST', { name: 'Bad crew' }))).json() as any;
    const res = await app.request(`/swdnd/scenes/${sc.id}/initiative`, json('PATCH', {
      initiative: { order: [{ tokenId: 'ship', name: 'K', roll: 1, crew: [3] }], activeIndex: 0, round: 1 },
    }));
    expect(res.status).toBe(400);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test apps/swdnd/src/lib/initiative.test.ts apps/backend/src/routes/swdnd/scenes.test.ts` — FAIL (`parseInitiative`/`groupCrew`/`ungroupCrew` missing; the backend strips `crew`, so the round-trip mismatches).

- [ ] **Step 3: Implement the backend schema.** In `apps/backend/src/routes/swdnd/scenes.ts`, replace the `InitiativeEntry` line:

```ts
const InitiativeEntry = z.object({
  tokenId: z.string(),
  name: z.string(),
  roll: z.number(),
  /** Ship entries nest their crew's token ids; the slot is one turn (SOTG). */
  crew: z.array(z.string()).optional(),
});
```

- [ ] **Step 4: Implement the pure ops.** In `apps/swdnd/src/lib/initiative.ts`, replace the `InitiativeEntry` interface and the `removeEntry` function, and append the new helpers:

```ts
export interface InitiativeEntry {
  tokenId: string;
  name: string;
  roll: number;
  /** Ship entries nest their crew's token ids: one strip slot, many creatures. */
  crew?: string[];
}
```

```ts
/** Remove a token's entry (and any nested reference to it), keeping the same creature's turn active where possible. */
export function removeEntry(init: Initiative, tokenId: string): Initiative {
  const idx = init.order.findIndex((e) => e.tokenId === tokenId);
  const order = (idx === -1 ? init.order : init.order.filter((e) => e.tokenId !== tokenId))
    .map((e) => {
      if (!e.crew?.includes(tokenId)) return e;
      const crew = e.crew.filter((id) => id !== tokenId);
      const { crew: _dropped, ...rest } = e;
      return crew.length ? { ...rest, crew } : rest;
    });
  if (idx === -1) return order === init.order ? init : { ...init, order };
  let activeIndex = init.activeIndex;
  if (idx < activeIndex) activeIndex -= 1;
  if (activeIndex >= order.length) activeIndex = 0;
  return { ...init, order, activeIndex };
}

/**
 * Tolerant reader for `scene.initiative_json`: legacy entries (no `crew`),
 * partial fields, and out-of-range indices all parse rather than throw.
 */
export function parseInitiative(raw: unknown): Initiative | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { order?: unknown; activeIndex?: unknown; round?: unknown };
  if (!Array.isArray(o.order)) return null;
  const order: InitiativeEntry[] = [];
  for (const item of o.order) {
    if (!item || typeof item !== 'object') continue;
    const { tokenId, name, roll, crew } = item as Record<string, unknown>;
    if (typeof tokenId !== 'string' || !tokenId) continue;
    const entry: InitiativeEntry = {
      tokenId,
      name: typeof name === 'string' ? name : '',
      roll: typeof roll === 'number' && Number.isFinite(roll) ? roll : 0,
    };
    const ids = Array.isArray(crew) ? crew.filter((x): x is string => typeof x === 'string' && !!x) : [];
    if (ids.length) entry.crew = ids;
    order.push(entry);
  }
  const roundRaw = typeof o.round === 'number' && Number.isFinite(o.round) ? Math.floor(o.round) : 1;
  const idxRaw = typeof o.activeIndex === 'number' && Number.isFinite(o.activeIndex) ? Math.floor(o.activeIndex) : 0;
  return {
    order,
    activeIndex: order.length === 0 ? 0 : Math.min(Math.max(0, idxRaw), order.length - 1),
    round: Math.max(1, roundRaw),
  };
}

/**
 * Nest `crewTokenIds` under the ship's entry: one strip slot for the whole
 * crew. SOTG: the lowest crew roll sets the ship's place in the order (when
 * the ship already had crew, its current slot value is that running minimum).
 * The active creature keeps its turn — a nested crew member hands it to the ship.
 */
export function groupCrew(init: Initiative, shipTokenId: string, crewTokenIds: string[]): Initiative {
  const ship = init.order.find((e) => e.tokenId === shipTokenId);
  if (!ship) return init;
  const ids = new Set(crewTokenIds.filter((id) => id && id !== shipTokenId));
  const moved = init.order.filter((e) => ids.has(e.tokenId));
  if (moved.length === 0) return init;

  const activeId = init.order[init.activeIndex]?.tokenId ?? null;
  const rolls = moved.map((e) => e.roll);
  const hadCrew = (ship.crew ?? []).length > 0;
  const order = init.order
    .filter((e) => !ids.has(e.tokenId))
    .map((e) => (e.tokenId === shipTokenId
      ? {
          ...e,
          crew: [...(e.crew ?? []), ...moved.map((m) => m.tokenId)],
          roll: hadCrew ? Math.min(e.roll, ...rolls) : Math.min(...rolls),
        }
      : e));

  const keepId = activeId && ids.has(activeId) ? shipTokenId : activeId;
  const found = keepId ? order.findIndex((e) => e.tokenId === keepId) : -1;
  return { ...init, order, activeIndex: found === -1 ? 0 : found };
}

/** Re-promote a ship's crew to top-level entries, right after the ship, at the slot's roll. */
export function ungroupCrew(
  init: Initiative,
  shipTokenId: string,
  nameFor: (tokenId: string) => string,
): Initiative {
  const idx = init.order.findIndex((e) => e.tokenId === shipTokenId);
  if (idx === -1 || !init.order[idx].crew?.length) return init;
  const ship = init.order[idx];
  const { crew = [], ...bare } = ship;
  const restored: InitiativeEntry[] = crew.map((tokenId) => ({ tokenId, name: nameFor(tokenId), roll: ship.roll }));
  const order = [...init.order.slice(0, idx), bare, ...restored, ...init.order.slice(idx + 1)];
  const activeId = init.order[init.activeIndex]?.tokenId ?? null;
  const found = activeId ? order.findIndex((e) => e.tokenId === activeId) : -1;
  return { ...init, order, activeIndex: found === -1 ? 0 : found };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `bun test apps/swdnd/src/lib/initiative.test.ts apps/backend/src/routes/swdnd/scenes.test.ts` — all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/swdnd/src/lib/initiative.ts apps/swdnd/src/lib/initiative.test.ts apps/backend/src/routes/swdnd/scenes.ts apps/backend/src/routes/swdnd/scenes.test.ts
git commit -m "feat(swdnd): grouped initiative — crew nested under a ship slot"
```

---

### Task 7: client DTOs, rotate REST, own-ship visibility

**Files:**
- Modify: `apps/swdnd/src/lib/scenes.ts`
- Modify: `apps/swdnd/src/lib/visibility.ts`
- Modify: `apps/swdnd/src/lib/visibility.test.ts`

**Interfaces:**

*Consumes:* `api()` from `./api`; the routes from Tasks 1–3.

*Produces:*
- `SceneDto` gains `mode: 'ground' | 'space'`.
- `TokenDto` gains `ship_id: string | null; facing: number`.
- `patchScene(id, patch: { name?: string; grid?: GridConfig; mode?: 'ground' | 'space'; sort?: number })` — widened patch type.
- `export const rotateToken: (id: string, facing: number, token?: string | null) => Promise<TokenDto>` — PATCHes only `{ facing }` to `/swdnd/tokens/{id}/position`.
- `ViewerCtx` gains `ownShipIds?: Set<string>` (optional, so existing call sites and tests keep working).
- `export function isOwnToken(t: Pick<TokenDto, 'character_id' | 'ship_id'>, ctx: Pick<ViewerCtx, 'ownCharacterIds' | 'ownShipIds'>): boolean` — the single definition of "mine" (own character token or crewed ship token).
- `tokenVisibility(t, ctx)` — unchanged signature; now treats a crewed ship's token as own for the fog exemption.

- [ ] **Step 1: Write the failing tests.** Append to `apps/swdnd/src/lib/visibility.test.ts` (extend the import list with `isOwnToken`; the file's existing `baseToken` helper needs `ship_id: null, facing: 0` added to its defaults):

```ts
describe('isOwnToken', () => {
  const own = { ownCharacterIds: new Set(['c1']), ownShipIds: new Set(['s1']) };

  it('is true for an owned character token and a crewed ship token', () => {
    expect(isOwnToken(baseToken({ character_id: 'c1' }), own)).toBe(true);
    expect(isOwnToken(baseToken({ ship_id: 's1' }), own)).toBe(true);
  });

  it('is false for someone else’s character, an uncrewed ship, and a plain token', () => {
    expect(isOwnToken(baseToken({ character_id: 'c9' }), own)).toBe(false);
    expect(isOwnToken(baseToken({ ship_id: 's9' }), own)).toBe(false);
    expect(isOwnToken(baseToken({}), own)).toBe(false);
  });

  it('tolerates a context with no ownShipIds (legacy call sites)', () => {
    expect(isOwnToken(baseToken({ ship_id: 's1' }), { ownCharacterIds: new Set() })).toBe(false);
  });
});

describe('tokenVisibility — crewed ships', () => {
  it('a player always sees their crewed ship, even under unrevealed fog', () => {
    const t = baseToken({ ship_id: 's1', q: 9, r: 9 });
    const ctx = { isDm: false, revealed: ['0,0'], ownCharacterIds: new Set<string>(), ownShipIds: new Set(['s1']) };
    expect(tokenVisibility(t, ctx)).toEqual({ visible: true, dimmed: false });
  });

  it('someone else’s ship under fog stays hidden', () => {
    const t = baseToken({ ship_id: 's9', q: 9, r: 9 });
    const ctx = { isDm: false, revealed: ['0,0'], ownCharacterIds: new Set<string>(), ownShipIds: new Set(['s1']) };
    expect(tokenVisibility(t, ctx)).toEqual({ visible: false, dimmed: false });
  });

  it('a hidden ship token is still hidden from players', () => {
    const t = baseToken({ ship_id: 's1', hidden: 1 });
    const ctx = { isDm: false, revealed: [], ownCharacterIds: new Set<string>(), ownShipIds: new Set(['s1']) };
    expect(tokenVisibility(t, ctx).visible).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test apps/swdnd/src/lib/visibility.test.ts` — FAIL (`isOwnToken` is not exported; the crewed-ship fog case returns `visible: false`).

- [ ] **Step 3: Implement the DTO + REST changes.** In `apps/swdnd/src/lib/scenes.ts`:

```ts
export interface SceneDto {
  id: string; campaign_id: string; name: string;
  image_path: string | null; image_w: number | null; image_h: number | null;
  grid_json: GridConfig; fog_json: string[]; initiative_json: unknown | null;
  /** 'space' switches the toolbar/vocabulary; distance still comes from grid_json.unitsPerHex. */
  mode: 'ground' | 'space';
  is_active: number; sort: number; created_at: string; updated_at: string;
}
export interface TokenDto {
  id: string; scene_id: string; character_id: string | null; ship_id: string | null; name: string; color: string;
  faction: 'friendly' | 'hostile' | 'neutral'; q: number; r: number; scale: number; facing: number;
  hp: number | null; max_hp: number | null; conditions_json: string[]; hidden: number;
  image_path: string | null; created_at: string; updated_at: string;
}
```

```ts
export const patchScene = (
  id: string,
  patch: { name?: string; grid?: GridConfig; mode?: 'ground' | 'space'; sort?: number },
) => api<SceneDto>(`/swdnd/scenes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
```

and next to `moveToken`:

```ts
/** Rotate only — q/r are omitted so a stale local copy can't teleport the token. */
export const rotateToken = (id: string, facing: number, token?: string | null) =>
  api<TokenDto>(`/swdnd/tokens/${id}/position`, { method: 'PATCH', headers: auth(token), body: JSON.stringify({ facing }) });
```

- [ ] **Step 4: Implement the visibility change.** Replace the body of `apps/swdnd/src/lib/visibility.ts` (keeping the header comment):

```ts
export interface ViewerCtx {
  isDm: boolean;
  revealed: string[];
  ownCharacterIds: Set<string>;
  /** Ships this player crews; absent on legacy call sites. */
  ownShipIds?: Set<string>;
}

/** "Mine": my character's token, or a token bound to a ship I crew. */
export function isOwnToken(
  t: Pick<TokenDto, 'character_id' | 'ship_id'>,
  ctx: Pick<ViewerCtx, 'ownCharacterIds' | 'ownShipIds'>,
): boolean {
  if (t.character_id && ctx.ownCharacterIds.has(t.character_id)) return true;
  return !!t.ship_id && !!ctx.ownShipIds?.has(t.ship_id);
}

export function tokenVisibility(t: TokenDto, ctx: ViewerCtx): { visible: boolean; dimmed: boolean } {
  if (ctx.isDm) return { visible: true, dimmed: t.hidden === 1 };
  if (t.hidden === 1) return { visible: false, dimmed: false };
  if (fogActive(ctx.revealed)) {
    if (!isOwnToken(t, ctx) && !isRevealed(toFogSet(ctx.revealed), { q: t.q, r: t.r })) {
      return { visible: false, dimmed: false };
    }
  }
  return { visible: true, dimmed: false };
}

/** HP rings: DM sees all (hostiles included); players see friendly only. */
export const showHpRing = (t: TokenDto, isDm: boolean): boolean => isDm || t.faction === 'friendly';
```

- [ ] **Step 5: Run to verify pass**

Run: `bun test apps/swdnd/src/lib/visibility.test.ts apps/swdnd/src/lib/` — all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/swdnd/src/lib/scenes.ts apps/swdnd/src/lib/visibility.ts apps/swdnd/src/lib/visibility.test.ts
git commit -m "feat(swdnd): ship-aware map DTOs, rotate endpoint client, own-ship visibility"
```

---

### Task 8: `useTabletop` — ship state, crew access, new actions

**Files:**
- Modify: `apps/swdnd/src/hooks/useTabletop.ts`

**Verification note:** this task has no new pure module of its own; it is verified by **typecheck + the full existing suite staying green**, plus the manual walkthrough in Task 12.

**Interfaces:**

*Consumes (from sub-projects 1–2 — these are the ONLY coupling points; if a name differs, adapt here and nowhere else):*
- `lib/starships.ts`: `listStarships(campaignId: string): Promise<StarshipDto[]>`, `getStarship(id: string): Promise<StarshipDto>`, `loadShipReference(): Promise<ShipReferenceData>`, `patchStarship(id: string, patch: { name?: string; data_json?: ShipBuild }, token?: string | null): Promise<StarshipDto>` — all four ship with sub-project 1 (`patchStarship` included; no need to add it). `StarshipDto = { id, campaign_id, name, data_json: ShipBuild, crew: { character_id: string; character_name: string; role: ShipRole }[], created_at, updated_at }` — this plan reads only `crew[].character_id`.
- `lib/shipRules`: `computeShip(build: ShipBuild, ref: ShipReferenceData): DerivedShip` with `DerivedShip.maxHull` and `.maxShields`. **`DerivedShip` carries no chassis-size field** — the size key comes from the reference row instead: `ref.sizes[build.identity.sizeId]?.key` is `'tiny' | 'small' | … | 'gargantuan'`, which is exactly what `shipTokenScale` expects. That lookup happens once, in the loader below.
- Realtime `ship:updated` payload `{ shipId, name, play }`.

*Produces (additions to `TabletopState`):*
- `shipVitals: Record<string, ShipVitals>`
- `ownShipIds: Set<string>`
- `ships: { id: string; name: string; scale: number }[]` — campaign ships for the spawner, with their footprint span
- `initiative: Initiative | null` — now produced by `parseInitiative`
- `actions.setSceneMode: (id: string, mode: 'ground' | 'space') => Promise<void>`
- `actions.rotate: (tokenId: string, facing: number) => Promise<void>`
- `actions.setShipPlay: (shipId: string, edit: (doc: ShipBuild) => ShipBuild) => Promise<void>`
- `actions.spawnShip: (shipId: string) => Promise<void>`
- `actions.loadShips: () => void`
- `canMove(t)` — widened: admin, own character token, or crewed ship token.

- [ ] **Step 1: Imports and type surface.** In `apps/swdnd/src/hooks/useTabletop.ts`, extend the `../lib/scenes` import with `rotateToken`, and add:

```ts
import { spawnPositions } from '../lib/spawn';
import { hexKey } from '../lib/hex';
import { shipTokenScale } from '../lib/shipTokens';
import {
  addShipVitals, applyPendingShipPlays, buildShipVitals, crewedShipIds, mergeShipPlay,
  type PendingShipPlays, type ShipVitals,
} from '../lib/shipVitals';
import { parseInitiative, type Initiative } from '../lib/initiative';
```

(replacing the existing `import type { Initiative } from '../lib/initiative';`).

Add to the `TabletopState` interface, after `vitals`:

```ts
  shipVitals: Record<string, ShipVitals>;
  ownShipIds: Set<string>;
  /** Campaign ships (spawner), each with the token scale its footprint implies. */
  ships: { id: string; name: string; scale: number }[];
```

and to `actions`, after `editToken`:

```ts
    setSceneMode: (id: string, mode: 'ground' | 'space') => Promise<void>;
    rotate: (tokenId: string, facing: number) => Promise<void>;
    setShipPlay: (shipId: string, edit: (doc: any) => any) => Promise<void>;
    spawnShip: (shipId: string) => Promise<void>;
    loadShips: () => void;
```

- [ ] **Step 2: Ship state + loader.** Inside `useTabletop`, after the `vitals` state declarations, add:

```ts
  const [shipVitals, setShipVitals] = useState<Record<string, ShipVitals>>({});
  const [ships, setShips] = useState<{ id: string; name: string; scale: number }[]>([]);
  const [wantShips, setWantShips] = useState(false);
  /** Full ship documents, needed to build whole-document PATCHes. */
  const shipDocs = useRef<Record<string, any>>({});
  const shipMaxima = useRef<(ship: any) => { maxHull: number; maxShields: number }>(() => ({ maxHull: 0, maxShields: 0 }));
  const shipsLoadedFor = useRef<string | null>(null);
  const pendingShipPlays = useRef<PendingShipPlays>({});
```

Then, after the character-vitals effect, add the loader and its trigger:

```ts
  // Ships load lazily: only in space scenes, when a ship token exists, or when
  // the DM opens the spawner. loadShipReference() is several content requests
  // and must not fire on every ground map.
  const loadShips = useCallback(async () => {
    const [starships, shipRules] = await Promise.all([
      import('../lib/starships'),
      import('../lib/shipRules'),
    ]);
    const [list, ref] = await Promise.all([starships.listStarships(campaignId), starships.loadShipReference()]);
    const maxima = (s: any) => {
      const d = shipRules.computeShip(s.data_json, ref);
      return { maxHull: d.maxHull, maxShields: d.maxShields };
    };
    shipMaxima.current = maxima;
    shipDocs.current = Object.fromEntries(list.map((s: any) => [s.id, s]));
    // The chassis size key ('medium', 'large', …) lives on the reference row, not
    // on DerivedShip — this is the one place this plan reads it.
    const sizeKeyOf = (s: any): string | null => ref.sizes[s.data_json?.identity?.sizeId ?? '']?.key ?? null;
    setShips(list.map((s: any) => ({
      id: s.id, name: s.name, scale: shipTokenScale(sizeKeyOf(s)),
    })));
    shipsLoadedFor.current = campaignId;
    setShipVitals(applyPendingShipPlays(buildShipVitals(list as any[], maxima), pendingShipPlays.current));
    pendingShipPlays.current = {};
    return list;
  }, [campaignId]);

  const needShips = wantShips
    || state.scene?.mode === 'space'
    || Object.values(state.tokens).some((t) => !!t.ship_id);

  useEffect(() => {
    shipsLoadedFor.current = null;
    shipDocs.current = {};
    pendingShipPlays.current = {};
    setShips([]);
    setShipVitals({});
    setWantShips(false);
  }, [campaignId]);

  useEffect(() => {
    if (!needShips || shipsLoadedFor.current === campaignId) return;
    let cancelled = false;
    loadShips().catch(() => {
      if (!cancelled) shipsLoadedFor.current = null; // ship rings simply don't render
    });
    return () => { cancelled = true; };
  }, [needShips, campaignId, loadShips]);
```

- [ ] **Step 3: Live `ship:updated`.** Inside the WS callback in the `connectCampaign` effect, next to the `character:updated` branch:

```ts
      if (env.type === 'ship:updated') {
        const p = env.payload as { shipId?: string; play?: { hull: number; shields: number; conditions: string[]; systemDamage: number } };
        const shipId = p?.shipId;
        const play = p?.play;
        if (!shipId || !play) return;
        const doc = shipDocs.current[shipId];
        if (doc) shipDocs.current[shipId] = { ...doc, data_json: { ...doc.data_json, play } };
        if (shipsLoadedFor.current === null) {
          pendingShipPlays.current[shipId] = play; // loader in flight; don't let it clobber this
          return;
        }
        setShipVitals((v) => {
          if (v[shipId]) return mergeShipPlay(v, shipId, play);
          // Ship created after load: adopt it, mirroring the character path.
          import('../lib/starships')
            .then((m) => m.getStarship(shipId))
            .then((ship: any) => {
              shipDocs.current[shipId] = ship;
              setShipVitals((v2) => mergeShipPlay(addShipVitals(v2, ship, shipMaxima.current), shipId, play));
            })
            .catch(() => { /* deleted meanwhile; stay a silent no-op */ });
          return v;
        });
        return;
      }
```

- [ ] **Step 4: Crewed-ship ownership + `canMove`.** After the `ownCharacterIds` effect, derive the crewed set (kept in state so `canMove` and the canvas both see it):

```ts
  const [ownShipIds, setOwnShipIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const docs = Object.values(shipDocs.current) as { id: string; crew?: { character_id: string }[] }[];
    setOwnShipIds(crewedShipIds(docs, ownCharacterIds));
  }, [ships, ownCharacterIds]);
```

and in the returned object replace `canMove`:

```ts
    canMove: (t) => authed
      || (!!t.character_id && ownCharacterIds.has(t.character_id))
      || (!!t.ship_id && ownShipIds.has(t.ship_id)),
```

- [ ] **Step 5: New actions + tolerant initiative.** In the returned object, replace the `initiative` line:

```ts
    initiative: parseInitiative(state.scene?.initiative_json ?? null),
```

expose the new state next to `vitals`:

```ts
    shipVitals,
    ownShipIds,
    ships,
```

and add to `actions` (after `editToken`):

```ts
      // One PATCH: mode and the matching grid calibration (5 ft ground / 50 ft space).
      setSceneMode: wrap(async (id: string, mode: 'ground' | 'space') => {
        const grid = state.scene?.id === id ? state.scene.grid_json : null;
        await patchScene(id, {
          mode,
          ...(grid ? { grid: { ...grid, unitsPerHex: mode === 'space' ? 50 : 5, unitLabel: grid.unitLabel || 'ft' } } : {}),
        });
      }),
      rotate: wrap(async (tokenId: string, facing: number) => { await rotateToken(tokenId, facing, playerToken); }),
      setShipPlay: async (shipId: string, edit: (doc: any) => any) => {
        const doc = shipDocs.current[shipId];
        if (!doc) return;
        const next = edit(doc.data_json);
        shipDocs.current[shipId] = { ...doc, data_json: next };
        // Optimistic like commitFog: the condition ring must respond instantly.
        setShipVitals((v) => mergeShipPlay(v, shipId, next.play));
        try {
          const m = await import('../lib/starships');
          await m.patchStarship(shipId, { data_json: next }, playerToken);
          setError(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Ship update failed');
          shipsLoadedFor.current = null;
          void loadShips().catch(() => { /* resync failed; rings go stale until reload */ });
        }
      },
      spawnShip: wrap(async (shipId: string) => {
        const scene = state.scene;
        const doc = shipDocs.current[shipId];
        if (!scene || !doc) return;
        const taken = new Set(Object.values(state.tokens).map((t) => hexKey({ q: t.q, r: t.r })));
        const spot = spawnPositions({ q: 0, r: 0 }, taken.size + 1).find((h) => !taken.has(hexKey(h))) ?? { q: 0, r: 0 };
        await createToken(scene.id, {
          name: doc.name,
          ship_id: shipId,
          faction: 'friendly',
          color: '#7aa2ff',
          scale: ships.find((s) => s.id === shipId)?.scale ?? 2,
          facing: 0,
          q: spot.q,
          r: spot.r,
        });
      }),
      loadShips: () => setWantShips(true),
```

- [ ] **Step 6: Typecheck + full suite**

Run: `cd apps/swdnd && bun run build` — clean (no unused locals, no implicit any beyond the deliberate `any` seams noted above).
Run: `bun test` — same pass count as before this task (no test targets the hook directly).

- [ ] **Step 7: Commit**

```bash
git add apps/swdnd/src/hooks/useTabletop.ts
git commit -m "feat(swdnd): tabletop hook loads ship vitals, crew access and ship actions"
```

---

### Task 9: token rendering — shields over hull, bow marker, rotate handles

**Files:**
- Modify: `apps/swdnd/src/panels/Tabletop/TokenGlyph.tsx`
- Modify: `apps/swdnd/src/panels/Tabletop/SceneCanvas.tsx`

**Verification note:** SVG-only task. It is verified by **typecheck (`bun run build`) + the full suite staying green + the manual checklist in Task 12** — there is no DOM test harness in this repo, and all the geometry it consumes (`facingAngle`, `footprintScale`, `shipStatusNames`, `hpArcPath`) is already unit-tested in Tasks 4–5.

**Interfaces:**

*Consumes:* `hpArcPath`, `hpColor`, `hpFraction`, `statusSegments`, `BAND_FRACTION`, `RING_FONT_FRACTION` from `../../lib/rings`; `facingAngle`, `rotateFacing` from `../../lib/shipTokens`; `shipStatusNames`, `tokenShipVitals`, `type ShipVitals` from `../../lib/shipVitals`; `isOwnToken` from `../../lib/visibility`; `gridUnits` from `../../lib/hex`.

*Produces:*
- `TokenGlyph` props gain `ship?: ShipVitals | null` (ship-bound vitals; overrides the character/NPC hp source), `facingDeg?: number | null` (bow marker angle; `null`/absent = no marker), `showRotate?: boolean` (render the ±60° handles).
- `SceneCanvas` props gain `shipVitals: Record<string, ShipVitals>`, `ownShipIds: Set<string>`, `selectedTokenId: string | null`, `onRotate: (tokenId: string, facing: number) => void`; `activeTokenId: string | null` becomes `activeTokenIds: Set<string>` (ship slot + its nested crew both pulse).
- Rotate hit-testing contract: handles carry `data-rotate="ccw" | "cw"` inside the token's `data-token-id` group; `onPointerDown` consumes them before any drag/pan branch.

- [ ] **Step 1: TokenGlyph.** Replace the component's props block and the derived-values block at the top of `apps/swdnd/src/panels/Tabletop/TokenGlyph.tsx`:

```tsx
export default function TokenGlyph({
  token, grid, ghost, draggable, at, vitals, showHp, dimmed, active, ship, facingDeg, showRotate,
}: {
  token: TokenDto;
  grid: GridConfig;
  /** Override render position (drag preview), map px. */
  at?: { x: number; y: number };
  ghost?: boolean;
  draggable?: boolean;
  vitals: TokenVitals;
  showHp: boolean;
  /** DM view of a hidden token. */
  dimmed?: boolean;
  /** This token's turn is currently active in the initiative order. */
  active?: boolean;
  /** Ship-bound vitals: hull drives the inner arc, shields the outer one. */
  ship?: ShipVitals | null;
  /** Bow-marker angle in screen degrees, or null for no marker. */
  facingDeg?: number | null;
  /** Show the ±60° rotation handles (selected + movable ship tokens). */
  showRotate?: boolean;
}) {
  const pos = at ?? hexToPixel({ q: token.q, r: token.r }, grid);
  const radius = grid.hexSize * 0.72 * token.scale;
  // Ships read hull/shields off the ship document; everyone else uses token/character vitals.
  const fraction = showHp
    ? (ship ? hpFraction(ship.hull, ship.maxHull) : hpFraction(vitals.hp, vitals.maxHp))
    : null;
  const shieldFraction = ship && showHp ? hpFraction(ship.shields, ship.maxShields) : null;
  // Band center sits clear of the HP arc (1.08r); band width/font follow rings.ts fractions.
  const ringR = radius * 1.45;
  const band = ringR * BAND_FRACTION;
  const ringFont = ringR * RING_FONT_FRACTION;
  const segments = statusSegments(ship ? shipStatusNames(ship) : vitals.conditions, ringR);
  const rotateR = radius * 1.5;
  const handleAt = (deg: number) => ({
    x: Math.cos((deg * Math.PI) / 180) * rotateR,
    y: Math.sin((deg * Math.PI) / 180) * rotateR,
  });
```

Add the imports at the top of the file:

```tsx
import { shipStatusNames, type ShipVitals } from '../../lib/shipVitals';
```

Then, immediately after the existing `{fraction != null && ( … )}` HP-arc block, insert the shields arc, the bow marker and the handles:

```tsx
      {shieldFraction != null && (
        // Shields ride OUTSIDE the hull arc: a depleted shield reads as a gap
        // around a still-full hull ring.
        <path
          d={hpArcPath(radius * 1.26, shieldFraction)}
          fill="none" stroke="#4dd0e1" strokeWidth={grid.hexSize * 0.07}
          strokeOpacity={0.95} strokeLinecap="round" pointerEvents="none"
        />
      )}
      {facingDeg != null && (
        <g transform={`rotate(${facingDeg})`} pointerEvents="none">
          <path
            d={`M ${radius * 1.02} 0 L ${radius * 0.66} ${-radius * 0.28} L ${radius * 0.66} ${radius * 0.28} Z`}
            fill={token.color} fillOpacity={0.95} stroke="#05070a" strokeWidth={1}
          />
        </g>
      )}
      {showRotate && facingDeg != null && ([
        ['ccw', facingDeg - 42, '⟲'] as const,
        ['cw', facingDeg + 42, '⟳'] as const,
      ]).map(([dir, deg, icon]) => {
        const p = handleAt(deg);
        return (
          <g key={dir} data-rotate={dir} style={{ cursor: 'pointer' }}>
            <circle cx={p.x} cy={p.y} r={grid.hexSize * 0.3} fill="#05070a" fillOpacity={0.8} stroke="#4dd0e1" strokeWidth={1.5} />
            <text
              x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central"
              fill="#e6f7ff" fontFamily="monospace" fontSize={grid.hexSize * 0.34}
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              {icon}
            </text>
          </g>
        );
      })}
```

- [ ] **Step 2: SceneCanvas props.** In `apps/swdnd/src/panels/Tabletop/SceneCanvas.tsx`, extend the imports:

```tsx
import { gridUnits, hexBlast, hexCorners, hexDistance, hexLine, hexToPixel, pixelToHex, type Hex } from '../../lib/hex';
import { tokenVisibility, showHpRing, isOwnToken } from '../../lib/visibility';
import { facingAngle, rotateFacing } from '../../lib/shipTokens';
import { tokenShipVitals, type ShipVitals } from '../../lib/shipVitals';
```

In the `Props` interface, replace `activeTokenId: string | null;` with, and add:

```tsx
  /** Ship-bound vitals by ship id (hull/shields/conditions rings). */
  shipVitals: Record<string, ShipVitals>;
  /** Ships this viewer crews — own-token fog exemption. */
  ownShipIds: Set<string>;
  /** The token whose editor is open; ship tokens then show rotation handles. */
  selectedTokenId: string | null;
  /** A ±60° rotation step was requested on a ship token. */
  onRotate: (tokenId: string, facing: number) => void;
  /** Tokens taking the current initiative turn (a ship slot pulses with its crew). */
  activeTokenIds: Set<string>;
```

and mirror both changes in the destructured parameter list of `export default function SceneCanvas({ … })`.

- [ ] **Step 3: Rotate hit-test.** In `onPointerDown`, immediately after the `if (e.button === 2) return;` line and the `setPointerCapture` try/catch, before the `if (fogBrush)` branch:

```tsx
    // Rotation handles live inside the token group: consume the gesture before
    // any drag/pan branch can claim it.
    const rotEl = (e.target as Element).closest('[data-rotate]');
    if (rotEl) {
      const rotId = rotEl.closest('[data-token-id]')?.getAttribute('data-token-id');
      const rotTok = tokens.find((t) => t.id === rotId);
      if (rotTok && canMove(rotTok)) {
        onRotate(rotTok.id, rotateFacing(rotTok.facing, rotEl.getAttribute('data-rotate') === 'cw' ? 1 : -1));
      }
      return;
    }
```

- [ ] **Step 4: Render ships.** Replace `renderToken`:

```tsx
  const renderToken = (t: TokenDto, dimmed: boolean) => {
    const localDrag = drag?.tokenId === t.id ? { x: drag.x, y: drag.y } : undefined;
    const remoteGhost = !localDrag && dragGhosts[t.id] ? dragGhosts[t.id] : undefined;
    const ship = tokenShipVitals(t, shipVitals);
    return (
      <TokenGlyph
        key={t.id}
        token={t}
        grid={g}
        at={localDrag ?? remoteGhost}
        ghost={!!remoteGhost}
        draggable={canMove(t)}
        vitals={tokenVitals(t, vitals)}
        showHp={showHpRing(t, isDm)}
        dimmed={dimmed}
        active={activeTokenIds.has(t.id)}
        ship={ship}
        facingDeg={t.ship_id ? facingAngle(t.facing, g) : null}
        showRotate={!!t.ship_id && t.id === selectedTokenId && canMove(t)}
      />
    );
  };
```

- [ ] **Step 5: Own-token fog exemption + unit-aware ruler.** In the main token group, replace the ownership line:

```tsx
          const ownToken = isOwnToken(t, { ownCharacterIds, ownShipIds });
          if (!isDm && fogOn && ownToken) return null;
          const vis = tokenVisibility(t, { isDm, revealed: effectiveRevealed, ownCharacterIds, ownShipIds });
```

In the above-fog own-token group, replace the filter and the `tokenVisibility` call:

```tsx
          {tokens
            .filter((t) => isOwnToken(t, { ownCharacterIds, ownShipIds }))
            .map((t) => {
              const vis = tokenVisibility(t, { isDm, revealed: effectiveRevealed, ownCharacterIds, ownShipIds });
```

In the ruler group, replace the distance/label lines:

```tsx
          const units = gridUnits(g);
          const dist = hexDistance(a, b) * units.per;
```

and the label text:

```tsx
                {dist} {units.label}
```

- [ ] **Step 6: Typecheck + suite**

Run: `cd apps/swdnd && bun run build` — expect ONE remaining error class: `panels/Tabletop/index.tsx` no longer satisfies `SceneCanvas`'s props (`activeTokenId` removed, five props missing). That is fixed in Task 10; if you want a green build at this commit, do Steps 1–2 of Task 10 first and commit them together.
Run: `bun test` — unchanged pass count.

- [ ] **Step 7: Commit**

```bash
git add apps/swdnd/src/panels/Tabletop/TokenGlyph.tsx apps/swdnd/src/panels/Tabletop/SceneCanvas.tsx
git commit -m "feat(swdnd): ship token rendering — shields over hull, bow marker, rotate handles"
```

---

### Task 10: map toolbar — space toggle, ship spawner, wider sizes

**Files:**
- Create: `apps/swdnd/src/panels/Tabletop/ShipSpawner.tsx`
- Modify: `apps/swdnd/src/panels/Tabletop/index.tsx`
- Modify: `apps/swdnd/src/panels/Tabletop/TokenEditor.tsx`

**Verification note:** UI-only task — verified by **typecheck + suite green + the Task 12 manual checklist**.

**Interfaces:**

*Consumes:* `useTabletop()`'s new `ships`, `shipVitals`, `ownShipIds`, and `actions.setSceneMode` / `spawnShip` / `loadShips` / `rotate` (Task 8); `gridUnits` from `../../lib/hex` (Task 4); the new `SceneCanvas` props (Task 9).

*Produces:*
- `export default function ShipSpawner({ ships, onSpawn, onClose }: { ships: { id: string; name: string; scale: number }[]; onSpawn: (shipId: string) => void; onClose: () => void }): JSX.Element`.
- `Tabletop` local state `shipDrawerOpen: boolean`.
- `TokenEditor` size `<select>` options widened to `[1, 2, 3, 4, 6, 8, 16]`, with the token's current value appended when it isn't on the list.

- [ ] **Step 1: Create `ShipSpawner.tsx`:**

```tsx
// apps/swdnd/src/panels/Tabletop/ShipSpawner.tsx — DM: drop a campaign ship onto the map.
export default function ShipSpawner({
  ships, onSpawn, onClose,
}: {
  ships: { id: string; name: string; scale: number }[];
  onSpawn: (shipId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="ht-panel flex flex-wrap items-center gap-2 p-2 text-[11px]">
      <span className="ht-label">Ships</span>
      {ships.length === 0 && (
        <span className="text-[10px] text-ht-muted">no starships in this campaign yet</span>
      )}
      {ships.map((s) => (
        <button
          key={s.id}
          type="button"
          className="ht-step"
          title={`spawn ${s.name} (${s.scale} hexes across)`}
          onClick={() => onSpawn(s.id)}
        >
          ⛴ {s.name} <span className="text-ht-muted">×{s.scale}</span>
        </button>
      ))}
      <button type="button" className="ml-auto ht-step" onClick={onClose}>✕ close</button>
    </div>
  );
}
```

- [ ] **Step 2: Wire `SceneCanvas`'s new props.** In `apps/swdnd/src/panels/Tabletop/index.tsx`, replace the `activeTokenId={…}` line in the `<SceneCanvas …>` element with:

```tsx
            shipVitals={t.shipVitals}
            ownShipIds={t.ownShipIds}
            selectedTokenId={selectedId}
            onRotate={(id, facing) => void t.actions.rotate(id, facing)}
            activeTokenIds={(() => {
              const e = t.initiative?.order[t.initiative.activeIndex];
              return new Set(e ? [e.tokenId, ...(e.crew ?? [])] : []);
            })()}
```

- [ ] **Step 3: Space-mode toggle + spawner button.** Add the imports:

```tsx
import { gridUnits } from '../../lib/hex';
import ShipSpawner from './ShipSpawner';
```

Add the state next to the other `useState` calls:

```tsx
  const [shipDrawerOpen, setShipDrawerOpen] = useState(false);
```

Replace the scene readout span so it reports scale through `gridUnits` and shows the mode:

```tsx
        {t.scene && (
          <span className="text-[10px] text-ht-muted">
            {t.scene.mode === 'space' ? '✦ space' : '⛰ ground'} · {gridUnits(t.scene.grid_json).per}{' '}
            {gridUnits(t.scene.grid_json).label}/hex · {t.tokens.length} tokens
          </span>
        )}
```

In the DM toolbar (inside `{t.isDm && (…)}`, in the `{t.scene && (<>…</>)}` group), add after the `⬡ grid` button:

```tsx
                <button
                  type="button"
                  title="space encounter — 50 ft/hex, ship tokens and space conditions"
                  className={`ht-step ${t.scene.mode === 'space' ? 'ht-tile-active' : ''}`}
                  onClick={() => void t.actions.setSceneMode(t.scene!.id, t.scene!.mode === 'space' ? 'ground' : 'space')}
                >
                  ✦ space
                </button>
                <button
                  type="button"
                  title="spawn a campaign starship as a token"
                  className={`ht-step ${shipDrawerOpen ? 'ht-tile-active' : ''}`}
                  onClick={() => { t.actions.loadShips(); setShipDrawerOpen((v) => !v); }}
                >
                  ⛴ ship
                </button>
```

and render the drawer just above the `{t.isDm && selected && (…)}` TokenEditor block:

```tsx
      {t.isDm && shipDrawerOpen && (
        <div className="mx-2 mb-2">
          <ShipSpawner
            ships={t.ships}
            onSpawn={(id) => void t.actions.spawnShip(id)}
            onClose={() => setShipDrawerOpen(false)}
          />
        </div>
      )}
```

- [ ] **Step 4: AoE size labels in grid units.** Replace the template-size `<select>`'s options:

```tsx
                {[1, 2, 3, 4, 6].map((n) => (
                  <option key={n} value={n}>
                    {n} hex · {n * gridUnits(t.scene!.grid_json).per} {gridUnits(t.scene!.grid_json).label}
                  </option>
                ))}
```

- [ ] **Step 5: Wider footprints in `TokenEditor`.** In `apps/swdnd/src/panels/Tabletop/TokenEditor.tsx`, replace the three hardcoded `<option>` elements in the size select:

```tsx
          {(() => {
            const sizes = [1, 2, 3, 4, 6, 8, 16];
            const opts = sizes.includes(token.scale) ? sizes : [...sizes, token.scale].sort((a, b) => a - b);
            return opts.map((n) => <option key={n} value={n}>{n}</option>);
          })()}
```

- [ ] **Step 6: Typecheck + suite**

Run: `cd apps/swdnd && bun run build` — clean.
Run: `bun test` — unchanged pass count.

- [ ] **Step 7: Commit**

```bash
git add apps/swdnd/src/panels/Tabletop/ShipSpawner.tsx apps/swdnd/src/panels/Tabletop/index.tsx apps/swdnd/src/panels/Tabletop/TokenEditor.tsx
git commit -m "feat(swdnd): space-mode toggle, ship spawner and unit-aware map labels"
```

---

### Task 11: ship conditions menu + grouped-initiative UI

**Files:**
- Create: `apps/swdnd/src/panels/Tabletop/ShipConditionsMenu.tsx`
- Modify: `apps/swdnd/src/panels/Tabletop/index.tsx`
- Modify: `apps/swdnd/src/panels/Tabletop/InitiativeEditor.tsx`
- Modify: `apps/swdnd/src/panels/Tabletop/InitiativeStrip.tsx`

**Verification note:** UI-only task — verified by **typecheck + suite green + the Task 12 manual checklist**. All the state transitions it drives (`toggleShipCondition`, `setSystemDamage`, `groupCrew`, `ungroupCrew`) are unit-tested in Tasks 5–6.

**Interfaces:**

*Consumes:* `SHIP_CONDITIONS`, `MAX_SYSTEM_DAMAGE` from `../../lib/shipTokens`; `toggleShipCondition`, `setSystemDamage` from `../../lib/shipPlay`; `groupCrew`, `ungroupCrew` from `../../lib/initiative`; `conditionColor` from `../../lib/rings`; `t.actions.setShipPlay`, `t.shipVitals`, `t.ownShipIds` from the hook.

*Produces:*
- `export default function ShipConditionsMenu({ name, vitals, onToggle, onSystemDamage }: { name: string; vitals: ShipVitals | null; onToggle: (condition: string) => void; onSystemDamage: (value: number) => void }): JSX.Element`.
- `InitiativeEditor` props gain nothing (it already receives `tokens` and `onChange`); it renders a `crew of ▾` select per non-ship entry and an `⇱ ungroup` button per crewed ship entry.
- `InitiativeStrip` props gain `nameOf: (tokenId: string) => string` for rendering nested crew names.

- [ ] **Step 1: Create `ShipConditionsMenu.tsx`:**

```tsx
// apps/swdnd/src/panels/Tabletop/ShipConditionsMenu.tsx — space vocabulary for a
// ship token. Writes land on the SHIP document (ShipPlayState), never on
// token.conditions_json, so every token of that ship and the ShipSheet agree.
import { conditionColor } from '../../lib/rings';
import { MAX_SYSTEM_DAMAGE, SHIP_CONDITIONS } from '../../lib/shipTokens';
import type { ShipVitals } from '../../lib/shipVitals';

export default function ShipConditionsMenu({
  name, vitals, onToggle, onSystemDamage,
}: {
  name: string;
  vitals: ShipVitals | null;
  onToggle: (condition: string) => void;
  onSystemDamage: (value: number) => void;
}) {
  const active = new Set(vitals?.conditions ?? []);
  const sys = vitals?.systemDamage ?? 0;
  return (
    <>
      <div className="ht-label px-2 py-1">{name} · ship status</div>
      {!vitals && <div className="px-2 py-1 text-[10px] text-ht-muted">loading ship…</div>}
      <div className="max-h-56 overflow-y-auto">
        {SHIP_CONDITIONS.map((c) => (
          <button
            key={c} type="button" disabled={!vitals}
            className="flex w-full items-center gap-2 rounded px-2 py-0.5 text-left hover:bg-white/5 disabled:opacity-40"
            onClick={() => onToggle(c)}
          >
            <span style={{ color: conditionColor(c) }}>{active.has(c) ? '◈' : '○'}</span>
            <span className={active.has(c) ? 'text-ht-bright' : 'text-ht-text'}>{c}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 border-t border-ht-line px-2 py-1">
        <span className="text-[10px] text-ht-muted">system damage</span>
        <button
          type="button" className="ht-step" disabled={!vitals || sys <= 0}
          title="one less damaged system" onClick={() => onSystemDamage(sys - 1)}
        >
          −
        </button>
        <span className="text-ht-bright">{sys}</span>
        <button
          type="button" className="ht-step" disabled={!vitals || sys >= MAX_SYSTEM_DAMAGE}
          title="one more damaged system" onClick={() => onSystemDamage(sys + 1)}
        >
          +
        </button>
        <span className="text-[10px] text-ht-muted">/ {MAX_SYSTEM_DAMAGE}</span>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Route the context menu.** In `apps/swdnd/src/panels/Tabletop/index.tsx`, add:

```tsx
import { setSystemDamage, toggleShipCondition } from '../../lib/shipPlay';
import ShipConditionsMenu from './ShipConditionsMenu';
```

Open the menu for crew players too — replace the `onTokenContextMenu` prop on `<SceneCanvas>`:

```tsx
            onTokenContextMenu={(id, x, y) => {
              const tok = t.tokens.find((x2) => x2.id === id);
              if (!tok) return;
              // DMs get every token; a player only their own crewed ship.
              if (t.isDm || (!!tok.ship_id && t.ownShipIds.has(tok.ship_id))) setCtxMenu({ tokenId: id, x, y });
            }}
```

Replace the menu block's guard and body — change `{t.isDm && ctxMenu && (() => {` to `{ctxMenu && (() => {` and replace the panel's inner content (from `<div className="ht-label px-2 py-1">{tok.name} · conditions</div>` through the closing `)}` of the character/NPC branch) with:

```tsx
              {tok.ship_id ? (
                <ShipConditionsMenu
                  name={tok.name}
                  vitals={t.shipVitals[tok.ship_id] ?? null}
                  onToggle={(c) => void t.actions.setShipPlay(tok.ship_id!, (doc) => toggleShipCondition(doc, c))}
                  onSystemDamage={(n) => void t.actions.setShipPlay(tok.ship_id!, (doc) => setSystemDamage(doc, n))}
                />
              ) : !t.isDm ? null : (
                <>
                  <div className="ht-label px-2 py-1">{tok.name} · conditions</div>
                  {tok.character_id ? (
                    <div className="px-2 py-1 text-ht-muted">set from the character sheet</div>
                  ) : (
                    <div className="max-h-56 overflow-y-auto">
                      {SW5E_CONDITIONS.map((c) => {
                        const active = tok.conditions_json.includes(c);
                        return (
                          <button
                            key={c} type="button"
                            className="flex w-full items-center gap-2 rounded px-2 py-0.5 text-left hover:bg-white/5"
                            onClick={() => void t.actions.editToken(tok.id, {
                              conditions: active
                                ? tok.conditions_json.filter((x) => x !== c)
                                : [...tok.conditions_json, c],
                            })}
                          >
                            <span style={{ color: conditionColor(c) }}>{active ? '◈' : '○'}</span>
                            <span className={active ? 'text-ht-bright' : 'text-ht-text'}>{c}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
```

- [ ] **Step 3: Strip shows nested crew.** In `apps/swdnd/src/panels/Tabletop/InitiativeStrip.tsx`, add `nameOf` to the props and render crew inside the slot:

```tsx
export default function InitiativeStrip({
  initiative, isDm, nameOf, onNext, onPrev, onEnd,
}: {
  initiative: Initiative;
  isDm: boolean;
  /** Resolve a nested crew token id to a display name. */
  nameOf: (tokenId: string) => string;
  onNext: () => void;
  onPrev: () => void;
  onEnd: () => void;
}) {
```

and inside the entry span, after the roll:

```tsx
          {e.crew?.length ? (
            <span className="text-ht-muted"> ⟨{e.crew.map(nameOf).join(', ')}⟩</span>
          ) : null}
```

In `index.tsx`, pass it:

```tsx
          nameOf={(id) => t.tokens.find((tok) => tok.id === id)?.name ?? '—'}
```

- [ ] **Step 4: Editor groups and ungroups.** In `apps/swdnd/src/panels/Tabletop/InitiativeEditor.tsx`, extend the import from `'../../lib/initiative'` with `groupCrew, ungroupCrew`, and replace the per-entry `<span>` body with:

```tsx
          {initiative.order.map((e) => {
            const tok = tokens.find((x) => x.id === e.tokenId);
            const ships = initiative.order.filter((s) => s.tokenId !== e.tokenId
              && tokens.find((x) => x.id === s.tokenId)?.ship_id);
            return (
              <span key={e.tokenId} className="flex items-center gap-1">
                <span className="text-ht-bright">{e.name}</span>
                <input
                  className="w-10 border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none"
                  type="number"
                  value={drafts[e.tokenId] ?? String(e.roll)}
                  onChange={(ev) => setDrafts((d) => ({ ...d, [e.tokenId]: ev.target.value }))}
                  onBlur={() => commitRoll(e.tokenId)}
                  onKeyDown={(ev) => ev.key === 'Enter' && commitRoll(e.tokenId)}
                />
                {tok?.ship_id && e.crew?.length ? (
                  <button
                    type="button" className="ht-step text-[10px]"
                    title="split the crew back out into their own turns"
                    onClick={() => onChange(ungroupCrew(initiative, e.tokenId, (id) => tokens.find((x) => x.id === id)?.name ?? id))}
                  >
                    ⇱ {e.crew.length} crew
                  </button>
                ) : null}
                {!tok?.ship_id && ships.length > 0 && (
                  <select
                    className="border-b border-ht-line bg-transparent text-[10px] text-ht-muted outline-none"
                    title="fold this creature into a ship's turn — the lowest crew roll sets the ship's place"
                    value=""
                    onChange={(ev) => ev.target.value && onChange(groupCrew(initiative, ev.target.value, [e.tokenId]))}
                  >
                    <option value="">crew of…</option>
                    {ships.map((s) => <option key={s.tokenId} value={s.tokenId}>{s.name}</option>)}
                  </select>
                )}
                <button
                  type="button" className="text-[10px] text-ht-muted"
                  onClick={() => onChange(removeEntry(initiative, e.tokenId))}
                >
                  ✕
                </button>
              </span>
            );
          })}
```

- [ ] **Step 5: Typecheck + suite**

Run: `cd apps/swdnd && bun run build` — clean.
Run: `bun test` — unchanged pass count.

- [ ] **Step 6: Commit**

```bash
git add apps/swdnd/src/panels/Tabletop/ShipConditionsMenu.tsx apps/swdnd/src/panels/Tabletop/index.tsx apps/swdnd/src/panels/Tabletop/InitiativeEditor.tsx apps/swdnd/src/panels/Tabletop/InitiativeStrip.tsx
git commit -m "feat(swdnd): ship condition menu and grouped-initiative controls"
```

---

### Task 12: full verification + live walkthrough

**Files:**
- Modify (temporarily): `.claude/launch.json` — MUST be reverted afterwards
- Modify: vault docs in `/Users/asherc/Documents/Mount Tantiss/ashercarlow.com/swdnd/`

- [ ] **Step 1: Full suite + typecheck**

Run: `bun test` (repo root — safe, `NODE_ENV=test` routes to a temp DB) → all pass, count ≥ the pre-branch baseline plus the ~45 assertions added here.
Run: `cd apps/swdnd && bun run build` → clean.
Run: `git status --short` → only the files this plan names.

- [ ] **Step 2: Migration sanity on a real DB.** Run the backend once against a scratch DB and confirm 007 applies and is idempotent:

```bash
SWDND_DB_PATH=/tmp/swdnd-migrate-check.sqlite bun run apps/backend/src/index.ts &
sleep 2; kill %1
sqlite3 /tmp/swdnd-migrate-check.sqlite "SELECT version FROM schema_migrations ORDER BY version;"
sqlite3 /tmp/swdnd-migrate-check.sqlite "PRAGMA table_info(token);" | grep -E 'ship_id|facing'
sqlite3 /tmp/swdnd-migrate-check.sqlite "PRAGMA table_info(scene);" | grep mode
```

Expect `007_swdnd_space_scenes` listed once, `ship_id`/`facing` on `token`, `mode` on `scene`. Start it a second time and confirm no re-application and no error.

- [ ] **Step 3: Auth-enforced servers for the walkthrough.** Edit `.claude/launch.json`'s backend entry to `"runtimeExecutable": "sh", "runtimeArgs": ["-c", "ASHERCARLOW_AUTH_TOKEN=dm-secret bun start"]`, restart via the preview tools, then seed via curl: a campaign, a player + token, a character owned by that player, a starship with that character on its crew, and an active scene. DM login via `fetch('/auth/login', {credentials:'include', …})`.

Browser-automation reminders: React inputs need the native value setter + an `input` event; synthetic pointerdown/pointerup need a `setTimeout` between them; prefer DOM `.click()` over ref-clicks; `credentials:'omit'` for anonymous API checks.

- [ ] **Step 4: DM walkthrough checklist**

- `/map/<cid>` → toolbar shows `⛰ ground · 5 ft/hex`. Click `✦ space` → readout flips to `✦ space · 50 ft/hex` **in one PATCH** (check the network panel: a single `PATCH /swdnd/scenes/…`), and the ruler now reads `150 ft` across three hexes.
- `⛴ ship` → spawner lists the campaign's ships with `×N` spans; spawn one → a friendly token appears at a free hex, sized to its footprint, with a bow marker.
- Select the ship token → `⟲`/`⟳` handles flank the bow. Click `⟳` six times → the marker walks the six hex directions and returns to start; a second browser tab (player) sees each rotation live.
- The ship token's rings: outer cyan arc = shields, inner arc = hull. Change hull on the ShipSheet in a split panel → the map ring updates live without a reload.
- Right-click the ship token → space vocabulary (Ionized … Tractored, the same strings the ShipSheet offers) + a `0/6` system-damage stepper. Toggle `Slowed 1`, then `Slowed 3` → only `Slowed 3` remains (family replacement, same as the sheet's conditions menu). Toggle `Ionized` and set damage to 3 → the status ring shows `Ionized` and `sys 3`; the ShipSheet shows the same; `token.conditions_json` stays `[]` (check via `GET /swdnd/scenes/<sid>/tokens`).
- Right-click a plain NPC token → the old SW5E condition list, unchanged. Right-click a character token → "set from the character sheet", unchanged.
- `♞ init` → `⚔ start from tokens`, enter rolls, set two characters as `crew of… <ship>` → they vanish from the strip into the ship's slot, whose roll becomes the lower of the two; the strip shows `Krayt 9 ⟨Pilot, Gunner⟩`. `▶ next` treats the ship as one turn; the ship token and both crew tokens pulse. `⇱ 2 crew` splits them back out.
- Fog: paint over the ship → the DM still sees it dimmed; the player tab sees their crewed ship but not the hostile one.
- Switch the scene back to `⛰ ground` → readout returns to 5 ft/hex, ship tokens remain (mode is a UI affordance, not a data purge).

- [ ] **Step 5: Player walkthrough checklist (second tab, no admin cookie)**

- `/map/<cid>?token=<playerToken>` → the crewed ship token is draggable (move lands, no 403) and rotatable; a ship the player does not crew is not.
- Right-click the crewed ship → the ship status menu opens and writes succeed (crew edits everything); right-click a hostile token → no menu.
- Revoke the crew row (`DELETE /swdnd/starships/<id>/crew`) and reload → the ship token is no longer draggable and the move PATCH returns 403.

- [ ] **Step 6: Legacy-data check.** Against the dev DB, hand-write a pre-space scene document and confirm nothing throws:

```bash
sqlite3 ./data/swdnd.sqlite "UPDATE scene SET mode = NULL, grid_json = '{\"orientation\":\"pointy\",\"hexSize\":32,\"originX\":0,\"originY\":0}', initiative_json = '{\"order\":[{\"tokenId\":\"x\",\"name\":\"X\",\"roll\":5}],\"activeIndex\":7,\"round\":0}' WHERE is_active = 1;"
```

Reload the map → mode reads ground, the ruler falls back to 5 ft/hex, the strip renders with the active index clamped and round 1.

- [ ] **Step 7: REVERT `.claude/launch.json`**, restart the backend in dev mode, and confirm `git status` shows it unmodified.

- [ ] **Step 8: Vault docs.** In `/Users/asherc/Documents/Mount Tantiss/ashercarlow.com/swdnd/`:
  - `Features/Tabletop & Map.md` — space mode (50 ft/hex via `unitsPerHex`), ship tokens, facing, footprints, ship conditions on the ship, grouped initiative.
  - `Features/Starships.md` (created by sub-project 1) — cross-link the map integration; note that crew may move/rotate their ship's token.
  - `Roadmap.md` / `Architecture.md` — tick sub-project 3; restate the out-of-scope list (no movement validation, no firing arcs, no LoS, no auto-advance, no ×10 scale conversion, no server-side fog).

- [ ] **Step 9:** Run superpowers:finishing-a-development-branch → 4-option menu (on "2": push + PR).

---
