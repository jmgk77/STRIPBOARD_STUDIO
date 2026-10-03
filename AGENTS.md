# AGENTS.md — agent/human guide

Stripboard Studio: a browser tool that turns a small circuit into a practical, human-buildable
stripboard / Veroboard layout. Plain ES modules + SVG. No framework, no build step.

This file is the entry point for any agent working here. Deeper notes:
`docs/STATUS.md` (where we are, pending list), `docs/DECISIONS.md` (why),
`docs/REQUIREMENTS.md` (master-prompt traceability), `docs/PRIOR_ART.md` (how we compare
to existing tools), `docs/FIXTURES.md` (the standard test board) and `docs/SCREENSHOTS.md`
(the shot list for the user-facing `MANUAL.md`). `README.md` and `MANUAL.md` are user-facing;
everything under `docs/` and this file are developer-facing. `README.md` is **user-facing**; keep it in sync with shipped behavior.

## Commands

```bash
npm start        # static server on http://localhost:8080 (serve.mjs; no deps)
npm test         # node --test tests/*.test.js
node --check src/ui/app.js   # quick syntax check when touching the UI
```

No `install`, no bundler, no TypeScript. ES modules need an HTTP origin (not `file://`).

## Non-negotiable architecture rules

1. `src/core/` never touches the DOM; it stays pure and unit-tested (`node --test`).
2. **One authoritative connectivity model** — UI, router, optimizer and DRC all ask
   `connectivity.analyze`. Never re-derive "what is connected" elsewhere.
3. Physical model is exactly: strips split by cuts; a jumper is a vertical wire; pins sit
   in holes. Keep it honest.
4. Never silently rearrange the user's layout; optimization is an explicit action.
5. Fixed objects (locked parts, fixed jumpers/cuts) are never modified by Solve/Optimize.
6. `core/` must not import from `ui/`; `ui/` may import from `core/`.

## Layout

```
index.html, styles.css
serve.mjs                 static dev server
src/core/                 pure logic (tested)
  model.js                Project / Component / Net, JSON
  geometry.js             rotations, pin/body placement, row letters, bounds
  library.js              part definitions (keep it small; add as needed)
  connectivity.js         single copper model + DRC (analyze)
  router.js               maze Solve: cuts and jumpers
  optimize.js             greedy placement/span optimizer (Easy/Balanced/Compact presets)
  align.js                line up routed cuts into one column
  pareto.js               non-dominated frontier (board-size search)
  checks.js               multimeter check lists for the assembly sheet
  netlist.js, ascii.js    exports
src/ui/                   DOM
  scene.js                SVG board render (no app state)
  schematic.js            read-only schematic
  i18n.js                 EN/PT dictionaries + t()/applyStatic()
  app.js                  state, interactions, panels, autosave, print/export
src/main.js               bootstrap
tests/                    node --test, one file per core module (+ tests/helpers/dom.mjs shim)
docs/                     internal notes (see list above)
manual/                   images for the user-facing MANUAL.md
```

## Conventions

- 1-based grid. Columns numbered left→right; rows lettered **A at the bottom**, `AA` past
  Z. A cell is `H7` = row H, column 7. Strips run along x; a part's leads run down a column.
- Pin identity is `"REF.PIN"` (refs never contain `.`). `Component.value` feeds the BOM.
- Custom pin bars are stored in `project.customParts` and rebuilt via `buildBarPart`.
- `wiresUnder` on a `PartDef`: false (headers/terminals/DIP) means the router never runs a
  jumper under it, and `analyze` reports `jumper-under-body` if one does.
- Comments explain *why*, not *what*; match the existing tone (sparse, technical).
- UI edits: snapshot before mutating (`this.snapshot()`), then `_afterStructuralChange`.
  New lasting logic belongs in `core/` with a test, not in `app.js`.

## Adding a part

Add a `PartDef` in `src/core/library.js` (pins in local coords, optional `body`,
`bendable` span, `wiresUnder`). Schematic/glyph drawing is in `src/ui/scene.js`
(`drawGlyph`). To expose a preset dev board, add pins + `body` + `wiresUnder: true`.

## Dependency policy

Prefer browser-native APIs. Add a dependency only when it clearly beats ~a page of our own
code; check license (no GPL code) and transitive deps. Today there are **zero** runtime
dependencies.

## Before you finish

- Run `npm test` (must stay green) and update `README.md` (user-facing) plus the relevant
  `docs/` file (STATUS/DECISIONS) when behavior or decisions change.
