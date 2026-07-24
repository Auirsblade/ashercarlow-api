# Generalized Split View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any panel screen (sheet / map / DM screen) beside any other via `/split/:left/:right` URLs, driven by alt-click on nav links, with new sheet↔map cross-links; `/play/:characterId` becomes a redirect.

**Architecture:** All navigation rules live in one pure, unit-tested function (`navigateFrom` in `lib/panels.ts`). A `SplitContext` + shared `PanelLink` component make every panel-nav link split-aware without the three screens knowing splits exist. `SplitPage` composes panels in the existing `SplitView` layout with a slim per-half chrome bar (⛶ promote) and mounts the page's single RollDock (panel-embedded docks suppress themselves via the context). Frontend-only.

**Tech Stack:** React + react-router v6 + `bun:test` for the pure module. No backend changes.

**Spec:** `docs/superpowers/specs/2026-07-24-split-view-design.md` (approved). Branch: `swdnd-split-view`.

## Verified facts (read before implementing)

- **Build/typecheck:** `cd apps/swdnd && bun run build` (tsc `noUnusedLocals`; NEVER `bun --cwd`). `bun test` does not typecheck. Do NOT run a bare `bun test` from the repo root (wipes the dev swdnd DB); scope test runs to file paths.
- **Navigation rules (approved):** full-screen alt-click → split (current left, target right) · in-split plain click → replace own side · in-split alt-click → replace other side · same panel on both sides → collapse to that panel full-screen · ⛶ promotes a half · links to non-panel destinations (campaigns list, PlayerHome, builder) always full-page navigate.
- **Current state (post map-polish merge):** `App.tsx` has `SheetPage` (fetches campaign for a page-level RollDock), `PlayPage` (hardcoded sheet+map SplitView), `MapPage`, `DmPage`. `SplitView` ([layouts/SplitView.tsx](apps/swdnd/src/layouts/SplitView.tsx)) is a 2-col grid: left half `@container overflow-auto`, right `@container h-screen overflow-auto`. `RollDock` (`components/RollDock.tsx`) is mounted inside `Tabletop` and `DMScreen` and at `SheetPage` level. `useTabletop` fetches `getPlayerByToken(playerToken)` but keeps only a `Set` of own character ids (`hooks/useTabletop.ts:135-142`). `CoreBar` (sheet header) has `characterId` but not the campaign id; `Sheet/index.tsx` holds `s.dto.campaign_id`. `TokenEditor` doesn't know the campaign id. `DMScreen` header links `map`/`campaigns`; `AdminDrawer` links `open map` + per-character `sheet`; `DmHome` rows link `dm screen`/`map`.
- **PanelLink click handling:** react-router `Link` must keep default behavior for ctrl/cmd/shift/middle clicks (new tab); only plain and alt-only left-clicks are intercepted. Alt-left-click default action in some browsers is "download link" — `preventDefault` in the intercept stops that.
- **Commit discipline:** `git add` explicit paths only, never `-A`.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `apps/swdnd/src/lib/panels.ts` | create | Panel type, parse/format/paths, `samePanel`, `navigateFrom` |
| `apps/swdnd/src/lib/panels.test.ts` | create | full rule-table tests |
| `apps/swdnd/src/components/split.tsx` | create | `SplitContext`, `useSplit`, `PanelLink` |
| `apps/swdnd/src/components/SplitPage.tsx` | create | `/split` route: parse, chrome, panels, single RollDock |
| `apps/swdnd/src/layouts/SplitView.tsx` | modify | both halves fixed-height flex columns (SplitPage is now the sole consumer) |
| `apps/swdnd/src/components/RollDock.tsx` | modify | render null inside a split panel |
| `apps/swdnd/src/App.tsx` | modify | `/split/:left/:right` route; `PlayPage` → redirect |
| `apps/swdnd/src/hooks/useTabletop.ts` | modify | expose `ownCharacters: {id, name}[]` |
| `apps/swdnd/src/panels/Tabletop/index.tsx` | modify | player `sheet` buttons + DM `dm` button; pass campaignId to TokenEditor |
| `apps/swdnd/src/panels/Tabletop/TokenEditor.tsx` | modify | `sheet` PanelLink on character tokens |
| `apps/swdnd/src/panels/CharacterSheet/Sheet/CoreBar.tsx` | modify | `map` PanelLink (new `campaignId` prop) |
| `apps/swdnd/src/panels/CharacterSheet/Sheet/index.tsx` | modify | pass `campaignId` to CoreBar |
| `apps/swdnd/src/panels/DMScreen/index.tsx` | modify | header `map` → PanelLink |
| `apps/swdnd/src/panels/DMScreen/AdminDrawer.tsx` | modify | `open map` + roster `sheet` → PanelLink |
| `apps/swdnd/src/panels/DmHome/index.tsx` | modify | row links → PanelLink (alt opens the dm+map pair) |

