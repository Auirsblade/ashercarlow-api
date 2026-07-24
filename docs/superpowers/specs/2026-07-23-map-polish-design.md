# Map Polish Design — Image Tokens, Roll Log, Ring Labels

**Date:** 2026-07-23
**Status:** Approved
**Scope:** Three quality-of-life improvements to the shipped swdnd app: a shared persisted roll log with a floating dice roller, image tokens (uploads on the reserved `token.image_path` column), and curved condition-name labels inside thicker status rings.

## Decisions (approved 2026-07-23)

- **Roll log sources:** a dedicated roller widget **plus** auto-broadcast of existing character-sheet rolls (checks, saves, attacks, damage).
- **Persistence:** rolls are stored in a new `roll` table; the log survives reload and supports scrollback ("what did he roll for that damage?"). WS is the live tail.
- **Secret DM rolls:** the roller has a DM-only "secret" toggle. Secret rolls are stored `hidden=1`, stripped from the list endpoint for non-admins, and skip the room broadcast. Players never see that a secret roll happened.
- **Placement:** a floating `RollDock` mounted on **all three surfaces** — Tabletop, CharacterSheet (play view), DMScreen.
- **Roller expressiveness:** quick dice buttons that **build a visible, editable formula** (`2d6+1d8+3`), plus modifier, adv/dis for a bare `1d20`, and an optional label.
- **Client rolls, server records.** Server-side rolling was considered for tamper-resistance and rejected — friends-trust-model app, and it would fork the sheet's existing local roll path.
- **Image tokens access:** DM can set any token's image; a **player can set the image on their own character's token** — the same trust boundary as token movement (`assertTokenMoveAccess`).
- **Ring labels:** thicker status band with the condition name **curved along the arc**, black/white text chosen by segment-color luminance, **fit-based fallback** to the current single-letter marker when the name doesn't fit the slice, and bottom-half arcs flipped so text never renders upside-down.

## 1. Roll log — backend

### Migration `005_swdnd_rolls.sql`

```sql
CREATE TABLE roll (
  id          TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  roller      TEXT NOT NULL,            -- display name: player name or 'DM'
  label       TEXT,                     -- e.g. 'Perception check', 'Blaster damage'
  formula     TEXT NOT NULL,            -- '2d6+1d8+3'
  rolls_json  TEXT NOT NULL DEFAULT '[]', -- [{sides, value}, ...]
  total       INTEGER NOT NULL,
  hidden      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_roll_campaign ON roll(campaign_id, created_at);
```

Registered as version 5 in `apps/backend/src/db/swdnd/index.ts`.

### Routes (`apps/backend/src/routes/swdnd/rolls.ts`)

- `GET /swdnd/campaigns/{id}/rolls?limit=50` — open read (trust model), newest-first, capped at 100. Rows with `hidden=1` are **stripped unless the requester passes the admin check in-handler** (same reasoning as the players list: GETs bypass the blanket gate, so sensitive reads guard themselves).
- `POST /swdnd/campaigns/{id}/rolls` — body `{roller?, label?, formula, rolls: [{sides, value}], total, hidden?}`. A new `endsWith('/rolls')` clause joins `selfGated()`; the handler calls `assertCampaignMember` (templates pattern: admin cookie or a valid player token for this campaign). `hidden: true` from a **non-admin is a 403** — secrecy is a DM privilege. Server assigns `id`/`created_at`; `roller` defaults to the authenticated player's name, or `'DM'` for admins.
- No PATCH/DELETE — the log is append-only.
- Non-hidden rolls broadcast `roll:created` (full row) to the campaign room. Hidden rolls broadcast nothing; the DM's dock appends from the POST response.

## 2. Roll log — client

### `lib/dice.ts` extension (existing exports untouched)

- `parseFormula(s): FormulaTerm[] | null` — sums of `NdM` dice terms and integer constants with `+`/`-` (`2d6+1d8+3-1`). Whitespace-tolerant; anything else → `null`.
- `rollFormula(terms, rng?): {total, rolls: [{sides, value}], formula}` — negative constants subtract; negative dice terms are rejected by the parser (YAGNI).

### `lib/rolls.ts` (new)

- `RollDto` mirroring the row (with `rolls` parsed).
- REST wrappers `listRolls(campaignId, limit?)`, `postRoll(campaignId, body)`.
- Pure helpers: `appendRoll(list, roll)` (dedupe by id, newest-first, in-memory cap 100) and formula-builder ops for the quick buttons — `addDie(formula, sides)` (collapses `1d6+1d6` → `2d6`, appends a term otherwise), `addModifier(formula, k)` (merges constants), `clearFormula`.

### `hooks/useRollLog.ts` (new)

Self-contained per-mount: `useRollLog(campaignId)` → `{rolls, status, roll(formula, opts), error}`. Load recent via REST → own `connectCampaign` socket → merge `roll:created` with the standard pre-load buffering and reload-on-reconnect. `roll()` parses, rolls locally, POSTs, and appends the response (covers the hidden-roll no-broadcast case); the WS append dedupes the echo by id. A second WS connection per tab is accepted — it keeps the dock droppable into any view without coupling to `useTabletop`/`useSheet`/`useDmScreen`.

