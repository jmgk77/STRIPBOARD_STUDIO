// Best-effort realizer: choose track cuts and jumper wires so the nets are true on the
// copper. It is a small maze router -- horizontal moves run along a strip, vertical moves
// are jumper wires -- so it can find detours (the crossover case) rather than only straight
// strips and single-column jumpers.
//
// Greedy single ordering can strand a net, so `route` runs several net orderings, checks
// each with the authoritative analyzer, and keeps the best one.

import { analyze, cellId } from "./connectivity.js";
import { componentBody, componentPins, rowLabel } from "./geometry.js";
import { pinKey, Project } from "./model.js";

const JUMPER_COST = 6; // prefer copper over a jumper

class MinHeap {
  constructor() {
    this.a = [];
  }
  get size() {
    return this.a.length;
  }
  push(item, prio) {
    this.a.push([prio, item]);
    let i = this.a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.a[p][0] <= this.a[i][0]) break;
      [this.a[p], this.a[i]] = [this.a[i], this.a[p]];
      i = p;
    }
  }
  pop() {
    const top = this.a[0];
    const last = this.a.pop();
    if (this.a.length) {
      this.a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let s = i;
        if (l < this.a.length && this.a[l][0] < this.a[s][0]) s = l;
        if (r < this.a.length && this.a[r][0] < this.a[s][0]) s = r;
        if (s === i) break;
        [this.a[s], this.a[i]] = [this.a[i], this.a[s]];
        i = s;
      }
    }
    return top;
  }
}

export function route(project, library, { maxAttempts = Infinity } = {}) {
  const { cols, rows } = project;

  const pinAt = new Map(); // cell -> net id | null (every pin occupies its hole)
  const pinsByNet = new Map(); // net id -> [{x,y}]
  for (const comp of project.components.values()) {
    const part = library.get(comp.part);
    if (!part) continue;
    for (const p of componentPins(comp, part)) {
      const net = project.netOf(pinKey(comp.ref, p.id));
      pinAt.set(cellId(p.x, p.y), net ? net.id : null);
      if (net && p.x >= 1 && p.x <= cols && p.y >= 1 && p.y <= rows) {
        const list = pinsByNet.get(net.id) ?? [];
        list.push({ x: p.x, y: p.y });
        pinsByNet.set(net.id, list);
      }
    }
  }

  const fixedCuts = project.fixedCuts ?? new Set();
  const fixedJumpers = (project.jumpers ?? []).filter((j) => j.fixed && j.net);

  let best = null;
  let tried = 0;
  for (const order of orderings([...pinsByNet.keys()], pinsByNet)) {
    if (tried++ >= maxAttempts) break;
    const attempt = runAttempt(project, library, order, pinAt, pinsByNet, fixedCuts, fixedJumpers);
    if (best === null || attempt.score < best.score) best = attempt;
    if (best.errors === 0) break; // a valid result; good enough
  }
  if (best === null) return { cuts: new Set(), jumpers: [], diagnostics: [] };
  return { cuts: best.cuts, jumpers: best.jumpers, diagnostics: best.diagnostics };
}

// -- one routing attempt ------------------------------------------------------

