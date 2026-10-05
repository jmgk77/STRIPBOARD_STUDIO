// Derive simple multimeter checks from a board so the print/assembly sheet can tell the
// builder what to verify: net continuity, isolation, per-cut separation, jumper and mounting
// hole checks. Pure; no DOM.

import { componentPins, rowLabel } from "./geometry.js";
import { jumperEndA, jumperEndB, splitPin } from "./model.js";

export function buildChecks(project, library) {
  const { cols, rows } = project;
  const cell = (x, y) => `${rowLabel(y, rows)}${x}`;
  const onBoard = (x, y) => x >= 1 && x <= cols && y >= 1 && y <= rows;

  // Nets with at least two pins actually placed on the board.
  const nets = [];
  for (const net of project.nets) {
    const placed = [];
    for (const key of [...net.pins].sort()) {
      const { ref, pin } = splitPin(key);
      const comp = project.components.get(ref);
      const part = comp && library.get(comp.part);
      if (!part) continue;
      const p = componentPins(comp, part).find((q) => q.id === pin);
      if (p && onBoard(p.x, p.y)) placed.push(key);
    }
    if (placed.length >= 2) nets.push({ id: net.id, label: net.label || net.id, pins: placed });
  }

  const cuts = [...project.cuts].sort().map((c) => {
    const [x, y] = c.split(",").map(Number);
    return { cell: cell(x, y), left: onBoard(x - 1, y) ? cell(x - 1, y) : null, right: onBoard(x + 1, y) ? cell(x + 1, y) : null };
  });

  const jumpers = project.jumpers.map((j) => {
    const a = jumperEndA(j);
    const b = jumperEndB(j);
    return { a: cell(a.x, a.y), b: cell(b.x, b.y), net: j.net || "" };
  });

  const mounts = [...(project.mountingHoles ?? [])].sort().map((c) => {
    const [x, y] = c.split(",").map(Number);
    return { cell: cell(x, y), left: onBoard(x - 1, y) ? cell(x - 1, y) : null, right: onBoard(x + 1, y) ? cell(x + 1, y) : null };
  });

  return { nets, cuts, jumpers, mounts };
}
