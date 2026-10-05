import test from "node:test";
import assert from "node:assert/strict";

import { Project, Component, Net, pinKey } from "../src/core/model.js";
import { LIBRARY } from "../src/core/library.js";
import { buildChecks } from "../src/core/checks.js";
import { rowLabel } from "../src/core/geometry.js";

test("buildChecks derives net/cut/jumper/mount checks", () => {
  const p = new Project({ cols: 12, rows: 8 });
  p.addComponent(new Component({ ref: "J1", part: "header2", x: 2, y: 2 }));
  p.addComponent(new Component({ ref: "J2", part: "header2", x: 8, y: 2 }));
  p.addComponent(new Component({ ref: "J3", part: "header2", x: 2, y: 5 })); // single-pin net below
  p.nets = [new Net("A", [pinKey("J1", "1"), pinKey("J2", "1")]), new Net("B", [pinKey("J3", "1")])];
  p.cuts = new Set(["5,2"]);
  p.jumpers = [{ x: 3, ya: 2, yb: 5, net: "A" }];
  p.mountingHoles = new Set(["1,1"]);

  const c = buildChecks(p, LIBRARY);
  assert.equal(c.nets.length, 1, "one-pin nets are not listed");
  assert.equal(c.nets[0].label, "A");
  assert.deepEqual(c.nets[0].pins, [pinKey("J1", "1"), pinKey("J2", "1")]);

  const row = rowLabel(2, 8); // letter first, then the column (H7 = row H, column 7)
  assert.equal(c.cuts.length, 1);
  assert.equal(c.cuts[0].cell, `${row}5`);
  assert.equal(c.cuts[0].left, `${row}4`);
  assert.equal(c.cuts[0].right, `${row}6`);

  assert.equal(c.jumpers.length, 1);
  assert.equal(c.jumpers[0].a, `${rowLabel(2, 8)}3`);
  assert.equal(c.jumpers[0].b, `${rowLabel(5, 8)}3`);
  assert.equal(c.jumpers[0].net, "A");

  assert.equal(c.mounts.length, 1);
  assert.equal(c.mounts[0].cell, `${rowLabel(1, 8)}1`);
});
