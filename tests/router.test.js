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

test("a tombstoned cut is not re-derived (delete stays deleted)", () => {
  const p = new Project({ cols: 14, rows: 10 });
  p.addComponent(new Component({ ref: "J1", part: "header4", x: 2, y: 2 })); // (2,2)..(2,5)
  p.addComponent(new Component({ ref: "J2", part: "header4", x: 7, y: 2 })); // (7,2)..(7,5)
  p.nets = [
    new Net("A", [pinKey("J1", "1"), pinKey("J1", "4")]),
    new Net("B", [pinKey("J2", "1"), pinKey("J2", "4")]),
  ];
  const r1 = route(p, LIBRARY);
  const cut = [...r1.cuts].find((c) => c.endsWith(",2"));
  assert.ok(cut, `expected a cut on row 2, got ${JSON.stringify([...r1.cuts])}`);
  p.removedCuts = new Set([cut]);
  const r2 = route(p, LIBRARY);
  assert.ok(!r2.cuts.has(cut), `tombstoned cut ${cut} came back`);
  p.cuts = r2.cuts;
  p.jumpers = r2.jumpers;
  const a = analyze(p, LIBRARY);
  assert.equal(a.ok, true, JSON.stringify(a.issues));
});

test("a tombstoned jumper edge is not reused (delete stays deleted)", () => {
  const p = new Project({ cols: 12, rows: 10 });
  p.addComponent(new Component({ ref: "J1", part: "header4", x: 2, y: 2 })); // (2,2)..(2,5)
  p.addComponent(new Component({ ref: "J2", part: "header4", x: 4, y: 2 })); // (4,2)..(4,5)
  p.nets = [
    new Net("A", [pinKey("J1", "1"), pinKey("J1", "4")]),
    new Net("B", [pinKey("J2", "1"), pinKey("J2", "4")]),
  ];
  const r1 = route(p, LIBRARY);
  assert.ok(r1.jumpers.length > 0, "expected at least one jumper");
  const key = (j) => `${j.x},${j.ya},${j.yb}`;
  const banned = key(r1.jumpers[0]);
  p.removedJumpers = new Set([banned]);
  const r2 = route(p, LIBRARY);
  assert.ok(!r2.jumpers.some((j) => key(j) === banned), `tombstoned jumper ${banned} came back`);
});

test("the router never derives a cut at a mounting hole", () => {
  const p = new Project({ cols: 14, rows: 10 });
  p.addComponent(new Component({ ref: "J1", part: "header4", x: 2, y: 2 }));
  p.addComponent(new Component({ ref: "J2", part: "header4", x: 7, y: 2 }));
  p.nets = [
    new Net("A", [pinKey("J1", "1"), pinKey("J1", "4")]),
    new Net("B", [pinKey("J2", "1"), pinKey("J2", "4")]),
  ];
  const r1 = route(p, LIBRARY);
  const cut = [...r1.cuts].find((c) => c.endsWith(",2"));
  assert.ok(cut, `expected a cut on row 2, got ${JSON.stringify([...r1.cuts])}`);
  p.mountingHoles = new Set([cut]);
  const r2 = route(p, LIBRARY);
  assert.ok(!r2.cuts.has(cut), `the router cut at the mounting hole ${cut}`);
});

test("a fixed cut keeps the router from deriving another on that row", () => {
  const p = new Project({ cols: 12, rows: 6 });
  p.addComponent(new Component({ ref: "J1", part: "header2", x: 2, y: 2 })); // (2,2)
  p.addComponent(new Component({ ref: "J2", part: "header2", x: 10, y: 2 })); // (10,2)
  p.nets = [new Net("A", [pinKey("J1", "1")]), new Net("B", [pinKey("J2", "1")])];
  p.fixedCuts = new Set(["5,2"]);
  const r = route(p, LIBRARY);
  const rowCuts = [...r.cuts].filter((c) => c.endsWith(",2"));
  assert.deepEqual(rowCuts, ["5,2"], "only the user's cut remains on that row");
  p.cuts = new Set(r.cuts);
  assert.equal(analyze(p, LIBRARY).ok, true);
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
