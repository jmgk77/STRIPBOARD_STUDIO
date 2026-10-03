// Post-process the routed cuts so they line up: move each cut, within its own row, to a
// common target column when that keeps the board valid. A run of cuts in one column can be
// made with a single straight cutter pass instead of drilling scattered holes.
//
// Validity is checked with the authoritative analyzer, so a move that opens a net or
// creates a short is rejected.

import { analyze } from "./connectivity.js";

export function alignCuts(project, library, cuts, jumpers = []) {
  const fixed = project.fixedCuts ?? new Set();
  const movable = [...cuts].filter((c) => !fixed.has(c));
  if (movable.length < 2) return new Set(cuts);

  const target = commonColumn(movable);
  let current = new Set(cuts);

  const valid = (set) => {
    const clone = project.clone();
    clone.cuts = set;
    clone.jumpers = jumpers.map((j) => ({ ...j }));
    return analyze(clone, library).ok;
  };

  for (const c of movable) {
    const [x, y] = c.split(",").map(Number);
    if (x === target) continue;
    const to = `${target},${y}`;
    if (current.has(to)) continue;
    const trial = new Set(current);
    trial.delete(c);
    trial.add(to);
    if (valid(trial)) current = trial;
  }
  return current;
}

function commonColumn(cuts) {
  const count = new Map();
  for (const c of cuts) {
    const x = c.split(",")[0];
    count.set(x, (count.get(x) ?? 0) + 1);
  }
  let best = null;
  let bestN = -1;
  for (const [x, n] of count) {
    if (n > bestN) {
      bestN = n;
      best = Number(x);
    }
  }
  return best;
}
