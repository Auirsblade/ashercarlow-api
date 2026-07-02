# swdnd Character Sheet — Play View (Phase 2) Design

> **Status:** Approved (design). Date: 2026-07-02.
> **Builds on:** the Character Sheets design (`docs/superpowers/specs/2026-06-28-character-sheets-design.md`) and its **Phase 1 spine** (`docs/superpowers/plans/2026-06-28-character-sheets-phase-1-spine.md`, merged). This is **Phase 2** of that feature.
> **Scope:** The responsive, live **play sheet** — the read/play surface that renders a computed sheet and lets the owner adjust play state in real time. The **builder** (Phase 3) and **progression/multiclass UX** (Phase 4) are out of scope, as are the map and DM screen.

## 1. Overview

Phase 1 delivered the pure compute engine (`computeSheet(build, ref)`), the character/player REST routes, the access model, and the frontend client + reference loader — all tested, no UI. Phase 2 builds the **play sheet**: it loads a character, computes the derived sheet, renders it in the **Holoterminal** aesthetic, and lets whoever can write (the DM or the owning player) adjust **play state** (HP, points, conditions, …) with changes persisted and broadcast live to the campaign room. Everything that defines the character (abilities, class/level, proficiencies, known powers, gear) is edited in the **builder** (Phase 3); the play sheet only mutates `build.play`.

## 2. Confirmed decisions

| Decision | Choice |
|---|---|
| Aesthetic | **Holoterminal** — near-black bg, cyan HUD glow, monospace, thin hairlines; faction color-shift (Light → blue/cyan, Dark → red, Universal/none → neutral cyan) |
| Numeric editing | **Inline steppers** (−/+ directly on HP, temp HP, Force/Tech points, hit dice, exhaustion; tap the number to type an exact value) |
| Conditions | **On-demand "+ Condition" dropdown**; active conditions render as removable chips — nothing occupies space when clean |
| Powers | **Cast-to-spend**: tapping a power's "cast" deducts its `(level + 1)` point cost from the pool |
| Layout | **Responsive**: wide → 3 columns; narrow/split → core bar + tabs (Combat / Powers / Gear / Features) |
| Responsiveness mechanism | **CSS container queries** (Tailwind v4 `@container` + `@md/@lg` variants) keyed on the **panel's own width** |
| Rolling | **Lightweight local dice roller** (tap a save/skill/attack → ephemeral d20/damage result); no shared roll log (later) |
| Editing rights | **Admin cookie OR owning-player token** (from the URL); otherwise read-only |

## 3. Play-state model

Derived stats come from `computeSheet` and are **never stored**. The sheet edits only `build.play` (Phase 1 `PlayState`): `hp, tempHp, hitDiceSpent, forcePointsSpent, techPointsSpent, superiorityDiceSpent, conditions[], exhaustion, inspiration, notes`.

The sheet presents *remaining* values by combining stored *spent/current* with derived maxima:
- **HP** — `play.hp` is current HP (0…`derived.maxHp`); `tempHp` is separate. Damage reduces temp first then hp (min 0); heal caps at `maxHp`.
- **Force / Tech points** — remaining = `derived.casting.{force,tech}.pointsMax − play.{force,tech}PointsSpent`. Steppers and cast-to-spend adjust the `*Spent` field (0…max).
- **Hit dice** — remaining = `derived.totalLevel − play.hitDiceSpent`.
- **Superiority dice** — remaining = `derived.superiority.diceMax − play.superiorityDiceSpent` (only when `derived.superiority` is non-null).
- **Exhaustion** 0–6; **inspiration** boolean; **conditions** a deduped list of standard sw5e condition names.

