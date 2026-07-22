# swdnd Character Progression & Multiclass (Phase 4) — Design

> **Status:** Approved (design). Date: 2026-07-22.
> **Builds on:** the Character Sheets feature design (`2026-06-28-character-sheets-design.md`) and its merged Phase 1 spine (PR #2), Phase 2 play sheet (PR #3), and Phase 3 builder + landing (PR #4). This is the **final Character Sheets phase**.
> **Scope:** Level-up over time, multiclassing, archetypes, ASI/feat elections, and play-HP tracking of level changes. Starships, the map, and the DM screen remain their own features.

## 1. Overview

Phase 4 turns the level-1 builder into a **career**: the Class step becomes an ordered **level log** (the UI face of the build's `levels[]` array), "+ Add level" grows it — same class to level up, a different one to multiclass — and each level row carries its own decisions (HP, ASI-or-feat, archetype at class level 3). The Phase 1 engine already computes everything downstream (multiclass caster level, point pools, known-power caps, superiority); the UI and validation just follow `derived`.

## 2. Confirmed decisions

| Decision | Choice |
|---|---|
| Level-up UX | **The Class step becomes the level log** (no separate wizard). Rows L1…LN grouped by class; "+ Add level" opens the existing class table; per-row inline decisions; "remove last level" undoes the top entry and everything it granted. |
| Play HP | **Current HP tracks level changes**: on level add/remove, `play.hp` moves by the same delta as `derived.maxHp` (clamped 0…new max). A first class pick fills HP to max (fixes the 0-HP fresh build); ability-driven max changes (CON ASI) move max only. |
| Multiclass gate | sw5e rule: **13+ in the primary ability of BOTH the current class and the new one**. Enforced in the class picker; **house-rule unlock** (existing `houseRuled` mechanism, step key `class`) overrides. |
| ASI vs feat | Each ASI-eligible level row elects **ASI or feat**. ASI = an inline 2-point allocator on the row (`increases` with `source:'asi'`, `ref:'l{n}'`; +2 same or +1/+1; caps at 20 total per sw5e). Feat = a **slot** on the Feats step. |
| Enforcement & aesthetics | Everything inherits Phase 3's decisions: constrained-with-unlock, Holoterminal, container queries, auto-save. |

## 3. Data pins (verified this session)

- **ASI levels are per-class data**: Foundry class `advancement` entries of type `AbilityScoreImprovement` carry `level` — Fighter `[4,6,8,12,14,16,19]`, Consular `[4,8,12,16,19]`. Mapper exposes `RefClass.asiLevels: number[]`.
- **Archetype→class linkage**: archetype docs carry `system.classIdentifier` (e.g. `'consular'`) matching the class doc's `system.identifier` — NOT our Foundry-`_id` row ids. Mapper exposes `RefClass.identifier` and `RefArchetype.classIdentifier`.
- **Primary abilities** (multiclass prereqs), pinned from the sw5e API (`sw5eapi.azurewebsites.net/api/class` → `primaryAbility`; sw5e.com's PHB pages were down at design time):
  `berserker: str · consular: wis · engineer: int · fighter: str · guardian: str · monk: dex · operative: dex · scholar: int · scout: dex · sentinel: dex`
  ⚠ **Caveat:** the PHB prose may allow either-of-two abilities for some classes (5e's Fighter is "STR or DEX"; Consular plausibly "WIS or CHA" given alignment-driven casting). Encode as a `MULTICLASS_PRIMARY` constant keyed by **class identifier slug** with a source comment; re-verify against the PHB when sw5e.com recovers. The house-rule unlock makes any discrepancy non-blocking at the table.

## 4. The level log (Class step redesign)

- **Grouped display**: one group per class in first-taken order — header `Consular · 4 levels` (+ archetype line once chosen) — with level rows beneath (`L1 · d6 · hp avg`, `L4 · ASI +1 WIS +1 CHA`, …). The global character level is the row count (`n` stays the 1-based overall index).
- **"+ Add level"** opens the class StepTable. Rows for classes failing the multiclass prereq (either side) render dimmed with the reason (`needs WIS 13 — you have 11`) and refuse selection while `class` is locked; the existing `⌂ house rule` toggle (now surfaced on this step) opens them.
- **Per-row decisions**:
  - **HP**: `avg` (default) or tap to type the roll (1…die size). Level 1 stays max-die (engine rule).
  - **ASI levels** (from `asiLevels` of that class, evaluated against that class's level count): elect **ASI** (inline 2-point ± allocator, identical pattern to the species allocator) or **feat** (creates a Feats-step slot). Election is stored in `levels[n].choices.asiOrFeat`; switching elections clears the other's grants.
  - **Archetype**: when a class reaches 3 levels, its group header gains `choose archetype ▸` — a filtered StepTable (by `classIdentifier`) with the standard expandable detail. Stored on that class's first level-3+ entry's `archetypeId` (the engine's `classesTaken` already takes the first non-null per class).
- **Remove last level**: two-tap confirm; pops `levels[N]`, deletes its `l{N}` increases and feat slot, clears an archetype stored on it, and applies the negative HP delta.
- Step status: `✓` when every row's obligations are met; `!` with a summary like `L4 ASI · 1 pt left` or `L3 archetype pending` (archetype pending = attention, not blocking-done? — **decision: attention**, an sw5e character at L3 without a form/archetype is incomplete).

## 5. Feats step: slots

A slot strip above the existing feats table: `L1 (optional)` plus one slot per feat-electing ASI level (`Fighter L6`, …). Tap a slot to arm it; picking in the table fills the armed slot (`levels[n].choices.featId`). Empty non-optional slots flag the step `!`. The L1 slot stays optional-✓ as today.

## 6. Play-state HP rule (pure)

In `buildState`, every action that changes `levels[]` (`setClass` on an empty build — unchanged behavior for the L1 builder — plus new `addLevel`/`removeLastLevel`) computes `derived.maxHp` before and after (via `computeSheet` inputs it already receives) and shifts `play.hp` by the delta, clamped to `0…newMax`. No other action touches play state.

## 7. Plumbing

- **`buildState` actions (new)**: `addLevel(classId)` (prereq-gated unless `houseRuled('class')`), `removeLastLevel`, `setLevelHp(n, 'avg' | roll)`, `setAsiChoice(n, 'asi' | 'feat' | null)`, `allocateAsiPoint(n, ability, delta)` (budget 2 per level; total score cap 20 incl. all increases), `setFeatForLevel(n, featId | null)` (replaces the Phase 3 `setFeat`, which becomes `setFeatForLevel(1, …)` semantics), `setArchetype(classId, archetypeId | null)`.
- **Mappers/types**: `RefClass.identifier`, `RefClass.asiLevels`, `RefArchetype.classIdentifier`; `MULTICLASS_PRIMARY` constant in `lib/rules/constants.ts`.
- **`validation`**: class-step per-row obligations (HP always satisfiable, ASI allocation, archetype-at-3 attention); feats slots; everything else (powers counts, skills) already keys off `derived` and re-flags automatically as levels change — the Phase 1 engine recomputes caster level/known caps per multiclass rules.
- **Builder shell**: top strip reads `building level N`; the Class step surfaces the house-rule toggle.
- **Sheet**: Features panel shows the archetype line; no other changes — CoreBar/classSummary already handle `Consular 4 / Fighter 1`.

## 8. Testing

- **Units**: every new action — HP delta on add/remove (incl. first-pick fill and clamping), prereq gating both-sides + unlock bypass, ASI budget/cap-20, election switching clears grants, archetype set/clear, feat slots.
- **Integration**: (a) Consular 1→5 with archetype at 3 and ASI at 4 → exact engine numbers (points, known, DC, HP with deltas applied); (b) Consular 4 / Fighter 1 multiclass — prereq path plus derived matching the Phase 1 casting tests; (c) remove-last-level round-trip restores prior state.
- **Live walkthrough** at the end (level Brakk up, multiclass him, archetype a consular) + visual pass, per the established pattern.

## 9. Out of scope

- Feats' mechanical effects beyond the election (still descriptive; a feat granting +1 to a score is read by the player, not auto-applied).
- Class/archetype **feature text** on the sheet (the "feature detail" panel note stands — a future enhancement alongside the DM screen).
- Retraining/respec beyond remove-last-level; epic levels (>20 — `addLevel` caps at 20).
- Starships, the map, the DM screen; WS auth (tracked).
