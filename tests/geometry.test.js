import test from "node:test";
import assert from "node:assert/strict";

import { rotateLocal, normalizeDeg, pinWorld } from "../src/core/geometry.js";
import { LIBRARY } from "../src/core/library.js";
import { Component } from "../src/core/model.js";

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

test("pinWorld applies rotation about the origin", () => {
  const part = LIBRARY.get("header3");
  const comp = new Component({ ref: "J1", part: "header3", x: 2, y: 4, rot: 90 });
  // pin 2 local (0,1) -> 90deg -> (-1,0) -> world (1,4)
  assert.deepEqual(pinWorld(comp, part, "2"), { x: 1, y: 4 });
});
