# DM Screen Phase 2 — Bestiary & Reference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the DM Screen (and the swdnd app): monster browser + essentials-parsed statblocks with one-click spawn-to-map, named encounter groups with spawn-all, and the three-category quick-reference tab — filling the phase-1 placeholder tabs.

**Architecture:** House pattern: all logic in pure unit-tested `lib/` modules (`monsters.ts` parser tested against real Foundry fixtures, `spawn.ts`, `refSearch.ts`, `encounters.ts`), dumb components, `useDmScreen` extended with the new loads + actions. Backend adds only the `encounter` table (migration 004) and its CRUD; **spawning composes the existing `POST /swdnd/scenes/:id/tokens`** client-side — zero new spawn surface, live on every viewer via the existing `token:created` broadcast.

**Tech Stack:** Bun + Hono + `@hono/zod-openapi` + `bun:sqlite`; React 19 + Vite 7 + Tailwind v4 `@container` + Holoterminal CSS. No new dependencies.

**Verified facts an engineer must not re-litigate (from live-corpus research, 272 monster rows):**
- Content rows are `{id, name, content_source, content_type, raw_json}`; `raw_json` is a Foundry actor doc: `{name, system: {abilities, attributes, details, traits, …}, items: […]}`.
- `system.details.cr` is `int` in 190 rows, `float` (0.125/0.25/0.5) in 61, and the **string `'0'`** in 21 — parse with `Number()` and treat non-finite as `null`.
- `system.details.type` is `{value: 'droid'|'construct'|'beast'|'humanoid'|'aberration'|'plant'|'undead'|'custom'|'force', …}`.
- `system.traits.size` ∈ `tiny|sm|med|lg|huge|grg` (all six occur).
- `system.attributes.hp` = `{max, value, formula, …}` (no row lacks `max`); `ac` = `{flat, calc, formula}`; `movement` = `{walk, fly, swim, climb, burrow, roll, crawl, turn, space, units, hover}` (report nonzero modes only, skip `space`/`turn`).
- `system.abilities` includes `hon`/`san` — read only the six real keys; each is `{value, …}`.
- `items[]` types across the corpus: `feat` ×883 (→ traits), `weapon` ×441 (→ actions), `power` ×262 (→ **a third `powers` group** — the spec's two-group signature would silently drop 262 entries, so `MonsterView` adds `powers`; this is the deliberate spec deviation), `equipment` ×14 (ignored). Every item description is `{value: '<html>'}`.
- Conditions (16) and weapon properties (46) are Foundry **journal docs**: text lives at `pages[].text.content`, NOT `system.description`. Powers (465) are item docs already mapped by `loadReference()` → reuse `ReferenceData.powers` for the Reference tab (no refetch); their rows also carry `level` + `power_type` columns.
- `cleanRichText` (lib/richText.ts) returns **plain text** with newlines/bullets — render with `whitespace-pre-line`, never `dangerouslySetInnerHTML`.
- Encounter route gating: `/swdnd/campaigns/:id/encounters` and `/swdnd/encounters/:id` match **no** `selfGated` clause (checked against every startsWith/endsWith rule) → mutations ride the blanket admin gate with no in-handler auth; GETs are open (consistent with campaigns/characters).
- Client helpers that already exist: `createToken(sceneId, body)`, `listScenes(campaignId)` (`SceneDto` has `grid_json: GridConfig`, `image_w/image_h`, `is_active`), `pixelToHex(x, y, cfg)`, `hexRing(center, radius)` (returns `[{...center}]` for radius ≤ 0), `BufferedText` (panels/DMScreen/).
- `cd apps/swdnd && bun run build` is the real typecheck (never `bun --cwd`); `*.test.ts` excluded from tsc; backend test files set `SWDND_DB_PATH` + reset tables in `beforeAll` (delete children before parents for FK order).

**File structure:**

```
apps/backend/src/db/migrations/swdnd/004_swdnd_encounters.sql  CREATE
apps/backend/src/db/swdnd/index.ts                             MODIFY  register migration
apps/backend/src/routes/swdnd/encounters.ts                    CREATE  CRUD routes
apps/backend/src/routes/swdnd/encounters.test.ts               CREATE
apps/backend/src/routes/swdnd/index.ts                         MODIFY  register routes
apps/backend/src/routes/swdnd/gate.test.ts                     MODIFY  encounter gate matrix
apps/swdnd/src/lib/monsters.ts + .test.ts                      CREATE  parser/filter
apps/swdnd/src/lib/spawn.ts + .test.ts                         CREATE  positions/bodies
apps/swdnd/src/lib/refSearch.ts + .test.ts                     CREATE  journal/item entries + search
apps/swdnd/src/lib/encounters.ts + .test.ts                    CREATE  DTO + wrappers + edit helpers
apps/swdnd/src/hooks/useDmScreen.ts                            MODIFY  +monsters/ref/encounters/spawn
apps/swdnd/src/panels/DMScreen/MonsterBrowser.tsx              CREATE
apps/swdnd/src/panels/DMScreen/Statblock.tsx                   CREATE
apps/swdnd/src/panels/DMScreen/EncounterList.tsx               CREATE
apps/swdnd/src/panels/DMScreen/Reference.tsx                   CREATE  (includes RefLookup)
apps/swdnd/src/panels/DMScreen/index.tsx                       MODIFY  wire tabs
```

---

### Task 1: Migration 004 + encounter routes

**Files:**
- Create: `apps/backend/src/db/migrations/swdnd/004_swdnd_encounters.sql`
- Modify: `apps/backend/src/db/swdnd/index.ts`
- Create: `apps/backend/src/routes/swdnd/encounters.ts`
- Create: `apps/backend/src/routes/swdnd/encounters.test.ts`
- Modify: `apps/backend/src/routes/swdnd/index.ts`
- Modify: `apps/backend/src/routes/swdnd/gate.test.ts`

- [ ] **Step 1: Write the migration** — `apps/backend/src/db/migrations/swdnd/004_swdnd_encounters.sql`:

```sql
-- Named monster groups for DM encounter prep. monsters_json: [{monsterId, count}].
CREATE TABLE encounter (
  id            TEXT PRIMARY KEY,
  campaign_id   TEXT NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  monsters_json TEXT NOT NULL DEFAULT '[]',
  sort          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX idx_encounter_campaign ON encounter(campaign_id);
```

- [ ] **Step 2: Register it** — in `apps/backend/src/db/swdnd/index.ts`, append to the `MIGRATIONS` array after the `003_swdnd_templates` entry:

```ts
  { version: '004_swdnd_encounters', file: '004_swdnd_encounters.sql' },
```

- [ ] **Step 3: Write the failing route tests** — create `apps/backend/src/routes/swdnd/encounters.test.ts` (dev-mode pattern, mirrors `players.test.ts`):

```ts
// apps/backend/src/routes/swdnd/encounters.test.ts
import { test, expect, beforeAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAPIHono } from '@hono/zod-openapi';

let app: OpenAPIHono;
let swdndDb: import('bun:sqlite').Database;

beforeAll(async () => {
  process.env.SWDND_DB_PATH = join(tmpdir(), `swdnd-encounters-${crypto.randomUUID()}.sqlite`);
  delete process.env.ASHERCARLOW_AUTH_TOKEN;
  ({ swdndDb } = await import('../../db/swdnd'));
  const { registerSwdndRoutes } = await import('./index');
  app = new OpenAPIHono();
  registerSwdndRoutes(app);
  // Shared singleton — reset in FK order (encounter references campaign).
  swdndDb.exec('DELETE FROM encounter; DELETE FROM character; DELETE FROM player; DELETE FROM campaign;');
  swdndDb.run('INSERT INTO campaign (id,name,created_at,updated_at) VALUES (?,?,?,?)', ['c1', 'Camp', 'n', 'n']);
});

test('create, list, patch, delete an encounter', async () => {
  const created = await app.request('/swdnd/campaigns/c1/encounters', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Droid patrol', monsters: [{ monsterId: 'm1', count: 3 }] }),
  });
  expect(created.status).toBe(201);
  const enc = await created.json();
  expect(enc.name).toBe('Droid patrol');
  expect(enc.monsters_json).toEqual([{ monsterId: 'm1', count: 3 }]);

  const list = await app.request('/swdnd/campaigns/c1/encounters');
  expect(list.status).toBe(200);
  const rows = await list.json();
  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBe(enc.id);

  const patched = await app.request(`/swdnd/encounters/${enc.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Droid ambush', monsters: [{ monsterId: 'm1', count: 2 }, { monsterId: 'm2', count: 1 }] }),
  });
  expect(patched.status).toBe(200);
  const p = await patched.json();
  expect(p.name).toBe('Droid ambush');
  expect(p.monsters_json).toHaveLength(2);

  const deleted = await app.request(`/swdnd/encounters/${enc.id}`, { method: 'DELETE' });
  expect(deleted.status).toBe(200);
  expect(await deleted.json()).toEqual({ ok: true });
  const after = await app.request('/swdnd/campaigns/c1/encounters');
  expect(await after.json()).toEqual([]);
});

