import test from "node:test";
import assert from "node:assert/strict";

import { Project, Component, Net, pinKey } from "../src/core/model.js";
import { LIBRARY } from "../src/core/library.js";
import { analyze } from "../src/core/connectivity.js";
import { alignCuts } from "../src/core/align.js";

// Two rows, each with two single-pin nets that a cut must separate.
function board() {
  const p = new Project({ cols: 12, rows: 6 });
  for (const ref of ["J1", "J2", "J3", "J4"]) p.addComponent(new Component({ ref, part: "header2" }));
  p.components.get("J1").x = 2; p.components.get("J1").y = 2;
  p.components.get("J2").x = 10; p.components.get("J2").y = 2;
  p.components.get("J3").x = 2; p.components.get("J3").y = 4;
  p.components.get("J4").x = 10; p.components.get("J4").y = 4;
  p.nets = [
    new Net("A", [pinKey("J1", "1")]),
    new Net("B", [pinKey("J2", "1")]),
    new Net("C", [pinKey("J3", "1")]),
    new Net("D", [pinKey("J4", "1")]),
  ];
  return p;
}

test("alignCuts moves cuts into one column when valid", () => {
  const p = board();
  const cuts = new Set(["5,2", "7,4"]);
  p.cuts = new Set(cuts);
  assert.equal(analyze(p, LIBRARY).ok, true, "input board should be valid");

  const aligned = alignCuts(p, LIBRARY, cuts);
  const cols = new Set([...aligned].map((c) => c.split(",")[0]));
  assert.deepEqual([...cols], ["5"], "all cuts now share column 5");

  p.cuts = aligned;
  assert.equal(analyze(p, LIBRARY).ok, true, "aligned board is still valid");
});

test("alignCuts never moves a fixed cut", () => {
  const p = board();
  p.fixedCuts = new Set(["7,4"]);
  const cuts = new Set(["5,2", "7,4"]);
  p.cuts = new Set(cuts);
  const aligned = alignCuts(p, LIBRARY, cuts);
  assert.ok(aligned.has("7,4"), "fixed cut stays where it was");
});
