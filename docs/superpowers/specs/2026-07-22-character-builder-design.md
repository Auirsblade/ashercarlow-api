# swdnd Character Builder (Phase 3) — Design

> **Status:** Approved (design). Date: 2026-07-22.
> **Builds on:** the Character Sheets feature design (`2026-06-28-character-sheets-design.md`, §3 fixed the step-rail shape) and its merged Phase 1 spine + Phase 2 play sheet.
> **Scope:** The guided **builder** for **level-1, single-class** characters, plus the **player landing** page. Progression, multiclass, and archetypes (which arrive at class level 3 in sw5e) are Phase 4. Starships, map, DM screen out of scope.

## 1. Overview

Phase 3 makes characters *creatable and buildable* in the app. A player opens their DM-shared link, sees **their characters** (multiple drafts encouraged), creates new ones, and walks a **step rail** — Species → Background → Class → Abilities → Skills → Feats → Equipment → Powers & Maneuvers — picking from the real sw5e reference data in searchable, sortable tables. The compute engine (Phase 1) recomputes the derived sheet live as choices land; the play sheet (Phase 2) renders the result.

## 2. Confirmed decisions

| Decision | Choice |
|---|---|
| New-character entry | **Player landing** at `/player?token=…` — lists the player's characters w/ build status, "+ new character", draft delete. Backed entirely by existing routes (`GET /swdnd/players/me`, `POST /campaigns/{id}/characters`, `DELETE /characters/{id}`). **Zero new backend routes.** |
| Ability scores | **All three sw5e methods**: manual entry (covers 4d6-drop-lowest rolling), standard array **[15, 14, 13, 12, 10, 8]** quick-assign, and point buy — **27 points, scores 8–15**, costs `8:0, 9:1, 10:2, 11:3, 12:4, 13:5, 14:7, 15:9` (pinned from sw5e.com PHB ch. 1, "Variant: Customizing Ability Scores"). All modes write the same `abilities.base`. |
| Rules enforcement | **Constrained by default + per-step house-rule unlock**: steps present legal options and counts; an explicit "⌂ house rule" toggle opens the full list and flags the step as house-ruled instead of blocking. |
| Step content UX | **Searchable, sortable table with expandable rows** — a few stat columns per row; a row expands inline to the full entry (description + stats) with the select action. Same pattern for every pick-step. |
| Save cadence | **Auto-save** — optimistic local build edits, debounced `patchCharacter` (same as the play sheet), "auto-saved ✓" indicator in the top strip. |
| Aesthetic / layout | Holoterminal carries over; responsiveness by **container query** (rail collapses to a horizontal step strip when narrow). |

## 3. Surfaces

- **`/player?token=…`** — the landing. Character rows (name, class summary via `classSummary`, completeness "5/8 steps"), each opening `/sheet/:id?token=…`; a "build" affordance opening `/sheet/:id/build?token=…`; "+ new character" (name prompt → `POST` → straight into the builder); delete with typed-name confirm for drafts. Admin (cookie) sees the same page per campaign later via the DM screen — out of scope here.
- **`/sheet/:characterId/build?token=…`** — the builder, replacing the Phase-2 placeholder in `panels/CharacterSheet/index.tsx`. Editable under the same rule as the sheet (`resolveCanEdit`); read-only visitors get a redirect to the sheet.

## 4. Builder layout

- **Top strip**: character name (editable inline — PATCHes `name` + `identity.name`), "building level 1", auto-save state, "◂ back to sheet".
- **Step rail** (left, ~24%): the 8 steps with derived status glyphs — `✓` complete · `!` needs attention · `○` untouched — plus a per-step summary chip (chosen species name, "known 5/9", …). Jump to any step. Narrow container: the rail becomes a horizontal scrollable strip above the content.
- **Content area**: the active step. Pick-steps use the shared **StepTable**; the Abilities step is custom (mode tabs).

## 5. The steps (what each edits, its data, its completeness)

Statuses are **derived from build data by a pure `validation` module — never stored**. (The Abilities "! 2 pts left" style feedback is session-local UI inside the step, not persisted.)

| Step | Edits | Reference / constraint | ✓ when |
|---|---|---|---|
| 1 Species | `identity.speciesId`; replaces prior species' `abilities.increases` (`source:'species'`) | `species` table. Structured ability increases read from the doc's `advancement` (`AbilityScoreImprovement`: fixed map → auto-applied; free `points` → an in-step allocator) | species chosen (+ its free points, if any, fully allocated) |
| 2 Background | `identity.backgroundId` | `backgrounds` table. Skill/tool grants are **prose** in the data → shown as guidance; the player applies them via the Skills step (assisted, not parsed) | background chosen |
| 3 Class | `levels = [{ n:1, classId, archetypeId:null, hp:'avg' }]`; sets `proficiencies.savingThrows` from the class | `classes` table. Columns: name, hit die, casting, superiority. Changing class re-flags dependent steps (skills/powers) via validation. No archetype at L1 (sw5e archetypes are L3+ → Phase 4) | class chosen |
| 4 Abilities | `abilities.base` | Mode tabs: Manual / Standard array / **Point buy (27 pts, 8–15)**. Species increases display alongside but live in `increases` | any **base** score ≠ 10 (else `○`; never blocks — manual mode is its own escape hatch) |
| 5 Skills | `proficiencies.skills` (+ free-text `tools`/`languages`) | All 18 skills listed; the class's `skillChoices` highlighted with "pick `skillNumber`" guidance. Free pick beyond that — backgrounds grant skills in prose (often off the class list), so a hard which-skill constraint is impossible | picked count ≥ class `skillNumber`; `!` when 0 < count < `skillNumber` |
| 6 Feats | `abilities.increases` (`source:'feat'`) + a feat pick recorded in `levels[0].choices.featId` | `feats` table, browsable; backgrounds suggest feat options (prose). Optional at L1 | always ✓ (labeled "optional") |
| 7 Equipment | `equipment[]`, `credits` | `weapons` + `armor` + `gear` tables (tabbed source filter); class/background starting-gear prose shown as guidance; credits quick-set | any equipment or credits > 0 (else `○`; never blocks) |
| 8 Powers & Maneuvers | `knownPowers`, `knownManeuvers` | `powers` filtered to the class's track(s) & ≤ max power level; counter targets `derived.casting.*.knownMax`; `maneuvers` table + counter for superiority users (a Fighter at L1 already knows 1 maneuver / 2 dice). Hidden when the class grants neither at L1 | known == knownMax per applicable track; `!` under/over |

