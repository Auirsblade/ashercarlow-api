# Map Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three approved map-polish features — a persisted campaign roll log with a floating dice-roller dock, image tokens on the reserved `token.image_path` column, and curved condition-name labels inside thicker status rings.

**Architecture:** Follows the house pattern throughout: pure unit-tested `lib/` modules, dumb components, hooks that do REST load → WS merge with pre-load buffering and reload-on-reconnect. Backend adds one migration (005, `roll` table), one new route file (`rolls.ts`, member-gated POST via a new `endsWith('/rolls')` selfGated clause), and two token-image routes guarded by the existing `assertTokenMoveAccess`. The client rolls dice locally and POSTs results (friends trust model); the server records and broadcasts `roll:created`.

**Tech Stack:** Bun + Hono + `@hono/zod-openapi` + `bun:sqlite` (backend); React + react-router + SVG (frontend); `bun:test`.

**Spec:** `docs/superpowers/specs/2026-07-23-map-polish-design.md` (approved). Branch: `swdnd-map-polish`.

## Verified facts (read before implementing)

- **Build/typecheck:** `cd apps/swdnd && bun run build` is the real frontend typecheck (`noUnusedLocals` on; NEVER `bun --cwd`). `bun test` does not typecheck. `*.test.ts` files are excluded from tsc, so loose fixtures are fine there. Backend has no separate build; `bun test` covers it.
- **DANGER:** a bare `bun test` from the repo root wipes the dev `./data/swdnd.sqlite` campaign state (content tables survive). That is accepted (walkthrough recreates data), but never run it casually mid-walkthrough.
- **Gate architecture:** the blanket `authGate` on `/swdnd/*` blocks only non-GET requests whose path matches no `selfGated()` clause. GETs bypass it entirely, so any GET returning restricted data must check auth in-handler. `assertCampaignMember` (in `access.ts`) accepts the admin bearer/cookie or an `X-Player-Token` belonging to the campaign; dev mode (env `ASHERCARLOW_AUTH_TOKEN` unset) passes everything.
- **WS:** `connectCampaign(campaignId, onMessage, onStatus?, token?)` in `apps/swdnd/src/lib/ws.ts` auto-reconnects; hooks reload on reconnect via a `hadOpened` ref. Broadcasts go through `publishToRoom(roomForCampaign(campaignId), { type, room, payload })`.
- **Existing dice code:** `lib/dice.ts` has `rollDie`, `rollD20(mod, {advantage, disadvantage}, rng)`, `rollDamage`. All sheet d20 rolls funnel through the single `roll(label, mod)` closure in `panels/CharacterSheet/Sheet/index.tsx` (Abilities/Skills/Combat all call `onRoll(label, mod)`).
- **Player identity client-side:** the `?token=` search param. `useCharacterSheet` reads it internally; `useTabletop` exposes `playerToken`. The server can resolve a player's name from the token, so the roller name can default server-side.
- **Scene upload pattern** (`scenes.ts:160-180, 289-330`): `parseBody()`, `EXT_BY_MIME` map for png/jpg/webp, size cap, `mkdirSync(UPLOADS_DIR(), {recursive:true})`, `Bun.write`, delete stale other-extension files, serve via `GET /swdnd/uploads/{file}` with `SAFE_FILE = /^[A-Za-z0-9-]+\.(png|jpg|webp)$/` (matches `token-<uuid>.png`).
- **Rings today** (`lib/rings.ts`): `statusSegments(conditions, r)` returns `{name, path, full, color, label}`; TokenGlyph draws thin arcs (`strokeWidth hexSize*0.07`) with the full condition name as text OUTSIDE the ring at `label`. Angles: 0° = 12 o'clock, clockwise, `polar(r, deg)` helper.
- **Backend test harness:** each test file sets `process.env.SWDND_DB_PATH` to a tmp file and sets/deletes `ASHERCARLOW_AUTH_TOKEN` in `beforeAll` BEFORE `await import('../../db/swdnd')`, registers routes on a fresh `OpenAPIHono`, then resets tables in FK order (see `gate.test.ts`). Auth checks read `process.env` per request, so one file can rely on the value it set.
- **Commit discipline:** `git add` explicit paths only, never `-A`.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `apps/backend/src/db/migrations/swdnd/005_swdnd_rolls.sql` | create | `roll` table |
| `apps/backend/src/db/swdnd/index.ts` | modify | register migration 005 |
| `apps/backend/src/routes/swdnd/access.ts` | modify | export non-throwing `isAdminRequest` |
| `apps/backend/src/routes/swdnd/rolls.ts` | create | GET list (hidden-filtered) + member-gated POST |
| `apps/backend/src/routes/swdnd/index.ts` | modify | `/rolls` selfGated clause + register routes |
| `apps/backend/src/routes/swdnd/rolls.test.ts` | create | roll routes + auth matrix |
| `apps/backend/src/routes/swdnd/tokens.ts` | modify | token image upload/delete routes |
| `apps/backend/src/routes/swdnd/tokens-image.test.ts` | create | image routes access matrix |
| `apps/swdnd/src/lib/dice.ts` | modify | `parseFormula` / `formatFormula` / `rollFormula` |
| `apps/swdnd/src/lib/dice.test.ts` | modify | formula tests |
| `apps/swdnd/src/lib/rolls.ts` | create | RollDto, REST wrappers, `appendRoll`, formula-builder ops |
| `apps/swdnd/src/lib/rolls.test.ts` | create | pure helper tests |
| `apps/swdnd/src/lib/rings.ts` | modify | band constants, `contrastText`, `textArcPath`, fit rule, segment fields |
| `apps/swdnd/src/lib/rings.test.ts` | modify | label geometry tests |
| `apps/swdnd/src/hooks/useRollLog.ts` | create | load → WS merge → `roll()` action |
| `apps/swdnd/src/components/RollDock.tsx` | create | floating log + roller (shared by all surfaces) |
| `apps/swdnd/src/panels/Tabletop/index.tsx` | modify | mount dock; player own-token image panel |
| `apps/swdnd/src/panels/DMScreen/index.tsx` | modify | mount dock |
| `apps/swdnd/src/App.tsx` | modify | SheetPage mounts dock (fetches campaign id) |
| `apps/swdnd/src/panels/CharacterSheet/Sheet/index.tsx` | modify | broadcast sheet rolls |
| `apps/swdnd/src/lib/scenes.ts` | modify | `uploadTokenImage` / `deleteTokenImage` |
| `apps/swdnd/src/hooks/useTabletop.ts` | modify | `setTokenImage` / `clearTokenImage` actions |
| `apps/swdnd/src/panels/Tabletop/TokenGlyph.tsx` | modify | clipped image + curved ring labels |
| `apps/swdnd/src/panels/Tabletop/TokenImageControls.tsx` | create | upload/remove strip (DM editor + player panel) |
| `apps/swdnd/src/panels/Tabletop/TokenEditor.tsx` | modify | embed image controls |
| `apps/swdnd/src/panels/Tabletop/SceneCanvas.tsx` | modify | players tap-select their own token |

Suggested execution order: Tasks 1–5 (backend + pure libs) → review → Tasks 6–9 (hook + components) → review → Task 10 (verification + walkthrough).

---

### Task 1: `roll` table + rolls routes

**Files:**
- Create: `apps/backend/src/db/migrations/swdnd/005_swdnd_rolls.sql`
- Modify: `apps/backend/src/db/swdnd/index.ts`
- Modify: `apps/backend/src/routes/swdnd/access.ts`
- Create: `apps/backend/src/routes/swdnd/rolls.ts`
- Modify: `apps/backend/src/routes/swdnd/index.ts`
- Test: `apps/backend/src/routes/swdnd/rolls.test.ts`

- [ ] **Step 1: Write the migration**

`apps/backend/src/db/migrations/swdnd/005_swdnd_rolls.sql`:

```sql
-- Campaign roll log: append-only record of dice rolls (client rolls, server records).
CREATE TABLE roll (
  id          TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  roller      TEXT NOT NULL,              -- display name: player/character name or 'DM'
  label       TEXT,                       -- e.g. 'Perception check', 'Blaster damage'
  formula     TEXT NOT NULL,              -- '2d6+1d8+3'
  rolls_json  TEXT NOT NULL DEFAULT '[]', -- [{sides, value}, ...]
  total       INTEGER NOT NULL,
  hidden      INTEGER NOT NULL DEFAULT 0, -- DM-only secret roll
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_roll_campaign ON roll(campaign_id, created_at);
```

- [ ] **Step 2: Register the migration**

In `apps/backend/src/db/swdnd/index.ts`, extend `MIGRATIONS`:

```ts
const MIGRATIONS: Migration[] = [
  { version: '001_swdnd_core', file: '001_swdnd_core.sql' },
  { version: '002_swdnd_map', file: '002_swdnd_map.sql' },
  { version: '003_swdnd_templates', file: '003_swdnd_templates.sql' },
  { version: '004_swdnd_encounters', file: '004_swdnd_encounters.sql' },
  { version: '005_swdnd_rolls', file: '005_swdnd_rolls.sql' },
];
```

- [ ] **Step 3: Export a non-throwing admin check from access.ts**

Append to `apps/backend/src/routes/swdnd/access.ts` (below `assertAdmin`):

```ts
/**
 * Non-throwing admin check for read-side filtering (e.g. hidden rolls).
 * Dev mode (env token unset) counts as admin — dev sees everything.
 */
export function isAdminRequest(c: Context): boolean {
  if (!process.env.ASHERCARLOW_AUTH_TOKEN) return true;
  return isAdmin(c);
}
```

