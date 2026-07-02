# Character Sheet Play View (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the swdnd **play sheet** — a responsive, live read/play view that renders `computeSheet(build, ref)` in the Holoterminal aesthetic and lets the owner adjust play state, persisted and broadcast in real time.

**Architecture:** All non-trivial logic lives in **pure, unit-tested modules** (`lib/playState.ts`, `lib/dice.ts`, `lib/sheetView.ts`, `lib/faction.ts`, `lib/canEdit.ts`); React components stay "dumb" (props in → JSX out, calling action callbacks), so correctness is tested in the pure layer and the presentational layer is verified via `bun --cwd apps/swdnd run build` + a live-preview visual polish pass. A single `useCharacterSheet` hook orchestrates load → compute → play-state edits (optimistic + debounced persist) → realtime merge.

**Tech Stack:** React 19, React Router 7, Vite 7, Tailwind v4 (`@theme` + `@container`), Bun (`bun test`). Consumes the Phase 1 engine/client (all merged to `main`).

**Spec:** `docs/superpowers/specs/2026-07-02-character-sheet-play-view-design.md`.

---

## Phase 1 API this plan builds on (already merged, do not reimplement)

From `apps/swdnd/src/lib/rules` (via `./rules` or `./rules/types`):
- `computeSheet(build: CharacterBuild, ref: ReferenceData): DerivedSheet`.
- `DerivedSheet`: `{ totalLevel, proficiencyBonus, abilities: Record<AbilityKey,{score,mod}>, maxHp, armorClass, initiative, speed, hitDice: Record<string,number>, savingThrows: Record<AbilityKey,{bonus,proficient}>, skills: SkillBonus[], casting: { force: TrackCasting; tech: TrackCasting }, superiority: SuperiorityBlock | null }`.
- `TrackCasting`: `{ classes, casterLevel, maxPowerLevel, pointsMax, knownMax, ability: AbilityKey|null, saveDc: number|null, attackBonus: number|null }`.
- `SuperiorityBlock`: `{ level, diceMax, die, knownMax }`. `SkillBonus`: `{ key: SkillKey, ability: AbilityKey, bonus, proficient, expertise }`.
- `PlayState`: `{ hp, tempHp, hitDiceSpent, forcePointsSpent, techPointsSpent, superiorityDiceSpent, conditions: string[], exhaustion, inspiration, notes }`.
- `CharacterBuild.identity.alignment: 'light'|'dark'|'universal'|'none'`; `CharacterBuild.knownPowers: string[]`; `CharacterBuild.play: PlayState`.
- `RefPower`: `{ id, name, level, castType: 'force'|'tech' }`. `ReferenceData.powers: Record<string, RefPower>`. `AbilityKey`, `SkillKey`.
- `SKILLS: Record<SkillKey,{ability,label}>` from `./rules/constants`.

From `apps/swdnd/src/lib/characters`:
- `getCharacter(id): Promise<CharacterDto>` where `CharacterDto = { id, campaign_id, player_id, name, data_json: CharacterBuild, created_at, updated_at }`.
- `patchCharacter(id, patch: { name?, data_json?: CharacterBuild }, token?): Promise<CharacterDto>`.
- `loadReference(): Promise<ReferenceData>`.

From `apps/swdnd/src/lib/ws`: `connectCampaign(campaignId, onMessage:(env)=>void, onStatus?:(open)=>void): CampaignSocket` (`{ send, close }`), `WsEnvelope = { type, room, payload? }`.
From `apps/swdnd/src/lib/auth`: `useAuth(): { authed, loading, refresh }`.

**Test note (from `tasks/lessons.md`):** `*.test.ts` under `apps/swdnd/src` are excluded from the build already. Pure modules import from `./rules/...`; keep tests pure (no React) so `bun test` runs them directly.

---

## File structure

Create under `apps/swdnd/src/`:
- `lib/faction.ts` — alignment → accent color + CSS-var style.
- `lib/dice.ts` — pure dice roller (injectable RNG).
- `lib/playState.ts` — `applyPlayAction(build, derived, action)` (all play mutations, clamped).
- `lib/sheetView.ts` — pure render helpers (`remaining`, `powerCost`, `knownPowersByLevel`).
- `lib/canEdit.ts` — `resolveCanEdit({admin, token})`.
- `hooks/useCharacterSheet.ts` — orchestration hook.
- `panels/CharacterSheet/Sheet/{index,CoreBar,Stepper,ConditionsMenu,Abilities,Skills,Combat,Gear,Features,Powers,TabbedShell,RollToast}.tsx`.
Modify:
- `index.css` — Holoterminal `@theme` tokens + a few utility classes.
- `panels/CharacterSheet/index.tsx` — play/build mode router.
- `App.tsx` — `PlayPage` resolves the real `campaign_id`.

---

## Task 1: Holoterminal theme + faction mapping

**Files:**
- Modify: `apps/swdnd/src/index.css`
- Create: `apps/swdnd/src/lib/faction.ts`
- Test: `apps/swdnd/src/lib/faction.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/swdnd/src/lib/faction.test.ts
import { test, expect } from 'bun:test';
import { factionAccent, factionStyle } from './faction';

test('faction accent maps alignment to a color', () => {
  expect(factionAccent('light')).toBe('#7aa2ff');
  expect(factionAccent('dark')).toBe('#ff5470');
  expect(factionAccent('universal')).toBe('#4dd0e1');
  expect(factionAccent('none')).toBe('#4dd0e1');
});

test('factionStyle sets the --faction CSS variable', () => {
  expect(factionStyle('dark')).toEqual({ '--faction': '#ff5470' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/swdnd/src/lib/faction.test.ts`
Expected: FAIL — cannot resolve `./faction`.

- [ ] **Step 3: Implement faction.ts**

```ts
// apps/swdnd/src/lib/faction.ts
import type { CSSProperties } from 'react';
import type { Alignment } from './rules/types';

export const FACTION_ACCENT: Record<Alignment, string> = {
  light: '#7aa2ff',
  dark: '#ff5470',
  universal: '#4dd0e1',
  none: '#4dd0e1',
};

export function factionAccent(alignment: Alignment): string {
  return FACTION_ACCENT[alignment] ?? '#4dd0e1';
}

/** Inline style that sets --faction so descendant utilities can reference it. */
export function factionStyle(alignment: Alignment): CSSProperties {
  return { ['--faction']: factionAccent(alignment) } as CSSProperties;
}
```

- [ ] **Step 4: Add Holoterminal tokens to index.css**

Replace the contents of `apps/swdnd/src/index.css` with:

```css
@import "tailwindcss";

@theme {
  --color-ht-bg: #05080d;
  --color-ht-panel: #070d14;
  --color-ht-line: rgba(77, 208, 225, 0.28);
  --color-ht-accent: #4dd0e1;
  --color-ht-text: #8fe6f5;
  --color-ht-bright: #d6fbff;
  --color-ht-muted: #5f8f99;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
}

html, body, #root {
  height: 100%;
  margin: 0;
}

/* Holoterminal helpers. --faction defaults to the accent; sheet root overrides it. */
.ht-panel {
  border: 1px solid var(--color-ht-line);
  border-radius: 0.375rem;
  background: var(--color-ht-panel);
}
.ht-glow {
  border: 1px solid var(--faction, var(--color-ht-accent));
  box-shadow: 0 0 12px color-mix(in srgb, var(--faction, var(--color-ht-accent)) 22%, transparent);
}
.ht-step {
  border: 1px solid var(--color-ht-line);
  border-radius: 0.25rem;
  padding: 0 0.5rem;
  color: var(--color-ht-accent);
  user-select: none;
  cursor: pointer;
}
.ht-label {
  font-size: 0.625rem;
  letter-spacing: 0.12em;
  color: var(--color-ht-accent);
  text-transform: uppercase;
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `bun test apps/swdnd/src/lib/faction.test.ts`
Expected: PASS (2 pass).
Run: `bun --cwd apps/swdnd run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/swdnd/src/lib/faction.ts apps/swdnd/src/lib/faction.test.ts apps/swdnd/src/index.css
git commit -m "feat(swdnd): Holoterminal theme tokens + faction accent"
```

---

## Task 2: Dice roller

**Files:**
- Create: `apps/swdnd/src/lib/dice.ts`
- Test: `apps/swdnd/src/lib/dice.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/swdnd/src/lib/dice.test.ts
import { test, expect } from 'bun:test';
import { rollDie, rollD20, rollDamage, type Rng } from './dice';

