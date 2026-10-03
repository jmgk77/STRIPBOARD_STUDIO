import test from "node:test";
import assert from "node:assert/strict";

import { Project, Component, Net, pinKey } from "../src/core/model.js";
import { LIBRARY } from "../src/core/library.js";
import { exportNetlist } from "../src/core/netlist.js";

function board() {
  const p = new Project({ cols: 12, rows: 10, title: "t" });
  p.addComponent(new Component({ ref: "R1", part: "resistor", value: "10k" }));
  p.addComponent(new Component({ ref: "C1", part: "capacitor", value: "100n" }));
  p.addComponent(new Component({ ref: "J1", part: "header2" }));
  p.nets = [
    new Net("N1", [pinKey("R1", "1"), pinKey("C1", "1")], 1, "VCC"),
    new Net("N2", [pinKey("R1", "2"), pinKey("J1", "1")], 1, "OUT"),
  ];
  return p;
}

test("json netlist lists components and nets", () => {
  const data = JSON.parse(exportNetlist(board(), LIBRARY, "json"));
  assert.equal(data.nets.find((n) => n.id === "N1").label, "VCC");
  assert.ok(data.components.some((c) => c.ref === "R1"));
});

test("spice netlist emits 2-pin devices and ends", () => {
  const text = exportNetlist(board(), LIBRARY, "spice");
  assert.match(text, /^R1 \d+ \d+ 10k$/m);
  assert.match(text, /^C1 /m);
  assert.match(text, /\.end/);
  assert.match(text, /skipped J1/); // header is not a SPICE device
});

test("kicad netlist has components and nets", () => {
  const text = exportNetlist(board(), LIBRARY, "kicad");
  assert.match(text, /<comp ref="R1">/);
  assert.match(text, /name="VCC"/);
  assert.match(text, /<node ref="R1" pin="1"\/>/);
});