(`isAdmin` is the existing private helper in the same file; do not export it directly.)

- [ ] **Step 4: Write the failing route tests**

`apps/backend/src/routes/swdnd/rolls.test.ts` (production-like env; every request carries explicit auth):

```ts
// apps/backend/src/routes/swdnd/rolls.test.ts
import { test, expect, beforeAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAPIHono } from '@hono/zod-openapi';

let app: OpenAPIHono;
let swdndDb: import('bun:sqlite').Database;

const ADMIN = { Authorization: 'Bearer admin-secret' };
const JSON_H = { 'Content-Type': 'application/json' };

const post = (campaign: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(`/swdnd/campaigns/${campaign}/rolls`, {
    method: 'POST', headers: { ...JSON_H, ...headers }, body: JSON.stringify(body),
  });

beforeAll(async () => {
  process.env.SWDND_DB_PATH = join(tmpdir(), `swdnd-rolls-${crypto.randomUUID()}.sqlite`);
  process.env.ASHERCARLOW_AUTH_TOKEN = 'admin-secret'; // production-like
  ({ swdndDb } = await import('../../db/swdnd'));
  const { registerSwdndRoutes } = await import('./index');
  app = new OpenAPIHono();
  registerSwdndRoutes(app);
  swdndDb.exec('DELETE FROM roll; DELETE FROM character; DELETE FROM player; DELETE FROM campaign;');
  swdndDb.run('INSERT INTO campaign (id,name,created_at,updated_at) VALUES (?,?,?,?)', ['c1', 'Camp', 'n', 'n']);
  swdndDb.run('INSERT INTO player (id,campaign_id,name,access_token,created_at) VALUES (?,?,?,?,?)', ['p1', 'c1', 'Kira', 'tok-1', 'n']);
});

test('member POST: player token works, roller defaults to the player name', async () => {
  const res = await post('c1', { formula: '2d6+3', rolls: [{ sides: 6, value: 4 }, { sides: 6, value: 2 }], total: 9 }, { 'X-Player-Token': 'tok-1' });
  expect(res.status).toBe(201);
  const roll = await res.json();
  expect(roll.roller).toBe('Kira');
  expect(roll.rolls_json).toEqual([{ sides: 6, value: 4 }, { sides: 6, value: 2 }]);
  expect(roll.hidden).toBe(0);
});

test('explicit roller (sheet rolls send the character name) is kept', async () => {
  const res = await post('c1', { roller: 'Lyra', label: 'Stealth check', formula: '1d20+5', rolls: [{ sides: 20, value: 17 }], total: 22 }, { 'X-Player-Token': 'tok-1' });
  expect(res.status).toBe(201);
  expect((await res.json()).roller).toBe('Lyra');
});

test('admin POST defaults roller to DM; hidden is honored and not listed for players', async () => {
  const res = await post('c1', { formula: '1d20', rolls: [{ sides: 20, value: 3 }], total: 3, hidden: true }, ADMIN);
  expect(res.status).toBe(201);
  const roll = await res.json();
  expect(roll.roller).toBe('DM');
  expect(roll.hidden).toBe(1);

  const asPlayer = await (await app.request('/swdnd/campaigns/c1/rolls', { headers: { 'X-Player-Token': 'tok-1' } })).json();
  expect(asPlayer.some((r: { id: string }) => r.id === roll.id)).toBe(false);

  const asAdmin = await (await app.request('/swdnd/campaigns/c1/rolls', { headers: ADMIN })).json();
  expect(asAdmin.some((r: { id: string }) => r.id === roll.id)).toBe(true);
});

test('a player asking for hidden gets 403', async () => {
  const res = await post('c1', { formula: '1d20', rolls: [{ sides: 20, value: 9 }], total: 9, hidden: true }, { 'X-Player-Token': 'tok-1' });
  expect(res.status).toBe(403);
});

test('non-members are rejected: anon and wrong-campaign tokens 403', async () => {
  expect((await post('c1', { formula: '1d4', rolls: [{ sides: 4, value: 2 }], total: 2 })).status).toBe(403);
  swdndDb.run('INSERT INTO campaign (id,name,created_at,updated_at) VALUES (?,?,?,?)', ['c2', 'Other', 'n', 'n']);
  swdndDb.run('INSERT INTO player (id,campaign_id,name,access_token,created_at) VALUES (?,?,?,?,?)', ['p2', 'c2', 'Rex', 'tok-2', 'n']);
  expect((await post('c1', { formula: '1d4', rolls: [{ sides: 4, value: 2 }], total: 2 }, { 'X-Player-Token': 'tok-2' })).status).toBe(403);
});

test('list is newest-first and honors limit', async () => {
  const list = await (await app.request('/swdnd/campaigns/c1/rolls?limit=2', { headers: ADMIN })).json();
  expect(list).toHaveLength(2);
  const all = await (await app.request('/swdnd/campaigns/c1/rolls', { headers: ADMIN })).json();
  // newest-first: the hidden DM roll (3rd insert) precedes the Lyra roll (2nd insert)
  const ids = all.map((r: { roller: string }) => r.roller);
  expect(ids.indexOf('DM')).toBeLessThan(ids.indexOf('Lyra'));
});

test('unknown campaign 404s on both verbs', async () => {
  expect((await app.request('/swdnd/campaigns/nope/rolls')).status).toBe(404);
  expect((await post('nope', { formula: '1d4', rolls: [], total: 0 }, ADMIN)).status).toBe(404);
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `bun test apps/backend/src/routes/swdnd/rolls.test.ts`
Expected: FAIL (404s — routes don't exist yet).

- [ ] **Step 6: Implement the routes**

`apps/backend/src/routes/swdnd/rolls.ts`:

```ts
// apps/backend/src/routes/swdnd/rolls.ts — campaign roll log (append-only).
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { swdndDb } from '../../db/swdnd';
import { publishToRoom, roomForCampaign } from '../../lib/swdnd-realtime';
import { assertCampaignMember, isAdminRequest, playerTokenFrom, resolvePlayerByToken } from './access';

const RollDie = z.object({ sides: z.number().int().min(2), value: z.number().int().min(1) });
const Roll = z.object({
  id: z.string(), campaign_id: z.string(), roller: z.string(), label: z.string().nullable(),
  formula: z.string(), rolls_json: z.array(RollDie), total: z.number(),
  hidden: z.number(), created_at: z.string(),
}).openapi('SwdndRoll');

const PostBody = z.object({
  roller: z.string().min(1).max(60).optional(),
  label: z.string().max(120).optional(),
  formula: z.string().min(1).max(120),
  rolls: z.array(RollDie).max(200),
  total: z.number().int(),
  hidden: z.boolean().optional(),
}).openapi('SwdndPostRoll');

const ErrorBody = z.object({ message: z.string() });

interface RollRow {
  id: string; campaign_id: string; roller: string; label: string | null;
  formula: string; rolls_json: string; total: number; hidden: number; created_at: string;
}
const rollOut = (r: RollRow) => ({ ...r, rolls_json: JSON.parse(r.rolls_json || '[]') });
const campaignExists = (id: string): boolean =>
  !!swdndDb.query('SELECT id FROM campaign WHERE id = ?').get(id);

