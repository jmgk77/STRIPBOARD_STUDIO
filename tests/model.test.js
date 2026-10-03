import test from "node:test";
import assert from "node:assert/strict";

import { Project, Component, Net, pinKey, pinLabel } from "../src/core/model.js";

test("connect merges existing nets and keeps the first id", () => {
  const p = new Project();
  p.addComponent(new Component({ ref: "J1", part: "header2" }));
  p.addComponent(new Component({ ref: "J2", part: "header2" }));
  p.nets = [new Net("A", [pinKey("J1", "1"), pinKey("J2", "1")]), new Net("B", [pinKey("J1", "2")])];
  const merged = p.connect([pinKey("J1", "1"), pinKey("J1", "2")]);
  assert.equal(merged.id, "A");
  assert.equal(merged.pins.size, 3);
  assert.equal(p.nets.length, 1);
});

test("removeComponent drops its pins from nets", () => {
  const p = new Project();
  p.addComponent(new Component({ ref: "J1", part: "header2" }));
  p.addComponent(new Component({ ref: "J2", part: "header2" }));
  p.nets = [new Net("A", [pinKey("J1", "1"), pinKey("J2", "1")])];
  p.removeComponent("J1");
  assert.equal(p.netOf(pinKey("J1", "1")), null);
  assert.notEqual(p.netOf(pinKey("J2", "1")), null);
});

test("uniqueRef skips taken refs", () => {
  const p = new Project();
  p.addComponent(new Component({ ref: "J1", part: "header2" }));
  assert.equal(p.uniqueRef("J"), "J2");
});

test("pinLabel prefers the instance pin name", () => {
  const p = new Project();
  p.addComponent(new Component({ ref: "U1", part: "module-2x10" }));
  p.components.get("U1").pinNames["L1"] = "GPIO4";
  assert.equal(pinLabel(p, "U1.L1"), "U1.GPIO4");
  assert.equal(pinLabel(p, "U1.L2"), "U1.L2");
});

test("net labels survive a JSON round-trip", () => {
  const p = new Project();
  p.nets = [new Net("N1", ["J1.1"], 1, "VCC")];
  const q = Project.fromJSON(p.toJSON());
  assert.equal(q.nets[0].label, "VCC");
  assert.deepEqual(q.toJSON(), p.toJSON());
});

test("pin names survive a JSON round-trip", () => {
  const p = new Project();
  p.addComponent(new Component({ ref: "U1", part: "module-2x10", pinNames: { L1: "GPIO4" } }));
  const q = Project.fromJSON(p.toJSON());
  assert.equal(q.components.get("U1").pinNames.L1, "GPIO4");
});

test("JSON round-trips", () => {
  const p = new Project({ cols: 20, rows: 12, title: "t" });
  p.addComponent(new Component({ ref: "J1", part: "header2", x: 3, y: 4, rot: 90, locked: true, value: "x" }));
  p.nets = [new Net("A", [pinKey("J1", "1")])];
  p.cuts = new Set(["5,5"]);
  p.jumpers = [{ x: 1, ya: 2, yb: 6 }];
  const q = Project.fromJSON(p.toJSON());
  assert.deepEqual(q.toJSON(), p.toJSON());
});
