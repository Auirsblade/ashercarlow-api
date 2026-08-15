# swdnd Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the static stub at `/` into a real home page: admin sees campaign cards with dm/map navigation and expandable player rosters (sheet links + invite links); anonymous visitors enter a remembered player code and forward to the existing PlayerHome.

**Architecture:** Frontend-only, additive. Two new pure libs (`playerSession` localStorage wrapper, `landing` grouping helper) under TDD; one new panel (`panels/Landing/`) composing existing REST wrappers (`listCampaigns`, `listPlayers`, `listCharacters`, `getPlayerByToken`) with the house Holoterminal idioms; two one-line integrations (App.tsx route swap, PlayerHome `switch player` link). Zero backend changes.

**Tech Stack:** React 19 + Vite + Tailwind v4, react-router, bun:test. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-14-landing-page-design.md` (approved 2026-08-14).

## Global Constraints

- Suite baseline 618 pass / 0 fail — must not drop; new lib tests raise it.
- Typecheck + build: `cd apps/swdnd && bun run build` (`tsc -b && vite build`) clean. Never `bun --cwd`.
- `*.test.ts` are excluded from `tsconfig.app.json` — co-located tests are the bun:test convention.
- All styling via existing `ht-*` classes + Tailwind utilities already in use (no new CSS).
- `git add` explicit paths only, never `-A`.
- The storage key is exactly `swdnd.playerToken`; `lib/playerSession.ts` is its ONLY reader/writer.

## Verified facts (do not re-litigate)

- `lib/characters.ts` already exports: `PlayerDto { id; campaign_id; name; access_token; created_at }`, `CharacterDto { id; campaign_id; player_id: string | null; name; data_json; created_at; updated_at }`, `listCharacters(campaignId)`, `listPlayers(campaignId)`, `getPlayerByToken(token)` → `{ player: PlayerDto; characters: Array<{id; name; campaign_id}> }` (the `/swdnd/players/me?token=` wrapper; 404s on unknown token via `api()` throwing).
- `lib/campaigns.ts` exports `listCampaigns()` → `CampaignDto[] { id; name; created_at }` (admin-gated GET — returns 401→throw when unauthed, but the landing page only calls it when `authed`).
- `lib/auth.tsx` exports `useAuth()` → `{ authed, loading }`.
- `components/split.tsx` exports `PanelLink({ to: Panel, current?, className, title, children })`; `Panel = { kind: 'sheet' | 'map' | 'dm' | 'ship'; id: string }` from `lib/panels.ts`. The landing page is a NON-panel screen → omit `current`.
- `App.tsx:112-121` holds the inline `Landing` stub; the route is `<Route path="/" element={<Landing />} />` at line 128; `SinglePanel` is the full-screen wrapper other home screens use.
- `PlayerHome/index.tsx:85-89` header block is where `switch player` lands; PlayerHome reads its token from `useSearchParams`.
- AdminDrawer's invite idiom (`AdminDrawer.tsx:57-66`): build `${window.location.origin}/player?token=${encodeURIComponent(p.access_token)}`, `navigator.clipboard.writeText` with a `copied` state flash, `window.prompt` fallback on clipboard failure.
- `api()` throws `Error(message)` on non-2xx with the server's `{message}` body; 404 for unknown player token is `Error('Unknown player token')`-shaped — the EXACT message comes from the backend; tasks must branch on a "not found" test, not string equality (see Task 3 Step 2's `isNotFound`).

## File structure

| File | Status | Responsibility |
|---|---|---|
| `apps/swdnd/src/lib/playerSession.ts` | create | localStorage wrapper, sole owner of `swdnd.playerToken` |
| `apps/swdnd/src/lib/playerSession.test.ts` | create | round-trip, junk tolerance, disabled-storage no-throw |
| `apps/swdnd/src/lib/landing.ts` | create | `groupCharactersByPlayer` pure helper |
| `apps/swdnd/src/lib/landing.test.ts` | create | grouping edge cases |
| `apps/swdnd/src/panels/Landing/index.tsx` | create | the panel: admin view / stored-token forward / code form |
| `apps/swdnd/src/App.tsx` | modify | drop the inline stub, route `/` to the new panel |
| `apps/swdnd/src/panels/PlayerHome/index.tsx` | modify | header `switch player` link |

---

### Task 1: `lib/playerSession.ts` — the storage wrapper

**Files:**
- Create: `apps/swdnd/src/lib/playerSession.ts`
- Create: `apps/swdnd/src/lib/playerSession.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module; `globalThis.localStorage` only).
- Produces:
  ```ts
  export function getStoredToken(): string | null;   // trimmed value; null on absent/empty/whitespace; never throws
  export function setStoredToken(token: string): void; // trims; no-op on empty/whitespace; never throws
  export function clearStoredToken(): void;            // never throws
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/swdnd/src/lib/playerSession.test.ts
import { afterEach, describe, expect, it } from 'bun:test';
import { clearStoredToken, getStoredToken, setStoredToken } from './playerSession';

// bun:test provides a working localStorage in the test environment; each test
// leaves the key clean so ordering never matters.
afterEach(() => clearStoredToken());

describe('playerSession', () => {
  it('round-trips a token', () => {
    setStoredToken('488c2546-fabf-4a92-bc95-c40bb9035b66');
    expect(getStoredToken()).toBe('488c2546-fabf-4a92-bc95-c40bb9035b66');
  });

  it('returns null when nothing is stored', () => {
    expect(getStoredToken()).toBeNull();
  });

  it('clear removes the stored token', () => {
    setStoredToken('abc');
    clearStoredToken();
    expect(getStoredToken()).toBeNull();
  });

  it('set is a no-op on empty and whitespace', () => {
    setStoredToken('');
    expect(getStoredToken()).toBeNull();
    setStoredToken('   ');
    expect(getStoredToken()).toBeNull();
  });

  it('trims on write and read', () => {
    setStoredToken('  abc  ');
    expect(getStoredToken()).toBe('abc');
  });

  it('treats stored whitespace junk as absent', () => {
    globalThis.localStorage.setItem('swdnd.playerToken', '   ');
    expect(getStoredToken()).toBeNull();
  });

  it('never throws when storage is unavailable', () => {
    const original = globalThis.localStorage;
    // Simulate private-mode / disabled storage: every access throws.
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('denied'); },
    });
    try {
      expect(getStoredToken()).toBeNull();
      expect(() => setStoredToken('abc')).not.toThrow();
      expect(() => clearStoredToken()).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original });
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/asherc/Git/ashercarlow-api && bun test apps/swdnd/src/lib/playerSession.test.ts`
Expected: FAIL — `Cannot find module './playerSession'`.

