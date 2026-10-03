import test from "node:test";
import assert from "node:assert/strict";

import { buildBarPart, LIBRARY } from "../src/core/library.js";
import { Project, Component } from "../src/core/model.js";
import { componentBody } from "../src/core/geometry.js";
import { analyze } from "../src/core/connectivity.js";

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

test("screw terminal pins are 2 holes apart (5.08 mm)", () => {
  const part = LIBRARY.get("terminal2");
  assert.deepEqual(part.pins.map((p) => [p.id, p.x, p.y]), [["1", 0, 0], ["2", 0, 2]]);
});

test("screw terminal body is a 3x5 block", () => {
  const part = LIBRARY.get("terminal2");
  assert.deepEqual(part.body, { x: -1, y: -1, w: 3, h: 5 });
  const c = new Component({ ref: "T1", part: "terminal2", x: 5, y: 4 });
  assert.deepEqual(componentBody(c, part), { x0: 4, y0: 3, x1: 6, y1: 7 });
});

test("terminal bodies collide when placed adjacent", () => {
  const p = new Project({ cols: 12, rows: 12 });
  p.addComponent(new Component({ ref: "T1", part: "terminal2", x: 4, y: 3 })); // body x3..5
  p.addComponent(new Component({ ref: "T2", part: "terminal2", x: 6, y: 3 })); // body x5..7
  assert.ok(analyze(p, LIBRARY).issues.some((i) => i.code === "overlap"));
});

test("custom part specs survive a project JSON round-trip", () => {
  const p = new Project();
  p.customParts.push({ name: "custom-x", label: "X", count: 6, gap: 4, doubleRow: true, prefix: "", leftPrefix: "L", rightPrefix: "R" });
  const q = Project.fromJSON(p.toJSON());
  assert.deepEqual(q.customParts, p.customParts);
});
