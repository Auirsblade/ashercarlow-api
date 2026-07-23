# swdnd Tabletop & Map — Design

> **Status:** Approved (design). Date: 2026-07-23.
> **Builds on:** the swdnd foundation (WS backbone, host dispatch, `swdnd.sqlite`) and the completed Character Sheets feature (PRs #2–#5). Second of the three swdnd features; the app ships when Map and DM Screen exist.
> **Scope:** Real-time shared hex-grid battle map at `/map/:campaignId` (and beside the sheet at `/play/:characterId`). Three implementation phases, one PR each.

## 1. Confirmed decisions

| Decision | Choice |
|---|---|
| Table mode | **Fully remote** — every player on their own device; live drags/pings are core to the feel. |
| Map content | **DM-supplied images** uploaded as scene backgrounds; the app overlays and calibrates the grid. |
| Grid | **Hex** (not square). Axial coordinates; per-scene orientation (`flat` \| `pointy`) since images come drawn either way; per-scene units-per-hex + unit label (default `5 ft`). |
| Fog of war | **DM-painted reveal** (paint/erase brush over hexes). No line-of-sight math — the DM is the LoS engine. Players see revealed hexes only; the DM sees everything with hidden areas dimmed. |
| Tokens | **Generated discs** (color + initials) in v1; data model reserves `image_path` for image tokens later. Player tokens auto-exist per campaign character; DM creates NPC/hostile tokens ad-hoc. |
| Control | Players move **only their own character's token**; the DM moves/creates/removes anything. |
| HP rings | Inner arc, green→amber→red by fraction. **DM sees HP rings on ALL tokens (hostiles included); players see them only on `friendly`-faction tokens.** Character tokens derive HP live from the sheet; NPC/hostile tokens carry DM-edited `hp/max_hp`. |
| Status rings | Outer ring showing conditions (e.g. Hunter's Mark). One condition = full labeled ring; **N conditions pie-split the ring into N colored, individually-labeled segments**. Visible to everyone. Character tokens source conditions from the sheet's `play.conditions`; NPC/hostile tokens from token-level `conditions_json`. |
| Scenes | **Scene list, one active** — prep multiple maps (upload, calibrate, place tokens, pre-paint fog); activating one flips every viewer instantly and non-destructively. No player-facing scene picker. |
| Combat tools | **All four in v1 scope** (phase 3): hex ruler, pings, AoE templates, initiative tracker on the map (players must see turn order in remote play). Hex cones use the standard **60° wedge** convention; blasts are radius-N hex disks; lines use hex-line interpolation. |
| Rendering | **Custom SVG scene graph** (no new deps): image layer → grid → templates → tokens → fog → ephemeral. `viewBox` pan/zoom owned by us. Chosen over react-konva (second paradigm for object counts we'll never hit) and tldraw (fights our state model and aesthetic). Rings/labels are what SVG arcs + text excel at, crisp at every zoom. |
| State model | **REST + SQLite are the source of truth**; WS fans out authoritative events after commit (the sheet's pattern, echo-guarded optimistic client). **Ephemeral, direct-WS only:** mid-drag token positions, pings, shared ruler. A refresh always recovers exact state. |
| WS auth | **This feature closes the deferred hole**: the `/swdnd/ws` upgrade now requires a valid player `access_token` for that campaign or the admin cookie; otherwise rejected. |
| Trust model | Fog/hidden filtering is **client-side in v1** (player clients receive hostile tokens and decline to render them under fog / when `hidden`). Acceptable for a trusted table; server-side filtering is a later hardening, noted in the vault. |

## 2. Data model (migration `002_swdnd_map`)

- **`scene`** — `id, campaign_id (FK), name, image_path NULL, image_w, image_h, grid_json, fog_json, initiative_json, is_active, sort, created_at, updated_at`.
  - `grid_json`: `{ orientation: 'flat'|'pointy', hexSize: px, originX: px, originY: px, unitsPerHex: number, unitLabel: string }` (image-pixel space).
  - `fog_json`: revealed hexes as an array of `"q,r"` axial keys.
  - `initiative_json`: `{ order: [{ tokenId, name, roll }], activeIndex, round } | null`.
- **`token`** — `id, scene_id (FK, cascade), character_id NULL, name, color, faction ('friendly'|'hostile'|'neutral'), q, r, scale (1|2|3 hex-diameters), hp NULL, max_hp NULL, conditions_json, hidden, image_path NULL (v1 unused), created_at, updated_at`. Character-linked tokens leave hp/conditions NULL and derive from the sheet.
- **Uploads** on disk under the data volume: `SWDND_UPLOADS_DIR` (default `./data/uploads/swdnd/`), served by a static GET route. Multipart upload, 10 MB cap, png/jpg/webp allowlist.

## 3. Backend routes & WS events

REST under `/swdnd/*` (DM = admin cookie/bearer; player = `X-Player-Token`/`?token=`):
- Scenes: `GET/POST /campaigns/:id/scenes`, `PATCH/DELETE /scenes/:id` (name/grid/sort), `POST /scenes/:id/activate`, `POST /scenes/:id/image` (multipart), `PATCH /scenes/:id/fog` (`{reveal:[], hide:[]}` hex batches) — all DM-only.
- Tokens: `POST /scenes/:id/tokens`, `PATCH/DELETE /tokens/:id` (DM-only) and `PATCH /tokens/:id/position` — DM any; a player only when the token's `character_id` resolves to their player id.
- Templates (phase 3): `POST /scenes/:id/templates`, `DELETE /templates/:id` — any authed room member (trusted table); DM may clear all.
- Initiative (phase 3): `PATCH /scenes/:id/initiative` — DM-only.
- ⚠️ These paths ride under the existing `selfGated()` exemption rules — each route enforces its own check like the character routes do.

WS broadcasts after commit: `scene:activated`, `scene:updated` (grid/fog/image/initiative), `token:created|updated|deleted`, `template:created|deleted`. Ephemeral client→room relays (server rebroadcasts, never persists): `token:drag` (throttled), `ping`, `ruler`. Upgrade auth per §1.

## 4. Pure modules (unit-tested, no React/IO)

- `lib/hex.ts` — axial math for both orientations: `pixelToHex`, `hexToPixel`, `hexRound`, `hexDistance`, `hexLine` (cube-lerp), `hexBlast(center, r)`, `hexWedge(origin, dir 0–5, length)`, `hexRing`, `hexCorners` (grid rendering). The module everything trusts; exhaustive tests.
- `lib/rings.ts` — HP arc path for a fraction (color banding green→amber→red) and status-pie geometry: N conditions → N equal outer segments with deterministic per-condition colors and label anchors.
- `lib/mapState.ts` — reducers merging WS events + optimistic local actions into `{scene, tokens, templates}` (sheet-style echo guard).
- `lib/fog.ts` — revealed-set operations (paint/erase batches, brush footprint via `hexBlast`).

## 5. The Tabletop panel

`panels/Tabletop/` — container-agnostic (`@container`), Holoterminal. One `<svg>`: map image → hex grid (subtle cyan) → templates → tokens → fog (players opaque, DM 40% dim) → ephemeral (pings, drag ghosts, shared ruler). Pan/zoom = viewBox transform (wheel/pinch zoom, drag-on-empty pan). Toolbar (collapses when narrow): select/move · ruler · ping · template pickers · **DM-only:** fog brush, token creator, scene drawer (list/upload/calibrate-with-live-preview/activate), initiative editor. Initiative strip across the top for everyone when running; the active token glows.

**Tokens:** disc + initials at 1/2/3 hex-diameter scale. Inner HP arc (visibility per §1), outer status pie (labels at segment midpoints). Character tokens bind live: the panel loads campaign characters + reference data, runs `computeSheet`, and re-renders on `character:updated`. DM tap-popover edits NPC hp/conditions/faction/scale/hidden. Player drag: ephemeral ghost → hex-snap on drop → REST commit → snap-back on failure.

**Split view:** `/play/:characterId` renders CharacterSheet + Tabletop side by side (campaign derived from the character); lands in phase 1.

## 6. Implementation phases (one PR + plan each)

1. **Map core** — hex engine, WS upgrade auth (+ sheet client sends its token), scene CRUD/upload/calibration/activation, tokens with drag (ephemeral previews) and pan/zoom, split view. Playable immediately.
2. **Fog & rings** — fog brush + player masking, HP/status rings, character binding, hidden flag, NPC popover.
3. **Combat tools** — shared ruler, pings, AoE templates, initiative tracker.

## 7. Testing

Per phase: `bun test` on pure modules (hex math exhaustive incl. rounding/orientation edges; ring segment geometry; fog set ops; mapState reducers), backend route tests for the auth matrix (WS upgrade accept/reject, player-moves-own-token-only, DM-only fog/scene ops, upload validation), and a **two-tab live walkthrough** (DM tab + player-token tab) proving real-time drag/fog/ping flow, narrow + wide.

## 8. Out of scope (tracked)

- Line-of-sight/vision fog; wall authoring.
- Image tokens (`image_path` reserved), token art libraries, map-asset marketplaces.
- Server-side fog/hidden filtering (trust-model hardening).
- Square-grid support; measurement templates beyond blast/wedge/line.
- Persisted roll log / chat; DM Screen (own feature).