function runAttempt(project, library, order, pinAt, pinsByNet, fixedCuts = new Set(), fixedJumpers = []) {
  const { cols, rows } = project;
  const netLabel = new Map(project.nets.map((n) => [n.id, n.label || n.id]));

  // Body keep-out: where a body is flush (`wiresUnder` false) no jumper arc or end may
  // pass under it. Bodies that are elevated (discretes, modules on headers) do not block.
  const bodyBlock = new Set();
  for (const comp of project.components.values()) {
    const part = library.get(comp.part);
    if (!part || part.wiresUnder) continue;
    const b = componentBody(comp, part);
    if (!b) continue;
    for (let y = Math.max(1, b.y0); y <= Math.min(rows, b.y1); y++) {
      for (let x = Math.max(1, b.x0); x <= Math.min(cols, b.x1); x++) {
        bodyBlock.add(cellId(x, y));
      }
    }
  }
  const owner = new Map(); // cell -> net id (copper)
  const arc = new Map(); // cell -> net id (jumper clearance)
  const jumperEnds = new Set();
  const jumpers = [];
  const diagnostics = [];

  const otherNet = (c, net) => {
    if (pinAt.has(c)) return pinAt.get(c) !== null && pinAt.get(c) !== net;
    if (owner.has(c)) return owner.get(c) !== net;
    return false;
  };

  // A strip may run under a jumper's arc -- only pins, other nets' copper and the need
  // for a separating cut restrict it. Jumper ENDS are stricter (one wire per hole).
  const stripUsable = (net, x, y) => {
    if (x < 1 || x > cols || y < 1 || y > rows) return false;
    const c = cellId(x, y);
    if (fixedCuts.has(c)) return false; // a user cut breaks the copper here
    if (pinAt.has(c) && pinAt.get(c) !== net) return false;
    if (owner.has(c) && owner.get(c) !== net) return false;
    for (const nx of [x - 1, x + 1]) {
      if (nx < 1 || nx > cols) continue;
      if (otherNet(cellId(nx, y), net)) return false;
    }
    return true;
  };

  const endpointUsable = (net, x, y) => {
    const c = cellId(x, y);
    // A jumper ends in a HOLE, and a hole already takes a component lead: never share it,
    // not even with a pin of the same net. Connect through the strip in the adjacent cell.
    if (pinAt.has(c)) return false;
    if (bodyBlock.has(c)) return false; // no soldering under a flush body
    if (!stripUsable(net, x, y)) return false;
    return !arc.has(c) && !jumperEnds.has(c);
  };

  // Rows in a column that block a jumper's passage (any pin, or an existing arc/end).
  const blockedRowsIn = (x) => {
    const out = [];
    for (let y = 1; y <= rows; y++) {
      const c = cellId(x, y);
      if (pinAt.has(c) || arc.has(c) || jumperEnds.has(c) || bodyBlock.has(c)) out.push(y);
    }
    return out;
  };

  const blockedBetween = (sorted, lo, hi) => {
    if (lo > hi) return false;
    let a = 0;
    let b = sorted.length;
    while (a < b) {
      const m = (a + b) >> 1;
      if (sorted[m] < lo) a = m + 1;
      else b = m;
    }
    return a < sorted.length && sorted[a] <= hi;
  };

  // Seed the user's fixed jumpers: conductors of their net. They join their two holes for
  // free (a zero-cost edge in the search) and reserve their span for everything else.
  const extra = new Map(); // net -> [{x,y}] endpoints that must be reached
  const fixedEdges = new Map(); // net -> Map(cell -> the other endpoint cell)
  for (const j of fixedJumpers) {
    const c1 = cellId(j.x, j.ya);
    const c2 = cellId(j.x, j.yb);
    owner.set(c1, j.net);
    owner.set(c2, j.net);
    jumperEnds.add(c1);
    jumperEnds.add(c2);
    for (let y = j.ya + 1; y < j.yb; y++) arc.set(cellId(j.x, y), j.net);
    jumpers.push({ x: j.x, ya: j.ya, yb: j.yb, net: j.net, fixed: true });
    const list = extra.get(j.net) ?? [];
    list.push({ x: j.x, y: j.ya }, { x: j.x, y: j.yb });
    extra.set(j.net, list);
    const edges = fixedEdges.get(j.net) ?? new Map();
    edges.set(c1, c2);
    edges.set(c2, c1);
    fixedEdges.set(j.net, edges);
  }

  function dijkstra(net, sources) {
    const dist = new Map();
    const prev = new Map();
    const heap = new MinHeap();
    const fixedEdge = fixedEdges.get(net);
    const blockedCache = new Map();
    const endCache = new Map();
    const blocked = (x) => {
      if (!blockedCache.has(x)) blockedCache.set(x, blockedRowsIn(x));
      return blockedCache.get(x);
    };
    const endpoints = (x) => {
      if (!endCache.has(x)) {
        const set = [];
        for (let y = 1; y <= rows; y++) if (endpointUsable(net, x, y)) set.push(y);
        endCache.set(x, set);
      }
      return endCache.get(x);
    };
    for (const s of sources) {
      const [sx, sy] = s.split(",").map(Number);
      dist.set(s, 0);
      heap.push([s, sx, sy], 0);
    }
    while (heap.size) {
      const [d, item] = heap.pop();
      const [cell, x, y] = item;
      if (d > (dist.get(cell) ?? Infinity)) continue;
      for (const nx of [x - 1, x + 1]) {
        if (nx < 1 || nx > cols || !stripUsable(net, nx, y)) continue;
        const nc = cellId(nx, y);
        if (d + 1 < (dist.get(nc) ?? Infinity)) {
          dist.set(nc, d + 1);
          prev.set(nc, { from: cell, kind: "h" });
          heap.push([nc, nx, y], d + 1);
        }
      }
      const blk = blocked(x);
      for (const ny of endpoints(x)) {
        if (ny === y) continue;
        const lo = Math.min(y, ny);
        const hi = Math.max(y, ny);
        if (blockedBetween(blk, lo + 1, hi - 1)) continue;
        const cost = JUMPER_COST + Math.abs(ny - y);
        const nc = cellId(x, ny);
        if (d + cost < (dist.get(nc) ?? Infinity)) {
          dist.set(nc, d + cost);
          prev.set(nc, { from: cell, kind: "j" });
          heap.push([nc, x, ny], d + cost);
        }
      }
      // A fixed jumper joins its two holes at no cost (it is already soldered).
      const other = fixedEdge?.get(cell);
      if (other && d < (dist.get(other) ?? Infinity)) {
        const [ox, oy] = other.split(",").map(Number);
        dist.set(other, d);
        prev.set(other, { from: cell, kind: "f" });
        heap.push([other, ox, oy], d);
      }
    }
    return { dist, prev };
  }

  function reconstruct(prev, endCell) {
    const path = [];
    let cur = endCell;
    while (prev.has(cur)) {
      path.push(cur);
      cur = prev.get(cur).from;
    }
    path.push(cur);
    return path;
  }

  function applyPath(net, path) {
    for (const cell of path) {
      const [x, y] = cell.split(",").map(Number);
      owner.set(cellId(x, y), net);
    }
    for (let i = 0; i + 1 < path.length; i++) {
      const [x1, y1] = path[i].split(",").map(Number);
      const [x2, y2] = path[i + 1].split(",").map(Number);
      if (x1 === x2 && y1 !== y2) {
        const lo = Math.min(y1, y2);
        const hi = Math.max(y1, y2);
        if (!jumpers.some((j) => j.x === x1 && j.ya === lo && j.yb === hi)) {
          jumpers.push({ x: x1, ya: lo, yb: hi, net, fixed: false });
          jumperEnds.add(cellId(x1, lo));
          jumperEnds.add(cellId(x1, hi));
          for (let y = lo + 1; y < hi; y++) arc.set(cellId(x1, y), net);
        }
      }
    }
  }

  for (const net of order) {
    const pins = pinsByNet.get(net) ?? [];
    const extraEnds = extra.get(net) ?? [];
    const terminals = [...pins, ...extraEnds];
    if (terminals.length < 2) continue;
    for (const t of terminals) owner.set(cellId(t.x, t.y), net);
    // Start from the first pin PLUS the fixed jumper ends: those ends are already wired
    // together by the user's jumper, so the router must not bridge them again.
    let connected = [];
    const seen = new Set();
    const add = (t) => {
      const c = cellId(t.x, t.y);
      if (!seen.has(c)) {
        seen.add(c);
        connected.push(c);
      }
    };
    add(pins[0] ?? terminals[0]);
    const pending = terminals.filter((t) => !seen.has(cellId(t.x, t.y)));
    while (pending.length) {
      const { dist, prev } = dijkstra(net, connected);
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < pending.length; i++) {
        const d = dist.get(cellId(pending[i].x, pending[i].y));
        if (d !== undefined && d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx < 0) {
        diagnostics.push({ level: "error", code: "unreachable", netId: net, message: `net ${netLabel.get(net)}: cannot connect all its pins` });
        break;
      }
      const target = pending.splice(bestIdx, 1)[0];
      const path = reconstruct(prev, cellId(target.x, target.y));
      applyPath(net, path);
      for (const step of path) if (!connected.includes(step)) connected.push(step);
    }
  }

  const cuts = deriveCuts(project, owner, pinAt, diagnostics);
  for (const c of fixedCuts) cuts.add(c); // keep the user's cuts
  const clone = Project.fromJSON(project.toJSON());
  clone.cuts = cuts;
  clone.jumpers = jumpers;
  const result = analyze(clone, library);
  const errors = result.issues.filter((i) => i.level === "error").length;
  const score = (result.ok ? 0 : 100) + errors * 5 + jumpers.length + cuts.size * 0.5;
  return { cuts, jumpers, diagnostics, errors, score };
}

