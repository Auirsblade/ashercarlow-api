# DM Ship Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the DM a fleet: ingest the 87 pre-built sw5e ships as a new `starships` reference table, browse them on the DM screen with real derived statblocks, add one to the campaign fleet or spawn it straight onto the active scene as a full `starship` row + ship token, watch every campaign ship live on a fleet rail, and put stock ships into encounter groups so "spawn all" drops squadrons.

**Architecture:** House pattern. Backend does data only: one new reference table fed by a new pack mapping (with a size-driven distillation at import time), one seed-idempotency fix so live deploys backfill the new table, and one additive column on `encounter`. Everything else is pure frontend `lib/` modules (`starships.ts` stock parser + `stockToShipBuild` converter, `shipCards.ts`, `spawn.ts` ship bodies) consumed by dumb components (`ShipBrowser`, `ShipStatblock`, `FleetRail`) through `useDmScreen`. Spawning composes the **existing** `POST /swdnd/campaigns/{id}/starships` + `PATCH /swdnd/starships/{id}` + `POST /swdnd/scenes/{id}/tokens` routes client-side — zero new mutation surface.

**Tech Stack:** Bun + Hono + `@hono/zod-openapi` + `bun:sqlite` / React + Vite + Tailwind v4 / `bun:test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-12-starship-spine-design.md` §7 ("stock-ship browser and encounter integration — sub-project 4"). Depends on sub-projects 1–3 being merged.

## Design decisions embedded in this plan (not yet individually approved)

