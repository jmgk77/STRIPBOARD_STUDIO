# Stripboard Studio

A browser tool for planning **shields** (ESP32, Arduino and similar) on traditional
continuous-copper stripboard.

The goal is narrow and personal: place modules and headers, say which pins connect to
which, see the physical board (component side and copper side) with the track cuts and
jumpers, catch wiring mistakes *before* soldering, and get a little help optimizing
placement and lead lengths. It is **not** a general-purpose EDA suite.

A guided, screenshot-by-screenshot walkthrough of every option is in
[`MANUAL.md`](MANUAL.md).

It runs on **desktop, tablet and phone**: on small screens the side panels become **drawers**
(the **Parts** / **Panel** buttons in the toolbar), and touch uses **drag to pan**, **pinch to
zoom** and a **Box** button for rubber-band select. The desktop layout and mouse behavior are
unchanged.

## Run

```bash
npm start                      # serves http://localhost:8080 (no dependencies, no build step)
# or, without npm:
node serve.mjs
python3 -m http.server 8080
```

Then open **http://localhost:8080**. ES modules need an HTTP origin, so do not open the
file directly (`file://`); if the browser caches old JS, hard-reload with Ctrl+Shift+R.

Everything is plain HTML/CSS/JavaScript with native ES modules and SVG. No framework, no
bundler, no TypeScript, no runtime dependencies.

## What it does

**Parts**
- The palette is grouped (**Recent / Discretes / Headers & terminals / ICs / Modules /
  Custom**) with a **search** box, so the list stays short as the library grows.
- Headers (1xN), **screw terminals** (2/3/4-way, 5.08 mm pitch), DIP-8/14/16, resistors,
  capacitors, LEDs, diodes, transistors, and modules (2x15, 2x10, 1x8).
- **+ New pin bar**: create a single- or double-row bar with a configurable pin count and
  row gap (in holes); custom bars can be **edited (✎) or deleted (✕)** from the palette.
  Saved in the project and rebuilt on load.
- **Presets**: ESP32 DevKit V1 (30-pin), Arduino Nano, ULN2803 (DIP-18) and a PCF8574
  module (pin names are a starting point — rename to match your board).
- Every part has a physical **body** used for drawing and collision, and a `wiresUnder`
  flag: when false (headers, terminals, DIP) the router never runs a jumper under it;
  elevated parts (discretes, modules on headers) allow wires underneath.

**Editing**
- Drag to move, `R` rotate (0/90/180/270), `L` lock, `Delete` remove, `Ctrl+D` duplicate. The
  same actions (**Rotate / Lock / Duplicate / Delete**) are on the selected object in the
  **Properties** panel.
- **Multi-select**: **Shift+click** a part to add/remove it, or **drag on the empty board** to
  rubber-band select. Move / `R` / `L` / `Delete` / `Ctrl+D` / `G` then act on the whole
  selection (Properties shows "N parts selected"). Shift-drag a bendable lead still edits span.
- Editable **reference** (rename `J11` to `entrada energia`; nets follow), per-part
  **value** (fed into the BOM and print sheet), and per-pin **names** (`U1.GPIO4`).
- Two-lead parts are **bendable**: a per-instance **span** (min 2 holes) you can change.
- **Groups (semi-locked)**: give two or more parts the same **group** name in Properties and
  they stay rigidly fixed *relative to each other*, while the whole cluster can still be
  moved (drag any member) and optimized (Solve translates the group as one unit). All
  members must be unlocked — any locked member fixes the entire group. Selecting a member
  outlines the whole cluster with a dashed box.
  - Fast workflow: select a part, press **`G`** to start a group (`G1`), select the next and
    press `G` again to add it; press `G` on an existing member to make that group active;
    **`Shift+G`** removes the selected part; **`Esc`** ends the group session.
- Board resize never moves parts; **Crop** fits the board to the content (bodies,
  cuts, jumpers and mounting holes included) — it only crops unused margins and **keeps the
  existing routing** (shifted, not re-solved).

**Nets**
- **Connect** by clicking two pins, or add pins to the selected net.
- A net is a first-class selection: click a single-net strip or a ratsnest line on the
  board to select it, or click it in the **Nets** tab. The selected net shows in
  **Properties** (rename, pin chips, delete) and lights its pins, strips and jumpers.
- Rename a net, list its pins as **chips** (remove `✕` or **split `✂`** one pin into a new
  net), delete a net, and `Delete` removes the selected net too.
- **Merge** a net into another with the "Merge into" selector; **split** several pins at once
  by selecting their **components** (multi-select) and pressing "Split selected pins".

**Wires & cuts**
- Jumpers and cuts are first-class objects: click to select, drag to move, `Delete` to
  remove. `L` (or **Fix/Unfix** on the selected object in Properties) pins or releases one;
  fixed objects are kept by Solve, and a row with a fixed cut is left to the user.
- **Add by hand**: the **Cut** tool cuts the strip at a clicked hole (click it again to
  remove the cut); the **Jumper** tool draws a vertical wire between two clicked holes in
  the same column and then returns to Select. Hand-placed objects are **fixed** by default.
  Bad spots are refused (a pin in the hole, another jumper ending there, a flush body
  overhead).