- [ ] **Step 3: Implement**

```ts
// apps/swdnd/src/lib/playerSession.ts — the remembered player code.
// The ONLY module that touches this key. Friends-trust model: the code is an
// unguessable invite UUID, not a password; localStorage is fine. Every helper
// swallows storage errors (private mode / disabled storage → behave as absent).
const KEY = 'swdnd.playerToken';

export function getStoredToken(): string | null {
  try {
    const v = globalThis.localStorage.getItem(KEY);
    const trimmed = v?.trim() ?? '';
    return trimmed === '' ? null : trimmed;
  } catch {
    return null;
  }
}

export function setStoredToken(token: string): void {
  const trimmed = token.trim();
  if (trimmed === '') return;
  try {
    globalThis.localStorage.setItem(KEY, trimmed);
  } catch {
    /* storage unavailable — the form still works per-visit */
  }
}

export function clearStoredToken(): void {
  try {
    globalThis.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd /Users/asherc/Git/ashercarlow-api && bun test apps/swdnd/src/lib/playerSession.test.ts`
Expected: PASS (7 tests). Then the full suite: `bun test` → 618 + 7, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/playerSession.ts apps/swdnd/src/lib/playerSession.test.ts
git commit -m "feat(swdnd): remembered player-code storage wrapper"
```

---

### Task 2: `lib/landing.ts` — roster grouping

**Files:**
- Create: `apps/swdnd/src/lib/landing.ts`
- Create: `apps/swdnd/src/lib/landing.test.ts`

**Interfaces:**
- Consumes: `PlayerDto`, `CharacterDto` types from `./characters` (types only — no fetch).
- Produces:
  ```ts
  export interface PlayerGroup { player: PlayerDto | null; characters: CharacterDto[] }
  export function groupCharactersByPlayer(players: PlayerDto[], characters: CharacterDto[]): PlayerGroup[];
  // One group per player in roster order (characterless players included);
  // characters keep list order; a TRAILING { player: null } group holds
  // characters whose player_id is null OR unknown; the null group is omitted
  // when empty.
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/swdnd/src/lib/landing.test.ts
import { describe, expect, it } from 'bun:test';
import { groupCharactersByPlayer } from './landing';
import type { CharacterDto, PlayerDto } from './characters';