1. **Stock ships are ingested as a new reference table.** `starships` joins `REFERENCE_TABLES`, fed by the `drakes-shipyard` pack. Deploy-time implication: the Docker image bakes a content DB that merges idempotently on boot, and `seedContentFromImage` currently short-circuits when the live `commit_hash` equals the seed's — a live volume already seeded at the pinned commit would never receive the new table. Task 2 changes the short-circuit to also fire when the seed has rows for a content table the live DB has none of. This is a behavior change to a boot path.
2. **The stock-ship row stores a distilled document, not the full Foundry actor.** Measured: the 87 actors serialize to ~16 MB (avg 285 KB each; 54 embedded items with full HTML descriptions), versus 6.9 MB for all 272 monsters. A shape-preserving projection (same Foundry field paths, essentials only) is 1.1 MB / ~13 KB per ship. Every dropped detail already lives in the reference table the embedded item points at via `flags.core.sourceId`. This deviates from `sw5e-map.ts`'s "raw_json always preserves the full Foundry document" comment, for this table only.
3. **`stockToShipBuild` owns the defaults for everything the pack omits.** Weapon mounts (the pack's `mountType` is `null` on all 349 weapon items) default to `fixed-forward`; ability scores are taken as `abilities.base` with `increases: []`; published hull/shield totals become `overrides.maxHull` / `overrides.maxShields`; equipment kinds `ShipBuild` cannot express (trinkets, vehicle gear) are dropped; unresolvable refs are dropped rather than failing the conversion.
4. **Spawn-to-scene creates a REAL `starship` row per spawn, not a statless token.** A hostile ship is a full ship: it has a build, a sheet, hull/shield pools, and shows on the fleet rail. Spawning ×3 creates three `starship` rows (`Name`, `Name #2`, `Name #3`) and three tokens bound to them by `ship_id`.
5. **Encounters store ships by stock ref, instantiated at spawn time.** The encounter holds `{stockShipRef, count}`, not ship ids — an encounter is a template, reusable across sessions, and "spawn all" mints fresh `starship` rows every time.
6. **Reality check on the encounter storage shape.** `encounter` has **no member table**: members live in the `monsters_json` TEXT column (`[{monsterId, count}]`). Migration 008 therefore mirrors that column rather than adding a column to a member table: `ships_json TEXT NOT NULL DEFAULT '[]'` holding `[{stockShipRef, count}]`.

## Global Constraints

- The existing suite stays green (`bun test` — 329 passing before sub-projects 1–3; whatever the count is when this plan starts, it must not drop).
- The import and the boot-time seed stay idempotent for live deploys: re-running either changes nothing on an up-to-date database, and an already-deployed volume picks up the new table without losing user data.
- `REFERENCE_TABLES` and `PACK_SOURCES` are append-only — add entries at the end, never reorder or rename existing ones.
- All timestamps are ISO 8601 UTC strings (`new Date().toISOString()`).

## Verified facts (checked against the pinned pack clone and the repo — do not re-litigate)

- **The `starships` pack directory is NOT the pre-built ships.** `vendor/sw5e/packs/starships/` holds the six size chassis (`tiny|small|medium|large|huge|gargantuan-starship.json`, item type `starshipsize`) and already maps to the `starship_sizes` table. The 87 pre-built named ships live in **`vendor/sw5e/packs/drakes-shipyard/`**. Other unmapped pack dirs (`fistoscodex`, `monsters_temp`, `tables`) stay unmapped.
- The clone exists locally at `vendor/sw5e`, at the exact commit the Dockerfile pins (`SW5E_REF=beab2383231e3ac43ea251eae11570a5f6fc79c5`). If it is missing: `git clone --depth 1 https://github.com/sw5e-foundry/sw5e.git vendor/sw5e` then `git -C vendor/sw5e fetch --depth 1 origin beab2383231e3ac43ea251eae11570a5f6fc79c5 && git -C vendor/sw5e checkout FETCH_HEAD`.
- **The rows are Foundry Actor documents**, `type: 'starship'`, all 87 with `system.details.source === "Drake's Shipyard"`. Structure:
  - `system.abilities.{str,dex,con,int,wis,cha}.value` — integers, present on all 87 (plus `hon`/`san`, which are ignored).
  - `system.attributes.hp` = `{value, max, temp, tempmax}` — **hull is `hp.max`, shields are `hp.tempmax`**. Two ships (`A/SF-01 B-wing starfighter`, `A-Z-Z-3 Light Freighter`) have `max`/`tempmax` `null` with a non-null `value`.
  - `system.details.tier` is a **string** `'0'`–`'5'`. `system.traits.size` is **`null` on all 87** — the size comes from the embedded item.
  - `system.attributes.hull` / `shld` are zeroed on the actors (`dice: 0`, `die: ''`) — useless; ignore them.
  - `items[]` types across the pack: `feat` (starship actions/features), `starshipsize` (**exactly one per ship**, on all 87), `equipment`, `weapon`, `starshipmod`, `consumable`, `power`.
- **`flags.core.sourceId` is the reference key**: `'Compendium.sw5e.<packDir>.<refId>'`. Resolution rates against the imported reference tables: `starships`(sizes) 6/6, `starship_weapons` 45/45, `starship_armor` 6/6, `starship_equipment` 15/15 — but **`starship_modifications` 0/143 by id** (the actors were authored against a different mod-pack revision; 82 of the 143 resolve **by name**), and `starship_features` 13/45. 3 equipment items and 2 weapon items carry **no** `sourceId` at all. → the converter must be tolerant: sourceId first, case-insensitive name second, skip third.
- **Shields live in `starship_armor`, not `starship_equipment`.** `starshiparmor` holds 3 rows with `system.armor.type === 'starship'` (armor) and 3 with `'ssshield'` (shields). `starshipequipment` holds reactors, power couplings and hyperdrives (17 rows) and has no `system.armor.type` distinction to rely on from the pack row itself — the **embedded item's** `system.armor.type` is the authoritative kind discriminator: `starship`→armor, `ssshield`→shield, `reactor`→reactor, `powerc`→coupling, `hyper`→hyperdrive, `vehicle`/`trinket`→not modelled.
- **`system.mountType` is `null` on all 349 embedded weapon items**; `system.weaponType` is `'primary (starship)'`…`'quaternary (starship)'`.
- Size distribution: Small 50, Medium 22, Large 8, Tiny 5, Gargantuan 1, Huge 1. Tier distribution: 0×12, 1×27, 2×30, 3×12, 4×5, 5×1.
- **Size measurements**: full docs 16.0 MB serialized; descriptions-stripped 11.4 MB; the distillation in Task 1 → **1.12 MB total, 12.9 KB avg** (monsters average 25.5 KB, total 6.9 MB — so the distilled ship table is *cheaper* than the bestiary the DM screen already loads).
- `encounter` members are the `monsters_json` column (`004_swdnd_encounters.sql`), **not** a member table. `/swdnd/campaigns/:id/encounters` and `/swdnd/encounters/:id` match **no** `selfGated` clause → mutations ride the blanket admin gate, GETs are open.
- `bun test` from the repo root is safe now (`db/swdnd/index.ts` routes `NODE_ENV === 'test'` to a per-pid temp DB — commit `8f50deb`). The real typecheck is `cd apps/swdnd && bun run build` (`tsc -b && vite build`, `noUnusedLocals`); **never** `bun --cwd`. `*.test.ts` files are excluded from `tsconfig.app.json`, so partial reference literals in tests are fine.
- Backend test files set `SWDND_DB_PATH` in `beforeAll`, import `../../db/swdnd` dynamically, and reset tables in FK order (children before parents).
- `git add` explicit paths only, never `-A`.

## Interfaces treated as existing (delivered by sub-projects 1–3)

These are consumed by this plan and must NOT be re-implemented. Signatures are taken from the approved spec.

These are **verified against the sibling plan** `docs/superpowers/plans/2026-08-12-starship-spine.md` (sub-project 1), not merely assumed:

```ts
// apps/swdnd/src/lib/shipRules/types.ts
export type ShipAbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export type WeaponMount = 'fixed-forward' | 'fixed-aft' | 'fixed-port' | 'fixed-starboard' | 'turret';
export type ShipEquipmentKind = 'armor' | 'shield' | 'reactor' | 'coupling' | 'hyperdrive' | 'weapon';
export interface ShipEquipmentEntry { id: string; ref: string; kind: ShipEquipmentKind; mount?: WeaponMount }
export interface ShipAbilityIncrease { source: 'tier'; ref: string; ability: ShipAbilityKey; amount: number }
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
  overrides: Record<string, number>;   // maxHull | maxShields | armorClass | speed | turnSpeed
  houseRuled?: string[];
}
export interface ShipReferenceData {
  sizes: Record<string, RefShipSize>;                  // starship_sizes
  armor: Record<string, RefShipArmor>;                 // starship_armor — armor AND shields (kind: 'shield')
  equipment: Record<string, RefShipEquipment>;         // starship_equipment — reactors, couplings, hyperdrives
  weapons: Record<string, RefShipWeapon>;              // starship_weapons
  modifications: Record<string, RefShipModification>;  // starship_modifications
}
// every Ref* view type above carries at least { id: string; name: string }
export interface DerivedShip {
  tier: number; armorClass: number; damageReduction: number;
  maxHull: number; maxShields: number; speed: number; turnSpeed: number;
  /* …plus dice, weapon profiles and budget counters this plan does not read */
}
export function emptyShipBuild(name: string): ShipBuild;

// apps/swdnd/src/lib/shipRules/index.ts
export function computeShip(build: ShipBuild, ref: ShipReferenceData): DerivedShip;

// apps/swdnd/src/lib/starships.ts
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
export function patchStarship(id: string, patch: { name?: string; data_json?: ShipBuild }, token?: string | null): Promise<StarshipDto>;
export function loadShipReference(): Promise<ShipReferenceData>;
// ShipCrewMember / ShipRole are sub-project-1 crew types; this plan never reads them.

// apps/swdnd/src/lib/panels.ts — PanelKind now includes 'ship' (→ /ship/:shipId)
// apps/swdnd/src/lib/scenes.ts — TokenDto gains `ship_id: string | null; facing: number`;
//   POST /swdnd/scenes/{id}/tokens accepts ship_id + facing, and its `scale` cap is
//   widened to 16 for multi-hex ship footprints (sub-project 3)
// apps/swdnd/src/lib/shipTokens.ts — shipTokenScale(sizeKey): footprint span in hexes (sub-project 3)
// apps/swdnd/src/lib/shipVitals.ts (sub-project 3) — the shared live-ship cache types:
//   export interface ShipPlayLike { hull: number; shields: number; conditions: string[]; systemDamage: number }
//   export type PendingShipPlays = Record<string, ShipPlayLike>   // buffered ship:updated plays, by ship id
// This plan reuses BOTH rather than declaring its own copies in lib/shipCards.ts.
// Realtime: `ship:updated` on the campaign room, payload {shipId, name, play}
```

> **PREFLIGHT (do this once, before Task 3).** Open `apps/swdnd/src/lib/shipRules/types.ts`, `apps/swdnd/src/lib/shipRules/index.ts` and `apps/swdnd/src/lib/starships.ts` and confirm the names above still match what actually shipped. Two shapes deliberately come from sub-projects 2–3 rather than 1: `computeShip` takes an optional third `crew` argument (sub-project 2) which this plan never passes, and `emptyShipBuild()` is at `schemaVersion: 2` with a `play.powerDice` block (sub-project 2) — which is exactly why `stockToShipBuild` seeds from it instead of writing a literal. `shipTokenScale` (`lib/shipTokens.ts`) and `TokenDto.ship_id` / `.facing` / token `scale` come from sub-project 3. This plan funnels **every** dependence on `ShipReferenceData`'s field names through exactly two functions — `shipRefIndex()` (Task 4) and `cardFromShip()` (Task 5), each marked `ADAPTER`. If a name drifted, fix those two places and nothing else. From `DerivedShip` only `armorClass`, `maxHull`, `maxShields`, `speed` and `turnSpeed` are read, all in Task 5 and Task 7.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `apps/backend/src/db/swdnd/reference.ts` | modify | `starships` manifest entry |
| `apps/backend/src/db/import/sw5e-map.ts` | modify | `drakes-shipyard` pack source + `distillStockShip` |
| `apps/backend/src/db/import/sw5e-map.test.ts` | modify | distillation + mapping tests |
| `apps/backend/src/db/swdnd/seed.ts` | modify | backfill a content table added after the live DB was seeded |
| `apps/backend/src/db/swdnd/seed.test.ts` | modify | same-commit backfill test |
| `apps/swdnd/src/lib/starships.ts` | modify | stock-ship parser/filter + `stockToShipBuild` + fleet composition |
| `apps/swdnd/src/lib/starships.test.ts` | modify | parser + converter tests |
| `apps/swdnd/src/lib/shipCards.ts` + `.test.ts` | create | fleet-rail cards + live merge |
| `apps/swdnd/src/lib/spawn.ts` + `.test.ts` | modify | `copyName`, `shipSpawnBody` |
| `apps/swdnd/src/hooks/useDmScreen.ts` | modify | stock ships, fleet, ship spawn, `ship:updated` |
| `apps/swdnd/src/panels/DMScreen/ShipStatblock.tsx` | create | derived stock statblock |
| `apps/swdnd/src/panels/DMScreen/ShipBrowser.tsx` | create | searchable list + actions |
| `apps/swdnd/src/panels/DMScreen/FleetRail.tsx` | create | live campaign-ship cards |
| `apps/swdnd/src/panels/DMScreen/index.tsx` | modify | `ships` tab + fleet rail |
| `apps/backend/src/db/migrations/swdnd/008_swdnd_encounter_ships.sql` | create | `ships_json` column |
| `apps/backend/src/db/swdnd/index.ts` | modify | register migration 008 |
| `apps/backend/src/routes/swdnd/encounters.ts` | modify | `ships` in schemas + handlers |
| `apps/backend/src/routes/swdnd/encounters.test.ts` | modify | ships round-trip + validation |
| `apps/swdnd/src/lib/encounters.ts` + `.test.ts` | modify | `EncounterShip` + edit helpers |
| `apps/swdnd/src/panels/DMScreen/EncounterList.tsx` | modify | ship chips + add-ship select |

---

### Task 1: `starships` reference table + `drakes-shipyard` import mapping

**Files:**
- Modify: `apps/backend/src/db/swdnd/reference.ts`
- Modify: `apps/backend/src/db/import/sw5e-map.ts`
- Modify: `apps/backend/src/db/import/sw5e-map.test.ts`

**Interfaces:**
- Consumes: `RefTable`, `REFERENCE_TABLES`, `PackSource`, `PACK_SOURCES`, `mapFoundryDoc`, `RefRow` (all existing in the two modified modules).
- Produces:
  ```ts
  // apps/backend/src/db/import/sw5e-map.ts
  export function distillStockShip(doc: any): Record<string, unknown>;
  // REFERENCE_TABLES gains { table: 'starships', extra: [] }
  // PACK_SOURCES gains { packDir: 'drakes-shipyard', table: 'starships' }
  // → GET /swdnd/content/starships starts serving 87 rows (VALID_CATEGORIES is derived from REFERENCE_TABLES)
  ```

- [ ] **Step 1: Write the failing tests** — append to `apps/backend/src/db/import/sw5e-map.test.ts`, inside the existing `describe('mapFoundryDoc', …)`'s file scope (add a new top-level `describe` at the end of the file). The fixture is a trimmed copy of `drakes-shipyard/akajor-class-shuttle.json` with a weapon borrowed from `arc-170-starfighter.json` — every id below is real:

```ts
const stockShipSource: PackSource = { packDir: 'drakes-shipyard', table: 'starships' };

/** Trimmed real actor: Aka'jor-class Shuttle (+ one ARC-170 weapon). */
const stockShipDoc = {
  _id: 'tRnGAAILKowm8n4T',
  name: "Aka'jor-class Shuttle",
  type: 'starship',
  img: 'https://example.invalid/shuttle.jpg',
  effects: [{ _id: 'fx1', name: 'Directional Shield' }],
  prototypeToken: { name: "Aka'jor-class Shuttle", width: 1, height: 1 },
  system: {
    abilities: {
      str: { value: 13, proficient: 1, bonuses: { check: '', save: '' } },
      dex: { value: 14, proficient: 1, bonuses: { check: '', save: '' } },
      con: { value: 13, proficient: 0, bonuses: { check: '', save: '' } },
      int: { value: 8, proficient: 0, bonuses: { check: '', save: '' } },
      wis: { value: 12, proficient: 0, bonuses: { check: '', save: '' } },
      cha: { value: 14, proficient: 0, bonuses: { check: '', save: '' } },
      hon: { value: 10, proficient: 0 },
      san: { value: 10, proficient: 0 },
    },
    attributes: {
      ac: { flat: null, calc: 'starship', formula: '' },
      hp: { value: 27, max: 27, temp: 18, tempmax: 18, min: 0, bonuses: { level: '' } },
      hull: { die: '', dice: 0, dicemax: 0, value: null, max: null },
      movement: { walk: 30, fly: 0, space: 0, turn: 0, units: 'ft', hover: false },
      systemDamage: 0,
    },
    details: { biography: { value: '<p>long prose</p>' }, description: { value: '<p>more prose</p>' }, source: "Drake's Shipyard", tier: '2', role: [] },
    traits: { size: null, di: {}, dr: {} },
    skills: { ast: { value: 0 } },
  },
  items: [
    {
      _id: 'i1', name: 'Small Starship', type: 'starshipsize',
      effects: [], ownership: { default: 0 }, _stats: { systemId: 'sw5e' },
      flags: { core: { sourceId: 'Compendium.sw5e.starships.6BN8l5E8QtYt103T' } },
      system: { description: { value: '<p>chassis prose</p>' }, tier: 2, size: 'sm', hullDice: 'd6', hullDiceStart: 3, advancement: [{ type: 'HitPoints' }] },
    },
    {
      _id: 'i2', name: 'Deflection Armor', type: 'equipment',
      flags: { core: { sourceId: 'Compendium.sw5e.starshiparmor.aG6mKPerYCFmkI00' } },
      system: { description: { value: '<p>armor prose</p>' }, armor: { value: 10, type: 'starship', dex: 2 }, equipped: true, quantity: 1 },
    },
    {
      _id: 'i3', name: 'Quick-Charge Shield', type: 'equipment',
      flags: { core: { sourceId: 'Compendium.sw5e.starshiparmor.M7igMGsBIosGA4dS' } },
      system: { description: { value: '<p>shield prose</p>' }, armor: { value: 0, type: 'ssshield', dex: null }, equipped: true, quantity: 1 },
    },
    {
      _id: 'i4', name: 'Heavy blaster cannon', type: 'weapon',
      flags: { core: { sourceId: 'Compendium.sw5e.starshipweapons.A0LPvkVHhH3e2Aeh' } },
      system: { description: { value: '<p>weapon prose</p>' }, weaponType: 'primary (starship)', mountType: null, quantity: 1, damage: { parts: [['1d10', 'energy']] } },
    },
    {
      _id: 'i5', name: 'Adaptive Ailerons', type: 'starshipmod',
      flags: { core: { sourceId: 'Compendium.sw5e.starshipmodifications.H1PmkigBok9ThtyJ' } },
      system: { description: { value: '<p>mod prose</p>' }, armor: { type: '', value: null, dex: null }, quantity: 1, tier: 0 },
    },
    {
      _id: 'i6', name: 'Attack Run', type: 'feat',
      flags: { core: { sourceId: 'Compendium.sw5e.starshipactions.O9t2gB5wl6n86Eh4' } },
      system: { description: { value: '<p>action prose</p>' }, type: { value: 'starshipAction' } },
    },
  ],
};

describe('distillStockShip', () => {
  it('keeps identity, abilities, pools, tier and item refs', () => {
    const d = distillStockShip(stockShipDoc) as any;
    expect(d._id).toBe('tRnGAAILKowm8n4T');
    expect(d.name).toBe("Aka'jor-class Shuttle");
    expect(d.type).toBe('starship');
    expect(d.system.abilities.str.value).toBe(13);
    expect(d.system.abilities.cha.value).toBe(14);
    expect(d.system.abilities.hon).toBeUndefined();       // hon/san are not real ship abilities
    expect(d.system.attributes.hp).toEqual({ value: 27, max: 27, temp: 18, tempmax: 18 });
    expect(d.system.details.tier).toBe('2');
    expect(d.system.details.source).toBe("Drake's Shipyard");
    expect(d.system.traits.size).toBeNull();
    expect(d.items).toHaveLength(6);
    const size = d.items.find((i: any) => i.type === 'starshipsize');
    expect(size.flags.core.sourceId).toBe('Compendium.sw5e.starships.6BN8l5E8QtYt103T');
    expect(size.system.tier).toBe(2);
    const armor = d.items.find((i: any) => i.name === 'Deflection Armor');
    expect(armor.system.armor).toEqual({ value: 10, type: 'starship', dex: 2 });
    const weapon = d.items.find((i: any) => i.type === 'weapon');
    expect(weapon.system.weaponType).toBe('primary (starship)');
    expect(weapon.system.mountType).toBeNull();
  });

  it('drops the prose and Foundry chrome that make the pack 16 MB', () => {
    const json = JSON.stringify(distillStockShip(stockShipDoc));
    expect(json).not.toContain('prose');
    expect(json).not.toContain('prototypeToken');
    expect(json).not.toContain('advancement');
    expect(json).not.toContain('_stats');
    expect(json.length).toBeLessThan(JSON.stringify(stockShipDoc).length / 2);
  });

  it('tolerates a malformed document', () => {
    const d = distillStockShip({}) as any;
    expect(d.items).toEqual([]);
    expect(d.system.attributes.hp).toEqual({ value: null, max: null, temp: null, tempmax: null });
    expect(() => JSON.stringify(distillStockShip(null))).not.toThrow();
  });
});

describe('mapFoundryDoc for stock ships', () => {
  it('stores the distilled doc and reads content_source from details.source', () => {
    const row = mapFoundryDoc(stockShipSource, stockShipDoc);
    expect(row.id).toBe('tRnGAAILKowm8n4T');
    expect(row.name).toBe("Aka'jor-class Shuttle");
    expect(row.content_source).toBe("Drake's Shipyard");
    expect(row.extra).toEqual({});
    expect(row.raw_json).not.toContain('prose');
    expect(JSON.parse(row.raw_json).system.attributes.hp.max).toBe(27);
  });

  it('maps the two easily-confused starship packs to different tables', () => {
    const byDir = Object.fromEntries(PACK_SOURCES.map((s) => [s.packDir, s.table]));
    expect(byDir['starships']).toBe('starship_sizes');       // the six size chassis
    expect(byDir['drakes-shipyard']).toBe('starships');      // the 87 pre-built ships
  });
});
```

Add `distillStockShip` to the existing import at the top of the file:

```ts
import { mapFoundryDoc, PACK_SOURCES, distillStockShip, type PackSource } from './sw5e-map';
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/asherc/Git/ashercarlow-api && bun test apps/backend/src/db/import/sw5e-map.test.ts`
Expected: FAIL — `distillStockShip is not a function` (no such export) and `byDir['drakes-shipyard']` is `undefined`.

- [ ] **Step 3: Add the manifest entry** — in `apps/backend/src/db/swdnd/reference.ts`, append to the **end** of `REFERENCE_TABLES` (append-only):

```ts
  { table: 'monster_traits', extra: [] },
  // Pre-built named starships. NOTE the confusing pair: the sw5e pack DIRECTORY
  // called `starships` holds the six size chassis and feeds `starship_sizes`;
  // THIS table is fed by the `drakes-shipyard` pack (87 actor documents).
  { table: 'starships', extra: [] },
];
```

- [ ] **Step 4: Implement the distillation** — in `apps/backend/src/db/import/sw5e-map.ts`, append the pack source at the **end** of `PACK_SOURCES`:

```ts
  { packDir: 'monstertraits', table: 'monster_traits' },
  // 87 pre-built ships (Foundry Actor docs, not Items) — see distillStockShip.
  { packDir: 'drakes-shipyard', table: 'starships' },
];
```

then add, above `mapFoundryDoc`:

```ts
const SHIP_ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const SHIP_ITEM_SYSTEM_KEYS = ['armor', 'weaponType', 'mountType', 'quantity', 'tier', 'size'] as const;

/**
 * Stock-ship actors carry ~54 embedded items with full HTML descriptions: 16 MB
 * of JSON across the pack, which would land in the baked seed image and on the
 * wire for the DM's ship browser. Every dropped detail already lives in the
 * reference table the embedded item points at (flags.core.sourceId), so this
 * stores a SHAPE-PRESERVING projection — identical Foundry field paths,
 * essentials only (1.1 MB total, ~13 KB/ship; monsters average 25 KB).
 * Deliberate exception to "raw_json always preserves the full Foundry document".
 */
export function distillStockShip(doc: any): Record<string, unknown> {
  const d = doc && typeof doc === 'object' ? doc : {};
  const system = d.system ?? {};
  const attrs = system.attributes ?? {};
  const hp = attrs.hp ?? {};
  const ac = attrs.ac ?? {};
  const details = system.details ?? {};

  const abilities: Record<string, { value: unknown }> = {};
  for (const k of SHIP_ABILITIES) {
    if (system.abilities?.[k]) abilities[k] = { value: system.abilities[k].value ?? null };
  }

  const items = (Array.isArray(d.items) ? d.items : []).map((it: any) => {
    const sys = it?.system ?? {};
    const sourceId = it?.flags?.core?.sourceId;
    const kept: Record<string, unknown> = {};
    for (const k of SHIP_ITEM_SYSTEM_KEYS) if (k in sys) kept[k] = sys[k];
    return {
      _id: it?._id ?? null,
      name: typeof it?.name === 'string' ? it.name : null,
      type: typeof it?.type === 'string' ? it.type : null,
      ...(typeof sourceId === 'string' ? { flags: { core: { sourceId } } } : {}),
      system: kept,
    };
  });

  return {
    _id: d._id ?? null,
    name: typeof d.name === 'string' ? d.name : null,
    type: typeof d.type === 'string' ? d.type : null,
    system: {
      abilities,
      attributes: {
        ac: { flat: ac.flat ?? null, calc: ac.calc ?? null },
        hp: { value: hp.value ?? null, max: hp.max ?? null, temp: hp.temp ?? null, tempmax: hp.tempmax ?? null },
        movement: attrs.movement ?? null,
        systemDamage: attrs.systemDamage ?? null,
      },
      details: { source: details.source ?? null, tier: details.tier ?? null, role: details.role ?? null },
      traits: { size: system.traits?.size ?? null },
    },
    items,
  };
}
```

and rewrite the two affected lines inside `mapFoundryDoc` — the `source_field` line and the `raw_json` line:

```ts
  // Stock ships put their book at system.details.source; every Item pack uses system.source.
  const isStockShip = source.table === 'starships';
  const source_field = isStockShip ? system.details?.source : system.source;
  const content_source =
    typeof source_field === 'string'
      ? source_field
      : source_field && typeof source_field.book === 'string'
        ? source_field.book
        : null;

  return {
    id: String(doc?._id ?? doc?.name ?? ''),
    name: typeof doc?.name === 'string' ? doc.name : null,
    content_source,
    content_type: typeof system.contentType === 'string' ? system.contentType : null,
    raw_json: JSON.stringify(isStockShip ? distillStockShip(doc) : doc),
    extra,
  };
```

- [ ] **Step 5: Run to verify pass**

Run: `cd /Users/asherc/Git/ashercarlow-api && bun test apps/backend/src/db/import/sw5e-map.test.ts apps/backend/src/db/swdnd/reference.test.ts`
Expected: PASS (the manifest loop in `reference.test.ts` now also asserts the `starships` table is created).

- [ ] **Step 6: Re-run the real import and verify the corpus** (needs `vendor/sw5e` at the pinned commit — see Verified facts):

```bash
cd /Users/asherc/Git/ashercarlow-api && SW5E_PACKS_DIR=vendor/sw5e/packs bun run apps/backend/src/db/import/sw5e-import.ts
```

Expected: `[sw5e-import] imported N records into swdnd.sqlite` with no `skipping missing pack dir: drakes-shipyard` warning. Then verify:

```bash
cd /Users/asherc/Git/ashercarlow-api && bun -e "
import { Database } from 'bun:sqlite';
const db = new Database('data/swdnd.sqlite');
console.log(db.query('SELECT count(*) n, sum(length(raw_json)) bytes FROM starships').get());
console.log(db.query(\"SELECT id, name, content_source FROM starships ORDER BY name LIMIT 3\").all());
"
```

Expected: `{ n: 87, bytes: ~1_120_000 }` and three rows with `content_source: \"Drake's Shipyard\"`. Re-running the import must produce the same counts (idempotent `INSERT OR REPLACE`).

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/db/swdnd/reference.ts apps/backend/src/db/import/sw5e-map.ts apps/backend/src/db/import/sw5e-map.test.ts
git commit -m "feat(swdnd): ingest the drakes-shipyard stock ships as a starships reference table"
```

---

### Task 2: Seed backfill for content tables added after a deploy was seeded

**Files:**
- Modify: `apps/backend/src/db/swdnd/seed.ts`
- Modify: `apps/backend/src/db/swdnd/seed.test.ts`

**Interfaces:**
- Consumes: `CONTENT_TABLES`, `columnNames(db, schema, table)`, `seedContentFromImage(db, seedPath?)` (all in `seed.ts`).
- Produces:
  ```ts
  // apps/backend/src/db/swdnd/seed.ts — module-private
  function backfillNeeded(db: Database): boolean;   // seed has rows, live has none, for any content table
  // seedContentFromImage's version short-circuit now also requires !backfillNeeded(db)
  ```

- [ ] **Step 1: Write the failing test** — append inside the existing `describe('seedContentFromImage', …)` in `apps/backend/src/db/swdnd/seed.test.ts` (it reuses that describe's `dir`, `makeDb` and `writeSeed`):

```ts
  it('backfills a content table the live DB has never seen, even at the same commit', () => {
    const seedPath2 = join(dir, 'newtable-seed.sqlite');
    const livePath2 = join(dir, 'newtable-live.sqlite');

    // A seed built by the new image: species + the newly-added starships table.
    writeSeed(seedPath2, 'eee', ['wookiee']);
    const seed = openDatabase(seedPath2);
    seed.prepare(
      "INSERT OR REPLACE INTO starships (id, name, content_source, content_type, raw_json) VALUES (?, ?, NULL, NULL, '{}')",
    ).run('tRnGAAILKowm8n4T', "Aka'jor-class Shuttle");
    seed.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    seed.close();

    // The live volume: already seeded at commit 'eee' back when `starships`
    // did not exist, so the table is present (ensureReferenceTables) but empty.
    const live = makeDb(livePath2);
    seedContentFromImage(live, seedPath2);
    live.exec('DELETE FROM starships');
    expect(liveCommit(live)).toBe('eee');

    // Same commit — the version short-circuit alone would skip forever.
    seedContentFromImage(live, seedPath2);
    expect(live.query<{ n: number }, []>('SELECT count(*) n FROM starships').get()!.n).toBe(1);

    // ...and the next boot is a genuine no-op again.
    live.prepare(
      "INSERT INTO starships (id, name, content_source, content_type, raw_json) VALUES ('local', 'Local', NULL, NULL, '{}')",
    ).run();
    seedContentFromImage(live, seedPath2);
    expect(live.query<{ n: number }, []>('SELECT count(*) n FROM starships').get()!.n).toBe(2);
    expect(speciesCount(live)).toBe(1);
    live.close();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/asherc/Git/ashercarlow-api && bun test apps/backend/src/db/swdnd/seed.test.ts`
Expected: FAIL — `expect(1).toBe(1)` on the backfill assertion actually reports `0`: the same-commit short-circuit returns before copying, so `starships` stays empty.

- [ ] **Step 3: Implement** — in `apps/backend/src/db/swdnd/seed.ts`, add below `columnNames`:

```ts
/**
 * True when the seed has rows for a content table the live DB has none of.
 * A volume seeded before a new reference table existed still reports the same
 * `commit_hash` as the seed, so the version check alone would leave that table
 * empty forever (this is how `starships` reaches already-deployed instances).
 * Tables missing from either side are skipped, matching the copy loop.
 */
function backfillNeeded(db: Database): boolean {
  for (const table of CONTENT_TABLES) {
    if (table === 'data_version') continue;
    if (columnNames(db, 'seed', table).length === 0) continue;
    if (columnNames(db, 'main', table).length === 0) continue;
    const seedRows = db.query<{ n: number }, []>(`SELECT count(*) n FROM seed.${table}`).get()?.n ?? 0;
    if (seedRows === 0) continue;
    const liveRows = db.query<{ n: number }, []>(`SELECT count(*) n FROM main.${table}`).get()?.n ?? 0;
    if (liveRows === 0) return true;
  }
  return false;
}
```

and change the short-circuit inside `seedContentFromImage`:

```ts
    if (
      liveVersion && seedVersion
      && liveVersion.commit_hash === seedVersion.commit_hash
      && !backfillNeeded(db)
    ) {
      return; // content already matches the baked-in seed
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd /Users/asherc/Git/ashercarlow-api && bun test apps/backend/src/db/swdnd/seed.test.ts`
Expected: PASS, all five tests in the file (the three original scenarios still behave identically — empty live DB seeds, new commit refreshes, same commit with nothing missing no-ops).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/db/swdnd/seed.ts apps/backend/src/db/swdnd/seed.test.ts
git commit -m "fix(backend): backfill content tables added after a deploy was seeded"
```

---

### Task 3: Stock-ship parser and filters

**Files:**
- Modify: `apps/swdnd/src/lib/starships.ts`
- Modify: `apps/swdnd/src/lib/starships.test.ts`

**Interfaces:**
- Consumes: `ShipAbilityKey` (`./shipRules/types`), `api` (`./api`).
- Produces:
  ```ts
  // apps/swdnd/src/lib/starships.ts
  export interface StockShipRow { id: string; name?: string | null; raw_json: string }
  export interface StockShipItem { name: string; ref: string | null; armorType: string; weaponType: string }
  export interface StockShipView {
    id: string; name: string; sizeRef: string | null; sizeName: string; tier: number;
    abilities: Record<ShipAbilityKey, number>; hull: number | null; shields: number | null; source: string;
    weapons: StockShipItem[]; equipment: StockShipItem[]; modifications: StockShipItem[];
  }
  export interface StockShipFilter { q: string; size?: string; tierMin?: number; tierMax?: number }
  export function sourceRef(sourceId: unknown): string | null;
  export function parseStockShip(row: StockShipRow): StockShipView;   // never throws
  export function filterStockShips(list: StockShipView[], f: StockShipFilter): StockShipView[];
  export function stockShipSizes(list: StockShipView[]): string[];
  export function listStockShips(): Promise<StockShipRow[]>;
  ```

- [ ] **Step 1: Write the failing tests** — append to `apps/swdnd/src/lib/starships.test.ts`. The fixture is one distilled row exactly as Task 1's importer writes it:

```ts
import {
  filterStockShips, listStockShipsUnused as _unused, parseStockShip, sourceRef, stockShipSizes,
  type StockShipRow, type StockShipView,
} from './starships';

const shuttleRaw = JSON.stringify({
  _id: 'tRnGAAILKowm8n4T',
  name: "Aka'jor-class Shuttle",
  type: 'starship',
  system: {
    abilities: { str: { value: 13 }, dex: { value: 14 }, con: { value: 13 }, int: { value: 8 }, wis: { value: 12 }, cha: { value: 14 } },
    attributes: {
      ac: { flat: null, calc: 'starship' },
      hp: { value: 27, max: 27, temp: 18, tempmax: 18 },
      movement: { walk: 30, fly: 0, space: 0, turn: 0, units: 'ft' },
      systemDamage: 0,
    },
    details: { source: "Drake's Shipyard", tier: '2', role: [] },
    traits: { size: null },
  },
  items: [
    { _id: 'i1', name: 'Small Starship', type: 'starshipsize', flags: { core: { sourceId: 'Compendium.sw5e.starships.6BN8l5E8QtYt103T' } }, system: { tier: 2, size: 'sm' } },
    { _id: 'i2', name: 'Deflection Armor', type: 'equipment', flags: { core: { sourceId: 'Compendium.sw5e.starshiparmor.aG6mKPerYCFmkI00' } }, system: { armor: { value: 10, type: 'starship', dex: 2 }, quantity: 1 } },
    { _id: 'i3', name: 'Quick-Charge Shield', type: 'equipment', flags: { core: { sourceId: 'Compendium.sw5e.starshiparmor.M7igMGsBIosGA4dS' } }, system: { armor: { value: 0, type: 'ssshield', dex: null }, quantity: 1 } },
    { _id: 'i4', name: 'Fuel Cell Reactor', type: 'equipment', flags: { core: { sourceId: 'Compendium.sw5e.starshipequipment.jk7zL3cqhufDKsuh' } }, system: { armor: { value: null, type: 'reactor', dex: null } } },
    { _id: 'i5', name: 'Hyperdrive, Class 1.5', type: 'equipment', flags: { core: { sourceId: 'Compendium.sw5e.starshipequipment.EllirPMc7jJSHZpL' } }, system: { armor: { value: null, type: 'hyper', dex: null } } },
    { _id: 'i6', name: 'Heavy blaster cannon', type: 'weapon', flags: { core: { sourceId: 'Compendium.sw5e.starshipweapons.A0LPvkVHhH3e2Aeh' } }, system: { weaponType: 'primary (starship)', mountType: null, quantity: 1 } },
    { _id: 'i7', name: 'Adaptive Ailerons', type: 'starshipmod', flags: { core: { sourceId: 'Compendium.sw5e.starshipmodifications.H1PmkigBok9ThtyJ' } }, system: { quantity: 1, tier: 0 } },
    { _id: 'i8', name: 'Attack Run', type: 'feat', flags: { core: { sourceId: 'Compendium.sw5e.starshipactions.O9t2gB5wl6n86Eh4' } }, system: {} },
    { _id: 'i9', name: 'Proton torpedo', type: 'consumable', flags: { core: { sourceId: 'Compendium.sw5e.starshipweapons.sNop7QuAG9JwcZiG' } }, system: { quantity: 4 } },
  ],
});

const shuttleRow: StockShipRow = { id: 'tRnGAAILKowm8n4T', name: "Aka'jor-class Shuttle", raw_json: shuttleRaw };

const view = (over: Partial<StockShipView>): StockShipView => ({
  id: 'x', name: 'X', sizeRef: null, sizeName: 'Small Starship', tier: 1,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  hull: 10, shields: 10, source: '', weapons: [], equipment: [], modifications: [], ...over,
});

describe('sourceRef', () => {
  it('extracts the reference id from a Foundry compendium path', () => {
    expect(sourceRef('Compendium.sw5e.starshipweapons.A0LPvkVHhH3e2Aeh')).toBe('A0LPvkVHhH3e2Aeh');
    expect(sourceRef('Compendium.sw5e.starships.6BN8l5E8QtYt103T')).toBe('6BN8l5E8QtYt103T');
  });
  it('returns null on anything else', () => {
    expect(sourceRef(undefined)).toBeNull();
    expect(sourceRef('')).toBeNull();
    expect(sourceRef('Compendium.sw5e.starships')).toBeNull();
    expect(sourceRef(42)).toBeNull();
  });
});

describe('parseStockShip', () => {
  it('reads identity, size, tier, abilities and pools', () => {
    const v = parseStockShip(shuttleRow);
    expect(v.id).toBe('tRnGAAILKowm8n4T');
    expect(v.name).toBe("Aka'jor-class Shuttle");
    expect(v.sizeRef).toBe('6BN8l5E8QtYt103T');
    expect(v.sizeName).toBe('Small Starship');   // system.traits.size is null on every pack ship
    expect(v.tier).toBe(2);                      // details.tier is the string '2'
    expect(v.abilities).toEqual({ str: 13, dex: 14, con: 13, int: 8, wis: 12, cha: 14 });
    expect(v.hull).toBe(27);                     // hp.max
    expect(v.shields).toBe(18);                  // hp.tempmax
    expect(v.source).toBe("Drake's Shipyard");
  });

  it('groups installed items by type and keeps their refs and kind discriminators', () => {
    const v = parseStockShip(shuttleRow);
    expect(v.weapons.map((w) => w.name)).toEqual(['Heavy blaster cannon']);
    expect(v.weapons[0].ref).toBe('A0LPvkVHhH3e2Aeh');
    expect(v.weapons[0].weaponType).toBe('primary (starship)');
    expect(v.equipment.map((e) => e.armorType)).toEqual(['starship', 'ssshield', 'reactor', 'hyper']);
    expect(v.equipment[1].ref).toBe('M7igMGsBIosGA4dS');
    expect(v.modifications.map((m) => m.name)).toEqual(['Adaptive Ailerons']);
    // feats (starship actions) and consumables (ammo) are not build entries
    expect(JSON.stringify(v)).not.toContain('Attack Run');
    expect(JSON.stringify(v)).not.toContain('Proton torpedo');
  });

  it('degrades instead of throwing on malformed rows', () => {
    const empty = parseStockShip({ id: 'zz', name: null, raw_json: 'not json' });
    expect(empty.name).toBe('zz');
    expect(empty.tier).toBe(0);
    expect(empty.sizeRef).toBeNull();
    expect(empty.sizeName).toBe('');
    expect(empty.hull).toBeNull();
    expect(empty.shields).toBeNull();
    expect(empty.abilities).toEqual({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
    expect(empty.weapons).toEqual([]);
  });

  it('falls back to hp.value/hp.temp when the pack omits the maxima (2 of 87 ships)', () => {
    const raw = JSON.parse(shuttleRaw);
    raw.system.attributes.hp = { value: 38, max: null, temp: null, tempmax: null };
    const v = parseStockShip({ id: 'bw', name: 'A/SF-01 B-wing starfighter', raw_json: JSON.stringify(raw) });
    expect(v.hull).toBe(38);
    expect(v.shields).toBeNull();
  });

  it('takes tier from the embedded size item when details.tier is absent', () => {
    const raw = JSON.parse(shuttleRaw);
    delete raw.system.details.tier;
    expect(parseStockShip({ id: 'a', name: 'A', raw_json: JSON.stringify(raw) }).tier).toBe(2);
  });
});

describe('filterStockShips / stockShipSizes', () => {
  const list = [
    view({ id: 'a', name: 'ARC-170 Starfighter', sizeName: 'Small Starship', tier: 2 }),
    view({ id: 'b', name: 'Acclamator-class Assault Ship', sizeName: 'Gargantuan Starship', tier: 5 }),
    view({ id: 'c', name: 'Amphibious Fighter', sizeName: 'Tiny Starship', tier: 0 }),
  ];

  it('matches names case-insensitively', () => {
    expect(filterStockShips(list, { q: 'arc' }).map((s) => s.id)).toEqual(['a']);
    expect(filterStockShips(list, { q: '  A  ' }).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
  it('filters by size and tier range', () => {
    expect(filterStockShips(list, { q: '', size: 'Tiny Starship' }).map((s) => s.id)).toEqual(['c']);
    expect(filterStockShips(list, { q: '', tierMin: 2 }).map((s) => s.id)).toEqual(['a', 'b']);
    expect(filterStockShips(list, { q: '', tierMax: 2 }).map((s) => s.id)).toEqual(['a', 'c']);
    expect(filterStockShips(list, { q: '', tierMin: 2, tierMax: 2 }).map((s) => s.id)).toEqual(['a']);
  });
  it('lists the sizes present, in canonical order', () => {
    expect(stockShipSizes(list)).toEqual(['Tiny Starship', 'Small Starship', 'Gargantuan Starship']);
  });
});
```

Delete the placeholder `listStockShipsUnused as _unused` from the import line before running — it exists only to remind you that `listStockShips` is a REST wrapper and, per house pattern (`characters.ts`, `encounters.ts`), is not unit-tested. Final import line:

```ts
import {
  filterStockShips, parseStockShip, sourceRef, stockShipSizes,
  type StockShipRow, type StockShipView,
} from './starships';
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/asherc/Git/ashercarlow-api && bun test apps/swdnd/src/lib/starships.test.ts`
Expected: FAIL — `parseStockShip is not a function` / `sourceRef is not a function` (no such exports yet); the sub-project-1 mapper tests in the same file still pass.

- [ ] **Step 3: Implement** — append to `apps/swdnd/src/lib/starships.ts`:

```ts
// ---- Stock ships (drakes-shipyard pack -> the `starships` content table) ----
// Rows are distilled Foundry ACTOR documents (see distillStockShip in the
// backend importer): same field paths as the raw pack, essentials only.

export interface StockShipRow { id: string; name?: string | null; raw_json: string }

export interface StockShipItem {
  name: string;
  /** Reference row id from flags.core.sourceId; null when the pack omits it. */
  ref: string | null;
  /** system.armor.type on equipment: starship|ssshield|reactor|powerc|hyper|''. */
  armorType: string;
  /** system.weaponType on weapons: 'primary (starship)'…'quaternary (starship)'. */
  weaponType: string;
}

export interface StockShipView {
  id: string;
  name: string;
  sizeRef: string | null;
  sizeName: string;
  tier: number;
  abilities: Record<ShipAbilityKey, number>;
  hull: number | null;
  shields: number | null;
  source: string;
  weapons: StockShipItem[];
  equipment: StockShipItem[];
  modifications: StockShipItem[];
}

const STOCK_ABILITY_KEYS: ShipAbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/** Size names in chassis order; anything unknown sorts last, alphabetically. */
const SIZE_ORDER = [
  'Tiny Starship', 'Small Starship', 'Medium Starship',
  'Large Starship', 'Huge Starship', 'Gargantuan Starship',
];

function stockNum(v: unknown): number | null {
  const n = Number(v);
  return typeof v === 'boolean' || v === null || v === undefined || v === '' || !Number.isFinite(n)
    ? null
    : n;
}

/** 'Compendium.sw5e.starshipweapons.A0LPvkVHhH3e2Aeh' -> 'A0LPvkVHhH3e2Aeh'. */
export function sourceRef(sourceId: unknown): string | null {
  if (typeof sourceId !== 'string') return null;
  const parts = sourceId.split('.');
  return parts.length === 4 && parts[3] ? parts[3] : null;
}

function stockItem(it: any): StockShipItem {
  return {
    name: typeof it?.name === 'string' ? it.name : '',
    ref: sourceRef(it?.flags?.core?.sourceId),
    armorType: typeof it?.system?.armor?.type === 'string' ? it.system.armor.type : '',
    weaponType: typeof it?.system?.weaponType === 'string' ? it.system.weaponType : '',
  };
}

/** Parse one `starships` content row into a display view. Never throws. */
export function parseStockShip(row: StockShipRow): StockShipView {
  let raw: Record<string, any> = {};
  try { raw = JSON.parse(row.raw_json) ?? {}; } catch { /* unparsable -> empty view */ }
  const sys: Record<string, any> = raw.system ?? {};
  const items: any[] = Array.isArray(raw.items) ? raw.items : [];
  const sizeItem = items.find((it) => it?.type === 'starshipsize') ?? null;
  const hp: Record<string, any> = sys.attributes?.hp ?? {};

  const abilities = {} as Record<ShipAbilityKey, number>;
  for (const k of STOCK_ABILITY_KEYS) abilities[k] = stockNum(sys.abilities?.[k]?.value) ?? 10;

  return {
    id: row.id,
    name: row.name || (typeof raw.name === 'string' ? raw.name : row.id),
    sizeRef: sourceRef(sizeItem?.flags?.core?.sourceId),
    sizeName: typeof sizeItem?.name === 'string' ? sizeItem.name : '',
    tier: stockNum(sys.details?.tier) ?? stockNum(sizeItem?.system?.tier) ?? 0,
    abilities,
    hull: stockNum(hp.max) ?? stockNum(hp.value),
    shields: stockNum(hp.tempmax) ?? stockNum(hp.temp),
    source: typeof sys.details?.source === 'string' ? sys.details.source : '',
    weapons: items.filter((it) => it?.type === 'weapon').map(stockItem),
    equipment: items.filter((it) => it?.type === 'equipment').map(stockItem),
    modifications: items.filter((it) => it?.type === 'starshipmod').map(stockItem),
  };
}

export interface StockShipFilter { q: string; size?: string; tierMin?: number; tierMax?: number }

export function filterStockShips(list: StockShipView[], f: StockShipFilter): StockShipView[] {
  const q = f.q.trim().toLowerCase();
  return list.filter((s) => {
    if (q && !s.name.toLowerCase().includes(q)) return false;
    if (f.size && s.sizeName !== f.size) return false;
    if (f.tierMin !== undefined && s.tier < f.tierMin) return false;
    if (f.tierMax !== undefined && s.tier > f.tierMax) return false;
    return true;
  });
}

export function stockShipSizes(list: StockShipView[]): string[] {
  const present = [...new Set(list.map((s) => s.sizeName).filter(Boolean))];
  return present.sort((a, b) => {
    const ia = SIZE_ORDER.indexOf(a);
    const ib = SIZE_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

export const listStockShips = () => api<StockShipRow[]>('/swdnd/content/starships');
```

Ensure `ShipAbilityKey` is in this module's `./shipRules/types` type import (the same import that already brings in `ShipBuild`/`ShipReferenceData` for the sub-project-1 mappers).

- [ ] **Step 4: Run to verify pass, then typecheck**

Run: `cd /Users/asherc/Git/ashercarlow-api && bun test apps/swdnd/src/lib/starships.test.ts && cd apps/swdnd && bun run build`
Expected: PASS + clean build.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/starships.ts apps/swdnd/src/lib/starships.test.ts
git commit -m "feat(swdnd): tolerant stock-ship parser and filters"
```

---

### Task 4: `stockToShipBuild` — stock row to a real `ShipBuild`

**Files:**
- Modify: `apps/swdnd/src/lib/starships.ts`
- Modify: `apps/swdnd/src/lib/starships.test.ts`

**Interfaces:**
- Consumes: `StockShipView`, `StockShipItem` (Task 3); `ShipBuild`, `ShipEquipmentEntry`, `ShipEquipmentKind`, `ShipReferenceData`, `emptyShipBuild` (sub-project 1); `createStarship`, `patchStarship`, `StarshipDto` (sub-project 1).
- Produces:
  ```ts
  // apps/swdnd/src/lib/starships.ts
  export interface ShipRefIndex {
    sizes: Record<string, string>;          // refId -> name
    weapons: Record<string, string>;
    armor: Record<string, string>;          // starship_armor: armor AND shields
    equipment: Record<string, string>;      // reactors, couplings, hyperdrives
    modifications: Record<string, string>;
  }
  export function shipRefIndex(ref: ShipReferenceData): ShipRefIndex;                       // ADAPTER
  export function resolveRef(index: Record<string, string>, ref: string | null, name: string): string | null;
  export function stockToShipBuild(view: StockShipView, idx: ShipRefIndex): ShipBuild;
  export function fillStockPlay(build: ShipBuild, derived: { maxHull: number; maxShields: number }): ShipBuild;
  export function createShipFromBuild(campaignId: string, build: ShipBuild): Promise<StarshipDto>;
  ```

- [ ] **Step 1: Write the failing tests** — append to `apps/swdnd/src/lib/starships.test.ts`. Ids are real; the two modification ids exercise the stale-ref name fallback verified in the pack (`H1PmkigBok9ThtyJ` no longer exists; `Adaptive Ailerons` is now `6WjkUMegKn0XeCNz`):

```ts
import { fillStockPlay, resolveRef, stockToShipBuild, type ShipRefIndex } from './starships';
import { emptyShipBuild } from './shipRules/types';

const idx: ShipRefIndex = {
  sizes: { '6BN8l5E8QtYt103T': 'Small Starship', RFKvLuqE13INBxqd: 'Large Starship' },
  weapons: { A0LPvkVHhH3e2Aeh: 'Heavy blaster cannon', aT793quog1Rf5hjm: 'Rapid-fire laser cannon' },
  armor: { aG6mKPerYCFmkI00: 'Deflection Armor', M7igMGsBIosGA4dS: 'Quick-Charge Shield' },
  equipment: { jk7zL3cqhufDKsuh: 'Fuel Cell Reactor', oqB8RltTDjHnaS1Y: 'Direct Power Coupling', EllirPMc7jJSHZpL: 'Hyperdrive, Class 1.5' },
  modifications: { '6WjkUMegKn0XeCNz': 'Adaptive Ailerons', Th7e9A044Rao7Bhf: 'Co-Pilot Seat' },
};

const item = (over: Partial<StockShipItem>): StockShipItem =>
  ({ name: '', ref: null, armorType: '', weaponType: '', ...over });

const shuttleView: StockShipView = {
  id: 'tRnGAAILKowm8n4T',
  name: "Aka'jor-class Shuttle",
  sizeRef: '6BN8l5E8QtYt103T',
  sizeName: 'Small Starship',
  tier: 2,
  abilities: { str: 13, dex: 14, con: 13, int: 8, wis: 12, cha: 14 },
  hull: 27,
  shields: 18,
  source: "Drake's Shipyard",
  weapons: [item({ name: 'Heavy blaster cannon', ref: 'A0LPvkVHhH3e2Aeh', weaponType: 'primary (starship)' })],
  equipment: [
    item({ name: 'Deflection Armor', ref: 'aG6mKPerYCFmkI00', armorType: 'starship' }),
    item({ name: 'Quick-Charge Shield', ref: 'M7igMGsBIosGA4dS', armorType: 'ssshield' }),
    item({ name: 'Fuel Cell Reactor', ref: 'jk7zL3cqhufDKsuh', armorType: 'reactor' }),
    item({ name: 'Direct Power Coupling', ref: 'oqB8RltTDjHnaS1Y', armorType: 'powerc' }),
    item({ name: 'Hyperdrive, Class 1.5', ref: 'EllirPMc7jJSHZpL', armorType: 'hyper' }),
    item({ name: 'Lucky Dice', ref: null, armorType: 'trinket' }),   // no ShipBuild kind -> dropped
  ],
  modifications: [
    item({ name: 'Adaptive Ailerons', ref: 'H1PmkigBok9ThtyJ' }),   // stale id, resolvable by name
    item({ name: 'Co-Pilot Seat', ref: null }),                     // no sourceId at all
    item({ name: 'Nonexistent Widget', ref: 'zzzzzzzzzzzzzzzz' }),  // unresolvable -> dropped
  ],
};

describe('resolveRef', () => {
  it('prefers the id when it exists in the index', () => {
    expect(resolveRef(idx.weapons, 'A0LPvkVHhH3e2Aeh', 'anything')).toBe('A0LPvkVHhH3e2Aeh');
  });
  it('falls back to a case-insensitive name match (143 of 143 mod ids in the pack are stale)', () => {
    expect(resolveRef(idx.modifications, 'H1PmkigBok9ThtyJ', 'Adaptive Ailerons')).toBe('6WjkUMegKn0XeCNz');
    expect(resolveRef(idx.modifications, null, 'co-pilot seat')).toBe('Th7e9A044Rao7Bhf');
  });
  it('returns null when neither resolves', () => {
    expect(resolveRef(idx.modifications, 'nope', 'Nonexistent Widget')).toBeNull();
    expect(resolveRef(idx.modifications, null, '')).toBeNull();
  });
});

describe('stockToShipBuild', () => {
  const build = stockToShipBuild(shuttleView, idx);

  it('carries identity, size and tier at the current build schema version', () => {
    // Seeded from emptyShipBuild, so a stock ship is stamped with whatever
    // schemaVersion (and whatever later-added play fields) the empty document has.
    expect(build.schemaVersion).toBe(emptyShipBuild('x').schemaVersion);
    expect(build.identity).toEqual({ name: "Aka'jor-class Shuttle", sizeId: '6BN8l5E8QtYt103T', tier: 2 });
  });

  it('takes the published ability scores as the base, with no tier increases', () => {
    expect(build.abilities.base).toEqual({ str: 13, dex: 14, con: 13, int: 8, wis: 12, cha: 14 });
    expect(build.abilities.increases).toEqual([]);
  });

  it('installs weapons first with a fixed-forward default mount (the pack has no mountType)', () => {
    expect(build.equipment[0]).toEqual({ id: 'e1', ref: 'A0LPvkVHhH3e2Aeh', kind: 'weapon', mount: 'fixed-forward' });
  });

  it('maps equipment kinds from system.armor.type and drops what ShipBuild cannot model', () => {
    expect(build.equipment.slice(1)).toEqual([
      { id: 'e2', ref: 'aG6mKPerYCFmkI00', kind: 'armor' },
      { id: 'e3', ref: 'M7igMGsBIosGA4dS', kind: 'shield' },
      { id: 'e4', ref: 'jk7zL3cqhufDKsuh', kind: 'reactor' },
      { id: 'e5', ref: 'oqB8RltTDjHnaS1Y', kind: 'coupling' },
      { id: 'e6', ref: 'EllirPMc7jJSHZpL', kind: 'hyperdrive' },
    ]);
    expect(JSON.stringify(build.equipment)).not.toContain('Lucky Dice');   // trinket: no ShipBuild kind
    expect(build.equipment).toHaveLength(6);
  });

  it('resolves modifications by id-then-name and drops the unresolvable', () => {
    expect(build.modifications).toEqual(['6WjkUMegKn0XeCNz', 'Th7e9A044Rao7Bhf']);
  });

  it('pins the published hull/shield totals as overrides and starts the ship at full', () => {
    expect(build.overrides).toEqual({ maxHull: 27, maxShields: 18 });
    expect(build.play.hull).toBe(27);
    expect(build.play.shields).toBe(18);
    expect(build.play.systemDamage).toBe(0);
    expect(build.play.conditions).toEqual([]);
    expect(build.play.ammoSpent).toEqual({});
    expect(build.play.notes).toBe("Stock: Aka'jor-class Shuttle (Drake's Shipyard)");
  });

  it('omits an override the pack did not publish', () => {
    const noMax = stockToShipBuild({ ...shuttleView, hull: 38, shields: null }, idx);
    expect(noMax.overrides).toEqual({ maxHull: 38 });
    expect(noMax.play.shields).toBe(0);
  });

  it('falls back to a name match for the size when the size ref is stale', () => {
    const b = stockToShipBuild({ ...shuttleView, sizeRef: 'stale' }, idx);
    expect(b.identity.sizeId).toBe('6BN8l5E8QtYt103T');
  });
});

describe('fillStockPlay', () => {
  it('tops up only the pools the pack left at zero', () => {
    const build = stockToShipBuild({ ...shuttleView, hull: null, shields: null }, idx);
    const filled = fillStockPlay(build, { maxHull: 21, maxShields: 15 });
    expect(filled.play.hull).toBe(21);
    expect(filled.play.shields).toBe(15);
    expect(filled.overrides).toEqual({});         // still derived, not pinned
  });
  it('leaves a published build untouched', () => {
    const build = stockToShipBuild(shuttleView, idx);
    expect(fillStockPlay(build, { maxHull: 999, maxShields: 999 })).toBe(build);
  });
});
```

Extend the file's existing `./starships` import with `type StockShipItem` as well.

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/asherc/Git/ashercarlow-api && bun test apps/swdnd/src/lib/starships.test.ts`
Expected: FAIL — `stockToShipBuild is not a function` / `resolveRef is not a function`; Task 3's tests still pass.

- [ ] **Step 3: Implement** — append to `apps/swdnd/src/lib/starships.ts`:

```ts
// ---- Stock ship -> ShipBuild ----

/**
 * Flat `refId -> name` lookups per reference category. ADAPTER: this is the one
 * place that knows ShipReferenceData's field names (see PREFLIGHT in the plan);
 * every conversion below works off this narrow shape so the pure logic and its
 * tests never touch the engine's view types.
 */
export interface ShipRefIndex {
  sizes: Record<string, string>;
  weapons: Record<string, string>;
  armor: Record<string, string>;
  equipment: Record<string, string>;
  modifications: Record<string, string>;
}

const names = (m: Record<string, { name: string }>): Record<string, string> =>
  Object.fromEntries(Object.entries(m ?? {}).map(([id, v]) => [id, v?.name ?? '']));

/** ADAPTER — rename these five accessors if sub-project 1 named them differently. */
export function shipRefIndex(ref: ShipReferenceData): ShipRefIndex {
  return {
    sizes: names(ref.sizes),
    weapons: names(ref.weapons),
    armor: names(ref.armor),
    equipment: names(ref.equipment),
    modifications: names(ref.modifications),
  };
}

/**
 * Resolve a pack reference: sourceId first, case-insensitive name second, null
 * third. The name fallback is load-bearing — every one of the 143 distinct
 * starship-modification ids embedded in the ship pack is stale against the
 * current modifications pack, and 5 items carry no sourceId at all.
 */
export function resolveRef(
  index: Record<string, string>,
  ref: string | null,
  name: string,
): string | null {
  if (ref && index[ref] !== undefined) return ref;
  const want = name.trim().toLowerCase();
  if (!want) return null;
  for (const [id, n] of Object.entries(index)) {
    if (n.trim().toLowerCase() === want) return id;
  }
  return null;
}

/** system.armor.type on an installed item -> ShipBuild equipment kind.
 * Anything absent here (trinket, vehicle gear, '') has no ShipBuild kind. */
const STOCK_EQUIP_KIND: Record<string, ShipEquipmentKind> = {
  starship: 'armor',
  ssshield: 'shield',
  reactor: 'reactor',
  powerc: 'coupling',
  hyper: 'hyperdrive',
};

/**
 * Convert a stock ship into a campaign-ready build. Owns every default the pack
 * omits: fixed-forward mounts, published scores as the base with no increases,
 * published pools pinned as overrides, and skip-on-unresolvable throughout
 * (trinkets and vehicle gear have no ShipBuild equipment kind).
 *
 * The document is seeded from emptyShipBuild() rather than written as a literal,
 * so it always carries the CURRENT schemaVersion and every play field later
 * sub-projects added (sub-project 2 bumps the ship document to v2 and adds
 * `play.powerDice`) — a stock ship must not be born on an older schema.
 */
export function stockToShipBuild(view: StockShipView, idx: ShipRefIndex): ShipBuild {
  const equipment: ShipEquipmentEntry[] = [];
  let n = 0;

  for (const w of view.weapons) {
    const ref = resolveRef(idx.weapons, w.ref, w.name);
    if (!ref) continue;
    equipment.push({ id: `e${++n}`, ref, kind: 'weapon', mount: 'fixed-forward' });
  }
  for (const e of view.equipment) {
    const kind = STOCK_EQUIP_KIND[e.armorType];
    if (!kind) continue;
    // starship_armor holds both armor and shields; everything else is starship_equipment.
    const table = kind === 'armor' || kind === 'shield' ? idx.armor : idx.equipment;
    const ref = resolveRef(table, e.ref, e.name);
    if (!ref) continue;
    equipment.push({ id: `e${++n}`, ref, kind });
  }

  const modifications = view.modifications
    .map((m) => resolveRef(idx.modifications, m.ref, m.name))
    .filter((r): r is string => r !== null);

  const sizeId =
    (view.sizeRef && idx.sizes[view.sizeRef] !== undefined ? view.sizeRef : null)
    ?? resolveRef(idx.sizes, null, view.sizeName)
    ?? '';

  const seed = emptyShipBuild(view.name);
  return {
    ...seed,
    identity: { name: view.name, sizeId, tier: view.tier },
    abilities: { base: { ...view.abilities }, increases: [] },
    equipment,
    modifications,
    play: {
      ...seed.play,
      hull: view.hull ?? 0,
      shields: view.shields ?? 0,
      notes: `Stock: ${view.name}${view.source ? ` (${view.source})` : ''}`,
    },
    overrides: {
      ...(view.hull !== null ? { maxHull: view.hull } : {}),
      ...(view.shields !== null ? { maxShields: view.shields } : {}),
    },
    houseRuled: [],
  };
}

/** Start an unpublished pool at its derived maximum instead of at zero. */
export function fillStockPlay(
  build: ShipBuild,
  derived: { maxHull: number; maxShields: number },
): ShipBuild {
  if (build.play.hull > 0 && build.play.shields > 0) return build;
  return {
    ...build,
    play: {
      ...build.play,
      hull: build.play.hull > 0 ? build.play.hull : derived.maxHull,
      shields: build.play.shields > 0 ? build.play.shields : derived.maxShields,
    },
  };
}

/**
 * Add a ship to a campaign fleet by composing the spine's own routes: POST
 * creates the row with an empty build by design, PATCH writes the real one.
 * A failed PATCH leaves an empty-build ship the DM can edit or delete.
 */
export async function createShipFromBuild(campaignId: string, build: ShipBuild): Promise<StarshipDto> {
  const created = await createStarship(campaignId, build.identity.name);
  return patchStarship(created.id, { data_json: build });
}
```

Extend this module's `./shipRules/types` type import with `ShipBuild`, `ShipEquipmentEntry` and `ShipEquipmentKind` if they are not already imported, and add a **value** import of `emptyShipBuild` from the same module.

- [ ] **Step 4: Run to verify pass, then typecheck**

Run: `cd /Users/asherc/Git/ashercarlow-api && bun test apps/swdnd/src/lib/starships.test.ts && cd apps/swdnd && bun run build`
Expected: PASS + clean build.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/starships.ts apps/swdnd/src/lib/starships.test.ts
git commit -m "feat(swdnd): convert stock ships into campaign ship builds"
```

---

### Task 5: Fleet cards + ship spawn bodies

**Files:**
- Create: `apps/swdnd/src/lib/shipCards.ts`
- Create: `apps/swdnd/src/lib/shipCards.test.ts`
- Modify: `apps/swdnd/src/lib/spawn.ts`
- Modify: `apps/swdnd/src/lib/spawn.test.ts`

**Interfaces:**
- Consumes: `StarshipDto`, `ShipBuild`, `ShipReferenceData`, `computeShip` (sub-project 1); `ShipPlayLike`, `PendingShipPlays` (`./shipVitals`, sub-project 3 — the shared buffered-play cache; this module does **not** declare its own); `Hex` (`./hex`).
- Produces:
  ```ts
  // apps/swdnd/src/lib/shipCards.ts
  export interface ShipCard {
    id: string; name: string; tier: number; sizeName: string;
    hull: number; maxHull: number; shields: number; maxShields: number;
    conditions: string[]; systemDamage: number;
  }
  export function cardFromShip(dto: StarshipDto, ref: ShipReferenceData): ShipCard;      // ADAPTER (sizeName)
  export function buildShipCards(ships: StarshipDto[], ref: ShipReferenceData): ShipCard[];
  export function mergeShipCardPlay(cards: ShipCard[], shipId: string, name: string, play: ShipPlayLike): ShipCard[];
  export function addShipCard(cards: ShipCard[], dto: StarshipDto, ref: ShipReferenceData): ShipCard[];
  /** Card-side overlay of the SHARED PendingShipPlays cache. The cache stores play
   *  state only, so any names those buffered events carried ride in a parallel map;
   *  a ship absent from `names` keeps the name it loaded with. */
  export function applyPendingShipCards(
    cards: ShipCard[], pending: PendingShipPlays, names?: Record<string, string>,
  ): ShipCard[];

  // apps/swdnd/src/lib/spawn.ts
  export function copyName(base: string, index: number): string;
  export interface ShipSpawnBody {
    name: string; faction: 'hostile'; q: number; r: number;
    hp: number | null; max_hp: number | null; ship_id: string; facing: number; scale: number;
  }
  export function shipSpawnBody(
    shipId: string, name: string, hull: number, maxHull: number, pos: Hex,
    facing?: number, scale?: number,
  ): ShipSpawnBody;
  ```
  `scale` is the footprint span sub-project 3 defined (`shipTokenScale(sizeKey)` — cells converted to hexes across); it defaults to 1 so a caller that cannot resolve the chassis size still spawns a legal token.

- [ ] **Step 1: Write the failing tests** — create `apps/swdnd/src/lib/shipCards.test.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import {
  addShipCard, applyPendingShipCards, buildShipCards, cardFromShip, mergeShipCardPlay,
  type ShipCard,
} from './shipCards';
import type { StarshipDto } from './starships';
import type { ShipBuild, ShipReferenceData } from './shipRules/types';

// Partial reference literal — test files are excluded from tsconfig.app.json.
const ref = {
  sizes: { '6BN8l5E8QtYt103T': { id: '6BN8l5E8QtYt103T', name: 'Small Starship' } },
  weapons: {}, armor: {}, equipment: {}, modifications: {},
} as unknown as ShipReferenceData;

/** Overrides pin the maxima, so these assertions never depend on engine math. */
const build = (over: Partial<ShipBuild> = {}): ShipBuild => ({
  schemaVersion: 1,
  identity: { name: "Aka'jor-class Shuttle", sizeId: '6BN8l5E8QtYt103T', tier: 2 },
  abilities: { base: { str: 13, dex: 14, con: 13, int: 8, wis: 12, cha: 14 }, increases: [] },
  equipment: [],
  modifications: [],
  play: {
    hull: 20, shields: 6, hullDiceSpent: 0, shieldDiceSpent: 0,
    ammoSpent: {}, conditions: ['ionized'], systemDamage: 1, notes: '',
  },
  overrides: { maxHull: 27, maxShields: 18 },
  houseRuled: [],
  ...over,
}) as ShipBuild;

const dto = (id: string, name: string, b: ShipBuild = build()): StarshipDto => ({
  id, campaign_id: 'c1', name, data_json: b, crew: [], created_at: 'n', updated_at: 'n',
}) as StarshipDto;

const card = (over: Partial<ShipCard> = {}): ShipCard => ({
  id: 's1', name: 'Shuttle', tier: 2, sizeName: 'Small Starship',
  hull: 20, maxHull: 27, shields: 6, maxShields: 18,
  conditions: ['ionized'], systemDamage: 1, ...over,
});

describe('cardFromShip', () => {
  it('reads identity and pools, and resolves the size name from the reference', () => {
    const c = cardFromShip(dto('s1', "Aka'jor-class Shuttle"), ref);
    expect(c).toEqual({
      id: 's1', name: "Aka'jor-class Shuttle", tier: 2, sizeName: 'Small Starship',
      hull: 20, maxHull: 27, shields: 6, maxShields: 18,
      conditions: ['ionized'], systemDamage: 1,
    });
  });

  it('degrades to an empty size label for an unknown size id', () => {
    const b = build({ identity: { name: 'Nameless', sizeId: 'nope', tier: 0 } } as Partial<ShipBuild>);
    expect(cardFromShip(dto('s2', 'Nameless', b), ref).sizeName).toBe('');
  });

  it('copies conditions rather than aliasing the build', () => {
    const d = dto('s1', 'Shuttle');
    const c = cardFromShip(d, ref);
    c.conditions.push('stalled');
    expect(d.data_json.play.conditions).toEqual(['ionized']);
  });
});

describe('buildShipCards', () => {
  it('makes one card per ship', () => {
    expect(buildShipCards([dto('s1', 'A'), dto('s2', 'B')], ref).map((c) => c.id)).toEqual(['s1', 's2']);
  });
});

describe('mergeShipCardPlay', () => {
  const cards = [card({ id: 's1' }), card({ id: 's2', name: 'Other' })];

  it('overlays a live ship:updated payload', () => {
    const next = mergeShipCardPlay(cards, 's1', 'Renamed', { hull: 3, shields: 0, conditions: ['slowed-2'], systemDamage: 4 });
    expect(next[0]).toEqual(card({ id: 's1', name: 'Renamed', hull: 3, shields: 0, conditions: ['slowed-2'], systemDamage: 4 }));
    expect(next[1]).toBe(cards[1]);
  });

  it('keeps the derived maxima (a mid-session refit needs a reload, as with party cards)', () => {
    const next = mergeShipCardPlay(cards, 's1', 'X', { hull: 1, shields: 1, conditions: [], systemDamage: 0 });
    expect(next[0].maxHull).toBe(27);
    expect(next[0].maxShields).toBe(18);
  });

  it('returns the same array for an unknown id', () => {
    expect(mergeShipCardPlay(cards, 'nope', 'X', { hull: 1, shields: 1, conditions: [], systemDamage: 0 })).toBe(cards);
  });
});

describe('addShipCard', () => {
  it('appends an unknown ship and replaces a known one', () => {
    const cards = [card({ id: 's1' })];
    expect(addShipCard(cards, dto('s2', 'New'), ref).map((c) => c.id)).toEqual(['s1', 's2']);
    const replaced = addShipCard(cards, dto('s1', 'Renamed'), ref);
    expect(replaced).toHaveLength(1);
    expect(replaced[0].name).toBe('Renamed');
  });
});

describe('applyPendingShipCards', () => {
  it('replays the shared buffered-play cache and ignores unknown ids', () => {
    const cards = [card({ id: 's1' })];
    const next = applyPendingShipCards(
      cards,
      {
        s1: { hull: 9, shields: 2, conditions: [], systemDamage: 0 },
        zz: { hull: 1, shields: 1, conditions: [], systemDamage: 0 },
      },
      { s1: 'Buffered' },
    );
    expect(next).toHaveLength(1);
    expect(next[0].name).toBe('Buffered');
    expect(next[0].hull).toBe(9);
  });

  it('keeps the loaded name when no buffered name was recorded', () => {
    const cards = [card({ id: 's1', name: 'Shuttle' })];
    const next = applyPendingShipCards(cards, { s1: { hull: 1, shields: 0, conditions: [], systemDamage: 0 } });
    expect(next[0]).toEqual(card({ id: 's1', name: 'Shuttle', hull: 1, shields: 0, conditions: [], systemDamage: 0 }));
  });
});
```

and append to `apps/swdnd/src/lib/spawn.test.ts`:

```ts
import { copyName, shipSpawnBody } from './spawn';

describe('copyName', () => {
  it('suffixes copies after the first', () => {
    expect(copyName('ARC-170 Starfighter', 0)).toBe('ARC-170 Starfighter');
    expect(copyName('ARC-170 Starfighter', 1)).toBe('ARC-170 Starfighter #2');
    expect(copyName('ARC-170 Starfighter', 2)).toBe('ARC-170 Starfighter #3');
  });
});

describe('shipSpawnBody', () => {
  it('binds the token to its starship row, hostile, facing forward, one hex across', () => {
    expect(shipSpawnBody('ship-1', 'ARC-170 Starfighter', 27, 27, { q: 3, r: -1 })).toEqual({
      name: 'ARC-170 Starfighter',
      faction: 'hostile',
      q: 3,
      r: -1,
      hp: 27,
      max_hp: 27,
      ship_id: 'ship-1',
      facing: 0,
      scale: 1,
    });
  });

  it('accepts an explicit facing and footprint span', () => {
    expect(shipSpawnBody('ship-1', 'X', 10, 20, { q: 0, r: 0 }, 3).facing).toBe(3);
    expect(shipSpawnBody('ship-1', 'X', 10, 20, { q: 0, r: 0 }, 0, 4).scale).toBe(4);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/asherc/Git/ashercarlow-api && bun test apps/swdnd/src/lib/shipCards.test.ts apps/swdnd/src/lib/spawn.test.ts`
Expected: FAIL — `Cannot find module './shipCards'` and `copyName is not a function`; the existing `spawnPositions`/`spawnBodies` tests still pass.

- [ ] **Step 3: Implement the cards** — create `apps/swdnd/src/lib/shipCards.ts`:

```ts
// apps/swdnd/src/lib/shipCards.ts — read-only fleet dashboard cards, the ship
// twin of partyCards.ts. Derived maxima are computed at load and cached: a
// mid-session refit won't refresh them until reload, the same documented
// trade-off the party rail accepts.
import type { StarshipDto } from './starships';
import type { ShipReferenceData } from './shipRules/types';
import type { PendingShipPlays, ShipPlayLike } from './shipVitals';
import { computeShip } from './shipRules';

// The slice of ship `play` the fleet rail displays is exactly sub-project 3's
// ShipPlayLike, and the buffered-play cache is its PendingShipPlays — one cache
// shape for the map and the DM screen instead of two near-identical ones.
// `ship:updated` payloads carry the full play object; extra fields are ignored.

export interface ShipCard {
  id: string;
  name: string;
  tier: number;
  sizeName: string;
  hull: number;
  maxHull: number;
  shields: number;
  maxShields: number;
  conditions: string[];
  systemDamage: number;
}

export function cardFromShip(dto: StarshipDto, ref: ShipReferenceData): ShipCard {
  const derived = computeShip(dto.data_json, ref);
  const { identity, play } = dto.data_json;
  return {
    id: dto.id,
    name: dto.name,
    tier: identity.tier,
    // ADAPTER: the only ShipReferenceData field this module reads (see PREFLIGHT).
    sizeName: ref.sizes[identity.sizeId]?.name ?? '',
    hull: play.hull,
    maxHull: derived.maxHull,
    shields: play.shields,
    maxShields: derived.maxShields,
    conditions: [...play.conditions],
    systemDamage: play.systemDamage,
  };
}

export function buildShipCards(ships: StarshipDto[], ref: ShipReferenceData): ShipCard[] {
  return ships.map((s) => cardFromShip(s, ref));
}

/** Merge a live `ship:updated` payload. Unknown ids return the array unchanged. */
export function mergeShipCardPlay(
  cards: ShipCard[],
  shipId: string,
  name: string,
  play: ShipPlayLike,
): ShipCard[] {
  if (!cards.some((c) => c.id === shipId)) return cards;
  return cards.map((c) => (c.id === shipId
    ? {
        ...c, name, hull: play.hull, shields: play.shields,
        conditions: [...play.conditions], systemDamage: play.systemDamage,
      }
    : c));
}

/** Replace-or-append one ship's card — used when an event names an id not yet listed. */
export function addShipCard(cards: ShipCard[], dto: StarshipDto, ref: ShipReferenceData): ShipCard[] {
  const card = cardFromShip(dto, ref);
  return cards.some((c) => c.id === card.id)
    ? cards.map((c) => (c.id === card.id ? card : c))
    : [...cards, card];
}

/**
 * Overlay plays buffered while the initial load was in flight, from the SHARED
 * PendingShipPlays cache (lib/shipVitals.ts). That cache stores play state only,
 * so a rename carried by a buffered event rides in the parallel `names` map;
 * ships missing from it keep the name they loaded with. Unknown ids are no-ops.
 */
export function applyPendingShipCards(
  cards: ShipCard[],
  pending: PendingShipPlays,
  names: Record<string, string> = {},
): ShipCard[] {
  let out = cards;
  for (const [id, play] of Object.entries(pending)) {
    const cur = out.find((c) => c.id === id);
    if (!cur) continue;
    out = mergeShipCardPlay(out, id, names[id] ?? cur.name, play);
  }
  return out;
}
```

- [ ] **Step 4: Implement the spawn bodies** — in `apps/swdnd/src/lib/spawn.ts`, add `copyName` above `spawnBodies`, use it there, and append `shipSpawnBody`:

```ts
/** `Name`, `Name #2`, `Name #3`… for multi-copy spawns. */
export function copyName(base: string, index: number): string {
  return index === 0 ? base : `${base} #${index + 1}`;
}

/** Token-create payloads for `count` copies of a statblock: hostile faction,
 * hp/max prefilled, names suffixed `#2, #3…` for multiples. */
export function spawnBodies(view: MonsterView, count: number, positions: Hex[]): SpawnBody[] {
  return positions.slice(0, count).map((pos, i) => ({
    name: copyName(view.name, i),
    faction: 'hostile',
    q: pos.q,
    r: pos.r,
    hp: view.hp,
    max_hp: view.hp,
  }));
}

export interface ShipSpawnBody {
  name: string;
  faction: 'hostile';
  q: number;
  r: number;
  hp: number | null;
  max_hp: number | null;
  /** Binds the token to its starship row (sub-project 3). */
  ship_id: string;
  facing: number;
  /** Footprint span in hexes across — shipTokenScale(sizeKey), sub-project 3. */
  scale: number;
}

/** Token payload for one spawned ship. Each spawn owns a real `starship` row,
 * so hp mirrors that ship's hull and the token carries the binding, facing and
 * the chassis footprint sub-project 3 spawns map-side ships with. */
export function shipSpawnBody(
  shipId: string,
  name: string,
  hull: number,
  maxHull: number,
  pos: Hex,
  facing = 0,
  scale = 1,
): ShipSpawnBody {
  return { name, faction: 'hostile', q: pos.q, r: pos.r, hp: hull, max_hp: maxHull, ship_id: shipId, facing, scale };
}
```

- [ ] **Step 5: Run to verify pass, then typecheck**

Run: `cd /Users/asherc/Git/ashercarlow-api && bun test apps/swdnd/src/lib/shipCards.test.ts apps/swdnd/src/lib/spawn.test.ts && cd apps/swdnd && bun run build`
Expected: PASS (including the untouched `spawnBodies` naming tests) + clean build.

> If `cardFromShip`'s assertions fail because `computeShip` rejects the partial reference literal, widen the `ref` literal in the test with the fields the engine dereferences (e.g. a full `sizes` row) — do **not** change `cardFromShip`.

- [ ] **Step 6: Commit**

```bash
git add apps/swdnd/src/lib/shipCards.ts apps/swdnd/src/lib/shipCards.test.ts apps/swdnd/src/lib/spawn.ts apps/swdnd/src/lib/spawn.test.ts
git commit -m "feat(swdnd): fleet cards and ship spawn bodies"
```

---

### Task 6: `useDmScreen` — stock ships, fleet, ship spawn, `ship:updated`

**Files:**
- Modify: `apps/swdnd/src/hooks/useDmScreen.ts`

**Interfaces:**
- Consumes: `listStockShips`, `parseStockShip`, `stockToShipBuild`, `fillStockPlay`, `shipRefIndex`, `createShipFromBuild`, `StockShipRow`, `StockShipView` (Tasks 3–4); `buildShipCards`, `applyPendingShipCards`, `mergeShipCardPlay`, `addShipCard`, `ShipCard` (Task 5); `ShipPlayLike`, `PendingShipPlays` (`lib/shipVitals.ts`, sub-project 3); `copyName`, `shipSpawnBody`, `spawnPositions` (Task 5 / existing); `listStarships`, `getStarship`, `loadShipReference`, `computeShip`, `ShipReferenceData` (sub-project 1); `listScenes`, `createToken`, `pixelToHex` (existing).
- Produces:
  ```ts
  // apps/swdnd/src/hooks/useDmScreen.ts — DmScreenState grows:
  //   stockShips: StockShipView[]
  //   shipCards: ShipCard[]
  //   shipRef: ShipReferenceData | null
  //   actions.addShipToFleet: (view: StockShipView) => Promise<void>
  //   actions.spawnShip: (view: StockShipView, count: number) => Promise<void>
  // module-private: activeSceneCenter(), spawnShipGroups()
  ```

- [ ] **Step 1: Extend the imports** — in `apps/swdnd/src/hooks/useDmScreen.ts`:

```ts
import { spawnBodies, spawnPositions, copyName, shipSpawnBody } from '../lib/spawn';
import {
  createShipFromBuild, fillStockPlay, listStarships, listStockShips, loadShipReference,
  parseStockShip, shipRefIndex, stockToShipBuild,
  type StockShipView,
} from '../lib/starships';
import {
  addShipCard, applyPendingShipCards, buildShipCards, mergeShipCardPlay, type ShipCard,
} from '../lib/shipCards';
// One buffered-play cache for the whole app — sub-project 3 owns its shape.
import type { PendingShipPlays, ShipPlayLike } from '../lib/shipVitals';
import { computeShip } from '../lib/shipRules';
import type { ShipReferenceData } from '../lib/shipRules/types';
import { shipTokenScale } from '../lib/shipTokens';
import type { Hex } from '../lib/hex';
```

(`shipTokenScale` is sub-project 3's footprint rule — a spawned hostile ship must be the same size on the map as one the DM drops from the map toolbar.)

(`getStarship` is also needed for the adopt-unknown-id path — add it to the `../lib/starships` import; sub-project 1 exports it.)

- [ ] **Step 2: Extend `DmScreenState`** — add three fields and two actions:

```ts
export interface DmScreenState {
  loading: boolean;
  error: string | null;
  campaign: CampaignDto | null;
  cards: PartyCard[];
  players: PlayerDto[];
  monsters: MonsterView[];
  stockShips: StockShipView[];
  shipCards: ShipCard[];
  shipRef: ShipReferenceData | null;
  refEntries: { conditions: RefEntry[]; weaponProperties: RefEntry[]; powers: PowerEntry[] };
  encounters: EncounterDto[];
  actions: {
    renameCampaign: (name: string) => Promise<void>;
    addPlayer: (name: string) => Promise<void>;
    renamePlayerSlot: (id: string, name: string) => Promise<void>;
    removePlayer: (id: string) => Promise<void>;
    spawn: (view: MonsterView, count: number) => Promise<void>;
    spawnEncounter: (enc: EncounterDto) => Promise<void>;
    addShipToFleet: (view: StockShipView) => Promise<void>;
    spawnShip: (view: StockShipView, count: number) => Promise<void>;
    addEncounter: (name: string) => Promise<void>;
    renameEncounter: (id: string, name: string) => Promise<void>;
    setEncounterMonsters: (id: string, monsters: EncounterMonster[]) => Promise<void>;
    removeEncounter: (id: string) => Promise<void>;
    reload: () => void;
  };
}
```

- [ ] **Step 3: Load the ship data** — add state next to the existing `useState` block:

```ts
  const [stockShips, setStockShips] = useState<StockShipView[]>([]);
  const [shipCards, setShipCards] = useState<ShipCard[]>([]);
  const [shipRef, setShipRef] = useState<ShipReferenceData | null>(null);
  const shipRefData = useRef<ShipReferenceData | null>(null);
  const shipCardsLoaded = useRef(false);
  const pendingShips = useRef<PendingShipPlays>({});
  /** Names carried by those buffered events — the shared cache holds play only. */
  const pendingShipNames = useRef<Record<string, string>>({});
```

then extend `reload`'s `Promise.all` and its `.then`:

```ts
  const reload = useCallback(() => {
    setLoading(true);
    cardsLoaded.current = false;
    shipCardsLoaded.current = false;
    pending.current = {};
    pendingShips.current = {};
    pendingShipNames.current = {};
    Promise.all([
      getCampaign(campaignId), listCharacters(campaignId), listPlayers(campaignId), loadReference(),
      api<MonsterRow[]>('/swdnd/content/monsters'),
      api<RefRow[]>('/swdnd/content/conditions'),
      api<RefRow[]>('/swdnd/content/weapon_properties'),
      listEncounters(campaignId),
      listStockShips(),
      listStarships(campaignId),
      loadShipReference(),
    ])
      .then(([camp, chars, slots, ref, monsterRows, conditionRows, wpRows, encs, stockRows, ships, sref]) => {
        refData.current = ref;
        shipRefData.current = sref;
        setShipRef(sref);
        setCampaign(camp);
        setPlayers(slots);
        setMonsters(monsterRows.map(parseMonster).sort((a, b) => a.name.localeCompare(b.name)));
        setStockShips(stockRows.map(parseStockShip).sort((a, b) => a.name.localeCompare(b.name)));
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
        shipCardsLoaded.current = true;
        setShipCards(applyPendingShipCards(buildShipCards(ships, sref), pendingShips.current, pendingShipNames.current));
        pendingShips.current = {};
        pendingShipNames.current = {};
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [campaignId]);
```

- [ ] **Step 4: Handle `ship:updated`** — inside the WS `onMessage` callback, after the `campaign:updated` early return and before the `character:updated` guard:

```ts
      if (env.type === 'ship:updated') {
        const s = env.payload as { shipId?: string; name?: string; play?: ShipPlayLike };
        if (!s?.shipId || !s.play || typeof s.name !== 'string') return;
        const { shipId, name, play } = s as { shipId: string; name: string; play: ShipPlayLike };
        if (!shipCardsLoaded.current) {
          pendingShips.current[shipId] = play;
          pendingShipNames.current[shipId] = name;
          return;
        }
        setShipCards((cur) => {
          if (cur.some((c) => c.id === shipId)) return mergeShipCardPlay(cur, shipId, name, play);
          // Unknown id: ship created after load (another DM tab spawning). Adopt it.
          const sref = shipRefData.current;
          if (sref) {
            getStarship(shipId)
              .then((sdto) => {
                const r = shipRefData.current;
                if (!r) return;
                setShipCards((c2) => mergeShipCardPlay(addShipCard(c2, sdto, r), shipId, name, play));
              })
              .catch(() => { /* deleted in the gap; stay a silent no-op */ });
          }
          return cur;
        });
        return;
      }
```

- [ ] **Step 5: Extract the spawn centre and add the ship spawn** — replace `spawnMany` with the pair below (the monster path keeps its exact previous behavior):

```ts
  /** The active scene plus the hex under its image centre. */
  const activeSceneCenter = useCallback(async (): Promise<{ sceneId: string; center: Hex }> => {
    const scenes = await listScenes(campaignId);
    const active = scenes.find((s) => s.is_active === 1);
    if (!active) throw new Error('No active scene to spawn onto — activate one on the map first.');
    const cx = (active.image_w ?? 0) / 2;
    const cy = (active.image_h ?? 0) / 2;
    const center = active.grid_json ? pixelToHex(cx, cy, active.grid_json) : { q: 0, r: 0 };
    return { sceneId: active.id, center };
  }, [campaignId]);

  // Spawn composes the existing token routes against the ACTIVE scene; tokens
  // appear on every viewer via the existing token:created broadcasts.
  const spawnMany = useCallback(async (groups: { view: MonsterView; count: number }[]) => {
    const { sceneId, center } = await activeSceneCenter();
    const total = groups.reduce((sum, g) => sum + g.count, 0);
    const positions = spawnPositions(center, total);
    let used = 0;
    for (const g of groups) {
      const bodies = spawnBodies(g.view, g.count, positions.slice(used, used + g.count));
      used += g.count;
      for (const body of bodies) await createToken(sceneId, body);
    }
  }, [activeSceneCenter]);

  const refreshFleet = useCallback(async () => {
    const sref = shipRefData.current;
    if (!sref) return;
    setShipCards(buildShipCards(await listStarships(campaignId), sref));
  }, [campaignId]);

  /** One real `starship` row per copy, then one bound token each. */
  const spawnShipGroups = useCallback(async (groups: { view: StockShipView; count: number }[]) => {
    const sref = shipRefData.current;
    if (!sref) throw new Error('Ship reference not loaded yet — reload the DM screen.');
    const idx = shipRefIndex(sref);
    const { sceneId, center } = await activeSceneCenter();
    const total = groups.reduce((sum, g) => sum + g.count, 0);
    const positions = spawnPositions(center, total);
    let used = 0;
    for (const g of groups) {
      const base = stockToShipBuild(g.view, idx);
      const build = fillStockPlay(base, computeShip(base, sref));
      const scale = shipTokenScale(sref.sizes[build.identity.sizeId]?.key ?? null);
      for (let i = 0; i < g.count; i++) {
        const name = copyName(g.view.name, i);
        const ship = await createShipFromBuild(campaignId, { ...build, identity: { ...build.identity, name } });
        const pos = positions[used++];
        await createToken(sceneId, shipSpawnBody(ship.id, name, build.play.hull, build.play.hull, pos, 0, scale));
      }
    }
    await refreshFleet();
  }, [activeSceneCenter, campaignId, refreshFleet]);
```

- [ ] **Step 6: Wire the two new actions** — inside the returned `actions` object, after `spawnEncounter`:

```ts
      addShipToFleet: wrap(async (view: StockShipView) => {
        const sref = shipRefData.current;
        if (!sref) throw new Error('Ship reference not loaded yet — reload the DM screen.');
        const base = stockToShipBuild(view, shipRefIndex(sref));
        await createShipFromBuild(campaignId, fillStockPlay(base, computeShip(base, sref)));
        await refreshFleet();
      }),
      spawnShip: wrap(async (view: StockShipView, count: number) => {
        await spawnShipGroups([{ view, count }]);
      }),
```

and add `stockShips`, `shipCards`, `shipRef` to the returned object beside `monsters`.

- [ ] **Step 7: Verify** — this is a hook with no unit test (house pattern: hooks are covered by the pure modules they compose plus the typechecker).

Run: `cd /Users/asherc/Git/ashercarlow-api/apps/swdnd && bun run build && cd /Users/asherc/Git/ashercarlow-api && bun test apps/swdnd`
Expected: clean build (this is the real verification for this task) + the frontend suite still green. Behavioral verification happens in the Task 12 walkthrough.

- [ ] **Step 8: Commit**

```bash
git add apps/swdnd/src/hooks/useDmScreen.ts
git commit -m "feat(swdnd): useDmScreen stock ships, fleet cards, and ship spawn"
```

---

### Task 7: `ShipStatblock` + `ShipBrowser` panes

**Files:**
- Create: `apps/swdnd/src/panels/DMScreen/ShipStatblock.tsx`
- Create: `apps/swdnd/src/panels/DMScreen/ShipBrowser.tsx`

**Verification note:** these are presentational components. Per house pattern (`MonsterBrowser`/`Statblock` were verified the same way) they carry **no unit tests**; verification is the typecheck plus the still-green suite, and behavior is confirmed in the Task 12 manual walkthrough. All logic they need is already unit-tested in Tasks 3–5.

**Interfaces:**
- Consumes: `StockShipView`, `filterStockShips`, `stockShipSizes`, `shipRefIndex`, `stockToShipBuild`, `ShipRefIndex` (Tasks 3–4); `computeShip`, `ShipReferenceData` (sub-project 1); `EncounterDto` (existing).
- Produces:
  ```tsx
  // apps/swdnd/src/panels/DMScreen/ShipStatblock.tsx
  export default function ShipStatblock(props: { view: StockShipView; shipRef: ShipReferenceData; idx: ShipRefIndex }): JSX.Element;
  // apps/swdnd/src/panels/DMScreen/ShipBrowser.tsx
  export default function ShipBrowser(props: {
    stock: StockShipView[];
    shipRef: ShipReferenceData | null;
    encounters: EncounterDto[];
    onAddToFleet: (view: StockShipView) => void;
    onSpawn: (view: StockShipView, count: number) => void;
    onAddToEncounter: (encounterId: string, stockShipRef: string) => void;
  }): JSX.Element;
  ```

- [ ] **Step 1: Create the statblock** — `apps/swdnd/src/panels/DMScreen/ShipStatblock.tsx`:

```tsx
// apps/swdnd/src/panels/DMScreen/ShipStatblock.tsx — a stock ship rendered
// through the real engine: the pack row is converted to a ShipBuild and fed to
// computeShip, so the browser shows exactly what "add to fleet" would create.
import { useMemo } from 'react';
import { computeShip } from '../../lib/shipRules';
import type { ShipReferenceData } from '../../lib/shipRules/types';
import { stockToShipBuild, type ShipRefIndex, type StockShipView } from '../../lib/starships';

const MOUNT_LABEL: Record<string, string> = {
  'fixed-forward': 'fwd', 'fixed-aft': 'aft', 'fixed-port': 'port',
  'fixed-starboard': 'stbd', turret: 'turret',
};

const abilityMod = (v: number): string => {
  const m = Math.floor((v - 10) / 2);
  return `${v} (${m >= 0 ? '+' : ''}${m})`;
};

export default function ShipStatblock({
  view, shipRef, idx,
}: { view: StockShipView; shipRef: ShipReferenceData; idx: ShipRefIndex }) {
  const build = useMemo(() => stockToShipBuild(view, idx), [view, idx]);
  const derived = useMemo(() => computeShip(build, shipRef), [build, shipRef]);

  const abilities: Array<[string, number]> = [
    ['STR', build.abilities.base.str], ['DEX', build.abilities.base.dex], ['CON', build.abilities.base.con],
    ['INT', build.abilities.base.int], ['WIS', build.abilities.base.wis], ['CHA', build.abilities.base.cha],
  ];
  const weapons = build.equipment.filter((e) => e.kind === 'weapon');
  const systems = build.equipment.filter((e) => e.kind !== 'weapon');
  const refName = (table: Record<string, string>, ref: string) => table[ref] ?? `(unknown ${ref})`;

  return (
    <div>
      <div className="ht-name text-sm font-bold text-ht-bright">{view.name}</div>
      <div className="text-[10px] text-ht-muted">
        {[view.sizeName, `tier ${view.tier}`].filter(Boolean).join(' · ')}
        {view.source ? ` · ${view.source}` : ''}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        <span><span className="ht-label">AC</span> {derived.armorClass}</span>
        <span><span className="ht-label">Hull</span> {derived.maxHull}</span>
        <span><span className="ht-label">Shields</span> {derived.maxShields}</span>
        <span><span className="ht-label">Speed</span> {derived.speed}</span>
        <span><span className="ht-label">Turn</span> {derived.turnSpeed}</span>
      </div>

      <div className="mt-2 grid grid-cols-6 gap-1 text-center text-[10px]">
        {abilities.map(([k, v]) => (
          <div key={k} className="rounded border border-ht-line p-1">
            <div className="ht-label">{k}</div>
            <div className="text-ht-bright">{abilityMod(v)}</div>
          </div>
        ))}
      </div>

      {weapons.length > 0 && (
        <section className="mt-3">
          <div className="ht-label mb-1">Weapons</div>
          <div className="flex flex-col gap-1 text-[11px]">
            {weapons.map((w) => (
              <div key={w.id}>
                <span className="text-ht-bright">{refName(idx.weapons, w.ref)}</span>
                <span className="text-ht-muted"> · {MOUNT_LABEL[w.mount ?? 'turret'] ?? w.mount}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {systems.length > 0 && (
        <section className="mt-3">
          <div className="ht-label mb-1">Systems</div>
          <div className="flex flex-wrap gap-1 text-[10px]">
            {systems.map((e) => (
              <span key={e.id} className="rounded border border-ht-line px-1 py-0.5">
                <span className="text-ht-bright">
                  {refName(e.kind === 'armor' || e.kind === 'shield' ? idx.armor : idx.equipment, e.ref)}
                </span>
                <span className="text-ht-muted"> · {e.kind}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {build.modifications.length > 0 && (
        <section className="mt-3">
          <div className="ht-label mb-1">Modifications ({build.modifications.length})</div>
          <div className="flex flex-wrap gap-1 text-[10px] text-ht-text">
            {build.modifications.map((ref, i) => (
              <span key={`${ref}-${i}`} className="rounded border border-ht-line px-1 py-0.5">
                {refName(idx.modifications, ref)}
              </span>
            ))}
          </div>
        </section>
      )}

      {view.hull === null && (
        <div className="mt-3 text-[10px] text-ht-muted">
          This ship publishes no hull total — pools start at the derived maxima.
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create the browser** — `apps/swdnd/src/panels/DMScreen/ShipBrowser.tsx`:

```tsx
// apps/swdnd/src/panels/DMScreen/ShipBrowser.tsx — stock-ship search/filter list
// + statblock pane with add-to-fleet, spawn and add-to-encounter controls.
import { useMemo, useState } from 'react';
import {
  filterStockShips, shipRefIndex, stockShipSizes, type StockShipView,
} from '../../lib/starships';
import type { ShipReferenceData } from '../../lib/shipRules/types';
import type { EncounterDto } from '../../lib/encounters';
import ShipStatblock from './ShipStatblock';

const TIERS = [0, 1, 2, 3, 4, 5] as const;

interface Props {
  stock: StockShipView[];
  shipRef: ShipReferenceData | null;
  encounters: EncounterDto[];
  onAddToFleet: (view: StockShipView) => void;
  onSpawn: (view: StockShipView, count: number) => void;
  onAddToEncounter: (encounterId: string, stockShipRef: string) => void;
}

export default function ShipBrowser({ stock, shipRef, encounters, onAddToFleet, onSpawn, onAddToEncounter }: Props) {
  const [q, setQ] = useState('');
  const [size, setSize] = useState('');
  const [tierMin, setTierMin] = useState('');
  const [tierMax, setTierMax] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [count, setCount] = useState(1);
  const [encId, setEncId] = useState('');

  const sizes = useMemo(() => stockShipSizes(stock), [stock]);
  const filtered = useMemo(() => filterStockShips(stock, {
    q,
    size: size || undefined,
    tierMin: tierMin === '' ? undefined : Number(tierMin),
    tierMax: tierMax === '' ? undefined : Number(tierMax),
  }), [stock, q, size, tierMin, tierMax]);
  const selected = stock.find((s) => s.id === selectedId) ?? null;
  const idx = useMemo(() => (shipRef ? shipRefIndex(shipRef) : null), [shipRef]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 @[700px]:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2 text-[11px]">
          <input
            className="w-40 border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none"
            placeholder="search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="border-b border-ht-line bg-transparent text-ht-text outline-none" value={size} onChange={(e) => setSize(e.target.value)}>
            <option value="">any size</option>
            {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="border-b border-ht-line bg-transparent text-ht-text outline-none" value={tierMin} onChange={(e) => setTierMin(e.target.value)}>
            <option value="">tier min</option>
            {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="border-b border-ht-line bg-transparent text-ht-text outline-none" value={tierMax} onChange={(e) => setTierMax(e.target.value)}>
            <option value="">tier max</option>
            {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <span className="text-[10px] text-ht-muted">{filtered.length}/{stock.length}</span>
        </div>
        <div className="max-h-[420px] overflow-y-auto @[700px]:min-h-0 @[700px]:max-h-none @[700px]:flex-1">
          {filtered.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`flex w-full items-baseline gap-2 border-b border-ht-line/50 px-1 py-1 text-left text-[11px] ${s.id === selectedId ? 'ht-tile-active' : ''}`}
              onClick={() => setSelectedId(s.id)}
            >
              <span className="text-ht-bright">{s.name}</span>
              <span className="ml-auto shrink-0 text-[10px] text-ht-muted">
                tier {s.tier}{s.sizeName ? ` · ${s.sizeName}` : ''}
              </span>
            </button>
          ))}
          {filtered.length === 0 && <div className="p-2 text-[11px] text-ht-muted">No matches.</div>}
        </div>
      </div>

      <div className="ht-panel min-w-0 flex-1 p-3 @[700px]:max-w-[46%] @[700px]:min-h-0 @[700px]:overflow-y-auto">
        {selected && shipRef && idx ? (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
              <button type="button" className="ht-step" onClick={() => onAddToFleet(selected)}>add to fleet</button>
              <select className="border-b border-ht-line bg-transparent text-ht-text outline-none" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>×{n}</option>)}
              </select>
              <button type="button" className="ht-step" onClick={() => onSpawn(selected, count)}>spawn to map</button>
              {encounters.length > 0 && (
                <span className="ml-auto flex items-center gap-1">
                  <select className="max-w-[140px] border-b border-ht-line bg-transparent text-ht-text outline-none" value={encId} onChange={(e) => setEncId(e.target.value)}>
                    <option value="">encounter…</option>
                    {encounters.map((enc) => <option key={enc.id} value={enc.id}>{enc.name}</option>)}
                  </select>
                  <button type="button" className="ht-step" onClick={() => encId && onAddToEncounter(encId, selected.id)}>+ add</button>
                </span>
              )}
            </div>
            <ShipStatblock view={selected} shipRef={shipRef} idx={idx} />
          </>
        ) : (
          <div className="text-[11px] text-ht-muted">
            {shipRef ? 'Select a ship to view its statblock.' : 'Ship reference still loading…'}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck** — the components are not wired into `index.tsx` yet; with `noUnusedLocals` that is fine (separate modules), but the build must pass.

Run: `cd /Users/asherc/Git/ashercarlow-api/apps/swdnd && bun run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/swdnd/src/panels/DMScreen/ShipStatblock.tsx apps/swdnd/src/panels/DMScreen/ShipBrowser.tsx
git commit -m "feat(swdnd): stock ship browser and derived statblock panes"
```

---

### Task 8: Fleet rail + DM screen wiring

**Files:**
- Create: `apps/swdnd/src/panels/DMScreen/FleetRail.tsx`
- Modify: `apps/swdnd/src/panels/DMScreen/index.tsx`

**Verification note:** presentational + wiring; verified by typecheck, the still-green suite, and the Task 12 manual walkthrough. No unit tests (the card logic is already tested in Task 5).

**Interfaces:**
- Consumes: `ShipCard` (Task 5); `PanelLink` (`components/split`), `hpColor`, `hpFraction`, `conditionColor` (`lib/rings`); `useDmScreen` state from Task 6.
- Produces:
  ```tsx
  // apps/swdnd/src/panels/DMScreen/FleetRail.tsx
  export default function FleetRail(props: { cards: ShipCard[]; campaignId: string }): JSX.Element;
  // DMScreen TABS becomes ['monsters', 'ships', 'encounters', 'reference']
  ```

- [ ] **Step 1: Create the rail** — `apps/swdnd/src/panels/DMScreen/FleetRail.tsx`:

```tsx
// apps/swdnd/src/panels/DMScreen/FleetRail.tsx — read-only live campaign-ship
// cards (shields over hull, as on the ship sheet). Ship names open the ShipSheet
// panel; alt-click splits, courtesy of PanelLink.
import { PanelLink } from '../../components/split';
import { conditionColor, hpColor, hpFraction } from '../../lib/rings';
import type { ShipCard } from '../../lib/shipCards';

function Card({ card, campaignId }: { card: ShipCard; campaignId: string }) {
  const hullFrac = hpFraction(card.hull, card.maxHull) ?? 0;
  const shieldFrac = hpFraction(card.shields, card.maxShields) ?? 0;
  return (
    <div className="ht-panel min-w-[220px] shrink-0 p-3 @[860px]:min-w-0 @[860px]:shrink">
      <div className="flex items-baseline justify-between gap-2">
        <PanelLink
          to={{ kind: 'ship', id: card.id }}
          current={{ kind: 'dm', id: campaignId }}
          className="ht-name text-[13px] font-bold text-ht-bright"
        >
          {card.name}
        </PanelLink>
        <span className="text-[10px] text-ht-muted">T{card.tier}</span>
      </div>
      <div className="text-[10px] text-ht-muted">{card.sizeName || 'unsized'}</div>

      <div className="mt-2 h-1.5 overflow-hidden rounded bg-ht-line/40">
        <div className="h-full" style={{ width: `${Math.round(shieldFrac * 100)}%`, background: '#89ddff' }} />
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded bg-ht-line/40">
        <div className="h-full" style={{ width: `${Math.round(hullFrac * 100)}%`, background: hpColor(hullFrac) }} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
        <span className="text-ht-bright">{card.shields}/{card.maxShields} SHD</span>
        <span className="text-ht-bright">{card.hull}/{card.maxHull} HULL</span>
        {card.systemDamage > 0 && <span className="text-red-400">SYS {card.systemDamage}</span>}
      </div>

      {card.conditions.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {card.conditions.map((cond) => (
            <span key={cond} className="rounded border border-ht-line px-1 text-[9px]" style={{ color: conditionColor(cond) }}>
              {cond}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FleetRail({ cards, campaignId }: { cards: ShipCard[]; campaignId: string }) {
  if (cards.length === 0) {
    return <div className="ht-panel p-3 text-[11px] text-ht-muted">No ships yet — add one from the ships tab.</div>;
  }
  return (
    <div className="flex gap-2 overflow-x-auto @[860px]:flex-col @[860px]:overflow-x-visible">
      {cards.map((c) => <Card key={c.id} card={c} campaignId={campaignId} />)}
    </div>
  );
}
```

- [ ] **Step 2: Wire the DM screen** — in `apps/swdnd/src/panels/DMScreen/index.tsx`:

Imports and tab list:

```tsx
import MonsterBrowser from './MonsterBrowser';
import ShipBrowser from './ShipBrowser';
import FleetRail from './FleetRail';
import EncounterList from './EncounterList';
import Reference from './Reference';
import { addMonster } from '../../lib/encounters';

const TABS = ['monsters', 'ships', 'encounters', 'reference'] as const;
```

The aside gains the fleet rail below the party rail:

```tsx
        <aside className="shrink-0 @[860px]:min-h-0 @[860px]:w-[260px] @[860px]:overflow-y-auto">
          <PartyRail cards={dm.cards} />
          <div className="mt-2">
            <div className="ht-label mb-1">Fleet</div>
            <FleetRail cards={dm.shipCards} campaignId={campaignId} />
          </div>
        </aside>
```

And the new tab body, after the `monsters` block (the `onAddToEncounter` handler lands in Task 11 — for now pass a no-op that Task 11 replaces, marked so it is impossible to forget):

```tsx
            {tab === 'ships' && (
              <ShipBrowser
                stock={dm.stockShips}
                shipRef={dm.shipRef}
                encounters={dm.encounters}
                onAddToFleet={(view) => void dm.actions.addShipToFleet(view)}
                onSpawn={(view, count) => void dm.actions.spawnShip(view, count)}
                onAddToEncounter={() => { /* wired in Task 11 (encounter ship members) */ }}
              />
            )}
```

- [ ] **Step 3: Build + frontend suite**

Run: `cd /Users/asherc/Git/ashercarlow-api/apps/swdnd && bun run build && cd /Users/asherc/Git/ashercarlow-api && bun test apps/swdnd`
Expected: clean + PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/swdnd/src/panels/DMScreen/FleetRail.tsx apps/swdnd/src/panels/DMScreen/index.tsx
git commit -m "feat(swdnd): fleet rail and ships tab on the DM screen"
```

---

### Task 9: Migration 008 — encounters gain stock ships

**Files:**
- Create: `apps/backend/src/db/migrations/swdnd/008_swdnd_encounter_ships.sql`
- Modify: `apps/backend/src/db/swdnd/index.ts`
- Modify: `apps/backend/src/routes/swdnd/encounters.ts`
- Modify: `apps/backend/src/routes/swdnd/encounters.test.ts`

> **Numbering check:** this assumes sub-project 1 took `006_swdnd_starships` and sub-project 3 took `007_*`. Before writing the file, `ls apps/backend/src/db/migrations/swdnd/` and use the next free integer, keeping the filename and the `MIGRATIONS` entry in sync.

**Interfaces:**
- Consumes: `encounter` table (migration 004), `MonsterEntry`/`Encounter`/`PostBody`/`PatchBody`/`EncounterRow`/`encounterOut` (existing in `encounters.ts`).
- Produces:
  ```ts
  // apps/backend/src/routes/swdnd/encounters.ts
  const ShipEntry = z.object({ stockShipRef: z.string().min(1), count: z.number().int().min(1) });
  // Encounter response gains  ships_json: ShipEntry[]
  // PostBody / PatchBody gain ships?: ShipEntry[]
  // encounter row gains       ships_json TEXT NOT NULL DEFAULT '[]'
  ```

- [ ] **Step 1: Write the failing tests** — append to `apps/backend/src/routes/swdnd/encounters.test.ts`:

```ts
test('encounters carry stock-ship members alongside monsters', async () => {
  const created = await app.request('/swdnd/campaigns/c1/encounters', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Blockade',
      monsters: [{ monsterId: 'm1', count: 2 }],
      ships: [{ stockShipRef: 'tRnGAAILKowm8n4T', count: 3 }],
    }),
  });
  expect(created.status).toBe(201);
  const enc = await created.json();
  expect(enc.monsters_json).toEqual([{ monsterId: 'm1', count: 2 }]);
  expect(enc.ships_json).toEqual([{ stockShipRef: 'tRnGAAILKowm8n4T', count: 3 }]);

  const patched = await app.request(`/swdnd/encounters/${enc.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ships: [{ stockShipRef: 'B5AmMDBTT6TrfW5E', count: 1 }] }),
  });
  expect(patched.status).toBe(200);
  const p = await patched.json();
  expect(p.ships_json).toEqual([{ stockShipRef: 'B5AmMDBTT6TrfW5E', count: 1 }]);
  expect(p.monsters_json).toEqual([{ monsterId: 'm1', count: 2 }]); // untouched by a ships-only patch

  const list = await app.request('/swdnd/campaigns/c1/encounters');
  const rows = await list.json();
  expect(rows.find((r: { id: string }) => r.id === enc.id).ships_json).toHaveLength(1);

  expect((await app.request(`/swdnd/encounters/${enc.id}`, { method: 'DELETE' })).status).toBe(200);
});

test('an encounter created without ships reports an empty ship list', async () => {
  const res = await app.request('/swdnd/campaigns/c1/encounters', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Ground only' }),
  });
  const enc = await res.json();
  expect(enc.ships_json).toEqual([]);
  expect((await app.request(`/swdnd/encounters/${enc.id}`, { method: 'DELETE' })).status).toBe(200);
});

test('ships validation rejects count < 1 and an empty ref', async () => {
  const bad = await app.request('/swdnd/campaigns/c1/encounters', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'bad', ships: [{ stockShipRef: 'x', count: 0 }] }),
  });
  expect(bad.status).toBe(400);
  const bad2 = await app.request('/swdnd/campaigns/c1/encounters', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'bad', ships: [{ stockShipRef: '', count: 1 }] }),
  });
  expect(bad2.status).toBe(400);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test apps/backend/src/routes/swdnd/encounters.test.ts`
Expected: FAIL — `expect(received).toEqual(expected)` with `ships_json` `undefined` (the column and the schema field do not exist); the pre-existing encounter tests pass.

- [ ] **Step 3: Write the migration** — `apps/backend/src/db/migrations/swdnd/008_swdnd_encounter_ships.sql`:

```sql
-- Encounter groups gain stock-ship members, mirroring monsters_json.
-- ships_json: [{stockShipRef, count}] where stockShipRef is a `starships`
-- reference row id. Ships are instantiated (a real `starship` row + a bound
-- token) at spawn time, so an encounter stays a reusable template.
-- Existing rows take the DEFAULT, so this is safe on a live database.
ALTER TABLE encounter ADD COLUMN ships_json TEXT NOT NULL DEFAULT '[]';
```

- [ ] **Step 4: Register it** — in `apps/backend/src/db/swdnd/index.ts`, append to `MIGRATIONS`:

```ts
  { version: '008_swdnd_encounter_ships', file: '008_swdnd_encounter_ships.sql' },
```

- [ ] **Step 5: Implement the route changes** — in `apps/backend/src/routes/swdnd/encounters.ts`:

```ts
const MonsterEntry = z.object({ monsterId: z.string().min(1), count: z.number().int().min(1) });
const ShipEntry = z.object({ stockShipRef: z.string().min(1), count: z.number().int().min(1) });
const Encounter = z.object({
  id: z.string(), campaign_id: z.string(), name: z.string(),
  monsters_json: z.array(MonsterEntry), ships_json: z.array(ShipEntry), sort: z.number(),
  created_at: z.string(), updated_at: z.string(),
}).openapi('SwdndEncounter');

const PostBody = z.object({
  name: z.string().min(1),
  monsters: z.array(MonsterEntry).optional(),
  ships: z.array(ShipEntry).optional(),
}).openapi('SwdndPostEncounter');
const PatchBody = z.object({
  name: z.string().min(1).optional(),
  monsters: z.array(MonsterEntry).optional(),
  ships: z.array(ShipEntry).optional(),
  sort: z.number().int().optional(),
}).openapi('SwdndPatchEncounter');
const ErrorBody = z.object({ message: z.string() });

interface EncounterRow {
  id: string; campaign_id: string; name: string; monsters_json: string; ships_json: string;
  sort: number; created_at: string; updated_at: string;
}

const encounterOut = (row: EncounterRow) => ({
  ...row,
  monsters_json: JSON.parse(row.monsters_json || '[]'),
  ships_json: JSON.parse(row.ships_json || '[]'),
});
```

the POST handler's insert:

```ts
    const { name, monsters, ships } = c.req.valid('json');
    const campaign = swdndDb.query<{ id: string }, [string]>('SELECT id FROM campaign WHERE id = ?').get(campaignId);
    if (!campaign) throw new HTTPException(404, { message: 'Campaign not found' });
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    swdndDb.run(
      `INSERT INTO encounter (id, campaign_id, name, monsters_json, ships_json, sort, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      [id, campaignId, name, JSON.stringify(monsters ?? []), JSON.stringify(ships ?? []), now, now],
    );
    return c.json(encounterOut(getRow(id)!), 201);
```

and the PATCH handler's update:

```ts
    swdndDb.run(
      'UPDATE encounter SET name = ?, monsters_json = ?, ships_json = ?, sort = ?, updated_at = ? WHERE id = ?',
      [
        body.name ?? row.name,
        body.monsters !== undefined ? JSON.stringify(body.monsters) : row.monsters_json,
        body.ships !== undefined ? JSON.stringify(body.ships) : row.ships_json,
        body.sort ?? row.sort,
        now,
        id,
      ],
    );
```

- [ ] **Step 6: Run to verify pass**

Run: `cd /Users/asherc/Git/ashercarlow-api && bun test apps/backend/src/routes/swdnd/encounters.test.ts apps/backend/src/routes/swdnd/gate.test.ts && bun test apps/backend`
Expected: PASS. The gate matrix is unchanged (ship members ride the same admin-gated routes), and migration 008 applies cleanly on the temp DBs the backend tests create.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/db/migrations/swdnd/008_swdnd_encounter_ships.sql apps/backend/src/db/swdnd/index.ts apps/backend/src/routes/swdnd/encounters.ts apps/backend/src/routes/swdnd/encounters.test.ts
git commit -m "feat(swdnd): stock-ship members on encounter groups"
```

---

### Task 10: Encounter ship helpers (client)

**Files:**
- Modify: `apps/swdnd/src/lib/encounters.ts`
- Modify: `apps/swdnd/src/lib/encounters.test.ts`

**Interfaces:**
- Consumes: `api` (`./api`), `EncounterMonster`, `EncounterDto` (existing).
- Produces:
  ```ts
  // apps/swdnd/src/lib/encounters.ts
  export interface EncounterShip { stockShipRef: string; count: number }
  // EncounterDto gains ships_json: EncounterShip[]
  // createEncounter / patchEncounter accept ships?: EncounterShip[]
  export function addStockShip(list: EncounterShip[], stockShipRef: string): EncounterShip[];
  export function setShipCount(list: EncounterShip[], stockShipRef: string, count: number): EncounterShip[];
  export function removeStockShip(list: EncounterShip[], stockShipRef: string): EncounterShip[];
  export function totalShipCount(list: EncounterShip[]): number;
  ```

- [ ] **Step 1: Write the failing tests** — append to `apps/swdnd/src/lib/encounters.test.ts`:

```ts
import {
  addStockShip, removeStockShip, setShipCount, totalShipCount, type EncounterShip,
} from './encounters';

describe('encounter ship helpers', () => {
  const list: EncounterShip[] = [
    { stockShipRef: 'tRnGAAILKowm8n4T', count: 2 },
    { stockShipRef: 'B5AmMDBTT6TrfW5E', count: 1 },
  ];

  it('adds a new ref at count 1 and increments a known one', () => {
    expect(addStockShip(list, 'zzz')).toEqual([...list, { stockShipRef: 'zzz', count: 1 }]);
    expect(addStockShip(list, 'B5AmMDBTT6TrfW5E')).toEqual([
      { stockShipRef: 'tRnGAAILKowm8n4T', count: 2 },
      { stockShipRef: 'B5AmMDBTT6TrfW5E', count: 2 },
    ]);
  });

  it('sets a count, dropping the entry at zero or below', () => {
    expect(setShipCount(list, 'tRnGAAILKowm8n4T', 5)[0].count).toBe(5);
    expect(setShipCount(list, 'tRnGAAILKowm8n4T', 0)).toEqual([{ stockShipRef: 'B5AmMDBTT6TrfW5E', count: 1 }]);
    expect(setShipCount(list, 'unknown', 4)).toBe(list);
  });

  it('removes and totals', () => {
    expect(removeStockShip(list, 'B5AmMDBTT6TrfW5E')).toEqual([{ stockShipRef: 'tRnGAAILKowm8n4T', count: 2 }]);
    expect(totalShipCount(list)).toBe(3);
    expect(totalShipCount([])).toBe(0);
  });

  it('never mutates the input', () => {
    const snapshot = JSON.stringify(list);
    addStockShip(list, 'zzz');
    setShipCount(list, 'tRnGAAILKowm8n4T', 9);
    removeStockShip(list, 'tRnGAAILKowm8n4T');
    expect(JSON.stringify(list)).toBe(snapshot);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/asherc/Git/ashercarlow-api && bun test apps/swdnd/src/lib/encounters.test.ts`
Expected: FAIL — `addStockShip is not a function`; the monster helpers' tests still pass.

- [ ] **Step 3: Implement** — in `apps/swdnd/src/lib/encounters.ts`, extend the DTO and wrappers and append the helpers:

```ts
export interface EncounterMonster { monsterId: string; count: number }
/** A stock-ship member: a `starships` reference row id, instantiated at spawn. */
export interface EncounterShip { stockShipRef: string; count: number }
export interface EncounterDto {
  id: string;
  campaign_id: string;
  name: string;
  monsters_json: EncounterMonster[];
  ships_json: EncounterShip[];
  sort: number;
  created_at: string;
  updated_at: string;
}

export const listEncounters = (campaignId: string) =>
  api<EncounterDto[]>(`/swdnd/campaigns/${campaignId}/encounters`);
export const createEncounter = (
  campaignId: string, name: string, monsters?: EncounterMonster[], ships?: EncounterShip[],
) =>
  api<EncounterDto>(`/swdnd/campaigns/${campaignId}/encounters`, {
    method: 'POST',
    body: JSON.stringify({ name, ...(monsters ? { monsters } : {}), ...(ships ? { ships } : {}) }),
  });
export const patchEncounter = (
  id: string,
  patch: { name?: string; monsters?: EncounterMonster[]; ships?: EncounterShip[]; sort?: number },
) => api<EncounterDto>(`/swdnd/encounters/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
```

```ts
export function addStockShip(list: EncounterShip[], stockShipRef: string): EncounterShip[] {
  return list.some((s) => s.stockShipRef === stockShipRef)
    ? list.map((s) => (s.stockShipRef === stockShipRef ? { ...s, count: s.count + 1 } : s))
    : [...list, { stockShipRef, count: 1 }];
}

export function setShipCount(list: EncounterShip[], stockShipRef: string, count: number): EncounterShip[] {
  if (!list.some((s) => s.stockShipRef === stockShipRef)) return list;
  if (count <= 0) return list.filter((s) => s.stockShipRef !== stockShipRef);
  return list.map((s) => (s.stockShipRef === stockShipRef ? { ...s, count } : s));
}

export function removeStockShip(list: EncounterShip[], stockShipRef: string): EncounterShip[] {
  return list.filter((s) => s.stockShipRef !== stockShipRef);
}

export function totalShipCount(list: EncounterShip[]): number {
  return list.reduce((sum, s) => sum + s.count, 0);
}
```

- [ ] **Step 4: Run to verify pass, then typecheck**

Run: `cd /Users/asherc/Git/ashercarlow-api && bun test apps/swdnd/src/lib/encounters.test.ts && cd apps/swdnd && bun run build`
Expected: PASS + clean build.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/encounters.ts apps/swdnd/src/lib/encounters.test.ts
git commit -m "feat(swdnd): encounter stock-ship member helpers"
```

---

### Task 11: Encounter ships in the UI and in "spawn all"

**Files:**
- Modify: `apps/swdnd/src/hooks/useDmScreen.ts`
- Modify: `apps/swdnd/src/panels/DMScreen/EncounterList.tsx`
- Modify: `apps/swdnd/src/panels/DMScreen/index.tsx`

**Verification note:** the hook and the list are wiring over already-tested pure helpers; verification is the typecheck plus the still-green suite, with behavior confirmed in the Task 12 walkthrough.

**Interfaces:**
- Consumes: `EncounterShip`, `addStockShip`, `setShipCount`, `removeStockShip`, `totalShipCount`, `patchEncounter` (Task 10); `spawnShipGroups`, `activeSceneCenter`, `stockShips` (Task 6); `StockShipView` (Task 3).
- Produces:
  ```ts
  // apps/swdnd/src/hooks/useDmScreen.ts
  //   spawnShipGroups(groups: { view: StockShipView; count: number }[], skip?: number): Promise<void>
  //   actions.setEncounterShips: (id: string, ships: EncounterShip[]) => Promise<void>
  //   actions.spawnEncounter now spawns monsters AND ships from one encounter
  // apps/swdnd/src/panels/DMScreen/EncounterList.tsx
  export default function EncounterList(props: {
    encounters: EncounterDto[];
    monsters: MonsterView[];
    stockShips: StockShipView[];
    onCreate: (name: string) => void;
    onRename: (id: string, name: string) => void;
    onSetMonsters: (id: string, monsters: EncounterMonster[]) => void;
    onSetShips: (id: string, ships: EncounterShip[]) => void;
    onSpawnAll: (enc: EncounterDto) => void;
    onDelete: (id: string) => void;
  }): JSX.Element;
  ```

- [ ] **Step 1: Make ship spawning share the placement ring** — in `apps/swdnd/src/hooks/useDmScreen.ts`, change `spawnShipGroups` to accept a leading offset so a mixed encounter never stacks ships on top of monsters:

```ts
  /** One real `starship` row per copy, then one bound token each. `skip` leaves
   * room for tokens another group already placed in the same centre-out ring. */
  const spawnShipGroups = useCallback(async (
    groups: { view: StockShipView; count: number }[],
    skip = 0,
  ) => {
    const sref = shipRefData.current;
    if (!sref) throw new Error('Ship reference not loaded yet — reload the DM screen.');
    const idx = shipRefIndex(sref);
    const { sceneId, center } = await activeSceneCenter();
    const total = groups.reduce((sum, g) => sum + g.count, 0);
    const positions = spawnPositions(center, skip + total).slice(skip);
    let used = 0;
    for (const g of groups) {
      const base = stockToShipBuild(g.view, idx);
      const build = fillStockPlay(base, computeShip(base, sref));
      const scale = shipTokenScale(sref.sizes[build.identity.sizeId]?.key ?? null);
      for (let i = 0; i < g.count; i++) {
        const name = copyName(g.view.name, i);
        const ship = await createShipFromBuild(campaignId, { ...build, identity: { ...build.identity, name } });
        const pos = positions[used++];
        await createToken(sceneId, shipSpawnBody(ship.id, name, build.play.hull, build.play.hull, pos, 0, scale));
      }
    }
    await refreshFleet();
  }, [activeSceneCenter, campaignId, refreshFleet]);
```

- [ ] **Step 2: Spawn both halves of an encounter** — replace the `spawnEncounter` action and add `setEncounterShips` next to `setEncounterMonsters`:

```ts
      spawnEncounter: wrap(async (enc: EncounterDto) => {
        const byId = new Map(monsters.map((m) => [m.id, m]));
        const groups = enc.monsters_json
          .map((e) => ({ view: byId.get(e.monsterId), count: e.count }))
          .filter((g): g is { view: MonsterView; count: number } => !!g.view);
        const shipById = new Map(stockShips.map((s) => [s.id, s]));
        const shipGroups = enc.ships_json
          .map((e) => ({ view: shipById.get(e.stockShipRef), count: e.count }))
          .filter((g): g is { view: StockShipView; count: number } => !!g.view);
        if (groups.length === 0 && shipGroups.length === 0) {
          throw new Error('No known monsters or ships in this encounter.');
        }
        if (groups.length > 0) await spawnMany(groups);
        if (shipGroups.length > 0) {
          const monsterTotal = groups.reduce((sum, g) => sum + g.count, 0);
          await spawnShipGroups(shipGroups, monsterTotal);
        }
      }),
      setEncounterShips: wrap(async (id: string, ships: EncounterShip[]) => {
        await patchEncounter(id, { ships });
        await refreshEncounters();
      }),
```

Add `setEncounterShips: (id: string, ships: EncounterShip[]) => Promise<void>;` to `DmScreenState['actions']`, and extend the `../lib/encounters` import with `type EncounterShip`.

- [ ] **Step 3: Show ships in the encounter list** — in `apps/swdnd/src/panels/DMScreen/EncounterList.tsx`, extend the imports/props:

```tsx
import {
  addMonster, addStockShip, removeMonster, removeStockShip, setCount, setShipCount,
  totalCount, totalShipCount,
  type EncounterDto, type EncounterMonster, type EncounterShip,
} from '../../lib/encounters';
import type { MonsterView } from '../../lib/monsters';
import type { StockShipView } from '../../lib/starships';
import BufferedText from './BufferedText';

interface Props {
  encounters: EncounterDto[];
  monsters: MonsterView[];
  stockShips: StockShipView[];
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onSetMonsters: (id: string, monsters: EncounterMonster[]) => void;
  onSetShips: (id: string, ships: EncounterShip[]) => void;
  onSpawnAll: (enc: EncounterDto) => void;
  onDelete: (id: string) => void;
}

export default function EncounterList({
  encounters, monsters, stockShips, onCreate, onRename, onSetMonsters, onSetShips, onSpawnAll, onDelete,
}: Props) {
  const [newName, setNewName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [addPick, setAddPick] = useState<Record<string, string>>({});
  const [shipPick, setShipPick] = useState<Record<string, string>>({});
  const nameOf = (id: string) => monsters.find((m) => m.id === id)?.name ?? `(unknown ${id})`;
  const shipNameOf = (ref: string) => stockShips.find((s) => s.id === ref)?.name ?? `(unknown ${ref})`;
```

the header count line gains ships:

```tsx
            <span className="text-[10px] text-ht-muted">
              {totalCount(enc.monsters_json)} monsters
              {totalShipCount(enc.ships_json) > 0 ? ` · ${totalShipCount(enc.ships_json)} ships` : ''}
            </span>
```

and a second chip row goes directly after the monster chip row's closing `</div>`:

```tsx
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {enc.ships_json.map((s) => (
              <span key={s.stockShipRef} className="flex items-center gap-1 rounded border border-ht-line px-1 py-0.5 text-[10px]">
                <span className="text-ht-bright">{shipNameOf(s.stockShipRef)}</span>
                <button type="button" className="text-ht-muted" onClick={() => onSetShips(enc.id, setShipCount(enc.ships_json, s.stockShipRef, s.count - 1))}>−</button>
                <span>×{s.count}</span>
                <button type="button" className="text-ht-muted" onClick={() => onSetShips(enc.id, setShipCount(enc.ships_json, s.stockShipRef, s.count + 1))}>+</button>
                <button type="button" className="text-red-400" onClick={() => onSetShips(enc.id, removeStockShip(enc.ships_json, s.stockShipRef))}>✕</button>
              </span>
            ))}
            <span className="flex items-center gap-1 text-[10px]">
              <select
                className="max-w-[160px] border-b border-ht-line bg-transparent text-ht-text outline-none"
                value={shipPick[enc.id] ?? ''}
                onChange={(e) => setShipPick((cur) => ({ ...cur, [enc.id]: e.target.value }))}
              >
                <option value="">add ship…</option>
                {stockShips.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button
                type="button"
                className="ht-step"
                onClick={() => {
                  const pick = shipPick[enc.id];
                  if (pick) onSetShips(enc.id, addStockShip(enc.ships_json, pick));
                }}
              >
                +
              </button>
            </span>
          </div>
```

Also update the empty-state copy: `No encounters yet — create a named group below, then add monsters and ships from the browsers or here.`

- [ ] **Step 4: Wire both tabs** — in `apps/swdnd/src/panels/DMScreen/index.tsx`, replace the Task 8 placeholder handler and pass the new EncounterList props:

```tsx
import { addMonster, addStockShip } from '../../lib/encounters';
```

```tsx
            {tab === 'ships' && (
              <ShipBrowser
                stock={dm.stockShips}
                shipRef={dm.shipRef}
                encounters={dm.encounters}
                onAddToFleet={(view) => void dm.actions.addShipToFleet(view)}
                onSpawn={(view, count) => void dm.actions.spawnShip(view, count)}
                onAddToEncounter={(encounterId, stockShipRef) => {
                  const enc = dm.encounters.find((e) => e.id === encounterId);
                  if (enc) void dm.actions.setEncounterShips(encounterId, addStockShip(enc.ships_json, stockShipRef));
                }}
              />
            )}
            {tab === 'encounters' && (
              <EncounterList
                encounters={dm.encounters}
                monsters={dm.monsters}
                stockShips={dm.stockShips}
                onCreate={(name) => void dm.actions.addEncounter(name)}
                onRename={(id, name) => void dm.actions.renameEncounter(id, name)}
                onSetMonsters={(id, monsters) => void dm.actions.setEncounterMonsters(id, monsters)}
                onSetShips={(id, ships) => void dm.actions.setEncounterShips(id, ships)}
                onSpawnAll={(enc) => void dm.actions.spawnEncounter(enc)}
                onDelete={(id) => void dm.actions.removeEncounter(id)}
              />
            )}
```

- [ ] **Step 5: Build + frontend suite**

Run: `cd /Users/asherc/Git/ashercarlow-api/apps/swdnd && bun run build && cd /Users/asherc/Git/ashercarlow-api && bun test apps/swdnd`
Expected: clean + PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/swdnd/src/hooks/useDmScreen.ts apps/swdnd/src/panels/DMScreen/EncounterList.tsx apps/swdnd/src/panels/DMScreen/index.tsx
git commit -m "feat(swdnd): encounter ships in the list and in spawn all"
```

---

### Task 12: Full verification + live walkthrough (coordinator-run)

**Files:** none (`.claude/launch.json` temporarily edited, MUST be reverted).

- [ ] **Step 1: Full suite + build**

Run: `cd /Users/asherc/Git/ashercarlow-api && bun test && (cd apps/swdnd && bun run build)`
Expected: 0 fail, clean build. This phase adds tests to `sw5e-map.test.ts` (4), `seed.test.ts` (1), `starships.test.ts` (~17), `shipCards.test.ts` (~8), `spawn.test.ts` (2), `encounters.test.ts` backend (3) and frontend (4) — the total must be strictly greater than the pre-task baseline with no regressions.

- [ ] **Step 2: Confirm the content path end-to-end**

```bash
cd /Users/asherc/Git/ashercarlow-api && bun -e "
import { Database } from 'bun:sqlite';
const db = new Database('data/swdnd.sqlite');
const { n, bytes } = db.query('SELECT count(*) n, sum(length(raw_json)) bytes FROM starships').get();
console.log({ n, mb: (bytes / 1e6).toFixed(2) });
const row = db.query(\"SELECT raw_json FROM starships WHERE name LIKE 'ARC-170%'\").get();
const doc = JSON.parse(row.raw_json);
console.log(doc.name, doc.system.details.tier, doc.system.attributes.hp, doc.items.filter(i => i.type === 'weapon').map(i => i.name));
"
```
Expected: `{ n: 87, mb: '1.12' }`, tier `'2'`, `hp.max` 27 / `tempmax` 37, and the ARC-170's four weapons by name.

- [ ] **Step 3: Auth-enforced walkthrough** (`.claude/launch.json` → `ASHERCARLOW_AUTH_TOKEN=dm-secret`, restart backend, DM cookie login; a campaign with a scene that has a grid, activated):
  1. Ships tab: 87 load; search, size and tier-range filters narrow the list; a statblock renders AC / hull / shields / speed / turn, weapons with `fwd` mounts, systems and mods with real names (no `(unknown …)` on a mainstream ship such as the ARC-170); pick `A/SF-01 B-wing starfighter` and confirm the "publishes no hull total" note.
  2. "add to fleet" → the ship appears on the fleet rail with shields-over-hull bars; its name opens the ShipSheet panel; alt-click splits DM+ship.
  3. "spawn to map" ×3 → three tokens (`Name`, `Name #2`, `Name #3`) clustered at map centre, hostile, bound to three new `starship` rows (all three show on the fleet rail), each drawn at its chassis footprint (a Large ship spans 2 hexes, a Gargantuan 4 — same span the map toolbar's spawner gives it); visible live on a player's map tab.
  4. Edit a spawned ship's hull on its sheet → the fleet rail card updates live via `ship:updated` without a reload.
  5. Spawn with **no active scene** → inline error, no crash, no orphan ship rows beyond the ones already created (documented: ships are created before tokens; the error surfaces at the scene lookup, which happens first).
  6. Encounters tab: add ships from the browser's `encounter…` select and from the in-row `add ship…` select; counts +/−; "spawn all" on a mixed group lands monsters and ships on distinct hexes with correct counts and `#n` suffixes.
  7. Auth: encounter POST/PATCH/DELETE and starship POST/PATCH 401 from an anonymous tab; GETs open.
- [ ] **Step 4: Deploy-path check** — build the image and confirm a pre-seeded volume backfills:

```bash
cd /Users/asherc/Git/ashercarlow-api && docker compose build
```
Expected: stage 1's `sw5e-import.ts` run reports the ship rows with no `skipping missing pack dir: drakes-shipyard`. On first boot against an existing volume the log must show `[swdnd] seeded reference content (<commit>)` even though the commit is unchanged (that is Task 2's backfill firing); a second boot logs nothing (no-op).

- [ ] **Step 5: REVERT `.claude/launch.json`**, restart the backend in dev mode.

- [ ] **Step 6: Vault docs + wrap-up** — update `Roadmap.md` (starship domain sub-project 4 complete), `Features/DM Screen.md` (ships tab, fleet rail, encounter ships), `Data Model.md` (`starships` reference table + its distillation, `encounter.ships_json`), then run the superpowers:finishing-a-development-branch menu.

---

## Self-review notes

- **Scope coverage:** stock-ship data → T1–T2; stock-ship browser (search, statblock, add-to-fleet, spawn-to-scene) → T3, T4, T6, T7; fleet rail → T5, T6, T8; encounters gain ships → T9–T11; verification → T12.
- **The prompt's premise was wrong in one place, verified against the pinned pack clone:** the `starships` pack directory is the six size chassis (already mapped to `starship_sizes`), and the 87 pre-built named ships are the **`drakes-shipyard`** pack. The new `starships` reference table is therefore fed by `drakes-shipyard`, and Task 1 asserts both mappings so the confusing pair can't be silently swapped later. The rows are Foundry **Actor** documents, so the mapper reads `system.abilities`, `system.attributes.hp` (hull = `max`, shields = `tempmax`), `system.details.tier`, and the embedded `items[]` (size, weapons, equipment, mods) rather than an Item's `system`.
- **The prompt's encounter-member shape was also wrong, and the plan adapts:** `encounter` has no member table — members are the `monsters_json` column. Migration 008 mirrors that column with `ships_json` instead of adding a nullable ref column to a nonexistent table.
- **Deliberate deviations, each data-driven:** (a) stock rows store a shape-preserving distillation, not the full Foundry doc (16 MB → 1.1 MB; every dropped field lives in the reference table the item points at); (b) `stockToShipBuild` takes a parsed `StockShipView` plus a narrow `ShipRefIndex` rather than a raw row plus `ShipReferenceData` — the browser needs the view for display anyway, and the index confines all knowledge of sub-project 1's field names to `shipRefIndex()`; (c) the name-fallback ref resolution exists because **all 143** embedded modification ids are stale against the current pack (82 recover by name, the rest are dropped, matching `monsters.ts`'s skip-on-missing posture).
- **The deploy hazard is real and handled:** `seedContentFromImage` short-circuits on matching `commit_hash`, so without Task 2 the live volume would carry an empty `starships` table forever even after a new image ships. The fix stays idempotent — after one backfill, later boots no-op again — and is covered by a test that empties the table at an unchanged commit.
- **Type consistency checked across tasks:** `StockShipRow`/`StockShipItem`/`StockShipView` (T3) match T4/T6/T7/T11 imports; `ShipRefIndex`/`stockToShipBuild`/`fillStockPlay`/`createShipFromBuild` (T4) match T6/T7; `ShipCard` (T5) matches T6/T8, and the buffered-play cache (`ShipPlayLike` / `PendingShipPlays`) is imported from sub-project 3's `lib/shipVitals.ts` rather than redeclared, with names carried in a parallel map on the hook side; `copyName`/`shipSpawnBody` (T5) match T6/T11; `EncounterShip` + helpers (T10) match T9's wire shape (`{stockShipRef, count}`) and T11's UI; `spawnShipGroups`'s `skip` parameter (T11) is the only signature change to a function introduced earlier, and it is defaulted so T6's call sites keep compiling.
- **Sub-project-1 coupling is confined to two ADAPTER functions** (`shipRefIndex`, `cardFromShip`) plus the five `DerivedShip` scalars named verbatim in the approved spec; the PREFLIGHT note tells the implementer to check them once before Task 3.
- **Known accepted trade-offs:** a failed PATCH in `createShipFromBuild` leaves an empty-build ship row (the DM can delete it); fleet-card maxima are cached until reload, matching the party rail; the DM screen now fires the ship reference loader on mount (it is a ship screen now); trinkets and vehicle gear found on a handful of pack ships are dropped because `ShipBuild` has no equipment kind for them.