const listRoute = createRoute({
  method: 'get', path: '/swdnd/campaigns/{id}/rolls', tags: ['swdnd'],
  summary: 'List recent rolls (secret DM rolls stripped for non-admins)',
  request: { params: z.object({ id: z.string() }), query: z.object({ limit: z.string().optional() }) },
  responses: {
    200: { description: 'Rolls, newest first', content: { 'application/json': { schema: z.array(Roll) } } },
    404: { description: 'No campaign', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const createRollRoute = createRoute({
  method: 'post', path: '/swdnd/campaigns/{id}/rolls', tags: ['swdnd'],
  summary: 'Record a roll (any campaign member; hidden is DM-only)',
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: PostBody } } } },
  responses: {
    201: { description: 'Recorded', content: { 'application/json': { schema: Roll } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'No campaign', content: { 'application/json': { schema: ErrorBody } } },
  },
});

export function registerRollRoutes(app: OpenAPIHono): void {
  app.openapi(listRoute, (c) => {
    const { id } = c.req.valid('param');
    if (!campaignExists(id)) throw new HTTPException(404, { message: 'Campaign not found' });
    const limit = Math.min(Math.max(Number(c.req.valid('query').limit) || 50, 1), 100);
    // GETs bypass the blanket gate, so the hidden filter is enforced here.
    const rows = isAdminRequest(c)
      ? swdndDb.query<RollRow, [string, number]>(
          'SELECT * FROM roll WHERE campaign_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(id, limit)
      : swdndDb.query<RollRow, [string, number]>(
          'SELECT * FROM roll WHERE campaign_id = ? AND hidden = 0 ORDER BY created_at DESC, rowid DESC LIMIT ?').all(id, limit);
    return c.json(rows.map(rollOut), 200);
  });

  app.openapi(createRollRoute, (c) => {
    const { id } = c.req.valid('param');
    if (!campaignExists(id)) throw new HTTPException(404, { message: 'Campaign not found' });
    assertCampaignMember(c, id);
    const b = c.req.valid('json');
    const admin = isAdminRequest(c);
    if (b.hidden && !admin) throw new HTTPException(403, { message: 'Only the DM can roll in secret' });
    const roller = b.roller ?? resolvePlayerByToken(playerTokenFrom(c))?.name ?? 'DM';
    const now = new Date().toISOString();
    const rid = crypto.randomUUID();
    swdndDb.run(
      `INSERT INTO roll (id, campaign_id, roller, label, formula, rolls_json, total, hidden, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [rid, id, roller, b.label ?? null, b.formula, JSON.stringify(b.rolls), b.total, b.hidden ? 1 : 0, now],
    );
    const row = swdndDb.query<RollRow, [string]>('SELECT * FROM roll WHERE id = ?').get(rid)!;
    if (!row.hidden) {
      const room = roomForCampaign(id);
      publishToRoom(room, { type: 'roll:created', room, payload: rollOut(row) });
    }
    return c.json(rollOut(row), 201);
  });
}
```

- [ ] **Step 7: Wire the gate clause + registration**

In `apps/backend/src/routes/swdnd/index.ts`: add the import, the clause, and the registration call:

```ts
import { registerRollRoutes } from './rolls';
```

In `selfGated()` add (with the others):

```ts
    path.endsWith('/rolls') || // member-gated create in-handler; GET filters hidden in-handler
```

In `registerSwdndRoutes` add `registerRollRoutes(app);` after `registerPlayerRoutes(app);`.

- [ ] **Step 8: Run tests to verify they pass**

Run: `bun test apps/backend/src/routes/swdnd/rolls.test.ts`
Expected: all PASS.

Also run: `bun test apps/backend/src/routes/swdnd/` — the existing gate/route tests must stay green.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/db/migrations/swdnd/005_swdnd_rolls.sql apps/backend/src/db/swdnd/index.ts apps/backend/src/routes/swdnd/access.ts apps/backend/src/routes/swdnd/rolls.ts apps/backend/src/routes/swdnd/index.ts apps/backend/src/routes/swdnd/rolls.test.ts
git commit -m "feat(swdnd): roll table and campaign roll-log routes"
```

---

### Task 2: multi-term dice formulas in `lib/dice.ts`

**Files:**
- Modify: `apps/swdnd/src/lib/dice.ts`
- Test: `apps/swdnd/src/lib/dice.test.ts`

- [ ] **Step 1: Write the failing tests** (append to the existing `dice.test.ts`; keep existing tests untouched)

```ts
import { formatFormula, parseFormula, rollFormula } from './dice';

describe('parseFormula', () => {
  test('accepts multi-term sums with modifiers', () => {
    expect(parseFormula('2d6+1d8+3')).toEqual({ dice: [{ count: 2, sides: 6 }, { count: 1, sides: 8 }], modifier: 3 });
    expect(parseFormula('1d20-1')).toEqual({ dice: [{ count: 1, sides: 20 }], modifier: -1 });
    expect(parseFormula(' 2D6 + 3 ')).toEqual({ dice: [{ count: 2, sides: 6 }], modifier: 3 });
    expect(parseFormula('1d8+2-1')).toEqual({ dice: [{ count: 1, sides: 8 }], modifier: 1 });
  });
  test('bare dNN means one die', () => {
    expect(parseFormula('d20')).toEqual({ dice: [{ count: 1, sides: 20 }], modifier: 0 });
  });
  test('rejects junk, dice-less, negative-dice, and out-of-range formulas', () => {
    for (const bad of ['', 'abc', '3', '+5', '2d6potato', '2d6 1d8', '-1d6', '0d6', '2d1', '101d6', '2d2000']) {
      expect(parseFormula(bad)).toBeNull();
    }
  });
});

describe('formatFormula', () => {
  test('round-trips and normalizes', () => {
    expect(formatFormula(parseFormula('2d6+1d8+3')!)).toBe('2d6+1d8+3');
    expect(formatFormula(parseFormula('1d20-1')!)).toBe('1d20-1');
    expect(formatFormula(parseFormula('d20')!)).toBe('1d20');
    expect(formatFormula(parseFormula('2d6+0')!)).toBe('2d6');
  });
});

describe('rollFormula', () => {
  test('rolls every die and adds the modifier (seeded rng)', () => {
    const seq = [0.99, 0.0, 0.5]; let i = 0;
    const rng = () => seq[i++ % seq.length];
    const r = rollFormula(parseFormula('2d6+1d8+3')!, rng);
    expect(r.rolls).toEqual([{ sides: 6, value: 6 }, { sides: 6, value: 1 }, { sides: 8, value: 5 }]);
    expect(r.total).toBe(6 + 1 + 5 + 3);
    expect(r.formula).toBe('2d6+1d8+3');
  });
});
```

(If the file doesn't already import `describe`, extend its `bun:test` import.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test apps/swdnd/src/lib/dice.test.ts`
Expected: FAIL — `parseFormula` not exported.

- [ ] **Step 3: Implement** (append to `lib/dice.ts`; existing exports untouched)

```ts
export interface DiceTerm { count: number; sides: number }
export interface FormulaTerms { dice: DiceTerm[]; modifier: number }

/**
 * Parse a sum of dice terms and integer constants: `2d6+1d8+3-1`.
 * Bare `dNN` counts as one die. Whitespace/case tolerant. Requires at least
 * one die; negative dice terms and silly ranges are rejected. → null on junk.
 */
export function parseFormula(input: string): FormulaTerms | null {
  const s = input.replace(/\s+/g, '').toLowerCase();
  if (!s) return null;
  const token = /([+-]?)(?:(\d*)d(\d+)|(\d+))/g;
  const dice: DiceTerm[] = [];
  let modifier = 0;
  let idx = 0;
  let m: RegExpExecArray | null;
  while ((m = token.exec(s))) {
    if (m.index !== idx) return null;            // gap between tokens → junk
    if (idx > 0 && m[1] === '') return null;     // later terms need an explicit sign
    const negative = m[1] === '-';
    if (m[3] !== undefined) {
      if (negative) return null;                 // no negative dice
      const count = m[2] === '' ? 1 : Number(m[2]);
      const sides = Number(m[3]);
      if (count < 1 || count > 100 || sides < 2 || sides > 1000) return null;
      dice.push({ count, sides });
    } else {
      modifier += negative ? -Number(m[4]) : Number(m[4]);
    }
    idx = token.lastIndex;
  }
  if (idx !== s.length || dice.length === 0) return null;
  return { dice, modifier };
}

/** Canonical string form: dice joined with '+', signed trailing modifier, 0 omitted. */
export function formatFormula(t: FormulaTerms): string {
  const dice = t.dice.map((d) => `${d.count}d${d.sides}`).join('+');
  if (t.modifier === 0) return dice;
  return `${dice}${t.modifier > 0 ? '+' : ''}${t.modifier}`;
}

export interface FormulaResult { total: number; rolls: { sides: number; value: number }[]; formula: string }

export function rollFormula(terms: FormulaTerms, rng: Rng = defaultRng): FormulaResult {
  const rolls = terms.dice.flatMap((t) =>
    Array.from({ length: t.count }, () => ({ sides: t.sides, value: rollDie(t.sides, rng) })));
  return {
    total: rolls.reduce((s, r) => s + r.value, 0) + terms.modifier,
    rolls,
    formula: formatFormula(terms),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/swdnd/src/lib/dice.test.ts` — all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/dice.ts apps/swdnd/src/lib/dice.test.ts
git commit -m "feat(swdnd): multi-term dice formula parser and roller"
```

---

### Task 3: `lib/rolls.ts` — client DTO, wrappers, log + builder helpers

**Files:**
- Create: `apps/swdnd/src/lib/rolls.ts`
- Test: `apps/swdnd/src/lib/rolls.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/swdnd/src/lib/rolls.test.ts
import { describe, expect, test } from 'bun:test';
import { addDie, addModifier, appendRoll, MAX_LOG, type RollDto } from './rolls';

const mk = (id: string): RollDto => ({
  id, campaign_id: 'c1', roller: 'Kira', label: null, formula: '1d20',
  rolls_json: [{ sides: 20, value: 11 }], total: 11, hidden: 0, created_at: 'n',
});

describe('appendRoll', () => {
  test('prepends, dedupes by id, caps the in-memory log', () => {
    const list = appendRoll([mk('a')], mk('b'));
    expect(list.map((r) => r.id)).toEqual(['b', 'a']);
    expect(appendRoll(list, mk('b'))).toBe(list); // duplicate → same reference
    const full = Array.from({ length: MAX_LOG }, (_, i) => mk(`r${i}`));
    expect(appendRoll(full, mk('new'))).toHaveLength(MAX_LOG);
  });
});

describe('formula builder ops', () => {
  test('addDie starts, appends, and collapses same-sided dice', () => {
    expect(addDie('', 6)).toBe('1d6');
    expect(addDie('1d6', 6)).toBe('2d6');
    expect(addDie('2d6', 8)).toBe('2d6+1d8');
    expect(addDie('2d6+3', 6)).toBe('3d6+3');
  });
  test('addDie on hand-typed junk starts over from one die', () => {
    expect(addDie('potato', 20)).toBe('1d20');
  });
  test('addModifier merges constants and is inert without dice', () => {
    expect(addModifier('1d20', 3)).toBe('1d20+3');
    expect(addModifier('1d20+3', -1)).toBe('1d20+2');
    expect(addModifier('1d20+1', -1)).toBe('1d20');
    expect(addModifier('', 3)).toBe('');
    expect(addModifier('junk', 3)).toBe('junk');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test apps/swdnd/src/lib/rolls.test.ts` — FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// apps/swdnd/src/lib/rolls.ts — roll-log REST client + pure log/builder helpers.
import { api } from './api';
import { formatFormula, parseFormula } from './dice';

export interface RollDie { sides: number; value: number }
export interface RollDto {
  id: string; campaign_id: string; roller: string; label: string | null;
  formula: string; rolls_json: RollDie[]; total: number; hidden: number; created_at: string;
}
export interface PostRollBody {
  roller?: string; label?: string; formula: string; rolls: RollDie[]; total: number; hidden?: boolean;
}

const auth = (token?: string | null): Record<string, string> => (token ? { 'X-Player-Token': token } : {});

export const listRolls = (campaignId: string, limit = 50) =>
  api<RollDto[]>(`/swdnd/campaigns/${campaignId}/rolls?limit=${limit}`);
export const postRoll = (campaignId: string, body: PostRollBody, token?: string | null) =>
  api<RollDto>(`/swdnd/campaigns/${campaignId}/rolls`, { method: 'POST', headers: auth(token), body: JSON.stringify(body) });

export const MAX_LOG = 100;

/** Prepend a roll (log is newest-first); dedupe by id (POST response vs WS echo); cap in-memory size. */
export function appendRoll(list: RollDto[], roll: RollDto): RollDto[] {
  if (list.some((r) => r.id === roll.id)) return list;
  return [roll, ...list].slice(0, MAX_LOG);
}

/** Quick-button: add one die, collapsing into an existing same-sided term. Junk restarts the formula. */
export function addDie(formula: string, sides: number): string {
  const terms = parseFormula(formula) ?? { dice: [], modifier: 0 };
  const existing = terms.dice.find((d) => d.sides === sides);
  if (existing) existing.count += 1;
  else terms.dice.push({ count: 1, sides });
  return formatFormula(terms);
}

/** Merge a constant into the formula's modifier. Inert until the formula has a die. */
export function addModifier(formula: string, delta: number): string {
  const terms = parseFormula(formula);
  if (!terms) return formula;
  terms.modifier += delta;
  return formatFormula(terms);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/swdnd/src/lib/rolls.test.ts` — all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/rolls.ts apps/swdnd/src/lib/rolls.test.ts
git commit -m "feat(swdnd): roll-log client wrappers and formula-builder helpers"
```

---

### Task 4: token image upload/delete routes

**Files:**
- Modify: `apps/backend/src/routes/swdnd/tokens.ts`
- Test: `apps/backend/src/routes/swdnd/tokens-image.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

```ts
// apps/backend/src/routes/swdnd/tokens-image.test.ts
import { test, expect, beforeAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { OpenAPIHono } from '@hono/zod-openapi';

let app: OpenAPIHono;
let swdndDb: import('bun:sqlite').Database;
let uploads: string;

const ADMIN = { Authorization: 'Bearer admin-secret' };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const upload = (tokenId: string, headers: Record<string, string> = {}, type = 'image/png') => {
  const fd = new FormData();
  fd.append('file', new File([PNG], 'face.png', { type }));
  return app.request(`/swdnd/tokens/${tokenId}/image`, { method: 'POST', headers, body: fd });
};

beforeAll(async () => {
  process.env.SWDND_DB_PATH = join(tmpdir(), `swdnd-tokimg-${crypto.randomUUID()}.sqlite`);
  process.env.ASHERCARLOW_AUTH_TOKEN = 'admin-secret';
  uploads = mkdtempSync(join(tmpdir(), 'swdnd-uploads-'));
  process.env.SWDND_UPLOADS_DIR = uploads;
  ({ swdndDb } = await import('../../db/swdnd'));
  const { registerSwdndRoutes } = await import('./index');
  app = new OpenAPIHono();
  registerSwdndRoutes(app);
  swdndDb.exec('DELETE FROM token; DELETE FROM scene; DELETE FROM character; DELETE FROM player; DELETE FROM campaign;');
  swdndDb.run('INSERT INTO campaign (id,name,created_at,updated_at) VALUES (?,?,?,?)', ['c1', 'Camp', 'n', 'n']);
  swdndDb.run('INSERT INTO player (id,campaign_id,name,access_token,created_at) VALUES (?,?,?,?,?)', ['p1', 'c1', 'Kira', 'tok-1', 'n']);
  swdndDb.run('INSERT INTO player (id,campaign_id,name,access_token,created_at) VALUES (?,?,?,?,?)', ['p2', 'c1', 'Rex', 'tok-2', 'n']);
  swdndDb.run(
    "INSERT INTO character (id,campaign_id,player_id,name,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    ['ch1', 'c1', 'p1', 'Lyra', '{"schemaVersion":1}', 'n', 'n'],
  );
  swdndDb.run(
    "INSERT INTO scene (id,campaign_id,name,grid_json,fog_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    ['s1', 'c1', 'Map', '{}', '[]', 'n', 'n'],
  );
  swdndDb.run(
    "INSERT INTO token (id,scene_id,character_id,name,color,faction,q,r,conditions_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ['t-own', 's1', 'ch1', 'Lyra', '#4dd0e1', 'friendly', 0, 0, '[]', 'n', 'n'],
  );
  swdndDb.run(
    "INSERT INTO token (id,scene_id,character_id,name,color,faction,q,r,conditions_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ['t-npc', 's1', null, 'Droid', '#ff5470', 'hostile', 1, 0, '[]', 'n', 'n'],
  );
});

test('admin can set any token image; file lands and is served', async () => {
  const res = await upload('t-npc', ADMIN);
  expect(res.status).toBe(200);
  const tok = await res.json();
  expect(tok.image_path).toBe('token-t-npc.png');
  const served = await app.request(`/swdnd/uploads/${tok.image_path}`);
  expect(served.status).toBe(200);
});

test('owning player can set their own character token image', async () => {
  const res = await upload('t-own', { 'X-Player-Token': 'tok-1' });
  expect(res.status).toBe(200);
  expect((await res.json()).image_path).toBe('token-t-own.png');
});

test('anon and non-owning players are rejected', async () => {
  expect((await upload('t-own')).status).toBe(403);
  expect((await upload('t-own', { 'X-Player-Token': 'tok-2' })).status).toBe(403);
  expect((await upload('t-npc', { 'X-Player-Token': 'tok-1' })).status).toBe(403); // NPC token has no owner
});

test('bad uploads 400: wrong mime, missing file', async () => {
  expect((await upload('t-npc', ADMIN, 'image/gif')).status).toBe(400);
  const empty = new FormData();
  const res = await app.request('/swdnd/tokens/t-npc/image', { method: 'POST', headers: ADMIN, body: empty });
  expect(res.status).toBe(400);
});

test('delete clears image_path (same access rule) and 404s on unknown token', async () => {
  expect((await app.request('/swdnd/tokens/t-own/image', { method: 'DELETE', headers: { 'X-Player-Token': 'tok-2' } })).status).toBe(403);
  const res = await app.request('/swdnd/tokens/t-own/image', { method: 'DELETE', headers: { 'X-Player-Token': 'tok-1' } });
  expect(res.status).toBe(200);
  expect((await res.json()).image_path).toBeNull();
  expect((await app.request('/swdnd/tokens/nope/image', { method: 'DELETE', headers: ADMIN })).status).toBe(404);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test apps/backend/src/routes/swdnd/tokens-image.test.ts` — FAIL (404, routes missing).

- [ ] **Step 3: Implement the routes** (in `tokens.ts`)

Add imports at the top:

```ts
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
```

Add constants near the other module-level declarations:

```ts
const UPLOADS_DIR = () => process.env.SWDND_UPLOADS_DIR ?? './data/uploads/swdnd';
const MAX_TOKEN_UPLOAD = 5 * 1024 * 1024;
const EXT_BY_MIME: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const SAFE_FILE = /^[A-Za-z0-9-]+\.(png|jpg|webp)$/;
```

Route definitions (next to the others):

```ts
const uploadImageRoute = createRoute({
  method: 'post', path: '/swdnd/tokens/{id}/image', tags: ['swdnd'],
  summary: 'Upload a token image (multipart: file; DM any, a player their own character’s token)',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Token with image', content: { 'application/json': { schema: Token } } },
    400: { description: 'Bad upload', content: { 'application/json': { schema: ErrorBody } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});
const deleteImageRoute = createRoute({
  method: 'delete', path: '/swdnd/tokens/{id}/image', tags: ['swdnd'],
  summary: 'Remove a token image (reverts to the generated disc)',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Token without image', content: { 'application/json': { schema: Token } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});
```

Handlers inside `registerTokenRoutes` (after the position handler). NOTE: `/swdnd/tokens` paths are already selfGated-exempt — `assertTokenMoveAccess` is the enforcement, exactly like the move route:

```ts
  app.openapi(uploadImageRoute, async (c) => {
    const { id } = c.req.valid('param');
    const row = getTokenRow(id);
    if (!row) throw new HTTPException(404, { message: 'Token not found' });
    assertTokenMoveAccess(c, row);
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) throw new HTTPException(400, { message: 'Missing file' });
    const ext = EXT_BY_MIME[file.type];
    if (!ext) throw new HTTPException(400, { message: 'Only png/jpg/webp images are allowed' });
    if (file.size > MAX_TOKEN_UPLOAD) throw new HTTPException(400, { message: 'Image exceeds 5 MB' });

    mkdirSync(UPLOADS_DIR(), { recursive: true });
    const filename = `token-${id}.${ext}`;
    await Bun.write(join(UPLOADS_DIR(), filename), file);
    for (const otherExt of Object.values(EXT_BY_MIME)) {
      if (otherExt === ext) continue;
      const stalePath = join(UPLOADS_DIR(), `token-${id}.${otherExt}`);
      if (await Bun.file(stalePath).exists()) await unlink(stalePath);
    }
    const now = new Date().toISOString();
    swdndDb.run('UPDATE token SET image_path = ?, updated_at = ? WHERE id = ?', [filename, now, id]);
    const updated = getTokenRow(id)!;
    broadcastToken(updated, 'token:updated');
    return c.json(tokenOut(updated), 200);
  });

  app.openapi(deleteImageRoute, async (c) => {
    const { id } = c.req.valid('param');
    const row = getTokenRow(id);
    if (!row) throw new HTTPException(404, { message: 'Token not found' });
    assertTokenMoveAccess(c, row);
    if (row.image_path && SAFE_FILE.test(row.image_path)) {
      const p = join(UPLOADS_DIR(), row.image_path);
      if (await Bun.file(p).exists()) await unlink(p);
    }
    const now = new Date().toISOString();
    swdndDb.run('UPDATE token SET image_path = NULL, updated_at = ? WHERE id = ?', [now, id]);
    const updated = getTokenRow(id)!;
    broadcastToken(updated, 'token:updated');
    return c.json(tokenOut(updated), 200);
  });
```

Note the token-id in the filename comes straight from the DB row lookup (a 404 fires first for unknown ids), and UUIDs match `SAFE_FILE`, so the serve route accepts them. The test ids (`t-own`) are also alnum-dash.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/backend/src/routes/swdnd/tokens-image.test.ts` and `bun test apps/backend/src/routes/swdnd/tokens.test.ts` — all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/routes/swdnd/tokens.ts apps/backend/src/routes/swdnd/tokens-image.test.ts
git commit -m "feat(swdnd): token image upload/delete on the move-access boundary"
```

---

### Task 5: ring-label geometry in `lib/rings.ts`

**Files:**
- Modify: `apps/swdnd/src/lib/rings.ts`
- Test: `apps/swdnd/src/lib/rings.test.ts`

Design recap: the status band becomes thick enough to hold curved text. `statusSegments` keeps its `(conditions, r)` signature — `r` is the band's center radius. New per-segment fields: `textArc` (mid-band arc path for `<textPath>`, direction-flipped when the slice midpoint is in the bottom semicircle so text never renders upside-down), `textColor` (black/white by WCAG relative luminance), `fits` (estimated text width vs available arc length). Fallback when `!fits`: a single uppercase initial rendered at `label`, which MOVES to the mid-band point (it was outside the ring before). Exported constants let TokenGlyph size the band and font consistently.

- [ ] **Step 1: Write the failing tests** (append to `rings.test.ts`)

```ts
import { BAND_FRACTION, contrastText, RING_FONT_FRACTION, statusSegments, textArcPath } from './rings';

describe('contrastText', () => {
  test('light palette colors get dark text, dark colors get light text', () => {
    expect(contrastText('#ffcb6b')).toBe('#101418'); // light amber
    expect(contrastText('#a3f7bf')).toBe('#101418'); // light green
    expect(contrastText('#1a2b3c')).toBe('#f5fbff'); // dark navy
    expect(contrastText('nonsense')).toBe('#f5fbff'); // unparsable → light default
  });
});

describe('textArcPath', () => {
  test('flip reverses direction (sweep flag 0, start/end swapped)', () => {
    const fwd = textArcPath(10, 0, 90, false);
    const rev = textArcPath(10, 0, 90, true);
    // flag runs are 'x-rotation large-arc sweep': forward sweeps 1, flipped sweeps 0
    expect(fwd).toContain(' 0 0 1 ');
    expect(rev).toContain(' 0 0 0 ');
    // the flipped arc starts (M x y) where the forward arc ends (last two tokens)
    expect(rev.split(' ').slice(1, 3)).toEqual(fwd.split(' ').slice(-2));
  });
});

describe('statusSegments labels', () => {
  test('single condition: full ring, curved name fits, arc not flipped', () => {
    const [s] = statusSegments(['stunned'], 40);
    expect(s.full).toBe(true);
    expect(s.fits).toBe(true);
    expect(s.textArc).not.toBeNull();
    expect(s.textColor).toBe(contrastText(s.color));
  });
  test('long name on a narrow slice does not fit; short one does', () => {
    const segs = statusSegments(["hunter's mark", 'web', 'prone', 'slow'], 40);
    const long = segs.find((s) => s.name === "hunter's mark")!;
    const short = segs.find((s) => s.name === 'web')!;
    expect(long.fits).toBe(false);
    expect(short.fits).toBe(true);
  });
  test('bottom-half slices get a reversed (sweep-0) text arc; top-half stay forward', () => {
    const segs = statusSegments(['aa', 'bb', 'cc', 'dd'], 40);
    // slices start at 12 o'clock clockwise: mid-angles 45°, 135°, 225°, 315°
    expect(segs[0].textArc).toContain(' 0 0 1 '); // 45° top-right → forward
    expect(segs[1].textArc).toContain(' 0 0 0 '); // 135° bottom-right → flipped
    expect(segs[2].textArc).toContain(' 0 0 0 '); // 225° bottom-left → flipped
    expect(segs[3].textArc).toContain(' 0 0 1 '); // 315° top-left → forward
  });
  test('label point moved onto the band (mid-band radius, not outside)', () => {
    const segs = statusSegments(['aa', 'bb'], 40);
    const d = Math.hypot(segs[0].label.x, segs[0].label.y);
    expect(d).toBeCloseTo(40, 0);
  });
  test('no conditions → no segments (unchanged)', () => {
    expect(statusSegments([], 40)).toEqual([]);
  });
});
```

(Extend the file's `bun:test` import with `describe` if needed.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test apps/swdnd/src/lib/rings.test.ts` — FAIL (new exports missing).

- [ ] **Step 3: Implement**

Replace the `StatusSegment` interface, the `LABEL_OFFSET` block, and `statusSegments` in `rings.ts` with (keep `hpFraction`/`hpColor`/`polar`/`arcPath`/`hpArcPath`/`PALETTE`/`conditionColor` as-is):

```ts
export interface StatusSegment {
  name: string;
  path: string;                 // stroked arc path (or full-circle marker when full)
  full: boolean;                // single condition -> full ring
  color: string;
  label: { x: number; y: number }; // mid-band point: anchor for the initial fallback
  textArc: string | null;       // mid-band arc for <textPath>; direction-flipped on the bottom half
  textColor: string;            // contrast color for text inside the band
  fits: boolean;                // curved full name fits the arc
}

/** Band stroke width and font size as fractions of the band-center radius. */
export const BAND_FRACTION = 0.34;
export const RING_FONT_FRACTION = 0.24;

const CHAR_WIDTH = 0.62;   // average monospace glyph width in em
const ARC_PADDING = 0.85;  // usable share of the arc for text

/** Relative-luminance (WCAG) contrast pick: dark text on light colors, light on dark. */
export function contrastText(color: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return '#f5fbff';
  const n = parseInt(m[1], 16);
  const chan = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * chan((n >> 16) & 255) + 0.7152 * chan((n >> 8) & 255) + 0.0722 * chan(n & 255);
  return lum >= 0.4 ? '#101418' : '#f5fbff';
}

/**
 * Arc path for <textPath>. flip=true draws end→start with sweep 0 (counter-
 * clockwise) so glyphs on bottom-half slices read upright instead of head-down.
 */
export function textArcPath(r: number, startDeg: number, endDeg: number, flip: boolean): string {
  const s = polar(r, startDeg);
  const e = polar(r, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return flip
    ? `M ${e.x} ${e.y} A ${r} ${r} 0 ${large} 0 ${s.x} ${s.y}`
    : `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

const nameFits = (name: string, r: number, sweepDeg: number): boolean => {
  const fontSize = r * RING_FONT_FRACTION;
  const textWidth = name.length * CHAR_WIDTH * fontSize;
  const arcLength = r * (sweepDeg * Math.PI / 180);
  return textWidth <= arcLength * ARC_PADDING;
};

/** Midpoint in the bottom semicircle → the text arc must be flipped. */
const inBottomHalf = (midDeg: number): boolean => {
  const a = ((midDeg % 360) + 360) % 360;
  return a > 90 && a < 270;
};

/** N conditions -> N equal clockwise slices starting at 12 o'clock; text curves inside the band. */
export function statusSegments(conditions: string[], r: number): StatusSegment[] {
  const n = conditions.length;
  if (n === 0) return [];
  if (n === 1) {
    const name = conditions[0];
    const color = conditionColor(name);
    return [{
      name,
      path: hpArcPath(r, 1),
      full: true,
      color,
      label: { x: 0, y: -r },
      // full ring: a 340° arc whose midpoint (startOffset 50%) sits at 12 o'clock
      textArc: textArcPath(r, -170, 170, false),
      textColor: contrastText(color),
      fits: nameFits(name, r, 340),
    }];
  }
  const GAP = 4; // degrees of breathing room between slices
  const slice = 360 / n;
  return conditions.map((name, i) => {
    const start = i * slice + GAP / 2;
    const end = (i + 1) * slice - GAP / 2;
    const mid = i * slice + slice / 2;
    const labelPos = polar(r, mid);
    const color = conditionColor(name);
    return {
      name,
      path: arcPath(r, start, end),
      full: false,
      color,
      label: { x: labelPos.x, y: labelPos.y },
      textArc: textArcPath(r, start, end, inBottomHalf(mid)),
      textColor: contrastText(color),
      fits: nameFits(name, r, end - start),
    };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/swdnd/src/lib/rings.test.ts` — ALL pass, including the pre-existing ring tests. If a pre-existing test asserted the old outside-label position (`r + 6`), update that assertion to the mid-band point and say so in the commit message — that behavior change is the point of this task.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/rings.ts apps/swdnd/src/lib/rings.test.ts
git commit -m "feat(swdnd): curved ring-label geometry — text arcs, contrast, fit rule"
```

---

### Task 6: `useRollLog` hook

**Files:**
- Create: `apps/swdnd/src/hooks/useRollLog.ts`

No unit test file (hooks are exercised in the walkthrough, matching `useTabletop`/`useDmScreen`); the pure pieces are already tested in Tasks 2–3. The build (`cd apps/swdnd && bun run build`) is the check here — it runs in Task 7 once a component consumes the hook (tsc `noUnusedLocals` would fail an unconsumed file's imports otherwise… it won't, but the hook alone compiles fine; still, verify the build at the end of this task).

- [ ] **Step 1: Implement**

```ts
// apps/swdnd/src/hooks/useRollLog.ts — self-contained roll-log state for RollDock.
// Own WS connection on purpose: the dock mounts on three different surfaces
// (map, sheet, DM screen) without coupling to their hooks.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { connectCampaign, type WsEnvelope } from '../lib/ws';
import { parseFormula, rollD20, rollFormula } from '../lib/dice';
import { appendRoll, listRolls, postRoll, type RollDto } from '../lib/rolls';

export interface RollOpts {
  label?: string;
  hidden?: boolean;
  advantage?: boolean;
  disadvantage?: boolean;
}

export interface RollLogState {
  rolls: RollDto[];
  error: string | null;
  roll: (formula: string, opts?: RollOpts) => Promise<void>;
}

export function useRollLog(campaignId: string): RollLogState {
  const [searchParams] = useSearchParams();
  const playerToken = searchParams.get('token');
  const [rolls, setRolls] = useState<RollDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);
  const pending = useRef<RollDto[]>([]);

  const reload = useCallback(() => {
    loaded.current = false;
    pending.current = [];
    listRolls(campaignId)
      .then((list) => {
        loaded.current = true;
        let next = list;
        for (const r of pending.current) next = appendRoll(next, r);
        pending.current = [];
        setRolls(next);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load rolls'));
  }, [campaignId]);

  useEffect(reload, [reload]);

  useEffect(() => {
    const hadOpened = { current: false };
    const sock = connectCampaign(campaignId, (env: WsEnvelope) => {
      if (env.type !== 'roll:created') return;
      const r = env.payload as RollDto;
      if (!loaded.current) {
        pending.current.push(r);
        return;
      }
      setRolls((cur) => appendRoll(cur, r));
    }, (open) => {
      if (open) {
        if (hadOpened.current) reload();
        hadOpened.current = true;
      }
    }, playerToken);
    return () => sock.close();
  }, [campaignId, playerToken, reload]);

  const roll = useCallback(async (formula: string, opts: RollOpts = {}) => {
    const terms = parseFormula(formula);
    if (!terms) {
      setError(`Can't parse "${formula}" — try 2d6+3`);
      return;
    }
    try {
      let posted: RollDto;
      if (opts.advantage || opts.disadvantage) {
        // adv/dis is offered only for a single d20 (+ modifier)
        const r = rollD20(terms.modifier, { advantage: opts.advantage, disadvantage: opts.disadvantage });
        const suffix = opts.advantage ? '(adv)' : '(dis)';
        posted = await postRoll(campaignId, {
          label: opts.label ? `${opts.label} ${suffix}` : suffix,
          formula,
          rolls: r.rolls.map((v) => ({ sides: 20, value: v })),
          total: r.total,
          hidden: opts.hidden,
        }, playerToken);
      } else {
        const r = rollFormula(terms);
        posted = await postRoll(campaignId, {
          label: opts.label,
          formula: r.formula,
          rolls: r.rolls,
          total: r.total,
          hidden: opts.hidden,
        }, playerToken);
      }
      // The POST response covers hidden rolls (no WS echo); appendRoll dedupes the echo for public ones.
      setRolls((cur) => appendRoll(cur, posted));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Roll failed');
    }
  }, [campaignId, playerToken]);

  return { rolls, error, roll };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/swdnd/src/hooks/useRollLog.ts
git commit -m "feat(swdnd): useRollLog hook — load, WS merge, roll action"
```

---

### Task 7: `RollDock` + mounts + sheet roll broadcast

**Files:**
- Create: `apps/swdnd/src/components/RollDock.tsx`
- Modify: `apps/swdnd/src/panels/Tabletop/index.tsx`
- Modify: `apps/swdnd/src/panels/DMScreen/index.tsx`
- Modify: `apps/swdnd/src/App.tsx`
- Modify: `apps/swdnd/src/panels/CharacterSheet/Sheet/index.tsx`

Placement note: the sheet's private `RollToast` already owns bottom-RIGHT — the dock lives bottom-LEFT on every surface.

- [ ] **Step 1: Implement `RollDock`**

```tsx
// apps/swdnd/src/components/RollDock.tsx — floating roll log + dice roller.
// Mounted on the map, the character sheet page, and the DM screen.
import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { useRollLog } from '../hooks/useRollLog';
import { parseFormula } from '../lib/dice';
import { addDie, addModifier, type RollDto } from '../lib/rolls';

const DICE = [4, 6, 8, 10, 12, 20, 100] as const;

function RollLine({ r }: { r: RollDto }) {
  return (
    <div className="border-b border-ht-line/40 py-1">
      <div className="flex items-baseline gap-2">
        <span className="ht-label shrink-0">{r.hidden ? '🔒 ' : ''}{r.roller}</span>
        {r.label && <span className="truncate text-[10px] text-ht-muted">{r.label}</span>}
        <b className="ml-auto text-base text-ht-bright">{r.total}</b>
      </div>
      <div className="text-[10px] text-ht-muted">
        {r.formula} · [{r.rolls_json.map((d) => d.value).join(', ')}]
      </div>
    </div>
  );
}

export default function RollDock({ campaignId }: { campaignId: string }) {
  const { authed } = useAuth();
  const log = useRollLog(campaignId);
  const [open, setOpen] = useState(false);
  const [formula, setFormula] = useState('');
  const [label, setLabel] = useState('');
  const [secret, setSecret] = useState(false);
  const [advMode, setAdvMode] = useState<'norm' | 'adv' | 'dis'>('norm');

  const terms = parseFormula(formula);
  const canAdv = !!terms && terms.dice.length === 1
    && terms.dice[0].count === 1 && terms.dice[0].sides === 20;
  const latest = log.rolls.find((r) => !r.hidden) ?? log.rolls[0] ?? null;

  const doRoll = () => {
    if (!terms) return;
    void log.roll(formula, {
      label: label.trim() || undefined,
      hidden: authed && secret,
      advantage: canAdv && advMode === 'adv',
      disadvantage: canAdv && advMode === 'dis',
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        className="ht-glow fixed bottom-4 left-4 z-30 rounded-md px-3 py-2 font-mono text-[11px] text-ht-text"
        onClick={() => setOpen(true)}
      >
        🎲{latest ? <> {latest.roller} · {latest.formula} = <b className="text-ht-bright">{latest.total}</b></> : ' rolls'}
      </button>
    );
  }

  return (
    <div className="ht-panel fixed bottom-4 left-4 z-30 flex w-80 max-w-[92vw] flex-col rounded-md p-2 font-mono text-[11px] text-ht-text">
      <div className="flex items-center gap-2">
        <span className="ht-label">roll log</span>
        <button type="button" className="ht-step ml-auto" onClick={() => setOpen(false)}>✕</button>
      </div>

      <div className="my-1 max-h-56 overflow-y-auto">
        {log.rolls.length === 0 && <div className="py-2 text-ht-muted">No rolls yet.</div>}
        {log.rolls.map((r) => <RollLine key={r.id} r={r} />)}
      </div>

      {log.error && <div className="mb-1 text-[10px] text-red-400">⚠ {log.error}</div>}

      <div className="flex flex-wrap items-center gap-1">
        {DICE.map((d) => (
          <button key={d} type="button" className="ht-step" onClick={() => setFormula((f) => addDie(f, d))}>
            d{d}
          </button>
        ))}
        <button type="button" className="ht-step" onClick={() => setFormula((f) => addModifier(f, 1))}>+1</button>
        <button type="button" className="ht-step" onClick={() => setFormula((f) => addModifier(f, -1))}>−1</button>
        <button type="button" className="ht-step" onClick={() => setFormula('')}>clear</button>
      </div>

      <div className="mt-1 flex items-center gap-2">
        <input
          className="w-24 border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none"
          placeholder="2d6+3" value={formula}
          onChange={(e) => setFormula(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doRoll()}
        />
        <input
          className="min-w-0 flex-1 border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none"
          placeholder="label…" value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doRoll()}
        />
      </div>

      <div className="mt-1 flex items-center gap-2">
        {canAdv && (
          <>
            <button type="button" className={`ht-step ${advMode === 'adv' ? 'ht-tile-active' : ''}`}
              onClick={() => setAdvMode((m) => (m === 'adv' ? 'norm' : 'adv'))}>adv</button>
            <button type="button" className={`ht-step ${advMode === 'dis' ? 'ht-tile-active' : ''}`}
              onClick={() => setAdvMode((m) => (m === 'dis' ? 'norm' : 'dis'))}>dis</button>
          </>
        )}
        {authed && (
          <label className="flex items-center gap-1 text-[10px] text-ht-muted">
            <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} />
            secret
          </label>
        )}
        <button type="button" className="ht-step ht-tile-active ml-auto" disabled={!terms} onClick={doRoll}>
          roll
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount on the map and DM screen**

`panels/Tabletop/index.tsx`: add `import RollDock from '../../components/RollDock';` and render `<RollDock campaignId={campaignId} />` as the LAST child of the root `@container` div (after the `min-h-0 flex-1` canvas div).

`panels/DMScreen/index.tsx`: add the same import and render `<RollDock campaignId={campaignId} />` just before the closing root `</div>` (after the drawer block). It goes AFTER the `if (!authed)` early return, so it only mounts for the DM — correct, this page is DM-only.

- [ ] **Step 3: Mount on the sheet page** (`App.tsx`)

The `/play/:characterId` split view already gets its dock from Tabletop; only the standalone sheet page needs one. Replace `SheetPage`:

```tsx
import RollDock from "./components/RollDock";

function SheetPage() {
  const { characterId = "" } = useParams();
  const [campaignId, setCampaignId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getCharacter(characterId)
      .then((c) => alive && setCampaignId(c.campaign_id))
      .catch(() => alive && setCampaignId(null));
    return () => {
      alive = false;
    };
  }, [characterId]);
  return (
    <SinglePanel>
      <CharacterSheet characterId={characterId} />
      {campaignId && <RollDock campaignId={campaignId} />}
    </SinglePanel>
  );
}
```

(`useState`/`useEffect`/`getCharacter` are already imported in App.tsx.)

- [ ] **Step 4: Broadcast sheet rolls**

In `panels/CharacterSheet/Sheet/index.tsx`, add imports:

```tsx
import { useSearchParams } from 'react-router-dom';
import { postRoll } from '../../../lib/rolls';
```

Add inside the component (before the early returns): `const [searchParams] = useSearchParams();`

Replace the `roll` closure (after the null-guard early return, `s.build`/`s.dto` are safe via the guard for build; dto needs its own check):

```tsx
  const roll = (label: string, mod: number) => {
    const r = rollD20(mod);
    pushRoll(label, `d20 ${r.kept} ${mod >= 0 ? '+' : ''}${mod}`, r.total);
    // Fire-and-forget into the campaign roll log — a failed POST never blocks the local toast.
    if (s.dto) {
      void postRoll(s.dto.campaign_id, {
        roller: s.build.identity.name || 'Character',
        label,
        formula: mod === 0 ? '1d20' : `1d20${mod >= 0 ? '+' : ''}${mod}`,
        rolls: [{ sides: 20, value: r.kept }],
        total: r.total,
      }, searchParams.get('token')).catch(() => { /* anon viewer or offline: local roll still shows */ });
    }
  };
```

(If `useCharacterSheet`'s returned object doesn't expose `dto`, check `hooks/useCharacterSheet.ts` — the interface has `dto: CharacterDto | null`; expose it in the return if it isn't already.)

- [ ] **Step 5: Build + verify**

Run: `cd apps/swdnd && bun run build`
Expected: clean build (this is the typecheck).

- [ ] **Step 6: Commit**

```bash
git add apps/swdnd/src/components/RollDock.tsx apps/swdnd/src/hooks/useRollLog.ts apps/swdnd/src/panels/Tabletop/index.tsx apps/swdnd/src/panels/DMScreen/index.tsx apps/swdnd/src/App.tsx apps/swdnd/src/panels/CharacterSheet/Sheet/index.tsx
git commit -m "feat(swdnd): RollDock on map/sheet/DM screen; sheet rolls broadcast"
```

---

### Task 8: token images + curved labels in `TokenGlyph`

**Files:**
- Modify: `apps/swdnd/src/lib/scenes.ts`
- Modify: `apps/swdnd/src/hooks/useTabletop.ts`
- Modify: `apps/swdnd/src/panels/Tabletop/TokenGlyph.tsx`

- [ ] **Step 1: Client wrappers** (append to `lib/scenes.ts`)

```ts
export async function uploadTokenImage(tokenId: string, file: File, token?: string | null): Promise<TokenDto> {
  const fd = new FormData();
  fd.append('file', file);
  return api<TokenDto>(`/swdnd/tokens/${tokenId}/image`, { method: 'POST', headers: auth(token), body: fd });
}
export const deleteTokenImage = (tokenId: string, token?: string | null) =>
  api<TokenDto>(`/swdnd/tokens/${tokenId}/image`, { method: 'DELETE', headers: auth(token) });
```

- [ ] **Step 2: Hook actions** (`useTabletop.ts`)

Add `uploadTokenImage, deleteTokenImage` to the `../lib/scenes` import list. Extend the `actions` interface:

```ts
    setTokenImage: (id: string, file: File) => Promise<void>;
    clearTokenImage: (id: string) => Promise<void>;
```

And the returned actions object (next to `editToken`; the `token:updated` echo updates state, no local mutation needed):

```ts
      setTokenImage: wrap(async (id: string, file: File) => { await uploadTokenImage(id, file, playerToken); }),
      clearTokenImage: wrap(async (id: string) => { await deleteTokenImage(id, playerToken); }),
```

- [ ] **Step 3: `TokenGlyph` — image + curved labels**

Replace the file body with:

```tsx
// apps/swdnd/src/panels/Tabletop/TokenGlyph.tsx
import type { GridConfig } from '../../lib/hex';
import { hexToPixel } from '../../lib/hex';
import {
  BAND_FRACTION, hpArcPath, hpColor, hpFraction, RING_FONT_FRACTION, statusSegments,
} from '../../lib/rings';
import type { TokenVitals } from '../../lib/vitals';
import type { TokenDto } from '../../lib/scenes';
import { API_BASE } from '../../lib/api';

const initials = (name: string) =>
  name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();

export default function TokenGlyph({
  token, grid, ghost, draggable, at, vitals, showHp, dimmed, active,
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
}) {
  const pos = at ?? hexToPixel({ q: token.q, r: token.r }, grid);
  const radius = grid.hexSize * 0.72 * token.scale;
  const fraction = showHp ? hpFraction(vitals.hp, vitals.maxHp) : null;
  // Band center sits clear of the HP arc (1.08r); band width/font follow rings.ts fractions.
  const ringR = radius * 1.45;
  const band = ringR * BAND_FRACTION;
  const ringFont = ringR * RING_FONT_FRACTION;
  const segments = statusSegments(vitals.conditions, ringR);
  return (
    <g
      transform={`translate(${pos.x}, ${pos.y})`}
      data-token-id={token.id}
      opacity={ghost ? 0.45 : dimmed ? 0.35 : 1}
      style={draggable ? { cursor: 'grab' } : undefined}
    >
      {token.image_path ? (
        <>
          <clipPath id={`tok-clip-${token.id}`}>
            <circle r={radius * 0.96} />
          </clipPath>
          <image
            href={`${API_BASE}/swdnd/uploads/${token.image_path}?v=${token.updated_at}`}
            x={-radius} y={-radius} width={radius * 2} height={radius * 2}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#tok-clip-${token.id})`}
          />
          {/* Faction color survives as the border ring so friend/foe reads at a glance. */}
          <circle
            r={radius} fill="none"
            stroke={token.color} strokeWidth={grid.hexSize * 0.08}
            strokeDasharray={dimmed ? '4 3' : undefined}
          />
        </>
      ) : (
        <circle
          r={radius} fill={token.color} fillOpacity={0.25}
          stroke={token.color} strokeWidth={grid.hexSize * 0.08}
          strokeDasharray={dimmed ? '4 3' : undefined}
        />
      )}
      {active && (
        <circle r={radius * 1.6} fill="none" stroke="#4dd0e1" strokeWidth={grid.hexSize * 0.06} pointerEvents="none">
          <animate attributeName="stroke-opacity" values="0.9;0.25;0.9" dur="1.6s" repeatCount="indefinite" />
        </circle>
      )}
      {fraction != null && (
        <path
          d={hpArcPath(radius * 1.08, fraction)}
          fill="none" stroke={hpColor(fraction)} strokeWidth={grid.hexSize * 0.09}
          strokeLinecap="round" pointerEvents="none"
        />
      )}
      {segments.map((s, i) => (
        <g key={s.name} pointerEvents="none">
          <path d={s.path} fill="none" stroke={s.color} strokeWidth={band} strokeOpacity={0.9} />
          {s.fits && s.textArc ? (
            <>
              <path id={`seg-${token.id}-${i}`} d={s.textArc} fill="none" />
              <text fontSize={ringFont} fill={s.textColor} fontFamily="monospace" style={{ userSelect: 'none' }}>
                <textPath href={`#seg-${token.id}-${i}`} startOffset="50%" textAnchor="middle" dominantBaseline="central">
                  {s.name}
                </textPath>
              </text>
            </>
          ) : (
            <text
              x={s.label.x} y={s.label.y} textAnchor="middle" dominantBaseline="central"
              fill={s.textColor} fontFamily="monospace" fontSize={ringFont} style={{ userSelect: 'none' }}
            >
              {s.name[0]?.toUpperCase() ?? '?'}
            </text>
          )}
        </g>
      ))}
      {!token.image_path && (
        <text
          textAnchor="middle" dominantBaseline="central"
          fill="#e6f7ff" fontFamily="monospace" fontWeight="bold"
          fontSize={radius * 0.8} style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {initials(token.name)}
        </text>
      )}
      <text
        y={ringR + band / 2 + grid.hexSize * 0.4} textAnchor="middle"
        fill="#9adbe8" fontFamily="monospace" fontSize={grid.hexSize * 0.36}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {token.name}
      </text>
    </g>
  );
}
```

- [ ] **Step 4: Build**

Run: `cd apps/swdnd && bun run build` — clean.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/scenes.ts apps/swdnd/src/hooks/useTabletop.ts apps/swdnd/src/panels/Tabletop/TokenGlyph.tsx
git commit -m "feat(swdnd): clipped image tokens and curved ring labels in TokenGlyph"
```

---

### Task 9: image controls — DM editor + player own-token panel

**Files:**
- Create: `apps/swdnd/src/panels/Tabletop/TokenImageControls.tsx`
- Modify: `apps/swdnd/src/panels/Tabletop/TokenEditor.tsx`
- Modify: `apps/swdnd/src/panels/Tabletop/SceneCanvas.tsx`
- Modify: `apps/swdnd/src/panels/Tabletop/index.tsx`

- [ ] **Step 1: `TokenImageControls`** (inline strip, used by both surfaces)

```tsx
// apps/swdnd/src/panels/Tabletop/TokenImageControls.tsx
import { useRef } from 'react';
import type { TokenDto } from '../../lib/scenes';

export default function TokenImageControls({
  token, onUpload, onClear,
}: {
  token: TokenDto;
  onUpload: (file: File) => void;
  onClear: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <span className="flex items-center gap-1">
      <input
        ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          e.target.value = ''; // allow re-selecting the same file
        }}
      />
      <button type="button" className="ht-step" onClick={() => fileRef.current?.click()}>
        {token.image_path ? '🖼 replace' : '🖼 image'}
      </button>
      {token.image_path && (
        <button type="button" className="text-[10px] text-ht-muted" onClick={onClear}>clear img</button>
      )}
    </span>
  );
}
```

- [ ] **Step 2: Embed in `TokenEditor`**

In `TokenEditor.tsx`: import the component, extend the props, render the strip after the size `<label>` (before the hidden toggle):

```tsx
import TokenImageControls from './TokenImageControls';
```

Props type gains:

```tsx
  onImageUpload: (id: string, file: File) => void;
  onImageClear: (id: string) => void;
```

(add `onImageUpload, onImageClear` to the destructured parameter list), then in the JSX:

```tsx
      <TokenImageControls
        token={token}
        onUpload={(f) => onImageUpload(token.id, f)}
        onClear={() => onImageClear(token.id)}
      />
```

- [ ] **Step 3: Player tap-select of their own token** (`SceneCanvas.tsx`)

At the mouse-up handler around line 221, replace:

```tsx
      if (!moved) {
        if (isDm) onSelectToken(drag.tokenId);
      } else if (hex.q !== drag.startHex.q || hex.r !== drag.startHex.r) {
```

with:

```tsx
      if (!moved) {
        const t = tokens.find((x) => x.id === drag.tokenId);
        const own = !!t?.character_id && ownCharacterIds.has(t.character_id);
        if (isDm || own) onSelectToken(drag.tokenId);
      } else if (hex.q !== drag.startHex.q || hex.r !== drag.startHex.r) {
```

And around line 237, replace the empty-tap deselect:

```tsx
        } else if (isDm) {
          onSelectToken(null);
        }
```

with:

```tsx
        } else {
          onSelectToken(null); // players deselect their own-token panel the same way
        }
```

(`tokens` and `ownCharacterIds` are existing SceneCanvas props.)

- [ ] **Step 4: Wire both panels** (`Tabletop/index.tsx`)

Pass the new editor props in the existing DM block:

```tsx
          <TokenEditor
            token={selected}
            onEdit={(id, body) => void t.actions.editToken(id, body)}
            onDelete={(id) => void t.actions.removeToken(id)}
            onImageUpload={(id, file) => void t.actions.setTokenImage(id, file)}
            onImageClear={(id) => void t.actions.clearTokenImage(id)}
            onClose={() => setSelectedId(null)}
          />
```

Add the player panel right below the DM `TokenEditor` block (new sibling block) and import `TokenImageControls` at the top of the file:

```tsx
      {!t.isDm && selected && selected.character_id && t.ownCharacterIds.has(selected.character_id) && (
        <div className="mx-2 mb-2">
          <div className="ht-panel flex items-center gap-3 p-2 text-[11px]">
            <span className="ht-label">{selected.name}</span>
            <TokenImageControls
              token={selected}
              onUpload={(f) => void t.actions.setTokenImage(selected.id, f)}
              onClear={() => void t.actions.clearTokenImage(selected.id)}
            />
            <button type="button" className="ht-step ml-auto" onClick={() => setSelectedId(null)}>✕ close</button>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Build + full test suite**

Run: `cd apps/swdnd && bun run build` — clean.
Run (repo root, remember it resets the dev DB): `bun test` — all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/swdnd/src/panels/Tabletop/TokenImageControls.tsx apps/swdnd/src/panels/Tabletop/TokenEditor.tsx apps/swdnd/src/panels/Tabletop/SceneCanvas.tsx apps/swdnd/src/panels/Tabletop/index.tsx
git commit -m "feat(swdnd): token image controls for DM and owning players"
```

---

### Task 10: full verification + live walkthrough

**Files:**
- Modify (temporarily): `.claude/launch.json` — MUST be reverted afterwards
- Modify: vault docs in `/Users/asherc/Documents/Mount Tantiss/ashercarlow.com/swdnd/`

- [ ] **Step 1: Full suite + builds**

```bash
bun test               # repo root — wipes dev swdnd.sqlite campaign state (recreated below)
cd apps/swdnd && bun run build
```

Expected: all tests pass, clean build.

- [ ] **Step 2: Auth-enforced servers**

Edit `.claude/launch.json` backend entry to `"runtimeExecutable": "sh", "runtimeArgs": ["-c", "ASHERCARLOW_AUTH_TOKEN=dm-secret bun start"]`, restart via preview tools. Recreate walkthrough data via curl (bearer `dm-secret`): campaign, player slot, a character, a scene with an image + active, DM login in tab-1 via `fetch('/auth/login', {credentials:'include', ...})`.

Browser-automation reminders (hard-won): React inputs need the native value setter + dispatched `input` event; commit BufferedText-style inputs by dispatching `new FocusEvent('focusout', {bubbles: true})` (`.blur()` no-ops unfocused); DOM `.click()` via javascript_tool over ref-clicks; anon checks via `fetch(..., {credentials:'omit'})`; wrap repeated `const` evals in IIFEs.

- [ ] **Step 3: Walkthrough checklist**

Roll log:
- DM tab (map): open the dock, tap d6 twice + `+1` → formula `2d6+1`, roll → appears in both tabs live.
- Player tab (map with `?token=`): roll `1d20`, adv toggle appears; roll with adv → two d20s in the detail, label suffixed `(adv)`; roller shows the player name.
- Sheet: click a skill roll → toast AND the dock log line with the character name + label in the other tab.
- Secret: DM checks `secret`, rolls → visible with 🔒 in the DM tab only; player tab shows nothing (verify also via `credentials:'omit'` GET that hidden rows are stripped).
- Reload the player tab → recent rolls still listed (persistence); hidden 403 for player POST (`curl` with `hidden: true` + player token → 403).
- Dock on the DM screen (`/dm/:id`) shows the same log.

Image tokens:
- DM: tap-select an NPC token → 🖼 image → upload a png → face appears clipped in the disc in both tabs (token:updated), faction border intact; replace with another image (cache-bust works); clear img → disc returns.
- Player: tap own character token → minimal panel (image controls only), upload works; tap another token → no panel.
- Wrong-player rejection via curl (other player token → 403).

Ring labels:
- One condition (e.g. `hunter's mark`) → full ring, curved name, contrast text.
- Add conditions to 3–4 → narrow slices: short names curve, long names fall back to initials; bottom-half text reads upright.
- Confirm HP arc, initiative glow, name label all still legible; eyeball band thickness/font at scale 1 and 2 (tune `ringR`/`BAND_FRACTION` constants if cramped — pure-constant tweak).

- [ ] **Step 4: REVERT `.claude/launch.json`**, restart backend in dev mode.

- [ ] **Step 5: Update vault docs**

- `Roadmap.md`: add a "Map polish" line (image tokens · roll log · ring labels) with the branch/PR.
- `Features/Tabletop & Map.md`: shipped-surface additions (image tokens + ring labels + dock on the map).
- `Features/DM Screen.md`: note the RollDock mount + secret rolls.
- `Data Model.md`: `roll` table entry (migration 005) + `token.image_path` no longer "reserved".
- `TODOs and Improvements.md`: mark the ring-label item done (or remove it).

- [ ] **Step 6: Commit docs, then run superpowers:finishing-a-development-branch**

```bash
git add docs/superpowers/plans/2026-07-23-map-polish.md
git commit -m "docs(swdnd): map polish plan completion notes"
```

Present the standard 4-option menu; on "2", push `swdnd-map-polish` and open the PR.
