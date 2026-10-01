import test from "node:test";
import assert from "node:assert/strict";

import { toAscii } from "../src/core/ascii.js";
import { Project, Component, Net, pinKey } from "../src/core/model.js";
import { LIBRARY } from "../src/core/library.js";

test("ascii shows pins, cuts, jumpers and a legend", () => {
  const p = new Project({ cols: 12, rows: 8, title: "t" });
  p.addComponent(new Component({ ref: "J1", part: "header2", x: 2, y: 2 })); // (2,2),(2,3)
  p.addComponent(new Component({ ref: "R1", part: "resistor", x: 6, y: 3, span: 3 })); // (6,3),(6,6)
  p.nets = [new Net("A", [pinKey("J1", "1"), pinKey("R1", "1")])];
  p.cuts = new Set(["4,2"]);
  p.jumpers = [{ x: 2, ya: 2, yb: 6 }];

  const text = toAscii(p, LIBRARY);
  assert.match(text, /legend/);
  assert.ok(text.includes("x"), "cut marker");
  assert.ok(text.includes("o"), "jumper end marker");
  assert.ok(text.includes("|"), "jumper arc marker");
  assert.ok(text.includes("J1"), "component legend");
  assert.ok(text.includes("A: J1.1, R1.1"), "net legend");
});

test("ascii of an empty board is just copper", () => {
  const p = new Project({ cols: 4, rows: 3 });
  const text = toAscii(p, LIBRARY);
  assert.ok(text.includes("----"));
});
