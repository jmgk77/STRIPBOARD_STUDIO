import test from "node:test";
import assert from "node:assert/strict";

import { Project, Component, Net, pinKey } from "../src/core/model.js";
import { LIBRARY } from "../src/core/library.js";
import { analyze, cellId, safeMountCells } from "../src/core/connectivity.js";

function base() {
  const p = new Project({ cols: 12, rows: 10 });
  p.addComponent(new Component({ ref: "J1", part: "header2", x: 2, y: 2 })); // (2,2),(2,3)
  p.addComponent(new Component({ ref: "J2", part: "header2", x: 6, y: 5 })); // (6,5),(6,6)
  p.addComponent(new Component({ ref: "J3", part: "header2", x: 6, y: 2 })); // (6,2),(6,3)
  return p;
}

test("two nets on one uncut strip short together", () => {
  const p = base();
  p.nets = [new Net("A", [pinKey("J1", "1")]), new Net("B", [pinKey("J3", "1")])];
  const r = analyze(p, LIBRARY);
  assert.equal(r.ok, false);
  assert.ok(r.shorts.length >= 1);
});

test("a cut between them separates the nets", () => {
  const p = base();
  p.nets = [new Net("A", [pinKey("J1", "1")]), new Net("B", [pinKey("J3", "1")])];
  p.cuts = new Set([cellId(4, 2)]);
  const r = analyze(p, LIBRARY);
  assert.equal(r.ok, true, JSON.stringify(r.issues));
});

test("a net split across rows is open; a jumper closes it", () => {
  const p = base();
  p.nets = [new Net("A", [pinKey("J1", "1"), pinKey("J2", "1")])]; // (2,2) and (6,5)
  let r = analyze(p, LIBRARY);
  assert.equal(r.ok, false);
  assert.ok(r.unconnected.length >= 1);
  p.jumpers = [{ x: 3, ya: 2, yb: 5 }]; // free column, not on a pin
  r = analyze(p, LIBRARY);
  assert.equal(r.ok, true, JSON.stringify(r.issues));
});

test("issue messages use the net label and carry the net id", () => {
  const p = base();
  p.nets = [new Net("N1", [pinKey("J1", "1"), pinKey("J2", "1")], 1, "VCC")];
  const open = analyze(p, LIBRARY).issues.find((i) => i.code === "net-open");
  assert.ok(open);
  assert.ok(open.message.includes("VCC"));
  assert.equal(open.netId, "N1");
});

test("a pin sitting on a cut is an error", () => {
  const p = base();
  p.cuts = new Set([cellId(2, 2)]);
  const r = analyze(p, LIBRARY);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === "pin-on-cut"));
});

test("overlapping components are flagged", () => {
  const p = new Project({ cols: 12, rows: 12 });
  p.addComponent(new Component({ ref: "J1", part: "header4", x: 2, y: 2 })); // rows 2..5
  p.addComponent(new Component({ ref: "J2", part: "header4", x: 2, y: 4 })); // rows 4..7
  const r = analyze(p, LIBRARY);
  assert.ok(r.issues.some((i) => i.code === "overlap"));
});

test("problem messages give positions as letter+number", () => {
  const p = base(); // 12x10; J1.1 is at (2,2) -> row I, column 2
  p.cuts = new Set([cellId(2, 2)]);
  const onCut = analyze(p, LIBRARY).issues.find((i) => i.code === "pin-on-cut");
  assert.ok(onCut);
  assert.ok(onCut.message.includes("I2"), onCut.message);
});

test("a jumper under a flush body is an error", () => {
  const p = new Project({ cols: 12, rows: 12 });
  p.addComponent(new Component({ ref: "D1", part: "dip8", x: 3, y: 3 })); // pins x3/x6, body x4-5
  p.jumpers = [{ x: 4, ya: 3, yb: 6 }]; // arcs through the DIP body interior (no pin there)
  const r = analyze(p, LIBRARY);
  assert.ok(r.issues.some((i) => i.code === "jumper-under-body"), JSON.stringify(r.issues));
});

test("safeMountCells: idle copper is safe, net copper between pins is not", () => {
  const p = new Project({ cols: 12, rows: 4 });
  p.addComponent(new Component({ ref: "J1", part: "header2", x: 2, y: 2 })); // pin (2,2)
  p.addComponent(new Component({ ref: "J2", part: "header2", x: 8, y: 2 })); // pin (8,2)
  p.nets = [new Net("A", [pinKey("J1", "1"), pinKey("J2", "1")])];
  const safe = safeMountCells(p, LIBRARY);
  assert.ok(!safe.has("5,2"), "between two net pins must be unsafe");
  assert.ok(safe.has("10,2"), "dead-end past the last net pin is safe");
  assert.ok(!safe.has("2,2"), "a pin cell is never safe");
  assert.ok(safe.has("5,4"), "an unused strip is safe");
});

test("safeMountCells: a jumper end is a connection point", () => {
  const p = new Project({ cols: 12, rows: 6 });
  p.addComponent(new Component({ ref: "J1", part: "header2", x: 2, y: 2 })); // pin (2,2) on net A
  p.nets = [new Net("A", [pinKey("J1", "1")])];
  p.jumpers = [{ x: 10, ya: 2, yb: 5, net: "A" }]; // carries net A off this run
  const safe = safeMountCells(p, LIBRARY);
  assert.ok(!safe.has("6,2"), "between a net pin and a jumper end must be unsafe");
  assert.ok(safe.has("11,2"), "past the jumper end is a dead-end, safe");
});

test("a mounting hole breaks the strip", () => {
  const p = new Project({ cols: 12, rows: 6 });
  p.addComponent(new Component({ ref: "J1", part: "header2", x: 2, y: 2 })); // pin (2,2)
  p.addComponent(new Component({ ref: "J2", part: "header2", x: 8, y: 2 })); // pin (8,2)
  p.nets = [new Net("A", [pinKey("J1", "1"), pinKey("J2", "1")])];
  assert.equal(analyze(p, LIBRARY).ok, true); // one strip: connected
  p.mountingHoles = new Set(["5,2"]);
  const r = analyze(p, LIBRARY);
  assert.equal(r.ok, false);
  assert.ok(r.unconnected.some((i) => i.code === "net-open"));
});

test("a pin on a mounting hole is an error", () => {
  const p = new Project({ cols: 12, rows: 6 });
  p.addComponent(new Component({ ref: "J1", part: "header2", x: 2, y: 2 })); // pin (2,2)
  p.mountingHoles = new Set(["2,2"]);
  const r = analyze(p, LIBRARY);
  assert.ok(r.issues.some((i) => i.code === "mount-on-pin" && i.level === "error"), JSON.stringify(r.issues));
});

test("a mounting hole under a flush body is a warning", () => {
  const p = new Project({ cols: 12, rows: 8 });
  p.addComponent(new Component({ ref: "D1", part: "dip8", x: 3, y: 3 })); // body x4-5, y3-6
  p.mountingHoles = new Set(["4,4"]); // interior of the body, not a pin
  const r = analyze(p, LIBRARY);
  assert.ok(r.issues.some((i) => i.code === "mount-under-body" && i.level === "warn"), JSON.stringify(r.issues));
});

test("two jumpers sharing a hole is an error", () => {
  const p = base();
  p.jumpers = [
    { x: 4, ya: 2, yb: 5 },
    { x: 4, ya: 2, yb: 8 },
  ];
  const r = analyze(p, LIBRARY);
  assert.ok(r.issues.some((i) => i.code === "jumper-collision"));
});
