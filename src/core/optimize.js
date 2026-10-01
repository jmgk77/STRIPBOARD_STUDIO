// Light optimizer: a greedy hill-climb over the UNLOCKED components. For each one it
// tries its rotations, a few small moves, and (for bendable two-lead parts) a few lead
// spacings; it keeps any move that lowers the cost and repeats.
//
// Cost = hard errors first, then jumpers, then cuts, then board spread (so equal-wiring
// arrangements get squeezed together). Errors come from the authoritative analyzer on the
// routed board, so a move that creates a short or an overlap is rejected.

import { analyze } from "./connectivity.js";
import { componentPins, contentBounds, resolveSpan, totalWirelength } from "./geometry.js";
import { route } from "./router.js";

const ROTS = [0, 90, 180, 270];
const DEFAULT_WEIGHTS = { errors: 1000, diag: 200, jumpers: 10, cuts: 3, spread: 2, wire: 1, span: 1 };
export const COMPACT_WEIGHTS = { errors: 1000, diag: 200, jumpers: 10, cuts: 3, spread: 8, wire: 4, span: 3 };

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
  const r = route(project, library, { maxAttempts: 8 });
  const clone = project.clone();
  clone.cuts = r.cuts;
  clone.jumpers = r.jumpers;
  const a = analyze(clone, library);
  const errors = a.issues.filter((i) => i.level === "error").length;
  const diagErrors = r.diagnostics.filter((d) => d.level === "error").length;
  const b = contentBounds(clone, library);
  const spread = b ? b.x1 - b.x0 + (b.y1 - b.y0) : 0;
  const wire = totalWirelength(clone, library);
  let spanSum = 0;
  for (const c of clone.components.values()) {
    const p = library.get(c.part);
    if (p?.bendable) spanSum += resolveSpan(c, p);
  }
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
  { weights: overrides = {}, maxPasses = 6, maxEvaluations = 600 } = {},
) {
  const weights = { ...DEFAULT_WEIGHTS, ...overrides };
  const cache = new Map();
  let evaluations = 0;
  const free = [...project.components.values()].filter((c) => !c.locked);
  let best = evaluate(project, library, cache, weights);
  evaluations += 1;
  const startScore = best.score;

  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;
    for (const comp of free) {
      if (evaluations >= maxEvaluations) break;
      const part = library.get(comp.part);
      const base = { x: comp.x, y: comp.y, rot: comp.rot, span: comp.span };
      const candidates = [];
      for (const rot of ROTS) if (rot !== base.rot) candidates.push({ ...base, rot });
      const offsets = weights.spread >= 6 ? [1, 2, 3, 5, 8, 13, 21] : [1, 2, 4];
      for (const d of offsets) {
        candidates.push({ ...base, x: base.x + d });
        candidates.push({ ...base, x: base.x - d });
        candidates.push({ ...base, y: base.y + d });
        candidates.push({ ...base, y: base.y - d });
      }
      // Move toward the group's centroid: closes large gaps in one step.
      const others = [...project.components.values()].filter((c) => c !== comp);
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
        if (n) {
          candidates.push({ ...base, x: Math.round(sx / n) });
          candidates.push({ ...base, y: Math.round(sy / n) });
        }
      }
      if (part?.bendable) {
        const { min, max, default: def } = part.bendable;
        const spans = new Set([min, def, base.span - 1, base.span + 1, max]);
        for (const s of spans) {
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

  return { score: best.score, startScore, evaluations, components: free.length, spread: best.spread };
}
