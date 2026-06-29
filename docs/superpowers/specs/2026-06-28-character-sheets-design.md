# swdnd Character Sheets — Design

> **Status:** Approved. Date: 2026-06-28.
> **Builds on:** the swdnd foundation (`docs/superpowers/specs/2026-06-28-swdnd-foundation-design.md`). Second feature in the roadmap.
> **Scope:** A guided builder + responsive play sheet for sw5e characters. Starships, the DM screen, and the map are out of scope.

## 1. Overview

The Character Sheets feature lets players build and play **sw5e** characters from the rules data ingested in the foundation. It has two surfaces — a **guided builder** and a **play sheet** — and is the first real consumer of the foundation's WebSocket backbone (live HP / conditions).

## 2. Confirmed decisions

| Decision | Choice |
|---|---|
| Primary shape | **Guided builder → play sheet** |
| Rules automation | **Assisted**: compute derived stats + surface requirements, allow overrides (home-game friendly) |
| Progression scope | **Full progression + multiclass** (level-up over time, multiclass caster math) |
| Builder navigation | **Step rail** (sidebar of steps with ✓/incomplete status, jump to any) |
| Sheet layout | **Responsive**: 3-column when wide → compact tabbed when narrow |
| Responsiveness mechanism | **CSS container queries** (Tailwind v4 `@container` + `@md:`/`@lg:`), keyed on the **panel's own width**, not the viewport |
| Rules/compute location | **Frontend**, pure TypeScript (instant recompute; backend stays storage) |
| Player access | **DM admin + per-player link** (foundation auth model, implemented here) |
| Starships | **Deferred** (separate sheet domain, later) |

## 3. Two surfaces, one panel

The existing `CharacterSheet` panel becomes a thin router between two modes; it stays container-agnostic so it renders standalone or in the split `/play` view.

- **Play sheet** — default at `/sheet/:characterId`. The responsive read/play view (§5).
- **Builder** — an "Edit / Level up" affordance from the sheet, e.g. `/sheet/:characterId/build`. The **step rail**: a sidebar listing build steps, each with a completeness indicator; the user jumps to any step. Steps:
  1. Species
  2. Background
  3. Class & Level (add/level a class; the multiclass + progression surface)
  4. Abilities (base scores + ASIs)
  5. Skills & Proficiencies
  6. Feats / ASI choices
  7. Equipment
  8. Powers & Maneuvers (for casters / superiority users)

  Leveling up or adding a class = adding/editing entries in step 3; the rail re-flags any now-incomplete dependent steps (e.g. new ASI to allocate).

New character creation lands in the builder with an empty build.

## 4. Responsive layout — container queries

The play sheet is **3-column when wide, compact-tabbed when narrow**, driven by **CSS container queries** on the sheet panel's own width (Tailwind v4: mark the panel root as a `@container`, use `@md:`/`@lg:` variants on the grid/sections). This means in the split `/play` view on an ultrawide, each panel independently gets the full multi-column layout — responsiveness is **not** tied to viewport width. The compact mode collapses sections into tabs (Combat / Powers / Gear / Features) with an always-visible core bar (name, HP, AC, points).

## 5. Data model — `character.data_json`

The `character` row (foundation schema: `id, campaign_id, player_id, name, data_json, created_at, updated_at`) stores a **build definition** + **play state** as JSON. Derived stats are **computed, never stored**.

```jsonc
{
  "schemaVersion": 1,
  "identity": { "name": "", "speciesId": "", "backgroundId": "", "alignment": "light|dark|universal|none" },
  "abilities": {
    "base": { "str": 10, "dex": 10, "con": 10, "int": 10, "wis": 10, "cha": 10 },
    "increases": [ { "source": "species|asi|feat", "ref": "<id>", "ability": "wis", "amount": 1 } ]
  },
  "levels": [
    { "n": 1, "classId": "guardian", "archetypeId": null, "hp": "avg|<rolled>", "choices": { /* feature picks */ } }
    /* ordered → drives progression + multiclass */
  ],
  "proficiencies": { "skills": [], "tools": [], "languages": [], "savingThrows": [] },
  "equipment": [ { "ref": "<id>", "qty": 1, "equipped": true, "mods": [] } ],
  "credits": 0,
  "knownPowers": [ "<id>" ],
  "knownManeuvers": [ "<id>" ],
  "play": {
    "hp": 0, "tempHp": 0, "hitDiceSpent": 0,
    "forcePointsSpent": 0, "techPointsSpent": 0,
    "conditions": [], "exhaustion": 0, "inspiration": false, "notes": ""
  },
  "overrides": { /* assisted-mode manual overrides, keyed by computed field */ }
}
```

The ordered `levels[]` log is what makes full progression + multiclass recomputable from scratch.

## 6. Compute engine (the heart of "assisted")

A **pure, unit-tested TypeScript module** in `apps/swdnd/src/lib/rules/`. Signature conceptually: `computeSheet(build, referenceData) -> DerivedSheet`. It computes:

