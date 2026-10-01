import test from "node:test";
import assert from "node:assert/strict";

import { Project, Component, Net, pinKey } from "../src/core/model.js";
import { LIBRARY } from "../src/core/library.js";
import { analyze } from "../src/core/connectivity.js";
import { route } from "../src/core/router.js";
import { pinWorld } from "../src/core/geometry.js";

// A small "shield": two 4-pin headers wired pin-to-pin across a gap.
function shield() {
  const p = new Project({ cols: 20, rows: 16 });
  p.addComponent(new Component({ ref: "J1", part: "header4", x: 2, y: 2 })); // (2,2)..(2,5)
  p.addComponent(new Component({ ref: "J2", part: "header4", x: 2, y: 8 })); // (2,8)..(2,11)
  p.nets = [
    new Net("A", [pinKey("J1", "1"), pinKey("J2", "1")]),
    new Net("B", [pinKey("J1", "2"), pinKey("J2", "2")]),
    new Net("C", [pinKey("J1", "3"), pinKey("J2", "3")]),
    new Net("D", [pinKey("J1", "4"), pinKey("J2", "4")]),
  ];
  return p;
}

test("end to end: place, route, and validate a pin-to-pin shield", () => {
  const p = shield();
  const result = route(p, LIBRARY);
  assert.equal(result.diagnostics.filter((d) => d.level === "error").length, 0, JSON.stringify(result.diagnostics));
  p.cuts = result.cuts;
  p.jumpers = result.jumpers;
  const r = analyze(p, LIBRARY);
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  // four independent cross-gap nets: each needs at least one jumper (the two header
  // columns are full of pins, so no net can jump in its own column)
  assert.ok(result.jumpers.length >= 4, `expected >=4 jumpers, got ${result.jumpers.length}`);
});

test("crossover between two stacked headers routes with jumpers", () => {
  const p = new Project({ cols: 20, rows: 16 });
  p.addComponent(new Component({ ref: "J1", part: "header4", x: 2, y: 2 })); // rows 2..5
  p.addComponent(new Component({ ref: "J2", part: "header4", x: 2, y: 8 })); // rows 8..11
  p.nets = [
    new Net("A", [pinKey("J1", "1"), pinKey("J2", "1")]),
    new Net("D", [pinKey("J1", "4"), pinKey("J2", "4")]),
    new Net("B", [pinKey("J1", "2"), pinKey("J2", "3")]), // middle two cross
    new Net("C", [pinKey("J1", "3"), pinKey("J2", "2")]),
  ];
  const result = route(p, LIBRARY);
  p.cuts = result.cuts;
  p.jumpers = result.jumpers;
  const r = analyze(p, LIBRARY);
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.ok(result.jumpers.length >= 4, `expected >=4 jumpers, got ${result.jumpers.length}`);
});

test("crossover between a module's two columns routes with a detour", () => {
  const p = new Project({ cols: 22, rows: 16 });
  p.addComponent(new Component({ ref: "U1", part: "module-2x10", x: 2, y: 2 })); // L col x2, R col x8
  p.nets = [
    new Net("A", [pinKey("U1", "L1"), pinKey("U1", "R1")]),
    new Net("B", [pinKey("U1", "L3"), pinKey("U1", "R5")]),
    new Net("C", [pinKey("U1", "L5"), pinKey("U1", "R3")]),
  ];
  const result = route(p, LIBRARY);
  p.cuts = result.cuts;
  p.jumpers = result.jumpers;
  const r = analyze(p, LIBRARY);
  assert.equal(r.ok, true, JSON.stringify(r.issues));
});

test("rotating a part 180 degrees moves its pins about the origin", () => {
  const resistor = LIBRARY.get("resistor"); // pins (0,0) and (0,3)
  const p = new Project({ cols: 12, rows: 10 });
  const c = new Component({ ref: "J1", part: "resistor", x: 4, y: 5 });
  p.addComponent(c);
  assert.deepEqual(pinWorld(c, resistor, "2"), { x: 4, y: 8 });
  c.rot = 180;
  assert.deepEqual(pinWorld(c, resistor, "2"), { x: 4, y: 2 });
  const r = analyze(p, LIBRARY);
  assert.ok(!r.issues.some((i) => i.code === "pin-off-board"));
});
