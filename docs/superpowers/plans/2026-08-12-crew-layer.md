# Crew Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Characters gain SotG deployments (six roles, ranks 0–5) and prestige; the ship compute engine becomes crew-aware (a deployed gunner's proficiency lands in ship attack bonuses and save DCs); ships gain power-dice pools sized by tier and shaped by their power coupling, with reactor recovery displayed and every spend/recover done by hand.

**Architecture:** All new rules are pure and unit-tested before any pixel moves. `lib/rules/` gains tolerant accessors for two new optional `CharacterBuild` fields (`deployments`, `prestige`) and one optional `PlayState` field (`techDie`) — pre-v2 documents read as empty, never migrated. A new pure module `lib/crew.ts` is the single bridge between the character engine and the ship engine: it turns crew rows + character builds into the `CrewInput` that `computeShip` accepts as an optional third argument. `lib/shipRules/power.ts` holds the SotG power-dice constants (die size by tier, capacity by coupling, reactor recovery rate) and the one function that reads them off a build. Deployment reference data (`deployments`, `deployment_features`) is mapped in `lib/starships.ts` and fetched on demand — folded into `loadShipReference()` for ship screens, fetched as a standalone two-request loader by the character sheet's Deployments UI, and never added to the ten-request character loader. Abilities are reference text, not buttons: nothing about a stratagem's cost is automated.

**Tech Stack:** Bun + Hono + @hono/zod-openapi + bun:sqlite / React + Vite + Tailwind v4 / bun:test

**Spec:** `docs/superpowers/specs/2026-08-12-starship-spine-design.md` — sub-project 2 of the starship domain decomposition (Context §7 defers exactly this scope out of the spine). Depends on sub-project 1 (starship spine) being merged. Branch: `swdnd-crew-layer`.

## Design decisions embedded in this plan (not yet individually approved)

These were chosen while writing the plan and have **not** been reviewed one by one. Read them first; changing any of them changes the task bodies below.

1. **Deployments as a flat array on `CharacterBuild`.** `deployments?: Array<{ deploymentId: string; rank: number }>` keyed by the Foundry `deployments` row id (`8B0449FqtXP02WVs` = Gunner), not by role string — the pack row is the source of truth for name/description and the role is derived from it. Sub-decisions: the array holds **only ranked entries** (setting rank 0 removes the entry, so "rank 0" and "not deployed" are the same state); the field is declared **optional** (`deployments?`, `prestige?`) exactly like the existing `houseRuled?`, and is read everywhere through `deploymentsOf(build)` / `prestigeOf(build)`, so a pre-v2 document is valid TypeScript without a migration. `emptyBuild()` always writes `deployments: []` and `prestige: 0`.
2. **`CrewInput` shape.** `{ proficiencyByRole: Partial<Record<ShipRole, number>> }` — proficiency only, nothing else, and only for roles where a crew member is deployed at rank ≥ 1 (the SotG rule). Sub-decision: when several crew members hold the same role (SotG allows multiple gunners), the **highest** proficiency bonus wins for the ship's displayed numbers.
3. **Power dice live in `ShipPlayState` as manual counters.** `powerDice?: { central: number; systems: Record<'comms'|'engines'|'shields'|'sensors'|'weapons', number> }`, moved only by explicit `spendPower` / `recoverPower` / `setPower` actions through the existing ship play reducer. Capacity and die size are *derived* (never stored); reactor recovery is *displayed* with a roll button that reports a number — the player then taps the pools. Nothing is auto-spent, auto-refilled, or auto-routed.
4. **Tech die as a manual stepper in the character's `PlayState`.** `techDie?: number` stores the *current* die size; `undefined` means "follow the rank-derived base" (d4 at Mechanic rank 1 → d12 at rank 5) and `0` means "unusable" (the RAW state after rolling a 1 on a d4). The UI walks the ladder `[0, 4, 6, 8, 10, 12]` and offers a reset-to-base; the reducer takes an absolute size so it never needs reference data. No automation of the roll-a-1 / roll-max swing.
5. **Deployment abilities render as reference text only.** Rank-gated feature lists appear on the ship sheet per crewed role and on the character sheet per deployment, each showing its power-die location and activation, beside the counters. No per-ability buttons, no cost deduction (YAGNI, and the costs in the pack data are not uniformly machine-readable).
6. **Deployment reference data loads on demand.** `loadDeploymentReference()` is two requests (`deployments`, `deployment_features`). `loadShipReference()` folds it in, so ship screens pay nothing extra; the character sheet's Deployments step/section calls it itself on mount. The ten-request `loadReference()` is untouched.
7. **`CrewInput` is built from the crewed characters' build documents alone — no character reference load.** `crewInputFrom` derives each member's proficiency with `proficiencyBonus(totalLevel(build))` (both already pure in `lib/rules/core.ts`), so `useShipSheet` fetches the crewed `CharacterDto`s and nothing else: no `loadReference()`, no `computeSheet`, zero extra content requests on a ship screen. Rationale: proficiency is the **only** field `CrewInput` consumes today, and a full `DerivedSheet` per crew member would cost the ten-request character loader per ship-sheet mount to read one number off it. Full derived sheets arrive if and when a future feature needs more of the crew's sheet (a Coordinator's skill modifiers, say) — at that point `CrewMemberInput` grows a `derived` field and `crewInputFrom` is the single call site that changes.

## Global Constraints

- Existing tests stay green — the full suite (329 tests at spine-branch point, plus whatever the spine added) must pass at every commit.
- `CharacterBuild.schemaVersion` 1 → 2 and `ShipBuild.schemaVersion` 1 → 2, with **tolerant defaults** at every read site (`?? []`, `?? 0`, accessor helpers) — no data migration, no document rewrite.
- Every JSON route is defined with `createRoute` and registered via `app.openapi(route, handler)`; this plan adds **no** new routes — `GET /swdnd/content/{category}` already serves `deployments` and `deployment_features`.
- Timestamps are ISO 8601 UTC strings.
- Realtime reuses `ship:updated` and `character:updated` — no new event types.
- `git add` explicit paths only, never `-A`.
- The frontend has no test runner for components: **UI-only tasks verify with `cd apps/swdnd && bun run build` (tsc -b, `noUnusedLocals`/`noUnusedParameters`) plus the scoped test suite**, and say so in the step.
- `bun test` from the repo root is safe (commit `8f50deb` isolates the swdnd DB under `NODE_ENV=test`); scoped runs are still preferred for speed.

## Spine contract (verify in Task 1, Step 1)

Sub-project 1 is merged before this plan runs. Every name below has been **pre-aligned against the sub-project-1 plan** (`docs/superpowers/plans/2026-08-12-starship-spine.md`); Task 1 Step 1 is now a confirmation pass, not a discovery pass — read the shipped code and, where it still differs, edit this table and the affected task bodies in place before any code is written.