Execution: Task 1 (pure) → Task 2 (split machinery) → Task 3 (cross-links) → one opus review → Task 4 (walkthrough + docs).

---

### Task 1: `lib/panels.ts` — descriptors + navigation model

**Files:**
- Create: `apps/swdnd/src/lib/panels.ts`
- Test: `apps/swdnd/src/lib/panels.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/swdnd/src/lib/panels.test.ts
import { describe, expect, test } from 'bun:test';
import {
  formatPanel, navigateFrom, panelPath, parsePanel, samePanel, splitPath, type Panel,
} from './panels';

const sheetA: Panel = { kind: 'sheet', id: 'a' };
const sheetB: Panel = { kind: 'sheet', id: 'b' };
const mapC: Panel = { kind: 'map', id: 'c' };
const dmC: Panel = { kind: 'dm', id: 'c' };

describe('parsePanel / formatPanel', () => {
  test('round-trips all three kinds', () => {
    for (const p of [sheetA, mapC, dmC]) {
      expect(parsePanel(formatPanel(p))).toEqual(p);
    }
  });
  test('accepts ids containing colons (uuids never do, but be safe)', () => {
    expect(parsePanel('sheet:a:b')).toEqual({ kind: 'sheet', id: 'a:b' });
  });
  test('rejects junk', () => {
    for (const bad of ['', 'sheet', 'sheet:', ':x', 'nope:x', 'sheet:a/b', 'map:']) {
      expect(parsePanel(bad)).toBeNull();
    }
  });
});

describe('paths', () => {
  test('panelPath maps kinds to their full-screen routes', () => {
    expect(panelPath(sheetA)).toBe('/sheet/a');
    expect(panelPath(mapC)).toBe('/map/c');
    expect(panelPath(dmC)).toBe('/dm/c');
  });
  test('splitPath composes descriptors', () => {
    expect(splitPath(sheetA, mapC)).toBe('/split/sheet:a/map:c');
  });
});

describe('samePanel', () => {
  test('kind and id must both match', () => {
    expect(samePanel(sheetA, { kind: 'sheet', id: 'a' })).toBe(true);
    expect(samePanel(sheetA, sheetB)).toBe(false);
    expect(samePanel(mapC, dmC)).toBe(false); // same id, different kind
  });
});

describe('navigateFrom — full screen (ctx null)', () => {
  test('plain click → target full screen', () => {
    expect(navigateFrom(null, mapC, sheetA, false)).toBe('/sheet/a');
  });
  test('alt-click with a current panel → split, current left / target right', () => {
    expect(navigateFrom(null, mapC, sheetA, true)).toBe('/split/map:c/sheet:a');
  });
  test('alt-click onto the current panel itself stays full screen', () => {
    expect(navigateFrom(null, mapC, mapC, true)).toBe('/map/c');
  });
  test('alt-click with no current panel (e.g. DmHome without a pair) → plain nav', () => {
    expect(navigateFrom(null, null, mapC, true)).toBe('/map/c');
  });
});

describe('navigateFrom — in a split', () => {
  const ctxLeft = { left: mapC, right: sheetA, side: 'left' as const };
  const ctxRight = { left: mapC, right: sheetA, side: 'right' as const };

  test('plain click replaces own side', () => {
    expect(navigateFrom(ctxLeft, mapC, dmC, false)).toBe('/split/dm:c/sheet:a');
    expect(navigateFrom(ctxRight, sheetA, sheetB, false)).toBe('/split/map:c/sheet:b');
  });
  test('alt-click replaces the other side', () => {
    expect(navigateFrom(ctxLeft, mapC, sheetB, true)).toBe('/split/map:c/sheet:b');
    expect(navigateFrom(ctxRight, sheetA, dmC, true)).toBe('/split/dm:c/sheet:a');
  });
  test('plain click onto what the other side shows collapses to it', () => {
    expect(navigateFrom(ctxLeft, mapC, sheetA, false)).toBe('/sheet/a');
  });
  test('alt-click onto what the own side shows collapses to it', () => {
    expect(navigateFrom(ctxRight, sheetA, sheetA, true)).toBe('/sheet/a');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test apps/swdnd/src/lib/panels.test.ts` — FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// apps/swdnd/src/lib/panels.ts — pure panel descriptors + split navigation model.
