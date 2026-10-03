# Internal status — where we are / what is left

Developer- and agent-facing notes. The **user-facing** docs are `README.md` and `MANUAL.md`;
keep those in sync with shipped behavior. Use this file for "where we are, what is left",
`docs/DECISIONS.md` for the reasoning, `docs/REQUIREMENTS.md` for the master-prompt →
implementation traceability, `docs/PRIOR_ART.md` for the comparison with existing tools,
`docs/FIXTURES.md` for the canonical **standard test board**, and `docs/SCREENSHOTS.md` for the
`MANUAL.md` shot list. Agent entry point: `AGENTS.md`.

Last updated: 2026-10-04.

## How to run

- `npm start` → http://localhost:8080 (static `serve.mjs`, no build step, no deps).
- `npm test` → `node --test tests/*.test.js` (currently **90** tests, all green).
- ES modules need an HTTP origin; do not open `index.html` directly (`file://`).

## Layout / responsibilities

- `src/core/` — DOM-free, pure, unit-tested. `model`, `geometry`, `library`,
  `connectivity` (single authoritative copper model + DRC), `router` (maze Solve),
  `optimize`, `align`, `pareto`, `netlist`, `ascii`.
- `src/ui/` — `scene.js` (SVG draw, no app state), `schematic.js` (read-only view),
  `i18n.js` (EN/PT dictionaries), `app.js` (state, interactions, panels, autosave, print/export).
- `index.html` + `styles.css` — toolbar, panels, dialogs.
- `manual/` — images for the user-facing `MANUAL.md`.

## Invariants (do not break)

1. `core/` never touches the DOM; it stays pure and covered by `tests/`.
2. One authoritative connectivity model: UI, router and DRC all ask
   `connectivity.analyze`; never re-derive "what is connected" elsewhere.
3. Physical model is exactly: strips split by cuts, jumpers are wires between holes (vertical
   by default, diagonal opt-in), pins sit in holes. Keep it honest.
4. Never silently rearrange the user's layout; optimization is an explicit action.
5. Fixed objects (locked parts, fixed jumpers/cuts) are never modified by Solve/Optimize.

## Where we are

Shipped and working (user framing in `README.md`/`MANUAL.md`): parts library + custom pin bars,
connect/nets (rename, split, merge), bendable spans, **groups (semi-locked clusters)**,
**multi-selection + marquee**, duplicate, version tabs **Edit / Solve / Easy / Balanced /
Compact / Crop** (label; internal key `trim`; result tabs cached; `Use this` is one undo step), **board-size Pareto search**,
manual **Cut/Jumper/Mount** tools (+ delete-stays-deleted tombstones), **mounting holes** with
mm geometry + **mountable zones**, mirror copper view + schematic, **zoom/pan**, Problems/DRC
(two languages), **Print/PDF** with selectable sections + BOM + assembly steps, Netlist/ASCII
export, undo/redo + saved indicator, JSON save/open + autosave, **light/dark theme**, **i18n
EN/PT**, and a dependency-free **UI test harness**.

Recent commits (see `git log` for the full list): F4b board-size Pareto, F5 net split/merge,
T1 UI tests (DOM shim), L1 MIT LICENSE, 4a zoom/pan, 4b/4c/4d UI polish, 4e Save-As dialog,
4f light theme + i18n, user `MANUAL.md` + `docs/SCREENSHOTS.md`.

### Lost in the rename / fresh-start, and status

The directory rename itself moved nothing. The risk was the earlier **fresh-start rewrite**
(deleting the Python/stripboard-py prototype); audited against the 87 original prompts:

| Item | Old prototype | Now | Status |
|---|---|---|---|
| `AGENTS.md` + internal `docs/` | existed | restored | **Done**: `AGENTS.md` + `docs/` |
| Easy-to-assemble mode | weight preset | shipped | **Done** (F4a) |
| A whole Solve = one undo step | guaranteed | `Use this` snapshots first | **Done** (F2) |
| Hand-declared cuts/jumpers respected | not supported | supported | Done (improvement) |
| stripboard-py as headless oracle | used at runtime | not used | Intentional (D9) |

## Pending list (updated 2026-10-04)

| id | item | prio | cost | benefit |
|---|---|---|---|---|
| S2 | **Stronger search** (multi-start / simulated annealing) so Easy/Balanced/Compact separate reliably — the greedy limits S1's effect | P2 | L | M |
| ALT | **"Show alternatives"**: Pareto over (mode × size), list 3–5 non-dominated layouts; slow → server-side candidate | P2 | L | M |
| F9 | **Import netlist** (KiCad/gEDA/TinyCAD + mapping UI) — future version | P3 | L | M |

Discarded by request: **B8** (drag perf), **F11** (single-file ESP32), **extra UI languages**.
Rejected on review: cloud/login/collab, 3D, huge part library,
full schematic editor, framework/plugin system — keep it offline, tiny and focused.

Done (audit + backlog): B1–B7, B9–B12, U1–U3, F1–F8 (incl. F4a/F4b), M1, T1, L1, the four
UI-polish items (4a–4f), the naming/credit review items, **A1 electrical checks** (D31) and **S1 buildability terms**
(`jlen`/`crowd`, D32 — with the calibration caveat) and **R1a responsive layout** (drawers ≤980px)
and **R1b touch gestures** (pan/pinch/Box, D34), both desktop-safe. Full detail in
`docs/DECISIONS.md` (D13–D34).

## Intentionally out of scope

- Standalone SVG export (D4) — use Print/PDF + browser "Save as PDF".
- Schematic **editor** (D10) — view only; edit in KiCad via netlist export.
- Direct vector-PDF export — browser print dialog by design.
- Accessibility pass (WCAG) — skipped by request (4f excluded a11y).

## Known gaps / tech debt

- **UI test coverage is thin**: `tests/ui.test.js` drives a few interactions via a DOM shim
  (`tests/helpers/dom.mjs`); drag/marquee/pointer/dialog/print paths are still untested.
- **Optimizer is slow** on large boards (tens of seconds per mode, honestly reported with a
  timer); cooperative so it never freezes. A Web Worker could help later.
- **Print document body text** and **part labels** are English regardless of language.
- Autosave is per-browser (localStorage), not per-file; it mirrors the edit board only.