**House-rule unlock** — appears on any step with an *active hard constraint*, which at level 1 is **Powers & Maneuvers** (track/level filters + known-count caps); Phase 4's progression steps (ASI budgets, prerequisite gates) reuse it. Species/Background/Class browse complete catalogs and Skills/Equipment are guidance-only, so they need no lock. Unlocking adds the step's key to a new **additive build field `houseRuled: string[]`** (schemaVersion stays 1; absent = empty), opens the unfiltered list, and downgrades that step's constraint checks to presence-only; the rail shows `⌂` on house-ruled steps.

## 6. Reference detail rendering

Foundry `raw_json` descriptions are **HTML with `@Compendium[...]{label}` link codes**. A pure `richText` module converts them for the expanded row: strip tags to safe text (allowlist: paragraphs/bold/italics/lists), replace `@Compendium[...]{label}` → `label`. Never `dangerouslySetInnerHTML` raw source. The row's stat columns come from mapped fields; the expanded pane adds the cleaned description.

## 7. Architecture & files (`apps/swdnd/src/`)

Pure logic (unit-tested, no React/IO):
- `lib/buildState.ts` — `applyBuildAction(build, ref, action): CharacterBuild` — `setSpecies` (incl. increase replacement), `setBackground`, `setClass`, `setBaseAbilities`, `allocateSpeciesPoint`, `toggleSkill`, `setFeat`, `addEquipment/removeEquipment/setCredits`, `togglePower`, `toggleManeuver`, `toggleHouseRule`, `setName`. Constraint-aware (respects `houseRuled`), always returns a new build.
- `lib/validation.ts` — `stepStatus(build, ref, derived): Record<StepKey, { state: 'done'|'attention'|'untouched'; summary?: string }>` per §5.
- `lib/pointBuy.ts` — cost table, `pointsSpent(scores)`, `budgetRemaining`, legality.
- `lib/richText.ts` — Foundry HTML → safe display text.
- `lib/sheetView.ts` — small additions as needed (e.g. table-row projections per category).

React:
- `hooks/useBuilder.ts` — mirrors `useCharacterSheet`: load character + reference, hold `build`, dispatch build actions (optimistic + debounced `patchCharacter`), expose `derived` + `stepStatus`, `canEdit`.
- `panels/CharacterSheet/Builder/` — `index.tsx` (shell: top strip + rail + active step, `@container`), `StepRail.tsx`, `StepTable.tsx` (the generic searchable/sortable/expandable table + multi-pick counter), `steps/{Species,Background,Class,Abilities,Skills,Feats,Equipment,Powers}.tsx`.
- `panels/PlayerHome/index.tsx` — the landing; route `/player` added in `App.tsx`.
- `panels/CharacterSheet/index.tsx` — `mode === 'build'` renders the Builder (keyed by characterId, like the sheet).

## 8. Data flow & known limits

Builder edits → `applyBuildAction` → optimistic `build` → debounced PATCH of `data_json` → backend broadcasts `character:updated`. The Phase-2 sheet only live-merges `play`, so an **open sheet in another tab shows build changes on next load** — acceptable for now (building and playing simultaneously is rare); noted for the DM screen phase. `computeSheet` recomputes locally on every build edit, so the builder can show live derived effects (HP, AC, known-power caps) instantly.

## 9. Testing

- **Pure modules** (the risk): `buildState` (species increase replacement, constrained vs house-ruled toggles, class-change re-flagging inputs), `validation` (every §5 rule, both `!` paths), `pointBuy` (exact sw5e table, budget edges), `richText` (tag stripping, `@Compendium` replacement) — `bun test`.
- **Integration**: from `emptyBuild` drive `applyBuildAction` through a full Consular build and assert `stepStatus` all-✓ and `computeSheet` matches the known Lyra values; a Fighter build asserts the maneuvers path.
- **Components**: `tsc`/`vite build` + live preview against the seeded dev data (established pattern), with the visual pass at the end.

## 10. Implementation phasing

1. **Pure modules** — `pointBuy`, `richText`, `buildState`, `validation` (+ tests).
2. **Player landing** — `/player` route + panel over existing routes.
3. **Builder shell** — top strip, rail (derived statuses), `StepTable`, read-only steps browsing real data.
4. **Selections wired** — pick/multi-pick actions + house-rule unlock + auto-save.
5. **Abilities step** — three modes.
6. **Polish + live preview** — full build walkthrough (Consular and Fighter), visual pass.

## 11. Out of scope

- Level-up, multiclass, archetypes, ASI-at-level-4+ (Phase 4 — the rail re-flagging machinery in `validation` is built ready for it).
- Parsing background/starting-equipment prose into structured grants.
- Starships; the map; the DM screen (incl. DM-side character management UI).
- Live build-merge into open sheets (play state already merges live).