// The whole alt-click/split rule table lives in navigateFrom; components stay dumb.

export type PanelKind = 'sheet' | 'map' | 'dm';
export interface Panel { kind: PanelKind; id: string }
export interface SplitCtx { left: Panel; right: Panel; side: 'left' | 'right' }

const KINDS: readonly string[] = ['sheet', 'map', 'dm'];

/** `kind:id` → Panel, or null on anything malformed. Ids may contain ':' but never '/'. */
export function parsePanel(s: string): Panel | null {
  const i = s.indexOf(':');
  if (i <= 0) return null;
  const kind = s.slice(0, i);
  const id = s.slice(i + 1);
  if (!KINDS.includes(kind) || !id || id.includes('/')) return null;
  return { kind: kind as PanelKind, id };
}

export const formatPanel = (p: Panel): string => `${p.kind}:${p.id}`;

/** The panel's full-screen route. */
export function panelPath(p: Panel): string {
  if (p.kind === 'sheet') return `/sheet/${p.id}`;
  if (p.kind === 'map') return `/map/${p.id}`;
  return `/dm/${p.id}`;
}

export const splitPath = (left: Panel, right: Panel): string =>
  `/split/${formatPanel(left)}/${formatPanel(right)}`;

export const samePanel = (a: Panel, b: Panel): boolean => a.kind === b.kind && a.id === b.id;

/**
 * The navigation rule table (query strings are the caller's job):
 * - full screen: alt + a known current panel → split (current left, target right); else target full screen
 * - in a split: plain replaces your own side, alt replaces the other side
 * - a move that would show the same panel on both sides collapses to it full screen
 */
