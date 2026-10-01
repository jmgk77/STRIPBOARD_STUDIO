// Light optimizer: a greedy hill-climb over the UNLOCKED components. For each one it
// tries its rotations, a few small moves, and (for bendable two-lead parts) a few lead
// spacings; it keeps any move that lowers the cost and repeats.
//
// Cost = hard errors first, then jumpers, then cuts, then board spread (so equal-wiring
// arrangements get squeezed together). Errors come from the authoritative analyzer on the
// routed board, so a move that creates a short or an overlap is rejected.

import { analyze } from "./connectivity.js";
import { contentBounds } from "./geometry.js";
import { route } from "./router.js";

const ROTS = [0, 90, 180, 270];
const DEFAULT_WEIGHTS = { errors: 1000, diag: 200, jumpers: 10, cuts: 3, spread: 4 };

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
  const score =
    errors * weights.errors +
    diagErrors * weights.diag +
    r.jumpers.length * weights.jumpers +
    r.cuts.size * weights.cuts +
    spread * weights.spread;
  const val = { score, errors, jumpers: r.jumpers.length, cuts: r.cuts.size, spread };
  cache.set(key, val);
  return val;
}

export function optimize(
  project,
  library,
  { weights = DEFAULT_WEIGHTS, maxPasses = 4, radius = 1, maxEvaluations = 400 } = {},
) {
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
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (dx || dy) candidates.push({ ...base, x: base.x + dx, y: base.y + dy });
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
