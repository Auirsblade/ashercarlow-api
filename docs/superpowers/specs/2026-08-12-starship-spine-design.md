# Starship Domain Spine Design

**Date:** 2026-08-12
**Status:** Approved
**Scope:** Sub-project 1 of the full SW5E starship domain: the `starship` entity (DB + build JSON), crew roster table, ship reference loaders, pure ship compute engine, ship CRUD/roster routes with a crew-based access model, `ship:updated` realtime, and the ShipSheet panel (budget-validating builder + live play view) wired into the split-view system. Rides with one unrelated atomic commit: per-weapon attack math on the character sheet.

## Context: the full starship domain, decomposed

Approved build order (2026-08-12), each sub-project its own spec → plan → PR cycle:

0. **Rider** — per-weapon attack math on the character play sheet (this PR, own commit).
1. **Starship spine** — *this spec.*
2. **Crew layer** — deployments/ranks/prestige on characters, role-aware ship compute (gunner proficiency etc.), power dice pools (reactor recovery, coupling topology, tech die).
3. **Space map mode** — per-scene ground/space toggle (5 ft vs 50 ft per hex), ship tokens bound to `starship` rows (`token.ship_id`), shields-over-hull double ring, facing/rotation (60° hex adaptation of the 90° RAW), multi-hex footprints, grouped initiative, ship condition vocabulary.
4. **DM ship tools** — stock-ship browser (spawn = create pre-filled `starship` + token), ships in encounter groups.

## Decisions (approved 2026-08-12)

- **Full domain, dependency order.** No session deadline; domain-first (spine → crew → map → DM tools), nothing built twice.
- **Both party models.** One shared party ship AND individual fighters must coexist → ship↔character crewing is **many-to-many** from day one.
- **Crew edits everything.** Any player owning a character on the ship's crew may edit build, play state, and roster alike. One write rule; the table trusts itself.
- **Roster is a join table, not JSON.** The write-access check ("is this player's character on this crew?") runs server-side per request; it must be queryable without parsing ship documents.
- **Crew-dependent stats deferred.** `computeShip` stays pure and ship-only in the spine. Weapon attack bonuses render as the ship's contribution plus a literal "`+ your proficiency`" suffix until the crew layer upgrades the engine.
- **Creation bootstrap.** `POST` accepts an optional initial crew assignment. Via player token it is *required* and must name a character that player owns (otherwise the creator couldn't edit their own ship). Admin creation may start with an empty roster.
- **PRs need not be atomic** (sole maintainer): the rider ships as its own commit inside this PR.

## 0. Rider: per-weapon attack math

New pure helper in `apps/swdnd/src/lib/rules/` — `weaponAttacks(build, derived, ref): WeaponAttack[]` — one entry per equipped weapon: `{name, ability, attackBonus, damageFormula, damageType}`. Ability resolution: explicit `RefWeapon.ability` if set; else finesse property → better of STR/DEX; else ranged property → DEX; else STR. Attack bonus = ability mod + proficiency bonus + `RefWeapon.attackBonus`. Damage = `damageParts` dice + the same ability mod. `Sheet/Combat.tsx` drops its single `prof + STR` and renders two clickable rolls per weapon (attack, damage) through the existing `onRoll` path (rolls land in the campaign log). Out of scope, matching current behavior: weapon-category proficiency checks, fire modes/property riders (burst, rapid). Exact `properties` keys (`fin`/`ran` vs long names) verified against ingested rows at implementation. Tests: `weaponAttacks.test.ts` — finesse picks the higher stat, ranged picks DEX, explicit ability wins, `attackBonus` folds in, damage includes mod and type.

## 1. Data model

`apps/backend/src/db/migrations/swdnd/006_swdnd_starships.sql`, registered in the `MIGRATIONS` array:

```sql
CREATE TABLE starship (
  id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  name TEXT NOT NULL, data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE starship_crew (
  ship_id TEXT NOT NULL REFERENCES starship(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES character(id) ON DELETE CASCADE,
  role TEXT NOT NULL,             -- coordinator|gunner|mechanic|operator|pilot|technician
  PRIMARY KEY (ship_id, character_id, role)
);
CREATE INDEX idx_starship_campaign ON starship(campaign_id);
CREATE INDEX idx_starship_crew_character ON starship_crew(character_id);
```

Mirrors `character` exactly: one `data_json` document (build + play), `name` denormalized alongside. SOTG's "at most one of each role except gunners" is app-level validation (warn, don't block — house-rule friendly), not a DB constraint. A character may crew multiple ships (fighter + capital ship).

`ShipBuild` (in `lib/shipRules/types.ts`, congruent with `CharacterBuild`):

