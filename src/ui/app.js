// Application state and interactions. Renders through ui/scene.js and mutates the model
// in core/. Undo/redo is whole-project snapshots taken before each change.

import { Component, Project, pinLabel, pinKey, splitPin } from "../core/model.js";
import { LIBRARY, listParts, buildBarPart, registerPart, registerProjectParts } from "../core/library.js";
import { analyze } from "../core/connectivity.js";
import { route } from "../core/router.js";
import { optimize as optimizeLayout, COMPACT_WEIGHTS } from "../core/optimize.js";
import { contentBounds } from "../core/geometry.js";
import { toAscii } from "../core/ascii.js";
import { render, CELL, PAD } from "./scene.js";

const REF_PREFIX = { resistor: "R", led: "D", diode: "D", transistor: "Q", module: "U" };

export class App {
  constructor() {
    this.svg = document.getElementById("board");
    this.project = starterProject();
    this.view = "front";
    this.selected = null;
    this.pending = null;
    this.mode = "select";
    this.solved = false;
    this.showNames = true;
    this.selectedNet = null;
    this.selectedWire = null;
    this.layers = { parts: true, wires: true, cuts: true, copper: true, nets: true, grid: true };
    this._editBefore = null;
    this.fileName = null;
    this.issues = [];
    this.history = [];
    this.redoStack = [];
    this.drag = null;
    this.wireDrag = null;

    this._bindToolbar();
    this._bindBoard();
    this._bindKeyboard();
    this._syncSizeInputs();
    this.render();
  }

  _syncSizeInputs() {
    document.getElementById("cols").value = this.project.cols;
    document.getElementById("rows").value = this.project.rows;
  }

  // -- rendering ----------------------------------------------------------------

  render() {
    render(this.svg, {
      project: this.project,
      library: LIBRARY,
      view: this.view,
      selected: this.selected,
      pending: this.pending,
      mode: this.mode,
      solved: this.solved,
      showNames: this.showNames,
      selectedNet: this.selectedNet,
      selectedWire: this.selectedWire,
      layers: this.layers,
      issues: this.issues,
    });
    this._renderPalette();
    this._renderNets();
    this._renderProblems();
    this._renderSelection();
  }

  _renderPalette() {
    const box = document.getElementById("palette-list");
    box.innerHTML = "";
    for (const part of listParts()) {
      const item = document.createElement("div");
      item.className = "item";
      item.textContent = part.label;
      item.addEventListener("click", () => this.addPart(part.name));
      box.appendChild(item);
    }
  }

  _renderNets() {
    const box = document.getElementById("nets");
    box.innerHTML = "";
    if (this.project.nets.length === 0) {
      box.innerHTML = '<div class="muted">no nets yet — use Connect</div>';
      return;
    }
    for (const net of this.project.nets) {
      const row = document.createElement("div");
      row.className = "item" + (this.selectedNet === net.id ? " active" : "");

      const head = document.createElement("div");
      head.className = "nethead";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "netname";
      input.placeholder = net.id;
      input.value = net.label || "";
      input.addEventListener("focus", () => {
        this._editBefore = JSON.stringify(this.project.toJSON());
      });
      input.addEventListener("input", () => {
        net.label = input.value.trim();
        this.scene.set_project(this.project);
      });
      input.addEventListener("change", () => {
        if (this._editBefore) this.pushHistory(this._editBefore);
        this._editBefore = null;
        this.render();
      });
      const del = document.createElement("button");
      del.className = "minibtn";
      del.textContent = "✕";
      del.title = "delete this net";
      del.addEventListener("click", () => {
        this.snapshot();
        this.project.nets = this.project.nets.filter((n) => n !== net);
        if (this.selectedNet === net.id) this.selectedNet = null;
        this._afterStructuralChange(false);
      });
      head.appendChild(input);
      head.appendChild(del);
      row.appendChild(head);

      const pins = document.createElement("div");
      pins.className = "netpins";
      if (net.pins.size === 0) pins.innerHTML = '<span class="muted">(no pins)</span>';
      for (const key of [...net.pins].sort()) {
        const ref = splitPin(key).ref;
        const chip = document.createElement("span");
        chip.className = "chip" + (ref === this.selected ? " sel" : "");
        chip.title = "click to select this component";
        chip.appendChild(document.createTextNode(pinLabel(this.project, key)));
        chip.addEventListener("click", (e) => {
          e.stopPropagation();
          this.selected = ref;
          this.selectedNet = net.id;
          this.render();
        });
        const x = document.createElement("button");
        x.className = "chipx";
        x.textContent = "✕";
        x.title = "remove this pin from the net";
        x.addEventListener("click", (e) => {
          e.stopPropagation();
          this.snapshot();
          net.pins.delete(key);
          if (net.pins.size === 0) this.project.nets = this.project.nets.filter((n) => n !== net);
          this._afterStructuralChange(true);
        });
        chip.appendChild(x);
        pins.appendChild(chip);
      }
      row.appendChild(pins);
      row.addEventListener("click", (e) => {
        if (e.target.closest("input,button")) return;
        this.selectedNet = this.selectedNet === net.id ? null : net.id;
        this.render();
      });
      box.appendChild(row);
    }
  }

