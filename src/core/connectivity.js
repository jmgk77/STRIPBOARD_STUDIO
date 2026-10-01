// The single authoritative copper model.
//
// Physical truth: each row is one continuous copper strip, broken at any cell listed in
// `cuts`; a jumper is a vertical wire joining (x,ya) to (x,yb); every component pin sits
// in a hole. Two pins are connected iff their cells end up in the same copper region.
//
// Everything else in the app (UI, router, DRC) must ask this module rather than re-deriving
// connectivity elsewhere.

import { componentPins } from "./geometry.js";
import { pinKey } from "./model.js";

export const cellId = (x, y) => `${x},${y}`;
export const parseCell = (c) => {
  const [x, y] = c.split(",").map(Number);
  return { x, y };
};

class DSU {
  constructor() {
    this.parent = new Map();
  }
  find(a) {
    if (!this.parent.has(a)) this.parent.set(a, a);
    let root = a;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    while (this.parent.get(a) !== root) {
      const next = this.parent.get(a);
      this.parent.set(a, root);
      a = next;
    }
    return root;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/**
 * Analyze a project against the physical model.
 * @returns {{ ok: boolean, issues: object[], unconnected: object[], shorts: object[],
 *             pinNode: Map<string,string>, regionNets: Map<string,Set<string>> }}
 */
export function analyze(project, library) {
  const { cols, rows } = project;
  const present = (x, y) => x >= 1 && x <= cols && y >= 1 && y <= rows && !project.cuts.has(cellId(x, y));

  const dsu = new DSU();
  for (let y = 1; y <= rows; y++) {
    for (let x = 1; x < cols; x++) {
      if (present(x, y) && present(x + 1, y)) dsu.union(cellId(x, y), cellId(x + 1, y));
    }
  }

  const issues = [];

  for (const j of project.jumpers) {
    for (const [x, y] of [[j.x, j.ya], [j.x, j.yb]]) {
      if (!present(x, y)) {
        issues.push({ level: "error", code: "jumper-off-copper", message: `jumper end (${x},${y}) is off the board or on a cut` });
      }
    }
    if (present(j.x, j.ya) && present(j.x, j.yb)) dsu.union(cellId(j.x, j.ya), cellId(j.x, j.yb));
  }

  const pinNode = new Map();
  const pinPos = new Map();
  for (const comp of project.components.values()) {
    const part = library.get(comp.part);
    if (!part) {
      issues.push({ level: "error", code: "unknown-part", message: `component ${comp.ref} uses unknown part ${comp.part}` });
      continue;
    }
    for (const p of componentPins(comp, part)) {
      const key = pinKey(comp.ref, p.id);
      pinPos.set(key, { x: p.x, y: p.y });
      if (p.x < 1 || p.x > cols || p.y < 1 || p.y > rows) {
        issues.push({ level: "error", code: "pin-off-board", message: `${key} is off the board at (${p.x},${p.y})` });
        continue;
      }
      if (project.cuts.has(cellId(p.x, p.y))) {
        issues.push({ level: "error", code: "pin-on-cut", message: `${key} sits on a cut at (${p.x},${p.y})` });
      }
      pinNode.set(key, dsu.find(cellId(p.x, p.y)));
    }
  }

  const unconnected = [];
  const regionNets = new Map(); // region root -> set of net ids present there
  for (const net of project.nets) {
    const roots = new Set();
    let placed = 0;
    for (const key of net.pins) {
      const node = pinNode.get(key);
      if (node === undefined) continue;
      placed += 1;
      roots.add(node);
      const set = regionNets.get(node) ?? new Set();
      set.add(net.id);
      regionNets.set(node, set);
    }
    if (placed >= 2 && roots.size > 1) {
      unconnected.push({ level: "error", code: "net-open", message: `net ${net.id} is split across ${roots.size} copper regions` });
    }
  }

  const shorts = [];
  for (const [node, nets] of regionNets) {
    if (nets.size > 1) shorts.push({ level: "error", code: "short", message: `different nets share copper (${node}): ${[...nets].join(", ")}` });
  }

  // Physical collisions that make a board unbuildable.
  const occ = new Map();
  const add = (x, y, item) => {
    const list = occ.get(cellId(x, y)) ?? [];
    list.push(item);
    occ.set(cellId(x, y), list);
  };
  for (const [key, pos] of pinPos) add(pos.x, pos.y, { kind: "pin", key });
  project.jumpers.forEach((j, i) => {
    add(j.x, j.ya, { kind: "jumper", i, end: true });
    add(j.x, j.yb, { kind: "jumper", i, end: true });
    for (let y = j.ya + 1; y < j.yb; y++) add(j.x, y, { kind: "jumper", i, arc: true });
  });
  for (const [cell, items] of occ) {
    const ends = items.filter((i) => i.kind === "jumper" && i.end);
    const arcs = items.filter((i) => i.kind === "jumper" && i.arc);
    const pins = items.filter((i) => i.kind === "pin");
    if (ends.length > 1) issues.push({ level: "error", code: "jumper-collision", message: `two jumpers share the hole at ${cell}` });
    if (ends.length && pins.length) issues.push({ level: "error", code: "jumper-on-pin", message: `a jumper end lands on a pin at ${cell}` });
    if (arcs.length && pins.length) issues.push({ level: "error", code: "jumper-over-pin", message: `a jumper arcs through a pin at ${cell}` });
    if (arcs.length && ends.length) issues.push({ level: "error", code: "jumper-overlap", message: `a jumper overlaps another jumper at ${cell}` });
    if (pins.length > 1) issues.push({ level: "error", code: "pin-collision", message: `two pins share the hole at ${cell}` });
  }

  const all = [...issues, ...unconnected, ...shorts];
  return { ok: all.every((i) => i.level !== "error"), issues: all, problems: issues, unconnected, shorts, pinNode, regionNets };
}
