# Decision log (internal)

Newest first. Each entry: decision, rationale, consequences. Proposals that are not yet
implemented are marked **(proposed)**. User-facing behavior lives in `README.md`.

Last updated: 2026-10-03.

---

## D34 — Touch gestures (R1b)

Branches on `evt.pointerType === "touch"`, so **desktop is unchanged**:
- **One finger on the empty board = pan**; **one finger on a part = move it** (as mouse).
- **Two fingers = pinch-zoom + pan** (anchored at the midpoint; `_startPinch`/`_movePinch`).
- A toolbar **Box** toggle (mobile) switches empty-drag to a **rubber-band marquee**, since drag
  otherwise pans (multi-select on touch still possible).
- `#board { touch-action: none }` (≤980px) so the app owns the gestures; HTML targets are ≥40px.

Verified headless: phone → `touch-action:none`, Box visible, a simulated pinch changed the board
`viewBox` width 1958→699 (zoom in); desktop → `touch-action:auto`, Box hidden.

---

## D33 — Responsive layout (R1a): drawers on small screens

Root cause: no media queries; `main` was a fixed flex row with a 200 px palette and a 290 px
panel, so `#center` (the board) collapsed to **0 px** on phones. Fix, scoped to
`@media (max-width: 980px)` so **desktop is byte-for-byte unchanged**:
- the toolbar becomes one scrollable row; new `.mobonly` **Parts** / **Panel** buttons appear;
- `#palette` and `#panel` become **off-canvas drawers** (fixed, full height), toggled by
  `body.show-palette` / `body.show-panel`; `#center` fills the width.
- Drawers close when you tap the board, press Esc, or pick a palette item.

Dropdown fix: the scrolling toolbar (mobile) clipped the absolute **View/Export** menus; on
≤980px they are now pinned with `position:fixed` under their button (`_positionMenu`, with a
viewport clamp and `max-height:70vh` scroll). The right-most menus also right-align their
dropdown (`#viewMenu`/`#exportMenu`) so they stay on screen (a 2 px desktop overflow).

Verified headless: desktop 1440 → palette 200 / board 950 / panel 290, no mobile buttons;
phone 390 and tablet portrait 768 → board full width, drawers open to x=0, and both menus
within the viewport (fixed). R1b (touch gestures: pinch/pan/tap-vs-marquee) remains.

---

## D32 — Buildability in the cost function (S1) + calibration finding

Added two terms to the optimizer's weighted cost:
- **`jlen`** — total routed jumper length in holes (a diagonal counts its hypotenuse;
  `optimize.jumperLength`). Penalises long wires (not just their count).
- **`crowd`** — summed deficit of empty space between component **bodies** below `CLEARANCE`
  holes (same-group pairs skipped: a rigid cluster's internal spacing is the user's choice).
Presets (intent, not fitted): Balanced `jlen 2 / crowd 3`; **Compact `jlen 1 / crowd 1`**
(tolerate tightness/long wires to shrink); **Easy `jlen 6 / crowd 8`** (avoid both). `evaluate`
adds them to the score; `optimize` now returns `jlen`/`crowd`.

**Calibration finding (honest):** a calibration script (kept **outside the repo**, `/tmp`) ran the
modes on the standard shield and on temporary fixtures (dense / tight). The new terms are active
and do change choices (e.g. fewer/shorter jumpers, less crowding in some cases), but the
**greedy hill-climb does not separate the presets reliably** — Compact was sometimes not even the
smallest spread, and Easy ≈ Balanced on some boards. Fitting weights to a fixture would overfit
and still be erratic, so the weights are set by **intent**, not fitted. Reliable, strong preset
separation needs a better search (multi-start / simulated annealing) → queued as **S2**. Validate
`jlen`/`crowd` weights on real boards (V1).

---

## D31 — Assembly electrical checks (A1)

`core/checks.js` derives, from a board, a **multimeter guide** for the print sheet: **net
continuity** (each net with 2+ placed pins, listed pin-to-pin), **isolation** (different nets
must be open), **per-cut** separation (the two neighbouring holes must be open after cutting),
**per-jumper** continuity, and **mounting-hole** no-bridge checks. It is pure and tested
(`tests/checks.test.js`). The print dialog gains an **Electrical checks (before power)** section
(checkbox `pc-checks`, on by default); the assembly steps now point to it. Localised label
(`print.checks`); the sheet body text stays English.

---

## D30 — External review: what we accepted / rejected

Grounded against the repo:

- **Accepted, done now:** rename **Trim → Crop** (keeps routing; internal key stays `trim`) and
  **"schematic view" → "circuit view"** (it is a read-only netlist view, not an editor).