export function navigateFrom(
  ctx: SplitCtx | null,
  current: Panel | null,
  target: Panel,
  alt: boolean,
): string {
  if (!ctx) {
    if (alt && current && !samePanel(current, target)) return splitPath(current, target);
    return panelPath(target);
  }
  const replaceLeft = alt ? ctx.side === 'right' : ctx.side === 'left';
  const nextLeft = replaceLeft ? target : ctx.left;
  const nextRight = replaceLeft ? ctx.right : target;
  if (samePanel(nextLeft, nextRight)) return panelPath(target);
  return splitPath(nextLeft, nextRight);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test apps/swdnd/src/lib/panels.test.ts` — all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/swdnd/src/lib/panels.ts apps/swdnd/src/lib/panels.test.ts
git commit -m "feat(swdnd): panel descriptors and split navigation model"
```

---

### Task 2: split machinery — context, PanelLink, SplitPage, route, redirect

**Files:**
- Create: `apps/swdnd/src/components/split.tsx`
- Create: `apps/swdnd/src/components/SplitPage.tsx`
- Modify: `apps/swdnd/src/layouts/SplitView.tsx`
- Modify: `apps/swdnd/src/components/RollDock.tsx`
- Modify: `apps/swdnd/src/App.tsx`

- [ ] **Step 1: `components/split.tsx` — context + PanelLink**

```tsx
// apps/swdnd/src/components/split.tsx — SplitContext + the split-aware nav link.
// Screens use PanelLink for panel-to-panel navigation and stay split-agnostic.
import { createContext, useContext, type MouseEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { navigateFrom, panelPath, type Panel, type SplitCtx } from '../lib/panels';

export const SplitContext = createContext<SplitCtx | null>(null);
export const useSplit = (): SplitCtx | null => useContext(SplitContext);

/**
 * A nav link between panel screens. Plain click follows the navigation model
 * (full-screen nav, or contained replace inside a split); alt-click opens the
 * target beside `current` / replaces the split's other side. Modified clicks
 * (ctrl/cmd/shift/middle) keep browser behavior via the real href.
 */
export function PanelLink({
  to, current, className, children, title,
}: {
  to: Panel;
  /** The panel the link lives on; enables full-screen alt-click. Omit on non-panel screens. */
  current?: Panel;
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  const ctx = useSplit();
  const navigate = useNavigate();
  const { search } = useLocation();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault(); // also stops alt-click's browser default (download) on some platforms
    navigate(navigateFrom(ctx, current ?? null, to, e.altKey) + search);
  };
  return (
    <Link to={panelPath(to) + search} className={className} title={title} onClick={onClick}>
      {children}
    </Link>
  );
}
```

- [ ] **Step 2: `components/SplitPage.tsx`**

```tsx
// apps/swdnd/src/components/SplitPage.tsx — /split/:left/:right route.
// Parses both descriptors, renders each panel under a slim chrome bar (⛶
// promotes the half to full screen), and mounts the page's single RollDock.
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { getCharacter } from '../lib/characters';
import { panelPath, parsePanel, type Panel } from '../lib/panels';
import SplitView from '../layouts/SplitView';
import CharacterSheet from '../panels/CharacterSheet';
import Tabletop from '../panels/Tabletop';
import DMScreen from '../panels/DMScreen';
import RollDock from './RollDock';
import { SplitContext } from './split';

function PanelBody({ panel }: { panel: Panel }) {
  if (panel.kind === 'sheet') return <CharacterSheet characterId={panel.id} />;
  if (panel.kind === 'map') return <Tabletop campaignId={panel.id} />;
  return <DMScreen campaignId={panel.id} />;
}

function Half({
  panel, other, side, search,
}: {
  panel: Panel | null;
  other: Panel | null;
  side: 'left' | 'right';
  search: string;
}) {
  if (!panel) {
    return (
      <div className="p-6 font-mono text-[11px] text-ht-muted">
        Unknown panel — expected <code>sheet:&lt;id&gt;</code>, <code>map:&lt;id&gt;</code> or{' '}
        <code>dm:&lt;id&gt;</code>. <Link className="ht-step" to="/">home</Link>
      </div>
    );
  }
  const ctx = other
    ? { left: side === 'left' ? panel : other, right: side === 'left' ? other : panel, side }
    : null;
  return (
    <SplitContext.Provider value={ctx}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-ht-line px-2 py-0.5 font-mono text-[10px] text-ht-muted">
          <span>{panel.kind}</span>
          <Link
            className="ht-step ml-auto"
            title="expand this panel"
            to={panelPath(panel) + search}
          >
            ⛶
          </Link>
        </div>
        <div className="@container min-h-0 flex-1 overflow-auto">
          <PanelBody panel={panel} />
        </div>
      </div>
    </SplitContext.Provider>
  );
}

export default function SplitPage() {
  const { left = '', right = '' } = useParams();
  const { search } = useLocation();
  const l = parsePanel(left);
  const r = parsePanel(right);

  // The page's single RollDock: first map/dm campaign id (left first), else
  // resolve a sheet panel's campaign with a one-shot fetch.
  const direct = [l, r].find((p) => p && p.kind !== 'sheet')?.id ?? null;
  const sheetId = direct ? null : ([l, r].find((p) => p?.kind === 'sheet')?.id ?? null);
  const [sheetCampaign, setSheetCampaign] = useState<string | null>(null);
  useEffect(() => {
    setSheetCampaign(null);
    if (!sheetId) return;
    let alive = true;
    getCharacter(sheetId)
      .then((c) => alive && setSheetCampaign(c.campaign_id))
      .catch(() => {});
    return () => { alive = false; };
  }, [sheetId]);
  const dockCampaign = direct ?? sheetCampaign;

  return (
    <>
      <SplitView
        left={<Half panel={l} other={r} side="left" search={search} key={left} />}
        right={<Half panel={r} other={l} side="right" search={search} key={right} />}
      />
      {dockCampaign && <RollDock campaignId={dockCampaign} />}
    </>
  );
}
```

- [ ] **Step 3: `layouts/SplitView.tsx`** — SplitPage is now the sole consumer; both halves become fixed-height columns whose scrolling the Half wrapper owns:

```tsx
import type { ReactNode } from "react";

export default function SplitView({
  left,
  right,
}: {
  left: ReactNode;
  right: ReactNode;
}) {
  return (
    <div className="grid min-h-screen grid-cols-1 divide-ht-line md:grid-cols-2 md:divide-x">
      <div className="h-screen overflow-hidden">{left}</div>
      <div className="h-screen overflow-hidden">{right}</div>
    </div>
  );
}
```

(The `@container` moves into Half's scroll div so container queries measure the panel, as before.)

- [ ] **Step 4: RollDock suppression** — a naive `if (useSplit()) return null;` before the other hooks would violate the rules-of-hooks on the suppressed path, and checking AFTER `useRollLog` would still open the duplicate websocket. So gate with a wrapper component: replace the default export with a thin wrapper and rename the existing component.

```tsx
import { useSplit } from './split';
```

Rename the existing component function to `RollDockInner` (keep its body unchanged) and add:

```tsx
export default function RollDock({ campaignId }: { campaignId: string }) {
  // Inside a split panel, the SplitPage mounts the one true dock — a
  // panel-embedded dock would double the pill and the websocket.
  if (useSplit()) return null;
  return <RollDockInner campaignId={campaignId} />;
}
```

(`useSplit()` is a hook call, but it is unconditional at the top of the wrapper — legal. `RollDockInner` mounts only outside splits, so its `useRollLog` socket never opens for suppressed docks. SplitPage's own dock mounts OUTSIDE any provider, so its context is null and it renders.)

- [ ] **Step 5: App.tsx** — add the route and turn PlayPage into a redirect. Add imports:

```tsx
import { Navigate, useLocation } from "react-router-dom"; // merge into the existing react-router-dom import
import SplitPage from "./components/SplitPage";
import { splitPath } from "./lib/panels";
```

Replace `PlayPage` with:

```tsx
function PlayPage() {
  const { characterId = "" } = useParams();
  const { search } = useLocation();
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    getCharacter(characterId)
      .then((c) => alive && setCampaignId(c.campaign_id))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [characterId]);
  if (failed) return <Navigate replace to={`/sheet/${characterId}${search}`} />;
  if (!campaignId) return <SinglePanel><div className="p-6 text-zinc-500">Loading…</div></SinglePanel>;
  return (
    <Navigate
      replace
      to={splitPath({ kind: "sheet", id: characterId }, { kind: "map", id: campaignId }) + search}
    />
  );
}
```

Add the route (next to `/play`):

```tsx
          <Route path="/split/:left/:right" element={<SplitPage />} />
```

`SplitView` import in App.tsx becomes unused — remove it (tsc will insist).

- [ ] **Step 6: Build**

Run: `cd apps/swdnd && bun run build` — clean.

- [ ] **Step 7: Commit**

```bash
git add apps/swdnd/src/components/split.tsx apps/swdnd/src/components/SplitPage.tsx apps/swdnd/src/layouts/SplitView.tsx apps/swdnd/src/components/RollDock.tsx apps/swdnd/src/App.tsx
git commit -m "feat(swdnd): /split route, SplitContext + PanelLink, /play redirect"
```

---

### Task 3: cross-links on every screen

**Files:**
- Modify: `apps/swdnd/src/hooks/useTabletop.ts`
- Modify: `apps/swdnd/src/panels/Tabletop/index.tsx`
- Modify: `apps/swdnd/src/panels/Tabletop/TokenEditor.tsx`
- Modify: `apps/swdnd/src/panels/CharacterSheet/Sheet/CoreBar.tsx`
- Modify: `apps/swdnd/src/panels/CharacterSheet/Sheet/index.tsx`
- Modify: `apps/swdnd/src/panels/DMScreen/index.tsx`
- Modify: `apps/swdnd/src/panels/DMScreen/AdminDrawer.tsx`
- Modify: `apps/swdnd/src/panels/DmHome/index.tsx`

- [ ] **Step 1: `useTabletop` exposes own characters with names.** In the interface add `ownCharacters: { id: string; name: string }[];` (next to `ownCharacterIds`). Add state:

```ts
  const [ownCharacters, setOwnCharacters] = useState<{ id: string; name: string }[]>([]);
```

Replace the players/me effect body (`hooks/useTabletop.ts:135-142`):

```ts
  // Which characters belong to this player link (players/me), for canMove and sheet links.
  useEffect(() => {
    if (!playerToken) return;
    import('../lib/characters').then(({ getPlayerByToken }) =>
      getPlayerByToken(playerToken)
        .then((me) => {
          setOwnCharacterIds(new Set(me.characters.map((c) => c.id)));
          setOwnCharacters(me.characters.map((c) => ({ id: c.id, name: c.name })));
        })
        .catch(() => {
          setOwnCharacterIds(new Set());
          setOwnCharacters([]);
        }),
    );
  }, [playerToken]);
```

And add `ownCharacters,` to the returned object (next to `ownCharacterIds`).

- [ ] **Step 2: Map toolbar links** (`panels/Tabletop/index.tsx`). Imports:

```tsx
import { PanelLink } from '../../components/split';
```

Inside the toolbar `ht-glow` bar, directly after the scene-info span (`… tokens</span>` closing `)}`), add — players get their sheet button(s), the DM gets a dm-screen button:

```tsx
        {!t.isDm && t.ownCharacters.map((c) => (
          <PanelLink
            key={c.id}
            to={{ kind: 'sheet', id: c.id }}
            current={{ kind: 'map', id: campaignId }}
            className="ht-step"
            title={`open ${c.name}'s sheet (alt-click: beside the map)`}
          >
            ▤ {c.name}
          </PanelLink>
        ))}
        {t.isDm && (
          <PanelLink
            to={{ kind: 'dm', id: campaignId }}
            current={{ kind: 'map', id: campaignId }}
            className="ht-step"
            title="open the DM screen (alt-click: beside the map)"
          >
            ⌘ dm
          </PanelLink>
        )}
