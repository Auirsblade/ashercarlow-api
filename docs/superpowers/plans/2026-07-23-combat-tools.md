# Tabletop & Map Phase 3 — Combat Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The four combat tools — shared hex ruler, pings, persisted AoE templates (blast / 60° cone / line), and an on-map initiative tracker — completing the Tabletop & Map feature.

**Architecture:** Phase-1/2 pattern. Templates are REST+SQLite truth (new `template` table, migration 003) broadcast as `template:*` events; ruler and pings are ephemeral WS relays (the foundation's WS handler already relays arbitrary client frames to the rest of the room — zero backend change). Initiative persists in the existing `scene.initiative_json` via a DM-only PATCH riding `scene:updated`. Pure modules: `lib/templates.ts` (footprints + direction snapping), `lib/initiative.ts` (turn/round ops); `mapState.ts` grows a `templates` map.

**Tech stack:** Bun + Hono + `@hono/zod-openapi`; React 19 + Vite + Tailwind v4; `bun test`; `cd apps/swdnd && bun run build` is the real typecheck (`noUnusedLocals` on).

**Spec:** `docs/superpowers/specs/2026-07-23-tabletop-map-design.md` §1 (combat tools row), §2 (initiative_json), §3 (template/initiative routes + ephemeral events), §4, §5.

**Access decisions (spec §3):** template create/delete = **any authed campaign member** (admin or campaign-scoped player token; trusted table — any member may delete any template); DM-only: clear-all templates, initiative PATCH. New helper `assertCampaignMember` in access.ts. `selfGated` gains the suffix `/templates` and prefix `/swdnd/templates` — so the clear-all route (also ending in `/templates`) must `assertAdmin` in-handler.

**Ephemeral envelope shapes** (client↔client via the relay; never persisted):
- `{ type: 'ping', room, payload: { id: string, x: number, y: number } }` — map-pixel point; `id` unique per ping (peer uuid + counter).
- `{ type: 'ruler', room, payload: { peer: string, a: {q,r}, b: {q,r}, done: boolean } }` — hex endpoints; `done: true` clears that peer's ruler.

---

## File structure

| File | Role |
|---|---|
| `apps/backend/src/db/migrations/swdnd/003_swdnd_templates.sql` + `db/swdnd/index.ts` | `template` table |
| `apps/backend/src/routes/swdnd/templates.ts` (+`.test.ts`) | list/create/delete/clear routes + broadcasts |
| `apps/backend/src/routes/swdnd/access.ts` | `assertCampaignMember` |
| `apps/backend/src/routes/swdnd/index.ts` | selfGated widening + route registration |
| `apps/backend/src/routes/swdnd/scenes.ts` (+`scenes.test.ts`) | initiative PATCH route |
| `apps/swdnd/src/lib/templates.ts` (+`.test.ts`) | `templateHexes`, `dirFromPoint` |
| `apps/swdnd/src/lib/initiative.ts` (+`.test.ts`) | turn/round/entry ops |
| `apps/swdnd/src/lib/mapState.ts` (+`.test.ts`) | `templates` in state + `template:*` events |
| `apps/swdnd/src/lib/scenes.ts` | `TemplateDto`, template REST wrappers, `patchInitiative` |
| `apps/swdnd/src/hooks/useTabletop.ts` | templates load, ping/ruler send+receive, initiative action, peer id |
| `apps/swdnd/src/panels/Tabletop/SceneCanvas.tsx` | mode-based interactions, template/ephemeral layers |
| `apps/swdnd/src/panels/Tabletop/TokenGlyph.tsx` | active-turn glow |
| `apps/swdnd/src/panels/Tabletop/InitiativeStrip.tsx`, `InitiativeEditor.tsx` (new) | tracker UI |
| `apps/swdnd/src/panels/Tabletop/index.tsx` | tools cluster (everyone) + DM initiative/clear controls |

---

### Task 1: Migration 003 + template routes + `assertCampaignMember`

**Files:**
- Create: `apps/backend/src/db/migrations/swdnd/003_swdnd_templates.sql`
- Modify: `apps/backend/src/db/swdnd/index.ts` (register migration — match the existing `{ version: '00N_name', file }` convention exactly)
- Modify: `apps/backend/src/routes/swdnd/access.ts`
- Modify: `apps/backend/src/routes/swdnd/index.ts`
- Create: `apps/backend/src/routes/swdnd/templates.ts`
- Test: `apps/backend/src/routes/swdnd/templates.test.ts`

- [ ] **Step 1: Migration**

```sql
-- 003_swdnd_templates.sql — AoE templates (phase 3 of Tabletop & Map).
CREATE TABLE template (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL REFERENCES scene(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('blast', 'cone', 'line')),
  q INTEGER NOT NULL,
  r INTEGER NOT NULL,
  dir INTEGER NOT NULL DEFAULT 0,      -- cone: hex direction 0-5
  size INTEGER NOT NULL DEFAULT 1,     -- blast: radius; cone: length; line: unused
  q2 INTEGER,                          -- line: endpoint hex
  r2 INTEGER,
  color TEXT NOT NULL DEFAULT '#c792ea',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_template_scene ON template(scene_id);
```

Register it in `db/swdnd/index.ts` following the 001/002 entries.

- [ ] **Step 2: `assertCampaignMember` in access.ts** (below `assertTokenMoveAccess`, same style):

```ts
/**
 * Any authed member of the campaign: admin (bearer/cookie) or a player token
 * belonging to that campaign. Dev mode (env token unset) passes everything.
 */
export function assertCampaignMember(c: Context, campaignId: string): void {
  if (!process.env.ASHERCARLOW_AUTH_TOKEN) return;
  if (isAdmin(c)) return;
  const player = resolvePlayerByToken(playerTokenFrom(c));
  if (player && player.campaign_id === campaignId) return;
  throw new HTTPException(403, { message: 'Not a member of this campaign' });
}
```

(`isAdmin` is file-local in access.ts — same file, fine.)

- [ ] **Step 3: selfGated widening** in `routes/swdnd/index.ts` — add two clauses with a comment:

```ts
    path.startsWith('/swdnd/templates') || // member-gated delete in-handler
    path.endsWith('/templates') ||         // member-gated create; clear-all asserts admin in-handler
```

- [ ] **Step 4: Failing tests** — `templates.test.ts`, following `tokens.test.ts`'s fixture conventions exactly (env delete + table resets in `beforeAll` — add `DELETE FROM template;` first, before `DELETE FROM scene;`; the shared-db import style; the `withAuthEnv` wrapper if present). Cases:

```ts
// 1. POST /swdnd/scenes/:id/templates creates a blast; response has id/kind/q/r/size; GET lists it.
// 2. cone requires dir 0-5 (dir: 9 -> 400); line stores q2/r2.
// 3. auth matrix (with ASHERCARLOW_AUTH_TOKEN set):
//    - POST with a valid player token of the campaign -> 201
//    - POST with a player token from ANOTHER campaign -> 403
//    - POST with no auth -> 403
//    - DELETE /swdnd/templates/:id with the other-campaign token -> 403; with member token -> 200
//    - DELETE /swdnd/scenes/:id/templates (clear-all) with player token -> 403; with bearer -> 200
// 4. DELETE clear-all removes all templates for the scene (GET returns []).
```

Write them concretely against the fixtures; run → expect 404s/failures (routes missing).

- [ ] **Step 5: Implement `templates.ts`** (mirror `tokens.ts` structure — zod schemas, `rowOut`, `createRoute` configs, register function):

```ts
// apps/backend/src/routes/swdnd/templates.ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { swdndDb } from '../../db/swdnd';
import { publishToRoom, roomForCampaign } from '../../lib/swdnd-realtime';
import { assertAdmin, assertCampaignMember } from './access';
import { getSceneRow } from './scenes';

const Template = z.object({
  id: z.string(), scene_id: z.string(),
  kind: z.enum(['blast', 'cone', 'line']),
  q: z.number(), r: z.number(), dir: z.number(), size: z.number(),
  q2: z.number().nullable(), r2: z.number().nullable(),
  color: z.string(), created_at: z.string(),
}).openapi('SwdndTemplate');

const PostBody = z.object({
  kind: z.enum(['blast', 'cone', 'line']),
  q: z.number().int(), r: z.number().int(),
  dir: z.number().int().min(0).max(5).optional(),
  size: z.number().int().min(0).max(20).optional(),
  q2: z.number().int().optional(), r2: z.number().int().optional(),
  color: z.string().optional(),
}).openapi('SwdndPostTemplate');

const ErrorBody = z.object({ message: z.string() });

interface TemplateRow {
  id: string; scene_id: string; kind: string; q: number; r: number; dir: number;
  size: number; q2: number | null; r2: number | null; color: string; created_at: string;
}

const getRow = (id: string): TemplateRow | null =>
  swdndDb.query('SELECT * FROM template WHERE id = ?').get(id) as TemplateRow | null;

const listRoute = createRoute({
  method: 'get', path: '/swdnd/scenes/{id}/templates', tags: ['swdnd'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Templates', content: { 'application/json': { schema: z.array(Template) } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const createRouteDef = createRoute({
  method: 'post', path: '/swdnd/scenes/{id}/templates', tags: ['swdnd'],
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: PostBody } } } },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: Template } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: ErrorBody } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const deleteRoute = createRoute({
  method: 'delete', path: '/swdnd/templates/{id}', tags: ['swdnd'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const clearRoute = createRoute({
  method: 'delete', path: '/swdnd/scenes/{id}/templates', tags: ['swdnd'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Cleared', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

export function registerTemplateRoutes(app: OpenAPIHono): void {
  app.openapi(listRoute, (c) => {
    const { id } = c.req.valid('param');
    if (!getSceneRow(id)) throw new HTTPException(404, { message: 'Scene not found' });
    const rows = swdndDb.query('SELECT * FROM template WHERE scene_id = ? ORDER BY created_at').all(id) as TemplateRow[];
    return c.json(rows, 200);
  });

  app.openapi(createRouteDef, (c) => {
    const { id } = c.req.valid('param');
    const b = c.req.valid('json');
    const scene = getSceneRow(id);
    if (!scene) throw new HTTPException(404, { message: 'Scene not found' });
    assertCampaignMember(c, scene.campaign_id);
    if (b.kind === 'line' && (b.q2 == null || b.r2 == null)) {
      throw new HTTPException(400, { message: 'line templates need q2/r2' });
    }
    const now = new Date().toISOString();
    const tid = crypto.randomUUID();
    swdndDb.run(
      `INSERT INTO template (id, scene_id, kind, q, r, dir, size, q2, r2, color, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tid, id, b.kind, b.q, b.r, b.dir ?? 0, b.size ?? 1, b.q2 ?? null, b.r2 ?? null, b.color ?? '#c792ea', now],
    );
    const row = getRow(tid)!;
    const room = roomForCampaign(scene.campaign_id);
    publishToRoom(room, { type: 'template:created', room, payload: row });
    return c.json(row, 201);
  });

  app.openapi(deleteRoute, (c) => {
    const { id } = c.req.valid('param');
    const row = getRow(id);
    if (!row) throw new HTTPException(404, { message: 'Template not found' });
    const scene = getSceneRow(row.scene_id)!;
    assertCampaignMember(c, scene.campaign_id);
    swdndDb.run('DELETE FROM template WHERE id = ?', [id]);
    const room = roomForCampaign(scene.campaign_id);
    publishToRoom(room, { type: 'template:deleted', room, payload: { id } });
    return c.json({ ok: true }, 200);
  });

  app.openapi(clearRoute, (c) => {
    const { id } = c.req.valid('param');
    const scene = getSceneRow(id);
    if (!scene) throw new HTTPException(404, { message: 'Scene not found' });
    assertAdmin(c); // clear-all is DM-only even though the path is selfGated-exempt
    swdndDb.run('DELETE FROM template WHERE scene_id = ?', [id]);
    const room = roomForCampaign(scene.campaign_id);
    publishToRoom(room, { type: 'template:cleared', room, payload: { sceneId: id } });
    return c.json({ ok: true }, 200);
  });
}
```

Check `getSceneRow`'s exported signature/row shape in scenes.ts and `assertAdmin`'s import path before writing. Register `registerTemplateRoutes` in `routes/swdnd/index.ts` next to the others.

- [ ] **Step 6: Run** `bun test apps/backend` — all pass (was 48 at phase-2 close; expect +new).

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/db/migrations/swdnd/003_swdnd_templates.sql apps/backend/src/db/swdnd/index.ts \
  apps/backend/src/routes/swdnd/templates.ts apps/backend/src/routes/swdnd/templates.test.ts \
  apps/backend/src/routes/swdnd/access.ts apps/backend/src/routes/swdnd/index.ts
git commit -m "feat(swdnd): AoE template table and member-gated routes"
```