- **Mounting holes**: the **Mount** tool places a chassis screw hole (default **Ø3.2 mm**,
  `mountDiameter`). It **cuts the strip** (no copper there) — the copper is drawn **broken**
  there, so the net highlight matches the electrical reality — and is a keep-out for pins and
  jumper ends; click again to remove it. Adding/removing one **invalidates the routing**
  (re-run Solve). Drawn as a larger circle with a crosshair, on both sides, and listed with
  its own drill step on the print sheet.
- **Delete stays deleted**: removing a cut/jumper also tells Solve not to put that exact
  one back (a "tombstone"), so re-solving does not resurrect it.
- **Properties** shows the selected jumper (net, endpoints as letter+number, length,
  fixed/auto) or cut (position, fixed/auto) with Fix/Unfix and Delete.

**Solve / Easy / Balanced / Compact**
- **Solve**: a small maze router chooses track **cuts** and **jumper** wires, including
  detours for crossovers. Fixed (user-edited) jumpers/cuts are respected. Cuts are then
  **aligned**, where possible, into one column so they can be made in a single straight pass.
- **Easy**: greedy pass over unlocked parts (rotations, moves, lead spans) that strongly
  prefers **few jumpers** (the fiddly part to build) and some breathing room — easier to
  assemble even if the board is a little larger.
- **Balanced**: same, with an even trade of jumpers, cuts, size and wirelength.
- **Compact**: same, but strongly prefers a small board (pulls the free cluster together and
  shrinks leads).
- The three are **one objective with three weight presets** (same search budget), not three
  algorithms — so they differ only by what they value, not by how long they search. **Easy**
  also avoids long jumpers and crowded parts; **Compact** tolerates both to save board space.
- Optimization runs **cooperatively** (it yields to the browser), so a long Compact pass takes
  its time without freezing the tab — no time limit is imposed. A live **elapsed-time counter**
  (e.g. "Computing compact… 12s") shows while a tab computes.
- **Diagonal jumpers** (View menu, **off** by default) let the router span two columns with one
  wire when a straight vertical one cannot connect (or costs more). They are drawn slanted and
  cost more, so copper/vertical are still preferred; the honest vertical-only model is default.
- **Size…** (next to the version tabs) searches board sizes and lists the **non-dominated
  trade-offs** — "25×23 with 17 jumpers" vs "30×23 with 16 jumpers" — then **Apply** swaps in
  the chosen board. It is slow (each option is optimized + routed) but runs cooperatively.

**Version tabs** (above the board): **Edit / Solve / Easy / Balanced / Compact / Crop**. Clicking a
tab computes it once (with a spinner) and caches it, so you can flip between them; result
tabs are **read-only** (edits are disabled) — press **Use this** to copy a result into the
Edit board (a single undoable step: `Ctrl+Z` returns to the previous board). Editing the
board invalidates the cached results (they recompute on demand).

**See it / check it**
- Component side and mirrored **copper side** (which also moves the coordinate labels to
  the mirrored edges); on the copper side parts are drawn as **faint ghosts** so the copper,
  cuts and jumpers stay readable; small labels (columns numbered, rows lettered, **A at the bottom**);
  a faint 5x5-hole grid; a **View** menu in the toolbar to show/hide parts, wires, cuts,
  copper, nets, grid, plus copper-side, pin names, circuit view, **mountable zones** and
  **diagonal jumpers** (a routing option) — and **Theme** (Auto/Light/Dark, follows the OS) and
  **Language** (Auto/English/Português; the whole interface — chrome, panels, status messages
  and problem messages — switches language; the generated print sheet stays English).
- **Mountable zones** (on by default; toggle in View): **hatch the cells where a mounting hole
  would not affect any net**. A cell is safe only if the copper run has no connection point on
  both sides of it — connection points are net pins **and jumper ends**, so a run that carries
  a net via a jumper is not hatched. Jumper arcs (and pins, and flush bodies) are excluded too.
- The **connections** (ratsnest) are shown before solving; tick **connections (always)** in
  the View menu to keep the intended wiring visible after a Solve — the initial connection
  view is never lost.
- The board defaults to **55x24 (A1-X55)** — change Cols/Rows any time.
- Solve keeps off a **flush body**: jumpers never run under a component whose
  `wiresUnder` is false (headers, terminals, DIP); elevated parts (discretes, modules on
  headers) allow wires underneath.
- **Problems** panel (shorts, open nets, overlaps, off-board pins, jumpers under a flush
  body, mounting holes on a pin or under a body, no room to cut, spare pins, one-pin nets),
  each position shown as **letter+number** (e.g. `C3`), clickable to highlight the net or
  component.
