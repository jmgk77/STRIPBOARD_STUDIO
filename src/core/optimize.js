// Light optimizer: a greedy hill-climb over the UNLOCKED components. For each one it
// tries its four rotations and a few small translations, keeps any move that lowers the
// cost, and repeats. It is deliberately small -- "a little optimization" -- not a solver.
//
// Cost = hard errors first, then jumpers, then cuts. Errors come from the authoritative
// analyzer on the routed board, so a move that creates a short/overlap is rejected.

import { analyze } from "./connectivity.js";
import { route } from "./router.js";

const ROTS = [0, 90, 180, 270];

function signature(project) {
  return [...project.components.values()]
    .filter((c) => !c.locked)
    .map((c) => `${c.ref}:${c.x},${c.y},${c.rot}`)
    .join("|");
}

function evaluate(project, library, cache) {
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
  const score = errors * 1000 + diagErrors * 200 + r.jumpers.length * 10 + r.cuts.size * 3;
  const val = { score, errors, jumpers: r.jumpers.length, cuts: r.cuts.size };
  cache.set(key, val);
  return val;
}

export function optimize(project, library, { maxPasses = 3, radius = 1, maxEvaluations = 240 } = {}) {
  const cache = new Map();
  let evaluations = 0;
  const free = [...project.components.values()].filter((c) => !c.locked);
  let best = evaluate(project, library, cache);
  evaluations += 1;
  const startScore = best.score;

  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;
    for (const comp of free) {
      if (evaluations >= maxEvaluations) break;
      const base = { x: comp.x, y: comp.y, rot: comp.rot };
      const candidates = [];
      for (const rot of ROTS) if (rot !== base.rot) candidates.push({ x: base.x, y: base.y, rot });
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (dx === 0 && dy === 0) continue;
          candidates.push({ x: base.x + dx, y: base.y + dy, rot: base.rot });
        }
      }
      let bestMove = null;
      let bestVal = best;
      for (const cand of candidates) {
        if (evaluations >= maxEvaluations) break;
        comp.x = cand.x;
        comp.y = cand.y;
        comp.rot = cand.rot;
        const val = evaluate(project, library, cache);
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
        best = bestVal;
        improved = true;
      } else {
        comp.x = base.x;
        comp.y = base.y;
        comp.rot = base.rot;
      }
    }
    if (!improved) break;
  }

  return { score: best.score, startScore, evaluations, components: free.length };
}