const player = (id: string, name: string): PlayerDto =>
  ({ id, campaign_id: 'camp', name, access_token: `tok-${id}`, created_at: 't' });

// Partial-but-typed factory: the grouping only reads id/name/player_id, but the
// literal must satisfy CharacterDto (tests are excluded from tsc, editors still check).
const character = (id: string, name: string, player_id: string | null): CharacterDto =>
  ({ id, campaign_id: 'camp', player_id, name, data_json: {} as CharacterDto['data_json'], created_at: 't', updated_at: 't' });

describe('groupCharactersByPlayer', () => {
  const p1 = player('p1', 'Paulina');
  const p2 = player('p2', 'Rook');

  it('groups characters under their players in roster order', () => {
    const out = groupCharactersByPlayer(
      [p1, p2],
      [character('c1', 'Kira', 'p1'), character('c2', 'Dex', 'p2'), character('c3', 'Vex', 'p1')],
    );
    expect(out.map((g) => g.player?.id)).toEqual(['p1', 'p2']);
    expect(out[0].characters.map((c) => c.id)).toEqual(['c1', 'c3']); // list order kept
    expect(out[1].characters.map((c) => c.id)).toEqual(['c2']);
  });

  it('includes characterless players with an empty group', () => {
    const out = groupCharactersByPlayer([p1], []);
    expect(out).toEqual([{ player: p1, characters: [] }]);
  });

  it('collects null and unknown player_ids into a trailing null group', () => {
    const out = groupCharactersByPlayer(
      [p1],
      [character('c1', 'Kira', 'p1'), character('c2', 'NPC', null), character('c3', 'Ghost', 'gone')],
    );
    expect(out).toHaveLength(2);
    expect(out[1].player).toBeNull();
    expect(out[1].characters.map((c) => c.id)).toEqual(['c2', 'c3']);
  });

  it('omits the null group when every character is assigned', () => {
    const out = groupCharactersByPlayer([p1], [character('c1', 'Kira', 'p1')]);
    expect(out).toHaveLength(1);
  });

  it('handles the empty campaign', () => {
    expect(groupCharactersByPlayer([], [])).toEqual([]);
  });

  it('does not mutate its inputs', () => {
    const players = [p1];
    const characters = [character('c1', 'Kira', 'p1')];
    groupCharactersByPlayer(players, characters);
    expect(players).toHaveLength(1);
    expect(characters[0].id).toBe('c1');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/asherc/Git/ashercarlow-api && bun test apps/swdnd/src/lib/landing.test.ts`
Expected: FAIL — `Cannot find module './landing'`.

- [ ] **Step 3: Implement**

```ts
// apps/swdnd/src/lib/landing.ts — pure helpers for the landing page.
import type { CharacterDto, PlayerDto } from './characters';

export interface PlayerGroup {
  player: PlayerDto | null; // null = the trailing "unassigned" bucket
  characters: CharacterDto[];
}

/**
 * One group per player in roster order (characterless players included, so the
 * DM can still copy their invite link); characters keep list order; characters
 * with a null or unknown player_id land in a trailing { player: null } group,
 * omitted when empty.
 */
export function groupCharactersByPlayer(
  players: PlayerDto[],
  characters: CharacterDto[],
): PlayerGroup[] {
  const known = new Set(players.map((p) => p.id));
  const groups = players.map((p) => ({
    player: p as PlayerDto | null,
    characters: characters.filter((c) => c.player_id === p.id),
  }));
  const unassigned = characters.filter((c) => c.player_id === null || !known.has(c.player_id));
  if (unassigned.length > 0) groups.push({ player: null, characters: unassigned });
  return groups;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd /Users/asherc/Git/ashercarlow-api && bun test apps/swdnd/src/lib/landing.test.ts`
Expected: PASS (6 tests). Full suite: 618 + 13 total, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/landing.ts apps/swdnd/src/lib/landing.test.ts
git commit -m "feat(swdnd): landing roster grouping helper"
```

---

### Task 3: The Landing panel + wiring

**Files:**
- Create: `apps/swdnd/src/panels/Landing/index.tsx`
- Modify: `apps/swdnd/src/App.tsx` (drop the inline `Landing` stub at :112-121; route `/` to the panel)
- Modify: `apps/swdnd/src/panels/PlayerHome/index.tsx` (header `switch player` link)

**Interfaces:**
- Consumes: `getStoredToken`/`setStoredToken`/`clearStoredToken` (Task 1), `groupCharactersByPlayer`/`PlayerGroup` (Task 2), `listCampaigns`/`CampaignDto` (`../../lib/campaigns`), `listPlayers`/`listCharacters`/`getPlayerByToken`/`PlayerDto`/`CharacterDto` (`../../lib/characters`), `useAuth` (`../../lib/auth`), `PanelLink` (`../../components/split`), `SinglePanel` (existing layout — check its import path in App.tsx and reuse).
- Produces: the default-exported `Landing` component; no downstream consumers.

- [ ] **Step 1: Write the panel**

```tsx
// apps/swdnd/src/panels/Landing/index.tsx — the home page at '/'.
// Admin (session cookie): campaign cards with dm/map nav + expandable rosters.
// Anonymous: remembered-code auto-forward, else the player-code form.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PanelLink } from '../../components/split';
import { useAuth } from '../../lib/auth';
import { listCampaigns, type CampaignDto } from '../../lib/campaigns';
import {
  getPlayerByToken, listCharacters, listPlayers,
  type CharacterDto, type PlayerDto,
} from '../../lib/characters';
import { groupCharactersByPlayer } from '../../lib/landing';
import { clearStoredToken, getStoredToken, setStoredToken } from '../../lib/playerSession';

/** api() throws Error(server message); unknown player codes are the 404 path.
 * The message text belongs to the backend, so sniff loosely rather than compare. */
const isNotFound = (e: unknown) =>
  e instanceof Error && /unknown|not found/i.test(e.message);

interface Roster { players: PlayerDto[]; characters: CharacterDto[] }

function InviteButton({ player }: { player: PlayerDto }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const link = `${window.location.origin}/player?token=${encodeURIComponent(player.access_token)}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy the invite link:', link);
    }
  };
  return (
    <button type="button" className="ht-step text-[10px]" onClick={() => void copy()}>
      {copied ? 'copied ✓' : 'copy invite link'}
    </button>
  );
}

function CampaignCard({ campaign }: { campaign: CampaignDto }) {
  const [open, setOpen] = useState(false);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = useRef(false);

  const toggle = () => {
    setOpen((o) => !o);
    if (roster || loading.current) return;
    loading.current = true;
    setError(null);
    Promise.all([listPlayers(campaign.id), listCharacters(campaign.id)])
      .then(([players, characters]) => setRoster({ players, characters }))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load players'))
      .finally(() => { loading.current = false; });
  };

  return (
    <div className="ht-panel flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[140px] text-ht-bright">{campaign.name}</div>
        <PanelLink className="ht-step text-[10px]" to={{ kind: 'dm', id: campaign.id }}>⌘ dm screen</PanelLink>
        <PanelLink className="ht-step text-[10px]" to={{ kind: 'map', id: campaign.id }}>⬡ map</PanelLink>
        <button type="button" className="ht-step text-[10px]" onClick={toggle}>
          {open ? 'players ▴' : 'players ▾'}
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-1 border-t border-ht-line pt-2">
          {error && <div className="text-[11px] text-red-400">{error}</div>}
          {!roster && !error && <div className="text-[11px] text-ht-muted">Loading…</div>}
          {roster && groupCharactersByPlayer(roster.players, roster.characters).map((g) => (
            <div key={g.player?.id ?? 'unassigned'} className="flex flex-wrap items-center gap-2">
              <div className="min-w-[110px] text-[11px] text-ht-text">
                {g.player ? g.player.name : <span className="text-ht-muted">unassigned</span>}
              </div>
              {g.characters.length === 0 && (
                <span className="text-[10px] text-ht-muted">(no characters yet)</span>
              )}
              {g.characters.map((c) => (
                <PanelLink key={c.id} className="ht-step text-[10px]" to={{ kind: 'sheet', id: c.id }}>
                  ▤ {c.name}
                </PanelLink>
              ))}
              {g.player && <InviteButton player={g.player} />}
            </div>
          ))}
          {roster && roster.players.length === 0 && roster.characters.length === 0 && (
            <div className="text-[11px] text-ht-muted">No players yet — invite them from the DM console.</div>
          )}
        </div>
      )}
    </div>
  );
}