- **Accepted as backlog:** **S1** buildability in the cost function (biggest risk: the solver
  optimizing a metric, not a board a human wants to solder); **A1** assembly recipe with
  electrical checks; **R1** responsive/touch (measured: board is 0 px wide on phones); **V1**
  dogfood on real boards (user task); **ALT** layout alternatives.
- **Rejected:** cloud/login/collab, 3D, huge library, full schematic editor, framework/plugins,
  turning this into a universal EDA.

---

## D29 — Light theme and i18n (EN/PT)

- **Theme**: `this.theme` is `auto|light|dark` (persisted). `auto` follows `prefers-color-scheme`.
  Applied via `document.documentElement.dataset.theme`; CSS overrides the vars for `[data-theme=light]`
  and the **board palette is theme-aware** (`scene.js` `C` gained light variants — the board
  colours were hardcoded). A Theme select lives in the View menu.
- **i18n**: `src/ui/i18n.js` holds `en`/`pt` dictionaries + `t(key, params)` and
  `applyStatic()` for `[data-i18n]` / `-title` / `-placeholder`. Static chrome (toolbar, menus,
  dialogs, tabs, palette) is fully keyed; the Properties/Nets panels, size dialog, part dialog,
  issue level pills, save indicator and **all status-line messages** use `t()`. **DRC issues are
  translated by `code`**: the core issues carry structured fields (`pos`/`pos2`/`ref`/`pin`/
  `part`/`regions`/`sample`/`netIds`/`row`/`colA`/`colB`) and the UI builds a localised message
  (`_issueText`), falling back to the English `message`. `this.lang` is `auto|en|pt` (persisted;
  `auto` follows `navigator.language`); a Language select lives in the View menu. **Still English**
  by design/scope: the generated **print document** body text and **part labels** (library names).

---

## D28 — UI polish, phase 1 (hover info, tool hotkeys, save state)

- **4a zoom/pan** (done): viewBox transform, wheel zoom at cursor, middle/Space-drag pan, `+`/`−`/`0`,
  zoom % + buttons; interactions stay correct via getScreenCTM.
- **4b hover info**: native SVG `<title>` on component / jumper / cut / mounting-hole groups
  (ref, part, value, lock, group; net + endpoints; position).
- **4c tool hotkeys**: `X` cut, `J` jumper, `M` mount (toggle), alongside `V` select / `C` connect.
- **4d save state**: Undo/Redo buttons are enabled/disabled from the history; a "saved / ● unsaved"
  indicator next to Save reflects `dirty` (updated on render and after Save).
- **4e Save As**: `window.prompt` replaced by a `saveDlg` dialog (name field, Enter to confirm),
  consistent with the Print / Size dialogs.
Deferred: a light theme, full a11y pass and i18n (4f).

---

## D26 — UI tests via a dependency-free DOM shim (T1)

The suite was core-only (`node --test` on pure logic) with no UI coverage. Adding jsdom would
break the zero-dependency policy, so `tests/helpers/dom.mjs` implements a tiny shim (elements
with attributes/dataset/classList/children, `getElementById` that auto-creates, `createElement(NS)`,
`addEventListener`/`dispatch`, `closest`, SVG geometry stubs, `localStorage`, a few `window`
globals). `tests/ui.test.js` installs it, imports `App`, and drives real interactions
(add → duplicate → delete → undo, plain-click select/deselect, `G` grouping, the 100-entry undo
cap). Tests clear the app's pending status/autosave timers (`makeApp(t)` + `t.after`) so the
process exits fast. Coverage is still thin (no pointer-drag/marquee/dialog/print paths) but the
wiring is now regression-tested and the shim makes adding more easy.

---

## D25 — Diagonal jumpers (F10, opt-in routing option)

A jumper now has an optional `x2`: end A = `(x, ya)`, end B = `(x2 ?? x, yb)`. When `x2 !== x`
the wire is diagonal. The router gets a **`diagonal` option** (default **off**), threaded through
`route` and `optimize`/`optimizeAsync` so **every** mode (Solve / Easy / Balanced / Compact, and
the size search) honours it. Diagonal edges cost more (`DIAG_COST`) and are bounded to
`|dx|<=2`, `|dy|<=6`, so copper/vertical are still preferred and the honest vertical-only model
stays the default. Blocked by any pin/arc/end/body on the wire's cells (`jumperSpan` = Bresenham
cells between the ends).

Helpers in `model`: `jumperEndA/B`, `jumperKey`, `jumperSpan`; `analyze`, `contentBounds`,
`scene`, `ascii`, `print`, `cropTo` (Trim/size) and the jumper tombstone key all use them, so a
diagonal round-trips through save/undo and shows its endpoints and length. UI: a **View** menu
checkbox "diagonal jumpers (routing)". Note: it only triggers in tight boards (vertical/copper
usually win), matching "use only when it helps" — on the standard pump shield the router still
solves with vertical jumpers, so **no diagonal appears there even when enabled**; that is
expected. A deterministic router test (seeded search) locks that diagonals CAN be emitted.
Also: the version tabs now show a **live elapsed-time counter** while computing.