  _renderProblems() {
    const box = document.getElementById("problems");
    box.innerHTML = "";
    if (this.issues.length === 0) {
      box.innerHTML = '<div class="muted">no problems</div>';
      return;
    }
    for (const issue of this.issues) {
      const item = document.createElement("div");
      item.className = "item";
      const pill = document.createElement("span");
      pill.className = `pill ${issue.level === "error" ? "error" : "warn"}`;
      pill.textContent = issue.level;
      item.appendChild(pill);
      item.appendChild(document.createTextNode(" " + issue.message));
      item.title = "click to highlight";
      item.addEventListener("click", () => {
        this.selected = null;
        this.selectedWire = null;
        if (issue.netId) this.selectedNet = issue.netId;
        else if (issue.netIds?.length) this.selectedNet = issue.netIds[0];
        else if (issue.ref) this.selected = issue.ref;
        else if (issue.refs?.length) this.selected = issue.refs[0];
        this.render();
      });
      box.appendChild(item);
    }
  }

  _renderSelection() {
    const box = document.getElementById("selection");
    box.innerHTML = "";
    const comp = this.selected ? this.project.components.get(this.selected) : null;
    if (!comp) {
      box.textContent = this.pending ? `connect: ${this.pending} — click another pin` : "(none)";
      return;
    }
    const part = LIBRARY.get(comp.part);
    const head = document.createElement("div");
    const lock = comp.locked ? "locked" : "free";
    head.textContent = `${comp.ref} — ${part?.label ?? comp.part} — rot ${comp.rot}° — ${lock}`;
    box.appendChild(head);

    if (part?.bendable) {
      const row = document.createElement("div");
      row.className = "pinrow";
      const tag = document.createElement("span");
      tag.className = "pintag";
      tag.textContent = "span";
      const input = document.createElement("input");
      input.type = "number";
      input.min = String(part.bendable.min);
      input.max = String(part.bendable.max);
      input.value = String(comp.span || part.bendable.default);
      input.addEventListener("change", () => {
        this.snapshot();
        const v = Number(input.value) || part.bendable.default;
        comp.span = Math.max(part.bendable.min, Math.min(part.bendable.max, v));
        this.render();
      });
      row.appendChild(tag);
      row.appendChild(input);
      box.appendChild(row);
    }

    const hint = document.createElement("div");
    hint.className = "muted";
    hint.textContent = "pin names (blank = use the pin id):";
    box.appendChild(hint);

    const list = document.createElement("div");
    list.className = "pinlist";
    for (const pin of part?.pins ?? []) {
      const row = document.createElement("div");
      row.className = "pinrow";
      const tag = document.createElement("span");
      tag.className = "pintag";
      tag.textContent = pin.id;
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = pin.id;
      input.value = comp.pinNames?.[pin.id] ?? "";
      input.addEventListener("focus", () => {
        this._editBefore = JSON.stringify(this.project.toJSON());
      });
      input.addEventListener("input", () => {
        const value = input.value.trim();
        if (value) comp.pinNames[pin.id] = value;
        else delete comp.pinNames[pin.id];
        this.scene.set_project(this.project); // update board labels, keep focus here
      });
      input.addEventListener("change", () => {
        if (this._editBefore) this.pushHistory(this._editBefore);
        this._editBefore = null;
        this.render();
      });
      row.appendChild(tag);
      row.appendChild(input);

      const net = this.project.netOf(pinKey(comp.ref, pin.id));
      if (net) {
        const badge = document.createElement("span");
        badge.className = "netbadge";
        badge.textContent = net.label || net.id;
        const off = document.createElement("button");
        off.className = "minibtn";
        off.textContent = "✕";
        off.title = "disconnect this pin";
        off.addEventListener("click", () => {
          this.snapshot();
          net.pins.delete(pinKey(comp.ref, pin.id));
          if (net.pins.size === 0) this.project.nets = this.project.nets.filter((n) => n !== net);
          this._afterStructuralChange(false);
        });
        row.appendChild(badge);
        row.appendChild(off);
      }
      list.appendChild(row);
    }
    box.appendChild(list);
  }