function AdminHome() {
  const [campaigns, setCampaigns] = useState<CampaignDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCampaigns()
      .then(setCampaigns)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load campaigns'));
  }, []);

  return (
    <>
      <div className="ht-glow mb-3 rounded-md p-3">
        <div className="ht-name text-sm font-bold">swdnd</div>
        <div className="text-[10px] text-ht-muted">campaigns — ⌘ dm</div>
      </div>
      {error && <div className="mb-2 text-[11px] text-red-400">{error}</div>}
      {!campaigns && !error && <div className="text-ht-muted">Loading…</div>}
      {campaigns && campaigns.length === 0 && (
        <div className="text-[11px] text-ht-muted">
          {/* Plain Link: panelPath needs an id, and /dm (DmHome) is a non-panel screen. */}
          No campaigns yet — <Link className="underline" to="/dm">open the DM console</Link> to create one.
        </div>
      )}
      <div className="flex flex-col gap-2">
        {campaigns?.map((c) => <CampaignCard key={c.id} campaign={c} />)}
      </div>
    </>
  );
}

function PlayerGate() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Distinguishes "checking a remembered code" from "showing the form".
  const [checkingStored, setCheckingStored] = useState(() => getStoredToken() !== null);

  useEffect(() => {
    const stored = getStoredToken();
    if (!stored) return;
    let live = true;
    getPlayerByToken(stored)
      .then(() => { if (live) navigate(`/player?token=${encodeURIComponent(stored)}`, { replace: true }); })
      .catch((e) => {
        if (!live) return;
        if (isNotFound(e)) clearStoredToken(); // revoked — forget silently
        else setError(e instanceof Error ? e.message : 'Could not reach the server');
        setCheckingStored(false);
      });
    return () => { live = false; };
  }, [navigate]);

  const submit = () => {
    const trimmed = code.trim();
    if (trimmed === '' || busy) return;
    setBusy(true);
    setError(null);
    getPlayerByToken(trimmed)
      .then(() => {
        setStoredToken(trimmed);
        navigate(`/player?token=${encodeURIComponent(trimmed)}`);
      })
      .catch((e) => {
        setError(isNotFound(e) ? 'unknown player code' : e instanceof Error ? e.message : 'Could not reach the server');
        setBusy(false);
      });
  };

  if (checkingStored && !error) return <div className="text-ht-muted">Loading…</div>;

  return (
    <div className="ht-panel flex max-w-md flex-col gap-3 p-4">
      <div>
        <div className="ht-name text-sm font-bold">swdnd</div>
        <div className="text-[10px] text-ht-muted">Star Wars D&D — sw5e</div>
      </div>
      <div className="text-[11px] text-ht-muted">
        Enter your player code (from your invite link) to open your characters.
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => { e.preventDefault(); submit(); }}
      >
        <input
          className="flex-1 border-b border-ht-line bg-transparent px-1 text-[12px] text-ht-bright outline-none"
          placeholder="player code…"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
        />
        <button type="submit" className="ht-step" disabled={code.trim() === '' || busy}>
          {busy ? 'checking…' : 'enter'}
        </button>
      </form>
      {error && <div className="text-[11px] text-red-400">{error}</div>}
    </div>
  );
}

