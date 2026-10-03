import test from "node:test";
import assert from "node:assert/strict";

import { Project, Component, Net, pinKey } from "../src/core/model.js";
import { LIBRARY } from "../src/core/library.js";
import { analyze } from "../src/core/connectivity.js";
import { contentBounds } from "../src/core/geometry.js";
import { optimize, EASY_WEIGHTS, COMPACT_WEIGHTS, BALANCED_WEIGHTS } from "../src/core/optimize.js";
import { route } from "../src/core/router.js";

test("optimizer fixes an off-board rotated part", () => {
  const p = new Project({ cols: 16, rows: 12 });
  // A resistor at y=1 rotated 180 puts pin 2 at (x, -2): off the board.
  p.addComponent(new Component({ ref: "R1", part: "resistor", x: 4, y: 1, rot: 180, locked: false }));
  p.addComponent(new Component({ ref: "R2", part: "resistor", x: 10, y: 6, locked: true }));
  p.nets = [new Net("A", [pinKey("R1", "2"), pinKey("R2", "1")])];

  assert.ok(analyze(p, LIBRARY).issues.some((i) => i.code === "pin-off-board"));
  const info = optimize(p, LIBRARY);
  assert.ok(info.score < info.startScore, "optimizer should improve the cost");
  assert.ok(!analyze(p, LIBRARY).issues.some((i) => i.code === "pin-off-board"));
});

test("compact pulls a free part toward a locked one", () => {
  const p = new Project({ cols: 24, rows: 12 });
  p.addComponent(new Component({ ref: "J1", part: "header2", x: 2, y: 2, locked: true }));
  p.addComponent(new Component({ ref: "J2", part: "header2", x: 18, y: 8, locked: false }));
  p.nets = [new Net("A", [pinKey("J1", "1"), pinKey("J2", "1")])];
  const b0 = contentBounds(p, LIBRARY);
  const spread0 = b0.x1 - b0.x0 + (b0.y1 - b0.y0);
  optimize(p, LIBRARY, { weights: { errors: 1000, diag: 200, jumpers: 10, cuts: 3, spread: 20 } });
  const b1 = contentBounds(p, LIBRARY);
  const spread1 = b1.x1 - b1.x0 + (b1.y1 - b1.y0);
  assert.ok(spread1 < spread0, `spread ${spread0} -> ${spread1}`);
});

test("three presets exist; easy favours fewer jumpers than balanced", () => {
  assert.equal(typeof BALANCED_WEIGHTS, "object");
  assert.equal(typeof COMPACT_WEIGHTS, "object");
  assert.ok(EASY_WEIGHTS.jumpers > BALANCED_WEIGHTS.jumpers, "easy must weight jumpers higher");

  const build = () => {
    const p = new Project({ cols: 24, rows: 12 });
    p.addComponent(new Component({ ref: "J1", part: "header4", x: 2, y: 2, locked: true }));
    p.addComponent(new Component({ ref: "J2", part: "header4", x: 5, y: 8, locked: false }));
    p.nets = [
      new Net("A", [pinKey("J1", "1"), pinKey("J2", "1")]),
      new Net("B", [pinKey("J1", "2"), pinKey("J2", "2")]),
    ];
    return p;
  };
  const jumpers = (p) => route(p, LIBRARY).jumpers.length;
  const bal = build();
  optimize(bal, LIBRARY, { maxPasses: 6, maxEvaluations: 300 });
  const easy = build();
  optimize(easy, LIBRARY, { weights: EASY_WEIGHTS, maxPasses: 6, maxEvaluations: 300 });
  assert.ok(jumpers(easy) <= jumpers(bal), `easy ${jumpers(easy)} vs balanced ${jumpers(bal)}`);
});

test("optimizer never moves a locked part", () => {
  const p = new Project({ cols: 12, rows: 12 });
  p.addComponent(new Component({ ref: "J1", part: "header4", x: 2, y: 2, locked: true }));
  p.addComponent(new Component({ ref: "J2", part: "header4", x: 2, y: 8, locked: true }));
  p.nets = [
    new Net("A", [pinKey("J1", "1"), pinKey("J2", "1")]),
    new Net("B", [pinKey("J1", "2"), pinKey("J2", "2")]),
  ];
  optimize(p, LIBRARY);
  assert.deepEqual([p.components.get("J1").x, p.components.get("J1").y], [2, 2]);
  assert.deepEqual([p.components.get("J2").x, p.components.get("J2").y], [2, 8]);
});