---

### Task 2: Initiative PATCH route

**Files:**
- Modify: `apps/backend/src/routes/swdnd/scenes.ts`
- Test: `apps/backend/src/routes/swdnd/scenes.test.ts` (append)

- [ ] **Step 1: Failing tests** (existing fixture style):

```ts
describe('initiative', () => {
  it('PATCH /swdnd/scenes/:id/initiative sets and clears the tracker', async () => {
    const sc = await (await app.request(`/swdnd/campaigns/${campaignId}/scenes`, {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name: 'Init' }),
    })).json();
    const init = { order: [{ tokenId: 't1', name: 'A', roll: 18 }, { tokenId: 't2', name: 'B', roll: 11 }], activeIndex: 0, round: 1 };
    let res = await app.request(`/swdnd/scenes/${sc.id}/initiative`, {
      method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ initiative: init }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).initiative_json).toEqual(init);

    res = await app.request(`/swdnd/scenes/${sc.id}/initiative`, {
      method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ initiative: null }),
    });
    expect((await res.json()).initiative_json).toBeNull();
  });

  it('404s on unknown scene', async () => {
    const res = await app.request('/swdnd/scenes/nope/initiative', {
      method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ initiative: null }),
    });
    expect(res.status).toBe(404);
  });
});
```

Adapt fixture names to the file's actual helpers. Run → fail (404 route missing).

- [ ] **Step 2: Implement** in scenes.ts (beside the fog route; same style — `broadcastScene` helper, `security` annotation like other DM-only mutations):