---

## D24 — Net split / merge (F5)

`Project.splitNet(netId, pins)` moves the given pins out of a net into a **new** net (removing
the source if it empties); merging reuses the existing `Project.connect(keys, id)` (which joins
every net containing those pins, keeping the chosen id). UI lives in the selected net's
Properties: each pin chip gets a **✂** (split that pin off), plus "Split selected pins" (uses
the component multi-selection, F7) and a **Merge into** selector. Net changes invalidate the
routing. Also: **mountable zones** now default to **on** (D21).

---

## D23 — Board-size Pareto search (F4b)

The board size was always a user input. The **Size…** button (next to the version tabs) searches
it: it compacts once to learn the smallest content size, builds a few candidates from that size
up to the current one, runs **optimize + route** on each, and keeps the **non-dominated** ones
over (area, jumpers, cuts) via `core/pareto.js`. Applying one swaps in that already-computed
board (one undoable step). Runs cooperatively (no freeze); slow by nature, so only a handful of
candidates. `cropTo()` was extracted from Trim and reused to place the compacted content at the
top-left of each candidate.

---

## D22 — Multi-selection and marquee (F7)

`this.selection` is a `Set` of refs; `this.selected` stays the **primary** (anchor) so the
single-object Properties/behaviour is unchanged. Shift-click a part toggles it in the set
(refined: only a **lead** keeps Shift for span editing, so Shift on the body selects);
dragging on the empty board draws a **marquee** that selects every component whose body/pins
overlap it. The whole selection moves as one clamped delta, expanded by any groups (refused if
any member is locked). Delete / Rotate / Lock / Duplicate / Nudge / `G` / `Shift+G` operate on
the selection; Properties shows a "N parts selected" bulk panel. A plain click selects on the
first click and only toggles off on a second click (the "was it the sole selection before?"
flag is captured before selecting, not after). `G` on a multi-selection adds
them all to the active group at once — the main group-UX win.

---

## D21 — Mountable zones (safe-to-drill hatch)

After Solve/Optimize, the user needs to know where a mounting hole will not disturb the
circuit. `connectivity.safeMountCells(project, library)` returns the cells where drilling is
electrically harmless: the copper run has no **connection point** on **both** sides of the
cell (cutting a dead-end or an unused strip is fine), and the cell is not a pin, a jumper end,
or under a flush body. Connection points are net-bearing component pins **and jumper ends** —
a jumper end carries the net onward, so ignoring it wrongly marked run segments as idle. The View menu's **mountable zones** toggle hatches those cells (45° pattern
over the merged runs). Pure core logic, unit-tested; the hatch is render-only (not printed).

---

## D20 — Print dialog with selectable sections

Print/PDF used to be a `window.prompt` for the origin and always emitted every section. Now a
`<dialog>` asks the **origin** (default `A1`, remembered) plus **checkboxes** for what to
include: component side, copper side (mirrored, no parts), mounting holes, cuts, jumpers, BOM,
assembly steps (+ net check). Only the selected blocks are written to the print window, so the
user prints just what interests them. Board SVGs are only built when their side is selected.
The gate was relaxed: printing is allowed whenever the board has parts, not only after Solve.

---

## D19 — Cooperative optimizer: yield instead of a time limit

The optimizer is heavy: each evaluation is a full `route` (up to 4 attempts) + analyze, and
Compact can do 6 passes × 300 evaluations. Run synchronously on a large board it blocks the
main thread for many seconds, so Chrome offers to kill the tab. The user does **not** want a
time limit — the long Compact result is the good one.

Solution (done): `optimize` is now a **generator** (`optimizeGen`) with two wrappers:
- `optimize(...)` (sync) drains it in one task — used by tests/headless.
- `optimizeAsync(...)` runs it with `cooperative: true` and `await`s a macrotask whenever the
  generator yields (every `yieldMs`, default 12 ms), so the browser stays responsive and the
  run completes fully. The UI (`_computeVersion`) uses `optimizeAsync` with **no time cap**.

**No time limit at all.** An earlier attempt added a `maxMs` budget that stopped the optimizer
early; it was reverted because on a large board it truncated Compact after only ~9 of 300
evaluations and produced much worse boards (score 9007 vs 7635 in a probe). Yielding solves
the freeze without sacrificing quality. A Web Worker is no longer needed for responsiveness;
it would only add true parallelism later.

---

