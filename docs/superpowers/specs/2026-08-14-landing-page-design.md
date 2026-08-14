# swdnd Landing Page — Design

**Date:** 2026-08-14 · **Status:** approved · **Scope:** frontend-only (apps/swdnd)

## Goal

Turn the static stub at `/` (swdnd.ashercarlow.com) into a real home page:

- **Admin** (existing `.ashercarlow.com` session cookie): every campaign as a card — name, `dm screen` + `map` navigation, and an expandable players section (characters as sheet links, `copy invite link` per player).
- **Player** (no cookie): a one-field form for their invite code (the player `access_token` UUID). A valid code is remembered in localStorage; returning visitors auto-forward to their existing home at `/player?token=…`.

No backend changes. Every endpoint consumed already exists.

## Decisions (approved 2026-08-14)

1. **Admin login stays out-of-band.** The page only reads the existing cookie (`useAuth`). No login UI; DmHome's "DM login required" dead-end is unchanged.
2. **Player codes are remembered** in localStorage (friends-trust model; the code is an unguessable invite UUID, not a password). A `switch player` escape hatch lives on PlayerHome.
3. **Admin player rows do both:** characters render as sheet links AND each player carries `copy invite link` (the AdminDrawer idiom).
4. **The player flow is a thin gateway:** after validation the page forwards to the existing PlayerHome rather than duplicating its list.
5. **DmHome stays untouched** as the mutation surface (create/rename). The landing page is read + navigate. (Absorbing DmHome into `/` is a possible later consolidation, deliberately out of scope.)

## Architecture

```
apps/swdnd/src/
├── lib/playerSession.ts        NEW   pure localStorage wrapper (get/set/clear, junk-tolerant)
├── lib/playerSession.test.ts   NEW
├── lib/landing.ts              NEW   pure helpers: groupCharactersByPlayer(players, characters)
├── lib/landing.test.ts         NEW
├── panels/Landing/index.tsx    NEW   the panel (replaces the inline Landing stub in App.tsx)
├── panels/PlayerHome/index.tsx MOD   header gains `switch player` (clear storage → navigate '/')
└── App.tsx                     MOD   `/` renders <SinglePanel><Landing /></SinglePanel>
```

### State resolution (in order)

1. `useAuth()` loading → `Loading…` (house mono/muted idiom).
2. `authed` → **admin view**.
3. `getStoredToken()` non-null → validate via `getPlayerByToken(token)` (`GET /swdnd/players/me?token=`):
   - 200 → `navigate('/player?token=…', { replace: true })`.
   - 404 (revoked/deleted) → `clearStoredToken()`, fall through to the form. Silent — no error flash for a stale remembered code.
   - Network/5xx error → fall through to the form **without clearing storage** (a flaky network must not log players out), with the inline error shown.
4. Otherwise → **player code form**.

## Admin view

- `listCampaigns()` on mount; failure → inline red error (house style), page still renders.
- One `ht-panel` card per campaign:
  - Campaign name (text, not editable here).
  - `⌘ dm screen` → `/dm/:id` and `⬡ map` → `/map/:id`, both as `PanelLink` (alt-click split semantics come free).
  - `players ▾` expander. First expand fetches `GET /swdnd/campaigns/:id/players` + `GET /swdnd/campaigns/:id/characters` once, cached in component state keyed by campaign id. Re-collapse/expand does not refetch.
- Player rows (from `groupCharactersByPlayer`):
  - Player name · their characters as `▤ <name>` sheet `PanelLink`s (`/sheet/:id`) · `copy invite link`.
  - Invite link is exactly the AdminDrawer idiom: `${origin}/player?token=${encodeURIComponent(access_token)}`, navigator.clipboard with `copied ✓` flash, `window.prompt` fallback.
  - A player with no characters renders `(no characters yet)` in muted text.
  - Characters with `player_id: null` group under a final `unassigned` row — sheet links only, no invite action.
- Empty campaign list → `No campaigns yet — open the DM console to create one.` with a `/dm` link.

## Player gateway

- Form: one text input (`player code…` placeholder), one `enter` button; Enter key submits.
- Submit → trim → `getPlayerByToken`:
  - 200 → `setStoredToken(code)`, `navigate('/player?token=' + encodeURIComponent(code))`.
  - 404 → inline `unknown player code` error; storage untouched.
  - Other errors → inline generic error; storage untouched.
- Empty input → button disabled (no request).
- **PlayerHome addition:** a small `switch player` link in the header — `clearStoredToken()` then `navigate('/')`. Without it, a remembered player could never reach the form again.

## lib contracts

```ts
// lib/playerSession.ts — the ONLY reader/writer of the storage key
const KEY = 'swdnd.playerToken';
export function getStoredToken(): string | null;   // null on absent/empty/junk; never throws (storage disabled → null)
export function setStoredToken(token: string): void; // no-op on empty/whitespace; never throws
export function clearStoredToken(): void;            // never throws

// lib/landing.ts — pure, unit-tested. PlayerDto/CharacterDto are the existing
// types in lib/characters.ts (listPlayers/listCharacters/getPlayerByToken all
// already live there too — no new REST wrappers needed).
export interface PlayerGroup { player: PlayerDto | null; characters: CharacterDto[] }
// One group per player (roster order), characters in list order; a trailing
// { player: null } group holds player_id-less characters; players with no
// characters still get a group. Unknown player_id on a character → the null group.
export function groupCharactersByPlayer(players: PlayerDto[], characters: CharacterDto[]): PlayerGroup[];
```

## Error handling summary

| Failure | Behavior |
|---|---|
| Campaign list fetch fails (admin) | Inline error, page shell still renders |
| Players/characters fetch fails on expand | Inline error inside the card, expander re-clickable (retry) |
| Stored token 404s | Clear storage, show form, no error message |
| Stored token network error | Keep storage, show form + inline error |
| Form code 404s | `unknown player code`, storage untouched |
| localStorage unavailable (private mode) | All helpers no-op/return null; form still works per-visit |

## Testing

- `playerSession.test.ts`: round-trip, clear, empty/whitespace set no-op, junk tolerance (mock localStorage absent/throwing → null, no throw).
- `landing.test.ts`: grouping — multi-player, empty roster, characterless player, null `player_id`, unknown `player_id`, order preservation.
- Panel/UI: no DOM harness (house convention) — suite stays green, typecheck + build clean; acceptance is a browser walkthrough (admin view with real campaigns, expand + invite copy, player code entry incl. bad code, remembered-token auto-forward, switch-player round-trip).

## Out of scope

Absorbing DmHome (create/rename) into `/` · admin login UI · rate-limiting code guesses (unguessable UUID, friends-trust) · multi-player-profile switching UI beyond the single remembered code · resume/wedding/starwars hosts (untouched).
