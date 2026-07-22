# Character Builder (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the swdnd **player landing** and the **level-1 single-class builder** — step rail, searchable/sortable pick-tables, three ability-entry modes, house-rule unlock — writing `character.data_json` through the existing routes.

**Architecture:** Same as Phases 1–2: all logic in **pure, unit-tested modules** (`pointBuy`, `richText`, `buildState`, `validation`); React components are dumb; a `useBuilder` hook mirrors `useCharacterSheet` (load → compute → optimistic build edits → debounced PATCH). **Zero new backend routes.**

**Tech Stack:** React 19, React Router 7, Vite 7, Tailwind v4 (`@container`), Bun (`bun test`). Consumes the Phase 1 engine + Phase 2 patterns (all merged).

**Spec:** `docs/superpowers/specs/2026-07-22-character-builder-design.md`.

---

## Phase 1/2 API this plan builds on (merged — do not reimplement)

- `apps/swdnd/src/lib/rules/types.ts` — `CharacterBuild` (`identity{name,speciesId,backgroundId,alignment}`, `abilities{base,increases[]}` with `AbilityIncrease{source:'species'|'asi'|'feat', ref, ability, amount}`, `levels[]` (`{n,classId,archetypeId,hp,choices?}`), `proficiencies{skills,expertise,tools,languages,savingThrows}`, `equipment[]{ref,qty,equipped}`, `credits`, `knownPowers[]`, `knownManeuvers[]`, `play`, `overrides`), `emptyBuild(name)`, `AbilityKey`, `SkillKey`, view types (`RefClass{id,name,hitDie,saves,skillChoices,skillNumber,powercasting,superiorityProgression}`, `RefSpecies{id,name,walkSpeed}`, `RefArmor`, `RefWeapon`, `RefPower{id,name,level,castType}`, `ReferenceData`).
- `apps/swdnd/src/lib/rules/index.ts` — `computeSheet(build, ref): DerivedSheet` (`casting.{force,tech}.{classes,knownMax,maxPowerLevel,…}`, `superiority: {diceMax,die,knownMax}|null`, …). `SKILLS` map in `rules/constants.ts`.
- `apps/swdnd/src/lib/characters.ts` — `getCharacter`, `patchCharacter(id, {name?, data_json?}, token?)`, `createCharacter(campaignId, name, token?)`, `deleteCharacter(id, token?)`, `getPlayerByToken(token)` → `{player, characters:[{id,name,campaign_id}]}`, `loadReference()`, `mapClassRow`/`mapSpeciesRow`/`mapArmorRow`/`mapWeaponRow`/`mapPowerRow`/`mapArchetypeRow`, `classSummary(build, ref)` in `lib/sheetView.ts`.
- `apps/swdnd/src/lib/canEdit.ts` — `resolveCanEdit({admin, token})`; `lib/faction.ts` — `factionStyle`.
- `apps/swdnd/src/hooks/useCharacterSheet.ts` — the hook pattern to mirror (dynamic-import-free, debounced save, `alive` flags).
- Holoterminal CSS utilities in `apps/swdnd/src/index.css`: `.ht-screen .ht-panel .ht-glow .ht-step .ht-label .ht-name .ht-tile-active`.
- Backend `emptyBuildJson` in `apps/backend/src/routes/swdnd/characters.ts` mirrors `emptyBuild` (keep in sync).

**Foundry data facts (verified against `vendor/sw5e/packs`):** species ability increases live in `advancement[type='AbilityScoreImprovement'].configuration` as `{fixed: {cha:2,dex:1}, points: N}` (Zabrak has BOTH `fixed:{con:2}` and `points:1`); descriptions are HTML at `system.description.value` containing `@Compendium[...]{Label}`/`@UUID[...]{Label}` codes; item prices at `system.price.value`; maneuvers have `system.maneuverType` (`physical|mental|general`); backgrounds carry prose at `system.skillProficiencies.value`, `system.toolProficiencies.value`, `system.equipment.value`, `system.featureName` (string or `{value}`); feats may carry `system.requirements` (string or null).

**Test conventions:** `bun test <path>`; pure modules only (components verified by `cd apps/swdnd && bun run build`). The `bun --cwd` flag is unreliable here — use `cd apps/swdnd && bun run build`.

---

## File structure

Create (pure): `apps/swdnd/src/lib/{pointBuy,richText,buildState,validation}.ts` + tests.
Modify (pure): `lib/rules/types.ts` (+`houseRuled`, ref-type extensions), `lib/characters.ts` (new mappers + categories), backend `characters.ts` (`emptyBuildJson` sync).
Create (React): `hooks/useBuilder.ts`, `panels/PlayerHome/index.tsx`, `panels/CharacterSheet/Builder/{index,StepRail,StepTable}.tsx`, `panels/CharacterSheet/Builder/steps/{Species,Background,Class,Abilities,Skills,Feats,Equipment,Powers}.tsx`.
Modify (React): `App.tsx` (`/player` route), `panels/CharacterSheet/index.tsx` (build mode → Builder).

---

## Task 1: Point-buy module

**Files:**
- Create: `apps/swdnd/src/lib/pointBuy.ts`
- Test: `apps/swdnd/src/lib/pointBuy.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/swdnd/src/lib/pointBuy.test.ts
import { test, expect } from 'bun:test';
import { POINT_BUY_BUDGET, scoreCost, pointsSpent, budgetRemaining, isLegalPointBuy } from './pointBuy';
import type { AbilityKey } from './rules/types';

const base = (over: Partial<Record<AbilityKey, number>> = {}): Record<AbilityKey, number> => ({
  str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8, ...over,
});

test('sw5e cost table (pinned from sw5e.com PHB ch.1)', () => {
  expect(POINT_BUY_BUDGET).toBe(27);
  expect(scoreCost(8)).toBe(0);
  expect(scoreCost(11)).toBe(3);
  expect(scoreCost(14)).toBe(7);
  expect(scoreCost(15)).toBe(9);
  expect(scoreCost(7)).toBeNull();
  expect(scoreCost(16)).toBeNull();
});

test('pointsSpent sums costs; null when any score is out of range', () => {
  expect(pointsSpent(base())).toBe(0);
  expect(pointsSpent(base({ str: 15, dex: 15, con: 15 }))).toBe(27); // 15,15,15,8,8,8
  expect(pointsSpent(base({ str: 16 }))).toBeNull();
});

test('budgetRemaining and legality', () => {
  expect(budgetRemaining(base({ str: 15, dex: 14 }))).toBe(27 - 9 - 7);
  expect(isLegalPointBuy(base({ str: 15, dex: 15, con: 15 }))).toBe(true);
  expect(isLegalPointBuy(base({ str: 15, dex: 15, con: 15, int: 9 }))).toBe(false); // 28 pts
  expect(isLegalPointBuy(base({ str: 16 }))).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/swdnd/src/lib/pointBuy.test.ts`
Expected: FAIL — cannot resolve `./pointBuy`.

- [ ] **Step 3: Implement**

```ts
// apps/swdnd/src/lib/pointBuy.ts
// sw5e "Variant: Customizing Ability Scores" (sw5e.com PHB ch.1): 27 points,
// scores 8–15 before species increases.
import type { AbilityKey } from './rules/types';

export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_MIN = 8;
export const POINT_BUY_MAX = 15;
export const POINT_BUY_COST: Record<number, number> = {
  8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9,
};

/** Cost of one score, or null when outside the 8–15 point-buy range. */
export function scoreCost(score: number): number | null {
  return POINT_BUY_COST[score] ?? null;
}

/** Total points spent, or null when any score is out of range. */
export function pointsSpent(base: Record<AbilityKey, number>): number | null {
  let total = 0;
  for (const score of Object.values(base)) {
    const cost = scoreCost(score);
    if (cost == null) return null;
    total += cost;
  }
  return total;
}

export function budgetRemaining(base: Record<AbilityKey, number>): number | null {
  const spent = pointsSpent(base);
  return spent == null ? null : POINT_BUY_BUDGET - spent;
}

export function isLegalPointBuy(base: Record<AbilityKey, number>): boolean {
  const remaining = budgetRemaining(base);
  return remaining != null && remaining >= 0;
}

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/swdnd/src/lib/pointBuy.test.ts`
Expected: PASS (3 pass).

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/pointBuy.ts apps/swdnd/src/lib/pointBuy.test.ts
git commit -m "feat(swdnd): sw5e point-buy module"
```

---

## Task 2: Rich-text cleaner

**Files:**
- Create: `apps/swdnd/src/lib/richText.ts`
- Test: `apps/swdnd/src/lib/richText.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/swdnd/src/lib/richText.test.ts
import { test, expect } from 'bun:test';
import { cleanRichText } from './richText';

test('strips tags, keeps paragraph breaks', () => {
  expect(cleanRichText('<p>First.</p><p>Second.</p>')).toBe('First.\nSecond.');
  expect(cleanRichText('a<br>b')).toBe('a\nb');
  expect(cleanRichText('<ul><li>one</li><li>two</li></ul>')).toBe('• one\n• two');
});

test('replaces Foundry link codes with their labels', () => {
  expect(cleanRichText('See @Compendium[sw5e.archetypes.abc]{Makashi Form} for detail')).toBe(
    'See Makashi Form for detail',
  );
  expect(cleanRichText('@UUID[Compendium.sw5e.feats.xyz]{Ace Pilot}')).toBe('Ace Pilot');
});

test('decodes common entities, collapses whitespace, handles null', () => {
  expect(cleanRichText('a &amp; b&nbsp;c')).toBe('a & b c');
  expect(cleanRichText('  <p>  spaced   out  </p> ')).toBe('spaced out');
  expect(cleanRichText(null)).toBe('');
  expect(cleanRichText(undefined)).toBe('');
});

