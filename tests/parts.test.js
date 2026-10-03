import test from "node:test";
import assert from "node:assert/strict";

import { buildBarPart } from "../src/core/library.js";
import { Project } from "../src/core/model.js";

test("single-row pin bar has one column of pins", () => {
  const part = buildBarPart({ name: "b1", label: "B", count: 4, doubleRow: false, prefix: "P" });
  assert.deepEqual(
    part.pins.map((p) => [p.id, p.x, p.y]),
    [["P1", 0, 0], ["P2", 0, 1], ["P3", 0, 2], ["P4", 0, 3]],
  );
});

test("double-row pin bar uses the configured gap in holes", () => {
  const part = buildBarPart({ name: "b2", label: "B", count: 3, gap: 5, doubleRow: true });
  assert.deepEqual(
    part.pins.map((p) => [p.id, p.x, p.y]),
    [["L1", 0, 0], ["L2", 0, 1], ["L3", 0, 2], ["R1", 5, 0], ["R2", 5, 1], ["R3", 5, 2]],
  );
});

test("custom part specs survive a project JSON round-trip", () => {
  const p = new Project();
  p.customParts.push({ name: "custom-x", label: "X", count: 6, gap: 4, doubleRow: true, prefix: "", leftPrefix: "L", rightPrefix: "R" });
  const q = Project.fromJSON(p.toJSON());
  assert.deepEqual(q.customParts, p.customParts);
});