## D18 — Plan: Easy mode, groups, multi-select (F4/F7/F8)

**Group is a plain component property — yes, like `locked`/`rot`.** `Component.group`
(string, default empty) identifies the cluster; components sharing a non-empty name are
rigid. It persists with the component, snapshots/undo cover it for free, and no separate
group table can drift. Consequences: grouping/ungrouping is a field edit; an "empty" group
simply disappears; renaming a group = reassigning each member's field (cheap).

**F8 (groups) — M.** Optimizer treats a group as a unit: translation-only candidates move
every member together; singletons keep rotate/move/span. All-or-nothing lock: any locked
member fixes the whole group (D8). Manual drag moves the whole group. UI can start as a
`group` text input in Properties (next to `value`); F7 upgrades it to select-and-group.

**F7 (multi-select) — L, high value.** Selection becomes a set of refs; shift-click adds,
a marquee (rubber-band) selects; dragging moves all selected as one undoable step. This is
the real UX enabler for **group creation** and bulk edits. Do it after F8's property exists.

**F4 — split.** **F4a Easy-to-assemble (S):** a third weight preset over the existing cost
function (fewer jumpers/cuts, prefer aligned cut columns, keep spacing), plus an explicit
Balanced preset — no new algorithm, per the original research ("three modes = one objective,
three presets"). **F4b board-size Pareto search (L):** evaluate a few `(cols,rows)` around
the content, run optimize+route, Pareto-rank size vs cuts vs jumpers, let the user pick.
Nobody in prior art does F4b; it is the most expensive item and can wait.

**Recommended order:** F4a (cheap, closes master-prompt §9) → F8 (M, unlocks the P1–P8
case via a Properties field) → F7 (L, best editing UX, upgrades groups) → F4b (L, last).

**F4a implemented:** `optimize.js` exports `BALANCED_WEIGHTS` (the default), `COMPACT_WEIGHTS`
and `EASY_WEIGHTS` (jumpers ×22 — strongly prefer copper over fiducial wires). The Optimize
tab is relabelled **Balanced** and a new **Easy** tab (`Ctrl+Shift+E`) was added. One cost
function, three presets. F8 is implemented (see D8). F7 is next, then F4b.

---

## D17 — Result invalidation and Crop semantics

- **Open/New invalidate all result tabs.** Opening or creating a board now resets
  `versions` and returns to **Edit**, so a cached Solve/Optimize/Compact/Trim from the
  previous board can never be shown. (Previously the stale tabs survived an Open.)
- **Trim crops the board you are viewing.** `_computeVersion("trim")` now clones
  `_shownProject()` instead of always the Edit board, so "Solve → Trim" keeps the Solve
  routing and its problem set — this was the cause of the "44 problems" report (Trim was
  cloning the unsolved Edit board). Trim remains a pure crop/translate (D16).
- **View controls moved** from the bottom of the Parts palette to a **View** menu in the
  toolbar, next to Export — discoverable and grouped with the board actions.
- **Palette groups start minimized** and remember their open/closed state; a search
  force-opens matching groups.

---

## D16 — Crop (internal `trim`) crops margins only; it never re-solves

The tab is labelled **Crop** (was "Trim"); the internal key/`data-vtab` stays `trim`.

Decision: **Crop** shifts the existing components, cuts, fixed cuts, tombstones,
mounting holes and jumpers by the same `(dx,dy)` and shrinks `cols/rows` to `contentBounds`.
It does not clear or recompute routing.

Rationale: trim removes the unused part of the stripboard; the user's solved layout (and
any hand edits) must survive. The previous behaviour cleared `cuts`/`jumpers`, which silently
discarded a Solve/Compact result and forced a re-solve. Reported by the user; fixed.

Consequence: Trim is a pure crop/translate and is reversible like any other version tab via
`Use this` + `Ctrl+Z`. Tombstones are shifted too so they still point at the right cells.

---

## D15 — UI information architecture: objects, nets, contextual actions, palette  **(implemented)**

Design review answers, now implemented (see the note at the end).

**1. Nets are only editable in the Nets tab today — yes, and that is inconsistent.**
Current truth: nets are created with **Connect**; renaming, removing a pin (chip `✕`) and
deleting happen **only in the Nets tab**. On the board, strips and ratsnest carry no
`data-net` (only the schematic does), so a net is **not clickable** and never shows a real
Properties view (`_renderSelection` just prints "net X selected"). Recommendation: make nets
first-class selectable from the board (add `data-net` to strips/ratsnest) and give them a
Properties view (rename, pins, delete) mirroring the Nets tab. Preserves the one-primary-
selection → Properties rule.

