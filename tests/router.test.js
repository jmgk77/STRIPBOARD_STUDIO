import test from "node:test";
import assert from "node:assert/strict";

import { Project, Component, Net, pinKey } from "../src/core/model.js";
import { LIBRARY } from "../src/core/library.js";
import { analyze } from "../src/core/connectivity.js";
import { route } from "../src/core/router.js";

test("router bridges two nets across rows with jumpers and cuts", () => {
  const p = new Project({ cols: 12, rows: 10 });
  p.addComponent(new Component({ ref: "J1", part: "header4", x: 2, y: 2 })); // (2,2)..(2,5)
  p.addComponent(new Component({ ref: "J2", part: "header4", x: 4, y: 2 })); // (4,2)..(4,5)
  p.nets = [
    new Net("A", [pinKey("J1", "1"), pinKey("J1", "4")]), // (2,2)-(2,5)
    new Net("B", [pinKey("J2", "1"), pinKey("J2", "4")]), // (4,2)-(4,5)
  ];
  const result = route(p, LIBRARY);
  assert.equal(result.diagnostics.filter((d) => d.level === "error").length, 0, JSON.stringify(result.diagnostics));
  p.cuts = result.cuts;
  p.jumpers = result.jumpers;
  const r = analyze(p, LIBRARY);
  assert.equal(r.ok, true, JSON.stringify(r.issues));
});

test("router reports adjacent different nets that cannot be cut", () => {
  const p = new Project({ cols: 12, rows: 6 });
  p.addComponent(new Component({ ref: "J1", part: "header2", x: 2, y: 2 })); // (2,2)
  p.addComponent(new Component({ ref: "J2", part: "header2", x: 3, y: 2 })); // (3,2)
  p.nets = [new Net("A", [pinKey("J1", "1")]), new Net("B", [pinKey("J2", "1")])];
  const result = route(p, LIBRARY);
  assert.ok(result.diagnostics.some((d) => d.code === "adjacent-nets"));
});
