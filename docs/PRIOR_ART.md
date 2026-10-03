# Prior art & paradigm comparison (internal)

How Stripboard Studio compares to the tools that informed it. This is a dev-facing analysis,
not marketing. Reconstructed from the original research session
(`ses_f089fb7f9ffe3xKlGlJFq4h0Bl`) plus the current implementation. Recheck periodically;
the field moves.

## The two paradigms

1. **Manual WYSIWYG drawing/checking** — the human is the solver; the tool is a smart
   canvas (VeroRoute, DIYLC, stripboard-editor, KiCad/Fritzing). They draw and often DRC,
   but do **not** choose placement/orientation or optimize cuts/jumpers.
2. **Headless netlist → layout compiler** — the tool is the solver (stripboard-py). It
   routes a netlist, but auto-placement is immature and there is no interactive editor.

**Our paradigm is a hybrid:** an interactive editor (paradigm 1) with a human-in-the-loop
optimizer that places/rotates/bends parts and routes cuts/jumpers while respecting *fixed*
objects (paradigm 2), in a zero-install browser. That combination is the niche.

## Capability matrix

| Tool | Stack / license | Place | Rotate | Route | Respects edited jumper/cut | Optimizes size | Interactive | Import |
|---|---|---|---|---|---|---|---|---|
| VeroRoute | Qt/C++, **GPL-3.0** | manual | yes | interactive (human-guided) | only what you draw | no | good | netlist, big library |
| DIYLC | Java, **GPL-3.0** | manual | yes | no | — | no | good | many formats, huge library |
| stripboard-editor | Next.js+Django, **GPL-3.0** | manual drag | yes | no (live DRC + strip colour) | — | no | good | small |
| stripboard-py | Python, **MIT** | heuristic (immature) | 180° only | yes (maze + rip-up) | **no** (TODO 2.4 / 1.8) | no (dims as inputs) | **none** | netlist |
| boardwright | Python, **MIT** | manual (perfboard) | — | maze (perfboard) | — | no | none | netlist |
| **Stripboard Studio** | **Browser, JS/SVG, no deps** | **manual + auto (Easy/Balanced/Compact)** | **0/90/180/270** | **yes, with detours + opt-in diagonals** | **yes** (fixed cuts/jumpers) | **Compact/Trim + Pareto size search** | **good** (multi-select, groups, zoom) | **export only** |

## Where we are already better

- **Web / zero-install, zero runtime dependencies, no build.** Every established tool needs
  a desktop install; the Python library has no GUI.
- **Joint placement + orientation + lead-span + cuts + jumpers optimization** in one greedy
  loop — no prior-art tool offers this together.
- **Editable jumpers/cuts that the solver respects.** `stripboard-py` explicitly does not
  honor hand-declared links/cuts (its TODO 2.4/1.8); we seed fixed jumpers as zero-cost
  edges and keep fixed cuts.
- **4 rotations** vs. stripboard-py's 180°-only.
- **Three optimization presets** (Easy/Balanced/Compact) and a **board-size Pareto search** that
  lists the non-dominated size↔jumpers/cuts trade-offs — no prior-art tool offers this.
- **Groups / semi-locked clusters**, **multi-selection + marquee**, duplicate, nudge, tombstoned
  deletes, and **crossovers without external wires** (crossover via jumpers).
- **Fix-and-rerun + cached result tabs** (Edit/Solve/Easy/Balanced/Compact/Trim), one primary
  selection, derived highlighting, `Use this` as one undo step.
- **Dual side (component + mirrored copper)**, DRC with letter+number positions, netlist
  export (JSON/SPICE/KiCad), ASCII dump, 1:1 print with origin, BOM and assembly steps,
  and **mounting holes with mm geometry** + **mountable-zone hatching**.
- **Editor comforts**: zoom/pan, hover info, tool hotkeys, saved indicator, undo/redo buttons,
  light/dark theme, EN/PT interface — plus a **90-test** suite including a dependency-free UI
  harness.
- **Honest model**: one authoritative connectivity engine, `wiresUnder` keepout enforced in
  both router and DRC, diagonal jumpers opt-in (vertical stays the default), autosave.

## Where we lose

- **Maturity/robustness.** Our router is a small greedy maze router; dense boards can report
  `unreachable`. stripboard-py has a near-exhaustive + rip-up/reroute router; VeroRoute/DIYLC
  have years of edge-case hardening.
- **Auto-placement quality.** Our optimizer is greedy hill-climb (no simulated annealing),
  so it finds decent-but-not-optimal layouts. (stripboard-py's is also immature, so this is
  a "not yet great" rather than a strict loss.)
- **Import.** We export netlists but cannot import one (F9, future); DIYLC/VeroRoute import
  KiCad/gEDA/TinyCAD and ship large component libraries. Ours is a small curated set by design.
- **Schematic.** Ours is a basic read-only view; full tools have real schematic editors
  (we deliberately export to KiCad instead).
- **Print.** We rely on the browser print dialog (no direct vector PDF); mature tools emit
  PDF/precision output directly.
- **Copy/paste** between boards is not implemented (multi-select, group move and Save As are).

## Grounded gaps (referenced elsewhere)

- Import remains the main functional gap (F9); everything else from the prototype is restored
  (three optimization presets, undo of a whole Solve, manual Cut/Jumper/Mount, groups).
- AGENTS.md and the old internal `docs/` existed in the deleted prototype; restored here.

## Licensing position

No third-party code in the repo. Ideas only: stripboard-py (MIT) for derived-cut /
net-diameter modeling, boardwright (MIT) for JSON-as-source and two-sided render,
VeroRoute/DIYLC/stripboard-editor (GPL-3.0) for UX inspiration. See `README.md` credits.
