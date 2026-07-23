# Character Progression & Multiclass (Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the level-1 builder's Class step into an ordered level log with multiclassing, per-level HP/ASI-or-feat/archetype decisions, and play-HP that tracks level changes.

**Architecture:** All rules live in pure unit-tested modules (`lib/buildState.ts`, `lib/multiclass.ts`, `lib/validation.ts`); components stay dumb and dispatch typed actions through the existing `useBuilder` hook (no hook changes). The Phase 1 engine (`computeSheet`) already derives everything downstream of `levels[]`; this phase only grows the actions that edit `levels[]` and the UI that drives them.

**Tech Stack:** Bun workspace, React 19 (`ref`-as-prop pattern for `ReferenceData`), Vite 7, Tailwind v4 container queries, `bun test`.

**Spec:** `docs/superpowers/specs/2026-07-22-character-progression-design.md`

**Branch:** `swdnd-progression` (already cut from main; work directly on it).

**Repo facts the engineer must know:**
- Run tests from repo root: `bun test` (or scope: `bun test apps/swdnd/src/lib/buildState.test.ts`).
- Frontend build check: `cd apps/swdnd && bun run build` (do NOT use `bun --cwd` — unreliable here). `*.test.ts` files are excluded from `tsc` and `bun test` does not typecheck, so test fixtures may omit fields — production code must therefore guard new `RefClass`/`RefArchetype` fields with `?? []` / `?? ''` when reading them.
- Commit after each task with a `feat(swdnd):`/`test(swdnd):` prefix.
- The Holoterminal utility classes available in components: `.ht-panel .ht-glow .ht-step .ht-label .ht-name .ht-tile-active`, colors `text-ht-text / text-ht-muted / text-ht-bright / text-ht-accent`, border `border-ht-line`.

---

### Task 1: Reference types & mappers — `identifier`, `asiLevels`, `classIdentifier`, archetype description

**Files:**
- Modify: `apps/swdnd/src/lib/rules/types.ts` (RefClass, RefArchetype)
- Modify: `apps/swdnd/src/lib/characters.ts` (`mapClassRow`, `mapArchetypeRow`)
- Test: `apps/swdnd/src/lib/characters.test.ts` (append)

Foundry class docs carry `system.identifier` (slug like `'fighter'`) and an `advancement` array whose `AbilityScoreImprovement` entries have a `level` field. Archetype docs carry `system.classIdentifier` matching the class's `identifier` (NOT our row ids), plus a normal `system.description.value`.

- [ ] **Step 1: Write the failing tests** — append to `apps/swdnd/src/lib/characters.test.ts`:

```ts
test('mapClassRow exposes identifier and sorted asiLevels from advancement', () => {
  const row = {
    id: 'c1', name: 'Fighter',
    raw_json: JSON.stringify({ system: {
      identifier: 'fighter', hitDice: 'd10', saves: ['str', 'con'],
      advancement: [
        { type: 'AbilityScoreImprovement', level: 19 },
        { type: 'HitPoints' },
        { type: 'AbilityScoreImprovement', level: 4 },
        { type: 'AbilityScoreImprovement', level: 6 },
      ],
    } }),
  };
  expect(mapClassRow(row)).toMatchObject({ identifier: 'fighter', asiLevels: [4, 6, 19] });
});

test('mapClassRow defaults identifier/asiLevels when data is missing', () => {
  const row = { id: 'c2', name: 'Mystery', raw_json: JSON.stringify({ system: {} }) };
  expect(mapClassRow(row)).toMatchObject({ identifier: '', asiLevels: [] });
});

test('mapArchetypeRow exposes classIdentifier and description', () => {
  const row = {
    id: 'a1', name: 'Sage Pursuant',
    raw_json: JSON.stringify({ system: {
      classIdentifier: 'consular',
      description: { value: '<p>A sage.</p>' },
    } }),
  };
  expect(mapArchetypeRow(row)).toMatchObject({ classIdentifier: 'consular', description: 'A sage.' });
});
```

