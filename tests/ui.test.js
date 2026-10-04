import test from "node:test";
import assert from "node:assert/strict";

import { installDom } from "./helpers/dom.mjs";

const dom = installDom();
const { App } = await import("../src/ui/app.js");

function click(app, ref) {
  const g = dom.document.createElement("g");
  g.setAttribute("data-ref", ref);
  const ev = { target: g, shiftKey: false, ctrlKey: false, metaKey: false, pointerId: 1, clientX: 0, clientY: 0, preventDefault() {} };
  app.svg.dispatch("pointerdown", ev);
  app.svg.dispatch("pointerup", {});
}

// Clear the app's pending status/autosave timers so the test process can exit promptly.
function makeApp(t) {
  const app = new App();
  t.after(() => {
    clearTimeout(app._statusTimer);
    clearTimeout(app._autosaveTimer);
  });
  return app;
}

test("add, duplicate, delete and undo work through the UI layer", (t) => {
  const app = makeApp(t);
  assert.equal(app.project.components.size, 0);
  app.addPart("header4");
  assert.equal(app.project.components.size, 1);
  assert.equal(app.selection.size, 1, "the new part is selected");
  app.duplicateSelected();
  assert.equal(app.project.components.size, 2);
  app.deleteSelected();
  assert.equal(app.project.components.size, 1);
  app.undo();
  assert.equal(app.project.components.size, 2, "undo restores the deleted copy");
});

test("a plain click selects, a second click deselects (F7 regression)", (t) => {
  const app = makeApp(t);
  app.addPart("terminal2");
  const ref = app.selected;
  app._clearSelection();
  assert.equal(app.selection.size, 0);
  click(app, ref);
  assert.ok(app.selection.has(ref), "first click selects");
  click(app, ref);
  assert.equal(app.selection.size, 0, "second click deselects");
});

test("G adds the whole selection to one group", (t) => {
  const app = makeApp(t);
  app.addPart("header2");
  const a = app.selected;
  app.addPart("header2");
  const b = app.selected;
  app.selection = new Set([a, b]);
  app.selected = b;
  app._addToGroup();
  assert.equal(app.project.components.get(a).group, "G1");
  assert.equal(app.project.components.get(b).group, "G1");
});

test("undo history is capped", (t) => {
  const app = makeApp(t);
  for (let i = 0; i < 130; i++) app.pushHistory(JSON.stringify(app.project.toJSON()));
  assert.equal(app.history.length, 100);
});