All mutations live in a **pure module** `lib/playState.ts` — `applyPlayAction(build, derived, action): PlayState` — so clamping and math are unit-tested without React (this is the Phase 2 risk surface, mirroring Phase 1's approach). Actions: `damage(n) / heal(n) / setTemp(n) / spendForce(n) / spendTech(n) / castPower(power) / restForce() / spendHitDie() / addCondition(c) / removeCondition(c) / setExhaustion(n) / toggleInspiration()`.

## 4. Data flow

```
getCharacter(id) ─┐                         loadReference() (cached) ─┐
                  ├─► build = dto.data_json                          ├─► ref
                  │                                                   │
     campaignId = dto.campaign_id                                    ▼
                  │                              derived = computeSheet(build, ref)
                  ▼                                                   │
     connectCampaign(campaignId, …)  ◄──── live ────►   render CoreBar + sections
                  │                                                   │
   incoming character:updated (other client) ─► merge payload.play    │ local edit (canEdit)
                  │                                                   ▼
                  └───────────── set play state ◄──── optimistic apply + debounced PATCH
                                                        patchCharacter(id,{data_json},token?)
```

- **Load:** `getCharacter(id)` → `build` + `campaign_id` + `player_id`; `loadReference()` once, cached in a module-level promise. `computeSheet(build, ref)` yields `derived`; recomputed whenever `build` changes (play edits don't change derived except HP max via CON — they don't, so derived is stable during play; recompute only on build changes).
- **Edit (optimistic + debounced):** an action updates local `play` immediately; a **debounced** (~400 ms) `patchCharacter(id, { data_json: {…build, play} }, token)` persists it. The backend broadcasts `character:updated` (Phase 1).
- **Real-time merge:** the sheet subscribes to its campaign room. On `character:updated` where `payload.characterId === id`, it sets `play = payload.play` (last-write-wins) and briefly **flashes** changed numbers. Our own echoed update is idempotent.

## 5. Editing rights

- `canEdit` = admin session (`getAuthMe()` true) **OR** a `token` query param is present in the URL (the owning player's shareable link `…/sheet/:id?token=…`).
- Writes send the token as `X-Player-Token` (via the Phase 1 `patchCharacter(id, patch, token)`); the backend enforces real ownership. When `!canEdit`, the sheet renders read-only (no steppers, no cast, no conditions menu).

## 6. Aesthetic / design system (Holoterminal)

A small token set, defined CSS-first for Tailwind v4 in `apps/swdnd/src/index.css` via `@theme`, plus a per-sheet **faction** CSS variable:
- **Palette:** `--ht-bg` `#05080d`, panel hairline `rgba(77,208,225,.28)`, accent `--ht-accent` `#4dd0e1`, text `#8fe6f5` / bright `#d6fbff`, muted `#5f8f99`.
- **Faction accent** (`--faction`, set on the sheet root from `build.identity.alignment`): Light → `#7aa2ff`, Dark → `#ff5470`, Universal/none → `#4dd0e1`. Force/Tech panels, the active casting ability, and key highlights use `--faction`; glow via `box-shadow`/`text-shadow` in that hue.
- **Type:** `ui-monospace` stack; uppercase micro-labels with letter-spacing.
- Utilities: a couple of small component classes (`.ht-panel`, `.ht-glow`, `.ht-step`) to avoid repeating the glow/hairline recipe. The **visual polish pass** (frontend-design + live preview) refines spacing/scale against real components in sub-phase 3.

## 7. Layout & responsiveness

The `Sheet` root is a `@container`. Breakpoints key on the panel's own width:
- **Wide** (container `@lg`, ≥ ~64rem): full-width **CoreBar** + a 3-column grid — (1) Abilities + Saves + Skills, (2) Attacks + Gear + Features, (3) Powers + Maneuvers.
- **Medium** (`@md`): CoreBar + 2 columns (sections reflow).
- **Narrow** (default, e.g. split view / phone): CoreBar stays pinned; the sections collapse into a **tabbed shell** — Combat / Powers / Gear / Features — one at a time.

Because it's container-based, each panel in the split `/play` view independently gets the layout its own width allows (the ultrawide requirement).

## 8. Components & files (`apps/swdnd/src/`)

- `panels/CharacterSheet/index.tsx` — mode router: **play** (this phase) vs **build** (Phase 3 placeholder linking out).
- `panels/CharacterSheet/Sheet/index.tsx` — the `@container` responsive shell (wide grid vs `TabbedShell`).
- `panels/CharacterSheet/Sheet/CoreBar.tsx` — name/class/level/alignment, HP+temp steppers, AC/Init/Speed/Prof, Force/Tech point steppers (DC/atk/max-level), `ConditionsMenu`, inspiration/exhaustion, "Edit / Level up" link.
- `panels/CharacterSheet/Sheet/{Abilities,Skills,Combat,Powers,Gear,Features}.tsx` — one section each (`Skills` covers saves + the 18 skills; `Powers` groups Force/Tech by level with cast-to-spend and shows the Maneuvers/superiority panel only when `derived.superiority`).
- `panels/CharacterSheet/Sheet/{ConditionsMenu,Stepper,TabbedShell,RollToast}.tsx` — the reusable interaction pieces.
- `hooks/useCharacterSheet.ts` — loads character + reference, computes `derived`, holds `play`, exposes `actions` (wrapping `applyPlayAction` + debounced persist), `canEdit`, `connected`, and merges realtime updates.
- `lib/playState.ts` — pure play-state actions (+ tests).
- `lib/dice.ts` — pure dice roller with injectable RNG (+ tests).
- `lib/faction.ts` — `alignment → faction accent` mapping (+ small test).
- `index.css` — Holoterminal `@theme` tokens.
- `App.tsx` — fix `PlayPage` to resolve the real `campaign_id` from the character (currently passes `characterId` as a placeholder room) so the split view's map joins the correct room.

## 9. Real-time

Reuses the Phase 1 backbone: `connectCampaign(campaignId, onMessage, onStatus)` (auto-reconnect). Local edits persist via `patchCharacter`, which broadcasts `character:updated` `{ characterId, name, play }` to the campaign room; the sheet reflects external changes (e.g., the DM adjusting HP) by merging `payload.play` and flashing the delta. **Security note:** the WS upgrade is intentionally unauthenticated in the foundation (documented deferral); Phase 2's broadcast of play state to the campaign room is the intended use, and does not widen exposure beyond the already-open, unguessable-id read posture. Tightening WS auth remains a tracked follow-up.

## 10. Testing

Concentrate tests on the pure logic (the risk); rely on the live-preview visual pass + `tsc`/`vite build` for the presentational layer (no heavy React test harness added this phase).
- `lib/playState.ts` — thorough: damage through temp HP, heal cap at max, spend/cast clamped to pool, cast deducts `level+1`, hit-dice/superiority spend, condition add/dedupe/remove, exhaustion 0–6 clamp, inspiration toggle, rest restores points.
- `lib/dice.ts` — deterministic via injected RNG: `d20+mod`, advantage/disadvantage if included, damage formula parsing, bounds.
- `lib/faction.ts` — alignment → accent mapping.
- `canEdit` resolution — admin vs token vs neither.
- Whole-suite gate: `bun test` and `bun --cwd apps/swdnd run build` stay green.

## 11. Implementation phasing (one spec, sequenced plan)

1. **Data layer + static render** — `useCharacterSheet` (load + `computeSheet`), Holoterminal `@theme` tokens + `faction`, CoreBar and all sections rendering derived values read-only, wide layout.
2. **Play-state editing** — `lib/playState.ts` + `Stepper` + `ConditionsMenu` + cast-to-spend + `lib/dice.ts`/`RollToast`; optimistic local apply + debounced `patchCharacter`; `canEdit` gating.
3. **Responsive + polish** — `@container` breakpoints, `TabbedShell` narrow mode, and the **visual polish pass** (frontend-design + live preview against the real components).
4. **Real-time** — subscribe to the campaign room, merge external `character:updated`, flash deltas; fix `PlayPage` to use the real `campaign_id`.

## 12. Out of scope

- The **builder** (Phase 3) and **progression/multiclass** (Phase 4).
- A shared/persisted **roll log** (rolls are local/ephemeral here) — a later map/DM feature.
- **Starships**, the **map**, and the **DM screen**.
- Tightening **WebSocket authentication** (tracked foundation follow-up).
