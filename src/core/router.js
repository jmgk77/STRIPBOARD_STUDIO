// Best-effort realizer: given placements and nets, choose the track cuts and jumper wires
// that make the nets true on the copper. It is deliberately simple (row runs + vertical
// jumpers); when it cannot find a way, it says so instead of producing a wrong board.

import { cellId } from "./connectivity.js";
import { componentPins } from "./geometry.js";
import { pinKey } from "./model.js";

function rowRuns(y, cols, isCut) {
  const runs = [];
  let start = null;
  for (let x = 1; x <= cols; x++) {
    if (!isCut(x, y)) {
      if (start === null) start = x;
    } else if (start !== null) {
      runs.push([start, x - 1]);
      start = null;
    }
  }
  if (start !== null) runs.push([start, cols]);
  return runs;
}

function runContaining(runs, x) {
  return runs.find(([a, b]) => x >= a && x <= b) ?? null;
}

/**
 * Compute cuts and jumpers for the current placement + nets.
 * @returns {{ cuts: Set<string>, jumpers: {x,ya,yb}[], diagnostics: object[] }}
 */
export function route(project, library) {
  const { cols, rows } = project;
  const diagnostics = [];

  const pins = [];
  for (const comp of project.components.values()) {
    const part = library.get(comp.part);
    if (!part) continue;
    for (const p of componentPins(comp, part)) {
      const key = pinKey(comp.ref, p.id);
      const net = project.netOf(key);
      if (net) pins.push({ x: p.x, y: p.y, net: net.id, key });
    }
  }
  const pinCells = new Set(pins.map((p) => cellId(p.x, p.y)));

  // 1. per-row segments of same-net pins, with a cut between different nets.
  const cuts = new Set();
  const segments = [];
  for (let y = 1; y <= rows; y++) {
    const terms = pins.filter((p) => p.y === y).sort((a, b) => a.x - b.x);
    let prev = null;
    let i = 0;
    while (i < terms.length) {
      const net = terms[i].net;
      let j = i;
      while (j + 1 < terms.length && terms[j + 1].net === net) j += 1;
      const seg = { y, x0: terms[i].x, x1: terms[j].x, net };
      if (prev) {
        const gap = seg.x0 - prev.x1;
        if (gap <= 1) {
          diagnostics.push({
            level: "error",
            code: "adjacent-nets",
            message: `row ${y}: nets ${prev.net} and ${net} sit on adjacent holes (columns ${prev.x1} and ${seg.x0}); move a part`,
          });
        } else {
          cuts.add(cellId(Math.floor((prev.x1 + seg.x0) / 2), y));
        }
      }
      segments.push(seg);
      prev = seg;
      i = j + 1;
    }
  }

  // 2. reachable copper for each segment = its row run (copper extends until a cut/edge).
  const isCut = (x, y) => cuts.has(cellId(x, y)) || project.cuts.has(cellId(x, y));
  const runsCache = new Map();
  const runsFor = (y) => {
    if (!runsCache.has(y)) runsCache.set(y, rowRuns(y, cols, isCut));
    return runsCache.get(y);
  };
  for (const seg of segments) {
    seg.run = runContaining(runsFor(seg.y), seg.x0);
  }

  // 3. connect each net's segments with vertical jumpers (greedy star from the first).
  const jumpers = [];
  const usedEnds = new Set();
  const arcCells = new Set();

  const jumperOk = (x, ya, yb) => {
    for (const yy of [ya, yb]) {
      const c = cellId(x, yy);
      if (isCut(x, yy) || pinCells.has(c) || usedEnds.has(c) || arcCells.has(c)) return false;
    }
    for (let yy = ya + 1; yy < yb; yy++) {
      const c = cellId(x, yy);
      if (pinCells.has(c) || usedEnds.has(c) || arcCells.has(c)) return false;
    }
    return true;
  };

  const byNet = new Map();
  for (const seg of segments) {
    const list = byNet.get(seg.net) ?? [];
    list.push(seg);
    byNet.set(seg.net, list);
  }

  for (const [net, segs] of byNet) {
    if (segs.length < 2) continue;
    const home = segs[0];
    for (let k = 1; k < segs.length; k++) {
      const target = segs[k];
      if (!home.run || !target.run) continue;
      if (home.y === target.y) {
        diagnostics.push({
          level: "error",
          code: "row-split",
          message: `net ${net}: pins on row ${home.y} are split by another net; move a part`,
        });
        continue;
      }
      const lo = Math.min(home.y, target.y);
      const hi = Math.max(home.y, target.y);
      const from = Math.max(home.run[0], target.run[0]);
      const to = Math.min(home.run[1], target.run[1]);
      let chosen = null;
      for (let x = from; x <= to && chosen === null; x++) {
        if (jumperOk(x, lo, hi)) chosen = x;
      }
      if (chosen === null) {
        diagnostics.push({
          level: "error",
          code: "no-jumper-column",
          message: `net ${net}: no free shared column to bridge rows ${lo}–${hi}`,
        });
        continue;
      }
      jumpers.push({ x: chosen, ya: lo, yb: hi });
      usedEnds.add(cellId(chosen, lo));
      usedEnds.add(cellId(chosen, hi));
      for (let yy = lo + 1; yy < hi; yy++) arcCells.add(cellId(chosen, yy));
    }
  }

  return { cuts, jumpers, diagnostics };
}