  // -- history ------------------------------------------------------------------

  pushHistory(json) {
    this.history.push(json);
    this.redoStack.length = 0;
  }

  snapshot() {
    this.pushHistory(JSON.stringify(this.project.toJSON()));
  }

  undo() {
    if (!this.history.length) return;
    this.redoStack.push(JSON.stringify(this.project.toJSON()));
    this.project = Project.fromJSON(JSON.parse(this.history.pop()));
    this._afterStructuralChange(false);
  }

  redo() {
    if (!this.redoStack.length) return;
    this.history.push(JSON.stringify(this.project.toJSON()));
    this.project = Project.fromJSON(JSON.parse(this.redoStack.pop()));
    this._afterStructuralChange(false);
  }

  _afterStructuralChange(invalidate = true) {
    if (invalidate) this.invalidateRouting();
    else this.solved = this.project.jumpers.length > 0 || this.project.cuts.size > 0;
    this.selected = this.project.components.has(this.selected) ? this.selected : null;
    this.pending = null;
    this._recomputeIssues();
    this.render();
  }

  invalidateRouting() {
    this.project.cuts = new Set();
    this.project.jumpers = [];
    this.solved = false;
  }

  _recomputeIssues() {
    const result = analyze(this.project, LIBRARY);
    this.issues = result.issues;
  }

  // -- editing ------------------------------------------------------------------

  findFreeSpot() {
    for (let y = 2; y <= this.project.rows - 2; y++) {
      for (let x = 2; x <= this.project.cols - 2; x++) {
        const clash = [...this.project.components.values()].some(
          (c) => Math.abs(c.x - x) < 2 && Math.abs(c.y - y) < 3,
        );
        if (!clash) return { x, y };
      }
    }
    return { x: 2, y: 2 };
  }

  addPart(name) {
    const part = LIBRARY.get(name);
    const prefix = REF_PREFIX[part.kind] ?? "J";
    const ref = this.project.uniqueRef(prefix);
    const spot = this.findFreeSpot();
    this.snapshot();
    this.project.addComponent(new Component({ ref, part: name, x: spot.x, y: spot.y, rot: 0, locked: false, value: part.defaultValue }));
    this.selected = ref;
    this._afterStructuralChange();
  }

  openNewPart() {
    document.getElementById("pLabel").value = "Header";
    document.getElementById("pDouble").value = "no";
    document.getElementById("pCount").value = 8;
    document.getElementById("pGap").value = 3;
    document.getElementById("pPrefix").value = "";
    document.getElementById("pLeft").value = "L";
    document.getElementById("pRight").value = "R";
    this.updatePartForm();
    document.getElementById("partDlg").showModal();
  }

  updatePartForm() {
    const doubleRow = document.getElementById("pDouble").value === "yes";
    for (const id of ["rowGap", "rowLeft", "rowRight"]) {
      document.getElementById(id).style.display = doubleRow ? "flex" : "none";
    }
    document.getElementById("rowPrefix").style.display = doubleRow ? "none" : "flex";
  }

