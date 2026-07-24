# swdnd: full-height layouts + roll-table formatting

Branch `swdnd-full-height` (off `swdnd-split-view`). Two user asks:

> Round 2 (from the vault TODO doc, all in this PR): clickable dice rolls,
> warning colors, button tooltips, AoE template editing, right-click
> conditions. See "Round 2" section below.

1. Content should use the full viewport height — most visible in the builder,
   where the step list scroll area stops at `max-h-[60vh]`.
2. Background descriptions render Foundry roll tables as run-together text
   (`[[/r d6 # Bond]]Bond`, `1My family…`). Parse them into "Roll d6 — Bond"
   plus a numbered list, in `cleanRichText` so every roll table benefits.

## Plan

- [x] richText: format `<table>` blocks — roll-header tables become
      `Roll dN — Label` + `1. option` lines; generic tables get ` · ` cell
      separators; inline `[[/r dN # X]]` codes cleaned. Tests first.
- [x] SinglePanel: `min-h-screen` → `h-dvh overflow-y-auto` so panels get a
      definite height context (mirrors SplitPage's Half pane).
- [x] MapPage inner wrapper `h-screen` → `h-full`.
- [x] Builder: root `h-full` flex column; header/error `shrink-0`; steps row
      `flex-1 min-h-0`; content wrapper flex column + `overflow-y-auto`
      (fallback scroll for non-table steps).
- [x] StepTable: root `flex-1 min-h-0`; scroll area `max-h-[60vh]` →
      `flex-1 min-h-0`. Intermediate wrappers in Class (add/arch pickers) and
      Powers get `flex-1 min-h-0`. StepRail nav `shrink-0`.
- [x] DMScreen: root `h-full` flex column; content row `flex-1 min-h-0`,
      page-style scroll below 700px, per-column scroll above. PartyRail aside
      becomes its own scroll column at ≥860px.
- [x] MonsterBrowser/Reference lists: px caps only in stacked (<700px) layout,
      `flex-1 min-h-0` fill at ≥700px; statblock pane scrolls independently.
- [x] Verify in browser: single builder, split DM+map, DM screen tabs, mobile
      widths, backgrounds detail formatting. bun tests (247 pass) + tsc clean.
- [x] Commit, push, PR against swdnd-split-view.

## Review

Verified in the dev preview (backend + vite, real sqlite data):

- Builder species list: page no longer scrolls; the list alone scrolls
  (832px visible of 4297px content on a 964px viewport). Mobile keeps the
  pinned header + horizontal step strip with the list filling the rest.
- Background detail: `Roll d8 — Feat` / `Roll d6 — Bond` headers with `1.`–`8.`
  numbered options replace the run-together table text.
- DM screen at 1280px: monster list 617px tall (was 420), statblock scrolls
  independently (1323px content in a 641px pane); reference powers list fills
  616px (was 440). Mobile (375px) unchanged: stacked, page-style scroll.
- Split view 1600px (798px panes, the 700–860 band): initially still capped at
  420px with dead space — moved the height-fill breakpoint from @[860px] to
  @[700px] so panes fill too; re-verified.
- The 60vh/420px/440px caps survive only in <700px stacked layouts where the
  height chain is unbounded and page scrolling is the right behavior.

## Round 2

- [x] Warning colors: point-buy budget warning text yellow when out of range
      or over budget (error banners already red).
- [x] Clickable dice: RollTriggerProvider where RollDock mounts; RollableText
      renders `Roll dN — Label` headers, `roll dN (Label)` codes and `NdM±k`
      expressions as buttons that post to the campaign roll log (hidden when
      DM), with the result shown inline. Wired into StepTable detail,
      Statblock (traits/actions + HP formula), Reference lookups.
      lib/diceText matcher + tests.
- [x] AoE editing: backend PATCH /swdnd/templates/{id} (q/r/q2/r2/dir/color) +
      template:updated WS + mapState case + route test. Canvas: dragging the
      origin handle moves the template (lines translate both ends, optimistic
      with echo reconcile); tap opens an editor bar (6 color swatches, delete)
      replacing the old insta-delete tap.
- [x] Right-click conditions: DM-only context menu on tokens — SW5E condition
      toggles for NPC tokens, "set from the character sheet" hint for
      character tokens; right-click never pans (button-2 guard).
- [x] Tooltips: descriptive title= on map tools, fog controls, grid/init/tpl/
      scenes, initiative strip, RollDock (pill, adv/dis, secret), DM admin,
      StepTable sort headers, template editor.
- [x] Drive-by fix: `bun test` wiped data/swdnd.sqlite (route tests DELETE
      whole tables against the default DB path). Tests now default to a
      temp-dir DB under NODE_ENV=test; explicit SWDND_DB_PATH still wins.
- [x] Verify all in browser, run tests + tsc, update PR.

### Round 2 review

Verified in the dev preview (admin session + player-token contexts):

- Builder background detail: "Roll d8 — Feat" click → inline "= 6" and a
  campaign-log entry `Asher: 1d8=6 (Feat)`; counter test confirmed exactly
  one roll per click.
- DM statblock (AT-AT): 6 clickable dice (20d20+120 HP, 12d8/12d12 damage);
  DM click logged as `DM: 20d20+120=329 hidden=1` — shared-unless-DM ✓.
- Map: handle drag moved the blast template (preview tracked the pointer,
  PATCH persisted q0,r0→q3,r4); tap opened the editor; recolor persisted
  (#5dd39e); right-click on Raider toggled Stunned (ring rendered), Hero
  showed the sheet hint. Backdrop click closes the menu.
- Found + fixed while testing: setPointerCapture throws InvalidPointerId on
  synthetic/stale pointers and aborted the whole pointerdown handler — now
  try/caught (capture is a nicety).
- 251 frontend + 78 backend tests pass, tsc clean both apps; dev DB survives
  test runs after the isolation fix.

Note: the pre-fix test run had already wiped the local dev campaigns
(Hero/Lyra) — unrecoverable; a fresh "Verify" campaign was created for
testing. Flagged to Asher in the session.