function orderings(nets, pinsByNet) {
  const out = [];
  const push = (arr) => {
    const key = arr.join(">");
    if (!out.some((o) => o.key === key)) out.push({ key, arr });
  };
  push([...nets].sort((a, b) => pinsByNet.get(b).length - pinsByNet.get(a).length));
  push([...nets].sort((a, b) => pinsByNet.get(a).length - pinsByNet.get(b).length));
  for (const first of nets) push([first, ...nets.filter((n) => n !== first)]);
  let seed = 987654321;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);
  for (let k = 0; k < 20; k++) {
    const arr = [...nets];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    push(arr);
  }
  return out.map((o) => o.arr);
}

function deriveCuts(project, owner, pinAt, diagnostics) {
  const { cols, rows } = project;
  const netLabel = new Map(project.nets.map((n) => [n.id, n.label || n.id]));
  const cuts = new Set();
  for (let y = 1; y <= rows; y++) {
    const used = [];
    for (let x = 1; x <= cols; x++) {
      const net = owner.get(cellId(x, y));
      if (net !== undefined) used.push({ x, net });
    }
    for (let i = 0; i + 1 < used.length; i++) {
      const a = used[i];
      const b = used[i + 1];
      if (a.net === b.net) continue;
      const mid = Math.floor((a.x + b.x) / 2);
      let placed = null;
      for (let d = 0; d < b.x - a.x && placed === null; d++) {
        for (const cand of [mid - d, mid + d]) {
          if (cand > a.x && cand < b.x) {
            const c = cellId(cand, y);
            if (!pinAt.has(c) && !owner.has(c)) {
              placed = c;
              break;
            }
          }
        }
      }
      if (placed === null) {
        diagnostics.push({
          level: "error",
          code: "adjacent-nets",
          netIds: [a.net, b.net],
          message: `row ${rowLabel(y, rows)}: no room to cut between nets ${netLabel.get(a.net)} and ${netLabel.get(b.net)} (columns ${a.x}–${b.x})`,
        });
      } else {
        cuts.add(placed);
      }
    }
  }
  return cuts;
}
