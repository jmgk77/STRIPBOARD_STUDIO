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

test("a flush body's holes are a jumper keep-out", () => {
  const p = new Project({ cols: 14, rows: 16 });
  p.addComponent(new Component({ ref: "H1", part: "header4", x: 6, y: 5 })); // body col6 rows5-8, flush
  p.addComponent(new Component({ ref: "R1", part: "resistor", x: 6, y: 1, span: 3 })); // (6,1),(6,4)
  p.addComponent(new Component({ ref: "R2", part: "resistor", x: 6, y: 9, span: 3 })); // (6,9),(6,12)
  p.nets = [new Net("A", [pinKey("R1", "2"), pinKey("R2", "1")])]; // (6,4) to (6,9)
  const r = route(p, LIBRARY);
  const inBody = (x, y) => x === 6 && y >= 5 && y <= 8;
  for (const j of r.jumpers) {
    for (let y = j.ya; y <= j.yb; y++) assert.ok(!inBody(j.x, y), `jumper under the header at ${j.x},${y}`);
  }
});

test("no hole is ever shared by two jumpers", () => {
  const p = new Project({ cols: 12, rows: 10 });
  p.addComponent(new Component({ ref: "J", part: "header3", x: 5, y: 2 })); // pins (5,2),(5,3),(5,4)
  p.nets = [new Net("A", [pinKey("J", "1"), pinKey("J", "2"), pinKey("J", "3")])];
  const r = route(p, LIBRARY);
  const ends = [];
  for (const j of r.jumpers) ends.push(`${j.x},${j.ya}`, `${j.x},${j.yb}`);
  assert.equal(new Set(ends).size, ends.length, "a hole is shared by two jumpers");
});

test("router leaves two different nets on adjacent holes as a short (cannot be cut)", () => {
  const p = new Project({ cols: 12, rows: 6 });
  p.addComponent(new Component({ ref: "J1", part: "header2", x: 2, y: 2 })); // (2,2)
  p.addComponent(new Component({ ref: "J2", part: "header2", x: 3, y: 2 })); // (3,2)
  p.nets = [new Net("A", [pinKey("J1", "1")]), new Net("B", [pinKey("J2", "1")])];
  const result = route(p, LIBRARY);
  p.cuts = result.cuts;
  p.jumpers = result.jumpers;
  const r = analyze(p, LIBRARY);
  assert.equal(r.ok, false);
  assert.ok(r.shorts.length >= 1);
});