### `components/RollDock.tsx` (new, shared)

Floating bottom-right. Collapsed: a pill with the latest visible roll (`Kira · 2d6+3 = 11`). Expanded: scrollable log (roller, label, formula, per-die results, total; 🔒 marker on hidden rows — DM only sees them) + the roller: d4/d6/d8/d10/d12/d20/d100 quick buttons building into a visible editable formula input, +/- modifier, adv/dis toggle shown only when the formula is exactly `1d20` (adv/dis rolls via existing `rollD20`, posts both d20s in `rolls` with `total` derived from the kept die, and suffixes the label with `(adv)`/`(dis)` so the log shows why two dice appear), optional label field, DM-only "secret" checkbox (rendered from `useAuth().authed`).

### Mounting + sheet integration

`RollDock` mounts on Tabletop, CharacterSheet play view, and DMScreen (each already knows `campaignId`). The sheet's existing roll buttons additionally `postRoll` their local results with the character's name as `roller` and a label ("Stealth check", power/damage names) — fire-and-forget: a failed POST never blocks or delays the local roll display.

## 3. Image tokens

### Backend (`tokens.ts` additions)

- `POST /swdnd/tokens/{id}/image` — multipart upload, png/jpg/webp, 5 MB cap (mirrors the scene image route). Saves to `SWDND_UPLOADS_DIR/token-{id}.{ext}`, deletes any prior file with a different extension, sets `image_path`, bumps `updated_at`, broadcasts `token:updated`.
- `DELETE /swdnd/tokens/{id}/image` — removes the file, nulls `image_path`, broadcasts `token:updated` (token reverts to the generated disc).
- Both use `assertTokenMoveAccess` in-handler: admin, or the player owning the token's character. Paths start with `/swdnd/tokens` so they are already selfGated-exempt — the in-handler check is the enforcement, exactly like the move route.
- Files are served by the existing `/swdnd/uploads/{file}` route; clients cache-bust with `?v={updated_at}`.

### Frontend

- **TokenGlyph:** when `image_path` is set, render `<image>` clipped to the token circle via a per-token `<clipPath>`, beneath rings and labels. The faction color remains as a visible border ring adjacent to the status band so friend/foe reads at a glance. The clip radius shrinks slightly under the (now thicker) status band so art isn't hidden. No image → today's disc, unchanged.
- **TokenEditor (DM):** upload input + "remove image" button.
- **Player affordance:** tap-selecting **their own** token opens a minimal editor showing only the image controls (the DM's full editor stays DM-only).

## 4. Ring labels

All geometry stays pure in `lib/rings.ts`; `TokenGlyph` just renders what it's given.

- **Band thickness:** status ring grows from the current thin stroke to ~22% of token radius — thick enough for legible curved text.
- **`statusSegments` gains per-segment:**
  - `textArc: string | null` — arc path at mid-band radius for SVG `<textPath>` (unique id per token+segment).
  - `textColor: string` — relative luminance of the segment color (WCAG formula) ≥ 0.5 → black, else white.
  - `fits: boolean` — estimated text width (`name.length × 0.62 × fontSize`) ≤ arc length at mid-band radius (`r_mid × sliceRadians`), with a small padding factor. `fits` → curved full name; not → the existing single-letter marker at the slice mid-angle (current behavior preserved as fallback). A single condition is a full ring and nearly always fits.
- **Upside-down guard:** when a slice's mid-angle lies in the bottom semicircle, the text arc is emitted counter-clockwise (start/end swapped, sweep flipped) so the name reads upright-ish rather than head-down.
- **HP arc** stays where it is, outside the status band.

## Testing

- `dice.test.ts`: `parseFormula` accept/reject table, `rollFormula` with seeded rng, builder ops (`addDie` collapsing, modifier merging).
- `rolls.test.ts` (backend): member gate matrix (anon 401, player OK, admin OK), hidden filtering (player list excludes, admin list includes), player-sends-hidden 403, limit/order.
- `rolls.test.ts` (client lib): `appendRoll` dedupe/cap/order.
- `rings.test.ts` additions: fit rule boundaries, luminance→contrast color, bottom-half arc flip, fallback marker parity with today.
- `tokens.test.ts` additions: image upload/delete access matrix (admin, owning player, other player 403, anon 401), extension handling.
- Live two-tab walkthrough (auth enforced): roller + formula builder, sheet roll broadcast, secret roll invisible to the player tab, log scrollback after reload, image upload by DM and by owning player (and rejection for the wrong player), ring labels with 1 and 3 conditions, fallback letters on narrow slices.

## Out of scope (unchanged deferrals)

Server-side rolling · roll statistics · per-roll reactions · monster art auto-sourcing from Foundry `img` paths · animated dice.
