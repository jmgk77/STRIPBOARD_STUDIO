// Light optimizer: a greedy hill-climb over the UNLOCKED components.
//
// Two move sets:
//   * global   -- shift the whole free cluster together (closes the big gap between a
//                 fixed anchor and everything else in one go; a single part often cannot
//                 move without making some net longer)
//   * per part -- rotate, small move, and (for bendable parts) a lead span change
//
// Cost = hard errors first, then jumpers, cuts, board spread, net wirelength and lead
// spans. Errors come from the authoritative analyzer on the routed board, so a move that
// creates a short or an overlap is rejected.

import { analyze } from "./connectivity.js";
import { componentPins, contentBounds, resolveSpan, totalWirelength } from "./geometry.js";
import { route } from "./router.js";

const ROTS = [0, 90, 180, 270];
// One objective, three presets (master prompt §9):
//   Balanced (default) -- an even trade of jumpers, cuts, size and wirelength.
//   Compact            -- strongly prefer a small board (higher spread/wire/span weights).
//   Easy               -- strongly prefer few jumpers (wires are the fiddly part to build),
//                         and slightly favour fewer cuts and some breathing room.
const DEFAULT_WEIGHTS = { errors: 1000, diag: 200, jumpers: 10, cuts: 3, spread: 2, wire: 1, span: 1 };
export const BALANCED_WEIGHTS = DEFAULT_WEIGHTS;
export const COMPACT_WEIGHTS = { errors: 1000, diag: 200, jumpers: 10, cuts: 3, spread: 8, wire: 4, span: 3 };
export const EASY_WEIGHTS = { errors: 1000, diag: 200, jumpers: 22, cuts: 4, spread: 3, wire: 1, span: 1 };

function pinsBounds(comps, library) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of comps) {
    const part = library.get(c.part);
    if (!part) continue;
    for (const p of componentPins(c, part)) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

// Average pin position of a set of components (used to steer a part/unit toward the rest).
function pinsCentroid(comps, library) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const c of comps) {
    const p = library.get(c.part);
    if (!p) continue;
    for (const q of componentPins(c, p)) {
      sx += q.x;
      sy += q.y;
      n += 1;
    }
  }
  return n ? { x: sx / n, y: sy / n } : null;
}

function unitCentroid(members) {
  const n = members.length;
  return {
    x: members.reduce((s, m) => s + m.x, 0) / n,
    y: members.reduce((s, m) => s + m.y, 0) / n,
  };
}

// A "unit" is one movable thing: a single unlocked part, or a whole group (rigid cluster).
// A group only participates when every member is unlocked (all-or-nothing, D8); otherwise
// it is a fixed anchor, like a locked part.
function freeUnits(project) {
  const comps = [...project.components.values()];
  const groups = new Map();
  for (const c of comps) {
    if (!c.group) continue;
    if (!groups.has(c.group)) groups.set(c.group, []);
    groups.get(c.group).push(c);
  }
  const units = [];
  const taken = new Set();
  for (const c of comps) {
    if (c.group) {
      if (taken.has(c.group)) continue;
      taken.add(c.group);
      const members = groups.get(c.group);
      if (!members.every((m) => !m.locked)) continue; // any lock -> whole group fixed
      // A lone member is not a rigid cluster: treat it as a normal part (can rotate).
      units.push(members.length > 1 ? { members, group: c.group } : { members, group: null });
    } else if (!c.locked) {
      units.push({ members: [c], group: null });
    }
  }
  return units;
}

// Direct shifts that slam the free cluster against the fixed parts (or the board corner).
function targetShifts(free, fixed, library) {
  const fb = pinsBounds(free, library);
  if (!fb) return [];
  const out = [];
  if (!fixed.length) {
    out.push({ dx: 1 - fb.x0, dy: 1 - fb.y0 });
    return out;
  }
  const sb = pinsBounds(fixed, library);
  const d = { dx: 0, dy: 0 };
  if (fb.x0 > sb.x1) d.dx = sb.x1 + 2 - fb.x0;
  else if (fb.x1 < sb.x0) d.dx = sb.x0 - 1 - fb.x1;
  if (fb.y0 > sb.y1) d.dy = sb.y1 + 2 - fb.y0;
  else if (fb.y1 < sb.y0) d.dy = sb.y0 - 1 - fb.y1;
  out.push({ ...d });
  out.push({ dx: Math.trunc(d.dx / 2), dy: Math.trunc(d.dy / 2) });
  out.push({ dx: d.dx, dy: 0 });
  out.push({ dx: 0, dy: d.dy });
  return out;
}

function signature(project) {
  return [...project.components.values()]
    .filter((c) => !c.locked)
    .map((c) => `${c.ref}:${c.x},${c.y},${c.rot},${c.span}`)
    .join("|");
}