```

Pass the campaign to the token editor: in the existing `<TokenEditor` element, add one prop line `campaignId={campaignId}` right after `token={selected}` — every other prop stays exactly as it is.

- [ ] **Step 3: TokenEditor sheet link** (`panels/Tabletop/TokenEditor.tsx`). Imports:

```tsx
import { PanelLink } from '../../components/split';
```

Props gain `campaignId: string;` (destructure it). In the `isCharacter` branch, replace:

```tsx
        <span className="text-[10px] text-ht-muted">hp &amp; conditions come from the character sheet</span>
```

with:

```tsx
        <span className="flex items-center gap-2 text-[10px] text-ht-muted">
          hp &amp; conditions come from the character sheet
          <PanelLink
            to={{ kind: 'sheet', id: token.character_id! }}
            current={{ kind: 'map', id: campaignId }}
            className="ht-step"
            title="open sheet (alt-click: beside the map)"
          >
            ▤ sheet
          </PanelLink>
        </span>
```

(`token.character_id!` is safe — `isCharacter` is `!!token.character_id`.)

- [ ] **Step 4: Sheet header map link.** `panels/CharacterSheet/Sheet/index.tsx`: pass the campaign to CoreBar:

```tsx
      <CoreBar characterId={characterId} campaignId={s.dto?.campaign_id ?? null} build={s.build} … />
