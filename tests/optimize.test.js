import test from "node:test";
import assert from "node:assert/strict";

import { Project, Component, Net, pinKey } from "../src/core/model.js";
import { LIBRARY } from "../src/core/library.js";
import { analyze } from "../src/core/connectivity.js";
import { optimize } from "../src/core/optimize.js";

test("optimizer fixes an off-board rotated part", () => {
  const p = new Project({ cols: 16, rows: 12 });
  // A resistor at y=1 rotated 180 puts pin 2 at (x, -2): off the board.
  p.addComponent(new Component({ ref: "R1", part: "resistor", x: 4, y: 1, rot: 180, locked: false }));
  p.addComponent(new Component({ ref: "R2", part: "resistor", x: 10, y: 6, locked: true }));
  p.nets = [new Net("A", [pinKey("R1", "2"), pinKey("R2", "1")])];

  assert.ok(analyze(p, LIBRARY).issues.some((i) => i.code === "pin-off-board"));
  const info = optimize(p, LIBRARY);
  assert.ok(info.score < info.startScore, "optimizer should improve the cost");
  assert.ok(!analyze(p, LIBRARY).issues.some((i) => i.code === "pin-off-board"));
});

test("optimizer never moves a locked part", () => {
  const p = new Project({ cols: 12, rows: 12 });
  p.addComponent(new Component({ ref: "J1", part: "header4", x: 2, y: 2, locked: true }));
  p.addComponent(new Component({ ref: "J2", part: "header4", x: 2, y: 8, locked: true }));
  p.nets = [
    new Net("A", [pinKey("J1", "1"), pinKey("J2", "1")]),
    new Net("B", [pinKey("J1", "2"), pinKey("J2", "2")]),
  ];
  optimize(p, LIBRARY);
  assert.deepEqual([p.components.get("J1").x, p.components.get("J1").y], [2, 2]);
  assert.deepEqual([p.components.get("J2").x, p.components.get("J2").y], [2, 8]);
});
