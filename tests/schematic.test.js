import test from "node:test";
import assert from "node:assert/strict";

import { Project, Component, Net, pinKey } from "../src/core/model.js";
import { LIBRARY, buildBarPart, registerPart } from "../src/core/library.js";
import { planSchematic } from "../src/ui/schematic.js";

test("plans a wire for a simple two-pin net", () => {
  const p = new Project();
  p.addComponent(new Component({ ref: "R1", part: "resistor" }));
  p.addComponent(new Component({ ref: "C1", part: "capacitor" }));
  p.nets = [new Net("A", [pinKey("R1", "1"), pinKey("C1", "1")])];
  const plan = planSchematic(p, LIBRARY);
  assert.ok(plan.wires.length >= 1);
});

test("wires do not overlap: segments are pairwise disjoint", () => {
  const p = new Project();
  for (const ref of ["R1", "R2", "R3", "R4"]) p.addComponent(new Component({ ref, part: "resistor" }));
  p.nets = [
    new Net("A", [pinKey("R1", "1"), pinKey("R3", "1")]),
    new Net("B", [pinKey("R2", "1"), pinKey("R4", "1")]),
  ];
  const plan = planSchematic(p, LIBRARY);
  // no two horizontal segments at the same y may share an x-range
  const horiz = [];
  for (const w of plan.wires) {
    for (let i = 0; i + 1 < w.points.length; i++) {
      const a = w.points[i];
      const b = w.points[i + 1];
      if (Math.abs(a.y - b.y) < 1) horiz.push({ y: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
    }
  }
  for (let i = 0; i < horiz.length; i++) {
    for (let j = i + 1; j < horiz.length; j++) {
      const overlap = Math.abs(horiz[i].y - horiz[j].y) < 1 && horiz[i].hi > horiz[j].lo && horiz[j].hi > horiz[i].lo;
      assert.ok(!overlap, `overlapping horizontals: ${JSON.stringify(horiz[i])} / ${JSON.stringify(horiz[j])}`);
    }
  }
});

test("a box pin connects to a terminal with a wire", () => {
  registerPart(buildBarPart({ name: "exp", label: "exp", count: 8, doubleRow: false }));
  const p = new Project();
  p.addComponent(new Component({ ref: "U1", part: "exp" })); // 8 pins, left column
  p.addComponent(new Component({ ref: "P1", part: "terminal2" })); // 2 pins
  p.nets = [new Net("A", [pinKey("U1", "3"), pinKey("P1", "2")])];
  const plan = planSchematic(p, LIBRARY);
  assert.ok(plan.wires.length >= 1, "expected a wire between the box pin and the terminal");
});
