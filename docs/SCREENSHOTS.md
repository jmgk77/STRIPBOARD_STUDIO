# Screenshots to capture for MANUAL.md

Developer/author task list (not user-facing). Put each PNG in `manual/img/` with the exact
filename below; `MANUAL.md` already references them, so dropping the file in place fills the
placeholder. Suggested: PNG, ~1200–1600 px wide, consistent theme (use **Dark** unless noted),
and crop to the relevant area.

Reference board: `docs/FIXTURES.md` (the pump shield). Build it once, then vary tab/toggles.

| # | Filename | What to show | How to set it up |
|---|---|---|---|
| 01 | `01-overview.png` | Whole app with a real board | Open the pump shield; **Edit** tab; a few parts + nets; left palette, center board, right panel all visible |
| 02 | `02-coordinates.png` | Row/column labels and one named hole | Zoom into the top-left of the board (wheel); point out a cell like `H7` (columns numbered, rows lettered, A at the bottom) |
| 03 | `03-palette.png` | Grouped palette + search + a custom bar | Type in **search parts**; expand **Custom** to show *New pin bar* results |
| 04 | `04-editing.png` | Properties of a selected part | Select a part; show **ref**, **value**, **group**, a named pin, and the actions Rotate/Lock/Duplicate/Delete |
| 05 | `05-span.png` | Bendable span in action | Select a resistor/capacitor; Shift-drag a lead so the span changes; show the Properties value |
| 06 | `06-multiselect.png` | Two+ parts selected at once | Shift-click a few terminals; show the "N parts selected" panel |
| 07 | `07-group.png` | Group dashed outline | Put `group = G1` on the P1–P8 terminals (or press `G`); select one → dashed box "group: G1" |
| 08 | `08-nets.png` | Net editing | Select a net (Nets tab or click a strip); show rename, pin chips with `✂`/`✕`, "Merge into" |
| 09 | `09-tools.png` | Cut + jumper + mounting hole on the board | Place one cut (`X`), one jumper (`J`), one mount (`M`); show all three on the board |
| 10 | `10-solve.png` | A solved board | Edit the pump shield, click **Solve**; show cuts (X), jumpers and the status line |
| 11 | `11-modes.png` | The result tabs | Show the vtab bar **Edit / Solve / Easy / Balanced / Compact / Crop** and a computed tab |
| 12 | `12-trim.png` | Board cropped | Compute a result, then **Crop**; show the smaller board with routing kept |
| 13 | `13-size.png` | Size… dialog with options | Click **Size…**, wait for the list, capture the non-dominated options with Apply buttons |
| 14 | `14-view-menu.png` | The open View menu | Open **View**; capture all checkboxes + Theme/Language selects |
| 15 | `15-copper-schematic.png` | Copper side and circuit view | One shot each (or a side-by-side): **copper side** (mirrored, faint parts) and **circuit view** |
| 16 | `16-mount-zones.png` | Mountable zones hatch | Enable **mountable zones**; show hatched idle copper areas; optionally select a net to compare |
| 17 | `17-zoom.png` | Zoomed/panned board | Zoom to ~200% and pan so the zoom % control is visible bottom-right |
| 18 | `18-problems.png` | Problems list | Create an issue (e.g. cut a net, or put a mount on a pin) so Problems shows a few entries |
| 19 | `19-print-dialog.png` | Print dialog | **Export → Print / PDF**; capture origin + section checkboxes |
| 20 | `20-print-output.png` | The printed sheet | Let the print window open; capture the copper/component side + BOM/steps (or save as PDF and screenshot page 1) |
| 21 | `21-export.png` | Netlist / ASCII dialogs | Open **Netlist…** (show format select) and **Text (ASCII)…** |
| 22 | `22-save.png` | Save As dialog | **Save As** → capture the dialog with the file-name field |
| 23 | `23-theme-language.png` | Theme + Language | Open **View**; show Theme (Auto/Light/Dark) and Language (Auto/English/Português). Capture one **light** shot too if possible |

Notes:
- If a feature changes, update **MANUAL.md** and this list together (like README).
- Keep filenames stable — the manual references them.
- Prefer showing the **standard pump shield** so screenshots stay consistent.
