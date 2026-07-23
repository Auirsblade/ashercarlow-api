# swdnd DM Screen — Design

> **Status:** Approved (design). Date: 2026-07-23.
> **Builds on:** the swdnd foundation, Character Sheets (PRs #2–#5), and Tabletop & Map (PRs #6–#8). Third and final swdnd feature — the app ships when this lands.
> **Scope:** DM-only campaign control surface at `/dm/:campaignId` plus a `/dm` landing page. Two implementation phases, one PR each.

## 1. Confirmed decisions

| Decision | Choice |
|---|---|
| Lore | **Mechanics-only.** The screen never reads the Obsidian vault; Obsidian stays open alongside for lore. No notes feature. |
| Party dashboard | **Read-only.** Live glance at each character (HP/temp, conditions, exhaustion, inspiration, AC, key passives). No DM-side edits from the dashboard — HP/condition changes happen on the sheet or the map token editor as today. |
| Monster statblocks | **Essentials parsed, prose tolerated.** Structural parse of what browsing/sorting/spawning need (name, CR, type, size, HP, AC, speed, six abilities); traits/actions/attacks render as cleaned rich text from the Foundry JSON's own descriptions. The parser never throws — malformed records display rough, not broken. |
| Spawn to map | One click creates **hostile tokens on the active scene** (hp/max prefilled from the statblock) via the existing token routes — zero new backend surface. Placement = compact cluster near the map center (pure `spawnPositions` helper); the DM drags from there. Appears live on every viewer via existing broadcasts. |
| Encounters | **Named groups only** — `[{monsterId, count}]` per campaign with spawn-all. **No difficulty math.** |
| Quick reference | **Conditions + powers + weapon properties** — three searchable categories via one reusable lookup component. All served by the existing `/swdnd/content/{category}` route. |
| Initiative mirror | **Out.** The DM keeps the map open in another tab/split view; initiative stays on the Tabletop panel. |
| Campaign admin | In a **drawer**, not always-on: players with copy-able invite links, create/rename/delete player slots, character roster with sheet links, jump-to-map. |
| DM landing | **`/dm`** (admin-only): list campaigns, create/rename, click through to `/dm/:campaignId`. Closes the "campaign ids only exist via curl" gap. |
| Layout | **Persistent party rail + tabbed workspace** (Monsters · Encounters · Reference); toolbar hosts the admin-drawer toggle. Narrow containers collapse the rail into a horizontal top strip (`@container`). Holoterminal aesthetic. |
| Auth | UI gates on the admin cookie (`useAuth().authed`); new backend mutations ride the blanket admin gate (no selfGated exemptions added). Reference/content GETs stay open as today. |

## 2. Data model (migration `004_swdnd_encounters`)

- **`encounter`** — `id, campaign_id (FK cascade), name, monsters_json, sort, created_at, updated_at`.
  - `monsters_json`: `[{ monsterId: string, count: number }]` (monster ids reference the `monsters` reference table; counts ≥ 1).
- Nothing else. Party data is computed; monsters/conditions/powers/weapon properties are existing reference tables; campaigns/players/characters/scenes/tokens are existing.

## 3. Backend routes

All new mutations are DM-only via the blanket gate (paths match no `selfGated` clause — verified: no `/encounters` suffix/prefix exemption exists or is added).

- **Encounters:** `GET/POST /swdnd/campaigns/:id/encounters`, `PATCH/DELETE /swdnd/encounters/:id` (name/monsters_json/sort).
- **Campaigns:** existing `GET /swdnd/campaigns` + `POST /swdnd/campaigns`; add `PATCH /swdnd/campaigns/:id` (rename) if missing — the plan verifies the current surface.
- **Players:** existing create (admin-only in-handler, on a `/players`-suffixed path that is selfGated-exempt); add `PATCH /swdnd/players/:id` (rename) and `DELETE /swdnd/players/:id` if missing. ⚠️ Gating check: `/swdnd/players/:id` matches no selfGated clause (it neither starts with an exempted prefix nor ends with `/characters`, `/players`, or `/templates`), so both new routes ride the blanket admin gate; the plan re-verifies this matrix for every path it adds.
- **No spawn route** — spawning composes existing `POST /swdnd/scenes/:id/tokens` calls client-side.
- **No new WS events** — the party rail consumes existing `character:updated`; spawns ride existing `token:created`.

## 4. Pure modules (unit-tested, no React/IO)

- `lib/monsters.ts` — `parseMonster(raw)` → `MonsterView { id, name, crLabel, cr: number|null, type, size, hp, ac, speed, abilities {str..cha}, traits: [{name, text}], actions: [{name, text}] }`; Foundry `@`-references and markup stripped to clean text/simple HTML; every field individually tolerant (missing → null/empty). `filterMonsters(list, {q, type?, crMin?, crMax?})`, `monsterTypes(list)`. Tested against real `raw_json` fixtures (a handful of representative monsters checked into the test file).
- `lib/spawn.ts` — `spawnPositions(center: Hex, count: number): Hex[]` (center-out compact cluster via existing `hexBlast` ordering) and `spawnBodies(view: MonsterView, count, positions)` → token-create payloads (`faction: 'hostile'`, hp/max from the statblock, name suffixed `#2, #3…` for multiples).
- `lib/partyCards.ts` — `cardFromCharacter(dto, ref)` → `{ id, name, classLine, hp, maxHp, tempHp, ac, conditions, exhaustion, inspiration, … }` via `computeSheet` + `classSummary`; `mergeCardPlay(card, play)` for live `character:updated` merges (same semantics as the map's vitals: play live, derived cached until reload).
- `lib/refSearch.ts` — case-insensitive name/text filtering used by the Reference tab (conditions, powers with type/level filters, weapon properties).
- `lib/encounters.ts` — DTOs + REST wrappers.

## 5. The DMScreen panel & landing

- `panels/DMScreen/index.tsx` — layout shell + `useDmScreen(campaignId)` hook (load characters + reference + monsters + content categories; WS connect for `character:updated`; encounter CRUD actions; spawn action = sequential token POSTs against the active scene, surfacing "no active scene" as an inline error).
- `PartyRail.tsx` — read-only cards, color-banded HP, condition chips.
- `MonsterBrowser.tsx` + `Statblock.tsx` — search/filter list, statblock pane, Spawn N + add-to-encounter controls.
- `EncounterList.tsx` — groups with spawn-all / edit / delete.
- `Reference.tsx` + `RefLookup.tsx` — the three-category searchable lookup.
- `AdminDrawer.tsx` — players (invite links via clipboard, create/rename/delete), characters (sheet links), map link.
- `panels/DmHome/index.tsx` at `/dm` — campaign list/create/rename, links to each screen. Route added in `App.tsx`.
- Not-authed state: both pages render a "DM login required" notice (no login UI in scope — the cookie comes from the existing central auth flow).

## 6. Implementation phases (one PR + plan each)

1. **DM core** — `/dm` landing (campaign list/create/rename), screen shell + layout, party rail (live), admin drawer (player CRUD + invite links + roster), any missing campaign/player routes. Makes the app fully self-serve.
2. **Bestiary & reference** — monster parser + browser + statblock, spawn-to-map, encounter table/routes/UI, quick-reference tab.

## 7. Testing

Per phase: `bun test` pure modules (monster parser fixtures incl. a deliberately-degenerate record; spawn positions/bodies; card derivation + play merge; filters), backend route tests (encounter CRUD + DM-only gate matrix; new campaign/player mutations), and a live walkthrough (landing → create player → invite link opens PlayerHome; party rail updating live while a sheet edits HP; spawn appearing on a player's map tab in real time).

## 8. Out of scope (tracked)

- Obsidian/lore integration; in-app notes.
- DM-side HP/condition edits from the dashboard (map token editor already covers NPCs; sheet covers PCs).
- Difficulty/XP budget math.
- Initiative mirror on the DM screen.
- Structured attack/damage parsing (roll automation), monster art, homebrew monsters.
- Real accounts / multi-DM.
