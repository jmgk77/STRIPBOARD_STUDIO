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

/** Contiguous copper runs on a row, split by cuts AND mounting holes (both break copper). */
export function copperRuns(project, y) {
  const mounts = project.mountingHoles ?? new Set();
  const runs = [];
  let start = null;
  for (let x = 1; x <= project.cols; x++) {
    const cell = cellId(x, y);
    if (!project.cuts.has(cell) && !mounts.has(cell)) {
      if (start === null) start = x;
    } else if (start !== null) {
      runs.push([start, x - 1]);
      start = null;
    }
  }
  if (start !== null) runs.push([start, project.cols]);
  return runs;
}

/**
 * Cells where drilling a mounting hole would NOT affect any net: the copper run has no
 * net-bearing pin on both sides of the cell (cutting a dead-end or an unused strip is
 * harmless). Cells holding a pin, a jumper end, or under a flush body are never listed.
 */
export function safeMountCells(project, library) {
  const { cols, rows } = project;
  const netPoint = new Set(); // cells where the copper is part of a connection (net)
  const blocked = new Set(); // pins, jumper ends, flush-body cells
  for (const comp of project.components.values()) {
    const part = library.get(comp.part);
    if (!part) continue;
    for (const p of componentPins(comp, part)) {
      const cell = cellId(p.x, p.y);
      blocked.add(cell);
      if (project.netOf(`${comp.ref}.${p.id}`)) netPoint.add(cell);
    }
    if (part.wiresUnder === false) {
      const b = componentBody(comp, part);
      if (b) {
        for (let yy = Math.max(1, b.y0); yy <= Math.min(rows, b.y1); yy++) {
          for (let xx = Math.max(1, b.x0); xx <= Math.min(cols, b.x1); xx++) blocked.add(cellId(xx, yy));
        }
      }
    }
  }
  for (const j of project.jumpers) {
    const lo = Math.min(j.ya, j.yb);
    const hi = Math.max(j.ya, j.yb);
    // The wire spans the whole column, so a screw there would collide: block it all.
    for (let y = lo; y <= hi; y++) blocked.add(cellId(j.x, y));
    // Its ends conduct the net onward, so they are connection points like net pins.
    netPoint.add(cellId(j.x, lo));
    netPoint.add(cellId(j.x, hi));
  }
  const safe = new Set();
  for (let y = 1; y <= rows; y++) {
    for (const [a, b] of copperRuns(project, y)) {
      const points = [];
      for (let x = a; x <= b; x++) if (netPoint.has(cellId(x, y))) points.push(x);
      for (let x = a; x <= b; x++) {
        const cell = cellId(x, y);
        if (blocked.has(cell)) continue;
        const left = points.some((px) => px < x);
        const right = points.some((px) => px > x);
        if (!left || !right) safe.add(cell); // cutting a dead-end / unused run is fine
      }
    }
  }
  return safe;
}
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
  const mounts = project.mountingHoles ?? new Set(); // drilled screw holes: no copper
  const present = (x, y) => x >= 1 && x <= cols && y >= 1 && y <= rows && !project.cuts.has(cellId(x, y)) && !mounts.has(cellId(x, y));

  const dsu = new DSU();
  for (let y = 1; y <= rows; y++) {
    for (let x = 1; x < cols; x++) {
      if (present(x, y) && present(x + 1, y)) dsu.union(cellId(x, y), cellId(x + 1, y));
    }
  }

  const issues = [];

  for (const j of project.jumpers) {
    for (const [x, y] of [[j.x, j.ya], [j.x, j.yb]]) {
      if (mounts.has(cellId(x, y))) {
        issues.push({ level: "error", code: "mount-on-jumper-end", message: `jumper end ${at(x, y)} lands on a mounting hole` });
      } else if (!present(x, y)) {
        issues.push({ level: "error", code: "jumper-off-copper", message: `jumper end ${at(x, y)} is off the board or on a cut` });
      }
    }
    if (present(j.x, j.ya) && present(j.x, j.yb)) dsu.union(cellId(j.x, j.ya), cellId(j.x, j.yb));
  }

  const pinNode = new Map();
  const pinPos = new Map();
  const compBox = new Map(); // ref -> bounding box of its pins (collision proxy)
  const flushBlock = new Set(); // cells under a flush body (wiresUnder false) where no wire may run
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
    if (body && part.wiresUnder === false) {
      for (let yy = Math.max(1, body.y0); yy <= Math.min(rows, body.y1); yy++) {
        for (let xx = Math.max(1, body.x0); xx <= Math.min(cols, body.x1); xx++) {
          flushBlock.add(cellId(xx, yy));
        }
      }
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
      if (mounts.has(cellId(p.x, p.y))) {
        issues.push({ level: "error", code: "mount-on-pin", ref: comp.ref, pin: p.id, message: `${key} sits on a mounting hole at ${at(p.x, p.y)}` });
      }
      pinNode.set(key, dsu.find(cellId(p.x, p.y)));
    }
  }

  // A jumper may not run under a flush body (`wiresUnder` false): there is no room to
  // solder there. Pin cells are already covered by the jumper-on/over-pin checks, so only
  // flag body cells that do not hold a pin.
  const pinCells = new Set([...pinPos.values()].map((p) => cellId(p.x, p.y)));
  for (const j of project.jumpers) {
    const lo = Math.min(j.ya, j.yb);
    const hi = Math.max(j.ya, j.yb);
    let under = false;
    for (let y = lo; y <= hi && !under; y++) {
      const c = cellId(j.x, y);
      if (flushBlock.has(c) && !pinCells.has(c)) under = true;
    }
    if (under) {
      issues.push({ level: "error", code: "jumper-under-body", message: `jumper ${at(j.x, lo)}-${at(j.x, hi)} runs under a component body` });
    }
  }

  // A screw head / standoff needs room: warn when a mounting hole sits under a flush body.
  for (const cell of mounts) {
    if (flushBlock.has(cell)) {
      issues.push({ level: "warn", code: "mount-under-body", message: `mounting hole ${atCell(cell)} is under a component body` });
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