export default function Landing() {
  const { authed, loading } = useAuth();
  if (loading) return <div className="ht-screen min-h-screen p-4 font-mono text-ht-muted">Loading…</div>;
  return (
    <div className="ht-screen min-h-screen p-4 font-mono text-ht-text">
      {authed ? <AdminHome /> : <PlayerGate />}
    </div>
  );
}
```

NOTE — the three styling/routing soft spots were verified against the repo while writing this plan; the code above already uses the real idioms:
- Input classes are DmHome's exact new-campaign input classes (`border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none`) — there is no `ht-input` class; do not invent one.
- `border-ht-line` is the real divider token (used by that same input).
- The empty-campaigns "open the DM console" link is a plain `<Link to="/dm">` because `panelPath` requires an id (`/dm/:id` is DmPage; bare `/dm` is DmHome, a non-panel screen).
- `api()` throws `Error('Unauthorized')` on 401 and `Error(<server message>)` otherwise; the `/players/me` 404 message is "Unknown token"-shaped, which `isNotFound`'s `/unknown|not found/i` matches. The reviewer should sanity-check that regex against the actual handler message.

- [ ] **Step 2: Wire App.tsx**

In `apps/swdnd/src/App.tsx`: delete the inline `function Landing() {…}` stub (lines 112-121) and its `SinglePanel` usage there; add `import Landing from './panels/Landing';` alongside the other panel imports; the route becomes:

```tsx
<Route path="/" element={<SinglePanel><Landing /></SinglePanel>} />
```

(The panel renders its own `ht-screen` wrapper like PlayerHome/DmHome do inside `SinglePanel` — match whichever of the two conventions App.tsx actually uses for those routes.)

- [ ] **Step 3: PlayerHome `switch player`**

In `apps/swdnd/src/panels/PlayerHome/index.tsx`, add to the imports:

```tsx
import { clearStoredToken } from '../../lib/playerSession';
```

and inside the header `ht-glow` block (after the `your characters` line):

```tsx
<button
  type="button"
  className="ht-step mt-1 text-[10px]"
  onClick={() => { clearStoredToken(); navigate('/'); }}
