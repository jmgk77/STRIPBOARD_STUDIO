import test from "node:test";
import assert from "node:assert/strict";

import { rotateLocal, normalizeDeg, pinWorld, contentBounds } from "../src/core/geometry.js";
import { LIBRARY } from "../src/core/library.js";
import { Component, Project } from "../src/core/model.js";

test("rotateLocal handles the four orientations", () => {
  assert.deepEqual(rotateLocal(2, 1, 0), { x: 2, y: 1 });
  assert.deepEqual(rotateLocal(2, 1, 90), { x: -1, y: 2 });
  assert.deepEqual(rotateLocal(2, 1, 180), { x: -2, y: -1 });
  assert.deepEqual(rotateLocal(2, 1, 270), { x: 1, y: -2 });
});

test("four 90-degree rotations return to start", () => {
  let p = { x: 3, y: 5 };
  for (let i = 0; i < 4; i++) p = rotateLocal(p.x, p.y, 90);
  assert.deepEqual(p, { x: 3, y: 5 });
});

test("normalizeDeg", () => {
  assert.equal(normalizeDeg(-90), 270);
  assert.equal(normalizeDeg(450), 90);
});

test("pinWorld translates by the component origin", () => {
  const part = LIBRARY.get("header3"); // pins 1..3 down column 0
  const comp = new Component({ ref: "J1", part: "header3", x: 2, y: 4 });
  assert.deepEqual(pinWorld(comp, part, "1"), { x: 2, y: 4 });
  assert.deepEqual(pinWorld(comp, part, "3"), { x: 2, y: 6 });
});

test("a bendable part's span sets its second pin", () => {
  const part = LIBRARY.get("resistor");
  const c = new Component({ ref: "R1", part: "resistor", x: 4, y: 4, span: 5 });
  assert.deepEqual(pinWorld(c, part, "2"), { x: 4, y: 9 });
  const d = new Component({ ref: "R2", part: "resistor", x: 4, y: 4 }); // default span 3
  assert.deepEqual(pinWorld(d, part, "2"), { x: 4, y: 7 });
});

test("contentBounds covers pins and cuts", () => {
  const p = new Project({ cols: 20, rows: 12 });
  p.addComponent(new Component({ ref: "R1", part: "resistor", x: 3, y: 2, span: 4 })); // (3,2)..(3,6)
  p.cuts = new Set(["10,9"]);
  assert.deepEqual(contentBounds(p, LIBRARY), { x0: 3, y0: 2, x1: 10, y1: 9 });
});

test("pinWorld applies rotation about the origin", () => {
  const part = LIBRARY.get("header3");
  const comp = new Component({ ref: "J1", part: "header3", x: 2, y: 4, rot: 90 });
  // pin 2 local (0,1) -> 90deg -> (-1,0) -> world (1,4)
  assert.deepEqual(pinWorld(comp, part, "2"), { x: 1, y: 4 });
});
