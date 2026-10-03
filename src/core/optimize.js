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

// Direct shifts that slam the free cluster against the fixed parts (or the board corner).
function targetShifts(project, free, library) {
  const fb = pinsBounds(free, library);
  if (!fb) return [];
  const fixed = [...project.components.values()].filter((c) => c.locked);
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
  { weights: overrides = {}, maxPasses = 4, maxEvaluations = 120 } = {},
) {
  const weights = { ...DEFAULT_WEIGHTS, ...overrides };
  const cache = new Map();
  let evaluations = 0;
  const free = [...project.components.values()].filter((c) => !c.locked);
  let best = evaluate(project, library, cache, weights);
  evaluations += 1;
  const startScore = best.score;

  const perPartOffsets = weights.spread >= 6 ? [1, 2] : [1];

  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;

    // 1. shift the whole free cluster onto the fixed parts (closes big gaps cheaply)
    for (let round = 0; round < 3 && evaluations < maxEvaluations; round++) {
      let bestShift = null;
      let bestVal = best;
      const seen = new Set();
      for (const { dx, dy } of targetShifts(project, free, library)) {
        if (!dx && !dy) continue;
        const key = `${dx},${dy}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (evaluations >= maxEvaluations) break;
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

    // 2. refine each free part on its own
    for (const comp of free) {
      if (evaluations >= maxEvaluations) break;
      const part = library.get(comp.part);
      const base = { x: comp.x, y: comp.y, rot: comp.rot, span: comp.span };
      const candidates = [];
      for (const rot of ROTS) if (rot !== base.rot) candidates.push({ ...base, rot });
      for (const d of perPartOffsets) {
        candidates.push({ ...base, x: base.x + d }, { ...base, x: base.x - d });
        candidates.push({ ...base, y: base.y + d }, { ...base, y: base.y - d });
      }
      const others = free.filter((c) => c !== comp);
      if (others.length) {
        let sx = 0;
        let sy = 0;
        let n = 0;
        for (const other of others) {
          const op = library.get(other.part);
          if (!op) continue;
          for (const q of componentPins(other, op)) {
            sx += q.x;
            sy += q.y;
            n += 1;
          }
        }
        if (n) candidates.push({ ...base, x: Math.round(sx / n) }, { ...base, y: Math.round(sy / n) });
      }
      if (part?.bendable) {
        const { min, max, default: def } = part.bendable;
        for (const s of new Set([min, def, base.span - 1, base.span + 1, max])) {
          const clamped = Math.max(min, Math.min(max, s));
          if (clamped !== base.span) candidates.push({ ...base, span: clamped });
        }
      }

      let bestMove = null;
      let bestVal = best;
      for (const cand of candidates) {
        if (evaluations >= maxEvaluations) break;
        comp.x = cand.x;
        comp.y = cand.y;
        comp.rot = cand.rot;
        comp.span = cand.span;
        const val = evaluate(project, library, cache, weights);
        evaluations += 1;
        if (val.score < bestVal.score) {
          bestVal = val;
          bestMove = cand;
        }
      }
      if (bestMove) {
        comp.x = bestMove.x;
        comp.y = bestMove.y;
        comp.rot = bestMove.rot;
        comp.span = bestMove.span;
        best = bestVal;
        improved = true;
      } else {
        comp.x = base.x;
        comp.y = base.y;
        comp.rot = base.rot;
        comp.span = base.span;
      }
    }
    if (!improved) break;
  }

  return { score: best.score, startScore, evaluations, components: free.length, spread: best.spread, wire: best.wire };
}