function evaluate(project, library, cache, weights) {
  const key = signature(project);
  const hit = cache.get(key);
  if (hit) return hit;
  const r = route(project, library, { maxAttempts: 4 });
  // Temporarily apply the routing instead of deep-cloning the project (much cheaper).
  const prevCuts = project.cuts;
  const prevJumpers = project.jumpers;
  project.cuts = r.cuts;
  project.jumpers = r.jumpers;
  const a = analyze(project, library);
  const b = contentBounds(project, library);
  const wire = totalWirelength(project, library);
  let spanSum = 0;
  for (const c of project.components.values()) {
    const p = library.get(c.part);
    if (p?.bendable) spanSum += resolveSpan(c, p);
  }
  project.cuts = prevCuts;
  project.jumpers = prevJumpers;

  const errors = a.issues.filter((i) => i.level === "error").length;
  const diagErrors = r.diagnostics.filter((d) => d.level === "error").length;
  const spread = b ? b.x1 - b.x0 + (b.y1 - b.y0) : 0;
  const score =
    errors * weights.errors +
    diagErrors * weights.diag +
    r.jumpers.length * weights.jumpers +
    r.cuts.size * weights.cuts +
    spread * weights.spread +
    wire * weights.wire +
    spanSum * weights.span;
  const val = { score, errors, jumpers: r.jumpers.length, cuts: r.cuts.size, spread, wire, span: spanSum };
  cache.set(key, val);
  return val;
}

export function optimize(
  project,
  library,
  { weights: overrides = {}, maxPasses = 4, maxEvaluations = 120, maxMs = Infinity } = {},
) {
  const weights = { ...DEFAULT_WEIGHTS, ...overrides };
  const cache = new Map();
  let evaluations = 0;
  // Time budget: keep the synchronous run short enough that the browser does not flag the
  // page as unresponsive (each evaluation is a full route + analyze).
  const deadline = maxMs === Infinity ? Infinity : Date.now() + maxMs;
  const budget = () => evaluations >= maxEvaluations || Date.now() > deadline;
  const units = freeUnits(project);
  const free = units.flatMap((u) => u.members);
  const freeSet = new Set(free);
  const fixed = [...project.components.values()].filter((c) => !freeSet.has(c));
  let best = evaluate(project, library, cache, weights);
  evaluations += 1;
  const startScore = best.score;

  const perPartOffsets = weights.spread >= 6 ? [1, 2] : [1];

  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;

    // 1. shift the whole free cluster onto the fixed parts (closes big gaps cheaply)
    for (let round = 0; round < 3 && !budget(); round++) {
      let bestShift = null;
      let bestVal = best;
      const seen = new Set();
      for (const { dx, dy } of targetShifts(free, fixed, library)) {
        if (!dx && !dy) continue;
        const key = `${dx},${dy}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (budget()) break;
        for (const c of free) {
          c.x += dx;
          c.y += dy;
        }
        const val = evaluate(project, library, cache, weights);
        evaluations += 1;
        for (const c of free) {
          c.x -= dx;
          c.y -= dy;
        }
        if (val.score < bestVal.score) {
          bestVal = val;
          bestShift = { dx, dy };
        }
      }
      if (!bestShift) break;
      for (const c of free) {
        c.x += bestShift.dx;
        c.y += bestShift.dy;
      }
      best = bestVal;
      improved = true;
    }

    // 2. refine each free unit: a lone part rotates/moves/bends; a group only translates.
    for (const unit of units) {
      if (budget()) break;
      const members = unit.members;
      const bases = members.map((m) => ({ x: m.x, y: m.y, rot: m.rot, span: m.span }));
      // Candidates are transforms: absolute fields for a singleton, dx/dy for a rigid group.
      const apply = (cand) =>
        members.forEach((m, i) => {
          const b = bases[i];
          m.x = (cand.x ?? b.x) + (cand.dx ?? 0);
          m.y = (cand.y ?? b.y) + (cand.dy ?? 0);
          m.rot = cand.rot ?? b.rot;
          m.span = cand.span ?? b.span;
        });
      const candidates = [];
      if (unit.group) {
        for (const d of perPartOffsets) {
          candidates.push({ dx: d }, { dx: -d }, { dy: d }, { dy: -d });
        }
        const others = free.filter((c) => !members.includes(c));
        if (others.length) {
          const c = unitCentroid(members);
          const o = pinsCentroid(others, library);
          if (o) candidates.push({ dx: Math.round(o.x - c.x), dy: Math.round(o.y - c.y) });
        }
      } else {
        const comp = members[0];
        const base = bases[0];
        const part = library.get(comp.part);
        for (const rot of ROTS) if (rot !== base.rot) candidates.push({ rot });
        for (const d of perPartOffsets) {
          candidates.push({ x: base.x + d }, { x: base.x - d }, { y: base.y + d }, { y: base.y - d });
        }
        const o = pinsCentroid(free.filter((c) => c !== comp), library);
        if (o) candidates.push({ x: Math.round(o.x) }, { y: Math.round(o.y) });
        if (part?.bendable) {
          const { min, max, default: def } = part.bendable;
          for (const s of new Set([min, def, base.span - 1, base.span + 1, max])) {
            const clamped = Math.max(min, Math.min(max, s));
            if (clamped !== base.span) candidates.push({ span: clamped });
          }
        }
      }

      let bestMove = null;
      let bestVal = best;
      for (const cand of candidates) {
        if (budget()) break;
        apply(cand);
        const val = evaluate(project, library, cache, weights);
        evaluations += 1;
        if (val.score < bestVal.score) {
          bestVal = val;
          bestMove = cand;
        }
      }
      apply(bestMove ?? {}); // apply the winner, or restore the bases
      if (bestMove) {
        best = bestVal;
        improved = true;
      }
    }
    if (!improved) break;
  }

  const timedOut = Date.now() > deadline;
  return { score: best.score, startScore, evaluations, components: free.length, spread: best.spread, wire: best.wire, timedOut };
}
