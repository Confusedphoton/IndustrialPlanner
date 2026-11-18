# Review blocker ledger

Every blocking review finding is classified here. A class with 3 or more instances that is still `open` is **recurring**: stop point-fixing it and propose a systematic prevention. A new instance of a class whose prevention has landed is a gap in that prevention; fix the prevention itself.

## Classes

| ID | Class | Count | Status | Prevention |
|----|-------|-------|--------|------------|
| UI-TARGET | Pen hit targets below ~36px (buttons, expanders, resize handles) | 7 | gap — component CSS / grid tracks override the global min-size rule and controls overlap; previously: global min-size rule for button/select/tab with explicit `data-pen-target="compact"` opt-out; e2e hit-area sweep (src/tests/e2e/pen-target-sizes.test.ts) | Pen-sized controls: in-canvas rail 44px, overlay/graph toolbars 36px, tree expanders 30px, resize grips ≥14px hit area |
| UI-REACH | Frequent tools buried, scrolled away, or far from the pen | 11 | prevention in progress | Persistent canvas tool rail (`canvas-tool-rail.tsx`) holds editing tools, undo/redo and Quick Place |
| UI-SPACE | Docks/panels starve the canvas or waste space | 11 | recurring — prevention gap: budget must enforce the total-width invariant (stack right docks) | `resolveDockLayoutBudget` reserves a minimum canvas width for every dock combination |
| GRAPH-LAYOUT | Flow graph layout unreadable: orientation, overlap, clipped labels | 13 | recurring — systematic fix: camera refit on orientation change, toolbar outside content, global label collision pass | Orientation-aware layout, `minNodeBreadth` collision spacing, sink-anchored fit, edge labels placed in layer gaps |
| GRAPH-DATA | Flow graph shows misleading numbers | 2 | prevented | Regression test: target node rate equals the target production rate |
| GRAPH-INPUT | Graph gestures misbehave (pinch coordinates, accidental node moves) | 8 | recurring — gesture state machine tests must cover pinch exit and both callers | Container-local pinch math; tap-slop threshold before node moves; pan-mode for reference graphs |
| UI-LEGIBILITY | Information needed for a decision is the least legible element | 9 | prevention in progress | Recipe tiles show inputs → output and a "from X" line; graph cards show machine icon + count persistently |
| GRAPH-PERFORMANCE | Graph camera updates churn observers or persistence | 1 | prevention in progress | Stable callbacks via refs; camera persistence coalesced until the gesture settles |
| OVERLAY-BOUNDS | Popups/menus positioned from assumed sizes and clipped by the viewport | 6 | prevention in progress | Measure rendered size, choose the side with room, clamp both axes, bounded internal scroll |
| PEN-PARITY | Core canvas flows need keyboard, wheel, mouse modifiers or fingers | 6 | prevention in progress | Every canvas action reachable by pen tap/drag alone; on-screen zoom/fit |
| I18N-CANVAS | Canvas-drawn text bypasses i18n | 1 | prevention in progress | Decorations receive translated strings |
| STALE-ACTION | Contextual menus keep acting on the state from when they opened | 2 | fixed r10 (node identity preserved) | Menus derive details and actions from live state after edits |
| AMBIGUOUS-ICON | Two different actions share a glyph | 1 | fixed r9 | Distinct glyphs for distinct actions |
| FIRST-VIEW | Initial camera ignores the base | 2 | fixed r9 | Unsaved viewports centre on the document content (protocol core) |
| UI-KEYBOARD | Controls only respond to pointer events | 1 | prevention in progress | Keyboard clicks (detail 0) route through the same action as pointer taps |

## Instances