(`mapClassRow`/`mapArchetypeRow` are already imported at the top of this test file.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test apps/swdnd/src/lib/characters.test.ts`
Expected: the three new tests FAIL (`identifier`/`asiLevels`/`classIdentifier` undefined).

- [ ] **Step 3: Extend the types** — in `apps/swdnd/src/lib/rules/types.ts`, add to `RefClass` (after `superiorityProgression`):

```ts
  /** sw5e slug (system.identifier, e.g. 'fighter') linking archetypes to classes. */
  identifier: string;
  /** CLASS levels that grant an ASI (from advancement), e.g. [4, 6, 8, 12, 14, 16, 19]. */
  asiLevels: number[];
```

and to `RefArchetype` (after `superiorityProgression`):

```ts
  /** Matches RefClass.identifier of the parent class (system.classIdentifier). */
  classIdentifier: string;
  description: string;
```

- [ ] **Step 4: Extend the mappers** — in `apps/swdnd/src/lib/characters.ts`, inside `mapClassRow` before the `return`, add:

```ts
  const adv = Array.isArray(s.advancement) ? s.advancement : [];
  const asiLevels = adv
    .filter((a: any) => a?.type === 'AbilityScoreImprovement')
    .map((a: any) => Number(a.level))
    .filter((n: number) => Number.isFinite(n) && n > 0)
    .sort((x: number, y: number) => x - y);
```

and add to the returned object:

```ts
    identifier: typeof s.identifier === 'string' ? s.identifier : '',
    asiLevels,
```

In `mapArchetypeRow`, add to the returned object:

```ts
    classIdentifier: typeof s.classIdentifier === 'string' ? s.classIdentifier : '',
    description: descriptionOf(s),
```

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test apps/swdnd/src/lib/characters.test.ts` → PASS.
Run: `bun test` (root) → all pass (old fixtures lack the new fields but tests aren't typechecked; nothing reads them yet).
Run: `cd apps/swdnd && bun run build` → clean.

- [ ] **Step 6: Commit**

```bash
git add apps/swdnd/src/lib/rules/types.ts apps/swdnd/src/lib/characters.ts apps/swdnd/src/lib/characters.test.ts
git commit -m "feat(swdnd): map class identifier/asiLevels and archetype classIdentifier"
```

---

### Task 2: `MULTICLASS_PRIMARY` constant + `multiclassBlockers`

**Files:**
- Modify: `apps/swdnd/src/lib/rules/constants.ts` (append)
- Create: `apps/swdnd/src/lib/multiclass.ts`
- Test: `apps/swdnd/src/lib/multiclass.test.ts`

- [ ] **Step 1: Write the failing tests** — create `apps/swdnd/src/lib/multiclass.test.ts`:

```ts
// apps/swdnd/src/lib/multiclass.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild, type ReferenceData, type RefClass } from './rules/types';
import { multiclassBlockers } from './multiclass';

const fighter: RefClass = {
  id: 'fighter', name: 'Fighter', identifier: 'fighter', hitDie: 10, saves: ['str', 'con'],
  skillChoices: [], skillNumber: 2, asiLevels: [4, 6, 8, 12, 14, 16, 19],
  powercasting: { force: 'none', tech: 'none' }, superiorityProgression: 1, description: '',
};
const consular: RefClass = {
  id: 'consular', name: 'Consular', identifier: 'consular', hitDie: 6, saves: ['wis', 'cha'],
  skillChoices: [], skillNumber: 2, asiLevels: [4, 8, 12, 16, 19],
  powercasting: { force: 'full', tech: 'none' }, superiorityProgression: 0, description: '',
};
const mystery: RefClass = { ...fighter, id: 'mystery', name: 'Mystery', identifier: 'not-in-table' };
const ref = {
  classes: { fighter, consular, mystery },
  archetypes: {}, species: {}, armor: {}, weapons: {}, powers: {}, backgrounds: {}, feats: {}, maneuvers: {}, gear: {},
} as unknown as ReferenceData;

const withLevels = (classIds: string[], base: Partial<Record<'str' | 'wis', number>>) => {
  const b = emptyBuild('x');
  Object.assign(b.abilities.base, base);
  b.levels = classIds.map((classId, i) => ({ n: i + 1, classId, archetypeId: null, hp: 'avg' as const, choices: {} }));
  return b;
};

test('first class and same-class levels are always allowed', () => {
  expect(multiclassBlockers(emptyBuild('x'), ref, 'fighter')).toEqual([]);
  expect(multiclassBlockers(withLevels(['fighter'], { str: 8 }), ref, 'fighter')).toEqual([]);
});

test('new class blocked when ITS primary is under 13', () => {
  const b = withLevels(['fighter'], { str: 13, wis: 12 });
  const blockers = multiclassBlockers(b, ref, 'consular');
  expect(blockers).toHaveLength(1);
  expect(blockers[0]).toBe('Consular needs WIS 13 — you have 12');
});

test('new class blocked when an EXISTING class primary is under 13', () => {
  const b = withLevels(['fighter'], { str: 12, wis: 18 });
  expect(multiclassBlockers(b, ref, 'consular')).toEqual(['Fighter needs STR 13 — you have 12']);
});

test('both sides at 13+ pass; increases count toward the score', () => {
  const b = withLevels(['fighter'], { str: 12, wis: 13 });
  b.abilities.increases.push({ source: 'species', ref: 'sp', ability: 'str', amount: 1 });
  expect(multiclassBlockers(b, ref, 'consular')).toEqual([]);
});

test('unknown identifier fails open (no blocker)', () => {
  const b = withLevels(['fighter'], { str: 13 });
  expect(multiclassBlockers(b, ref, 'mystery')).toEqual([]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test apps/swdnd/src/lib/multiclass.test.ts`
Expected: FAIL — `multiclass.ts` doesn't exist.

- [ ] **Step 3: Add the constant** — append to `apps/swdnd/src/lib/rules/constants.ts`:

```ts
/**
 * Multiclass primary abilities keyed by class identifier slug (RefClass.identifier).
 * Source: sw5eapi.azurewebsites.net/api/class → primaryAbility (pinned 2026-07-22;
 * sw5e.com's PHB pages were down — re-verify the either-of-two-abilities nuance
 * when the site recovers; the 'class' house-rule unlock covers any discrepancy).
 */
export const MULTICLASS_PRIMARY: Record<string, AbilityKey> = {
  berserker: 'str', consular: 'wis', engineer: 'int', fighter: 'str', guardian: 'str',
  monk: 'dex', operative: 'dex', scholar: 'int', scout: 'dex', sentinel: 'dex',
};
```

- [ ] **Step 4: Implement the module** — create `apps/swdnd/src/lib/multiclass.ts`:

```ts
// apps/swdnd/src/lib/multiclass.ts
import { MULTICLASS_PRIMARY } from './rules/constants';
import { classesTaken, totalAbilityScores } from './rules/core';
import type { CharacterBuild, ReferenceData } from './rules/types';

/**
 * sw5e multiclass prerequisites: taking a level in a NEW class needs 13+ in the
 * primary ability of the new class AND of every class already taken. Returns
 * human-readable blockers; empty = allowed. First class and same-class levels
 * are always allowed; unknown class data fails open.
 */
export function multiclassBlockers(build: CharacterBuild, ref: ReferenceData, classId: string): string[] {
  const taken = classesTaken(build);
  if (taken.length === 0 || taken.some((t) => t.classId === classId)) return [];
  const scores = totalAbilityScores(build);
  const blockers: string[] = [];
  for (const id of [classId, ...taken.map((t) => t.classId)]) {
    const cls = ref.classes[id];
    const primary = cls ? MULTICLASS_PRIMARY[cls.identifier ?? ''] : undefined;
    if (!primary || scores[primary] >= 13) continue;
    blockers.push(`${cls!.name} needs ${primary.toUpperCase()} 13 — you have ${scores[primary]}`);
  }
  return blockers;
}
```

- [ ] **Step 5: Run tests**

Run: `bun test apps/swdnd/src/lib/multiclass.test.ts` → 5 pass. Then `bun test` → all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/swdnd/src/lib/rules/constants.ts apps/swdnd/src/lib/multiclass.ts apps/swdnd/src/lib/multiclass.test.ts
git commit -m "feat(swdnd): multiclass prerequisite check (MULTICLASS_PRIMARY)"
```

---

### Task 3: buildState — HP-delta rule + `addLevel` / `removeLastLevel` / `setLevelHp`

**Files:**
- Modify: `apps/swdnd/src/lib/buildState.ts`
- Test: `apps/swdnd/src/lib/buildState.test.ts` (append)

The HP rule (spec §2/§6): every action that changes the *shape* of `levels[]` shifts `play.hp` by the `maxHp` delta, clamped to `0…newMax`. Ability-driven max changes (CON increases) move max only — which is why `removeLastLevel` strips the level's `l{n}` increases BEFORE measuring the delta (otherwise remove wouldn't round-trip an add whose ASI raised CON).

- [ ] **Step 1: Write the failing tests** — append to `apps/swdnd/src/lib/buildState.test.ts`. The file's existing `consular` fixture needs the Task 1 fields; ALSO update it in place by adding `identifier: 'consular', asiLevels: [4, 8, 12, 16, 19],` after its `skillNumber: 2,` line, and add a fighter fixture + register it:

```ts
const fighter: RefClass = {
  id: 'fighter', name: 'Fighter', identifier: 'fighter', hitDie: 10, saves: ['str', 'con'],
  skillChoices: [], skillNumber: 2, asiLevels: [4, 6, 8, 12, 14, 16, 19],
  powercasting: { force: 'none', tech: 'none' }, superiorityProgression: 1, description: '',
};
```

(change the ref literal's `classes: { consular }` to `classes: { consular, fighter }`.)

Then append:

```ts
test('addLevel on an empty build sets saves and fills hp to the new max', () => {
  const b = emptyBuild('x');
  b.abilities.base.con = 12; // +1
  const r = applyBuildAction(b, ref, derived, { t: 'addLevel', classId: 'fighter' });
  expect(r.levels).toEqual([{ n: 1, classId: 'fighter', archetypeId: null, hp: 'avg', choices: {} }]);
  expect(r.proficiencies.savingThrows).toEqual(['str', 'con']);
  expect(r.play.hp).toBe(11); // die 10 + con 1
});

test('addLevel appends and bumps current hp by the delta; unknown class is a no-op', () => {
  let b = applyBuildAction(emptyBuild('x'), ref, derived, { t: 'addLevel', classId: 'fighter' });
  b = applyBuildAction(b, ref, derived, { t: 'addLevel', classId: 'fighter' });
  expect(b.levels.map((l) => l.n)).toEqual([1, 2]);
  expect(b.play.hp).toBe(16); // 10 + avg 6
  expect(applyBuildAction(b, ref, derived, { t: 'addLevel', classId: 'nope' }).levels).toHaveLength(2);
});

test('addLevel enforces the multiclass gate unless house-ruled', () => {
  let b = emptyBuild('x');
  b.abilities.base.str = 13; b.abilities.base.wis = 12;
  b = applyBuildAction(b, ref, derived, { t: 'addLevel', classId: 'fighter' });
  expect(applyBuildAction(b, ref, derived, { t: 'addLevel', classId: 'consular' }).levels).toHaveLength(1);
  const unlocked = applyBuildAction(b, ref, derived, { t: 'toggleHouseRule', step: 'class' });
  expect(applyBuildAction(unlocked, ref, derived, { t: 'addLevel', classId: 'consular' }).levels).toHaveLength(2);
});

test('addLevel caps at 20 levels', () => {
  let b = applyBuildAction(emptyBuild('x'), ref, derived, { t: 'addLevel', classId: 'fighter' });
  for (let i = 0; i < 25; i++) b = applyBuildAction(b, ref, derived, { t: 'addLevel', classId: 'fighter' });
  expect(b.levels).toHaveLength(20);
});

test('removeLastLevel pops the entry, resets saves when empty, and lowers hp', () => {
  let b = applyBuildAction(emptyBuild('x'), ref, derived, { t: 'addLevel', classId: 'fighter' });
  b = applyBuildAction(b, ref, derived, { t: 'addLevel', classId: 'fighter' });
  b = applyBuildAction(b, ref, derived, { t: 'removeLastLevel' });
  expect(b.levels).toHaveLength(1);
  expect(b.play.hp).toBe(10);
  b = applyBuildAction(b, ref, derived, { t: 'removeLastLevel' });
  expect(b.levels).toEqual([]);
  expect(b.proficiencies.savingThrows).toEqual([]);
  expect(b.play.hp).toBe(0);
  expect(applyBuildAction(b, ref, derived, { t: 'removeLastLevel' }).levels).toEqual([]); // no-op on empty
});

test('setLevelHp clamps the roll to 1..die, moves hp by the delta, ignores level 1', () => {
  let b = applyBuildAction(emptyBuild('x'), ref, derived, { t: 'addLevel', classId: 'fighter' });
  b = applyBuildAction(b, ref, derived, { t: 'addLevel', classId: 'fighter' });
  // L2 avg 6 → roll 10: +4
  b = applyBuildAction(b, ref, derived, { t: 'setLevelHp', n: 2, hp: 10 });
  expect(b.levels[1].hp).toBe(10);
  expect(b.play.hp).toBe(20);
  b = applyBuildAction(b, ref, derived, { t: 'setLevelHp', n: 2, hp: 99 });
  expect(b.levels[1].hp).toBe(10); // clamped to the die
  b = applyBuildAction(b, ref, derived, { t: 'setLevelHp', n: 2, hp: 'avg' });
  expect(b.play.hp).toBe(16);
  const untouched = applyBuildAction(b, ref, derived, { t: 'setLevelHp', n: 1, hp: 3 });
  expect(untouched.levels[0].hp).toBe('avg'); // level 1 is always max die
});

test('hp delta clamps to 0..newMax (damaged character keeps damage)', () => {
  let b = applyBuildAction(emptyBuild('x'), ref, derived, { t: 'addLevel', classId: 'fighter' });
  b = applyBuildAction(b, ref, derived, { t: 'addLevel', classId: 'fighter' });
  b.play.hp = 2; // took damage
  b = applyBuildAction(b, ref, derived, { t: 'removeLastLevel' });
  expect(b.play.hp).toBe(0); // 2 - 6 clamps at 0
});

test('setClass also fills hp to max on a fresh build', () => {
  const b = applyBuildAction(emptyBuild('x'), ref, derived, { t: 'setClass', classId: 'consular' });
  expect(b.play.hp).toBe(6);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test apps/swdnd/src/lib/buildState.test.ts`
Expected: new tests FAIL (unknown action types fall through the switch and hp never moves).

- [ ] **Step 3: Implement** — in `apps/swdnd/src/lib/buildState.ts`:

Add imports at the top:

```ts
import { maxHp } from './rules/combat';
import { multiclassBlockers } from './multiclass';
```

Add to the `BuildAction` union:

```ts
  | { t: 'addLevel'; classId: string }
  | { t: 'removeLastLevel' }
  | { t: 'setLevelHp'; n: number; hp: 'avg' | number }
```

Add a helper above `applyBuildAction`:

```ts
/** Shift play.hp by the maxHp delta since `before`, clamped to 0..newMax (spec §6). */
function applyHpDelta(b: CharacterBuild, ref: ReferenceData, before: number): void {
  const after = maxHp(b, ref);
  b.play.hp = Math.max(0, Math.min(after, b.play.hp + (after - before)));
}
```

Add the cases (and extend `setClass` with the same delta rule):

```ts
    case 'setClass': {
      const before = maxHp(build, ref);
      b.levels = [{ n: 1, classId: action.classId, archetypeId: null, hp: 'avg', choices: {} }];
      b.proficiencies.savingThrows = [...(ref.classes[action.classId]?.saves ?? [])];
      applyHpDelta(b, ref, before);
      break;
    }

    case 'addLevel': {
      if (b.levels.length >= 20 || !ref.classes[action.classId]) break;
      if (!houseRuled(b, 'class') && multiclassBlockers(b, ref, action.classId).length > 0) break;
      const before = maxHp(build, ref);
      if (b.levels.length === 0) b.proficiencies.savingThrows = [...(ref.classes[action.classId]?.saves ?? [])];
      b.levels.push({ n: b.levels.length + 1, classId: action.classId, archetypeId: null, hp: 'avg', choices: {} });
      applyHpDelta(b, ref, before);
      break;
    }

    case 'removeLastLevel': {
      const last = b.levels[b.levels.length - 1];
      if (!last) break;
      // Ability-driven max changes move max only: strip this level's increases
      // FIRST, then measure only the level's own HP contribution (round-trips addLevel).
      b.abilities.increases = b.abilities.increases.filter((i) => i.ref !== `l${last.n}`);
      const before = maxHp(b, ref);
      b.levels.pop();
      if (b.levels.length === 0) b.proficiencies.savingThrows = [];
      applyHpDelta(b, ref, before);
      break;
    }

    case 'setLevelHp': {
      const entry = b.levels.find((l) => l.n === action.n);
      if (!entry || entry.n === 1) break; // level 1 is always max die (engine rule)
      const die = ref.classes[entry.classId]?.hitDie ?? 6;
      const before = maxHp(build, ref);
      entry.hp = action.hp === 'avg' ? 'avg' : Math.min(Math.max(1, Math.round(action.hp)), die);
      applyHpDelta(b, ref, before);
      break;
    }
```

- [ ] **Step 4: Run tests**

Run: `bun test apps/swdnd/src/lib/buildState.test.ts` → all pass. Then `bun test` → all pass (existing integration tests never read `play.hp` after `setClass`, but if one asserts a full build object, update its expected `play.hp` to the new fill-to-max value).

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/buildState.ts apps/swdnd/src/lib/buildState.test.ts
git commit -m "feat(swdnd): level add/remove/hp actions with play-hp delta tracking"
```

---

### Task 4: buildState — ASI elections, feat slots, archetypes (replaces `setFeat`)

**Files:**
- Modify: `apps/swdnd/src/lib/buildState.ts`
- Modify: `apps/swdnd/src/panels/CharacterSheet/Builder/steps/Feats.tsx` (one dispatch line, keeps tsc green — full slot UI is Task 9)
- Test: `apps/swdnd/src/lib/buildState.test.ts` (append + update the old `setFeat` assertions)

- [ ] **Step 1: Write the failing tests** — append to `apps/swdnd/src/lib/buildState.test.ts`:

```ts
const fighterAt = (levels: number, base: Partial<Record<'str' | 'con', number>> = {}) => {
  let b = emptyBuild('x');
  Object.assign(b.abilities.base, base);
  for (let i = 0; i < levels; i++) b = applyBuildAction(b, ref, derived, { t: 'addLevel', classId: 'fighter' });
  return b;
};

test('setAsiChoice stores the election; switching clears the other grant', () => {
  let b = fighterAt(4);
  b = applyBuildAction(b, ref, derived, { t: 'setAsiChoice', n: 4, choice: 'asi' });
  expect(b.levels[3].choices).toEqual({ asiOrFeat: 'asi' });
  b = applyBuildAction(b, ref, derived, { t: 'allocateAsiPoint', n: 4, ability: 'str', delta: 1 });
  expect(b.abilities.increases).toContainEqual({ source: 'asi', ref: 'l4', ability: 'str', amount: 1 });
  // switch to feat → ASI increases for l4 are wiped
  b = applyBuildAction(b, ref, derived, { t: 'setAsiChoice', n: 4, choice: 'feat' });
  expect(b.abilities.increases.filter((i) => i.ref === 'l4')).toEqual([]);
  b = applyBuildAction(b, ref, derived, { t: 'setFeatForLevel', n: 4, featId: 'f1' });
  expect(b.levels[3].choices).toEqual({ asiOrFeat: 'feat', featId: 'f1' });
  // switch back to asi → feat slot is wiped
  b = applyBuildAction(b, ref, derived, { t: 'setAsiChoice', n: 4, choice: 'asi' });
  expect(b.levels[3].choices).toEqual({ asiOrFeat: 'asi' });
  // clear election entirely
  b = applyBuildAction(b, ref, derived, { t: 'setAsiChoice', n: 4, choice: null });
  expect(b.levels[3].choices).toEqual({});
});

test('allocateAsiPoint: budget of 2, cap 20, requires an asi election, removable', () => {
  let b = fighterAt(4, { str: 18 });
  expect(applyBuildAction(b, ref, derived, { t: 'allocateAsiPoint', n: 4, ability: 'str', delta: 1 })
    .abilities.increases).toEqual([]); // no election yet
  b = applyBuildAction(b, ref, derived, { t: 'setAsiChoice', n: 4, choice: 'asi' });
  b = applyBuildAction(b, ref, derived, { t: 'allocateAsiPoint', n: 4, ability: 'str', delta: 1 });
  b = applyBuildAction(b, ref, derived, { t: 'allocateAsiPoint', n: 4, ability: 'str', delta: 1 }); // str 20
  const capped = applyBuildAction(b, ref, derived, { t: 'allocateAsiPoint', n: 4, ability: 'con', delta: 1 });
  expect(capped.abilities.increases.filter((i) => i.ref === 'l4')).toHaveLength(2); // budget spent
  const over = applyBuildAction(
    applyBuildAction(b, ref, derived, { t: 'allocateAsiPoint', n: 4, ability: 'str', delta: -1 }),
    ref, derived, { t: 'allocateAsiPoint', n: 4, ability: 'str', delta: 1 },
  );
  expect(over.abilities.increases.filter((i) => i.ref === 'l4' && i.ability === 'str')).toHaveLength(2);
  // at str 20, another str point is refused even with budget
  let atCap = fighterAt(4, { str: 20 });
  atCap = applyBuildAction(atCap, ref, derived, { t: 'setAsiChoice', n: 4, choice: 'asi' });
  atCap = applyBuildAction(atCap, ref, derived, { t: 'allocateAsiPoint', n: 4, ability: 'str', delta: 1 });
  expect(atCap.abilities.increases).toEqual([]);
});

test('setFeatForLevel: L1 is always allowed, other levels need a feat election', () => {
  let b = fighterAt(2);
  b = applyBuildAction(b, ref, derived, { t: 'setFeatForLevel', n: 1, featId: 'f1' });
  expect(b.levels[0].choices).toEqual({ featId: 'f1' });
  b = applyBuildAction(b, ref, derived, { t: 'setFeatForLevel', n: 1, featId: null });
  expect(b.levels[0].choices).toEqual({});
  expect(applyBuildAction(b, ref, derived, { t: 'setFeatForLevel', n: 2, featId: 'f1' })
    .levels[1].choices).toEqual({}); // L2 has no feat election
});

test('setArchetype stores on the class 3rd-level entry, gated by classIdentifier', () => {
  let b = fighterAt(3);
  // wrong-class archetype refused while locked
  expect(applyBuildAction(b, ref, derived, { t: 'setArchetype', classId: 'fighter', archetypeId: 'sage' })
    .levels[2].archetypeId).toBeNull();
  b = applyBuildAction(b, ref, derived, { t: 'setArchetype', classId: 'fighter', archetypeId: 'tactician' });
  expect(b.levels.map((l) => l.archetypeId)).toEqual([null, null, 'tactician']);
  // house rule opens cross-class archetypes
  let hr = applyBuildAction(b, ref, derived, { t: 'toggleHouseRule', step: 'class' });
  hr = applyBuildAction(hr, ref, derived, { t: 'setArchetype', classId: 'fighter', archetypeId: 'sage' });
  expect(hr.levels[2].archetypeId).toBe('sage');
  // clearing
  b = applyBuildAction(b, ref, derived, { t: 'setArchetype', classId: 'fighter', archetypeId: null });
  expect(b.levels[2].archetypeId).toBeNull();
  // under 3 class levels → no-op
  const low = fighterAt(2);
  expect(applyBuildAction(low, ref, derived, { t: 'setArchetype', classId: 'fighter', archetypeId: 'tactician' })
    .levels.every((l) => l.archetypeId === null)).toBe(true);
});
```

Add the archetype fixtures next to the class fixtures at the top of the file, and register them in the ref literal (`archetypes: { sage, tactician }`):

```ts
const sage = {
  id: 'sage', name: 'Sage', classIdentifier: 'consular',
  powercasting: { force: 'none', tech: 'none' }, superiorityProgression: 0, description: '',
};
const tactician = {
  id: 'tactician', name: 'Tactician', classIdentifier: 'fighter',
  powercasting: { force: 'none', tech: 'none' }, superiorityProgression: 0, description: '',
};
```

Finally, in the existing `'toggleSkill / setFeat / equipment / credits'` test, replace the line
`b = applyBuildAction(b, ref, derived, { t: 'setFeat', featId: 'f1' });` with
`b = applyBuildAction(b, ref, derived, { t: 'setFeatForLevel', n: 1, featId: 'f1' });`.

- [ ] **Step 2: Run to verify failure**

Run: `bun test apps/swdnd/src/lib/buildState.test.ts`
Expected: new tests FAIL.

- [ ] **Step 3: Implement** — in `apps/swdnd/src/lib/buildState.ts`:

Add `totalAbilityScores` to the imports:

```ts
import { totalAbilityScores } from './rules/core';
```

In the `BuildAction` union, REMOVE `| { t: 'setFeat'; featId: string | null }` and add:

```ts
  | { t: 'setAsiChoice'; n: number; choice: 'asi' | 'feat' | null }
  | { t: 'allocateAsiPoint'; n: number; ability: AbilityKey; delta: 1 | -1 }
  | { t: 'setFeatForLevel'; n: number; featId: string | null }
  | { t: 'setArchetype'; classId: string; archetypeId: string | null }
```

Replace the whole `case 'setFeat'` block with these cases:

```ts
    case 'setAsiChoice': {
      const entry = b.levels.find((l) => l.n === action.n);
      if (!entry) break;
      const prev = entry.choices?.asiOrFeat;
      entry.choices = { ...(entry.choices ?? {}) };
      if (action.choice === null) delete entry.choices.asiOrFeat;
      else entry.choices.asiOrFeat = action.choice;
      // Switching elections clears the other election's grants (spec §2).
      if (prev === 'asi' && action.choice !== 'asi') {
        b.abilities.increases = b.abilities.increases.filter((i) => i.ref !== `l${action.n}`);
      }
      if (prev === 'feat' && action.choice !== 'feat') delete entry.choices.featId;
      break;
    }

    case 'allocateAsiPoint': {
      const entry = b.levels.find((l) => l.n === action.n);
      if (entry?.choices?.asiOrFeat !== 'asi') break;
      const asiRef = `l${action.n}`;
      if (action.delta === -1) {
        const idx = b.abilities.increases.findIndex((i) => i.ref === asiRef && i.ability === action.ability);
        if (idx >= 0) b.abilities.increases.splice(idx, 1);
        break;
      }
      const spent = b.abilities.increases.filter((i) => i.ref === asiRef).reduce((s, i) => s + i.amount, 0);
      if (spent >= 2) break;                                    // ASI budget is 2 points
      if (totalAbilityScores(b)[action.ability] >= 20) break;   // sw5e hard cap
      b.abilities.increases.push({ source: 'asi', ref: asiRef, ability: action.ability, amount: 1 });
      break;
    }

    case 'setFeatForLevel': {
      const entry = b.levels.find((l) => l.n === action.n);
      if (!entry) break;
      // L1's feat is the optional Phase 3 slot; other levels need a 'feat' election.
      if (action.n !== 1 && entry.choices?.asiOrFeat !== 'feat') break;
      entry.choices = { ...(entry.choices ?? {}) };
      if (action.featId == null) delete entry.choices.featId;
      else entry.choices.featId = action.featId;
      break;
    }

    case 'setArchetype': {
      // The archetype lives on the entry where the class reaches level 3
      // (the engine's classesTaken reads the first non-null per class).
      let classLevel = 0;
      let target: (typeof b.levels)[number] | undefined;
      for (const l of b.levels) {
        if (l.classId !== action.classId) continue;
        classLevel += 1;
        if (classLevel === 3) { target = l; break; }
      }
      if (!target) break;
      if (action.archetypeId != null) {
        const arch = ref.archetypes[action.archetypeId];
        if (!arch) break;
        if (!houseRuled(b, 'class') && arch.classIdentifier !== ref.classes[action.classId]?.identifier) break;
      }
      for (const l of b.levels) if (l.classId === action.classId) l.archetypeId = null;
      target.archetypeId = action.archetypeId;
      break;
    }
```

- [ ] **Step 4: Fix the one component call site** — in `apps/swdnd/src/panels/CharacterSheet/Builder/steps/Feats.tsx`, change the `onSelect` line:

```tsx
      onSelect={(f) => dispatch({ t: 'setFeatForLevel', n: 1, featId: f.id === chosen ? null : f.id })}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test` → all pass (fix any other `setFeat` usages the compiler/tests surface the same way).
Run: `cd apps/swdnd && bun run build` → clean (proves no `setFeat` references remain).

- [ ] **Step 6: Commit**

```bash
git add apps/swdnd/src/lib/buildState.ts apps/swdnd/src/lib/buildState.test.ts apps/swdnd/src/panels/CharacterSheet/Builder/steps/Feats.tsx
git commit -m "feat(swdnd): ASI elections, per-level feat slots, archetype selection"
```

---

### Task 5: validation — level-log obligations + feat slots

**Files:**
- Modify: `apps/swdnd/src/lib/validation.ts`
- Test: `apps/swdnd/src/lib/validation.test.ts` (append; extend fixtures like Task 3/4 did — the file has its own `RefClass` fixtures that need `identifier`/`asiLevels` added, e.g. `asiLevels: [4, 8, 12, 16, 19]` for a consular-like class and an archetype fixture with `classIdentifier`)

Class step rules (spec §4): `✓` when every row's obligations are met; `!` with the FIRST problem as the summary. Obligations per row: ASI rows (the entry's class-level ordinal is in that class's `asiLevels`) need an election, and an 'asi' election needs both points spent (`L4 ASI · 1 pt left`); a class at 3+ levels without an archetype is `attention` (`<Class> archetype pending`). A 'feat' election's empty slot flags the FEATS step, not the class step. Done-summary: `Consular 4 / Fighter 1` style.

Feats step (spec §5): slots are the entries with a 'feat' election; any empty slot → `attention` (`1 slot empty`); otherwise `done` with a feat count, or the L1 pick's name / `optional` as today.

- [ ] **Step 1: Write the failing tests** — append to `apps/swdnd/src/lib/validation.test.ts` (adapt fixture names to the file's existing ones; the pattern below assumes a `ref` with a class whose id is `consular`, `asiLevels: [4, 8, 12, 16, 19]`, `identifier: 'consular'`, and an archetype `sage` with `classIdentifier: 'consular'`; build levels with a helper or inline arrays):

```ts
const levelsOf = (classId: string, count: number) =>
  Array.from({ length: count }, (_, i) => ({ n: i + 1, classId, archetypeId: null as string | null, hp: 'avg' as const, choices: {} as Record<string, unknown> }));

test('class step: ASI row without an election flags attention', () => {
  const b = emptyBuild('x');
  b.levels = levelsOf('consular', 4);
  b.levels[2].archetypeId = 'sage';
  const s = stepStatus(b, ref, computeSheet(b, ref));
  expect(s.class.state).toBe('attention');
  expect(s.class.summary).toBe('L4 ASI/feat pending');
});

test('class step: half-spent ASI reports points left; fully spent + archetype is done', () => {
  const b = emptyBuild('x');
  b.levels = levelsOf('consular', 4);
  b.levels[2].archetypeId = 'sage';
  b.levels[3].choices = { asiOrFeat: 'asi' };
  b.abilities.increases.push({ source: 'asi', ref: 'l4', ability: 'wis', amount: 1 });
  let s = stepStatus(b, ref, computeSheet(b, ref));
  expect(s.class.state).toBe('attention');
  expect(s.class.summary).toBe('L4 ASI · 1 pt left');
  b.abilities.increases.push({ source: 'asi', ref: 'l4', ability: 'wis', amount: 1 });
  s = stepStatus(b, ref, computeSheet(b, ref));
  expect(s.class.state).toBe('done');
  expect(s.class.summary).toBe('Consular 4');
});

test('class step: 3+ levels without an archetype is attention', () => {
  const b = emptyBuild('x');
  b.levels = levelsOf('consular', 3);
  const s = stepStatus(b, ref, computeSheet(b, ref));
  expect(s.class.state).toBe('attention');
  expect(s.class.summary).toBe('Consular archetype pending');
});

test('class step: feat election satisfies the row (slot emptiness is the feats step)', () => {
  const b = emptyBuild('x');
  b.levels = levelsOf('consular', 4);
  b.levels[2].archetypeId = 'sage';
  b.levels[3].choices = { asiOrFeat: 'feat' };
  const d = computeSheet(b, ref);
  const s = stepStatus(b, ref, d);
  expect(s.class.state).toBe('done');
  expect(s.feats.state).toBe('attention');
  expect(s.feats.summary).toBe('1 slot empty');
  b.levels[3].choices = { asiOrFeat: 'feat', featId: 'f1' };
  const s2 = stepStatus(b, ref, computeSheet(b, ref));
  expect(s2.feats.state).toBe('done');
  expect(s2.feats.summary).toBe('1 feat');
});

test('feats step unchanged for a pure L1 build', () => {
  const b = emptyBuild('x');
  b.levels = levelsOf('consular', 1);
  expect(stepStatus(b, ref, computeSheet(b, ref)).feats).toMatchObject({ state: 'done', summary: 'optional' });
});
```

(If the file computes `derived` differently — e.g. a shared mock — follow its existing pattern instead of `computeSheet`, but the assertions stay identical. `computeSheet` is exported from `./rules`.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test apps/swdnd/src/lib/validation.test.ts`
Expected: new tests FAIL (class step reports plain class name; feats step reports `optional`).

- [ ] **Step 3: Implement** — in `apps/swdnd/src/lib/validation.ts`:

Add the import:

```ts
import { classesTaken } from './rules/core';
```

Replace the two lines computing `classInfo` (the `const classId … const classInfo …` block) with:

```ts
  const classId = build.levels[0]?.classId;
  const cls = classId ? ref.classes[classId] : undefined;
  const taken = classesTaken(build);
  let classInfo: StepInfo;
  if (build.levels.length === 0) classInfo = info('untouched', '—');
  else {
    const problems: string[] = [];
    const ordinals = new Map<string, number>();
    for (const lvl of build.levels) {
      const classLevel = (ordinals.get(lvl.classId) ?? 0) + 1;
      ordinals.set(lvl.classId, classLevel);
      if (!(ref.classes[lvl.classId]?.asiLevels ?? []).includes(classLevel)) continue;
      const choice = lvl.choices?.asiOrFeat;
      if (choice === 'asi') {
        const spent = build.abilities.increases
          .filter((i) => i.ref === `l${lvl.n}`)
          .reduce((s, i) => s + i.amount, 0);
        if (spent < 2) problems.push(`L${lvl.n} ASI · ${2 - spent} pt${2 - spent === 1 ? '' : 's'} left`);
      } else if (choice !== 'feat') {
        problems.push(`L${lvl.n} ASI/feat pending`);
      }
    }
    for (const t of taken) {
      if (t.levels >= 3 && !t.archetypeId) {
        problems.push(`${ref.classes[t.classId]?.name ?? t.classId} archetype pending`);
      }
    }
    const summary = taken.map((t) => `${ref.classes[t.classId]?.name ?? t.classId} ${t.levels}`).join(' / ');
    classInfo = problems.length ? info('attention', problems[0]) : info('done', summary);
  }
```

(`cls` must stay defined — the skills-step block below it reads `cls?.skillNumber`.)

Replace the two `featId`/`featsInfo` lines with:

```ts
  const featSlots = build.levels.filter((l) => l.n !== 1 && l.choices?.asiOrFeat === 'feat');
  const emptySlots = featSlots.filter((l) => !l.choices?.featId).length;
  const l1FeatId = build.levels[0]?.choices?.featId as string | undefined;
  const featsInfo = emptySlots > 0
    ? info('attention', `${emptySlots} slot${emptySlots === 1 ? '' : 's'} empty`)
    : featSlots.length > 0
      ? info('done', `${featSlots.length + (l1FeatId ? 1 : 0)} feat${featSlots.length + (l1FeatId ? 1 : 0) === 1 ? '' : 's'}`)
      : info('done', l1FeatId ? (ref.feats[l1FeatId]?.name ?? String(l1FeatId)) : 'optional');
```

- [ ] **Step 4: Run tests**

Run: `bun test apps/swdnd/src/lib/validation.test.ts` → pass. Then `bun test` → all pass. NOTE: existing tests asserting the class summary equals the bare class name (e.g. `'Consular'`) now get `'Consular 1'` — update those expectations; that's the intended new format. Also check `PlayerHome`'s steps-done counting still compiles (it only reads `state`/`applicable` — unaffected).

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/validation.ts apps/swdnd/src/lib/validation.test.ts
git commit -m "feat(swdnd): level-log and feat-slot validation"
```

---

### Task 6: Progression integration tests

**Files:**
- Create: `apps/swdnd/src/lib/progression.integration.test.ts`

Pure-module end-to-end per spec §8 — no components. Complete file:

- [ ] **Step 1: Write the integration tests**

```ts
// apps/swdnd/src/lib/progression.integration.test.ts
// Spec §8: (a) Consular 1→5 with archetype+ASI, (b) multiclass gate + derived,
// (c) remove-last-level round-trip.
import { test, expect } from 'bun:test';
import { emptyBuild, type CharacterBuild, type ReferenceData, type RefClass } from './rules/types';
import { computeSheet } from './rules';
import { applyBuildAction, type BuildAction } from './buildState';
import { stepStatus } from './validation';

const consular: RefClass = {
  id: 'consular', name: 'Consular', identifier: 'consular', hitDie: 6, saves: ['wis', 'cha'],
  skillChoices: ['ins', 'lor'], skillNumber: 2, asiLevels: [4, 8, 12, 16, 19],
  powercasting: { force: 'full', tech: 'none' }, superiorityProgression: 0, description: '',
};
const fighter: RefClass = {
  id: 'fighter', name: 'Fighter', identifier: 'fighter', hitDie: 10, saves: ['str', 'con'],
  skillChoices: ['ath'], skillNumber: 2, asiLevels: [4, 6, 8, 12, 14, 16, 19],
  powercasting: { force: 'none', tech: 'none' }, superiorityProgression: 1, description: '',
};
const sage = {
  id: 'sage', name: 'Sage', classIdentifier: 'consular',
  powercasting: { force: 'none', tech: 'none' }, superiorityProgression: 0, description: '',
};
const ref = {
  classes: { consular, fighter }, archetypes: { sage },
  species: {}, armor: {}, weapons: {}, powers: {}, backgrounds: {}, feats: {}, maneuvers: {}, gear: {},
} as unknown as ReferenceData;

/** Mirror useBuilder: recompute derived before every action. */
const step = (b: CharacterBuild, action: BuildAction) =>
  applyBuildAction(b, ref, computeSheet(b, ref), action);

test('(a) Consular 1→5: hp fills and tracks, archetype at 3, ASI at 4, engine numbers', () => {
  let b = emptyBuild('Lyra');
  b.identity.alignment = 'light';
  b.abilities.base.wis = 15; // → 17 after the ASI
  b.abilities.base.con = 12; // +1 per level

  b = step(b, { t: 'addLevel', classId: 'consular' });
  expect(computeSheet(b, ref).maxHp).toBe(7); // die 6 + con 1
  expect(b.play.hp).toBe(7);                  // first pick fills to max
  expect(b.proficiencies.savingThrows).toEqual(['wis', 'cha']);

  for (let i = 0; i < 4; i++) b = step(b, { t: 'addLevel', classId: 'consular' });
  expect(computeSheet(b, ref).maxHp).toBe(27); // 7 + 4×(4+1)
  expect(b.play.hp).toBe(27);

  expect(stepStatus(b, ref, computeSheet(b, ref)).class.state).toBe('attention'); // archetype + ASI pending
  b = step(b, { t: 'setArchetype', classId: 'consular', archetypeId: 'sage' });
  expect(b.levels[2].archetypeId).toBe('sage');

  b = step(b, { t: 'setAsiChoice', n: 4, choice: 'asi' });
  b = step(b, { t: 'allocateAsiPoint', n: 4, ability: 'wis', delta: 1 });
  b = step(b, { t: 'allocateAsiPoint', n: 4, ability: 'wis', delta: 1 });

  const d = computeSheet(b, ref);
  expect(d.abilities.wis.score).toBe(17);
  expect(b.play.hp).toBe(27);                // WIS ASI never moves current hp
  expect(d.casting.force.casterLevel).toBe(5);
  expect(d.casting.force.maxPowerLevel).toBe(3);
  expect(d.casting.force.knownMax).toBe(17);
  expect(d.casting.force.saveDc).toBe(8 + 3 + 3); // prof 3 + wis 3
  const s = stepStatus(b, ref, d);
  expect(s.class.state).toBe('done');
  expect(s.class.summary).toBe('Consular 5');
});

test('(b) Consular 4 / Fighter 1: prereq path, then derived matches Phase 1 casting', () => {
  let b = emptyBuild('Brakk');
  b.identity.alignment = 'light';
  b.abilities.base.str = 13;
  b.abilities.base.wis = 12;
  b = step(b, { t: 'addLevel', classId: 'fighter' });
  // wis 12 blocks the consular dip
  expect(step(b, { t: 'addLevel', classId: 'consular' }).levels).toHaveLength(1);
  // ...and str 12 on the EXISTING side blocks too
  let c = emptyBuild('y');
  c.abilities.base.str = 12; c.abilities.base.wis = 18;
  c = step(c, { t: 'addLevel', classId: 'fighter' });
  expect(step(c, { t: 'addLevel', classId: 'consular' }).levels).toHaveLength(1);
  // house rule bypasses
  const hr = step(step(b, { t: 'toggleHouseRule', step: 'class' }), { t: 'addLevel', classId: 'consular' });
  expect(hr.levels).toHaveLength(2);
  // legit path: wis 14 → build Fighter 1 / Consular 4
  b = step(b, { t: 'setBaseAbilities', base: { ...b.abilities.base, wis: 14 } });
  for (let i = 0; i < 4; i++) b = step(b, { t: 'addLevel', classId: 'consular' });
  const d = computeSheet(b, ref);
  expect(d.totalLevel).toBe(5);
  // multiclass caster level: consular full weight 1 × 4 levels → full[4] = power level 2
  expect(d.casting.force.casterLevel).toBe(4);
  expect(d.casting.force.maxPowerLevel).toBe(2);
  expect(d.superiority?.die).toBe('d4'); // fighter 1
  // consular's 4th class level (entry n=5) is an ASI level → election pending first
  expect(stepStatus(b, ref, d).class.summary).toBe('L5 ASI/feat pending');
  b = step(b, { t: 'setAsiChoice', n: 5, choice: 'feat' });
  b = step(b, { t: 'setArchetype', classId: 'consular', archetypeId: 'sage' });
  expect(stepStatus(b, ref, computeSheet(b, ref)).class.summary).toBe('Fighter 1 / Consular 4');
});

test('(c) removeLastLevel round-trips an add + ASI decisions exactly', () => {
  let b = emptyBuild('rt');
  b.abilities.base.con = 14;
  for (let i = 0; i < 3; i++) b = step(b, { t: 'addLevel', classId: 'fighter' });
  const before = JSON.parse(JSON.stringify(b));

  let c = step(b, { t: 'addLevel', classId: 'fighter' }); // L4 = fighter ASI level
  c = step(c, { t: 'setAsiChoice', n: 4, choice: 'asi' });
  c = step(c, { t: 'allocateAsiPoint', n: 4, ability: 'con', delta: 1 });
  c = step(c, { t: 'allocateAsiPoint', n: 4, ability: 'con', delta: 1 }); // con 16 — max moves, hp doesn't
  expect(c.play.hp).toBe(before.play.hp + 8); // the level's own avg(6)+con(2)

  c = step(c, { t: 'removeLastLevel' });
  expect(JSON.parse(JSON.stringify(c))).toEqual(before);
});
```

- [ ] **Step 2: Run**

Run: `bun test apps/swdnd/src/lib/progression.integration.test.ts`
Expected: 3 pass (all pure modules landed in Tasks 1–5). If (c) fails on `play.hp`, the `removeLastLevel` strip-increases-first ordering from Task 3 is broken — fix THAT, not the test.

- [ ] **Step 3: Full suite**

Run: `bun test` → all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/swdnd/src/lib/progression.integration.test.ts
git commit -m "test(swdnd): progression integration coverage (level-up, multiclass, round-trip)"
```

---

### Task 7: StepTable — disabled rows

**Files:**
- Modify: `apps/swdnd/src/panels/CharacterSheet/Builder/StepTable.tsx`

Component-only (verified by `tsc`/build; behavior verified in the Task 11 walkthrough). Rows with a disabled reason render dimmed, show the reason in the expanded pane, and hide the select action.

- [ ] **Step 1: Implement** — in `StepTable.tsx`:

Add to `Props<T>` (after `selectLabel`):

```ts
  /** Non-null → row is dimmed, reason shown in the detail pane, selection hidden. */
  disabledReason?: (item: T) => string | null;
```

Destructure `disabledReason` in the component signature. In the row map, compute the reason and apply it:

```tsx
        {visible.map((item) => {
          const id = idOf(item);
          const selected = isSelected(item);
          const open = expanded === id;
          const reason = disabledReason?.(item) ?? null;
          return (
            <div key={id} className={`${selected || open ? 'ht-glow' : 'ht-panel'}${reason ? ' opacity-60' : ''}`}>
```

and in the expanded pane, replace the `{editable && (` block with:

```tsx
                  {reason && <div className="mt-1 text-yellow-300">⚠ {reason}</div>}
                  {editable && !reason && (
                    <div className="mt-2 text-right">
                      <button type="button" className="ht-step" onClick={() => onSelect(item)}>
                        {selectLabel ? selectLabel(item) : selected ? '✕ remove' : '✓ select'}
                      </button>
                    </div>
                  )}
```

- [ ] **Step 2: Verify build**

Run: `cd apps/swdnd && bun run build` → clean. `bun test` → still green.

- [ ] **Step 3: Commit**

```bash
git add apps/swdnd/src/panels/CharacterSheet/Builder/StepTable.tsx
git commit -m "feat(swdnd): StepTable disabled rows with reason"
```

---

### Task 8: Class step → level log + Builder shell strip

**Files:**
- Rewrite: `apps/swdnd/src/panels/CharacterSheet/Builder/steps/Class.tsx`
- Modify: `apps/swdnd/src/panels/CharacterSheet/Builder/index.tsx` (strip text only — the new ClassStep keeps the same `build/ref/editable/dispatch` props; `multiclassBlockers` reads scores from the build, so no `derived` prop is needed)

- [ ] **Step 1: Rewrite `Class.tsx`** — complete file:

```tsx
// apps/swdnd/src/panels/CharacterSheet/Builder/steps/Class.tsx
import { useState } from 'react';
import type { BuildAction } from '../../../../lib/buildState';
import { multiclassBlockers } from '../../../../lib/multiclass';
import { ABILITIES } from '../../../../lib/rules/constants';
import { classesTaken } from '../../../../lib/rules/core';
import type {
  CharacterBuild, LevelEntry, ReferenceData, RefClass,
} from '../../../../lib/rules/types';
import StepTable from '../StepTable';

const casting = (c: RefClass): string => {
  const parts: string[] = [];
  if (c.powercasting.force !== 'none') parts.push(`Force (${c.powercasting.force})`);
  if (c.powercasting.tech !== 'none') parts.push(`Tech (${c.powercasting.tech})`);
  return parts.join(' · ') || '—';
};

interface Props {
  build: CharacterBuild;
  ref: ReferenceData;
  editable: boolean;
  dispatch: (a: BuildAction) => void;
}

/** The entry's ordinal within its own class (Consular 1, 2, … regardless of interleaving). */
function classLevelOf(build: CharacterBuild, entry: LevelEntry): number {
  let count = 0;
  for (const l of build.levels) {
    if (l.classId === entry.classId) count += 1;
    if (l.n === entry.n) break;
  }
  return count;
}

function HpControl({ entry, die, editable, dispatch }: {
  entry: LevelEntry; die: number; editable: boolean; dispatch: (a: BuildAction) => void;
}) {
  const [editing, setEditing] = useState(false);
  const avg = Math.floor(die / 2) + 1;
  if (entry.n === 1) return <span className="text-ht-muted">hp max ({die})</span>;
  if (editing) {
    return (
      <input
        autoFocus type="number" min={1} max={die}
        defaultValue={entry.hp === 'avg' ? avg : entry.hp}
        className="w-12 border-b border-ht-line bg-transparent text-center text-ht-bright outline-none"
        onBlur={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) dispatch({ t: 'setLevelHp', n: entry.n, hp: v });
          setEditing(false);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    );
  }
  return (
    <span className="flex items-center gap-1">
      <button type="button" disabled={!editable}
        className={entry.hp === 'avg' ? 'ht-step' : 'text-ht-muted'}
        onClick={() => dispatch({ t: 'setLevelHp', n: entry.n, hp: 'avg' })}>
        avg {avg}
      </button>
      <button type="button" disabled={!editable}
        className={entry.hp === 'avg' ? 'text-ht-muted' : 'ht-step'}
        onClick={() => setEditing(true)}>
        {entry.hp === 'avg' ? 'roll…' : `roll ${entry.hp}`}
      </button>
    </span>
  );
}

function AsiRow({ build, ref, entry, editable, dispatch }: {
  build: CharacterBuild; ref: ReferenceData; entry: LevelEntry;
  editable: boolean; dispatch: (a: BuildAction) => void;
}) {
  const asiRef = `l${entry.n}`;
  const allocated = build.abilities.increases.filter((i) => i.ref === asiRef);
  const spent = allocated.reduce((s, i) => s + i.amount, 0);
  const choice = entry.choices?.asiOrFeat as 'asi' | 'feat' | undefined;
  const featId = entry.choices?.featId as string | undefined;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
      <span className="ht-label">ASI level</span>
      <button type="button" disabled={!editable}
        className={`ht-step ${choice === 'asi' ? 'ht-tile-active' : ''}`}
        onClick={() => dispatch({ t: 'setAsiChoice', n: entry.n, choice: choice === 'asi' ? null : 'asi' })}>
        +2 ability points
      </button>
      <button type="button" disabled={!editable}
        className={`ht-step ${choice === 'feat' ? 'ht-tile-active' : ''}`}
        onClick={() => dispatch({ t: 'setAsiChoice', n: entry.n, choice: choice === 'feat' ? null : 'feat' })}>
        take a feat
      </button>
      {choice === 'asi' && (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className={spent < 2 ? 'text-yellow-300' : 'text-ht-muted'}>
            {2 - spent} pt{2 - spent === 1 ? '' : 's'} left
          </span>
          {ABILITIES.map((a) => {
            const pts = allocated.filter((i) => i.ability === a).reduce((s, i) => s + i.amount, 0);
            return (
              <span key={a} className="flex items-center gap-0.5">
                <span className={pts > 0 ? 'text-ht-bright' : 'text-ht-muted'}>
                  {a.toUpperCase()}{pts > 0 ? ` +${pts}` : ''}
                </span>
                {editable && (
                  <>
                    <button type="button" className="ht-step px-1"
                      onClick={() => dispatch({ t: 'allocateAsiPoint', n: entry.n, ability: a, delta: 1 })}>+</button>
                    <button type="button" className="ht-step px-1"
                      onClick={() => dispatch({ t: 'allocateAsiPoint', n: entry.n, ability: a, delta: -1 })}>−</button>
                  </>
                )}
              </span>
            );
          })}
        </span>
      )}
      {choice === 'feat' && (
        <span className={featId ? 'text-ht-muted' : 'text-yellow-300'}>
          {featId ? `feat: ${ref.feats[featId]?.name ?? featId}` : 'pick your feat on the Feats step'}
        </span>
      )}
    </div>
  );
}

export default function ClassStep({ build, ref, editable, dispatch }: Props) {
  // picker: null = level log · 'add' = class table · `arch:<classId>` = archetype table
  const [picker, setPicker] = useState<string | null>(build.levels.length === 0 ? 'add' : null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const houseRuled = (build.houseRuled ?? []).includes('class');
  const taken = classesTaken(build);
  const lastEntry = build.levels[build.levels.length - 1];

  const houseRuleHeader = (
    <div className="ht-panel flex flex-wrap items-center gap-2 p-2 text-[10px] text-ht-muted">
      <span>Multiclassing needs 13+ in the primary ability of both classes.</span>
      <button type="button" className={`ht-step ml-auto ${houseRuled ? 'ht-tile-active' : ''}`}
        onClick={() => dispatch({ t: 'toggleHouseRule', step: 'class' })}>
        ⌂ house rule {houseRuled ? 'on' : 'off'}
      </button>
    </div>
  );

  if (picker === 'add') {
    return (
      <div className="flex flex-col gap-2 text-[11px]">
        {build.levels.length > 0 && (
          <button type="button" className="ht-step self-start" onClick={() => setPicker(null)}>
            ◂ back to level log
          </button>
        )}
        <StepTable
          items={Object.values(ref.classes)}
          columns={[
            { key: 'name', label: 'Name', flex: 1.2, value: (c) => c.name },
            { key: 'die', label: 'Hit Die', flex: 0.6, value: (c) => `d${c.hitDie}` },
            { key: 'casting', label: 'Casting', flex: 1, value: casting },
            { key: 'sup', label: 'Superiority', flex: 0.8, value: (c) => (c.superiorityProgression > 0 ? `${c.superiorityProgression}× prog.` : '—') },
          ]}
          idOf={(c) => c.id}
          searchText={(c) => c.name}
          isSelected={() => false}
          disabledReason={(c) => (houseRuled ? null : (multiclassBlockers(build, ref, c.id)[0] ?? null))}
          onSelect={(c) => { dispatch({ t: 'addLevel', classId: c.id }); setPicker(null); }}
          selectLabel={() => `✓ take level ${build.levels.length + 1}`}
          detail={(c) => [
            `SAVES · ${c.saves.map((s) => s.toUpperCase()).join(', ')}   SKILLS · pick ${c.skillNumber}`,
            c.description || 'No description in the source data.',
          ].join('\n')}
          editable={editable}
          header={houseRuleHeader}
        />
      </div>
    );
  }

  if (picker?.startsWith('arch:')) {
    const classId = picker.slice(5);
    const cls = ref.classes[classId];
    const current = taken.find((t) => t.classId === classId)?.archetypeId ?? null;
    const options = Object.values(ref.archetypes)
      .filter((a) => houseRuled || a.classIdentifier === cls?.identifier);
    return (
      <div className="flex flex-col gap-2 text-[11px]">
        <button type="button" className="ht-step self-start" onClick={() => setPicker(null)}>
          ◂ back to level log
        </button>
        <StepTable
          items={options}
          columns={[{ key: 'name', label: `${cls?.name ?? ''} archetypes`, flex: 1, value: (a) => a.name }]}
          idOf={(a) => a.id}
          searchText={(a) => a.name}
          isSelected={(a) => a.id === current}
          onSelect={(a) => {
            dispatch({ t: 'setArchetype', classId, archetypeId: a.id === current ? null : a.id });
            setPicker(null);
          }}
          selectLabel={(a) => (a.id === current ? '✕ clear archetype' : '✓ choose archetype')}
          detail={(a) => a.description || 'No description in the source data.'}
          editable={editable}
          header={houseRuled ? houseRuleHeader : undefined}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 text-[11px]">
      {houseRuleHeader}
      {taken.map((t) => {
        const cls = ref.classes[t.classId];
        const arch = t.archetypeId ? ref.archetypes[t.archetypeId] : null;
        return (
          <div key={t.classId} className="ht-panel p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-ht-bright">{cls?.name ?? t.classId}</span>
              <span className="text-ht-muted">· {t.levels} level{t.levels === 1 ? '' : 's'} · d{cls?.hitDie ?? '?'}</span>
              {t.levels >= 3 && (
                <button type="button" disabled={!editable}
                  className={`ht-step ml-auto ${arch ? '' : 'text-yellow-300'}`}
                  onClick={() => setPicker(`arch:${t.classId}`)}>
                  {arch ? arch.name : 'choose archetype ▸'}
                </button>
              )}
            </div>
            <div className="mt-1 flex flex-col gap-1">
              {build.levels.filter((l) => l.classId === t.classId).map((entry) => {
                const classLevel = classLevelOf(build, entry);
                const isAsi = (cls?.asiLevels ?? []).includes(classLevel);
                return (
                  <div key={entry.n} className="border-t border-ht-line pt-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="ht-label">L{entry.n}</span>
                      <span className="text-ht-muted">{cls?.name ?? t.classId} {classLevel}</span>
                      <span className="ml-auto">
                        <HpControl entry={entry} die={cls?.hitDie ?? 6} editable={editable} dispatch={dispatch} />
                      </span>
                    </div>
                    {isAsi && <AsiRow build={build} ref={ref} entry={entry} editable={editable} dispatch={dispatch} />}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-2">
        {editable && build.levels.length < 20 && (
          <button type="button" className="ht-step" onClick={() => setPicker('add')}>
            + add level {build.levels.length + 1}
          </button>
        )}
        {editable && lastEntry && (confirmRemove ? (
          <span className="ml-auto flex items-center gap-2">
            <span className="text-[10px] text-ht-muted">
              remove L{lastEntry.n} ({ref.classes[lastEntry.classId]?.name ?? lastEntry.classId})?
            </span>
            <button type="button" className="ht-step text-red-400"
              onClick={() => { dispatch({ t: 'removeLastLevel' }); setConfirmRemove(false); }}>
              confirm ✕
            </button>
            <button type="button" className="ht-step" onClick={() => setConfirmRemove(false)}>keep</button>
          </span>
        ) : (
          <button type="button" className="ml-auto text-[10px] text-ht-muted" onClick={() => setConfirmRemove(true)}>
            − remove last level
          </button>
        ))}
      </div>
      <div className="text-[10px] text-ht-muted">
        Level changes carry into your current HP automatically; level 1 always takes the full die.
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update the Builder shell** — in `apps/swdnd/src/panels/CharacterSheet/Builder/index.tsx`, change the strip line

```tsx
        <span className="text-[10px] text-ht-muted">building level 1</span>
```

to

```tsx
        <span className="text-[10px] text-ht-muted">building level {Math.max(1, b.build.levels.length)}</span>
```

(The ClassStep call site keeps its existing props — the new ClassStep takes the same `build/ref/editable/dispatch`.)

- [ ] **Step 3: Verify build + suite**

Run: `cd apps/swdnd && bun run build` → clean. `bun test` → green.

- [ ] **Step 4: Commit**

```bash
git add apps/swdnd/src/panels/CharacterSheet/Builder/steps/Class.tsx apps/swdnd/src/panels/CharacterSheet/Builder/index.tsx
git commit -m "feat(swdnd): class step level log (multiclass, hp, ASI, archetypes)"
```

---

### Task 9: Feats step — slot strip

**Files:**
- Modify: `apps/swdnd/src/panels/CharacterSheet/Builder/steps/Feats.tsx` (full rewrite below)

- [ ] **Step 1: Rewrite `Feats.tsx`** — complete file:

```tsx
// apps/swdnd/src/panels/CharacterSheet/Builder/steps/Feats.tsx
import { useState } from 'react';
import type { BuildAction } from '../../../../lib/buildState';
import type { CharacterBuild, ReferenceData } from '../../../../lib/rules/types';
import StepTable from '../StepTable';

interface Props {
  build: CharacterBuild;
  ref: ReferenceData;
  editable: boolean;
  dispatch: (a: BuildAction) => void;
}

export default function FeatsStep({ build, ref, editable, dispatch }: Props) {
  const bg = ref.backgrounds[build.identity.backgroundId];
  const slots = [
    {
      n: 1, label: 'L1 (optional)', optional: true,
      featId: build.levels[0]?.choices?.featId as string | undefined,
    },
    ...build.levels
      .filter((l) => l.n !== 1 && l.choices?.asiOrFeat === 'feat')
      .map((l) => ({
        n: l.n,
        label: `L${l.n} (${ref.classes[l.classId]?.name ?? l.classId})`,
        optional: false,
        featId: l.choices?.featId as string | undefined,
      })),
  ];
  const [armed, setArmed] = useState(1);
  const armedSlot = slots.find((s) => s.n === armed) ?? slots[0];

  return (
    <StepTable
      items={Object.values(ref.feats)}
      columns={[
        { key: 'name', label: 'Name', flex: 1.2, value: (f) => f.name },
        { key: 'req', label: 'Requirements', flex: 1, value: (f) => f.requirements ?? '—' },
      ]}
      idOf={(f) => f.id}
      searchText={(f) => `${f.name} ${f.requirements ?? ''}`}
      isSelected={(f) => f.id === armedSlot.featId}
      onSelect={(f) => dispatch({
        t: 'setFeatForLevel', n: armedSlot.n,
        featId: f.id === armedSlot.featId ? null : f.id,
      })}
      selectLabel={(f) => (f.id === armedSlot.featId ? '✕ clear feat' : `✓ take for ${armedSlot.label}`)}
      detail={(f) => f.description || 'No description in the source data.'}
      editable={editable}
      header={
        <div className="flex flex-col gap-1">
          {slots.length > 1 && (
            <div className="ht-panel flex flex-wrap items-center gap-2 p-2 text-[10px]">
              <span className="ht-label">Slots</span>
              {slots.map((s) => (
                <button key={s.n} type="button"
                  className={`ht-step ${s.n === armedSlot.n ? 'ht-tile-active' : ''} ${!s.optional && !s.featId ? 'text-yellow-300' : ''}`}
                  onClick={() => setArmed(s.n)}>
                  {s.label} · {s.featId ? ref.feats[s.featId]?.name ?? s.featId : 'empty'}
                </button>
              ))}
            </div>
          )}
          <div className="ht-panel p-2 text-[10px] text-ht-muted">
            {slots.length > 1
              ? 'Picking a feat fills the armed slot.'
              : 'Optional at level 1 — ASI levels that elect a feat add slots here.'}
            {bg ? ` Your background (${bg.name}) suggests options in its description.` : ''}
            {' '}Feat effects are read at the table; the pick is recorded on the build.
          </div>
        </div>
      }
    />
  );
}
```

- [ ] **Step 2: Verify build + suite**

Run: `cd apps/swdnd && bun run build` → clean. `bun test` → green.

- [ ] **Step 3: Commit**

```bash
git add apps/swdnd/src/panels/CharacterSheet/Builder/steps/Feats.tsx
git commit -m "feat(swdnd): feat slot strip for ASI feat elections"
```

---

### Task 10: Sheet Features — archetype line

**Files:**
- Modify: `apps/swdnd/src/panels/CharacterSheet/Sheet/Features.tsx`

- [ ] **Step 1: Implement** — replace the file body with:

```tsx
// apps/swdnd/src/panels/CharacterSheet/Sheet/Features.tsx
import { classesTaken } from '../../../lib/rules/core';
import type { CharacterBuild, ReferenceData } from '../../../lib/rules/types';
import { classSummary } from '../../../lib/sheetView';

export default function Features({ build, ref }: { build: CharacterBuild; ref: ReferenceData }) {
  const speciesName = ref.species[build.identity.speciesId]?.name ?? build.identity.speciesId;
  const backgroundName = ref.backgrounds[build.identity.backgroundId]?.name ?? build.identity.backgroundId;
  const archetyped = classesTaken(build).filter((t) => t.archetypeId);
  return (
    <div className="ht-panel p-2 font-mono text-[11px]">
      <div className="ht-label mb-1">Features &amp; Traits</div>
      <div className="flex justify-between text-ht-text">
        <span>Species</span><span className="text-ht-muted">{speciesName || '—'}</span>
      </div>
      <div className="flex justify-between text-ht-text">
        <span>Background</span><span className="text-ht-muted">{backgroundName || '—'}</span>
      </div>
      <div className="flex justify-between text-ht-text">
        <span>Classes</span><span className="text-ht-muted">{classSummary(build, ref) || '—'}</span>
      </div>
      {archetyped.map((t) => (
        <div key={t.classId} className="flex justify-between text-ht-text">
          <span>{ref.classes[t.classId]?.name ?? t.classId} archetype</span>
          <span className="text-ht-muted">{ref.archetypes[t.archetypeId!]?.name ?? t.archetypeId}</span>
        </div>
      ))}
    </div>
  );
}
```

(The stale "Feature detail arrives with the builder (Phase 3)." line is removed — Phase 3 shipped; feature text is a tracked future enhancement.)

- [ ] **Step 2: Verify build + suite**

Run: `cd apps/swdnd && bun run build` → clean. `bun test` → green.

- [ ] **Step 3: Commit**

```bash
git add apps/swdnd/src/panels/CharacterSheet/Sheet/Features.tsx
git commit -m "feat(swdnd): show archetypes on the sheet features panel"
```

---

### Task 11: Full verification (coordinator)

Not a subagent task — the coordinator runs it.

- [ ] `bun test` from repo root: everything green (expect ~115+ tests).
- [ ] `cd apps/swdnd && bun run build`: clean tsc + vite build.
- [ ] Live walkthrough on the running preview (backend :3000, swdnd :5175, player token `d782eace-375e-4e20-9a3b-fd06ea364d8a`, character Brakk Voss `84740f12-7dc8-4327-b8a1-4048a733829e`): level Brakk (Fighter) to 4 (ASI election with +1/+1), attempt a Consular dip below WIS 13 (dimmed with reason), raise WIS / house-rule and dip, level a Consular to 3 and pick an archetype, verify play.hp moved with each level, remove last level round-trip, verify feat slot flow, sheet shows archetype + `Fighter N / Consular M`, PlayerHome step counts still sane. Visual pass at narrow + wide container widths.
- [ ] Update the Mount Tantiss vault docs (Roadmap.md → Phase 4 done; Features/Character Sheets.md → level log; Data Model.md → `l{n}` increase refs + `choices.asiOrFeat`).
- [ ] `superpowers:finishing-a-development-branch`.
