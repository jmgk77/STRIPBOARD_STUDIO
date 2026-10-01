import test from "node:test";
import assert from "node:assert/strict";

import { Project, Component, Net, pinKey } from "../src/core/model.js";
import { LIBRARY } from "../src/core/library.js";
import { analyze } from "../src/core/connectivity.js";
import { route } from "../src/core/router.js";

test("a fixed jumper is kept by Solve and makes the net route", () => {
  const p = new Project({ cols: 12, rows: 10 });
  p.addComponent(new Component({ ref: "J1", part: "header2", x: 2, y: 2 })); // (2,2),(2,3)
  p.addComponent(new Component({ ref: "J2", part: "header2", x: 2, y: 6 })); // (2,6),(2,7)
  p.nets = [new Net("A", [pinKey("J1", "1"), pinKey("J2", "1")])]; // (2,2) .. (2,6)
  p.jumpers = [{ x: 1, ya: 2, yb: 6, net: "A", fixed: true }];

  const r = route(p, LIBRARY);
  assert.ok(r.jumpers.some((j) => j.fixed && j.x === 1), "fixed jumper preserved");
  p.cuts = new Set(r.cuts);
  p.jumpers = r.jumpers;
  assert.equal(analyze(p, LIBRARY).ok, true);
});

test("a fixed cut is kept by Solve", () => {
  const p = new Project({ cols: 12, rows: 8 });
  p.addComponent(new Component({ ref: "J1", part: "header4", x: 2, y: 2 }));
  p.fixedCuts = new Set(["6,3"]);
  const r = route(p, LIBRARY);
  assert.ok(r.cuts.has("6,3"), "fixed cut preserved");
});

test("a fixed cut between two nets prevents a short", () => {
  const p = new Project({ cols: 12, rows: 8 });
  p.addComponent(new Component({ ref: "J1", part: "header2", x: 2, y: 2 })); // (2,2)
  p.addComponent(new Component({ ref: "J2", part: "header2", x: 8, y: 2 })); // (8,2)
  p.nets = [new Net("A", [pinKey("J1", "1")]), new Net("B", [pinKey("J2", "1")])];
  p.fixedCuts = new Set(["5,2"]);
  const r = route(p, LIBRARY);
  p.cuts = new Set(r.cuts);
  p.jumpers = r.jumpers;
  const a = analyze(p, LIBRARY);
  assert.equal(a.shorts.length, 0, JSON.stringify(a.issues));
});