**2. Taxonomy: cuts/jumpers/mounting holes are "board objects", not components.**
Recommend formalizing three classes:
- **Component** (placed part): ref, value, rotate, lock, span, pin names.
- **Board object** (cut, jumper, mounting hole): intrinsic to the board, **no ref/rotate**;
  position + fixed (cuts/jumpers) + delete.
- **Net**: electrical grouping.
Rename the UI section to **Board objects** and make all three share one selection +
Properties presentation. Matches D12/D14.

**3. Move Lock/Rotate into Properties — good idea, with one caveat.**
Recommend moving Rotate, Lock/Unlock (for parts), Fix/Unfix (for wires/cuts) and Delete into
the contextual Properties panel; keep the toolbar lean and keep the hotkeys (`R`/`L`/
`Delete`) as the fast path. Lock and Fix are the same action on different objects, so one
contextual "Lock/Fix" button. Caveat: discoverability — mitigate with labels, tooltips and
the hotkey shown next to each action.

**4. The palette has no anti-clutter strategy yet.**
`_renderPalette` lists **every** part flat (`listParts()`), only mitigated by the deliberately
small library. Recommendation: group by kind (Discretes / Headers & terminals / ICs /
Modules / Presets / Custom), add a **search** filter and a **recently used** row, and keep the
library small. Fixes the "giant, confusing list" without a redesign.

Verdict: (1) and (4) are the biggest UX wins; (2) is mostly naming/consistency; (3) is medium
with a discoverability caveat.

**Implemented:** nets get `data-net` on single-net strip runs and ratsnest lines, so a board
click selects the net, and a new `_netBox` gives the selected net a Properties view
(rename / pin chips / delete) mirroring the Nets tab. The palette is grouped + searchable
with a Recent row (`_renderPalette` + `PALETTE_GROUPS`, `partSearch`). Rotate/Lock/Fix/
Delete moved into the Properties panel as contextual actions; the toolbar keeps only tools,
file, export and view (hotkeys unchanged). While wiring the net Properties view, fixed a
latent bug: `this.scene.set_project(...)` was called but `this.scene` never existed — now
`_renderBoard(project)` redraws only the SVG so live label typing keeps input focus.

---

## D14 — Manual cuts/jumpers + "delete stays deleted" tombstones

Decision: the user can hand-place cuts (Cut tool: click a hole, click again to remove) and
jumpers (Jumper tool: two holes in the same column). Hand-placed objects are **fixed** by
default. Deleting a cut/jumper records a **tombstone** (`Project.removedCuts` /
`removedJumpers`) so a later Solve does not recreate that exact object.

Rationale: master prompt §10 (manual editing is first-class) and the user's explicit
"delete stays deleted". The solver must cooperate, otherwise it resurrects cuts/jumpers the
user rejected.

Implementation:
- Model: two persisted sets; `route` reads them and passes them down.
- Router: `deriveCuts` skips tombstoned cells when choosing where to cut; `dijkstra` skips
  tombstoned vertical edges, so it routes around them instead of re-adding them.
- UI: `setMode("cut"|"jumper")`; `_addCut`/`_addJumperClick` validate against pins, other
  jumper ends and flush bodies (mirroring the router keepouts) before adding; `deleteSelected`
  writes the tombstone.
- Manual objects use `_afterStructuralChange(false)` (keep existing routing) rather than
  `invalidateRouting()` (which would wipe the hand edits).

Limits: tombstones persist for the life of the project (no auto-clear yet — a deleted spot
stays uncuttable by Solve); a hand-drawn jumper has no net label until one is assigned; the
jumper stays strictly vertical (the physical model).

---

## D13 — License: **MIT** (implemented)

The repo contains **zero third-party code** (ideas only; see `docs/PRIOR_ART.md`), so we are
free to choose any license. We deliberately avoided GPL code, and MIT/Apache are compatible
with that stance.

| Option | Pros | Cons |
|---|---|---|
| **MIT** | Simplest; maximum reuse/adoption; matches prior-art we borrowed ideas from (stripboard-py, boardwright are MIT); trivial to host on an ESP32 / share | No explicit patent grant |
| **Apache-2.0** | Permissive + **explicit patent grant** + NOTICE handling; good if contributors/patents matter | Longer, more obligations (NOTICE, state changes); still not copyleft |
| **GPL-3.0** | Copyleft keeps derivatives open; aligns with many EDA tools (VeroRoute/DIYLC) | Blocks closed integration; inconsistent with having avoided GPL code; harder adoption |
| **AGPL-3.0** | Network copyleft (hosted users get source) | Overkill for a personal/hosted tool; scares off reuse |
| ** / all rights reserved** | Full control | No sharing/contribution; contradicts the project's spirit |

**Decided: MIT.** Best fit for the stated goals (personal tool, possible ESP32/self-hosting,
sharing, prior-art-friendly). Apache-2.0 would only win if a patent grant became important.

