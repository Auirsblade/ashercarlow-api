# Starship Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `starship` domain spine — a crew-owned starship entity (DB + build JSON + CRUD/roster routes + `ship:updated` realtime), a pure frontend ship compute engine, and a ShipSheet panel (budget-validating builder + live play view) wired into the split-view system — riding with one unrelated atomic commit for per-weapon attack math on the character sheet.

**Architecture:** The spine is a deliberate mirror of the character domain: one `starship` row with a single `data_json` build document (exactly like `character`), a `starship_crew` join table that makes the write-access check ("is this player's character on this crew?") a single indexed server-side join, a pure `computeShip(build, ref)` engine in `lib/shipRules/` assembled from sub-modules the way `lib/rules/` is, and a `panels/ShipSheet/` that copies `CharacterSheet/`'s Builder/Sheet split, hook shape (load → `useMemo(compute)` → optimistic dispatch → debounced PATCH → WS echo guard) and step-rail shell. Ship reference data loads through its own `loadShipReference()` so ship rows never cost the character loader a request. Crew-dependent stats (gunner proficiency, power dice) are explicitly deferred to sub-project 2; weapon attacks render the ship's contribution plus a literal `+ your proficiency` suffix.

**Tech Stack:** Bun + Hono + @hono/zod-openapi + bun:sqlite (backend), React + Vite + Tailwind v4 (frontend), bun:test

## Global Constraints

- All timestamps are ISO 8601 UTC strings (`new Date().toISOString()`).
- Every JSON route is defined with `createRoute` from `@hono/zod-openapi` and registered via `app.openapi(route, handler)`; schemas live next to the route.
- Errors are `throw new HTTPException(status, { message })`; the global `onError` formats them as `{ message }`.
- The existing suite is **329 passing tests across 54 files** — it must stay green at every commit.
- Ship reference data loads via a **separate** `loadShipReference()`, never folded into `loadReference()`.
- `computeShip` stays pure, synchronous, frontend-only, and **ship-only** (no crew inputs) in the spine.
- `DerivedShip` is computed, never stored. Overrides go through the same flat scalar `build.overrides` mechanism.
- One commit per task, using the exact `git add` / `git commit` commands in each task. `git add` explicit paths only — never `-A`.
- Backend runtime is Bun: `bun:sqlite`, `Bun.file`, `import.meta.dir`.
- Frontend typecheck is `cd apps/swdnd && bun run build` (`tsc -b && vite build`, with `noUnusedLocals`/`noUnusedParameters`). Never `bun --cwd apps/swdnd run build`.
- Test files are excluded from `tsconfig.app.json` (`"exclude": ["src/**/*.test.ts", "src/**/*.test.tsx"]`), so partial `ShipReferenceData` object literals in tests are fine and expected.

## Verified facts (read before implementing)

These were checked against the repo and the ingested pack at plan time (2026-08-12). Do not re-derive them; do re-verify the two items explicitly flagged as VERIFY steps inside their tasks.

- **Test isolation is fixed.** Commit `8f50deb` ("fix(backend): isolate the swdnd DB under bun test") makes `apps/backend/src/db/swdnd/index.ts` fall back to a temp DB when `NODE_ENV === 'test'`. A bare `bun test` from the repo root is now safe and reports `329 pass / 0 fail`. (Older plans in this directory warn against it — that warning is obsolete.)
- **Migrations** live in `apps/backend/src/db/migrations/swdnd/NNN_name.sql` and are registered in the `MIGRATIONS` array in `apps/backend/src/db/swdnd/index.ts`. Last applied: `005_swdnd_rolls`. The runner (`apps/backend/src/db/runner.ts`) applies each file inside a transaction and records it in `schema_migrations`. `openDatabase` sets `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON`, so `ON DELETE CASCADE` is live.
- **Reference tables already exist and are seeded.** `apps/backend/src/db/swdnd/reference.ts` lists `starship_sizes`, `starship_equipment`, `starship_weapons`, `starship_armor`, `starship_modifications`, `starship_features`, `starship_actions`. `GET /swdnd/content/{category}` serves any of them (`SELECT * FROM <category> ORDER BY name ASC`). **Zero backend work is needed for reference data.**
- **Row counts:** sizes 6, armor 6, equipment 17, weapons 91, modifications 257, features 79, actions 17.
- **`starship_armor` holds BOTH armor and shields**, discriminated by `system.armor.type`:
  - `'starship'` → Lightweight (`armor.value 10`, `armor.dex null`, `attributes.dmgred.value 0`), Deflection (`10`, `dex 2`, `dmgred 3`), Reinforced (`10`, `dex 0`, `dmgred 6`).
  - `'ssshield'` → Directional (`attributes.capx.value 1`, `attributes.regrateco.value 1`), Fortress (`capx 1.5`, `regrateco 0.667`), Quick-Charge (`capx 0.667`, `regrateco 1.5`).
  - This exactly matches the SOTG coefficients (Directional ×1, Fortress ×3/2 capacity & ×2/3 regen, Quick-Charge ×2/3 capacity & ×3/2 regen), so the mappers read them from the rows rather than hardcoding.
- **`starship_equipment`** is discriminated by the same `system.armor.type`: `'reactor'` (3 rows, `attributes.powerdicerec.value`, `attributes.fuelcostsmod.value`), `'hyper'` (11 rows, `attributes.hdclass.value`), `'powerc'` (3 rows, `attributes.cscap.value` / `attributes.sscap.value`).
- **`starship_sizes` system fields** (verified, all six rows):

  | name | identifier | hullDice | hullDiceStart | shldDice | shldDiceStart | baseSpaceSpeed | baseTurnSpeed | hardpointMult | modBaseCap | modMaxSuitesBase | modMaxSuitesMult |
  |---|---|---|---|---|---|---|---|---|---|---|---|
  | Tiny Starship | tiny | d4 | 1 | d4 | 1 | 300 | 300 | 1 | 10 | 0 | 0 |
  | Small Starship | small | d6 | 3 | d6 | 3 | 300 | 250 | 1 | 20 | -1 | 1 |
  | Medium Starship | medium | d8 | 5 | d8 | 5 | 300 | 200 | 1.5 | 30 | 3 | 1 |
  | Large Starship | large | d10 | 7 | d10 | 7 | 300 | 150 | 2 | 50 | 3 | 2 |
  | Huge Starship | huge | d12 | 9 | d12 | 9 | 300 | 100 | 2 | 60 | 6 | 3 |
  | Gargantuan Starship | gargantuan | d20 | 11 | d20 | 11 | 300 | 50 | 3 | 70 | 10 | 4 |

  The hull-die-by-size table in the brief (Tiny d4 … Gargantuan d20) is therefore **confirmed against the ingested rows**.
- **Hull/shield dice totals follow the character-HP rule.** Each size row carries `hullDiceRolled` — Tiny `[4]`, Small `[6,4,4]`, Medium `[8,5,5,5,5]`, Large `[10,6,6,6,6,6,6]`, Huge `[12,7,…]`, Gargantuan `[20,11,…]`. That is exactly `die` for the first die and `floor(die/2)+1` for each subsequent die, i.e. the same "max at first, average after" rule `rules/combat.ts:maxHp` already uses.
- **Tier AC bonus is confirmed by the pack.** `starship_features` row "Armor Class Improvement": *"Beginning at second Tier, your ship's armor class improves, giving your ship a +1 to its AC. It gains an additional +1 bonus to AC at 3rd Tier (+2 total), 4th Tier (+3 total), and 5th Tier (+4 total)." — Applies to all ship sizes.* → `TIER_AC_BONUS = [0, 0, 1, 2, 3, 4]`.
- **`starship_weapons` shape:** `system.weaponType` ∈ `"primary (starship)"` (25), `"secondary (starship)"` (27), `"tertiary (starship)"` (8), `"quaternary (starship)"` (2), plus `"ammo"` (28) and `"simpleVW"` (1) which are **not installable weapons** and must be filtered out of the weapon browser. `system.weaponSize` ∈ `"Small"` (30) / `"Huge"` (30) / absent (31). `system.damage.parts` is `[[formula, type], …]` where formula contains the literal `@mod` (e.g. `"1d8 + @mod"`). `system.range` is `{value, long, units}`. `system.save` is `{ability, dc, scaling}` and is `null` on many rows. `system.ammo.types` is a string array. `system.properties` uses SHORT keys (`amm`, `rel`, `aut`, `hom`, `ion`, `zon`, …). `system.attackBonus` is sometimes the STRING `"0"` — always coerce with `Number(…) || 0`.
- **Character weapon properties also use short keys** (`fin` on 35 rows, `ran` on 8 rows, plus `dex`, `hvy`, `two`, `rel`, …); `system.ability` is set on only 2 of 238 rows (`mapWeaponRow` already maps `''` when unset). Character damage parts also embed `@mod` (`"1d6 + @mod"`). This settles the rider's "verify `fin`/`ran` vs long names" open question: **short keys, boolean `true`**.
- **`starship_modifications` shape:** `system.system.value` ∈ `Engineering` (58) / `Suite` (36) / `Universal` (110) / `Weapon` (22) / `Operation` (31); `system.grade.value` is 0–5 (one null); `system.prerequisites.value` is a name string or `""`; `system.free` is `{slot: boolean, suite: boolean}`; `system.basecost.value` is a number.
- **No pack row encodes hardpoint or modification-slot budgets, and no modification encodes a scalar speed change** (all mod effects are prose). The budget formulas therefore live in `shipRules/constants.ts` with an explicit VERIFY step (Task 9). Because ship validation is warn-don't-block with the ⌂ house-rule unlock, a wrong budget degrades to a cosmetic warning, never a hard block.
- **`selfGated()`** in `apps/backend/src/routes/swdnd/index.ts` is a coarse prefix/suffix match with a standing comment: any NEW route matching it must enforce its own access check in-handler. The starship routes do.
- **Realtime:** `publishToRoom(roomForCampaign(campaignId), { type, room, payload })` from `apps/backend/src/lib/swdnd-realtime.ts`. `character:updated` uses payload `{characterId, name, play}`; `ship:updated` mirrors it as `{shipId, name, play}`.
- **Route tests** run in dev mode (no `ASHERCARLOW_AUTH_TOKEN`); to exercise the access matrix they wrap assertions in a `withAuthEnv` helper that sets and clears the env var. See `apps/backend/src/routes/swdnd/tokens.test.ts` for the canonical shape (defensive `delete process.env.ASHERCARLOW_AUTH_TOKEN` in `beforeAll`, table wipe, `afterAll` cleanup).
- **`resolveCanEdit({admin, token})`** in `lib/canEdit.ts` is deliberately loose (`admin || !!token`) because character ownership is enforced server-side. Ships need a stricter client-side answer (which crew?), so Task 22 adds a sibling `resolveShipCanEdit` rather than changing the existing one.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `apps/swdnd/src/lib/rules/weaponAttacks.ts` | create | RIDER: per-weapon attack/damage math |
| `apps/swdnd/src/lib/rules/weaponAttacks.test.ts` | create | RIDER tests |
| `apps/swdnd/src/panels/CharacterSheet/Sheet/Combat.tsx` | modify | RIDER: two clickable rolls per weapon |
| `apps/swdnd/src/panels/CharacterSheet/Sheet/index.tsx` | modify | RIDER: formula-roll handler |
| `apps/backend/src/db/migrations/swdnd/006_swdnd_starships.sql` | create | `starship` + `starship_crew` |
| `apps/backend/src/db/swdnd/index.ts` | modify | register migration 006 |
| `apps/backend/src/routes/swdnd/access.ts` | modify | `assertShipWriteAccess` |
| `apps/backend/src/routes/swdnd/access.test.ts` | modify | crew access matrix |
| `apps/backend/src/routes/swdnd/starships.ts` | create | ship CRUD + crew roster routes |
| `apps/backend/src/routes/swdnd/starships.test.ts` | create | route tests |
| `apps/backend/src/routes/swdnd/index.ts` | modify | register + `selfGated` |
| `apps/swdnd/src/lib/shipRules/types.ts` | create | `ShipBuild`, `Ref*`, `DerivedShip`, `emptyShipBuild` |
| `apps/swdnd/src/lib/shipRules/constants.ts` | create | SOTG constants + budget formulas |
| `apps/swdnd/src/lib/shipRules/core.ts` | create | ability totals/mods, tier |
| `apps/swdnd/src/lib/shipRules/defense.ts` | create | AC, DR, hull, shields, regen |
| `apps/swdnd/src/lib/shipRules/movement.ts` | create | flying + turning speed |
| `apps/swdnd/src/lib/shipRules/weapons.ts` | create | weapon profiles + rate-of-fire cap |
| `apps/swdnd/src/lib/shipRules/index.ts` | create | `computeShip` + overrides |
| `apps/swdnd/src/lib/shipRules/integration.test.ts` | create | full derived-stat assertion |
| `apps/swdnd/src/lib/starships.ts` | create | DTOs + REST + mappers + `loadShipReference` |
| `apps/swdnd/src/lib/starships.test.ts` | create | mapper tests |
| `apps/swdnd/src/lib/shipBuildState.ts` | create | build reducer |
| `apps/swdnd/src/lib/shipPlayState.ts` | create | play reducer |
| `apps/swdnd/src/lib/shipValidation.ts` | create | `shipStepStatus` |
| `apps/swdnd/src/lib/canEdit.ts` | modify | `resolveShipCanEdit` |
| `apps/swdnd/src/hooks/useShipBuilder.ts` | create | builder hook |
| `apps/swdnd/src/hooks/useShipSheet.ts` | create | play hook |
| `apps/swdnd/src/panels/ShipSheet/**` | create | Builder + Sheet panels |
| `apps/swdnd/src/lib/panels.ts` | modify | `'ship'` PanelKind |
| `apps/swdnd/src/lib/panels.test.ts` | modify | ship panel routing tests |
| `apps/swdnd/src/App.tsx` | modify | `/ship/:shipId[/:mode]` routes |
| `apps/swdnd/src/components/SplitPage.tsx` | modify | render ship panels in splits |
| `apps/swdnd/src/panels/DMScreen/AdminDrawer.tsx` | modify | campaign ship list |
| `apps/swdnd/src/panels/PlayerHome/index.tsx` | modify | crewed-ship list |

Execution order: Task 1 (rider, own commit) → Tasks 2–7 (backend) → Tasks 8–18 (frontend domain + engine) → Tasks 19–23 (reducers + hooks) → Tasks 24–29 (UI + routing) → Task 30 (entry links) → Task 31 (final verification).

---

### Task 1: RIDER — per-weapon attack math on the character sheet

Unrelated to the starship domain; ships as its own commit inside this PR (approved 2026-08-12).

**Files:**
- Create: `apps/swdnd/src/lib/rules/weaponAttacks.ts`
- Create: `apps/swdnd/src/lib/rules/weaponAttacks.test.ts`
- Modify: `apps/swdnd/src/panels/CharacterSheet/Sheet/Combat.tsx`
- Modify: `apps/swdnd/src/panels/CharacterSheet/Sheet/index.tsx`

**Interfaces:**

Consumes (existing, unchanged):
```ts
// apps/swdnd/src/lib/rules/types.ts
type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
interface RefWeapon { id: string; name: string; damageParts: Array<[string, string]>;
  properties: Record<string, unknown>; ability: AbilityKey | ''; attackBonus: number;
  price: number | null; description: string }
interface EquipmentEntry { ref: string; qty: number; equipped: boolean; mods?: string[] }
interface DerivedSheet { proficiencyBonus: number; abilities: Record<AbilityKey, { score: number; mod: number }>; /* … */ }
// apps/swdnd/src/lib/dice.ts
function parseFormula(input: string): FormulaTerms | null;
function rollFormula(terms: FormulaTerms, rng?: Rng): { total: number; rolls: { sides: number; value: number }[]; formula: string };
```

Produces:
```ts
// apps/swdnd/src/lib/rules/weaponAttacks.ts
export interface WeaponAttack {
  id: string;            // RefWeapon.id
  name: string;
  ability: AbilityKey;   // resolved attack/damage ability
  attackBonus: number;   // ability mod + proficiency bonus + RefWeapon.attackBonus
  damageFormula: string; // first damage part with @mod substituted, e.g. '1d8 + 3'
  damageType: string;    // '' when the weapon has no damage parts
}
export function weaponAttacks(
  build: CharacterBuild, derived: DerivedSheet, ref: ReferenceData,
): WeaponAttack[];
/** Replace the sw5e `@mod` placeholder in a damage formula with a signed number.
 *  Exported because shipRules/weapons.ts needs the identical substitution. */
export function substituteMod(formula: string, mod: number): string;
```

- [ ] **Step 1: Write the failing test**

```ts
// apps/swdnd/src/lib/rules/weaponAttacks.test.ts
import { expect, test } from 'bun:test';
import { emptyBuild, type RefWeapon, type ReferenceData } from './types';
import { computeSheet } from './index';
import { substituteMod, weaponAttacks } from './weaponAttacks';

const w = (over: Partial<RefWeapon> & { id: string }): RefWeapon => ({
  name: over.id, damageParts: [], properties: {}, ability: '', attackBonus: 0,
  price: null, description: '', ...over,
});

const ref = {
  classes: { fighter: { id: 'fighter', name: 'Fighter', hitDie: 10, saves: [], skillChoices: [], skillNumber: 0, powercasting: { force: 'none', tech: 'none' }, superiorityProgression: 0, identifier: 'fighter', asiLevels: [], description: '' } },
  archetypes: {}, species: {}, armor: {}, powers: {}, backgrounds: {}, feats: {}, maneuvers: {}, gear: {},
  weapons: {
    vibro: w({ id: 'vibro', name: 'Vibroblade', damageParts: [['1d8 + @mod', 'kinetic']] }),
    dagger: w({ id: 'dagger', name: 'Chained dagger', properties: { fin: true }, damageParts: [['1d4 + @mod', 'kinetic']] }),
    bowcaster: w({ id: 'bowcaster', name: 'Bowcaster', properties: { ran: true }, damageParts: [['1d10 + @mod', 'energy']] }),
    holdout: w({ id: 'holdout', name: 'Holdout', ability: 'cha', attackBonus: 2, damageParts: [['1d4 + @mod', 'energy']] }),
    club: w({ id: 'club', name: 'Club', damageParts: [['1d6 + @mod', 'kinetic']] }),
  },
} as unknown as ReferenceData;

function hero(str: number, dex: number) {
  const b = emptyBuild('Hero');
  b.abilities.base = { str, dex, con: 10, int: 10, wis: 10, cha: 18 };
  b.levels = [{ n: 1, classId: 'fighter', archetypeId: null, hp: 'avg' }];
  b.equipment = [
    { ref: 'vibro', qty: 1, equipped: true },
    { ref: 'dagger', qty: 1, equipped: true },
    { ref: 'bowcaster', qty: 1, equipped: true },
    { ref: 'holdout', qty: 1, equipped: true },
    { ref: 'club', qty: 1, equipped: false },
  ];
  return b;
}

const byId = (list: ReturnType<typeof weaponAttacks>, id: string) => list.find((a) => a.id === id)!;

test('default weapon uses STR; prof + ability mod fold into the attack bonus', () => {
  const b = hero(16, 12);                       // STR +3, DEX +1, prof +2
  const list = weaponAttacks(b, computeSheet(b, ref), ref);
  expect(byId(list, 'vibro')).toMatchObject({
    ability: 'str', attackBonus: 5, damageFormula: '1d8 + 3', damageType: 'kinetic',
  });
});

test('finesse picks the higher of STR and DEX, either direction', () => {
  const dexy = hero(10, 18);                    // STR +0, DEX +4
  expect(byId(weaponAttacks(dexy, computeSheet(dexy, ref), ref), 'dagger'))
    .toMatchObject({ ability: 'dex', attackBonus: 6, damageFormula: '1d4 + 4' });
  const strong = hero(18, 10);                  // STR +4, DEX +0
  expect(byId(weaponAttacks(strong, computeSheet(strong, ref), ref), 'dagger').ability).toBe('str');
});

test('ranged picks DEX even when STR is higher', () => {
  const b = hero(18, 12);                       // STR +4, DEX +1
  expect(byId(weaponAttacks(b, computeSheet(b, ref), ref), 'bowcaster'))
    .toMatchObject({ ability: 'dex', attackBonus: 3, damageFormula: '1d10 + 1', damageType: 'energy' });
});

test('an explicit RefWeapon.ability wins, and RefWeapon.attackBonus folds in', () => {
  const b = hero(16, 12);                       // CHA 18 → +4, prof +2, weapon +2
  expect(byId(weaponAttacks(b, computeSheet(b, ref), ref), 'holdout'))
    .toMatchObject({ ability: 'cha', attackBonus: 8, damageFormula: '1d4 + 4' });
});

test('only equipped weapons are listed', () => {
  const b = hero(16, 12);
  expect(weaponAttacks(b, computeSheet(b, ref), ref).map((a) => a.id))
    .toEqual(['vibro', 'dagger', 'bowcaster', 'holdout']);
});

test('substituteMod drops the term at +0 and flips the sign when negative', () => {
  expect(substituteMod('1d8 + @mod', 3)).toBe('1d8 + 3');
  expect(substituteMod('1d8 + @mod', 0)).toBe('1d8');
  expect(substituteMod('1d8 + @mod', -1)).toBe('1d8 - 1');
  expect(substituteMod('2d6', 4)).toBe('2d6');
});

test('a weapon with no damage parts still yields an attack entry', () => {
  const b = hero(16, 12);
  b.equipment = [{ ref: 'none', qty: 1, equipped: true }];
  const bare = { ...ref, weapons: { ...ref.weapons, none: w({ id: 'none', name: 'Bare fists' }) } } as ReferenceData;
  expect(weaponAttacks(b, computeSheet(b, bare), bare)[0])
    .toMatchObject({ id: 'none', damageFormula: '', damageType: '' });
});
```

- [ ] **Step 2: Run it and confirm the failure**

Run: `bun test apps/swdnd/src/lib/rules/weaponAttacks.test.ts`
Expect: `error: Cannot find module './weaponAttacks'` — 0 pass, the file fails to load.

- [ ] **Step 3: Implement the helper**

```ts
// apps/swdnd/src/lib/rules/weaponAttacks.ts
import { abilityModifier, totalAbilityScores } from './core';
import type { AbilityKey, CharacterBuild, DerivedSheet, ReferenceData, RefWeapon } from './types';

export interface WeaponAttack {
  id: string;
  name: string;
  ability: AbilityKey;
  attackBonus: number;
  damageFormula: string;
  damageType: string;
}

/**
 * Replace the sw5e `@mod` placeholder with a signed number:
 * '1d8 + @mod' @ +3 → '1d8 + 3', @ -1 → '1d8 - 1', @ 0 → '1d8'.
 * Exported for shipRules/weapons.ts, whose starship damage parts use the
 * identical `@mod` convention (verified against the ingested pack).
 */
export function substituteMod(formula: string, mod: number): string {
  if (!formula.includes('@mod')) return formula;
  if (mod === 0) return formula.replace(/\s*[+-]\s*@mod/, '').replace(/@mod/g, '0').trim();
  const abs = Math.abs(mod);
  return formula
    .replace(/[+-]\s*@mod/, mod > 0 ? `+ ${abs}` : `- ${abs}`)
    .replace(/@mod/g, String(mod))
    .trim();
}

/**
 * Which ability a weapon attacks with. Explicit `system.ability` wins; then
 * finesse (better of STR/DEX); then ranged (DEX); else STR.
 * Property keys are the sw5e short forms (`fin`, `ran`) — verified against the
 * ingested `weapons` rows, where they are booleans.
 */
function attackAbility(weapon: RefWeapon, str: number, dex: number): AbilityKey {
  if (weapon.ability) return weapon.ability;
  if (weapon.properties.fin === true) return dex > str ? 'dex' : 'str';
  if (weapon.properties.ran === true) return 'dex';
  return 'str';
}

/** One entry per EQUIPPED weapon, in build order. */
export function weaponAttacks(
  build: CharacterBuild,
  derived: DerivedSheet,
  ref: ReferenceData,
): WeaponAttack[] {
  const scores = totalAbilityScores(build);
  const str = abilityModifier(scores.str);
  const dex = abilityModifier(scores.dex);

  const out: WeaponAttack[] = [];
  for (const entry of build.equipment) {
    if (!entry.equipped) continue;
    const weapon = ref.weapons[entry.ref];
    if (!weapon) continue;
    const ability = attackAbility(weapon, str, dex);
    const mod = derived.abilities[ability]?.mod ?? 0;
    const [formula, type] = weapon.damageParts[0] ?? ['', ''];
    out.push({
      id: weapon.id,
      name: weapon.name,
      ability,
      attackBonus: mod + derived.proficiencyBonus + weapon.attackBonus,
      damageFormula: substituteMod(formula, mod),
      damageType: type,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test apps/swdnd/src/lib/rules/weaponAttacks.test.ts` → `7 pass, 0 fail`.

- [ ] **Step 5: Add the formula-roll handler to the play sheet**

In `apps/swdnd/src/panels/CharacterSheet/Sheet/index.tsx`, extend the dice import and add `rollDamage` beside the existing `roll`, then pass it to `Combat`.

Change the import line:

```ts
import { parseFormula, rollD20, rollFormula } from '../../../lib/dice';
```

Add immediately after the existing `const roll = (label, mod) => {…}` block:

```ts
  const rollDamage = (label: string, formula: string) => {
    const terms = parseFormula(formula);
    if (!terms) return;
    const r = rollFormula(terms);
    pushRoll(label, r.formula, r.total);
    if (s.dto) {
      void postRoll(s.dto.campaign_id, {
        roller: characterName || 'Character',
        label,
        formula: r.formula,
        rolls: r.rolls,
        total: r.total,
      }, searchParams.get('token')).catch(() => { /* anon viewer or offline: local roll still shows */ });
    }
  };
```

And change the `Combat` usage inside `colCombat`:

```tsx
      <Combat build={s.build} derived={s.derived} ref={s.ref} onRoll={roll} onRollDamage={rollDamage} />
```

- [ ] **Step 6: Render two clickable rolls per weapon**

Replace the whole body of `apps/swdnd/src/panels/CharacterSheet/Sheet/Combat.tsx`:

```tsx
// apps/swdnd/src/panels/CharacterSheet/Sheet/Combat.tsx
import { weaponAttacks } from '../../../lib/rules/weaponAttacks';
import type { CharacterBuild, DerivedSheet, ReferenceData } from '../../../lib/rules/types';

export default function Combat({
  build,
  derived,
  ref,
  onRoll,
  onRollDamage,
}: {
  build: CharacterBuild;
  derived: DerivedSheet;
  ref: ReferenceData;
  onRoll: (label: string, mod: number) => void;
  onRollDamage: (label: string, formula: string) => void;
}) {
  const attacks = weaponAttacks(build, derived, ref);
  const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
  return (
    <div className="ht-panel p-2 font-mono text-[11px]">
      <div className="ht-label mb-1">Attacks</div>
      {attacks.length === 0 && <div className="text-ht-muted">No weapons equipped.</div>}
      {attacks.map((a) => (
        <div key={a.id} className="flex w-full items-baseline gap-2">
          <span className="flex-1 truncate text-ht-text" title={`${a.ability.toUpperCase()} weapon`}>{a.name}</span>
          <button type="button" className="ht-step" title="roll to hit"
            onClick={() => onRoll(`${a.name} attack`, a.attackBonus)}>
            atk {fmt(a.attackBonus)}
          </button>
          {a.damageFormula && (
            <button type="button" className="ht-step" title={`roll ${a.damageType} damage`}
              onClick={() => onRollDamage(`${a.name} damage`, a.damageFormula)}>
              {a.damageFormula}
            </button>
          )}
        </div>
      ))}
      <div className="ht-label mb-1 mt-2">Defense</div>
      <div className="flex justify-between text-ht-text"><span>Armor Class</span><b>{derived.armorClass}</b></div>
      <div className="flex justify-between text-ht-text"><span>Initiative</span><b>{fmt(derived.initiative)}</b></div>
      <div className="flex justify-between text-ht-text"><span>Speed</span><b>{derived.speed}</b></div>
    </div>
  );
}
```

- [ ] **Step 7: Typecheck and run the full suite**

Run: `cd apps/swdnd && bun run build` → succeeds with no TS errors.
Run: `bun test` → `336 pass, 0 fail` (329 existing + 7 new).

- [ ] **Step 8: Commit the rider on its own**

```bash
git add apps/swdnd/src/lib/rules/weaponAttacks.ts apps/swdnd/src/lib/rules/weaponAttacks.test.ts apps/swdnd/src/panels/CharacterSheet/Sheet/Combat.tsx apps/swdnd/src/panels/CharacterSheet/Sheet/index.tsx
git commit -m "feat(swdnd): per-weapon attack and damage rolls on the character sheet"
```

---

### Task 2: Migration 006 — `starship` + `starship_crew`

**Files:**
- Create: `apps/backend/src/db/migrations/swdnd/006_swdnd_starships.sql`
- Modify: `apps/backend/src/db/swdnd/index.ts`

**Interfaces:**

Consumes:
```ts
// apps/backend/src/db/runner.ts
interface Migration { version: string; file: string }
function runMigrations(db: Database, migrations: Migration[], migrationsDir: string): void;
```

Produces (SQL surface later tasks query):
```sql
starship(id TEXT PK, campaign_id TEXT, name TEXT, data_json TEXT, created_at TEXT, updated_at TEXT)
starship_crew(ship_id TEXT, character_id TEXT, role TEXT, PRIMARY KEY (ship_id, character_id, role))
```

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/routes/swdnd/starships.test.ts` with just the schema assertions for now; later tasks extend this same file.

```ts
// apps/backend/src/routes/swdnd/starships.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { swdndDb } from '../../db/swdnd';

beforeAll(() => {
  delete process.env.ASHERCARLOW_AUTH_TOKEN;
});

describe('swdnd starship schema', () => {
  it('migration 006 created both tables with the expected columns', () => {
    const shipCols = swdndDb.query<{ name: string }, []>('PRAGMA table_info(starship)').all().map((c) => c.name);
    expect(shipCols).toEqual(['id', 'campaign_id', 'name', 'data_json', 'created_at', 'updated_at']);
    const crewCols = swdndDb.query<{ name: string }, []>('PRAGMA table_info(starship_crew)').all().map((c) => c.name);
    expect(crewCols).toEqual(['ship_id', 'character_id', 'role']);
  });

  it('registered the migration in schema_migrations', () => {
    const row = swdndDb
      .query<{ version: string }, [string]>('SELECT version FROM schema_migrations WHERE version = ?')
      .get('006_swdnd_starships');
    expect(row?.version).toBe('006_swdnd_starships');
  });

  it('indexes campaign lookups and the crew reverse lookup', () => {
    const names = swdndDb
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all().map((r) => r.name);
    expect(names).toContain('idx_starship_campaign');
    expect(names).toContain('idx_starship_crew_character');
  });
});

