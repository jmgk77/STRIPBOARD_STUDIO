import test from "node:test";
import assert from "node:assert/strict";

import { paretoFront, dominates } from "../src/core/pareto.js";

test("paretoFront keeps only non-dominated points", () => {
  const pts = [
    { id: "a", area: 100, jumpers: 10 },
    { id: "b", area: 120, jumpers: 8 },
    { id: "c", area: 130, jumpers: 12 }, // dominated by a
    { id: "d", area: 90, jumpers: 15 },
    { id: "e", area: 100, jumpers: 12 }, // dominated by a
  ];
  const front = paretoFront(pts, ["area", "jumpers"]).map((p) => p.id).sort();
  assert.deepEqual(front, ["a", "b", "d"]);
});

test("dominates is strict on at least one objective", () => {
  assert.equal(dominates({ a: 1, b: 1 }, { a: 1, b: 2 }, ["a", "b"]), true);
  assert.equal(dominates({ a: 2, b: 1 }, { a: 1, b: 1 }, ["a", "b"]), false); // worse on a
  assert.equal(dominates({ a: 1, b: 1 }, { a: 1, b: 1 }, ["a", "b"]), false); // equal -> no
});
