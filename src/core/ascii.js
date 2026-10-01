// A plain-text (ASCII) rendering of the board: strips, cuts, jumpers, pins and a legend.
// Meant for debugging and for pasting into a chat -- the whole physical state in text.

import { contentBounds, componentPins } from "./geometry.js";
import { pinLabel } from "./model.js";

const SYMBOLS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function toAscii(project, library, { margin = 1 } = {}) {
  const { cols, rows } = project;
  const bounds = contentBounds(project, library) ?? { x0: 1, y0: 1, x1: cols, y1: rows };
  const x0 = Math.max(1, bounds.x0 - margin);
  const y0 = Math.max(1, bounds.y0 - margin);
  const x1 = Math.min(cols, bounds.x1 + margin);
  const y1 = Math.min(rows, bounds.y1 + margin);

  // one symbol per component
  const symbol = new Map();
  [...project.components.values()].forEach((c, i) => symbol.set(c.ref, SYMBOLS[i % SYMBOLS.length]));

  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const grid = Array.from({ length: h }, () => Array.from({ length: w }, () => "-"));
  const at = (x, y) => {
    const cx = x - x0;
    const cy = y - y0;
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return null;
    return { cx, cy };
  };

  for (const c of project.cuts) {
    const [x, y] = c.split(",").map(Number);
    const p = at(x, y);
    if (p) grid[p.cy][p.cx] = "x";
  }
  for (const j of project.jumpers) {
    for (const yy of [j.ya, j.yb]) {
      const p = at(j.x, yy);
      if (p) grid[p.cy][p.cx] = "o";
    }
    for (let yy = j.ya + 1; yy < j.yb; yy++) {
      const p = at(j.x, yy);
      if (p) grid[p.cy][p.cx] = "|";
    }
  }
  for (const comp of project.components.values()) {
    const part = library.get(comp.part);
    if (!part) continue;
    for (const pin of componentPins(comp, part)) {
      const p = at(pin.x, pin.y);
      if (p) grid[p.cy][p.cx] = symbol.get(comp.ref);
    }
  }

  const lines = [];
  lines.push(`${project.title}  ${cols}x${rows}  (showing cols ${x0}-${x1}, rows ${y0}-${y1})`);
  const pad = " ".repeat(String(y1).length + 2);
  const tens = pad + Array.from({ length: w }, (_, i) => {
    const c = x0 + i;
    return Math.floor(c / 10) % 10;
  }).join("");
  const units = pad + Array.from({ length: w }, (_, i) => (x0 + i) % 10).join("");
  lines.push(tens);
  lines.push(units);
  for (let y = y0; y <= y1; y++) {
    lines.push(`${String(y).padStart(String(y1).length)}  ` + grid[y - y0].join(""));
  }

  lines.push("");
  lines.push("legend:  - copper strip   x cut   o jumper end   | jumper arc");
  lines.push("");
  lines.push("components:");
  for (const comp of project.components.values()) {
    const part = library.get(comp.part);
    if (!part) continue;
    const pins = componentPins(comp, part)
      .map((p) => {
        const name = comp.pinNames?.[p.id];
        return `${p.id}=(${p.x},${p.y})${name ? ` "${name}"` : ""}`;
      })
      .join(" ");
    const lock = comp.locked ? " locked" : "";
    const span = part.bendable ? ` span=${comp.span || part.bendable.default}` : "";
    lines.push(`  ${symbol.get(comp.ref)} ${comp.ref} ${comp.part}@(${comp.x},${comp.y}) rot${comp.rot}${span}${lock}  pins: ${pins}`);
  }
  lines.push("");
  lines.push("nets:");
  if (project.nets.length === 0) lines.push("  (none)");
  for (const net of project.nets) {
    lines.push(`  ${net.id}: ${[...net.pins].sort().map((k) => pinLabel(project, k)).join(", ")}`);
  }
  lines.push("");
  lines.push(`cuts: ${[...project.cuts].sort().join(" ") || "(none)"}`);
  lines.push(
    `jumpers: ${project.jumpers.map((j) => `${j.x}:${j.ya}-${j.yb}`).join(" ") || "(none)"}`,
  );
  return lines.join("\n");
}