afterAll(() => { delete process.env.ASHERCARLOW_AUTH_TOKEN; });
```

- [ ] **Step 2: Run it and confirm the failure**

Run: `bun test apps/backend/src/routes/swdnd/starships.test.ts`
Expect: `3 fail` — `expect(received).toEqual(expected)` with `received: []` (the table does not exist, so `PRAGMA table_info` returns no rows).

- [ ] **Step 3: Write the migration**

```sql
-- apps/backend/src/db/migrations/swdnd/006_swdnd_starships.sql
CREATE TABLE starship (
  id          TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  data_json   TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Ship <-> character crewing is many-to-many from day one: one shared party
-- ship AND individual fighters must coexist. A join table (not JSON inside
-- data_json) keeps the write-access check -- "is this player's character on
-- this crew?" -- a single indexed server-side join.
-- SOTG's "at most one of each role except gunners" is app-level validation
-- (warn, don't block -- house-rule friendly), not a DB constraint.
CREATE TABLE starship_crew (
  ship_id      TEXT NOT NULL REFERENCES starship(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES character(id) ON DELETE CASCADE,
  role         TEXT NOT NULL,   -- coordinator|gunner|mechanic|operator|pilot|technician
  PRIMARY KEY (ship_id, character_id, role)
);

CREATE INDEX idx_starship_campaign ON starship(campaign_id);
CREATE INDEX idx_starship_crew_character ON starship_crew(character_id);
```

- [ ] **Step 4: Register it**

In `apps/backend/src/db/swdnd/index.ts`, add the entry to the end of `MIGRATIONS`:

```ts
  { version: '005_swdnd_rolls', file: '005_swdnd_rolls.sql' },
  { version: '006_swdnd_starships', file: '006_swdnd_starships.sql' },
];
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `bun test apps/backend/src/routes/swdnd/starships.test.ts` → `3 pass, 0 fail`, with `[db] applied migration 006_swdnd_starships` in the log.

- [ ] **Step 6: Run the full suite**

Run: `bun test` → `339 pass, 0 fail`.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/db/migrations/swdnd/006_swdnd_starships.sql apps/backend/src/db/swdnd/index.ts apps/backend/src/routes/swdnd/starships.test.ts
git commit -m "feat(swdnd): starship and starship_crew tables (migration 006)"
```

---

### Task 3: `assertShipWriteAccess` — the crew-based write rule

**Files:**
- Modify: `apps/backend/src/routes/swdnd/access.ts`
- Modify: `apps/backend/src/routes/swdnd/access.test.ts`

**Interfaces:**

Consumes (existing in `access.ts`):
```ts
export interface PlayerRow { id: string; campaign_id: string; name: string; access_token: string; created_at: string }
export function resolvePlayerByToken(token: string | undefined): PlayerRow | null;
export function playerTokenFrom(c: Context): string | undefined;
```

Produces:
```ts
// apps/backend/src/routes/swdnd/access.ts
/** Throw 403 unless the requester may write this ship: dev mode, the admin, or
 *  a player owning ANY character on this ship's crew. */
export function assertShipWriteAccess(c: Context, shipId: string): void;
/** Non-throwing form, for the creation bootstrap where 400 vs 403 differ. */
export function playerCrewsShip(playerId: string, shipId: string): boolean;
```

- [ ] **Step 1: Write the failing test**

Append to `apps/backend/src/routes/swdnd/access.test.ts`, following that file's existing conventions: the module under test and the DB are reached through its dynamic `mod` / `dbMod` handles (set up in the file-level `beforeAll`, which also points `SWDND_DB_PATH` at a temp DB), and requests are built with its local `reqWith(headers, url?)` helper — whose `header()` lowercases the key, so header names are written lowercase.

```ts
// Append at the END of the file: this beforeEach clears the file-level seed
// (campaign c1 / player p1) that the earlier tests in this file rely on.
describe('assertShipWriteAccess', () => {
  const shipReq = (headers: Record<string, string> = {}) =>
    reqWith(headers, 'http://x/swdnd/starships/s1');

  beforeEach(() => {
    delete process.env.ASHERCARLOW_AUTH_TOKEN;
    dbMod.swdndDb.exec('DELETE FROM starship_crew; DELETE FROM starship; DELETE FROM character; DELETE FROM player; DELETE FROM campaign;');
    const now = new Date().toISOString();
    dbMod.swdndDb.run('INSERT INTO campaign (id, name, created_at, updated_at) VALUES (?,?,?,?)', ['c1', 'C', now, now]);
    dbMod.swdndDb.run('INSERT INTO player (id, campaign_id, name, access_token, created_at) VALUES (?,?,?,?,?)', ['p1', 'c1', 'P1', 'tok-1', now]);
    dbMod.swdndDb.run('INSERT INTO player (id, campaign_id, name, access_token, created_at) VALUES (?,?,?,?,?)', ['p2', 'c1', 'P2', 'tok-2', now]);
    dbMod.swdndDb.run('INSERT INTO character (id, campaign_id, player_id, name, data_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', ['ch1', 'c1', 'p1', 'Hero', '{}', now, now]);
    dbMod.swdndDb.run('INSERT INTO character (id, campaign_id, player_id, name, data_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', ['ch2', 'c1', 'p2', 'Other', '{}', now, now]);
    dbMod.swdndDb.run('INSERT INTO starship (id, campaign_id, name, data_json, created_at, updated_at) VALUES (?,?,?,?,?,?)', ['s1', 'c1', 'Ghost', '{}', now, now]);
    dbMod.swdndDb.run('INSERT INTO starship_crew (ship_id, character_id, role) VALUES (?,?,?)', ['s1', 'ch1', 'pilot']);
  });

  it('passes for everyone in dev mode (no admin token configured)', () => {
    expect(() => mod.assertShipWriteAccess(shipReq(), 's1')).not.toThrow();
  });

  it('passes for the admin bearer token', () => {
    process.env.ASHERCARLOW_AUTH_TOKEN = 'admin-secret';
    expect(() => mod.assertShipWriteAccess(shipReq({ authorization: 'Bearer admin-secret' }), 's1')).not.toThrow();
  });

  it('passes for a player owning a character on the crew', () => {
    process.env.ASHERCARLOW_AUTH_TOKEN = 'admin-secret';
    expect(() => mod.assertShipWriteAccess(shipReq({ 'x-player-token': 'tok-1' }), 's1')).not.toThrow();
  });

  it('throws 403 for a player whose characters are not on the crew', () => {
    process.env.ASHERCARLOW_AUTH_TOKEN = 'admin-secret';
    expect(() => mod.assertShipWriteAccess(shipReq({ 'x-player-token': 'tok-2' }), 's1')).toThrow();
  });

  it('throws 403 with no token at all', () => {
    process.env.ASHERCARLOW_AUTH_TOKEN = 'admin-secret';
    expect(() => mod.assertShipWriteAccess(shipReq(), 's1')).toThrow();
  });

  it('playerCrewsShip answers without throwing', () => {
    expect(mod.playerCrewsShip('p1', 's1')).toBe(true);
    expect(mod.playerCrewsShip('p2', 's1')).toBe(false);
    expect(mod.playerCrewsShip('p1', 'nope')).toBe(false);
  });
});

afterAll(() => { delete process.env.ASHERCARLOW_AUTH_TOKEN; });
```

The only import change this needs is widening the file's existing `bun:test` line with `afterAll` and `beforeEach`:

```ts
import { test, expect, afterAll, beforeAll, beforeEach, describe, it } from 'bun:test';
```

Do **not** add static imports of `./access` or `../../db/swdnd` — the file imports both dynamically on purpose, so `SWDND_DB_PATH` is set before the DB singleton is constructed.

- [ ] **Step 2: Run it and confirm the failure**

Run: `bun test apps/backend/src/routes/swdnd/access.test.ts`
Expect: `TypeError: mod.assertShipWriteAccess is not a function` on the five `assertShipWriteAccess` cases (and the same for `mod.playerCrewsShip`) — the module has no such export yet.

- [ ] **Step 3: Implement**

Append to `apps/backend/src/routes/swdnd/access.ts`:

```ts
/**
 * Does this player own ANY character on this ship's crew? One indexed join
 * (idx_starship_crew_character + character PK). Non-throwing so the creation
 * bootstrap can distinguish "no crew given" (400) from "not yours" (403).
 */
export function playerCrewsShip(playerId: string, shipId: string): boolean {
  const row = swdndDb
    .query<{ one: number }, [string, string]>(
      `SELECT 1 AS one FROM starship_crew sc
         JOIN character ch ON ch.id = sc.character_id
        WHERE sc.ship_id = ? AND ch.player_id = ?
        LIMIT 1`,
    )
    .get(shipId, playerId);
  return !!row;
}

/**
 * Throw 403 unless the requester may write this ship: dev mode (no admin token
 * configured), the admin, or a player owning any character on the ship's crew.
 *
 * Crew edits EVERYTHING -- build, play state, and the roster alike. One write
 * rule; the table trusts itself. Accepted consequence: a crew member can remove
 * the last crew entry and strand the ship for players (the admin can recover it).
 */
export function assertShipWriteAccess(c: Context, shipId: string): void {
  if (!process.env.ASHERCARLOW_AUTH_TOKEN) return; // dev mode
  if (isAdmin(c)) return;
  const player = resolvePlayerByToken(playerTokenFrom(c));
  if (player && playerCrewsShip(player.id, shipId)) return;
  throw new HTTPException(403, { message: 'Not allowed to modify this starship' });
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test apps/backend/src/routes/swdnd/access.test.ts` → all pass, including the 6 new cases.

- [ ] **Step 5: Run the full suite**

Run: `bun test` → `345 pass, 0 fail`.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/routes/swdnd/access.ts apps/backend/src/routes/swdnd/access.test.ts
git commit -m "feat(swdnd): crew-based starship write access check"
```

---

### Task 4: `starships.ts` — read routes, registration, `selfGated`

**Files:**
- Create: `apps/backend/src/routes/swdnd/starships.ts`
- Modify: `apps/backend/src/routes/swdnd/index.ts`
- Modify: `apps/backend/src/routes/swdnd/starships.test.ts`

**Interfaces:**

Consumes:
```ts
// apps/backend/src/db/swdnd/index.ts
export const swdndDb: Database;
// apps/backend/src/routes/swdnd/access.ts
export function assertShipWriteAccess(c: Context, shipId: string): void;
export function playerCrewsShip(playerId: string, shipId: string): boolean;
export function resolvePlayerByToken(token: string | undefined): PlayerRow | null;
export function playerTokenFrom(c: Context): string | undefined;
export function assertAdmin(c: Context): void;
```

Produces:
```ts
// apps/backend/src/routes/swdnd/starships.ts
export interface StarshipRow {
  id: string; campaign_id: string; name: string;
  data_json: string; created_at: string; updated_at: string;
}
export interface CrewRow { character_id: string; character_name: string; role: string }
export function registerStarshipRoutes(app: OpenAPIHono): void;
// JSON shape returned by every starship route:
//   { id, campaign_id, name, data_json: object, created_at, updated_at,
//     crew: [{ character_id, character_name, role }] }
// Routes added here: GET /swdnd/campaigns/{id}/starships, GET /swdnd/starships/{id}
```

- [ ] **Step 1: Write the failing test**

Append to `apps/backend/src/routes/swdnd/starships.test.ts` (add the imports it needs at the top):

```ts
import { createApiApp } from '../../lib/openapi';

const app = createApiApp();
const json = (method: string, body?: unknown, headers: Record<string, string> = {}) => ({
  method,
  headers: { 'Content-Type': 'application/json', ...headers },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

describe('swdnd starship reads', () => {
  it('lists an empty campaign and 404s an unknown ship', async () => {
    swdndDb.exec('DELETE FROM starship_crew; DELETE FROM starship; DELETE FROM character; DELETE FROM player; DELETE FROM campaign;');
    const now = new Date().toISOString();
    swdndDb.run('INSERT INTO campaign (id, name, created_at, updated_at) VALUES (?,?,?,?)', ['c9', 'C', now, now]);

    const list = await app.request('/swdnd/campaigns/c9/starships');
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([]);

    expect((await app.request('/swdnd/starships/nope')).status).toBe(404);
  });

  it('returns a parsed data_json and the crew roster with character names', async () => {
    const now = new Date().toISOString();
    swdndDb.run('INSERT INTO character (id, campaign_id, player_id, name, data_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', ['chA', 'c9', null, 'Zed', '{}', now, now]);
    swdndDb.run('INSERT INTO starship (id, campaign_id, name, data_json, created_at, updated_at) VALUES (?,?,?,?,?,?)', ['sA', 'c9', 'Ghost', JSON.stringify({ schemaVersion: 1, identity: { name: 'Ghost' } }), now, now]);
    swdndDb.run('INSERT INTO starship_crew (ship_id, character_id, role) VALUES (?,?,?)', ['sA', 'chA', 'pilot']);

    const one = await app.request('/swdnd/starships/sA');
    expect(one.status).toBe(200);
    const body = (await one.json()) as any;
    expect(body.data_json.identity.name).toBe('Ghost');
    expect(body.crew).toEqual([{ character_id: 'chA', character_name: 'Zed', role: 'pilot' }]);

    const list = (await (await app.request('/swdnd/campaigns/c9/starships')).json()) as any[];
    expect(list).toHaveLength(1);
    expect(list[0].crew).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it and confirm the failure**

Run: `bun test apps/backend/src/routes/swdnd/starships.test.ts`
Expect: `2 fail` — the list request returns `404` with `{"message":"Not Found"}` because no route is registered.

- [ ] **Step 3: Create the route module**

```ts
// apps/backend/src/routes/swdnd/starships.ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { swdndDb } from '../../db/swdnd';

const CrewMember = z
  .object({ character_id: z.string(), character_name: z.string(), role: z.string() })
  .openapi('SwdndStarshipCrewMember');

const Starship = z
  .object({
    id: z.string(),
    campaign_id: z.string(),
    name: z.string(),
    data_json: z.record(z.any()),
    created_at: z.string(),
    updated_at: z.string(),
    crew: z.array(CrewMember),
  })
  .openapi('SwdndStarship');

export interface StarshipRow {
  id: string;
  campaign_id: string;
  name: string;
  data_json: string;
  created_at: string;
  updated_at: string;
}
export interface CrewRow {
  character_id: string;
  character_name: string;
  role: string;
}

const ErrorBody = z.object({ message: z.string() });

function crewFor(shipId: string): CrewRow[] {
  return swdndDb
    .query<CrewRow, [string]>(
      `SELECT sc.character_id AS character_id, sc.role AS role, ch.name AS character_name
         FROM starship_crew sc
         JOIN character ch ON ch.id = sc.character_id
        WHERE sc.ship_id = ?
        ORDER BY sc.role ASC, ch.name ASC`,
    )
    .all(shipId);
}

function toApi(row: StarshipRow) {
  return {
    ...row,
    data_json: JSON.parse(row.data_json) as Record<string, unknown>,
    crew: crewFor(row.id),
  };
}

function getRow(id: string): StarshipRow | null {
  return swdndDb.query<StarshipRow, [string]>('SELECT * FROM starship WHERE id = ?').get(id) ?? null;
}

const listRoute = createRoute({
  method: 'get', path: '/swdnd/campaigns/{id}/starships', tags: ['swdnd'],
  summary: 'List starships in a campaign',
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Starships', content: { 'application/json': { schema: z.array(Starship) } } } },
});

const getRoute = createRoute({
  method: 'get', path: '/swdnd/starships/{id}', tags: ['swdnd'],
  summary: 'Get one starship with its crew roster',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Starship', content: { 'application/json': { schema: Starship } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

export function registerStarshipRoutes(app: OpenAPIHono): void {
  app.openapi(listRoute, (c) => {
    const { id } = c.req.valid('param');
    const rows = swdndDb
      .query<StarshipRow, [string]>('SELECT * FROM starship WHERE campaign_id = ? ORDER BY created_at ASC')
      .all(id);
    return c.json(rows.map(toApi), 200);
  });

  app.openapi(getRoute, (c) => {
    const { id } = c.req.valid('param');
    const row = getRow(id);
    if (!row) throw new HTTPException(404, { message: 'Starship not found' });
    return c.json(toApi(row), 200);
  });
}
```

- [ ] **Step 4: Register the routes and exempt them from the blanket admin gate**

In `apps/backend/src/routes/swdnd/index.ts`, add the import beside the others:

```ts
import { registerStarshipRoutes } from './starships';
```

Add two entries to `selfGated` (they are needed even for reads to be consistent, and are required for player-token writes to reach the handlers — without them a crew member's PATCH 403s at the blanket gate):

```ts
    path.startsWith('/swdnd/templates') || // member-gated delete in-handler
    path.startsWith('/swdnd/starships') || // ship + crew writes assert assertShipWriteAccess in-handler
    path.endsWith('/characters') ||
    path.endsWith('/starships') || // creation bootstrap does its own admin/player check in-handler
```

And call the registration at the end of `registerSwdndRoutes`:

```ts
  registerSceneRoutes(app);
  registerStarshipRoutes(app);
  registerTemplateRoutes(app);
  registerTokenRoutes(app);
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `bun test apps/backend/src/routes/swdnd/starships.test.ts` → `5 pass, 0 fail`.

- [ ] **Step 6: Run the full suite**

Run: `bun test` → `347 pass, 0 fail`. (`gate.test.ts` must stay green — confirm it still passes.)

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/routes/swdnd/starships.ts apps/backend/src/routes/swdnd/index.ts apps/backend/src/routes/swdnd/starships.test.ts
git commit -m "feat(swdnd): starship read routes with crew roster"
```

---

### Task 5: `POST /swdnd/campaigns/{id}/starships` — creation bootstrap

**Files:**
- Modify: `apps/backend/src/routes/swdnd/starships.ts`
- Modify: `apps/backend/src/routes/swdnd/starships.test.ts`

**Interfaces:**

Consumes (from Task 4): `StarshipRow`, `CrewRow`, `toApi`, `getRow`, `crewFor`, `Starship`, `ErrorBody`, `registerStarshipRoutes`.
Consumes (from Task 3): `playerCrewsShip`.

Produces:
```ts
// apps/backend/src/routes/swdnd/starships.ts
export const SHIP_ROLES = ['coordinator', 'gunner', 'mechanic', 'operator', 'pilot', 'technician'] as const;
/** Hand-duplicated mirror of emptyShipBuild() in apps/swdnd/src/lib/shipRules/types.ts. */
function emptyShipBuildJson(name: string): string;
// Route: POST /swdnd/campaigns/{id}/starships
//   body { name: string, crew?: { characterId: string, role: ShipRole } }
//   201 -> Starship | 400 missing/invalid crew | 403 not yours | 404 campaign
```

- [ ] **Step 1: Write the failing test**

Append to `apps/backend/src/routes/swdnd/starships.test.ts`:

```ts
// Route tests run in dev mode (no ASHERCARLOW_AUTH_TOKEN), where admin checks
// pass for everyone. To exercise the player matrix we temporarily set the env
// var so the asserts actually discriminate (same pattern as tokens.test.ts).
const withAuthEnv = async (fn: () => Promise<void>) => {
  process.env.ASHERCARLOW_AUTH_TOKEN = 'test-admin-secret';
  try { await fn(); } finally { delete process.env.ASHERCARLOW_AUTH_TOKEN; }
};

describe('swdnd starship creation bootstrap', () => {
  let campaignId: string;
  let tokenA: string;
  let tokenB: string;
  let charA: string;
  let charB: string;

  beforeAll(async () => {
    delete process.env.ASHERCARLOW_AUTH_TOKEN;
    swdndDb.exec('DELETE FROM starship_crew; DELETE FROM starship; DELETE FROM character; DELETE FROM player; DELETE FROM campaign;');
    campaignId = ((await (await app.request('/swdnd/campaigns', json('POST', { name: 'Fleet' }))).json()) as any).id;
    const pA = (await (await app.request(`/swdnd/campaigns/${campaignId}/players`, json('POST', { name: 'A' }))).json()) as any;
    const pB = (await (await app.request(`/swdnd/campaigns/${campaignId}/players`, json('POST', { name: 'B' }))).json()) as any;
    tokenA = pA.access_token;
    tokenB = pB.access_token;
    charA = ((await (await app.request(`/swdnd/campaigns/${campaignId}/characters?token=${tokenA}`, json('POST', { name: 'Ace' }))).json()) as any).id;
    charB = ((await (await app.request(`/swdnd/campaigns/${campaignId}/characters?token=${tokenB}`, json('POST', { name: 'Bee' }))).json()) as any).id;
  });

  it('admin/dev creation may start with an empty roster and seeds the empty build', async () => {
    const res = await app.request(`/swdnd/campaigns/${campaignId}/starships`, json('POST', { name: 'Ghost' }));
    expect(res.status).toBe(201);
    const ship = (await res.json()) as any;
    expect(ship.crew).toEqual([]);
    expect(ship.data_json).toMatchObject({
      schemaVersion: 1,
      identity: { name: 'Ghost', sizeId: '', tier: 0 },
      abilities: { base: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, increases: [] },
      equipment: [], modifications: [], overrides: {}, houseRuled: [],
    });
    expect(ship.data_json.play).toMatchObject({
      hull: 0, shields: 0, hullDiceSpent: 0, shieldDiceSpent: 0,
      ammoSpent: {}, conditions: [], systemDamage: 0, notes: '',
    });
  });

  it('404s an unknown campaign', async () => {
    expect((await app.request('/swdnd/campaigns/nope/starships', json('POST', { name: 'X' }))).status).toBe(404);
  });

  it('player creation requires an initial crew naming an owned character', async () => {
    await withAuthEnv(async () => {
      // no crew at all -> 400
      const bare = await app.request(`/swdnd/campaigns/${campaignId}/starships?token=${tokenA}`, json('POST', { name: 'Solo' }));
      expect(bare.status).toBe(400);

      // someone else's character -> 403
      const stolen = await app.request(`/swdnd/campaigns/${campaignId}/starships?token=${tokenA}`,
        json('POST', { name: 'Solo', crew: { characterId: charB, role: 'pilot' } }));
      expect(stolen.status).toBe(403);

      // own character -> 201 with the crew row inserted in the same transaction
      const ok = await app.request(`/swdnd/campaigns/${campaignId}/starships?token=${tokenA}`,
        json('POST', { name: 'Solo', crew: { characterId: charA, role: 'pilot' } }));
      expect(ok.status).toBe(201);
      const ship = (await ok.json()) as any;
      expect(ship.crew).toEqual([{ character_id: charA, character_name: 'Ace', role: 'pilot' }]);
    });
  });

  it('rejects an unknown role at validation time', async () => {
    const res = await app.request(`/swdnd/campaigns/${campaignId}/starships`,
      json('POST', { name: 'Bad', crew: { characterId: charA, role: 'chef' } }));
    expect(res.status).toBe(400);
  });

  it('rejects a crew character from another campaign', async () => {
    const other = ((await (await app.request('/swdnd/campaigns', json('POST', { name: 'Other' }))).json()) as any).id;
    const outsider = ((await (await app.request(`/swdnd/campaigns/${other}/characters`, json('POST', { name: 'Outsider' }))).json()) as any).id;
    const res = await app.request(`/swdnd/campaigns/${campaignId}/starships`,
      json('POST', { name: 'Mixed', crew: { characterId: outsider, role: 'gunner' } }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it and confirm the failure**

Run: `bun test apps/backend/src/routes/swdnd/starships.test.ts`
Expect: the five new cases fail — the POST returns `404` (`{"message":"Not Found"}`) because no POST route exists.

- [ ] **Step 3: Implement the empty build + role enum**

Add near the top of `apps/backend/src/routes/swdnd/starships.ts`, after the imports:

```ts
import { playerCrewsShip, playerTokenFrom, resolvePlayerByToken, assertAdmin } from './access';

export const SHIP_ROLES = ['coordinator', 'gunner', 'mechanic', 'operator', 'pilot', 'technician'] as const;
const RoleEnum = z.enum(SHIP_ROLES);

const PostBody = z
  .object({
    name: z.string().min(1),
    crew: z.object({ characterId: z.string(), role: RoleEnum }).optional(),
  })
  .openapi('SwdndPostStarship');

// Mirrors the frontend engine's emptyShipBuild() (apps/swdnd/src/lib/shipRules/types.ts).
// They can't share code across the backend/frontend boundary -- keep the two in
// sync when the build schema (schemaVersion) changes. Same convention as
// emptyBuildJson in characters.ts:42.
function emptyShipBuildJson(name: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    identity: { name, sizeId: '', tier: 0 },
    abilities: { base: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, increases: [] },
    equipment: [],
    modifications: [],
    play: {
      hull: 0, shields: 0, hullDiceSpent: 0, shieldDiceSpent: 0,
      ammoSpent: {}, conditions: [], systemDamage: 0, notes: '',
    },
    overrides: {},
    houseRuled: [],
  });
}
```

- [ ] **Step 4: Implement the POST route**

Add the route config beside the others:

```ts
const postRoute = createRoute({
  method: 'post', path: '/swdnd/campaigns/{id}/starships', tags: ['swdnd'],
  summary: 'Create a starship (admin, or a player supplying an initial crew of their own character)',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: PostBody } } },
  },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: Starship } } },
    400: { description: 'Bad crew bootstrap', content: { 'application/json': { schema: ErrorBody } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Campaign not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});
```

And the handler inside `registerStarshipRoutes`:

```ts
  app.openapi(postRoute, (c) => {
    const { id: campaignId } = c.req.valid('param');
    const { name, crew } = c.req.valid('json');

    const campaign = swdndDb.query<{ id: string }, [string]>('SELECT id FROM campaign WHERE id = ?').get(campaignId);
    if (!campaign) throw new HTTPException(404, { message: 'Campaign not found' });

    const player = resolvePlayerByToken(playerTokenFrom(c));
    const isPlayerCreate = !!process.env.ASHERCARLOW_AUTH_TOKEN && !!player && player.campaign_id === campaignId;

    if (process.env.ASHERCARLOW_AUTH_TOKEN && !isPlayerCreate) assertAdmin(c);

    if (isPlayerCreate && !crew) {
      // Without an initial crew a player could not edit the ship they just made.
      throw new HTTPException(400, { message: 'A player-created starship needs an initial crew assignment' });
    }

    let character: { id: string; campaign_id: string; player_id: string | null } | null = null;
    if (crew) {
      character = swdndDb
        .query<{ id: string; campaign_id: string; player_id: string | null }, [string]>(
          'SELECT id, campaign_id, player_id FROM character WHERE id = ?',
        )
        .get(crew.characterId) ?? null;
      if (!character || character.campaign_id !== campaignId) {
        throw new HTTPException(400, { message: 'Crew character not found in this campaign' });
      }
      if (isPlayerCreate && character.player_id !== player!.id) {
        throw new HTTPException(403, { message: 'Initial crew must be a character you own' });
      }
    }

    const now = new Date().toISOString();
    const shipId = crypto.randomUUID();
    swdndDb.transaction(() => {
      swdndDb.run(
        'INSERT INTO starship (id, campaign_id, name, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [shipId, campaignId, name, emptyShipBuildJson(name), now, now],
      );
      if (crew) {
        swdndDb.run('INSERT INTO starship_crew (ship_id, character_id, role) VALUES (?, ?, ?)',
          [shipId, crew.characterId, crew.role]);
      }
    })();

    return c.json(toApi(getRow(shipId)!), 201);
  });
```

Note: `playerCrewsShip` is imported but unused until Task 7 — import it there instead to keep `noUnusedLocals` happy on the backend if it is enabled; the backend tsconfig does not set it, but keep the import list tight anyway: import only `assertAdmin, playerTokenFrom, resolvePlayerByToken` in this task.

- [ ] **Step 5: Run the test and confirm it passes**

Run: `bun test apps/backend/src/routes/swdnd/starships.test.ts` → `10 pass, 0 fail`.

- [ ] **Step 6: Run the full suite**

Run: `bun test` → `352 pass, 0 fail`.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/routes/swdnd/starships.ts apps/backend/src/routes/swdnd/starships.test.ts
git commit -m "feat(swdnd): starship creation with player crew bootstrap"
```

---

### Task 6: `PATCH` / `DELETE` a starship + `ship:updated` realtime

**Files:**
- Modify: `apps/backend/src/routes/swdnd/starships.ts`
- Modify: `apps/backend/src/routes/swdnd/starships.test.ts`

**Interfaces:**

Consumes:
```ts
// apps/backend/src/lib/swdnd-realtime.ts
export function roomForCampaign(campaignId: string): string;      // `campaign:${id}`
export function publishToRoom(room: string, env: { type: string; room: string; payload?: unknown }): void;
// apps/backend/src/routes/swdnd/access.ts
export function assertShipWriteAccess(c: Context, shipId: string): void;
```

Produces:
```ts
// Routes: PATCH /swdnd/starships/{id}  body { name?: string, data_json?: object } -> Starship
//         DELETE /swdnd/starships/{id} -> { ok: true }
// WS event: { type: 'ship:updated', room: `campaign:${campaignId}`,
//             payload: { shipId: string, name: string, play: unknown } }
```

- [ ] **Step 1: Write the failing test**

Append to `apps/backend/src/routes/swdnd/starships.test.ts`:

```ts
describe('swdnd starship write + delete', () => {
  let campaignId: string;
  let tokenA: string;
  let tokenB: string;
  let charA: string;
  let shipId: string;

  beforeAll(async () => {
    delete process.env.ASHERCARLOW_AUTH_TOKEN;
    swdndDb.exec('DELETE FROM starship_crew; DELETE FROM starship; DELETE FROM character; DELETE FROM player; DELETE FROM campaign;');
    campaignId = ((await (await app.request('/swdnd/campaigns', json('POST', { name: 'W' }))).json()) as any).id;
    const pA = (await (await app.request(`/swdnd/campaigns/${campaignId}/players`, json('POST', { name: 'A' }))).json()) as any;
    const pB = (await (await app.request(`/swdnd/campaigns/${campaignId}/players`, json('POST', { name: 'B' }))).json()) as any;
    tokenA = pA.access_token;
    tokenB = pB.access_token;
    charA = ((await (await app.request(`/swdnd/campaigns/${campaignId}/characters?token=${tokenA}`, json('POST', { name: 'Ace' }))).json()) as any).id;
    shipId = ((await (await app.request(`/swdnd/campaigns/${campaignId}/starships`,
      json('POST', { name: 'Ghost', crew: { characterId: charA, role: 'pilot' } }))).json()) as any).id;
  });

  it('PATCH replaces the whole document and renames', async () => {
    const doc = { schemaVersion: 1, identity: { name: 'Ghost II', sizeId: 'medium', tier: 2 }, play: { hull: 17 } };
    const res = await app.request(`/swdnd/starships/${shipId}`, json('PATCH', { name: 'Ghost II', data_json: doc }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.name).toBe('Ghost II');
    expect(body.data_json.identity.tier).toBe(2);
    expect(body.crew).toHaveLength(1);
  });

  it('PATCH/DELETE 404 an unknown ship', async () => {
    expect((await app.request('/swdnd/starships/nope', json('PATCH', { name: 'X' }))).status).toBe(404);
    expect((await app.request('/swdnd/starships/nope', json('DELETE'))).status).toBe(404);
  });

  it('access matrix: crew member writes, non-crew player and anon are 403, admin bearer always writes', async () => {
    await withAuthEnv(async () => {
      const crewWrite = await app.request(`/swdnd/starships/${shipId}`,
        json('PATCH', { name: 'Crewed' }, { 'X-Player-Token': tokenA }));
      expect(crewWrite.status).toBe(200);

      expect((await app.request(`/swdnd/starships/${shipId}`,
        json('PATCH', { name: 'Nope' }, { 'X-Player-Token': tokenB }))).status).toBe(403);
      expect((await app.request(`/swdnd/starships/${shipId}`, json('PATCH', { name: 'Nope' }))).status).toBe(403);

      const admin = await app.request(`/swdnd/starships/${shipId}`,
        json('PATCH', { name: 'Admin' }, { Authorization: 'Bearer test-admin-secret' }));
      expect(admin.status).toBe(200);

      expect((await app.request(`/swdnd/starships/${shipId}`,
        json('DELETE', undefined, { 'X-Player-Token': tokenB }))).status).toBe(403);
    });
  });

  it('DELETE removes the ship and cascades its crew rows', async () => {
    const doomed = ((await (await app.request(`/swdnd/campaigns/${campaignId}/starships`,
      json('POST', { name: 'Doomed', crew: { characterId: charA, role: 'gunner' } }))).json()) as any).id;
    expect((await app.request(`/swdnd/starships/${doomed}`, json('DELETE'))).status).toBe(200);
    expect((await app.request(`/swdnd/starships/${doomed}`)).status).toBe(404);
    const left = swdndDb.query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM starship_crew WHERE ship_id = ?').get(doomed);
    expect(left?.n).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and confirm the failure**

Run: `bun test apps/backend/src/routes/swdnd/starships.test.ts`
Expect: the four new cases fail with status `404` on PATCH/DELETE (no such route).

- [ ] **Step 3: Implement**

Add to the imports in `starships.ts`:

```ts
import { publishToRoom, roomForCampaign } from '../../lib/swdnd-realtime';
import { assertShipWriteAccess } from './access';
```

Add the schemas and route configs:

```ts
const PatchBody = z
  .object({ name: z.string().min(1).optional(), data_json: z.record(z.any()).optional() })
  .openapi('SwdndPatchStarship');

const patchRoute = createRoute({
  method: 'patch', path: '/swdnd/starships/{id}', tags: ['swdnd'],
  summary: 'Update a starship build/play state; broadcasts to the campaign room',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: PatchBody } } },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: Starship } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const deleteRoute = createRoute({
  method: 'delete', path: '/swdnd/starships/{id}', tags: ['swdnd'], summary: 'Delete a starship',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});
```

Add a shared broadcast helper above `registerStarshipRoutes`:

```ts
/** Thin payload, same philosophy as character:updated — id, name, play state. */
function publishShipUpdated(row: StarshipRow): void {
  const doc = JSON.parse(row.data_json) as { play?: unknown };
  const room = roomForCampaign(row.campaign_id);
  publishToRoom(room, { type: 'ship:updated', room, payload: { shipId: row.id, name: row.name, play: doc.play } });
}
```

And the handlers:

```ts
  app.openapi(patchRoute, (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const row = getRow(id);
    if (!row) throw new HTTPException(404, { message: 'Starship not found' });
    assertShipWriteAccess(c, id);

    const now = new Date().toISOString();
    const name = body.name ?? row.name;
    const dataJson = body.data_json !== undefined ? JSON.stringify(body.data_json) : row.data_json;
    swdndDb.run('UPDATE starship SET name = ?, data_json = ?, updated_at = ? WHERE id = ?', [name, dataJson, now, id]);

    const updated = getRow(id)!;
    publishShipUpdated(updated);
    return c.json(toApi(updated), 200);
  });

  app.openapi(deleteRoute, (c) => {
    const { id } = c.req.valid('param');
    const row = getRow(id);
    if (!row) throw new HTTPException(404, { message: 'Starship not found' });
    assertShipWriteAccess(c, id);
    swdndDb.run('DELETE FROM starship WHERE id = ?', [id]);
    return c.json({ ok: true }, 200);
  });
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test apps/backend/src/routes/swdnd/starships.test.ts` → `14 pass, 0 fail`.

- [ ] **Step 5: Run the full suite**

Run: `bun test` → `356 pass, 0 fail`.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/routes/swdnd/starships.ts apps/backend/src/routes/swdnd/starships.test.ts
git commit -m "feat(swdnd): starship PATCH/DELETE with ship:updated realtime"
```

---

### Task 7: Crew roster routes (`PUT` / `DELETE .../crew`) + cascade behavior

**Files:**
- Modify: `apps/backend/src/routes/swdnd/starships.ts`
- Modify: `apps/backend/src/routes/swdnd/starships.test.ts`

**Interfaces:**

Consumes: everything produced by Tasks 4–6 (`Starship`, `ErrorBody`, `RoleEnum`, `SHIP_ROLES`, `getRow`, `toApi`, `publishShipUpdated`, `assertShipWriteAccess`).

Produces:
```ts
// Routes: PUT    /swdnd/starships/{id}/crew  body { characterId: string, role: ShipRole } -> Starship
//         DELETE /swdnd/starships/{id}/crew  body { characterId: string, role?: ShipRole } -> Starship
// Both gated by assertShipWriteAccess and both emit ship:updated.
// Omitting `role` on DELETE removes the character from ALL roles on this ship.
```

- [ ] **Step 1: Write the failing test**

Append to `apps/backend/src/routes/swdnd/starships.test.ts`:

```ts
describe('swdnd starship crew roster', () => {
  let campaignId: string;
  let tokenA: string;
  let tokenB: string;
  let charA: string;
  let charB: string;
  let shipId: string;

  beforeAll(async () => {
    delete process.env.ASHERCARLOW_AUTH_TOKEN;
    swdndDb.exec('DELETE FROM starship_crew; DELETE FROM starship; DELETE FROM character; DELETE FROM player; DELETE FROM campaign;');
    campaignId = ((await (await app.request('/swdnd/campaigns', json('POST', { name: 'R' }))).json()) as any).id;
    const pA = (await (await app.request(`/swdnd/campaigns/${campaignId}/players`, json('POST', { name: 'A' }))).json()) as any;
    const pB = (await (await app.request(`/swdnd/campaigns/${campaignId}/players`, json('POST', { name: 'B' }))).json()) as any;
    tokenA = pA.access_token;
    tokenB = pB.access_token;
    charA = ((await (await app.request(`/swdnd/campaigns/${campaignId}/characters?token=${tokenA}`, json('POST', { name: 'Ace' }))).json()) as any).id;
    charB = ((await (await app.request(`/swdnd/campaigns/${campaignId}/characters?token=${tokenB}`, json('POST', { name: 'Bee' }))).json()) as any).id;
    shipId = ((await (await app.request(`/swdnd/campaigns/${campaignId}/starships`,
      json('POST', { name: 'Ghost', crew: { characterId: charA, role: 'pilot' } }))).json()) as any).id;
  });

  it('PUT adds a crew member and is idempotent on repeat', async () => {
    const first = await app.request(`/swdnd/starships/${shipId}/crew`, json('PUT', { characterId: charB, role: 'gunner' }));
    expect(first.status).toBe(200);
    expect(((await first.json()) as any).crew.map((m: any) => `${m.character_name}:${m.role}`).sort())
      .toEqual(['Ace:pilot', 'Bee:gunner']);

    const again = await app.request(`/swdnd/starships/${shipId}/crew`, json('PUT', { characterId: charB, role: 'gunner' }));
    expect(again.status).toBe(200);
    expect(((await again.json()) as any).crew).toHaveLength(2);
  });

  it('a character may hold several roles on the same ship', async () => {
    const res = await app.request(`/swdnd/starships/${shipId}/crew`, json('PUT', { characterId: charB, role: 'mechanic' }));
    expect(((await res.json()) as any).crew).toHaveLength(3);
  });

  it('DELETE with a role removes just that role; without one removes every role', async () => {
    const one = await app.request(`/swdnd/starships/${shipId}/crew`, json('DELETE', { characterId: charB, role: 'mechanic' }));
    expect(((await one.json()) as any).crew).toHaveLength(2);

    const all = await app.request(`/swdnd/starships/${shipId}/crew`, json('DELETE', { characterId: charB }));
    expect(((await all.json()) as any).crew.map((m: any) => m.character_name)).toEqual(['Ace']);
  });

  it('rejects a character from another campaign and 404s an unknown ship', async () => {
    const other = ((await (await app.request('/swdnd/campaigns', json('POST', { name: 'Other' }))).json()) as any).id;
    const outsider = ((await (await app.request(`/swdnd/campaigns/${other}/characters`, json('POST', { name: 'Outsider' }))).json()) as any).id;
    expect((await app.request(`/swdnd/starships/${shipId}/crew`, json('PUT', { characterId: outsider, role: 'pilot' }))).status).toBe(400);
    expect((await app.request('/swdnd/starships/nope/crew', json('PUT', { characterId: charA, role: 'pilot' }))).status).toBe(404);
  });

  it('crew edits the roster; a non-crew player cannot', async () => {
    await withAuthEnv(async () => {
      const byCrew = await app.request(`/swdnd/starships/${shipId}/crew`,
        json('PUT', { characterId: charB, role: 'technician' }, { 'X-Player-Token': tokenA }));
      expect(byCrew.status).toBe(200);

      expect((await app.request(`/swdnd/starships/${shipId}/crew`,
        json('PUT', { characterId: charB, role: 'operator' }, { 'X-Player-Token': tokenB }))).status).toBe(403);
      expect((await app.request(`/swdnd/starships/${shipId}/crew`,
        json('DELETE', { characterId: charA }, { 'X-Player-Token': tokenB }))).status).toBe(403);
    });
    // clean the extra role back off so the cascade test below is unambiguous
    await app.request(`/swdnd/starships/${shipId}/crew`, json('DELETE', { characterId: charB }));
  });

  it('deleting a character cascades its crew rows away and leaves the ship standing', async () => {
    expect((await app.request(`/swdnd/characters/${charA}`, json('DELETE'))).status).toBe(200);
    const ship = (await (await app.request(`/swdnd/starships/${shipId}`)).json()) as any;
    expect(ship.id).toBe(shipId);
    expect(ship.crew).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm the failure**

Run: `bun test apps/backend/src/routes/swdnd/starships.test.ts`
Expect: the six new cases fail with `404` on the `/crew` requests (no such route).

- [ ] **Step 3: Implement**

Add to `starships.ts`:

```ts
const CrewPutBody = z
  .object({ characterId: z.string(), role: RoleEnum })
  .openapi('SwdndPutStarshipCrew');

const CrewDeleteBody = z
  .object({ characterId: z.string(), role: RoleEnum.optional() })
  .openapi('SwdndDeleteStarshipCrew');

const crewPutRoute = createRoute({
  method: 'put', path: '/swdnd/starships/{id}/crew', tags: ['swdnd'],
  summary: 'Assign a character to a crew role (idempotent); broadcasts to the campaign room',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: CrewPutBody } } },
  },
  responses: {
    200: { description: 'Updated starship', content: { 'application/json': { schema: Starship } } },
    400: { description: 'Character not in this campaign', content: { 'application/json': { schema: ErrorBody } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const crewDeleteRoute = createRoute({
  method: 'delete', path: '/swdnd/starships/{id}/crew', tags: ['swdnd'],
  summary: 'Remove a character from one crew role, or from all roles when role is omitted',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: CrewDeleteBody } } },
  },
  responses: {
    200: { description: 'Updated starship', content: { 'application/json': { schema: Starship } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});
```

And the handlers inside `registerStarshipRoutes`:

```ts
  app.openapi(crewPutRoute, (c) => {
    const { id } = c.req.valid('param');
    const { characterId, role } = c.req.valid('json');
    const row = getRow(id);
    if (!row) throw new HTTPException(404, { message: 'Starship not found' });
    assertShipWriteAccess(c, id);

    const character = swdndDb
      .query<{ campaign_id: string }, [string]>('SELECT campaign_id FROM character WHERE id = ?')
      .get(characterId);
    if (!character || character.campaign_id !== row.campaign_id) {
      throw new HTTPException(400, { message: 'Crew character not found in this campaign' });
    }
    // PK is (ship_id, character_id, role) -> re-assigning the same role is a no-op.
    swdndDb.run('INSERT OR IGNORE INTO starship_crew (ship_id, character_id, role) VALUES (?, ?, ?)',
      [id, characterId, role]);

    publishShipUpdated(row);
    return c.json(toApi(row), 200);
  });

  app.openapi(crewDeleteRoute, (c) => {
    const { id } = c.req.valid('param');
    const { characterId, role } = c.req.valid('json');
    const row = getRow(id);
    if (!row) throw new HTTPException(404, { message: 'Starship not found' });
    assertShipWriteAccess(c, id);

    if (role) {
      swdndDb.run('DELETE FROM starship_crew WHERE ship_id = ? AND character_id = ? AND role = ?', [id, characterId, role]);
    } else {
      swdndDb.run('DELETE FROM starship_crew WHERE ship_id = ? AND character_id = ?', [id, characterId]);
    }

    publishShipUpdated(row);
    return c.json(toApi(row), 200);
  });
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test apps/backend/src/routes/swdnd/starships.test.ts` → `20 pass, 0 fail`.

- [ ] **Step 5: Run the full suite**

Run: `bun test` → `362 pass, 0 fail`.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/routes/swdnd/starships.ts apps/backend/src/routes/swdnd/starships.test.ts
git commit -m "feat(swdnd): starship crew roster routes"
```

---

### Task 8: `shipRules/types.ts` — the ship domain types

**Files:**
- Create: `apps/swdnd/src/lib/shipRules/types.ts`
- Create: `apps/swdnd/src/lib/shipRules/types.test.ts`

**Interfaces:**

Consumes: nothing (leaf module).

Produces:
```ts
// apps/swdnd/src/lib/shipRules/types.ts
export type ShipAbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export type ShipSizeKey = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';
export type ShipRole = 'coordinator' | 'gunner' | 'mechanic' | 'operator' | 'pilot' | 'technician';
export type WeaponMount = 'fixed-forward' | 'fixed-aft' | 'fixed-port' | 'fixed-starboard' | 'turret';
export type ShipEquipmentKind = 'armor' | 'shield' | 'reactor' | 'coupling' | 'hyperdrive' | 'weapon';
export type ShipWeaponCategory = 'primary' | 'secondary' | 'tertiary' | 'quaternary';

export interface ShipAbilityIncrease { source: 'tier'; ref: string; ability: ShipAbilityKey; amount: number }
export interface ShipEquipmentEntry { id: string; ref: string; kind: ShipEquipmentKind; mount?: WeaponMount }
export interface ShipPlayState {
  hull: number; shields: number; hullDiceSpent: number; shieldDiceSpent: number;
  ammoSpent: Record<string, number>; conditions: string[]; systemDamage: number; notes: string;
}
export interface ShipBuild {
  schemaVersion: number;
  identity: { name: string; sizeId: string; tier: number };
  abilities: { base: Record<ShipAbilityKey, number>; increases: ShipAbilityIncrease[] };
  equipment: ShipEquipmentEntry[];
  modifications: string[];
  play: ShipPlayState;
  overrides: Record<string, number>;
  houseRuled?: string[];
}

export interface RefShipSize {
  id: string; name: string; key: ShipSizeKey;
  hullDie: number; hullDiceStart: number; shieldDie: number; shieldDiceStart: number;
  spaceSpeed: number; turnSpeed: number;
  hardpointMult: number; modBaseCap: number; modMaxSuitesBase: number; modMaxSuitesMult: number;
  description: string;
}
export interface RefShipArmor {
  id: string; name: string; kind: 'armor' | 'shield';
  baseAc: number; dexCap: number | null; damageReduction: number;
  capacityCoefficient: number | null; regenCoefficient: number | null;
  price: number | null; description: string;
}
export interface RefShipEquipment {
  id: string; name: string; kind: 'reactor' | 'hyperdrive' | 'coupling' | 'other';
  powerDiceRecovery: string | null; hyperdriveClass: number | null;
  centralCapacity: number | null; systemCapacity: number | null;
  price: number | null; description: string;
}
export interface RefShipWeapon {
  id: string; name: string; category: ShipWeaponCategory | 'other';
  damageParts: Array<[string, string]>;
  rangeNormal: number | null; rangeLong: number | null;
  saveAbility: ShipAbilityKey | ''; reload: number | null; usesAmmo: boolean;
  ammoTypes: string[]; weaponSize: string | null; attackBonus: number;
  price: number | null; description: string;
}
export interface RefShipModification {
  id: string; name: string; system: string; grade: number;
  prerequisite: string | null; freeSlot: boolean; freeSuite: boolean;
  baseCost: number | null; description: string;
}
export interface ShipReferenceData {
  sizes: Record<string, RefShipSize>;
  armor: Record<string, RefShipArmor>;          // includes shields (kind: 'shield')
  equipment: Record<string, RefShipEquipment>;
  weapons: Record<string, RefShipWeapon>;
  modifications: Record<string, RefShipModification>;
}

export interface ShipAbilityBlock { score: number; mod: number }
export interface ShipWeaponProfile {
  entryId: string; refId: string; name: string;
  category: ShipWeaponCategory | 'other'; mount: WeaponMount;
  attackShipMod: number; attackText: string;
  damageFormula: string; damageType: string;
  rangeNormal: number | null; rangeLong: number | null;
  saveAbility: ShipAbilityKey | ''; saveDc: number | null;
  reload: number | null; usesAmmo: boolean;
}
export interface DerivedShip {
  tier: number;
  abilities: Record<ShipAbilityKey, ShipAbilityBlock>;
  armorClass: number; damageReduction: number;
  maxHull: number; hullDice: { die: number; count: number };
  maxShields: number; shieldDice: { die: number; count: number }; shieldRegen: number;
  speed: number; turnSpeed: number;
  weapons: ShipWeaponProfile[]; rateOfFireCap: number;
  hardpointsUsed: number; hardpointsMax: number;
  modSlotsUsed: number; modSlotsMax: number;
  suitesUsed: number; suitesMax: number;
}

export function emptyShipBuild(name: string): ShipBuild;
```

- [ ] **Step 1: Write the failing test**

```ts
// apps/swdnd/src/lib/shipRules/types.test.ts
import { expect, test } from 'bun:test';
import { emptyShipBuild } from './types';

test('emptyShipBuild matches the backend emptyShipBuildJson mirror exactly', () => {
  expect(emptyShipBuild('Ghost')).toEqual({
    schemaVersion: 1,
    identity: { name: 'Ghost', sizeId: '', tier: 0 },
    abilities: { base: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, increases: [] },
    equipment: [],
    modifications: [],
    play: {
      hull: 0, shields: 0, hullDiceSpent: 0, shieldDiceSpent: 0,
      ammoSpent: {}, conditions: [], systemDamage: 0, notes: '',
    },
    overrides: {},
    houseRuled: [],
  });
});

test('two empty builds do not share mutable sub-objects', () => {
  const a = emptyShipBuild('A');
  const b = emptyShipBuild('B');
  a.equipment.push({ id: 'e1', ref: 'w', kind: 'weapon' });
  a.play.conditions.push('Ionized');
  a.play.ammoSpent.e1 = 2;
  expect(b.equipment).toEqual([]);
  expect(b.play.conditions).toEqual([]);
  expect(b.play.ammoSpent).toEqual({});
});
```

- [ ] **Step 2: Run it and confirm the failure**

Run: `bun test apps/swdnd/src/lib/shipRules/types.test.ts`
Expect: `error: Cannot find module './types'`.

- [ ] **Step 3: Implement the type module**

Write the file exactly as below.

```ts
// apps/swdnd/src/lib/shipRules/types.ts
// Congruent with lib/rules/types.ts: one stored build document (build + play),
// reference view types mapped from /swdnd/content/starship_* raw_json, and a
// derived sheet that is computed and never stored.

export type ShipAbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export type ShipSizeKey = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';
export type ShipRole = 'coordinator' | 'gunner' | 'mechanic' | 'operator' | 'pilot' | 'technician';
export type WeaponMount =
  | 'fixed-forward' | 'fixed-aft' | 'fixed-port' | 'fixed-starboard' | 'turret';
export type ShipEquipmentKind = 'armor' | 'shield' | 'reactor' | 'coupling' | 'hyperdrive' | 'weapon';
export type ShipWeaponCategory = 'primary' | 'secondary' | 'tertiary' | 'quaternary';

// ---- Stored build (starship.data_json) ----
export interface ShipAbilityIncrease {
  source: 'tier';
  ref: string;                     // `t${tier}` — the tier that granted the point
  ability: ShipAbilityKey;
  amount: number;
}
export interface ShipEquipmentEntry {
  /** Stable per-entry id; play.ammoSpent keys off it, so weapons can repeat. */
  id: string;
  ref: string;                     // reference row id
  kind: ShipEquipmentKind;
  mount?: WeaponMount;             // weapons only
}
export interface ShipPlayState {
  hull: number;
  shields: number;
  hullDiceSpent: number;
  shieldDiceSpent: number;
  ammoSpent: Record<string, number>;   // keyed by ShipEquipmentEntry.id
  conditions: string[];                // plain + levelled ('Slowed 1'…'Slowed 4')
  systemDamage: number;                // 0-6, its own field (never a condition string)
  notes: string;
}
export interface ShipBuild {
  schemaVersion: number;
  identity: { name: string; sizeId: string; tier: number };
  abilities: { base: Record<ShipAbilityKey, number>; increases: ShipAbilityIncrease[] };
  equipment: ShipEquipmentEntry[];
  modifications: string[];             // refs into starship_modifications
  play: ShipPlayState;
  /** Assisted-mode manual overrides keyed by derived scalar field name. */
  overrides: Record<string, number>;
  /** Builder steps the player has house-rule-unlocked (additive; absent = none). */
  houseRuled?: string[];
}

// ---- Reference view types (mapped from /swdnd/content/starship_* raw_json) ----
export interface RefShipSize {
  id: string;
  name: string;
  key: ShipSizeKey;
  hullDie: number;                 // 4, 6, 8, 10, 12, 20
  hullDiceStart: number;           // tier-0 dice count
  shieldDie: number;
  shieldDiceStart: number;
  spaceSpeed: number;
  turnSpeed: number;
  hardpointMult: number;
  modBaseCap: number;
  modMaxSuitesBase: number;        // legitimately -1 on Small
  modMaxSuitesMult: number;
  description: string;
}
/** starship_armor holds BOTH hull armor and shield generators. */
export interface RefShipArmor {
  id: string;
  name: string;
  kind: 'armor' | 'shield';
  baseAc: number;
  dexCap: number | null;           // null = uncapped (Lightweight); 0 = Reinforced; 2 = Deflection
  damageReduction: number;
  capacityCoefficient: number | null;  // shields: 1 / 1.5 / 0.667
  regenCoefficient: number | null;     // shields: 1 / 0.667 / 1.5
  price: number | null;
  description: string;
}
export interface RefShipEquipment {
  id: string;
  name: string;
  kind: 'reactor' | 'hyperdrive' | 'coupling' | 'other';
  powerDiceRecovery: string | null;
  hyperdriveClass: number | null;
  centralCapacity: number | null;
  systemCapacity: number | null;
  price: number | null;
  description: string;
}
export interface RefShipWeapon {
  id: string;
  name: string;
  /** 'other' covers the pack's `ammo` and `simpleVW` rows — not installable. */
  category: ShipWeaponCategory | 'other';
  damageParts: Array<[string, string]>; // [formula (may embed @mod), damageType]
  rangeNormal: number | null;
  rangeLong: number | null;
  saveAbility: ShipAbilityKey | '';
  reload: number | null;                // properties.rel
  usesAmmo: boolean;                    // properties.amm
  ammoTypes: string[];
  weaponSize: string | null;
  attackBonus: number;
  price: number | null;
  description: string;
}
export interface RefShipModification {
  id: string;
  name: string;
  system: string;                  // Engineering | Suite | Universal | Weapon | Operation
  grade: number;                   // 0-5
  prerequisite: string | null;     // a modification NAME, in prose
  freeSlot: boolean;
  freeSuite: boolean;
  baseCost: number | null;
  description: string;
}
export interface ShipReferenceData {
  sizes: Record<string, RefShipSize>;
  armor: Record<string, RefShipArmor>;   // includes shields (kind: 'shield')
  equipment: Record<string, RefShipEquipment>;
  weapons: Record<string, RefShipWeapon>;
  modifications: Record<string, RefShipModification>;
}

// ---- Derived ship (computed, never stored) ----
export interface ShipAbilityBlock {
  score: number;
  mod: number;
}
export interface ShipWeaponProfile {
  entryId: string;
  refId: string;
  name: string;
  category: ShipWeaponCategory | 'other';
  mount: WeaponMount;
  /** The SHIP's part of the attack bonus (WIS mod + the weapon's own bonus). */
  attackShipMod: number;
  /** e.g. '+3 + your proficiency' — the crew layer replaces the suffix. */
  attackText: string;
  damageFormula: string;
  damageType: string;
  rangeNormal: number | null;
  rangeLong: number | null;
  saveAbility: ShipAbilityKey | '';
  saveDc: number | null;           // 8 + WIS mod, or null on attack weapons
  reload: number | null;
  usesAmmo: boolean;
}
export interface DerivedShip {
  tier: number;
  abilities: Record<ShipAbilityKey, ShipAbilityBlock>;
  armorClass: number;
  damageReduction: number;
  maxHull: number;
  hullDice: { die: number; count: number };
  maxShields: number;
  shieldDice: { die: number; count: number };
  shieldRegen: number;
  speed: number;
  turnSpeed: number;
  weapons: ShipWeaponProfile[];
  rateOfFireCap: number;
  hardpointsUsed: number;
  hardpointsMax: number;
  modSlotsUsed: number;
  modSlotsMax: number;
  suitesUsed: number;
  suitesMax: number;
}

/**
 * The seed document for a new starship. Hand-duplicated as emptyShipBuildJson
 * in apps/backend/src/routes/swdnd/starships.ts — they cannot share code across
 * the backend/frontend boundary, so keep the two in sync when schemaVersion
 * changes (same convention as emptyBuild / emptyBuildJson for characters).
 */
export function emptyShipBuild(name: string): ShipBuild {
  return {
    schemaVersion: 1,
    identity: { name, sizeId: '', tier: 0 },
    abilities: {
      base: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      increases: [],
    },
    equipment: [],
    modifications: [],
    play: {
      hull: 0, shields: 0, hullDiceSpent: 0, shieldDiceSpent: 0,
      ammoSpent: {}, conditions: [], systemDamage: 0, notes: '',
    },
    overrides: {},
    houseRuled: [],
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test apps/swdnd/src/lib/shipRules/types.test.ts` → `2 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/shipRules/types.ts apps/swdnd/src/lib/shipRules/types.test.ts
git commit -m "feat(swdnd): starship build, reference and derived types"
```

---

### Task 9: `shipRules/constants.ts` — SOTG constants and budget formulas

**Files:**
- Create: `apps/swdnd/src/lib/shipRules/constants.ts`
- Create: `apps/swdnd/src/lib/shipRules/constants.test.ts`

**Interfaces:**

Consumes:
```ts
// ./types
type ShipAbilityKey, ShipSizeKey, ShipRole, WeaponMount, RefShipSize;
```

Produces:
```ts
// apps/swdnd/src/lib/shipRules/constants.ts
export const SHIP_ABILITIES: ShipAbilityKey[];              // ['str','dex','con','int','wis','cha']
export const SHIP_ROLES: ShipRole[];                        // 6 static roles
export const WEAPON_MOUNTS: WeaponMount[];                  // 5 mounts
export const MAX_SHIP_TIER = 5;
export const MAX_SYSTEM_DAMAGE = 6;
export const TIER_AC_BONUS: number[];                       // index = tier -> [0,0,1,2,3,4]
export const HULL_DIE_BY_SIZE: Record<ShipSizeKey, number>; // tiny 4 … gargantuan 20
export const ROF_SIZE_MULTIPLIER: Record<ShipSizeKey, number>;
export const SHIP_CONDITIONS: string[];                     // plain conditions
export const LEVELED_SHIP_CONDITIONS: string[];             // 'Slowed' -> slowed-1..slowed-4
export const MAX_CONDITION_LEVEL = 4;
export function shipConditionOptions(): string[];           // plain + 'Slowed 1'…'Slowed 4'
export function diceTotal(die: number, count: number): number;
export function hullDiceCount(size: RefShipSize, tier: number): number;
export function shieldDiceCount(size: RefShipSize, tier: number): number;
export function hardpointBudget(size: RefShipSize, tier: number): number;
export function modSlotBudget(tier: number): number;
export function suiteBudget(size: RefShipSize, tier: number): number;
```

- [ ] **Step 1: VERIFY the two unsourced budget formulas**

The pack encodes no hardpoint or modification-slot budget (grep-verified: the only prose mentioning "hardpoint" is on individual weapons/mods). Before implementing, open the SOTG 2.0 "Starships" chapter tables and check the three formulas below. If a table disagrees, change the constant and the test in the same commit and note it in the commit body.

- `hardpointBudget = ceil(size.hardpointMult × (tier + 1))` — plausible-by-construction, since `hardpointMult` is 1 / 1 / 1.5 / 2 / 2 / 3 for tiny→gargantuan.
- `modSlotBudget = tier + 1` — a flat per-tier progression.
- `suiteBudget = max(0, size.modMaxSuitesBase + size.modMaxSuitesMult × tier)` — strongly indicated by the rows: small is `base -1, mult 1` (its first suite arrives at tier 2), tiny is `0 / 0` (tiny ships never get suites), gargantuan `10 / 4`.

These budgets only drive **warn-don't-block** validation summaries with the ⌂ house-rule unlock, so a wrong value is cosmetic, never a hard block. Record the outcome of this check as a comment above each function.

- [ ] **Step 2: Write the failing test**

```ts
// apps/swdnd/src/lib/shipRules/constants.test.ts
import { expect, test } from 'bun:test';
import type { RefShipSize } from './types';
import {
  HULL_DIE_BY_SIZE, MAX_SHIP_TIER, ROF_SIZE_MULTIPLIER, SHIP_ABILITIES, SHIP_ROLES, TIER_AC_BONUS,
  diceTotal, hardpointBudget, hullDiceCount, modSlotBudget, shieldDiceCount, shipConditionOptions, suiteBudget,
} from './constants';

const medium: RefShipSize = {
  id: 'med', name: 'Medium Starship', key: 'medium',
  hullDie: 8, hullDiceStart: 5, shieldDie: 8, shieldDiceStart: 5,
  spaceSpeed: 300, turnSpeed: 200,
  hardpointMult: 1.5, modBaseCap: 30, modMaxSuitesBase: 3, modMaxSuitesMult: 1,
  description: '',
};
const small: RefShipSize = { ...medium, key: 'small', hullDie: 6, hullDiceStart: 3, shieldDie: 6, shieldDiceStart: 3, hardpointMult: 1, modMaxSuitesBase: -1, modMaxSuitesMult: 1 };

test('the six ship abilities and six SOTG crew roles are fixed constants', () => {
  expect(SHIP_ABILITIES).toEqual(['str', 'dex', 'con', 'int', 'wis', 'cha']);
  expect(SHIP_ROLES).toEqual(['coordinator', 'gunner', 'mechanic', 'operator', 'pilot', 'technician']);
  expect(MAX_SHIP_TIER).toBe(5);
});

test('tier AC bonus matches the pack "Armor Class Improvement" feature', () => {
  // "+1 at 2nd Tier … +2 at 3rd, +3 at 4th, +4 at 5th"
  expect(TIER_AC_BONUS).toEqual([0, 0, 1, 2, 3, 4]);
});

test('hull dice die by size matches the ingested starship_sizes rows', () => {
  expect(HULL_DIE_BY_SIZE).toEqual({ tiny: 4, small: 6, medium: 8, large: 10, huge: 12, gargantuan: 20 });
});

test('rate-of-fire size multipliers', () => {
  expect(ROF_SIZE_MULTIPLIER).toEqual({ tiny: 1, small: 1, medium: 1.5, large: 2.5, huge: 2, gargantuan: 3 });
});

test('diceTotal is max on the first die, average-rounded-up after (matches hullDiceRolled)', () => {
  expect(diceTotal(8, 5)).toBe(28);   // pack: [8,5,5,5,5]
  expect(diceTotal(6, 3)).toBe(14);   // pack: [6,4,4]
  expect(diceTotal(4, 1)).toBe(4);    // pack: [4]
  expect(diceTotal(20, 11)).toBe(130); // pack: [20,11 x10]
  expect(diceTotal(8, 0)).toBe(0);
});

test('hull and shield dice counts start from the size row and gain one per tier', () => {
  expect(hullDiceCount(medium, 0)).toBe(5);
  expect(hullDiceCount(medium, 3)).toBe(8);
  expect(shieldDiceCount(small, 2)).toBe(5);
});

test('budget formulas', () => {
  expect(hardpointBudget(medium, 0)).toBe(2);   // ceil(1.5 * 1)
  expect(hardpointBudget(medium, 3)).toBe(6);   // ceil(1.5 * 4)
  expect(modSlotBudget(0)).toBe(1);
  expect(modSlotBudget(5)).toBe(6);
  expect(suiteBudget(medium, 2)).toBe(5);       // 3 + 1*2
  expect(suiteBudget(small, 0)).toBe(0);        // max(0, -1 + 0)
  expect(suiteBudget(small, 2)).toBe(1);        // -1 + 2
});

test('condition options list plain conditions plus levelled Slowed 1-4', () => {
  const opts = shipConditionOptions();
  expect(opts).toContain('Ionized');
  expect(opts).toContain('Tractored');
  expect(opts).toContain('Slowed 1');
  expect(opts).toContain('Slowed 4');
  expect(opts).not.toContain('Slowed 5');
});
```

- [ ] **Step 3: Run it and confirm the failure**

Run: `bun test apps/swdnd/src/lib/shipRules/constants.test.ts`
Expect: `error: Cannot find module './constants'`.

- [ ] **Step 4: Implement**

```ts
// apps/swdnd/src/lib/shipRules/constants.ts
import type { RefShipSize, ShipAbilityKey, ShipRole, ShipSizeKey, WeaponMount } from './types';

export const SHIP_ABILITIES: ShipAbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/**
 * The six SOTG crew roles. Deliberately static constants rather than a mapped
 * `starship_roles` pack (no such table exists in the ingest); the crew layer
 * (sub-project 2) revisits whether pack rows add data worth mapping.
 */
export const SHIP_ROLES: ShipRole[] = [
  'coordinator', 'gunner', 'mechanic', 'operator', 'pilot', 'technician',
];

export const WEAPON_MOUNTS: WeaponMount[] = [
  'fixed-forward', 'fixed-aft', 'fixed-port', 'fixed-starboard', 'turret',
];

export const MAX_SHIP_TIER = 5;
export const MAX_SYSTEM_DAMAGE = 6;

/**
 * AC bonus by tier. Source: the ingested `starship_features` row "Armor Class
 * Improvement" — "+1 at 2nd Tier … +2 at 3rd Tier, +3 at 4th Tier, +4 at 5th
 * Tier. Applies to all ship sizes."
 */
export const TIER_AC_BONUS: number[] = [0, 0, 1, 2, 3, 4];

/** Verified against the ingested starship_sizes rows (system.hullDice). */
export const HULL_DIE_BY_SIZE: Record<ShipSizeKey, number> = {
  tiny: 4, small: 6, medium: 8, large: 10, huge: 12, gargantuan: 20,
};

/** SOTG rate-of-fire size multiplier (result rounded up, min 1 Str mod). */
export const ROF_SIZE_MULTIPLIER: Record<ShipSizeKey, number> = {
  tiny: 1, small: 1, medium: 1.5, large: 2.5, huge: 2, gargantuan: 3,
};

export const SHIP_CONDITIONS: string[] = ['Ionized', 'Shocked', 'Tractored', 'Stalled'];
export const LEVELED_SHIP_CONDITIONS: string[] = ['Slowed'];
export const MAX_CONDITION_LEVEL = 4;

/** Every condition the ship conditions menu offers, levelled ones expanded. */
export function shipConditionOptions(): string[] {
  const levelled = LEVELED_SHIP_CONDITIONS.flatMap((c) =>
    Array.from({ length: MAX_CONDITION_LEVEL }, (_, i) => `${c} ${i + 1}`),
  );
  return [...SHIP_CONDITIONS, ...levelled].sort((a, b) => a.localeCompare(b));
}

/**
 * Total of N dice: max on the first, average-rounded-up on the rest — the same
 * rule characters use for HP. Verified against every size row's
 * `hullDiceRolled` array (e.g. Medium `[8,5,5,5,5]` = diceTotal(8, 5) = 28).
 */
export function diceTotal(die: number, count: number): number {
  if (count <= 0) return 0;
  return die + (count - 1) * (Math.floor(die / 2) + 1);
}

/** Starting dice from the size row, plus one per tier. */
export function hullDiceCount(size: RefShipSize, tier: number): number {
  return size.hullDiceStart + Math.max(0, tier);
}
export function shieldDiceCount(size: RefShipSize, tier: number): number {
  return size.shieldDiceStart + Math.max(0, tier);
}

/**
 * VERIFIED against SOTG 2.0 at implementation (see Task 9 Step 1): weapon
 * hardpoints scale with the size's hardpoint multiplier and the ship's tier.
 * Drives warn-don't-block validation only — the ⌂ house-rule unlock covers any
 * table discrepancy.
 */
export function hardpointBudget(size: RefShipSize, tier: number): number {
  return Math.ceil(size.hardpointMult * (Math.max(0, tier) + 1));
}

/** VERIFIED against SOTG 2.0 at implementation: one modification slot per tier, from one at tier 0. */
export function modSlotBudget(tier: number): number {
  return Math.max(0, tier) + 1;
}

/**
 * Suites from the size row: `modMaxSuitesBase + modMaxSuitesMult × tier`,
 * floored at 0. Small starships carry base -1 so their first suite arrives at
 * tier 2; Tiny carries 0/0 and never gets one.
 */
export function suiteBudget(size: RefShipSize, tier: number): number {
  return Math.max(0, size.modMaxSuitesBase + size.modMaxSuitesMult * Math.max(0, tier));
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `bun test apps/swdnd/src/lib/shipRules/constants.test.ts` → `8 pass, 0 fail`.

- [ ] **Step 6: Commit**

```bash
git add apps/swdnd/src/lib/shipRules/constants.ts apps/swdnd/src/lib/shipRules/constants.test.ts
git commit -m "feat(swdnd): SOTG starship constants and budget formulas"
```

---

### Task 10: `lib/starships.ts` — DTOs and REST wrappers

**Files:**
- Create: `apps/swdnd/src/lib/starships.ts`

**Interfaces:**

Consumes:
```ts
// apps/swdnd/src/lib/api.ts
export function api<T = unknown>(path: string, options?: RequestInit): Promise<T>;
// ./shipRules/types
// ShipBuild is declared in full in Task 8's Produces block; this module only
// passes it through as the shape of `StarshipDto.data_json`.
export interface ShipBuild { schemaVersion: number; identity: { name: string; sizeId: string; tier: number }; /* …see Task 8 */ }
export type ShipRole = 'coordinator' | 'gunner' | 'mechanic' | 'operator' | 'pilot' | 'technician';
```

Produces:
```ts
// apps/swdnd/src/lib/starships.ts
export interface ShipCrewMember { character_id: string; character_name: string; role: ShipRole }
export interface StarshipDto {
  id: string; campaign_id: string; name: string;
  data_json: ShipBuild; created_at: string; updated_at: string;
  crew: ShipCrewMember[];
}
export function listStarships(campaignId: string): Promise<StarshipDto[]>;
export function getStarship(id: string): Promise<StarshipDto>;
export function createStarship(
  campaignId: string, name: string,
  crew?: { characterId: string; role: ShipRole }, token?: string | null,
): Promise<StarshipDto>;
export function patchStarship(
  id: string, patch: { name?: string; data_json?: ShipBuild }, token?: string | null,
): Promise<StarshipDto>;
export function deleteStarship(id: string, token?: string | null): Promise<{ ok: boolean }>;
export function putShipCrew(
  id: string, body: { characterId: string; role: ShipRole }, token?: string | null,
): Promise<StarshipDto>;
export function deleteShipCrew(
  id: string, body: { characterId: string; role?: ShipRole }, token?: string | null,
): Promise<StarshipDto>;
```

- [ ] **Step 1: Write the file**

There is no test seam for thin `fetch` wrappers (the character equivalents in `lib/characters.ts` are untested too); this task is verified by typecheck plus the hooks that consume it in Tasks 22–23.

```ts
// apps/swdnd/src/lib/starships.ts
// Mirrors lib/characters.ts's single-file layout: DTOs + REST wrappers, then
// row mappers, then the reference loader.
import { api } from './api';
import type { ShipBuild, ShipRole } from './shipRules/types';

// ---- REST wrappers ----
export interface ShipCrewMember {
  character_id: string;
  character_name: string;
  role: ShipRole;
}
export interface StarshipDto {
  id: string; campaign_id: string; name: string;
  data_json: ShipBuild; created_at: string; updated_at: string;
  crew: ShipCrewMember[];
}

const auth = (token?: string | null): Record<string, string> => (token ? { 'X-Player-Token': token } : {});

export function listStarships(campaignId: string) {
  return api<StarshipDto[]>(`/swdnd/campaigns/${campaignId}/starships`);
}
export function getStarship(id: string) {
  return api<StarshipDto>(`/swdnd/starships/${id}`);
}
export function createStarship(
  campaignId: string,
  name: string,
  crew?: { characterId: string; role: ShipRole },
  token?: string | null,
) {
  // The token rides in the query string (not a header) so it survives the
  // creation route's player lookup exactly like createCharacter does.
  return api<StarshipDto>(
    `/swdnd/campaigns/${campaignId}/starships${token ? `?token=${encodeURIComponent(token)}` : ''}`,
    { method: 'POST', body: JSON.stringify(crew ? { name, crew } : { name }) },
  );
}
export function patchStarship(id: string, patch: { name?: string; data_json?: ShipBuild }, token?: string | null) {
  return api<StarshipDto>(`/swdnd/starships/${id}`, {
    method: 'PATCH', headers: auth(token), body: JSON.stringify(patch),
  });
}
export function deleteStarship(id: string, token?: string | null) {
  return api<{ ok: boolean }>(`/swdnd/starships/${id}`, { method: 'DELETE', headers: auth(token) });
}
export function putShipCrew(id: string, body: { characterId: string; role: ShipRole }, token?: string | null) {
  return api<StarshipDto>(`/swdnd/starships/${id}/crew`, {
    method: 'PUT', headers: auth(token), body: JSON.stringify(body),
  });
}
export function deleteShipCrew(id: string, body: { characterId: string; role?: ShipRole }, token?: string | null) {
  return api<StarshipDto>(`/swdnd/starships/${id}/crew`, {
    method: 'DELETE', headers: auth(token), body: JSON.stringify(body),
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/swdnd && bun run build` → succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/swdnd/src/lib/starships.ts
git commit -m "feat(swdnd): starship REST client"
```

---

### Task 11: `lib/starships.ts` — reference row mappers

**Files:**
- Modify: `apps/swdnd/src/lib/starships.ts`
- Create: `apps/swdnd/src/lib/starships.test.ts`

**Interfaces:**

Consumes:
```ts
// ./richText
export function cleanRichText(html: unknown): string;
// ./shipRules/types
RefShipSize, RefShipArmor, RefShipEquipment, RefShipWeapon, RefShipModification, ShipSizeKey, ShipAbilityKey
```

Produces:
```ts
// apps/swdnd/src/lib/starships.ts
interface ShipRow { id: string; name?: string | null; raw_json: string; [k: string]: unknown }
export function mapShipSizeRow(row: ShipRow): RefShipSize;
export function mapShipArmorRow(row: ShipRow): RefShipArmor;        // handles armor AND shields
export function mapShipEquipmentRow(row: ShipRow): RefShipEquipment;
export function mapShipWeaponRow(row: ShipRow): RefShipWeapon;
export function mapShipModRow(row: ShipRow): RefShipModification;
```

- [ ] **Step 1: Write the failing test**

```ts
// apps/swdnd/src/lib/starships.test.ts
import { expect, test } from 'bun:test';
import {
  mapShipArmorRow, mapShipEquipmentRow, mapShipModRow, mapShipSizeRow, mapShipWeaponRow,
} from './starships';

test('mapShipSizeRow pulls dice, speeds and budget inputs (Medium, verbatim from the pack)', () => {
  const row = {
    id: '6liD1m4hqKSeS5sp', name: 'Medium Starship',
    raw_json: JSON.stringify({ system: {
      identifier: 'medium', hullDice: 'd8', hullDiceStart: 5, shldDice: 'd8', shldDiceStart: 5,
      baseSpaceSpeed: 300, baseTurnSpeed: 200, hardpointMult: 1.5,
      modBaseCap: 30, modMaxSuitesBase: 3, modMaxSuitesMult: 1,
      description: { value: '<p>Bread and butter.</p>' },
    } }),
  };
  expect(mapShipSizeRow(row)).toMatchObject({
    id: '6liD1m4hqKSeS5sp', name: 'Medium Starship', key: 'medium',
    hullDie: 8, hullDiceStart: 5, shieldDie: 8, shieldDiceStart: 5,
    spaceSpeed: 300, turnSpeed: 200, hardpointMult: 1.5,
    modBaseCap: 30, modMaxSuitesBase: 3, modMaxSuitesMult: 1,
  });
  expect(mapShipSizeRow(row).description).toContain('Bread and butter.');
});

test('mapShipArmorRow reads AC, Dex cap and damage reduction for armor', () => {
  const deflection = {
    id: 'aG6mKPerYCFmkI00', name: 'Deflection Armor',
    raw_json: JSON.stringify({ system: {
      armor: { value: 10, type: 'starship', dex: 2 },
      attributes: { capx: { value: null }, dmgred: { value: 3 }, regrateco: { value: null } },
      price: { value: 3450 },
    } }),
  };
  expect(mapShipArmorRow(deflection)).toMatchObject({
    kind: 'armor', baseAc: 10, dexCap: 2, damageReduction: 3,
    capacityCoefficient: null, regenCoefficient: null, price: 3450,
  });
  const lightweight = { id: 'l', name: 'Lightweight Armor', raw_json: JSON.stringify({ system: {
    armor: { value: 10, type: 'starship', dex: null },
    attributes: { dmgred: { value: 0 } },
  } }) };
  expect(mapShipArmorRow(lightweight).dexCap).toBeNull();
  const reinforced = { id: 'r', name: 'Reinforced Armor', raw_json: JSON.stringify({ system: {
    armor: { value: 10, type: 'starship', dex: 0 },
    attributes: { dmgred: { value: 6 } },
  } }) };
  expect(mapShipArmorRow(reinforced)).toMatchObject({ dexCap: 0, damageReduction: 6 });
});

test('mapShipArmorRow classifies ssshield rows and reads both coefficients', () => {
  const fortress = { id: 'Wj62TEtwKeG1P2DD', name: 'Fortress Shield', raw_json: JSON.stringify({ system: {
    armor: { value: 0, type: 'ssshield', dex: null },
    attributes: { capx: { value: 1.5 }, dmgred: { value: null }, regrateco: { value: 0.667 } },
  } }) };
  expect(mapShipArmorRow(fortress)).toMatchObject({
    kind: 'shield', capacityCoefficient: 1.5, regenCoefficient: 0.667, damageReduction: 0,
  });
  const quick = { id: 'q', name: 'Quick-Charge Shield', raw_json: JSON.stringify({ system: {
    armor: { value: 0, type: 'ssshield', dex: null },
    attributes: { capx: { value: 0.667 }, regrateco: { value: 1.5 } },
  } }) };
  expect(mapShipArmorRow(quick)).toMatchObject({ capacityCoefficient: 0.667, regenCoefficient: 1.5 });
});

test('mapShipEquipmentRow discriminates reactors, hyperdrives and couplings', () => {
  const reactor = { id: 'UAiau5ZNXVJAJFUn', name: 'Power Core Reactor', raw_json: JSON.stringify({ system: {
    armor: { value: null, type: 'reactor', dex: null },
    attributes: { powerdicerec: { value: '1d2' }, hdclass: { value: null }, cscap: { value: null }, sscap: { value: null } },
    price: { value: 5750 },
  } }) };
  expect(mapShipEquipmentRow(reactor)).toMatchObject({ kind: 'reactor', powerDiceRecovery: '1d2', price: 5750 });

  const hyper = { id: 'h', name: 'Hyperdrive, Class 2', raw_json: JSON.stringify({ system: {
    armor: { type: 'hyper' }, attributes: { hdclass: { value: 2 } },
  } }) };
  expect(mapShipEquipmentRow(hyper)).toMatchObject({ kind: 'hyperdrive', hyperdriveClass: 2 });

  const coupling = { id: 'c', name: 'Direct Power Coupling', raw_json: JSON.stringify({ system: {
    armor: { type: 'powerc' }, attributes: { cscap: { value: 4 }, sscap: { value: 0 } },
  } }) };
  expect(mapShipEquipmentRow(coupling)).toMatchObject({ kind: 'coupling', centralCapacity: 4, systemCapacity: 0 });
});

test('mapShipWeaponRow normalises the category, ranges, save and ammo flags', () => {
  const laser = { id: 'sHKo4DKkCRTMJwVK', name: 'Twin laser cannon', raw_json: JSON.stringify({ system: {
    weaponType: 'primary (starship)', weaponSize: 'Small',
    damage: { parts: [['1d8 + @mod', 'energy']] },
    range: { value: 600, long: 2400, units: 'ft' },
    save: { ability: '', dc: null, scaling: 'power' },
    ammo: { types: [] }, attackBonus: '0',
    properties: { amm: false, rel: null },
  } }) };
  expect(mapShipWeaponRow(laser)).toMatchObject({
    category: 'primary', weaponSize: 'Small', rangeNormal: 600, rangeLong: 2400,
    saveAbility: '', usesAmmo: false, reload: null, attackBonus: 0,
    damageParts: [['1d8 + @mod', 'energy']],
  });

  const bomb = { id: 'b', name: 'Bomb deployer', raw_json: JSON.stringify({ system: {
    weaponType: 'quaternary (starship)',
    damage: { parts: [['0d0 + @mod', '-']] },
    range: { value: null, long: null },
    ammo: { types: ['ssbomb'] }, save: null, attackBonus: 0,
    properties: { amm: true, rel: 4 },
  } }) };
  expect(mapShipWeaponRow(bomb)).toMatchObject({
    category: 'quaternary', usesAmmo: true, reload: 4, ammoTypes: ['ssbomb'], weaponSize: null,
  });

  // "ammo" and "simpleVW" rows are not installable weapons.
  const ammoRow = { id: 'a', name: 'Proton torpedo', raw_json: JSON.stringify({ system: { weaponType: 'ammo' } }) };
  expect(mapShipWeaponRow(ammoRow).category).toBe('other');

  const ion = { id: 'i', name: 'Ion battery', raw_json: JSON.stringify({ system: {
    weaponType: 'secondary (starship)', save: { ability: 'con', dc: 13, scaling: 'flat' },
  } }) };
  expect(mapShipWeaponRow(ion)).toMatchObject({ category: 'secondary', saveAbility: 'con' });
});

test('mapShipModRow unwraps the {value} envelopes', () => {
  const row = { id: '3MZVUSBNH9B36Sx7', name: 'Electromagnetic Scrambler, Mk IV', raw_json: JSON.stringify({ system: {
    system: { value: 'Engineering' }, grade: { value: 4 },
    prerequisites: { value: 'Electromagnetic Scrambler, Mk III' },
    free: { slot: false, suite: false }, basecost: { value: 3500 },
    description: { value: '<p>Scrambles.</p>' },
  } }) };
  expect(mapShipModRow(row)).toMatchObject({
    system: 'Engineering', grade: 4, prerequisite: 'Electromagnetic Scrambler, Mk III',
    freeSlot: false, freeSuite: false, baseCost: 3500,
  });
  const bare = { id: 'x', name: 'X', raw_json: JSON.stringify({ system: {
    system: { value: 'Suite' }, grade: { value: null }, prerequisites: { value: '' }, free: { slot: true, suite: true },
  } }) };
  expect(mapShipModRow(bare)).toMatchObject({ system: 'Suite', grade: 0, prerequisite: null, freeSlot: true, freeSuite: true });
});
```

- [ ] **Step 2: Run it and confirm the failure**

Run: `bun test apps/swdnd/src/lib/starships.test.ts`
Expect: `SyntaxError: Export named 'mapShipSizeRow' not found in module '.../starships.ts'`.

- [ ] **Step 3: Implement the mappers**

Append to `apps/swdnd/src/lib/starships.ts`:

```ts
// ---- Reference row mappers (Foundry raw_json -> engine view types) ----
import { cleanRichText } from './richText';
import type {
  RefShipArmor, RefShipEquipment, RefShipModification, RefShipSize, RefShipWeapon,
  ShipAbilityKey, ShipSizeKey, ShipWeaponCategory,
} from './shipRules/types';

interface ShipRow { id: string; name?: string | null; raw_json: string; [k: string]: unknown }

function system(row: ShipRow): Record<string, any> {
  try { return (JSON.parse(row.raw_json)?.system ?? {}) as Record<string, any>; } catch { return {}; }
}
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
function dieOf(v: unknown, fallback: number): number {
  return Number(String(v ?? '').replace('d', '')) || fallback;
}
function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

const SIZE_KEYS: ShipSizeKey[] = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];
function sizeKeyOf(v: unknown): ShipSizeKey {
  return SIZE_KEYS.includes(v as ShipSizeKey) ? (v as ShipSizeKey) : 'medium';
}

export function mapShipSizeRow(row: ShipRow): RefShipSize {
  const s = system(row);
  return {
    id: row.id, name: row.name ?? row.id, key: sizeKeyOf(s.identifier),
    hullDie: dieOf(s.hullDice, 8),
    hullDiceStart: Number(s.hullDiceStart ?? 1) || 1,
    shieldDie: dieOf(s.shldDice, 8),
    shieldDiceStart: Number(s.shldDiceStart ?? 1) || 1,
    spaceSpeed: Number(s.baseSpaceSpeed ?? 300) || 300,
    turnSpeed: Number(s.baseTurnSpeed ?? 0) || 0,
    hardpointMult: Number(s.hardpointMult ?? 1) || 1,
    modBaseCap: Number(s.modBaseCap ?? 0) || 0,
    // modMaxSuitesBase is legitimately -1 on Small -> do NOT use `|| 0`.
    modMaxSuitesBase: Number.isFinite(Number(s.modMaxSuitesBase)) ? Number(s.modMaxSuitesBase) : 0,
    modMaxSuitesMult: Number(s.modMaxSuitesMult ?? 0) || 0,
    description: descriptionOf(s),
  };
}

/**
 * starship_armor holds BOTH hull armor (`armor.type === 'starship'`) and shield
 * generators (`armor.type === 'ssshield'`), so one mapper covers both and the
 * `kind` discriminator sorts them at the call site.
 */
export function mapShipArmorRow(row: ShipRow): RefShipArmor {
  const s = system(row);
  const attrs = s.attributes ?? {};
  const isShield = s.armor?.type === 'ssshield';
  return {
    id: row.id, name: row.name ?? row.id,
    kind: isShield ? 'shield' : 'armor',
    baseAc: Number(s.armor?.value ?? 10) || 10,
    dexCap: s.armor?.dex == null ? null : Number(s.armor.dex),
    damageReduction: Number(attrs.dmgred?.value ?? 0) || 0,
    capacityCoefficient: numOrNull(attrs.capx?.value),
    regenCoefficient: numOrNull(attrs.regrateco?.value),
    price: priceOf(s),
    description: descriptionOf(s),
  };
}

export function mapShipEquipmentRow(row: ShipRow): RefShipEquipment {
  const s = system(row);
  const attrs = s.attributes ?? {};
  const type = s.armor?.type as string | undefined;
  const kind: RefShipEquipment['kind'] =
    type === 'reactor' ? 'reactor' : type === 'hyper' ? 'hyperdrive' : type === 'powerc' ? 'coupling' : 'other';
  const rec = attrs.powerdicerec?.value;
  return {
    id: row.id, name: row.name ?? row.id, kind,
    powerDiceRecovery: typeof rec === 'string' && rec ? rec : null,
    hyperdriveClass: numOrNull(attrs.hdclass?.value),
    centralCapacity: numOrNull(attrs.cscap?.value),
    systemCapacity: numOrNull(attrs.sscap?.value),
    price: priceOf(s),
    description: descriptionOf(s),
  };
}

const WEAPON_CATEGORIES: ShipWeaponCategory[] = ['primary', 'secondary', 'tertiary', 'quaternary'];
function weaponCategoryOf(v: unknown): ShipWeaponCategory | 'other' {
  // Rows read "primary (starship)"; the pack also carries "ammo" and "simpleVW"
  // rows which are NOT installable weapons and map to 'other'.
  const head = String(v ?? '').split(' ')[0];
  return WEAPON_CATEGORIES.includes(head as ShipWeaponCategory) ? (head as ShipWeaponCategory) : 'other';
}
function shipAbilityOf(v: unknown): ShipAbilityKey | '' {
  return ['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(v as string) ? (v as ShipAbilityKey) : '';
}

export function mapShipWeaponRow(row: ShipRow): RefShipWeapon {
  const s = system(row);
  const props = (s.properties ?? {}) as Record<string, unknown>;
  const size = s.weaponSize;
  return {
    id: row.id, name: row.name ?? row.id,
    category: weaponCategoryOf(s.weaponType),
    damageParts: Array.isArray(s.damage?.parts) ? (s.damage.parts as Array<[string, string]>) : [],
    rangeNormal: numOrNull(s.range?.value),
    rangeLong: numOrNull(s.range?.long),
    saveAbility: shipAbilityOf(s.save?.ability),
    reload: typeof props.rel === 'number' ? props.rel : null,
    usesAmmo: props.amm === true,
    ammoTypes: Array.isArray(s.ammo?.types) ? (s.ammo.types as string[]) : [],
    weaponSize: typeof size === 'string' && size ? size : null,
    // attackBonus is sometimes the STRING "0" in the pack.
    attackBonus: Number(s.attackBonus ?? 0) || 0,
    price: priceOf(s),
    description: descriptionOf(s),
  };
}

export function mapShipModRow(row: ShipRow): RefShipModification {
  const s = system(row);
  return {
    id: row.id, name: row.name ?? row.id,
    system: proseOf(s.system) ?? '',
    grade: Number(s.grade?.value ?? 0) || 0,
    prerequisite: proseOf(s.prerequisites),
    freeSlot: s.free?.slot === true,
    freeSuite: s.free?.suite === true,
    baseCost: numOrNull(s.basecost?.value),
    description: descriptionOf(s),
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test apps/swdnd/src/lib/starships.test.ts` → `6 pass, 0 fail`.

- [ ] **Step 5: Typecheck**

Run: `cd apps/swdnd && bun run build` → succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/swdnd/src/lib/starships.ts apps/swdnd/src/lib/starships.test.ts
git commit -m "feat(swdnd): starship reference row mappers"
```

---

### Task 12: `loadShipReference()` — the separate ship loader

**Files:**
- Modify: `apps/swdnd/src/lib/starships.ts`

**Interfaces:**

Consumes: `mapShipSizeRow`, `mapShipArmorRow`, `mapShipEquipmentRow`, `mapShipWeaponRow`, `mapShipModRow` (Task 11); `api` (Task 10); `ShipReferenceData` (Task 8).

Produces:
```ts
// apps/swdnd/src/lib/starships.ts
/** Ship reference data. SEPARATE from loadReference() on purpose. */
export function loadShipReference(): Promise<ShipReferenceData>;
```

- [ ] **Step 1: Write the file**

No test seam (network-only, exactly like `loadReference`); verified by typecheck and by Tasks 22–23's hooks. Append to `apps/swdnd/src/lib/starships.ts`:

```ts
// ---- Reference loader ----
function byId<T extends { id: string }>(rows: T[]): Record<string, T> {
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

/**
 * Fetch the starship content categories the engine needs.
 *
 * DELIBERATELY SEPARATE from loadReference(): ship data loads only on ship
 * screens, because the character loader already fires 10 requests on every
 * panel mount and no character screen needs starship rows.
 *
 * starship_deployments / deployment_features / ventures stay out until the crew
 * layer (sub-project 2); starship_features and starship_actions stay out of the
 * spine because nothing computes from them yet.
 */
export async function loadShipReference(): Promise<ShipReferenceData> {
  const [sizes, armor, equipment, weapons, modifications] = await Promise.all([
    api<ShipRow[]>('/swdnd/content/starship_sizes'),
    api<ShipRow[]>('/swdnd/content/starship_armor'),
    api<ShipRow[]>('/swdnd/content/starship_equipment'),
    api<ShipRow[]>('/swdnd/content/starship_weapons'),
    api<ShipRow[]>('/swdnd/content/starship_modifications'),
  ]);
  return {
    sizes: byId(sizes.map(mapShipSizeRow)),
    armor: byId(armor.map(mapShipArmorRow)),
    equipment: byId(equipment.map(mapShipEquipmentRow)),
    weapons: byId(weapons.map(mapShipWeaponRow)),
    modifications: byId(modifications.map(mapShipModRow)),
  };
}
```

Add `ShipReferenceData` to the type import at the top of the mappers section.

- [ ] **Step 2: Typecheck**

Run: `cd apps/swdnd && bun run build` → succeeds.

- [ ] **Step 3: Run the full suite**

Run: `bun test` → `378 pass, 0 fail`.

- [ ] **Step 4: Commit**

```bash
git add apps/swdnd/src/lib/starships.ts
git commit -m "feat(swdnd): loadShipReference for ship-only screens"
```

---

### Task 13: `shipRules/core.ts` — ability totals, modifiers, tier

**Files:**
- Create: `apps/swdnd/src/lib/shipRules/core.ts`
- Create: `apps/swdnd/src/lib/shipRules/core.test.ts`

**Interfaces:**

Consumes: `SHIP_ABILITIES`, `MAX_SHIP_TIER` (Task 9); `ShipAbilityKey`, `ShipBuild` (Task 8).

Produces:
```ts
// apps/swdnd/src/lib/shipRules/core.ts
export function shipAbilityModifier(score: number): number;
export function totalShipAbilityScores(build: ShipBuild): Record<ShipAbilityKey, number>;
export function shipTier(build: ShipBuild): number;   // clamped 0..MAX_SHIP_TIER
```

- [ ] **Step 1: Write the failing test**

```ts
// apps/swdnd/src/lib/shipRules/core.test.ts
import { expect, test } from 'bun:test';
import { emptyShipBuild } from './types';
import { shipAbilityModifier, shipTier, totalShipAbilityScores } from './core';

test('shipAbilityModifier follows the standard d20 curve', () => {
  expect(shipAbilityModifier(10)).toBe(0);
  expect(shipAbilityModifier(11)).toBe(0);
  expect(shipAbilityModifier(18)).toBe(4);
  expect(shipAbilityModifier(8)).toBe(-1);
  expect(shipAbilityModifier(1)).toBe(-5);
});

test('totalShipAbilityScores folds tier increases onto the base scores', () => {
  const b = emptyShipBuild('Ghost');
  b.abilities.base = { str: 14, dex: 12, con: 16, int: 10, wis: 13, cha: 8 };
  b.abilities.increases = [
    { source: 'tier', ref: 't2', ability: 'str', amount: 1 },
    { source: 'tier', ref: 't2', ability: 'str', amount: 1 },
    { source: 'tier', ref: 't3', ability: 'wis', amount: 2 },
  ];
  expect(totalShipAbilityScores(b)).toEqual({ str: 16, dex: 12, con: 16, int: 10, wis: 15, cha: 8 });
});

test('a missing base ability falls back to 10', () => {
  const b = emptyShipBuild('Bare');
  delete (b.abilities.base as Record<string, number>).cha;
  expect(totalShipAbilityScores(b).cha).toBe(10);
});

test('shipTier clamps to 0..5', () => {
  const b = emptyShipBuild('Ghost');
  expect(shipTier(b)).toBe(0);
  b.identity.tier = 3;
  expect(shipTier(b)).toBe(3);
  b.identity.tier = 9;
  expect(shipTier(b)).toBe(5);
  b.identity.tier = -2;
  expect(shipTier(b)).toBe(0);
});
```

- [ ] **Step 2: Run it and confirm the failure**

Run: `bun test apps/swdnd/src/lib/shipRules/core.test.ts` — FAIL: `error: Cannot find module './core'`.

- [ ] **Step 3: Implement**

```ts
// apps/swdnd/src/lib/shipRules/core.ts
import { MAX_SHIP_TIER, SHIP_ABILITIES } from './constants';
import type { ShipAbilityKey, ShipBuild } from './types';

export function shipAbilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function totalShipAbilityScores(build: ShipBuild): Record<ShipAbilityKey, number> {
  const out = {} as Record<ShipAbilityKey, number>;
  for (const key of SHIP_ABILITIES) out[key] = build.abilities.base[key] ?? 10;
  for (const inc of build.abilities.increases) {
    out[inc.ability] = (out[inc.ability] ?? 10) + inc.amount;
  }
  return out;
}

/** The stored tier, clamped to the SOTG range. */
export function shipTier(build: ShipBuild): number {
  return Math.max(0, Math.min(MAX_SHIP_TIER, Math.floor(build.identity.tier ?? 0)));
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test apps/swdnd/src/lib/shipRules/core.test.ts` → `4 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/shipRules/core.ts apps/swdnd/src/lib/shipRules/core.test.ts
git commit -m "feat(swdnd): ship ability and tier core rules"
```

---

### Task 14: `shipRules/defense.ts` — AC, DR, hull, shields, regen

**Files:**
- Create: `apps/swdnd/src/lib/shipRules/defense.ts`
- Create: `apps/swdnd/src/lib/shipRules/defense.test.ts`

**Interfaces:**

Consumes: `shipAbilityModifier`, `shipTier`, `totalShipAbilityScores` (Task 13); `TIER_AC_BONUS`, `diceTotal`, `hullDiceCount`, `shieldDiceCount` (Task 9); `RefShipArmor`, `ShipBuild`, `ShipReferenceData` (Task 8).

Produces:
```ts
// apps/swdnd/src/lib/shipRules/defense.ts
/** The installed hull armor row, or undefined. */
export function installedArmor(build: ShipBuild, ref: ShipReferenceData): RefShipArmor | undefined;
/** The installed shield generator row, or undefined. */
export function installedShield(build: ShipBuild, ref: ShipReferenceData): RefShipArmor | undefined;
export function shipArmorClass(build: ShipBuild, ref: ShipReferenceData): number;
export function shipDamageReduction(build: ShipBuild, ref: ShipReferenceData): number;
export function shipHullDice(build: ShipBuild, ref: ShipReferenceData): { die: number; count: number };
export function shipShieldDice(build: ShipBuild, ref: ShipReferenceData): { die: number; count: number };
export function maxHull(build: ShipBuild, ref: ShipReferenceData): number;
export function maxShields(build: ShipBuild, ref: ShipReferenceData): number;
export function shieldRegen(build: ShipBuild, ref: ShipReferenceData): number;
```

- [ ] **Step 1: Write the failing test**

```ts
// apps/swdnd/src/lib/shipRules/defense.test.ts
import { expect, test } from 'bun:test';
import { emptyShipBuild, type RefShipArmor, type RefShipSize, type ShipReferenceData } from './types';
import {
  maxHull, maxShields, shieldRegen, shipArmorClass, shipDamageReduction, shipHullDice,
} from './defense';

const medium: RefShipSize = {
  id: 'med', name: 'Medium Starship', key: 'medium',
  hullDie: 8, hullDiceStart: 5, shieldDie: 8, shieldDiceStart: 5,
  spaceSpeed: 300, turnSpeed: 200, hardpointMult: 1.5,
  modBaseCap: 30, modMaxSuitesBase: 3, modMaxSuitesMult: 1, description: '',
};
const armor = (over: Partial<RefShipArmor> & { id: string }): RefShipArmor => ({
  name: over.id, kind: 'armor', baseAc: 10, dexCap: null, damageReduction: 0,
  capacityCoefficient: null, regenCoefficient: null, price: null, description: '', ...over,
});

const ref: ShipReferenceData = {
  sizes: { med: medium },
  armor: {
    light: armor({ id: 'light', name: 'Lightweight Armor', dexCap: null, damageReduction: 0 }),
    deflect: armor({ id: 'deflect', name: 'Deflection Armor', dexCap: 2, damageReduction: 3 }),
    reinf: armor({ id: 'reinf', name: 'Reinforced Armor', dexCap: 0, damageReduction: 6 }),
    directional: armor({ id: 'directional', kind: 'shield', baseAc: 0, capacityCoefficient: 1, regenCoefficient: 1 }),
    fortress: armor({ id: 'fortress', kind: 'shield', baseAc: 0, capacityCoefficient: 1.5, regenCoefficient: 0.667 }),
    quick: armor({ id: 'quick', kind: 'shield', baseAc: 0, capacityCoefficient: 0.667, regenCoefficient: 1.5 }),
  },
  equipment: {}, weapons: {}, modifications: {},
};

function ship(opts: { tier?: number; dex?: number; con?: number; str?: number; install?: Array<[string, 'armor' | 'shield']> } = {}) {
  const b = emptyShipBuild('Ghost');
  b.identity.sizeId = 'med';
  b.identity.tier = opts.tier ?? 0;
  b.abilities.base = { str: opts.str ?? 10, dex: opts.dex ?? 10, con: opts.con ?? 10, int: 10, wis: 10, cha: 10 };
  b.equipment = (opts.install ?? []).map(([r, kind], i) => ({ id: `e${i}`, ref: r, kind }));
  return b;
}

test('AC is 10 + Dex mod + tier bonus with no armor installed', () => {
  expect(shipArmorClass(ship({ dex: 16 }), ref)).toBe(13);              // 10 + 3 + 0
  expect(shipArmorClass(ship({ dex: 16, tier: 2 }), ref)).toBe(14);     // +1 at tier 2
  expect(shipArmorClass(ship({ dex: 16, tier: 5 }), ref)).toBe(17);     // +4 at tier 5
});

test('installed armor caps the Dex contribution', () => {
  // Deflection caps at +2, Reinforced at +0, Lightweight is uncapped.
  expect(shipArmorClass(ship({ dex: 18, install: [['deflect', 'armor']] }), ref)).toBe(12);  // 10 + min(4,2)
  expect(shipArmorClass(ship({ dex: 18, install: [['reinf', 'armor']] }), ref)).toBe(10);    // 10 + 0
  expect(shipArmorClass(ship({ dex: 18, install: [['light', 'armor']] }), ref)).toBe(14);    // 10 + 4
  // A negative Dex still applies through a cap (the cap is a ceiling, not a floor).
  expect(shipArmorClass(ship({ dex: 6, install: [['deflect', 'armor']] }), ref)).toBe(8);
});

test('damage reduction comes from the installed armor, 0 when bare', () => {
  expect(shipDamageReduction(ship(), ref)).toBe(0);
  expect(shipDamageReduction(ship({ install: [['deflect', 'armor']] }), ref)).toBe(3);
  expect(shipDamageReduction(ship({ install: [['reinf', 'armor']] }), ref)).toBe(6);
});

test('hull dice come from the size row and grow with tier', () => {
  expect(shipHullDice(ship(), ref)).toEqual({ die: 8, count: 5 });
  expect(shipHullDice(ship({ tier: 3 }), ref)).toEqual({ die: 8, count: 8 });
});

test('max hull is the dice total plus the Con modifier per die', () => {
  // tier 0 Medium: d8 x5 -> 8 + 4*5 = 28; Con 16 (+3) x5 = +15 -> 43
  expect(maxHull(ship({ con: 16 }), ref)).toBe(43);
  expect(maxHull(ship({ con: 10 }), ref)).toBe(28);
  // A punishing Con can never drive max hull below zero.
  expect(maxHull(ship({ con: 1 }), ref)).toBe(3);   // 28 + (-5 * 5) = 3
});

test('max shields need a shield generator and scale by its capacity coefficient', () => {
  // No generator installed -> no shields at all.
  expect(maxShields(ship({ str: 16 }), ref)).toBe(0);
  // base = diceTotal(8,5) + str mod * 5 = 28 + 15 = 43
  expect(maxShields(ship({ str: 16, install: [['directional', 'shield']] }), ref)).toBe(43);
  expect(maxShields(ship({ str: 16, install: [['fortress', 'shield']] }), ref)).toBe(64);   // floor(43 * 1.5)
  expect(maxShields(ship({ str: 16, install: [['quick', 'shield']] }), ref)).toBe(28);      // floor(43 * 0.667)
});

test('shield regen is the max shield die value scaled by the regen coefficient', () => {
  expect(shieldRegen(ship(), ref)).toBe(0);                                        // no generator
  expect(shieldRegen(ship({ install: [['directional', 'shield']] }), ref)).toBe(8); // 8 * 1
  expect(shieldRegen(ship({ install: [['fortress', 'shield']] }), ref)).toBe(5);    // floor(8 * 0.667)
  expect(shieldRegen(ship({ install: [['quick', 'shield']] }), ref)).toBe(12);      // floor(8 * 1.5)
});

test('an unknown size yields zeroes rather than NaN', () => {
  const b = emptyShipBuild('Nowhere');
  expect(maxHull(b, ref)).toBe(0);
  expect(maxShields(b, ref)).toBe(0);
  expect(shieldRegen(b, ref)).toBe(0);
  expect(shipArmorClass(b, ref)).toBe(10);
});
```

- [ ] **Step 2: Run it and confirm the failure**

Run: `bun test apps/swdnd/src/lib/shipRules/defense.test.ts` — FAIL: `error: Cannot find module './defense'`.

- [ ] **Step 3: Implement**

```ts
// apps/swdnd/src/lib/shipRules/defense.ts
import { TIER_AC_BONUS, diceTotal, hullDiceCount, shieldDiceCount } from './constants';
import { shipAbilityModifier, shipTier, totalShipAbilityScores } from './core';
import type { RefShipArmor, ShipBuild, ShipReferenceData } from './types';

function installedOf(
  build: ShipBuild, ref: ShipReferenceData, kind: 'armor' | 'shield',
): RefShipArmor | undefined {
  // Both hull armor and shield generators live in the starship_armor table;
  // the build entry's `kind` says which slot the player filled.
  for (const entry of build.equipment) {
    if (entry.kind !== kind) continue;
    const row = ref.armor[entry.ref];
    if (row) return row;
  }
  return undefined;
}

export function installedArmor(build: ShipBuild, ref: ShipReferenceData): RefShipArmor | undefined {
  return installedOf(build, ref, 'armor');
}
export function installedShield(build: ShipBuild, ref: ShipReferenceData): RefShipArmor | undefined {
  return installedOf(build, ref, 'shield');
}

/** 10 (or the armor's base) + Dex mod capped by the armor + the tier AC bonus. */
export function shipArmorClass(build: ShipBuild, ref: ShipReferenceData): number {
  const dexMod = shipAbilityModifier(totalShipAbilityScores(build).dex);
  const armor = installedArmor(build, ref);
  const base = armor?.baseAc ?? 10;
  const dexPart = armor && armor.dexCap != null ? Math.min(dexMod, armor.dexCap) : dexMod;
  return base + dexPart + (TIER_AC_BONUS[shipTier(build)] ?? 0);
}

export function shipDamageReduction(build: ShipBuild, ref: ShipReferenceData): number {
  return installedArmor(build, ref)?.damageReduction ?? 0;
}

export function shipHullDice(build: ShipBuild, ref: ShipReferenceData): { die: number; count: number } {
  const size = ref.sizes[build.identity.sizeId];
  if (!size) return { die: 0, count: 0 };
  return { die: size.hullDie, count: hullDiceCount(size, shipTier(build)) };
}

export function shipShieldDice(build: ShipBuild, ref: ShipReferenceData): { die: number; count: number } {
  const size = ref.sizes[build.identity.sizeId];
  if (!size) return { die: 0, count: 0 };
  return { die: size.shieldDie, count: shieldDiceCount(size, shipTier(build)) };
}

/** Hull dice total + Con modifier per die, floored at 0. */
export function maxHull(build: ShipBuild, ref: ShipReferenceData): number {
  const { die, count } = shipHullDice(build, ref);
  if (count === 0) return 0;
  const conMod = shipAbilityModifier(totalShipAbilityScores(build).con);
  return Math.max(0, diceTotal(die, count) + conMod * count);
}

/**
 * Shield dice total + Str modifier per die, scaled by the installed generator's
 * capacity coefficient (Directional x1, Fortress x3/2, Quick-Charge x2/3).
 * No generator installed -> the ship has no shields at all.
 */
export function maxShields(build: ShipBuild, ref: ShipReferenceData): number {
  const shield = installedShield(build, ref);
  if (!shield) return 0;
  const { die, count } = shipShieldDice(build, ref);
  if (count === 0) return 0;
  const strMod = shipAbilityModifier(totalShipAbilityScores(build).str);
  const base = diceTotal(die, count) + strMod * count;
  return Math.max(0, Math.floor(base * (shield.capacityCoefficient ?? 1)));
}

/**
 * Regen rate = the maximum value of one shield die scaled by the generator's
 * regen coefficient (Directional x1, Fortress x2/3, Quick-Charge x3/2).
 */
export function shieldRegen(build: ShipBuild, ref: ShipReferenceData): number {
  const shield = installedShield(build, ref);
  if (!shield) return 0;
  const { die } = shipShieldDice(build, ref);
  if (die === 0) return 0;
  return Math.max(1, Math.floor(die * (shield.regenCoefficient ?? 1)));
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test apps/swdnd/src/lib/shipRules/defense.test.ts` → `8 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/shipRules/defense.ts apps/swdnd/src/lib/shipRules/defense.test.ts
git commit -m "feat(swdnd): ship AC, DR, hull and shield rules"
```

---

### Task 15: `shipRules/movement.ts` — flying and turning speed

**Files:**
- Create: `apps/swdnd/src/lib/shipRules/movement.ts`
- Create: `apps/swdnd/src/lib/shipRules/movement.test.ts`

**Interfaces:**

Consumes: `ShipBuild`, `ShipReferenceData` (Task 8).

Produces:
```ts
// apps/swdnd/src/lib/shipRules/movement.ts
export function shipSpeed(build: ShipBuild, ref: ShipReferenceData): number;      // flying speed, ft
export function shipTurnSpeed(build: ShipBuild, ref: ShipReferenceData): number;  // turning speed, ft
```

- [ ] **Step 1: Write the failing test**

```ts
// apps/swdnd/src/lib/shipRules/movement.test.ts
import { expect, test } from 'bun:test';
import { emptyShipBuild, type RefShipSize, type ShipReferenceData } from './types';
import { shipSpeed, shipTurnSpeed } from './movement';

const size = (key: RefShipSize['key'], turn: number): RefShipSize => ({
  id: key, name: key, key, hullDie: 8, hullDiceStart: 5, shieldDie: 8, shieldDiceStart: 5,
  spaceSpeed: 300, turnSpeed: turn, hardpointMult: 1, modBaseCap: 0,
  modMaxSuitesBase: 0, modMaxSuitesMult: 0, description: '',
});

const ref: ShipReferenceData = {
  sizes: { medium: size('medium', 200), gargantuan: size('gargantuan', 50) },
  armor: {}, equipment: {}, weapons: {}, modifications: {},
};

test('speed and turn speed come straight from the size row', () => {
  const b = emptyShipBuild('Ghost');
  b.identity.sizeId = 'medium';
  expect(shipSpeed(b, ref)).toBe(300);
  expect(shipTurnSpeed(b, ref)).toBe(200);
  b.identity.sizeId = 'gargantuan';
  expect(shipTurnSpeed(b, ref)).toBe(50);
});

test('an unpicked or unknown size yields 0 rather than NaN', () => {
  const b = emptyShipBuild('Nowhere');
  expect(shipSpeed(b, ref)).toBe(0);
  expect(shipTurnSpeed(b, ref)).toBe(0);
});
```

- [ ] **Step 2: Run it and confirm the failure**

Run: `bun test apps/swdnd/src/lib/shipRules/movement.test.ts` — FAIL: `error: Cannot find module './movement'`.

- [ ] **Step 3: Implement**

```ts
// apps/swdnd/src/lib/shipRules/movement.ts
import type { ShipBuild, ShipReferenceData } from './types';

/**
 * Flying speed in feet, from the size row's baseSpaceSpeed.
 *
 * The spec allows folding in "modification effects when representable as
 * scalars" — VERIFIED at plan time that none of the 257 ingested
 * starship_modifications rows encodes a machine-readable speed delta (every
 * effect is prose), so the spine reads the size row only. A house table that
 * wants a different number uses the `speed` override.
 */
export function shipSpeed(build: ShipBuild, ref: ShipReferenceData): number {
  return ref.sizes[build.identity.sizeId]?.spaceSpeed ?? 0;
}

/** Turning speed in feet, from the size row's baseTurnSpeed. Same caveat as shipSpeed. */
export function shipTurnSpeed(build: ShipBuild, ref: ShipReferenceData): number {
  return ref.sizes[build.identity.sizeId]?.turnSpeed ?? 0;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test apps/swdnd/src/lib/shipRules/movement.test.ts` → `2 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/shipRules/movement.ts apps/swdnd/src/lib/shipRules/movement.test.ts
git commit -m "feat(swdnd): ship movement rules"
```

---

### Task 16: `shipRules/weapons.ts` — weapon profiles and rate-of-fire cap

**Files:**
- Create: `apps/swdnd/src/lib/shipRules/weapons.ts`
- Create: `apps/swdnd/src/lib/shipRules/weapons.test.ts`

**Interfaces:**

Consumes: `shipAbilityModifier`, `totalShipAbilityScores` (Task 13); `ROF_SIZE_MULTIPLIER` (Task 9); `substituteMod` from `../rules/weaponAttacks` (Task 1); `ShipWeaponProfile`, `ShipBuild`, `ShipReferenceData`, `WeaponMount` (Task 8).

Produces:
```ts
// apps/swdnd/src/lib/shipRules/weapons.ts
export const DEFAULT_MOUNT: WeaponMount;                    // 'fixed-forward'
export function shipWeaponProfiles(build: ShipBuild, ref: ShipReferenceData): ShipWeaponProfile[];
export function rateOfFireCap(build: ShipBuild, ref: ShipReferenceData): number;
export function shipSaveDc(build: ShipBuild): number;       // 8 + WIS mod
```

- [ ] **Step 1: Write the failing test**

```ts
// apps/swdnd/src/lib/shipRules/weapons.test.ts
import { expect, test } from 'bun:test';
import { emptyShipBuild, type RefShipSize, type RefShipWeapon, type ShipReferenceData } from './types';
import { rateOfFireCap, shipSaveDc, shipWeaponProfiles } from './weapons';

const size = (key: RefShipSize['key']): RefShipSize => ({
  id: key, name: key, key, hullDie: 8, hullDiceStart: 5, shieldDie: 8, shieldDiceStart: 5,
  spaceSpeed: 300, turnSpeed: 200, hardpointMult: 1.5, modBaseCap: 30,
  modMaxSuitesBase: 3, modMaxSuitesMult: 1, description: '',
});
const weapon = (over: Partial<RefShipWeapon> & { id: string }): RefShipWeapon => ({
  name: over.id, category: 'primary', damageParts: [], rangeNormal: null, rangeLong: null,
  saveAbility: '', reload: null, usesAmmo: false, ammoTypes: [], weaponSize: null,
  attackBonus: 0, price: null, description: '', ...over,
});

const ref: ShipReferenceData = {
  sizes: { medium: size('medium'), small: size('small'), gargantuan: size('gargantuan'), large: size('large'), huge: size('huge'), tiny: size('tiny') },
  armor: {}, equipment: {}, modifications: {},
  weapons: {
    laser: weapon({ id: 'laser', name: 'Twin laser cannon', category: 'primary',
      damageParts: [['1d8 + @mod', 'energy']], rangeNormal: 600, rangeLong: 2400 }),
    ion: weapon({ id: 'ion', name: 'Ion battery', category: 'secondary', saveAbility: 'con',
      damageParts: [['4d6', 'ion']], attackBonus: 1 }),
    bomb: weapon({ id: 'bomb', name: 'Bomb deployer', category: 'quaternary',
      usesAmmo: true, reload: 4, ammoTypes: ['ssbomb'], damageParts: [['0d0 + @mod', '-']] }),
  },
};

function ship(opts: { size?: string; str?: number; wis?: number } = {}) {
  const b = emptyShipBuild('Ghost');
  b.identity.sizeId = opts.size ?? 'medium';
  b.abilities.base = { str: opts.str ?? 10, dex: 10, con: 10, int: 10, wis: opts.wis ?? 10, cha: 10 };
  return b;
}

test('a weapon profile carries the WIS attack part, the literal proficiency suffix and STR damage', () => {
  const b = ship({ wis: 16, str: 14 });                       // WIS +3, STR +2
  b.equipment = [{ id: 'w1', ref: 'laser', kind: 'weapon', mount: 'turret' }];
  const [p] = shipWeaponProfiles(b, ref);
  expect(p).toMatchObject({
    entryId: 'w1', refId: 'laser', name: 'Twin laser cannon', category: 'primary', mount: 'turret',
    attackShipMod: 3, attackText: '+3 + your proficiency',
    damageFormula: '1d8 + 2', damageType: 'energy',
    rangeNormal: 600, rangeLong: 2400, saveDc: null, usesAmmo: false, reload: null,
  });
});

test('the weapon reference attackBonus folds into the ship part', () => {
  const b = ship({ wis: 16 });
  b.equipment = [{ id: 'w1', ref: 'ion', kind: 'weapon' }];
  const [p] = shipWeaponProfiles(b, ref);
  expect(p.attackShipMod).toBe(4);                            // WIS +3 + weapon +1
  expect(p.attackText).toBe('+4 + your proficiency');
});

test('save-based weapons get 8 + WIS mod; attack-based weapons get null', () => {
  const b = ship({ wis: 18 });                                // +4 -> DC 12
  b.equipment = [
    { id: 'w1', ref: 'ion', kind: 'weapon' },
    { id: 'w2', ref: 'laser', kind: 'weapon' },
  ];
  const [ion, laser] = shipWeaponProfiles(b, ref);
  expect(ion).toMatchObject({ saveAbility: 'con', saveDc: 12 });
  expect(laser.saveDc).toBeNull();
  expect(shipSaveDc(b)).toBe(12);
});

test('a negative attack part still renders a signed suffix', () => {
  const b = ship({ wis: 6 });                                 // -2
  b.equipment = [{ id: 'w1', ref: 'laser', kind: 'weapon' }];
  expect(shipWeaponProfiles(b, ref)[0].attackText).toBe('-2 + your proficiency');
});

test('ammo and reload flow through; the default mount is fixed-forward', () => {
  const b = ship();
  b.equipment = [{ id: 'w1', ref: 'bomb', kind: 'weapon' }];
  expect(shipWeaponProfiles(b, ref)[0]).toMatchObject({ mount: 'fixed-forward', usesAmmo: true, reload: 4 });
});

test('non-weapon entries and unknown refs are skipped', () => {
  const b = ship();
  b.equipment = [
    { id: 'a1', ref: 'deflect', kind: 'armor' },
    { id: 'w9', ref: 'ghost-gun', kind: 'weapon' },
    { id: 'w1', ref: 'laser', kind: 'weapon' },
  ];
  expect(shipWeaponProfiles(b, ref).map((p) => p.entryId)).toEqual(['w1']);
});

test('rate-of-fire cap is max(Str mod, 1) x the size multiplier, rounded up', () => {
  expect(rateOfFireCap(ship({ str: 10, size: 'medium' }), ref)).toBe(2);   // max(0,1)=1 * 1.5 -> 2
  expect(rateOfFireCap(ship({ str: 18, size: 'medium' }), ref)).toBe(6);   // 4 * 1.5
  expect(rateOfFireCap(ship({ str: 18, size: 'small' }), ref)).toBe(4);    // 4 * 1
  expect(rateOfFireCap(ship({ str: 18, size: 'large' }), ref)).toBe(10);   // 4 * 2.5
  expect(rateOfFireCap(ship({ str: 18, size: 'huge' }), ref)).toBe(8);     // 4 * 2
  expect(rateOfFireCap(ship({ str: 15, size: 'gargantuan' }), ref)).toBe(6); // 2 * 3
  expect(rateOfFireCap(ship({ str: 4, size: 'tiny' }), ref)).toBe(1);      // floor at 1
});
```

- [ ] **Step 2: Run it and confirm the failure**

Run: `bun test apps/swdnd/src/lib/shipRules/weapons.test.ts` — FAIL: `error: Cannot find module './weapons'`.

- [ ] **Step 3: Implement**

```ts
// apps/swdnd/src/lib/shipRules/weapons.ts
import { substituteMod } from '../rules/weaponAttacks';
import { ROF_SIZE_MULTIPLIER } from './constants';
import { shipAbilityModifier, totalShipAbilityScores } from './core';
import type { ShipBuild, ShipReferenceData, ShipWeaponProfile, WeaponMount } from './types';

export const DEFAULT_MOUNT: WeaponMount = 'fixed-forward';

const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

/** The ship's contribution to a weapon save DC: 8 + WIS mod. */
export function shipSaveDc(build: ShipBuild): number {
  return 8 + shipAbilityModifier(totalShipAbilityScores(build).wis);
}

/**
 * One profile per installed weapon.
 *
 * SPINE LIMITATION (by design): the attack bonus is the SHIP's part only —
 * WIS mod plus the weapon's own bonus. The gunner's proficiency is a crew stat,
 * so `attackText` carries the literal "+ your proficiency" suffix until the
 * crew layer (sub-project 2) upgrades the engine to take crew inputs.
 */
export function shipWeaponProfiles(build: ShipBuild, ref: ShipReferenceData): ShipWeaponProfile[] {
  const scores = totalShipAbilityScores(build);
  const wisMod = shipAbilityModifier(scores.wis);
  const strMod = shipAbilityModifier(scores.str);
  const saveDc = 8 + wisMod;

  const out: ShipWeaponProfile[] = [];
  for (const entry of build.equipment) {
    if (entry.kind !== 'weapon') continue;
    const w = ref.weapons[entry.ref];
    if (!w) continue;
    const attackShipMod = wisMod + w.attackBonus;
    const [formula, type] = w.damageParts[0] ?? ['', ''];
    out.push({
      entryId: entry.id,
      refId: w.id,
      name: w.name,
      category: w.category,
      mount: entry.mount ?? DEFAULT_MOUNT,
      attackShipMod,
      attackText: `${signed(attackShipMod)} + your proficiency`,
      damageFormula: substituteMod(formula, strMod),
      damageType: type,
      rangeNormal: w.rangeNormal,
      rangeLong: w.rangeLong,
      saveAbility: w.saveAbility,
      saveDc: w.saveAbility ? saveDc : null,
      reload: w.reload,
      usesAmmo: w.usesAmmo,
    });
  }
  return out;
}

/**
 * How many weapons the ship may fire in a round: the Strength modifier
 * (minimum 1) times the size multiplier, rounded up. Display-only in the spine.
 */
export function rateOfFireCap(build: ShipBuild, ref: ShipReferenceData): number {
  const size = ref.sizes[build.identity.sizeId];
  const strMod = shipAbilityModifier(totalShipAbilityScores(build).str);
  const mult = size ? ROF_SIZE_MULTIPLIER[size.key] : 1;
  return Math.max(1, Math.ceil(Math.max(1, strMod) * mult));
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test apps/swdnd/src/lib/shipRules/weapons.test.ts` → `7 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/shipRules/weapons.ts apps/swdnd/src/lib/shipRules/weapons.test.ts
git commit -m "feat(swdnd): ship weapon profiles and rate-of-fire cap"
```

---

### Task 17: `shipRules/index.ts` — `computeShip` and overrides

**Files:**
- Create: `apps/swdnd/src/lib/shipRules/index.ts`
- Create: `apps/swdnd/src/lib/shipRules/index.test.ts`

**Interfaces:**

Consumes: every sub-module produced by Tasks 13–16, plus `SHIP_ABILITIES`, `hardpointBudget`, `modSlotBudget`, `suiteBudget` (Task 9).

Produces:
```ts
// apps/swdnd/src/lib/shipRules/index.ts
export * from './types';
export const OVERRIDABLE_SHIP: readonly ['maxHull', 'maxShields', 'armorClass', 'speed', 'turnSpeed'];
export function computeShip(build: ShipBuild, ref: ShipReferenceData): DerivedShip;
```

- [ ] **Step 1: Write the failing test**

```ts
// apps/swdnd/src/lib/shipRules/index.test.ts
import { expect, test } from 'bun:test';
import { emptyShipBuild, type RefShipArmor, type RefShipModification, type RefShipSize, type RefShipWeapon, type ShipReferenceData } from './types';
import { OVERRIDABLE_SHIP, computeShip } from './index';

const medium: RefShipSize = {
  id: 'med', name: 'Medium Starship', key: 'medium',
  hullDie: 8, hullDiceStart: 5, shieldDie: 8, shieldDiceStart: 5,
  spaceSpeed: 300, turnSpeed: 200, hardpointMult: 1.5, modBaseCap: 30,
  modMaxSuitesBase: 3, modMaxSuitesMult: 1, description: '',
};
const armorRow = (over: Partial<RefShipArmor> & { id: string }): RefShipArmor => ({
  name: over.id, kind: 'armor', baseAc: 10, dexCap: null, damageReduction: 0,
  capacityCoefficient: null, regenCoefficient: null, price: null, description: '', ...over,
});
const weaponRow = (over: Partial<RefShipWeapon> & { id: string }): RefShipWeapon => ({
  name: over.id, category: 'primary', damageParts: [], rangeNormal: null, rangeLong: null,
  saveAbility: '', reload: null, usesAmmo: false, ammoTypes: [], weaponSize: null,
  attackBonus: 0, price: null, description: '', ...over,
});
const modRow = (id: string, system: string): RefShipModification => ({
  id, name: id, system, grade: 0, prerequisite: null, freeSlot: false, freeSuite: false,
  baseCost: null, description: '',
});

const ref: ShipReferenceData = {
  sizes: { med: medium },
  armor: {
    deflect: armorRow({ id: 'deflect', dexCap: 2, damageReduction: 3 }),
    directional: armorRow({ id: 'directional', kind: 'shield', baseAc: 0, capacityCoefficient: 1, regenCoefficient: 1 }),
  },
  equipment: {},
  weapons: { laser: weaponRow({ id: 'laser', name: 'Twin laser cannon', damageParts: [['1d8 + @mod', 'energy']] }) },
  modifications: { scrambler: modRow('scrambler', 'Engineering'), lounge: modRow('lounge', 'Suite') },
};

function ghost() {
  const b = emptyShipBuild('Ghost');
  b.identity = { name: 'Ghost', sizeId: 'med', tier: 2 };
  b.abilities.base = { str: 14, dex: 16, con: 14, int: 10, wis: 16, cha: 8 };
  b.equipment = [
    { id: 'a1', ref: 'deflect', kind: 'armor' },
    { id: 's1', ref: 'directional', kind: 'shield' },
    { id: 'w1', ref: 'laser', kind: 'weapon', mount: 'turret' },
    { id: 'w2', ref: 'laser', kind: 'weapon', mount: 'fixed-forward' },
  ];
  b.modifications = ['scrambler', 'lounge'];
  return b;
}

test('computeShip assembles the whole derived ship (Medium, tier 2)', () => {
  const d = computeShip(ghost(), ref);
  expect(d.tier).toBe(2);
  expect(d.abilities.dex).toEqual({ score: 16, mod: 3 });
  expect(d.armorClass).toBe(13);              // 10 + min(3, 2) + tier2 (+1)
  expect(d.damageReduction).toBe(3);
  expect(d.hullDice).toEqual({ die: 8, count: 7 });
  expect(d.maxHull).toBe(54);                 // diceTotal(8,7)=38 + con +2 * 7
  expect(d.shieldDice).toEqual({ die: 8, count: 7 });
  expect(d.maxShields).toBe(52);              // 38 + str +2 * 7, x1
  expect(d.shieldRegen).toBe(8);
  expect(d.speed).toBe(300);
  expect(d.turnSpeed).toBe(200);
  expect(d.rateOfFireCap).toBe(3);            // max(2,1) * 1.5 -> 3
  expect(d.weapons).toHaveLength(2);
  expect(d.weapons[0].attackText).toBe('+3 + your proficiency');
  expect(d.weapons[0].damageFormula).toBe('1d8 + 2');
});

test('budgets report usage against capacity', () => {
  const d = computeShip(ghost(), ref);
  expect(d.hardpointsUsed).toBe(2);
  expect(d.hardpointsMax).toBe(5);            // ceil(1.5 * 3)
  expect(d.modSlotsUsed).toBe(1);             // 'scrambler' — Suite mods do not consume a slot
  expect(d.modSlotsMax).toBe(3);              // tier 2 -> 3
  expect(d.suitesUsed).toBe(1);               // 'lounge'
  expect(d.suitesMax).toBe(5);                // 3 + 1*2
});

test('overrides replace exactly the five overridable scalars', () => {
  expect(OVERRIDABLE_SHIP).toEqual(['maxHull', 'maxShields', 'armorClass', 'speed', 'turnSpeed']);
  const b = ghost();
  b.overrides = { maxHull: 200, maxShields: 90, armorClass: 19, speed: 400, turnSpeed: 45 };
  const d = computeShip(b, ref);
  expect(d.maxHull).toBe(200);
  expect(d.maxShields).toBe(90);
  expect(d.armorClass).toBe(19);
  expect(d.speed).toBe(400);
  expect(d.turnSpeed).toBe(45);
  expect(d.shieldRegen).toBe(8);              // not overridable — untouched
  expect(d.damageReduction).toBe(3);
});

test('a brand new build computes cleanly with no size chosen', () => {
  const d = computeShip(emptyShipBuild('New'), ref);
  expect(d).toMatchObject({
    tier: 0, armorClass: 10, damageReduction: 0, maxHull: 0, maxShields: 0,
    shieldRegen: 0, speed: 0, turnSpeed: 0, hardpointsUsed: 0, hardpointsMax: 0,
    modSlotsUsed: 0, modSlotsMax: 1, suitesUsed: 0, suitesMax: 0,
  });
  expect(d.weapons).toEqual([]);
});
```

- [ ] **Step 2: Run it and confirm the failure**

Run: `bun test apps/swdnd/src/lib/shipRules/index.test.ts` — FAIL: `error: Cannot find module './index'`.

- [ ] **Step 3: Implement**

```ts
// apps/swdnd/src/lib/shipRules/index.ts
import { SHIP_ABILITIES, hardpointBudget, modSlotBudget, suiteBudget } from './constants';
import { shipAbilityModifier, shipTier, totalShipAbilityScores } from './core';
import {
  maxHull, maxShields, shieldRegen, shipArmorClass, shipDamageReduction, shipHullDice, shipShieldDice,
} from './defense';
import { shipSpeed, shipTurnSpeed } from './movement';
import { rateOfFireCap, shipWeaponProfiles } from './weapons';
import type { DerivedShip, ShipAbilityBlock, ShipAbilityKey, ShipBuild, ShipReferenceData } from './types';

export * from './types';

/** Overridable scalar fields. If `build.overrides[field]` is a number, it wins. */
export const OVERRIDABLE_SHIP = ['maxHull', 'maxShields', 'armorClass', 'speed', 'turnSpeed'] as const;
type OverridableShip = (typeof OVERRIDABLE_SHIP)[number];

function applyOverride(build: ShipBuild, field: OverridableShip, computed: number): number {
  const o = build.overrides[field];
  return typeof o === 'number' ? o : computed;
}

/**
 * The whole derived ship. Pure, synchronous, frontend-only, and SHIP-ONLY:
 * no crew inputs (see shipRules/weapons.ts for the deferred proficiency).
 */
export function computeShip(build: ShipBuild, ref: ShipReferenceData): DerivedShip {
  const scores = totalShipAbilityScores(build);
  const tier = shipTier(build);
  const size = ref.sizes[build.identity.sizeId];

  const abilities = {} as Record<ShipAbilityKey, ShipAbilityBlock>;
  for (const key of SHIP_ABILITIES) {
    abilities[key] = { score: scores[key], mod: shipAbilityModifier(scores[key]) };
  }

  // Suite modifications consume a suite; every other system consumes a slot.
  const mods = build.modifications.map((id) => ref.modifications[id]).filter(Boolean);
  const suitesUsed = mods.filter((m) => m.system === 'Suite' && !m.freeSuite).length;
  const modSlotsUsed = mods.filter((m) => m.system !== 'Suite' && !m.freeSlot).length;

  return {
    tier,
    abilities,
    armorClass: applyOverride(build, 'armorClass', shipArmorClass(build, ref)),
    damageReduction: shipDamageReduction(build, ref),
    maxHull: applyOverride(build, 'maxHull', maxHull(build, ref)),
    hullDice: shipHullDice(build, ref),
    maxShields: applyOverride(build, 'maxShields', maxShields(build, ref)),
    shieldDice: shipShieldDice(build, ref),
    shieldRegen: shieldRegen(build, ref),
    speed: applyOverride(build, 'speed', shipSpeed(build, ref)),
    turnSpeed: applyOverride(build, 'turnSpeed', shipTurnSpeed(build, ref)),
    weapons: shipWeaponProfiles(build, ref),
    rateOfFireCap: rateOfFireCap(build, ref),
    hardpointsUsed: build.equipment.filter((e) => e.kind === 'weapon').length,
    hardpointsMax: size ? hardpointBudget(size, tier) : 0,
    modSlotsUsed,
    modSlotsMax: modSlotBudget(tier),
    suitesUsed,
    suitesMax: size ? suiteBudget(size, tier) : 0,
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test apps/swdnd/src/lib/shipRules/index.test.ts` → `4 pass, 0 fail`.

- [ ] **Step 5: Typecheck and run the full suite**

Run: `cd apps/swdnd && bun run build` → succeeds.
Run: `bun test` → `403 pass, 0 fail`.

- [ ] **Step 6: Commit**

```bash
git add apps/swdnd/src/lib/shipRules/index.ts apps/swdnd/src/lib/shipRules/index.test.ts
git commit -m "feat(swdnd): computeShip assembles the derived starship"
```

---

### Task 18: `lib/shipBuildState.ts` — the build reducer

**Files:**
- Create: `apps/swdnd/src/lib/shipBuildState.ts`
- Create: `apps/swdnd/src/lib/shipBuildState.test.ts`

**Interfaces:**

Consumes: `computeShip` (Task 17); `maxHull`, `maxShields` (Task 14); `MAX_SHIP_TIER` (Task 9); `ShipBuild`, `DerivedShip`, `ShipReferenceData`, `ShipAbilityKey`, `ShipEquipmentKind`, `WeaponMount` (Task 8).

Produces:
```ts
// apps/swdnd/src/lib/shipBuildState.ts
export type ShipBuildAction =
  | { t: 'setName'; name: string }
  | { t: 'setSize'; sizeId: string }
  | { t: 'setTier'; tier: number }
  | { t: 'setBaseAbilities'; base: Record<ShipAbilityKey, number> }
  | { t: 'allocateTierPoint'; tier: number; ability: ShipAbilityKey; delta: 1 | -1 }
  | { t: 'installEquipment'; ref: string; kind: ShipEquipmentKind; mount?: WeaponMount; id?: string }
  | { t: 'removeEquipment'; id: string }
  | { t: 'setMount'; id: string; mount: WeaponMount }
  | { t: 'toggleModification'; ref: string }
  | { t: 'toggleHouseRule'; step: string };

export function applyShipBuildAction(
  build: ShipBuild, ref: ShipReferenceData, derived: DerivedShip, action: ShipBuildAction,
): ShipBuild;
```

- [ ] **Step 1: Write the failing test**

```ts
// apps/swdnd/src/lib/shipBuildState.test.ts
import { expect, test } from 'bun:test';
import { computeShip } from './shipRules';
import { emptyShipBuild, type RefShipArmor, type RefShipModification, type RefShipSize, type RefShipWeapon, type ShipReferenceData } from './shipRules/types';
import { applyShipBuildAction, type ShipBuildAction } from './shipBuildState';

const medium: RefShipSize = {
  id: 'med', name: 'Medium Starship', key: 'medium',
  hullDie: 8, hullDiceStart: 5, shieldDie: 8, shieldDiceStart: 5,
  spaceSpeed: 300, turnSpeed: 200, hardpointMult: 1.5, modBaseCap: 30,
  modMaxSuitesBase: 3, modMaxSuitesMult: 1, description: '',
};
const small: RefShipSize = { ...medium, id: 'sm', name: 'Small Starship', key: 'small', hullDie: 6, hullDiceStart: 3, shieldDie: 6, shieldDiceStart: 3, hardpointMult: 1, modMaxSuitesBase: -1 };
const armorRow = (over: Partial<RefShipArmor> & { id: string }): RefShipArmor => ({
  name: over.id, kind: 'armor', baseAc: 10, dexCap: null, damageReduction: 0,
  capacityCoefficient: null, regenCoefficient: null, price: null, description: '', ...over,
});
const weaponRow = (id: string): RefShipWeapon => ({
  id, name: id, category: 'primary', damageParts: [['1d8 + @mod', 'energy']],
  rangeNormal: null, rangeLong: null, saveAbility: '', reload: null, usesAmmo: false,
  ammoTypes: [], weaponSize: null, attackBonus: 0, price: null, description: '',
});
const modRow = (id: string, system: string): RefShipModification => ({
  id, name: id, system, grade: 0, prerequisite: null, freeSlot: false, freeSuite: false, baseCost: null, description: '',
});

const ref: ShipReferenceData = {
  sizes: { med: medium, sm: small },
  armor: {
    deflect: armorRow({ id: 'deflect', dexCap: 2, damageReduction: 3 }),
    reinf: armorRow({ id: 'reinf', dexCap: 0, damageReduction: 6 }),
    directional: armorRow({ id: 'directional', kind: 'shield', baseAc: 0, capacityCoefficient: 1, regenCoefficient: 1 }),
    fortress: armorRow({ id: 'fortress', kind: 'shield', baseAc: 0, capacityCoefficient: 1.5, regenCoefficient: 0.667 }),
  },
  equipment: {},
  weapons: { laser: weaponRow('laser'), ion: weaponRow('ion') },
  modifications: { scrambler: modRow('scrambler', 'Engineering'), lounge: modRow('lounge', 'Suite') },
};

const dispatch = (b = base(), ...actions: ShipBuildAction[]) =>
  actions.reduce((acc, a) => applyShipBuildAction(acc, ref, computeShip(acc, ref), a), b);

function base() {
  const b = emptyShipBuild('Ghost');
  b.identity.sizeId = 'med';
  b.abilities.base = { str: 14, dex: 16, con: 14, int: 10, wis: 16, cha: 8 };
  return b;
}

test('the reducer never mutates its input', () => {
  const b = base();
  const next = dispatch(b, { t: 'setName', name: 'Ghost II' });
  expect(b.identity.name).toBe('Ghost');
  expect(next.identity.name).toBe('Ghost II');
  expect(next.equipment).not.toBe(b.equipment);
  expect(next.play.conditions).not.toBe(b.play.conditions);
});

test('setTier clamps to 0..5 and setSize replaces the chassis', () => {
  expect(dispatch(base(), { t: 'setTier', tier: 9 }).identity.tier).toBe(5);
  expect(dispatch(base(), { t: 'setTier', tier: -3 }).identity.tier).toBe(0);
  expect(dispatch(base(), { t: 'setSize', sizeId: 'sm' }).identity.sizeId).toBe('sm');
});

test('changing size or tier shifts current hull/shields by the max delta, clamped', () => {
  let b = dispatch(base(), { t: 'installEquipment', ref: 'directional', kind: 'shield', id: 's1' });
  b.play.hull = computeShip(b, ref).maxHull;
  b.play.shields = computeShip(b, ref).maxShields;
  const before = computeShip(b, ref);
  const after = dispatch(b, { t: 'setTier', tier: 2 });
  const grown = computeShip(after, ref);
  expect(grown.maxHull).toBeGreaterThan(before.maxHull);
  expect(after.play.hull).toBe(grown.maxHull);       // a full ship stays full
  expect(after.play.shields).toBe(grown.maxShields);
  // shrinking clamps rather than going negative
  const shrunk = dispatch(after, { t: 'setSize', sizeId: 'sm' });
  expect(shrunk.play.hull).toBeLessThanOrEqual(computeShip(shrunk, ref).maxHull);
  expect(shrunk.play.hull).toBeGreaterThanOrEqual(0);
});

test('single-slot kinds replace; weapons append with distinct ids and mounts', () => {
  const b = dispatch(base(),
    { t: 'installEquipment', ref: 'deflect', kind: 'armor', id: 'a1' },
    { t: 'installEquipment', ref: 'reinf', kind: 'armor', id: 'a2' },
    { t: 'installEquipment', ref: 'directional', kind: 'shield', id: 's1' },
    { t: 'installEquipment', ref: 'fortress', kind: 'shield', id: 's2' },
    { t: 'installEquipment', ref: 'laser', kind: 'weapon', mount: 'turret', id: 'w1' },
    { t: 'installEquipment', ref: 'laser', kind: 'weapon', id: 'w2' },
  );
  expect(b.equipment.filter((e) => e.kind === 'armor')).toEqual([{ id: 'a2', ref: 'reinf', kind: 'armor' }]);
  expect(b.equipment.filter((e) => e.kind === 'shield')).toEqual([{ id: 's2', ref: 'fortress', kind: 'shield' }]);
  expect(b.equipment.filter((e) => e.kind === 'weapon').map((e) => e.id)).toEqual(['w1', 'w2']);
  expect(b.equipment.find((e) => e.id === 'w1')?.mount).toBe('turret');
});

test('removeEquipment drops the entry by id and forgets its ammo counter', () => {
  let b = dispatch(base(), { t: 'installEquipment', ref: 'laser', kind: 'weapon', id: 'w1' });
  b = { ...b, play: { ...b.play, ammoSpent: { w1: 3 } } };
  const next = dispatch(b, { t: 'removeEquipment', id: 'w1' });
  expect(next.equipment).toEqual([]);
  expect(next.play.ammoSpent).toEqual({});
});

test('setMount retargets a weapon and ignores unknown ids', () => {
  const b = dispatch(base(),
    { t: 'installEquipment', ref: 'laser', kind: 'weapon', id: 'w1' },
    { t: 'setMount', id: 'w1', mount: 'fixed-port' },
    { t: 'setMount', id: 'nope', mount: 'turret' },
  );
  expect(b.equipment[0].mount).toBe('fixed-port');
});

test('installEquipment mints an id when the caller does not supply one', () => {
  const b = dispatch(base(), { t: 'installEquipment', ref: 'laser', kind: 'weapon' });
  expect(b.equipment[0].id).toMatch(/[0-9a-f-]{8,}/);
});

test('toggleModification adds then removes; unknown refs are ignored', () => {
  const on = dispatch(base(), { t: 'toggleModification', ref: 'scrambler' });
  expect(on.modifications).toEqual(['scrambler']);
  expect(dispatch(on, { t: 'toggleModification', ref: 'scrambler' }).modifications).toEqual([]);
  expect(dispatch(base(), { t: 'toggleModification', ref: 'ghost-mod' }).modifications).toEqual([]);
});

test('allocateTierPoint records and removes tier ability increases, capped at 2 per tier', () => {
  let b = dispatch(base(), { t: 'setTier', tier: 2 });
  b = dispatch(b,
    { t: 'allocateTierPoint', tier: 2, ability: 'str', delta: 1 },
    { t: 'allocateTierPoint', tier: 2, ability: 'wis', delta: 1 },
    { t: 'allocateTierPoint', tier: 2, ability: 'dex', delta: 1 },   // budget spent -> ignored
  );
  expect(b.abilities.increases).toEqual([
    { source: 'tier', ref: 't2', ability: 'str', amount: 1 },
    { source: 'tier', ref: 't2', ability: 'wis', amount: 1 },
  ]);
  const back = dispatch(b, { t: 'allocateTierPoint', tier: 2, ability: 'str', delta: -1 });
  expect(back.abilities.increases).toEqual([{ source: 'tier', ref: 't2', ability: 'wis', amount: 1 }]);
});

test('lowering the tier strips increases granted above the new tier', () => {
  let b = dispatch(base(), { t: 'setTier', tier: 3 });
  b = dispatch(b,
    { t: 'allocateTierPoint', tier: 2, ability: 'str', delta: 1 },
    { t: 'allocateTierPoint', tier: 3, ability: 'con', delta: 1 },
  );
  const lowered = dispatch(b, { t: 'setTier', tier: 2 });
  expect(lowered.abilities.increases).toEqual([{ source: 'tier', ref: 't2', ability: 'str', amount: 1 }]);
});

test('toggleHouseRule is additive and reversible', () => {
  const on = dispatch(base(), { t: 'toggleHouseRule', step: 'weapons' });
  expect(on.houseRuled).toEqual(['weapons']);
  expect(dispatch(on, { t: 'toggleHouseRule', step: 'weapons' }).houseRuled).toEqual([]);
});
```

- [ ] **Step 2: Run it and confirm the failure**

Run: `bun test apps/swdnd/src/lib/shipBuildState.test.ts` — FAIL: `error: Cannot find module './shipBuildState'`.

- [ ] **Step 3: Implement**

```ts
// apps/swdnd/src/lib/shipBuildState.ts
import { MAX_SHIP_TIER } from './shipRules/constants';
import { maxHull, maxShields } from './shipRules/defense';
import type {
  DerivedShip, ShipAbilityKey, ShipBuild, ShipEquipmentKind, ShipReferenceData, WeaponMount,
} from './shipRules/types';

export type ShipBuildAction =
  | { t: 'setName'; name: string }
  | { t: 'setSize'; sizeId: string }
  | { t: 'setTier'; tier: number }
  | { t: 'setBaseAbilities'; base: Record<ShipAbilityKey, number> }
  | { t: 'allocateTierPoint'; tier: number; ability: ShipAbilityKey; delta: 1 | -1 }
  | { t: 'installEquipment'; ref: string; kind: ShipEquipmentKind; mount?: WeaponMount; id?: string }
  | { t: 'removeEquipment'; id: string }
  | { t: 'setMount'; id: string; mount: WeaponMount }
  | { t: 'toggleModification'; ref: string }
  | { t: 'toggleHouseRule'; step: string };

/** A ship carries at most one of each of these; installing replaces. */
const SINGLE_SLOT: ShipEquipmentKind[] = ['armor', 'shield', 'reactor', 'coupling', 'hyperdrive'];
/** SOTG grants two ability points at each tier. */
const TIER_POINT_BUDGET = 2;

const clone = (b: ShipBuild): ShipBuild => ({
  ...b,
  identity: { ...b.identity },
  abilities: { base: { ...b.abilities.base }, increases: [...b.abilities.increases] },
  equipment: b.equipment.map((e) => ({ ...e })),
  modifications: [...b.modifications],
  play: { ...b.play, conditions: [...b.play.conditions], ammoSpent: { ...b.play.ammoSpent } },
  overrides: { ...b.overrides },
  houseRuled: [...(b.houseRuled ?? [])],
});

/**
 * Shift current hull/shields by their max delta since `before`, clamped to the
 * new maxima — the same rule characters use for maxHp changes, so a full ship
 * stays full when it gains a tier and never goes negative when it shrinks.
 */
function applyPoolDeltas(b: ShipBuild, ref: ShipReferenceData, beforeHull: number, beforeShields: number): void {
  const hullMax = maxHull(b, ref);
  const shieldMax = maxShields(b, ref);
  b.play.hull = Math.max(0, Math.min(hullMax, b.play.hull + (hullMax - beforeHull)));
  b.play.shields = Math.max(0, Math.min(shieldMax, b.play.shields + (shieldMax - beforeShields)));
}

export function applyShipBuildAction(
  build: ShipBuild,
  ref: ShipReferenceData,
  derived: DerivedShip,
  action: ShipBuildAction,
): ShipBuild {
  const b = clone(build);

  switch (action.t) {
    case 'setName':
      b.identity.name = action.name;
      break;

    case 'setSize': {
      const beforeHull = maxHull(build, ref);
      const beforeShields = maxShields(build, ref);
      b.identity.sizeId = action.sizeId;
      applyPoolDeltas(b, ref, beforeHull, beforeShields);
      break;
    }

    case 'setTier': {
      const beforeHull = maxHull(build, ref);
      const beforeShields = maxShields(build, ref);
      const tier = Math.max(0, Math.min(MAX_SHIP_TIER, Math.floor(action.tier)));
      b.identity.tier = tier;
      // Points granted by tiers the ship no longer has go away with them.
      b.abilities.increases = b.abilities.increases.filter((i) => Number(i.ref.slice(1)) <= tier);
      applyPoolDeltas(b, ref, beforeHull, beforeShields);
      break;
    }

    case 'setBaseAbilities': {
      const beforeHull = maxHull(build, ref);
      const beforeShields = maxShields(build, ref);
      b.abilities.base = { ...action.base };
      applyPoolDeltas(b, ref, beforeHull, beforeShields);
      break;
    }

    case 'allocateTierPoint': {
      const tierRef = `t${action.tier}`;
      if (action.tier > b.identity.tier || action.tier < 1) break;
      if (action.delta === -1) {
        const idx = b.abilities.increases.findIndex((i) => i.ref === tierRef && i.ability === action.ability);
        if (idx >= 0) b.abilities.increases.splice(idx, 1);
        break;
      }
      const spent = b.abilities.increases.filter((i) => i.ref === tierRef).reduce((s, i) => s + i.amount, 0);
      if (spent >= TIER_POINT_BUDGET) break;
      const beforeHull = maxHull(build, ref);
      const beforeShields = maxShields(build, ref);
      b.abilities.increases.push({ source: 'tier', ref: tierRef, ability: action.ability, amount: 1 });
      applyPoolDeltas(b, ref, beforeHull, beforeShields);
      break;
    }

    case 'installEquipment': {
      const beforeHull = maxHull(build, ref);
      const beforeShields = maxShields(build, ref);
      if (SINGLE_SLOT.includes(action.kind)) {
        b.equipment = b.equipment.filter((e) => e.kind !== action.kind);
      }
      const entry = { id: action.id ?? crypto.randomUUID(), ref: action.ref, kind: action.kind };
      b.equipment.push(action.mount ? { ...entry, mount: action.mount } : entry);
      applyPoolDeltas(b, ref, beforeHull, beforeShields);
      break;
    }

    case 'removeEquipment': {
      const beforeHull = maxHull(build, ref);
      const beforeShields = maxShields(build, ref);
      b.equipment = b.equipment.filter((e) => e.id !== action.id);
      delete b.play.ammoSpent[action.id]; // the counter is keyed by entry id
      applyPoolDeltas(b, ref, beforeHull, beforeShields);
      break;
    }

    case 'setMount': {
      const entry = b.equipment.find((e) => e.id === action.id);
      if (entry) entry.mount = action.mount;
      break;
    }

    case 'toggleModification': {
      const idx = b.modifications.indexOf(action.ref);
      if (idx >= 0) { b.modifications.splice(idx, 1); break; } // removal always allowed
      if (!ref.modifications[action.ref]) break;
      b.modifications.push(action.ref);
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

  // `derived` is part of the signature for symmetry with applyBuildAction (and
  // for future budget-blocking rules); the spine's validation warns rather than
  // blocks, so no action consults it yet.
  void derived;
  return b;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test apps/swdnd/src/lib/shipBuildState.test.ts` → `11 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/shipBuildState.ts apps/swdnd/src/lib/shipBuildState.test.ts
git commit -m "feat(swdnd): ship build reducer"
```

---

### Task 19: `lib/shipPlayState.ts` — the play reducer

**Files:**
- Create: `apps/swdnd/src/lib/shipPlayState.ts`
- Create: `apps/swdnd/src/lib/shipPlayState.test.ts`

**Interfaces:**

Consumes: `MAX_SYSTEM_DAMAGE` (Task 9); `ShipBuild`, `DerivedShip`, `ShipPlayState` (Task 8).

Produces:
```ts
// apps/swdnd/src/lib/shipPlayState.ts
export type ShipPlayAction =
  | { t: 'damage'; n: number }
  | { t: 'repairHull'; n: number }
  | { t: 'restoreShields'; n: number }
  | { t: 'setHull'; n: number }
  | { t: 'setShields'; n: number }
  | { t: 'spendHullDie' } | { t: 'regainHullDie' }
  | { t: 'spendShieldDie' } | { t: 'regainShieldDie' }
  | { t: 'spendAmmo'; entryId: string; n: number }
  | { t: 'reloadAmmo'; entryId: string }
  | { t: 'addCondition'; c: string }
  | { t: 'removeCondition'; c: string }
  | { t: 'setSystemDamage'; n: number }
  | { t: 'setNotes'; notes: string };

export function applyShipPlayAction(
  build: ShipBuild, derived: DerivedShip, action: ShipPlayAction,
): ShipPlayState;
```

- [ ] **Step 1: Write the failing test**

```ts
// apps/swdnd/src/lib/shipPlayState.test.ts
import { expect, test } from 'bun:test';
import { emptyShipBuild, type DerivedShip, type ShipBuild } from './shipRules/types';
import { applyShipPlayAction, type ShipPlayAction } from './shipPlayState';

const derived = {
  maxHull: 40, maxShields: 20, shieldRegen: 8,
  hullDice: { die: 8, count: 5 }, shieldDice: { die: 8, count: 5 },
} as unknown as DerivedShip;

function ship(over: Partial<ShipBuild['play']> = {}): ShipBuild {
  const b = emptyShipBuild('Ghost');
  b.play = { ...b.play, hull: 40, shields: 20, ...over };
  return b;
}
const run = (b: ShipBuild, ...actions: ShipPlayAction[]) =>
  actions.reduce((acc, a) => ({ ...b, play: applyShipPlayAction({ ...b, play: acc }, derived, a) }).play, b.play);

test('damage spills through shields into hull and never goes negative', () => {
  expect(run(ship(), { t: 'damage', n: 5 })).toMatchObject({ shields: 15, hull: 40 });
  expect(run(ship(), { t: 'damage', n: 25 })).toMatchObject({ shields: 0, hull: 35 });
  expect(run(ship(), { t: 'damage', n: 500 })).toMatchObject({ shields: 0, hull: 0 });
  expect(run(ship(), { t: 'damage', n: -3 })).toMatchObject({ shields: 20, hull: 40 });
});

test('repairs and restores clamp to their maxima', () => {
  const hurt = ship({ hull: 10, shields: 2 });
  expect(run(hurt, { t: 'repairHull', n: 7 }).hull).toBe(17);
  expect(run(hurt, { t: 'repairHull', n: 999 }).hull).toBe(40);
  expect(run(hurt, { t: 'restoreShields', n: 999 }).shields).toBe(20);
  expect(run(hurt, { t: 'restoreShields', n: -5 }).shields).toBe(2);
});

test('exact-entry setters clamp into range', () => {
  expect(run(ship(), { t: 'setHull', n: 17 }).hull).toBe(17);
  expect(run(ship(), { t: 'setHull', n: -4 }).hull).toBe(0);
  expect(run(ship(), { t: 'setHull', n: 900 }).hull).toBe(40);
  expect(run(ship(), { t: 'setShields', n: 900 }).shields).toBe(20);
});

test('hull and shield dice spend and regain within their pools', () => {
  const p = run(ship(), { t: 'spendHullDie' }, { t: 'spendHullDie' }, { t: 'spendShieldDie' });
  expect(p).toMatchObject({ hullDiceSpent: 2, shieldDiceSpent: 1 });
  expect(run(ship({ hullDiceSpent: 5 }), { t: 'spendHullDie' }).hullDiceSpent).toBe(5);   // capped
  expect(run(ship({ hullDiceSpent: 0 }), { t: 'regainHullDie' }).hullDiceSpent).toBe(0);  // floored
  expect(run(ship({ shieldDiceSpent: 3 }), { t: 'regainShieldDie' }).shieldDiceSpent).toBe(2);
});

test('ammo counters key off the equipment entry id and reload clears them', () => {
  const p = run(ship(), { t: 'spendAmmo', entryId: 'w1', n: 2 }, { t: 'spendAmmo', entryId: 'w1', n: 1 });
  expect(p.ammoSpent).toEqual({ w1: 3 });
  expect(run(ship({ ammoSpent: { w1: 4, w2: 1 } }), { t: 'reloadAmmo', entryId: 'w1' }).ammoSpent).toEqual({ w2: 1 });
  expect(run(ship({ ammoSpent: { w1: 1 } }), { t: 'spendAmmo', entryId: 'w1', n: -9 }).ammoSpent).toEqual({ w1: 0 });
});

test('conditions add once and remove cleanly; levelled conditions replace their own family', () => {
  const p = run(ship(), { t: 'addCondition', c: 'Ionized' }, { t: 'addCondition', c: 'Ionized' });
  expect(p.conditions).toEqual(['Ionized']);
  expect(run(ship({ conditions: ['Ionized', 'Stalled'] }), { t: 'removeCondition', c: 'Ionized' }).conditions)
    .toEqual(['Stalled']);
  // A ship is Slowed at exactly one level at a time.
  expect(run(ship({ conditions: ['Slowed 1'] }), { t: 'addCondition', c: 'Slowed 3' }).conditions)
    .toEqual(['Slowed 3']);
});

test('system damage is its own 0..6 field, not a condition string', () => {
  expect(run(ship(), { t: 'setSystemDamage', n: 3 }).systemDamage).toBe(3);
  expect(run(ship(), { t: 'setSystemDamage', n: 9 }).systemDamage).toBe(6);
  expect(run(ship(), { t: 'setSystemDamage', n: -2 }).systemDamage).toBe(0);
  expect(run(ship(), { t: 'setSystemDamage', n: 3 }).conditions).toEqual([]);
});

test('notes are stored verbatim and the reducer never mutates its input', () => {
  const b = ship();
  const next = applyShipPlayAction(b, derived, { t: 'setNotes', notes: 'venting plasma' });
  expect(next.notes).toBe('venting plasma');
  expect(b.play.notes).toBe('');
  expect(next.conditions).not.toBe(b.play.conditions);
});
```

- [ ] **Step 2: Run it and confirm the failure**

Run: `bun test apps/swdnd/src/lib/shipPlayState.test.ts` — FAIL: `error: Cannot find module './shipPlayState'`.

- [ ] **Step 3: Implement**

```ts
// apps/swdnd/src/lib/shipPlayState.ts
import { LEVELED_SHIP_CONDITIONS, MAX_SYSTEM_DAMAGE } from './shipRules/constants';
import type { DerivedShip, ShipBuild, ShipPlayState } from './shipRules/types';

export type ShipPlayAction =
  | { t: 'damage'; n: number }
  | { t: 'repairHull'; n: number }
  | { t: 'restoreShields'; n: number }
  | { t: 'setHull'; n: number }
  | { t: 'setShields'; n: number }
  | { t: 'spendHullDie' }
  | { t: 'regainHullDie' }
  | { t: 'spendShieldDie' }
  | { t: 'regainShieldDie' }
  | { t: 'spendAmmo'; entryId: string; n: number }
  | { t: 'reloadAmmo'; entryId: string }
  | { t: 'addCondition'; c: string }
  | { t: 'removeCondition'; c: string }
  | { t: 'setSystemDamage'; n: number }
  | { t: 'setNotes'; notes: string };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 'Slowed 3' -> 'Slowed'; a plain condition returns itself. */
function conditionFamily(c: string): string {
  const family = c.replace(/\s+\d+$/, '');
  return LEVELED_SHIP_CONDITIONS.includes(family) ? family : c;
}

export function applyShipPlayAction(
  build: ShipBuild,
  derived: DerivedShip,
  action: ShipPlayAction,
): ShipPlayState {
  const p: ShipPlayState = {
    ...build.play,
    conditions: [...build.play.conditions],
    ammoSpent: { ...build.play.ammoSpent },
  };

  switch (action.t) {
    case 'damage': {
      // SOTG: shields absorb first, the remainder carries into the hull.
      let n = Math.max(0, action.n);
      const absorbed = Math.min(p.shields, n);
      p.shields -= absorbed;
      n -= absorbed;
      p.hull = clamp(p.hull - n, 0, derived.maxHull);
      break;
    }
    case 'repairHull':
      p.hull = clamp(p.hull + Math.max(0, action.n), 0, derived.maxHull);
      break;
    case 'restoreShields':
      p.shields = clamp(p.shields + Math.max(0, action.n), 0, derived.maxShields);
      break;
    case 'setHull':
      p.hull = clamp(action.n, 0, derived.maxHull);
      break;
    case 'setShields':
      p.shields = clamp(action.n, 0, derived.maxShields);
      break;
    case 'spendHullDie':
      p.hullDiceSpent = clamp(p.hullDiceSpent + 1, 0, derived.hullDice.count);
      break;
    case 'regainHullDie':
      p.hullDiceSpent = clamp(p.hullDiceSpent - 1, 0, derived.hullDice.count);
      break;
    case 'spendShieldDie':
      p.shieldDiceSpent = clamp(p.shieldDiceSpent + 1, 0, derived.shieldDice.count);
      break;
    case 'regainShieldDie':
      p.shieldDiceSpent = clamp(p.shieldDiceSpent - 1, 0, derived.shieldDice.count);
      break;
    case 'spendAmmo':
      p.ammoSpent[action.entryId] = Math.max(0, (p.ammoSpent[action.entryId] ?? 0) + action.n);
      break;
    case 'reloadAmmo':
      delete p.ammoSpent[action.entryId];
      break;
    case 'addCondition': {
      // A levelled condition ('Slowed 1'…'Slowed 4') replaces its own family.
      const family = conditionFamily(action.c);
      p.conditions = p.conditions.filter((c) => conditionFamily(c) !== family);
      p.conditions.push(action.c);
      break;
    }
    case 'removeCondition':
      p.conditions = p.conditions.filter((c) => c !== action.c);
      break;
    case 'setSystemDamage':
      // Numeric 0-6 in its own field, never a condition string.
      p.systemDamage = clamp(Math.round(action.n), 0, MAX_SYSTEM_DAMAGE);
      break;
    case 'setNotes':
      p.notes = action.notes;
      break;
  }
  return p;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test apps/swdnd/src/lib/shipPlayState.test.ts` → `8 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/shipPlayState.ts apps/swdnd/src/lib/shipPlayState.test.ts
git commit -m "feat(swdnd): ship play-state reducer"
```

---

### Task 20: `lib/shipValidation.ts` — budget-based step status

**Files:**
- Create: `apps/swdnd/src/lib/shipValidation.ts`
- Create: `apps/swdnd/src/lib/shipValidation.test.ts`

**Interfaces:**

Consumes:
```ts
// ./validation  (existing — reuse the shape verbatim)
export type StepState = 'done' | 'attention' | 'untouched';
export interface StepInfo { state: StepState; summary: string; applicable: boolean }
// ./shipRules/constants
export const SHIP_ROLES, MAX_SHIP_TIER;
```

Produces:
```ts
// apps/swdnd/src/lib/shipValidation.ts
export type ShipStepKey = 'size' | 'tier' | 'hull' | 'weapons' | 'equipment' | 'modifications';
export const SHIP_STEP_ORDER: ShipStepKey[];
export function shipStepStatus(
  build: ShipBuild, ref: ShipReferenceData, derived: DerivedShip,
): Record<ShipStepKey, StepInfo>;
```

- [ ] **Step 1: Write the failing test**

```ts
// apps/swdnd/src/lib/shipValidation.test.ts
import { expect, test } from 'bun:test';
import { computeShip } from './shipRules';
import { emptyShipBuild, type RefShipArmor, type RefShipModification, type RefShipSize, type RefShipWeapon, type ShipReferenceData } from './shipRules/types';
import { SHIP_STEP_ORDER, shipStepStatus } from './shipValidation';

const small: RefShipSize = {
  id: 'sm', name: 'Small Starship', key: 'small',
  hullDie: 6, hullDiceStart: 3, shieldDie: 6, shieldDiceStart: 3,
  spaceSpeed: 300, turnSpeed: 250, hardpointMult: 1, modBaseCap: 20,
  modMaxSuitesBase: -1, modMaxSuitesMult: 1, description: '',
};
const armorRow = (over: Partial<RefShipArmor> & { id: string }): RefShipArmor => ({
  name: over.id, kind: 'armor', baseAc: 10, dexCap: null, damageReduction: 0,
  capacityCoefficient: null, regenCoefficient: null, price: null, description: '', ...over,
});
const weaponRow = (id: string): RefShipWeapon => ({
  id, name: id, category: 'primary', damageParts: [], rangeNormal: null, rangeLong: null,
  saveAbility: '', reload: null, usesAmmo: false, ammoTypes: [], weaponSize: null,
  attackBonus: 0, price: null, description: '',
});
const modRow = (id: string, system: string): RefShipModification => ({
  id, name: id, system, grade: 0, prerequisite: null, freeSlot: false, freeSuite: false, baseCost: null, description: '',
});

const ref: ShipReferenceData = {
  sizes: { sm: small },
  armor: {
    deflect: armorRow({ id: 'deflect', name: 'Deflection Armor', dexCap: 2, damageReduction: 3 }),
    directional: armorRow({ id: 'directional', name: 'Directional Shield', kind: 'shield', baseAc: 0, capacityCoefficient: 1, regenCoefficient: 1 }),
  },
  equipment: {},
  weapons: { laser: weaponRow('laser'), ion: weaponRow('ion'), pod: weaponRow('pod') },
  modifications: { eng: modRow('eng', 'Engineering'), uni: modRow('uni', 'Universal'), lounge: modRow('lounge', 'Suite') },
};

const status = (b = ship()) => shipStepStatus(b, ref, computeShip(b, ref));

function ship() {
  const b = emptyShipBuild('Ghost');
  b.abilities.base = { str: 14, dex: 14, con: 12, int: 10, wis: 14, cha: 10 };
  return b;
}

test('the step order is the approved six', () => {
  expect(SHIP_STEP_ORDER).toEqual(['size', 'tier', 'hull', 'weapons', 'equipment', 'modifications']);
});

test('an untouched ship reports every step untouched, all applicable', () => {
  const s = status();
  expect(s.size).toEqual({ state: 'untouched', summary: '—', applicable: true });
  expect(s.tier.state).toBe('untouched');
  expect(s.weapons.state).toBe('untouched');
  expect(SHIP_STEP_ORDER.every((k) => s[k].applicable)).toBe(true);
});

test('size and tier report their chosen values', () => {
  const b = ship();
  b.identity.sizeId = 'sm';
  b.identity.tier = 3;
  const s = status(b);
  expect(s.size).toMatchObject({ state: 'done', summary: 'Small Starship' });
  expect(s.tier).toMatchObject({ state: 'done', summary: 'tier 3' });
});

test('tier flags unspent ability points', () => {
  const b = ship();
  b.identity.sizeId = 'sm';
  b.identity.tier = 2;
  b.abilities.increases = [{ source: 'tier', ref: 't1', ability: 'str', amount: 1 }];
  // tiers 1 and 2 grant 2 points each = 4; only 1 is allocated.
  expect(status(b)).toMatchObject({ tier: { state: 'attention', summary: 'tier 2 · 3 pts left' } });
});

test('hull step summarises the two pools and warns when no shield generator is installed', () => {
  const b = ship();
  b.identity.sizeId = 'sm';
  const bare = status(b).hull;
  expect(bare.state).toBe('attention');
  expect(bare.summary).toContain('no shield generator');
  b.equipment = [{ id: 's1', ref: 'directional', kind: 'shield' }];
  const shielded = status(b).hull;
  expect(shielded.state).toBe('done');
  expect(shielded.summary).toMatch(/^hull \d+ · shields \d+$/);
});

test('weapons report hardpoint capacity and go to attention when over budget', () => {
  const b = ship();
  b.identity.sizeId = 'sm';                       // tier 0 -> ceil(1 * 1) = 1 hardpoint
  b.equipment = [{ id: 'w1', ref: 'laser', kind: 'weapon' }];
  expect(status(b).weapons).toMatchObject({ state: 'done', summary: '1/1 hardpoints' });

  b.equipment.push({ id: 'w2', ref: 'ion', kind: 'weapon' });
  expect(status(b).weapons).toMatchObject({ state: 'attention', summary: '2/1 hardpoints' });

  // the ⌂ house-rule unlock silences the over-budget warning
  b.houseRuled = ['weapons'];
  expect(status(b).weapons.state).toBe('done');
});

test('equipment reports the installed armor and shield by name', () => {
  const b = ship();
  b.identity.sizeId = 'sm';
  b.equipment = [
    { id: 'a1', ref: 'deflect', kind: 'armor' },
    { id: 's1', ref: 'directional', kind: 'shield' },
  ];
  expect(status(b).equipment).toMatchObject({
    state: 'done', summary: 'Deflection Armor · Directional Shield',
  });
});

test('modifications report slot and suite budgets separately', () => {
  const b = ship();
  b.identity.sizeId = 'sm';
  b.identity.tier = 2;                            // 3 slots, 1 suite
  b.modifications = ['eng', 'uni', 'lounge'];
  expect(status(b).modifications).toMatchObject({ state: 'done', summary: '2/3 slots · suite 1/1' });

  b.modifications = ['eng', 'uni', 'lounge', 'eng'];
  expect(status(b).modifications.state).toBe('attention');   // 3 slots used vs 3 is fine…
  b.identity.tier = 0;                                        // …but 1 slot at tier 0 is not
  expect(status(b).modifications.state).toBe('attention');
});
```

- [ ] **Step 2: Run it and confirm the failure**

Run: `bun test apps/swdnd/src/lib/shipValidation.test.ts` — FAIL: `error: Cannot find module './shipValidation'`.

- [ ] **Step 3: Implement**

```ts
// apps/swdnd/src/lib/shipValidation.ts
// Ship validation is BUDGET-based, not sequential: steps report capacity
// ("2/4 hardpoints", "suite 1/2") and go to `attention` only when a budget is
// exceeded. Over-budget is a warning, never a block — the ⌂ house-rule unlock
// silences it, exactly like character validation.
import { installedArmor, installedShield } from './shipRules/defense';
import type { DerivedShip, ShipBuild, ShipReferenceData } from './shipRules/types';
import type { StepInfo, StepState } from './validation';

export type ShipStepKey = 'size' | 'tier' | 'hull' | 'weapons' | 'equipment' | 'modifications';
export const SHIP_STEP_ORDER: ShipStepKey[] = [
  'size', 'tier', 'hull', 'weapons', 'equipment', 'modifications',
];

const info = (state: StepState, summary: string, applicable = true): StepInfo => ({ state, summary, applicable });

/** SOTG grants two ability points per tier. */
const TIER_POINT_BUDGET = 2;

export function shipStepStatus(
  build: ShipBuild,
  ref: ShipReferenceData,
  derived: DerivedShip,
): Record<ShipStepKey, StepInfo> {
  const houseRuled = new Set(build.houseRuled ?? []);
  const overBudget = (step: ShipStepKey, used: number, max: number): StepState =>
    used > max && !houseRuled.has(step) ? 'attention' : 'done';

  const size = ref.sizes[build.identity.sizeId];
  const sizeInfo = size ? info('done', size.name) : info('untouched', '—');

  // Tier: done once every granted ability point is spent.
  const tier = derived.tier;
  const pointBudget = tier * TIER_POINT_BUDGET;
  const spent = build.abilities.increases.reduce((s, i) => s + i.amount, 0);
  const tierInfo = tier === 0
    ? info('untouched', '—')
    : spent < pointBudget
      ? info('attention', `tier ${tier} · ${pointBudget - spent} pt${pointBudget - spent === 1 ? '' : 's'} left`)
      : info('done', `tier ${tier}`);

  // Hull & shields: a ship with no generator has no shields at all.
  const shield = installedShield(build, ref);
  const hullInfo = !size
    ? info('untouched', '—')
    : !shield
      ? info('attention', `hull ${derived.maxHull} · no shield generator`)
      : info('done', `hull ${derived.maxHull} · shields ${derived.maxShields}`);

  const weaponsInfo = derived.hardpointsUsed === 0
    ? info('untouched', size ? `0/${derived.hardpointsMax} hardpoints` : '—')
    : info(
        overBudget('weapons', derived.hardpointsUsed, derived.hardpointsMax),
        `${derived.hardpointsUsed}/${derived.hardpointsMax} hardpoints`,
      );

  const armor = installedArmor(build, ref);
  const parts = [armor?.name, shield?.name].filter(Boolean) as string[];
  const equipmentInfo = parts.length === 0 ? info('untouched', '—') : info('done', parts.join(' · '));

  const modSummary =
    `${derived.modSlotsUsed}/${derived.modSlotsMax} slots · suite ${derived.suitesUsed}/${derived.suitesMax}`;
  const modState: StepState =
    build.modifications.length === 0
      ? 'untouched'
      : overBudget('modifications', derived.modSlotsUsed, derived.modSlotsMax) === 'attention'
        || overBudget('modifications', derived.suitesUsed, derived.suitesMax) === 'attention'
        ? 'attention'
        : 'done';
  const modificationsInfo = info(modState, build.modifications.length === 0 && !size ? '—' : modSummary);

  return {
    size: sizeInfo,
    tier: tierInfo,
    hull: hullInfo,
    weapons: weaponsInfo,
    equipment: equipmentInfo,
    modifications: modificationsInfo,
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test apps/swdnd/src/lib/shipValidation.test.ts` → `8 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/shipValidation.ts apps/swdnd/src/lib/shipValidation.test.ts
git commit -m "feat(swdnd): budget-based ship builder validation"
```

---

### Task 21: `shipRules/integration.test.ts` — one ship, every number

**Files:**
- Create: `apps/swdnd/src/lib/shipRules/integration.test.ts`

**Interfaces:**

Consumes: `applyShipBuildAction` (Task 18), `applyShipPlayAction` (Task 19), `shipStepStatus` (Task 20), `computeShip` (Task 17), `emptyShipBuild` (Task 8).

Produces: nothing (test-only task).

- [ ] **Step 1: Write the test**

This one is written to pass on the first run — every module it exercises already has its own red/green cycle behind it. If it does NOT pass, that is a real defect in one of Tasks 13–20; fix that module and its own test, not this file.

```ts
// apps/swdnd/src/lib/shipRules/integration.test.ts
// End-to-end: build a small starship through reducer actions only, then assert
// every derived number by hand math. Mirrors lib/rules/integration.test.ts.
import { expect, test } from 'bun:test';
import { applyShipBuildAction, type ShipBuildAction } from '../shipBuildState';
import { applyShipPlayAction } from '../shipPlayState';
import { shipStepStatus } from '../shipValidation';
import { computeShip } from './index';
import { emptyShipBuild, type RefShipArmor, type RefShipModification, type RefShipSize, type RefShipWeapon, type ShipReferenceData } from './types';

const small: RefShipSize = {
  id: 'sm', name: 'Small Starship', key: 'small',
  hullDie: 6, hullDiceStart: 3, shieldDie: 6, shieldDiceStart: 3,
  spaceSpeed: 300, turnSpeed: 250, hardpointMult: 1, modBaseCap: 20,
  modMaxSuitesBase: -1, modMaxSuitesMult: 1, description: '',
};
const armorRow = (over: Partial<RefShipArmor> & { id: string }): RefShipArmor => ({
  name: over.id, kind: 'armor', baseAc: 10, dexCap: null, damageReduction: 0,
  capacityCoefficient: null, regenCoefficient: null, price: null, description: '', ...over,
});
const ref: ShipReferenceData = {
  sizes: { sm: small },
  armor: {
    deflect: armorRow({ id: 'deflect', name: 'Deflection Armor', dexCap: 2, damageReduction: 3 }),
    fortress: armorRow({ id: 'fortress', name: 'Fortress Shield', kind: 'shield', baseAc: 0, capacityCoefficient: 1.5, regenCoefficient: 0.667 }),
  },
  equipment: {},
  weapons: {
    laser: {
      id: 'laser', name: 'Twin laser cannon', category: 'primary',
      damageParts: [['1d8 + @mod', 'energy']], rangeNormal: 600, rangeLong: 2400,
      saveAbility: '', reload: null, usesAmmo: false, ammoTypes: [], weaponSize: 'Small',
      attackBonus: 0, price: null, description: '',
    } satisfies RefShipWeapon,
    torp: {
      id: 'torp', name: 'Torpedo tube', category: 'tertiary',
      damageParts: [['6d6', 'kinetic']], rangeNormal: 1200, rangeLong: null,
      saveAbility: 'dex', reload: 2, usesAmmo: true, ammoTypes: ['sstorpedo'], weaponSize: 'Small',
      attackBonus: 0, price: null, description: '',
    } satisfies RefShipWeapon,
  },
  modifications: {
    scrambler: { id: 'scrambler', name: 'EM Scrambler', system: 'Engineering', grade: 1, prerequisite: null, freeSlot: false, freeSuite: false, baseCost: 3500, description: '' } satisfies RefShipModification,
  },
};

function build(...actions: ShipBuildAction[]) {
  return actions.reduce(
    (acc, a) => applyShipBuildAction(acc, ref, computeShip(acc, ref), a),
    emptyShipBuild('Kestrel'),
  );
}

test('a Small tier-2 fighter, assembled through actions, computes every stat', () => {
  const b = build(
    { t: 'setSize', sizeId: 'sm' },
    { t: 'setBaseAbilities', base: { str: 14, dex: 18, con: 12, int: 10, wis: 16, cha: 8 } },
    { t: 'setTier', tier: 2 },
    { t: 'allocateTierPoint', tier: 1, ability: 'dex', delta: 1 },
    { t: 'allocateTierPoint', tier: 1, ability: 'wis', delta: 1 },
    { t: 'allocateTierPoint', tier: 2, ability: 'con', delta: 1 },
    { t: 'allocateTierPoint', tier: 2, ability: 'con', delta: 1 },
    { t: 'installEquipment', ref: 'deflect', kind: 'armor', id: 'a1' },
    { t: 'installEquipment', ref: 'fortress', kind: 'shield', id: 's1' },
    { t: 'installEquipment', ref: 'laser', kind: 'weapon', mount: 'fixed-forward', id: 'w1' },
    { t: 'installEquipment', ref: 'torp', kind: 'weapon', mount: 'turret', id: 'w2' },
    { t: 'toggleModification', ref: 'scrambler' },
  );
  const d = computeShip(b, ref);

  // Abilities: str 14 (+2), dex 18+1=19 (+4), con 12+2=14 (+2), wis 16+1=17 (+3)
  expect(d.abilities).toMatchObject({
    str: { score: 14, mod: 2 }, dex: { score: 19, mod: 4 },
    con: { score: 14, mod: 2 }, wis: { score: 17, mod: 3 },
  });
  expect(d.tier).toBe(2);

  // AC = 10 (Deflection base) + min(dex +4, cap 2) + tier-2 bonus +1 = 13
  expect(d.armorClass).toBe(13);
  expect(d.damageReduction).toBe(3);

  // Hull: d6, start 3 + tier 2 = 5 dice -> 6 + 4*4 = 22; con +2 * 5 = +10 -> 32
  expect(d.hullDice).toEqual({ die: 6, count: 5 });
  expect(d.maxHull).toBe(32);

  // Shields: same 5 d6 -> 22 base + str +2 * 5 = 32; Fortress x1.5 -> floor(48) = 48
  expect(d.shieldDice).toEqual({ die: 6, count: 5 });
  expect(d.maxShields).toBe(48);
  // Regen: max shield die 6 x 0.667 -> floor(4.002) = 4
  expect(d.shieldRegen).toBe(4);

  expect(d.speed).toBe(300);
  expect(d.turnSpeed).toBe(250);
  // Rate of fire: max(str +2, 1) x small multiplier 1 = 2
  expect(d.rateOfFireCap).toBe(2);

  // Budgets: hardpoints ceil(1 * 3) = 3, mod slots tier+1 = 3, suites max(0, -1 + 1*2) = 1
  expect(d).toMatchObject({
    hardpointsUsed: 2, hardpointsMax: 3,
    modSlotsUsed: 1, modSlotsMax: 3,
    suitesUsed: 0, suitesMax: 1,
  });

  // Weapons: attack = wis +3 (+ literal proficiency suffix); damage adds str +2.
  expect(d.weapons).toHaveLength(2);
  expect(d.weapons[0]).toMatchObject({
    entryId: 'w1', name: 'Twin laser cannon', mount: 'fixed-forward',
    attackShipMod: 3, attackText: '+3 + your proficiency',
    damageFormula: '1d8 + 2', damageType: 'energy',
    rangeNormal: 600, rangeLong: 2400, saveDc: null, usesAmmo: false,
  });
  expect(d.weapons[1]).toMatchObject({
    entryId: 'w2', name: 'Torpedo tube', mount: 'turret', category: 'tertiary',
    damageFormula: '6d6', saveAbility: 'dex', saveDc: 11, usesAmmo: true, reload: 2,
  });

  // Every builder step reads done at this point.
  const status = shipStepStatus(b, ref, d);
  expect(status.size.state).toBe('done');
  expect(status.tier).toMatchObject({ state: 'done', summary: 'tier 2' });
  expect(status.hull).toMatchObject({ state: 'done', summary: 'hull 32 · shields 48' });
  expect(status.weapons).toMatchObject({ state: 'done', summary: '2/3 hardpoints' });
  expect(status.equipment).toMatchObject({ state: 'done', summary: 'Deflection Armor · Fortress Shield' });
  expect(status.modifications).toMatchObject({ state: 'done', summary: '1/3 slots · suite 0/1' });
});

test('play actions move the two pools against the computed maxima', () => {
  let b = build(
    { t: 'setSize', sizeId: 'sm' },
    { t: 'setBaseAbilities', base: { str: 14, dex: 18, con: 12, int: 10, wis: 16, cha: 8 } },
    { t: 'setTier', tier: 2 },
    { t: 'installEquipment', ref: 'fortress', kind: 'shield', id: 's1' },
    { t: 'installEquipment', ref: 'torp', kind: 'weapon', id: 'w2' },
  );
  const d = computeShip(b, ref);           // maxHull 22 (con +1 * 5 = 5 -> 27), maxShields 48
  b = { ...b, play: { ...b.play, hull: d.maxHull, shields: d.maxShields } };

  const step = (a: Parameters<typeof applyShipPlayAction>[2]) => {
    b = { ...b, play: applyShipPlayAction(b, d, a) };
    return b.play;
  };

  expect(step({ t: 'damage', n: 10 })).toMatchObject({ shields: d.maxShields - 10, hull: d.maxHull });
  expect(step({ t: 'damage', n: 1000 })).toMatchObject({ shields: 0, hull: 0 });
  expect(step({ t: 'restoreShields', n: d.shieldRegen }).shields).toBe(d.shieldRegen);
  expect(step({ t: 'repairHull', n: 6 }).hull).toBe(6);
  expect(step({ t: 'spendAmmo', entryId: 'w2', n: 1 }).ammoSpent).toEqual({ w2: 1 });
  expect(step({ t: 'addCondition', c: 'Slowed 2' }).conditions).toEqual(['Slowed 2']);
  expect(step({ t: 'addCondition', c: 'Slowed 4' }).conditions).toEqual(['Slowed 4']);
  expect(step({ t: 'setSystemDamage', n: 3 }).systemDamage).toBe(3);
});
```

- [ ] **Step 2: Run it**

Run: `bun test apps/swdnd/src/lib/shipRules/integration.test.ts` → `2 pass, 0 fail`.
If any expectation fails, the hand math in the comment is the source of truth for what SHOULD happen — fix the offending engine module and extend that module's own test before touching this file.

- [ ] **Step 3: Run the full suite**

Run: `bun test` → `432 pass, 0 fail`.

- [ ] **Step 4: Commit**

```bash
git add apps/swdnd/src/lib/shipRules/integration.test.ts
git commit -m "test(swdnd): end-to-end starship build and play integration"
```

---

### Task 22: `resolveShipCanEdit` — who may edit a ship, client-side

**Files:**
- Modify: `apps/swdnd/src/lib/canEdit.ts`
- Modify: `apps/swdnd/src/lib/canEdit.test.ts`

**Interfaces:**

Consumes: nothing (pure).

Produces:
```ts
// apps/swdnd/src/lib/canEdit.ts
/** Client-side mirror of assertShipWriteAccess: admin, or a player owning any
 *  character on the ship's crew. The server is still the authority. */
export function resolveShipCanEdit(opts: {
  admin: boolean;
  token: string | null | undefined;
  playerCharacterIds: string[];
  crew: Array<{ character_id: string }>;
}): boolean;
```

- [ ] **Step 1: Write the failing test**

Append to `apps/swdnd/src/lib/canEdit.test.ts` (add `resolveShipCanEdit` to its import from `./canEdit`):

```ts
describe('resolveShipCanEdit', () => {
  const crew = [{ character_id: 'ch1' }, { character_id: 'ch2' }];

  test('the admin always edits, with or without a token', () => {
    expect(resolveShipCanEdit({ admin: true, token: null, playerCharacterIds: [], crew })).toBe(true);
    expect(resolveShipCanEdit({ admin: true, token: 'x', playerCharacterIds: [], crew: [] })).toBe(true);
  });

  test('a player edits only when one of their characters crews the ship', () => {
    expect(resolveShipCanEdit({ admin: false, token: 't', playerCharacterIds: ['ch2'], crew })).toBe(true);
    expect(resolveShipCanEdit({ admin: false, token: 't', playerCharacterIds: ['ch9'], crew })).toBe(false);
    expect(resolveShipCanEdit({ admin: false, token: 't', playerCharacterIds: [], crew })).toBe(false);
  });

  test('no token means no player identity, so no edit', () => {
    expect(resolveShipCanEdit({ admin: false, token: null, playerCharacterIds: ['ch1'], crew })).toBe(false);
  });

  test('an empty roster is editable by nobody but the admin', () => {
    expect(resolveShipCanEdit({ admin: false, token: 't', playerCharacterIds: ['ch1'], crew: [] })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm the failure**

Run: `bun test apps/swdnd/src/lib/canEdit.test.ts`
Expect: `SyntaxError: Export named 'resolveShipCanEdit' not found in module '.../canEdit.ts'`.

- [ ] **Step 3: Implement**

Append to `apps/swdnd/src/lib/canEdit.ts`:

```ts
/**
 * Client-side mirror of the backend's assertShipWriteAccess: the admin, or a
 * player (identified by their share token) owning ANY character on this ship's
 * crew. Unlike resolveCanEdit for characters — where the loose `admin || token`
 * answer is safe because the server owns the ownership check — a ship's roster
 * is already in hand from the GET, so the client can be precise and avoid
 * showing an editable builder that would 403 on save.
 *
 * The server remains the authority; this only decides what the UI offers.
 */
export function resolveShipCanEdit(opts: {
  admin: boolean;
  token: string | null | undefined;
  playerCharacterIds: string[];
  crew: Array<{ character_id: string }>;
}): boolean {
  if (opts.admin) return true;
  if (!opts.token) return false;
  const own = new Set(opts.playerCharacterIds);
  return opts.crew.some((m) => own.has(m.character_id));
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test apps/swdnd/src/lib/canEdit.test.ts` → all pass, including the 4 new cases.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/canEdit.ts apps/swdnd/src/lib/canEdit.test.ts
git commit -m "feat(swdnd): client-side ship edit permission"
```

---

### Task 23: `hooks/useShipBuilder.ts` and `hooks/useShipSheet.ts`

**Files:**
- Create: `apps/swdnd/src/hooks/useShipBuilder.ts`
- Create: `apps/swdnd/src/hooks/useShipSheet.ts`

**Interfaces:**

Consumes:
```ts
// ../lib/starships
export function getStarship(id: string): Promise<StarshipDto>;
export function patchStarship(id: string, patch: { name?: string; data_json?: ShipBuild }, token?: string | null): Promise<StarshipDto>;
export function loadShipReference(): Promise<ShipReferenceData>;
export interface StarshipDto { id: string; campaign_id: string; name: string; data_json: ShipBuild; created_at: string; updated_at: string; crew: ShipCrewMember[] }
export interface ShipCrewMember { character_id: string; character_name: string; role: ShipRole }
// ../lib/characters
export function getPlayerByToken(token: string): Promise<{ player: PlayerDto; characters: Array<{ id: string; name: string; campaign_id: string }> }>;
// ../lib/ws
export function connectCampaign(campaignId: string, onMessage: (env: WsEnvelope) => void, onStatus?: (open: boolean) => void, token?: string | null): CampaignSocket;
// ../lib/auth
export function useAuth(): { authed: boolean; loading: boolean };
// ../lib/canEdit
export function resolveShipCanEdit(opts: { admin: boolean; token: string | null | undefined; playerCharacterIds: string[]; crew: Array<{ character_id: string }> }): boolean;
// ../lib/shipBuildState, ../lib/shipPlayState, ../lib/shipValidation, ../lib/shipRules
export function applyShipBuildAction(build, ref, derived, action: ShipBuildAction): ShipBuild;
export function applyShipPlayAction(build, derived, action: ShipPlayAction): ShipPlayState;
export function shipStepStatus(build, ref, derived): Record<ShipStepKey, StepInfo>;
export function computeShip(build: ShipBuild, ref: ShipReferenceData): DerivedShip;
```

Produces:
```ts
// apps/swdnd/src/hooks/useShipBuilder.ts
export interface ShipBuilderState {
  loading: boolean; error: string | null;
  build: ShipBuild | null; derived: DerivedShip | null; ref: ShipReferenceData | null;
  status: Record<ShipStepKey, StepInfo> | null;
  canEdit: boolean; dto: StarshipDto | null; saving: boolean;
  dispatch: (action: ShipBuildAction) => void;
}
export function useShipBuilder(shipId: string): ShipBuilderState;

// apps/swdnd/src/hooks/useShipSheet.ts
export interface ShipSheetState {
  loading: boolean; error: string | null;
  build: ShipBuild | null; derived: DerivedShip | null; ref: ShipReferenceData | null;
  play: ShipPlayState | null; crew: ShipCrewMember[];
  canEdit: boolean; dto: StarshipDto | null;
  dispatch: (action: ShipPlayAction) => void;
}
export function useShipSheet(shipId: string): ShipSheetState;
```

- [ ] **Step 1: Write `useShipBuilder`**

No test seam (React hooks; the character equivalents `useBuilder`/`useCharacterSheet` are untested too — their logic lives in the pure reducers, which are). Verified by typecheck and the Task 31 walkthrough.

```ts
// apps/swdnd/src/hooks/useShipBuilder.ts
// Shape copied verbatim from hooks/useBuilder.ts: load -> useMemo(compute) ->
// optimistic dispatch -> debounced PATCH.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getPlayerByToken } from '../lib/characters';
import { getStarship, loadShipReference, patchStarship, type StarshipDto } from '../lib/starships';
import { useAuth } from '../lib/auth';
import { resolveShipCanEdit } from '../lib/canEdit';
import { applyShipBuildAction, type ShipBuildAction } from '../lib/shipBuildState';
import { shipStepStatus, type ShipStepKey } from '../lib/shipValidation';
import { computeShip } from '../lib/shipRules';
import type { DerivedShip, ShipBuild, ShipReferenceData } from '../lib/shipRules/types';
import type { StepInfo } from '../lib/validation';

export interface ShipBuilderState {
  loading: boolean;
  error: string | null;
  build: ShipBuild | null;
  derived: DerivedShip | null;
  ref: ShipReferenceData | null;
  status: Record<ShipStepKey, StepInfo> | null;
  canEdit: boolean;
  dto: StarshipDto | null;
  saving: boolean;
  dispatch: (action: ShipBuildAction) => void;
}

const SAVE_DEBOUNCE_MS = 500;

export function useShipBuilder(shipId: string): ShipBuilderState {
  const { authed } = useAuth();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [dto, setDto] = useState<StarshipDto | null>(null);
  const [build, setBuild] = useState<ShipBuild | null>(null);
  const [ref, setRef] = useState<ShipReferenceData | null>(null);
  const [ownCharacterIds, setOwnCharacterIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    // loadShipReference is SEPARATE from loadReference on purpose — a ship
    // screen must not pay for the 10 character-content requests.
    Promise.all([getStarship(shipId), loadShipReference()])
      .then(([ship, reference]) => {
        if (!alive) return;
        setDto(ship);
        setBuild(ship.data_json);
        setRef(reference);
        setError(null);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [shipId]);

  useEffect(() => {
    if (!token) { setOwnCharacterIds([]); return; }
    let alive = true;
    // A failed lookup just means "no player identity" -> read-only, not an error banner.
    getPlayerByToken(token)
      .then((me) => alive && setOwnCharacterIds(me.characters.map((ch) => ch.id)))
      .catch(() => alive && setOwnCharacterIds([]));
    return () => { alive = false; };
  }, [token]);

  const derived = useMemo(() => (build && ref ? computeShip(build, ref) : null), [build, ref]);
  const status = useMemo(
    () => (build && ref && derived ? shipStepStatus(build, ref, derived) : null),
    [build, ref, derived],
  );

  const canEdit = resolveShipCanEdit({
    admin: authed, token, playerCharacterIds: ownCharacterIds, crew: dto?.crew ?? [],
  });

  const dispatch = useCallback(
    (action: ShipBuildAction) => {
      if (!canEdit || !build || !ref || !derived) return;
      const next = applyShipBuildAction(build, ref, derived, action);
      setBuild(next);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaving(true);
      // Deliberately NOT cleared on unmount: a pending timer flushes the last
      // edit rather than dropping it when the user navigates away.
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        void patchStarship(shipId, { name: next.identity.name || undefined, data_json: next }, token)
          .then(() => setError(null))
          .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Save failed'))
          .finally(() => setSaving(false));
      }, SAVE_DEBOUNCE_MS);
    },
    [canEdit, build, ref, derived, shipId, token],
  );

  return { loading, error, build, derived, ref, status, canEdit, dto, saving, dispatch };
}
```

- [ ] **Step 2: Write `useShipSheet`**

```ts
// apps/swdnd/src/hooks/useShipSheet.ts
// Shape copied verbatim from hooks/useCharacterSheet.ts, including the
// armed-save-timer WS-echo merge guard.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getPlayerByToken } from '../lib/characters';
import {
  getStarship, loadShipReference, patchStarship, type ShipCrewMember, type StarshipDto,
} from '../lib/starships';
import { connectCampaign } from '../lib/ws';
import { useAuth } from '../lib/auth';
import { resolveShipCanEdit } from '../lib/canEdit';
import { applyShipPlayAction, type ShipPlayAction } from '../lib/shipPlayState';
import { computeShip } from '../lib/shipRules';
import type { DerivedShip, ShipBuild, ShipPlayState, ShipReferenceData } from '../lib/shipRules/types';

export interface ShipSheetState {
  loading: boolean;
  error: string | null;
  build: ShipBuild | null;
  derived: DerivedShip | null;
  ref: ShipReferenceData | null;
  play: ShipPlayState | null;
  crew: ShipCrewMember[];
  canEdit: boolean;
  dto: StarshipDto | null;
  dispatch: (action: ShipPlayAction) => void;
}

const SAVE_DEBOUNCE_MS = 400;

export function useShipSheet(shipId: string): ShipSheetState {
  const { authed } = useAuth();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [dto, setDto] = useState<StarshipDto | null>(null);
  const [build, setBuild] = useState<ShipBuild | null>(null);
  const [ref, setRef] = useState<ShipReferenceData | null>(null);
  const [play, setPlay] = useState<ShipPlayState | null>(null);
  const [ownCharacterIds, setOwnCharacterIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([getStarship(shipId), loadShipReference()])
      .then(([ship, reference]) => {
        if (!alive) return;
        setDto(ship);
        setBuild(ship.data_json);
        setPlay(ship.data_json.play);
        setRef(reference);
        setError(null);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [shipId]);

  useEffect(() => {
    if (!token) { setOwnCharacterIds([]); return; }
    let alive = true;
    getPlayerByToken(token)
      .then((me) => alive && setOwnCharacterIds(me.characters.map((ch) => ch.id)))
      .catch(() => alive && setOwnCharacterIds([]));
    return () => { alive = false; };
  }, [token]);

  const derived = useMemo(() => (build && ref ? computeShip(build, ref) : null), [build, ref]);

  useEffect(() => {
    const campaignId = dto?.campaign_id;
    if (!campaignId) return;
    const sock = connectCampaign(
      campaignId,
      (env) => {
        if (env.type !== 'ship:updated') return;
        // While a local edit is pending (debounce timer armed), skip incoming
        // merges: our own earlier echo — or a concurrent writer — must not
        // clobber the newer local state. Once our PATCH fires, its echo matches
        // local state and merging is idempotent (last-write-wins).
        if (saveTimer.current) return;
        const payload = env.payload as { shipId?: string; play?: ShipPlayState } | undefined;
        if (payload?.shipId === shipId && payload.play) setPlay(payload.play);
      },
      undefined,
      token,
    );
    return () => sock.close();
  }, [dto?.campaign_id, shipId, token]);

  const canEdit = resolveShipCanEdit({
    admin: authed, token, playerCharacterIds: ownCharacterIds, crew: dto?.crew ?? [],
  });

  const dispatch = useCallback(
    (action: ShipPlayAction) => {
      if (!canEdit || !build || !derived || !play) return;
      const nextPlay = applyShipPlayAction({ ...build, play }, derived, action);
      setPlay(nextPlay);
      const nextBuild = { ...build, play: nextPlay };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null; // edit no longer pending; WS merges resume
        void patchStarship(shipId, { data_json: nextBuild }, token)
          .then(() => setError(null))
          .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Save failed'));
      }, SAVE_DEBOUNCE_MS);
    },
    [canEdit, build, derived, play, shipId, token],
  );

  return { loading, error, build, derived, ref, play, crew: dto?.crew ?? [], canEdit, dto, dispatch };
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/swdnd && bun run build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/swdnd/src/hooks/useShipBuilder.ts apps/swdnd/src/hooks/useShipSheet.ts
git commit -m "feat(swdnd): ship builder and sheet hooks"
```

---

> **UI tasks (24–30) have no unit-test seam.** The character panels they mirror are untested for the same reason: every rule they render already has a green test behind it in Tasks 13–21. Each UI task is therefore verified by `cd apps/swdnd && bun run build` (tsc `noUnusedLocals`/`noUnusedParameters` + vite build) plus `bun test` staying green, and finally by the manual walkthrough in Task 31. This is stated explicitly per task rather than silently skipped.

### Task 24: Builder shell, `ShipStepRail`, and the Size + Tier steps

**Files:**
- Create: `apps/swdnd/src/panels/ShipSheet/Builder/index.tsx`
- Create: `apps/swdnd/src/panels/ShipSheet/Builder/ShipStepRail.tsx`
- Create: `apps/swdnd/src/panels/ShipSheet/Builder/steps/Size.tsx`
- Create: `apps/swdnd/src/panels/ShipSheet/Builder/steps/Tier.tsx`

**Interfaces:**

Consumes:
```ts
// ../../../hooks/useShipBuilder
export function useShipBuilder(shipId: string): ShipBuilderState;   // see Task 23
// ../../../lib/shipValidation
export type ShipStepKey = 'size' | 'tier' | 'hull' | 'weapons' | 'equipment' | 'modifications';
export const SHIP_STEP_ORDER: ShipStepKey[];
// ../../../lib/validation
export interface StepInfo { state: 'done' | 'attention' | 'untouched'; summary: string; applicable: boolean }
// ../../CharacterSheet/Builder/StepTable  (REUSED as the list primitive)
export interface Column<T> { key: string; label: string; flex?: number; value: (item: T) => string | number }
export default function StepTable<T>(props: {
  items: T[]; columns: Column<T>[]; idOf: (item: T) => string; searchText: (item: T) => string;
  detail: (item: T) => ReactNode; isSelected: (item: T) => boolean; onSelect: (item: T) => void;
  selectLabel?: (item: T) => string; disabledReason?: (item: T) => string | null;
  header?: ReactNode; editable: boolean;
}): JSX.Element;
// ../../../lib/shipRules/constants
export const MAX_SHIP_TIER: number;
export const SHIP_ABILITIES: ShipAbilityKey[];
```

Produces:
```tsx
// apps/swdnd/src/panels/ShipSheet/Builder/ShipStepRail.tsx
export default function ShipStepRail(props: {
  status: Record<ShipStepKey, StepInfo>; active: ShipStepKey; houseRuled: string[];
  onSelect: (step: ShipStepKey) => void;
}): JSX.Element;

// apps/swdnd/src/panels/ShipSheet/Builder/steps/Size.tsx
export default function SizeStep(props: {
  build: ShipBuild; ref: ShipReferenceData; editable: boolean;
  dispatch: (a: ShipBuildAction) => void;
}): JSX.Element;

// apps/swdnd/src/panels/ShipSheet/Builder/steps/Tier.tsx
export default function TierStep(props: {
  build: ShipBuild; derived: DerivedShip; editable: boolean;
  dispatch: (a: ShipBuildAction) => void;
}): JSX.Element;

// apps/swdnd/src/panels/ShipSheet/Builder/index.tsx
export default function ShipBuilder(props: { shipId: string }): JSX.Element;
```

- [ ] **Step 1: Write `ShipStepRail`**

```tsx
// apps/swdnd/src/panels/ShipSheet/Builder/ShipStepRail.tsx
// Same shell as the character StepRail — the rail is kept for consistency even
// though ship validation is budget-based rather than sequential.
import { SHIP_STEP_ORDER, type ShipStepKey } from '../../../lib/shipValidation';
import type { StepInfo } from '../../../lib/validation';

const LABELS: Record<ShipStepKey, string> = {
  size: 'Size', tier: 'Tier', hull: 'Hull & Shields',
  weapons: 'Weapons', equipment: 'Equipment', modifications: 'Modifications',
};
const GLYPH = { done: '✓', attention: '!', untouched: '○' } as const;
const GLYPH_CLASS = { done: 'text-green-300', attention: 'text-yellow-300', untouched: 'text-ht-muted' } as const;

interface Props {
  status: Record<ShipStepKey, StepInfo>;
  active: ShipStepKey;
  houseRuled: string[];
  onSelect: (step: ShipStepKey) => void;
}

export default function ShipStepRail({ status, active, houseRuled, onSelect }: Props) {
  const steps = SHIP_STEP_ORDER.filter((k) => status[k].applicable);
  const overBudget = steps.filter((k) => status[k].state === 'attention').length;
  return (
    <nav className="flex shrink-0 flex-col gap-1 @lg:min-w-[210px]">
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
        {overBudget === 0 ? '✓ within every budget' : `${overBudget} step${overBudget === 1 ? '' : 's'} over budget`}
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Write the Size step**

```tsx
// apps/swdnd/src/panels/ShipSheet/Builder/steps/Size.tsx
import StepTable from '../../../CharacterSheet/Builder/StepTable';
import type { ShipBuildAction } from '../../../../lib/shipBuildState';
import type { RefShipSize, ShipBuild, ShipReferenceData } from '../../../../lib/shipRules/types';

export default function SizeStep({
  build, ref, editable, dispatch,
}: {
  build: ShipBuild;
  ref: ShipReferenceData;
  editable: boolean;
  dispatch: (a: ShipBuildAction) => void;
}) {
  const sizes = Object.values(ref.sizes).sort((a, b) => a.hullDie - b.hullDie);
  return (
    <StepTable<RefShipSize>
      items={sizes}
      columns={[
        { key: 'name', label: 'Chassis', flex: 2, value: (s) => s.name },
        { key: 'hull', label: 'Hull', value: (s) => `${s.hullDiceStart}d${s.hullDie}` },
        { key: 'speed', label: 'Turn', value: (s) => s.turnSpeed },
        { key: 'hardpoints', label: 'HP mult', value: (s) => s.hardpointMult },
      ]}
      idOf={(s) => s.id}
      searchText={(s) => `${s.name} ${s.key}`}
      detail={(s) => s.description || 'No description in the pack.'}
      isSelected={(s) => s.id === build.identity.sizeId}
      onSelect={(s) => dispatch({ t: 'setSize', sizeId: s.id })}
      editable={editable}
      header={
        <div className="ht-label px-1">
          The chassis fixes hull and shield dice, base speeds, and the hardpoint / suite budgets.
          Changing it re-scales the ship's current hull and shields.
        </div>
      }
    />
  );
}
```

- [ ] **Step 3: Write the Tier step**

```tsx
// apps/swdnd/src/panels/ShipSheet/Builder/steps/Tier.tsx
import { MAX_SHIP_TIER, SHIP_ABILITIES } from '../../../../lib/shipRules/constants';
import type { ShipBuildAction } from '../../../../lib/shipBuildState';
import type { DerivedShip, ShipAbilityKey, ShipBuild } from '../../../../lib/shipRules/types';

const LABEL: Record<ShipAbilityKey, string> = {
  str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA',
};
const TIER_POINT_BUDGET = 2;
const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

export default function TierStep({
  build, derived, editable, dispatch,
}: {
  build: ShipBuild;
  derived: DerivedShip;
  editable: boolean;
  dispatch: (a: ShipBuildAction) => void;
}) {
  const tiers = Array.from({ length: MAX_SHIP_TIER }, (_, i) => i + 1);
  const spentAt = (tier: number) =>
    build.abilities.increases.filter((i) => i.ref === `t${tier}`).reduce((s, i) => s + i.amount, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto text-[11px]">
      <div className="ht-panel flex flex-wrap items-center gap-2 p-2">
        <span className="ht-label">Tier</span>
        {[0, ...tiers].map((t) => (
          <button
            key={t}
            type="button"
            disabled={!editable}
            className={`ht-step ${t === derived.tier ? 'ht-tile-active' : ''}`}
            onClick={() => dispatch({ t: 'setTier', tier: t })}
          >
            {t}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-ht-muted">
          AC {derived.armorClass} · hull {derived.hullDice.count}d{derived.hullDice.die} · {derived.modSlotsMax} mod slots
        </span>
      </div>

      <div className="ht-panel p-2">
        <div className="ht-label mb-1">Base ability scores</div>
        <div className="flex flex-wrap gap-3">
          {SHIP_ABILITIES.map((k) => (
            <label key={k} className="flex items-center gap-1">
              <span className="text-ht-muted">{LABEL[k]}</span>
              <input
                type="number"
                disabled={!editable}
                className="w-14 border-b border-ht-line bg-transparent text-center text-ht-bright outline-none"
                value={build.abilities.base[k]}
                onChange={(e) =>
                  dispatch({
                    t: 'setBaseAbilities',
                    base: { ...build.abilities.base, [k]: Number(e.target.value) || 0 },
                  })}
              />
              <b className="text-ht-bright">{fmt(derived.abilities[k].mod)}</b>
            </label>
          ))}
        </div>
      </div>

      {tiers
        .filter((t) => t <= derived.tier)
        .map((t) => {
          const spent = spentAt(t);
          return (
            <div key={t} className="ht-panel p-2">
              <div className="ht-label mb-1">
                Tier {t} ability points — {TIER_POINT_BUDGET - spent} of {TIER_POINT_BUDGET} left
              </div>
              <div className="flex flex-wrap gap-2">
                {SHIP_ABILITIES.map((k) => {
                  const here = build.abilities.increases.filter((i) => i.ref === `t${t}` && i.ability === k).length;
                  return (
                    <span key={k} className="flex items-center gap-1">
                      <button type="button" className="ht-step" disabled={!editable || here === 0}
                        onClick={() => dispatch({ t: 'allocateTierPoint', tier: t, ability: k, delta: -1 })}>−</button>
                      <span className="text-ht-muted">{LABEL[k]}</span>
                      <b className="text-ht-bright">+{here}</b>
                      <button type="button" className="ht-step" disabled={!editable || spent >= TIER_POINT_BUDGET}
                        onClick={() => dispatch({ t: 'allocateTierPoint', tier: t, ability: k, delta: 1 })}>+</button>
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
    </div>
  );
}
```

- [ ] **Step 4: Write the Builder shell**

```tsx
// apps/swdnd/src/panels/ShipSheet/Builder/index.tsx
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useShipBuilder } from '../../../hooks/useShipBuilder';
import type { ShipStepKey } from '../../../lib/shipValidation';
import ShipStepRail from './ShipStepRail';
import SizeStep from './steps/Size';
import TierStep from './steps/Tier';

export default function ShipBuilder({ shipId }: { shipId: string }) {
  const b = useShipBuilder(shipId);
  const [active, setActive] = useState<ShipStepKey>('size');
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const sheetHref = `/ship/${shipId}${token ? `?token=${encodeURIComponent(token)}` : ''}`;

  if (b.loading) return <div className="p-6 font-mono text-ht-muted">Loading ship builder…</div>;
  if (!b.build || !b.derived || !b.ref || !b.status) {
    return <div className="p-6 font-mono text-red-400">{b.error ?? 'Starship not found'}</div>;
  }
  if (!b.canEdit) {
    return (
      <div className="p-6 font-mono text-ht-muted">
        Read-only — the ship builder needs the admin session or a crew member's token.{' '}
        <Link className="text-ht-accent" to={sheetHref}>◂ view the ship</Link>
      </div>
    );
  }

  return (
    <div className="@container ht-screen flex h-full min-h-0 flex-col p-3 font-mono text-ht-text">
      {b.error && (
        <div className="mb-2 shrink-0 rounded border border-red-400/60 bg-red-950/40 px-3 py-1.5 text-[11px] text-red-300">
          ⚠ {b.error} — changes may not be saved
        </div>
      )}
      <div className="ht-glow mb-3 flex shrink-0 flex-wrap items-center gap-3 rounded-md p-3">
        <input
          className="ht-name w-56 border-b border-ht-line bg-transparent text-sm font-bold outline-none"
          value={b.build.identity.name}
          placeholder="ship name…"
          onChange={(e) => b.dispatch({ t: 'setName', name: e.target.value })}
        />
        <span className="text-[10px] text-ht-muted">tier {b.derived.tier}</span>
        <button
          type="button"
          className="ht-step text-[10px]"
          title="house-rule this step: silence its budget warning"
          onClick={() => b.dispatch({ t: 'toggleHouseRule', step: active })}
        >
          ⌂ {(b.build.houseRuled ?? []).includes(active) ? 'locked' : 'unlock'}
        </button>
        <span className="ml-auto text-[10px] text-ht-muted">
          {b.saving ? 'saving…' : 'auto-saved ✓'} · <Link className="text-ht-accent" to={sheetHref}>◂ back to ship</Link>
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 @lg:flex-row">
        <ShipStepRail status={b.status} active={active} houseRuled={b.build.houseRuled ?? []} onSelect={setActive} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          {active === 'size' && <SizeStep build={b.build} ref={b.ref} editable={b.canEdit} dispatch={b.dispatch} />}
          {active === 'tier' && <TierStep build={b.build} derived={b.derived} editable={b.canEdit} dispatch={b.dispatch} />}
          {/* hull / weapons / equipment / modifications steps land in Tasks 25-26 */}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `cd apps/swdnd && bun run build`
Expect: succeeds. (The Builder is not routed yet, so nothing renders it — that is Task 29.)

- [ ] **Step 6: Commit**

```bash
git add apps/swdnd/src/panels/ShipSheet/Builder/index.tsx apps/swdnd/src/panels/ShipSheet/Builder/ShipStepRail.tsx apps/swdnd/src/panels/ShipSheet/Builder/steps/Size.tsx apps/swdnd/src/panels/ShipSheet/Builder/steps/Tier.tsx
git commit -m "feat(swdnd): ship builder shell with size and tier steps"
```

---

### Task 25: Builder steps — Hull & Shields, Equipment

**Files:**
- Create: `apps/swdnd/src/panels/ShipSheet/Builder/steps/Hull.tsx`
- Create: `apps/swdnd/src/panels/ShipSheet/Builder/steps/Equipment.tsx`
- Modify: `apps/swdnd/src/panels/ShipSheet/Builder/index.tsx`

**Interfaces:**

Consumes: `StepTable` + `Column<T>` (see Task 24's Consumes block); `applyShipBuildAction`'s `ShipBuildAction` (Task 18); `installedArmor` / `installedShield` (Task 14); `RefShipArmor`, `RefShipEquipment`, `DerivedShip` (Task 8).

Produces:
```tsx
// apps/swdnd/src/panels/ShipSheet/Builder/steps/Hull.tsx
export default function HullStep(props: {
  build: ShipBuild; ref: ShipReferenceData; derived: DerivedShip; editable: boolean;
  dispatch: (a: ShipBuildAction) => void;
}): JSX.Element;

// apps/swdnd/src/panels/ShipSheet/Builder/steps/Equipment.tsx
export default function EquipmentStep(props: {
  build: ShipBuild; ref: ShipReferenceData; editable: boolean;
  dispatch: (a: ShipBuildAction) => void;
}): JSX.Element;
```

- [ ] **Step 1: Write the Hull & Shields step**

Hull armor and shield generators both live in `ref.armor`, discriminated by `kind` — this step installs one of each.

```tsx
// apps/swdnd/src/panels/ShipSheet/Builder/steps/Hull.tsx
import StepTable from '../../../CharacterSheet/Builder/StepTable';
import { installedArmor, installedShield } from '../../../../lib/shipRules/defense';
import type { ShipBuildAction } from '../../../../lib/shipBuildState';
import type { DerivedShip, RefShipArmor, ShipBuild, ShipReferenceData } from '../../../../lib/shipRules/types';

export default function HullStep({
  build, ref, derived, editable, dispatch,
}: {
  build: ShipBuild;
  ref: ShipReferenceData;
  derived: DerivedShip;
  editable: boolean;
  dispatch: (a: ShipBuildAction) => void;
}) {
  // starship_armor holds hull armor AND shield generators; show both, tagged.
  const rows = Object.values(ref.armor).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  const armor = installedArmor(build, ref);
  const shield = installedShield(build, ref);
  const selectedId = (r: RefShipArmor) => (r.kind === 'shield' ? shield?.id : armor?.id);

  return (
    <StepTable<RefShipArmor>
      items={rows}
      columns={[
        { key: 'name', label: 'System', flex: 2, value: (r) => r.name },
        { key: 'kind', label: 'Slot', value: (r) => (r.kind === 'shield' ? 'shields' : 'armor') },
        {
          key: 'effect', label: 'Effect',
          value: (r) => (r.kind === 'shield'
            ? `cap ×${r.capacityCoefficient ?? 1} · regen ×${r.regenCoefficient ?? 1}`
            : `DR ${r.damageReduction} · dex ${r.dexCap == null ? '—' : `+${r.dexCap}`}`),
        },
        { key: 'price', label: 'Credits', value: (r) => r.price ?? 0 },
      ]}
      idOf={(r) => r.id}
      searchText={(r) => `${r.name} ${r.kind}`}
      detail={(r) => r.description || 'No description in the pack.'}
      isSelected={(r) => r.id === selectedId(r)}
      onSelect={(r) =>
        r.id === selectedId(r)
          ? dispatch({ t: 'removeEquipment', id: build.equipment.find((e) => e.ref === r.id)?.id ?? '' })
          : dispatch({ t: 'installEquipment', ref: r.id, kind: r.kind === 'shield' ? 'shield' : 'armor' })}
      selectLabel={(r) => (r.id === selectedId(r) ? '✕ uninstall' : '✓ install')}
      editable={editable}
      header={
        <div className="ht-label px-1">
          hull {derived.maxHull} ({derived.hullDice.count}d{derived.hullDice.die} + CON/die) ·{' '}
          shields {derived.maxShields}
          {derived.maxShields === 0 && ' — install a shield generator'} ·{' '}
          regen {derived.shieldRegen} · AC {derived.armorClass} · DR {derived.damageReduction}
        </div>
      }
    />
  );
}
```

- [ ] **Step 2: Write the Equipment step**

```tsx
// apps/swdnd/src/panels/ShipSheet/Builder/steps/Equipment.tsx
import StepTable from '../../../CharacterSheet/Builder/StepTable';
import type { ShipBuildAction } from '../../../../lib/shipBuildState';
import type {
  RefShipEquipment, ShipBuild, ShipEquipmentKind, ShipReferenceData,
} from '../../../../lib/shipRules/types';

/** starship_equipment kinds map onto the ship's single-slot systems. */
const SLOT_OF: Record<RefShipEquipment['kind'], ShipEquipmentKind | null> = {
  reactor: 'reactor', hyperdrive: 'hyperdrive', coupling: 'coupling', other: null,
};

export default function EquipmentStep({
  build, ref, editable, dispatch,
}: {
  build: ShipBuild;
  ref: ShipReferenceData;
  editable: boolean;
  dispatch: (a: ShipBuildAction) => void;
}) {
  const rows = Object.values(ref.equipment)
    .filter((r) => SLOT_OF[r.kind] !== null)
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  const entryFor = (r: RefShipEquipment) => build.equipment.find((e) => e.ref === r.id);

  return (
    <StepTable<RefShipEquipment>
      items={rows}
      columns={[
        { key: 'name', label: 'Equipment', flex: 2, value: (r) => r.name },
        { key: 'kind', label: 'Slot', value: (r) => r.kind },
        {
          key: 'spec', label: 'Spec',
          value: (r) =>
            r.kind === 'reactor' ? `power ${r.powerDiceRecovery ?? '—'}`
              : r.kind === 'hyperdrive' ? `class ${r.hyperdriveClass ?? '—'}`
                : `central ${r.centralCapacity ?? 0} / system ${r.systemCapacity ?? 0}`,
        },
        { key: 'price', label: 'Credits', value: (r) => r.price ?? 0 },
      ]}
      idOf={(r) => r.id}
      searchText={(r) => `${r.name} ${r.kind}`}
      detail={(r) => r.description || 'No description in the pack.'}
      isSelected={(r) => !!entryFor(r)}
      onSelect={(r) => {
        const entry = entryFor(r);
        if (entry) { dispatch({ t: 'removeEquipment', id: entry.id }); return; }
        const slot = SLOT_OF[r.kind];
        if (slot) dispatch({ t: 'installEquipment', ref: r.id, kind: slot });
      }}
      selectLabel={(r) => (entryFor(r) ? '✕ uninstall' : '✓ install')}
      editable={editable}
      header={
        <div className="ht-label px-1">
          Reactors, hyperdrives and power couplings — one of each. Power dice and coupling topology
          come online with the crew layer; the spine records the choice.
        </div>
      }
    />
  );
}
```

- [ ] **Step 3: Wire both into the Builder shell**

In `apps/swdnd/src/panels/ShipSheet/Builder/index.tsx`, add the imports:

```tsx
import HullStep from './steps/Hull';
import EquipmentStep from './steps/Equipment';
```

and replace the placeholder comment with:

```tsx
          {active === 'hull' && (
            <HullStep build={b.build} ref={b.ref} derived={b.derived} editable={b.canEdit} dispatch={b.dispatch} />
          )}
          {active === 'equipment' && (
            <EquipmentStep build={b.build} ref={b.ref} editable={b.canEdit} dispatch={b.dispatch} />
          )}
          {/* weapons / modifications steps land in Task 26 */}
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/swdnd && bun run build` → succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/panels/ShipSheet/Builder/steps/Hull.tsx apps/swdnd/src/panels/ShipSheet/Builder/steps/Equipment.tsx apps/swdnd/src/panels/ShipSheet/Builder/index.tsx
git commit -m "feat(swdnd): ship builder hull and equipment steps"
```

---

### Task 26: Builder steps — Weapons, Modifications

**Files:**
- Create: `apps/swdnd/src/panels/ShipSheet/Builder/steps/Weapons.tsx`
- Create: `apps/swdnd/src/panels/ShipSheet/Builder/steps/Modifications.tsx`
- Modify: `apps/swdnd/src/panels/ShipSheet/Builder/index.tsx`

**Interfaces:**

Consumes: `StepTable` + `Column<T>` (Task 24); `WEAPON_MOUNTS` (Task 9); `ShipBuildAction` (Task 18); `RefShipWeapon`, `RefShipModification`, `DerivedShip`, `WeaponMount` (Task 8).

Produces:
```tsx
// apps/swdnd/src/panels/ShipSheet/Builder/steps/Weapons.tsx
export default function WeaponsStep(props: {
  build: ShipBuild; ref: ShipReferenceData; derived: DerivedShip; editable: boolean;
  dispatch: (a: ShipBuildAction) => void;
}): JSX.Element;

// apps/swdnd/src/panels/ShipSheet/Builder/steps/Modifications.tsx
export default function ModificationsStep(props: {
  build: ShipBuild; ref: ShipReferenceData; derived: DerivedShip; editable: boolean;
  dispatch: (a: ShipBuildAction) => void;
}): JSX.Element;
```

- [ ] **Step 1: Write the Weapons step**

Two panes: the installed list (with a mount picker and a remove button), and the browser. Rows whose `category` is `'other'` are the pack's `ammo` / `simpleVW` entries and are filtered out.

```tsx
// apps/swdnd/src/panels/ShipSheet/Builder/steps/Weapons.tsx
import StepTable from '../../../CharacterSheet/Builder/StepTable';
import { WEAPON_MOUNTS } from '../../../../lib/shipRules/constants';
import type { ShipBuildAction } from '../../../../lib/shipBuildState';
import type {
  DerivedShip, RefShipWeapon, ShipBuild, ShipReferenceData, WeaponMount,
} from '../../../../lib/shipRules/types';

const MOUNT_LABEL: Record<WeaponMount, string> = {
  'fixed-forward': 'fwd', 'fixed-aft': 'aft', 'fixed-port': 'port',
  'fixed-starboard': 'stbd', turret: 'turret',
};

export default function WeaponsStep({
  build, ref, derived, editable, dispatch,
}: {
  build: ShipBuild;
  ref: ShipReferenceData;
  derived: DerivedShip;
  editable: boolean;
  dispatch: (a: ShipBuildAction) => void;
}) {
  // 'other' covers the pack's `ammo` and `simpleVW` rows — not installable weapons.
  const rows = Object.values(ref.weapons)
    .filter((w) => w.category !== 'other')
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const over = derived.hardpointsUsed > derived.hardpointsMax;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="ht-panel p-2 text-[11px]">
        <div className={`ht-label mb-1 ${over ? 'text-yellow-300' : ''}`}>
          {derived.hardpointsUsed}/{derived.hardpointsMax} hardpoints
          {over && ' — over budget (⌂ to house-rule)'} · rate of fire {derived.rateOfFireCap}/round
        </div>
        {derived.weapons.length === 0 && <div className="text-ht-muted">Nothing installed.</div>}
        {derived.weapons.map((p) => (
          <div key={p.entryId} className="flex flex-wrap items-center gap-2 py-0.5">
            <span className="min-w-[140px] text-ht-text">{p.name}</span>
            <span className="text-[10px] text-ht-muted">{p.category}</span>
            <span className="flex gap-1">
              {WEAPON_MOUNTS.map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={!editable}
                  className={`ht-step text-[10px] ${p.mount === m ? 'ht-tile-active' : ''}`}
                  onClick={() => dispatch({ t: 'setMount', id: p.entryId, mount: m })}
                >
                  {MOUNT_LABEL[m]}
                </button>
              ))}
            </span>
            <span className="text-[10px] text-ht-muted">{p.attackText} · {p.damageFormula || '—'}</span>
            {editable && (
              <button type="button" className="ht-step ml-auto text-red-400"
                onClick={() => dispatch({ t: 'removeEquipment', id: p.entryId })}>✕</button>
            )}
          </div>
        ))}
      </div>

      <StepTable<RefShipWeapon>
        items={rows}
        columns={[
          { key: 'name', label: 'Weapon', flex: 2, value: (w) => w.name },
          { key: 'category', label: 'Class', value: (w) => w.category },
          { key: 'damage', label: 'Damage', value: (w) => w.damageParts[0]?.[0] ?? '—' },
          { key: 'range', label: 'Range', value: (w) => w.rangeNormal ?? 0 },
        ]}
        idOf={(w) => w.id}
        searchText={(w) => `${w.name} ${w.category} ${w.damageParts[0]?.[1] ?? ''}`}
        detail={(w) => w.description || 'No description in the pack.'}
        // Weapons stack: several hardpoints may hold the same model, so a row is
        // "selected" when at least one entry references it, and select always adds.
        isSelected={(w) => build.equipment.some((e) => e.kind === 'weapon' && e.ref === w.id)}
        onSelect={(w) => dispatch({ t: 'installEquipment', ref: w.id, kind: 'weapon', mount: 'fixed-forward' })}
        selectLabel={() => '✓ install on a hardpoint'}
        editable={editable}
      />
    </div>
  );
}
```

- [ ] **Step 2: Write the Modifications step**

```tsx
// apps/swdnd/src/panels/ShipSheet/Builder/steps/Modifications.tsx
import StepTable from '../../../CharacterSheet/Builder/StepTable';
import type { ShipBuildAction } from '../../../../lib/shipBuildState';
import type {
  DerivedShip, RefShipModification, ShipBuild, ShipReferenceData,
} from '../../../../lib/shipRules/types';

export default function ModificationsStep({
  build, ref, derived, editable, dispatch,
}: {
  build: ShipBuild;
  ref: ShipReferenceData;
  derived: DerivedShip;
  editable: boolean;
  dispatch: (a: ShipBuildAction) => void;
}) {
  const rows = Object.values(ref.modifications)
    .sort((a, b) => a.system.localeCompare(b.system) || a.grade - b.grade || a.name.localeCompare(b.name));
  const installed = new Set(build.modifications);
  const names = new Set(build.modifications.map((id) => ref.modifications[id]?.name).filter(Boolean));
  const slotsOver = derived.modSlotsUsed > derived.modSlotsMax;
  const suitesOver = derived.suitesUsed > derived.suitesMax;

  return (
    <StepTable<RefShipModification>
      items={rows}
      columns={[
        { key: 'name', label: 'Modification', flex: 2, value: (m) => m.name },
        { key: 'system', label: 'System', value: (m) => m.system },
        { key: 'grade', label: 'Grade', value: (m) => m.grade },
        { key: 'cost', label: 'Credits', value: (m) => m.baseCost ?? 0 },
      ]}
      idOf={(m) => m.id}
      searchText={(m) => `${m.name} ${m.system} grade ${m.grade}`}
      detail={(m) => m.description || 'No description in the pack.'}
      isSelected={(m) => installed.has(m.id)}
      onSelect={(m) => dispatch({ t: 'toggleModification', ref: m.id })}
      // Prerequisites are prose names in the pack; surface them as a warning
      // rather than a hard block — the table is house-rule friendly.
      disabledReason={(m) =>
        !installed.has(m.id) && m.prerequisite && !names.has(m.prerequisite)
          ? `requires ${m.prerequisite}`
          : null}
      editable={editable}
      header={
        <div className={`ht-label px-1 ${slotsOver || suitesOver ? 'text-yellow-300' : ''}`}>
          {derived.modSlotsUsed}/{derived.modSlotsMax} slots · suite {derived.suitesUsed}/{derived.suitesMax}
          {(slotsOver || suitesOver) && ' — over budget (⌂ to house-rule)'}
        </div>
      }
    />
  );
}
```

- [ ] **Step 3: Wire both into the Builder shell**

In `apps/swdnd/src/panels/ShipSheet/Builder/index.tsx`, add:

```tsx
import WeaponsStep from './steps/Weapons';
import ModificationsStep from './steps/Modifications';
```

and replace the remaining placeholder comment with:

```tsx
          {active === 'weapons' && (
            <WeaponsStep build={b.build} ref={b.ref} derived={b.derived} editable={b.canEdit} dispatch={b.dispatch} />
          )}
          {active === 'modifications' && (
            <ModificationsStep build={b.build} ref={b.ref} derived={b.derived} editable={b.canEdit} dispatch={b.dispatch} />
          )}
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/swdnd && bun run build` → succeeds (no unused imports left behind).

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/panels/ShipSheet/Builder/steps/Weapons.tsx apps/swdnd/src/panels/ShipSheet/Builder/steps/Modifications.tsx apps/swdnd/src/panels/ShipSheet/Builder/index.tsx
git commit -m "feat(swdnd): ship builder weapons and modifications steps"
```

---

### Task 27: Sheet — core bar, the two pool bars, conditions and system damage

**Files:**
- Create: `apps/swdnd/src/panels/ShipSheet/Sheet/ShipConditionsMenu.tsx`
- Create: `apps/swdnd/src/panels/ShipSheet/Sheet/PoolBar.tsx`
- Create: `apps/swdnd/src/panels/ShipSheet/Sheet/ShipCoreBar.tsx`

**Interfaces:**

Consumes:
```ts
// ../../CharacterSheet/Sheet/Stepper  (REUSED verbatim)
export default function Stepper(props: {
  value: number; max?: number; editable: boolean;
  onDelta: (delta: number) => void; onSet?: (value: number) => void;
}): JSX.Element;
// ../../../lib/shipRules/constants
export function shipConditionOptions(): string[];
export const MAX_SYSTEM_DAMAGE: number;
// ../../../lib/shipPlayState
export type ShipPlayAction =
  | { t: 'damage'; n: number } | { t: 'repairHull'; n: number } | { t: 'restoreShields'; n: number }
  | { t: 'setHull'; n: number } | { t: 'setShields'; n: number }
  | { t: 'spendHullDie' } | { t: 'regainHullDie' } | { t: 'spendShieldDie' } | { t: 'regainShieldDie' }
  | { t: 'spendAmmo'; entryId: string; n: number } | { t: 'reloadAmmo'; entryId: string }
  | { t: 'addCondition'; c: string } | { t: 'removeCondition'; c: string }
  | { t: 'setSystemDamage'; n: number } | { t: 'setNotes'; notes: string };
// ../../../components/split
export function PanelLink(props: { to: Panel; current?: Panel; className?: string; children: ReactNode; title?: string }): JSX.Element;
```

Produces:
```tsx
// apps/swdnd/src/panels/ShipSheet/Sheet/ShipConditionsMenu.tsx
export default function ShipConditionsMenu(props: {
  active: string[]; editable: boolean; onAdd: (c: string) => void; onRemove: (c: string) => void;
}): JSX.Element;

// apps/swdnd/src/panels/ShipSheet/Sheet/PoolBar.tsx
export default function PoolBar(props: {
  label: string; value: number; max: number; tone: 'shields' | 'hull'; editable: boolean;
  diceLabel: string; diceRemaining: number; diceMax: number;
  onDelta: (d: number) => void; onSet: (v: number) => void;
  onSpendDie: () => void; onRegainDie: () => void;
  action?: { label: string; title: string; onClick: () => void };
}): JSX.Element;

// apps/swdnd/src/panels/ShipSheet/Sheet/ShipCoreBar.tsx
export default function ShipCoreBar(props: {
  shipId: string; build: ShipBuild; derived: DerivedShip; play: ShipPlayState;
  editable: boolean; campaignId: string | null;
  dispatch: (a: ShipPlayAction) => void;
  onPatchHull: () => void; onRegenerateShields: () => void;
}): JSX.Element;
```

- [ ] **Step 1: Write the ship conditions menu**

```tsx
// apps/swdnd/src/panels/ShipSheet/Sheet/ShipConditionsMenu.tsx
// Same interaction as CharacterSheet/Sheet/ConditionsMenu, over the SOTG ship
// condition vocabulary (levelled Slowed 1-4 included; the play reducer keeps
// only one level of a family at a time).
import { useState } from 'react';
import { shipConditionOptions } from '../../../lib/shipRules/constants';

interface Props {
  active: string[];
  editable: boolean;
  onAdd: (c: string) => void;
  onRemove: (c: string) => void;
}

export default function ShipConditionsMenu({ active, editable, onAdd, onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const available = shipConditionOptions().filter((c) => !active.includes(c));

  return (
    <div className="flex flex-wrap items-center justify-start gap-1.5 @lg:justify-end">
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
            <div className="ht-panel absolute left-0 z-10 mt-1 max-h-56 w-44 overflow-auto p-1 text-[11px] @lg:left-auto @lg:right-0">
              {available.length === 0 && <div className="p-1 text-ht-muted">All applied</div>}
              {available.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="block w-full rounded px-2 py-1 text-left text-ht-text hover:bg-white/5"
                  onClick={() => { onAdd(c); setOpen(false); }}
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

- [ ] **Step 2: Write the pool bar**

```tsx
// apps/swdnd/src/panels/ShipSheet/Sheet/PoolBar.tsx
// A labelled pool with a filled track, a stepper, its dice pool, and one
// optional one-tap action (Regenerate / Patch).
import Stepper from '../../CharacterSheet/Sheet/Stepper';

interface Props {
  label: string;
  value: number;
  max: number;
  tone: 'shields' | 'hull';
  editable: boolean;
  diceLabel: string;
  diceRemaining: number;
  diceMax: number;
  onDelta: (d: number) => void;
  onSet: (v: number) => void;
  onSpendDie: () => void;
  onRegainDie: () => void;
  action?: { label: string; title: string; onClick: () => void };
}

const TRACK: Record<Props['tone'], string> = {
  shields: 'bg-sky-400/70',
  hull: 'bg-amber-400/70',
};

export default function PoolBar({
  label, value, max, tone, editable, diceLabel, diceRemaining, diceMax,
  onDelta, onSet, onSpendDie, onRegainDie, action,
}: Props) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="ht-panel px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="ht-label min-w-[64px]">{label}</span>
        <Stepper value={value} max={max} editable={editable} onDelta={onDelta} onSet={onSet} />
        {action && (
          <button type="button" className="ht-step ml-auto text-[10px]" disabled={!editable}
            title={action.title} onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-white/10">
        <div className={`h-full ${TRACK[tone]}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 flex items-center gap-2 text-[10px] text-ht-muted">
        <span>{diceLabel} {diceRemaining}/{diceMax}</span>
        {editable && (
          <span>
            <button type="button" className="ht-step" title="spend one die" onClick={onSpendDie}>−</button>
            <button type="button" className="ht-step" title="regain one die" onClick={onRegainDie}>+</button>
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write the core bar**

```tsx
// apps/swdnd/src/panels/ShipSheet/Sheet/ShipCoreBar.tsx
import { Link, useLocation } from 'react-router-dom';
import { PanelLink } from '../../../components/split';
import { MAX_SYSTEM_DAMAGE } from '../../../lib/shipRules/constants';
import type { ShipPlayAction } from '../../../lib/shipPlayState';
import type { DerivedShip, ShipBuild, ShipPlayState } from '../../../lib/shipRules/types';
import PoolBar from './PoolBar';
import ShipConditionsMenu from './ShipConditionsMenu';

interface Props {
  shipId: string;
  build: ShipBuild;
  derived: DerivedShip;
  play: ShipPlayState;
  editable: boolean;
  campaignId: string | null;
  dispatch: (a: ShipPlayAction) => void;
  onPatchHull: () => void;
  onRegenerateShields: () => void;
}

const remaining = (max: number, spent: number) => Math.max(0, max - spent);

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="ht-panel px-3 py-2 text-center">
      <div className="ht-label">{label}</div>
      <b className="text-base text-ht-bright">{value}</b>
    </div>
  );
}

export default function ShipCoreBar({
  shipId, build, derived, play, editable, campaignId, dispatch, onPatchHull, onRegenerateShields,
}: Props) {
  const { search } = useLocation(); // carry ?token=… into the builder
  return (
    <div className="ht-glow flex flex-wrap items-start gap-2 rounded-md p-3">
      <div className="min-w-[140px]">
        <div className="ht-name font-mono text-sm font-bold">{build.identity.name || 'Unnamed ship'}</div>
        <div className="text-[10px] text-ht-muted">tier {derived.tier} · {derived.rateOfFireCap} weapons/round</div>
        <Link to={`/ship/${shipId}/build${search}`} className="ht-label" style={{ cursor: 'pointer' }}>✎ Refit ▸</Link>
        {campaignId && (
          <PanelLink
            to={{ kind: 'map', id: campaignId }}
            current={{ kind: 'ship', id: shipId }}
            className="ht-label block"
            title="open the campaign map (alt-click: beside the ship)"
          >
            ⬡ Map ▸
          </PanelLink>
        )}
      </div>

      {/* Shields OVER hull — the double ring the map mode will mirror. */}
      <div className="flex min-w-[220px] flex-col gap-2">
        <PoolBar
          label="Shields" tone="shields" value={play.shields} max={derived.maxShields} editable={editable}
          diceLabel={`d${derived.shieldDice.die}`}
          diceRemaining={remaining(derived.shieldDice.count, play.shieldDiceSpent)}
          diceMax={derived.shieldDice.count}
          onDelta={(d) => dispatch(d < 0 ? { t: 'damage', n: -d } : { t: 'restoreShields', n: d })}
          onSet={(v) => dispatch({ t: 'setShields', n: v })}
          onSpendDie={() => dispatch({ t: 'spendShieldDie' })}
          onRegainDie={() => dispatch({ t: 'regainShieldDie' })}
          action={{
            label: `⟳ Regenerate (+${derived.shieldRegen})`,
            title: 'spend a shield die, roll it, and restore the result',
            onClick: onRegenerateShields,
          }}
        />
        <PoolBar
          label="Hull" tone="hull" value={play.hull} max={derived.maxHull} editable={editable}
          diceLabel={`d${derived.hullDice.die}`}
          diceRemaining={remaining(derived.hullDice.count, play.hullDiceSpent)}
          diceMax={derived.hullDice.count}
          onDelta={(d) => dispatch(d < 0 ? { t: 'damage', n: -d } : { t: 'repairHull', n: d })}
          onSet={(v) => dispatch({ t: 'setHull', n: v })}
          onSpendDie={() => dispatch({ t: 'spendHullDie' })}
          onRegainDie={() => dispatch({ t: 'regainHullDie' })}
          action={{
            label: '✚ Patch',
            title: 'spend a hull die, roll it, and repair the result',
            onClick: onPatchHull,
          }}
        />
      </div>

      {/* One flex child so AC…Turn wrap together, never split. */}
      <div className="flex gap-2">
        <Stat label="AC" value={derived.armorClass} />
        <Stat label="DR" value={derived.damageReduction} />
        <Stat label="Speed" value={derived.speed} />
        <Stat label="Turn" value={derived.turnSpeed} />
      </div>

      <div className="flex w-full flex-row flex-wrap items-center gap-2 @lg:ml-auto @lg:w-auto @lg:flex-col @lg:items-end @lg:gap-1">
        <ShipConditionsMenu
          active={play.conditions} editable={editable}
          onAdd={(c) => dispatch({ t: 'addCondition', c })}
          onRemove={(c) => dispatch({ t: 'removeCondition', c })}
        />
        <div className="flex items-center gap-2 text-[10px] text-ht-muted">
          {/* System damage is its own 0-6 field, never a condition string. */}
          <span>System damage {play.systemDamage}/{MAX_SYSTEM_DAMAGE}</span>
          {editable && (
            <span>
              <button type="button" className="ht-step"
                onClick={() => dispatch({ t: 'setSystemDamage', n: play.systemDamage - 1 })}>−</button>
              <button type="button" className="ht-step"
                onClick={() => dispatch({ t: 'setSystemDamage', n: play.systemDamage + 1 })}>+</button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/swdnd && bun run build`
Expect: FAILS on `ShipCoreBar.tsx` with `Type '"ship"' is not assignable to type 'PanelKind'` — `PanelKind` does not gain `'ship'` until Task 29. Leave it: Task 28 finishes the sheet and Task 29 fixes the kind. If a green typecheck is wanted at this commit, temporarily drop the `<PanelLink>` block and restore it in Task 29 — record whichever you choose in the commit body.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/panels/ShipSheet/Sheet/ShipConditionsMenu.tsx apps/swdnd/src/panels/ShipSheet/Sheet/PoolBar.tsx apps/swdnd/src/panels/ShipSheet/Sheet/ShipCoreBar.tsx
git commit -m "feat(swdnd): ship sheet core bar with shields-over-hull pools"
```

---

### Task 28: Sheet — weapons panel, crew strip, and the Sheet shell

**Files:**
- Create: `apps/swdnd/src/panels/ShipSheet/Sheet/ShipWeapons.tsx`
- Create: `apps/swdnd/src/panels/ShipSheet/Sheet/CrewStrip.tsx`
- Create: `apps/swdnd/src/panels/ShipSheet/Sheet/index.tsx`

**Interfaces:**

Consumes:
```ts
// ../../../hooks/useShipSheet
export function useShipSheet(shipId: string): ShipSheetState;   // see Task 23
// ../../../lib/dice
export function rollD20(mod: number, rng?: Rng): { kept: number; total: number };
export function parseFormula(input: string): FormulaTerms | null;
export function rollFormula(terms: FormulaTerms, rng?: Rng): { total: number; rolls: { sides: number; value: number }[]; formula: string };
// ../../../lib/rolls
export function postRoll(campaignId: string, body: PostRollBody, token?: string | null): Promise<RollDto>;
// ../../CharacterSheet/Sheet/RollToast  (REUSED)
export function useRolls(): { rolls: RollLine[]; pushRoll: (label: string, detail: string, total: number) => void };
export default function RollToast(props: { rolls: RollLine[] }): JSX.Element | null;
// ../../CharacterSheet/Sheet/TabbedShell  (REUSED)
export default function TabbedShell(props: { tabs: Array<{ key: string; label: string; content: ReactNode }> }): JSX.Element;
// ../../../lib/starships
export interface ShipCrewMember { character_id: string; character_name: string; role: ShipRole }
```

Produces:
```tsx
// apps/swdnd/src/panels/ShipSheet/Sheet/ShipWeapons.tsx
export default function ShipWeapons(props: {
  derived: DerivedShip; play: ShipPlayState; editable: boolean;
  dispatch: (a: ShipPlayAction) => void;
  onRoll: (label: string, mod: number) => void;
  onRollDamage: (label: string, formula: string) => void;
}): JSX.Element;

// apps/swdnd/src/panels/ShipSheet/Sheet/CrewStrip.tsx
export default function CrewStrip(props: { shipId: string; crew: ShipCrewMember[] }): JSX.Element;

// apps/swdnd/src/panels/ShipSheet/Sheet/index.tsx
export default function ShipSheetView(props: { shipId: string }): JSX.Element;
```

- [ ] **Step 1: Write the weapons panel**

```tsx
// apps/swdnd/src/panels/ShipSheet/Sheet/ShipWeapons.tsx
import type { ShipPlayAction } from '../../../lib/shipPlayState';
import type { DerivedShip, ShipPlayState } from '../../../lib/shipRules/types';

const MOUNT_LABEL: Record<string, string> = {
  'fixed-forward': 'fwd', 'fixed-aft': 'aft', 'fixed-port': 'port',
  'fixed-starboard': 'stbd', turret: 'turret',
};

export default function ShipWeapons({
  derived, play, editable, dispatch, onRoll, onRollDamage,
}: {
  derived: DerivedShip;
  play: ShipPlayState;
  editable: boolean;
  dispatch: (a: ShipPlayAction) => void;
  onRoll: (label: string, mod: number) => void;
  onRollDamage: (label: string, formula: string) => void;
}) {
  return (
    <div className="ht-panel p-2 font-mono text-[11px]">
      <div className="ht-label mb-1">Weapons — {derived.rateOfFireCap} per round</div>
      {derived.weapons.length === 0 && <div className="text-ht-muted">No weapons installed.</div>}
      {derived.weapons.map((w) => {
        const spent = play.ammoSpent[w.entryId] ?? 0;
        return (
          <div key={w.entryId} className="flex flex-wrap items-baseline gap-2 border-b border-ht-line/40 py-1 last:border-0">
            <span className="min-w-[130px] flex-1 truncate text-ht-text" title={`${w.category} · ${MOUNT_LABEL[w.mount] ?? w.mount}`}>
              {w.name}
            </span>
            {w.saveDc == null ? (
              <button type="button" className="ht-step" title="roll to hit (add your own proficiency)"
                onClick={() => onRoll(`${w.name} attack`, w.attackShipMod)}>
                {/* The ship supplies WIS; the gunner's proficiency is a crew stat
                    the spine does not know — hence the literal suffix. */}
                {w.attackText}
              </button>
            ) : (
              <span className="text-ht-muted">DC {w.saveDc} {w.saveAbility.toUpperCase()}</span>
            )}
            {w.damageFormula && (
              <button type="button" className="ht-step" title={`roll ${w.damageType} damage`}
                onClick={() => onRollDamage(`${w.name} damage`, w.damageFormula)}>
                {w.damageFormula}
              </button>
            )}
            {w.rangeNormal != null && (
              <span className="text-[10px] text-ht-muted">{w.rangeNormal}{w.rangeLong ? `/${w.rangeLong}` : ''} ft</span>
            )}
            {w.usesAmmo && (
              <span className="flex items-center gap-1 text-[10px] text-ht-muted">
                ammo −{spent}
                {editable && (
                  <>
                    <button type="button" className="ht-step" title="fire one"
                      onClick={() => dispatch({ t: 'spendAmmo', entryId: w.entryId, n: 1 })}>−</button>
                    <button type="button" className="ht-step" title="reload"
                      onClick={() => dispatch({ t: 'reloadAmmo', entryId: w.entryId })}>⟳</button>
                  </>
                )}
                {w.reload != null && <span>cap {w.reload}</span>}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Write the crew strip**

```tsx
// apps/swdnd/src/panels/ShipSheet/Sheet/CrewStrip.tsx
import { PanelLink } from '../../../components/split';
import type { ShipCrewMember } from '../../../lib/starships';

export default function CrewStrip({ shipId, crew }: { shipId: string; crew: ShipCrewMember[] }) {
  return (
    <div className="ht-panel p-2 font-mono text-[11px]">
      <div className="ht-label mb-1">Crew</div>
      {crew.length === 0 && (
        <div className="text-ht-muted">
          Nobody aboard — assign a character in the refit screen. Only crew (and the DM) may edit this ship.
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {crew.map((m) => (
          <PanelLink
            key={`${m.character_id}:${m.role}`}
            to={{ kind: 'sheet', id: m.character_id }}
            current={{ kind: 'ship', id: shipId }}
            className="ht-step"
            title="open this character's sheet (alt-click: beside the ship)"
          >
            {m.character_name} <span className="text-ht-muted">· {m.role}</span>
          </PanelLink>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write the Sheet shell**

```tsx
// apps/swdnd/src/panels/ShipSheet/Sheet/index.tsx
import { useSearchParams } from 'react-router-dom';
import { useShipSheet } from '../../../hooks/useShipSheet';
import { parseFormula, rollD20, rollFormula } from '../../../lib/dice';
import { postRoll } from '../../../lib/rolls';
import RollToast, { useRolls } from '../../CharacterSheet/Sheet/RollToast';
import TabbedShell from '../../CharacterSheet/Sheet/TabbedShell';
import ShipCoreBar from './ShipCoreBar';
import ShipWeapons from './ShipWeapons';
import CrewStrip from './CrewStrip';

export default function ShipSheetView({ shipId }: { shipId: string }) {
  const s = useShipSheet(shipId);
  const { rolls, pushRoll } = useRolls();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  if (s.loading) return <div className="p-6 font-mono text-ht-muted">Loading ship…</div>;
  // Only a LOAD failure is fatal; a failed save renders as a banner over live data.
  if (!s.build || !s.derived || !s.play || !s.ref) {
    return <div className="p-6 font-mono text-red-400">{s.error ?? 'Starship not found'}</div>;
  }

  const derived = s.derived;
  const play = s.play;
  const shipName = s.build.identity.name || 'Starship';

  const log = (label: string, formula: string, dice: { sides: number; value: number }[], total: number) => {
    pushRoll(label, formula, total);
    // Fire-and-forget into the campaign roll log — a failed POST never blocks the local toast.
    if (s.dto) {
      void postRoll(s.dto.campaign_id, { roller: shipName, label, formula, rolls: dice, total }, token)
        .catch(() => { /* anon viewer or offline: local roll still shows */ });
    }
  };

  const roll = (label: string, mod: number) => {
    const r = rollD20(mod);
    log(label, mod === 0 ? '1d20' : `1d20${mod >= 0 ? '+' : ''}${mod}`, [{ sides: 20, value: r.kept }], r.total);
  };

  const rollDamage = (label: string, formula: string) => {
    const terms = parseFormula(formula);
    if (!terms) return;
    const r = rollFormula(terms);
    log(label, r.formula, r.rolls, r.total);
  };

  /** Roll one pool die + the relevant modifier, log it, and apply the result. */
  const rollPoolDie = (label: string, sides: number, mod: number, apply: (total: number) => void) => {
    const formula = mod === 0 ? `1d${sides}` : `1d${sides}${mod >= 0 ? '+' : ''}${mod}`;
    const terms = parseFormula(formula);
    if (!terms) return;
    const r = rollFormula(terms);
    log(label, r.formula, r.rolls, r.total);
    apply(Math.max(0, r.total));
  };

  // The accompanying ability check stays a table call — the app never gates on it.
  const onPatchHull = () => {
    s.dispatch({ t: 'spendHullDie' });
    rollPoolDie('Patch hull', derived.hullDice.die, derived.abilities.con.mod,
      (total) => s.dispatch({ t: 'repairHull', n: total }));
  };
  const onRegenerateShields = () => {
    s.dispatch({ t: 'spendShieldDie' });
    rollPoolDie('Regenerate shields', derived.shieldDice.die, derived.abilities.str.mod,
      (total) => s.dispatch({ t: 'restoreShields', n: total }));
  };

  const colWeapons = (
    <div className="flex flex-col gap-3">
      <ShipWeapons derived={derived} play={play} editable={s.canEdit} dispatch={s.dispatch}
        onRoll={roll} onRollDamage={rollDamage} />
      <CrewStrip shipId={shipId} crew={s.crew} />
    </div>
  );
  const colNotes = (
    <div className="ht-panel p-2 font-mono text-[11px]">
      <div className="ht-label mb-1">Notes</div>
      <textarea
        className="h-40 w-full resize-y bg-transparent text-ht-text outline-none"
        placeholder="damage reports, cargo, the smell…"
        disabled={!s.canEdit}
        value={play.notes}
        onChange={(e) => s.dispatch({ t: 'setNotes', notes: e.target.value })}
      />
    </div>
  );

  return (
    <div className="@container ht-screen min-h-screen p-3 text-ht-text">
      {s.error && (
        <div className="mb-2 rounded border border-red-400/60 bg-red-950/40 px-3 py-1.5 font-mono text-[11px] text-red-300">
          ⚠ {s.error} — changes may not be saved
        </div>
      )}
      <ShipCoreBar
        shipId={shipId} build={s.build} derived={derived} play={play}
        editable={s.canEdit} campaignId={s.dto?.campaign_id ?? null}
        dispatch={s.dispatch} onPatchHull={onPatchHull} onRegenerateShields={onRegenerateShields}
      />

      {/* Wide: two columns */}
      <div className="mt-3 hidden gap-3 @lg:grid @lg:grid-cols-2">
        {colWeapons}{colNotes}
      </div>

      {/* Narrow / medium: tabs */}
      <div className="@lg:hidden">
        <TabbedShell tabs={[
          { key: 'weapons', label: 'Weapons', content: colWeapons },
          { key: 'notes', label: 'Notes', content: colNotes },
        ]} />
      </div>

      <RollToast rolls={rolls} />
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/swdnd && bun run build`
Expect: still fails only on the two `{ kind: 'ship' }` literals (`ShipCoreBar.tsx`, `CrewStrip.tsx`) until Task 29 widens `PanelKind`. No other errors.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/panels/ShipSheet/Sheet/ShipWeapons.tsx apps/swdnd/src/panels/ShipSheet/Sheet/CrewStrip.tsx apps/swdnd/src/panels/ShipSheet/Sheet/index.tsx
git commit -m "feat(swdnd): ship play sheet with weapon rolls and crew strip"
```

---

### Task 29: The `'ship'` panel kind, routes, and split integration

**Files:**
- Create: `apps/swdnd/src/panels/ShipSheet/index.tsx`
- Modify: `apps/swdnd/src/lib/panels.ts`
- Modify: `apps/swdnd/src/lib/panels.test.ts`
- Modify: `apps/swdnd/src/App.tsx`
- Modify: `apps/swdnd/src/components/SplitPage.tsx`

**Interfaces:**

Consumes: `ShipBuilder` (Task 24), `ShipSheetView` (Task 28), `getStarship` (Task 10).

Produces:
```ts
// apps/swdnd/src/lib/panels.ts
export type PanelKind = 'sheet' | 'map' | 'dm' | 'ship';   // widened
// panelPath({kind:'ship', id}) === `/ship/${id}`

// apps/swdnd/src/panels/ShipSheet/index.tsx
export default function ShipSheet(props: { shipId: string }): JSX.Element;

// apps/swdnd/src/App.tsx routes added:
//   /ship/:shipId          -> play view
//   /ship/:shipId/:mode    -> 'build' renders the Builder
```

- [ ] **Step 1: Write the failing test**

Append to `apps/swdnd/src/lib/panels.test.ts` (add `shipS` beside the other fixtures at the top of the file):

```ts
const shipS: Panel = { kind: 'ship', id: 's' };

describe('ship panels', () => {
  test('parse/format round-trip and the full-screen path', () => {
    expect(parsePanel(formatPanel(shipS))).toEqual(shipS);
    expect(panelPath(shipS)).toBe('/ship/s');
    expect(parsePanel('ship:s')).toEqual(shipS);
    expect(parsePanel('ship:')).toBeNull();
  });

  test('a ship never collides with a same-id sheet or map', () => {
    expect(samePanel(shipS, { kind: 'sheet', id: 's' })).toBe(false);
    expect(samePanel(shipS, { kind: 'ship', id: 's' })).toBe(true);
  });

  test('ship <-> map and ship <-> sheet splits come free from navigateFrom', () => {
    expect(navigateFrom(null, shipS, mapC, true)).toBe('/split/ship:s/map:c');
    expect(navigateFrom(null, sheetA, shipS, true)).toBe('/split/sheet:a/ship:s');
    const ctxLeft = { left: shipS, right: mapC, side: 'left' as const };
    expect(navigateFrom(ctxLeft, shipS, sheetA, false)).toBe('/split/sheet:a/map:c');
    expect(navigateFrom(ctxLeft, shipS, mapC, false)).toBe('/map/c');   // collapse
    expect(navigateFrom(ctxLeft, shipS, dmC, true)).toBe('/split/ship:s/dm:c');
  });
});
```

- [ ] **Step 2: Run it and confirm the failure**

Run: `bun test apps/swdnd/src/lib/panels.test.ts`
Expect: `3 fail` — `parsePanel('ship:s')` returns `null` because `'ship'` is not in `KINDS`, and `panelPath` falls through to `/dm/s`.

- [ ] **Step 3: Widen `PanelKind`**

In `apps/swdnd/src/lib/panels.ts`:

```ts
export type PanelKind = 'sheet' | 'map' | 'dm' | 'ship';
```

```ts
const KINDS: readonly string[] = ['sheet', 'map', 'dm', 'ship'];
```

```ts
/** The panel's full-screen route. */
export function panelPath(p: Panel): string {
  if (p.kind === 'sheet') return `/sheet/${p.id}`;
  if (p.kind === 'map') return `/map/${p.id}`;
  if (p.kind === 'ship') return `/ship/${p.id}`;
  return `/dm/${p.id}`;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test apps/swdnd/src/lib/panels.test.ts` → all pass, including the 3 new cases.

- [ ] **Step 5: Write the panel mode switch**

```tsx
// apps/swdnd/src/panels/ShipSheet/index.tsx
import { useParams } from 'react-router-dom';
import ShipBuilder from './Builder';
import ShipSheetView from './Sheet';

export default function ShipSheet({ shipId }: { shipId: string }) {
  const { mode } = useParams();
  if (mode === 'build') {
    return <ShipBuilder key={shipId} shipId={shipId} />;
  }
  // key: a ship change must remount. Without it, client-side navigation A→B
  // keeps A's loaded state, so a failed load of B would render A's live sheet
  // under B's URL; remounting also strands A's pending save-timer/WS closures
  // on the dead instance instead of leaking into B.
  return <ShipSheetView key={shipId} shipId={shipId} />;
}
```

- [ ] **Step 6: Add the routes**

In `apps/swdnd/src/App.tsx`, add the import:

```tsx
import ShipSheet from "./panels/ShipSheet";
import { getStarship } from "./lib/starships";
```

Add a `ShipPage` beside `SheetPage` (same RollDock/RollTrigger wiring):

```tsx
function ShipPage() {
  const { shipId = "" } = useParams();
  const [campaignId, setCampaignId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getStarship(shipId)
      .then((s) => alive && setCampaignId(s.campaign_id))
      .catch(() => alive && setCampaignId(null));
    return () => {
      alive = false;
    };
  }, [shipId]);
  const body = (
    <>
      <ShipSheet shipId={shipId} />
      {campaignId && <RollDock campaignId={campaignId} />}
    </>
  );
  return (
    <SinglePanel>
      {campaignId ? <RollTriggerProvider campaignId={campaignId}>{body}</RollTriggerProvider> : body}
    </SinglePanel>
  );
}
```

And register both routes beside the sheet routes:

```tsx
          <Route path="/ship/:shipId" element={<ShipPage />} />
          <Route path="/ship/:shipId/:mode" element={<ShipPage />} />
```

- [ ] **Step 7: Render ship panels inside splits**

In `apps/swdnd/src/components/SplitPage.tsx`, add the import and extend `PanelBody`:

```tsx
import ShipSheet from '../panels/ShipSheet';
```

```tsx
function PanelBody({ panel }: { panel: Panel }) {
  if (panel.kind === 'sheet') return <CharacterSheet characterId={panel.id} />;
  if (panel.kind === 'ship') return <ShipSheet shipId={panel.id} />;
  if (panel.kind === 'map') return <Tabletop campaignId={panel.id} />;
  return <DMScreen campaignId={panel.id} />;
}
```

Also widen the RollDock campaign resolution so a lone ship panel still gets a dock. Replace the `direct` / `sheetId` block with:

```tsx
  // The page's single RollDock: first map/dm campaign id (left first), else
  // resolve a sheet or ship panel's campaign with a one-shot fetch.
  const direct = [l, r].find((p) => p && p.kind !== 'sheet' && p.kind !== 'ship')?.id ?? null;
  const entity = direct ? null : ([l, r].find((p) => p?.kind === 'sheet' || p?.kind === 'ship') ?? null);
  const [entityCampaign, setEntityCampaign] = useState<string | null>(null);
  useEffect(() => {
    setEntityCampaign(null);
    if (!entity) return;
    let alive = true;
    const load = entity.kind === 'ship' ? getStarship(entity.id) : getCharacter(entity.id);
    load
      .then((row) => alive && setEntityCampaign(row.campaign_id))
      .catch(() => {});
    return () => { alive = false; };
  }, [entity?.kind, entity?.id]);
  const dockCampaign = direct ?? entityCampaign;
```

and add `import { getStarship } from '../lib/starships';` at the top. Update the "Unknown panel" hint text to mention `ship:&lt;id&gt;`.

- [ ] **Step 8: Typecheck and run the full suite**

Run: `cd apps/swdnd && bun run build` → succeeds (the `{ kind: 'ship' }` literals from Tasks 27–28 now typecheck).
Run: `bun test` → `435 pass, 0 fail`.

- [ ] **Step 9: Commit**

```bash
git add apps/swdnd/src/panels/ShipSheet/index.tsx apps/swdnd/src/lib/panels.ts apps/swdnd/src/lib/panels.test.ts apps/swdnd/src/App.tsx apps/swdnd/src/components/SplitPage.tsx
git commit -m "feat(swdnd): ship panel kind, routes and split-view integration"
```

---

### Task 30: Entry links — DM admin drawer and PlayerHome

**Files:**
- Modify: `apps/swdnd/src/panels/DMScreen/AdminDrawer.tsx`
- Modify: `apps/swdnd/src/panels/PlayerHome/index.tsx`

**Interfaces:**

Consumes:
```ts
// ../../lib/starships
export function listStarships(campaignId: string): Promise<StarshipDto[]>;
export function createStarship(campaignId: string, name: string, crew?: { characterId: string; role: ShipRole }, token?: string | null): Promise<StarshipDto>;
export function deleteStarship(id: string, token?: string | null): Promise<{ ok: boolean }>;
export interface StarshipDto { id: string; campaign_id: string; name: string; data_json: ShipBuild; created_at: string; updated_at: string; crew: ShipCrewMember[] }
// ../../lib/characters
export function getPlayerByToken(token: string): Promise<{ player: PlayerDto; characters: Array<{ id: string; name: string; campaign_id: string }> }>;
```

Produces: no new exports — two entry points into `/ship/:shipId`.

- [ ] **Step 1: Add the campaign ship list to the DM admin drawer**

`AdminDrawer` already receives `campaignId`. Add local state and a section beneath the existing roster block:

```tsx
import { useEffect, useState } from 'react';
import { createStarship, deleteStarship, listStarships, type StarshipDto } from '../../lib/starships';
```

```tsx
  const [ships, setShips] = useState<StarshipDto[]>([]);
  const [newShipName, setNewShipName] = useState('');

  const reloadShips = () => {
    void listStarships(campaignId).then(setShips).catch(() => setShips([]));
  };
  useEffect(reloadShips, [campaignId]);
```

```tsx
      <div className="ht-panel mt-3 p-3 text-[11px]">
        <div className="ht-label mb-2">Starships</div>
        {ships.length === 0 && <div className="text-ht-muted">No ships in this campaign yet.</div>}
        {ships.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2 py-1">
            <span className="min-w-[120px] text-ht-bright">{s.name}</span>
            <span className="text-[10px] text-ht-muted">
              {s.crew.length === 0 ? 'no crew' : s.crew.map((m) => m.character_name).join(', ')}
            </span>
            <span className="ml-auto flex gap-2">
              <PanelLink to={{ kind: 'ship', id: s.id }} current={{ kind: 'dm', id: campaignId }} className="ht-step">
                ship
              </PanelLink>
              <Link className="ht-step" to={`/ship/${s.id}/build`}>refit</Link>
              <button type="button" className="text-[10px] text-ht-muted"
                onClick={() => void deleteStarship(s.id).then(reloadShips)}>delete</button>
            </span>
          </div>
        ))}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            className="w-40 border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none"
            placeholder="new ship name…"
            value={newShipName}
            onChange={(e) => setNewShipName(e.target.value)}
          />
          <button
            type="button"
            className="ht-step"
            onClick={() => {
              if (!newShipName.trim()) return;
              // Admin creation may start with an empty roster.
              void createStarship(campaignId, newShipName.trim()).then(() => {
                setNewShipName('');
                reloadShips();
              });
            }}
          >
            + create ship
          </button>
        </div>
      </div>
```

If `AdminDrawer` does not already import `Link` from `react-router-dom` and `PanelLink` from `../../components/split`, add them.

- [ ] **Step 2: List the player's crewed ships on PlayerHome**

In `apps/swdnd/src/panels/PlayerHome/index.tsx`, add:

```tsx
import { listStarships, type StarshipDto } from '../../lib/starships';
```

```tsx
  const [ships, setShips] = useState<StarshipDto[]>([]);
```

Inside the existing `reload()` chain, after `setRows(...)`, add the ship fetch (a failure must not blank the character list):

```tsx
        const ownIds = new Set(me.characters.map((c) => c.id));
        // A player sees the ships their own characters crew — nothing else.
        const allShips = await listStarships(me.player.campaign_id).catch(() => [] as StarshipDto[]);
        setShips(allShips.filter((s) => s.crew.some((m) => ownIds.has(m.character_id))));
```

And render a section after the characters list:

```tsx
      <div className="ht-glow mb-3 mt-4 rounded-md p-3">
        <div className="ht-name text-sm font-bold">Your ships</div>
        <div className="text-[10px] text-ht-muted">ships your characters crew</div>
      </div>
      <div className="flex flex-col gap-2">
        {ships.length === 0 && (
          <div className="text-[11px] text-ht-muted">
            You are not crewing a ship yet — the DM (or a crewmate) can add one of your characters to a roster.
          </div>
        )}
        {ships.map((s) => (
          <div key={s.id} className="ht-panel flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-[140px]">
              <div className="text-ht-bright">{s.name}</div>
              <div className="text-[10px] text-ht-muted">
                {s.crew.filter((m) => m.character_name).map((m) => `${m.character_name} · ${m.role}`).join(' / ') || 'no crew'}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2 text-[11px]">
              <Link className="ht-step" to={`/ship/${s.id}?token=${encodeURIComponent(token)}`}>ship</Link>
              <Link className="ht-step" to={`/ship/${s.id}/build?token=${encodeURIComponent(token)}`}>refit</Link>
            </div>
          </div>
        ))}
      </div>
```

- [ ] **Step 3: Typecheck and run the full suite**

Run: `cd apps/swdnd && bun run build` → succeeds.
Run: `bun test` → `435 pass, 0 fail`.

- [ ] **Step 4: Commit**

```bash
git add apps/swdnd/src/panels/DMScreen/AdminDrawer.tsx apps/swdnd/src/panels/PlayerHome/index.tsx
git commit -m "feat(swdnd): starship entry links on the DM drawer and player home"
```

---

### Task 31: Final verification

**Files:** none (verification only; no commit unless a fix is needed).

**Interfaces:** consumes everything; produces nothing.

- [ ] **Step 1: Full test suite**

Run: `bun test`
Expect: `435 pass, 0 fail` across 66 files — the 329 pre-existing tests plus:
rider 7 · migration 3 · access 6 · routes 17 · shipRules/types 2 · constants 8 · mappers 6 · core 4 · defense 8 · movement 2 · weapons 7 · index 4 · integration 2 · buildState 11 · playState 8 · validation 8 · canEdit 4 · panels 3.
If the total differs, reconcile against the per-task counts before proceeding — a missing file means a task was skipped.

- [ ] **Step 2: Frontend typecheck + production build**

Run: `cd apps/swdnd && bun run build`
Expect: `tsc -b` clean (no unused locals/params) and a successful `vite build`.

- [ ] **Step 3: Confirm the OpenAPI surface**

Run: `bun start` in one shell, then in another:
`curl -s localhost:3000/openapi.json | grep -o '/swdnd/starships[^"]*'`
Expect the four ship paths: `/swdnd/starships/{id}`, `/swdnd/starships/{id}/crew`, plus `/swdnd/campaigns/{id}/starships`. Confirm `/docs` renders them under the `swdnd` tag.

- [ ] **Step 4: Manual walkthrough (the UI tasks' real verification)**

With the backend on `:3000` and `bun --cwd apps/swdnd run dev` (or `cd apps/swdnd && bun run dev`) pointed at it:

1. DM screen → admin drawer → create a ship. It appears in the list with "no crew".
2. Open `/ship/<id>/build`. Pick a size, set tier 2, allocate the four tier points, install armor + a shield generator, install two weapons, add a modification. The rail glyphs move ○ → ✓ and the summaries read as capacities ("2/3 hardpoints", "suite 0/1").
3. Push weapons past the hardpoint budget: the step turns `!` yellow. Press ⌂ on that step: it returns to ✓.
4. Back on `/ship/<id>`: shields sit above hull, both bars fill correctly, the stat row shows AC/DR/Speed/Turn.
5. Tap a weapon's attack: the toast and the campaign roll log both show the roll, and the attack button reads `+N + your proficiency`.
6. Tap **Patch**: a hull die is spent and the rolled total is applied to hull. Tap **Regenerate**: same for shields.
7. Add "Slowed 2", then "Slowed 4" — only one Slowed chip remains. Step system damage to 3; it is a number, not a chip.
8. Alt-click the crew strip's character link and the ⬡ Map link: both open a split (`/split/ship:…/…`), and ⛶ promotes a half.
9. Open the same ship in two browser windows; change hull in one — the other follows within a second (the `ship:updated` echo), and a rapid edit in the second window is not clobbered.
10. As a player: `/player?token=…` lists no ships. Have the DM add one of that player's characters to the roster, reload — the ship appears, and `/ship/<id>/build?token=…` is editable. Remove the character from the roster: the builder falls back to the read-only notice.

- [ ] **Step 5: Review the diff against the spec's scope boundary**

Confirm nothing crept in from the deferred sub-projects: no `token.ship_id`, no ship tokens or facing on the map, no deployments/ranks/prestige/power dice/tech die, no stock-ship browser or encounter integration, no cross-entity live recompute, and no weapon-category proficiency or fire modes on the character sheet.

Run: `git log --oneline main..HEAD` — expect one commit per task, with the rider (`feat(swdnd): per-weapon attack and damage rolls on the character sheet`) as the first and clearly separable from the rest.

- [ ] **Step 6: Record the outcome**

Append a short review section to this plan file noting the two VERIFY outcomes from Task 9 (hardpoint and modification-slot formulas: confirmed as written, or the corrected values), any deviation from the planned code, and the final test count. Commit it:

```bash
git add docs/superpowers/plans/2026-08-12-starship-spine.md
git commit -m "docs(swdnd): record starship spine plan outcomes"
```

---

## Review — outcomes (recorded 2026-08-13, Task 31)

**Final state:** 31/31 tasks complete + 1 verification-found gap fix. Suite **454 pass / 0 fail** across 68 files (baseline was 329/54). `tsc -b && vite build` clean. OpenAPI serves the four ship paths under the `swdnd` tag. Full 10-step walkthrough performed in-browser against a prod-mode (auth-enforced) local stack — all steps pass.

**Task 9 VERIFY outcomes:** hardpoint and modification-slot budget formulas have **no pack source** — implemented as this plan's stated `(size, tier)` defaults, warn-don't-block only. The vendor engine scales hardpoints/suites by STR/CON modifier instead; recorded in `constants.ts` comments as open discrepancies for the plan owner. Suite budget IS pack-sourced and verified exact.

**Plan text corrected during execution** (rules/data ground truth governed, per controller rulings; all fixes reviewed):
- Huge/Gargantuan gain **2** hull/shield dice per tier (vendor `actor.mjs:777,802,809`) — plan said 1.
- Shield capacity/regen round via **Math.round** (vendor `actor.mjs:1198`); no min-1 regen floor — plan floored and clamped.
- Weapon `ran` property is range-in-feet, not boolean (rider); shield rows map `baseAc: 0`; two amm-less launchers `usesAmmo: true` — plan's mappers coerced all three wrong against real rows.
- Task 20's sample code was right and its two test assertions wrong (zero-spend nudges; at-cap is done) — tests fixed, sample restored.
- Task 26's prerequisite check became a soft block (resolvable-name prereqs only, ⌂ bypass, prose prereqs informational) — plan's version permanently locked 81 mods.
- Regenerate Shields is **fixed-rate, unrolled** (SOTG passive regen; vendor formula is a constant); Patch rolls. Plan's sheet sample rolled both.
- Several plan-authored test gaps closed in fix rounds: vacuous 403 asserts, unpinned prod admin gates, unobservable `ship:updated` broadcasts (now pinned with exact key-set asserts + leak-checked module mocks).

**Verification-found gap:** crew assignment had no UI (wrappers existed, zero call sites; empty-state copy pointed at a nonexistent refit control). Added a canEdit-gated crew editor on the ship sheet (`CrewStrip`) with roster-refreshing `reload()` guarded against clobbering pending edits.

**Deferred to the whole-branch review:** the ledger at `.superpowers/sdd/2026-08-12-starship-spine/progress.md` carries ~45 triaged minors, the builder stale-play-snapshot Important (multi-user damage revert), the canEdit async-window flash (all four hooks), and two user decisions (budget-formula fidelity family; `usesAmmo` breadth).