test('never lets markup through (safe for direct text rendering)', () => {
  expect(cleanRichText('<script>alert(1)</script>hi <b onclick="x">bold</b>')).toBe('alert(1)hi bold');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/swdnd/src/lib/richText.test.ts`
Expected: FAIL — cannot resolve `./richText`.

- [ ] **Step 3: Implement**

```ts
// apps/swdnd/src/lib/richText.ts
// Foundry descriptions are HTML with @Compendium[...]{Label} / @UUID[...]{Label}
// link codes. Reduce to plain text with paragraph breaks — rendered via
// whitespace-pre-line, never dangerouslySetInnerHTML.

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&nbsp;': ' ', '&rsquo;': '’', '&lsquo;': '‘', '&mdash;': '—', '&ndash;': '–',
};

export function cleanRichText(html: string | null | undefined): string {
  if (!html) return '';
  let s = html;
  // Foundry link codes → their display label.
  s = s.replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, '$1');
  // Structural tags → line breaks / bullets before stripping the rest.
  s = s.replace(/<li[^>]*>/gi, '\n• ');
  s = s.replace(/<\/(p|div|h[1-6]|ul|ol|li|tr)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  // Strip every remaining tag.
  s = s.replace(/<[^>]+>/g, '');
  for (const [entity, ch] of Object.entries(ENTITIES)) s = s.replaceAll(entity, ch);
  // Collapse: spaces within lines, at most single blank-free newlines, trim.
  s = s
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
  return s;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/swdnd/src/lib/richText.test.ts`
Expected: PASS (4 pass).

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/richText.ts apps/swdnd/src/lib/richText.test.ts
git commit -m "feat(swdnd): Foundry rich-text cleaner"
```

---

## Task 3: `houseRuled` build field (frontend + backend sync)

**Files:**
- Modify: `apps/swdnd/src/lib/rules/types.ts`
- Modify: `apps/swdnd/src/lib/rules/types.test.ts`
- Modify: `apps/backend/src/routes/swdnd/characters.ts` (the `emptyBuildJson` mirror)

- [ ] **Step 1: Add the failing assertion**

In `apps/swdnd/src/lib/rules/types.test.ts`, extend the existing `emptyBuild` test with:

```ts
  expect(b.houseRuled).toEqual([]);
```

Run: `bun test apps/swdnd/src/lib/rules/types.test.ts` — Expected: FAIL (`undefined`).

- [ ] **Step 2: Add the field**

In `apps/swdnd/src/lib/rules/types.ts`:
- To `CharacterBuild` (after `overrides`): `/** Step keys the player has house-rule-unlocked (additive; absent = none). */\n  houseRuled?: string[];`
- In `emptyBuild(...)`'s returned object (after `overrides: {}`): `houseRuled: [],`

In `apps/backend/src/routes/swdnd/characters.ts`, inside `emptyBuildJson`'s object (after `overrides: {}`): `houseRuled: [],`

- [ ] **Step 3: Verify**

Run: `bun test apps/swdnd/src/lib/rules/types.test.ts apps/backend/src/routes/swdnd/characters.test.ts`
Expected: PASS (both files).

- [ ] **Step 4: Commit**

```bash
git add apps/swdnd/src/lib/rules/types.ts apps/swdnd/src/lib/rules/types.test.ts apps/backend/src/routes/swdnd/characters.ts
git commit -m "feat(swdnd): additive houseRuled build field"
```

---

## Task 4: Reference expansion (backgrounds, feats, maneuvers, gear; descriptions, increases, prices)

**Files:**
- Modify: `apps/swdnd/src/lib/rules/types.ts` (view types), `apps/swdnd/src/lib/characters.ts` (mappers + `loadReference`)
- Test: `apps/swdnd/src/lib/characters.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `characters.test.ts`)

```ts
import { mapSpeciesRow, mapBackgroundRow, mapFeatRow, mapManeuverRow, mapGearRow } from './characters';

test('mapSpeciesRow extracts ability increases and description', () => {
  const row = {
    id: 'zabrak', name: 'Zabrak',
    raw_json: JSON.stringify({
      system: {
        movement: { walk: 30 },
        description: { value: '<p>Hardy &amp; determined.</p>' },
        advancement: [
          { type: 'ItemGrant', configuration: {} },
          { type: 'AbilityScoreImprovement', configuration: { fixed: { con: 2 }, points: 1 } },
        ],
      },
    }),
  };
  const s = mapSpeciesRow(row);
  expect(s.abilityIncreases).toEqual({ fixed: { con: 2 }, points: 1 });
  expect(s.description).toContain('Hardy & determined.');
  const none = mapSpeciesRow({ id: 'x', name: 'X', raw_json: JSON.stringify({ system: { movement: { walk: 25 } } }) });
  expect(none.abilityIncreases).toBeNull();
});

test('mapBackgroundRow pulls prose fields (string or {value} shapes)', () => {
  const row = {
    id: 'jedi', name: 'Jedi',
    raw_json: JSON.stringify({
      system: {
        description: { value: '<p>Order member.</p>' },
        featureName: { value: 'Shelter of the Faithful' },
        skillProficiencies: { value: 'Choose two from Insight, Lore, …' },
        toolProficiencies: { value: 'None' },
        equipment: { value: 'A lightsaber hilt, robes…' },
      },
    }),
  };
  const b = mapBackgroundRow(row);
  expect(b.featureName).toBe('Shelter of the Faithful');
  expect(b.skillProse).toContain('Choose two');
  expect(b.equipmentProse).toContain('lightsaber');
});

test('mapFeatRow, mapManeuverRow, mapGearRow', () => {
  const feat = mapFeatRow({ id: 'f', name: 'Ace Pilot', raw_json: JSON.stringify({ system: { description: { value: '<p>Fly good.</p>' }, requirements: null } }) });
  expect(feat).toMatchObject({ id: 'f', name: 'Ace Pilot', requirements: null });
  const man = mapManeuverRow({ id: 'm', name: 'Feint', raw_json: JSON.stringify({ system: { maneuverType: 'physical', description: { value: 'x' } } }) });
  expect(man.maneuverType).toBe('physical');
  const gear = mapGearRow({ id: 'g', name: 'Backpack', category: 'adventuring', raw_json: JSON.stringify({ system: { price: { value: 50 }, description: { value: 'Holds stuff' } } }) });
  expect(gear).toMatchObject({ id: 'g', category: 'adventuring', price: 50 });
});

test('weapon/armor rows now carry price and description', () => {
  const armorRow = { id: 'b', name: 'Beskar', raw_json: JSON.stringify({ system: { armor: { value: 14, type: 'medium', dex: 2 }, price: { value: 2000 }, description: { value: 'Shiny' } } }) };
  expect(mapArmorRow(armorRow)).toMatchObject({ baseAc: 14, price: 2000, description: 'Shiny' });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test apps/swdnd/src/lib/characters.test.ts`
Expected: FAIL — new exports missing.

- [ ] **Step 3: Extend the view types** (`apps/swdnd/src/lib/rules/types.ts`)

Add `description: string;` to `RefSpecies`, `RefClass`, and `RefPower`; add `price: number | null; description: string;` to `RefWeapon` and `RefArmor`; add to `RefSpecies`: `abilityIncreases: { fixed: Partial<Record<AbilityKey, number>>; points: number } | null;`. Add new interfaces + registry entries:

```ts
export interface RefBackground {
  id: string;
  name: string;
  description: string;
  featureName: string | null;
  skillProse: string | null;
  toolProse: string | null;
  equipmentProse: string | null;
}
export interface RefFeat {
  id: string;
  name: string;
  description: string;
  requirements: string | null;
}
export interface RefManeuver {
  id: string;
  name: string;
  maneuverType: string;
  description: string;
}
export interface RefGear {
  id: string;
  name: string;
  category: string | null;
  price: number | null;
  description: string;
}
```

And extend `ReferenceData` with `backgrounds: Record<string, RefBackground>; feats: Record<string, RefFeat>; maneuvers: Record<string, RefManeuver>; gear: Record<string, RefGear>;`.

- [ ] **Step 4: Extend the mappers + loader** (`apps/swdnd/src/lib/characters.ts`)

Add helpers + mappers (import `cleanRichText` from `./richText`):

```ts
function proseOf(v: unknown): string | null {
  if (typeof v === 'string') return v || null;
  if (v && typeof v === 'object' && 'value' in v) {
    const inner = (v as { value?: unknown }).value;
    return typeof inner === 'string' && inner ? inner : null;
  }
  return null;
}
function descriptionOf(s: Record<string, any>): string {
  return cleanRichText(proseOf(s.description));
}
function priceOf(s: Record<string, any>): number | null {
  const v = s.price?.value;
  return typeof v === 'number' ? v : null;
}
```

- `mapSpeciesRow`: also return `description: descriptionOf(s)` and `abilityIncreases`: find `Array.isArray(s.advancement)` entry with `type === 'AbilityScoreImprovement'`; if found map `{ fixed: cfg.fixed ?? {}, points: Number(cfg.points ?? 0) }` (filtering `fixed` keys through the existing `asAbility`), else `null`.
- `mapClassRow` / `mapPowerRow`: also return `description: descriptionOf(s)`.
- `mapWeaponRow` / `mapArmorRow`: also return `price: priceOf(s)`, `description: descriptionOf(s)`.
- New `mapBackgroundRow`, `mapFeatRow`, `mapManeuverRow`, `mapGearRow` per the test shapes (gear's `category` comes from the ROW column `row.category`, not raw_json).
- `loadReference()`: add `api<Row[]>('/swdnd/content/backgrounds' | 'feats' | 'maneuvers' | 'gear')` to the `Promise.all` and the returned object via `byId(...)`.

Update the TWO existing assertions that break on the additive fields: in the old `mapArmorRow` AND `mapPowerRow` tests, change `toEqual({...})` to `toMatchObject({...})` (the rows now also carry `price`/`description`).

- [ ] **Step 5: Verify + build**

Run: `bun test apps/swdnd/src/lib/` — Expected: all pass.
Run: `cd apps/swdnd && bun run build` — Expected: success (Powers/Combat/Gear components tolerate the additive fields).

- [ ] **Step 6: Commit**

```bash
git add apps/swdnd/src/lib/rules/types.ts apps/swdnd/src/lib/characters.ts apps/swdnd/src/lib/characters.test.ts
git commit -m "feat(swdnd): reference expansion — backgrounds, feats, maneuvers, gear, descriptions"
```

---

## Task 5: Build-state mutations

**Files:**
- Create: `apps/swdnd/src/lib/buildState.ts`
- Test: `apps/swdnd/src/lib/buildState.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/swdnd/src/lib/buildState.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild, type DerivedSheet, type ReferenceData, type RefClass, type RefSpecies } from './rules/types';
import { applyBuildAction } from './buildState';

const consular: RefClass = {
  id: 'consular', name: 'Consular', hitDie: 6, saves: ['wis', 'cha'],
  skillChoices: ['ins', 'lor', 'per'], skillNumber: 2,
  powercasting: { force: 'full', tech: 'none' }, superiorityProgression: 0, description: '',
};
const zabrak: RefSpecies = {
  id: 'zabrak', name: 'Zabrak', walkSpeed: 30, description: '',
  abilityIncreases: { fixed: { con: 2 }, points: 1 },
};
const human: RefSpecies = {
  id: 'human', name: 'Human', walkSpeed: 30, description: '',
  abilityIncreases: { fixed: {}, points: 4 },
};
const ref = {
  classes: { consular }, species: { zabrak, human },
  archetypes: {}, armor: {}, weapons: {},
  powers: {
    push: { id: 'push', name: 'Push', level: 0, castType: 'force', description: '' },
    heal: { id: 'heal', name: 'Heal', level: 1, castType: 'force', description: '' },
    scan: { id: 'scan', name: 'Scan', level: 1, castType: 'tech', description: '' },
    storm: { id: 'storm', name: 'Storm', level: 4, castType: 'force', description: '' },
  },
  backgrounds: {}, feats: {}, maneuvers: {}, gear: {},
} as unknown as ReferenceData;
// A Consular-1-ish derived: force known max 9, max power level 1, no tech, no superiority.
const derived = {
  casting: {
    force: { classes: 1, knownMax: 9, maxPowerLevel: 1 },
    tech: { classes: 0, knownMax: 0, maxPowerLevel: 0 },
  },
  superiority: null,
} as unknown as DerivedSheet;

test('setSpecies applies fixed increases and replaces a prior species entirely', () => {
  let b = applyBuildAction(emptyBuild('x'), ref, derived, { t: 'setSpecies', speciesId: 'zabrak' });
  expect(b.identity.speciesId).toBe('zabrak');
  expect(b.abilities.increases).toEqual([{ source: 'species', ref: 'zabrak', ability: 'con', amount: 2 }]);
  b = applyBuildAction(b, ref, derived, { t: 'allocateSpeciesPoint', ability: 'wis', delta: 1 });
  expect(b.abilities.increases).toContainEqual({ source: 'species', ref: 'zabrak#choice', ability: 'wis', amount: 1 });
  // switching species drops ALL species-sourced increases
  b = applyBuildAction(b, ref, derived, { t: 'setSpecies', speciesId: 'human' });
  expect(b.abilities.increases).toEqual([]);
});

test('allocateSpeciesPoint caps at the species budget and never goes negative', () => {
  let b = applyBuildAction(emptyBuild('x'), ref, derived, { t: 'setSpecies', speciesId: 'zabrak' }); // 1 point
  b = applyBuildAction(b, ref, derived, { t: 'allocateSpeciesPoint', ability: 'wis', delta: 1 });
  const capped = applyBuildAction(b, ref, derived, { t: 'allocateSpeciesPoint', ability: 'cha', delta: 1 });
  expect(capped.abilities.increases.filter((i) => i.ref === 'zabrak#choice')).toHaveLength(1); // no budget left
  const removed = applyBuildAction(b, ref, derived, { t: 'allocateSpeciesPoint', ability: 'wis', delta: -1 });
  expect(removed.abilities.increases.filter((i) => i.ref === 'zabrak#choice')).toHaveLength(0);
});

test('setClass writes levels[0] and saving throws', () => {
  const b = applyBuildAction(emptyBuild('x'), ref, derived, { t: 'setClass', classId: 'consular' });
  expect(b.levels).toEqual([{ n: 1, classId: 'consular', archetypeId: null, hp: 'avg', choices: {} }]);
  expect(b.proficiencies.savingThrows).toEqual(['wis', 'cha']);
});

test('toggleSkill / setFeat / equipment / credits', () => {
  let b = applyBuildAction(emptyBuild('x'), ref, derived, { t: 'toggleSkill', skill: 'lor' });
  expect(b.proficiencies.skills).toEqual(['lor']);
  b = applyBuildAction(b, ref, derived, { t: 'toggleSkill', skill: 'lor' });
  expect(b.proficiencies.skills).toEqual([]);
  b = applyBuildAction(b, ref, derived, { t: 'setClass', classId: 'consular' });
  b = applyBuildAction(b, ref, derived, { t: 'setFeat', featId: 'f1' });
  expect(b.levels[0].choices).toEqual({ featId: 'f1' });
  b = applyBuildAction(b, ref, derived, { t: 'addEquipment', ref: 'saber' });
  b = applyBuildAction(b, ref, derived, { t: 'addEquipment', ref: 'saber' });
  expect(b.equipment).toEqual([{ ref: 'saber', qty: 2, equipped: true }]);
  b = applyBuildAction(b, ref, derived, { t: 'removeEquipment', ref: 'saber' });
  expect(b.equipment[0].qty).toBe(1);
  b = applyBuildAction(b, ref, derived, { t: 'setCredits', credits: -5 });
  expect(b.credits).toBe(0);
});

test('togglePower enforces track, level cap, and count cap unless house-ruled', () => {
  let b = applyBuildAction(emptyBuild('x'), ref, derived, { t: 'togglePower', powerId: 'heal' });
  expect(b.knownPowers).toEqual(['heal']);
  // tech power: no tech track -> rejected
  expect(applyBuildAction(b, ref, derived, { t: 'togglePower', powerId: 'scan' }).knownPowers).toEqual(['heal']);
  // above max power level -> rejected
  expect(applyBuildAction(b, ref, derived, { t: 'togglePower', powerId: 'storm' }).knownPowers).toEqual(['heal']);
  // removal always allowed
  expect(applyBuildAction(b, ref, derived, { t: 'togglePower', powerId: 'heal' }).knownPowers).toEqual([]);
  // house-ruled: anything goes
  b = applyBuildAction(b, ref, derived, { t: 'toggleHouseRule', step: 'powers' });
  expect(b.houseRuled).toEqual(['powers']);
  expect(applyBuildAction(b, ref, derived, { t: 'togglePower', powerId: 'storm' }).knownPowers).toContain('storm');
});

test('togglePower count cap uses derived knownMax', () => {
  const tiny = { ...derived, casting: { ...derived.casting, force: { ...derived.casting.force, knownMax: 1 } } } as DerivedSheet;
  let b = applyBuildAction(emptyBuild('x'), ref, tiny, { t: 'togglePower', powerId: 'heal' });
  expect(applyBuildAction(b, ref, tiny, { t: 'togglePower', powerId: 'push' }).knownPowers).toEqual(['heal']); // cap 1
});

test('setName and toggleHouseRule round-trips', () => {
  let b = applyBuildAction(emptyBuild('x'), ref, derived, { t: 'setName', name: 'Kira' });
  expect(b.identity.name).toBe('Kira');
  b = applyBuildAction(b, ref, derived, { t: 'toggleHouseRule', step: 'powers' });
  b = applyBuildAction(b, ref, derived, { t: 'toggleHouseRule', step: 'powers' });
  expect(b.houseRuled).toEqual([]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test apps/swdnd/src/lib/buildState.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// apps/swdnd/src/lib/buildState.ts
import type {
  AbilityKey, CharacterBuild, DerivedSheet, ReferenceData, SkillKey,
} from './rules/types';

export type BuildAction =
  | { t: 'setName'; name: string }
  | { t: 'setSpecies'; speciesId: string }
  | { t: 'allocateSpeciesPoint'; ability: AbilityKey; delta: 1 | -1 }
  | { t: 'setBackground'; backgroundId: string }
  | { t: 'setClass'; classId: string }
  | { t: 'setBaseAbilities'; base: Record<AbilityKey, number> }
  | { t: 'toggleSkill'; skill: SkillKey }
  | { t: 'setFeat'; featId: string | null }
  | { t: 'addEquipment'; ref: string }
  | { t: 'removeEquipment'; ref: string }
  | { t: 'toggleEquipped'; ref: string }
  | { t: 'setCredits'; credits: number }
  | { t: 'togglePower'; powerId: string }
  | { t: 'toggleManeuver'; maneuverId: string }
  | { t: 'toggleHouseRule'; step: string };

const clone = (b: CharacterBuild): CharacterBuild => ({
  ...b,
  identity: { ...b.identity },
  abilities: { base: { ...b.abilities.base }, increases: [...b.abilities.increases] },
  levels: b.levels.map((l) => ({ ...l, choices: { ...(l.choices ?? {}) } })),
  proficiencies: {
    ...b.proficiencies,
    skills: [...b.proficiencies.skills],
    savingThrows: [...b.proficiencies.savingThrows],
  },
  equipment: b.equipment.map((e) => ({ ...e })),
  knownPowers: [...b.knownPowers],
  knownManeuvers: [...b.knownManeuvers],
  houseRuled: [...(b.houseRuled ?? [])],
});

const houseRuled = (b: CharacterBuild, step: string) => (b.houseRuled ?? []).includes(step);

export function applyBuildAction(
  build: CharacterBuild,
  ref: ReferenceData,
  derived: DerivedSheet,
  action: BuildAction,
): CharacterBuild {
  const b = clone(build);

  switch (action.t) {
    case 'setName':
      b.identity.name = action.name;
      break;

    case 'setSpecies': {
      b.identity.speciesId = action.speciesId;
      // Replace ALL species-sourced increases with the new species' fixed ones.
      b.abilities.increases = b.abilities.increases.filter((i) => i.source !== 'species');
      const inc = ref.species[action.speciesId]?.abilityIncreases;
      for (const [ability, amount] of Object.entries(inc?.fixed ?? {})) {
        b.abilities.increases.push({
          source: 'species', ref: action.speciesId, ability: ability as AbilityKey, amount: amount as number,
        });
      }
      break;
    }

    case 'allocateSpeciesPoint': {
      const speciesId = b.identity.speciesId;
      const budget = ref.species[speciesId]?.abilityIncreases?.points ?? 0;
      const choiceRef = `${speciesId}#choice`;
      const allocated = b.abilities.increases.filter((i) => i.ref === choiceRef);
      if (action.delta === 1) {
        if (allocated.reduce((s, i) => s + i.amount, 0) >= budget) break; // budget spent
        b.abilities.increases.push({ source: 'species', ref: choiceRef, ability: action.ability, amount: 1 });
      } else {
        const idx = b.abilities.increases.findIndex((i) => i.ref === choiceRef && i.ability === action.ability);
        if (idx >= 0) b.abilities.increases.splice(idx, 1);
      }
      break;
    }

    case 'setBackground':
      b.identity.backgroundId = action.backgroundId;
      break;

    case 'setClass': {
      b.levels = [{ n: 1, classId: action.classId, archetypeId: null, hp: 'avg', choices: {} }];
      b.proficiencies.savingThrows = [...(ref.classes[action.classId]?.saves ?? [])];
      break;
    }

    case 'setBaseAbilities':
      b.abilities.base = { ...action.base };
      break;

    case 'toggleSkill': {
      const i = b.proficiencies.skills.indexOf(action.skill);
      if (i >= 0) b.proficiencies.skills.splice(i, 1);
      else b.proficiencies.skills.push(action.skill);
      break;
    }

    case 'setFeat': {
      if (b.levels.length === 0) break;
      // Feat-sourced increases are Phase 4 (ASI feats); Phase 3 records the pick.
      if (action.featId == null) delete b.levels[0].choices!.featId;
      else b.levels[0].choices = { ...(b.levels[0].choices ?? {}), featId: action.featId };
      break;
    }

    case 'addEquipment': {
      const existing = b.equipment.find((e) => e.ref === action.ref);
      if (existing) existing.qty += 1;
      else b.equipment.push({ ref: action.ref, qty: 1, equipped: true });
      break;
    }
    case 'removeEquipment': {
      const idx = b.equipment.findIndex((e) => e.ref === action.ref);
      if (idx < 0) break;
      if (b.equipment[idx].qty > 1) b.equipment[idx].qty -= 1;
      else b.equipment.splice(idx, 1);
      break;
    }
    case 'toggleEquipped': {
      const item = b.equipment.find((e) => e.ref === action.ref);
      if (item) item.equipped = !item.equipped;
      break;
    }
    case 'setCredits':
      b.credits = Math.max(0, action.credits);
      break;

    case 'togglePower': {
      const idx = b.knownPowers.indexOf(action.powerId);
      if (idx >= 0) { b.knownPowers.splice(idx, 1); break; } // removal always allowed
      const power = ref.powers[action.powerId];
      if (!power) break;
      if (!houseRuled(b, 'powers')) {
        const track = derived.casting[power.castType];
        const sameTrackKnown = b.knownPowers.filter((id) => ref.powers[id]?.castType === power.castType).length;
        if (track.classes === 0) break;
        if (power.level > track.maxPowerLevel) break;
        if (sameTrackKnown >= track.knownMax) break;
      }
      b.knownPowers.push(action.powerId);
      break;
    }

    case 'toggleManeuver': {
      const idx = b.knownManeuvers.indexOf(action.maneuverId);
      if (idx >= 0) { b.knownManeuvers.splice(idx, 1); break; }
      if (!houseRuled(b, 'powers')) {
        const cap = derived.superiority?.knownMax ?? 0;
        if (b.knownManeuvers.length >= cap) break;
      }
      b.knownManeuvers.push(action.maneuverId);
      break;
    }

    case 'toggleHouseRule': {
      const list = b.houseRuled ?? [];
      const i = list.indexOf(action.step);
      if (i >= 0) list.splice(i, 1);
      else list.push(action.step);
      b.houseRuled = list;
      break;
    }
  }
  return b;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test apps/swdnd/src/lib/buildState.test.ts` — Expected: PASS (7 pass).

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/buildState.ts apps/swdnd/src/lib/buildState.test.ts
git commit -m "feat(swdnd): pure build-state mutations"
```

---

## Task 6: Step validation

**Files:**
- Create: `apps/swdnd/src/lib/validation.ts`
- Test: `apps/swdnd/src/lib/validation.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/swdnd/src/lib/validation.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild, type DerivedSheet, type ReferenceData, type RefClass, type RefSpecies } from './rules/types';
import { stepStatus, STEP_ORDER } from './validation';

const consular: RefClass = {
  id: 'consular', name: 'Consular', hitDie: 6, saves: ['wis', 'cha'],
  skillChoices: ['ins', 'lor', 'per'], skillNumber: 2,
  powercasting: { force: 'full', tech: 'none' }, superiorityProgression: 0, description: '',
};
const human: RefSpecies = { id: 'human', name: 'Human', walkSpeed: 30, description: '', abilityIncreases: { fixed: {}, points: 4 } };
const ref = {
  classes: { consular }, species: { human }, archetypes: {}, armor: {}, weapons: {},
  // Test 5 counts known powers per-track via ref lookup, so its ids must exist here.
  powers: {
    a: { id: 'a', name: 'A', level: 1, castType: 'force', description: '' },
    b: { id: 'b', name: 'B', level: 1, castType: 'force', description: '' },
    c: { id: 'c', name: 'C', level: 1, castType: 'force', description: '' },
  },
  backgrounds: { jedi: { id: 'jedi', name: 'Jedi', description: '', featureName: null, skillProse: null, toolProse: null, equipmentProse: null } },
  feats: {}, maneuvers: {}, gear: {},
} as unknown as ReferenceData;
const derived = (forceKnownMax = 9, superiority: DerivedSheet['superiority'] = null) => ({
  casting: {
    force: { classes: forceKnownMax > 0 ? 1 : 0, knownMax: forceKnownMax, maxPowerLevel: 1 },
    tech: { classes: 0, knownMax: 0, maxPowerLevel: 0 },
  },
  superiority,
} as unknown as DerivedSheet);

test('empty build: identity steps untouched, feats optional-done', () => {
  const s = stepStatus(emptyBuild('x'), ref, derived(0));
  expect(STEP_ORDER).toEqual(['species', 'background', 'class', 'abilities', 'skills', 'feats', 'equipment', 'powers']);
  expect(s.species.state).toBe('untouched');
  expect(s.background.state).toBe('untouched');
  expect(s.class.state).toBe('untouched');
  expect(s.abilities.state).toBe('untouched');
  expect(s.feats.state).toBe('done'); // optional
  expect(s.equipment.state).toBe('untouched');
  expect(s.powers.applicable).toBe(false); // no casting, no superiority
});

test('species with unallocated free points needs attention', () => {
  const b = emptyBuild('x');
  b.identity.speciesId = 'human'; // 4 free points, none allocated
  const s = stepStatus(b, ref, derived(0));
  expect(s.species.state).toBe('attention');
  b.abilities.increases = Array.from({ length: 4 }, (_, i) => ({
    source: 'species' as const, ref: 'human#choice', ability: 'wis' as const, amount: 1,
  }));
  expect(stepStatus(b, ref, derived(0)).species.state).toBe('done');
});

test('skills: partial is attention, at class count is done', () => {
  const b = emptyBuild('x');
  b.levels = [{ n: 1, classId: 'consular', archetypeId: null, hp: 'avg' }];
  b.proficiencies.skills = ['ins'];
  expect(stepStatus(b, ref, derived(9)).skills.state).toBe('attention'); // 1 of 2
  b.proficiencies.skills = ['ins', 'lor'];
  expect(stepStatus(b, ref, derived(9)).skills.state).toBe('done');
  expect(stepStatus(b, ref, derived(9)).skills.summary).toContain('2/2');
});

test('abilities done when any base differs from 10', () => {
  const b = emptyBuild('x');
  expect(stepStatus(b, ref, derived(0)).abilities.state).toBe('untouched');
  b.abilities.base.wis = 15;
  expect(stepStatus(b, ref, derived(0)).abilities.state).toBe('done');
});

test('powers: untouched at 0, attention when partial/over, done at knownMax; house-rule = presence only', () => {
  const b = emptyBuild('x');
  b.levels = [{ n: 1, classId: 'consular', archetypeId: null, hp: 'avg' }];
  const d = derived(2);
  expect(stepStatus(b, ref, d).powers.state).toBe('untouched');
  b.knownPowers = ['a'];
  expect(stepStatus(b, ref, d).powers.state).toBe('attention'); // 1 of 2
  b.knownPowers = ['a', 'b'];
  expect(stepStatus(b, ref, d).powers.state).toBe('done');
  b.knownPowers = ['a', 'b', 'c'];
  expect(stepStatus(b, ref, d).powers.state).toBe('attention'); // over
  b.houseRuled = ['powers'];
  expect(stepStatus(b, ref, d).powers.state).toBe('done'); // presence-only when unlocked
});

test('powers applicable for superiority-only user (Fighter L1)', () => {
  const b = emptyBuild('x');
  const d = derived(0, { level: 1, diceMax: 2, die: 'd4', knownMax: 1 });
  const s = stepStatus(b, ref, d);
  expect(s.powers.applicable).toBe(true);
  b.knownManeuvers = ['m1'];
  expect(stepStatus(b, ref, d).powers.state).toBe('done');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test apps/swdnd/src/lib/validation.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// apps/swdnd/src/lib/validation.ts
import type { CharacterBuild, DerivedSheet, ReferenceData } from './rules/types';

export type StepKey =
  | 'species' | 'background' | 'class' | 'abilities'
  | 'skills' | 'feats' | 'equipment' | 'powers';
export const STEP_ORDER: StepKey[] = [
  'species', 'background', 'class', 'abilities', 'skills', 'feats', 'equipment', 'powers',
];

export type StepState = 'done' | 'attention' | 'untouched';
export interface StepInfo {
  state: StepState;
  summary: string;
  /** false → the UI hides the step (e.g. Powers for a non-caster non-superiority build). */
  applicable: boolean;
}

const info = (state: StepState, summary: string, applicable = true): StepInfo => ({ state, summary, applicable });

export function stepStatus(
  build: CharacterBuild,
  ref: ReferenceData,
  derived: DerivedSheet,
): Record<StepKey, StepInfo> {
  const houseRuled = new Set(build.houseRuled ?? []);

  // Species: done when chosen AND its free points are fully allocated.
  const species = ref.species[build.identity.speciesId];
  const speciesPoints = species?.abilityIncreases?.points ?? 0;
  const allocated = build.abilities.increases
    .filter((i) => i.ref === `${build.identity.speciesId}#choice`)
    .reduce((s, i) => s + i.amount, 0);
  const speciesInfo = !build.identity.speciesId
    ? info('untouched', '—')
    : allocated < speciesPoints
      ? info('attention', `${species?.name ?? build.identity.speciesId} · ${speciesPoints - allocated} pts left`)
      : info('done', species?.name ?? build.identity.speciesId);

  const background = ref.backgrounds[build.identity.backgroundId];
  const backgroundInfo = build.identity.backgroundId
    ? info('done', background?.name ?? build.identity.backgroundId)
    : info('untouched', '—');

  const classId = build.levels[0]?.classId;
  const cls = classId ? ref.classes[classId] : undefined;
  const classInfo = classId ? info('done', cls?.name ?? classId) : info('untouched', '—');

  const touchedAbilities = Object.values(build.abilities.base).some((v) => v !== 10);
  const abilitiesInfo = touchedAbilities ? info('done', 'set') : info('untouched', '—');

  const needSkills = cls?.skillNumber ?? 0;
  const haveSkills = build.proficiencies.skills.length;
  const skillsInfo =
    haveSkills === 0
      ? info('untouched', needSkills ? `0/${needSkills}` : '—')
      : haveSkills < needSkills
        ? info('attention', `${haveSkills}/${needSkills}`)
        : info('done', `${haveSkills}/${needSkills || haveSkills}`);

  const featId = build.levels[0]?.choices?.featId as string | undefined;
  const featsInfo = info('done', featId ? (ref.feats[featId]?.name ?? String(featId)) : 'optional');

  const equipmentInfo =
    build.equipment.length > 0 || build.credits > 0
      ? info('done', `${build.equipment.length} items · ${build.credits} ₡`)
      : info('untouched', '—');

  // Powers & Maneuvers.
  const force = derived.casting.force;
  const tech = derived.casting.tech;
  const supMax = derived.superiority?.knownMax ?? 0;
  const applicable = force.knownMax > 0 || tech.knownMax > 0 || supMax > 0;
  const forceKnown = build.knownPowers.filter((id) => ref.powers[id]?.castType === 'force').length;
  const techKnown = build.knownPowers.filter((id) => ref.powers[id]?.castType === 'tech').length;
  const manKnown = build.knownManeuvers.length;
  const parts: string[] = [];
  if (force.knownMax > 0) parts.push(`force ${forceKnown}/${force.knownMax}`);
  if (tech.knownMax > 0) parts.push(`tech ${techKnown}/${tech.knownMax}`);
  if (supMax > 0) parts.push(`maneuvers ${manKnown}/${supMax}`);
  const summary = parts.join(' · ') || '—';
  let powersState: StepState;
  const anyPicked = forceKnown + techKnown + manKnown > 0;
  if (!applicable) powersState = 'done';
  else if (houseRuled.has('powers')) powersState = anyPicked ? 'done' : 'untouched';
  else if (!anyPicked) powersState = 'untouched';
  else {
    const exact =
      (force.knownMax === 0 || forceKnown === force.knownMax) &&
      (tech.knownMax === 0 || techKnown === tech.knownMax) &&
      (supMax === 0 || manKnown === supMax) &&
      forceKnown <= force.knownMax && techKnown <= tech.knownMax && manKnown <= supMax;
    powersState = exact ? 'done' : 'attention';
  }
  const powersInfo: StepInfo = { state: powersState, summary, applicable };

  return {
    species: speciesInfo,
    background: backgroundInfo,
    class: classInfo,
    abilities: abilitiesInfo,
    skills: skillsInfo,
    feats: featsInfo,
    equipment: equipmentInfo,
    powers: powersInfo,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test apps/swdnd/src/lib/validation.test.ts` — Expected: PASS (6 pass).
Note: the "over-cap" attention case requires powers picked above `knownMax`, reachable only via house-rule then re-lock — the test drives `knownPowers` directly, which is fine (validation is pure).

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/validation.ts apps/swdnd/src/lib/validation.test.ts
git commit -m "feat(swdnd): pure step validation"
```

---

## Task 7: useBuilder hook

**Files:**
- Create: `apps/swdnd/src/hooks/useBuilder.ts`

Context: mirrors `useCharacterSheet` (read it first). IO/orchestration — verified by build, not unit tests. No WS subscription (the builder is single-editor by nature; the sheet ignores build changes anyway). When `identity.name` changes, the PATCH also updates the row `name`.

- [ ] **Step 1: Implement**

```ts
// apps/swdnd/src/hooks/useBuilder.ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getCharacter, loadReference, patchCharacter, type CharacterDto } from '../lib/characters';
import { useAuth } from '../lib/auth';
import { resolveCanEdit } from '../lib/canEdit';
import { applyBuildAction, type BuildAction } from '../lib/buildState';
import { stepStatus, type StepKey, type StepInfo } from '../lib/validation';
import { computeSheet } from '../lib/rules';
import type { CharacterBuild, DerivedSheet, ReferenceData } from '../lib/rules/types';

export interface BuilderState {
  loading: boolean;
  error: string | null;
  build: CharacterBuild | null;
  derived: DerivedSheet | null;
  ref: ReferenceData | null;
  status: Record<StepKey, StepInfo> | null;
  canEdit: boolean;
  dto: CharacterDto | null;
  saving: boolean;
  dispatch: (action: BuildAction) => void;
}

const SAVE_DEBOUNCE_MS = 500;

export function useBuilder(characterId: string): BuilderState {
  const { authed } = useAuth();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [dto, setDto] = useState<CharacterDto | null>(null);
  const [build, setBuild] = useState<CharacterBuild | null>(null);
  const [ref, setRef] = useState<ReferenceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([getCharacter(characterId), loadReference()])
      .then(([character, reference]) => {
        if (!alive) return;
        setDto(character);
        setBuild(character.data_json);
        setRef(reference);
        setError(null);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [characterId]);

  const derived = useMemo(() => (build && ref ? computeSheet(build, ref) : null), [build, ref]);
  const status = useMemo(
    () => (build && ref && derived ? stepStatus(build, ref, derived) : null),
    [build, ref, derived],
  );

  const canEdit = resolveCanEdit({ admin: authed, token });

  const dispatch = useCallback(
    (action: BuildAction) => {
      if (!canEdit || !build || !ref || !derived) return;
      const next = applyBuildAction(build, ref, derived, action);
      setBuild(next);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaving(true);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        void patchCharacter(characterId, { name: next.identity.name || undefined, data_json: next }, token ?? undefined)
          .then(() => setError(null))
          .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Save failed'))
          .finally(() => setSaving(false));
      }, SAVE_DEBOUNCE_MS);
    },
    [canEdit, build, ref, derived, characterId, token],
  );

  return { loading, error, build, derived, ref, status, canEdit, dto, saving, dispatch };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/swdnd && bun run build` — Expected: success.

- [ ] **Step 3: Commit**

```bash
git add apps/swdnd/src/hooks/useBuilder.ts
git commit -m "feat(swdnd): useBuilder hook"
```

---

## Task 8: Player landing (`/player`)

**Files:**
- Create: `apps/swdnd/src/panels/PlayerHome/index.tsx`
- Modify: `apps/swdnd/src/App.tsx`

Context: token-driven landing per spec §3. Fetches the player + their characters via `getPlayerByToken`, then each full character (parallel `getCharacter` — N is small) to show class line + step completeness. Uses only existing routes. Follow the Holoterminal utilities. Read `App.tsx` first; add the route without disturbing existing ones.

- [ ] **Step 1: Implement the panel**

```tsx
// apps/swdnd/src/panels/PlayerHome/index.tsx
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  createCharacter, deleteCharacter, getCharacter, getPlayerByToken, loadReference,
  type CharacterDto, type PlayerDto,
} from '../../lib/characters';
import { classSummary } from '../../lib/sheetView';
import { computeSheet } from '../../lib/rules';
import { stepStatus, STEP_ORDER } from '../../lib/validation';
import type { ReferenceData } from '../../lib/rules/types';

interface RowData {
  dto: CharacterDto;
  classLine: string;
  stepsDone: number;
  stepsTotal: number;
}

function toRow(dto: CharacterDto, ref: ReferenceData): RowData {
  const derived = computeSheet(dto.data_json, ref);
  const status = stepStatus(dto.data_json, ref, derived);
  const applicable = STEP_ORDER.filter((k) => status[k].applicable);
  return {
    dto,
    classLine: classSummary(dto.data_json, ref) || 'no class yet',
    stepsDone: applicable.filter((k) => status[k].state === 'done').length,
    stepsTotal: applicable.length,
  };
}

export default function PlayerHome() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();

  const [player, setPlayer] = useState<PlayerDto | null>(null);
  const [rows, setRows] = useState<RowData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    Promise.all([getPlayerByToken(token), loadReference()])
      .then(async ([me, ref]) => {
        setPlayer(me.player);
        const dtos = await Promise.all(me.characters.map((c) => getCharacter(c.id)));
        setRows(dtos.map((d) => toRow(d, ref)));
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };
  useEffect(reload, [token]);

  const create = async () => {
    if (!player || !newName.trim()) return;
    const c = await createCharacter(player.campaign_id, newName.trim(), token);
    navigate(`/sheet/${c.id}/build?token=${encodeURIComponent(token)}`);
  };
  const remove = async (id: string) => {
    await deleteCharacter(id, token);
    setConfirmDelete(null);
    reload();
  };

  if (!token) return <div className="p-6 font-mono text-red-400">Missing player token.</div>;
  if (loading) return <div className="p-6 font-mono text-ht-muted">Loading…</div>;
  if (error || !player) return <div className="p-6 font-mono text-red-400">{error ?? 'Unknown player'}</div>;

  return (
    <div className="ht-screen min-h-screen p-4 font-mono text-ht-text">
      <div className="ht-glow mb-3 rounded-md p-3">
        <div className="ht-name text-sm font-bold">{player.name}</div>
        <div className="text-[10px] text-ht-muted">your characters</div>
      </div>

      <div className="flex flex-col gap-2">
        {rows.length === 0 && <div className="text-[11px] text-ht-muted">No characters yet — create your first below.</div>}
        {rows.map(({ dto, classLine, stepsDone, stepsTotal }) => (
          <div key={dto.id} className="ht-panel flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-[140px]">
              <div className="text-ht-bright">{dto.name}</div>
              <div className="text-[10px] text-ht-muted">{classLine}</div>
            </div>
            <div className="text-[10px] text-ht-muted">
              {stepsDone === stepsTotal ? '✓ build complete' : `${stepsDone}/${stepsTotal} steps`}
            </div>
            <div className="ml-auto flex items-center gap-2 text-[11px]">
              <a className="ht-step" href={`/sheet/${dto.id}?token=${encodeURIComponent(token)}`}>sheet</a>
              <a className="ht-step" href={`/sheet/${dto.id}/build?token=${encodeURIComponent(token)}`}>build</a>
              {confirmDelete === dto.id ? (
                <span>
                  <button type="button" className="ht-step text-red-400" onClick={() => void remove(dto.id)}>confirm ✕</button>
                  <button type="button" className="ht-step" onClick={() => setConfirmDelete(null)}>keep</button>
                </span>
              ) : (
                <button type="button" className="text-[10px] text-ht-muted" onClick={() => setConfirmDelete(dto.id)}>delete</button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="ht-panel mt-3 flex items-center gap-2 p-3">
        <span className="ht-label">New character</span>
        <input
          className="w-48 border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none"
          placeholder="name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void create()}
        />
        <button type="button" className="ht-step" onClick={() => void create()}>+ create &amp; build</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the route**

In `apps/swdnd/src/App.tsx`: `import PlayerHome from "./panels/PlayerHome";` and inside `<Routes>` (after the Landing route):

```tsx
<Route path="/player" element={<SinglePanel><PlayerHome /></SinglePanel>} />
```

- [ ] **Step 3: Typecheck + commit**

Run: `cd apps/swdnd && bun run build` — Expected: success.

```bash
git add apps/swdnd/src/panels/PlayerHome/index.tsx apps/swdnd/src/App.tsx
git commit -m "feat(swdnd): player landing at /player"
```

---

## Task 9: Builder shell + step rail + mode wiring

**Files:**
- Create: `apps/swdnd/src/panels/CharacterSheet/Builder/index.tsx`, `apps/swdnd/src/panels/CharacterSheet/Builder/StepRail.tsx`
- Modify: `apps/swdnd/src/panels/CharacterSheet/index.tsx`

- [ ] **Step 1: StepRail**

```tsx
// apps/swdnd/src/panels/CharacterSheet/Builder/StepRail.tsx
import { STEP_ORDER, type StepInfo, type StepKey } from '../../../lib/validation';

const LABELS: Record<StepKey, string> = {
  species: 'Species', background: 'Background', class: 'Class', abilities: 'Abilities',
  skills: 'Skills', feats: 'Feats', equipment: 'Equipment', powers: 'Powers',
};
const GLYPH = { done: '✓', attention: '!', untouched: '○' } as const;
const GLYPH_CLASS = { done: 'text-green-300', attention: 'text-yellow-300', untouched: 'text-ht-muted' } as const;

interface Props {
  status: Record<StepKey, StepInfo>;
  active: StepKey;
  houseRuled: string[];
  onSelect: (step: StepKey) => void;
}

export default function StepRail({ status, active, houseRuled, onSelect }: Props) {
  const steps = STEP_ORDER.filter((k) => status[k].applicable);
  const remaining = steps.filter((k) => status[k].state !== 'done').length;
  return (
    <nav className="flex flex-col gap-1 @lg:min-w-[190px]">
      <div className="flex gap-1 overflow-x-auto @lg:flex-col @lg:overflow-visible">
        {steps.map((k) => {
          const s = status[k];
          const isActive = k === active;
          return (
            <button
              key={k}
              type="button"
              onClick={() => onSelect(k)}
              className={`flex shrink-0 items-center gap-2 px-2 py-1 text-left text-[11px] ${
                isActive ? 'ht-glow text-ht-bright' : 'ht-panel text-ht-muted'
              }`}
            >
              <span className={GLYPH_CLASS[s.state]}>{GLYPH[s.state]}</span>
              <span>{LABELS[k]}</span>
              {houseRuled.includes(k) && <span title="house-ruled">⌂</span>}
              <span className="ml-auto pl-2 text-[9px] text-ht-muted">{s.summary}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-1 hidden text-[10px] text-ht-muted @lg:block">
        {remaining === 0 ? '✓ all steps complete' : `${remaining} step${remaining === 1 ? '' : 's'} remaining`}
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Builder shell** (steps land in Tasks 11–15; use a placeholder switch for now)

```tsx
// apps/swdnd/src/panels/CharacterSheet/Builder/index.tsx
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useBuilder } from '../../../hooks/useBuilder';
import { factionStyle } from '../../../lib/faction';
import type { StepKey } from '../../../lib/validation';
import StepRail from './StepRail';

export default function Builder({ characterId }: { characterId: string }) {
  const b = useBuilder(characterId);
  const [active, setActive] = useState<StepKey>('species');
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const sheetHref = `/sheet/${characterId}${token ? `?token=${encodeURIComponent(token)}` : ''}`;

  if (b.loading) return <div className="p-6 font-mono text-ht-muted">Loading builder…</div>;
  if (!b.build || !b.derived || !b.ref || !b.status) {
    return <div className="p-6 font-mono text-red-400">{b.error ?? 'Character not found'}</div>;
  }
  if (!b.canEdit) {
    return (
      <div className="p-6 font-mono text-ht-muted">
        Read-only link — the builder needs an owner token. <a className="text-ht-accent" href={sheetHref}>◂ view the sheet</a>
      </div>
    );
  }

  return (
    <div className="@container ht-screen min-h-screen p-3 font-mono text-ht-text" style={factionStyle(b.build.identity.alignment)}>
      {b.error && (
        <div className="mb-2 rounded border border-red-400/60 bg-red-950/40 px-3 py-1.5 text-[11px] text-red-300">
          ⚠ {b.error} — changes may not be saved
        </div>
      )}
      <div className="ht-glow mb-3 flex flex-wrap items-center gap-3 rounded-md p-3">
        <input
          className="ht-name w-56 border-b border-ht-line bg-transparent text-sm font-bold outline-none"
          value={b.build.identity.name}
          placeholder="character name…"
          onChange={(e) => b.dispatch({ t: 'setName', name: e.target.value })}
        />
        <span className="text-[10px] text-ht-muted">building level 1</span>
        <span className="ml-auto text-[10px] text-ht-muted">
          {b.saving ? 'saving…' : 'auto-saved ✓'} · <a className="text-ht-accent" href={sheetHref}>◂ back to sheet</a>
        </span>
      </div>

      <div className="flex flex-col gap-3 @lg:flex-row">
        <StepRail status={b.status} active={active} houseRuled={b.build.houseRuled ?? []} onSelect={setActive} />
        <div className="min-w-0 flex-1">
          {/* Step components replace this in Tasks 11–15 */}
          <div className="ht-panel p-4 text-[11px] text-ht-muted">step: {active} — coming in the next tasks</div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire build mode**

In `apps/swdnd/src/panels/CharacterSheet/index.tsx`, replace the Phase-3 placeholder branch:

```tsx
import Builder from './Builder';
// ...
  if (mode === 'build') {
    return <Builder key={characterId} characterId={characterId} />;
  }
```

(Keep the existing `key`ed `<Sheet>` return.)

- [ ] **Step 4: Typecheck + commit**

Run: `cd apps/swdnd && bun run build` — Expected: success.

```bash
git add apps/swdnd/src/panels/CharacterSheet/Builder apps/swdnd/src/panels/CharacterSheet/index.tsx
git commit -m "feat(swdnd): builder shell + step rail"
```

---

## Task 10: Generic StepTable

**Files:**
- Create: `apps/swdnd/src/panels/CharacterSheet/Builder/StepTable.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/swdnd/src/panels/CharacterSheet/Builder/StepTable.tsx
import { useMemo, useState, type ReactNode } from 'react';

export interface Column<T> {
  key: string;
  label: string;
  flex?: number;
  value: (item: T) => string | number;
}

interface Props<T> {
  items: T[];
  columns: Column<T>[];
  idOf: (item: T) => string;
  searchText: (item: T) => string;
  detail: (item: T) => ReactNode;
  isSelected: (item: T) => boolean;
  onSelect: (item: T) => void;
  selectLabel?: (item: T) => string;
  /** Optional strip above the table (counters, filters, unlock toggle). */
  header?: ReactNode;
  editable: boolean;
}

export default function StepTable<T>({
  items, columns, idOf, searchText, detail, isSelected, onSelect, selectLabel, header, editable,
}: Props<T>) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState(columns[0]?.key ?? '');
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const col = columns.find((c) => c.key === sortKey) ?? columns[0];
    const filtered = q ? items.filter((i) => searchText(i).toLowerCase().includes(q)) : [...items];
    // Selected rows pin to the top; the rest sort by the active column.
    return filtered.sort((a, b) => {
      const sel = Number(isSelected(b)) - Number(isSelected(a));
      if (sel !== 0) return sel;
      const av = col.value(a);
      const bv = col.value(b);
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return cmp * sortDir;
    });
  }, [items, columns, query, sortKey, sortDir, searchText, isSelected]);

  const toggleSort = (key: string) => {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(1);
    }
  };

  return (
    <div className="flex flex-col gap-1 text-[11px]">
      {header}
      <input
        className="ht-panel w-full px-2 py-1 text-ht-bright outline-none placeholder:text-ht-muted"
        placeholder={`⌕ search ${items.length} entries…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="ht-label flex gap-2 px-2">
        {columns.map((c) => (
          <button key={c.key} type="button" style={{ flex: c.flex ?? 1 }} className="text-left"
            onClick={() => toggleSort(c.key)}>
            {c.label}{sortKey === c.key ? (sortDir === 1 ? ' ▴' : ' ▾') : ''}
          </button>
        ))}
      </div>
      <div className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto pr-1">
        {visible.map((item) => {
          const id = idOf(item);
          const selected = isSelected(item);
          const open = expanded === id;
          return (
            <div key={id} className={selected || open ? 'ht-glow' : 'ht-panel'}>
              <button type="button" className="flex w-full gap-2 px-2 py-1 text-left"
                onClick={() => setExpanded(open ? null : id)}>
                {columns.map((c, i) => (
                  <span key={c.key} style={{ flex: c.flex ?? 1 }}
                    className={i === 0 ? (selected ? 'text-ht-bright' : 'text-ht-text') : 'text-ht-muted'}>
                    {i === 0 && selected ? '◈ ' : ''}{c.value(item)}{i === 0 && open ? ' ▾' : ''}
                  </span>
                ))}
              </button>
              {open && (
                <div className="border-t border-ht-line px-3 py-2">
                  <div className="whitespace-pre-line text-ht-muted">{detail(item)}</div>
                  {editable && (
                    <div className="mt-2 text-right">
                      <button type="button" className="ht-step" onClick={() => onSelect(item)}>
                        {selectLabel ? selectLabel(item) : selected ? '✕ remove' : '✓ select'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {visible.length === 0 && <div className="p-2 text-ht-muted">No matches.</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `cd apps/swdnd && bun run build` — Expected: success.

```bash
git add apps/swdnd/src/panels/CharacterSheet/Builder/StepTable.tsx
git commit -m "feat(swdnd): generic searchable/sortable step table"
```

---

## Task 11: Species + Background steps

**Files:**
- Create: `apps/swdnd/src/panels/CharacterSheet/Builder/steps/Species.tsx`, `.../steps/Background.tsx`
- Modify: `apps/swdnd/src/panels/CharacterSheet/Builder/index.tsx` (mount them)

- [ ] **Step 1: Species step** (table + free-point allocator)

```tsx
// apps/swdnd/src/panels/CharacterSheet/Builder/steps/Species.tsx
import type { BuildAction } from '../../../../lib/buildState';
import type { AbilityKey, CharacterBuild, ReferenceData, RefSpecies } from '../../../../lib/rules/types';
import StepTable from '../StepTable';

const ABILITIES: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

function asiLabel(s: RefSpecies): string {
  const inc = s.abilityIncreases;
  if (!inc) return '—';
  const fixed = Object.entries(inc.fixed).map(([a, n]) => `+${n} ${a.toUpperCase()}`);
  if (inc.points > 0) fixed.push(`+${inc.points} free`);
  return fixed.join(', ') || '—';
}

interface Props {
  build: CharacterBuild;
  ref: ReferenceData;
  editable: boolean;
  dispatch: (a: BuildAction) => void;
}

export default function SpeciesStep({ build, ref, editable, dispatch }: Props) {
  const chosen = ref.species[build.identity.speciesId];
  const points = chosen?.abilityIncreases?.points ?? 0;
  const choiceRef = `${build.identity.speciesId}#choice`;
  const allocatedBy = (a: AbilityKey) =>
    build.abilities.increases.filter((i) => i.ref === choiceRef && i.ability === a).reduce((s, i) => s + i.amount, 0);
  const allocated = ABILITIES.reduce((s, a) => s + allocatedBy(a), 0);

  return (
    <StepTable
      items={Object.values(ref.species)}
      columns={[
        { key: 'name', label: 'Name', flex: 1.4, value: (s) => s.name },
        { key: 'asi', label: 'Ability Increase', flex: 1.2, value: asiLabel },
        { key: 'speed', label: 'Speed', flex: 0.5, value: (s) => s.walkSpeed },
      ]}
      idOf={(s) => s.id}
      searchText={(s) => s.name}
      isSelected={(s) => s.id === build.identity.speciesId}
      onSelect={(s) => dispatch({ t: 'setSpecies', speciesId: s.id })}
      selectLabel={(s) => (s.id === build.identity.speciesId ? '◈ selected' : '✓ select species')}
      detail={(s) => s.description || 'No description in the source data.'}
      editable={editable}
      header={
        chosen && points > 0 ? (
          <div className="ht-glow flex flex-wrap items-center gap-2 rounded p-2">
            <span className="ht-label">{chosen.name} free points · {points - allocated} left</span>
            {ABILITIES.map((a) => (
              <span key={a} className="flex items-center gap-1">
                <span className="text-ht-muted">{a.toUpperCase()}</span>
                {editable && <button type="button" className="ht-step" onClick={() => dispatch({ t: 'allocateSpeciesPoint', ability: a, delta: -1 })}>−</button>}
                <b className="text-ht-bright">{allocatedBy(a)}</b>
                {editable && <button type="button" className="ht-step" onClick={() => dispatch({ t: 'allocateSpeciesPoint', ability: a, delta: 1 })}>+</button>}
              </span>
            ))}
          </div>
        ) : null
      }
    />
  );
}
```

- [ ] **Step 2: Background step**

```tsx
// apps/swdnd/src/panels/CharacterSheet/Builder/steps/Background.tsx
import type { BuildAction } from '../../../../lib/buildState';
import type { CharacterBuild, ReferenceData } from '../../../../lib/rules/types';
import StepTable from '../StepTable';

interface Props {
  build: CharacterBuild;
  ref: ReferenceData;
  editable: boolean;
  dispatch: (a: BuildAction) => void;
}

export default function BackgroundStep({ build, ref, editable, dispatch }: Props) {
  return (
    <StepTable
      items={Object.values(ref.backgrounds)}
      columns={[
        { key: 'name', label: 'Name', flex: 1, value: (b) => b.name },
        { key: 'feature', label: 'Feature', flex: 1.4, value: (b) => b.featureName ?? '—' },
      ]}
      idOf={(b) => b.id}
      searchText={(b) => `${b.name} ${b.featureName ?? ''}`}
      isSelected={(b) => b.id === build.identity.backgroundId}
      onSelect={(b) => dispatch({ t: 'setBackground', backgroundId: b.id })}
      selectLabel={(b) => (b.id === build.identity.backgroundId ? '◈ selected' : '✓ select background')}
      detail={(b) => [
        b.skillProse && `SKILLS · ${b.skillProse}`,
        b.toolProse && `TOOLS · ${b.toolProse}`,
        b.equipmentProse && `EQUIPMENT · ${b.equipmentProse}`,
        b.description,
        'Apply the skill/tool grants in the Skills step; grab the gear in Equipment.',
      ].filter(Boolean).join('\n')}
      editable={editable}
    />
  );
}
```

- [ ] **Step 3: Mount in the shell**

In `Builder/index.tsx`, import both steps and replace the placeholder `<div className="ht-panel p-4 …">` with a switch:

```tsx
          {active === 'species' && <SpeciesStep build={b.build} ref={b.ref} editable={b.canEdit} dispatch={b.dispatch} />}
          {active === 'background' && <BackgroundStep build={b.build} ref={b.ref} editable={b.canEdit} dispatch={b.dispatch} />}
          {!['species', 'background'].includes(active) && (
            <div className="ht-panel p-4 text-[11px] text-ht-muted">step: {active} — coming in the next tasks</div>
          )}
```

- [ ] **Step 4: Typecheck + commit**

Run: `cd apps/swdnd && bun run build` — Expected: success.

```bash
git add apps/swdnd/src/panels/CharacterSheet/Builder
git commit -m "feat(swdnd): species + background steps"
```

---

## Task 12: Class + Skills steps

**Files:**
- Create: `.../steps/Class.tsx`, `.../steps/Skills.tsx`
- Modify: `Builder/index.tsx`

- [ ] **Step 1: Class step**

```tsx
// apps/swdnd/src/panels/CharacterSheet/Builder/steps/Class.tsx
import type { BuildAction } from '../../../../lib/buildState';
import type { CharacterBuild, ReferenceData, RefClass } from '../../../../lib/rules/types';
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

export default function ClassStep({ build, ref, editable, dispatch }: Props) {
  const chosenId = build.levels[0]?.classId;
  return (
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
      isSelected={(c) => c.id === chosenId}
      onSelect={(c) => dispatch({ t: 'setClass', classId: c.id })}
      selectLabel={(c) => (c.id === chosenId ? '◈ selected' : '✓ choose class')}
      detail={(c) => [
        `SAVES · ${c.saves.map((s) => s.toUpperCase()).join(', ')}   SKILLS · pick ${c.skillNumber}`,
        c.description || 'No description in the source data.',
        chosenId && chosenId !== c.id ? '⚠ changing class re-flags your Skills and Powers steps.' : null,
      ].filter(Boolean).join('\n')}
      editable={editable}
    />
  );
}
```

- [ ] **Step 2: Skills step** (all 18, class options highlighted; guidance not lock, per spec)

```tsx
// apps/swdnd/src/panels/CharacterSheet/Builder/steps/Skills.tsx
import { SKILLS } from '../../../../lib/rules/constants';
import type { BuildAction } from '../../../../lib/buildState';
import type { CharacterBuild, ReferenceData, SkillKey } from '../../../../lib/rules/types';

interface Props {
  build: CharacterBuild;
  ref: ReferenceData;
  editable: boolean;
  dispatch: (a: BuildAction) => void;
}

export default function SkillsStep({ build, ref, editable, dispatch }: Props) {
  const cls = build.levels[0] ? ref.classes[build.levels[0].classId] : undefined;
  const classSet = new Set(cls?.skillChoices ?? []);
  const bg = ref.backgrounds[build.identity.backgroundId];
  const picked = new Set(build.proficiencies.skills);

  return (
    <div className="flex flex-col gap-2 text-[11px]">
      <div className="ht-glow rounded p-2 text-ht-muted">
        <span className="ht-label">Guidance</span>{' '}
        {cls ? `${cls.name}: pick ${cls.skillNumber} from the highlighted class options.` : 'Choose a class first for its skill options.'}
        {bg?.skillProse && ` Background (${bg.name}): ${bg.skillProse}`}
      </div>
      <div className="grid grid-cols-1 gap-1 @md:grid-cols-2">
        {(Object.keys(SKILLS) as SkillKey[]).map((k) => {
          const meta = SKILLS[k];
          const isClass = classSet.has(k);
          const on = picked.has(k);
          return (
            <button
              key={k}
              type="button"
              disabled={!editable}
              onClick={() => dispatch({ t: 'toggleSkill', skill: k })}
              className={`flex items-center gap-2 px-2 py-1 text-left ${on ? 'ht-glow text-ht-bright' : 'ht-panel text-ht-muted'}`}
            >
              <span>{on ? '◈' : '·'}</span>
              <span>{meta.label} <span className="text-ht-muted">({meta.ability})</span></span>
              {isClass && <span className="ml-auto text-[9px] text-ht-accent">class option</span>}
            </button>
          );
        })}
      </div>
      <div className="text-[10px] text-ht-muted">
        picked {picked.size}{cls ? ` · class target ${cls.skillNumber}` : ''} — background/house picks beyond the target are fine
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Mount both** in `Builder/index.tsx`'s switch (same pattern as Task 11; extend the placeholder-exclusion list to `['species','background','class','skills']`).

- [ ] **Step 4: Typecheck + commit**

Run: `cd apps/swdnd && bun run build` — Expected: success.

```bash
git add apps/swdnd/src/panels/CharacterSheet/Builder
git commit -m "feat(swdnd): class + skills steps"
```

---

## Task 13: Abilities step (manual / array / point buy)

**Files:**
- Create: `.../steps/Abilities.tsx`
- Modify: `Builder/index.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/swdnd/src/panels/CharacterSheet/Builder/steps/Abilities.tsx
import { useState } from 'react';
import { STANDARD_ARRAY, POINT_BUY_BUDGET, budgetRemaining, scoreCost } from '../../../../lib/pointBuy';
import type { BuildAction } from '../../../../lib/buildState';
import type { AbilityKey, CharacterBuild, DerivedSheet } from '../../../../lib/rules/types';

const ABILITIES: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
type Mode = 'manual' | 'array' | 'pointbuy';

interface Props {
  build: CharacterBuild;
  derived: DerivedSheet;
  editable: boolean;
  dispatch: (a: BuildAction) => void;
}

export default function AbilitiesStep({ build, derived, editable, dispatch }: Props) {
  const [mode, setMode] = useState<Mode>('manual');
  const base = build.abilities.base;
  const remaining = budgetRemaining(base);

  const set = (ability: AbilityKey, value: number) =>
    dispatch({ t: 'setBaseAbilities', base: { ...base, [ability]: value } });

  const arrayValueUsed = (v: number) =>
    ABILITIES.filter((a) => base[a] === v).length >= STANDARD_ARRAY.filter((x) => x === v).length;

  return (
    <div className="flex flex-col gap-2 text-[11px]">
      <div className="flex gap-1">
        {(['manual', 'array', 'pointbuy'] as Mode[]).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)}
            className={`flex-1 px-2 py-1 ${mode === m ? 'ht-glow text-ht-bright' : 'ht-panel text-ht-muted'}`}>
            {m === 'manual' ? 'Manual (rolled)' : m === 'array' ? 'Standard array' : 'Point buy'}
          </button>
        ))}
      </div>

      {mode === 'array' && (
        <div className="ht-panel p-2 text-ht-muted">
          Assign {STANDARD_ARRAY.join(' / ')} — tap a value below each ability.
        </div>
      )}
      {mode === 'pointbuy' && (
        <div className={`p-2 ${remaining != null && remaining >= 0 ? 'ht-glow' : 'ht-panel border-yellow-400'}`}>
          <span className="ht-label">Budget</span>{' '}
          {remaining == null
            ? '⚠ a score is outside 8–15 — adjust below or switch to Manual'
            : `${remaining}/${POINT_BUY_BUDGET} points remaining`}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 @md:grid-cols-3">
        {ABILITIES.map((a) => {
          const speciesBonus = build.abilities.increases
            .filter((i) => i.source === 'species' && i.ability === a)
            .reduce((s, i) => s + i.amount, 0);
          return (
            <div key={a} className="ht-panel p-2 text-center">
              <div className="ht-label">{a}</div>
              {mode === 'manual' && (
                <input
                  type="number" min={1} max={20} disabled={!editable}
                  className="w-14 bg-transparent text-center text-base text-ht-bright outline-none"
                  value={base[a]}
                  onChange={(e) => set(a, Number(e.target.value) || 0)}
                />
              )}
              {mode === 'array' && (
                <div className="flex flex-wrap justify-center gap-1">
                  {[...new Set(STANDARD_ARRAY)].map((v) => (
                    <button key={v} type="button" disabled={!editable}
                      onClick={() => set(a, v)}
                      className={`ht-step text-[10px] ${base[a] === v ? 'text-ht-bright' : arrayValueUsed(v) ? 'opacity-40' : ''}`}>
                      {v}
                    </button>
                  ))}
                </div>
              )}
              {mode === 'pointbuy' && (
                <div className="flex items-center justify-center gap-1">
                  <button type="button" disabled={!editable} className="ht-step" onClick={() => set(a, base[a] - 1)}>−</button>
                  <b className="w-8 text-base text-ht-bright">{base[a]}</b>
                  <button type="button" disabled={!editable} className="ht-step" onClick={() => set(a, base[a] + 1)}>+</button>
                </div>
              )}
              <div className="text-[9px] text-ht-muted">
                {mode === 'pointbuy' && scoreCost(base[a]) != null && `cost ${scoreCost(base[a])}`}
                {speciesBonus > 0 && ` · species +${speciesBonus}`}
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-[10px] text-ht-muted">
        Species increases apply on top of these base scores — final values show on the sheet (max HP {derived.maxHp}).
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount** in the shell switch (pass `derived={b.derived}`; extend the exclusion list).

- [ ] **Step 3: Typecheck + commit**

Run: `cd apps/swdnd && bun run build` — Expected: success.

```bash
git add apps/swdnd/src/panels/CharacterSheet/Builder
git commit -m "feat(swdnd): abilities step (manual, array, point buy)"
```

---

## Task 14: Feats + Equipment steps

**Files:**
- Create: `.../steps/Feats.tsx`, `.../steps/Equipment.tsx`
- Modify: `Builder/index.tsx`

- [ ] **Step 1: Feats step**

```tsx
// apps/swdnd/src/panels/CharacterSheet/Builder/steps/Feats.tsx
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
  const chosen = build.levels[0]?.choices?.featId as string | undefined;
  const bg = ref.backgrounds[build.identity.backgroundId];
  return (
    <StepTable
      items={Object.values(ref.feats)}
      columns={[
        { key: 'name', label: 'Name', flex: 1.2, value: (f) => f.name },
        { key: 'req', label: 'Requirements', flex: 1, value: (f) => f.requirements ?? '—' },
      ]}
      idOf={(f) => f.id}
      searchText={(f) => `${f.name} ${f.requirements ?? ''}`}
      isSelected={(f) => f.id === chosen}
      onSelect={(f) => dispatch({ t: 'setFeat', featId: f.id === chosen ? null : f.id })}
      selectLabel={(f) => (f.id === chosen ? '✕ clear feat' : '✓ take feat')}
      detail={(f) => f.description || 'No description in the source data.'}
      editable={editable}
      header={
        <div className="ht-panel p-2 text-[10px] text-ht-muted">
          Optional at level 1{bg ? ` — your background (${bg.name}) suggests feat options in its description` : ''}.
          Mechanical effects of feats land with the builder's progression phase; the pick is recorded on the build.
        </div>
      }
    />
  );
}
```

- [ ] **Step 2: Equipment step**

```tsx
// apps/swdnd/src/panels/CharacterSheet/Builder/steps/Equipment.tsx
import { useState } from 'react';
import type { BuildAction } from '../../../../lib/buildState';
import type { CharacterBuild, ReferenceData } from '../../../../lib/rules/types';
import StepTable from '../StepTable';

type Source = 'weapons' | 'armor' | 'gear';
interface Item { id: string; name: string; price: number | null; kind: string; description: string }

interface Props {
  build: CharacterBuild;
  ref: ReferenceData;
  editable: boolean;
  dispatch: (a: BuildAction) => void;
}

export default function EquipmentStep({ build, ref, editable, dispatch }: Props) {
  const [source, setSource] = useState<Source>('weapons');
  const bg = ref.backgrounds[build.identity.backgroundId];
  const items: Item[] =
    source === 'weapons'
      ? Object.values(ref.weapons).map((w) => ({ id: w.id, name: w.name, price: w.price, kind: 'weapon', description: w.description }))
      : source === 'armor'
        ? Object.values(ref.armor).map((a) => ({ id: a.id, name: a.name, price: a.price, kind: a.kind, description: a.description }))
        : Object.values(ref.gear).map((g) => ({ id: g.id, name: g.name, price: g.price, kind: g.category ?? 'gear', description: g.description }));
  const qtyOf = (id: string) => build.equipment.find((e) => e.ref === id)?.qty ?? 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="ht-panel flex flex-wrap items-center gap-2 p-2 text-[11px]">
        <span className="ht-label">Credits</span>
        {editable && <button type="button" className="ht-step" onClick={() => dispatch({ t: 'setCredits', credits: build.credits - 50 })}>−50</button>}
        <b className="text-ht-bright">{build.credits.toLocaleString()} ₡</b>
        {editable && <button type="button" className="ht-step" onClick={() => dispatch({ t: 'setCredits', credits: build.credits + 50 })}>+50</button>}
        <span className="ml-auto text-[10px] text-ht-muted">
          carried: {build.equipment.map((e) => `${e.ref === '' ? '' : ''}${e.qty > 1 ? `${e.qty}× ` : ''}${ref.weapons[e.ref]?.name ?? ref.armor[e.ref]?.name ?? ref.gear[e.ref]?.name ?? e.ref}`).join(', ') || 'nothing'}
        </span>
      </div>
      {bg?.equipmentProse && (
        <div className="ht-panel p-2 text-[10px] text-ht-muted">Background gear · {bg.equipmentProse}</div>
      )}
      <div className="flex gap-1 text-[11px]">
        {(['weapons', 'armor', 'gear'] as Source[]).map((s) => (
          <button key={s} type="button" onClick={() => setSource(s)}
            className={`flex-1 px-2 py-1 capitalize ${source === s ? 'ht-glow text-ht-bright' : 'ht-panel text-ht-muted'}`}>
            {s}
          </button>
        ))}
      </div>
      <StepTable
        key={source}
        items={items}
        columns={[
          { key: 'name', label: 'Name', flex: 1.4, value: (i) => i.name },
          { key: 'kind', label: 'Type', flex: 0.8, value: (i) => i.kind },
          { key: 'price', label: 'Price ₡', flex: 0.6, value: (i) => i.price ?? 0 },
        ]}
        idOf={(i) => i.id}
        searchText={(i) => `${i.name} ${i.kind}`}
        isSelected={(i) => qtyOf(i.id) > 0}
        onSelect={(i) => dispatch({ t: 'addEquipment', ref: i.id })}
        selectLabel={(i) => (qtyOf(i.id) > 0 ? `+ add another (have ${qtyOf(i.id)})` : '✓ add to gear')}
        detail={(i) => (
          <span>
            {i.description || 'No description in the source data.'}
            {qtyOf(i.id) > 0 && editable && (
              <button type="button" className="ht-step ml-2" onClick={() => dispatch({ t: 'removeEquipment', ref: i.id })}>− remove one</button>
            )}
          </span>
        )}
        editable={editable}
      />
    </div>
  );
}
```

- [ ] **Step 3: Mount both** in the shell switch (extend the exclusion list).

- [ ] **Step 4: Typecheck + commit**

Run: `cd apps/swdnd && bun run build` — Expected: success.

```bash
git add apps/swdnd/src/panels/CharacterSheet/Builder
git commit -m "feat(swdnd): feats + equipment steps"
```

---

## Task 15: Powers & Maneuvers step (+ house-rule unlock)

**Files:**
- Create: `.../steps/Powers.tsx`
- Modify: `Builder/index.tsx` (mount; remove the placeholder branch entirely)

- [ ] **Step 1: Implement**

```tsx
// apps/swdnd/src/panels/CharacterSheet/Builder/steps/Powers.tsx
import { useState } from 'react';
import type { BuildAction } from '../../../../lib/buildState';
import type { CharacterBuild, DerivedSheet, ReferenceData } from '../../../../lib/rules/types';
import StepTable from '../StepTable';

type Tab = 'force' | 'tech' | 'maneuvers';

interface Props {
  build: CharacterBuild;
  derived: DerivedSheet;
  ref: ReferenceData;
  editable: boolean;
  dispatch: (a: BuildAction) => void;
}

export default function PowersStep({ build, derived, ref, editable, dispatch }: Props) {
  const unlocked = (build.houseRuled ?? []).includes('powers');
  const force = derived.casting.force;
  const tech = derived.casting.tech;
  const supMax = derived.superiority?.knownMax ?? 0;
  const tabs: Tab[] = [
    ...(force.knownMax > 0 || unlocked ? (['force'] as Tab[]) : []),
    ...(tech.knownMax > 0 || unlocked ? (['tech'] as Tab[]) : []),
    ...(supMax > 0 || unlocked ? (['maneuvers'] as Tab[]) : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[0] ?? 'force');
  const activeTab = tabs.includes(tab) ? tab : tabs[0] ?? 'force';

  const knownIn = (t: 'force' | 'tech') => build.knownPowers.filter((id) => ref.powers[id]?.castType === t).length;

  const header = (
    <div className="ht-glow flex flex-wrap items-center gap-3 rounded p-2 text-[10px]">
      {force.knownMax > 0 && <span>force <b className="text-ht-bright">{knownIn('force')}/{force.knownMax}</b> · max lvl {force.maxPowerLevel}</span>}
      {tech.knownMax > 0 && <span>tech <b className="text-ht-bright">{knownIn('tech')}/{tech.knownMax}</b> · max lvl {tech.maxPowerLevel}</span>}
      {supMax > 0 && <span>maneuvers <b className="text-ht-bright">{build.knownManeuvers.length}/{supMax}</b> · {derived.superiority?.die}</span>}
      {editable && (
        <button type="button" onClick={() => dispatch({ t: 'toggleHouseRule', step: 'powers' })}
          className={`ml-auto ht-step ${unlocked ? 'text-yellow-300' : ''}`}>
          ⌂ house rule: {unlocked ? 'unlocked' : 'locked'}
        </button>
      )}
    </div>
  );

  if (tabs.length === 0) {
    return <div className="ht-panel p-4 text-[11px] text-ht-muted">This build has no powers or maneuvers at level 1.</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      {header}
      <div className="flex gap-1 text-[11px]">
        {tabs.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`flex-1 px-2 py-1 capitalize ${activeTab === t ? 'ht-glow text-ht-bright' : 'ht-panel text-ht-muted'}`}>
            {t}
          </button>
        ))}
      </div>

      {activeTab !== 'maneuvers' ? (
        <StepTable
          key={activeTab}
          items={Object.values(ref.powers).filter((p) =>
            p.castType === activeTab && (unlocked || p.level <= derived.casting[activeTab].maxPowerLevel),
          )}
          columns={[
            { key: 'name', label: 'Name', flex: 1.4, value: (p) => p.name },
            { key: 'level', label: 'Level', flex: 0.5, value: (p) => p.level },
          ]}
          idOf={(p) => p.id}
          searchText={(p) => p.name}
          isSelected={(p) => build.knownPowers.includes(p.id)}
          onSelect={(p) => dispatch({ t: 'togglePower', powerId: p.id })}
          selectLabel={(p) => (build.knownPowers.includes(p.id) ? '✕ forget' : '✓ learn')}
          detail={(p) => p.description || 'No description in the source data.'}
          editable={editable}
        />
      ) : (
        <StepTable
          key="maneuvers"
          items={Object.values(ref.maneuvers)}
          columns={[
            { key: 'name', label: 'Name', flex: 1.4, value: (m) => m.name },
            { key: 'type', label: 'Type', flex: 0.6, value: (m) => m.maneuverType },
          ]}
          idOf={(m) => m.id}
          searchText={(m) => `${m.name} ${m.maneuverType}`}
          isSelected={(m) => build.knownManeuvers.includes(m.id)}
          onSelect={(m) => dispatch({ t: 'toggleManeuver', maneuverId: m.id })}
          selectLabel={(m) => (build.knownManeuvers.includes(m.id) ? '✕ forget' : '✓ learn')}
          detail={(m) => m.description || 'No description in the source data.'}
          editable={editable}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount** — final shell switch covers all 8 steps (`powers` passes `derived`); delete the placeholder branch.

- [ ] **Step 3: Typecheck + commit**

Run: `cd apps/swdnd && bun run build` — Expected: success.

```bash
git add apps/swdnd/src/panels/CharacterSheet/Builder
git commit -m "feat(swdnd): powers & maneuvers step with house-rule unlock"
```

---

## Task 16: Full-build integration test

**Files:**
- Test: `apps/swdnd/src/lib/builder.integration.test.ts`

- [ ] **Step 1: Write the test** (pure: drives `applyBuildAction` end-to-end, asserts `stepStatus` and `computeSheet`)

```ts
// apps/swdnd/src/lib/builder.integration.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild, type ReferenceData, type RefClass, type RefSpecies } from './rules/types';
import { computeSheet } from './rules';
import { applyBuildAction, type BuildAction } from './buildState';
import { stepStatus, STEP_ORDER } from './validation';

const consular: RefClass = {
  id: 'consular', name: 'Consular', hitDie: 6, saves: ['wis', 'cha'],
  skillChoices: ['ins', 'lor', 'per'], skillNumber: 2,
  powercasting: { force: 'full', tech: 'none' }, superiorityProgression: 0, description: '',
};
const fighter: RefClass = {
  id: 'fighter', name: 'Fighter', hitDie: 10, saves: ['str', 'con'],
  skillChoices: ['ath', 'prc'], skillNumber: 2,
  powercasting: { force: 'none', tech: 'none' }, superiorityProgression: 0.5, description: '',
};
const human: RefSpecies = { id: 'human', name: 'Human', walkSpeed: 30, description: '', abilityIncreases: { fixed: {}, points: 4 } };
const powers = Object.fromEntries(
  Array.from({ length: 9 }, (_, i) => [`p${i}`, { id: `p${i}`, name: `Power ${i}`, level: i === 0 ? 0 : 1, castType: 'force' as const, description: '' }]),
);
const ref = {
  classes: { consular, fighter }, species: { human }, archetypes: {},
  armor: { suit: { id: 'suit', name: 'Combat suit', baseAc: 11, dexCap: null, kind: 'light', price: 200, description: '' } },
  weapons: {}, powers,
  backgrounds: { jedi: { id: 'jedi', name: 'Jedi', description: '', featureName: 'Faithful', skillProse: null, toolProse: null, equipmentProse: null } },
  feats: {}, maneuvers: { m1: { id: 'm1', name: 'Feint', maneuverType: 'physical', description: '' } }, gear: {},
} as unknown as ReferenceData;

function drive(build = emptyBuild('Test'), actions: BuildAction[]) {
  return actions.reduce((b, a) => applyBuildAction(b, ref, computeSheet(b, ref), a), build);
}

test('a full Consular level-1 build reaches all-done and computes correctly', () => {
  const b = drive(emptyBuild('Lyra'), [
    { t: 'setSpecies', speciesId: 'human' },
    { t: 'allocateSpeciesPoint', ability: 'wis', delta: 1 },
    { t: 'allocateSpeciesPoint', ability: 'wis', delta: 1 },
    { t: 'allocateSpeciesPoint', ability: 'dex', delta: 1 },
    { t: 'allocateSpeciesPoint', ability: 'con', delta: 1 },
    { t: 'setBackground', backgroundId: 'jedi' },
    { t: 'setClass', classId: 'consular' },
    { t: 'setBaseAbilities', base: { str: 10, dex: 13, con: 11, int: 13, wis: 15, cha: 11 } },
    { t: 'toggleSkill', skill: 'ins' },
    { t: 'toggleSkill', skill: 'lor' },
    { t: 'addEquipment', ref: 'suit' },
    ...Array.from({ length: 9 }, (_, i) => ({ t: 'togglePower' as const, powerId: `p${i}` })),
  ]);
  const derived = computeSheet(b, ref);
  const status = stepStatus(b, ref, derived);
  for (const k of STEP_ORDER) {
    if (status[k].applicable) expect(`${k}:${status[k].state}`).toBe(`${k}:done`);
  }
  // wis 15 + 2 species = 17 (+3); consular L1: hp 6+conMod(1)=7, force pool 4+3=7, known 9 = POWERS_KNOWN.force.full[1]
  expect(derived.abilities.wis).toEqual({ score: 17, mod: 3 });
  expect(derived.maxHp).toBe(7);
  expect(derived.casting.force.knownMax).toBe(9);
  expect(derived.casting.force.pointsMax).toBe(7);
  expect(derived.armorClass).toBe(11 + 2); // suit + dex 14 -> mod 2
  expect(b.knownPowers).toHaveLength(9);
});

test('a Fighter level-1 build exposes maneuvers and completes via them', () => {
  const b = drive(emptyBuild('Brakk'), [
    { t: 'setClass', classId: 'fighter' },
    { t: 'toggleManeuver', maneuverId: 'm1' },
  ]);
  const derived = computeSheet(b, ref);
  expect(derived.superiority).toEqual({ level: 1, diceMax: 2, die: 'd4', knownMax: 1 });
  const status = stepStatus(b, ref, derived);
  expect(status.powers.applicable).toBe(true);
  expect(status.powers.state).toBe('done');
});
```

- [ ] **Step 2: Run**

Run: `bun test apps/swdnd/src/lib/builder.integration.test.ts`
Expected: PASS (2 pass). If a number is off, fix the offending module (not the test's sw5e math).

- [ ] **Step 3: Full suite**

Run: `bun test` — Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/swdnd/src/lib/builder.integration.test.ts
git commit -m "test(swdnd): full-build integration (Consular + Fighter)"
```

---

## Task 17: Live preview walkthrough + visual polish

**Files:** any `apps/swdnd/src/panels/**` + `index.css` — styling/UX refinement only; pure modules frozen.

- [ ] **Step 1: Run the stack** — `.claude/launch.json` has `backend` (port 3000) and `swdnd` (port 5175) preview configs; `apps/swdnd/.env.development` points the API at localhost. Local data: `bun apps/backend/src/db/import/sw5e-import.ts` if `./data/swdnd.sqlite` is missing. Create a player slot for a campaign (`POST /swdnd/campaigns/{id}/players` via Swagger `/docs`) to get a token.
- [ ] **Step 2: Walk the flow** — `/player?token=…`: create a character → land in the builder → complete every step as a **Consular** (watch the rail flip to ✓, the auto-save chip, the free-point allocator, point-buy budget) → "back to sheet" shows the finished character. Repeat quickly as a **Fighter** (maneuvers tab). Check the narrow container (rail becomes the horizontal strip), read-only (`/sheet/:id/build` without token → redirect message), and the house-rule unlock on Powers.
- [ ] **Step 3: Polish** — match the approved mockup (glyph colors, glow on active rail step, table spacing/density); fix only presentation-level issues found while walking. Anything logic-level found: STOP and report it, don't silently patch.
- [ ] **Step 4: Verify + commit**

Run: `bun test` and `cd apps/swdnd && bun run build` — Expected: green.

```bash
git add apps/swdnd/src
git commit -m "polish(swdnd): builder visual pass"
```

---

## Task 18: Final sweep

- [ ] **Step 1:** `bun test` — Expected: all pass, 0 fail.
- [ ] **Step 2:** `cd apps/swdnd && bun run build` — Expected: clean.
- [ ] **Step 3:** Smoke list — landing lists/creates/deletes with a real token; a full Consular build round-trips to the play sheet with correct derived values; Fighter maneuvers; narrow mode; read-only redirect.
- [ ] **Step 4:** `git commit --allow-empty -m "test(swdnd): phase 3 builder integration verified"`

---

## Self-review (completed during planning)

- **Spec coverage:** §2 decisions → landing (T8), three ability modes (T1, T13), house-rule unlock (T5, T15), table UX (T10), auto-save (T7). §3 surfaces → T8, T9. §4 layout → T9. §5 steps + completeness → T6 (validation), T11–T15 (steps); archetype-at-L1 exclusion honored (setClass writes `archetypeId: null`). §6 rich text → T2 (+ used via `descriptionOf` in T4). §7 architecture/files → T1–T10. §8 data flow → T7 (no WS; name sync in PATCH). §9 testing → T1–T6 units + T16 integration; components by build + T17 preview. §10 phasing → task order matches.
- **Type consistency:** `BuildAction`/`applyBuildAction(build, ref, derived, action)` (T5) used by T7 and every step; `stepStatus`/`STEP_ORDER`/`StepInfo.applicable` (T6) used by T8/T9; `RefBackground.featureName` etc. (T4) match T11/T14 usage; `STANDARD_ARRAY`/`budgetRemaining`/`scoreCost` (T1) match T13; `Column<T>`/StepTable props (T10) match every step's usage; `houseRuled` (T3) consumed by T5/T6/T9/T15.
- **No placeholders:** every code step is complete; T17 is a bounded verification/refinement task by design (mirrors Phase 2's T16, which worked well).
- **Known judgment calls (documented, not gaps):** name-row sync PATCHes `name` on every save (harmless no-op when unchanged); Powers over-cap `attention` is only reachable via unlock→re-lock (validation still covers it); `Equipment` credits quick-set uses ±50 steps (typed entry can come later); species `#choice` allocations are amount-1 entries for simple add/remove.

## Out of scope (Phase 4+)

- Level-up entries, multiclass, archetypes, ASI/feat mechanical effects, prerequisite gating.
- Parsing background/starting-equipment prose into structured grants.
- DM-side character management UI; WS auth; live build-merge into open sheets.