- Ability modifiers; proficiency bonus (from total level).
- Saving throws & skill bonuses (Lore/Piloting/Technology included), with proficiency/expertise.
- AC, initiative, speed, hit dice, max HP (from `levels[]` hp choices + CON).
- **Multiclass caster level**: sum `caster_ratio` across all classes **and** archetypes (both carry `caster_type`/`caster_ratio` from the reference data), → Force/Tech point pools and **max power level**.
- Force vs Tech casting ability (Wis/Cha/either by alignment for Force; Int for Tech) → save DCs / attack bonuses.
- Superiority dice (count/size) for maneuver users.
- Derived equipment effects (armor → AC, weapon attack/damage).

**Override-friendly**: any computed field can be overridden via `build.overrides`; the engine reports both the computed value and whether an override is active. Lives frontend-side because the builder needs instant recompute and the DM screen will recompute too; the backend stays dumb storage. If server-side validation is ever needed, this module extracts to a shared package (not now — YAGNI).

## 7. sw5e data loading

The builder and sheet fetch reference categories (species, classes, archetypes, backgrounds, feats, powers, weapons, armor, gear, …) from the **existing** `GET /swdnd/content/:category` (foundation). Results are cached client-side. No backend changes are needed for reads; the `raw_json` column carries any fields the compute engine needs that weren't promoted to columns.

## 8. Backend: character routes (new)

Implements the character routes the foundation deferred, registered under `/swdnd` following the existing route pattern (`createRoute` + `app.openapi`, `HTTPException`, zod schemas):

- `GET /swdnd/campaigns/{id}/characters` — list characters in a campaign.
- `POST /swdnd/campaigns/{id}/characters` — create (name + empty build), returns the character.
- `GET /swdnd/characters/{id}` — fetch one (with `data_json`).
- `PATCH /swdnd/characters/{id}` — save build and/or play state into `data_json`; bumps `updated_at`; broadcasts (§10).
- `DELETE /swdnd/characters/{id}`.

## 9. Player access model

Implements the foundation's "DM admin + per-player link" (`player` table already exists with `access_token`):

- The **DM** (admin cookie) creates a campaign and **player slots**; each player slot has an unguessable `access_token` → a shareable link.
- A **player** opens their link; the token identifies them and authorizes writes to **their own** character(s).
- The **DM** can read/write any character in their campaigns.
- New routes: `POST /swdnd/campaigns/{id}/players` (DM creates a slot), `GET /swdnd/players/me?token=…` (resolve a player from a token).
- **Access gate (writes vs reads):**
  - **Mutations** (`POST`/`PATCH`/`DELETE` on characters) require the admin cookie **or** a player token matching the character's `player_id`. Because the foundation's blanket `/swdnd/*` gate only allows mutations for the admin, character-scoped mutation routes get their own check that *also* accepts a valid owning-player token.
  - **Reads** (`GET`) follow the foundation's existing pattern: open, relying on unguessable UUIDs/tokens for obscurity (same posture as the WS layer). Tighter read-scoping is deferred to real per-player accounts.

## 10. Real-time

On play-state changes (HP, temp HP, conditions, points spent, exhaustion), the sheet `PATCH`es to persist, then the backend broadcasts a `character:updated` envelope (`{ type, room: campaign room, payload: { characterId, play } }`) to the campaign room via the foundation's `publishToRoom`. Other clients in the room (future DM screen, map) update live. The sheet also subscribes to its campaign room to reflect external changes (e.g. the DM adjusting HP).

## 11. File structure (focused units)

Frontend (`apps/swdnd/src/`):
- `panels/CharacterSheet/index.tsx` — mode router (play vs build).
- `panels/CharacterSheet/Sheet/` — responsive play view; one component per section (Abilities, Combat, Powers, Gear, Features) + the compact-tab shell.
- `panels/CharacterSheet/Builder/` — step rail + one component per build step.
- `lib/rules/` — the pure compute engine + types (no React, no IO).
- `lib/characters.ts` — character/player API client.

Backend (`apps/backend/src/`):
- `routes/swdnd/characters.ts` — character routes.
- `routes/swdnd/players.ts` — player-slot + token resolution routes.
- Extend `routes/swdnd/index.ts` to register them and apply the character-scoped token gate.

## 12. Testing

- **Compute engine** (the risk): thorough unit tests — ability mods, proficiency, save DCs, AC/HP, **multiclass caster level + point pools**, alignment-driven casting ability, superiority dice, overrides, edge cases. `bun test` for the pure module.
- **Backend routes**: create/get/patch/delete + access-gate tests (admin vs correct player token vs wrong token).
- **End-to-end**: build a small character and assert the computed sheet matches expected values.

## 13. Implementation phasing (one spec, sequenced plan)

To de-risk the large scope, the plan builds in this order (each phase independently verifiable):

1. **Data model + compute engine + character/player routes + access model** — the spine.
2. **Play sheet** — responsive display + live play state + WS wiring; *this is where the visual polish pass happens* (frontend-design + live preview).
3. **Step-rail builder** — level-1, single class (species → … → powers).
4. **Progression + multiclass** — level-up entries, multiclass caster math, re-flagging dependent steps.

## 14. Out of scope

- Starships (separate sheet domain, later).
- The DM screen and the tabletop/map (their own features).
- Server-side rules validation (compute is frontend-only for now).
- Real per-player accounts/passwords (link-based access only).