```

`CoreBar.tsx`: props gain `campaignId: string | null;`; import `{ PanelLink }` from `'../../../components/split'`; below the `✎ Edit / Level up ▸` Link (same `min-w-[120px]` div), add:

```tsx
        {campaignId && (
          <PanelLink
            to={{ kind: 'map', id: campaignId }}
            current={{ kind: 'sheet', id: characterId }}
            className="ht-label block"
            title="open the campaign map (alt-click: beside the sheet)"
          >
            ⬡ Map ▸
          </PanelLink>
        )}
```

- [ ] **Step 5: DM screen header** (`panels/DMScreen/index.tsx`). Import `{ PanelLink }` from `'../../components/split'`. Replace the header map link:

```tsx
          <PanelLink to={{ kind: 'map', id: campaignId }} current={{ kind: 'dm', id: campaignId }} className="ht-step">map</PanelLink>
```

(`campaigns` and `admin` stay as they are — non-panel destinations.)

- [ ] **Step 6: AdminDrawer** (`panels/DMScreen/AdminDrawer.tsx`). Import `{ PanelLink }` from `'../../components/split'`. Replace `open map`:

```tsx
          <PanelLink to={{ kind: 'map', id: campaignId }} current={{ kind: 'dm', id: campaignId }} className="ht-step mt-2 inline-block text-[11px]">open map</PanelLink>