// Deterministic RNG that yields the given [0,1) values in order, then repeats the last.
function seq(values: number[]): Rng {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

test('rollDie maps [0,1) to 1..sides', () => {
  expect(rollDie(20, seq([0]))).toBe(1);
  expect(rollDie(20, seq([0.999]))).toBe(20);
  expect(rollDie(6, seq([0.5]))).toBe(4);
});

test('rollD20 adds modifier; advantage keeps the higher', () => {
  expect(rollD20(3, {}, seq([0.5]))).toMatchObject({ total: 14, kept: 11, mod: 3 });
  const adv = rollD20(0, { advantage: true }, seq([0.1, 0.95])); // rolls 3, 20 -> keep 20
  expect(adv).toMatchObject({ kept: 20, total: 20, rolls: [3, 20] });
  const dis = rollD20(0, { disadvantage: true }, seq([0.1, 0.95])); // keep 3
  expect(dis.kept).toBe(3);
});

test('rollDamage parses NdM+K', () => {
  const r = rollDamage('2d6+3', seq([0.99, 0.99])); // 6 + 6 + 3
  expect(r.total).toBe(15);
  expect(r.rolls).toEqual([6, 6]);
  expect(rollDamage('1d8', seq([0])).total).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/swdnd/src/lib/dice.test.ts`
Expected: FAIL — cannot resolve `./dice`.

- [ ] **Step 3: Implement dice.ts**

```ts
// apps/swdnd/src/lib/dice.ts
export type Rng = () => number; // returns [0, 1)
export const defaultRng: Rng = () => Math.random();

export function rollDie(sides: number, rng: Rng = defaultRng): number {
  return Math.floor(rng() * sides) + 1;
}

export interface D20Result {
  total: number;
  rolls: number[];
  kept: number;
  mod: number;
}

export function rollD20(
  mod: number,
  opts: { advantage?: boolean; disadvantage?: boolean } = {},
  rng: Rng = defaultRng,
): D20Result {
  const a = rollDie(20, rng);
  if (!opts.advantage && !opts.disadvantage) {
    return { total: a + mod, rolls: [a], kept: a, mod };
  }
  const b = rollDie(20, rng);
  const kept = opts.advantage ? Math.max(a, b) : Math.min(a, b);
  return { total: kept + mod, rolls: [a, b], kept, mod };
}

export interface DamageResult {
  total: number;
  rolls: number[];
  formula: string;
}

/** Parse and roll a simple `NdM(+/-K)?` formula. Unparseable → total 0. */
export function rollDamage(formula: string, rng: Rng = defaultRng): DamageResult {
  const m = /^\s*(\d+)d(\d+)\s*([+-]\s*\d+)?\s*$/i.exec(formula);
  if (!m) return { total: 0, rolls: [], formula };
  const count = Number(m[1]);
  const sides = Number(m[2]);
  const bonus = m[3] ? Number(m[3].replace(/\s+/g, '')) : 0;
  const rolls = Array.from({ length: count }, () => rollDie(sides, rng));
  return { total: rolls.reduce((s, r) => s + r, 0) + bonus, rolls, formula };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/swdnd/src/lib/dice.test.ts`
Expected: PASS (3 pass).

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/dice.ts apps/swdnd/src/lib/dice.test.ts
git commit -m "feat(swdnd): pure dice roller"
```

---

## Task 3: Play-state mutations

**Files:**
- Create: `apps/swdnd/src/lib/playState.ts`
- Test: `apps/swdnd/src/lib/playState.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/swdnd/src/lib/playState.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild, type DerivedSheet, type RefPower } from './rules/types';
import { applyPlayAction } from './playState';

function derived(over: Partial<DerivedSheet> = {}): DerivedSheet {
  return {
    totalLevel: 5, proficiencyBonus: 3,
    abilities: {} as DerivedSheet['abilities'],
    maxHp: 30, armorClass: 12, initiative: 2, speed: 30,
    hitDice: { d6: 5 },
    savingThrows: {} as DerivedSheet['savingThrows'],
    skills: [],
    casting: {
      force: { classes: 1, casterLevel: 5, maxPowerLevel: 3, pointsMax: 22, knownMax: 17, ability: 'wis', saveDc: 14, attackBonus: 6 },
      tech: { classes: 0, casterLevel: 0, maxPowerLevel: 0, pointsMax: 0, knownMax: 0, ability: null, saveDc: null, attackBonus: null },
    },
    superiority: null,
    ...over,
  };
}
function build(play: Partial<import('./rules/types').PlayState> = {}) {
  const b = emptyBuild('x');
  b.play = { ...b.play, hp: 20, tempHp: 0, ...play };
  return b;
}

test('damage eats temp HP first then HP, floored at 0', () => {
  const p = applyPlayAction(build({ hp: 20, tempHp: 5 }), derived(), { t: 'damage', n: 8 });
  expect(p.tempHp).toBe(0);
  expect(p.hp).toBe(17);
  expect(applyPlayAction(build({ hp: 3 }), derived(), { t: 'damage', n: 10 }).hp).toBe(0);
});

test('heal caps at derived maxHp', () => {
  expect(applyPlayAction(build({ hp: 28 }), derived(), { t: 'heal', n: 10 }).hp).toBe(30);
});

test('spendForce and castPower clamp to the pool and use power cost level+1', () => {
  const b = build();
  expect(applyPlayAction(b, derived(), { t: 'spendForce', n: 5 }).forcePointsSpent).toBe(5);
  const power: RefPower = { id: 'heal', name: 'Heal', level: 1, castType: 'force' };
  expect(applyPlayAction(b, derived(), { t: 'castPower', power }).forcePointsSpent).toBe(2); // 1+1
  const spent = { ...b, play: { ...b.play, forcePointsSpent: 21 } };
  expect(applyPlayAction(spent, derived(), { t: 'castPower', power }).forcePointsSpent).toBe(22); // clamp at max 22
});

test('at-will power (level 0) costs 0', () => {
  const power: RefPower = { id: 'push', name: 'Push', level: 0, castType: 'force' };
  expect(applyPlayAction(build(), derived(), { t: 'castPower', power }).forcePointsSpent).toBe(0);
});

test('hit dice, conditions, exhaustion, inspiration', () => {
  const b = build();
  expect(applyPlayAction(b, derived(), { t: 'spendHitDie' }).hitDiceSpent).toBe(1);
  const c1 = applyPlayAction(b, derived(), { t: 'addCondition', c: 'Prone' });
  expect(c1.conditions).toEqual(['Prone']);
  const cDup = applyPlayAction({ ...b, play: c1 }, derived(), { t: 'addCondition', c: 'Prone' });
  expect(cDup.conditions).toEqual(['Prone']); // no duplicate
  expect(applyPlayAction({ ...b, play: c1 }, derived(), { t: 'removeCondition', c: 'Prone' }).conditions).toEqual([]);
  expect(applyPlayAction(b, derived(), { t: 'setExhaustion', n: 9 }).exhaustion).toBe(6); // clamp 0..6
  expect(applyPlayAction(b, derived(), { t: 'toggleInspiration' }).inspiration).toBe(true);
});

test('spendSuperiority clamps to derived diceMax (0 when no superiority)', () => {
  expect(applyPlayAction(build(), derived(), { t: 'spendSuperiority' }).superiorityDiceSpent).toBe(0);
  const withSup = derived({ superiority: { level: 3, diceMax: 4, die: 'd8', knownMax: 4 } });
  expect(applyPlayAction(build(), withSup, { t: 'spendSuperiority' }).superiorityDiceSpent).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/swdnd/src/lib/playState.test.ts`
Expected: FAIL — cannot resolve `./playState`.

- [ ] **Step 3: Implement playState.ts**

```ts
// apps/swdnd/src/lib/playState.ts
import type { CharacterBuild, DerivedSheet, PlayState, RefPower } from './rules/types';

export type PlayAction =
  | { t: 'damage'; n: number }
  | { t: 'heal'; n: number }
  | { t: 'setTemp'; n: number }
  | { t: 'spendForce'; n: number }
  | { t: 'spendTech'; n: number }
  | { t: 'castPower'; power: RefPower }
  | { t: 'restForce' }
  | { t: 'restTech' }
  | { t: 'spendHitDie' }
  | { t: 'regainHitDie' }
  | { t: 'spendSuperiority' }
  | { t: 'regainSuperiority' }
  | { t: 'addCondition'; c: string }
  | { t: 'removeCondition'; c: string }
  | { t: 'setExhaustion'; n: number }
  | { t: 'toggleInspiration' };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function applyPlayAction(
  build: CharacterBuild,
  derived: DerivedSheet,
  action: PlayAction,
): PlayState {
  const p: PlayState = { ...build.play, conditions: [...build.play.conditions] };
  const supMax = derived.superiority?.diceMax ?? 0;

  switch (action.t) {
    case 'damage': {
      let n = Math.max(0, action.n);
      const absorbed = Math.min(p.tempHp, n);
      p.tempHp -= absorbed;
      n -= absorbed;
      p.hp = clamp(p.hp - n, 0, derived.maxHp);
      break;
    }
    case 'heal':
      p.hp = clamp(p.hp + Math.max(0, action.n), 0, derived.maxHp);
      break;
    case 'setTemp':
      p.tempHp = Math.max(0, action.n);
      break;
    case 'spendForce':
      p.forcePointsSpent = clamp(p.forcePointsSpent + action.n, 0, derived.casting.force.pointsMax);
      break;
    case 'spendTech':
      p.techPointsSpent = clamp(p.techPointsSpent + action.n, 0, derived.casting.tech.pointsMax);
      break;
    case 'castPower': {
      const cost = action.power.level === 0 ? 0 : action.power.level + 1;
      if (action.power.castType === 'force') {
        p.forcePointsSpent = clamp(p.forcePointsSpent + cost, 0, derived.casting.force.pointsMax);
      } else {
        p.techPointsSpent = clamp(p.techPointsSpent + cost, 0, derived.casting.tech.pointsMax);
      }
      break;
    }
    case 'restForce':
      p.forcePointsSpent = 0;
      break;
    case 'restTech':
      p.techPointsSpent = 0;
      break;
    case 'spendHitDie':
      p.hitDiceSpent = clamp(p.hitDiceSpent + 1, 0, derived.totalLevel);
      break;
    case 'regainHitDie':
      p.hitDiceSpent = clamp(p.hitDiceSpent - 1, 0, derived.totalLevel);
      break;
    case 'spendSuperiority':
      p.superiorityDiceSpent = clamp(p.superiorityDiceSpent + 1, 0, supMax);
      break;
    case 'regainSuperiority':
      p.superiorityDiceSpent = clamp(p.superiorityDiceSpent - 1, 0, supMax);
      break;
    case 'addCondition':
      if (!p.conditions.includes(action.c)) p.conditions.push(action.c);
      break;
    case 'removeCondition':
      p.conditions = p.conditions.filter((c) => c !== action.c);
      break;
    case 'setExhaustion':
      p.exhaustion = clamp(action.n, 0, 6);
      break;
    case 'toggleInspiration':
      p.inspiration = !p.inspiration;
      break;
  }
  return p;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/swdnd/src/lib/playState.test.ts`
Expected: PASS (6 pass).

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/playState.ts apps/swdnd/src/lib/playState.test.ts
git commit -m "feat(swdnd): pure play-state mutations"
```

---

## Task 4: Sheet-view helpers + edit gating

**Files:**
- Create: `apps/swdnd/src/lib/sheetView.ts`, `apps/swdnd/src/lib/canEdit.ts`
- Test: `apps/swdnd/src/lib/sheetView.test.ts`, `apps/swdnd/src/lib/canEdit.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/swdnd/src/lib/sheetView.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild, type ReferenceData, type RefPower } from './rules/types';
import { remaining, powerCost, knownPowersByLevel } from './sheetView';

test('remaining never goes negative', () => {
  expect(remaining(22, 17)).toBe(5);
  expect(remaining(22, 30)).toBe(0);
});

test('powerCost is level+1, 0 for at-will', () => {
  expect(powerCost(0)).toBe(0);
  expect(powerCost(1)).toBe(2);
  expect(powerCost(3)).toBe(4);
});

test('knownPowersByLevel groups known ids by track then level, sorted', () => {
  const powers: Record<string, RefPower> = {
    push: { id: 'push', name: 'Force Push', level: 0, castType: 'force' },
    heal: { id: 'heal', name: 'Heal', level: 1, castType: 'force' },
    storm: { id: 'storm', name: 'Force Storm', level: 3, castType: 'force' },
    scan: { id: 'scan', name: 'Sensor Scan', level: 1, castType: 'tech' },
  };
  const ref = { powers } as unknown as ReferenceData;
  const b = emptyBuild('x');
  b.knownPowers = ['storm', 'push', 'heal', 'scan', 'missing'];
  const { force, tech } = knownPowersByLevel(b, ref);
  expect(force.map((g) => g.level)).toEqual([0, 1, 3]);
  expect(force[0].powers.map((p) => p.name)).toEqual(['Force Push']);
  expect(force[1].cost).toBe(2);
  expect(tech.map((g) => g.level)).toEqual([1]);
});
```

```ts
// apps/swdnd/src/lib/canEdit.test.ts
import { test, expect } from 'bun:test';
import { resolveCanEdit } from './canEdit';

test('admin or a present token grants edit; neither is read-only', () => {
  expect(resolveCanEdit({ admin: true, token: null })).toBe(true);
  expect(resolveCanEdit({ admin: false, token: 'tok-1' })).toBe(true);
  expect(resolveCanEdit({ admin: false, token: null })).toBe(false);
  expect(resolveCanEdit({ admin: false, token: '' })).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test apps/swdnd/src/lib/sheetView.test.ts apps/swdnd/src/lib/canEdit.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the helpers**

```ts
// apps/swdnd/src/lib/sheetView.ts
import type { CharacterBuild, CastType, ReferenceData, RefPower } from './rules/types';

export const remaining = (max: number, spent: number): number => Math.max(0, max - spent);
export const powerCost = (level: number): number => (level === 0 ? 0 : level + 1);

export interface PowerGroup {
  level: number;
  label: string;
  cost: number;
  powers: RefPower[];
}

function groupTrack(powers: RefPower[]): PowerGroup[] {
  const byLevel = new Map<number, RefPower[]>();
  for (const p of powers) {
    const list = byLevel.get(p.level) ?? [];
    list.push(p);
    byLevel.set(p.level, list);
  }
  return [...byLevel.keys()]
    .sort((a, b) => a - b)
    .map((level) => ({
      level,
      label: level === 0 ? 'At-will' : `Level ${level}`,
      cost: powerCost(level),
      powers: byLevel.get(level)!.sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

export function knownPowersByLevel(
  build: CharacterBuild,
  ref: ReferenceData,
): Record<CastType, PowerGroup[]> {
  const resolved = build.knownPowers
    .map((id) => ref.powers[id])
    .filter((p): p is RefPower => Boolean(p));
  return {
    force: groupTrack(resolved.filter((p) => p.castType === 'force')),
    tech: groupTrack(resolved.filter((p) => p.castType === 'tech')),
  };
}
```

```ts
// apps/swdnd/src/lib/canEdit.ts
export function resolveCanEdit(opts: { admin: boolean; token: string | null | undefined }): boolean {
  return opts.admin || !!opts.token;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/swdnd/src/lib/sheetView.test.ts apps/swdnd/src/lib/canEdit.test.ts`
Expected: PASS (4 pass total).

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/sheetView.ts apps/swdnd/src/lib/canEdit.ts apps/swdnd/src/lib/sheetView.test.ts apps/swdnd/src/lib/canEdit.test.ts
git commit -m "feat(swdnd): sheet-view helpers + edit gating"
```

---

## Task 5: useCharacterSheet hook (load, compute, edit, persist)

**Files:**
- Create: `apps/swdnd/src/hooks/useCharacterSheet.ts`

Context: this hook is IO/orchestration — verified via `tsc`/build and the preview, not unit tests (its logic is delegated to the tested pure modules). Realtime is added in Task 15.

- [ ] **Step 1: Implement the hook**

```ts
// apps/swdnd/src/hooks/useCharacterSheet.ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getCharacter, loadReference, patchCharacter, type CharacterDto } from '../lib/characters';
import { useAuth } from '../lib/auth';
import { resolveCanEdit } from '../lib/canEdit';
import { applyPlayAction, type PlayAction } from '../lib/playState';
import { computeSheet } from '../lib/rules';
import type { CharacterBuild, DerivedSheet, PlayState, ReferenceData } from '../lib/rules/types';

export interface SheetState {
  loading: boolean;
  error: string | null;
  build: CharacterBuild | null;
  derived: DerivedSheet | null;
  ref: ReferenceData | null;
  play: PlayState | null;
  canEdit: boolean;
  dto: CharacterDto | null;
  dispatch: (action: PlayAction) => void;
}

const SAVE_DEBOUNCE_MS = 400;

export function useCharacterSheet(characterId: string): SheetState {
  const { authed } = useAuth();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [dto, setDto] = useState<CharacterDto | null>(null);
  const [build, setBuild] = useState<CharacterBuild | null>(null);
  const [ref, setRef] = useState<ReferenceData | null>(null);
  const [play, setPlay] = useState<PlayState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([getCharacter(characterId), loadReference()])
      .then(([character, reference]) => {
        if (!alive) return;
        setDto(character);
        setBuild(character.data_json);
        setPlay(character.data_json.play);
        setRef(reference);
        setError(null);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [characterId]);

  const derived = useMemo(
    () => (build && ref ? computeSheet(build, ref) : null),
    [build, ref],
  );

  const canEdit = resolveCanEdit({ admin: authed, token });

  const dispatch = useCallback(
    (action: PlayAction) => {
      if (!canEdit || !build || !derived || !play) return;
      const nextPlay = applyPlayAction({ ...build, play }, derived, action);
      setPlay(nextPlay);
      const nextBuild = { ...build, play: nextPlay };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void patchCharacter(characterId, { data_json: nextBuild }, token ?? undefined).catch(
          (e: unknown) => setError(e instanceof Error ? e.message : 'Save failed'),
        );
      }, SAVE_DEBOUNCE_MS);
    },
    [canEdit, build, derived, play, characterId, token],
  );

  return { loading, error, build, derived, ref, play, canEdit, dto, dispatch };
}
```

- [ ] **Step 2: Typecheck**

Run: `bun --cwd apps/swdnd run build`
Expected: build succeeds (nothing imports the hook yet; it must compile).

- [ ] **Step 3: Commit**

```bash
git add apps/swdnd/src/hooks/useCharacterSheet.ts
git commit -m "feat(swdnd): useCharacterSheet hook (load, compute, edit, debounced save)"
```

---

## Task 6: Stepper component

**Files:**
- Create: `apps/swdnd/src/panels/CharacterSheet/Sheet/Stepper.tsx`

- [ ] **Step 1: Implement the Stepper**

```tsx
// apps/swdnd/src/panels/CharacterSheet/Sheet/Stepper.tsx
import { useState } from 'react';

interface StepperProps {
  value: number;
  max?: number;
  editable: boolean;
  onDelta: (delta: number) => void;
  onSet?: (value: number) => void;
}

/** Inline −/+ with tap-to-type. Renders "value/max" when max is given. */
export default function Stepper({ value, max, editable, onDelta, onSet }: StepperProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  if (!editable) {
    return (
      <span className="font-mono text-ht-bright">
        {value}
        {max != null && <span className="text-ht-muted">/{max}</span>}
      </span>
    );
  }

  const commit = () => {
    const n = Number(draft);
    if (onSet && Number.isFinite(n)) onSet(n);
    setEditing(false);
  };

  return (
    <span className="inline-flex items-center gap-1.5 font-mono">
      <button type="button" className="ht-step" onClick={() => onDelta(-1)} aria-label="decrement">−</button>
      {editing ? (
        <input
          autoFocus
          className="w-10 bg-transparent text-center text-ht-bright outline-none"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
      ) : (
        <button
          type="button"
          className="text-lg text-ht-bright"
          onClick={() => {
            if (!onSet) return;
            setDraft(String(value));
            setEditing(true);
          }}
        >
          {value}
        </button>
      )}
      {max != null && <span className="text-ht-muted">/{max}</span>}
      <button type="button" className="ht-step" onClick={() => onDelta(1)} aria-label="increment">+</button>
    </span>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bun --cwd apps/swdnd run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/swdnd/src/panels/CharacterSheet/Sheet/Stepper.tsx
git commit -m "feat(swdnd): inline Stepper control"
```

---

## Task 7: ConditionsMenu component

**Files:**
- Create: `apps/swdnd/src/panels/CharacterSheet/Sheet/ConditionsMenu.tsx`

- [ ] **Step 1: Implement ConditionsMenu**

```tsx
// apps/swdnd/src/panels/CharacterSheet/Sheet/ConditionsMenu.tsx
import { useState } from 'react';

export const SW5E_CONDITIONS = [
  'Blinded', 'Charmed', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated',
  'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained',
  'Shocked', 'Slowed', 'Stunned', 'Unconscious',
];

interface Props {
  active: string[];
  editable: boolean;
  onAdd: (c: string) => void;
  onRemove: (c: string) => void;
}

export default function ConditionsMenu({ active, editable, onAdd, onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const available = SW5E_CONDITIONS.filter((c) => !active.includes(c));

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {active.map((c) => (
        <button
          key={c}
          type="button"
          disabled={!editable}
          onClick={() => editable && onRemove(c)}
          className="ht-glow rounded-full px-2 py-0.5 text-[10px] text-ht-bright"
          title={editable ? 'Remove' : undefined}
        >
          ● {c}{editable && ' ✕'}
        </button>
      ))}
      {editable && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="rounded-full border border-ht-line px-2 py-0.5 text-[10px] text-ht-accent"
          >
            + Condition ▾
          </button>
          {open && (
            <div className="absolute right-0 z-10 mt-1 max-h-56 w-40 overflow-auto ht-panel p-1 text-[11px]">
              {available.length === 0 && <div className="p-1 text-ht-muted">All applied</div>}
              {available.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="block w-full rounded px-2 py-1 text-left text-ht-text hover:bg-white/5"
                  onClick={() => {
                    onAdd(c);
                    setOpen(false);
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bun --cwd apps/swdnd run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/swdnd/src/panels/CharacterSheet/Sheet/ConditionsMenu.tsx
git commit -m "feat(swdnd): ConditionsMenu (on-demand conditions)"
```

---

## Task 8: RollToast (ephemeral roll results)

**Files:**
- Create: `apps/swdnd/src/panels/CharacterSheet/Sheet/RollToast.tsx`

- [ ] **Step 1: Implement RollToast + a small hook**

```tsx
// apps/swdnd/src/panels/CharacterSheet/Sheet/RollToast.tsx
import { useCallback, useState } from 'react';

export interface RollLine {
  id: number;
  label: string;
  detail: string;
  total: number;
}

let rollSeq = 0;

export function useRolls() {
  const [rolls, setRolls] = useState<RollLine[]>([]);
  const pushRoll = useCallback((label: string, detail: string, total: number) => {
    const id = ++rollSeq;
    setRolls((r) => [{ id, label, detail, total }, ...r].slice(0, 5));
    setTimeout(() => setRolls((r) => r.filter((x) => x.id !== id)), 6000);
  }, []);
  return { rolls, pushRoll };
}

export default function RollToast({ rolls }: { rolls: RollLine[] }) {
  if (rolls.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-20 flex flex-col gap-2">
      {rolls.map((r) => (
        <div key={r.id} className="ht-glow rounded px-3 py-2 font-mono text-xs text-ht-text">
          <span className="text-ht-muted">{r.label} </span>
          <b className="text-ht-bright text-base">{r.total}</b>
          <span className="text-ht-muted"> · {r.detail}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bun --cwd apps/swdnd run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/swdnd/src/panels/CharacterSheet/Sheet/RollToast.tsx
git commit -m "feat(swdnd): ephemeral roll toast"
```

---

## Task 9: CoreBar

**Files:**
- Create: `apps/swdnd/src/panels/CharacterSheet/Sheet/CoreBar.tsx`

- [ ] **Step 1: Implement CoreBar**

```tsx
// apps/swdnd/src/panels/CharacterSheet/Sheet/CoreBar.tsx
import type { CharacterBuild, DerivedSheet, PlayState } from '../../../lib/rules/types';
import type { PlayAction } from '../../../lib/playState';
import { remaining } from '../../../lib/sheetView';
import Stepper from './Stepper';
import ConditionsMenu from './ConditionsMenu';

interface Props {
  build: CharacterBuild;
  derived: DerivedSheet;
  play: PlayState;
  editable: boolean;
  dispatch: (a: PlayAction) => void;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="ht-panel px-3 py-2 text-center">
      <div className="ht-label">{label}</div>
      <b className="text-base text-ht-bright">{value}</b>
    </div>
  );
}

export default function CoreBar({ build, derived, play, editable, dispatch }: Props) {
  const { force, tech } = derived.casting;
  const level = build.levels.length;
  return (
    <div className="ht-glow flex flex-wrap items-center gap-2 rounded-md p-3">
      <div className="min-w-[120px]">
        <div className="font-mono text-sm font-bold text-ht-bright">{build.identity.name || 'Unnamed'}</div>
        <div className="text-[10px] text-ht-muted">
          Level {level} · <span style={{ color: 'var(--faction)' }}>{build.identity.alignment}</span>
        </div>
        <a href={`/sheet/${build.identity.name ? '' : ''}build`} className="ht-label" style={{ cursor: 'pointer' }}>✎ Edit / Level up ▸</a>
      </div>

      <div className="ht-panel px-3 py-2 text-center">
        <div className="ht-label">Hit Points</div>
        <Stepper value={play.hp} max={derived.maxHp} editable={editable}
          onDelta={(d) => dispatch(d < 0 ? { t: 'damage', n: -d } : { t: 'heal', n: d })}
          onSet={(v) => dispatch({ t: 'heal', n: v - play.hp })} />
        <div className="text-[10px] text-ht-muted">temp +{play.tempHp} · HD {remaining(derived.totalLevel, play.hitDiceSpent)}</div>
      </div>

      <Stat label="AC" value={derived.armorClass} />
      <Stat label="Init" value={`+${derived.initiative}`} />
      <Stat label="Speed" value={derived.speed} />
      <Stat label="Prof" value={`+${derived.proficiencyBonus}`} />

      {force.classes > 0 && (
        <div className="ht-glow rounded-md px-3 py-2 text-center">
          <div className="ht-label">Force Pts</div>
          <Stepper value={remaining(force.pointsMax, play.forcePointsSpent)} max={force.pointsMax} editable={editable}
            onDelta={(d) => dispatch({ t: 'spendForce', n: -d })}
            onSet={(v) => dispatch({ t: 'spendForce', n: remaining(force.pointsMax, play.forcePointsSpent) - v })} />
          <div className="text-[10px] text-ht-muted">max lvl {force.maxPowerLevel} · DC {force.saveDc} · atk +{force.attackBonus}</div>
        </div>
      )}
      {tech.classes > 0 && (
        <div className="ht-glow rounded-md px-3 py-2 text-center">
          <div className="ht-label">Tech Pts</div>
          <Stepper value={remaining(tech.pointsMax, play.techPointsSpent)} max={tech.pointsMax} editable={editable}
            onDelta={(d) => dispatch({ t: 'spendTech', n: -d })}
            onSet={(v) => dispatch({ t: 'spendTech', n: remaining(tech.pointsMax, play.techPointsSpent) - v })} />
          <div className="text-[10px] text-ht-muted">max lvl {tech.maxPowerLevel} · DC {tech.saveDc} · atk +{tech.attackBonus}</div>
        </div>
      )}

      <div className="ml-auto flex flex-col items-end gap-1">
        <ConditionsMenu active={play.conditions} editable={editable}
          onAdd={(c) => dispatch({ t: 'addCondition', c })}
          onRemove={(c) => dispatch({ t: 'removeCondition', c })} />
        <div className="flex items-center gap-2 text-[10px] text-ht-muted">
          <button type="button" disabled={!editable} onClick={() => dispatch({ t: 'toggleInspiration' })}>
            {play.inspiration ? '◆' : '◇'} Inspiration
          </button>
          <span>Exhaustion {play.exhaustion}</span>
          {editable && (
            <span>
              <button type="button" className="ht-step" onClick={() => dispatch({ t: 'setExhaustion', n: play.exhaustion - 1 })}>−</button>
              <button type="button" className="ht-step" onClick={() => dispatch({ t: 'setExhaustion', n: play.exhaustion + 1 })}>+</button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bun --cwd apps/swdnd run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/swdnd/src/panels/CharacterSheet/Sheet/CoreBar.tsx
git commit -m "feat(swdnd): CoreBar (HP/points steppers, conditions, status)"
```

---

## Task 10: Abilities + Skills sections

**Files:**
- Create: `apps/swdnd/src/panels/CharacterSheet/Sheet/Abilities.tsx`, `apps/swdnd/src/panels/CharacterSheet/Sheet/Skills.tsx`

- [ ] **Step 1: Implement Abilities**

```tsx
// apps/swdnd/src/panels/CharacterSheet/Sheet/Abilities.tsx
import type { AbilityKey, DerivedSheet } from '../../../lib/rules/types';

const ORDER: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export default function Abilities({
  derived,
  onRoll,
}: {
  derived: DerivedSheet;
  onRoll: (label: string, mod: number) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {ORDER.map((key) => {
        const a = derived.abilities[key];
        return (
          <button
            key={key}
            type="button"
            onClick={() => onRoll(key.toUpperCase() + ' check', a.mod)}
            className="ht-panel px-2 py-2 text-center font-mono"
          >
            <div className="ht-label">{key}</div>
            <b className="text-ht-bright">{a.score}</b>
            <div className="text-ht-muted">{a.mod >= 0 ? `+${a.mod}` : a.mod}</div>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Implement Skills (saves + skills)**

```tsx
// apps/swdnd/src/panels/CharacterSheet/Sheet/Skills.tsx
import { SKILLS } from '../../../lib/rules/constants';
import type { AbilityKey, DerivedSheet } from '../../../lib/rules/types';

const ABIL_ORDER: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

export default function Skills({
  derived,
  onRoll,
}: {
  derived: DerivedSheet;
  onRoll: (label: string, mod: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2 font-mono text-[11px]">
      <div className="ht-panel p-2">
        <div className="ht-label mb-1">Saving Throws</div>
        {ABIL_ORDER.map((k) => {
          const s = derived.savingThrows[k];
          return (
            <button key={k} type="button" onClick={() => onRoll(k.toUpperCase() + ' save', s.bonus)}
              className={`flex w-full justify-between ${s.proficient ? 'text-ht-bright' : 'text-ht-muted'}`}>
              <span>{s.proficient ? '● ' : ''}{k.toUpperCase()}</span>
              <b>{fmt(s.bonus)}</b>
            </button>
          );
        })}
      </div>
      <div className="ht-panel p-2">
        <div className="ht-label mb-1">Skills</div>
        {derived.skills.map((sk) => (
          <button key={sk.key} type="button" onClick={() => onRoll(SKILLS[sk.key].label, sk.bonus)}
            className={`flex w-full justify-between ${sk.proficient ? 'text-ht-bright' : 'text-ht-muted'}`}>
            <span>{sk.expertise ? '◎ ' : sk.proficient ? '● ' : ''}{SKILLS[sk.key].label} <span className="text-ht-muted">({sk.ability})</span></span>
            <b>{fmt(sk.bonus)}</b>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `bun --cwd apps/swdnd run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/swdnd/src/panels/CharacterSheet/Sheet/Abilities.tsx apps/swdnd/src/panels/CharacterSheet/Sheet/Skills.tsx
git commit -m "feat(swdnd): Abilities + Skills sections"
```

---

## Task 11: Combat, Gear, Features sections

**Files:**
- Create: `apps/swdnd/src/panels/CharacterSheet/Sheet/Combat.tsx`, `Gear.tsx`, `Features.tsx`

Context: these render from `build` + `derived`. sw5e weapon/feature detail beyond names is deferred (Phase 1 deliberately deferred per-weapon attack math); render what the build carries — equipped items, credits, and known-feature ids — with graceful fallbacks. Attacks use the derived casting/attack values available now; weapon-specific rolls use a generic prompt.

- [ ] **Step 1: Implement Combat**

```tsx
// apps/swdnd/src/panels/CharacterSheet/Sheet/Combat.tsx
import type { CharacterBuild, DerivedSheet, ReferenceData } from '../../../lib/rules/types';

export default function Combat({
  build,
  derived,
  ref,
  onRoll,
}: {
  build: CharacterBuild;
  derived: DerivedSheet;
  ref: ReferenceData;
  onRoll: (label: string, mod: number) => void;
}) {
  const weapons = build.equipment
    .filter((e) => e.equipped)
    .map((e) => ref.weapons[e.ref])
    .filter(Boolean);
  const atkMod = derived.proficiencyBonus + derived.abilities.str.mod;
  return (
    <div className="ht-panel p-2 font-mono text-[11px]">
      <div className="ht-label mb-1">Attacks</div>
      {weapons.length === 0 && <div className="text-ht-muted">No weapons equipped.</div>}
      {weapons.map((w) => (
        <button key={w.id} type="button" onClick={() => onRoll(`${w.name} attack`, atkMod)}
          className="flex w-full justify-between text-ht-text">
          <span>{w.name}</span>
          <span className="text-ht-muted">atk {atkMod >= 0 ? `+${atkMod}` : atkMod}</span>
        </button>
      ))}
      <div className="ht-label mb-1 mt-2">Defense</div>
      <div className="flex justify-between text-ht-text"><span>Armor Class</span><b>{derived.armorClass}</b></div>
      <div className="flex justify-between text-ht-text"><span>Initiative</span><b>+{derived.initiative}</b></div>
      <div className="flex justify-between text-ht-text"><span>Speed</span><b>{derived.speed}</b></div>
    </div>
  );
}
```

- [ ] **Step 2: Implement Gear**

```tsx
// apps/swdnd/src/panels/CharacterSheet/Sheet/Gear.tsx
import type { CharacterBuild, ReferenceData } from '../../../lib/rules/types';

export default function Gear({ build, ref }: { build: CharacterBuild; ref: ReferenceData }) {
  return (
    <div className="ht-panel p-2 font-mono text-[11px]">
      <div className="ht-label mb-1">
        Gear · <span className="text-ht-bright">{build.credits.toLocaleString()} ₡</span>
      </div>
      {build.equipment.length === 0 && <div className="text-ht-muted">Nothing carried.</div>}
      {build.equipment.map((e, i) => {
        const item = ref.weapons[e.ref] ?? ref.armor[e.ref];
        return (
          <div key={`${e.ref}-${i}`} className="flex justify-between text-ht-text">
            <span>{e.equipped ? '◈ ' : '· '}{item?.name ?? e.ref}{e.qty > 1 ? ` ×${e.qty}` : ''}</span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Implement Features**

```tsx
// apps/swdnd/src/panels/CharacterSheet/Sheet/Features.tsx
import type { CharacterBuild } from '../../../lib/rules/types';

export default function Features({ build }: { build: CharacterBuild }) {
  const classes = [...new Set(build.levels.map((l) => l.classId))];
  return (
    <div className="ht-panel p-2 font-mono text-[11px]">
      <div className="ht-label mb-1">Features &amp; Traits</div>
      <div className="flex justify-between text-ht-text">
        <span>Species</span><span className="text-ht-muted">{build.identity.speciesId || '—'}</span>
      </div>
      <div className="flex justify-between text-ht-text">
        <span>Background</span><span className="text-ht-muted">{build.identity.backgroundId || '—'}</span>
      </div>
      <div className="flex justify-between text-ht-text">
        <span>Classes</span><span className="text-ht-muted">{classes.join(', ') || '—'}</span>
      </div>
      <div className="mt-1 text-ht-muted">Feature detail arrives with the builder (Phase 3).</div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `bun --cwd apps/swdnd run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/panels/CharacterSheet/Sheet/Combat.tsx apps/swdnd/src/panels/CharacterSheet/Sheet/Gear.tsx apps/swdnd/src/panels/CharacterSheet/Sheet/Features.tsx
git commit -m "feat(swdnd): Combat, Gear, Features sections"
```

---

## Task 12: Powers section (cast-to-spend + maneuvers)

**Files:**
- Create: `apps/swdnd/src/panels/CharacterSheet/Sheet/Powers.tsx`

- [ ] **Step 1: Implement Powers**

```tsx
// apps/swdnd/src/panels/CharacterSheet/Sheet/Powers.tsx
import type { CharacterBuild, DerivedSheet, ReferenceData } from '../../../lib/rules/types';
import type { PlayAction } from '../../../lib/playState';
import { knownPowersByLevel, remaining } from '../../../lib/sheetView';

interface Props {
  build: CharacterBuild;
  derived: DerivedSheet;
  ref: ReferenceData;
  editable: boolean;
  playForceSpent: number;
  playTechSpent: number;
  dispatch: (a: PlayAction) => void;
}

export default function Powers({ build, derived, ref, editable, playForceSpent, playTechSpent, dispatch }: Props) {
  const groups = knownPowersByLevel(build, ref);
  const tracks = [
    { key: 'force' as const, title: 'Force Powers', track: derived.casting.force, groups: groups.force, spent: playForceSpent },
    { key: 'tech' as const, title: 'Tech Powers', track: derived.casting.tech, groups: groups.tech, spent: playTechSpent },
  ].filter((t) => t.track.classes > 0);

  return (
    <div className="flex flex-col gap-2 font-mono text-[11px]">
      {tracks.map(({ key, title, track, groups: gs, spent }) => (
        <div key={key} className="ht-glow rounded p-2">
          <div className="flex justify-between">
            <span className="ht-label">{title}</span>
            <span className="text-ht-muted">
              {remaining(track.pointsMax, spent)}/{track.pointsMax} pts · known {track.knownMax}
            </span>
          </div>
          {gs.map((g) => (
            <div key={g.level} className="mt-1 border-t border-ht-line pt-1">
              <div className="text-[9px] text-ht-muted">
                {g.label.toUpperCase()} · {g.cost} pts{g.level === track.maxPowerLevel ? ' ◂ max' : ''}
              </div>
              {g.powers.map((p) => (
                <div key={p.id} className="flex justify-between text-ht-text">
                  <span>{p.name}</span>
                  {editable ? (
                    <button type="button" className="ht-step text-[10px]"
                      onClick={() => dispatch({ t: 'castPower', power: p })}>
                      cast {g.cost > 0 ? `−${g.cost}` : ''}
                    </button>
                  ) : (
                    <span className="text-ht-muted">{g.cost > 0 ? `−${g.cost}` : 'at-will'}</span>
                  )}
                </div>
              ))}
            </div>
          ))}
          {editable && (
            <button type="button" className="mt-2 text-[9px] text-ht-muted"
              onClick={() => dispatch({ t: key === 'force' ? 'restForce' : 'restTech' })}>
              ↺ long rest — restore pool
            </button>
          )}
        </div>
      ))}

      {derived.superiority && (
        <div className="ht-panel p-2">
          <div className="ht-label">Superiority</div>
          <div className="flex justify-between text-ht-text">
            <span>{derived.superiority.die} dice</span>
            <span className="text-ht-muted">
              {remaining(derived.superiority.diceMax, build.play.superiorityDiceSpent)}/{derived.superiority.diceMax} · known {derived.superiority.knownMax}
            </span>
          </div>
          {editable && (
            <div className="mt-1 flex gap-2 text-[10px]">
              <button type="button" className="ht-step" onClick={() => dispatch({ t: 'spendSuperiority' })}>spend die</button>
              <button type="button" className="ht-step" onClick={() => dispatch({ t: 'regainSuperiority' })}>regain</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bun --cwd apps/swdnd run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/swdnd/src/panels/CharacterSheet/Sheet/Powers.tsx
git commit -m "feat(swdnd): Powers section (cast-to-spend) + superiority"
```

---

## Task 13: Sheet shell + mode router (wide layout, wired end-to-end)

**Files:**
- Create: `apps/swdnd/src/panels/CharacterSheet/Sheet/index.tsx`
- Modify: `apps/swdnd/src/panels/CharacterSheet/index.tsx`

- [ ] **Step 1: Implement the Sheet shell**

```tsx
// apps/swdnd/src/panels/CharacterSheet/Sheet/index.tsx
import { useCharacterSheet } from '../../../hooks/useCharacterSheet';
import { factionStyle } from '../../../lib/faction';
import { rollD20 } from '../../../lib/dice';
import CoreBar from './CoreBar';
import Abilities from './Abilities';
import Skills from './Skills';
import Combat from './Combat';
import Gear from './Gear';
import Features from './Features';
import Powers from './Powers';
import RollToast, { useRolls } from './RollToast';

export default function Sheet({ characterId }: { characterId: string }) {
  const s = useCharacterSheet(characterId);
  const { rolls, pushRoll } = useRolls();

  if (s.loading) return <div className="p-6 font-mono text-ht-muted">Loading sheet…</div>;
  if (s.error) return <div className="p-6 font-mono text-red-400">{s.error}</div>;
  if (!s.build || !s.derived || !s.ref || !s.play) return null;

  const roll = (label: string, mod: number) => {
    const r = rollD20(mod);
    pushRoll(label, `d20 ${r.kept} ${mod >= 0 ? '+' : ''}${mod}`, r.total);
  };

  return (
    <div className="@container min-h-screen bg-ht-bg p-3 text-ht-text" style={factionStyle(s.build.identity.alignment)}>
      <CoreBar build={s.build} derived={s.derived} play={s.play} editable={s.canEdit} dispatch={s.dispatch} />
      <div className="mt-3 grid grid-cols-1 gap-3 @md:grid-cols-2 @lg:grid-cols-3">
        <div className="flex flex-col gap-3">
          <Abilities derived={s.derived} onRoll={roll} />
          <Skills derived={s.derived} onRoll={roll} />
        </div>
        <div className="flex flex-col gap-3">
          <Combat build={s.build} derived={s.derived} ref={s.ref} onRoll={roll} />
          <Gear build={s.build} ref={s.ref} />
          <Features build={s.build} />
        </div>
        <div className="flex flex-col gap-3">
          <Powers build={s.build} derived={s.derived} ref={s.ref} editable={s.canEdit}
            playForceSpent={s.play.forcePointsSpent} playTechSpent={s.play.techPointsSpent} dispatch={s.dispatch} />
        </div>
      </div>
      <RollToast rolls={rolls} />
    </div>
  );
}
```

- [ ] **Step 2: Wire the mode router**

Replace `apps/swdnd/src/panels/CharacterSheet/index.tsx` with:

```tsx
// apps/swdnd/src/panels/CharacterSheet/index.tsx
import { useParams } from 'react-router-dom';
import Sheet from './Sheet';

export default function CharacterSheet({ characterId }: { characterId: string }) {
  const { mode } = useParams();
  if (mode === 'build') {
    return (
      <section className="p-6 font-mono text-ht-muted">
        Builder arrives in Phase 3. <a className="text-ht-accent" href={`/sheet/${characterId}`}>← Back to sheet</a>
      </section>
    );
  }
  return <Sheet characterId={characterId} />;
}
```

- [ ] **Step 3: Typecheck + build**

Run: `bun --cwd apps/swdnd run build`
Expected: build succeeds — the full wide sheet renders and edits.

- [ ] **Step 4: Commit**

```bash
git add apps/swdnd/src/panels/CharacterSheet/Sheet/index.tsx apps/swdnd/src/panels/CharacterSheet/index.tsx
git commit -m "feat(swdnd): wire the play sheet end-to-end (wide layout)"
```

---

## Task 14: Responsive tabbed shell (narrow mode)

**Files:**
- Create: `apps/swdnd/src/panels/CharacterSheet/Sheet/TabbedShell.tsx`
- Modify: `apps/swdnd/src/panels/CharacterSheet/Sheet/index.tsx`

- [ ] **Step 1: Implement TabbedShell**

```tsx
// apps/swdnd/src/panels/CharacterSheet/Sheet/TabbedShell.tsx
import { useState, type ReactNode } from 'react';

export default function TabbedShell({ tabs }: { tabs: { key: string; label: string; content: ReactNode }[] }) {
  const [active, setActive] = useState(tabs[0]?.key);
  return (
    <div>
      <div className="mt-3 flex gap-1">
        {tabs.map((t) => (
          <button key={t.key} type="button" onClick={() => setActive(t.key)}
            className={`flex-1 rounded px-2 py-1 text-[11px] ${active === t.key ? 'ht-glow text-ht-bright' : 'ht-panel text-ht-muted'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-3">{tabs.find((t) => t.key === active)?.content}</div>
    </div>
  );
}
```

- [ ] **Step 2: Use container queries to switch wide grid ↔ tabs**

In `apps/swdnd/src/panels/CharacterSheet/Sheet/index.tsx`, import `TabbedShell` and replace the `<div className="mt-3 grid …">…</div>` block with a wide grid (shown at `@lg`) plus a tabbed view (shown below `@lg`). Build the three column groups once and reuse them:

```tsx
  // ...inside Sheet, after computing roll():
  const colAbilities = (
    <div className="flex flex-col gap-3">
      <Abilities derived={s.derived} onRoll={roll} />
      <Skills derived={s.derived} onRoll={roll} />
    </div>
  );
  const colCombat = (
    <div className="flex flex-col gap-3">
      <Combat build={s.build} derived={s.derived} ref={s.ref} onRoll={roll} />
      <Gear build={s.build} ref={s.ref} />
      <Features build={s.build} />
    </div>
  );
  const colPowers = (
    <Powers build={s.build} derived={s.derived} ref={s.ref} editable={s.canEdit}
      playForceSpent={s.play.forcePointsSpent} playTechSpent={s.play.techPointsSpent} dispatch={s.dispatch} />
  );

  return (
    <div className="@container min-h-screen bg-ht-bg p-3 text-ht-text" style={factionStyle(s.build.identity.alignment)}>
      <CoreBar build={s.build} derived={s.derived} play={s.play} editable={s.canEdit} dispatch={s.dispatch} />

      {/* Wide: 3 columns */}
      <div className="mt-3 hidden gap-3 @lg:grid @lg:grid-cols-3">
        {colAbilities}{colCombat}{colPowers}
      </div>

      {/* Narrow / medium: tabs */}
      <div className="@lg:hidden">
        <TabbedShell tabs={[
          { key: 'combat', label: 'Combat', content: colCombat },
          { key: 'powers', label: 'Powers', content: colPowers },
          { key: 'skills', label: 'Skills', content: colAbilities },
        ]} />
      </div>

      <RollToast rolls={rolls} />
    </div>
  );
```

Remove the previous single-grid block so only the wide grid + tabbed view remain.

- [ ] **Step 3: Typecheck + build**

Run: `bun --cwd apps/swdnd run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/swdnd/src/panels/CharacterSheet/Sheet/TabbedShell.tsx apps/swdnd/src/panels/CharacterSheet/Sheet/index.tsx
git commit -m "feat(swdnd): responsive tabbed shell (container-query narrow mode)"
```

---

## Task 15: Real-time subscribe/merge + fix PlayPage room

**Files:**
- Modify: `apps/swdnd/src/hooks/useCharacterSheet.ts`, `apps/swdnd/src/App.tsx`

- [ ] **Step 1: Subscribe to the campaign room and merge external play updates**

In `apps/swdnd/src/hooks/useCharacterSheet.ts`, add `import { connectCampaign } from '../lib/ws';` and, after the `derived` memo, add an effect that joins the campaign room and merges incoming `character:updated` for this character:

```ts
  useEffect(() => {
    const campaignId = dto?.campaign_id;
    if (!campaignId) return;
    const sock = connectCampaign(campaignId, (env) => {
      if (env.type !== 'character:updated') return;
      const payload = env.payload as { characterId?: string; play?: PlayState } | undefined;
      if (payload?.characterId === characterId && payload.play) {
        setPlay(payload.play);
      }
    });
    return () => sock.close();
  }, [dto?.campaign_id, characterId]);
```

(Our own debounced save echoes back the same play state — idempotent. Last-write-wins across clients.)

- [ ] **Step 2: Fix PlayPage to use the real campaign id**

In `apps/swdnd/src/App.tsx`, replace the `PlayPage` component so the map panel joins the character's real campaign room instead of the `characterId` placeholder:

```tsx
import { useEffect, useState } from "react";
import { getCharacter } from "./lib/characters";
// ...existing imports...

function PlayPage() {
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
    <SplitView
      left={<CharacterSheet characterId={characterId} />}
      right={campaignId ? <Tabletop campaignId={campaignId} /> : <div className="p-6 text-zinc-500">Loading…</div>}
    />
  );
}
```

Add a route so the builder placeholder mode resolves: in the `<Routes>`, add
`<Route path="/sheet/:characterId/:mode" element={<SheetPage />} />` immediately after the existing `/sheet/:characterId` route.

- [ ] **Step 3: Typecheck + build**

Run: `bun --cwd apps/swdnd run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/swdnd/src/hooks/useCharacterSheet.ts apps/swdnd/src/App.tsx
git commit -m "feat(swdnd): live character:updated merge + real campaign room in split view"
```

---

## Task 16: Visual polish pass

**Files:** all `apps/swdnd/src/panels/CharacterSheet/Sheet/*.tsx` and `apps/swdnd/src/index.css` as needed.

This task is verification + refinement, not new behavior. Use the **frontend-design** skill and a **live preview** (run `bun --cwd apps/swdnd run dev` and drive the app; seed a character via the API or Swagger UI). The pure logic and data wiring are frozen — only styling/spacing/interaction feel changes.

- [ ] **Step 1: Preview with a real character**

Start the backend (`bun start`) and the frontend dev server (`bun --cwd apps/swdnd run dev`). Create a campaign + character via `POST /swdnd/campaigns` then `POST /swdnd/campaigns/{id}/characters` (Swagger at `/docs`), give it a build (abilities, a class level, a couple `knownPowers` ids from `GET /swdnd/content/powers`), and open `/sheet/{characterId}` in the swdnd host (set `VITE_API_BASE=http://localhost:3000`).

- [ ] **Step 2: Refine against the approved mockup**

Match the Holoterminal design: cyan glow on Force/Tech panels and the active casting stat, monospace, hairline panels, faction color on alignment + power panels. Tighten the CoreBar wrap at narrow widths, verify the `@lg` grid ↔ tab switch happens on **panel** width in the split view (resize one pane), and confirm read-only mode (no `?token=`, not admin) hides all steppers/cast/condition controls. Adjust `index.css` utilities and section spacing only.

- [ ] **Step 3: Verify build + full suite still green**

Run: `bun --cwd apps/swdnd run build`
Run: `bun test`
Expected: build succeeds; all tests pass (styling changes don't touch the tested pure modules).

- [ ] **Step 4: Commit**

```bash
git add apps/swdnd/src
git commit -m "polish(swdnd): Holoterminal visual pass on the play sheet"
```

---

## Task 17: Final integration sweep

**Files:** none new — verification.

- [ ] **Step 1: Full test suite**

Run: `bun test`
Expected: PASS — the new pure-module tests (faction, dice, playState, sheetView, canEdit) plus all prior tests, 0 fail.

- [ ] **Step 2: Frontend build**

Run: `bun --cwd apps/swdnd run build`
Expected: `tsc -b && vite build` succeeds.

- [ ] **Step 3: Read-only vs editable smoke check**

With the dev server running, confirm: `/sheet/{id}` as admin (logged in) shows steppers; `/sheet/{id}?token={playerToken}` shows steppers and persists (check a second browser/tab in the same campaign reflects HP changes live); `/sheet/{id}` with neither is read-only. Confirm a `character:updated` from one tab flips the other tab's HP.

- [ ] **Step 4: Commit any final fixups**

```bash
git add -A
git commit -m "test(swdnd): phase 2 play sheet integration verified" --allow-empty
```

---

## Self-review (completed during planning)

- **Spec coverage:** §2 decisions → Holoterminal theme (T1), inline steppers (T6/T9), on-demand conditions (T7), cast-to-spend (T12), responsive container-query (T14), local rolling (T2/T8/T13), edit rights (T4/T5). §3 play-state model → `playState.ts` (T3) + `sheetView.remaining` (T4). §4 data flow → hook (T5) + realtime (T15). §5 edit gating → `canEdit` (T4) wired in T5. §6 design system → T1. §7 layout → T13/T14. §8 files → all component tasks. §9 realtime → T15. §10 testing → pure-module tests in T1–T4; build/preview for UI. §11 phasing → task order mirrors the 4 sub-phases; §11's polish pass → T16.
- **Type consistency:** `PlayAction` (T3) is consumed identically by the hook (T5) and every component (`dispatch`); `remaining`/`powerCost`/`knownPowersByLevel` (T4) used in T9/T12; `factionStyle` (T1) used in T13. Component props reference only Phase 1 types confirmed present (`DerivedSheet`, `TrackCasting`, `SkillBonus`, `RefPower`, `SKILLS`).
- **No placeholders:** every code step is complete. T16 (visual polish) is intentionally a refinement/verification task — it changes styling only and is bounded by explicit checks, not placeholder code.
- **Known deferrals (from spec §12, not gaps):** per-weapon attack/damage math (Combat uses a generic prof+STR attack and a d20 roll for now), a shared roll log, and WS auth remain out of scope.

## Out of scope (later phases)

- The builder (Phase 3) and progression/multiclass (Phase 4).
- Shared/persisted roll log; per-weapon attack/damage; tighter WebSocket auth.