  createPart() {
    const label = document.getElementById("pLabel").value.trim() || "Bar";
    const doubleRow = document.getElementById("pDouble").value === "yes";
    const count = Math.max(1, Number(document.getElementById("pCount").value) || 1);
    const gap = Number(document.getElementById("pGap").value) || 3;
    const prefix = document.getElementById("pPrefix").value.trim();
    const leftPrefix = document.getElementById("pLeft").value.trim() || "L";
    const rightPrefix = document.getElementById("pRight").value.trim() || "R";
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "bar";
    const base = `custom-${slug}`;
    let name = base;
    let k = 2;
    while (LIBRARY.has(name)) name = `${base}-${k++}`;
    const spec = { name, label, count, gap, doubleRow, prefix, leftPrefix, rightPrefix };
    registerPart(buildBarPart(spec));
    this.snapshot();
    this.project.customParts.push(spec);
    document.getElementById("partDlg").close();
    this.render();
    this._status(`created ${label} (${count} ${doubleRow ? "x2" : ""} pins)`);
  }

  rotateSelected() {
    const comp = this.selected && this.project.components.get(this.selected);
    if (!comp) return;
    const part = LIBRARY.get(comp.part);
    if (part && part.rotatable === false) return;
    this.snapshot();
    comp.rot = (comp.rot + 90) % 360;
    this._afterStructuralChange();
  }

  lockSelected() {
    const comp = this.selected && this.project.components.get(this.selected);
    if (!comp) return;
    this.snapshot();
    comp.locked = !comp.locked;
    this.render();
  }

  deleteSelected() {
    if (this.selectedWire) {
      const w = this.selectedWire;
      this.snapshot();
      if (w.kind === "jumper") this.project.jumpers.splice(w.i, 1);
      else {
        this.project.cuts.delete(w.key);
        this.project.fixedCuts.delete(w.key);
      }
      this.selectedWire = null;
      this._afterStructuralChange(false);
      return;
    }
    if (!this.selected) return;
    this.snapshot();
    this.project.removeComponent(this.selected);
    this.selected = null;
    this._afterStructuralChange();
  }

  unfixSelected() {
    const w = this.selectedWire;
    if (!w) return;
    this.snapshot();
    if (w.kind === "jumper") {
      const j = this.project.jumpers[w.i];
      if (j) j.fixed = false;
    } else {
      this.project.fixedCuts.delete(w.key);
    }
    this._afterStructuralChange(false);
    this._status("unfixed (Solve may re-route it)");
  }

  setMode(mode) {
    this.mode = mode;
    if (mode !== "connect") this.pending = null;
    document.getElementById("connect").classList.toggle("active", mode === "connect");
    this.render();
    if (mode === "connect") this._status("connect: click a first pin, then a second pin (Esc cancels)");
  }

  handlePinClick(key) {
    if (this.mode !== "connect") return;
    // With a net selected, Connect adds pins to that net (edit its membership).
    if (this.selectedNet) {
      const net = this.project.nets.find((n) => n.id === this.selectedNet);
      if (net && !net.pins.has(key)) {
        this.snapshot();
        this.project.assignPin(key, net.id);
        this._afterStructuralChange(true);
        this._status(`added ${pinLabel(this.project, key)} to ${net.label || net.id}`);
      }
      return;
    }
    if (!this.pending) {
      this.pending = key;
      this.render();
      return;
    }
    if (this.pending === key) {
      this.pending = null;
      this.render();
      return;
    }
    this.snapshot();
    this.project.connect([this.pending, key]);
    this.pending = null;
    this._afterStructuralChange();
  }

  // -- solve --------------------------------------------------------------------

  solve() {
    this._runBusy("Solving…", () => {
      this.project.fixedCuts = this.project.fixedCuts ?? new Set();
      const result = route(this.project, LIBRARY);
      this.snapshot();
      this.project.cuts = new Set(result.cuts);
      this.project.jumpers = result.jumpers.map((j) => ({
        x: j.x, ya: j.ya, yb: j.yb, net: j.net, fixed: !!j.fixed,
      }));
      this.selectedWire = null;
      this.solved = true;
      const analysis = analyze(this.project, LIBRARY);
      this.issues = [...result.diagnostics, ...analysis.issues];
      this.render();
      const errors = this.issues.filter((i) => i.level === "error").length;
      this._status(
        errors
          ? `solved with ${errors} problem(s)`
          : `solved: ${result.jumpers.length} jumper(s), ${result.cuts.size} cut(s)`,
      );
    });
  }