test('unknown campaign / encounter 404', async () => {
  expect((await app.request('/swdnd/campaigns/nope/encounters')).status).toBe(404);
  expect((await app.request('/swdnd/campaigns/nope/encounters', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }),
  })).status).toBe(404);
  expect((await app.request('/swdnd/encounters/nope', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }),
  })).status).toBe(404);
  expect((await app.request('/swdnd/encounters/nope', { method: 'DELETE' })).status).toBe(404);
});

test('monsters validation rejects count < 1', async () => {
  const res = await app.request('/swdnd/campaigns/c1/encounters', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'bad', monsters: [{ monsterId: 'm1', count: 0 }] }),
  });
  expect(res.status).toBe(400);
});

test('campaign delete cascades its encounters', async () => {
  swdndDb.run('INSERT INTO campaign (id,name,created_at,updated_at) VALUES (?,?,?,?)', ['c2', 'Doomed', 'n', 'n']);
  await app.request('/swdnd/campaigns/c2/encounters', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'orphan?' }),
  });
  swdndDb.run('DELETE FROM campaign WHERE id = ?', ['c2']);
  const left = swdndDb.query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM encounter WHERE campaign_id = ?').get('c2');
  expect(left?.n).toBe(0);
});
```

- [ ] **Step 4: Add gate-matrix tests** — append to `apps/backend/src/routes/swdnd/gate.test.ts` (runs with `ASHERCARLOW_AUTH_TOKEN='admin-secret'`; do not touch `p1`/`ch1`):

```ts
test('encounter mutations ride the blanket admin gate; reads stay open', async () => {
  const anonPost = await app.request('/swdnd/campaigns/c1/encounters', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }),
  });
  expect(anonPost.status).toBe(401);

  const playerPost = await app.request('/swdnd/campaigns/c1/encounters', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Player-Token': 'tok-1' },
    body: JSON.stringify({ name: 'x' }),
  });
  expect(playerPost.status).toBe(401); // gate only accepts bearer/cookie

  const adminPost = await app.request('/swdnd/campaigns/c1/encounters', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin-secret' },
    body: JSON.stringify({ name: 'Gated group' }),
  });
  expect(adminPost.status).toBe(201);
  const enc = await adminPost.json();

  expect((await app.request(`/swdnd/encounters/${enc.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'y' }),
  })).status).toBe(401);
  expect((await app.request(`/swdnd/encounters/${enc.id}`, { method: 'DELETE' })).status).toBe(401);

  const anonList = await app.request('/swdnd/campaigns/c1/encounters');
  expect(anonList.status).toBe(200); // reads open, like campaigns/characters

  // cleanup so this file leaves no encounter state behind
  const del = await app.request(`/swdnd/encounters/${enc.id}`, {
    method: 'DELETE', headers: { Authorization: 'Bearer admin-secret' },
  });
  expect(del.status).toBe(200);
});
```

Note: `gate.test.ts`'s `beforeAll` reset line must also clear encounters first — change its `swdndDb.exec(...)` reset to `'DELETE FROM encounter; DELETE FROM character; DELETE FROM player; DELETE FROM campaign;'`.

- [ ] **Step 5: Run to verify failure**

Run: `cd /Users/asherc/Git/ashercarlow-api && bun test apps/backend/src/routes/swdnd/encounters.test.ts apps/backend/src/routes/swdnd/gate.test.ts`
Expected: new tests FAIL with 404 (routes absent); pre-existing pass.

- [ ] **Step 6: Implement** — create `apps/backend/src/routes/swdnd/encounters.ts`:

```ts
// apps/backend/src/routes/swdnd/encounters.ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { swdndDb } from '../../db/swdnd';

const MonsterEntry = z.object({ monsterId: z.string().min(1), count: z.number().int().min(1) });
const Encounter = z.object({
  id: z.string(), campaign_id: z.string(), name: z.string(),
  monsters_json: z.array(MonsterEntry), sort: z.number(),
  created_at: z.string(), updated_at: z.string(),
}).openapi('SwdndEncounter');

const PostBody = z.object({
  name: z.string().min(1),
  monsters: z.array(MonsterEntry).optional(),
}).openapi('SwdndPostEncounter');
const PatchBody = z.object({
  name: z.string().min(1).optional(),
  monsters: z.array(MonsterEntry).optional(),
  sort: z.number().int().optional(),
}).openapi('SwdndPatchEncounter');
const ErrorBody = z.object({ message: z.string() });

interface EncounterRow {
  id: string; campaign_id: string; name: string; monsters_json: string;
  sort: number; created_at: string; updated_at: string;
}

const encounterOut = (row: EncounterRow) => ({ ...row, monsters_json: JSON.parse(row.monsters_json || '[]') });
const getRow = (id: string): EncounterRow | null =>
  swdndDb.query<EncounterRow, [string]>('SELECT * FROM encounter WHERE id = ?').get(id) ?? null;

const listRoute = createRoute({
  method: 'get', path: '/swdnd/campaigns/{id}/encounters', tags: ['swdnd'],
  summary: 'List encounter groups for a campaign',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Encounters', content: { 'application/json': { schema: z.array(Encounter) } } },
    404: { description: 'Campaign not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const postRoute = createRoute({
  method: 'post', path: '/swdnd/campaigns/{id}/encounters', tags: ['swdnd'],
  summary: 'Create an encounter group (DM only via the blanket gate)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: PostBody } } },
  },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: Encounter } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Campaign not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const patchRoute = createRoute({
  method: 'patch', path: '/swdnd/encounters/{id}', tags: ['swdnd'],
  summary: 'Update an encounter group (DM only via the blanket gate)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: PatchBody } } },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: Encounter } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const deleteRoute = createRoute({
  method: 'delete', path: '/swdnd/encounters/{id}', tags: ['swdnd'],
  summary: 'Delete an encounter group (DM only via the blanket gate)',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

export function registerEncounterRoutes(app: OpenAPIHono): void {
  app.openapi(listRoute, (c) => {
    const { id: campaignId } = c.req.valid('param');
    const campaign = swdndDb.query<{ id: string }, [string]>('SELECT id FROM campaign WHERE id = ?').get(campaignId);
    if (!campaign) throw new HTTPException(404, { message: 'Campaign not found' });
    const rows = swdndDb
      .query<EncounterRow, [string]>('SELECT * FROM encounter WHERE campaign_id = ? ORDER BY sort ASC, created_at ASC')
      .all(campaignId);
    return c.json(rows.map(encounterOut), 200);
  });

  app.openapi(postRoute, (c) => {
    // /swdnd/campaigns/:id/encounters matches no selfGated clause — the
    // blanket admin gate already rejected non-admin mutations.
    const { id: campaignId } = c.req.valid('param');
    const { name, monsters } = c.req.valid('json');
    const campaign = swdndDb.query<{ id: string }, [string]>('SELECT id FROM campaign WHERE id = ?').get(campaignId);
    if (!campaign) throw new HTTPException(404, { message: 'Campaign not found' });
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    swdndDb.run(
      'INSERT INTO encounter (id, campaign_id, name, monsters_json, sort, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
      [id, campaignId, name, JSON.stringify(monsters ?? []), now, now],
    );
    return c.json(encounterOut(getRow(id)!), 201);
  });

  app.openapi(patchRoute, (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const row = getRow(id);
    if (!row) throw new HTTPException(404, { message: 'Encounter not found' });
    const now = new Date().toISOString();
    swdndDb.run(
      'UPDATE encounter SET name = ?, monsters_json = ?, sort = ?, updated_at = ? WHERE id = ?',
      [
        body.name ?? row.name,
        body.monsters !== undefined ? JSON.stringify(body.monsters) : row.monsters_json,
        body.sort ?? row.sort,
        now,
        id,
      ],
    );
    return c.json(encounterOut(getRow(id)!), 200);
  });

  app.openapi(deleteRoute, (c) => {
    const { id } = c.req.valid('param');
    if (!getRow(id)) throw new HTTPException(404, { message: 'Encounter not found' });
    swdndDb.run('DELETE FROM encounter WHERE id = ?', [id]);
    return c.json({ ok: true }, 200);
  });
}
```

- [ ] **Step 7: Register the routes** — in `apps/backend/src/routes/swdnd/index.ts`: add `import { registerEncounterRoutes } from './encounters';` next to the other imports, and `registerEncounterRoutes(app);` after `registerCharacterRoutes(app);`. Do NOT touch `selfGated`.

- [ ] **Step 8: Run the two files, then the full backend suite**

Run: `cd /Users/asherc/Git/ashercarlow-api && bun test apps/backend/src/routes/swdnd/encounters.test.ts apps/backend/src/routes/swdnd/gate.test.ts && bun test apps/backend`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/db/migrations/swdnd/004_swdnd_encounters.sql apps/backend/src/db/swdnd/index.ts apps/backend/src/routes/swdnd/encounters.ts apps/backend/src/routes/swdnd/encounters.test.ts apps/backend/src/routes/swdnd/index.ts apps/backend/src/routes/swdnd/gate.test.ts
git commit -m "feat(swdnd): encounter table and CRUD routes"
```

---

### Task 2: Pure module `lib/monsters.ts`

**Files:**
- Create: `apps/swdnd/src/lib/monsters.ts`
- Create: `apps/swdnd/src/lib/monsters.test.ts`

- [ ] **Step 1: Write the failing tests** — `apps/swdnd/src/lib/monsters.test.ts`. The `shrub` fixture is a trimmed **real** corpus record (id `ztM6EzzbMpfFBB3a`); the degenerate record exercises every tolerance path.

```ts
// apps/swdnd/src/lib/monsters.test.ts
import { describe, expect, it } from 'bun:test';
import { filterMonsters, monsterTypes, parseMonster } from './monsters';

// Trimmed real corpus record: "Shrub" (CR 0 plant, sm, hp 10 "3d6", ac 9, walk 20).
const shrub = {
  id: 'ztM6EzzbMpfFBB3a',
  name: 'Shrub',
  raw_json: JSON.stringify({
    name: 'Shrub',
    system: {
      abilities: {
        str: { value: 3 }, dex: { value: 8 }, con: { value: 11 },
        int: { value: 10 }, wis: { value: 10 }, cha: { value: 6 },
        hon: { value: 0 }, san: { value: 0 },
      },
      attributes: {
        hp: { value: 10, max: 10, formula: '3d6' },
        ac: { flat: 9, calc: 'natural', formula: '' },
        movement: { walk: 20, fly: 0, swim: 0, climb: 0, burrow: 0, roll: 0, crawl: 0, turn: 0, space: 0, units: 'ft', hover: false },
      },
      details: { cr: 0, type: { value: 'plant', subtype: '', swarm: '', custom: '' } },
      traits: { size: 'sm' },
    },
    items: [
      { type: 'feat', name: 'False Appearance', system: { description: { value: '<p>While the shrub remains motionless, it is indistinguishable from a normal shrub.</p>' } } },
      { type: 'weapon', name: 'Rake', system: { description: { value: '<p><em>Melee Weapon Attack</em> +1, Reach 5 ft., One target. <em>Hit:</em> 1 (1d4 - 1) kinetic damage.</p>' } } },
      { type: 'equipment', name: 'Mulch', system: { description: { value: '<p>ignored</p>' } } },
    ],
  }),
};

const degenerate = { id: 'bad1', name: 'Broken Record', raw_json: '{"name":"Broken Record"}' };
const unparsable = { id: 'bad2', name: 'Not JSON', raw_json: '{nope' };

describe('parseMonster', () => {
  it('parses the essentials from a real record', () => {
    const v = parseMonster(shrub);
    expect(v.id).toBe('ztM6EzzbMpfFBB3a');
    expect(v.name).toBe('Shrub');
    expect(v.cr).toBe(0);
    expect(v.crLabel).toBe('0');
    expect(v.type).toBe('plant');
    expect(v.size).toBe('Small');
    expect(v.hp).toBe(10);
    expect(v.hpFormula).toBe('3d6');
    expect(v.ac).toBe(9);
    expect(v.speed).toBe('20 ft.');
    expect(v.abilities).toEqual({ str: 3, dex: 8, con: 11, int: 10, wis: 10, cha: 6 });
    expect(v.traits).toEqual([{ name: 'False Appearance', text: 'While the shrub remains motionless, it is indistinguishable from a normal shrub.' }]);
    expect(v.actions).toHaveLength(1);
    expect(v.actions[0].name).toBe('Rake');
    expect(v.actions[0].text).toContain('Melee Weapon Attack +1');
    expect(v.powers).toEqual([]); // equipment items ignored, no power items
  });

  it('string and fractional CRs normalize; fractions get fraction labels', () => {
    const withCr = (cr: unknown) => parseMonster({
      id: 'x', name: 'X', raw_json: JSON.stringify({ system: { details: { cr } } }),
    });
    expect(withCr('0').cr).toBe(0);
    expect(withCr(0.125).crLabel).toBe('1/8');
    expect(withCr(0.25).crLabel).toBe('1/4');
    expect(withCr(0.5).crLabel).toBe('1/2');
    expect(withCr(7).crLabel).toBe('7');
    expect(withCr('garbage').cr).toBeNull();
    expect(withCr('garbage').crLabel).toBe('—');
  });

  it('multiple movement modes join; hover annotates fly', () => {
    const v = parseMonster({
      id: 'x', name: 'X',
      raw_json: JSON.stringify({ system: { attributes: { movement: { walk: 30, fly: 60, swim: 20, hover: true, units: 'ft' } } } }),
    });
    expect(v.speed).toBe('30 ft., fly 60 ft. (hover), swim 20 ft.');
  });

  it('a degenerate record displays rough, not broken', () => {
    const v = parseMonster(degenerate);
    expect(v).toEqual({
      id: 'bad1', name: 'Broken Record', cr: null, crLabel: '—', type: '', size: '',
      hp: null, hpFormula: null, ac: null, speed: '',
      abilities: { str: null, dex: null, con: null, int: null, wis: null, cha: null },
      traits: [], actions: [], powers: [],
    });
  });

  it('unparsable raw_json never throws', () => {
    const v = parseMonster(unparsable);
    expect(v.name).toBe('Not JSON');
    expect(v.cr).toBeNull();
  });
});

describe('filterMonsters + monsterTypes', () => {
  const list = [
    parseMonster(shrub),
    parseMonster({ id: 'd1', name: 'Probe Droid', raw_json: JSON.stringify({ system: { details: { cr: 0.25, type: { value: 'droid' } } } }) }),
    parseMonster({ id: 'b1', name: 'Rancor', raw_json: JSON.stringify({ system: { details: { cr: 8, type: { value: 'beast' } } } }) }),
    parseMonster(degenerate), // cr null
  ];

  it('name search is case-insensitive substring', () => {
    expect(filterMonsters(list, { q: 'ranc' }).map((m) => m.name)).toEqual(['Rancor']);
    expect(filterMonsters(list, { q: '' })).toHaveLength(4);
  });

  it('type filter is exact; cr range excludes null-cr records', () => {
    expect(filterMonsters(list, { q: '', type: 'droid' }).map((m) => m.name)).toEqual(['Probe Droid']);
    expect(filterMonsters(list, { q: '', crMin: 0.25 }).map((m) => m.name)).toEqual(['Probe Droid', 'Rancor']);
    expect(filterMonsters(list, { q: '', crMax: 0.5 }).map((m) => m.name)).toEqual(['Shrub', 'Probe Droid']);
    expect(filterMonsters(list, { q: '', crMin: 1, crMax: 10 }).map((m) => m.name)).toEqual(['Rancor']);
  });

  it('monsterTypes lists sorted unique non-empty types', () => {
    expect(monsterTypes(list)).toEqual(['beast', 'droid', 'plant']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/asherc/Git/ashercarlow-api && bun test apps/swdnd/src/lib/monsters.test.ts`
Expected: FAIL — cannot resolve `./monsters`.

- [ ] **Step 3: Implement** — `apps/swdnd/src/lib/monsters.ts`:

```ts
// apps/swdnd/src/lib/monsters.ts — tolerant essentials parser for Foundry
// monster actors. Every field degrades to null/''/[] on malformed data; the
// parser never throws (spec: "display rough, not broken").
import { cleanRichText } from './richText';

export interface MonsterEntryText { name: string; text: string }

export interface MonsterView {
  id: string;
  name: string;
  cr: number | null;
  crLabel: string;
  type: string;
  size: string;
  hp: number | null;
  hpFormula: string | null;
  ac: number | null;
  speed: string;
  abilities: { str: number | null; dex: number | null; con: number | null; int: number | null; wis: number | null; cha: number | null };
  traits: MonsterEntryText[];   // items type 'feat'
  actions: MonsterEntryText[];  // items type 'weapon'
  powers: MonsterEntryText[];   // items type 'power' (262 in the corpus — dropping them would gut casters)
}

export interface MonsterRow { id: string; name: string; raw_json: string }

const SIZE_LABELS: Record<string, string> = {
  tiny: 'Tiny', sm: 'Small', med: 'Medium', lg: 'Large', huge: 'Huge', grg: 'Gargantuan',
};
const CR_FRACTIONS: Record<number, string> = { 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' };
const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
// Real movement modes; 'space'/'turn' are starship fields, 'units'/'hover' are annotations.
const MOVE_MODES = ['walk', 'fly', 'swim', 'climb', 'burrow', 'roll', 'crawl'] as const;

function num(v: unknown): number | null {
  const n = Number(v);
  return typeof v === 'boolean' || v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n;
}

export function crLabel(cr: number | null): string {
  if (cr === null) return '—';
  return CR_FRACTIONS[cr] ?? String(cr);
}

function speedOf(movement: Record<string, unknown> | undefined): string {
  if (!movement) return '';
  const units = typeof movement.units === 'string' && movement.units ? movement.units : 'ft';
  const parts: string[] = [];
  for (const mode of MOVE_MODES) {
    const v = num(movement[mode]);
    if (!v) continue;
    const hover = mode === 'fly' && movement.hover === true ? ' (hover)' : '';
    parts.push(mode === 'walk' ? `${v} ${units}.` : `${mode} ${v} ${units}.${hover}`);
  }
  return parts.join(', ');
}

function itemEntries(items: unknown, type: string): MonsterEntryText[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((it): it is Record<string, any> => !!it && typeof it === 'object' && it.type === type)
    .map((it) => ({
      name: typeof it.name === 'string' ? it.name : '',
      text: cleanRichText(it.system?.description?.value),
    }));
}

/** Parse one content row into a display view. Never throws. */
export function parseMonster(row: MonsterRow): MonsterView {
  let raw: Record<string, any> = {};
  try { raw = JSON.parse(row.raw_json) ?? {}; } catch { /* unparsable → all-null view */ }
  const sys: Record<string, any> = raw.system ?? {};
  const details: Record<string, any> = sys.details ?? {};
  const attrs: Record<string, any> = sys.attributes ?? {};

  const cr = num(details.cr);
  const typeRaw = details.type;
  const type = typeof typeRaw === 'string' ? typeRaw
    : typeof typeRaw?.value === 'string' ? typeRaw.value : '';

  const abilities = {} as MonsterView['abilities'];
  for (const k of ABILITY_KEYS) abilities[k] = num(sys.abilities?.[k]?.value);

  return {
    id: row.id,
    name: row.name || (typeof raw.name === 'string' ? raw.name : row.id),
    cr,
    crLabel: crLabel(cr),
    type,
    size: SIZE_LABELS[sys.traits?.size as string] ?? '',
    hp: num(attrs.hp?.max) ?? num(attrs.hp?.value),
    hpFormula: typeof attrs.hp?.formula === 'string' && attrs.hp.formula ? attrs.hp.formula : null,
    ac: num(attrs.ac?.flat),
    speed: speedOf(attrs.movement),
    abilities,
    traits: itemEntries(raw.items, 'feat'),
    actions: itemEntries(raw.items, 'weapon'),
    powers: itemEntries(raw.items, 'power'),
  };
}

export interface MonsterFilter { q: string; type?: string; crMin?: number; crMax?: number }

export function filterMonsters(list: MonsterView[], f: MonsterFilter): MonsterView[] {
  const q = f.q.trim().toLowerCase();
  return list.filter((m) => {
    if (q && !m.name.toLowerCase().includes(q)) return false;
    if (f.type && m.type !== f.type) return false;
    if (f.crMin !== undefined && (m.cr === null || m.cr < f.crMin)) return false;
    if (f.crMax !== undefined && (m.cr === null || m.cr > f.crMax)) return false;
    return true;
  });
}

export function monsterTypes(list: MonsterView[]): string[] {
  return [...new Set(list.map((m) => m.type).filter(Boolean))].sort();
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd /Users/asherc/Git/ashercarlow-api && bun test apps/swdnd/src/lib/monsters.test.ts`
Expected: PASS. If a text assertion fails, check `cleanRichText`'s actual output before touching the parser.

- [ ] **Step 5: Typecheck** — `cd /Users/asherc/Git/ashercarlow-api/apps/swdnd && bun run build` → clean.

- [ ] **Step 6: Commit**

```bash
git add apps/swdnd/src/lib/monsters.ts apps/swdnd/src/lib/monsters.test.ts
git commit -m "feat(swdnd): tolerant monster essentials parser"
```

---

### Task 3: Pure modules `lib/spawn.ts` + `lib/refSearch.ts`

**Files:**
- Create: `apps/swdnd/src/lib/spawn.ts` + `apps/swdnd/src/lib/spawn.test.ts`
- Create: `apps/swdnd/src/lib/refSearch.ts` + `apps/swdnd/src/lib/refSearch.test.ts`

- [ ] **Step 1: Write the failing spawn tests** — `apps/swdnd/src/lib/spawn.test.ts`:

```ts
// apps/swdnd/src/lib/spawn.test.ts
import { describe, expect, it } from 'bun:test';
import { hexDistance } from './hex';
import { spawnBodies, spawnPositions } from './spawn';
import type { MonsterView } from './monsters';

const view = (over: Partial<MonsterView> = {}): MonsterView => ({
  id: 'm1', name: 'Probe Droid', cr: 0.25, crLabel: '1/4', type: 'droid', size: 'Small',
  hp: 25, hpFormula: null, ac: 12, speed: '30 ft.',
  abilities: { str: 10, dex: 12, con: 10, int: 14, wis: 10, cha: 10 },
  traits: [], actions: [], powers: [], ...over,
});

describe('spawnPositions', () => {
  it('returns exactly count hexes, center first, sorted center-out, all unique', () => {
    const center = { q: 3, r: -1 };
    const pos = spawnPositions(center, 9);
    expect(pos).toHaveLength(9);
    expect(pos[0]).toEqual(center);
    const dists = pos.map((h) => hexDistance(center, h));
    expect(dists).toEqual([...dists].sort((a, b) => a - b)); // non-decreasing
    expect(new Set(pos.map((h) => `${h.q},${h.r}`)).size).toBe(9);
    expect(Math.max(...dists)).toBe(2); // 9 fit in radius 2 (1+6+2)
  });

  it('count 1 is just the center; count 0 is empty', () => {
    expect(spawnPositions({ q: 0, r: 0 }, 1)).toEqual([{ q: 0, r: 0 }]);
    expect(spawnPositions({ q: 0, r: 0 }, 0)).toEqual([]);
  });
});

describe('spawnBodies', () => {
  it('builds hostile token payloads with hp prefilled and #N suffixes for multiples', () => {
    const bodies = spawnBodies(view(), 3, spawnPositions({ q: 0, r: 0 }, 3));
    expect(bodies).toHaveLength(3);
    expect(bodies[0]).toEqual({ name: 'Probe Droid', faction: 'hostile', q: 0, r: 0, hp: 25, max_hp: 25 });
    expect(bodies[1].name).toBe('Probe Droid #2');
    expect(bodies[2].name).toBe('Probe Droid #3');
    expect(bodies[1].q === 0 && bodies[1].r === 0).toBe(false); // distinct hexes
  });

  it('single spawn gets no suffix; null hp passes through as null', () => {
    const bodies = spawnBodies(view({ hp: null }), 1, spawnPositions({ q: 2, r: 2 }, 1));
    expect(bodies).toEqual([{ name: 'Probe Droid', faction: 'hostile', q: 2, r: 2, hp: null, max_hp: null }]);
  });
});
```

- [ ] **Step 2: Write the failing refSearch tests** — `apps/swdnd/src/lib/refSearch.test.ts`:

```ts
// apps/swdnd/src/lib/refSearch.test.ts
import { describe, expect, it } from 'bun:test';
import { refEntryFromRow, searchEntries, type RefEntry } from './refSearch';

// Journal-doc shape (conditions, weapon properties): text at pages[].text.content.
const journalRow = {
  id: 'j1', name: 'Blinded',
  raw_json: JSON.stringify({
    name: 'Blinded',
    pages: [{ name: 'Blinded', type: 'text', text: { format: 1, content: "<p>A blinded creature can't see.</p><ul><li>Attack rolls against it have advantage.</li></ul>" } }],
  }),
};
// Item-doc shape (fallback): text at system.description.value.
const itemRow = {
  id: 'i1', name: 'Saber Ward',
  raw_json: JSON.stringify({ name: 'Saber Ward', system: { description: { value: '<p>You raise your saber to ward.</p>' } } }),
};
const brokenRow = { id: 'b1', name: 'Broken', raw_json: '{nope' };

describe('refEntryFromRow', () => {
  it('reads journal pages, joining and cleaning to plain text', () => {
    const e = refEntryFromRow(journalRow);
    expect(e).toEqual({
      id: 'j1', name: 'Blinded',
      text: "A blinded creature can't see.\n• Attack rolls against it have advantage.",
    });
  });

  it('falls back to system.description for item docs', () => {
    expect(refEntryFromRow(itemRow).text).toBe('You raise your saber to ward.');
  });

  it('never throws on unparsable raw_json', () => {
    expect(refEntryFromRow(brokenRow)).toEqual({ id: 'b1', name: 'Broken', text: '' });
  });
});

describe('searchEntries', () => {
  const entries: RefEntry[] = [
    { id: '1', name: 'Blinded', text: 'cannot see' },
    { id: '2', name: 'Deafened', text: 'cannot hear sounds' },
    { id: '3', name: 'Auto', text: 'burst or rapid fire modes' },
  ];

  it('matches name or body text, case-insensitive; empty query returns all', () => {
    expect(searchEntries(entries, 'blind').map((e) => e.name)).toEqual(['Blinded']);
    expect(searchEntries(entries, 'SOUNDS').map((e) => e.name)).toEqual(['Deafened']);
    expect(searchEntries(entries, '')).toHaveLength(3);
    expect(searchEntries(entries, 'nope')).toEqual([]);
  });
});
```

- [ ] **Step 3: Run both to verify failure**

Run: `cd /Users/asherc/Git/ashercarlow-api && bun test apps/swdnd/src/lib/spawn.test.ts apps/swdnd/src/lib/refSearch.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 4: Implement `apps/swdnd/src/lib/spawn.ts`**

```ts
// apps/swdnd/src/lib/spawn.ts — pure spawn placement + token payloads.
import { hexRing, type Hex } from './hex';
import type { MonsterView } from './monsters';

/** First `count` hexes of a compact center-out cluster: the center, then each
 * ring outward in hexRing order. The DM drags tokens from there. */
export function spawnPositions(center: Hex, count: number): Hex[] {
  const out: Hex[] = [];
  for (let radius = 0; out.length < count; radius++) {
    for (const h of hexRing(center, radius)) {
      if (out.length >= count) break;
      out.push(h);
    }
  }
  return out;
}

export interface SpawnBody {
  name: string;
  faction: 'hostile';
  q: number;
  r: number;
  hp: number | null;
  max_hp: number | null;
}

/** Token-create payloads for `count` copies of a statblock: hostile faction,
 * hp/max prefilled, names suffixed `#2, #3…` for multiples. */
export function spawnBodies(view: MonsterView, count: number, positions: Hex[]): SpawnBody[] {
  return positions.slice(0, count).map((pos, i) => ({
    name: i === 0 ? view.name : `${view.name} #${i + 1}`,
    faction: 'hostile',
    q: pos.q,
    r: pos.r,
    hp: view.hp,
    max_hp: view.hp,
  }));
}
```

- [ ] **Step 5: Implement `apps/swdnd/src/lib/refSearch.ts`**

```ts
// apps/swdnd/src/lib/refSearch.ts — reference entries from content rows.
// Conditions and weapon properties are Foundry JOURNAL docs (text lives at
// pages[].text.content); other categories are item docs (system.description).
import { cleanRichText } from './richText';

export interface RefEntry { id: string; name: string; text: string }
export interface RefRow { id: string; name: string; raw_json: string }

export function refEntryFromRow(row: RefRow): RefEntry {
  let raw: Record<string, any> = {};
  try { raw = JSON.parse(row.raw_json) ?? {}; } catch { /* text stays '' */ }
  const pages = Array.isArray(raw.pages) ? raw.pages : [];
  const journalText = pages
    .map((p: any) => (typeof p?.text?.content === 'string' ? p.text.content : ''))
    .filter(Boolean)
    .join('\n');
  const html = journalText || raw.system?.description?.value;
  return { id: row.id, name: row.name, text: cleanRichText(html) };
}

/** Case-insensitive name-or-body filter; empty query returns everything. */
export function searchEntries<T extends RefEntry>(entries: T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter((e) => e.name.toLowerCase().includes(needle) || e.text.toLowerCase().includes(needle));
}
```

- [ ] **Step 6: Run to verify pass, then typecheck**

Run: `cd /Users/asherc/Git/ashercarlow-api && bun test apps/swdnd/src/lib/spawn.test.ts apps/swdnd/src/lib/refSearch.test.ts && cd apps/swdnd && bun run build`
Expected: PASS + clean build.

- [ ] **Step 7: Commit**

```bash
git add apps/swdnd/src/lib/spawn.ts apps/swdnd/src/lib/spawn.test.ts apps/swdnd/src/lib/refSearch.ts apps/swdnd/src/lib/refSearch.test.ts
git commit -m "feat(swdnd): spawn placement and reference search pure modules"
```

---

### Task 4: `lib/encounters.ts` (DTO + wrappers + edit helpers)

**Files:**
- Create: `apps/swdnd/src/lib/encounters.ts`
- Create: `apps/swdnd/src/lib/encounters.test.ts`

- [ ] **Step 1: Write the failing tests** — `apps/swdnd/src/lib/encounters.test.ts` (pure helpers only; the REST wrappers are thin `api` calls, covered by the backend route tests + walkthrough):

```ts
// apps/swdnd/src/lib/encounters.test.ts
import { describe, expect, it } from 'bun:test';
import { addMonster, removeMonster, setCount, totalCount, type EncounterMonster } from './encounters';

const base: EncounterMonster[] = [{ monsterId: 'a', count: 2 }, { monsterId: 'b', count: 1 }];

describe('encounter monster-list helpers (immutable)', () => {
  it('addMonster appends new ids at count 1 and increments existing', () => {
    expect(addMonster(base, 'c')).toEqual([...base, { monsterId: 'c', count: 1 }]);
    expect(addMonster(base, 'a')).toEqual([{ monsterId: 'a', count: 3 }, { monsterId: 'b', count: 1 }]);
    expect(base[0].count).toBe(2); // untouched
  });

  it('setCount clamps at 1+ and removes at 0 or below', () => {
    expect(setCount(base, 'b', 4)).toEqual([{ monsterId: 'a', count: 2 }, { monsterId: 'b', count: 4 }]);
    expect(setCount(base, 'a', 0)).toEqual([{ monsterId: 'b', count: 1 }]);
    expect(setCount(base, 'missing', 3)).toEqual(base);
  });

  it('removeMonster drops the id; totalCount sums', () => {
    expect(removeMonster(base, 'a')).toEqual([{ monsterId: 'b', count: 1 }]);
    expect(totalCount(base)).toBe(3);
    expect(totalCount([])).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd /Users/asherc/Git/ashercarlow-api && bun test apps/swdnd/src/lib/encounters.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `apps/swdnd/src/lib/encounters.ts`:

```ts
// apps/swdnd/src/lib/encounters.ts — encounter DTO, REST wrappers, and
// immutable monster-list edit helpers for the encounter editor.
import { api } from './api';

export interface EncounterMonster { monsterId: string; count: number }
export interface EncounterDto {
  id: string;
  campaign_id: string;
  name: string;
  monsters_json: EncounterMonster[];
  sort: number;
  created_at: string;
  updated_at: string;
}

export const listEncounters = (campaignId: string) =>
  api<EncounterDto[]>(`/swdnd/campaigns/${campaignId}/encounters`);
export const createEncounter = (campaignId: string, name: string, monsters?: EncounterMonster[]) =>
  api<EncounterDto>(`/swdnd/campaigns/${campaignId}/encounters`, {
    method: 'POST', body: JSON.stringify({ name, ...(monsters ? { monsters } : {}) }),
  });
export const patchEncounter = (id: string, patch: { name?: string; monsters?: EncounterMonster[]; sort?: number }) =>
  api<EncounterDto>(`/swdnd/encounters/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
export const deleteEncounter = (id: string) =>
  api<{ ok: boolean }>(`/swdnd/encounters/${id}`, { method: 'DELETE' });

export function addMonster(list: EncounterMonster[], monsterId: string): EncounterMonster[] {
  return list.some((m) => m.monsterId === monsterId)
    ? list.map((m) => (m.monsterId === monsterId ? { ...m, count: m.count + 1 } : m))
    : [...list, { monsterId, count: 1 }];
}

export function setCount(list: EncounterMonster[], monsterId: string, count: number): EncounterMonster[] {
  if (!list.some((m) => m.monsterId === monsterId)) return list;
  if (count <= 0) return list.filter((m) => m.monsterId !== monsterId);
  return list.map((m) => (m.monsterId === monsterId ? { ...m, count } : m));
}

export function removeMonster(list: EncounterMonster[], monsterId: string): EncounterMonster[] {
  return list.filter((m) => m.monsterId !== monsterId);
}

export function totalCount(list: EncounterMonster[]): number {
  return list.reduce((sum, m) => sum + m.count, 0);
}
```

- [ ] **Step 4: Run to verify pass, then typecheck** — `cd /Users/asherc/Git/ashercarlow-api && bun test apps/swdnd/src/lib/encounters.test.ts && cd apps/swdnd && bun run build` → PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/encounters.ts apps/swdnd/src/lib/encounters.test.ts
git commit -m "feat(swdnd): encounter client wrappers and edit helpers"
```

---

### Task 5: `useDmScreen` extension (monsters, reference, encounters, spawn)

**Files:**
- Modify: `apps/swdnd/src/hooks/useDmScreen.ts`

Read the current file in full first. The changes below extend it — keep all existing phase-1 behavior (cards, players, campaign, WS merge) intact.

- [ ] **Step 1: Add imports** — after the existing imports:

```ts
import { api } from '../lib/api';
import { listScenes, createToken } from '../lib/scenes';
import { pixelToHex } from '../lib/hex';
import { parseMonster, type MonsterRow, type MonsterView } from '../lib/monsters';
import { refEntryFromRow, type RefEntry, type RefRow } from '../lib/refSearch';
import { spawnBodies, spawnPositions } from '../lib/spawn';
import {
  createEncounter, deleteEncounter, listEncounters, patchEncounter,
  type EncounterDto, type EncounterMonster,
} from '../lib/encounters';
```

- [ ] **Step 2: Extend the state interface** — `DmScreenState` gains:

```ts
  monsters: MonsterView[];
  refEntries: { conditions: RefEntry[]; weaponProperties: RefEntry[]; powers: PowerEntry[] };
  encounters: EncounterDto[];
```

with this exported type above the interface (powers reuse `loadReference`'s already-fetched data — no refetch):

```ts
export interface PowerEntry extends RefEntry { level: number; castType: 'force' | 'tech' }
```

and `actions` gains:

```ts
    spawn: (view: MonsterView, count: number) => Promise<void>;
    spawnEncounter: (enc: EncounterDto) => Promise<void>;
    addEncounter: (name: string) => Promise<void>;
    renameEncounter: (id: string, name: string) => Promise<void>;
    setEncounterMonsters: (id: string, monsters: EncounterMonster[]) => Promise<void>;
    removeEncounter: (id: string) => Promise<void>;
```

- [ ] **Step 3: Add state + extend `reload()`** — new state alongside the existing:

```ts
  const [monsters, setMonsters] = useState<MonsterView[]>([]);
  const [refEntries, setRefEntries] = useState<DmScreenState['refEntries']>({ conditions: [], weaponProperties: [], powers: [] });
  const [encounters, setEncounters] = useState<EncounterDto[]>([]);
```

In `reload()`, extend the `Promise.all` to also fetch monsters, the two journal categories, and encounters (the existing four loads stay):

```ts
    Promise.all([
      getCampaign(campaignId), listCharacters(campaignId), listPlayers(campaignId), loadReference(),
      api<MonsterRow[]>('/swdnd/content/monsters'),
      api<RefRow[]>('/swdnd/content/conditions'),
      api<RefRow[]>('/swdnd/content/weapon_properties'),
      listEncounters(campaignId),
    ])
      .then(([camp, chars, slots, ref, monsterRows, conditionRows, wpRows, encs]) => {
        refData.current = ref;
        setCampaign(camp);
        setPlayers(slots);
        setMonsters(monsterRows.map(parseMonster).sort((a, b) => a.name.localeCompare(b.name)));
        setRefEntries({
          conditions: conditionRows.map(refEntryFromRow),
          weaponProperties: wpRows.map(refEntryFromRow),
          powers: Object.values(ref.powers)
            .map((p) => ({ id: p.id, name: p.name, text: p.description, level: p.level, castType: p.castType }))
            .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)),
        });
        setEncounters(encs);
        cardsLoaded.current = true;
        setCards(applyPendingCardPlays(buildCards(chars, ref), pending.current));
        pending.current = {};
        setError(null);
      })
```

(`RefPower` in rules/types has `id`, `name`, `level`, `castType`, `description` — mapped by `mapPowerRow`.)

- [ ] **Step 4: Add the spawn + encounter actions** — before the `return`:

```ts
  // Spawn composes the existing token routes against the ACTIVE scene; tokens
  // appear on every viewer via the existing token:created broadcasts.
  const spawnMany = useCallback(async (groups: { view: MonsterView; count: number }[]) => {
    const scenes = await listScenes(campaignId);
    const active = scenes.find((s) => s.is_active === 1);
    if (!active) throw new Error('No active scene to spawn onto — activate one on the map first.');
    const cx = (active.image_w ?? 0) / 2;
    const cy = (active.image_h ?? 0) / 2;
    const center = active.grid_json ? pixelToHex(cx, cy, active.grid_json) : { q: 0, r: 0 };
    const total = groups.reduce((sum, g) => sum + g.count, 0);
    const positions = spawnPositions(center, total);
    let used = 0;
    for (const g of groups) {
      const bodies = spawnBodies(g.view, g.count, positions.slice(used, used + g.count));
      used += g.count;
      for (const body of bodies) await createToken(active.id, body);
    }
  }, [campaignId]);

  const refreshEncounters = useCallback(
    () => listEncounters(campaignId).then(setEncounters),
    [campaignId],
  );
```

and in `actions` (reusing the existing `wrap` helper):

```ts
      spawn: wrap(async (view: MonsterView, count: number) => { await spawnMany([{ view, count }]); }),
      spawnEncounter: wrap(async (enc: EncounterDto) => {
        const byId = new Map(monsters.map((m) => [m.id, m]));
        const groups = enc.monsters_json
          .map((e) => ({ view: byId.get(e.monsterId), count: e.count }))
          .filter((g): g is { view: MonsterView; count: number } => !!g.view);
        if (groups.length === 0) throw new Error('No known monsters in this encounter.');
        await spawnMany(groups);
      }),
      addEncounter: wrap(async (name: string) => { await createEncounter(campaignId, name); await refreshEncounters(); }),
      renameEncounter: wrap(async (id: string, name: string) => { await patchEncounter(id, { name }); await refreshEncounters(); }),
      setEncounterMonsters: wrap(async (id: string, monsters: EncounterMonster[]) => {
        await patchEncounter(id, { monsters });
        await refreshEncounters();
      }),
      removeEncounter: wrap(async (id: string) => { await deleteEncounter(id); await refreshEncounters(); }),
```

and add `monsters, refEntries, encounters,` to the returned state object.

- [ ] **Step 5: Typecheck + frontend suite**

Run: `cd /Users/asherc/Git/ashercarlow-api/apps/swdnd && bun run build && cd /Users/asherc/Git/ashercarlow-api && bun test apps/swdnd`
Expected: clean + PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/swdnd/src/hooks/useDmScreen.ts
git commit -m "feat(swdnd): useDmScreen monsters/reference/encounters/spawn"
```

---

### Task 6: MonsterBrowser + Statblock

**Files:**
- Create: `apps/swdnd/src/panels/DMScreen/Statblock.tsx`
- Create: `apps/swdnd/src/panels/DMScreen/MonsterBrowser.tsx`

- [ ] **Step 1: Create `apps/swdnd/src/panels/DMScreen/Statblock.tsx`** — pure display; all text is `cleanRichText` plain text rendered with `whitespace-pre-line`:

```tsx
// apps/swdnd/src/panels/DMScreen/Statblock.tsx — essentials statblock pane.
import type { MonsterEntryText, MonsterView } from '../../lib/monsters';

const mod = (v: number | null): string => {
  if (v === null) return '—';
  const m = Math.floor((v - 10) / 2);
  return `${v} (${m >= 0 ? '+' : ''}${m})`;
};

function EntryGroup({ label, entries }: { label: string; entries: MonsterEntryText[] }) {
  if (entries.length === 0) return null;
  return (
    <section className="mt-3">
      <div className="ht-label mb-1">{label}</div>
      <div className="flex flex-col gap-2">
        {entries.map((e, i) => (
          <div key={`${e.name}-${i}`} className="text-[11px]">
            <span className="font-bold text-ht-bright">{e.name}. </span>
            <span className="whitespace-pre-line text-ht-text">{e.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Statblock({ view }: { view: MonsterView }) {
  const abilities: Array<[string, number | null]> = [
    ['STR', view.abilities.str], ['DEX', view.abilities.dex], ['CON', view.abilities.con],
    ['INT', view.abilities.int], ['WIS', view.abilities.wis], ['CHA', view.abilities.cha],
  ];
  return (
    <div>
      <div className="ht-name text-sm font-bold text-ht-bright">{view.name}</div>
      <div className="text-[10px] text-ht-muted">
        {[view.size, view.type].filter(Boolean).join(' ')} · CR {view.crLabel}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        <span><span className="ht-label">AC</span> {view.ac ?? '—'}</span>
        <span>
          <span className="ht-label">HP</span> {view.hp ?? '—'}
          {view.hpFormula ? <span className="text-ht-muted"> ({view.hpFormula})</span> : null}
        </span>
        <span><span className="ht-label">Speed</span> {view.speed || '—'}</span>
      </div>

      <div className="mt-2 grid grid-cols-6 gap-1 text-center text-[10px]">
        {abilities.map(([k, v]) => (
          <div key={k} className="rounded border border-ht-line p-1">
            <div className="ht-label">{k}</div>
            <div className="text-ht-bright">{mod(v)}</div>
          </div>
        ))}
      </div>

      <EntryGroup label="Traits" entries={view.traits} />
      <EntryGroup label="Actions" entries={view.actions} />
      <EntryGroup label="Powers" entries={view.powers} />
    </div>
  );
}
```

- [ ] **Step 2: Create `apps/swdnd/src/panels/DMScreen/MonsterBrowser.tsx`**

```tsx
// apps/swdnd/src/panels/DMScreen/MonsterBrowser.tsx — search/filter list +
// statblock pane with spawn and add-to-encounter controls.
import { useMemo, useState } from 'react';
import { filterMonsters, monsterTypes, type MonsterView } from '../../lib/monsters';
import type { EncounterDto } from '../../lib/encounters';
import Statblock from './Statblock';

const CR_STEPS = [0, 0.125, 0.25, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20] as const;
const crText = (v: number) => ({ 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' } as Record<number, string>)[v] ?? String(v);

interface Props {
  monsters: MonsterView[];
  encounters: EncounterDto[];
  onSpawn: (view: MonsterView, count: number) => void;
  onAddToEncounter: (encounterId: string, monsterId: string) => void;
}

export default function MonsterBrowser({ monsters, encounters, onSpawn, onAddToEncounter }: Props) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [crMin, setCrMin] = useState('');
  const [crMax, setCrMax] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [count, setCount] = useState(1);
  const [encId, setEncId] = useState('');

  const types = useMemo(() => monsterTypes(monsters), [monsters]);
  const filtered = useMemo(() => filterMonsters(monsters, {
    q,
    type: type || undefined,
    crMin: crMin === '' ? undefined : Number(crMin),
    crMax: crMax === '' ? undefined : Number(crMax),
  }), [monsters, q, type, crMin, crMax]);
  const selected = monsters.find((m) => m.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-3 @[700px]:flex-row">
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
          <input
            className="w-40 border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none"
            placeholder="search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="border-b border-ht-line bg-transparent text-ht-text outline-none" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">any type</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="border-b border-ht-line bg-transparent text-ht-text outline-none" value={crMin} onChange={(e) => setCrMin(e.target.value)}>
            <option value="">CR min</option>
            {CR_STEPS.map((v) => <option key={v} value={v}>{crText(v)}</option>)}
          </select>
          <select className="border-b border-ht-line bg-transparent text-ht-text outline-none" value={crMax} onChange={(e) => setCrMax(e.target.value)}>
            <option value="">CR max</option>
            {CR_STEPS.map((v) => <option key={v} value={v}>{crText(v)}</option>)}
          </select>
          <span className="text-[10px] text-ht-muted">{filtered.length}/{monsters.length}</span>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {filtered.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`flex w-full items-baseline gap-2 border-b border-ht-line/50 px-1 py-1 text-left text-[11px] ${m.id === selectedId ? 'ht-tile-active' : ''}`}
              onClick={() => setSelectedId(m.id)}
            >
              <span className="text-ht-bright">{m.name}</span>
              <span className="ml-auto shrink-0 text-[10px] text-ht-muted">
                CR {m.crLabel}{m.type ? ` · ${m.type}` : ''}{m.size ? ` · ${m.size}` : ''}
              </span>
            </button>
          ))}
          {filtered.length === 0 && <div className="p-2 text-[11px] text-ht-muted">No matches.</div>}
        </div>
      </div>

      <div className="ht-panel min-w-0 flex-1 p-3 @[700px]:max-w-[46%]">
        {selected ? (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
              <select className="border-b border-ht-line bg-transparent text-ht-text outline-none" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>×{n}</option>)}
              </select>
              <button type="button" className="ht-step" onClick={() => onSpawn(selected, count)}>spawn to map</button>
              {encounters.length > 0 && (
                <span className="ml-auto flex items-center gap-1">
                  <select className="max-w-[140px] border-b border-ht-line bg-transparent text-ht-text outline-none" value={encId} onChange={(e) => setEncId(e.target.value)}>
                    <option value="">encounter…</option>
                    {encounters.map((enc) => <option key={enc.id} value={enc.id}>{enc.name}</option>)}
                  </select>
                  <button
                    type="button"
                    className="ht-step"
                    onClick={() => encId && onAddToEncounter(encId, selected.id)}
                  >
                    + add
                  </button>
                </span>
              )}
            </div>
            <Statblock view={selected} />
          </>
        ) : (
          <div className="text-[11px] text-ht-muted">Select a monster to view its statblock.</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck** — `cd /Users/asherc/Git/ashercarlow-api/apps/swdnd && bun run build`. The components aren't wired into `index.tsx` yet — with `noUnusedLocals` that's fine (they're separate modules), but the build must still pass.

- [ ] **Step 4: Commit**

```bash
git add apps/swdnd/src/panels/DMScreen/Statblock.tsx apps/swdnd/src/panels/DMScreen/MonsterBrowser.tsx
git commit -m "feat(swdnd): monster browser and statblock panes"
```

---

### Task 7: EncounterList + Reference + tab wiring

**Files:**
- Create: `apps/swdnd/src/panels/DMScreen/EncounterList.tsx`
- Create: `apps/swdnd/src/panels/DMScreen/Reference.tsx`
- Modify: `apps/swdnd/src/panels/DMScreen/index.tsx`

- [ ] **Step 1: Create `apps/swdnd/src/panels/DMScreen/EncounterList.tsx`**

```tsx
// apps/swdnd/src/panels/DMScreen/EncounterList.tsx — named monster groups.
import { useState } from 'react';
import {
  addMonster, removeMonster, setCount, totalCount,
  type EncounterDto, type EncounterMonster,
} from '../../lib/encounters';
import type { MonsterView } from '../../lib/monsters';
import BufferedText from './BufferedText';

interface Props {
  encounters: EncounterDto[];
  monsters: MonsterView[];
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onSetMonsters: (id: string, monsters: EncounterMonster[]) => void;
  onSpawnAll: (enc: EncounterDto) => void;
  onDelete: (id: string) => void;
}

export default function EncounterList({ encounters, monsters, onCreate, onRename, onSetMonsters, onSpawnAll, onDelete }: Props) {
  const [newName, setNewName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [addPick, setAddPick] = useState<Record<string, string>>({});
  const nameOf = (id: string) => monsters.find((m) => m.id === id)?.name ?? `(unknown ${id})`;

  const create = () => {
    if (!newName.trim()) return;
    onCreate(newName.trim());
    setNewName('');
  };

  return (
    <div className="flex flex-col gap-2">
      {encounters.length === 0 && (
        <div className="text-[11px] text-ht-muted">No encounters yet — create a named group below, then add monsters from the browser or here.</div>
      )}
      {encounters.map((enc) => (
        <div key={enc.id} className="ht-panel p-3">
          <div className="flex flex-wrap items-center gap-2">
            <BufferedText
              value={enc.name}
              onCommit={(name) => onRename(enc.id, name)}
              className="min-w-[140px] border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none"
            />
            <span className="text-[10px] text-ht-muted">{totalCount(enc.monsters_json)} monsters</span>
            <div className="ml-auto flex items-center gap-2 text-[11px]">
              <button type="button" className="ht-step" onClick={() => onSpawnAll(enc)}>spawn all</button>
              {confirmDelete === enc.id ? (
                <span className="flex items-center gap-1 text-[10px]">
                  <button type="button" className="ht-step text-red-400" onClick={() => { setConfirmDelete(null); onDelete(enc.id); }}>confirm ✕</button>
                  <button type="button" className="ht-step" onClick={() => setConfirmDelete(null)}>keep</button>
                </span>
              ) : (
                <button type="button" className="text-[10px] text-ht-muted" onClick={() => setConfirmDelete(enc.id)}>delete</button>
              )}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {enc.monsters_json.map((m) => (
              <span key={m.monsterId} className="flex items-center gap-1 rounded border border-ht-line px-1 py-0.5 text-[10px]">
                <span className="text-ht-bright">{nameOf(m.monsterId)}</span>
                <button type="button" className="text-ht-muted" onClick={() => onSetMonsters(enc.id, setCount(enc.monsters_json, m.monsterId, m.count - 1))}>−</button>
                <span>×{m.count}</span>
                <button type="button" className="text-ht-muted" onClick={() => onSetMonsters(enc.id, setCount(enc.monsters_json, m.monsterId, m.count + 1))}>+</button>
                <button type="button" className="text-red-400" onClick={() => onSetMonsters(enc.id, removeMonster(enc.monsters_json, m.monsterId))}>✕</button>
              </span>
            ))}
            <span className="flex items-center gap-1 text-[10px]">
              <select
                className="max-w-[160px] border-b border-ht-line bg-transparent text-ht-text outline-none"
                value={addPick[enc.id] ?? ''}
                onChange={(e) => setAddPick((cur) => ({ ...cur, [enc.id]: e.target.value }))}
              >
                <option value="">add monster…</option>
                {monsters.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <button
                type="button"
                className="ht-step"
                onClick={() => {
                  const pick = addPick[enc.id];
                  if (pick) onSetMonsters(enc.id, addMonster(enc.monsters_json, pick));
                }}
              >
                +
              </button>
            </span>
          </div>
        </div>
      ))}

      <div className="ht-panel flex flex-wrap items-center gap-2 p-3">
        <span className="ht-label">New encounter</span>
        <input
          className="w-48 border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none"
          placeholder="name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
        <button type="button" className="ht-step" onClick={create}>+ create</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `apps/swdnd/src/panels/DMScreen/Reference.tsx`** (RefLookup lives here as the internal list component — one file, one purpose: the reference tab):

```tsx
// apps/swdnd/src/panels/DMScreen/Reference.tsx — three-category quick lookup.
import { useState } from 'react';
import { searchEntries, type RefEntry } from '../../lib/refSearch';
import type { PowerEntry } from '../../hooks/useDmScreen';

const CATEGORIES = ['conditions', 'powers', 'weapon properties'] as const;
type Category = (typeof CATEGORIES)[number];

function RefLookup({ entries, meta }: { entries: RefEntry[]; meta?: (e: RefEntry) => string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (entries.length === 0) return <div className="text-[11px] text-ht-muted">No matches.</div>;
  return (
    <div className="max-h-[440px] overflow-y-auto">
      {entries.map((e) => (
        <div key={e.id} className="border-b border-ht-line/50">
          <button
            type="button"
            className="flex w-full items-baseline gap-2 px-1 py-1 text-left text-[11px]"
            onClick={() => setOpenId((cur) => (cur === e.id ? null : e.id))}
          >
            <span className="text-ht-bright">{e.name}</span>
            {meta && <span className="ml-auto shrink-0 text-[10px] text-ht-muted">{meta(e)}</span>}
          </button>
          {openId === e.id && (
            <div className="whitespace-pre-line px-1 pb-2 text-[11px] text-ht-text">{e.text}</div>
          )}
        </div>
      ))}
    </div>
  );
}

interface Props {
  conditions: RefEntry[];
  powers: PowerEntry[];
  weaponProperties: RefEntry[];
}

export default function Reference({ conditions, powers, weaponProperties }: Props) {
  const [category, setCategory] = useState<Category>('conditions');
  const [q, setQ] = useState('');
  const [castType, setCastType] = useState('');
  const [level, setLevel] = useState('');

  const filteredPowers = searchEntries(powers, q).filter((p) =>
    (!castType || p.castType === castType) && (level === '' || p.level === Number(level)));

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
        {CATEGORIES.map((c) => (
          <button key={c} type="button" className={`ht-step ${category === c ? 'ht-tile-active' : ''}`} onClick={() => setCategory(c)}>
            {c}
          </button>
        ))}
        <input
          className="w-40 border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none"
          placeholder="search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {category === 'powers' && (
          <>
            <select className="border-b border-ht-line bg-transparent text-ht-text outline-none" value={castType} onChange={(e) => setCastType(e.target.value)}>
              <option value="">force + tech</option>
              <option value="force">force</option>
              <option value="tech">tech</option>
            </select>
            <select className="border-b border-ht-line bg-transparent text-ht-text outline-none" value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="">any level</option>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>{n === 0 ? 'at-will' : `level ${n}`}</option>)}
            </select>
          </>
        )}
      </div>

      {category === 'conditions' && <RefLookup entries={searchEntries(conditions, q)} />}
      {category === 'weapon properties' && <RefLookup entries={searchEntries(weaponProperties, q)} />}
      {category === 'powers' && (
        <RefLookup
          entries={filteredPowers}
          meta={(e) => {
            const p = e as PowerEntry;
            return `${p.castType} · ${p.level === 0 ? 'at-will' : `L${p.level}`}`;
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire the tabs** — in `apps/swdnd/src/panels/DMScreen/index.tsx`: add imports

```tsx
import MonsterBrowser from './MonsterBrowser';
import EncounterList from './EncounterList';
import Reference from './Reference';
import { addMonster } from '../../lib/encounters';
```

and replace the placeholder `<div className="ht-panel p-4 text-[11px] text-ht-muted">…</div>` block with:

```tsx
          <div className="ht-panel p-4">
            {tab === 'monsters' && (
              <MonsterBrowser
                monsters={dm.monsters}
                encounters={dm.encounters}
                onSpawn={(view, count) => void dm.actions.spawn(view, count)}
                onAddToEncounter={(encounterId, monsterId) => {
                  const enc = dm.encounters.find((e) => e.id === encounterId);
                  if (enc) void dm.actions.setEncounterMonsters(encounterId, addMonster(enc.monsters_json, monsterId));
                }}
              />
            )}
            {tab === 'encounters' && (
              <EncounterList
                encounters={dm.encounters}
                monsters={dm.monsters}
                onCreate={(name) => void dm.actions.addEncounter(name)}
                onRename={(id, name) => void dm.actions.renameEncounter(id, name)}
                onSetMonsters={(id, monsters) => void dm.actions.setEncounterMonsters(id, monsters)}
                onSpawnAll={(enc) => void dm.actions.spawnEncounter(enc)}
                onDelete={(id) => void dm.actions.removeEncounter(id)}
              />
            )}
            {tab === 'reference' && (
              <Reference
                conditions={dm.refEntries.conditions}
                powers={dm.refEntries.powers}
                weaponProperties={dm.refEntries.weaponProperties}
              />
            )}
          </div>
```

- [ ] **Step 4: Build + full frontend suite**

Run: `cd /Users/asherc/Git/ashercarlow-api/apps/swdnd && bun run build && cd /Users/asherc/Git/ashercarlow-api && bun test apps/swdnd`
Expected: clean + PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/panels/DMScreen/EncounterList.tsx apps/swdnd/src/panels/DMScreen/Reference.tsx apps/swdnd/src/panels/DMScreen/index.tsx
git commit -m "feat(swdnd): encounter list, quick reference, and tab wiring"
```

---

### Task 8: Full verification + live walkthrough (coordinator-run)

**Files:** none (`.claude/launch.json` temporarily edited, MUST be reverted).

- [ ] **Step 1: Full suite + both builds** — `cd /Users/asherc/Git/ashercarlow-api && bun test && (cd apps/swdnd && bun run build)`. Baseline 251 pass; this phase adds encounter-route, monsters, spawn, refSearch, and encounters tests. `bun test` wipes the dev DB — the walkthrough recreates campaign state (content tables survive).
- [ ] **Step 2: Auth-enforced walkthrough** (launch.json → `ASHERCARLOW_AUTH_TOKEN=dm-secret`, restart backend, DM cookie login; recreate campaign/player/character; create a scene with a grid and activate it):
  1. Monsters tab: 272 load; search + type + CR filters narrow the list; statblock renders a caster (traits/actions/powers groups) and a degenerate-looking record without crashing.
  2. Spawn ×3 → three hostile tokens (`Name`, `#2`, `#3`) clustered at map center with hp prefilled — visible **live on a player's map tab** (fog rules apply).
  3. Spawn with **no active scene** → inline error, no crash.
  4. Encounters tab: create group, add monsters (browser add-to-encounter + in-row add), counts +/−, rename, spawn-all (mixed group lands with correct counts + suffixes), two-tap delete.
  5. Reference tab: conditions text renders; powers filter by force/tech + level; weapon properties searchable.
  6. Auth: encounter POST/PATCH/DELETE 401 from the player tab; GET open.
- [ ] **Step 3: REVERT `.claude/launch.json`**, restart backend in dev mode.
- [ ] **Step 4: Vault docs** (`Roadmap.md` — feature + app complete; `Features/DM Screen.md` — phase 2 shipped surface; `Data Model.md` — encounter table) and the finishing-a-development-branch menu.

---

## Self-review notes

- Spec coverage: §2 encounter table → T1; §3 routes + gating note → T1 (verified: no selfGated clause matches `/encounters` paths); §4 `monsters.ts`/`spawn.ts`/`refSearch.ts`/`encounters.ts` → T2–T4; §5 MonsterBrowser/Statblock/EncounterList/Reference/RefLookup + spawn-in-hook with inline no-active-scene error → T5–T7; §7 testing → T1–T4 + T8.
- Deliberate spec deviations, both data-driven: `MonsterView.powers` third group (262 power items would otherwise be dropped) and `RefLookup` living inside `Reference.tsx` (one tab, one file). `spawnPositions` uses `hexRing` loops rather than `hexBlast` ordering — same footprint, but center-out ordering guaranteed (hexBlast iterates in axial-scan order, not distance order; the spec's "via hexBlast ordering" would scatter partial rings).
- Type consistency checked: `MonsterRow`/`MonsterView`/`MonsterEntryText` (T2) match T5/T6 imports; `RefEntry`/`RefRow` (T3) match T5/T7; `EncounterDto`/`EncounterMonster` + helpers (T4) match T5/T7; `PowerEntry` exported from the hook (T5) imported by Reference (T7); `spawn`/`spawnEncounter` action signatures (T5) match index.tsx wiring (T7).
