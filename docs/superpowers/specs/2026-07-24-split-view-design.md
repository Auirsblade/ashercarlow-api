# Generalized Split View Design

**Date:** 2026-07-24
**Status:** Approved
**Scope:** Replace the hardcoded `/play/:characterId` sheet+map split with a general split system: any panel screen (character sheet, map, DM screen) beside any other, driven by alt-click on the existing nav links, with new cross-links between the sheet and the map. Frontend-only — no backend changes.

## Decisions (approved 2026-07-24)

- **Splits are URLs.** `/split/:left/:right` with `screen:id` descriptors. Reload keeps the layout; layouts are bookmarkable and shareable. The shared `?token=` query rides the split URL.
- **Navigation semantics:**
  - Full screen + **alt-click** on a panel link → open the target beside the current screen (current keeps left, target takes right).
  - In a split, **plain click** → replace **your own** panel's content (contained navigation).
  - In a split, **alt-click** → replace the **other** panel.
  - Any move that would put the **same panel on both sides collapses** to that panel full-screen.
  - **⛶ per panel** in the split chrome promotes that half to full screen — the explicit exit, and the only one on touch (no Alt key).
  - Links to **non-panel destinations** (`/dm` campaigns list, PlayerHome, the builder, invite links) always navigate the whole page.
- **Cross-links added:** sheet header → `map`; map toolbar → player `sheet` button(s) for owned characters and a DM `dm` button; token editor → `sheet` link on character tokens. Existing panel links (DM screen `map`, admin-drawer roster `sheet`s, DmHome links) convert to the shared component and become alt-capable.
- **`/play/:characterId` becomes a redirect** to `/split/sheet:<id>/map:<campaignId>` (preserving `?token=`) so old bookmarks and any invite-flow muscle memory keep working.
- **One RollDock per page:** panel-embedded docks suppress themselves inside a split; the split page mounts exactly one dock.

## 1. Panel descriptors — `lib/panels.ts` (pure)

```ts
type PanelKind = 'sheet' | 'map' | 'dm';
interface Panel { kind: PanelKind; id: string }
```

- `parsePanel(s: string): Panel | null` — accepts `kind:id` where kind is one of the three and id is a non-empty string without `/`; anything else → `null`.
- `formatPanel(p: Panel): string` — `"kind:id"` (inverse of parse).
- `panelPath(p: Panel): string` — the full-screen route: `sheet → /sheet/{id}`, `map → /map/{id}`, `dm → /dm/{id}`.
- `splitPath(left: Panel, right: Panel): string` — `/split/{formatPanel(left)}/{formatPanel(right)}`.
- `samePanel(a: Panel, b: Panel): boolean` — kind AND id equality (`sheet:X` beside `sheet:Y` is a valid split).
- `navigateFrom(ctx: {left: Panel; right: Panel; side: 'left' | 'right'} | null, current: Panel | null, target: Panel, alt: boolean): string` — the whole navigation model in one pure function:
  - `ctx === null` (full screen): alt && current && !samePanel(current, target) → `splitPath(current, target)`; otherwise `panelPath(target)`.
  - In a split, compute the tentative next pair (plain → replace own side; alt → replace other side); if `samePanel(nextLeft, nextRight)` → `panelPath(target)` (collapse); else `splitPath(nextLeft, nextRight)`.

Query strings are appended by the caller (the link component preserves the current `?token=`), not by these helpers.

## 2. Route & SplitPage

- App.tsx adds `/split/:left/:right` → `SplitPage`.
- `SplitPage` parses both params. An unparseable side renders a small "unknown panel" placeholder in that half (with a link home); it never crashes the page.
- Panels render inside the existing `SplitView` layout (side-by-side ≥ `md`, stacked below). Above each half sits a slim chrome bar: the panel's kind label and the ⛶ promote button (navigates to `panelPath(panel)` + current query).
- Panel → component mapping: `sheet:<characterId>` → `CharacterSheet`, `map:<campaignId>` → `Tabletop`, `dm:<campaignId>` → `DMScreen`. Each is keyed by its descriptor so changing a side remounts cleanly (same reasoning as the existing sheet remount-on-id-change).
- `DMScreen` keeps its own `authed` gate — a player alt-clicking into a `dm:` panel just sees its "DM login required" message in that half.
- `/play/:characterId` keeps its character fetch but now renders `<Navigate replace to={splitPath(sheet, map) + search}>` once the campaign id resolves (error → sheet full-screen fallback).

## 3. SplitContext + PanelLink

- `SplitContext` (new, in `components/split.tsx` with SplitPage): `{left: Panel; right: Panel; side: 'left' | 'right'} | null`, default null. SplitPage wraps each half in a provider carrying that half's `side`.
- `PanelLink` (shared component): props `{to: Panel; current?: Panel; className?; children}`. Renders a real `<a>` (react-router `Link`) pointing at the plain full-screen path so middle-click/open-in-new-tab behave normally; `onClick` (when unmodified by ctrl/cmd/shift) prevents default and navigates to `navigateFrom(splitCtx, current ?? null, to, e.altKey)` with the current `?token=` preserved. `current` is the descriptor of the screen the link lives on (each screen knows its own kind+id); outside a split it's what makes alt-click able to open the split.
- `RollDock` reads `SplitContext`: non-null → render null. `SplitPage` mounts one `RollDock` itself with the left panel's campaign id (sheet panels resolve campaign via their own fetch — SplitPage derives the dock campaign as: left `map`/`dm` id directly, else right `map`/`dm` id, else the sheet's campaign once loaded). In every real layout both sides share a campaign; a cross-campaign split gets the first resolvable campaign's log.

## 4. Cross-links

- **Sheet header** (CoreBar area): `map` PanelLink → `map:<campaign_id>` (the sheet already holds its dto).
- **Map toolbar**: for a player token, one `sheet` PanelLink per owned character (from the `getPlayerByToken` fetch `useTabletop` already does — it needs to keep names alongside ids); for the DM (`authed`), a `dm` PanelLink → `dm:<campaignId>`.
- **Token editor**: character tokens get a `sheet` PanelLink in the editor row.
- **Converted to PanelLink** (gaining alt behavior): DM screen header `map`, admin-drawer `open map` + roster `sheet` links, DmHome's per-campaign `dm screen`/`map` links. Non-panel links (`campaigns`, PlayerHome's `sheet`/`build` — build is not a panel screen) stay plain.

## 5. Out of scope

Persisting a user's preferred layout · three-plus panels · resizable divider · cross-campaign dock merging · making the builder or home pages splittable.

## 6. Testing

- **Unit (`lib/panels.test.ts`):** parse/format round-trips for all three kinds; junk rejection (`''`, `'nope:x'`, `'sheet:'`, `'sheet:a/b'`, no colon); `panelPath`/`splitPath` outputs; `samePanel`; `navigateFrom` full rule table — full-screen plain, full-screen alt (opens split), full-screen alt onto self (stays full), split plain own-side replace, split alt other-side replace, both collapse directions, from both sides.
- **Live walkthrough:** DM: map → alt `dm` (split), plain-click inside panels replaces own side, alt-click replaces other side, navigate one side onto the other's panel → collapse, ⛶ promotes. Player: invite → `/play` URL redirects to the split with token intact, sheet+map both work, map toolbar `sheet` button present, token-editor `sheet` link (DM). Exactly one RollDock in any split; sheet rolls still broadcast. Narrow window stacks. Unknown descriptor (`/split/junk/map:X`) shows the placeholder half.