**Done (L1):** `LICENSE` added — MIT, **Copyright (c) 2026 JMGK** — and `"license": "MIT"` in
`package.json` (repo still `private`/unpublished). The README credits prior-art ideas.

---

## D12 — Mounting holes (fixação ao chassi)  **(implemented)**

### Idea

Mark points where a screw fixes the board to a chassis. A mounting hole is **not just a
cut**: it interrupts the copper strip (like a cut) *and* is a physical through-hole larger
than a normal hole (e.g. Ø3.2 mm for M3). The PDF must draw it and list its position so the
builder drills it.

### Why it fits the existing model

A mounting hole is "a cut plus a bigger hole plus a keep-out". Almost everything needed
already exists:

- **Connectivity** (`connectivity.js`): `present(x,y)` already returns false for cut cells;
  adding mounting-hole cells there makes the strip break with no new copper logic.
- **Router** (`router.js`): it already treats `project.fixedCuts` as hard breaks. Mounting
  holes behave the same for copper, and additionally must be a **keep-out for pins and
  jumper ends** (a screw/standoff occupies the spot). Jumper arcs may still span the hole.
- **Bounds** (`geometry.js` `contentBounds`): must include mounting holes so Trim/print
  frame them.
- **Print** (`app.js`): draw a larger circle + crosshair on both sides, list them as their
  own assembly step ("drill mounting holes Ø…").

### Recommended design

1. **Model**: `Project.mountingHoles = new Set(["x,y"])` (cells), a project-level
   `mountDiameter` in mm (default `3.2`), persisted in JSON (with a `version` bump).
   Keep it a **separate set from `cuts`** — extending `cuts` to objects would ripple through
   router/align/print for no gain.
2. **Connectivity**: mounting-hole cells are not copper (`present` false). New DRC codes:
   `mount-on-pin`, `mount-on-jumper-end`, `mount-duplicate`, and a **warn**
   `mount-under-body` (screw head/standoff collides with a flush body).
3. **Router**: seed mounting holes like fixed cuts (never route copper through them) and as
   a keep-out for jumper ends; arcs over the hole are allowed.
4. **UI**: a toolbar button toggles a **Mount hole** mode; click a cell toggles the hole.
   Selectable/deletable like a cut (reuse the wire/cut selection + Properties panel with a
   Delete action). Undo via the existing snapshot.
5. **Print / render**: bigger circle + crosshair, distinct from the cut "X"; shown on both
   component and (mirrored) copper side; listed with letter+number positions.

### Caveats / limits

- One grid cell = one hole. A Ø3.2 mm hole is physically wider than the 2.54 mm pitch, so
  it can nibble the neighbouring pads; modeling exactly would need a diameter-aware copper
  removal. MVP: break only the occupied cell and note the approximation.
- Non-grid mounting positions (arbitrary mm) are out of scope initially.
- Mounting holes are **fixed** by definition: Solve/Optimize never move them.

### Verdict

Feasible, **medium** cost, **high** real-world benefit (mounting to a chassis is a build
blocker today). Low risk: additive, isolated from the optimizer (treated as fixed).

### Implemented

