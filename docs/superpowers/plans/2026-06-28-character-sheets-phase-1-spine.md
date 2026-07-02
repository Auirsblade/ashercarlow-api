# Character Sheets — Phase 1 (Spine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the testable spine of the swdnd Character Sheets feature — the data model, a pure sw5e compute engine, the character/player REST routes, and the access model — with no UI yet.

**Architecture:** A pure, unit-tested TypeScript compute engine lives in `apps/swdnd/src/lib/rules/` (no React, no IO). It turns a stored character *build* (`character.data_json`) plus *reference view data* into a `DerivedSheet`. The backend gains character + player routes under `/swdnd` (Hono `OpenAPIHono`, `createRoute` + `app.openapi`), persisting builds and broadcasting `character:updated` over the existing WS room. A character-scoped access gate lets the admin **or** the owning player write, while reads stay open by unguessable id (foundation posture). A thin frontend API client wraps the routes and maps reference rows into the engine's view types.

**Tech Stack:** Bun, `bun:sqlite`, Hono + `@hono/zod-openapi`, TypeScript. Tests run with `bun test`.

**Spec:** `docs/superpowers/specs/2026-06-28-character-sheets-design.md` (this plan implements §5, §6, §8, §9, §10 — the non-UI portions — i.e. spec §13 phase 1).

---

## Domain reference (authoritative sw5e values used below)

These were extracted from the vendored sw5e Foundry system (`vendor/sw5e/module/config.mjs` and `vendor/sw5e/module/documents/actor/actor.mjs`). They are the ground truth for the engine. **Important:** real class data stores casting under `system.powercasting.{force,tech}` as one of `"full" | "3/4" | "half" | "arch" | "none"` — *not* the `casterType`/`casterRatio` fields the foundation importer looked for (those import as NULL and must be ignored).

- **Power points base** per progression: `full: 4, "3/4": 3, half: 2, arch: 1`. Tech track is then halved.
- **Power max level** per progression, indexed by class level 0..20:
  - `full:  [0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,9,9]`
  - `"3/4": [0,1,1,2,2,2,3,3,3,4,4,5,5,5,6,6,6,7,7,7,7]`
  - `half:  [0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5]`
  - `arch:  [0,0,0,1,1,1,1,2,2,2,2,2,2,3,3,3,3,4,4,4,4]`
- **Power limit** (first power level that is once-per-long-rest): `full: 6, "3/4": 5, half: 4, arch: 4`.
- **Powers known** per `[castType][progression]`, indexed by class level 0..20:
  - `force.full:  [0,9,11,13,15,17,19,21,23,25,26,28,29,31,32,34,35,37,38,39,40]`
  - `force."3/4": [0,7,9,11,13,15,17,18,19,21,22,24,25,26,28,29,30,32,33,34,35]`
  - `force.half:  [0,5,7,9,10,12,13,14,15,17,18,19,20,22,23,24,25,27,28,29,30]`
  - `force.arch:  [0,0,0,4,6,7,8,10,11,12,13,14,15,17,18,19,20,22,23,24,25]`
  - `tech.full:   [0,6,7,9,10,12,13,15,16,18,19,21,22,23,24,25,26,27,28,29,30]`
  - `tech."3/4":  [0,0,0,7,8,9,11,12,13,15,16,17,18,19,20,21,22,23,24,25,26]`
  - `tech.half:   [0,0,4,5,6,7,8,9,10,12,13,14,15,16,17,18,19,20,21,22,23]`
  - `tech.arch:   [0,0,0,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]`