- **Export** menu:
  - **Print / PDF** — opens a dialog: a label **origin** (default `A1`; e.g. `F15`) plus
    **checkboxes for the sections** you want — component side, copper side (mirrored, no
    parts), mounting holes, cuts, jumpers, BOM, assembly steps and **electrical checks**. Print only what
    you need. The **mounting-holes** section lists the **centre-to-centre distances in mm**
    (and each hole's X/Y from the board corner) — useful for designing an enclosure/support. Output is **true size** (one hole = 2.54 mm; print at 100% — no 'fit to page'),
    in **black & white**. (Scale relies on the browser print dialog; a direct vector-PDF
    export is not built yet.)
  - **Netlist** (JSON / SPICE / KiCad, copy or download) and **Text** (ASCII dump).
- **Circuit view** (checkbox in View): a basic read-only symbolic drawing — IEC-style symbols.
  It is a view of the existing netlist, not a schematic editor; edit schematics in KiCad and
  export the netlist.
  A 2-pin net is drawn as a **wire** when it can be a clean straight run; complex nets use
  **net labels** (name or number). Click a symbol or wire to select.

**Persistence**
- Human-readable JSON: **New / Open / Save / Save As** (Save asks for a name the first
  time), undo/redo, custom parts carried in the project.
- A **saved / ● unsaved** indicator sits next to Save, and **Undo/Redo** buttons (disabled when
  there is nothing to undo/redo).
- Saves **never overwrite**: the app reuses no name it has already written and appends
  `(1)`, `(2)`, … so repeated saves produce separate files. (The browser cannot see your
  Downloads folder, so on a real file-name collision it may also add its own suffix.)
- **Autosave**: the edit board is mirrored to browser `localStorage` and recovered on the
  next load (with a status note), so a reload or crash does not lose work. Unsaved changes
  are also guarded: New/Open asks for confirmation and the browser warns on unload.

## Coordinate reference

1-based grid, origin `(1, 1)`. **Columns are numbered** (1..n, left to right) and **rows
are lettered** (A..; A is the **bottom** row, spreadsheet style, `AA` past 26). A cell is
written `H7` = row H, column 7. Strips run along `x`; a part's leads run down a column.

## Interaction model

- **One primary selection at a time**: a component, a jumper, a cut, or a net. Selecting
  one clears the others; clicking the same thing again toggles it off; empty click and
  `Esc` clear everything.
- The **highlighted nets are derived** from the selection: a selected component lights all
  its nets, a selected jumper its net, a selected net itself. Chips, net rows, strips,
  ratsnest and pin rings all agree.
- Everything clickable has a pointer cursor and a subtle hover highlight.

## Keyboard shortcuts

Treated as a **stable interface** (frozen); documented here on purpose.

| Key | Action |
|---|---|
| `V` | select tool |
| `Shift`+click a part | add/remove it from the multi-selection |
| drag on empty board | rubber-band (marquee) select |
| `C` | connect tool |
| `X` / `J` / `M` | cut / jumper / mount tool (toggle) |
| `R` / `Shift+R` | rotate +90° / -90° |
| `L` | lock/unlock a part, or fix/unfix a jumper/cut |
| `G` | add selected part to the active group (creates `G1`… if none); pressing it on a grouped part makes that group active |
| `Shift+G` | remove the selected part from its group |
| `Ctrl+D` | duplicate the selected part (same value/pins/span/rot and group, placed next to it) |
| `Delete` / `Backspace` | delete the selection (component, jumper, cut or net) |
| Arrows | nudge the selected component one hole |
| `Esc` | clear selection / cancel connect or a pending jumper / end the group session |
| `Shift`+drag a lead (or `Alt`+drag) | change a bendable part's span |
| wheel / `+` / `−` / `0` | zoom at the cursor / zoom in / zoom out / fit |
| middle-drag or `Space`+drag | pan the board (zoom % shown bottom-right) |
| `Ctrl+Z` / `Ctrl+Y` (`Ctrl+Shift+Z`) | undo / redo |
| `Ctrl+S` / `Ctrl+Shift+S` | save / save as |
| `Ctrl+O` / `Ctrl+N` | open / new |
| `Ctrl+R` | solve |
| `Ctrl+Shift+O` / `Ctrl+Shift+C` / `Ctrl+Shift+E` | balanced / compact / easy optimize |
| `Ctrl+Shift+T` | crop to content (removes unused margins, keeps routing) |

Resize the board by dragging the blue handles on its right and bottom edges.

## Roadmap (not implemented yet)

- **Import a netlist** (KiCad/gEDA/TinyCAD) so an existing schematic can be brought in.

Standalone SVG export is intentionally out of scope: use **Print / PDF (1:1)** and the
browser's "Save as PDF", or the **Netlist**/**Text** exports.

Developer notes live in [`AGENTS.md`](AGENTS.md) and [`docs/`](docs/).

## Notes / credits

Ideas were taken from the prior art (read, not copied): `stripboard-py` (MIT) for the
derived-cut / net-diameter model, `boardwright` (MIT) for the JSON-as-source and
two-sided render approach, and VeroRoute / DIYLC / stripboard-editor (GPL) for UX
inspiration only. No GPL code is used here.



## License

MIT — see [`LICENSE`](LICENSE) (© 2026 JMGK).