`Project.mountingHoles` (Set of cells) + `mountDiameter` (default 3.2 mm), persisted.
`analyze` treats them as no-copper (breaks the strip) and reports `mount-on-pin`,
`mount-on-jumper-end` (errors) and `mount-under-body` (warn). The router treats them as
no-copper and a jumper-end keep-out, and never derives a cut on them. UI: **Mount** tool
(toggle a hole; refuses pins, jumper ends and flush bodies), selectable/deletable like a
cut. Drawn at true scale as a large circle + crosshair; the print sheet lists them and adds
a drill step. Trim shifts them with the content. ASCII marks them `M`. Tests in
`connectivity`/`router`/`model`. For enclosure design, `geometry.mountHoleMetrics` gives the
**millimetre** geometry of the holes (centre-to-centre pairs, pattern span, and each centre's
X/Y from the board's top-left corner, at 2.54 mm/hole); the print's mounting-holes section and
the ASCII export list it.

Fix (later): the copper **runs** now also split at mounting holes (`scene.runsForRow`), so the
drawn/tinted copper matches the analyzer (previously the hole broke the net electrically but
the strip was still drawn continuous). And adding/removing a mounting hole now calls
`_afterStructuralChange(true)` — it invalidates the routing (like moving a part), because a
hole changes copper connectivity and any existing cuts/jumpers are stale.

---

## D11 — Restore prototype artifacts and prototype-era guarantees

Decision: recover the internal artifacts and two guarantees that were dropped in the
fresh-start rewrite (which deleted the Python/stripboard-py prototype). Rationale: an audit
of the 87 original prompts found that `AGENTS.md` and `docs/` existed in the prototype but
were not carried over, and that two capabilities regressed. Restored/queued:
- `AGENTS.md` + `docs/STATUS|DECISIONS|REQUIREMENTS|PRIOR_ART.md` — restored.
- **Easy-to-assemble** optimization mode — was a weight preset; queued as F4.
- **A whole Solve = one undoable step** — was guaranteed; **restored** (F2 done: `Use this`
  snapshots the edit board first, so `Ctrl+Z` undoes the whole apply).
Consequence: F4 is treated as a recovery, not a new feature, and ranks P1.

## D10 — The schematic is a read-only view; connectivity is edited on the board

Decision: the electrical model is edited by **Connect** (pin-to-pin) and by net
membership, on the physical board; the **schematic view** renders that model read-only.
Rationale: the master prompt wanted drawing wires, but the user explicitly asked for
"simple + export, edit in KiCad". Consequence: no schematic editor; netlist export
(JSON/SPICE/KiCad) covers external editing. Revisit only if wire-drawing is requested.

## D9 — Build from scratch (plain ES modules + SVG), do not reuse stripboard-py

Decision: after evaluating prior art (stripboard-py, boardwright, VeroRoute, DIYLC,
Stripboard Editor), build a new, small web app from scratch. Rationale: reusing a Python
engine would force an install (defeating "runs anywhere in a browser"), and the user
judged the reuse/fork constraints too limiting; prior art informed ideas only, no GPL
code. Consequence: zero dependencies, no build step, full control of the model; the cost
is that we own the router/optimizer. See master prompt §21.

## D8 — Grouped / "semi-locked" components  **(implemented)**

### Problem

Some parts only make sense as a rigid cluster. Examples:

- Screw terminals on the right edge must stay **together** (fixed spacing and order) but
  do not need a specific board location — the optimizer is free to slide the whole cluster
  elsewhere.
- The concrete case the user gave (pump shield): `P1..P8` are `terminal2` parts forming a
  **2 columns × 4 rows array** — columns at x=26 and x=33 (dx=7), rows at y=2,8,14,20
  (dy=6), all `rot 0`. They must keep exactly that relative geometry, but the whole array
  may sit anywhere on the stripboard.

Today the only options are `locked` (never moves at all) or fully free (the optimizer
scatters the members and breaks the pattern).

### Concept

A **group** is a set of components that keep their relative placement. The group is a
rigid body: it can translate (and optionally rotate) as a unit, but membership, spacing,
order and per-member rotation are preserved. It is "semi-locked": fixed with respect to
each other, not to the board.

Important distinction from `locked`: `locked` freezes a part in absolute board position;
a **group** freezes only the *relative* positions of its members. The group as a whole is
still free to move.

### Why this is a good fit

- Groups are a **placement-only** concept. It does not touch the physical model
  (strips/cuts/jumpers) nor `connectivity.analyze`, so design rules 2 and 3 stay intact.
- The router works per net pin position, which the group translation respects.
- Undo/redo already snapshot the whole project, so no extra work there.

### Feasibility: yes. Difficulty: **medium**, risk **low** (isolated to model + optimizer + UI).

### Recommended design

1. **Model** (`src/core/model.js`)
   - Add `group` (string, default `""`/null) to `Component`; include it in `toJSON` and
     `fromJSON`. Components with the same non-empty `group` name form a cluster.
   - Free-text group names avoid needing multi-select and match the existing editable
     `ref`/pin-name UX. `renameComponent`/`removeComponent` need no changes.
2. **Optimizer** (`src/core/optimize.js`) — the bulk of the work.
   - Step 1 (global cluster shift, `targetShifts`) already moves all free parts together,
     so it preserves groups for free.
   - Step 2 (per-part refine) must operate on **units**: a unit is either a group (array
     of components) or a singleton free component. For a group unit, generate **translation
     candidates only** (±1/±2, cluster-centroid toward others) and apply/restore every
     member together. Singletons keep rotate/move/span as today.
   - `evaluate`'s cache `signature` already lists every unlocked component, so groups
     invalidate correctly with no change.
   - **Lock consistency (all-or-nothing):** a group participates in the free set only if
     *every* member is unlocked. If any member is `locked`, the whole group is treated as a
     fixed anchor (never moved), and the UI should warn. This avoids partially deforming a
     group (moving its unlocked members) — which is exactly the failure mode the user wants
     to prevent. To let the optimizer slide the `P1..P8` array, unlock all eight.
3. **Manual drag** (`src/ui/app.js` pointer handlers)
   - On pointerdown/pointermove for a grouped component, apply the same `dx,dy` delta to
     every member. Selection highlights the group (or the anchor part).
4. **UI**
   - Add a `group` input to the Properties panel next to `value` (same focus/change +
     snapshot pattern). Empty = ungrouped.
   - Optional: a dashed bounding box / shared colour for the selected group.
5. **Rotation (optional, phase 2)**
   - Phase 1: **translation only**. Rotating a rigid cluster means rotating every member's
     position about a pivot *and* adding 90° to each member's `rot`, plus DRC/overlap
     checks — more surface for little gain. Recommend leaving it out initially.

### Open questions

- Mixing `locked` and `free` in one group: resolved above — all-or-nothing (any lock =
  whole group fixed).
- Granularity: for the pump shield, is it **one** group of all 8 terminals, or **two**
  groups (the x=26 column and the x=33 column) that may drift independently? Proposal:
  support arbitrary groups, so the user chooses; the example works either way.
- Group naming: free text vs auto ids (`G1`, `G2`). Proposal: free text, like `ref`.
- Should Solve/Optimize treat a group as a keep-out? Proposal: no special handling beyond
  rigid movement.
- Group rotation: defer (translation only) — see phase 2 below.

### Effort / cost

- Model + serialization: **S**
- Optimizer unit refactor: **M** (the main cost; careful apply/restore of multi-part units)
- Manual drag + Properties input: **S**
- Tests: **S** (assert members keep relative offsets through `optimize`)
- Total: **medium**; low coupling, no router/DRC changes.

### Implemented

`Component.group` (string, persisted) — same name = rigid cluster. `optimize.js` builds
**units** (`freeUnits`): a group with all members unlocked moves by **translation only**; a
group with any locked member is a fixed anchor (all-or-nothing). Manual drag moves every
member by one clamped delta; selecting a member highlights its mates. The `group` field is
edited in Properties (like `value`). Group change does not invalidate routing. Selecting a
member draws a **dashed outline + "group: name"** around the cluster. A group of one member
is treated as a normal part (it may still rotate). Fast grouping: `G` on a selected part
adds it to the active group (creating `G1`… if none; pressing it on a grouped part makes that
group active), `Shift+G` removes it, `Esc` ends the session. Tests: relative offsets preserved through
`optimize`; a group with a locked member never moves; JSON round-trip. Rotation of a
multi-member group remains deferred (phase 2).

---

## D7 — DRC enforces the flush-body keepout for jumpers

Decision: `connectivity.analyze` reports `jumper-under-body` when a jumper runs over a
cell under a body with `wiresUnder:false`. Rationale: the router already avoids it, but
manual drag/edit could bypass the rule; DRC must agree with the router. Consequence:
Problems can now show this error; pin cells stay covered by the existing jumper-on/over-pin
checks to avoid duplicate noise.

## D6 — `Open` validates and reports instead of throwing

Decision: parse in `try/catch`, reject non-object/empty payloads, and reset the file input
so the same file can be re-selected. Rationale: an invalid JSON file crashed via unhandled
rejection; a stale `value` blocked re-opening. Consequence: bad files show a status message
and leave the current board untouched.

## D5 — Autosave via `localStorage`, no server; dirty flag persisted

Decision: mirror the **edit** board to `localStorage` (debounced 400 ms), restore on load,
persist the `dirty` flag, and guard unload / New / Open. Rationale: prevent losing work
without adding a backend or file-system dependency. Consequences: per-browser recovery;
status note on restore only when there are unsaved changes; `Save` records the cleared
dirty flag immediately.

## D4 — Standalone SVG export is out of scope

Decision: do not build a separate SVG export. Rationale: Print/PDF at 1:1 plus the
browser's "Save as PDF" covers the real need; a direct vector-PDF/SVG exporter is extra
surface with low value. Consequence: Export menu stays Print/PDF, Netlist, ASCII.

## D3 — Fixed objects are never modified by Solve/Optimize

Decision: locked parts and fixed jumpers/cuts are preserved; a row with a user-fixed cut is
left to the user. Rationale: the tool optimizes the user's layout, it does not override
explicit choices. Consequence: router seeds fixed jumpers as zero-cost edges and keeps
fixed cuts.

## D2 — `core/` is pure and unit-tested

Decision: no DOM in `core/`; all real logic testable with `node --test`. Rationale:
separates reasoning from rendering, keeps regressions catchable. Consequence: UI wiring
lives only in `src/ui/`; new logic should go into `core/` with tests.

## D1 — One authoritative connectivity model

Decision: `connectivity.analyze` is the single source of truth for "what is connected" and
for DRC; UI, router and optimizer all consult it. Rationale: a second derivation would
drift. Consequence: any new physical rule is added to `analyze` (and mirrored in the
router keepout to keep Solve producing valid boards).