  optimize() {
    this._optimize(null, "Optimizing…", "optimized");
  }

  compact() {
    // Spread/wire/span weigh heavily, so parts are pulled together and leads shortened.
    this._optimize(COMPACT_WEIGHTS, "Compacting…", "compacted", { maxPasses: 6, maxEvaluations: 300 });
  }

  _optimize(weights, busyMsg, verb, opts = {}) {
    this._runBusy(busyMsg, () => {
      this.snapshot();
      const info = weights
        ? optimizeLayout(this.project, LIBRARY, { weights, ...opts })
        : optimizeLayout(this.project, LIBRARY, opts);
      const result = route(this.project, LIBRARY);
      this.project.cuts = result.cuts;
      this.project.jumpers = result.jumpers;
      this.solved = true;
      this._recomputeIssues();
      this.render();
      this._status(
        `${verb} ${info.components} free part(s): cost ${info.startScore} -> ${info.score} (spread ${info.spread})`,
      );
    });
  }

  trim() {
    const b = contentBounds(this.project, LIBRARY);
    if (!b) return;
    this.snapshot();
    const dx = 1 - b.x0; // fit the content exactly, no extra leading row/column
    const dy = 1 - b.y0;
    for (const c of this.project.components.values()) {
      c.x += dx;
      c.y += dy;
    }
    this.project.cols = b.x1 - b.x0 + 1;
    this.project.rows = b.y1 - b.y0 + 1;
    this.invalidateRouting();
    document.getElementById("cols").value = this.project.cols;
    document.getElementById("rows").value = this.project.rows;
    this._afterStructuralChange(true);
    this._status(`board trimmed to ${this.project.cols} x ${this.project.rows}`);
  }

  showAscii() {
    const pre = document.getElementById("asciiText");
    pre.textContent = toAscii(this.project, LIBRARY);
    document.getElementById("asciiDlg").showModal();
    this._select( pre); // so Ctrl+C works even if the clipboard API is blocked
  }