- **Caster-level weight** per progression = `powerMaxLevel[prog][20] / 9` → `full: 1, "3/4": 7/9, half: 5/9, arch: 4/9`. A class contributes `classLevels * weight` to its track's caster level; the per-track total is rounded.
- **Multiclass max power level:** single casting class in a track → `powerMaxLevel[thatClassProg][thatClassLevels]`; two+ casting classes → `powerMaxLevel.full[roundedCasterLevel]`.
- **Casting ability:** Force = Wisdom (light) / Charisma (dark) / chosen (universal); Tech = Intelligence always. A class/archetype may carry `powercasting.{force,tech}Override` naming a different ability.
- **Point pool max** (per track) = `round(sum(classLevels * pointsBase[prog]))` (tech halved) **+ casting-ability modifier**. (sw5e's extra level/overall/focus bonuses are omitted — home-game; overrides cover edge cases.)
- **Save DC** = `8 + proficiencyBonus + castingAbilityMod`. **Power attack bonus** = `proficiencyBonus + castingAbilityMod`.
- **Tech half-caster gate:** a `half` tech progression grants no techcasting until that class reaches level 2 (`prog === "half" && castType === "tech" && classLevels < 2` → skip).
- **Superiority** (per class, taking `max(class.superiority.progression, archetype.superiority.progression)` as a number):
  - `diceMax += round(superiorityDiceQuant[classLevels] * progression)` where `superiorityDiceQuant = [0,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12]`.
  - `knownMax += maneuversKnown[round(classLevels * progression)]` where `maneuversKnown = [0,1,2,4,5,6,7,9,10,11,12,14,15,16,17,19,20,21,22,23,24]`.
  - `level += classLevels * progression` (rounded at end).
  - `die = superiorityDieSize[totalSuperiorityClassLevels]` where `superiorityDieSize = ["","d4","d4","d4","d4","d6","d6","d6","d6","d8","d8","d8","d8","d10","d10","d10","d10","d12","d12","d12","d12"]`.
- **Skills** (key → ability): `acr:dex, ani:wis, ath:str, dec:cha, ins:wis, itm:cha, inv:int, lor:int, med:wis, nat:int, prc:wis, prf:cha, per:cha, pil:int, slt:dex, ste:dex, sur:wis, tec:int`. (18 skills, including sw5e's Lore/Piloting/Technology.)
- **Proficiency bonus** = `2 + floor((totalLevel - 1) / 4)`.
- **Ability modifier** = `floor((score - 10) / 2)`.
- **HP:** the character's very first level (`n === 1`) = `hitDie + conMod`; every later level = `(hp === "avg" ? floor(hitDie/2)+1 : hp) + conMod`, each level at least 1.
- **Armor / AC:** armor row carries `{ baseAc, dexCap, kind }`. No armor → `10 + dexMod`. Body armor → `baseAc + (dexCap == null ? dexMod : min(dexMod, dexCap))`. A `shield` adds its `baseAc` on top.

---

## File structure

Frontend compute engine (pure TS, `apps/swdnd/src/lib/rules/`):
- `types.ts` — `CharacterBuild` (the `data_json` shape), the reference view types, and `DerivedSheet`.
- `constants.ts` — the sw5e tables above (skills, casting, superiority) + small lookups.
- `core.ts` — total level, ability scores/mods, proficiency bonus, class grouping.
- `casting.ts` — per-track powercasting (points, caster level, max power level, known, ability, DC, attack).
- `combat.ts` — max HP, AC, initiative, speed, hit dice.
- `skills.ts` — saving throws + skill bonuses.
- `superiority.ts` — superiority dice/known/die.
- `index.ts` — `computeSheet(build, ref)` orchestrator + override application.

Backend (`apps/backend/src/`):
- `routes/swdnd/access.ts` — token/player resolution + `assertCharacterWriteAccess`.
- `routes/swdnd/characters.ts` — character CRUD + broadcast.
- `routes/swdnd/players.ts` — player-slot creation + `GET /players/me`.
- `routes/swdnd/index.ts` (modify) — register new routes; exempt character/player routes from the blanket admin gate so the route-level gate runs.

Frontend client (`apps/swdnd/src/lib/`):
- `characters.ts` — typed REST client + reference loader that maps `/swdnd/content/:category` rows into the engine's view types.

---

## Task 1: Engine types

**Files:**
- Create: `apps/swdnd/src/lib/rules/types.ts`
- Test: `apps/swdnd/src/lib/rules/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/swdnd/src/lib/rules/types.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild, type CharacterBuild } from './types';

test('emptyBuild produces a schema-versioned, playable blank build', () => {
  const b: CharacterBuild = emptyBuild('Lyra Voss');
  expect(b.schemaVersion).toBe(1);
  expect(b.identity.name).toBe('Lyra Voss');
  expect(b.identity.alignment).toBe('none');
  expect(b.abilities.base).toEqual({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
  expect(b.levels).toEqual([]);
  expect(b.play.hp).toBe(0);
  expect(b.overrides).toEqual({});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/swdnd/src/lib/rules/types.test.ts`
Expected: FAIL — cannot resolve module `./types`.

- [ ] **Step 3: Write the types + `emptyBuild` factory**

```ts
// apps/swdnd/src/lib/rules/types.ts
export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export type Alignment = 'light' | 'dark' | 'universal' | 'none';
export type CastType = 'force' | 'tech';
export type Progression = 'full' | '3/4' | 'half' | 'arch' | 'none';
export type SkillKey =
  | 'acr' | 'ani' | 'ath' | 'dec' | 'ins' | 'itm' | 'inv' | 'lor' | 'med'
  | 'nat' | 'prc' | 'prf' | 'per' | 'pil' | 'slt' | 'ste' | 'sur' | 'tec';

// ---- Stored build (character.data_json) ----
export interface AbilityIncrease {
  source: 'species' | 'asi' | 'feat';
  ref: string;
  ability: AbilityKey;
  amount: number;
}
export interface LevelEntry {
  n: number;                       // 1-based overall character level for this entry
  classId: string;
  archetypeId: string | null;
  hp: 'avg' | number;             // 'avg' or a rolled total for this level's die
  choices?: Record<string, unknown>;
}
export interface EquipmentEntry {
  ref: string;
  qty: number;
  equipped: boolean;
  mods?: string[];
}
export interface PlayState {
  hp: number;
  tempHp: number;
  hitDiceSpent: number;
  forcePointsSpent: number;
  techPointsSpent: number;
  superiorityDiceSpent: number;
  conditions: string[];
  exhaustion: number;
  inspiration: boolean;
  notes: string;
}
export interface CharacterBuild {
  schemaVersion: number;
  identity: {
    name: string;
    speciesId: string;
    backgroundId: string;
    alignment: Alignment;
    /** For universal forcecasters: the chosen casting ability. */
    forceCastingAbility?: 'wis' | 'cha';
  };
  abilities: {
    base: Record<AbilityKey, number>;
    increases: AbilityIncrease[];
  };
  levels: LevelEntry[];
  proficiencies: {
    skills: SkillKey[];
    expertise: SkillKey[];
    tools: string[];
    languages: string[];
    savingThrows: AbilityKey[];
  };
  equipment: EquipmentEntry[];
  credits: number;
  knownPowers: string[];
  knownManeuvers: string[];
  play: PlayState;
  /** Assisted-mode manual overrides keyed by derived scalar field name. */
  overrides: Record<string, number>;
}

// ---- Reference view types (mapped from /swdnd/content/:category raw_json) ----
export interface RefClass {
  id: string;
  name: string;
  hitDie: number;                 // 6, 8, 10, 12
  saves: AbilityKey[];
  skillChoices: SkillKey[];
  skillNumber: number;
  powercasting: Record<CastType, Progression>;
  powercastingOverride?: Partial<Record<CastType, AbilityKey>>;
  superiorityProgression: number; // 0 when none
}
export interface RefArchetype {
  id: string;
  name: string;
  powercasting: Record<CastType, Progression>;
  powercastingOverride?: Partial<Record<CastType, AbilityKey>>;
  superiorityProgression: number;
}
export interface RefSpecies {
  id: string;
  name: string;
  walkSpeed: number;
}
export interface RefArmor {
  id: string;
  name: string;
  baseAc: number;
  dexCap: number | null;          // null = no cap (light); 0 = heavy; n = medium cap
  kind: 'light' | 'medium' | 'heavy' | 'shield';
}
export interface RefWeapon {
  id: string;
  name: string;
  damageParts: Array<[string, string]>; // [formula, damageType]
  properties: Record<string, unknown>;  // sw5e weapon properties (fin, dex, ran, ...)
  ability: AbilityKey | '';
  attackBonus: number;
}
export interface RefPower {
  id: string;
  name: string;
  level: number;                  // 0 = at-will
  castType: CastType;
}
export interface ReferenceData {
  classes: Record<string, RefClass>;
  archetypes: Record<string, RefArchetype>;
  species: Record<string, RefSpecies>;
  armor: Record<string, RefArmor>;
  weapons: Record<string, RefWeapon>;
  powers: Record<string, RefPower>;
}

// ---- Derived sheet (computed, never stored) ----
export interface AbilityBlock {
  score: number;
  mod: number;
}
export interface TrackCasting {
  classes: number;
  casterLevel: number;
  maxPowerLevel: number;
  pointsMax: number;
  knownMax: number;
  ability: AbilityKey | null;
  saveDc: number | null;
  attackBonus: number | null;
}
export interface SuperiorityBlock {
  level: number;
  diceMax: number;
  die: string;                    // e.g. 'd8'
  knownMax: number;
}
export interface SkillBonus {
  key: SkillKey;
  ability: AbilityKey;
  bonus: number;
  proficient: boolean;
  expertise: boolean;
}
export interface DerivedSheet {
  totalLevel: number;
  proficiencyBonus: number;
  abilities: Record<AbilityKey, AbilityBlock>;
  maxHp: number;
  armorClass: number;
  initiative: number;
  speed: number;
  hitDice: Record<string, number>; // { d10: 3, d6: 2 }
  savingThrows: Record<AbilityKey, { bonus: number; proficient: boolean }>;
  skills: SkillBonus[];
  casting: { force: TrackCasting; tech: TrackCasting };
  superiority: SuperiorityBlock | null;
}

export function emptyBuild(name: string): CharacterBuild {
  return {
    schemaVersion: 1,
    identity: { name, speciesId: '', backgroundId: '', alignment: 'none' },
    abilities: {
      base: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      increases: [],
    },
    levels: [],
    proficiencies: { skills: [], expertise: [], tools: [], languages: [], savingThrows: [] },
    equipment: [],
    credits: 0,
    knownPowers: [],
    knownManeuvers: [],
    play: {
      hp: 0, tempHp: 0, hitDiceSpent: 0, forcePointsSpent: 0, techPointsSpent: 0,
      superiorityDiceSpent: 0, conditions: [], exhaustion: 0, inspiration: false, notes: '',
    },
    overrides: {},
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/swdnd/src/lib/rules/types.test.ts`
Expected: PASS (1 pass).

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/rules/types.ts apps/swdnd/src/lib/rules/types.test.ts
git commit -m "feat(swdnd): character build + derived sheet types"
```

---

## Task 2: Engine constants (sw5e tables)

**Files:**
- Create: `apps/swdnd/src/lib/rules/constants.ts`
- Test: `apps/swdnd/src/lib/rules/constants.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/swdnd/src/lib/rules/constants.test.ts
import { test, expect } from 'bun:test';
import {
  SKILLS, ABILITIES, POWER_POINTS_BASE, POWER_MAX_LEVEL, POWER_LIMIT,
  POWERS_KNOWN, casterWeight, SUPERIORITY_DICE_QUANT, SUPERIORITY_DIE_SIZE,
  MANEUVERS_KNOWN,
} from './constants';

test('skills table has 18 sw5e skills with abilities', () => {
  expect(Object.keys(SKILLS)).toHaveLength(18);
  expect(SKILLS.lor.ability).toBe('int');   // Lore
  expect(SKILLS.pil.ability).toBe('int');   // Piloting
  expect(SKILLS.tec.ability).toBe('int');   // Technology
  expect(SKILLS.ath.ability).toBe('str');
});

test('casting tables match sw5e config', () => {
  expect(ABILITIES).toEqual(['str', 'dex', 'con', 'int', 'wis', 'cha']);
  expect(POWER_POINTS_BASE.full).toBe(4);
  expect(POWER_MAX_LEVEL.full[5]).toBe(3);
  expect(POWER_MAX_LEVEL.full).toHaveLength(21);
  expect(POWER_LIMIT.full).toBe(6);
  expect(POWERS_KNOWN.force.full[5]).toBe(17);
  expect(POWERS_KNOWN.tech.half[2]).toBe(4);
});

test('caster weight derives from powerMaxLevel[20] / 9', () => {
  expect(casterWeight('full')).toBe(1);
  expect(casterWeight('half')).toBeCloseTo(5 / 9, 6);
});

test('superiority tables match sw5e config', () => {
  expect(SUPERIORITY_DICE_QUANT[3]).toBe(4);
  expect(SUPERIORITY_DIE_SIZE[5]).toBe('d6');
  expect(MANEUVERS_KNOWN[3]).toBe(4);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/swdnd/src/lib/rules/constants.test.ts`
Expected: FAIL — cannot resolve module `./constants`.

- [ ] **Step 3: Write the constants**

```ts
// apps/swdnd/src/lib/rules/constants.ts
import type { AbilityKey, CastType, Progression, SkillKey } from './types';

export const ABILITIES: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export const SKILLS: Record<SkillKey, { ability: AbilityKey; label: string }> = {
  acr: { ability: 'dex', label: 'Acrobatics' },
  ani: { ability: 'wis', label: 'Animal Handling' },
  ath: { ability: 'str', label: 'Athletics' },
  dec: { ability: 'cha', label: 'Deception' },
  ins: { ability: 'wis', label: 'Insight' },
  itm: { ability: 'cha', label: 'Intimidation' },
  inv: { ability: 'int', label: 'Investigation' },
  lor: { ability: 'int', label: 'Lore' },
  med: { ability: 'wis', label: 'Medicine' },
  nat: { ability: 'int', label: 'Nature' },
  prc: { ability: 'wis', label: 'Perception' },
  prf: { ability: 'cha', label: 'Performance' },
  per: { ability: 'cha', label: 'Persuasion' },
  pil: { ability: 'int', label: 'Piloting' },
  slt: { ability: 'dex', label: 'Sleight of Hand' },
  ste: { ability: 'dex', label: 'Stealth' },
  sur: { ability: 'wis', label: 'Survival' },
  tec: { ability: 'int', label: 'Technology' },
};

type CastProg = Exclude<Progression, 'none'>;

export const POWER_POINTS_BASE: Record<CastProg, number> = {
  full: 4, '3/4': 3, half: 2, arch: 1,
};

export const POWER_MAX_LEVEL: Record<CastProg, number[]> = {
  full: [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 9, 9],
  '3/4': [0, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 7],
  half: [0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5],
  arch: [0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4],
};

export const POWER_LIMIT: Record<CastProg, number> = {
  full: 6, '3/4': 5, half: 4, arch: 4,
};

export const POWERS_KNOWN: Record<CastType, Record<CastProg, number[]>> = {
  force: {
    full: [0, 9, 11, 13, 15, 17, 19, 21, 23, 25, 26, 28, 29, 31, 32, 34, 35, 37, 38, 39, 40],
    '3/4': [0, 7, 9, 11, 13, 15, 17, 18, 19, 21, 22, 24, 25, 26, 28, 29, 30, 32, 33, 34, 35],
    half: [0, 5, 7, 9, 10, 12, 13, 14, 15, 17, 18, 19, 20, 22, 23, 24, 25, 27, 28, 29, 30],
    arch: [0, 0, 0, 4, 6, 7, 8, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 22, 23, 24, 25],
  },
  tech: {
    full: [0, 6, 7, 9, 10, 12, 13, 15, 16, 18, 19, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
    '3/4': [0, 0, 0, 7, 8, 9, 11, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26],
    half: [0, 0, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
    arch: [0, 0, 0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
  },
};

export const POWER_POINTS_BONUS: Record<CastType, AbilityKey[]> = {
  force: ['wis', 'cha'],
  tech: ['int'],
};

/** A class's contribution-per-level to its track's caster level. */
export function casterWeight(prog: CastProg): number {
  return POWER_MAX_LEVEL[prog][20] / 9;
}

export const SUPERIORITY_DICE_QUANT = [
  0, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12,
];
export const SUPERIORITY_DIE_SIZE = [
  '', 'd4', 'd4', 'd4', 'd4', 'd6', 'd6', 'd6', 'd6', 'd8', 'd8', 'd8', 'd8',
  'd10', 'd10', 'd10', 'd10', 'd12', 'd12', 'd12', 'd12',
];
export const MANEUVERS_KNOWN = [
  0, 1, 2, 4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24,
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/swdnd/src/lib/rules/constants.test.ts`
Expected: PASS (4 pass).

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/rules/constants.ts apps/swdnd/src/lib/rules/constants.test.ts
git commit -m "feat(swdnd): sw5e casting/superiority/skill constant tables"
```

---

## Task 3: Core — levels, abilities, proficiency, class grouping

**Files:**
- Create: `apps/swdnd/src/lib/rules/core.ts`
- Test: `apps/swdnd/src/lib/rules/core.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/swdnd/src/lib/rules/core.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild } from './types';
import {
  abilityModifier, totalLevel, proficiencyBonus, totalAbilityScores, classesTaken,
} from './core';

test('abilityModifier uses floor((score-10)/2)', () => {
  expect(abilityModifier(10)).toBe(0);
  expect(abilityModifier(17)).toBe(3);
  expect(abilityModifier(8)).toBe(-1);
});

test('proficiencyBonus steps every 4 levels', () => {
  expect(proficiencyBonus(1)).toBe(2);
  expect(proficiencyBonus(4)).toBe(2);
  expect(proficiencyBonus(5)).toBe(3);
  expect(proficiencyBonus(20)).toBe(6);
});

test('totalAbilityScores folds increases onto the base', () => {
  const b = emptyBuild('x');
  b.abilities.base.wis = 15;
  b.abilities.increases = [
    { source: 'species', ref: 'human', ability: 'wis', amount: 1 },
    { source: 'asi', ref: 'l4', ability: 'wis', amount: 1 },
    { source: 'asi', ref: 'l4', ability: 'cha', amount: 1 },
  ];
  const s = totalAbilityScores(b);
  expect(s.wis).toBe(17);
  expect(s.cha).toBe(11);
  expect(s.str).toBe(10);
});

test('classesTaken groups level entries by class with first archetype', () => {
  const b = emptyBuild('x');
  b.levels = [
    { n: 1, classId: 'consular', archetypeId: null, hp: 'avg' },
    { n: 2, classId: 'consular', archetypeId: 'niman', hp: 'avg' },
    { n: 3, classId: 'guardian', archetypeId: null, hp: 'avg' },
  ];
  expect(totalLevel(b)).toBe(3);
  expect(classesTaken(b)).toEqual([
    { classId: 'consular', archetypeId: 'niman', levels: 2 },
    { classId: 'guardian', archetypeId: null, levels: 1 },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/swdnd/src/lib/rules/core.test.ts`
Expected: FAIL — cannot resolve module `./core`.

- [ ] **Step 3: Write core**

```ts
// apps/swdnd/src/lib/rules/core.ts
import { ABILITIES } from './constants';
import type { AbilityKey, CharacterBuild } from './types';

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function totalLevel(build: CharacterBuild): number {
  return build.levels.length;
}

export function proficiencyBonus(level: number): number {
  return 2 + Math.floor((Math.max(level, 1) - 1) / 4);
}

export function totalAbilityScores(build: CharacterBuild): Record<AbilityKey, number> {
  const out = { ...build.abilities.base } as Record<AbilityKey, number>;
  for (const key of ABILITIES) out[key] = build.abilities.base[key] ?? 10;
  for (const inc of build.abilities.increases) {
    out[inc.ability] = (out[inc.ability] ?? 10) + inc.amount;
  }
  return out;
}

export interface ClassTaken {
  classId: string;
  archetypeId: string | null;
  levels: number;
}

/** Group ordered level entries into one record per class, in first-taken order. */
export function classesTaken(build: CharacterBuild): ClassTaken[] {
  const order: string[] = [];
  const map = new Map<string, ClassTaken>();
  for (const lvl of build.levels) {
    let entry = map.get(lvl.classId);
    if (!entry) {
      entry = { classId: lvl.classId, archetypeId: null, levels: 0 };
      map.set(lvl.classId, entry);
      order.push(lvl.classId);
    }
    entry.levels += 1;
    if (entry.archetypeId == null && lvl.archetypeId != null) entry.archetypeId = lvl.archetypeId;
  }
  return order.map((id) => map.get(id)!);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/swdnd/src/lib/rules/core.test.ts`
Expected: PASS (4 pass).

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/rules/core.ts apps/swdnd/src/lib/rules/core.test.ts
git commit -m "feat(swdnd): core engine helpers (levels, abilities, proficiency)"
```

---

## Task 4: Powercasting (force/tech tracks)

**Files:**
- Create: `apps/swdnd/src/lib/rules/casting.ts`
- Test: `apps/swdnd/src/lib/rules/casting.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/swdnd/src/lib/rules/casting.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild, type RefClass, type ReferenceData } from './types';
import { computeCasting } from './casting';

function ref(classes: Record<string, RefClass>): ReferenceData {
  return { classes, archetypes: {}, species: {}, armor: {}, weapons: {}, powers: {} };
}
const consular: RefClass = {
  id: 'consular', name: 'Consular', hitDie: 6, saves: ['wis', 'cha'],
  skillChoices: [], skillNumber: 2,
  powercasting: { force: 'full', tech: 'none' }, superiorityProgression: 0,
};
const guardian: RefClass = {
  id: 'guardian', name: 'Guardian', hitDie: 10, saves: ['con', 'cha'],
  skillChoices: [], skillNumber: 2,
  powercasting: { force: 'none', tech: 'none' }, superiorityProgression: 0,
};

test('single full forcecaster L5 (light, wis 17)', () => {
  const b = emptyBuild('Lyra');
  b.identity.alignment = 'light';
  b.abilities.base.wis = 17;
  b.levels = Array.from({ length: 5 }, (_, i) => ({ n: i + 1, classId: 'consular', archetypeId: null, hp: 'avg' as const }));
  const r = computeCasting(b, ref({ consular }));
  expect(r.force.casterLevel).toBe(5);
  expect(r.force.maxPowerLevel).toBe(3);
  expect(r.force.knownMax).toBe(17);
  expect(r.force.ability).toBe('wis');
  expect(r.force.pointsMax).toBe(20 + 3); // 5*4 base + wis mod 3
  expect(r.force.saveDc).toBe(8 + 3 + 3); // 8 + prof(3) + wis(3)
  expect(r.force.attackBonus).toBe(3 + 3);
  expect(r.tech.classes).toBe(0);
  expect(r.tech.saveDc).toBeNull();
});

test('dark forcecaster uses charisma', () => {
  const b = emptyBuild('Sith');
  b.identity.alignment = 'dark';
  b.abilities.base.cha = 16;
  b.levels = [{ n: 1, classId: 'consular', archetypeId: null, hp: 'avg' }];
  const r = computeCasting(b, ref({ consular }));
  expect(r.force.ability).toBe('cha');
  expect(r.force.saveDc).toBe(8 + 2 + 3); // prof 2 + cha mod 3
});

test('two forcecasting classes use combined caster level for max power level', () => {
  const trickster: RefClass = { ...consular, id: 'trickster', name: 'Trickster', powercasting: { force: '3/4', tech: 'none' } };
  const b = emptyBuild('Multi');
  b.identity.alignment = 'light';
  b.abilities.base.wis = 14;
  b.levels = [
    { n: 1, classId: 'consular', archetypeId: null, hp: 'avg' },
    { n: 2, classId: 'consular', archetypeId: null, hp: 'avg' },
    { n: 3, classId: 'trickster', archetypeId: null, hp: 'avg' },
    { n: 4, classId: 'trickster', archetypeId: null, hp: 'avg' },
    { n: 5, classId: 'trickster', archetypeId: null, hp: 'avg' },
  ];
  const r = computeCasting(b, ref({ consular, trickster }));
  // casterLevel = 2*1 + 3*(7/9) = 4.333 -> round 4 ; classes 2 -> full[4] = 2
  expect(r.force.casterLevel).toBe(4);
  expect(r.force.maxPowerLevel).toBe(2);
  expect(r.force.pointsMax).toBe(2 * 4 + 3 * 3 + 2); // 8 + 9 + wis mod 2 = 19
});

test('non-casting class contributes nothing', () => {
  const b = emptyBuild('Tank');
  b.levels = [{ n: 1, classId: 'guardian', archetypeId: null, hp: 'avg' }];
  const r = computeCasting(b, ref({ guardian }));
  expect(r.force.classes).toBe(0);
  expect(r.force.maxPowerLevel).toBe(0);
});

test('tech half-caster grants nothing before class level 2', () => {
  const scholar1: RefClass = { ...consular, id: 'scholar', name: 'Scholar', powercasting: { force: 'none', tech: 'half' } };
  const b = emptyBuild('Scholar');
  b.abilities.base.int = 16;
  b.levels = [{ n: 1, classId: 'scholar', archetypeId: null, hp: 'avg' }];
  expect(computeCasting(b, ref({ scholar: scholar1 })).tech.classes).toBe(0);
  b.levels.push({ n: 2, classId: 'scholar', archetypeId: null, hp: 'avg' });
  const r2 = computeCasting(b, ref({ scholar: scholar1 }));
  expect(r2.tech.classes).toBe(1);
  expect(r2.tech.ability).toBe('int');
  expect(r2.tech.pointsMax).toBe(Math.round((2 * 2) / 2) + 3); // base 4 halved = 2, + int mod 3
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/swdnd/src/lib/rules/casting.test.ts`
Expected: FAIL — cannot resolve module `./casting`.

- [ ] **Step 3: Write casting**

```ts
// apps/swdnd/src/lib/rules/casting.ts
import {
  POWER_POINTS_BASE, POWER_MAX_LEVEL, POWER_LIMIT, POWERS_KNOWN, casterWeight,
} from './constants';
import { abilityModifier, classesTaken, proficiencyBonus, totalAbilityScores, totalLevel } from './core';
import type {
  AbilityKey, CastType, CharacterBuild, Progression, ReferenceData, TrackCasting,
} from './types';

type CastProg = Exclude<Progression, 'none'>;
const CAST_TYPES: CastType[] = ['force', 'tech'];

function emptyTrack(): TrackCasting {
  return {
    classes: 0, casterLevel: 0, maxPowerLevel: 0, pointsMax: 0, knownMax: 0,
    ability: null, saveDc: null, attackBonus: null,
  };
}

/** Pick the casting ability for a track, honoring overrides and Force alignment. */
function castingAbility(
  castType: CastType,
  build: CharacterBuild,
  override: AbilityKey | null,
  scores: Record<AbilityKey, number>,
): AbilityKey {
  if (override) return override;
  if (castType === 'tech') return 'int';
  switch (build.identity.alignment) {
    case 'light': return 'wis';
    case 'dark': return 'cha';
    default:
      if (build.identity.forceCastingAbility) return build.identity.forceCastingAbility;
      return abilityModifier(scores.cha) > abilityModifier(scores.wis) ? 'cha' : 'wis';
  }
}

export function computeCasting(
  build: CharacterBuild,
  ref: ReferenceData,
): { force: TrackCasting; tech: TrackCasting } {
  const scores = totalAbilityScores(build);
  const prof = proficiencyBonus(totalLevel(build));
  const out = { force: emptyTrack(), tech: emptyTrack() };

  for (const castType of CAST_TYPES) {
    const track = out[castType];
    let maxClassProg: CastProg | null = null;
    let maxClassLevels = 0;
    let override: AbilityKey | null = null;

    for (const taken of classesTaken(build)) {
      const cls = ref.classes[taken.classId];
      if (!cls) continue;
      const arch = taken.archetypeId ? ref.archetypes[taken.archetypeId] : undefined;
      let prog = (arch?.powercasting?.[castType] ?? 'none') as Progression;
      if (prog === 'none') prog = cls.powercasting[castType] ?? 'none';
      if (prog === 'none') continue;
      if (prog === 'half' && castType === 'tech' && taken.levels < 2) continue;

      const ovr = arch?.powercastingOverride?.[castType] ?? cls.powercastingOverride?.[castType];
      if (ovr) override = ovr;

      const cp = prog as CastProg;
      track.classes += 1;
      track.knownMax += POWERS_KNOWN[castType][cp][taken.levels] ?? 0;
      track.pointsMax += taken.levels * POWER_POINTS_BASE[cp];
      track.casterLevel += taken.levels * casterWeight(cp);
      if (taken.levels > maxClassLevels) {
        maxClassLevels = taken.levels;
        maxClassProg = cp;
      }
    }

    if (castType === 'tech') track.pointsMax /= 2;
    track.pointsMax = Math.round(track.pointsMax);
    track.casterLevel = Math.round(track.casterLevel);

    if (track.classes > 0 && maxClassProg) {
      track.maxPowerLevel = track.classes === 1
        ? POWER_MAX_LEVEL[maxClassProg][maxClassLevels]
        : (POWER_MAX_LEVEL.full[track.casterLevel] ?? 0);

      const ability = castingAbility(castType, build, override, scores);
      const mod = abilityModifier(scores[ability]);
      track.ability = ability;
      track.pointsMax += mod;
      track.saveDc = 8 + prof + mod;
      track.attackBonus = prof + mod;
      // POWER_LIMIT[maxClassProg] is the first power level that's once-per-rest (UI hint, surfaced later).
      void POWER_LIMIT;
    }
  }

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/swdnd/src/lib/rules/casting.test.ts`
Expected: PASS (5 pass).

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/rules/casting.ts apps/swdnd/src/lib/rules/casting.test.ts
git commit -m "feat(swdnd): force/tech powercasting compute (points, DCs, multiclass)"
```

---

## Task 5: Combat — HP, AC, initiative, speed, hit dice

**Files:**
- Create: `apps/swdnd/src/lib/rules/combat.ts`
- Test: `apps/swdnd/src/lib/rules/combat.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/swdnd/src/lib/rules/combat.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild, type RefArmor, type RefClass, type RefSpecies, type ReferenceData } from './types';
import { maxHp, armorClass, initiative, speed, hitDice } from './combat';

const consular: RefClass = {
  id: 'consular', name: 'Consular', hitDie: 6, saves: ['wis', 'cha'],
  skillChoices: [], skillNumber: 2, powercasting: { force: 'full', tech: 'none' }, superiorityProgression: 0,
};
const human: RefSpecies = { id: 'human', name: 'Human', walkSpeed: 30 };
const beskar: RefArmor = { id: 'beskar', name: 'Beskar weave', baseAc: 14, dexCap: 2, kind: 'medium' };
const shield: RefArmor = { id: 'shield', name: 'Light shield', baseAc: 2, dexCap: null, kind: 'shield' };

function ref(over: Partial<ReferenceData> = {}): ReferenceData {
  return { classes: { consular }, archetypes: {}, species: { human }, armor: { beskar, shield }, weapons: {}, powers: {}, ...over };
}

test('maxHp: first level max die + later levels average, plus con each level', () => {
  const b = emptyBuild('Lyra');
  b.abilities.base.con = 12; // +1
  b.levels = Array.from({ length: 5 }, (_, i) => ({ n: i + 1, classId: 'consular', archetypeId: null, hp: 'avg' as const }));
  // L1 = 6 + 1 = 7 ; L2-5 = (3+1)+1 = 5 each -> 20 ; total 27
  expect(maxHp(b, ref())).toBe(27);
});

test('maxHp honors a rolled level value', () => {
  const b = emptyBuild('x');
  b.levels = [
    { n: 1, classId: 'consular', archetypeId: null, hp: 'avg' }, // 6
    { n: 2, classId: 'consular', archetypeId: null, hp: 5 },     // 5
  ];
  expect(maxHp(b, ref())).toBe(11);
});

test('armorClass: unarmored, medium with dex cap, plus shield', () => {
  const b = emptyBuild('x');
  b.abilities.base.dex = 14; // +2
  expect(armorClass(b, ref())).toBe(12); // 10 + 2
  b.equipment = [{ ref: 'beskar', qty: 1, equipped: true }];
  expect(armorClass(b, ref())).toBe(16); // 14 + min(2,2)
  b.equipment.push({ ref: 'shield', qty: 1, equipped: true });
  expect(armorClass(b, ref())).toBe(18); // + shield 2
});

test('heavy armor ignores dex; light armor uncapped', () => {
  const b = emptyBuild('x');
  b.abilities.base.dex = 18; // +4
  const heavy: RefArmor = { id: 'h', name: 'Heavy', baseAc: 18, dexCap: 0, kind: 'heavy' };
  const light: RefArmor = { id: 'l', name: 'Light', baseAc: 11, dexCap: null, kind: 'light' };
  b.equipment = [{ ref: 'h', qty: 1, equipped: true }];
  expect(armorClass(b, ref({ armor: { h: heavy, l: light } }))).toBe(18);
  b.equipment = [{ ref: 'l', qty: 1, equipped: true }];
  expect(armorClass(b, ref({ armor: { h: heavy, l: light } }))).toBe(15); // 11 + 4
});

test('initiative, speed, hit dice', () => {
  const b = emptyBuild('x');
  b.abilities.base.dex = 14;
  b.identity.speciesId = 'human';
  b.levels = [
    { n: 1, classId: 'consular', archetypeId: null, hp: 'avg' },
    { n: 2, classId: 'consular', archetypeId: null, hp: 'avg' },
  ];
  expect(initiative(b)).toBe(2);
  expect(speed(b, ref())).toBe(30);
  expect(hitDice(b, ref())).toEqual({ d6: 2 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/swdnd/src/lib/rules/combat.test.ts`
Expected: FAIL — cannot resolve module `./combat`.

- [ ] **Step 3: Write combat**

```ts
// apps/swdnd/src/lib/rules/combat.ts
import { abilityModifier, classesTaken, totalAbilityScores } from './core';
import type { CharacterBuild, ReferenceData } from './types';

export function maxHp(build: CharacterBuild, ref: ReferenceData): number {
  const conMod = abilityModifier(totalAbilityScores(build).con);
  let total = 0;
  for (const lvl of build.levels) {
    const cls = ref.classes[lvl.classId];
    const die = cls?.hitDie ?? 6;
    const base = lvl.n === 1
      ? die
      : (lvl.hp === 'avg' ? Math.floor(die / 2) + 1 : lvl.hp);
    total += Math.max(1, base + conMod);
  }
  return total;
}

export function armorClass(build: CharacterBuild, ref: ReferenceData): number {
  const dexMod = abilityModifier(totalAbilityScores(build).dex);
  const equipped = build.equipment.filter((e) => e.equipped).map((e) => ref.armor[e.ref]).filter(Boolean);
  const body = equipped.find((a) => a.kind !== 'shield');
  const shield = equipped.find((a) => a.kind === 'shield');

  let ac: number;
  if (!body) {
    ac = 10 + dexMod;
  } else {
    const dexPart = body.dexCap == null ? dexMod : Math.min(dexMod, body.dexCap);
    ac = body.baseAc + dexPart;
  }
  if (shield) ac += shield.baseAc;
  return ac;
}

export function initiative(build: CharacterBuild): number {
  return abilityModifier(totalAbilityScores(build).dex);
}

export function speed(build: CharacterBuild, ref: ReferenceData): number {
  return ref.species[build.identity.speciesId]?.walkSpeed ?? 30;
}

export function hitDice(build: CharacterBuild, ref: ReferenceData): Record<string, number> {
  const out: Record<string, number> = {};
  for (const taken of classesTaken(build)) {
    const die = ref.classes[taken.classId]?.hitDie;
    if (!die) continue;
    const key = `d${die}`;
    out[key] = (out[key] ?? 0) + taken.levels;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/swdnd/src/lib/rules/combat.test.ts`
Expected: PASS (5 pass).

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/rules/combat.ts apps/swdnd/src/lib/rules/combat.test.ts
git commit -m "feat(swdnd): combat compute (HP, AC, initiative, speed, hit dice)"
```

---

## Task 6: Skills + saving throws

**Files:**
- Create: `apps/swdnd/src/lib/rules/skills.ts`
- Test: `apps/swdnd/src/lib/rules/skills.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/swdnd/src/lib/rules/skills.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild } from './types';
import { savingThrows, skillBonuses } from './skills';

test('saving throws add proficiency where the build is proficient', () => {
  const b = emptyBuild('x');
  b.abilities.base.wis = 17; // +3
  b.abilities.base.con = 12; // +1
  b.levels = Array.from({ length: 5 }, (_, i) => ({ n: i + 1, classId: 'consular', archetypeId: null, hp: 'avg' as const }));
  b.proficiencies.savingThrows = ['wis', 'cha'];
  const saves = savingThrows(b);
  expect(saves.wis).toEqual({ bonus: 6, proficient: true }); // +3 + prof 3
  expect(saves.con).toEqual({ bonus: 1, proficient: false });
});

test('skill bonuses apply proficiency and expertise', () => {
  const b = emptyBuild('x');
  b.abilities.base.int = 16; // +3
  b.abilities.base.dex = 14; // +2
  b.levels = [{ n: 1, classId: 'consular', archetypeId: null, hp: 'avg' }]; // prof 2
  b.proficiencies.skills = ['lor', 'ste'];
  b.proficiencies.expertise = ['lor'];
  const skills = skillBonuses(b);
  const lore = skills.find((s) => s.key === 'lor')!;
  const stealth = skills.find((s) => s.key === 'ste')!;
  const acr = skills.find((s) => s.key === 'acr')!;
  expect(lore).toMatchObject({ bonus: 3 + 2 + 2, proficient: true, expertise: true }); // int + prof + prof
  expect(stealth).toMatchObject({ bonus: 2 + 2, proficient: true, expertise: false });
  expect(acr).toMatchObject({ bonus: 2, proficient: false });
  expect(skills).toHaveLength(18);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/swdnd/src/lib/rules/skills.test.ts`
Expected: FAIL — cannot resolve module `./skills`.

- [ ] **Step 3: Write skills**

```ts
// apps/swdnd/src/lib/rules/skills.ts
import { ABILITIES, SKILLS } from './constants';
import { abilityModifier, proficiencyBonus, totalAbilityScores, totalLevel } from './core';
import type { AbilityKey, CharacterBuild, SkillBonus, SkillKey } from './types';

export function savingThrows(
  build: CharacterBuild,
): Record<AbilityKey, { bonus: number; proficient: boolean }> {
  const scores = totalAbilityScores(build);
  const prof = proficiencyBonus(totalLevel(build));
  const proficientSet = new Set(build.proficiencies.savingThrows);
  const out = {} as Record<AbilityKey, { bonus: number; proficient: boolean }>;
  for (const key of ABILITIES) {
    const proficient = proficientSet.has(key);
    out[key] = { bonus: abilityModifier(scores[key]) + (proficient ? prof : 0), proficient };
  }
  return out;
}

export function skillBonuses(build: CharacterBuild): SkillBonus[] {
  const scores = totalAbilityScores(build);
  const prof = proficiencyBonus(totalLevel(build));
  const profSet = new Set(build.proficiencies.skills);
  const expSet = new Set(build.proficiencies.expertise);
  return (Object.keys(SKILLS) as SkillKey[]).map((key) => {
    const { ability } = SKILLS[key];
    const proficient = profSet.has(key);
    const expertise = proficient && expSet.has(key);
    const bonus = abilityModifier(scores[ability]) + (proficient ? prof : 0) + (expertise ? prof : 0);
    return { key, ability, bonus, proficient, expertise };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/swdnd/src/lib/rules/skills.test.ts`
Expected: PASS (2 pass).

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/rules/skills.ts apps/swdnd/src/lib/rules/skills.test.ts
git commit -m "feat(swdnd): skills + saving-throw compute"
```

---

## Task 7: Superiority

**Files:**
- Create: `apps/swdnd/src/lib/rules/superiority.ts`
- Test: `apps/swdnd/src/lib/rules/superiority.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/swdnd/src/lib/rules/superiority.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild, type RefClass, type ReferenceData } from './types';
import { computeSuperiority } from './superiority';

function ref(classes: Record<string, RefClass>): ReferenceData {
  return { classes, archetypes: {}, species: {}, armor: {}, weapons: {}, powers: {} };
}
const base: RefClass = {
  id: 'x', name: 'X', hitDie: 10, saves: [], skillChoices: [], skillNumber: 2,
  powercasting: { force: 'none', tech: 'none' }, superiorityProgression: 0,
};

test('no superiority classes -> null', () => {
  const b = emptyBuild('x');
  b.levels = [{ n: 1, classId: 'x', archetypeId: null, hp: 'avg' }];
  expect(computeSuperiority(b, ref({ x: base }))).toBeNull();
});

test('full superiority progression at 3 levels', () => {
  const sup: RefClass = { ...base, id: 'bm', superiorityProgression: 1 };
  const b = emptyBuild('x');
  b.levels = Array.from({ length: 3 }, (_, i) => ({ n: i + 1, classId: 'bm', archetypeId: null, hp: 'avg' as const }));
  // dice = round(quant[3]*1)=4 ; die = size[3]='d4' ; known = maneuvers[round(3*1)=3]=4
  expect(computeSuperiority(b, ref({ bm: sup }))).toEqual({ level: 3, diceMax: 4, die: 'd4', knownMax: 4 });
});

test('half progression rounds and uses raw class levels for die size', () => {
  const sup: RefClass = { ...base, id: 'sc', superiorityProgression: 0.5 };
  const b = emptyBuild('x');
  b.levels = Array.from({ length: 4 }, (_, i) => ({ n: i + 1, classId: 'sc', archetypeId: null, hp: 'avg' as const }));
  // dice = round(quant[4]*0.5)=round(2)=2 ; die = size[4]='d4' ; level = round(4*0.5)=2 ; known = maneuvers[2]=2
  expect(computeSuperiority(b, ref({ sc: sup }))).toEqual({ level: 2, diceMax: 2, die: 'd4', knownMax: 2 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/swdnd/src/lib/rules/superiority.test.ts`
Expected: FAIL — cannot resolve module `./superiority`.

- [ ] **Step 3: Write superiority**

```ts
// apps/swdnd/src/lib/rules/superiority.ts
import { SUPERIORITY_DICE_QUANT, SUPERIORITY_DIE_SIZE, MANEUVERS_KNOWN } from './constants';
import { classesTaken } from './core';
import type { CharacterBuild, ReferenceData, SuperiorityBlock } from './types';

export function computeSuperiority(
  build: CharacterBuild,
  ref: ReferenceData,
): SuperiorityBlock | null {
  let level = 0;
  let superiorityClassLevels = 0;
  let diceMax = 0;
  let knownMax = 0;

  for (const taken of classesTaken(build)) {
    const cls = ref.classes[taken.classId];
    if (!cls) continue;
    const arch = taken.archetypeId ? ref.archetypes[taken.archetypeId] : undefined;
    const progression = Math.max(cls.superiorityProgression ?? 0, arch?.superiorityProgression ?? 0);
    if (!progression) continue;

    level += taken.levels * progression;
    superiorityClassLevels += taken.levels;
    diceMax += Math.round((SUPERIORITY_DICE_QUANT[taken.levels] ?? 0) * progression);
    knownMax += MANEUVERS_KNOWN[Math.round(taken.levels * progression)] ?? 0;
  }

  if (superiorityClassLevels === 0) return null;
  return {
    level: Math.round(level),
    diceMax,
    die: SUPERIORITY_DIE_SIZE[superiorityClassLevels] ?? '',
    knownMax,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/swdnd/src/lib/rules/superiority.test.ts`
Expected: PASS (3 pass).

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/rules/superiority.ts apps/swdnd/src/lib/rules/superiority.test.ts
git commit -m "feat(swdnd): superiority dice compute"
```

---

## Task 8: Orchestrator — `computeSheet` + overrides

**Files:**
- Create: `apps/swdnd/src/lib/rules/index.ts`
- Test: `apps/swdnd/src/lib/rules/index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/swdnd/src/lib/rules/index.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild, type RefClass, type RefSpecies, type ReferenceData } from './types';
import { computeSheet } from './index';

const consular: RefClass = {
  id: 'consular', name: 'Consular', hitDie: 6, saves: ['wis', 'cha'],
  skillChoices: [], skillNumber: 2, powercasting: { force: 'full', tech: 'none' }, superiorityProgression: 0,
};
const human: RefSpecies = { id: 'human', name: 'Human', walkSpeed: 30 };
const ref: ReferenceData = { classes: { consular }, archetypes: {}, species: { human }, armor: {}, weapons: {}, powers: {} };

function lyra() {
  const b = emptyBuild('Lyra Voss');
  b.identity = { name: 'Lyra Voss', speciesId: 'human', backgroundId: '', alignment: 'light' };
  b.abilities.base = { str: 10, dex: 14, con: 12, int: 13, wis: 17, cha: 11 };
  b.levels = Array.from({ length: 5 }, (_, i) => ({ n: i + 1, classId: 'consular', archetypeId: null, hp: 'avg' as const }));
  b.proficiencies.savingThrows = ['wis', 'cha'];
  b.proficiencies.skills = ['ins', 'per'];
  return b;
}

test('computeSheet assembles a full derived sheet (Consular 5)', () => {
  const s = computeSheet(lyra(), ref);
  expect(s.totalLevel).toBe(5);
  expect(s.proficiencyBonus).toBe(3);
  expect(s.abilities.wis).toEqual({ score: 17, mod: 3 });
  expect(s.maxHp).toBe(27);
  expect(s.armorClass).toBe(12);
  expect(s.initiative).toBe(2);
  expect(s.speed).toBe(30);
  expect(s.hitDice).toEqual({ d6: 5 });
  expect(s.savingThrows.wis.bonus).toBe(6);
  expect(s.casting.force.maxPowerLevel).toBe(3);
  expect(s.casting.force.saveDc).toBe(14);
  expect(s.superiority).toBeNull();
});

test('overrides replace a derived scalar and report the flag is irrelevant to value', () => {
  const b = lyra();
  b.overrides = { maxHp: 40, armorClass: 18 };
  const s = computeSheet(b, ref);
  expect(s.maxHp).toBe(40);
  expect(s.armorClass).toBe(18);
  expect(s.initiative).toBe(2); // untouched
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/swdnd/src/lib/rules/index.test.ts`
Expected: FAIL — cannot resolve module `./index`.

- [ ] **Step 3: Write the orchestrator**

```ts
// apps/swdnd/src/lib/rules/index.ts
import { ABILITIES } from './constants';
import { computeCasting } from './casting';
import { armorClass, hitDice, initiative, maxHp, speed } from './combat';
import { abilityModifier, proficiencyBonus, totalAbilityScores, totalLevel } from './core';
import { savingThrows, skillBonuses } from './skills';
import { computeSuperiority } from './superiority';
import type { AbilityBlock, AbilityKey, CharacterBuild, DerivedSheet, ReferenceData } from './types';

export * from './types';

/** Overridable scalar fields. If `build.overrides[field]` is a number, it wins. */
const OVERRIDABLE = ['maxHp', 'armorClass', 'initiative', 'speed'] as const;
type Overridable = (typeof OVERRIDABLE)[number];

function applyOverride(build: CharacterBuild, field: Overridable, computed: number): number {
  const o = build.overrides[field];
  return typeof o === 'number' ? o : computed;
}

export function computeSheet(build: CharacterBuild, ref: ReferenceData): DerivedSheet {
  const scores = totalAbilityScores(build);
  const level = totalLevel(build);

  const abilities = {} as Record<AbilityKey, AbilityBlock>;
  for (const key of ABILITIES) {
    abilities[key] = { score: scores[key], mod: abilityModifier(scores[key]) };
  }

  return {
    totalLevel: level,
    proficiencyBonus: proficiencyBonus(level),
    abilities,
    maxHp: applyOverride(build, 'maxHp', maxHp(build, ref)),
    armorClass: applyOverride(build, 'armorClass', armorClass(build, ref)),
    initiative: applyOverride(build, 'initiative', initiative(build)),
    speed: applyOverride(build, 'speed', speed(build, ref)),
    hitDice: hitDice(build, ref),
    savingThrows: savingThrows(build),
    skills: skillBonuses(build),
    casting: computeCasting(build, ref),
    superiority: computeSuperiority(build, ref),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/swdnd/src/lib/rules/`
Expected: PASS — the whole engine suite green.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/rules/index.ts apps/swdnd/src/lib/rules/index.test.ts
git commit -m "feat(swdnd): computeSheet orchestrator + override application"
```

---

## Task 9: Backend access helpers

**Files:**
- Create: `apps/backend/src/routes/swdnd/access.ts`
- Test: `apps/backend/src/routes/swdnd/access.test.ts`

Context: the foundation's blanket `/swdnd/*` `authGate` only lets the admin mutate. Players must be able to write their *own* character, so character/player mutation routes are exempted from that blanket gate (Task 12) and call `assertCharacterWriteAccess` themselves. Access rules: a write is allowed when (a) no `ASHERCARLOW_AUTH_TOKEN` is set (dev mode), or (b) the request carries the admin bearer/cookie, or (c) the request carries a player token (header `X-Player-Token` or `?token=`) whose player owns the character.

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/src/routes/swdnd/access.test.ts
import { test, expect, beforeAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let mod: typeof import('./access');
let dbMod: typeof import('../../db/swdnd');

beforeAll(async () => {
  process.env.SWDND_DB_PATH = join(tmpdir(), `swdnd-access-${crypto.randomUUID()}.sqlite`);
  delete process.env.ASHERCARLOW_AUTH_TOKEN;
  dbMod = await import('../../db/swdnd');
  mod = await import('./access');
  // The swdndDb singleton is shared across test files in one bun process, so
  // clear it before seeding to stay isolated regardless of file run order.
  dbMod.swdndDb.exec('DELETE FROM character; DELETE FROM player; DELETE FROM campaign;');
  // seed a campaign + player
  dbMod.swdndDb.run('INSERT INTO campaign (id,name,created_at,updated_at) VALUES (?,?,?,?)', ['c1', 'C', 'n', 'n']);
  dbMod.swdndDb.run('INSERT INTO player (id,campaign_id,name,access_token,created_at) VALUES (?,?,?,?,?)', ['p1', 'c1', 'Ash', 'tok-1', 'n']);
});

function reqWith(headers: Record<string, string>, url = 'http://x/swdnd/characters/x') {
  // raw.headers is required because isCookieAuthed -> getCookie reads c.req.raw.headers.
  return { req: { header: (k: string) => headers[k.toLowerCase()], url, method: 'PATCH', raw: { headers: new Headers(headers) } } } as any;
}

test('resolvePlayerByToken finds the owning player', () => {
  expect(mod.resolvePlayerByToken('tok-1')?.id).toBe('p1');
  expect(mod.resolvePlayerByToken('nope')).toBeNull();
});

test('dev mode (no admin token) allows any write', () => {
  expect(() => mod.assertCharacterWriteAccess(reqWith({}), { player_id: 'p1' })).not.toThrow();
});

test('with admin token set, owning player token passes; wrong token 403s', () => {
  process.env.ASHERCARLOW_AUTH_TOKEN = 'admin-secret';
  expect(() => mod.assertCharacterWriteAccess(reqWith({ 'x-player-token': 'tok-1' }), { player_id: 'p1' })).not.toThrow();
  expect(() => mod.assertCharacterWriteAccess(reqWith({ 'x-player-token': 'tok-1' }), { player_id: 'other' })).toThrow();
  expect(() => mod.assertCharacterWriteAccess(reqWith({ authorization: 'Bearer admin-secret' }), { player_id: 'p1' })).not.toThrow();
  expect(() => mod.assertCharacterWriteAccess(reqWith({}), { player_id: 'p1' })).toThrow();
  delete process.env.ASHERCARLOW_AUTH_TOKEN;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/backend/src/routes/swdnd/access.test.ts`
Expected: FAIL — cannot resolve module `./access`.

- [ ] **Step 3: Write the access helpers**

```ts
// apps/backend/src/routes/swdnd/access.ts
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { swdndDb } from '../../db/swdnd';
import { isCookieAuthed } from '../auth';

export interface PlayerRow {
  id: string;
  campaign_id: string;
  name: string;
  access_token: string;
  created_at: string;
}

/** Resolve a player slot by its unguessable access token. */
export function resolvePlayerByToken(token: string | undefined): PlayerRow | null {
  if (!token) return null;
  return swdndDb
    .query<PlayerRow, [string]>('SELECT * FROM player WHERE access_token = ?')
    .get(token) ?? null;
}

/** The player token from header or query string, if any. */
export function playerTokenFrom(c: Context): string | undefined {
  return c.req.header('X-Player-Token') ?? new URL(c.req.url).searchParams.get('token') ?? undefined;
}

function isAdmin(c: Context): boolean {
  const expected = process.env.ASHERCARLOW_AUTH_TOKEN;
  if (!expected) return false;
  const header = c.req.header('Authorization')?.replace('Bearer ', '');
  return header === expected || isCookieAuthed(c);
}

/**
 * Throw 403 unless the requester may write this character:
 * dev mode (no admin token), the admin, or the owning player's token.
 */
export function assertCharacterWriteAccess(c: Context, character: { player_id: string | null }): void {
  if (!process.env.ASHERCARLOW_AUTH_TOKEN) return; // dev mode
  if (isAdmin(c)) return;
  const player = resolvePlayerByToken(playerTokenFrom(c));
  if (player && character.player_id && player.id === character.player_id) return;
  throw new HTTPException(403, { message: 'Not allowed to modify this character' });
}

/** Throw 403 unless the requester is the admin (dev mode passes). */
export function assertAdmin(c: Context): void {
  if (!process.env.ASHERCARLOW_AUTH_TOKEN) return;
  if (!isAdmin(c)) throw new HTTPException(403, { message: 'Admin only' });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/backend/src/routes/swdnd/access.test.ts`
Expected: PASS (3 pass).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/routes/swdnd/access.ts apps/backend/src/routes/swdnd/access.test.ts
git commit -m "feat(swdnd): character/player access helpers"
```

---

## Task 10: Backend character routes

**Files:**
- Create: `apps/backend/src/routes/swdnd/characters.ts`
- Test: `apps/backend/src/routes/swdnd/characters.test.ts`

Context: follow the campaigns route file exactly for shape (zod schemas, `createRoute`, `app.openapi`, `HTTPException`, `swdndDb`). `data_json` is stored as a JSON string and returned parsed. PATCH broadcasts `character:updated` to the campaign room via `publishToRoom` + `roomForCampaign`. Creation and mutation call the access helpers.

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/src/routes/swdnd/characters.test.ts
import { test, expect, beforeAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAPIHono } from '@hono/zod-openapi';

let app: OpenAPIHono;
let swdndDb: import('bun:sqlite').Database;

beforeAll(async () => {
  process.env.SWDND_DB_PATH = join(tmpdir(), `swdnd-char-${crypto.randomUUID()}.sqlite`);
  delete process.env.ASHERCARLOW_AUTH_TOKEN; // dev mode: writes open
  ({ swdndDb } = await import('../../db/swdnd'));
  const { registerSwdndRoutes } = await import('./index');
  app = new OpenAPIHono();
  registerSwdndRoutes(app);
  // swdndDb is a shared singleton across test files — reset before seeding.
  swdndDb.exec('DELETE FROM character; DELETE FROM player; DELETE FROM campaign;');
  swdndDb.run('INSERT INTO campaign (id,name,created_at,updated_at) VALUES (?,?,?,?)', ['c1', 'Camp', 'n', 'n']);
});

test('create → get → list → patch → delete', async () => {
  const created = await app.request('/swdnd/campaigns/c1/characters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Lyra' }),
  });
  expect(created.status).toBe(201);
  const char = await created.json();
  expect(char.name).toBe('Lyra');
  expect(char.data_json.schemaVersion).toBe(1); // parsed, not a string

  const got = await app.request(`/swdnd/characters/${char.id}`);
  expect(got.status).toBe(200);

  const list = await app.request('/swdnd/campaigns/c1/characters');
  expect((await list.json())).toHaveLength(1);

  const patched = await app.request(`/swdnd/characters/${char.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Lyra Voss', data_json: { schemaVersion: 1, play: { hp: 12 } } }),
  });
  expect(patched.status).toBe(200);
  expect((await patched.json()).data_json.play.hp).toBe(12);

  const del = await app.request(`/swdnd/characters/${char.id}`, { method: 'DELETE' });
  expect(del.status).toBe(200);
  const after = await app.request(`/swdnd/characters/${char.id}`);
  expect(after.status).toBe(404);
});

test('creating in a missing campaign 404s', async () => {
  const res = await app.request('/swdnd/campaigns/nope/characters', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }),
  });
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/backend/src/routes/swdnd/characters.test.ts`
Expected: FAIL — `./characters` not found / route not registered.

- [ ] **Step 3: Write the character routes**

```ts
// apps/backend/src/routes/swdnd/characters.ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { swdndDb } from '../../db/swdnd';
import { publishToRoom, roomForCampaign } from '../../lib/swdnd-realtime';
import { assertCharacterWriteAccess, resolvePlayerByToken, playerTokenFrom } from './access';

const Character = z
  .object({
    id: z.string(),
    campaign_id: z.string(),
    player_id: z.string().nullable(),
    name: z.string(),
    data_json: z.record(z.any()),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('SwdndCharacter');

interface CharacterRow {
  id: string;
  campaign_id: string;
  player_id: string | null;
  name: string;
  data_json: string;
  created_at: string;
  updated_at: string;
}

const ErrorBody = z.object({ message: z.string() });
const PostBody = z.object({ name: z.string().min(1) }).openapi('SwdndPostCharacter');
const PatchBody = z
  .object({ name: z.string().min(1).optional(), data_json: z.record(z.any()).optional() })
  .openapi('SwdndPatchCharacter');

function toApi(row: CharacterRow) {
  return { ...row, data_json: JSON.parse(row.data_json) as Record<string, unknown> };
}
function emptyBuildJson(name: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    identity: { name, speciesId: '', backgroundId: '', alignment: 'none' },
    abilities: { base: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, increases: [] },
    levels: [],
    proficiencies: { skills: [], expertise: [], tools: [], languages: [], savingThrows: [] },
    equipment: [], credits: 0, knownPowers: [], knownManeuvers: [],
    play: { hp: 0, tempHp: 0, hitDiceSpent: 0, forcePointsSpent: 0, techPointsSpent: 0, superiorityDiceSpent: 0, conditions: [], exhaustion: 0, inspiration: false, notes: '' },
    overrides: {},
  });
}
function getRow(id: string): CharacterRow | null {
  return swdndDb.query<CharacterRow, [string]>('SELECT * FROM character WHERE id = ?').get(id) ?? null;
}

const listRoute = createRoute({
  method: 'get', path: '/swdnd/campaigns/{id}/characters', tags: ['swdnd'],
  summary: 'List characters in a campaign',
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Characters', content: { 'application/json': { schema: z.array(Character) } } } },
});

const getRoute = createRoute({
  method: 'get', path: '/swdnd/characters/{id}', tags: ['swdnd'], summary: 'Get one character',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Character', content: { 'application/json': { schema: Character } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const postRoute = createRoute({
  method: 'post', path: '/swdnd/campaigns/{id}/characters', tags: ['swdnd'],
  summary: 'Create a character (admin or a player in the campaign)',
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: PostBody } } } },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: Character } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Campaign not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const patchRoute = createRoute({
  method: 'patch', path: '/swdnd/characters/{id}', tags: ['swdnd'],
  summary: 'Update a character build/play state; broadcasts to the campaign room',
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: PatchBody } } } },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: Character } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const deleteRoute = createRoute({
  method: 'delete', path: '/swdnd/characters/{id}', tags: ['swdnd'], summary: 'Delete a character',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

export function registerCharacterRoutes(app: OpenAPIHono): void {
  app.openapi(listRoute, (c) => {
    const { id } = c.req.valid('param');
    const rows = swdndDb
      .query<CharacterRow, [string]>('SELECT * FROM character WHERE campaign_id = ? ORDER BY created_at ASC')
      .all(id);
    return c.json(rows.map(toApi), 200);
  });

  app.openapi(getRoute, (c) => {
    const { id } = c.req.valid('param');
    const row = getRow(id);
    if (!row) throw new HTTPException(404, { message: 'Character not found' });
    return c.json(toApi(row), 200);
  });

  app.openapi(postRoute, (c) => {
    const { id: campaignId } = c.req.valid('param');
    const { name } = c.req.valid('json');
    const campaign = swdndDb.query<{ id: string }, [string]>('SELECT id FROM campaign WHERE id = ?').get(campaignId);
    if (!campaign) throw new HTTPException(404, { message: 'Campaign not found' });

    // A player creating a character is the owner; admin/dev creates an unassigned one.
    const player = resolvePlayerByToken(playerTokenFrom(c));
    const playerId = player && player.campaign_id === campaignId ? player.id : null;
    if (process.env.ASHERCARLOW_AUTH_TOKEN && !playerId) assertCharacterWriteAccess(c, { player_id: null });

    const now = new Date().toISOString();
    const charId = crypto.randomUUID();
    swdndDb.run(
      'INSERT INTO character (id, campaign_id, player_id, name, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [charId, campaignId, playerId, name, emptyBuildJson(name), now, now],
    );
    return c.json(toApi(getRow(charId)!), 201);
  });

  app.openapi(patchRoute, (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const row = getRow(id);
    if (!row) throw new HTTPException(404, { message: 'Character not found' });
    assertCharacterWriteAccess(c, row);

    const now = new Date().toISOString();
    const name = body.name ?? row.name;
    const dataJson = body.data_json !== undefined ? JSON.stringify(body.data_json) : row.data_json;
    swdndDb.run('UPDATE character SET name = ?, data_json = ?, updated_at = ? WHERE id = ?', [name, dataJson, now, id]);

    const updated = toApi(getRow(id)!);
    const room = roomForCampaign(row.campaign_id);
    publishToRoom(room, {
      type: 'character:updated', room,
      payload: { characterId: id, name: updated.name, play: (updated.data_json as { play?: unknown }).play },
    });
    return c.json(updated, 200);
  });

  app.openapi(deleteRoute, (c) => {
    const { id } = c.req.valid('param');
    const row = getRow(id);
    if (!row) throw new HTTPException(404, { message: 'Character not found' });
    assertCharacterWriteAccess(c, row);
    swdndDb.run('DELETE FROM character WHERE id = ?', [id]);
    return c.json({ ok: true }, 200);
  });
}
```

- [ ] **Step 4: Register the routes (so the test's `registerSwdndRoutes` includes them)**

Apply this in Task 12; for now, temporarily add `registerCharacterRoutes(app)` to `apps/backend/src/routes/swdnd/index.ts` and import it, so the test passes:

```ts
// apps/backend/src/routes/swdnd/index.ts  (interim — finalized in Task 12)
import { registerCharacterRoutes } from './characters';
// ...inside registerSwdndRoutes, after registerCampaignRoutes(app):
registerCharacterRoutes(app);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test apps/backend/src/routes/swdnd/characters.test.ts`
Expected: PASS (2 pass).

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/routes/swdnd/characters.ts apps/backend/src/routes/swdnd/characters.test.ts apps/backend/src/routes/swdnd/index.ts
git commit -m "feat(swdnd): character CRUD routes with broadcast"
```

---

## Task 11: Backend player routes

**Files:**
- Create: `apps/backend/src/routes/swdnd/players.ts`
- Test: `apps/backend/src/routes/swdnd/players.test.ts`

Context: `POST /swdnd/campaigns/{id}/players` is admin-only (creates a slot with an unguessable `access_token`). `GET /swdnd/players/me?token=…` resolves the player + their characters for the player link.

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/src/routes/swdnd/players.test.ts
import { test, expect, beforeAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAPIHono } from '@hono/zod-openapi';

let app: OpenAPIHono;
let swdndDb: import('bun:sqlite').Database;

beforeAll(async () => {
  process.env.SWDND_DB_PATH = join(tmpdir(), `swdnd-players-${crypto.randomUUID()}.sqlite`);
  delete process.env.ASHERCARLOW_AUTH_TOKEN;
  ({ swdndDb } = await import('../../db/swdnd'));
  const { registerSwdndRoutes } = await import('./index');
  app = new OpenAPIHono();
  registerSwdndRoutes(app);
  // swdndDb is a shared singleton across test files — reset before seeding.
  swdndDb.exec('DELETE FROM character; DELETE FROM player; DELETE FROM campaign;');
  swdndDb.run('INSERT INTO campaign (id,name,created_at,updated_at) VALUES (?,?,?,?)', ['c1', 'Camp', 'n', 'n']);
});

test('create a player slot then resolve it by token', async () => {
  const created = await app.request('/swdnd/campaigns/c1/players', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Ash' }),
  });
  expect(created.status).toBe(201);
  const player = await created.json();
  expect(player.name).toBe('Ash');
  expect(typeof player.access_token).toBe('string');

  const me = await app.request(`/swdnd/players/me?token=${player.access_token}`);
  expect(me.status).toBe(200);
  const body = await me.json();
  expect(body.player.id).toBe(player.id);
  expect(body.characters).toEqual([]);
});

test('unknown token 404s', async () => {
  const res = await app.request('/swdnd/players/me?token=nope');
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/backend/src/routes/swdnd/players.test.ts`
Expected: FAIL — `./players` not found / routes not registered.

- [ ] **Step 3: Write the player routes**

```ts
// apps/backend/src/routes/swdnd/players.ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { swdndDb } from '../../db/swdnd';
import { assertAdmin, resolvePlayerByToken } from './access';

const Player = z
  .object({
    id: z.string(),
    campaign_id: z.string(),
    name: z.string(),
    access_token: z.string(),
    created_at: z.string(),
  })
  .openapi('SwdndPlayer');

interface PlayerRow {
  id: string; campaign_id: string; name: string; access_token: string; created_at: string;
}
interface CharLite { id: string; name: string; campaign_id: string }

const ErrorBody = z.object({ message: z.string() });
const PostBody = z.object({ name: z.string().min(1) }).openapi('SwdndPostPlayer');
const MeBody = z.object({
  player: Player,
  characters: z.array(z.object({ id: z.string(), name: z.string(), campaign_id: z.string() })),
}).openapi('SwdndPlayerMe');

const postRoute = createRoute({
  method: 'post', path: '/swdnd/campaigns/{id}/players', tags: ['swdnd'],
  summary: 'Create a player slot in a campaign (DM only); returns a shareable token',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: PostBody } } } },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: Player } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Campaign not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const meRoute = createRoute({
  method: 'get', path: '/swdnd/players/me', tags: ['swdnd'],
  summary: 'Resolve a player and their characters from an access token',
  request: { query: z.object({ token: z.string() }) },
  responses: {
    200: { description: 'Player + characters', content: { 'application/json': { schema: MeBody } } },
    404: { description: 'Unknown token', content: { 'application/json': { schema: ErrorBody } } },
  },
});

export function registerPlayerRoutes(app: OpenAPIHono): void {
  app.openapi(postRoute, (c) => {
    assertAdmin(c);
    const { id: campaignId } = c.req.valid('param');
    const { name } = c.req.valid('json');
    const campaign = swdndDb.query<{ id: string }, [string]>('SELECT id FROM campaign WHERE id = ?').get(campaignId);
    if (!campaign) throw new HTTPException(404, { message: 'Campaign not found' });

    const now = new Date().toISOString();
    const playerId = crypto.randomUUID();
    const token = crypto.randomUUID();
    swdndDb.run(
      'INSERT INTO player (id, campaign_id, name, access_token, created_at) VALUES (?, ?, ?, ?, ?)',
      [playerId, campaignId, name, token, now],
    );
    return c.json({ id: playerId, campaign_id: campaignId, name, access_token: token, created_at: now }, 201);
  });

  app.openapi(meRoute, (c) => {
    const { token } = c.req.valid('query');
    const player = resolvePlayerByToken(token) as PlayerRow | null;
    if (!player) throw new HTTPException(404, { message: 'Unknown token' });
    const characters = swdndDb
      .query<CharLite, [string]>('SELECT id, name, campaign_id FROM character WHERE player_id = ? ORDER BY created_at ASC')
      .all(player.id);
    return c.json({ player, characters }, 200);
  });
}
```

- [ ] **Step 4: Register the routes (interim)**

Add to `apps/backend/src/routes/swdnd/index.ts` (finalized in Task 12):

```ts
import { registerPlayerRoutes } from './players';
// ...inside registerSwdndRoutes:
registerPlayerRoutes(app);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test apps/backend/src/routes/swdnd/players.test.ts`
Expected: PASS (2 pass).

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/routes/swdnd/players.ts apps/backend/src/routes/swdnd/players.test.ts apps/backend/src/routes/swdnd/index.ts
git commit -m "feat(swdnd): player-slot creation + token resolution routes"
```

---

## Task 12: Wire routes + exempt character/player routes from the blanket admin gate

**Files:**
- Modify: `apps/backend/src/routes/swdnd/index.ts`
- Test: `apps/backend/src/routes/swdnd/gate.test.ts`

Context: the blanket `/swdnd/*` middleware (foundation) 401s any non-GET that isn't the admin. That would block a player's own PATCH. The character/player mutation routes must be exempt from the blanket gate so their own `assert*` checks run. Player-slot creation stays admin-gated *inside* its handler (`assertAdmin`), so exempting it from the blanket gate is safe.

- [ ] **Step 1: Write the failing test (player can write own character even with admin token set)**

```ts
// apps/backend/src/routes/swdnd/gate.test.ts
import { test, expect, beforeAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAPIHono } from '@hono/zod-openapi';

let app: OpenAPIHono;
let swdndDb: import('bun:sqlite').Database;

beforeAll(async () => {
  process.env.SWDND_DB_PATH = join(tmpdir(), `swdnd-gate-${crypto.randomUUID()}.sqlite`);
  process.env.ASHERCARLOW_AUTH_TOKEN = 'admin-secret'; // production-like
  ({ swdndDb } = await import('../../db/swdnd'));
  const { registerSwdndRoutes } = await import('./index');
  app = new OpenAPIHono();
  registerSwdndRoutes(app);
  // swdndDb is a shared singleton across test files — reset before seeding.
  swdndDb.exec('DELETE FROM character; DELETE FROM player; DELETE FROM campaign;');
  swdndDb.run('INSERT INTO campaign (id,name,created_at,updated_at) VALUES (?,?,?,?)', ['c1', 'Camp', 'n', 'n']);
  swdndDb.run('INSERT INTO player (id,campaign_id,name,access_token,created_at) VALUES (?,?,?,?,?)', ['p1', 'c1', 'Ash', 'tok-1', 'n']);
  swdndDb.run(
    "INSERT INTO character (id,campaign_id,player_id,name,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    ['ch1', 'c1', 'p1', 'Lyra', '{"schemaVersion":1}', 'n', 'n'],
  );
});

test('blanket gate still blocks non-admin content mutation', async () => {
  const res = await app.request('/swdnd/campaigns', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }),
  });
  expect(res.status).toBe(401);
});

test('owning player can PATCH their character with their token', async () => {
  const res = await app.request('/swdnd/characters/ch1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Player-Token': 'tok-1' },
    body: JSON.stringify({ data_json: { schemaVersion: 1, play: { hp: 5 } } }),
  });
  expect(res.status).toBe(200);
});

test('a stranger cannot PATCH the character', async () => {
  const res = await app.request('/swdnd/characters/ch1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Player-Token': 'wrong' },
    body: JSON.stringify({ data_json: { schemaVersion: 1 } }),
  });
  expect(res.status).toBe(403);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/backend/src/routes/swdnd/gate.test.ts`
Expected: FAIL — the owning-player PATCH returns 401 (blanket gate blocks it) instead of 200.

- [ ] **Step 3: Update the router to exempt character/player paths**

```ts
// apps/backend/src/routes/swdnd/index.ts
import type { OpenAPIHono } from '@hono/zod-openapi';
import { authGate } from '../auth';
import { registerContentRoutes } from './content';
import { registerCampaignRoutes } from './campaigns';
import { registerCharacterRoutes } from './characters';
import { registerPlayerRoutes } from './players';

/** Paths whose mutations run their own (player-or-admin) access check, so the
 * blanket admin-only gate must not pre-empt them. */
function selfGated(path: string): boolean {
  return path.startsWith('/swdnd/characters') || path.endsWith('/characters') || path.endsWith('/players');
}

export function registerSwdndRoutes(app: OpenAPIHono): void {
  app.use('/swdnd/*', async (c, next) => {
    if (!selfGated(new URL(c.req.url).pathname)) {
      const blocked = authGate(c);
      if (blocked) return blocked;
    }
    return next();
  });

  registerContentRoutes(app);
  registerCampaignRoutes(app);
  registerCharacterRoutes(app);
  registerPlayerRoutes(app);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/backend/src/routes/swdnd/gate.test.ts`
Expected: PASS (3 pass).

- [ ] **Step 5: Run the whole backend suite to confirm no regressions**

Run: `bun test apps/backend`
Expected: PASS — all backend tests green (including the existing foundation tests).

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/routes/swdnd/index.ts apps/backend/src/routes/swdnd/gate.test.ts
git commit -m "feat(swdnd): exempt character/player routes from blanket admin gate"
```

---

## Task 13: Frontend characters API client + reference loader

**Files:**
- Create: `apps/swdnd/src/lib/characters.ts`
- Test: `apps/swdnd/src/lib/characters.test.ts`

Context: thin typed wrappers over the routes using the existing `api<T>()` (`apps/swdnd/src/lib/api.ts`). Also a `loadReference()` that fetches the content categories the engine needs and maps each row's `raw_json` into the engine view types. The mapper is the only logic worth unit-testing here (it depends on the real Foundry shapes); the wrappers are exercised by stubbing `fetch`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/swdnd/src/lib/characters.test.ts
import { test, expect, afterEach } from 'bun:test';
import { mapClassRow, mapArmorRow, mapPowerRow } from './characters';

afterEach(() => { /* no global state */ });

test('mapClassRow pulls hitDie, saves, powercasting, superiority from raw_json', () => {
  const row = {
    id: 'consular', name: 'Consular',
    raw_json: JSON.stringify({
      system: {
        hitDice: 'd6', saves: ['wis', 'cha'],
        skills: { number: 2, choices: ['ins', 'lor', 'per'] },
        powercasting: { force: 'full', tech: 'none', forceOverride: '', techOverride: '' },
        superiority: { progression: '0' },
      },
    }),
  };
  const c = mapClassRow(row);
  expect(c).toMatchObject({
    id: 'consular', name: 'Consular', hitDie: 6, saves: ['wis', 'cha'],
    skillNumber: 2, skillChoices: ['ins', 'lor', 'per'],
    powercasting: { force: 'full', tech: 'none' }, superiorityProgression: 0,
  });
});

test('mapArmorRow classifies kind and dex cap', () => {
  const row = { id: 'b', name: 'Beskar', raw_json: JSON.stringify({ system: { armor: { value: 14, type: 'medium', dex: 2 } } }) };
  expect(mapArmorRow(row)).toEqual({ id: 'b', name: 'Beskar', baseAc: 14, dexCap: 2, kind: 'medium' });
  const light = { id: 'l', name: 'Combat suit', raw_json: JSON.stringify({ system: { armor: { value: 11, type: 'light', dex: null } } }) };
  expect(mapArmorRow(light).dexCap).toBeNull();
});

test('mapPowerRow reads level and infers cast type from power_type column', () => {
  const row = { id: 'p', name: 'Force Push', power_type: 'force', raw_json: JSON.stringify({ system: { level: 1 } }) };
  expect(mapPowerRow(row)).toEqual({ id: 'p', name: 'Force Push', level: 1, castType: 'force' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/swdnd/src/lib/characters.test.ts`
Expected: FAIL — cannot resolve module `./characters`.

- [ ] **Step 3: Write the client + mappers**

```ts
// apps/swdnd/src/lib/characters.ts
import { api } from './api';
import type {
  AbilityKey, CharacterBuild, Progression, RefArchetype, RefArmor, RefClass,
  RefPower, RefSpecies, RefWeapon, ReferenceData, SkillKey,
} from './rules/types';

// ---- REST wrappers ----
export interface CharacterDto {
  id: string; campaign_id: string; player_id: string | null;
  name: string; data_json: CharacterBuild; created_at: string; updated_at: string;
}
export interface PlayerDto {
  id: string; campaign_id: string; name: string; access_token: string; created_at: string;
}

export function listCharacters(campaignId: string) {
  return api<CharacterDto[]>(`/swdnd/campaigns/${campaignId}/characters`);
}
export function getCharacter(id: string) {
  return api<CharacterDto>(`/swdnd/characters/${id}`);
}
export function createCharacter(campaignId: string, name: string, token?: string) {
  return api<CharacterDto>(`/swdnd/campaigns/${campaignId}/characters${token ? `?token=${token}` : ''}`, {
    method: 'POST', body: JSON.stringify({ name }),
  });
}
export function patchCharacter(id: string, patch: { name?: string; data_json?: CharacterBuild }, token?: string) {
  return api<CharacterDto>(`/swdnd/characters/${id}`, {
    method: 'PATCH',
    headers: token ? { 'X-Player-Token': token } : {},
    body: JSON.stringify(patch),
  });
}
export function deleteCharacter(id: string, token?: string) {
  return api<{ ok: boolean }>(`/swdnd/characters/${id}`, {
    method: 'DELETE', headers: token ? { 'X-Player-Token': token } : {},
  });
}
export function createPlayer(campaignId: string, name: string) {
  return api<PlayerDto>(`/swdnd/campaigns/${campaignId}/players`, { method: 'POST', body: JSON.stringify({ name }) });
}
export function getPlayerByToken(token: string) {
  return api<{ player: PlayerDto; characters: Array<{ id: string; name: string; campaign_id: string }> }>(
    `/swdnd/players/me?token=${encodeURIComponent(token)}`,
  );
}

// ---- Reference loader + row mappers (Foundry raw_json -> engine view types) ----
interface Row { id: string; name?: string | null; raw_json: string; [k: string]: unknown }

function system(row: Row): Record<string, any> {
  try { return (JSON.parse(row.raw_json)?.system ?? {}) as Record<string, any>; } catch { return {}; }
}
function prog(v: unknown): Progression {
  return v === 'full' || v === '3/4' || v === 'half' || v === 'arch' ? v : 'none';
}
function asAbility(v: unknown): AbilityKey | undefined {
  return ['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(v as string) ? (v as AbilityKey) : undefined;
}

export function mapClassRow(row: Row): RefClass {
  const s = system(row);
  const override: Partial<Record<'force' | 'tech', AbilityKey>> = {};
  const fo = asAbility(s.powercasting?.forceOverride); if (fo) override.force = fo;
  const to = asAbility(s.powercasting?.techOverride); if (to) override.tech = to;
  return {
    id: row.id, name: row.name ?? row.id,
    hitDie: Number(String(s.hitDice ?? 'd6').replace('d', '')) || 6,
    saves: Array.isArray(s.saves) ? (s.saves.filter(asAbility) as AbilityKey[]) : [],
    skillChoices: Array.isArray(s.skills?.choices) ? (s.skills.choices as SkillKey[]) : [],
    skillNumber: Number(s.skills?.number ?? 0),
    powercasting: { force: prog(s.powercasting?.force), tech: prog(s.powercasting?.tech) },
    powercastingOverride: Object.keys(override).length ? override : undefined,
    superiorityProgression: Number(s.superiority?.progression ?? 0) || 0,
  };
}

export function mapArchetypeRow(row: Row): RefArchetype {
  const s = system(row);
  const override: Partial<Record<'force' | 'tech', AbilityKey>> = {};
  const fo = asAbility(s.powercasting?.forceOverride); if (fo) override.force = fo;
  const to = asAbility(s.powercasting?.techOverride); if (to) override.tech = to;
  return {
    id: row.id, name: row.name ?? row.id,
    powercasting: { force: prog(s.powercasting?.force), tech: prog(s.powercasting?.tech) },
    powercastingOverride: Object.keys(override).length ? override : undefined,
    superiorityProgression: Number(s.superiority?.progression ?? 0) || 0,
  };
}

export function mapSpeciesRow(row: Row): RefSpecies {
  const s = system(row);
  return { id: row.id, name: row.name ?? row.id, walkSpeed: Number(s.movement?.walk ?? 30) || 30 };
}

export function mapArmorRow(row: Row): RefArmor {
  const s = system(row);
  const type = s.armor?.type as string | undefined;
  const kind: RefArmor['kind'] = type === 'medium' || type === 'heavy' || type === 'shield' ? type : 'light';
  return {
    id: row.id, name: row.name ?? row.id,
    baseAc: Number(s.armor?.value ?? 10) || 10,
    dexCap: s.armor?.dex == null ? null : Number(s.armor.dex),
    kind,
  };
}

export function mapWeaponRow(row: Row): RefWeapon {
  const s = system(row);
  return {
    id: row.id, name: row.name ?? row.id,
    damageParts: Array.isArray(s.damage?.parts) ? (s.damage.parts as Array<[string, string]>) : [],
    properties: (s.properties ?? {}) as Record<string, unknown>,
    ability: asAbility(s.ability) ?? '',
    attackBonus: Number(s.attackBonus ?? 0) || 0,
  };
}

export function mapPowerRow(row: Row): RefPower {
  const s = system(row);
  return {
    id: row.id, name: row.name ?? row.id,
    level: Number(s.level ?? 0) || 0,
    castType: row.power_type === 'tech' ? 'tech' : 'force',
  };
}

function byId<T extends { id: string }>(rows: T[]): Record<string, T> {
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

/** Fetch the content categories the engine needs and map them into ReferenceData. */
export async function loadReference(): Promise<ReferenceData> {
  const [classes, archetypes, species, armor, weapons, powers] = await Promise.all([
    api<Row[]>('/swdnd/content/classes'),
    api<Row[]>('/swdnd/content/archetypes'),
    api<Row[]>('/swdnd/content/species'),
    api<Row[]>('/swdnd/content/armor'),
    api<Row[]>('/swdnd/content/weapons'),
    api<Row[]>('/swdnd/content/powers'),
  ]);
  return {
    classes: byId(classes.map(mapClassRow)),
    archetypes: byId(archetypes.map(mapArchetypeRow)),
    species: byId(species.map(mapSpeciesRow)),
    armor: byId(armor.map(mapArmorRow)),
    weapons: byId(weapons.map(mapWeaponRow)),
    powers: byId(powers.map(mapPowerRow)),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/swdnd/src/lib/characters.test.ts`
Expected: PASS (3 pass).

- [ ] **Step 5: Typecheck the frontend (engine + client must compile)**

Run: `bun --cwd apps/swdnd run build`
Expected: Vite build succeeds (the new lib compiles; no UI imports it yet so the bundle is unchanged in behavior).

- [ ] **Step 6: Commit**

```bash
git add apps/swdnd/src/lib/characters.ts apps/swdnd/src/lib/characters.test.ts
git commit -m "feat(swdnd): characters/players API client + reference loader"
```

---

## Task 14: Phase 1 integration sweep

**Files:**
- Test: `apps/swdnd/src/lib/rules/integration.test.ts`

Goal: prove the engine maps a realistic build to a correct sheet end-to-end (spec §12 "End-to-end: build a small character and assert the computed sheet").

- [ ] **Step 1: Write the integration test**

```ts
// apps/swdnd/src/lib/rules/integration.test.ts
import { test, expect } from 'bun:test';
import { computeSheet } from './index';
import { emptyBuild, type RefArchetype, type RefArmor, type RefClass, type RefSpecies, type ReferenceData } from './types';

const consular: RefClass = {
  id: 'consular', name: 'Consular', hitDie: 6, saves: ['wis', 'cha'],
  skillChoices: ['ins', 'lor', 'per'], skillNumber: 2,
  powercasting: { force: 'full', tech: 'none' }, superiorityProgression: 0,
};
const fighter: RefClass = {
  id: 'fighter', name: 'Fighter', hitDie: 10, saves: ['str', 'con'],
  skillChoices: ['ath', 'prc'], skillNumber: 2,
  powercasting: { force: 'none', tech: 'none' }, superiorityProgression: 0.5,
};
const ref: ReferenceData = {
  classes: { consular, fighter },
  archetypes: {} as Record<string, RefArchetype>,
  species: { human: { id: 'human', name: 'Human', walkSpeed: 30 } as RefSpecies },
  armor: { combatsuit: { id: 'combatsuit', name: 'Combat suit', baseAc: 11, dexCap: null, kind: 'light' } as RefArmor },
  weapons: {}, powers: {},
};

test('Consular 4 / Fighter 1 multiclass sheet', () => {
  const b = emptyBuild('Mixed');
  b.identity = { name: 'Mixed', speciesId: 'human', backgroundId: '', alignment: 'light' };
  b.abilities.base = { str: 12, dex: 14, con: 14, int: 10, wis: 16, cha: 12 };
  b.levels = [
    { n: 1, classId: 'consular', archetypeId: null, hp: 'avg' },
    { n: 2, classId: 'consular', archetypeId: null, hp: 'avg' },
    { n: 3, classId: 'consular', archetypeId: null, hp: 'avg' },
    { n: 4, classId: 'consular', archetypeId: null, hp: 'avg' },
    { n: 5, classId: 'fighter', archetypeId: null, hp: 'avg' },
  ];
  b.proficiencies.savingThrows = ['wis', 'cha'];
  b.proficiencies.skills = ['lor', 'ins'];
  b.equipment = [{ ref: 'combatsuit', qty: 1, equipped: true }];

  const s = computeSheet(b, ref);
  expect(s.totalLevel).toBe(5);
  expect(s.proficiencyBonus).toBe(3);
  // HP: consular L1 6+2 ; L2-4 (4+2)x3=18 ; fighter L5 (6+2)=8  -> 8+18+8 = 34
  expect(s.maxHp).toBe(34);
  // AC: light 11 + dex 2 = 13
  expect(s.armorClass).toBe(13);
  expect(s.hitDice).toEqual({ d6: 4, d10: 1 });
  // Force: only consular casts -> classes 1 ; casterLevel 4 ; maxPowerLevel full[4]=2
  expect(s.casting.force.classes).toBe(1);
  expect(s.casting.force.maxPowerLevel).toBe(2);
  expect(s.casting.force.ability).toBe('wis');
  expect(s.casting.force.pointsMax).toBe(4 * 4 + 3); // 16 + wis mod 3
  // Superiority: fighter 0.5 @ 1 level -> dice round(quant[1]*0.5)=round(1.5)=2 ; die size[1]=d4 ; level round(0.5)=1
  expect(s.superiority).toEqual({ level: 1, diceMax: 2, die: 'd4', knownMax: 1 });
});
```

- [ ] **Step 2: Run the integration test**

Run: `bun test apps/swdnd/src/lib/rules/integration.test.ts`
Expected: PASS (1 pass). If any expected number is off, fix the offending engine module (not the test's sw5e math) and re-run.

- [ ] **Step 3: Run the entire suite (frontend engine + backend)**

Run: `bun test`
Expected: PASS — all green.

- [ ] **Step 4: Commit**

```bash
git add apps/swdnd/src/lib/rules/integration.test.ts
git commit -m "test(swdnd): end-to-end multiclass sheet integration"
```

---

## Self-review (completed during planning)

- **Spec coverage:** §5 data model → Task 1; §6 compute engine (all bullets: mods/prof → Task 3; saves/skills incl. Lore/Piloting/Tech → Task 6; AC/init/speed/HP/hit dice → Task 5; multiclass caster level + pools + max level → Task 4; alignment-driven casting ability + DCs → Task 4; superiority → Task 7; armor→AC → Task 5; overrides → Task 8) ; §7 reference loading (existing content route, client mapper) → Task 13; §8 character routes → Task 10; §9 player access model → Tasks 9, 11, 12; §10 real-time `character:updated` → Task 10. Weapon attack/damage rows (a §6 sub-bullet) are intentionally deferred to the play-sheet plan (Phase 2), where they render — the `RefWeapon` view type and mapper exist now so the engine can add them without a data change; this is the one scoped cut and is called out here rather than silently dropped.
- **Type consistency:** `CharacterBuild`, `ReferenceData`, `DerivedSheet`, `TrackCasting`, `SuperiorityBlock`, `SkillBonus`, `ClassTaken` names and shapes are used identically across Tasks 1–8 and re-exported from `index.ts`; the client (Task 13) imports them from `./rules/types`.
- **No placeholders:** every code/test step carries full content; the only deferral (weapon attack/damage) is explicit above.
- **Test DB isolation:** every backend route test sets `SWDND_DB_PATH` to a fresh temp file and toggles `ASHERCARLOW_AUTH_TOKEN` *before* dynamically importing the db/route modules, so the singleton `swdndDb` opens the throwaway DB and tests never touch `./data`.

## Out of scope (later phases, own plans)

- Phase 2 — the responsive play sheet (container-query layout, live play state, WS subscription, **visual polish pass**).
- Phase 3 — the step-rail builder (L1 single class).
- Phase 4 — progression + multiclass UX (level-up entries, re-flagging dependent steps).