```ts
ShipBuild {
  schemaVersion, identity { name, sizeId, tier },       // sizeId → starship_sizes row (the chassis)
  abilities { base, increases[] },                       // six ship abilities, tier increases
  equipment: ShipEquipmentEntry[],                       // { id, ref, kind, mount? } — armor, shields,
                                                         // reactor, coupling, weapons; weapons carry
                                                         // mount: fixed-{forward|aft|port|starboard} | turret
  modifications: string[],                               // refs into starship_modifications
  play: ShipPlayState, overrides: Record<string, number>, houseRuled?: string[]
}
ShipPlayState { hull, shields, hullDiceSpent, shieldDiceSpent,
                ammoSpent: Record<string, number>,       // keyed by equipment entry id (tertiary/quaternary)
                conditions: string[],                     -- plain + leveled ('slowed-1'…'slowed-4')
                systemDamage,                            -- numeric 0–6, its own field (not a condition string)
                notes }
```

`emptyShipBuild(name)` exported from types; hand-duplicated as `emptyShipBuildJson` in the backend route file with the existing keep-in-sync comment convention (matches `emptyBuildJson` in `characters.ts:42`).

## 2. Reference data flow

Zero backend work: `GET /swdnd/content/{category}` already serves `starship_sizes`, `starship_weapons`, `starship_armor`, `starship_equipment`, `starship_modifications`, `starship_features`, `starship_actions` (tables exist and are seeded). New frontend module **`lib/starships.ts`** mirroring `characters.ts`'s single-file layout (DTOs + REST wrappers + mappers + loader):

- Mappers over `JSON.parse(raw_json).system`: `mapShipSizeRow` (ability scores, hull/shield die type+count, speeds, hardpoint & mod-slot budgets, tier features), `mapShipWeaponRow` (category primary→quaternary, damage parts, ranges, reload/ammo, size), `mapShipArmorRow` (AC bonus / DR / Dex cap), `mapShipEquipmentRow` (shields: capacity & regen coefficients; reactors; couplings), `mapShipModRow` (type, grade, prerequisites).
- `loadShipReference(): Promise<ShipReferenceData>` — **separate** from `loadReference()`; ship data loads only on ship screens (the character loader already fires 10 requests on every panel mount). Deployments/deployment_features/ventures stay out until the crew layer.
- Tested like `characters.test.ts`: inline `raw_json` fixtures per mapper.

## 3. Compute engine

**`lib/shipRules/`** mirroring `lib/rules/`: pure, synchronous, frontend-only `computeShip(build: ShipBuild, ref: ShipReferenceData): DerivedShip`, assembled from sub-modules:

- `core.ts` — ability totals/mods (base + tier increases), tier.
- `defense.ts` — AC = 10 + Dex mod (capped by installed armor class) + tier AC bonus; DR from armor; max hull = hull dice (die by size, count by tier) + Con mod per die; max shields = shield dice + Str mod per die, scaled by the installed shield type's capacity coefficient; shield regen rate (max die × regen coefficient).
- `movement.ts` — flying speed and turning speed from the size row (+ modification effects when representable as scalars).
- `weapons.ts` — per-installed-weapon profile: `{name, category, mount, attackShipMod (WIS), damageFormula (+STR), ranges, save DC ship part (8 + WIS), reload/ammo capacity}`; rate-of-fire cap (Str mod × size multiplier) computed for display.

`DerivedShip` is computed, never stored. `OVERRIDABLE_SHIP = [maxHull, maxShields, armorClass, speed, turnSpeed]` through the same flat scalar `overrides` mechanism. Exact coefficients (hull die by size, shield type multipliers, tier AC bonus table) come from the ingested pack rows plus SOTG chapter constants in `shipRules/constants.ts`. Tests: co-located per module with hand-math fixtures, plus `shipRules/index.test.ts` assembling a full small ship, and an integration test asserting every derived number for a representative build (partial `ShipReferenceData` literals are fine — test files are excluded from `tsconfig.app.json`).

## 4. Routes, access, realtime

**`routes/swdnd/starships.ts`** (`registerStarshipRoutes`, wired in `lib/openapi.ts`):

| Route | Access | Notes |
|---|---|---|
| `GET /swdnd/campaigns/{id}/starships` | open read | list, `toApi` parses `data_json`; includes crew rows |
| `GET /swdnd/starships/{id}` | open read | ship + crew roster |
| `POST /swdnd/campaigns/{id}/starships` | admin, or player token **with required initial crew** naming an own character | seeds `emptyShipBuildJson(name)`; inserts crew row in the same transaction |
| `PATCH /swdnd/starships/{id}` | `assertShipWriteAccess` | whole-document write (last-write-wins, as characters); emits `ship:updated` |
| `DELETE /swdnd/starships/{id}` | `assertShipWriteAccess` | |
| `PUT /swdnd/starships/{id}/crew` | `assertShipWriteAccess` | body `{characterId, role}`; upsert; emits `ship:updated` |
| `DELETE /swdnd/starships/{id}/crew` | `assertShipWriteAccess` | body `{characterId, role?}` (omit role = remove from all roles); emits `ship:updated` |