| Symbol | Location | Shape |
|---|---|---|
| `ShipRole` | `apps/swdnd/src/lib/shipRules/types.ts` | `type ShipRole = 'coordinator' \| 'gunner' \| 'mechanic' \| 'operator' \| 'pilot' \| 'technician'` (declared in `types.ts`, **not** in `constants.ts`) |
| `SHIP_ROLES` | `apps/swdnd/src/lib/shipRules/constants.ts` | `SHIP_ROLES: ShipRole[]` — the six roles, in the order above |
| `ShipBuild`, `ShipPlayState`, `ShipEquipmentEntry`, `DerivedShip`, `ShipReferenceData`, `emptyShipBuild(name)` | `apps/swdnd/src/lib/shipRules/types.ts` | spec §1/§2/§3; `ShipBuild.identity.tier: number`, `ShipBuild.equipment: ShipEquipmentEntry[]` with `{ id, ref, kind, mount? }` and `kind: ShipEquipmentKind = 'armor' \| 'shield' \| 'reactor' \| 'coupling' \| 'hyperdrive' \| 'weapon'` |
| ship equipment reference map | `ShipReferenceData` | field named **`equipment`**: `Record<string, RefShipEquipment>` (reactors, couplings, hyperdrives); `RefShipEquipment` already carries `{ id, name, kind }` where `kind` is `'reactor' \| 'hyperdrive' \| 'coupling' \| 'other'`. Note `ShipReferenceData.armor` holds hull armor **and** shields. |
| `computeShip(build, ref)` | `apps/swdnd/src/lib/shipRules/index.ts` | pure, synchronous |
| `shipWeaponProfiles(build, ref)` | `apps/swdnd/src/lib/shipRules/weapons.ts` | returns `ShipWeaponProfile[]` carrying `attackShipMod` (Wis mod + the weapon's own bonus), `attackText` (`'+3 + your proficiency'`) and `saveDc: number \| null` — on save weapons, the pack's own `RefShipWeapon.saveDc` wins when present (e.g. a flat-scaling ion cannon printed at DC 13); `8 + Wis` is only the fallback for rows that omit it; `null` on attack weapons |
| `loadShipReference()`, module-local `ShipRow` / `system(row)` / `descriptionOf(s)` / `byId(rows)` | `apps/swdnd/src/lib/starships.ts` | mirrors `lib/characters.ts:60-81,228-231` (the ship module names its row type `ShipRow`, not `Row`) |
| ship crew rows on `GET /swdnd/starships/{id}` | `apps/backend/src/routes/swdnd/starships.ts` | `crew: Array<{ character_id: string; character_name: string; role: ShipRole }>` |
| `applyShipPlayAction(build, derived, action)` | `apps/swdnd/src/lib/shipPlayState.ts` | mirrors `lib/playState.ts:25` |
| `useShipSheet(shipId)` | `apps/swdnd/src/hooks/useShipSheet.ts` | returns `{ loading, error, build, derived, ref, play, canEdit, dto, crew, dispatch, reload }` — `reload` is a cheap DTO-only GET (no reference refetch), also called from the WS handler; `loading` already folds in `authLoading` + `identityLoading`; a `latestBuildRef` mirrors `build` so the debounced PATCH always composes from the freshest known document |
| `ship:updated` WS payload | published in `apps/backend/src/routes/swdnd/starships.ts`, consumed in `useShipSheet.ts` | exactly 4 keys: `{ shipId: string; name: string; play: ShipPlayState; data_json: ShipBuild }` — key-exact backend tests exist; any crew-plan code reading or re-asserting this payload must expect all 4 keys |
| `emptyShipBuildJson(name)` | `apps/backend/src/routes/swdnd/starships.ts` | hand-duplicated empty ship document with the keep-in-sync comment |
| ShipSheet play view | `apps/swdnd/src/panels/ShipSheet/Sheet/index.tsx` | composes sections and owns a `roll(label, formula)`-style helper wired to `postRoll` |

## Verified facts (checked against the repo while writing this plan)

- `deployments` has exactly **6 rows** (Coordinator, Gunner, Mechanic, Operator, Pilot, Technician — `content_source: 'SotG'`); `deployment_features` has **109 rows**.
- Every deployment feature's `system.requirements` matches `^<Name> <N>(st|nd|rd|th) Rank$`. Names are the six deployments plus a single `Universal 1st Rank` row.
- Power-die location comes from `system.consume.target`: `attributes.power.{comms|engines|sensors|shields|weapons}.value`. CORRECTED (Task 1 Step 1 confirmation, checked against `data/swdnd.sqlite`): **39 rows have one** (`consume.type: 'powerdice'` exactly matches these 39 — comms 12, engines 8, weapons 8, shields 7, sensors 4), the other **70 have no `consume` block at all** — not the 71/38 split originally stated here. There is no `central` target in the pack.
- `system.activation.type` ∈ `'' | action | bonus | reaction | none | special | minute`.
- `starship_equipment` holds 17 rows: 3 couplings (`Direct` / `Distributed` / `Hub & Spoke Power Coupling`, `system.equipmentType === 'powerc'`), 3 reactors (`Fuel Cell` / `Ionization` / `Power Core Reactor`, `equipmentType === 'reactor'`), 11 hyperdrives.
- Tech die is the **Mechanic's** (`System Boost`, Mechanic 1st Rank): starts d4, becomes d6/d8/d10/d12 at ranks 2/3/4/5; using it does not expend it; rolling a 1 shrinks it one size until the end of your next turn, rolling max grows it one size (cap d12).
- The pack contains **no prestige rules** — prestige is a bare tracked number.
- `schemaVersion: 1` is asserted in exactly two tests: `apps/swdnd/src/lib/rules/types.test.ts:7` and `apps/backend/src/routes/swdnd/characters.test.ts:31`.
- Baseline before the spine: `bun test` → 329 pass, 0 fail, 54 files.
- **Task 1 Step 1 confirmation pass (re-run against the spine's final-review fix wave, post-harmonization):** the Spine contract table and Tasks 7/9 below were re-checked against shipped code and corrected in place — `useShipSheet` gained `reload`/`latestBuildRef`/folded loading (table row + no task-body change needed), `ship:updated`'s 4-key payload got its own table row (no task body asserted the old shape, so no further edit needed), `RefShipWeapon.saveDc` pack-DC-precedence is now stated precisely in the table and Task 7's DC composition + tests were corrected so crew proficiency never modifies a flat pack DC, and Task 9's WS-handler edit was re-based onto the hook's actual early-return-guard shape (the drafted "beside the branch" framing was unreachable as written) with a `crewMembersRef` added to avoid a stale-closure bug. Two other reported deltas were checked and found **not** to touch this plan: `RefWeapon.weaponType` is a character-engine field (`lib/rules/types.ts`) unrelated to the ship-side `RefShipWeapon` this plan touches; `useShipBuilder`'s campaign-WS subscription is never referenced by any task here.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `apps/swdnd/src/lib/shipRules/types.ts` | modify | `PowerSystem`, `PowerDicePool`, `CrewInput`, `RefDeployment`, `RefDeploymentFeature`, `DeploymentReferenceData`; `ShipReferenceData` + `ShipPlayState` extensions |
| `apps/swdnd/src/lib/shipRules/constants.ts` | modify | `POWER_SYSTEMS` |
| `apps/swdnd/src/lib/starships.ts` | modify | `mapDeploymentRow`, `mapDeploymentFeatureRow`, `loadDeploymentReference`, extended `loadShipReference` |
| `apps/swdnd/src/lib/starships.test.ts` | modify | mapper tests with inline `raw_json` |
| `apps/swdnd/src/lib/rules/types.ts` | modify | `DeploymentEntry`, `CharacterBuild.deployments?/prestige?`, `PlayState.techDie?`, `schemaVersion: 2` |
| `apps/swdnd/src/lib/rules/core.ts` | modify | `deploymentsOf`, `prestigeOf` |
| `apps/backend/src/routes/swdnd/characters.ts` | modify | `emptyBuildJson` kept in sync (v2) |
| `apps/swdnd/src/lib/buildState.ts` | modify | `setDeploymentRank`, `setPrestige` |
| `apps/swdnd/src/lib/validation.ts` | modify | `deployments` step (optional, never `attention`) |
| `apps/swdnd/src/lib/crew.ts` | create | `deploymentRankForRole`, `crewInputFrom`, `techDieForRank`, `currentTechDie`, `TECH_DIE_LADDER` |
| `apps/swdnd/src/lib/crew.test.ts` | create | crew rules tests |
| `apps/swdnd/src/lib/shipRules/power.ts` | create | die by tier, coupling capacity, reactor recovery, pool helpers, `derivePower` |
| `apps/swdnd/src/lib/shipRules/power.test.ts` | create | hand-math tests |
| `apps/swdnd/src/lib/shipRules/index.ts` | modify | `computeShip(build, ref, crew?)`, `DerivedShip.power` |
| `apps/swdnd/src/lib/shipRules/weapons.ts` | modify | crew-aware attack bonus + save DC |
| `apps/swdnd/src/lib/shipPlayState.ts` | modify | `spendPower` / `recoverPower` / `setPower` |
| `apps/swdnd/src/lib/playState.ts` | modify | `setTechDie` |
| `apps/backend/src/routes/swdnd/starships.ts` | modify | `emptyShipBuildJson` v2 with `powerDice` |
| `apps/swdnd/src/hooks/useShipSheet.ts` | modify | crew DTO loading, `CrewInput`, `character:updated` refresh |
| `apps/swdnd/src/panels/CharacterSheet/Builder/steps/Deployments.tsx` | create | builder step |
| `apps/swdnd/src/panels/CharacterSheet/Builder/index.tsx` | modify | step wiring |
| `apps/swdnd/src/panels/CharacterSheet/Builder/StepRail.tsx` | modify | step label |
| `apps/swdnd/src/panels/CharacterSheet/Sheet/Deployments.tsx` | create | sheet section: ranks, features, prestige, tech die |
| `apps/swdnd/src/panels/CharacterSheet/Sheet/index.tsx` | modify | section wiring |
| `apps/swdnd/src/panels/ShipSheet/Sheet/PowerDice.tsx` | create | pools + die + reactor recovery |
| `apps/swdnd/src/panels/ShipSheet/Sheet/CrewAbilities.tsx` | create | rank-gated reference text per crewed role |
| `apps/swdnd/src/panels/ShipSheet/Sheet/index.tsx` | modify | section wiring |

Execution order: 1 → 2 → 3 → 4 (character data + reference) · 5 → 6 → 7 → 8 (engines + reducers) · 9 (hook) · 10 → 11 → 12 (UI) · 13 (verification).

---

### Task 1: Deployment reference — types, mappers, on-demand loader

**Files:**
- Modify: `apps/swdnd/src/lib/shipRules/types.ts`
- Modify: `apps/swdnd/src/lib/shipRules/constants.ts`
- Modify: `apps/swdnd/src/lib/starships.ts`
- Modify: `apps/swdnd/src/lib/starships.test.ts`

**Interfaces:**
- Consumes: `ShipRole` (`shipRules/types.ts`), `SHIP_ROLES` (`shipRules/constants.ts`); module-local `ShipRow`, `system(row)`, `descriptionOf(s)`, `byId(rows)`, `api` (`lib/starships.ts`, mirroring `lib/characters.ts:60-81,228-231`); `ShipReferenceData` (`shipRules/types.ts`); `GET /swdnd/content/deployments`, `GET /swdnd/content/deployment_features`.
- Produces:
  - `type PowerSystem = 'comms' | 'engines' | 'shields' | 'sensors' | 'weapons'`
  - `const POWER_SYSTEMS: PowerSystem[]`
  - `interface RefDeployment { id: string; name: string; role: ShipRole | null; description: string }`
  - `interface RefDeploymentFeature { id: string; name: string; role: ShipRole | 'universal'; rank: number; powerSystem: PowerSystem | null; activation: string; description: string }`
  - `interface DeploymentReferenceData { deployments: Record<string, RefDeployment>; deploymentFeatures: Record<string, RefDeploymentFeature> }`
  - `ShipReferenceData` gains `deployments` + `deploymentFeatures` (the two `DeploymentReferenceData` fields)
  - `function mapDeploymentRow(row: ShipRow): RefDeployment`
  - `function mapDeploymentFeatureRow(row: ShipRow): RefDeploymentFeature`
  - `function loadDeploymentReference(): Promise<DeploymentReferenceData>`

- [ ] **Step 1: Confirm the spine contract**

Read `apps/swdnd/src/lib/shipRules/types.ts`, `apps/swdnd/src/lib/shipRules/constants.ts`, `apps/swdnd/src/lib/shipRules/index.ts`, `apps/swdnd/src/lib/shipRules/weapons.ts`, `apps/swdnd/src/lib/starships.ts`, `apps/swdnd/src/lib/shipPlayState.ts`, `apps/swdnd/src/hooks/useShipSheet.ts`, `apps/backend/src/routes/swdnd/starships.ts`, `apps/swdnd/src/panels/ShipSheet/Sheet/index.tsx`.

The **Spine contract** table above is already written against sub-project 1's plan, so this step is a confirmation: check each row against the shipped code and, if anything drifted, correct the table **and** the later task bodies **in this plan file** (`docs/superpowers/plans/2026-08-12-crew-layer.md`) before writing feature code. Re-confirm in particular: `ShipRole` lives in `shipRules/types.ts` while `SHIP_ROLES` lives in `shipRules/constants.ts`; `ShipReferenceData.equipment` (not `shipEquipment`) holds reactors/couplings/hyperdrives while `.armor` holds armor and shields; the weapon function is `shipWeaponProfiles` and its profile carries `attackShipMod` / `attackText` / `saveDc: number | null`; `lib/starships.ts` names its row type `ShipRow` and its helpers `system` / `descriptionOf` / `byId`; crew rows carry `character_name` beside `character_id` and `role`. `RefShipEquipment` already carries `name`, so no spine edit is expected here — if one turns out to be unavoidable it must be additive and noted in the commit body. Do not write feature code in this step.

- [ ] **Step 2: Write the failing tests**

Append to `apps/swdnd/src/lib/starships.test.ts` (add the three new mappers/loaders to the existing import from `./starships`):

```ts
test('mapDeploymentRow derives the role key from the row name', () => {
  const row = {
    id: '8B0449FqtXP02WVs', name: 'Gunner',
    raw_json: JSON.stringify({ system: { description: { value: '<p>Guns &amp; more guns.</p>' } } }),
  };
  const d = mapDeploymentRow(row);
  expect(d).toMatchObject({ id: '8B0449FqtXP02WVs', name: 'Gunner', role: 'gunner' });
  expect(d.description).toContain('Guns & more guns.');
  // A row whose name is not one of the six SotG deployments has no role.
  expect(mapDeploymentRow({ id: 'x', name: 'Quartermaster', raw_json: '{}' }).role).toBeNull();
});

test('mapDeploymentFeatureRow parses role, rank, power-die location and activation', () => {
  const row = {
    id: 'dSMbwvdqRmrHWvwl', name: 'Angle Deflector Shields',
    raw_json: JSON.stringify({
      system: {
        requirements: 'Technician 1st Rank',
        activation: { type: 'reaction', cost: 1, condition: '' },
        consume: { type: 'powerdice', target: 'attributes.power.shields.value', amount: 1 },
        description: { value: '<p>Reduce the damage absorbed by your shields.</p>' },
      },
    }),
  };
  const f = mapDeploymentFeatureRow(row);
  expect(f).toMatchObject({
    id: 'dSMbwvdqRmrHWvwl', name: 'Angle Deflector Shields',
    role: 'technician', rank: 1, powerSystem: 'shields', activation: 'reaction',
  });
  expect(f.description).toContain('Reduce the damage absorbed by your shields.');
});

test('mapDeploymentFeatureRow handles every rank ordinal and the Universal outlier', () => {
  const at = (requirements: string) =>
    mapDeploymentFeatureRow({ id: 'r', name: 'R', raw_json: JSON.stringify({ system: { requirements } }) });
  expect(at('Gunner 2nd Rank')).toMatchObject({ role: 'gunner', rank: 2 });
  expect(at('Pilot 3rd Rank')).toMatchObject({ role: 'pilot', rank: 3 });
  expect(at('Operator 4th Rank')).toMatchObject({ role: 'operator', rank: 4 });
  expect(at('Mechanic 5th Rank')).toMatchObject({ role: 'mechanic', rank: 5 });
  expect(at('Universal 1st Rank')).toMatchObject({ role: 'universal', rank: 1 });
  // Unparseable requirements fall into the universal bucket at rank 0 (always visible).
  expect(at('')).toMatchObject({ role: 'universal', rank: 0 });
});

test('mapDeploymentFeatureRow leaves powerSystem null when nothing is consumed', () => {
  const row = {
    id: 'f', name: 'F',
    raw_json: JSON.stringify({
      system: { requirements: 'Pilot 1st Rank', consume: { type: '', target: '', amount: null } },
    }),
  };
  expect(mapDeploymentFeatureRow(row)).toMatchObject({ powerSystem: null, activation: '' });
});
```

- [ ] **Step 3: Run and watch it FAIL**

Run: `bun test apps/swdnd/src/lib/starships.test.ts`
Expected: FAIL — `SyntaxError: export 'mapDeploymentRow' not found in module` (or `mapDeploymentRow is not a function`).

- [ ] **Step 4: Types**

In `apps/swdnd/src/lib/shipRules/types.ts` add (`ShipRole` is declared in this same file by the spine, so no import is needed):

```ts
export type PowerSystem = 'comms' | 'engines' | 'shields' | 'sensors' | 'weapons';

/** A SotG deployment (one of the six crew roles) as it appears in the pack. */
export interface RefDeployment {
  id: string;
  name: string;
  /** Derived from the row name; null for rows that are not one of the six roles. */
  role: ShipRole | null;
  description: string;
}

/** A rank-gated deployment ability. Rendered as reference text — never automated. */
export interface RefDeploymentFeature {
  id: string;
  name: string;
  /** 'universal' covers the single SotG universal feature and unparseable rows. */
  role: ShipRole | 'universal';
  rank: number;                    // 1..5; 0 when the requirement line is unparseable
  powerSystem: PowerSystem | null; // which capacitor the ability spends from
  activation: string;              // '' | action | bonus | reaction | none | special | minute
  description: string;
}

export interface DeploymentReferenceData {
  deployments: Record<string, RefDeployment>;
  deploymentFeatures: Record<string, RefDeploymentFeature>;
}
```

and add the two fields to the existing `ShipReferenceData` interface:

```ts
  deployments: Record<string, RefDeployment>;
  deploymentFeatures: Record<string, RefDeploymentFeature>;
```

In `apps/swdnd/src/lib/shipRules/constants.ts` add:

```ts
import type { PowerSystem } from './types';

/** SotG system capacitors, in sheet display order. */
export const POWER_SYSTEMS: PowerSystem[] = ['comms', 'engines', 'shields', 'sensors', 'weapons'];
```

- [ ] **Step 5: Mappers + loader**

In `apps/swdnd/src/lib/starships.ts` add (type imports extended with `DeploymentReferenceData`, `PowerSystem`, `RefDeployment`, `RefDeploymentFeature`, `ShipRole` from `./shipRules/types`; value import `SHIP_ROLES` from `./shipRules/constants`):

```ts
const ROLE_SET = new Set<string>(SHIP_ROLES);
function asRole(v: unknown): ShipRole | null {
  const k = String(v ?? '').trim().toLowerCase();
  return ROLE_SET.has(k) ? (k as ShipRole) : null;
}

export function mapDeploymentRow(row: ShipRow): RefDeployment {
  const s = system(row);
  const name = row.name ?? row.id;
  return { id: row.id, name, role: asRole(name), description: descriptionOf(s) };
}

// "Technician 1st Rank" / "Gunner 4th Rank" / "Universal 1st Rank" — the only
// machine-readable link between a feature and its deployment + rank.
const REQUIREMENT_RE = /^\s*([A-Za-z]+)\s+(\d+)(?:st|nd|rd|th)\s+rank/i;
const POWER_TARGET_RE = /^attributes\.power\.(comms|engines|shields|sensors|weapons)\.value$/;

export function mapDeploymentFeatureRow(row: ShipRow): RefDeploymentFeature {
  const s = system(row);
  const m = REQUIREMENT_RE.exec(typeof s.requirements === 'string' ? s.requirements : '');
  const target = typeof s.consume?.target === 'string' ? s.consume.target : '';
  const ps = POWER_TARGET_RE.exec(target);
  return {
    id: row.id,
    name: row.name ?? row.id,
    role: (m ? asRole(m[1]) : null) ?? 'universal',
    rank: m ? Number(m[2]) : 0,
    powerSystem: ps ? (ps[1] as PowerSystem) : null,
    activation: typeof s.activation?.type === 'string' ? s.activation.type : '',
    description: descriptionOf(s),
  };
}

/**
 * Two requests, fetched on demand. Ship screens get these through
 * loadShipReference(); the character sheet's Deployments UI calls this directly
 * rather than growing the ten-request character loader.
 */
export async function loadDeploymentReference(): Promise<DeploymentReferenceData> {
  const [deployments, features] = await Promise.all([
    api<ShipRow[]>('/swdnd/content/deployments'),
    api<ShipRow[]>('/swdnd/content/deployment_features'),
  ]);
  return {
    deployments: byId(deployments.map(mapDeploymentRow)),
    deploymentFeatures: byId(features.map(mapDeploymentFeatureRow)),
  };
}
```

Then extend `loadShipReference()`: add `loadDeploymentReference()` as the last entry of its `Promise.all` array, destructure it as `deploymentRef`, and spread `...deploymentRef` into the returned object.

- [ ] **Step 6: Run and watch it PASS**

Run: `bun test apps/swdnd/src/lib/starships.test.ts`
Expected: PASS — all mapper tests green, including the pre-existing spine mapper tests.

- [ ] **Step 7: Commit**

```bash
git add apps/swdnd/src/lib/shipRules/types.ts apps/swdnd/src/lib/shipRules/constants.ts apps/swdnd/src/lib/starships.ts apps/swdnd/src/lib/starships.test.ts docs/superpowers/plans/2026-08-12-crew-layer.md
git commit -m "feat(swdnd): map deployment + deployment-feature reference rows"
```

---

### Task 2: `CharacterBuild` v2 — deployments, prestige, tech die

**Files:**
- Modify: `apps/swdnd/src/lib/rules/types.ts`
- Modify: `apps/swdnd/src/lib/rules/core.ts`
- Modify: `apps/swdnd/src/lib/rules/types.test.ts`
- Modify: `apps/swdnd/src/lib/rules/core.test.ts`
- Modify: `apps/backend/src/routes/swdnd/characters.ts`
- Modify: `apps/backend/src/routes/swdnd/characters.test.ts`

**Interfaces:**
- Consumes: `CharacterBuild`, `PlayState`, `emptyBuild(name)` (`lib/rules/types.ts`).
- Produces:
  - `interface DeploymentEntry { deploymentId: string; rank: number }`
  - `CharacterBuild.deployments?: DeploymentEntry[]`
  - `CharacterBuild.prestige?: number`
  - `PlayState.techDie?: number`
  - `emptyBuild(name)` now returns `schemaVersion: 2`, `deployments: []`, `prestige: 0`
  - `function deploymentsOf(build: CharacterBuild): DeploymentEntry[]`
  - `function prestigeOf(build: CharacterBuild): number`
  - backend `emptyBuildJson(name)` emits the same v2 document

- [ ] **Step 1: Write the failing tests**

Replace the body of `apps/swdnd/src/lib/rules/types.test.ts`:

```ts
// apps/swdnd/src/lib/rules/types.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild, type CharacterBuild } from './types';

test('emptyBuild produces a schema-versioned, playable blank build', () => {
  const b: CharacterBuild = emptyBuild('Lyra Voss');
  expect(b.schemaVersion).toBe(2);
  expect(b.identity.name).toBe('Lyra Voss');
  expect(b.identity.alignment).toBe('none');
  expect(b.abilities.base).toEqual({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
  expect(b.levels).toEqual([]);
  expect(b.play.hp).toBe(0);
  expect(b.overrides).toEqual({});
  expect(b.houseRuled).toEqual([]);
  expect(b.deployments).toEqual([]);
  expect(b.prestige).toBe(0);
  // Absent tech die means "follow the Mechanic-rank base" — see lib/crew.ts.
  expect(b.play.techDie).toBeUndefined();
});
```

Append to `apps/swdnd/src/lib/rules/core.test.ts` (extend the existing import from `./core` with `deploymentsOf, prestigeOf`, and from `./types` with `type CharacterBuild`):

```ts
test('deploymentsOf / prestigeOf tolerate pre-v2 documents', () => {
  const legacy = { ...emptyBuild('Old'), schemaVersion: 1 } as CharacterBuild;
  delete (legacy as { deployments?: unknown }).deployments;
  delete (legacy as { prestige?: unknown }).prestige;
  expect(deploymentsOf(legacy)).toEqual([]);
  expect(prestigeOf(legacy)).toBe(0);

  const ranked: CharacterBuild = {
    ...emptyBuild('New'),
    deployments: [{ deploymentId: 'gunner-row', rank: 3 }],
    prestige: 7,
  };
  expect(deploymentsOf(ranked)).toEqual([{ deploymentId: 'gunner-row', rank: 3 }]);
  expect(prestigeOf(ranked)).toBe(7);
});
```

Edit `apps/backend/src/routes/swdnd/characters.test.ts:31`:

```ts
  expect(char.data_json.schemaVersion).toBe(2); // parsed, not a string
```

- [ ] **Step 2: Run and watch it FAIL**

Run: `bun test apps/swdnd/src/lib/rules/types.test.ts apps/swdnd/src/lib/rules/core.test.ts apps/backend/src/routes/swdnd/characters.test.ts`
Expected: FAIL — `expect(1).toBe(2)` in types.test.ts and characters.test.ts, plus `deploymentsOf is not a function` in core.test.ts.

- [ ] **Step 3: Types**

In `apps/swdnd/src/lib/rules/types.ts` add above `CharacterBuild`:

```ts
/** A SotG deployment the character holds, at rank 1–5. Rank 0 entries are never stored. */
export interface DeploymentEntry {
  deploymentId: string;            // id of a `deployments` reference row
  rank: number;                    // 1..5
}
```

add to `PlayState`:

```ts
  /**
   * Mechanic's tech die, as a die SIZE (4|6|8|10|12), or 0 while unusable.
   * Absent → follow the rank-derived base (see techDieForRank in lib/crew.ts).
   * Manual: the roll-a-1 / roll-max swing is never automated.
   */
  techDie?: number;
```

add to `CharacterBuild` (after `houseRuled`):

```ts
  /** SotG deployments held, ranked. Absent on pre-v2 documents — read via deploymentsOf(). */
  deployments?: DeploymentEntry[];
  /** SotG prestige, a plain tracked number. Absent on pre-v2 documents — read via prestigeOf(). */
  prestige?: number;
```

and in `emptyBuild`: `schemaVersion: 2`, plus `deployments: [],` and `prestige: 0,` after `houseRuled: []`.

- [ ] **Step 4: Accessors**

Append to `apps/swdnd/src/lib/rules/core.ts` (extend the type import with `DeploymentEntry`):

```ts
/** Tolerant read: pre-v2 documents have no `deployments` field. */
export function deploymentsOf(build: CharacterBuild): DeploymentEntry[] {
  return build.deployments ?? [];
}

/** Tolerant read: pre-v2 documents have no `prestige` field. */
export function prestigeOf(build: CharacterBuild): number {
  return build.prestige ?? 0;
}
```

- [ ] **Step 5: Backend empty document**

In `apps/backend/src/routes/swdnd/characters.ts`, `emptyBuildJson` (the hand-duplicated mirror of `emptyBuild()` — keep the existing keep-in-sync comment): set `schemaVersion: 2` and add `deployments: [], prestige: 0,` after `houseRuled: []`:

```ts
    overrides: {},
    houseRuled: [],
    deployments: [],
    prestige: 0,
```

- [ ] **Step 6: Run and watch it PASS**

Run: `bun test apps/swdnd/src/lib/rules/ apps/backend/src/routes/swdnd/characters.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/swdnd/src/lib/rules/types.ts apps/swdnd/src/lib/rules/core.ts apps/swdnd/src/lib/rules/types.test.ts apps/swdnd/src/lib/rules/core.test.ts apps/backend/src/routes/swdnd/characters.ts apps/backend/src/routes/swdnd/characters.test.ts
git commit -m "feat(swdnd): character build v2 — deployments, prestige, tech die"
```

---

### Task 3: Build reducer — `setDeploymentRank` / `setPrestige`

**Files:**
- Modify: `apps/swdnd/src/lib/buildState.ts`
- Modify: `apps/swdnd/src/lib/buildState.test.ts`

**Interfaces:**
- Consumes: `applyBuildAction(build, ref, derived, action)`, `deploymentsOf` (Task 2), `DeploymentEntry` (Task 2).
- Produces:
  - `BuildAction` gains `{ t: 'setDeploymentRank'; deploymentId: string; rank: number }`
  - `BuildAction` gains `{ t: 'setPrestige'; prestige: number }`

- [ ] **Step 1: Write the failing tests**

Append to `apps/swdnd/src/lib/buildState.test.ts` (the file already defines `ref` and `derived` fixtures near the top — reuse them):

```ts
test('setDeploymentRank adds, updates, and clears a deployment', () => {
  const b0 = emptyBuild('x');
  const b1 = applyBuildAction(b0, ref, derived, { t: 'setDeploymentRank', deploymentId: 'gunner-row', rank: 2 });
  expect(b1.deployments).toEqual([{ deploymentId: 'gunner-row', rank: 2 }]);

  const b2 = applyBuildAction(b1, ref, derived, { t: 'setDeploymentRank', deploymentId: 'gunner-row', rank: 5 });
  expect(b2.deployments).toEqual([{ deploymentId: 'gunner-row', rank: 5 }]);

  const b3 = applyBuildAction(b2, ref, derived, { t: 'setDeploymentRank', deploymentId: 'pilot-row', rank: 1 });
  expect(b3.deployments).toEqual([{ deploymentId: 'gunner-row', rank: 5 }, { deploymentId: 'pilot-row', rank: 1 }]);

  // Rank 0 removes the entry entirely — "unranked" and "not deployed" are one state.
  const b4 = applyBuildAction(b3, ref, derived, { t: 'setDeploymentRank', deploymentId: 'gunner-row', rank: 0 });
  expect(b4.deployments).toEqual([{ deploymentId: 'pilot-row', rank: 1 }]);
});

test('setDeploymentRank clamps to 0..5 and never mutates the input build', () => {
  const b0 = emptyBuild('x');
  expect(applyBuildAction(b0, ref, derived, { t: 'setDeploymentRank', deploymentId: 'g', rank: 9 }).deployments)
    .toEqual([{ deploymentId: 'g', rank: 5 }]);
  expect(applyBuildAction(b0, ref, derived, { t: 'setDeploymentRank', deploymentId: 'g', rank: -2 }).deployments)
    .toEqual([]);
  expect(b0.deployments).toEqual([]);
});

test('setPrestige stores a clamped whole number', () => {
  const b0 = emptyBuild('x');
  expect(applyBuildAction(b0, ref, derived, { t: 'setPrestige', prestige: 12 }).prestige).toBe(12);
  expect(applyBuildAction(b0, ref, derived, { t: 'setPrestige', prestige: -5 }).prestige).toBe(0);
  expect(applyBuildAction(b0, ref, derived, { t: 'setPrestige', prestige: 3.7 }).prestige).toBe(3);
});
```

- [ ] **Step 2: Run and watch it FAIL**

Run: `bun test apps/swdnd/src/lib/buildState.test.ts`
Expected: FAIL — TypeScript-level union mismatch at runtime shows as the actions falling through the switch: `expect(undefined).toEqual([{...}])`.

- [ ] **Step 3: Implement**

In `apps/swdnd/src/lib/buildState.ts`:

Extend the type import with `DeploymentEntry` and the value import from `./rules/core` with `deploymentsOf`:

```ts
import { classLevelOrdinal, deploymentsOf, totalAbilityScores } from './rules/core';
```

Add to the `BuildAction` union:

```ts
  | { t: 'setDeploymentRank'; deploymentId: string; rank: number }
  | { t: 'setPrestige'; prestige: number };
```

Add to `clone()` (so a later action can't mutate the caller's array):

```ts
  deployments: deploymentsOf(b).map((d) => ({ ...d })),
```

Add the two cases to the switch:

```ts
    case 'setDeploymentRank': {
      const rank = Math.max(0, Math.min(5, Math.trunc(action.rank)));
      const kept: DeploymentEntry[] = deploymentsOf(b).filter((d) => d.deploymentId !== action.deploymentId);
      // Rank 0 is "not deployed": the entry is dropped rather than stored as a zero.
      b.deployments = rank > 0 ? [...kept, { deploymentId: action.deploymentId, rank }] : kept;
      break;
    }

    case 'setPrestige':
      b.prestige = Math.max(0, Math.trunc(action.prestige));
      break;
```

Note on ordering: an existing entry that is re-ranked moves to the end of the array. The UI renders deployments from the reference list, not from array order, so this is invisible — the test above encodes it.

- [ ] **Step 4: Run and watch it PASS**

Run: `bun test apps/swdnd/src/lib/buildState.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/buildState.ts apps/swdnd/src/lib/buildState.test.ts
git commit -m "feat(swdnd): build actions for deployment ranks and prestige"
```

---

### Task 4: Validation — the Deployments step

**Files:**
- Modify: `apps/swdnd/src/lib/validation.ts`
- Modify: `apps/swdnd/src/lib/validation.test.ts`

**Interfaces:**
- Consumes: `stepStatus(build, ref, derived)`, `StepInfo`, `deploymentsOf`, `prestigeOf`.
- Produces:
  - `StepKey` gains `'deployments'`
  - `STEP_ORDER` becomes `['species','background','class','abilities','skills','feats','equipment','powers','deployments']`
  - `stepStatus(...).deployments: StepInfo` — always `applicable: true`, `'untouched'` while nothing is set, `'done'` otherwise, **never** `'attention'`

- [ ] **Step 1: Write the failing tests**

Append to `apps/swdnd/src/lib/validation.test.ts`:

```ts
test('deployments step is optional: untouched when empty, never attention', () => {
  const empty = stepStatus(emptyBuild('x'), ref, derived(0));
  expect(STEP_ORDER).toEqual([
    'species', 'background', 'class', 'abilities', 'skills', 'feats', 'equipment', 'powers', 'deployments',
  ]);
  expect(empty.deployments).toEqual({ state: 'untouched', summary: '—', applicable: true });

  const one = stepStatus(
    { ...emptyBuild('x'), deployments: [{ deploymentId: 'gunner-row', rank: 3 }] },
    ref, derived(0),
  );
  expect(one.deployments).toEqual({ state: 'done', summary: '1 deployment · 0 prestige', applicable: true });

  const many = stepStatus(
    {
      ...emptyBuild('x'),
      deployments: [{ deploymentId: 'gunner-row', rank: 5 }, { deploymentId: 'pilot-row', rank: 1 }],
      prestige: 12,
    },
    ref, derived(0),
  );
  expect(many.deployments).toEqual({ state: 'done', summary: '2 deployments · 12 prestige', applicable: true });

  // Prestige alone counts as touched; nothing about deployments ever demands attention.
  const prestigeOnly = stepStatus({ ...emptyBuild('x'), prestige: 4 }, ref, derived(0));
  expect(prestigeOnly.deployments.state).toBe('done');
  for (const build of [emptyBuild('x'), { ...emptyBuild('x'), deployments: [{ deploymentId: 'g', rank: 5 }], prestige: 99 }]) {
    expect(stepStatus(build, ref, derived(0)).deployments.state).not.toBe('attention');
  }
});
```

- [ ] **Step 2: Run and watch it FAIL**

Run: `bun test apps/swdnd/src/lib/validation.test.ts`
Expected: FAIL — `expect(received).toEqual(expected)` on `STEP_ORDER` (8 entries vs 9) and `expect(undefined).toEqual({ state: 'untouched', … })`.

- [ ] **Step 3: Implement**

In `apps/swdnd/src/lib/validation.ts`:

```ts
import { classesTaken, classLevelOrdinal, deploymentsOf, prestigeOf } from './rules/core';
```

```ts
export type StepKey =
  | 'species' | 'background' | 'class' | 'abilities'
  | 'skills' | 'feats' | 'equipment' | 'powers' | 'deployments';
export const STEP_ORDER: StepKey[] = [
  'species', 'background', 'class', 'abilities', 'skills', 'feats', 'equipment', 'powers', 'deployments',
];
```

Before the return object, add:

```ts
  // Deployments are optional crew content: they can be empty forever without
  // ever asking for attention. The summary stays reference-free because
  // deployment names live in the on-demand deployment reference, not in
  // ReferenceData — the step component names them.
  const ranked = deploymentsOf(build).filter((d) => d.rank > 0);
  const prestige = prestigeOf(build);
  const deploymentsInfo: StepInfo = ranked.length === 0 && prestige === 0
    ? info('untouched', '—')
    : info('done', `${ranked.length} deployment${ranked.length === 1 ? '' : 's'} · ${prestige} prestige`);
```

and add `deployments: deploymentsInfo,` to the returned record.

- [ ] **Step 4: Run and watch it PASS**

Run: `bun test apps/swdnd/src/lib/validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/validation.ts apps/swdnd/src/lib/validation.test.ts
git commit -m "feat(swdnd): optional Deployments step in builder validation"
```

---

### Task 5: `lib/crew.ts` — crew input and tech-die rules

**Files:**
- Create: `apps/swdnd/src/lib/crew.ts`
- Create: `apps/swdnd/src/lib/crew.test.ts`
- Modify: `apps/swdnd/src/lib/shipRules/types.ts`

**Interfaces:**
- Consumes: `CharacterBuild`, `PlayState` (`lib/rules/types.ts`); `deploymentsOf` (Task 2), `proficiencyBonus`, `totalLevel` (`lib/rules/core.ts`); `RefDeployment` (Task 1); `ShipRole` (`shipRules/types.ts`).
- Produces:
  - `interface CrewInput { proficiencyByRole: Partial<Record<ShipRole, number>> }` (in `shipRules/types.ts`)
  - `interface CrewMemberInput { role: ShipRole; build: CharacterBuild }` — build only; proficiency is derived here (design decision 7)
  - `function deploymentRankForRole(build: CharacterBuild, role: ShipRole, deployments: Record<string, RefDeployment>): number`
  - `function crewInputFrom(members: CrewMemberInput[], deployments: Record<string, RefDeployment>): CrewInput`
  - `const TECH_DIE_LADDER: readonly number[]` = `[0, 4, 6, 8, 10, 12]`
  - `function techDieForRank(rank: number): number`
  - `function currentTechDie(build: CharacterBuild, play: PlayState, deployments: Record<string, RefDeployment>): { base: number; current: number; overridden: boolean }`
  - `function crewProficiency(build: CharacterBuild): number` — `proficiencyBonus(totalLevel(build))`, the whole of the cheap path

- [ ] **Step 1: Write the failing tests**

```ts
// apps/swdnd/src/lib/crew.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild, type CharacterBuild, type PlayState } from './rules/types';
import {
  crewInputFrom, crewProficiency, currentTechDie, deploymentRankForRole, techDieForRank, TECH_DIE_LADDER,
} from './crew';
import type { RefDeployment } from './shipRules/types';

const deployments: Record<string, RefDeployment> = {
  gun: { id: 'gun', name: 'Gunner', role: 'gunner', description: '' },
  pil: { id: 'pil', name: 'Pilot', role: 'pilot', description: '' },
  mec: { id: 'mec', name: 'Mechanic', role: 'mechanic', description: '' },
  odd: { id: 'odd', name: 'Quartermaster', role: null, description: '' },
};

function character(levels: number, entries: Array<{ deploymentId: string; rank: number }>): CharacterBuild {
  const b = emptyBuild('crew');
  b.levels = Array.from({ length: levels }, (_, i) => ({
    n: i + 1, classId: 'fighter', archetypeId: null, hp: 'avg' as const, choices: {},
  }));
  b.deployments = entries;
  return b;
}

test('deploymentRankForRole matches through the deployment reference, best rank wins', () => {
  const b = character(5, [{ deploymentId: 'gun', rank: 2 }, { deploymentId: 'pil', rank: 4 }]);
  expect(deploymentRankForRole(b, 'gunner', deployments)).toBe(2);
  expect(deploymentRankForRole(b, 'pilot', deployments)).toBe(4);
  expect(deploymentRankForRole(b, 'mechanic', deployments)).toBe(0);
  // Unknown ids and role-less rows contribute nothing.
  expect(deploymentRankForRole(character(1, [{ deploymentId: 'odd', rank: 5 }]), 'gunner', deployments)).toBe(0);
  expect(deploymentRankForRole(character(1, [{ deploymentId: 'ghost', rank: 5 }]), 'gunner', deployments)).toBe(0);
  // Pre-v2 documents have no deployments at all.
  expect(deploymentRankForRole(emptyBuild('old'), 'gunner', deployments)).toBe(0);
});

test('crewProficiency reads the character total level, no reference data needed', () => {
  expect(crewProficiency(character(1, []))).toBe(2);
  expect(crewProficiency(character(5, []))).toBe(3);
  expect(crewProficiency(character(17, []))).toBe(6);
});

test('crewInputFrom only counts crew deployed at rank 1+ in the role they crew', () => {
  const gunner = character(5, [{ deploymentId: 'gun', rank: 1 }]);      // prof +3
  const pilotNotDeployed = character(9, []);                            // prof +4, no deployment
  const wrongRole = character(17, [{ deploymentId: 'pil', rank: 5 }]);  // prof +6, but crews as mechanic

  const input = crewInputFrom([
    { role: 'gunner', build: gunner },
    { role: 'pilot', build: pilotNotDeployed },
    { role: 'mechanic', build: wrongRole },
  ], deployments);

  expect(input.proficiencyByRole).toEqual({ gunner: 3 });
});

test('crewInputFrom keeps the best proficiency when a role is double-crewed', () => {
  const rookie = character(1, [{ deploymentId: 'gun', rank: 1 }]);  // prof +2
  const veteran = character(13, [{ deploymentId: 'gun', rank: 3 }]); // prof +5
  const input = crewInputFrom([
    { role: 'gunner', build: veteran },
    { role: 'gunner', build: rookie },
  ], deployments);
  expect(input.proficiencyByRole).toEqual({ gunner: 5 });
  expect(crewInputFrom([], deployments).proficiencyByRole).toEqual({});
});

test('techDieForRank walks the SotG ladder', () => {
  expect(TECH_DIE_LADDER).toEqual([0, 4, 6, 8, 10, 12]);
  expect([0, 1, 2, 3, 4, 5].map(techDieForRank)).toEqual([0, 4, 6, 8, 10, 12]);
  expect(techDieForRank(9)).toBe(12);
  expect(techDieForRank(-1)).toBe(0);
});

test('currentTechDie prefers the stored size and reports whether it is overridden', () => {
  const mech = character(5, [{ deploymentId: 'mec', rank: 3 }]);
  const play = (techDie?: number): PlayState => ({ ...emptyBuild('x').play, techDie });

  expect(currentTechDie(mech, play(), deployments)).toEqual({ base: 8, current: 8, overridden: false });
  expect(currentTechDie(mech, play(6), deployments)).toEqual({ base: 8, current: 6, overridden: true });
  // 0 is the RAW "unusable" state, not "unset".
  expect(currentTechDie(mech, play(0), deployments)).toEqual({ base: 8, current: 0, overridden: true });
  // No Mechanic deployment → no tech die at all.
  expect(currentTechDie(emptyBuild('x'), play(), deployments)).toEqual({ base: 0, current: 0, overridden: false });
});
```

- [ ] **Step 2: Run and watch it FAIL**

Run: `bun test apps/swdnd/src/lib/crew.test.ts`
Expected: FAIL — `Cannot find module './crew'`.

- [ ] **Step 3: Add `CrewInput` to the ship types**

In `apps/swdnd/src/lib/shipRules/types.ts`:

```ts
/**
 * What the ship engine knows about its crew. Proficiency only, and only for
 * roles whose crew member is deployed at rank 1+ (SotG). Absent → the sheet
 * falls back to the spine's "+ your proficiency" display.
 */
export interface CrewInput {
  proficiencyByRole: Partial<Record<ShipRole, number>>;
}
```

- [ ] **Step 4: Implement `lib/crew.ts`**

```ts
// apps/swdnd/src/lib/crew.ts
// The single bridge between the character engine and the ship engine: crew
// rows + character builds in, CrewInput out. Pure and synchronous.
import { deploymentsOf, proficiencyBonus, totalLevel } from './rules/core';
import type { CharacterBuild, PlayState } from './rules/types';
import type { CrewInput, RefDeployment, ShipRole } from './shipRules/types';

export interface CrewMemberInput {
  /** The role this character is crewing on the ship (from `starship_crew`). */
  role: ShipRole;
  build: CharacterBuild;
}

/**
 * A crew member's proficiency bonus, straight off their build document.
 *
 * Deliberately NOT `computeSheet(...).proficiencyBonus`: proficiency is the only
 * number CrewInput consumes, and reaching it through a full DerivedSheet would
 * make every ship-sheet mount pay the ten-request character reference loader
 * (design decision 7). If a later feature needs more of the crew's derived
 * sheet, add the reference load then and widen CrewMemberInput.
 */
export function crewProficiency(build: CharacterBuild): number {
  return proficiencyBonus(totalLevel(build));
}

/** Best rank the character holds in the deployment matching `role` (0 = none). */
export function deploymentRankForRole(
  build: CharacterBuild,
  role: ShipRole,
  deployments: Record<string, RefDeployment>,
): number {
  let best = 0;
  for (const entry of deploymentsOf(build)) {
    if (deployments[entry.deploymentId]?.role !== role) continue;
    if (entry.rank > best) best = entry.rank;
  }
  return best;
}

/**
 * SotG: a crew member contributes their proficiency bonus only in a role they
 * are deployed to at rank 1 or higher. Several crew in one role (multiple
 * gunners are legal) resolve to the best bonus.
 */
export function crewInputFrom(
  members: CrewMemberInput[],
  deployments: Record<string, RefDeployment>,
): CrewInput {
  const proficiencyByRole: Partial<Record<ShipRole, number>> = {};
  for (const m of members) {
    if (deploymentRankForRole(m.build, m.role, deployments) < 1) continue;
    const prof = crewProficiency(m.build);
    const current = proficiencyByRole[m.role];
    if (current === undefined || prof > current) proficiencyByRole[m.role] = prof;
  }
  return { proficiencyByRole };
}

/** Tech-die sizes by Mechanic rank: index 0 (no rank) = unusable. */
export const TECH_DIE_LADDER: readonly number[] = [0, 4, 6, 8, 10, 12];

export function techDieForRank(rank: number): number {
  const r = Math.max(0, Math.min(5, Math.trunc(rank)));
  return TECH_DIE_LADDER[r];
}

/**
 * The tech die to render. `play.techDie` is the player's manual override — the
 * temporary shrink/grow from rolling a 1 or the maximum, which we never
 * automate. Absent means "sitting at the rank-derived base".
 */
export function currentTechDie(
  build: CharacterBuild,
  play: PlayState,
  deployments: Record<string, RefDeployment>,
): { base: number; current: number; overridden: boolean } {
  const base = techDieForRank(deploymentRankForRole(build, 'mechanic', deployments));
  const overridden = typeof play.techDie === 'number';
  return { base, current: overridden ? play.techDie! : base, overridden };
}
```

- [ ] **Step 5: Run and watch it PASS**

Run: `bun test apps/swdnd/src/lib/crew.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/swdnd/src/lib/crew.ts apps/swdnd/src/lib/crew.test.ts apps/swdnd/src/lib/shipRules/types.ts
git commit -m "feat(swdnd): crew rules — role proficiency input and tech-die ladder"
```

---

### Task 6: `shipRules/power.ts` — power dice constants and derivation

**Files:**
- Create: `apps/swdnd/src/lib/shipRules/power.ts`
- Create: `apps/swdnd/src/lib/shipRules/power.test.ts`
- Modify: `apps/swdnd/src/lib/shipRules/types.ts`
- Modify: `apps/backend/src/routes/swdnd/starships.ts`

**Interfaces:**
- Consumes: `ShipBuild`, `ShipPlayState`, `ShipReferenceData` (spine); `PowerSystem`, `POWER_SYSTEMS` (Task 1); `emptyShipBuild(name)` (spine).
- Produces:
  - `interface PowerDicePool { central: number; systems: Record<PowerSystem, number> }` (in `shipRules/types.ts`)
  - `ShipPlayState.powerDice?: PowerDicePool`; `ShipBuild.schemaVersion` bumped to 2 by `emptyShipBuild`
  - `type CouplingKind = 'direct' | 'distributed' | 'hub-spoke'`
  - `type ReactorKind = 'fuel-cell' | 'ionization' | 'power-core'`
  - `interface PowerDie { sides: number | null; label: string }`
  - `interface PowerCapacity { central: number; perSystem: number }`
  - `interface ReactorRecovery { kind: ReactorKind | null; formula: string; label: string }`
  - `interface DerivedPower { die: PowerDie; coupling: CouplingKind | null; capacity: PowerCapacity; recovery: ReactorRecovery }`
  - `function powerDieForTier(tier: number): PowerDie`
  - `function couplingKindOf(name: string): CouplingKind | null`
  - `function reactorKindOf(name: string): ReactorKind | null`
  - `function powerCapacity(coupling: CouplingKind | null): PowerCapacity`
  - `function reactorRecovery(kind: ReactorKind | null): ReactorRecovery`
  - `function emptyPowerDice(): PowerDicePool`
  - `function powerDiceOf(play: ShipPlayState): PowerDicePool`
  - `function derivePower(build: ShipBuild, ref: ShipReferenceData): DerivedPower`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/swdnd/src/lib/shipRules/power.test.ts
import { test, expect } from 'bun:test';
import {
  couplingKindOf, derivePower, emptyPowerDice, powerCapacity, powerDiceOf, powerDieForTier,
  reactorKindOf, reactorRecovery,
} from './power';
import type { ShipBuild, ShipPlayState, ShipReferenceData } from './types';
import { emptyShipBuild } from './types';

test('power die size follows ship tier; tier 0 is a flat 1', () => {
  expect(powerDieForTier(0)).toEqual({ sides: null, label: '1' });
  expect(powerDieForTier(1)).toEqual({ sides: 4, label: 'd4' });
  expect(powerDieForTier(2)).toEqual({ sides: 6, label: 'd6' });
  expect(powerDieForTier(3)).toEqual({ sides: 8, label: 'd8' });
  expect(powerDieForTier(4)).toEqual({ sides: 10, label: 'd10' });
  expect(powerDieForTier(5)).toEqual({ sides: 12, label: 'd12' });
  expect(powerDieForTier(11)).toEqual({ sides: 12, label: 'd12' }); // clamped
});

test('coupling and reactor kinds are recognised from the pack row names', () => {
  expect(couplingKindOf('Direct Power Coupling')).toBe('direct');
  expect(couplingKindOf('Distributed Power Coupling')).toBe('distributed');
  expect(couplingKindOf('Hub & Spoke Power Coupling')).toBe('hub-spoke');
  expect(couplingKindOf('Power Core Reactor')).toBeNull();
  expect(reactorKindOf('Fuel Cell Reactor')).toBe('fuel-cell');
  expect(reactorKindOf('Ionization Reactor')).toBe('ionization');
  expect(reactorKindOf('Power Core Reactor')).toBe('power-core');
  expect(reactorKindOf('Hyperdrive, Class 1.0')).toBeNull();
});

test('capacity is set by the coupling topology', () => {
  expect(powerCapacity('direct')).toEqual({ central: 4, perSystem: 0 });
  expect(powerCapacity('distributed')).toEqual({ central: 0, perSystem: 2 });
  expect(powerCapacity('hub-spoke')).toEqual({ central: 2, perSystem: 1 });
  expect(powerCapacity(null)).toEqual({ central: 0, perSystem: 0 });
});

test('reactor recovery rates are displayed, never applied', () => {
  expect(reactorRecovery('fuel-cell')).toEqual({ kind: 'fuel-cell', formula: '1', label: '1 die' });
  expect(reactorRecovery('ionization')).toEqual({ kind: 'ionization', formula: '1d2-1', label: '1d2−1 dice' });
  expect(reactorRecovery('power-core')).toEqual({ kind: 'power-core', formula: '1d2', label: '1d2 dice' });
  expect(reactorRecovery(null)).toEqual({ kind: null, formula: '0', label: 'no reactor' });
});

test('powerDiceOf tolerates pre-v2 ship documents', () => {
  const legacy = { ...emptyShipBuild('Old').play } as ShipPlayState;
  delete (legacy as { powerDice?: unknown }).powerDice;
  expect(powerDiceOf(legacy)).toEqual(emptyPowerDice());
  const filled: ShipPlayState = {
    ...legacy,
    powerDice: { central: 2, systems: { comms: 0, engines: 1, shields: 1, sensors: 0, weapons: 1 } },
  };
  expect(powerDiceOf(filled).central).toBe(2);
  expect(powerDiceOf(filled).systems.engines).toBe(1);
});

test('derivePower reads tier, coupling and reactor off the build', () => {
  // ShipReferenceData.equipment holds reactors, couplings and hyperdrives
  // (ShipReferenceData.armor holds armor AND shields — not read here).
  const ref = {
    equipment: {
      hub: { id: 'hub', name: 'Hub & Spoke Power Coupling', kind: 'coupling' },
      core: { id: 'core', name: 'Power Core Reactor', kind: 'reactor' },
      hyper: { id: 'hyper', name: 'Hyperdrive, Class 2', kind: 'hyperdrive' },
    },
  } as unknown as ShipReferenceData;
  const build = {
    ...emptyShipBuild('Krayt'),
    identity: { ...emptyShipBuild('Krayt').identity, tier: 3 },
    equipment: [
      { id: 'e1', ref: 'hyper', kind: 'hyperdrive' },
      { id: 'e2', ref: 'hub', kind: 'coupling' },
      { id: 'e3', ref: 'core', kind: 'reactor' },
    ],
  } as unknown as ShipBuild;

  const power = derivePower(build, ref);
  expect(power.die).toEqual({ sides: 8, label: 'd8' });
  expect(power.coupling).toBe('hub-spoke');
  expect(power.capacity).toEqual({ central: 2, perSystem: 1 });   // 2 central + 1 per system
  expect(power.recovery.kind).toBe('power-core');

  // Nothing installed: a tier-1 hull with no coupling stores nothing.
  const bare = { ...emptyShipBuild('Bare'), equipment: [] } as unknown as ShipBuild;
  expect(derivePower(bare, ref)).toMatchObject({ coupling: null, capacity: { central: 0, perSystem: 0 } });
});
```

- [ ] **Step 2: Run and watch it FAIL**

Run: `bun test apps/swdnd/src/lib/shipRules/power.test.ts`
Expected: FAIL — `Cannot find module './power'`.

- [ ] **Step 3: Ship play-state type + empty documents**

In `apps/swdnd/src/lib/shipRules/types.ts`:

```ts
/** Power dice held in the central capacitor and per system capacitor. */
export interface PowerDicePool {
  central: number;
  systems: Record<PowerSystem, number>;
}
```

add to `ShipPlayState`:

```ts
  /** Absent on pre-v2 documents — read via powerDiceOf(). Manual counters only. */
  powerDice?: PowerDicePool;
```

and in `emptyShipBuild(name)`: set `schemaVersion: 2` and add to the `play` literal:

```ts
    powerDice: { central: 0, systems: { comms: 0, engines: 0, shields: 0, sensors: 0, weapons: 0 } },
```

Mirror both changes in `emptyShipBuildJson(name)` in `apps/backend/src/routes/swdnd/starships.ts` (the hand-duplicated document with the keep-in-sync comment).

- [ ] **Step 4: Implement `shipRules/power.ts`**

```ts
// apps/swdnd/src/lib/shipRules/power.ts
// SotG power dice: die SIZE from ship tier, CAPACITY from the power coupling's
// topology, RECOVERY rate from the reactor. Everything here is display data —
// dice move only when a player taps a counter.
import { POWER_SYSTEMS } from './constants';
import type { PowerDicePool, PowerSystem, ShipBuild, ShipPlayState, ShipReferenceData } from './types';

export type CouplingKind = 'direct' | 'distributed' | 'hub-spoke';
export type ReactorKind = 'fuel-cell' | 'ionization' | 'power-core';

export interface PowerDie { sides: number | null; label: string }
export interface PowerCapacity { central: number; perSystem: number }
export interface ReactorRecovery { kind: ReactorKind | null; formula: string; label: string }
export interface DerivedPower {
  die: PowerDie;
  coupling: CouplingKind | null;
  capacity: PowerCapacity;
  recovery: ReactorRecovery;
}

// Tier 0 ships have no die: each "power die" is a flat 1.
const DIE_BY_TIER: Array<number | null> = [null, 4, 6, 8, 10, 12];

export function powerDieForTier(tier: number): PowerDie {
  const t = Math.max(0, Math.min(DIE_BY_TIER.length - 1, Math.trunc(tier)));
  const sides = DIE_BY_TIER[t];
  return { sides, label: sides === null ? '1' : `d${sides}` };
}

export function couplingKindOf(name: string): CouplingKind | null {
  const n = name.toLowerCase();
  if (!n.includes('coupling')) return null;
  if (n.includes('direct')) return 'direct';
  if (n.includes('distributed')) return 'distributed';
  if (n.includes('hub')) return 'hub-spoke';
  return null;
}

export function reactorKindOf(name: string): ReactorKind | null {
  const n = name.toLowerCase();
  if (!n.includes('reactor')) return null;
  if (n.includes('fuel cell')) return 'fuel-cell';
  if (n.includes('ionization')) return 'ionization';
  if (n.includes('power core')) return 'power-core';
  return null;
}

const CAPACITY: Record<CouplingKind, PowerCapacity> = {
  direct: { central: 4, perSystem: 0 },        // one big capacitor
  distributed: { central: 0, perSystem: 2 },   // no central store at all
  'hub-spoke': { central: 2, perSystem: 1 },   // a bit of both
};

export function powerCapacity(coupling: CouplingKind | null): PowerCapacity {
  return coupling ? { ...CAPACITY[coupling] } : { central: 0, perSystem: 0 };
}

const RECOVERY: Record<ReactorKind, { formula: string; label: string }> = {
  'fuel-cell': { formula: '1', label: '1 die' },
  ionization: { formula: '1d2-1', label: '1d2−1 dice' },
  'power-core': { formula: '1d2', label: '1d2 dice' },
};

export function reactorRecovery(kind: ReactorKind | null): ReactorRecovery {
  return kind ? { kind, ...RECOVERY[kind] } : { kind: null, formula: '0', label: 'no reactor' };
}

export function emptyPowerDice(): PowerDicePool {
  const systems = {} as Record<PowerSystem, number>;
  for (const s of POWER_SYSTEMS) systems[s] = 0;
  return { central: 0, systems };
}

/** Tolerant read: pre-v2 ship documents have no `powerDice` field. */
export function powerDiceOf(play: ShipPlayState): PowerDicePool {
  const stored = play.powerDice;
  if (!stored) return emptyPowerDice();
  const pool = emptyPowerDice();
  pool.central = stored.central ?? 0;
  for (const s of POWER_SYSTEMS) pool.systems[s] = stored.systems?.[s] ?? 0;
  return pool;
}

/**
 * The only function here that touches reference data: the installed coupling
 * and reactor are identified by their pack row NAMES (three of each, stable).
 * `RefShipEquipment.kind` already separates 'coupling' from 'reactor', but the
 * name is still what distinguishes Direct from Distributed from Hub & Spoke.
 */
export function derivePower(build: ShipBuild, ref: ShipReferenceData): DerivedPower {
  let coupling: CouplingKind | null = null;
  let reactor: ReactorKind | null = null;
  for (const entry of build.equipment) {
    const name = ref.equipment[entry.ref]?.name ?? '';
    coupling ??= couplingKindOf(name);
    reactor ??= reactorKindOf(name);
  }
  return {
    die: powerDieForTier(build.identity.tier),
    coupling,
    capacity: powerCapacity(coupling),
    recovery: reactorRecovery(reactor),
  };
}
```

- [ ] **Step 5: Run and watch it PASS**

Run: `bun test apps/swdnd/src/lib/shipRules/ apps/backend/src/routes/swdnd/starships.test.ts`
Expected: PASS — the new power tests plus every spine ship test. Two spine assertions pin `schemaVersion: 1` on the empty ship document and must move to `2` (the only spine test edits allowed here): the `toEqual` in `apps/swdnd/src/lib/shipRules/types.test.ts` and the creation-bootstrap `toMatchObject` in `apps/backend/src/routes/swdnd/starships.test.ts`. Both of those documents also gain the `powerDice` block added in Step 3.

- [ ] **Step 6: Commit**

```bash
git add apps/swdnd/src/lib/shipRules/power.ts apps/swdnd/src/lib/shipRules/power.test.ts apps/swdnd/src/lib/shipRules/types.ts apps/swdnd/src/lib/shipRules/types.test.ts apps/backend/src/routes/swdnd/starships.ts apps/backend/src/routes/swdnd/starships.test.ts
git commit -m "feat(swdnd): power dice — tier die size, coupling capacity, reactor recovery"
```

---

### Task 7: Crew-aware `computeShip`

**Files:**
- Modify: `apps/swdnd/src/lib/shipRules/index.ts`
- Modify: `apps/swdnd/src/lib/shipRules/weapons.ts`
- Modify: `apps/swdnd/src/lib/shipRules/weapons.test.ts`
- Modify: `apps/swdnd/src/lib/shipRules/index.test.ts`

**Interfaces:**
- Consumes: `computeShip(build, ref)`, `shipWeaponProfiles(build, ref)`, `shipSaveDc(build)`, `DerivedShip`, `ShipWeaponProfile` (spine); `CrewInput` (Task 5); `derivePower`, `DerivedPower` (Task 6).
- Produces:
  - `function computeShip(build: ShipBuild, ref: ShipReferenceData, crew?: CrewInput): DerivedShip`
  - `function shipWeaponProfiles(build: ShipBuild, ref: ShipReferenceData, crew?: CrewInput): ShipWeaponProfile[]`
  - `ShipWeaponProfile` gains `attackBonus: number` (ship part + crew proficiency) and `crewProficiencyApplied: boolean`; the spine's existing `attackShipMod` / `attackText` stay untouched so the breakdown still renders
  - `ShipWeaponProfile.saveDc` keeps its spine type `number | null` — crew proficiency folds in ONLY on the `8 + Wis` spec fallback (rows with no pack `saveDc`); a weapon carrying an explicit pack DC (e.g. the Heavy ion cannon at DC 13) is left exactly as the spine computed it — crew proficiency never modifies a flat pack DC (controller ruling). Attack weapons stay `null`
  - `DerivedShip` gains `power: DerivedPower`

- [ ] **Step 1: Write the failing tests**

Append to `apps/swdnd/src/lib/shipRules/weapons.test.ts`, reusing that file's spine fixtures: the `ship({ wis })` builder and the module-level `ref`, whose `laser` weapon is attack-based (no `saveAbility`), whose `ion` weapon is save-based with its own `attackBonus: 1` and no pack `saveDc` (so it exercises the `8 + Wis` fallback), and whose `heavyIon` weapon is save-based with an explicit pack `saveDc: 13` (so it exercises the controller ruling that crew proficiency never touches a flat pack DC).

```ts
test('a deployed gunner adds their proficiency to attack and save DC', () => {
  // Ship Wis 16 → +3. Gunner proficiency +4.
  const b = ship({ wis: 16 });
  b.equipment = [
    { id: 'w1', ref: 'laser', kind: 'weapon' },     // attack weapon: saveDc stays null
    { id: 'w2', ref: 'ion', kind: 'weapon' },       // save weapon, no pack DC: 8 + Wis (+ crew)
    { id: 'w3', ref: 'heavyIon', kind: 'weapon' },  // save weapon, EXPLICIT pack DC 13
  ];

  const [solo, soloSave, soloPack] = shipWeaponProfiles(b, ref);
  expect(solo.attackBonus).toBe(3);              // ship Wis mod only
  expect(solo.saveDc).toBeNull();                // unchanged: attack weapons have no DC
  expect(soloSave.saveDc).toBe(11);              // 8 + 3, the fallback formula
  expect(soloPack.saveDc).toBe(13);              // flat pack DC, unaffected by Wis
  expect(solo.crewProficiencyApplied).toBe(false);

  const [crewed, crewedSave, crewedPack] = shipWeaponProfiles(b, ref, { proficiencyByRole: { gunner: 4 } });
  expect(crewed.attackBonus).toBe(7);            // 3 + 4
  expect(crewedSave.saveDc).toBe(15);            // 8 + 3 + 4 — fallback composes with crew
  expect(crewedPack.saveDc).toBe(13);            // flat pack DC — crew proficiency NEVER touches it
  expect(crewedPack.attackBonus).toBe(7);        // attack bonus still gets crew, independent of the DC rule
  expect(crewed.saveDc).toBeNull();              // still null — crew never invents a DC
  expect(crewed.crewProficiencyApplied).toBe(true);

  // A crew with no gunner is the same as no crew at all.
  const noGunner = shipWeaponProfiles(b, ref, { proficiencyByRole: { pilot: 6 } })[0];
  expect(noGunner.attackBonus).toBe(3);
  expect(noGunner.crewProficiencyApplied).toBe(false);
});
```

Append to `apps/swdnd/src/lib/shipRules/index.test.ts`, reusing that file's spine fixtures — the `ghost()` build (two `laser` weapons, both attack-based) and the module-level `ref`:

```ts
test('computeShip threads crew input into weapons and exposes the power profile', () => {
  const bare = computeShip(ghost(), ref);
  expect(bare.weapons[0].crewProficiencyApplied).toBe(false);
  expect(bare.power.die.label).toBeString();
  expect(bare.power.capacity).toBeDefined();

  const crewed = computeShip(ghost(), ref, { proficiencyByRole: { gunner: 3 } });
  expect(crewed.weapons[0].attackBonus).toBe(bare.weapons[0].attackBonus + 3);
  expect(crewed.weapons[0].saveDc).toBeNull();   // ghost's lasers are attack weapons
  expect(crewed.weapons[0].crewProficiencyApplied).toBe(true);
  // Crew never touches anything but the crew-dependent numbers.
  expect(crewed.armorClass).toBe(bare.armorClass);
  expect(crewed.maxHull).toBe(bare.maxHull);
  expect(crewed.power).toEqual(bare.power);
});
```

- [ ] **Step 2: Run and watch it FAIL**

Run: `bun test apps/swdnd/src/lib/shipRules/`
Expected: FAIL — `expect(undefined).toBe(3)` on `crewProficiencyApplied` / `bare.power`.

- [ ] **Step 3: Implement**

In `apps/swdnd/src/lib/shipRules/weapons.ts` — take the optional crew argument and fold the gunner's proficiency into the two crew-dependent numbers. DRIFT FIX (Step 1 confirmation): the spine's `saveDc` line already reads `w.saveAbility ? (w.saveDc ?? (8 + wisMod)) : null` — the pack's own DC wins when present. Crew proficiency must compose ONLY into the `8 + wisMod` fallback branch, never onto a flat pack DC (controller ruling):

```ts
export function shipWeaponProfiles(
  build: ShipBuild,
  ref: ShipReferenceData,
  crew?: CrewInput,
): ShipWeaponProfile[] {
  const gunnerProficiency = crew?.proficiencyByRole.gunner;
  const crewProficiencyApplied = typeof gunnerProficiency === 'number';
  const prof = gunnerProficiency ?? 0;
  // …the spine's existing per-weapon loop, unchanged except for these fields:
  //   attackBonus: attackShipMod + prof,
  //   saveDc: w.saveAbility ? (w.saveDc ?? (8 + wisMod + prof)) : null,
  //     — pack DC (w.saveDc) is left exactly as the spine computed it; prof
  //     only ever composes into the 8 + Wis fallback, never a flat pack DC.
  //   crewProficiencyApplied,
  // attackShipMod and attackText keep the spine's values; the sheet renders the
  // "+ your proficiency" suffix only when crewProficiencyApplied is false.
}
```

Add the two new fields (`attackBonus`, `crewProficiencyApplied`) to `ShipWeaponProfile` in `shipRules/types.ts`, leaving the spine's `attackShipMod`, `attackText` and `saveDc: number | null` exactly as they are so the display can still show the breakdown.

In `apps/swdnd/src/lib/shipRules/index.ts`:

```ts
import { derivePower } from './power';
import type { CrewInput } from './types';

export function computeShip(build: ShipBuild, ref: ShipReferenceData, crew?: CrewInput): DerivedShip {
  // …existing body…
  return {
    // …existing fields…
    weapons: shipWeaponProfiles(build, ref, crew),
    power: derivePower(build, ref),
  };
}
```

and add `power: DerivedPower;` to `DerivedShip` (import the type from `./power`).

- [ ] **Step 4: Run and watch it PASS**

Run: `bun test apps/swdnd/src/lib/shipRules/`
Expected: PASS — new crew tests plus every spine engine test (spine tests calling `computeShip(build, ref)` keep working: `crew` is optional).

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/shipRules/index.ts apps/swdnd/src/lib/shipRules/weapons.ts apps/swdnd/src/lib/shipRules/types.ts apps/swdnd/src/lib/shipRules/weapons.test.ts apps/swdnd/src/lib/shipRules/index.test.ts
git commit -m "feat(swdnd): crew-aware ship compute — gunner proficiency in attacks and DCs"
```

---

### Task 8: Reducers — power-dice actions and the tech-die action

**Files:**
- Modify: `apps/swdnd/src/lib/shipPlayState.ts`
- Modify: `apps/swdnd/src/lib/shipPlayState.test.ts`
- Modify: `apps/swdnd/src/lib/playState.ts`
- Modify: `apps/swdnd/src/lib/playState.test.ts`

**Interfaces:**
- Consumes: `applyShipPlayAction(build, derived, action)` (spine); `applyPlayAction(build, derived, action)` (`lib/playState.ts:25`); `powerDiceOf`, `emptyPowerDice` (Task 6); `TECH_DIE_LADDER` (Task 5).
- Produces:
  - `type PowerLocation = 'central' | PowerSystem` (exported from `lib/shipPlayState.ts`)
  - `ShipPlayAction` gains `{ t: 'spendPower'; where: PowerLocation; n?: number }`, `{ t: 'recoverPower'; where: PowerLocation; n?: number }`, `{ t: 'setPower'; where: PowerLocation; n: number }`
  - `PlayAction` gains `{ t: 'setTechDie'; sides: number | null }`

- [ ] **Step 1: Write the failing tests**

Append to `apps/swdnd/src/lib/shipPlayState.test.ts`, reusing that file's spine fixtures — the `ship(over?)` builder and the module-level `derived` object. `derived` is a hand-written `as unknown as DerivedShip` literal, so extend it with a `power` block: `power: { die: { sides: 8, label: 'd8' }, coupling: 'hub-spoke', capacity: { central: 2, perSystem: 1 }, recovery: { kind: 'power-core', formula: '1d2', label: '1d2 dice' } }`.

```ts
test('power dice spend and recover within the coupling capacity', () => {
  const build = ship();                            // derived: hub & spoke — 2 central, 1 per system

  const filled = applyShipPlayAction(build, derived, { t: 'recoverPower', where: 'central', n: 5 });
  expect(filled.powerDice!.central).toBe(2);       // clamped to capacity

  const spent = applyShipPlayAction({ ...build, play: filled }, derived, { t: 'spendPower', where: 'central' });
  expect(spent.powerDice!.central).toBe(1);        // default step is one die

  const floored = applyShipPlayAction({ ...build, play: spent }, derived, { t: 'spendPower', where: 'central', n: 9 });
  expect(floored.powerDice!.central).toBe(0);
});

test('system capacitors clamp per system, independently of central', () => {
  const build = ship();
  const p1 = applyShipPlayAction(build, derived, { t: 'recoverPower', where: 'weapons', n: 3 });
  expect(p1.powerDice!.systems.weapons).toBe(1);   // hub & spoke: 1 per system
  expect(p1.powerDice!.systems.shields).toBe(0);
  expect(p1.powerDice!.central).toBe(0);

  const p2 = applyShipPlayAction({ ...build, play: p1 }, derived, { t: 'setPower', where: 'weapons', n: 0 });
  expect(p2.powerDice!.systems.weapons).toBe(0);
  const p3 = applyShipPlayAction({ ...build, play: p2 }, derived, { t: 'setPower', where: 'shields', n: 7 });
  expect(p3.powerDice!.systems.shields).toBe(1);
});

test('power actions work on a pre-v2 document with no powerDice field', () => {
  const build = ship();
  delete (build.play as { powerDice?: unknown }).powerDice;
  const p = applyShipPlayAction(build, derived, { t: 'recoverPower', where: 'engines', n: 1 });
  expect(p.powerDice).toEqual({ central: 0, systems: { comms: 0, engines: 1, shields: 0, sensors: 0, weapons: 0 } });
});
```

Append to `apps/swdnd/src/lib/playState.test.ts`:

```ts
test('setTechDie stores a ladder size; null clears the manual override', () => {
  expect(applyPlayAction(build(), derived(), { t: 'setTechDie', sides: 6 }).techDie).toBe(6);
  expect(applyPlayAction(build(), derived(), { t: 'setTechDie', sides: 0 }).techDie).toBe(0); // unusable
  expect(applyPlayAction(build({ techDie: 10 }), derived(), { t: 'setTechDie', sides: null }).techDie).toBeUndefined();
  // Off-ladder sizes are rejected rather than stored.
  expect(applyPlayAction(build({ techDie: 8 }), derived(), { t: 'setTechDie', sides: 7 }).techDie).toBe(8);
});
```

- [ ] **Step 2: Run and watch it FAIL**

Run: `bun test apps/swdnd/src/lib/shipPlayState.test.ts apps/swdnd/src/lib/playState.test.ts`
Expected: FAIL — `expect(undefined).toBe(2)` / `expect(undefined).toBe(6)` (the actions fall through the switch).

- [ ] **Step 3: Implement the ship reducer**

In `apps/swdnd/src/lib/shipPlayState.ts`:

```ts
import { powerDiceOf } from './shipRules/power';
import type { PowerSystem } from './shipRules/types';

/** Where a power die sits: the central capacitor or one system capacitor. */
export type PowerLocation = 'central' | PowerSystem;
```

Add to the action union:

```ts
  | { t: 'spendPower'; where: PowerLocation; n?: number }
  | { t: 'recoverPower'; where: PowerLocation; n?: number }
  | { t: 'setPower'; where: PowerLocation; n: number }
```

At the top of the reducer body (beside the existing play clone), materialise the pool so every branch works on a real object even for pre-v2 documents:

```ts
  p.powerDice = powerDiceOf(build.play);
```

and add the cases:

```ts
    case 'spendPower':
    case 'recoverPower':
    case 'setPower': {
      const cap = action.where === 'central'
        ? derived.power.capacity.central
        : derived.power.capacity.perSystem;
      const current = action.where === 'central'
        ? p.powerDice.central
        : p.powerDice.systems[action.where];
      const step = action.t === 'setPower' ? action.n : Math.max(1, Math.trunc(action.n ?? 1));
      const next = action.t === 'setPower'
        ? step
        : action.t === 'spendPower' ? current - step : current + step;
      const clamped = Math.max(0, Math.min(cap, Math.trunc(next)));
      if (action.where === 'central') p.powerDice.central = clamped;
      else p.powerDice.systems = { ...p.powerDice.systems, [action.where]: clamped };
      break;
    }
```

- [ ] **Step 4: Implement the character reducer**

In `apps/swdnd/src/lib/playState.ts`:

```ts
import { TECH_DIE_LADDER } from './crew';
```

Add to `PlayAction`:

```ts
  | { t: 'setTechDie'; sides: number | null }
```

and the case:

```ts
    case 'setTechDie':
      // null clears the manual override → the sheet falls back to the
      // rank-derived base. Off-ladder sizes are ignored.
      if (action.sides === null) p.techDie = undefined;
      else if (TECH_DIE_LADDER.includes(action.sides)) p.techDie = action.sides;
      break;
```

- [ ] **Step 5: Run and watch it PASS**

Run: `bun test apps/swdnd/src/lib/shipPlayState.test.ts apps/swdnd/src/lib/playState.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/swdnd/src/lib/shipPlayState.ts apps/swdnd/src/lib/shipPlayState.test.ts apps/swdnd/src/lib/playState.ts apps/swdnd/src/lib/playState.test.ts
git commit -m "feat(swdnd): manual power-dice and tech-die play actions"
```

---

### Task 9: `useShipSheet` — crew loading and live crew refresh

**Files:**
- Modify: `apps/swdnd/src/hooks/useShipSheet.ts`

**Interfaces:**
- Consumes: `getCharacter`, `CharacterDto` (`lib/characters.ts`); `crewInputFrom`, `CrewMemberInput` (Task 5); `computeShip(build, ref, crew?)` (Task 7); `connectCampaign` (`lib/ws.ts`); ship crew rows from `GET /swdnd/starships/{id}`. **Not** `loadReference` / `computeSheet` — see design decision 7.
- Produces: `useShipSheet(shipId)` return value gains
  - `crewMembers: Array<{ role: ShipRole; dto: CharacterDto }>`
  - `crewInput: CrewInput | undefined`
  - `derived` now computed as `computeShip(build, ref, crewInput)`

- [ ] **Step 1: Load the crewed characters**

After the existing ship + ship-reference load effect, add a second effect keyed on the crew roster (stringify the roster's ids+roles so the effect doesn't re-run on identical rosters):

```ts
  const crewKey = (dto?.crew ?? []).map((c) => `${c.character_id}:${c.role}`).sort().join(',');

  useEffect(() => {
    const rows = dto?.crew ?? [];
    if (rows.length === 0) {
      setCrewMembers([]);
      return;
    }
    let alive = true;
    // One request per crewed character and nothing else: crewInputFrom derives
    // proficiency from the build document itself (crewProficiency), so the ship
    // sheet never pays for the ten-request character reference loader.
    Promise.all(rows.map((row) => getCharacter(row.character_id).catch(() => null)))
      .then((dtos) => {
        if (!alive) return;
        const members = rows.flatMap((row, i) => {
          const cdto = dtos[i];
          return cdto ? [{ role: row.role, dto: cdto }] : [];
        });
        setCrewMembers(members);
      })
      .catch(() => { /* crew stats are additive: a failed load leaves the ship uncrewed */ });
    return () => { alive = false; };
  }, [crewKey]);
```

with the accompanying state and derivation:

```ts
  const [crewMembers, setCrewMembers] = useState<Array<{ role: ShipRole; dto: CharacterDto }>>([]);

  const crewInput = useMemo(() => {
    if (!ref || crewMembers.length === 0) return undefined;
    const members: CrewMemberInput[] = crewMembers.map((m) => ({ role: m.role, build: m.dto.data_json }));
    return crewInputFrom(members, ref.deployments);
  }, [crewMembers, ref]);

  const derived = useMemo(
    () => (build && ref ? computeShip(build, ref, crewInput) : null),
    [build, ref, crewInput],
  );
```

- [ ] **Step 2: Refresh crew on `character:updated`**

DRIFT FIX (Step 1 confirmation): this step originally described the new branch
as sitting "beside" a `ship:updated` branch, as though the WS callback
dispatched on `env.type` with parallel `if` blocks. The shipped callback
instead opens with an early-return guard — `if (env.type !== 'ship:updated')
return;` — so a `character:updated` branch appended AFTER that guard would be
unreachable dead code; it must be inserted BEFORE it. Separately, that
callback is only recreated when `[dto?.campaign_id, shipId, token, reload]`
change, so closing over `crewMembers` directly would read a stale snapshot
from whenever the effect last ran (usually the empty initial array) — mirror
the hook's existing `latestBuildRef` pattern with a `crewMembersRef` instead
of widening the effect's dependency array (which would reconnect the socket
on every crew refresh).

Add a ref that mirrors `crewMembers`, beside the `crewMembers` state from Step 1:

```ts
  const crewMembersRef = useRef<Array<{ role: ShipRole; dto: CharacterDto }>>([]);
  useEffect(() => { crewMembersRef.current = crewMembers; }, [crewMembers]);
```

Then, as the FIRST statement inside the campaign socket callback — before the
shipped `if (env.type !== 'ship:updated') return;` line — add:

```ts
        if (env.type === 'character:updated') {
          // A crewed character's deployments live in their build, which the
          // thin payload doesn't carry — refetch that one character. This is
          // independent of local ship edits, so it needs no save-timer guard.
          const payload = env.payload as { characterId?: string } | undefined;
          const id = payload?.characterId;
          if (id && crewMembersRef.current.some((m) => m.dto.id === id)) {
            void getCharacter(id).then((fresh) => {
              setCrewMembers((prev) => prev.map((m) => (m.dto.id === id ? { ...m, dto: fresh } : m)));
            }).catch(() => { /* transient: the next mount recomputes */ });
          }
          return;
        }
        // …the shipped `if (env.type !== 'ship:updated') return;` guard and the
        // rest of the ship:updated branch follow unchanged…
```

Nothing else needs recomputing by hand: `crewMembers` holds only the DTO, so replacing it re-runs the `crewInput` memo (which reads deployments and proficiency straight off `dto.data_json`) and, through it, `computeShip`.

- [ ] **Step 3: Export the new fields**

Add `crewMembers` and `crewInput` to the hook's return object and to its state interface, so the ship sheet can render per-role ability lists (Task 12) without re-fetching.

- [ ] **Step 4: Verify (UI/hook task — typecheck + suite)**

This task has no unit test of its own: it is React glue. Verification is the typecheck and the full engine suite.

Run: `cd apps/swdnd && bun run build`
Expected: clean (tsc `noUnusedLocals`/`noUnusedParameters` catches stale imports and unused destructuring).

Run: `bun test apps/swdnd/src/lib/`
Expected: PASS — unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/hooks/useShipSheet.ts
git commit -m "feat(swdnd): ship sheet resolves crew proficiency from crewed characters"
```

---

### Task 10: Builder step — Deployments

**Files:**
- Create: `apps/swdnd/src/panels/CharacterSheet/Builder/steps/Deployments.tsx`
- Modify: `apps/swdnd/src/panels/CharacterSheet/Builder/index.tsx`
- Modify: `apps/swdnd/src/panels/CharacterSheet/Builder/StepRail.tsx`

**Interfaces:**
- Consumes: `StepTable` + `Column` (`Builder/StepTable.tsx`); `BuildAction` with `setDeploymentRank` / `setPrestige` (Task 3); `loadDeploymentReference`, `RefDeployment`, `RefDeploymentFeature` (Task 1); `deploymentsOf`, `prestigeOf` (Task 2); `StepKey` (Task 4).
- Produces: `export default function DeploymentsStep({ build, editable, dispatch }: { build: CharacterBuild; editable: boolean; dispatch: (a: BuildAction) => void })`

- [ ] **Step 1: Write the step component**

```tsx
// apps/swdnd/src/panels/CharacterSheet/Builder/steps/Deployments.tsx
import { useEffect, useMemo, useState } from 'react';
import type { BuildAction } from '../../../../lib/buildState';
import { deploymentsOf, prestigeOf } from '../../../../lib/rules/core';
import type { CharacterBuild } from '../../../../lib/rules/types';
import { loadDeploymentReference } from '../../../../lib/starships';
import type { DeploymentReferenceData, RefDeployment } from '../../../../lib/shipRules/types';
import StepTable from '../StepTable';

interface Props {
  build: CharacterBuild;
  editable: boolean;
  dispatch: (a: BuildAction) => void;
}

const RANKS = [1, 2, 3, 4, 5];

export default function DeploymentsStep({ build, editable, dispatch }: Props) {
  // Two requests, on demand: deployments are optional content and must not
  // join the ten-request character reference loader.
  const [ref, setRef] = useState<DeploymentReferenceData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadDeploymentReference()
      .then((r) => alive && setRef(r))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Failed to load deployments'));
    return () => { alive = false; };
  }, []);

  const rankById = useMemo(() => {
    const map: Record<string, number> = {};
    for (const d of deploymentsOf(build)) map[d.deploymentId] = d.rank;
    return map;
  }, [build]);

  const featuresFor = (d: RefDeployment, rank: number) =>
    Object.values(ref?.deploymentFeatures ?? {})
      .filter((f) => f.role === d.role && f.rank > 0 && f.rank <= Math.max(rank, 1))
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));

  if (error) return <div className="ht-panel p-2 font-mono text-[11px] text-red-300">⚠ {error}</div>;
  if (!ref) return <div className="ht-panel p-2 font-mono text-[11px] text-ht-muted">Loading deployments…</div>;

  const items = Object.values(ref.deployments).filter((d) => d.role !== null);
  const prestige = prestigeOf(build);

  return (
    <StepTable
      items={items}
      columns={[
        { key: 'name', label: 'Deployment', flex: 1.2, value: (d) => d.name },
        { key: 'rank', label: 'Rank', flex: 0.6, value: (d) => rankById[d.id] ?? 0 },
      ]}
      idOf={(d) => d.id}
      searchText={(d) => `${d.name} ${d.role ?? ''}`}
      isSelected={(d) => (rankById[d.id] ?? 0) > 0}
      onSelect={(d) => dispatch({
        t: 'setDeploymentRank', deploymentId: d.id, rank: (rankById[d.id] ?? 0) > 0 ? 0 : 1,
      })}
      selectLabel={(d) => ((rankById[d.id] ?? 0) > 0 ? '✕ leave deployment' : '✓ deploy at rank 1')}
      detail={(d) => {
        const rank = rankById[d.id] ?? 0;
        return (
          <div className="flex flex-col gap-2">
            {editable && (
              <div className="flex items-center gap-2 text-[10px]">
                <span className="ht-label">Rank</span>
                {[0, ...RANKS].map((r) => (
                  <button key={r} type="button"
                    className={`ht-step ${r === rank ? 'ht-tile-active' : ''}`}
                    onClick={() => dispatch({ t: 'setDeploymentRank', deploymentId: d.id, rank: r })}>
                    {r === 0 ? 'none' : r}
                  </button>
                ))}
              </div>
            )}
            <div className="whitespace-pre-line">{d.description || 'No description in the source data.'}</div>
            <div>
              <div className="ht-label mb-1">Features {rank > 0 ? `· ranks 1–${rank}` : '· rank 1 preview'}</div>
              {featuresFor(d, rank).map((f) => (
                <div key={f.id} className="flex justify-between gap-2 text-[10px]">
                  <span className="text-ht-text">{f.rank} · {f.name}</span>
                  <span className="text-ht-muted">
                    {f.powerSystem ? `${f.powerSystem} die` : '—'}{f.activation ? ` · ${f.activation}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      }}
      editable={editable}
      header={
        <div className="ht-panel flex flex-wrap items-center gap-2 p-2 text-[10px]">
          <span className="ht-label">Prestige</span>
          {editable ? (
            <>
              <button type="button" className="ht-step" onClick={() => dispatch({ t: 'setPrestige', prestige: prestige - 1 })}>−</button>
              <span className="text-ht-bright">{prestige}</span>
              <button type="button" className="ht-step" onClick={() => dispatch({ t: 'setPrestige', prestige: prestige + 1 })}>+</button>
            </>
          ) : (
            <span className="text-ht-bright">{prestige}</span>
          )}
          <span className="ml-auto text-ht-muted">
            Deployments are optional. Rank sets which features you have; abilities are read at the table.
          </span>
        </div>
      }
    />
  );
}
```

- [ ] **Step 2: Wire the step into the builder**

In `apps/swdnd/src/panels/CharacterSheet/Builder/index.tsx` add the import and the render branch:

```tsx
import DeploymentsStep from './steps/Deployments';
```

```tsx
          {active === 'deployments' && <DeploymentsStep build={b.build} editable={b.canEdit} dispatch={b.dispatch} />}
```

In `apps/swdnd/src/panels/CharacterSheet/Builder/StepRail.tsx` add the label:

```ts
  skills: 'Skills', feats: 'Feats', equipment: 'Equipment', powers: 'Powers', deployments: 'Deployments',
```

- [ ] **Step 3: Verify (UI-only task — typecheck/build + suite green)**

There is no component test runner in this repo, so this task is verified by the typecheck/build and by the pure suite staying green — state this in the commit body.

Run: `cd apps/swdnd && bun run build`
Expected: clean — in particular `LABELS: Record<StepKey, string>` would fail to compile if the `deployments` label were missing.

Run: `bun test apps/swdnd/src/lib/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/swdnd/src/panels/CharacterSheet/Builder/steps/Deployments.tsx apps/swdnd/src/panels/CharacterSheet/Builder/index.tsx apps/swdnd/src/panels/CharacterSheet/Builder/StepRail.tsx
git commit -m "feat(swdnd): Deployments builder step

UI-only: verified by tsc build + the pure test suite."
```

---

### Task 11: Character sheet — Deployments section

**Files:**
- Create: `apps/swdnd/src/panels/CharacterSheet/Sheet/Deployments.tsx`
- Modify: `apps/swdnd/src/panels/CharacterSheet/Sheet/index.tsx`

**Interfaces:**
- Consumes: `loadDeploymentReference` (Task 1); `deploymentsOf`, `prestigeOf` (Task 2); `currentTechDie`, `TECH_DIE_LADDER` (Task 5); `PlayAction` with `setTechDie` (Task 8); `PlayState`, `CharacterBuild`.
- Produces: `export default function Deployments({ build, play, editable, dispatch }: { build: CharacterBuild; play: PlayState; editable: boolean; dispatch: (a: PlayAction) => void })`

- [ ] **Step 1: Write the section**

```tsx
// apps/swdnd/src/panels/CharacterSheet/Sheet/Deployments.tsx
import { useEffect, useState } from 'react';
import { currentTechDie, TECH_DIE_LADDER } from '../../../lib/crew';
import type { PlayAction } from '../../../lib/playState';
import { deploymentsOf, prestigeOf } from '../../../lib/rules/core';
import type { CharacterBuild, PlayState } from '../../../lib/rules/types';
import { loadDeploymentReference } from '../../../lib/starships';
import type { DeploymentReferenceData } from '../../../lib/shipRules/types';

interface Props {
  build: CharacterBuild;
  play: PlayState;
  editable: boolean;
  dispatch: (a: PlayAction) => void;
}

export default function Deployments({ build, play, editable, dispatch }: Props) {
  const [ref, setRef] = useState<DeploymentReferenceData | null>(null);
  const entries = deploymentsOf(build);

  useEffect(() => {
    if (entries.length === 0) return;      // nothing to name: skip the two requests entirely
    let alive = true;
    loadDeploymentReference().then((r) => alive && setRef(r)).catch(() => { /* section stays quiet */ });
    return () => { alive = false; };
  }, [entries.length]);

  if (entries.length === 0) return null;

  const tech = ref ? currentTechDie(build, play, ref.deployments) : null;
  const stepTech = (delta: 1 | -1) => {
    if (!tech) return;
    const i = TECH_DIE_LADDER.indexOf(tech.current);
    const next = TECH_DIE_LADDER[Math.max(0, Math.min(TECH_DIE_LADDER.length - 1, (i < 0 ? 0 : i) + delta))];
    dispatch({ t: 'setTechDie', sides: next });
  };

  return (
    <div className="ht-panel p-2 font-mono text-[11px]">
      <div className="ht-label mb-1 flex justify-between">
        <span>Deployments</span>
        <span className="text-ht-muted">{prestigeOf(build)} prestige</span>
      </div>

      {entries.map((e) => {
        const d = ref?.deployments[e.deploymentId];
        const features = Object.values(ref?.deploymentFeatures ?? {})
          .filter((f) => f.role === d?.role && f.rank > 0 && f.rank <= e.rank)
          .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
        return (
          <div key={e.deploymentId} className="mt-1 border-t border-ht-line pt-1">
            <div className="flex justify-between text-ht-text">
              <span>{d?.name ?? e.deploymentId}</span>
              <span className="text-ht-muted">rank {e.rank}</span>
            </div>
            {features.map((f) => (
              <div key={f.id} className="flex justify-between gap-2 text-[10px] text-ht-muted">
                <span>{f.rank} · {f.name}</span>
                <span>{f.powerSystem ? `${f.powerSystem} die` : ''}{f.activation ? ` · ${f.activation}` : ''}</span>
              </div>
            ))}
          </div>
        );
      })}

      {tech && tech.base > 0 && (
        <div className="mt-2 border-t border-ht-line pt-1">
          <div className="flex items-center justify-between text-ht-text">
            <span>Tech die</span>
            <span className="inline-flex items-center gap-1.5">
              {editable && <button type="button" className="ht-step" onClick={() => stepTech(-1)} aria-label="smaller die">−</button>}
              <span className="text-ht-bright">{tech.current === 0 ? 'unusable' : `d${tech.current}`}</span>
              {editable && <button type="button" className="ht-step" onClick={() => stepTech(1)} aria-label="larger die">+</button>}
            </span>
          </div>
          <div className="flex justify-between text-[9px] text-ht-muted">
            <span>base d{tech.base} · rolling a 1 shrinks it, rolling max grows it (until end of your next turn)</span>
            {editable && tech.overridden && (
              <button type="button" className="ht-step" onClick={() => dispatch({ t: 'setTechDie', sides: null })}>↺ base</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the sheet**

In `apps/swdnd/src/panels/CharacterSheet/Sheet/index.tsx`:

```tsx
import Deployments from './Deployments';
```

and add it to the combat column, after `<Features … />`:

```tsx
      <Deployments build={s.build} play={s.play} editable={s.canEdit} dispatch={s.dispatch} />
```

- [ ] **Step 3: Verify (UI-only task — typecheck/build + suite green)**

Run: `cd apps/swdnd && bun run build`
Expected: clean.

Run: `bun test apps/swdnd/src/lib/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/swdnd/src/panels/CharacterSheet/Sheet/Deployments.tsx apps/swdnd/src/panels/CharacterSheet/Sheet/index.tsx
git commit -m "feat(swdnd): character sheet deployments section with tech-die stepper

UI-only: verified by tsc build + the pure test suite."
```

---

### Task 12: Ship sheet — power dice and crew ability reference

**Files:**
- Create: `apps/swdnd/src/panels/ShipSheet/Sheet/PowerDice.tsx`
- Create: `apps/swdnd/src/panels/ShipSheet/Sheet/CrewAbilities.tsx`
- Modify: `apps/swdnd/src/panels/ShipSheet/Sheet/index.tsx`

**Interfaces:**
- Consumes: `DerivedShip.power` (Task 7); `powerDiceOf` (Task 6); `POWER_SYSTEMS` (Task 1); `PowerLocation` + power actions (Task 8); `crewMembers`, `ref` from `useShipSheet` (Task 9); `deploymentRankForRole` (Task 5); `Stepper` (`CharacterSheet/Sheet/Stepper.tsx`); `parseFormula`, `rollFormula` (`lib/dice.ts`).
- Produces:
  - `export default function PowerDice({ derived, play, editable, dispatch, onRoll }: { derived: DerivedShip; play: ShipPlayState; editable: boolean; dispatch: (a: ShipPlayAction) => void; onRoll?: (label: string, formula: string, total: number) => void })`
  - `export default function CrewAbilities({ crewMembers, ref }: { crewMembers: Array<{ role: ShipRole; dto: CharacterDto }>; ref: ShipReferenceData })`

- [ ] **Step 1: PowerDice section**

```tsx
// apps/swdnd/src/panels/ShipSheet/Sheet/PowerDice.tsx
import Stepper from '../../CharacterSheet/Sheet/Stepper';
import { parseFormula, rollFormula } from '../../../lib/dice';
import type { ShipPlayAction, PowerLocation } from '../../../lib/shipPlayState';
import { powerDiceOf } from '../../../lib/shipRules/power';
import { POWER_SYSTEMS } from '../../../lib/shipRules/constants';
import type { DerivedShip, ShipPlayState } from '../../../lib/shipRules/types';

interface Props {
  derived: DerivedShip;
  play: ShipPlayState;
  editable: boolean;
  dispatch: (a: ShipPlayAction) => void;
  onRoll?: (label: string, formula: string, total: number) => void;
}

export default function PowerDice({ derived, play, editable, dispatch, onRoll }: Props) {
  const pool = powerDiceOf(play);
  const { die, coupling, capacity, recovery } = derived.power;

  const rollRecovery = () => {
    const terms = parseFormula(recovery.formula);
    const total = terms ? rollFormula(terms).total : Number(recovery.formula) || 0;
    // Reporting only: the player decides where the recovered dice go.
    onRoll?.('Reactor recovery', recovery.formula, total);
  };

  const row = (label: string, where: PowerLocation, value: number, max: number) => (
    <div key={where} className="flex items-center justify-between text-ht-text">
      <span>{label}</span>
      <Stepper
        value={value}
        max={max}
        editable={editable && max > 0}
        onDelta={(d) => dispatch(d > 0 ? { t: 'recoverPower', where, n: d } : { t: 'spendPower', where, n: -d })}
        onSet={(n) => dispatch({ t: 'setPower', where, n })}
      />
    </div>
  );

  return (
    <div className="ht-panel p-2 font-mono text-[11px]">
      <div className="ht-label mb-1 flex justify-between">
        <span>Power dice</span>
        <span className="text-ht-muted">
          {die.label}{coupling ? ` · ${coupling.replace('-', ' & ')}` : ' · no coupling'}
        </span>
      </div>

      {capacity.central > 0 && row('Central', 'central', pool.central, capacity.central)}
      {capacity.perSystem > 0 &&
        POWER_SYSTEMS.map((s) => row(s[0].toUpperCase() + s.slice(1), s, pool.systems[s], capacity.perSystem))}
      {capacity.central === 0 && capacity.perSystem === 0 && (
        <div className="text-ht-muted">Install a power coupling to store power dice.</div>
      )}

      <div className="mt-2 flex items-center justify-between border-t border-ht-line pt-1 text-[10px] text-ht-muted">
        <span>Reactor recovery · {recovery.label} at the start of your turn</span>
        {editable && recovery.kind && (
          <button type="button" className="ht-step" onClick={rollRecovery}>⟳ roll {recovery.formula}</button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: CrewAbilities section**

```tsx
// apps/swdnd/src/panels/ShipSheet/Sheet/CrewAbilities.tsx
import type { CharacterDto } from '../../../lib/characters';
import { deploymentRankForRole } from '../../../lib/crew';
import type { ShipReferenceData, ShipRole } from '../../../lib/shipRules/types';

interface Props {
  crewMembers: Array<{ role: ShipRole; dto: CharacterDto }>;
  ref: ShipReferenceData;
}

/** Rank-gated deployment abilities as reference text — no buttons, nothing automated. */
export default function CrewAbilities({ crewMembers, ref }: Props) {
  if (crewMembers.length === 0) return null;
  const features = Object.values(ref.deploymentFeatures);

  return (
    <div className="ht-panel p-2 font-mono text-[11px]">
      <div className="ht-label mb-1">Crew abilities</div>
      {crewMembers.map((m) => {
        const rank = deploymentRankForRole(m.dto.data_json, m.role, ref.deployments);
        const list = features
          .filter((f) => f.role === m.role && f.rank > 0 && f.rank <= rank)
          .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
        return (
          <div key={`${m.dto.id}:${m.role}`} className="mt-1 border-t border-ht-line pt-1">
            <div className="flex justify-between text-ht-text">
              <span>{m.dto.name} · {m.role}</span>
              <span className="text-ht-muted">{rank > 0 ? `rank ${rank}` : 'not deployed'}</span>
            </div>
            {rank === 0 && (
              <div className="text-[10px] text-ht-muted">
                No rank in this deployment — contributes no proficiency to the ship.
              </div>
            )}
            {list.map((f) => (
              <div key={f.id} className="flex justify-between gap-2 text-[10px] text-ht-muted">
                <span>{f.rank} · {f.name}</span>
                <span>{f.powerSystem ? `${f.powerSystem} die` : ''}{f.activation ? ` · ${f.activation}` : ''}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Wire both into the ship sheet**

In `apps/swdnd/src/panels/ShipSheet/Sheet/index.tsx`, import both and render them in the same column as the crew roster strip, passing the spine's existing roll helper to `PowerDice` (`onRoll`) — the counters sit directly beside the ability lists:

```tsx
      <PowerDice derived={s.derived} play={s.play} editable={s.canEdit} dispatch={s.dispatch} onRoll={roll} />
      <CrewAbilities crewMembers={s.crewMembers} ref={s.ref} />
```

If the spine's roll helper has a different signature than `(label, formula, total)`, adapt the `onRoll` prop type in `PowerDice.tsx` to match it rather than changing the spine.

Also update the weapon rows to drop the `+ your proficiency` suffix when the crew supplies it:

```tsx
              {w.crewProficiencyApplied ? `+${w.attackBonus}` : `+${w.attackBonus} + your proficiency`}
```

- [ ] **Step 4: Verify (UI-only task — typecheck/build + suite green)**

Run: `cd apps/swdnd && bun run build`
Expected: clean.

Run: `bun test apps/swdnd/src/lib/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/panels/ShipSheet/Sheet/PowerDice.tsx apps/swdnd/src/panels/ShipSheet/Sheet/CrewAbilities.tsx apps/swdnd/src/panels/ShipSheet/Sheet/index.tsx
git commit -m "feat(swdnd): ship sheet power-dice counters and crew ability reference

UI-only: verified by tsc build + the pure test suite."
```

---

### Task 13: Full verification

**Files:**
- Modify (only if a gap is found): any file above
- Modify: vault docs in `/Users/asherc/Documents/Mount Tantiss/ashercarlow.com/swdnd/`

- [ ] **Step 1: Whole suite + typecheck**

Run: `bun test`
Expected: PASS — 0 fail. Count = the spine-branch baseline plus the tests added here (Task 1: 4 · Task 2: 2 · Task 3: 3 · Task 4: 1 · Task 5: 6 · Task 6: 6 · Task 7: 2 · Task 8: 4 = **28 new tests**).

Run: `cd apps/swdnd && bun run build`
Expected: clean.

- [ ] **Step 2: Tolerant-default audit**

Confirm by grep that no read site assumes the v2 fields exist:

```bash
grep -rn "\.deployments" apps/swdnd/src --include=*.ts --include=*.tsx | grep -v "ref\.\|Ref\.\|deploymentFeatures"
grep -rn "\.prestige\|\.techDie\|\.powerDice" apps/swdnd/src --include=*.ts --include=*.tsx
```

Expected: every hit is inside `deploymentsOf` / `prestigeOf` / `currentTechDie` / `powerDiceOf`, a reducer write, or a test. Any bare `build.deployments.map(...)` is a bug — route it through the accessor.

- [ ] **Step 3: Live walkthrough**

Start the dev backend and swdnd frontend (`.claude/launch.json` entries; revert any temporary edits afterwards). With one campaign, one player token, one character and one ship:

- Builder → **Deployments** step: rail shows `○ Deployments —`; take Gunner at rank 3 → rail shows `✓ Deployments 1 deployment · 0 prestige`; features 1–3 listed; prestige +/− persists across reload.
- Character sheet: Deployments section lists Gunner rank 3 with its features; take Mechanic rank 2 → tech die appears as `d6` with `base d6`; − → `d4` and a `↺ base` control; reload keeps `d4`; `↺ base` clears it back to `d6`.
- Ship sheet with that character crewed as gunner: weapon rows show a concrete `+N` (no "+ your proficiency"); drop the character's Gunner rank to 0 in another tab → the ship sheet's `character:updated` refresh restores the "+ your proficiency" suffix without a reload.
- Ship with a Hub & Spoke coupling at tier 3: Power dice shows `d8 · hub & spoke`, a Central row capped at 2 and five system rows capped at 1; +/− clamps at both ends; reload keeps the counts. Swap to Direct → central cap 4, system rows gone; to Distributed → central row gone, system caps 2.
- Reactor line shows the installed reactor's rate; `⟳ roll 1d2` reports a number and changes no counter.
- An old character created before this branch (or a document with the fields deleted via a PATCH) opens without error and reads as no deployments, 0 prestige, no tech die.

- [ ] **Step 4: Docs**

Update the vault: `Architecture.md` / `Roadmap.md` — crew layer landed (deployments/prestige on characters, crew-aware ship compute, power dice); `Features/Character Sheet.md` — the Deployments step and section; add or extend `Features/Starships.md` — power dice model (die by tier, capacity by coupling, reactor recovery), crew proficiency rule, and the explicit "abilities are reference text, no automation" stance.

- [ ] **Step 5: Finish the branch**

Use superpowers:finishing-a-development-branch → the 4-option menu.
