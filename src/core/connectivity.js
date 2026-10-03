// The single authoritative copper model.
//
// Physical truth: each row is one continuous copper strip, broken at any cell listed in
// `cuts`; a jumper is a vertical wire joining (x,ya) to (x,yb); every component pin sits
// in a hole. Two pins are connected iff their cells end up in the same copper region.
//
// Everything else in the app (UI, router, DRC) must ask this module rather than re-deriving
// connectivity elsewhere.

import { componentBody, componentPins, rowLabel } from "./geometry.js";
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
  const netLabel = new Map(project.nets.map((n) => [n.id, n.label || n.id]));
  // Board position as row letter + column number, e.g. C3.
  const at = (x, y) => `${rowLabel(y, rows)}${x}`;
  const atCell = (cell) => {
    const [x, y] = cell.split(",").map(Number);
    return at(x, y);
  };
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
        issues.push({ level: "error", code: "jumper-off-copper", message: `jumper end ${at(x, y)} is off the board or on a cut` });
      }
    }
    if (present(j.x, j.ya) && present(j.x, j.yb)) dsu.union(cellId(j.x, j.ya), cellId(j.x, j.yb));
  }

  const pinNode = new Map();
  const pinPos = new Map();
  const compBox = new Map(); // ref -> bounding box of its pins (collision proxy)
  for (const comp of project.components.values()) {
    const part = library.get(comp.part);
    if (!part) {
      issues.push({ level: "error", code: "unknown-part", message: `component ${comp.ref} uses unknown part ${comp.part}` });
      continue;
    }
    const body = componentBody(comp, part);
    if (body) {
      compBox.set(comp.ref, body);
    } else {
      const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      for (const p of componentPins(comp, part)) {
        box.x0 = Math.min(box.x0, p.x);
        box.y0 = Math.min(box.y0, p.y);
        box.x1 = Math.max(box.x1, p.x);
        box.y1 = Math.max(box.y1, p.y);
      }
      if (box.x0 !== Infinity) compBox.set(comp.ref, box);
    }
    for (const p of componentPins(comp, part)) {
      const key = pinKey(comp.ref, p.id);
      pinPos.set(key, { x: p.x, y: p.y });
      if (p.x < 1 || p.x > cols || p.y < 1 || p.y > rows) {
        issues.push({ level: "error", code: "pin-off-board", ref: comp.ref, pin: p.id, message: `${key} is off the board at ${at(p.x, p.y)}` });
        continue;
      }
      if (project.cuts.has(cellId(p.x, p.y))) {
        issues.push({ level: "error", code: "pin-on-cut", ref: comp.ref, pin: p.id, message: `${key} sits on a cut at ${at(p.x, p.y)}` });
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
      unconnected.push({ level: "error", code: "net-open", netId: net.id, message: `net ${netLabel.get(net.id)} is split across ${roots.size} copper regions` });
    }
  }

  const shorts = [];
  for (const [node, nets] of regionNets) {
    if (nets.size > 1) shorts.push({ level: "error", code: "short", netIds: [...nets], message: `different nets share copper at ${atCell(node)}: ${[...nets].map((id) => netLabel.get(id)).join(", ")}` });
  }

  // Design warnings (not fatal): spare pins and pointless one-pin nets.
  const assigned = new Set();
  for (const net of project.nets) for (const key of net.pins) assigned.add(key);
  const unassigned = [...pinPos.keys()].filter((k) => !assigned.has(k));
  if (unassigned.length) {
    const sample = unassigned.slice(0, 6).join(", ");
    issues.push({
      level: "warn",
      code: "unconnected-pins",
      message: `${unassigned.length} pin(s) not connected to any net: ${sample}${unassigned.length > 6 ? ", …" : ""}`,
    });
  }
  for (const net of project.nets) {
    if (net.pins.size === 1) {
      issues.push({ level: "warn", code: "single-pin-net", netId: net.id, message: `net ${netLabel.get(net.id)} has only one pin` });
    }
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
    if (ends.length > 1) issues.push({ level: "error", code: "jumper-collision", message: `two jumpers share the hole at ${atCell(cell)}` });
    if (ends.length && pins.length) issues.push({ level: "error", code: "jumper-on-pin", message: `a jumper end lands on a pin at ${atCell(cell)}` });
    if (arcs.length && pins.length) issues.push({ level: "error", code: "jumper-over-pin", message: `a jumper arcs through a pin at ${atCell(cell)}` });
    if (arcs.length && ends.length) issues.push({ level: "error", code: "jumper-overlap", message: `a jumper overlaps another jumper at ${atCell(cell)}` });
    if (pins.length > 1) issues.push({ level: "error", code: "pin-collision", message: `two pins share the hole at ${atCell(cell)}` });
  }

  // Two components whose pin areas overlap would physically collide.
  const refs = [...compBox.keys()];
  for (let i = 0; i < refs.length; i++) {
    for (let j = i + 1; j < refs.length; j++) {
      const a = compBox.get(refs[i]);
      const b = compBox.get(refs[j]);
      if (a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1) {
        issues.push({ level: "error", code: "overlap", refs: [refs[i], refs[j]], message: `components ${refs[i]} and ${refs[j]} overlap` });
      }
    }
  }

  const all = [...issues, ...unconnected, ...shorts];
  return { ok: all.every((i) => i.level !== "error"), issues: all, problems: issues, unconnected, shorts, pinNode, regionNets };
}