| Round | Finding | Class | Priority | Location | Status |
|-------|---------|-------|----------|----------|--------|
| 0 | Item-mode subtitle showed max(output, summed input) rate (30/min target shown as 750/min) | GRAPH-DATA | P1 | flow-graph-builder.ts | fixed r1 |
| 0 | Graph always left→right; tall dock shows ~2 of 8 columns, target off-screen | GRAPH-LAYOUT | P1 | production-flow-graph.tsx | fixed r1 |
| 0 | Cards overlap (28px layout breadth vs 64px cards) | GRAPH-LAYOUT | P1 | sankey-layout.ts | fixed r1 |
| 0 | Widening the recipe dock can leave the canvas 37px wide | UI-SPACE | P1 | recipe-tree-state.ts, workbench-app.tsx | fixed r1 |
| 0 | Editing tools scroll out of reach in the placement panel | UI-REACH | P2 | placement-panel.tsx | fixed r1 |
| 0 | Undo/redo only in the History panel | UI-REACH | P2 | history-panel.tsx | fixed r1 |
| 0 | 24px overlay buttons, 18px expanders, 8px dock handle, 31.5px compact rail | UI-TARGET | P2 | recipe-tree.module.scss, layout.module.scss | fixed r1 |
| 0 | Pinch zoom uses viewport client coordinates | GRAPH-INPUT | P2 | production-flow-graph.tsx | fixed r1 |
| 0 | Pressing a card moves it immediately; browsing rearranges the graph | GRAPH-INPUT | P2 | production-flow-graph.tsx | fixed r1 |
| 0 | Card titles/subtitles ellipsized; edge labels on curved paths collide | GRAPH-LAYOUT | P2 | production-flow-graph.tsx | fixed r1 |
| 0 | Alternative recipes distinguished only by 14px icons | UI-LEGIBILITY | P2 | recipe-tile-grid.tsx | fixed r1 |
| 0 | Quick Place has no visible entry; favourites need drag-and-drop | UI-REACH | P3 | quick-place-popup.tsx | fixed r1 |
| 0 | Side panels consume substantial canvas space | UI-SPACE | P2 | workbench layout | fixed r1 (left dock 375→320, budget) |
| 0 | Graph labels unreadable when zoomed to fit | GRAPH-LAYOUT | P2 | production-flow-graph.tsx | fixed r1 |
| 2 | Orientation switch leaves all cards off-screen (camera not migrated) | GRAPH-LAYOUT | P1 | production-flow-graph.tsx:206 | fixed r2 (refit on orientation change) |
| 2 | Three docks at 1280/1180 leave 272/329px canvas, below the minimum | UI-SPACE | P1 | dock-layout-budget.ts:28 | fixed r2 (stack inspector + recipe dock; invariant test) |
| 2 | Short-landscape fit puts the target under the graph toolbar | GRAPH-LAYOUT | P1 | production-flow-graph.tsx:165 | fixed r2 (toolbar outside content; anchor on planned target; visibility test) |
| 2 | Pinch → one finger continuation jumps ~700px | GRAPH-INPUT | P2 | production-flow-graph.tsx:445 | fixed r2 (rebase pan; test for both fingers) |
| 2 | Edge-rate pills collide across target groups and feedback routes | GRAPH-LAYOUT | P2 | production-flow-graph.tsx:664 | fixed r2 (global collision pass) |
| 2 | Machine name/count ellipsized, details only on hover | UI-LEGIBILITY | P2 | production-planning-panel.module.scss:1743 | fixed r2 (machine icon + count field; details on tap) |
| 2 | Production-planning flow cards have no tap actions | GRAPH-INPUT | P2 | production-planning-panel.tsx:3206 | fixed r2 (shared RecipeActionMenu) |
| 2 | Category chips 26px, settings switches ~24px, sim buttons 30px | UI-TARGET | P2 | panels.module.scss:2354, settings-dialog.module.scss:814 | fixed r2 (--pen-target token; whole switch card tappable) |
| 2 | Panning recreates ResizeObserver and writes IndexedDB per move | GRAPH-PERFORMANCE | P2 | production-flow-graph.tsx:136 | fixed r2 (stable refs; 250ms coalesced notify; memoized surface) |
| 2 | Rail tool buttons ignore keyboard activation | UI-KEYBOARD | P2 | canvas-tool-rail.tsx:175 | fixed r2 |
| 3 | Short vertical production-planning graph fits target below the dialog (graph min-height 520) | GRAPH-LAYOUT | P1 | production-planning-panel.module.scss:1564 | fixed r3 (graph takes parent height; flow view no longer scrolls) |
| 3 | Pinch starting on a card manipulates the node instead of zooming | GRAPH-INPUT | P2 | production-flow-graph.tsx:340 | fixed r3 (shared promotion of node press to pinch; tests for card starts) |
| 3 | Persisted rail center not clamped after resize; Quick Place off-screen | UI-REACH | P2 | canvas.module.scss:771 | fixed r3 (CSS clamp by measured rail height) |
| 3 | Action menu placement assumes 260px height; clipped in short windows | OVERLAY-BOUNDS | P2 | recipe-action-menu.tsx:100 | fixed r3 (measure, choose side, clamp, internal scroll; tests) |
| 3 | Equal-height stacking leaves the graph ~117px; empty inspector takes half | UI-SPACE | P2 | workbench-app.module.scss:35 | fixed r3 (adjustable split, default 60% graph; empty inspector collapses to header) |
| 3 | Rail grip 44×22, dialog buttons 30px, help buttons 22px | UI-TARGET | P2 | canvas.module.scss:807, settings-dialog.module.scss:63 | fixed r3 (--pen-target on grip, dialog buttons, contextual canvas toolbars; help button hit area) |
| 4 | Splitter allows a 116px Recipe Tree pane; graph fully hidden | UI-SPACE | P1 | recipe-tree-state.ts:100 | fixed r4 (height-aware split limits; single-pane mode with tappable headers; tests) |
| 4 | Fit has no whole-chain overview; 2 of 22 nodes visible in stacked view | GRAPH-LAYOUT | P2 | production-flow-graph.tsx:163 | fixed r4 (separate Overview / Focus target; tap background in overview to zoom there) |
| 4 | Placement mode selectors 34×24; splitter 12px, hover-only affordance | UI-TARGET | P2 | panels.module.scss:2436, recipe-tree.module.scss:584 | fixed r4 (variant trigger 34×28 + expanded hit area; visible splitter/dock grips, 18px strip) |
| 4 | Totals names/fractional counts only in hover tooltips | UI-LEGIBILITY | P2 | recipe-tree-overlay.tsx:713 | fixed r4 (chips are buttons; tap expands named list with exact values) |
| 4 | Open action menu keeps stale bounds after resize | OVERLAY-BOUNDS | P2 | recipe-action-menu.tsx:99 | fixed r4 (menu closes on resize; lifecycle test) |
| 4 | Placement labels break mid-word ("Purificatio / n Node") | UI-LEGIBILITY | P3 | panels.module.scss:2376 | fixed r4 (word-aware wrapping with hyphenation; html lang follows locale) |
| 5 | Pinch completion below readable scale is treated as a background tap → zoom jumps to 100% | GRAPH-INPUT | P2 | production-flow-graph.tsx:481 | fixed r5 (pinch participants never count as taps; test both lift orders) |
| 5 | Bottom-docked Timeline/Toolbox squeezes the stacked inspector below 180px | UI-SPACE | P2 | workbench-app.tsx:765 | fixed r5 (budget excludes bottom-dock row; recipe spans it; test) |
| 5 | Overview fits the initial layout (moved cards excluded) and is floored at 15% | GRAPH-LAYOUT | P2 | production-flow-graph.tsx:167 | fixed r5 (fit current geometry; zoom floor 0.05; moved-card overview test) |
| 5 | Expanded totals become a 37–88px scrolling slot; Collapse scrolls away | UI-LEGIBILITY | P2 | recipe-tree.module.scss:632 | fixed r5 (expanded totals replace the graph; sticky collapse) |
| 5 | View buttons on a collapsed Recipe Tree don't reveal it; no keyboard expand control | UI-REACH | P2 | recipe-tree-overlay.tsx:260 | fixed r5 (Tree/Flow expand the pane; keyboard expand buttons on both panes) |
| 5 | Totals buttons 32px, no expanded hit area | UI-TARGET | P3 | recipe-tree.module.scss:615 | fixed r5 (totals buttons use --pen-target) |
| 6 | Floating Recipe Tree not re-clamped on window resize; controls off-screen | OVERLAY-BOUNDS | P2 | recipe-tree-overlay.tsx:100 | fixed r6 (overlay reads observable viewport size; re-clamped every resize) |
| 6 | Hiding the graph for totals refits it; camera lost on return | GRAPH-LAYOUT | P2 | production-flow-graph.tsx:239 | fixed r6 (no fit while hidden or on reveal once fitted; camera test) |
| 6 | Splitter maps pointer with full column height, ignoring the bottom-dock row; drag lags the pen | UI-SPACE | P2 | recipe-tree-overlay.tsx:201 | fixed r6 (shared inverse mapping over fractional rows, grab offset, same clamp; test) |
| 6 | In overview, tapping a microscopic card opens actions instead of zooming | GRAPH-INPUT | P2 | production-flow-graph.tsx:494 | fixed r6 (below readable scale any tap zooms there first; test) |
| 7 | Rail overflows in short layouts; hidden tools unreachable by pen | UI-REACH | P2 | canvas.module.scss:783 | fixed r7 (rail wraps into columns; rotate view moved in; reachability check) |
| 7 | Resize while graph hidden → stale orientation/camera on reveal | GRAPH-LAYOUT | P2 | production-flow-graph.tsx:250 | fixed r7 (refit on reveal when size changed while hidden) |
| 7 | Collapsed Recipe Tree keeps bottom-dock height as blank space | UI-SPACE | P2 | workbench-app.module.scss:65 | fixed r7 (collapsed recipe header at column top; inspector spans bottom-dock row) |
| 7 | Splitter overshoot leaves reversal dead travel | UI-SPACE | P3 | recipe-tree-overlay.tsx:225 | fixed r7 (grab offset rebased at limits) |
| 7F | Continuous placement ignores pen taps | PEN-PARITY | P1 | hypergryph-single-placement-gesture-module.ts:659 | fixed r7 (taps honour continuous toggle; test) |
| 7F | Pen drag in belt/pipe tool pans instead of drawing; priority keyboard-only | PEN-PARITY | P1 | hypergryph-logistics-placement-gesture-module.ts:375 | fixed r7 (drag-to-draw from valid start; Priority/Cancel on rail; tests) |
| 7F | No on-screen canvas zoom / fit / recenter | PEN-PARITY | P2 | bottom-status-bar.tsx:162 | fixed r7 (rail zoom out / in / show whole base; tests) |
| 7F | Opening the inspector hides the selected device | UI-SPACE | P2 | workbench-app.tsx:745 | fixed r7 (keepEntityInView after right dock opens) |
| 7F | Pen-target token not applied to Toolbox/Help/Base/planner/popup controls | UI-TARGET | P2 | dialogs.module.scss:324 etc. | fixed r7 (global --pen-target min size + compact opt-out; e2e sweep test added) |
| 7F | Graph barely usable in small containers (chrome-heavy, 1–2 cards visible) | GRAPH-LAYOUT | P2 | recipe-tree-overlay.tsx:281 | fixed r7 (auto Overview when <30% visible; compact cards; one-line totals) |
| 7F | Planner first view hides the target (no initial fit) | GRAPH-LAYOUT | P2 | production-planning-panel.tsx:3216 | fixed r7 (fit on first open / new plan) |
| 7F | Floating Recipe Tree opens over the inspector | UI-SPACE | P2 | recipe-tree-overlay.tsx:850 | fixed r7 (first position beside the inspector) |
| 7F | Quick Place / device popup cover the rail | OVERLAY-BOUNDS | P2 | quick-place-popup.tsx:638 | fixed r7 (avoidCanvasToolRail for Quick Place and device popup) |
| 7F | Device popup recipe list cramped (single column, nested scroll) | UI-SPACE | P2 | canvas.module.scss:1051 | fixed r7 (popup widens to 540px, multi-column recipes, no nested scroll) |
| 7F | Canvas text hardcoded Chinese | I18N-CANVAS | P2 | MarqueeCanvasDecoration.ts:57 etc. | fixed r7 (canvas.modeLabel.* keys; placement reasons store i18n keys) |
| 7F | Graph wheel preventDefault on passive listener | GRAPH-INPUT | P2 | production-flow-graph.tsx:304 | fixed r7 (native non-passive wheel listener) |
| 7F | Recipe Tree pinning needs keyboard; graph read-only; inapplicable menu rows | UI-REACH | P2 | recipe-tree-overlay.tsx:452 | partially r7 (item picker button; inapplicable rows hidden; rate/recipe editing from graph not yet) |
| 7F | Palette never yields on narrow windows with a right dock | UI-SPACE | P2 | dock-layout-budget.ts:27 | deferred (canvas already ≥ 360px; auto-closing a user-opened panel judged worse) |
| 7F | Escape closes node menu and the Toolbox dialog together | UI-KEYBOARD | P3 | recipe-action-menu.tsx:72 | fixed r7 (capture-phase Escape) |
| 7F | Visual: raw entity id, mixed icon styles, mode banners, duplicate totals, dark off-switch | UI-LEGIBILITY | P3 | various | partially r7 (debug-only entity id, dark switch contrast, chip fade, merged totals) |
| 8 | Inspector-open nudge pans the device under the rail (prediction ignores stacking; keep-in-view ignores rail band) | UI-SPACE | P1 | action-impl.ts:596 | fixed r8 (keep-in-view after layout settles, from the workbench; avoids the rail band) |
| 8 | Placement Cancel/Rotate toolbar follows the hovering pen; Rotate missing from the rail | PEN-PARITY | P1 | canvas-tool-rail.tsx:273 | fixed r8 (Rotate/Cancel on the rail in placement; floating toolbar freezes near the pen; tests) |
| 8 | Rail rearranges when contextual buttons appear | UI-REACH | P2 | canvas-tool-rail.tsx:273 | fixed r8 (contextual buttons in an attached side group; rail never moves) |
| 8 | Show Whole Base floored at 50% zoom; base not fully shown in short windows | PEN-PARITY | P2 | viewport-settings.ts:12 | fixed r8 (whole-base fit can go below 0.5 into the rail-free area; persisted zoom keeps it) |
| 8 | Component CSS beats the global pen-target rule (planner view buttons 30px, compact dialog tabs) | UI-TARGET | P2 | production-planning-panel.module.scss:194 | fixed r8 (segmented 36px; compact dialog tabs 36px; dialog header buttons) |
| 8 | Base supply toggle overlaps Delete (24px grid tracks) | UI-TARGET | P2 | panels.module.scss:1012 | fixed r8 (pen-sized grid tracks, 6px gap) |
| 8 | Compact graph rates overflow cards and collide with neighbours | GRAPH-LAYOUT | P2 | production-planning-panel.module.scss:1858 | fixed r8 (number-only compact rate, bounded size, overflow clipped) |
| 8 | Overview tap zooms around the tap point; target lands half off-screen | GRAPH-INPUT | P2 | production-flow-graph.tsx | fixed r8 (tapped card centred at 0.85; test) |
| 8 | Keyboard hint legend covers the pen's work area | UI-SPACE | P2 | canvas-right-dock-toolbar.tsx | fixed r8 (shortcut legends hidden after pen/touch input) |
| 8 | Device choice requires a trip to the palette | UI-REACH | P2 | quick-place-popup.tsx | open (Quick Place on the rail is the near-pen picker; recent-devices strip not done) |
| 8 | Expanded device popup covers the rail | OVERLAY-BOUNDS | P2 | device-popup.tsx:85 | fixed r8 (width capped to rail-free space) |
| 8 | Wrapped rail covers much of a short canvas | UI-SPACE | P2 | canvas-tool-rail.tsx:406 | fixed r8 (primary group + More flyout; attached contextual group) |
| 8 | Recipe Tree graph: no direct rate/recipe editing | UI-REACH | P2 | recipe-action-menu.tsx | fixed r8 (rate stepper + recipe choices in the node menu) |
| 8 | Device popup has no Rotate | UI-REACH | P3 | device-popup.tsx | deferred (needs an in-place rotate editor operation) |
| 8 | Quick Place / floating Recipe Tree overlap the status bar | OVERLAY-BOUNDS | P3 | quick-place-popup.tsx, recipe-tree-overlay.tsx | fixed r8 (status-bar clearance) |
| 8 | avoidCanvasToolRail queries the DOM during render | GRAPH-PERFORMANCE | P3 | canvas-tool-rail-bounds.ts:18 | fixed r8 (rail rect from published observables) |
| 8 | AI-DIAG timing counters + console.debug left in single placement module | UI-LEGIBILITY | P3 | hypergryph-single-placement-gesture-module.ts:139 | fixed r8 (diagnostics removed) |
| 9 | Recipe change in node menu leaves Place action on the old recipe; stepper leaves stale rate/count | STALE-ACTION | P1 | recipe-tree-overlay.tsx:1008, recipe-action-menu.tsx:94 | fixed r9 (menu re-resolves the live node from the current plan after every edit) |
| 9 | Expanded popup 340px floor covers the rail at the 360px minimum canvas | OVERLAY-BOUNDS | P2 | device-popup.tsx:88 | fixed r9 (240px floor, width capped to rail-free space; actions wrap) |
| 9 | Recipe alternatives in the node menu all read "Refining Unit · Carbon" | UI-LEGIBILITY | P2 | recipe-tree-overlay.tsx:1069 | fixed r9 (recipe tiles show inputs/outputs) |
| 9 | Stepper/recipe edits refit the graph to overview and reset moved cards | GRAPH-LAYOUT | P2 | production-flow-graph.tsx:278 | fixed r9 (refit only when the node set changes; test) |
| 9 | Inspector stacking still pans 190px (dock-toggle viewport prediction) | UI-SPACE | P2 | action-impl.ts:587 | fixed r9 (dock-toggle viewport prediction removed; keep-in-view after layout) |
| 9 | Placement Rotate and Rotate View share an icon | AMBIGUOUS-ICON | P2 | canvas-tool-rail.tsx | fixed r9 (distinct rotate-view glyph) |
| 9 | Base resource names truncate after grid change | UI-LEGIBILITY | P3 | panels.module.scss:1012 | fixed r9 (two-line clamp) |
| 9 | New world still opens at {0,0} (default saved viewport) | FIRST-VIEW | P3 | world-document.ts:86 | fixed r9 (no default saved viewport; first view centres on content/core; test) |
| 9 | Rail jumps 180px when the palette auto-hides for placement in short windows | UI-REACH | P3 | workbench layout | resolved r9 (palette no longer auto-hides; it stays open during placement, accepted trade-off) |
| 9 | Move mode has no rail Rotate/Cancel | PEN-PARITY | P3 | canvas-tool-rail.tsx | fixed r9 (move shares placement Rotate/Cancel; tests) |
| 9 | "Pin this item" offered on already pinned item | UI-REACH | P3 | recipe-action-menu.tsx:194 | fixed r9 (Pin/Unpin by existing pin) |
| 9 | Compact overview cards have no names/units | UI-LEGIBILITY | P3 | production-flow-graph.tsx | fixed r9 (compact cards keep a name line) |
| 9 | "//Place Device" mode banner and pill duplicate the status bar | UI-LEGIBILITY | P3 | renderer decorations | fixed r9 (quiet top-centre mode label; toast moved below it) |
| 10 | Node menu overflows the viewport after a recipe edit; placement measured only once | OVERLAY-BOUNDS | P2 | recipe-action-menu.tsx:111 | fixed r10 (ResizeObserver re-clamp; status-bar clearance; actions above the editor) |
| 10 | Recipe tiles in the node menu drop the machine name | UI-LEGIBILITY | P2 | recipe-tree-overlay.tsx:1090 | fixed r10 (one-row choices: machine icon + name, inputs, duration) |
| 10 | 1024px canvas falls to 336px with the palette and a docked Recipe Tree | UI-SPACE | P2 | dock-layout-budget.ts:31 | fixed r10 (budget narrows the palette; floor 220px since r11; invariant tests at 1024) |
| 10 | Canvas mode label colours hard-coded | NEW: THEME-BYPASS | P3 | CanvasModeLabelDecoration.ts:12 | fixed r10 (text-0 fill, canvas-bg outline) |
| 10 | Wrapped Delete becomes a full-width button | NEW: DESTRUCTIVE-EMPHASIS | P3 | panels.module.scss | fixed r10 (buttons capped at half a row) |
| 10 | Quick Place Recent uses full rows | UI-SPACE | P3 | quick-place-popup.tsx:560 | fixed r10 (single strip of icon buttons) |
| 10 | First view wastes space outside the base | FIRST-VIEW | P3 | document-viewport.ts | fixed r11 (workbench fits the whole base into the rail-free canvas once it has a size; core-centring removed; test) |
| 10 | Recipe Tree dock grip overlaps pin/expander hit areas at 1024 | UI-TARGET | P3 | recipe-tree.module.scss | fixed r10 (12px gutter under the grip) |
| 10 | Plan solved twice; flow graph rebuilt per render while a menu is open; O(n·m) definition lookup | GRAPH-PERFORMANCE | P3 | recipe-tree-overlay.tsx:263,412; document-viewport.ts | fixed r10 (one lazy solve shared; memoised live target; Map lookup) |
| 10S | Duplicate-product node menu resolves to another machine's card (live lookup by item only) | STALE-ACTION | P1 | recipe-tree-overlay.tsx:962 | fixed r10 (resolve by node id; item fallback only when unique; tests) |
| 10S | Primary node actions sit below the recipe catalogue | UI-REACH | P2 | recipe-action-menu.tsx:140 | fixed r10 (actions first, editor last) |
| 10S | Machine variants indistinguishable in node-menu recipe choices | UI-LEGIBILITY | P2 | recipe-tile-grid.tsx:127 | fixed r10 (one-row machine-labelled choices) |
| 10S | Display-mode switch discards dragged card positions | GRAPH-LAYOUT | P2 | production-flow-graph.tsx:300 | fixed r10 (moved offsets kept by node id until reset, re-orientation or a new node set; test) |
| 10S | Menu grows past the viewport after choosing a recipe | OVERLAY-BOUNDS | P2 | recipe-action-menu.tsx:111 | fixed r10 (same as 10 row) |
| 10S | 240px popup floor overlaps the rail border by 3px in short layouts | OVERLAY-BOUNDS | P3 | device-popup.tsx:88 | open |
| 11S | Recipe choice acknowledged on a card it cannot affect (item-level choice vs duplicate-product card) | NEW: RECIPE-EDIT-SCOPE | P2 | recipe-tree-overlay.tsx:1043 | fixed r11 (choices only when the item has one card; "In use" marks the plan's recipe; tests) |
| 11S | Recipe rows omit quantities and differing outputs | UI-LEGIBILITY | P2 | recipe-tree-overlay.tsx:1110 | fixed r11 (amounts in inputs; outputs listed when they differ) |
| 11S | Choosing a lower recipe scrolls Place out of reach | UI-REACH | P2 | recipe-tree.module.scss:469 | fixed r11 (sticky title/details/actions head; pan-y on the menu) |
| 11 | 360px canvas floor fully covered by rail + popup at 1024 | UI-SPACE | P2 | dock-layout-budget.ts:1 | fixed r11 (canvas minimum excludes the rail band; palette floor 220px; test) |
| 11 | Tree view unreadable in a narrow dock; per-node native select | UI-LEGIBILITY | P2 | recipe-tree-overlay.tsx (tree) | fixed r11 (8px capped indent with guide lines; full names wrap; recipe chip opens the node menu; pin controls wrap) |
| 11 | Node menu fallback covers the tapped card | OVERLAY-BOUNDS | P3 | recipe-action-menu.tsx | fixed r11 (below → above → right → left before overlapping; test) |
| 11 | Mode label outline uses canvas-bg, not the painted in-canvas-bg | THEME-BYPASS | P3 | CanvasModeLabelDecoration.ts:55 | fixed r11 (in-canvas-bg outline; higher-contrast of text-0/shell-bg fill) |
| 11 | Dock grip shrank to 12px with a dead gutter | UI-TARGET | P3 | recipe-tree.module.scss:562 | fixed r11 (18px grip straddling the dock edge; gutter removed) |
| 11 | Status-bar clearance assumed 28px | OVERLAY-BOUNDS | P3 | recipe-action-menu.tsx | fixed r11 for the node menu and Quick Place (measured from the status bar element); floating Recipe Tree clamp still uses the constant |
| 11 | Recent strip icons have no visible names | UI-LEGIBILITY | P3 | quick-place-popup.tsx | fixed r11 (one-line captions) |
| 11 | Empty favourite slots dominate Quick Place | UI-SPACE | P3 | quick-place-popup.tsx | fixed r11 (slot grid hidden until the first favourite; test) |
| 11 | Auto recipe doesn't show what it resolves to; selected ≈ hover | UI-LEGIBILITY | P3 | recipe-tree.module.scss | fixed r11 ("In use" tag; accent bar for the selected choice) |
| 11 | Short-window palette pinned at 165px | UI-SPACE | P3 | state-impl.ts:66 | fixed r11 (220px) |
| 12S | Sewage (byproduct + external supply) still accepted ineffective recipe choices | RECIPE-EDIT-SCOPE | P2 | recipe-action-menu.tsx:64 | fixed r12 (choices only when the item has exactly one card, counting supply cards, and it is a normal production node; read-only "In use" row otherwise; tests) |
| 12S | Short-window panel minima defeat the usable canvas at 1024×540 | UI-SPACE | P2 | dock-layout-budget.ts:47 | fixed r12 (recipe dock may narrow to 260px once the palette is at its floor; grip hidden when it has no range; test) |
| 12S | Scrollable node menus skipped side placement | OVERLAY-BOUNDS | P3 | recipe-action-menu.tsx:304 | fixed r12 (sides tried with the capped height; test) |
| 12S | Sticky secondary actions dominate the short recipe editor | UI-SPACE | P3 | recipe-tree.module.scss:557 | fixed r12 (only title, one-line details and Place pinned; "In use" recipe scrolled into view on open) |
| 12 | First star in Quick Place moves the device list under the pen | NEW: LAYOUT-SHIFT | P2 | quick-place-popup.tsx:199 | fixed r12 (delegated; see commit) |
| 12 | Tree leaf rows render left of their parents; faint guides in dark | UI-LEGIBILITY | P2 | recipe-tree-overlay.tsx:707 | fixed r12 (delegated; see commit) |
| 12 | Recipe chips double tree-node height | UI-SPACE | P3 | recipe-tree | fixed r12 (delegated; see commit) |
| 12 | Chip text "Auto"/"2/2" meaningless without hover | UI-LEGIBILITY | P3 | recipe-tree-overlay.tsx:814 | fixed r12 (delegated; see commit) |
| 12 | Palette resize handle 10px | UI-TARGET | P3 | left-dock | fixed r12 (delegated; see commit) |
| 12 | Recipe Tree dock grip inert at 1024 (min = max) | NEW: INERT-CONTROL | P3 | recipe-tree-overlay.tsx | fixed r12 (grip hidden without a drag range) |
| 12 | Mode label redrawn every frame with blueprint/grass style | GRAPH-PERFORMANCE | P1 | CanvasModeLabelDecoration.ts:54 | fixed r12 (compare resolved colours, not theme identity) |
| 12 | Doc comments stacked above the wrong function | NEW: CODE-TIDINESS | P3 | recipe-action-menu.tsx:56 | fixed r12 |
| 12 | Overview card names unreadable (3–7px) | GRAPH-LAYOUT | P2 | production-flow-graph.tsx | fixed r12 (screen-sized ~11px name labels under compact cards, inverse-scaled rate; hidden below 0.2 scale) |
| 13 | Starting placement resizes the docks (temporary rail groups feed the budget) | NEW: LAYOUT-JUMP | P1 | workbench-app.tsx:750 | fixed r13 (budget reserves the rail's base width only) |
| 13S | Opening the inspector in a short window drops the rail-free canvas to 319px | UI-SPACE | P2 | dock-layout-budget.ts:61 | fixed r13 (stacked column and inspector may narrow to 260px once the palette is at its floor; test) |
| 13 | Overview rates shrink below readable size (2.2rem cap) | GRAPH-LAYOUT | P2 | production-planning-panel.module.scss:1890 | fixed r13 (cap raised to the card's text-area capacity) |
| 13 | Overview names truncate to ambiguous prefixes | UI-LEGIBILITY | P2 | production-flow-graph.tsx | fixed r13 (width-aware truncation keeps the last word; test) |
| 13 | "In use" recipe not scrolled into view on reopen | UI-REACH | P3 | recipe-action-menu.tsx:164 | fixed r13 (revealed after placement and height cap apply) |
| 13 | Narrow tree docks show 3–5 nodes | UI-SPACE | P2 | recipe-tree | fixed r13 (delegated; see commit) |
| 13 | Palette grip inert at 1024 / missing in short windows | UI-TARGET | P2 | left-dock.tsx | fixed r13 (delegated; see commit) |
| 13 | Recipe Tree dock grip covers root expanders | UI-TARGET | P3 | recipe-tree | fixed r13 (delegated; see commit) |
| 13 | Tree depth cap fixed at 6 in wide docks | UI-LEGIBILITY | P3 | recipe-tree | fixed r13 (delegated; see commit) |
| 13 | Graph toolbar crushes the pin search at 300px; totals cut off | UI-SPACE | P3 | recipe-tree / flow toolbar | fixed r13 (delegated; see commit) |