```

and the roster sheet link:

```tsx
                <PanelLink to={{ kind: 'sheet', id: c.id }} current={{ kind: 'dm', id: campaignId }} className="ht-step ml-auto">sheet</PanelLink>
```

Remove the now-unused `Link` import if nothing else uses it (nothing does).

- [ ] **Step 7: DmHome rows** (`panels/DmHome/index.tsx`). Import `{ PanelLink }` from `'../../components/split'`. Replace the two row links — DmHome isn't a panel screen, so each link's `current` is the row's *other* panel, making alt-click open the dm+map pair:

```tsx
                <PanelLink to={{ kind: 'dm', id: c.id }} current={{ kind: 'map', id: c.id }} className="ht-step" title="alt-click: dm screen + map">dm screen</PanelLink>
                <PanelLink to={{ kind: 'map', id: c.id }} current={{ kind: 'dm', id: c.id }} className="ht-step" title="alt-click: map + dm screen">map</PanelLink>
```

Remove the now-unused `Link` import.

- [ ] **Step 8: Build + scoped tests**

Run: `cd apps/swdnd && bun run build` — clean. `bun test apps/swdnd/src/lib/` — green.

- [ ] **Step 9: Commit**

```bash
git add apps/swdnd/src/hooks/useTabletop.ts apps/swdnd/src/panels/Tabletop/index.tsx apps/swdnd/src/panels/Tabletop/TokenEditor.tsx apps/swdnd/src/panels/CharacterSheet/Sheet/CoreBar.tsx apps/swdnd/src/panels/CharacterSheet/Sheet/index.tsx apps/swdnd/src/panels/DMScreen/index.tsx apps/swdnd/src/panels/DMScreen/AdminDrawer.tsx apps/swdnd/src/panels/DmHome/index.tsx
git commit -m "feat(swdnd): panel cross-links — sheet↔map, map→dm, alt-capable everywhere"
```

---

### Task 4: full verification + live walkthrough

**Files:**
- Modify (temporarily): `.claude/launch.json` — MUST be reverted afterwards
- Modify: vault docs in `/Users/asherc/Documents/Mount Tantiss/ashercarlow.com/swdnd/`

- [ ] **Step 1:** `bun test` (repo root — wipes dev swdnd campaign state, recreated below) → all pass; `cd apps/swdnd && bun run build` → clean.

- [ ] **Step 2:** Auth-enforced servers: edit `.claude/launch.json` backend to `"runtimeExecutable": "sh", "runtimeArgs": ["-c", "ASHERCARLOW_AUTH_TOKEN=dm-secret bun start"]`, restart via preview tools; recreate data via curl (campaign, player + token, character owned by the player, active scene with image, one NPC token); DM login via `fetch('/auth/login', {credentials:'include', …})`.

Browser-automation reminders: alt-click = dispatch a click with `altKey: true` via `el.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, altKey: true, button: 0}))`; React inputs need the native value setter + `input` event; synthetic pointerdown/pointerup need a `setTimeout` between them; DOM `.click()` over ref-clicks; `credentials:'omit'` for anon API checks.

- [ ] **Step 3: Walkthrough checklist**

DM (tab-1):
- `/map/<cid>` → toolbar shows `⌘ dm`; **alt-click** it → URL becomes `/split/map:<cid>/dm:<cid>`, map left + DM screen right, chrome bars with ⛶, exactly ONE RollDock pill.
- In the right (dm) panel, **plain-click** its `map` header link → right panel becomes the map… both sides now `map:<cid>` → **collapses** to `/map/<cid>` full screen.
- Rebuild the split; in the left (map) panel alt-click `⌘ dm` → replaces the RIGHT panel (no-op here since right is already dm — collapse check: alt from map onto dm when right IS dm → stays split? No: alt replaces other side with dm; other side already dm → pair (map, dm) unchanged → same URL, no collapse. Verify no navigation glitch).
- Tap a character token → editor shows `▤ sheet`; **alt-click** → sheet replaces the other panel → `/split/map:<cid>/sheet:<chid>`.
- ⛶ on the sheet half → `/sheet/<chid>` full screen.
- DM screen roster: alt-click a roster `sheet` link from full-screen `/dm/<cid>` → `/split/dm:<cid>/sheet:<chid>`.
- DmHome: alt-click a row's `map` → `/split/dm:<id>/map:<id>`.

Player (tab-2, logged out admin cookie for true player view; re-login tab-1 after):
- Invite-style `/play/<chid>?token=…` → **redirects** to `/split/sheet:<chid>/map:<cid>?token=…` — sheet + map, token intact (verify sheet editable, own token draggable).
- Map toolbar shows `▤ <name>`; plain-click inside the map half replaces that half with the sheet → both sides sheet → collapse behavior per rules (left was sheet already in this layout — verify the exact transition matches `navigateFrom`).
- Sheet header `⬡ Map ▸` present; alt-click from full-screen sheet opens the split.
- Rolls: sheet roll inside a split still broadcasts; only one dock pill.
- Narrow window (`resize_window` mobile preset) → halves stack.
- `/split/junk/map:<cid>` → left half shows the unknown-panel placeholder, right half renders the map.

- [ ] **Step 4: REVERT `.claude/launch.json`**, restart backend in dev mode.

- [ ] **Step 5: Vault docs** — `Architecture.md` or `Roadmap.md`: add the split-view line (route, alt-click model, /play redirect); `Features/Tabletop & Map.md`: replace the `/play` split-view mention with the generalized system + new cross-links; `Features/DM Screen.md`: note the header/drawer links are split-capable.

- [ ] **Step 6:** finishing-a-development-branch → 4-option menu (on "2": push + PR).