>
  switch player
</button>
```

(`navigate` already exists in the component via `useNavigate`.)

- [ ] **Step 4: Typecheck + suite + build**

Run: `cd /Users/asherc/Git/ashercarlow-api && bun test && cd apps/swdnd && bun run build`
Expected: 631 pass / 0 fail (618 + 13), `tsc -b && vite build` clean.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/panels/Landing/index.tsx apps/swdnd/src/App.tsx apps/swdnd/src/panels/PlayerHome/index.tsx
git commit -m "feat(swdnd): landing page — admin campaign cards, player code gateway"
```

---

### Task 4: Full verification + live walkthrough (coordinator-run)

**Files:** none (`.claude/launch.json` temporarily edited, MUST be reverted).

- [ ] **Step 1: Suite + build** — `bun test` (631/0) and `cd apps/swdnd && bun run build` clean; `git status --short` shows only planned files.

- [ ] **Step 2: Auth-enforced walkthrough** (launch.json → `ASHERCARLOW_AUTH_TOKEN=dm-secret`, restart backend; seed a campaign + 2 players + characters incl. one characterless player and one unassigned character):
  1. Anonymous `/`: player-code form renders (no admin content in the DOM); bad code → `unknown player code`; empty input → button disabled.
  2. Valid code → forwards to `/player?token=…`, PlayerHome renders; revisit `/` → auto-forward without the form (remembered).
  3. PlayerHome `switch player` → back on `/` with the form shown (storage cleared — verify via `localStorage.getItem('swdnd.playerToken')` in the console).
  4. Kill the backend, revisit `/` with a remembered code → form + error, and the code is STILL stored (network failure must not clear). Restart backend.
  5. Admin (cookie): campaign cards with `⌘ dm screen` / `⬡ map` links (verify navigation), `players ▾` expands to rosters: player rows with sheet links, `copy invite link` → clipboard contains `/player?token=…`; characterless player shows `(no characters yet)`; unassigned character under `unassigned` with no invite button; collapse/expand does not refetch (network panel).
  6. Revoked remembered code: delete the player via the DM screen, revisit `/` → form shown silently, storage cleared.
- [ ] **Step 3: REVERT `.claude/launch.json`**, restart dev backend, `git status` clean.
- [ ] **Step 4: Vault docs** — `Roadmap.md` gets a one-line entry (landing page); `Architecture.md` route table gains `/` → Landing. Small, honest updates only.
- [ ] **Step 5:** superpowers:finishing-a-development-branch → push + PR.

---

## Self-review notes

- **Spec coverage:** storage wrapper → T1; grouping → T2; panel (all three states), App wiring, PlayerHome escape hatch → T3; error-handling table + walkthrough → T3 code + T4 checklist. Out-of-scope list respected (no DmHome changes beyond none, no login UI, no backend).
- **Type consistency:** `PlayerGroup`/`groupCharactersByPlayer` (T2) match T3's import; `getStoredToken`/`setStoredToken`/`clearStoredToken` (T1) match T3/PlayerHome usage; `PanelLink to={{kind,id}}` matches `components/split.tsx`.
- **Known soft spots flagged to the implementer inline** (T3 note): `ht-input` existence, divider color token, `panelPath` with empty id — verify-not-invent instructions embedded rather than guessed.
- **404 sniffing:** `isNotFound` regexes the message rather than string-equality on backend copy — the T3 reviewer should confirm the actual 404 message shape against `players.ts` and tighten if the backend exposes a status code on the thrown error instead.