- **`assertShipWriteAccess(c, shipId)`** in `access.ts`: dev-mode pass-through when `ASHERCARLOW_AUTH_TOKEN` unset (matches every other assert); else admin OR the resolved player owns any character with a `starship_crew` row for this ship (one indexed join). Crew add/remove has no extra restriction — crew edits everything, including the roster. Consequence, accepted: a crew member can remove the last crew entry and strand the ship for players (admin can always recover).
- **`selfGated()`** in `routes/swdnd/index.ts` gains `/swdnd/starships` prefix + `/starships` suffix entries so player-token writes reach the handlers (verified: without this they 403 at the blanket gate).
- **Realtime**: `ship:updated` published to `roomForCampaign(campaign_id)` with thin payload `{shipId, name, play}` — same shape philosophy as `character:updated`. Consumers in the spine: `useShipSheet` only. Cross-entity staleness (a crewed character's own update doesn't recompute an open ship sheet) is accepted, matching the documented `partyCards.ts` trade-off; the crew layer revisits.
- Route tests `starships.test.ts`: access matrix (admin / crew-member token / non-crew player token / no token) across PATCH, DELETE, and crew routes; creation bootstrap (player POST without initial crew → 400; with non-owned character → 403); cascade behavior (character delete removes crew rows, ship survives).

## 5. Sheet UI

**`panels/ShipSheet/`** mirroring `CharacterSheet/`:

- `index.tsx` — route mode switch: `Builder` vs `Sheet`, keyed by ship id.
- Hooks `useShipBuilder` / `useShipSheet` copy the character hooks' shape verbatim: `Promise.all([getStarship(id), loadShipReference()])` → `useMemo(computeShip)` → `canEdit` (admin or own character on roster, resolved from the GET's crew list + `getPlayerByToken`) → pure reducers (`shipBuildState.ts`, `shipPlayState.ts`) with optimistic dispatch and debounced PATCH (500 ms build / 400 ms play), including the armed-save-timer WS-echo merge guard and flush-on-unmount behavior.
- **Builder** keeps the step-rail shell for consistency — steps: Size → Tier → Hull & Shields → Weapons → Equipment → Modifications — but validation is **budget-based**, not sequential: new `lib/shipValidation.ts` with `shipStepStatus(build, ref, derived)` returning the existing `StepInfo` shape, where summaries report capacity ("2/4 hardpoints", "1 mod slot free", "suite 1/2"). Over-budget → `attention` with the house-rule ⌂ unlock honored, same as character validation. `StepTable` is reused as the list primitive.
- **Sheet (play view)**: core bar (AC, DR, flying/turning speed, tier), **two labeled pool bars — shields over hull** — with steppers; shield regen and Patch as one-tap actions that roll the die through `onRoll` and apply the result to the pool (the accompanying ability check stays a table call — the app never gates on it); per-weapon clickable attack/damage rolls through `onRoll` (attack renders `+N + your proficiency` until the crew layer); ammo counters on tertiary/quaternary weapons; ship conditions menu (ionized, shocked, slowed 1–4, tractored, stalled) plus a 0–6 system-damage stepper, reusing the conditions-menu component pattern; crew roster strip (name + role, `sheet` PanelLinks).
- **Navigation**: `PanelKind` gains `'ship'` → `/ship/:shipId`, `/ship/:shipId/build`; `panels.ts` KINDS/`panelPath` extended so ship⇄map / ship⇄sheet / ship⇄dm splits and alt-click behavior come free from `navigateFrom`. Entry links: DM screen campaign view lists ships; PlayerHome lists ships the player's characters crew.

## 6. Testing

House pattern throughout: `bun:test`, co-located. Engine sub-module tests with commented hand math; mapper tests with inline `raw_json`; route access-matrix + bootstrap + cascade tests; one end-to-end integration test (build a small ship through reducer actions, assert every derived stat). Existing suites must stay green (329 passing at spec time).

## 7. Explicitly out of the spine

Map/token linkage (`token.ship_id`, ship tokens, facing, footprints — sub-project 3) · deployments, ranks, prestige, power dice, tech die (sub-project 2) · stock-ship browser and encounter integration (sub-project 4) · live cross-entity recompute · `starship_roles` pack (roles are six static constants in `shipRules/constants.ts`; at implementation, check whether the pack row adds data worth mapping) · weapon-category proficiency and fire modes on the character sheet (rider keeps current assumptions).