  _select(node) {
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  _copyAscii() {
    const pre = document.getElementById("asciiText");
    const fallback = () => {
      this._select(pre);
      try {
        const ok = document.execCommand("copy");
        this._status(ok ? "board text copied" : "text selected — press Ctrl+C");
      } catch {
        this._status("text selected — press Ctrl+C");
      }
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(pre.textContent)
        .then(() => this._status("board text copied"))
        .catch(fallback);
    } else {
      fallback();
    }
  }

  setView(copper) {
    this.view = copper ? "copper" : "front";
    this.render();
  }

  setBoardSize(cols, rows) {
    this.snapshot();
    this.project.cols = cols;
    this.project.rows = rows;
    this._afterStructuralChange(true);
  }

  // -- files --------------------------------------------------------------------

  newProject() {
    const cols = Number(document.getElementById("cols").value) || 34;
    const rows = Number(document.getElementById("rows").value) || 26;
    this.project = new Project({ cols, rows });
    this.fileName = null;
    this._syncSizeInputs();
    this.selected = null;
    this.pending = null;
    this.solved = false;
    this.history.length = 0;
    this.redoStack.length = 0;
    this._recomputeIssues();
    this.render();
  }

  save() {
    if (!this.fileName) {
      const name = window.prompt("Save board as", this.project.title || "board");
      if (name == null) return;
      this.fileName = (name.trim() || "board").replace(/\.json$/i, "");
      this.project.title = this.fileName;
    }
    const blob = new Blob([JSON.stringify(this.project.toJSON(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${this.fileName}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this._status(`saved ${this.fileName}.json`);
  }

  async open(file) {
    const text = await file.text();
    this.project = Project.fromJSON(JSON.parse(text));
    registerProjectParts(this.project.customParts);
    this.fileName = (file.name || "board").replace(/\.json$/i, "");
    document.getElementById("cols").value = this.project.cols;
    document.getElementById("rows").value = this.project.rows;
    this.selected = null;
    this.pending = null;
    this.solved = false;
    this.history.length = 0;
    this.redoStack.length = 0;
    this._recomputeIssues();
    this.render();
  }

  // -- input --------------------------------------------------------------------

  _bindToolbar() {
    const on = (id, fn) => document.getElementById(id).addEventListener("click", fn);
    on("new", () => this.newProject());
    on("save", () => this.save());
    on("open", () => document.getElementById("file").click());
    on("newPart", () => this.openNewPart());
    document.getElementById("partCancel").addEventListener("click", () => document.getElementById("partDlg").close());
    document.getElementById("partCreate").addEventListener("click", () => this.createPart());
    document.getElementById("pDouble").addEventListener("change", () => this.updatePartForm());
    on("undo", () => this.undo());
    on("redo", () => this.redo());
    on("rotate", () => this.rotateSelected());
    on("lock", () => this.lockSelected());
    on("delete", () => this.deleteSelected());
    on("solve", () => this.solve());
    on("optimize", () => this.optimize());
    on("compact", () => this.compact());
    on("trim", () => this.trim());
    on("ascii", () => this.showAscii());
    document.getElementById("asciiClose").addEventListener("click", () =>
      document.getElementById("asciiDlg").close(),
    );
    document.getElementById("asciiCopy").addEventListener("click", () => this._copyAscii());
    on("connect", () => this.setMode(this.mode === "connect" ? "select" : "connect"));
    document.getElementById("names").addEventListener("change", (e) => {
      this.showNames = e.target.checked;
      this.render();
    });
    on("unfix", () => this.unfixSelected());
    const layerIds = { "lc-parts": "parts", "lc-wires": "wires", "lc-cuts": "cuts", "lc-copper": "copper", "lc-nets": "nets", "lc-grid": "grid" };
    for (const [id, key] of Object.entries(layerIds)) {
      document.getElementById(id).addEventListener("change", (e) => {
        this.layers[key] = e.target.checked;
        this.render();
      });
    }
    document.getElementById("file").addEventListener("change", (e) => {
      if (e.target.files[0]) this.open(e.target.files[0]);
    });
    document.getElementById("copper").addEventListener("change", (e) => this.setView(e.target.checked));
    document.getElementById("cols").addEventListener("change", () => this.setBoardSize(Number(document.getElementById("cols").value), this.project.rows));
    document.getElementById("rows").addEventListener("change", () => this.setBoardSize(this.project.cols, Number(document.getElementById("rows").value)));
  }

  _cellAt(evt) {
    const pt = this.svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const loc = pt.matrixTransform(this.svg.getScreenCTM().inverse());
    const colIndex = Math.round((loc.x - PAD) / CELL);
    const row = Math.round((loc.y - PAD) / CELL) + 1;
    const x = this.view === "copper" ? this.project.cols - colIndex : colIndex + 1;
    return { x, y: row };
  }

  _bindBoard() {
    this.svg.addEventListener("pointerdown", (evt) => {
      const pinEl = evt.target.closest("[data-pin]");
      if (pinEl && this.mode === "connect") {
        this.handlePinClick(`${pinEl.dataset.ref}.${pinEl.dataset.pin}`);
        return;
      }
      const wireEl = evt.target.closest("[data-wire]");
      if (wireEl && this.mode === "select") {
        const i = Number(wireEl.dataset.wire);
        this.selected = null;
        this.selectedNet = null;
        this.selectedWire = { kind: "jumper", i };
        this.wireDrag = { kind: "jumper", i, before: JSON.stringify(this.project.toJSON()) };
        this.svg.setPointerCapture(evt.pointerId);
        this.render();
        return;
      }
      const cutEl = evt.target.closest("[data-cut]");
      if (cutEl && this.mode === "select") {
        const key = cutEl.dataset.cut;
        this.selected = null;
        this.selectedNet = null;
        this.selectedWire = { kind: "cut", key };
        this.wireDrag = { kind: "cut", key, before: JSON.stringify(this.project.toJSON()) };
        this.svg.setPointerCapture(evt.pointerId);
        this.render();
        return;
      }
      const compEl = evt.target.closest("[data-ref]");
      if (!compEl) {
        this.selected = null;
        this.selectedWire = null;
        this.render();
        return;
      }
      const ref = compEl.dataset.ref;
      this.selected = ref;
      this.selectedWire = null;
      const comp = this.project.components.get(ref);
      if (comp.locked) {
        // locked = fixed: select it, but do not drag it
        this.render();
        return;
      }
      this.drag = {
        ref,
        start: this._cellAt(evt),
        originX: comp.x,
        originY: comp.y,
        before: JSON.stringify(this.project.toJSON()),
      };
      this.svg.setPointerCapture(evt.pointerId);
      this.render();
    });

    this.svg.addEventListener("pointermove", (evt) => {
      if (this.wireDrag) {
        const cell = this._cellAt(evt);
        const x = Math.max(1, Math.min(this.project.cols, cell.x));
        const y = Math.max(1, Math.min(this.project.rows, cell.y));
        if (this.wireDrag.kind === "jumper") {
          const j = this.project.jumpers[this.wireDrag.i];
          if (j) {
            if (Math.abs(y - j.ya) <= Math.abs(y - j.yb)) j.ya = y;
            else j.yb = y;
            j.x = x;
            if (j.ya > j.yb) [j.ya, j.yb] = [j.yb, j.ya];
            if (j.ya === j.yb) j.yb = Math.min(this.project.rows, j.ya + 1);
            this.render();
          }
        } else {
          const nk = `${x},${y}`;
          if (nk !== this.wireDrag.key) {
            this.project.cuts.delete(this.wireDrag.key);
            this.project.fixedCuts.delete(this.wireDrag.key);
            this.project.cuts.add(nk);
            this.selectedWire = { kind: "cut", key: nk };
            this.wireDrag.key = nk;
            this.render();
          }
        }
        return;
      }
      if (!this.drag) return;
      const cell = this._cellAt(evt);
      const comp = this.project.components.get(this.drag.ref);
      const dx = cell.x - this.drag.start.x;
      const dy = cell.y - this.drag.start.y;
      comp.x = Math.max(1, Math.min(this.project.cols, this.drag.originX + dx));
      comp.y = Math.max(1, Math.min(this.project.rows, this.drag.originY + dy));
      this.render();
    });

    this.svg.addEventListener("pointerup", () => {
      if (this.wireDrag) {
        const d = this.wireDrag;
        this.wireDrag = null;
        if (d.kind === "jumper") {
          const j = this.project.jumpers[d.i];
          if (j) j.fixed = true;
        } else {
          this.project.fixedCuts.add(d.key);
        }
        this.pushHistory(d.before);
        this._afterStructuralChange(false);
        return;
      }
      if (!this.drag) return;
      const { ref, before, originX, originY } = this.drag;
      const comp = this.project.components.get(ref);
      this.drag = null;
      if (comp.x !== originX || comp.y !== originY) this.pushHistory(before);
      this._afterStructuralChange();
    });
  }

  _bindKeyboard() {
    document.addEventListener("keydown", (evt) => {
      const typing = ["INPUT", "TEXTAREA"].includes(evt.target.tagName);
      if (typing) return;
      if (evt.key === "Escape") {
        this.pending = null;
        this.selectedWire = null;
        this.selectedNet = null;
        this.render();
      } else if (evt.key.toLowerCase() === "r") {
        this.rotateSelected();
      } else if (evt.key.toLowerCase() === "l") {
        this.lockSelected();
      } else if (evt.key === "Delete" || evt.key === "Backspace") {
        this.deleteSelected();
      } else if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === "z") {
        evt.preventDefault();
        this.undo();
      }
    });
  }

  _status(msg) {
    document.title = `Stripboard Planner — ${msg}`;
    const el = document.getElementById("status");
    if (el) el.textContent = msg;
  }

  /** Run a heavy synchronous task with a visible "busy" state painted first. */
  _runBusy(msg, fn) {
    this._status(msg);
    document.body.classList.add("busy");
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        try {
          fn();
        } finally {
          document.body.classList.remove("busy");
        }
      }),
    );
  }
}

function starterProject() {
  // Match the toolbar defaults so the board size on screen equals the inputs.
  return new Project({ cols: 34, rows: 26, title: "shield" });
}