```ts
const InitiativeEntry = z.object({ tokenId: z.string(), name: z.string(), roll: z.number() });
const Initiative = z.object({
  order: z.array(InitiativeEntry),
  activeIndex: z.number().int().min(0),
  round: z.number().int().min(1),
}).openapi('SwdndInitiative');
const InitiativeBody = z.object({ initiative: Initiative.nullable() }).openapi('SwdndPatchInitiative');

const initiativeRoute = createRoute({
  method: 'patch', path: '/swdnd/scenes/{id}/initiative', tags: ['swdnd'],
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: InitiativeBody } } } },
  responses: {
    200: { description: 'Updated scene', content: { 'application/json': { schema: Scene } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});
```

Handler: 404 when `getSceneRow` misses; `UPDATE scene SET initiative_json = ?, updated_at = ? WHERE id = ?` with `initiative === null ? null : JSON.stringify(initiative)`; `broadcastScene(row, 'scene:updated')`; return `sceneOut`. Note: `sceneOut` must parse `initiative_json` (it stores `unknown | null`) — check how it currently handles the column (phase 1 defined it; if it doesn't `JSON.parse` the column, fix `sceneOut` so the API returns the object, and confirm no existing test asserts the raw string). The path stays blanket-gated (doesn't match any selfGated clause — `/initiative` suffix isn't exempt) → DM-only for free.

- [ ] **Step 3: Run** `bun test apps/backend` — green.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/routes/swdnd/scenes.ts apps/backend/src/routes/swdnd/scenes.test.ts
git commit -m "feat(swdnd): DM initiative tracker route"
```

---

### Task 3: `lib/templates.ts` — footprints + direction snapping

**Files:**
- Create: `apps/swdnd/src/lib/templates.ts`
- Test: `apps/swdnd/src/lib/templates.test.ts`
- Modify: `apps/swdnd/src/lib/scenes.ts` (add `TemplateDto` — Task 6 adds the wrappers, but the type lives with the other DTOs and this module needs it now)

- [ ] **Step 1: Add the DTO** to `lib/scenes.ts`:

```ts
export interface TemplateDto {
  id: string; scene_id: string; kind: 'blast' | 'cone' | 'line';
  q: number; r: number; dir: number; size: number;
  q2: number | null; r2: number | null; color: string; created_at: string;
}
```

- [ ] **Step 2: Failing tests**

```ts
// apps/swdnd/src/lib/templates.test.ts
import { describe, expect, it } from 'bun:test';
import { dirFromPoint, templateHexes } from './templates';
import type { TemplateDto } from './scenes';
import type { GridConfig } from './hex';

const tpl = (over: Partial<TemplateDto>): TemplateDto => ({
  id: 'x', scene_id: 's', kind: 'blast', q: 0, r: 0, dir: 0, size: 1,
  q2: null, r2: null, color: '#fff', created_at: '', ...over,
});
const pointy: GridConfig = { orientation: 'pointy', hexSize: 32, originX: 0, originY: 0, unitsPerHex: 5, unitLabel: 'ft' };
const flat: GridConfig = { ...pointy, orientation: 'flat' };

describe('templateHexes', () => {
  it('blast radius 1 = 7 hexes incl. center', () => {
    const h = templateHexes(tpl({ kind: 'blast', size: 1 }));
    expect(h.length).toBe(7);
    expect(h).toContainEqual({ q: 0, r: 0 });
  });

  it('cone length 2 = 5 hexes, origin excluded (L(L+3)/2)', () => {
    const h = templateHexes(tpl({ kind: 'cone', dir: 0, size: 2 }));
    expect(h.length).toBe(5);
    expect(h).not.toContainEqual({ q: 0, r: 0 });
  });

  it('line = hexLine to the endpoint', () => {
    const h = templateHexes(tpl({ kind: 'line', q2: 3, r2: 0 }));
    expect(h.length).toBe(4); // 0,0 .. 3,0 inclusive
    expect(h[0]).toEqual({ q: 0, r: 0 });
    expect(h[3]).toEqual({ q: 3, r: 0 });
  });

  it('line without endpoint yields []', () => {
    expect(templateHexes(tpl({ kind: 'line', q2: null, r2: null }))).toEqual([]);
  });
});

describe('dirFromPoint', () => {
  it('pointy: a point due right of the origin snaps to dir 0 (q+1)', () => {
    // pointy dir 0 = (1,0): pixel offset (sqrt(3)*s, 0) — straight right.
    expect(dirFromPoint({ q: 0, r: 0 }, 100, 0, pointy)).toBe(0);
  });
  it('pointy: a point due left snaps to dir 3 (q-1)', () => {
    expect(dirFromPoint({ q: 0, r: 0 }, -100, 0, pointy)).toBe(3);
  });
  it('flat: a point straight down snaps to dir 5 (0,+1)', () => {
    // flat dir 5 = (0,1): pixel offset (0, sqrt(3)*s) — straight down (y grows downward).
    expect(dirFromPoint({ q: 0, r: 0 }, 0, 100, flat)).toBe(5);
  });
  it('a point exactly on the origin falls back to dir 0', () => {
    expect(dirFromPoint({ q: 0, r: 0 }, 0, 0, pointy)).toBe(0);
  });
});
```

Before finalizing the flat-orientation expectation, verify with the real `hexToPixel`: for flat grids, `AXIAL_DIRS[5] = (0,1)` maps to pixel `(s·3/2·0, s·(√3/2·0 + √3·1)) = (0, √3·s)` — straight down. Correct as written. Run → fail (module missing).

- [ ] **Step 3: Implement**

```ts
// apps/swdnd/src/lib/templates.ts — AoE footprint geometry (pure).
import { AXIAL_DIRS, hexBlast, hexLine, hexToPixel, hexWedge, type Hex } from './hex';
import type { GridConfig } from './hex';
import type { TemplateDto } from './scenes';

/** The hexes a template covers. Line templates without an endpoint cover nothing. */
export function templateHexes(t: TemplateDto): Hex[] {
  switch (t.kind) {
    case 'blast':
      return hexBlast({ q: t.q, r: t.r }, t.size);
    case 'cone':
      return hexWedge({ q: t.q, r: t.r }, t.dir, t.size);
    case 'line':
      return t.q2 == null || t.r2 == null ? [] : hexLine({ q: t.q, r: t.r }, { q: t.q2, r: t.r2 });
  }
}

/**
 * Snap a drag vector (map-pixel point relative to the origin hex's center) to
 * the nearest of the six hex directions for the grid's orientation.
 */
export function dirFromPoint(origin: Hex, px: number, py: number, grid: GridConfig): number {
  const o = hexToPixel(origin, grid);
  const vx = px - o.x;
  const vy = py - o.y;
  if (vx === 0 && vy === 0) return 0;
  let best = 0;
  let bestDot = -Infinity;
  for (let d = 0; d < 6; d++) {
    const n = hexToPixel({ q: origin.q + AXIAL_DIRS[d].q, r: origin.r + AXIAL_DIRS[d].r }, grid);
    const nx = n.x - o.x;
    const ny = n.y - o.y;
    const len = Math.hypot(nx, ny) || 1;
    const dot = (vx * nx + vy * ny) / len; // cosine similarity × |v| — |v| constant across d
    if (dot > bestDot) {
      bestDot = dot;
      best = d;
    }
  }
  return best;
}
```

Check `AXIAL_DIRS`'s element shape in hex.ts (`{q,r}` objects vs tuples) and match; note `dirFromPoint` takes the ABSOLUTE map point (it subtracts the origin center itself).

- [ ] **Step 4: Run tests** — pass. `cd apps/swdnd && bun run build` — green.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/templates.ts apps/swdnd/src/lib/templates.test.ts apps/swdnd/src/lib/scenes.ts
git commit -m "feat(swdnd): AoE template footprints and direction snapping"
```

---

### Task 4: `lib/initiative.ts` — turn/round/entry ops

**Files:**
- Create: `apps/swdnd/src/lib/initiative.ts`
- Test: `apps/swdnd/src/lib/initiative.test.ts`

- [ ] **Step 1: Failing tests**

```ts
// apps/swdnd/src/lib/initiative.test.ts
import { describe, expect, it } from 'bun:test';
import {
  entriesFromTokens, nextTurn, prevTurn, removeEntry, sortByRoll, startInitiative, type Initiative,
} from './initiative';

const init = (over: Partial<Initiative> = {}): Initiative => ({
  order: [
    { tokenId: 'a', name: 'A', roll: 18 },
    { tokenId: 'b', name: 'B', roll: 11 },
    { tokenId: 'c', name: 'C', roll: 5 },
  ],
  activeIndex: 0,
  round: 1,
  ...over,
});

describe('startInitiative / sortByRoll', () => {
  it('sorts descending by roll and starts at round 1, index 0', () => {
    const s = startInitiative([
      { tokenId: 'b', name: 'B', roll: 11 },
      { tokenId: 'a', name: 'A', roll: 18 },
    ]);
    expect(s.order.map((e) => e.tokenId)).toEqual(['a', 'b']);
    expect(s.activeIndex).toBe(0);
    expect(s.round).toBe(1);
  });
  it('sortByRoll does not mutate', () => {
    const arr = [{ tokenId: 'b', name: 'B', roll: 1 }, { tokenId: 'a', name: 'A', roll: 2 }];
    sortByRoll(arr);
    expect(arr[0].tokenId).toBe('b');
  });
});

describe('nextTurn / prevTurn', () => {
  it('advances and wraps with a round increment', () => {
    let s = init();
    s = nextTurn(s); expect(s.activeIndex).toBe(1);
    s = nextTurn(s); expect(s.activeIndex).toBe(2);
    s = nextTurn(s); expect(s).toMatchObject({ activeIndex: 0, round: 2 });
  });
  it('prevTurn wraps back a round but never below round 1', () => {
    let s = init({ activeIndex: 0, round: 2 });
    s = prevTurn(s); expect(s).toMatchObject({ activeIndex: 2, round: 1 });
    s = prevTurn(s); expect(s.activeIndex).toBe(1);
    const start = init(); // round 1, index 0
    expect(prevTurn(start)).toEqual(start);
  });
  it('no-ops on an empty order', () => {
    const empty = init({ order: [], activeIndex: 0 });
    expect(nextTurn(empty)).toEqual(empty);
    expect(prevTurn(empty)).toEqual(empty);
  });
});

describe('removeEntry', () => {
  it('removing before the active entry shifts activeIndex down', () => {
    const s = removeEntry(init({ activeIndex: 2 }), 'a');
    expect(s.order.map((e) => e.tokenId)).toEqual(['b', 'c']);
    expect(s.activeIndex).toBe(1); // still C's turn
  });
  it('removing the active last entry wraps activeIndex to 0', () => {
    const s = removeEntry(init({ activeIndex: 2 }), 'c');
    expect(s.activeIndex).toBe(0);
  });
  it('unknown token is a no-op', () => {
    expect(removeEntry(init(), 'zz')).toEqual(init());
  });
});

describe('entriesFromTokens', () => {
  it('maps non-hidden tokens to roll-0 entries', () => {
    const entries = entriesFromTokens([
      { id: 't1', name: 'Brakk', hidden: 0 },
      { id: 't2', name: 'Sneak', hidden: 1 },
    ]);
    expect(entries).toEqual([{ tokenId: 't1', name: 'Brakk', roll: 0 }]);
  });
});
```

Run → fail.

- [ ] **Step 2: Implement**

```ts
// apps/swdnd/src/lib/initiative.ts — pure initiative-tracker operations.
export interface InitiativeEntry { tokenId: string; name: string; roll: number }
export interface Initiative { order: InitiativeEntry[]; activeIndex: number; round: number }

export const sortByRoll = (entries: InitiativeEntry[]): InitiativeEntry[] =>
  [...entries].sort((a, b) => b.roll - a.roll);

export const startInitiative = (entries: InitiativeEntry[]): Initiative =>
  ({ order: sortByRoll(entries), activeIndex: 0, round: 1 });

export function nextTurn(init: Initiative): Initiative {
  const n = init.order.length;
  if (n === 0) return init;
  const i = init.activeIndex + 1;
  return i >= n ? { ...init, activeIndex: 0, round: init.round + 1 } : { ...init, activeIndex: i };
}

export function prevTurn(init: Initiative): Initiative {
  const n = init.order.length;
  if (n === 0) return init;
  if (init.activeIndex === 0) {
    return init.round > 1 ? { ...init, activeIndex: n - 1, round: init.round - 1 } : init;
  }
  return { ...init, activeIndex: init.activeIndex - 1 };
}

/** Remove a token's entry, keeping the same creature's turn active where possible. */
export function removeEntry(init: Initiative, tokenId: string): Initiative {
  const idx = init.order.findIndex((e) => e.tokenId === tokenId);
  if (idx === -1) return init;
  const order = init.order.filter((e) => e.tokenId !== tokenId);
  let activeIndex = init.activeIndex;
  if (idx < activeIndex) activeIndex -= 1;
  if (activeIndex >= order.length) activeIndex = 0;
  return { ...init, order, activeIndex };
}

/** Seed entries from the scene's tokens (hidden tokens stay out of the public order). */
export const entriesFromTokens = (tokens: { id: string; name: string; hidden: number }[]): InitiativeEntry[] =>
  tokens.filter((t) => t.hidden !== 1).map((t) => ({ tokenId: t.id, name: t.name, roll: 0 }));
```

- [ ] **Step 3: Run tests** — pass.

- [ ] **Step 4: Commit**

```bash
git add apps/swdnd/src/lib/initiative.ts apps/swdnd/src/lib/initiative.test.ts
git commit -m "feat(swdnd): initiative tracker operations"
```

---

### Task 5: mapState — templates

**Files:**
- Modify: `apps/swdnd/src/lib/mapState.ts`
- Test: `apps/swdnd/src/lib/mapState.test.ts` (append + adjust fixtures)

- [ ] **Step 1: Failing tests** (append; reuse the file's fixture helpers, extending them with `templates: {}` where they build states literally):

```ts
describe('template events', () => {
  it('template:created adds and template:deleted removes', () => {
    const tpl = { id: 'T1', scene_id: 'S', kind: 'blast', q: 0, r: 0, dir: 0, size: 1, q2: null, r2: null, color: '#fff', created_at: '' };
    let s = applyMapEvent(emptyMapState(), { type: 'template:created', room: 'x', payload: tpl });
    expect(s.templates.T1).toEqual(tpl);
    s = applyMapEvent(s, { type: 'template:deleted', room: 'x', payload: { id: 'T1' } });
    expect(s.templates.T1).toBeUndefined();
  });

  it('template:cleared empties only for the matching scene', () => {
    const tpl = { id: 'T1', scene_id: 'S', kind: 'blast', q: 0, r: 0, dir: 0, size: 1, q2: null, r2: null, color: '#fff', created_at: '' };
    let s = applyMapEvent(emptyMapState(), { type: 'template:created', room: 'x', payload: tpl });
    s = { ...s, scene: { id: 'S' } as unknown as import('./scenes').SceneDto };
    const other = applyMapEvent(s, { type: 'template:cleared', room: 'x', payload: { sceneId: 'OTHER' } });
    expect(Object.keys(other.templates).length).toBe(1);
    const cleared = applyMapEvent(s, { type: 'template:cleared', room: 'x', payload: { sceneId: 'S' } });
    expect(cleared.templates).toEqual({});
  });
});
```

Run → fail (`templates` missing).

- [ ] **Step 2: Implement** — add to `MapState`:

```ts
  templates: Record<string, TemplateDto>;
```

`emptyMapState` gains `templates: {}`. In the hook's `reload` (Task 6) templates are loaded fresh, and `applyMapEvent` gains:

```ts
    case 'template:created': {
      const tpl = env.payload as TemplateDto;
      return { ...s, templates: { ...s.templates, [tpl.id]: tpl } };
    }
    case 'template:deleted': {
      const { id } = env.payload as { id: string };
      const { [id]: _gone, ...templates } = s.templates;
      return { ...s, templates };
    }
    case 'template:cleared': {
      const { sceneId } = env.payload as { sceneId: string };
      if (!s.scene || s.scene.id !== sceneId) return s;
      return { ...s, templates: {} };
    }
```

Import `TemplateDto` from './scenes'. Fix any existing test fixtures that construct `MapState` literals.

- [ ] **Step 3: Run** `bun test apps/swdnd` — green (build later; hook not updated yet is fine, `emptyMapState` covers the new field).

- [ ] **Step 4: Commit**

```bash
git add apps/swdnd/src/lib/mapState.ts apps/swdnd/src/lib/mapState.test.ts
git commit -m "feat(swdnd): template state in the map reducer"
```

---

### Task 6: client wrappers + `useTabletop` (templates, ping/ruler, initiative)

**Files:**
- Modify: `apps/swdnd/src/lib/scenes.ts`
- Modify: `apps/swdnd/src/hooks/useTabletop.ts`

- [ ] **Step 1: REST wrappers** in `lib/scenes.ts` (below the token wrappers; `auth` helper exists):

```ts
export const listTemplates = (sceneId: string) => api<TemplateDto[]>(`/swdnd/scenes/${sceneId}/templates`);
export const createTemplate = (sceneId: string, body: Record<string, unknown>, token?: string | null) =>
  api<TemplateDto>(`/swdnd/scenes/${sceneId}/templates`, { method: 'POST', headers: auth(token), body: JSON.stringify(body) });
export const deleteTemplate = (id: string, token?: string | null) =>
  api<{ ok: boolean }>(`/swdnd/templates/${id}`, { method: 'DELETE', headers: auth(token) });
export const clearTemplates = (sceneId: string) =>
  api<{ ok: boolean }>(`/swdnd/scenes/${sceneId}/templates`, { method: 'DELETE' });
export const patchInitiative = (sceneId: string, initiative: unknown | null) =>
  api<SceneDto>(`/swdnd/scenes/${sceneId}/initiative`, { method: 'PATCH', body: JSON.stringify({ initiative }) });
```

- [ ] **Step 2: Hook changes** (read the current file first; keep all existing behavior):

(a) New interface surface:

```ts
  templates: TemplateDto[];
  pings: { id: string; x: number; y: number }[];
  rulers: Record<string, { a: Hex; b: Hex }>;   // peer id → live remote ruler
  initiative: Initiative | null;                 // parsed from scene.initiative_json
  actions: {
    // ...existing...
    addTemplate: (body: Record<string, unknown>) => Promise<void>;
    removeTemplate: (id: string) => Promise<void>;
    clearAllTemplates: () => Promise<void>;
    sendPing: (x: number, y: number) => void;
    sendRuler: (a: Hex, b: Hex, done: boolean) => void;
    setInitiative: (init: Initiative | null) => Promise<void>;
  };
```

(b) Reload: fetch templates with the tokens —

```ts
const [tokens, templates] = active
  ? await Promise.all([listTokens(active.id), listTemplates(active.id)])
  : [[], []];
```

and seed `templates: Object.fromEntries(templates.map((t) => [t.id, t]))` in the `setState` (preserving `dragGhosts` as today).

(c) Peer id + ephemeral state:

```ts
const peerId = useRef<string>(crypto.randomUUID());
const pingSeq = useRef(0);
const [pings, setPings] = useState<{ id: string; x: number; y: number; at: number }[]>([]);
const [rulers, setRulers] = useState<Record<string, { a: Hex; b: Hex }>>({});
const lastRuler = useRef(0);
```

Prune pings on an interval (pings render for ~2s):

```ts
useEffect(() => {
  if (pings.length === 0) return;
  const t = setInterval(() => {
    const cutoff = Date.now() - 2200;
    setPings((p) => (p.some((x) => x.at < cutoff) ? p.filter((x) => x.at >= cutoff) : p));
  }, 500);
  return () => clearInterval(t);
}, [pings.length > 0]);
```

(d) WS handler — intercept the two ephemeral types before `applyMapEvent` (alongside the existing `character:updated` intercept):

```ts
if (env.type === 'ping') {
  const p = env.payload as { id: string; x: number; y: number };
  setPings((cur) => [...cur, { ...p, at: Date.now() }]);
  return;
}
if (env.type === 'ruler') {
  const p = env.payload as { peer: string; a: Hex; b: Hex; done: boolean };
  setRulers((cur) => {
    if (p.done) {
      const { [p.peer]: _gone, ...rest } = cur;
      return rest;
    }
    return { ...cur, [p.peer]: { a: p.a, b: p.b } };
  });
  return;
}
```

Also clear `setRulers({})` and `setPings([])` inside `reload` (scene flips shouldn't keep stale overlays).

(e) Senders (the relay skips the sender, so pings add themselves locally too):

```ts
const sendPing = useCallback((x: number, y: number) => {
  const id = `${peerId.current}:${pingSeq.current++}`;
  setPings((cur) => [...cur, { id, x, y, at: Date.now() }]);
  socket.current?.send({ type: 'ping', room, payload: { id, x, y } });
}, [room]);

const sendRuler = useCallback((a: Hex, b: Hex, done: boolean) => {
  const now = Date.now();
  if (!done && now - lastRuler.current < DRAG_THROTTLE_MS) return;
  lastRuler.current = now;
  socket.current?.send({ type: 'ruler', room, payload: { peer: peerId.current, a, b, done } });
}, [room]);
```

(The local ruler renders from SceneCanvas's own drag state — `rulers` holds REMOTE peers only.)

(f) Template + initiative actions:

```ts
addTemplate: wrap(async (body: Record<string, unknown>) => {
  if (state.scene) await createTemplate(state.scene.id, body, playerToken);
}),
removeTemplate: wrap(async (id: string) => { await deleteTemplate(id, playerToken); }),
clearAllTemplates: wrap(async () => { if (state.scene) await clearTemplates(state.scene.id); }),
setInitiative: async (init: Initiative | null) => {
  // Optimistic like commitFog: the strip must respond instantly to next/prev.
  setState((s) => (s.scene ? { ...s, scene: { ...s.scene, initiative_json: init } } : s));
  try {
    if (state.scene) await patchInitiative(state.scene.id, init);
    setError(null);
  } catch (e) {
    setError(e instanceof Error ? e.message : 'Initiative update failed');
    reload();
  }
},
```

(g) Derived return values:

```ts
templates: Object.values(state.templates),
pings,
rulers,
initiative: (state.scene?.initiative_json as Initiative | null) ?? null,
```

Type imports: `Hex` from '../lib/hex', `Initiative` from '../lib/initiative', `TemplateDto` + new wrappers from '../lib/scenes'.

- [ ] **Step 3: Verify** — `bun test apps/swdnd` green; `cd apps/swdnd && bun run build` green.

- [ ] **Step 4: Commit**

```bash
git add apps/swdnd/src/lib/scenes.ts apps/swdnd/src/hooks/useTabletop.ts
git commit -m "feat(swdnd): useTabletop templates, pings, rulers, initiative"
```

---

### Task 7: SceneCanvas — tool modes, template & ephemeral layers

**Files:**
- Modify: `apps/swdnd/src/panels/Tabletop/SceneCanvas.tsx`

New props (add to `Props`):

```ts
  /** Active interaction tool. 'move' = phase-1/2 behavior. */
  mode: 'move' | 'ruler' | 'ping' | 'blast' | 'cone' | 'line';
  templateSize: number;
  templates: TemplateDto[];
  pings: { id: string; x: number; y: number }[];
  rulers: Record<string, { a: Hex; b: Hex }>;
  activeTokenId: string | null;
  onPing: (x: number, y: number) => void;
  onRulerFrame: (a: Hex, b: Hex, done: boolean) => void;
  onCreateTemplate: (body: Record<string, unknown>) => void;
  onDeleteTemplate: (id: string) => void;
```

- [ ] **Step 1: Interaction state.** Add:

```ts
const [rulerDrag, setRulerDrag] = useState<{ a: Hex; b: Hex } | null>(null);
const [tplDrag, setTplDrag] = useState<{ kind: 'cone' | 'line'; origin: Hex; x: number; y: number } | null>(null);
```

Gesture precedence in `onPointerDown` (after pointer capture, in this order): fogBrush (unchanged, DM) → **tool modes** → token drag → template-marker tap → pan.

```ts
if (mode === 'ruler') {
  const p = mapPoint(e);
  const a = pixelToHex(p.x, p.y, g);
  setRulerDrag({ a, b: a });
  return;
}
if (mode === 'cone' || mode === 'line') {
  const p = mapPoint(e);
  setTplDrag({ kind: mode, origin: pixelToHex(p.x, p.y, g), x: p.x, y: p.y });
  return;
}
// 'ping' and 'blast' are click gestures — let the pan path handle the gesture
// and act on the no-movement tap in endDrag.
```

In the token-miss branch, before starting a pan, capture a possible template-marker hit:

```ts
const tplEl = (e.target as Element).closest('[data-template-id]');
pan.current = { ..., templateId: tplEl?.getAttribute('data-template-id') ?? null };
```

(extend the pan ref type with `templateId: string | null`).

`onPointerMove` additions (before the drag/pan branches):

```ts
if (rulerDrag) {
  const p = mapPoint(e);
  const b = pixelToHex(p.x, p.y, g);
  if (b.q !== rulerDrag.b.q || b.r !== rulerDrag.b.r) {
    setRulerDrag({ a: rulerDrag.a, b });
    onRulerFrame(rulerDrag.a, b, false);
  }
  return;
}
if (tplDrag) {
  const p = mapPoint(e);
  setTplDrag({ ...tplDrag, x: p.x, y: p.y });
  return;
}
```

`endDrag` additions (before the token branch):

```ts
if (rulerDrag) {
  onRulerFrame(rulerDrag.a, rulerDrag.b, true);
  setRulerDrag(null);
  return;
}
if (tplDrag) {
  const p = mapPoint(e);
  if (tplDrag.kind === 'cone') {
    const dir = dirFromPoint(tplDrag.origin, p.x, p.y, g);
    onCreateTemplate({ kind: 'cone', q: tplDrag.origin.q, r: tplDrag.origin.r, dir, size: templateSize });
  } else {
    const end = pixelToHex(p.x, p.y, g);
    if (end.q !== tplDrag.origin.q || end.r !== tplDrag.origin.r) {
      onCreateTemplate({ kind: 'line', q: tplDrag.origin.q, r: tplDrag.origin.r, q2: end.q, r2: end.r });
    }
  }
  setTplDrag(null);
  return;
}
```

And in the pan-tap branch (no movement), replace the bare deselect with mode-aware taps:

```ts
if (!movedPan) {
  const p = mapPoint(e);
  if (mode === 'ping') {
    onPing(p.x, p.y);
  } else if (mode === 'blast') {
    const hex = pixelToHex(p.x, p.y, g);
    onCreateTemplate({ kind: 'blast', q: hex.q, r: hex.r, size: templateSize });
  } else if (pan.current.templateId) {
    onDeleteTemplate(pan.current.templateId);   // any member; server enforces
  } else if (isDm) {
    onSelectToken(null);
  }
}
```

- [ ] **Step 2: Template layer** — spec order: image → grid → **templates** → tokens → fog → ephemeral. Insert after the grid `<g>`:

```tsx
<g>
  {templates.map((t) => {
    const cells = templateHexes(t);
    const o = hexToPixel({ q: t.q, r: t.r }, g);
    return (
      <g key={t.id}>
        <g pointerEvents="none">
          {cells.map((hex) => (
            <polygon
              key={`${t.id}:${hex.q},${hex.r}`}
              points={hexCorners(hex, g).map((p) => `${p.x},${p.y}`).join(' ')}
              fill={t.color} fillOpacity={0.22}
              stroke={t.color} strokeOpacity={0.6} strokeWidth={1}
            />
          ))}
        </g>
        {/* origin marker = the delete handle (tap in move mode removes) */}
        <circle
          data-template-id={t.id}
          cx={o.x} cy={o.y} r={g.hexSize * 0.22}
          fill={t.color} fillOpacity={0.9} stroke="#05070a" strokeWidth={1}
          style={{ cursor: 'pointer' }}
        />
      </g>
    );
  })}
  {/* in-flight cone/line preview, dashed */}
  {tplDrag && (() => {
    const preview: TemplateDto = {
      id: '__preview', scene_id: scene.id, kind: tplDrag.kind,
      q: tplDrag.origin.q, r: tplDrag.origin.r,
      dir: tplDrag.kind === 'cone' ? dirFromPoint(tplDrag.origin, tplDrag.x, tplDrag.y, g) : 0,
      size: templateSize,
      q2: tplDrag.kind === 'line' ? pixelToHex(tplDrag.x, tplDrag.y, g).q : null,
      r2: tplDrag.kind === 'line' ? pixelToHex(tplDrag.x, tplDrag.y, g).r : null,
      color: '#c792ea', created_at: '',
    };
    return (
      <g pointerEvents="none">
        {templateHexes(preview).map((hex) => (
          <polygon
            key={`pv:${hex.q},${hex.r}`}
            points={hexCorners(hex, g).map((p) => `${p.x},${p.y}`).join(' ')}
            fill="#c792ea" fillOpacity={0.12}
            stroke="#c792ea" strokeOpacity={0.7} strokeWidth={1} strokeDasharray="4 3"
          />
        ))}
      </g>
    );
  })()}
</g>
```

- [ ] **Step 3: Ephemeral layer** — LAST child of the `<svg>` (above fog), all `pointerEvents="none"`:

```tsx
<g pointerEvents="none">
  {/* rulers: local drag + remote peers */}
  {[
    ...(rulerDrag ? [{ key: '__local', ...rulerDrag }] : []),
    ...Object.entries(rulers).map(([peer, rl]) => ({ key: peer, ...rl })),
  ].map(({ key, a, b }) => {
    const pa = hexToPixel(a, g);
    const pb = hexToPixel(b, g);
    const cells = hexLine(a, b);
    const dist = hexDistance(a, b) * g.unitsPerHex;
    return (
      <g key={`ruler-${key}`}>
        {cells.map((hex) => (
          <polygon
            key={`rl:${key}:${hex.q},${hex.r}`}
            points={hexCorners(hex, g).map((p) => `${p.x},${p.y}`).join(' ')}
            fill="#4dd0e1" fillOpacity={0.15} stroke="#4dd0e1" strokeOpacity={0.5} strokeWidth={1}
          />
        ))}
        <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#4dd0e1" strokeWidth={1.5} strokeDasharray="6 4" />
        <text
          x={(pa.x + pb.x) / 2} y={(pa.y + pb.y) / 2 - g.hexSize * 0.4}
          textAnchor="middle" fill="#e6f7ff" fontFamily="monospace" fontSize={g.hexSize * 0.45}
          stroke="#05070a" strokeWidth={3} paintOrder="stroke"
        >
          {dist} {g.unitLabel}
        </text>
      </g>
    );
  })}
  {/* pings: expanding double-pulse */}
  {pings.map((p) => (
    <g key={p.id}>
      <circle cx={p.x} cy={p.y} r={g.hexSize * 0.3} fill="none" stroke="#ffcb6b" strokeWidth={2}>
        <animate attributeName="r" from={g.hexSize * 0.3} to={g.hexSize * 2.2} dur="1s" repeatCount="2" />
        <animate attributeName="stroke-opacity" from="1" to="0" dur="1s" repeatCount="2" />
      </circle>
      <circle cx={p.x} cy={p.y} r={g.hexSize * 0.16} fill="#ffcb6b" />
    </g>
  ))}
</g>
```

- [ ] **Step 4: Active-turn glow** — thread `active={t.id === activeTokenId}` through `renderToken` into `TokenGlyph` (Task 8 adds the prop).

- [ ] **Step 5: Imports** — `dirFromPoint`, `templateHexes` from '../../lib/templates'; `hexDistance`, `hexLine` added to the hex import; `TemplateDto` type from '../../lib/scenes'.

- [ ] **Step 6: Verify** with Tasks 8–9 (props flow through index.tsx; see the shared-build note in Task 9), then commit:

```bash
git add apps/swdnd/src/panels/Tabletop/SceneCanvas.tsx
git commit -m "feat(swdnd): ruler, ping, and AoE template canvas tools"
```

---

### Task 8: TokenGlyph — active-turn glow

**Files:**
- Modify: `apps/swdnd/src/panels/Tabletop/TokenGlyph.tsx`

- [ ] **Step 1:** Add an `active?: boolean` prop; render (right after the base disc `<circle>`):

```tsx
{active && (
  <circle r={radius * 1.5} fill="none" stroke="#4dd0e1" strokeWidth={grid.hexSize * 0.06} pointerEvents="none">
    <animate attributeName="stroke-opacity" values="0.9;0.25;0.9" dur="1.6s" repeatCount="indefinite" />
  </circle>
)}
```

- [ ] **Step 2:** Commit with Task 7/9 once the build is green:

```bash
git add apps/swdnd/src/panels/Tabletop/TokenGlyph.tsx
git commit -m "feat(swdnd): active-turn token glow"
```

---

### Task 9: Toolbar tools cluster + initiative strip & editor

**Files:**
- Create: `apps/swdnd/src/panels/Tabletop/InitiativeStrip.tsx`
- Create: `apps/swdnd/src/panels/Tabletop/InitiativeEditor.tsx`
- Modify: `apps/swdnd/src/panels/Tabletop/index.tsx`

- [ ] **Step 1: InitiativeStrip** — for everyone when initiative is running; DM gets prev/next/end inline:

```tsx
// apps/swdnd/src/panels/Tabletop/InitiativeStrip.tsx
import type { Initiative } from '../../lib/initiative';

export default function InitiativeStrip({
  initiative, isDm, onNext, onPrev, onEnd,
}: {
  initiative: Initiative;
  isDm: boolean;
  onNext: () => void;
  onPrev: () => void;
  onEnd: () => void;
}) {
  return (
    <div className="ht-panel mx-2 mb-2 flex flex-wrap items-center gap-2 p-2 text-[11px]">
      <span className="ht-label">Round {initiative.round}</span>
      {initiative.order.map((e, i) => (
        <span
          key={e.tokenId}
          className={`ht-step ${i === initiative.activeIndex ? 'ht-tile-active' : ''}`}
        >
          {e.name} <span className="text-ht-muted">{e.roll}</span>
        </span>
      ))}
      {initiative.order.length === 0 && <span className="text-[10px] text-ht-muted">no combatants</span>}
      {isDm && (
        <span className="ml-auto flex items-center gap-2">
          <button type="button" className="ht-step" onClick={onPrev}>◀</button>
          <button type="button" className="ht-step" onClick={onNext}>▶ next</button>
          <button type="button" className="ht-step text-red-400" onClick={onEnd}>end</button>
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: InitiativeEditor** — DM row (like TokenEditor). Roll inputs are BUFFERED (commit on blur/Enter — same echo-fighting rationale as TokenEditor's hp inputs; every commit PATCHes the whole initiative object via `onChange`):

```tsx
// apps/swdnd/src/panels/Tabletop/InitiativeEditor.tsx
import { useEffect, useState } from 'react';
import type { TokenDto } from '../../lib/scenes';
import {
  entriesFromTokens, removeEntry, sortByRoll, startInitiative, type Initiative,
} from '../../lib/initiative';

export default function InitiativeEditor({
  initiative, tokens, onChange, onClose,
}: {
  initiative: Initiative | null;
  tokens: TokenDto[];
  onChange: (init: Initiative | null) => void;
  onClose: () => void;
}) {
  // Buffered roll drafts keyed by tokenId; reseed when the entry set changes.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const entryKey = (initiative?.order ?? []).map((e) => e.tokenId).join(',');
  useEffect(() => {
    setDrafts(Object.fromEntries((initiative?.order ?? []).map((e) => [e.tokenId, String(e.roll)])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryKey]);

  const commitRoll = (tokenId: string) => {
    if (!initiative) return;
    const n = Number(drafts[tokenId]);
    if (Number.isNaN(n)) return;
    onChange({
      ...initiative,
      order: initiative.order.map((e) => (e.tokenId === tokenId ? { ...e, roll: n } : e)),
    });
  };

  return (
    <div className="ht-panel flex flex-wrap items-center gap-3 p-2 text-[11px]">
      <span className="ht-label">Initiative</span>
      {!initiative && (
        <button
          type="button" className="ht-step"
          onClick={() => onChange(startInitiative(entriesFromTokens(tokens)))}
        >
          ⚔ start from tokens
        </button>
      )}
      {initiative && (
        <>
          {initiative.order.map((e) => (
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
              <button
                type="button" className="text-[10px] text-ht-muted"
                onClick={() => onChange(removeEntry(initiative, e.tokenId))}
              >
                ✕
              </button>
            </span>
          ))}
          <button
            type="button" className="ht-step"
            onClick={() => onChange({ ...initiative, order: sortByRoll(initiative.order), activeIndex: 0 })}
          >
            ⇅ sort
          </button>
          <button type="button" className="ht-step text-red-400" onClick={() => onChange(null)}>end encounter</button>
        </>
      )}
      <button type="button" className="ml-auto ht-step" onClick={onClose}>✕ close</button>
    </div>
  );
}
```

- [ ] **Step 3: index.tsx wiring.**

- State: `const [tool, setTool] = useState<'move' | 'ruler' | 'ping' | 'blast' | 'cone' | 'line'>('move');` `const [templateSize, setTemplateSize] = useState(2);` `const [initEditorOpen, setInitEditorOpen] = useState(false);`
- **Tools cluster for EVERYONE** — in the header row, immediately after the scene-name/status span (NOT inside the DM-only span), when `t.scene` exists:

```tsx
<span className="flex flex-wrap items-center gap-1">
  {([['move', '✥'], ['ruler', '⟋'], ['ping', '◎'], ['blast', '⊚'], ['cone', '◠'], ['line', '⁄']] as const).map(([m, icon]) => (
    <button
      key={m} type="button" title={m}
      className={`ht-step ${tool === m ? 'ht-tile-active' : ''}`}
      onClick={() => setTool((cur) => (cur === m ? 'move' : m))}
    >
      {icon}
    </button>
  ))}
  {(tool === 'blast' || tool === 'cone') && (
    <select
      className="border-b border-ht-line bg-transparent text-[10px] text-ht-bright outline-none"
      value={templateSize}
      onChange={(e) => setTemplateSize(Number(e.target.value))}
    >
      {[1, 2, 3, 4, 6].map((n) => <option key={n} value={n}>{n} hex</option>)}
    </select>
  )}
</span>
```

- DM span additions (next to ☁ fog): `♞ init` toggle (`setInitEditorOpen((v) => !v)`, active style when open) and `✕ tpl` → `void t.actions.clearAllTemplates()`.
- Rows: `InitiativeStrip` renders for EVERYONE when `t.initiative` is non-null (above the canvas, below the toolbar/editor rows) with `onNext={() => void t.actions.setInitiative(nextTurn(t.initiative!))}`, `onPrev` likewise with `prevTurn`, `onEnd={() => void t.actions.setInitiative(null)}` (import from '../../lib/initiative'). `InitiativeEditor` renders when `t.isDm && initEditorOpen`, with `tokens={t.tokens}`, `onChange={(init) => void t.actions.setInitiative(init)}`.
- SceneCanvas call gains: `mode={tool}`, `templateSize`, `templates={t.templates}`, `pings={t.pings}`, `rulers={t.rulers}`, `activeTokenId={t.initiative ? t.initiative.order[t.initiative.activeIndex]?.tokenId ?? null : null}`, `onPing={t.actions.sendPing}`, `onRulerFrame={t.actions.sendRuler}`, `onCreateTemplate={(b) => void t.actions.addTemplate(b)}`, `onDeleteTemplate={(id) => void t.actions.removeTemplate(id)}`.
- Note: the fog tool (DM) takes precedence over `tool` in the canvas — leave `fogBrush` wiring as is.

- [ ] **Step 4: Shared build gate.** Tasks 7–9 change props across files; get `bun test apps/swdnd` AND `cd apps/swdnd && bun run build` green across all three, THEN make the three commits in task order (7, 8, 9):

```bash
git add apps/swdnd/src/panels/Tabletop/InitiativeStrip.tsx apps/swdnd/src/panels/Tabletop/InitiativeEditor.tsx apps/swdnd/src/panels/Tabletop/index.tsx
git commit -m "feat(swdnd): combat toolbar, initiative strip and editor"
```

---

### Task 10: Full verification (coordinator)

- [ ] `bun test` (repo) green; `cd apps/swdnd && bun run build` green.
- [ ] Two-tab walkthrough with `ASHERCARLOW_AUTH_TOKEN` set (DM cookie tab + player token tab):
  1. **Ruler:** player drags with the ruler tool → hex path highlights + `N ft` label locally AND live on the DM tab (ephemeral, disappears on release).
  2. **Ping:** each side pings → double-pulse appears on both tabs, fades ~2 s, no persistence after refresh.
  3. **Templates:** player places a blast (persists; visible both tabs; survives refresh); DM drags a cone (60° wedge, correct direction snap) and a line; player taps a template's origin dot in move mode → deleted for everyone; DM ✕ tpl clears all. Auth: player from another campaign 403s (covered by route tests; spot-check anonymous curl 403).
  4. **Initiative:** DM ⚔ start from tokens → strip appears on BOTH tabs (round 1, sorted); DM edits rolls (buffered), ▶ next advances and the active token GLOWS on the map for everyone; wrap increments the round; end encounter clears the strip everywhere.
  5. Templates under fog: player sees template cells only on revealed hexes (they sit under the fog layer).
- [ ] Vault docs: `Features/Tabletop & Map.md` (status → feature COMPLETE, phase 3 shipped-surface section), `Roadmap.md` (phase 3 ✅ → Tabletop & Map ✅ complete), `Data Model.md` (template table + initiative_json now live).
- [ ] `superpowers:finishing-a-development-branch`.

---

## Self-review notes (spec coverage & consistency)

- Spec §1 combat-tools row: ruler ✓ (T6/T7), pings ✓ (T6/T7), AoE blast/cone-60°-wedge/line ✓ (T1/T3/T7), initiative on the map for everyone ✓ (T2/T4/T9 strip + glow).
- Spec §3: `POST /scenes/:id/templates` + `DELETE /templates/:id` member-gated ✓ (T1, `assertCampaignMember`); DM clear-all ✓; `PATCH /scenes/:id/initiative` DM-only ✓ (T2, blanket gate); ephemeral `ping`/`ruler` relays ✓ (existing WS relay, T6).
- Spec §2: `initiative_json` shape `{order:[{tokenId,name,roll}], activeIndex, round} | null` ✓ (T2 zod = T4 types). Template table is NEW (spec §2 omitted it; §3's persisted routes imply it) — documented in the vault in T10.
- Layer order §5: image → grid → templates → tokens → fog → ephemeral ✓ (T7 insertion points).
- Type consistency: `TemplateDto` (T3, scenes.ts) used by T5/T6/T7; `Initiative`/`InitiativeEntry` (T4) used by T2's zod mirror, T6, T9; `mode` union identical in T7 props and T9 state; `sendRuler(a, b, done)` = `onRulerFrame` signature; ping payload `{id,x,y}` consistent T6/T7.
- Known accepted quirks: template origin-dot delete is the only delete affordance (discoverable enough for a trusted table); hidden tokens excluded from `entriesFromTokens` but the DM can't add them manually in v1 (edit rolls only) — acceptable, noted for later.
