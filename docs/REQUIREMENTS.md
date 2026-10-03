# Requirements traceability — master prompt vs. implementation

Source: original master prompt "Stripboard / Veroboard Circuit Designer — Master Prompt",
from session `ses_f089fb7f9ffe3xKLGlJFq4h0Bl` (project dir `/home/keres/Downloads/STRIPBOARD`,
the folder later renamed to `STRIPBOARD_STUDIO`). Analysis date: 2026-10-03 (re-checked
2026-10-04).

Status legend: **Done** = satisfied · **Partial** = partly satisfied · **Adapted** =
intentionally changed (see `DECISIONS.md`) · **Pending** = not implemented · **N/A** not
applicable.

| § | Requirement (condensed) | Status | Evidence / notes |
|---|---|---|---|
| 1 | Solve the physical stripboard puzzle, not "just another manual editor" | Done | App builds real boards; router + optimizer (`src/core/router.js`, `optimize.js`) |
| 2 | Two connected views of one circuit (electrical + physical) | Done | Physical board + read-only schematic (`src/ui/schematic.js`); single model |
| 3 | Research prior art before building; license check; reuse if better | Done | Research in original session; credits in README; from-scratch decision (D9) |
| 4 | Compiler/optimizer philosophy; manual editing first-class; fix & rerun | Done | Version tabs + Fix/Unfix; optimizer respects fixed objects |
| 5 | Traditional continuous-copper model; 2.54 mm grid | Done | `connectivity.js` strip/cut/jumper model; print at 1 hole = 2.54 mm |
| 6 | Component electrical + physical geometry; bendable leads; small library | Done | `library.js` `bendable` spans; DIP geometry; small curated set |
| 7 | Schematic is visual; user connects pins by drawing wires; model as nets | **Adapted** | Pin-click Connect + editable nets; schematic is **read-only** by decision (D10), export to KiCad |
| 8 | Board model: rows/cols/strips/placements/rotations/cuts/jumpers/fixed; two views; unmistakable copper side; mirrored output | Done | `scene.js` mirrored copper side + banner; Print emits copper side without components |
| 9 | Joint optimization of placement, orientation, strips, cuts, jumpers, **board size**; three modes (Compact/Balanced/Easy) | Done | Router + greedy optimizer; three weight presets **Easy/Balanced/Compact**; **board-size Pareto search** (`Size…`, D23) |
| 10 | Manual editing first-class; fixed objects never modified by solve/optimize | Done | Move/rotate/lock; **Cut** and **Jumper** tools add objects by hand (fixed by default); "delete stays deleted" tombstone |
| 11 | Board resizing never auto-rearranges; show problem if it no longer fits | Done | `setBoardSize` never moves parts; min-board guard |
| 12 | One authoritative connectivity engine used by all layers | Done | `connectivity.analyze` (invariant #2) |
| 13 | DRC: unconnected pins, shorts, invalid cuts, jumper conflicts, collisions; valid/warn/error | Done | `analyze` issue codes; Problems panel with error/warn |
| 14 | Assembly documentation: dimensions, orientation, cuts, jumpers, checks; side distinction | Done | Print/PDF: origin, BOM, ordered assembly steps, cut/jumper lists, both sides |
| 15 | Undo/redo mandatory; a whole autoroute = **one** undoable operation | Done | `Use this` snapshots first; `Ctrl+Z` returns to the pre-apply board (one step) |
| 16 | Persistence: human-readable JSON; New/Open/Save/**Save As**; autosave later | Done | New/Open/Save/Save As (`Ctrl+S` / `Ctrl+Shift+S`) + autosave |
| 17 | Layered architecture; core algorithms testable without UI | Done | `core/` DOM-free; `ui/` separate |
| 18 | Plain JS/HTML/CSS/ES modules/SVG; no TS/Vite/React/Electron | Done | No build, no framework (package.json has no deps) |
| 19 | Minimal dependencies; justify each | Done | **Zero runtime dependencies** |
| 20 | Tests for core logic, independent of UI | Done | 90 tests; core is pure-tested, plus a dependency-free DOM shim drives the UI (`tests/ui.test.js`, D26) |
| 21 | Build-vs-reuse strategy decision | Done | Chose from scratch after evaluating stripboard-py etc. (D9) |
| 22 | Smallest useful prototype first | Done | Prototype evolved into the current app |
| 23 | Success = save the user from the manual physical puzzle | Done | The core loop (place → connect → Solve/Optimize → DRC → print) is complete and in daily use |
| 24 | Always ask "is this already solved?"; smallest sensible solution | Done | Reflected in dependency policy and scope |

## Biggest gaps vs. the master prompt

The only remaining difference is intentional:

- **§7**: schematic editing was replaced by pin-click Connect + a read-only schematic
  (decision D10, not an omission) — edit in KiCad via the netlist export.

Resolved since the first pass: §9 (Easy/Balanced/Compact + board-size search), §10 (manual add
+ tombstone), §15 (undoable result), §16 (Save As + autosave), §20 (UI tests).

## Out-of-scope / intentionally deferred

- Standalone SVG export (D4) — use Print/PDF + browser "Save as PDF".
- Schematic editor (D10) — view only; edit in KiCad via netlist export.
- Direct vector-PDF export — relies on the browser print dialog by design.
