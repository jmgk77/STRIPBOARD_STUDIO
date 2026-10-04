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

test("zoom/pan updates the SVG viewBox", (t) => {
  const app = makeApp(t);
  const { width, height } = app._viewBase();
  app.zoomFit();
  assert.equal(app.svg.getAttribute("viewBox"), `0 0 ${width} ${height}`);
  app.zoomBy(2); // about the centre
  const vb = app.svg.getAttribute("viewBox").split(" ").map(Number);
  assert.ok(Math.abs(vb[2] - width / 2) < 1e-6, `visible width ${vb[2]}`);
  assert.ok(Math.abs(vb[3] - height / 2) < 1e-6);
  assert.equal(dom.getElementById("zoomPct").textContent, "200%");
});

test("tool hotkeys toggle the mode", (t) => {
  const app = makeApp(t);
  const press = (key) => dom.document.dispatch("keydown", { target: { tagName: "BODY" }, key, shiftKey: false, ctrlKey: false, metaKey: false, preventDefault() {} });
  press("c");
  assert.equal(app.mode, "connect");
  press("c");
  assert.equal(app.mode, "select");
  press("x");
  assert.equal(app.mode, "cut");
  press("x");
  assert.equal(app.mode, "select");
  press("j");
  assert.equal(app.mode, "jumper");
  press("m");
  assert.equal(app.mode, "mount");
});

test("the save indicator reflects the dirty flag", (t) => {
  const app = makeApp(t);
  assert.equal(dom.getElementById("saveState").textContent, "saved");
  app.addPart("header2");
  assert.equal(dom.getElementById("saveState").textContent, "● unsaved");
});

test("Save As uses a dialog and never reuses a name", (t) => {
  const app = makeApp(t);
  app.saveAs();
  assert.equal(dom.getElementById("saveDlg").open, true, "dialog opened");
  dom.getElementById("saveName").value = "board";
  app._confirmSave();
  assert.equal(app.fileName, "board");
  app.saveAs();
  dom.getElementById("saveName").value = "board";
  app._confirmSave();
  assert.equal(app.fileName, "board (1)", "second save gets a new name");
});

test("undo history is capped", (t) => {
  const app = makeApp(t);
  for (let i = 0; i < 130; i++) app.pushHistory(JSON.stringify(app.project.toJSON()));
  assert.equal(app.history.length, 100);
});
