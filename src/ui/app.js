// Application state and interactions. Renders through ui/scene.js and mutates the model
// in core/. Undo/redo is whole-project snapshots taken before each change.

import { Component, Project, jumperKey, pinLabel, pinKey, splitPin } from "../core/model.js";
import { LIBRARY, listParts, buildBarPart, registerPart, registerProjectParts } from "../core/library.js";
import { analyze, safeMountCells } from "../core/connectivity.js";
import { paretoFront } from "../core/pareto.js";
import { route } from "../core/router.js";
import { optimizeAsync, COMPACT_WEIGHTS, EASY_WEIGHTS } from "../core/optimize.js";
import { componentBody, componentPins, contentBounds, mountHoleMetrics, rotateLocal, rowLabel, rowLetter } from "../core/geometry.js";
import { toAscii } from "../core/ascii.js";
import { exportNetlist } from "../core/netlist.js";
import { alignCuts } from "../core/align.js";
import { render, CELL, PAD } from "./scene.js";
import { applyStatic, setLang, t } from "./i18n.js";
import { renderSchematic } from "./schematic.js";

const REF_PREFIX = {
  resistor: "R",
  capacitor: "C",
  led: "D",
  diode: "D",
  transistor: "Q",
  header: "J",
  terminal: "J",
  dip: "U",
  module: "U",
};
const AUTOSAVE_KEY = "stripboard-studio:autosave";
const SAVED_NAMES_KEY = "stripboard-studio:saved-names";
const THEME_KEY = "stripboard-studio:theme";
const LANG_KEY = "stripboard-studio:lang";
const RECENT_PARTS_KEY = "stripboard-studio:recent-parts";

// Fresh set of (empty) cached result tabs.
const emptyVersions = () => ({ solve: null, optimize: null, compact: null, easy: null, trim: null });

// Shift a "x,y" cell key by (dx, dy).
function shiftCell(key, dx, dy) {
  const [x, y] = key.split(",").map(Number);
  return `${x + dx},${y + dy}`;
}

// Translate everything (components, cuts, tombstones, mounting holes, jumpers) by (dx,dy) and
// resize the board. Used by Trim and the size search; never re-routes.
function cropTo(clone, dx, dy, cols, rows) {
  for (const c of clone.components.values()) {
    c.x += dx;
    c.y += dy;
  }
  clone.cuts = new Set([...clone.cuts].map((k) => shiftCell(k, dx, dy)));
  clone.fixedCuts = new Set([...clone.fixedCuts].map((k) => shiftCell(k, dx, dy)));
  clone.removedCuts = new Set([...clone.removedCuts].map((k) => shiftCell(k, dx, dy)));
  clone.mountingHoles = new Set([...clone.mountingHoles].map((k) => shiftCell(k, dx, dy)));
  clone.jumpers = clone.jumpers.map((j) => ({
    ...j,
    x: j.x + dx,
    ya: j.ya + dy,
    ...(j.x2 !== undefined ? { x2: j.x2 + dx } : {}),
    yb: j.yb + dy,
  }));
  clone.removedJumpers = new Set([...clone.removedJumpers].map((k) => {
    const parts = k.split(",").map(Number);
    if (parts.length === 4) return `${parts[0] + dx},${parts[1] + dy},${parts[2] + dx},${parts[3] + dy}`;
    return `${parts[0] + dx},${parts[1] + dy},${parts[2] + dy}`;
  }));
  clone.cols = cols;
  clone.rows = rows;
}

// Palette grouping (U2): each non-custom part falls into the first group whose `kinds` match.
const PALETTE_GROUPS = [
  { label: "Discretes", kinds: ["resistor", "capacitor", "led", "diode", "transistor"] },
  { label: "Headers & terminals", kinds: ["header", "terminal"] },
  { label: "ICs", kinds: ["dip"] },
  { label: "Modules & boards", kinds: ["module"] },
];

export class App {
  constructor() {
    this.svg = document.getElementById("board");
    this.project = starterProject();
    this.view = "front";
    this.selected = null; // primary selection (Properties / anchor)
    this.selection = new Set(); // full multi-selection of component refs
    this.marquee = null; // rubber-band rectangle while dragging empty board
    this.pending = null;
    this.jumperStart = null; // first hole of a jumper being drawn by hand
    this.activeGroup = null; // group that G adds to (cleared by Esc)
    this.mode = "select";
    this.solved = false;
    this.showNames = true;
    this.showConnections = false; // force the ratsnest on even after a board has routing
    this.showMountZones = true; // hatch cells where a mounting hole would not affect any net (on by default)
    this.allowDiagonal = false; // router option (F10): let jumpers span two columns
    this.theme = this._loadTheme(); // "auto" | "light" | "dark"
    this.lang = this._loadLang(); // "auto" | "en" | "pt"
    this.zoom = 1; // board zoom (1 = fit)
    this.pan = { x: 0, y: 0 }; // top-left of the visible viewBox, in board units
    this._panDrag = null;
    this._spaceDown = false;
    this.selectedNet = null;
    this.selectedWire = null;
    this.layers = { parts: true, wires: true, cuts: true, copper: true, nets: true, grid: true };
    this.schematic = false;
    this.active = "edit";
    this.versions = emptyVersions();
    this._editingPart = null;
    this._editBefore = new WeakMap(); // per-input: snapshot taken on focus, pushed on change
    this._statusTimer = null;
    this._paletteQuery = "";
    this._printOrigin = "A1"; // remembered print origin
    this._paletteOpen = new Set(); // palette groups the user expanded (default: minimized)
    this._recentParts = this._loadRecent();
    this.fileName = null;
    this.issues = [];
    this.history = [];
    this.redoStack = [];
    this.drag = null;
    this.wireDrag = null;
    this.spanDrag = null;
    this.boardResize = null;
    this.dirty = false;
    this._autosaveTimer = null;
    this._busy = false;

    this._bindToolbar();
    this._bindBoard();
    this._bindKeyboard();
    this._bindUnload();
    this._restoreAutosave();
    setLang(this._resolveLang());
    applyStatic();
    this._syncSizeInputs();
    this.render();
  }

  /** The set of nets currently in focus, derived from the one primary selection. */
  _focusedNets(project = this._shownProject()) {
    const set = new Set();
    if (this.selectedNet) set.add(this.selectedNet);
    else if (this.selectedWire?.kind === "jumper") {
      const j = project.jumpers[this.selectedWire.i];
      if (j?.net) set.add(j.net);
    } else if (this.selected) {
      const ref = this.selected;
      for (const net of project.nets) {
        if ([...net.pins].some((k) => splitPin(k).ref === ref)) set.add(net.id);
      }
    }
    return set;
  }

  _syncSizeInputs() {
    document.getElementById("cols").value = this.project.cols;
    document.getElementById("rows").value = this.project.rows;
  }

  /** Smallest board that still contains every component (bodies included) and cut/jumper. */
  _minBoard() {
    const b = contentBounds(this.project, LIBRARY);
    if (!b) return { cols: 4, rows: 4 };
    return { cols: Math.max(4, b.x1), rows: Math.max(4, b.y1) };
  }

  // -- rendering ----------------------------------------------------------------

  _shownProject() {
    return this.active === "edit" ? this.project : this.versions[this.active] ?? this.project;
  }

  _boardState(project) {
    return {
      project,
      library: LIBRARY,
      view: this.view,
      selected: this.selected,
      selection: this._selectedRefs(),
      theme: this._effectiveTheme(),
      marquee: this.marquee,
      selectedGroup: (this.selected && project.components.get(this.selected)?.group) || this.activeGroup || null,
      mountZones: this.showMountZones ? safeMountCells(project, LIBRARY) : null,
      pending: this.pending,
      jumperStart: this.jumperStart,
      mode: this.mode,
      solved: project.jumpers.length > 0 || project.cuts.size > 0,
      connections: this.showConnections,
      showNames: this.showNames,
      selectedNet: this.selectedNet,
      selectedWire: this.selectedWire,
      focusNets: this._focusedNets(project),
      layers: this.layers,
      issues: this.issues,
    };
  }

  /** Redraw only the board/schematic SVG (no panels) — safe while a panel input has focus. */
  _renderBoard(project = this._shownProject()) {
    const state = this._boardState(project);
    if (this.schematic) renderSchematic(this.svg, state);
    else render(this.svg, state);
    this._applyViewBox(); // preserve zoom/pan across redraws (scene sets the full viewBox)
  }

  render() {
    this._applyTheme();
    const project = this._shownProject();
    this.issues = analyze(project, LIBRARY).issues;
    this._renderBoard(project);
    this._renderPalette();
    this._renderNets();
    this._renderProblems();
    this._renderSelection();
    this._updateTabUI();
    this._scheduleAutosave();
  }

  // -- autosave / dirty tracking -------------------------------------------------

  _restoreAutosave() {
    let data;
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return;
      data = JSON.parse(raw);
    } catch {
      return; // storage unavailable or corrupt: fall back to a fresh board
    }
    if (!data?.project) return;
    try {
      this.project = Project.fromJSON(data.project);
      registerProjectParts(this.project.customParts);
    } catch {
      return;
    }
    this.fileName = data.fileName ?? null;
    // Restore the exact dirty flag that was persisted, so a board the user saved does not
    // trigger an unload prompt just because it came back from autosave.
    this.dirty = data.dirty === true;
    if (this.dirty) this._status("recovered unsaved work from this browser");
  }

  _persistAutosave() {
    try {
      localStorage.setItem(
        AUTOSAVE_KEY,
        JSON.stringify({
          version: 1,
          project: this.project.toJSON(),
          fileName: this.fileName,
          dirty: this.dirty,
          savedAt: Date.now(),
        }),
      );
    } catch {
      // storage unavailable or full: autosave is best-effort, never fatal
    }
  }

  _scheduleAutosave() {
    clearTimeout(this._autosaveTimer);
    this._autosaveTimer = setTimeout(() => this._persistAutosave(), 400);
  }

  _bindUnload() {
    window.addEventListener("beforeunload", (evt) => {
      if (!this.dirty) return;
      evt.preventDefault();
      evt.returnValue = "";
    });
  }

  _confirmDiscard() {
    if (!this.dirty) return true;
    return window.confirm("You have unsaved changes. Discard them?");
  }

  _loadRecent() {
    try {
      const a = JSON.parse(localStorage.getItem(RECENT_PARTS_KEY) || "[]");
      return Array.isArray(a) ? a : [];
    } catch {
      return [];
    }
  }

  _rememberRecent(name) {
    this._recentParts = [name, ...this._recentParts.filter((n) => n !== name)].slice(0, 6);
    try {
      localStorage.setItem(RECENT_PARTS_KEY, JSON.stringify(this._recentParts));
    } catch {
      // storage unavailable: recent list is optional
    }
  }

  _paletteItem(part, isCustom) {
    const item = document.createElement("div");
    item.className = "item pal";
    const label = document.createElement("span");
    label.className = "grow";
    label.textContent = part.label;
    label.title = "click to add";
    label.addEventListener("click", () => this.addPart(part.name));
    item.appendChild(label);
    if (isCustom) {
      const spec = this.project.customParts.find((s) => s.name === part.name);
      const edit = document.createElement("button");
      edit.className = "minibtn";
      edit.textContent = "✎";
      edit.title = "edit this pin bar";
      edit.addEventListener("click", (e) => {
        e.stopPropagation();
        this.openEditPart(spec);
      });
      const del = document.createElement("button");
      del.className = "minibtn";
      del.textContent = "✕";
      del.title = "delete this pin bar";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        this.deletePart(part.name);
      });
      item.appendChild(edit);
      item.appendChild(del);
    }
    return item;
  }

  _renderPalette() {
    const box = document.getElementById("palette-list");
    box.innerHTML = "";
    const q = this._paletteQuery.trim().toLowerCase();
    const parts = listParts();
    const customNames = new Set(this.project.customParts.map((s) => s.name));
    const byName = new Map(parts.map((p) => [p.name, p]));
    const matches = (p) =>
      !q || p.label.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || String(p.kind).includes(q);

    const groups = [];
    if (!q) {
      const recent = this._recentParts.map((n) => byName.get(n)).filter((p) => p && !customNames.has(p.name) && matches(p));
      if (recent.length) groups.push({ label: "Recent", parts: recent });
    }
    for (const g of PALETTE_GROUPS) {
      groups.push({ label: g.label, parts: parts.filter((p) => g.kinds.includes(p.kind) && !customNames.has(p.name) && matches(p)) });
    }
    const customs = parts.filter((p) => customNames.has(p.name) && matches(p));
    if (customs.length) groups.push({ label: "Custom", parts: customs });

    let shown = 0;
    for (const g of groups) {
      if (!g.parts.length) continue;
      shown += g.parts.length;
      const det = document.createElement("details");
      det.className = "palgroup";
      // Minimized by default; remembered across renders; force-open while searching.
      det.open = !!q || this._paletteOpen.has(g.label);
      det.addEventListener("toggle", () => {
        if (det.open) this._paletteOpen.add(g.label);
        else this._paletteOpen.delete(g.label);
      });
      const sum = document.createElement("summary");
      sum.textContent = `${g.label} (${g.parts.length})`;
      det.appendChild(sum);
      const inner = document.createElement("div");
      inner.className = "list";
      for (const part of g.parts) inner.appendChild(this._paletteItem(part, customNames.has(part.name)));
      det.appendChild(inner);
      box.appendChild(det);
    }
    if (!shown) box.innerHTML = `<div class="muted">${t("palette.none")}</div>`;
  }

  _renderNets() {
    const box = document.getElementById("nets");
    const project = this._shownProject();
    box.innerHTML = "";
    if (project.nets.length === 0) {
      box.innerHTML = '<div class="muted">no nets yet — use Connect</div>';
      return;
    }
    const ordered = [...project.nets].sort((a, b) =>
      (a.label || a.id).localeCompare(b.label || b.id, undefined, { numeric: true }),
    );
    const focus = this._focusedNets(project);
    const ed = this._canEdit();
    for (const net of ordered) {
      const row = document.createElement("div");
      row.className = "item" + (focus.has(net.id) ? " active" : "");

      const head = document.createElement("div");
      head.className = "nethead";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "netname";
      input.placeholder = net.id;
      input.value = net.label || "";
      input.disabled = !ed;
      input.addEventListener("focus", (e) => {
        this._editBefore.set(e.target, JSON.stringify(this.project.toJSON()));
      });
      input.addEventListener("input", () => {
        net.label = input.value.trim();
        this._renderBoard(this.project); // live board update, keep focus in this input
      });
      input.addEventListener("change", (e) => {
        const before = this._editBefore.get(e.target);
        if (before) this.pushHistory(before);
        this._editBefore.delete(e.target);
        this.render();
      });
      const del = document.createElement("button");
      del.className = "minibtn";
      del.textContent = "✕";
      del.title = "delete this net";
      del.disabled = !ed;
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
        chip.className = "chip" + (ref === this.selected || focus.has(net.id) ? " sel" : "");
        chip.title = "click to select this component";
        chip.appendChild(document.createTextNode(pinLabel(project, key)));
        chip.addEventListener("click", (e) => {
          e.stopPropagation();
          this._selectOnly(this.selected === ref ? null : ref);
          if (this.selected) {
            this.selectedWire = null;
            this.selectedNet = null;
          }
          this.render();
        });
        const x = document.createElement("button");
        x.className = "chipx";
        x.textContent = "✕";
        x.title = "remove this pin from the net";
        x.disabled = !ed;
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
        if (e.target.closest("input,button,span.chip")) return;
        if (this.selectedNet === net.id) {
          this.selectedNet = null;
        } else {
          this.selected = null;
          this.selectedWire = null;
          this.selectedNet = net.id;
        }
        this.render();
      });
      box.appendChild(row);
    }
  }

  _renderProblems() {
    const box = document.getElementById("problems");
    box.innerHTML = "";
    if (this.issues.length === 0) {
      box.innerHTML = `<div class="muted">${t("problems.none")}</div>`;
      return;
    }
    for (const issue of this.issues) {
      const item = document.createElement("div");
      item.className = "item";
      const pill = document.createElement("span");
      pill.className = `pill ${issue.level === "error" ? "error" : "warn"}`;
      pill.textContent = t(`level.${issue.level}`);
      item.appendChild(pill);
      item.appendChild(document.createTextNode(" " + issue.message));
      item.title = "click to highlight";
      item.addEventListener("click", () => {
        const netId = issue.netId ?? issue.netIds?.[0] ?? null;
        const ref = issue.ref ?? issue.refs?.[0] ?? null;
        if (netId) {
          this.selectedNet = this.selectedNet === netId ? null : netId;
          this._selectOnly(null);
          this.selectedWire = null;
        } else if (ref) {
          this._selectOnly(this.selected === ref ? null : ref);
          this.selectedNet = null;
          this.selectedWire = null;
        }
        this.render();
      });
      box.appendChild(item);
    }
  }

  _renderSelection() {
    const box = document.getElementById("selection");
    const project = this._shownProject();
    const ed = this._canEdit();
    box.innerHTML = "";
    if (this.selection.size > 1) {
      this._multiBox(box, ed);
      return;
    }
    const comp = this.selected ? project.components.get(this.selected) : null;
    if (!comp) {
      if (this.pending) {
        box.textContent = `connect: ${this.pending} — click another pin`;
        return;
      }
      if (this.selectedWire?.kind === "jumper") {
        const j = project.jumpers[this.selectedWire.i];
        if (j) {
          const net = project.nets.find((n) => n.id === j.net);
          const ex = j.x2 ?? j.x;
          const a = `${j.x}${rowLabel(j.ya, project.rows)}`;
          const b = `${ex}${rowLabel(j.yb, project.rows)}`;
          const len = Math.hypot(ex - j.x, j.yb - j.ya).toFixed(2);
          this._wireBox(box, `${t(j.x2 !== undefined ? "prop.jumperDiag" : "prop.jumper")} · ${a}-${b}`, [
            `net: ${net ? net.label || net.id : t("prop.none")}`,
            `length: ${len} holes`,
            `state: ${t(j.fixed ? "prop.fixed" : "prop.auto")}`,
          ], !!j.fixed, ed);
          return;
        }
      }
      if (this.selectedWire?.kind === "cut") {
        const [x, y] = this.selectedWire.key.split(",").map(Number);
        const fixed = project.fixedCuts?.has(this.selectedWire.key);
        this._wireBox(box, `${t("prop.cut")} · ${rowLabel(y, project.rows)}${x}`, [
          "breaks the strip on this row",
          `state: ${t(fixed ? "prop.fixed" : "prop.auto")}`,
        ], !!fixed, ed);
        return;
      }
      if (this.selectedWire?.kind === "mount") {
        const [x, y] = this.selectedWire.key.split(",").map(Number);
        this._wireBox(box, `${t("prop.mount")} · ${rowLabel(y, project.rows)}${x}`, [
          `drill Ø${project.mountDiameter} mm (through-hole)`,
          "the strip is cut here (no copper)",
        ], false, ed, false);
        return;
      }
      if (this.selectedNet) {
        const net = project.nets.find((n) => n.id === this.selectedNet);
        if (!net) {
          box.textContent = t("prop.none");
          return;
        }
        this._netBox(box, net, project, ed);
        return;
      }
      box.textContent = t("prop.none");
      return;
    }
    const part = LIBRARY.get(comp.part);
    const head = document.createElement("div");
    head.className = "pinrow";
    const refTag = document.createElement("span");
    refTag.className = "pintag";
    refTag.textContent = t("prop.ref");
    const refInput = document.createElement("input");
    refInput.type = "text";
    refInput.value = comp.ref;
    refInput.placeholder = "name";
    refInput.disabled = !ed;
    refInput.addEventListener("focus", (e) => {
      this._editBefore.set(e.target, JSON.stringify(this.project.toJSON()));
    });
    refInput.addEventListener("change", () => this._renameSelected(refInput));
    head.appendChild(refTag);
    head.appendChild(refInput);
    box.appendChild(head);

    const meta = document.createElement("div");
    meta.className = "muted";
    const lock = comp.locked ? "locked" : "free";
    meta.textContent = `${part?.label ?? comp.part} — rot ${comp.rot}° — ${lock}`;
    box.appendChild(meta);

    // Contextual actions for the selected component (the toolbar is kept lean; hotkeys remain).
    const actions = document.createElement("div");
    actions.className = "pinrow";
    const action = (label, title, fn) => {
      const b = document.createElement("button");
      b.className = "minibtn";
      b.textContent = label;
      b.title = title;
      b.disabled = !ed;
      b.addEventListener("click", fn);
      return b;
    };
    actions.appendChild(action(t("prop.rotate"), "R", () => this.rotateSelected()));
    actions.appendChild(action(t(comp.locked ? "prop.unlock" : "prop.lock"), "L", () => this.lockSelected()));
    actions.appendChild(action(t("prop.duplicate"), "Ctrl+D", () => this.duplicateSelected()));
    actions.appendChild(action(t("prop.delete"), "Delete", () => this.deleteSelected()));
    box.appendChild(actions);

    const valueRow = document.createElement("div");
    valueRow.className = "pinrow";
    const valueTag = document.createElement("span");
    valueTag.className = "pintag";
    valueTag.textContent = t("prop.value");
    const valueInput = document.createElement("input");
    valueInput.type = "text";
    valueInput.value = comp.value || "";
    valueInput.placeholder = part?.defaultValue || "(none)";
    valueInput.disabled = !ed;
    valueInput.addEventListener("focus", (e) => {
      this._editBefore.set(e.target, JSON.stringify(this.project.toJSON()));
    });
    valueInput.addEventListener("change", (e) => {
      const before = this._editBefore.get(e.target);
      if (before) this.pushHistory(before);
      this._editBefore.delete(e.target);
      comp.value = valueInput.value.trim();
      this.render();
    });
    valueRow.appendChild(valueTag);
    valueRow.appendChild(valueInput);
    box.appendChild(valueRow);

    // group: parts sharing a name stay rigidly together (semi-locked); the group can still
    // be moved as a whole. Empty = ungrouped.
    const groupRow = document.createElement("div");
    groupRow.className = "pinrow";
    const groupTag = document.createElement("span");
    groupTag.className = "pintag";
    groupTag.textContent = t("prop.tagGroup");
    const groupInput = document.createElement("input");
    groupInput.type = "text";
    groupInput.value = comp.group || "";
    groupInput.placeholder = "(ungrouped)";
    groupInput.title = "parts with the same group name stay rigidly together";
    groupInput.disabled = !ed;
    groupInput.addEventListener("focus", (e) => {
      this._editBefore.set(e.target, JSON.stringify(this.project.toJSON()));
    });
    groupInput.addEventListener("change", (e) => {
      const before = this._editBefore.get(e.target);
      if (before) this.pushHistory(before);
      this._editBefore.delete(e.target);
      comp.group = groupInput.value.trim();
      this._afterStructuralChange(false); // grouping does not invalidate the routing
    });
    groupRow.appendChild(groupTag);
    groupRow.appendChild(groupInput);
    box.appendChild(groupRow);

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
      input.disabled = !ed;
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
      input.disabled = !ed;
      input.addEventListener("focus", (e) => {
        this._editBefore.set(e.target, JSON.stringify(this.project.toJSON()));
      });
      input.addEventListener("input", () => {
        const value = input.value.trim();
        if (value) comp.pinNames[pin.id] = value;
        else delete comp.pinNames[pin.id];
        this._renderBoard(this.project); // update board labels, keep focus here
      });
      input.addEventListener("change", (e) => {
        const before = this._editBefore.get(e.target);
        if (before) this.pushHistory(before);
        this._editBefore.delete(e.target);
        this.render();
      });
      row.appendChild(tag);
      row.appendChild(input);

      const net = project.netOf(pinKey(comp.ref, pin.id));
      if (net) {
        const badge = document.createElement("span");
        badge.className = "netbadge";
        badge.textContent = net.label || net.id;
        const off = document.createElement("button");
        off.className = "minibtn";
        off.textContent = "✕";
        off.title = "disconnect this pin";
        off.disabled = !ed;
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
    if (this.history.length > 100) this.history.shift(); // cap undo memory on long sessions
    this.redoStack.length = 0;
    this.dirty = true;
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
    this.dirty = true;
    this.versions = emptyVersions();
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
    if (!this._guard()) return;
    const part = LIBRARY.get(name);
    const prefix = REF_PREFIX[part.kind] ?? "J";
    const ref = this.project.uniqueRef(prefix);
    const spot = this.findFreeSpot();
    this.snapshot();
    this.project.addComponent(new Component({ ref, part: name, x: spot.x, y: spot.y, rot: 0, locked: false, value: part.defaultValue }));
    this._selectOnly(ref);
    this._rememberRecent(name);
    this._afterStructuralChange();
  }

  _renameSelected(input) {
    if (!this._guard()) return;
    const comp = this.selected && this.project.components.get(this.selected);
    if (!comp) return;
    const next = input.value.trim();
    if (!next || next === comp.ref) {
      input.value = comp.ref;
      return;
    }
    if (next.includes(".") || this.project.components.has(next)) {
      this._status(next.includes(".") ? "name cannot contain '.'" : `name ${next} is already used`);
      input.value = comp.ref;
      return;
    }
    const before = this._editBefore.get(input);
    if (before) this.pushHistory(before);
    this._editBefore.delete(input);
    const old = comp.ref;
    this.project.renameComponent(old, next);
    this.selection = new Set([next]);
    this.selected = next;
    this.render();
    this._status(`renamed ${old} to ${next}`);
  }

  /** Properties view when several parts are selected: bulk actions. */
  _multiBox(box, ed) {
    box.innerHTML = "";
    const refs = this._selectedRefs();
    const head = document.createElement("div");
    head.textContent = t("prop.multi", { n: refs.length });
    box.appendChild(head);
    const names = document.createElement("div");
    names.className = "muted";
    names.textContent = refs.slice(0, 12).join(", ") + (refs.length > 12 ? " …" : "");
    box.appendChild(names);
    const row = document.createElement("div");
    row.className = "pinrow";
    const action = (label, title, fn) => {
      const b = document.createElement("button");
      b.className = "minibtn";
      b.textContent = label;
      b.title = title;
      b.disabled = !ed;
      b.addEventListener("click", fn);
      return b;
    };
    row.appendChild(action(t("prop.rotate"), "R", () => this.rotateSelected()));
    row.appendChild(action(t("prop.lock"), "L", () => this.lockSelected()));
    row.appendChild(action(t("prop.group"), "G", () => this._addToGroup()));
    row.appendChild(action(t("prop.duplicate"), "Ctrl+D", () => this.duplicateSelected()));
    row.appendChild(action(t("prop.delete"), "Delete", () => this.deleteSelected()));
    box.appendChild(row);
  }

  /** Properties view for a net: rename, edit its pins, delete. Mirrors the Nets tab. */
  _netBox(box, net, project, ed) {
    box.innerHTML = "";
    const head = document.createElement("div");
    head.className = "nethead";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "netname";
    input.placeholder = net.id;
    input.value = net.label || "";
    input.disabled = !ed;
    input.addEventListener("focus", (e) => {
      this._editBefore.set(e.target, JSON.stringify(this.project.toJSON()));
    });
    input.addEventListener("input", () => {
      net.label = input.value.trim();
      this._renderBoard(this.project); // live board update, keep focus here
    });
    input.addEventListener("change", (e) => {
      const before = this._editBefore.get(e.target);
      if (before) this.pushHistory(before);
      this._editBefore.delete(e.target);
      this.render();
    });
    head.appendChild(input);
    box.appendChild(head);

    const pins = document.createElement("div");
    pins.className = "netpins";
    if (net.pins.size === 0) pins.innerHTML = '<span class="muted">(no pins)</span>';
    for (const key of [...net.pins].sort()) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.appendChild(document.createTextNode(pinLabel(project, key)));
      const sc = document.createElement("button");
      sc.className = "chipx";
      sc.textContent = "✂";
      sc.title = "split this pin into a new net";
      sc.disabled = !ed;
      sc.addEventListener("click", (e) => {
        e.stopPropagation();
        this.snapshot();
        const created = this.project.splitNet(net.id, [key]);
        if (created) this._status(`split ${pinLabel(project, key)} into ${created.id}`);
        this._afterStructuralChange(true);
      });
      chip.appendChild(sc);
      const x = document.createElement("button");
      x.className = "chipx";
      x.textContent = "✕";
      x.title = "remove this pin from the net";
      x.disabled = !ed;
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
    box.appendChild(pins);

    // Split the selected component(s)' pins out of this net into a new one.
    if (this.selection.size) {
      const compRefs = this._selectedRefs();
      const mine = [...net.pins].filter((k) => compRefs.includes(splitPin(k).ref));
      if (mine.length) {
        const srow = document.createElement("div");
        srow.className = "pinrow";
        const sbtn = document.createElement("button");
        sbtn.className = "minibtn";
        sbtn.textContent = t("prop.splitSelection", { n: mine.length });
        sbtn.title = "move the selected parts' pins here into a new net";
        sbtn.disabled = !ed;
        sbtn.addEventListener("click", () => {
          this.snapshot();
          const created = this.project.splitNet(net.id, mine);
          if (created) this._status(`split ${mine.length} pin(s) into ${created.id}`);
          this._afterStructuralChange(true);
        });
        srow.appendChild(sbtn);
        box.appendChild(srow);
      }
    }

    // Merge this net into another (join their pins).
    const others = this.project.nets.filter((n) => n !== net);
    if (others.length) {
      const mrow = document.createElement("div");
      mrow.className = "pinrow";
      const sel = document.createElement("select");
      sel.disabled = !ed;
      for (const o of others) {
        const opt = document.createElement("option");
        opt.value = o.id;
        opt.textContent = o.label || o.id;
        sel.appendChild(opt);
      }
      const mbtn = document.createElement("button");
      mbtn.className = "minibtn";
      mbtn.textContent = t("prop.mergeInto");
      mbtn.title = "join this net with the chosen one";
      mbtn.disabled = !ed;
      mbtn.addEventListener("click", () => {
        const target = this.project.nets.find((n) => n.id === sel.value);
        if (!target) return;
        this.snapshot();
        const merged = this.project.connect([...net.pins, ...target.pins], target.id);
        this.selectedNet = merged.id;
        this.selectedWire = null;
        this._afterStructuralChange(true);
        this._status(`merged into "${target.label || target.id}"`);
      });
      mrow.appendChild(sel);
      mrow.appendChild(mbtn);
      box.appendChild(mrow);
    }

    const row = document.createElement("div");
    row.className = "pinrow";
    const del = document.createElement("button");
    del.className = "minibtn";
    del.textContent = t("prop.deleteNet");
    del.disabled = !ed;
    del.addEventListener("click", () => {
      this.snapshot();
      this.project.nets = this.project.nets.filter((n) => n !== net);
      if (this.selectedNet === net.id) this.selectedNet = null;
      this._afterStructuralChange(false);
    });
    row.appendChild(del);
    box.appendChild(row);
  }

  _wireBox(box, title, lines, fixed, ed = true, fixable = true) {
    box.innerHTML = "";
    const head = document.createElement("div");
    head.textContent = title;
    box.appendChild(head);
    for (const line of lines) {
      const d = document.createElement("div");
      d.className = "muted";
      d.textContent = line;
      box.appendChild(d);
    }
    const row = document.createElement("div");
    row.className = "pinrow";
    if (fixable) {
      const fix = document.createElement("button");
      fix.className = "minibtn";
      fix.textContent = fixed ? "Unfix" : "Fix";
      fix.title = fixed ? "release so Solve may change it" : "pin it so Solve keeps it";
      fix.disabled = !ed;
      fix.addEventListener("click", () => this.toggleFixSelected());
      row.appendChild(fix);
    }
    const del = document.createElement("button");
    del.className = "minibtn";
    del.textContent = t("prop.delete");
    del.disabled = !ed;
    del.addEventListener("click", () => this.deleteSelected());
    row.appendChild(del);
    box.appendChild(row);
  }

  openNewPart() {
    this._editingPart = null;
    document.getElementById("partTitle").textContent = t("part.newTitle");
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

  openEditPart(spec) {
    this._editingPart = spec;
    document.getElementById("partTitle").textContent = t("part.editTitle");
    document.getElementById("pLabel").value = spec.label || "";
    document.getElementById("pDouble").value = spec.doubleRow ? "yes" : "no";
    document.getElementById("pCount").value = spec.count || 1;
    document.getElementById("pGap").value = spec.gap || 3;
    document.getElementById("pPrefix").value = spec.prefix || "";
    document.getElementById("pLeft").value = spec.leftPrefix || "L";
    document.getElementById("pRight").value = spec.rightPrefix || "R";
    this.updatePartForm();
    document.getElementById("partDlg").showModal();
  }

  deletePart(name) {
    if (!this._guard()) return;
    if ([...this.project.components.values()].some((c) => c.part === name)) {
      this._status(`cannot delete ${name}: a component still uses it`);
      return;
    }
    this.snapshot();
    this.project.customParts = this.project.customParts.filter((s) => s.name !== name);
    LIBRARY.delete(name);
    this.render();
    this._status(`deleted ${name}`);
  }

  updatePartForm() {
    const doubleRow = document.getElementById("pDouble").value === "yes";
    for (const id of ["rowGap", "rowLeft", "rowRight"]) {
      document.getElementById(id).style.display = doubleRow ? "flex" : "none";
    }
    document.getElementById("rowPrefix").style.display = doubleRow ? "none" : "flex";
  }

  createPart() {
    if (!this._guard()) return;
    const label = document.getElementById("pLabel").value.trim() || "Bar";
    const doubleRow = document.getElementById("pDouble").value === "yes";
    const count = Math.max(1, Number(document.getElementById("pCount").value) || 1);
    const gap = Number(document.getElementById("pGap").value) || 3;
    const prefix = document.getElementById("pPrefix").value.trim();
    const leftPrefix = document.getElementById("pLeft").value.trim() || "L";
    const rightPrefix = document.getElementById("pRight").value.trim() || "R";
    if (this._editingPart) {
      this.snapshot();
      Object.assign(this._editingPart, { label, count, gap, doubleRow, prefix, leftPrefix, rightPrefix });
      LIBRARY.set(this._editingPart.name, buildBarPart(this._editingPart));
      this._editingPart = null;
      document.getElementById("partDlg").close();
      this.render();
      this._status(`updated ${label}`);
      return;
    }
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

  rotateSelected(dir = 1) {
    if (!this._guard()) return;
    const comps = this._selectedComps();
    if (!comps.length) return;
    this.snapshot();
    for (const comp of comps) {
      const part = LIBRARY.get(comp.part);
      if (part && part.rotatable === false) continue;
      comp.rot = (comp.rot + 90 * dir + 360) % 360;
    }
    this._afterStructuralChange();
  }

  lockSelected() {
    if (!this._guard()) return;
    if (this.selectedWire) {
      this.toggleFixSelected(); // L fixes/unfixes a jumper or a cut too
      return;
    }
    const comps = this._selectedComps();
    if (!comps.length) return;
    const allLocked = comps.every((c) => c.locked);
    this.snapshot();
    for (const c of comps) c.locked = !allLocked; // lock all, or unlock all
    this.render();
  }

  /** A copy of `comp` placed at the nearest free spot (so it does not overlap at once). */
  _duplicateSpot(comp, part) {
    const { cols, rows } = this.project;
    const occupied = new Set();
    for (const other of this.project.components.values()) {
      const op = LIBRARY.get(other.part);
      if (!op) continue;
      for (const p of componentPins(other, op)) occupied.add(`${p.x},${p.y}`);
      const b = componentBody(other, op);
      if (b) for (let yy = b.y0; yy <= b.y1; yy++) for (let xx = b.x0; xx <= b.x1; xx++) occupied.add(`${xx},${yy}`);
    }
    const probe = { ...comp, x: 0, y: 0 };
    const fits = (x, y) => {
      probe.x = x;
      probe.y = y;
      for (const p of componentPins(probe, part)) {
        if (p.x < 1 || p.x > cols || p.y < 1 || p.y > rows) return false;
        if (occupied.has(`${p.x},${p.y}`)) return false;
      }
      return true;
    };
    for (const [dx, dy] of [[1, 0], [2, 0], [0, 2], [1, 2], [-1, 0], [0, -2], [2, 2]]) {
      const x = comp.x + dx;
      const y = comp.y + dy;
      if (x >= 1 && x <= cols && y >= 1 && y <= rows && fits(x, y)) return { x, y };
    }
    return this.findFreeSpot();
  }

  /** `Ctrl+D`: copy the selected part(s) — same value/pins/span/rot and group. */
  duplicateSelected() {
    if (!this._guard()) return;
    const comps = this._selectedComps();
    if (!comps.length) {
      this._status("select a part to duplicate");
      return;
    }
    this.snapshot();
    const newRefs = [];
    for (const comp of comps) {
      const part = LIBRARY.get(comp.part);
      const prefix = comp.ref.match(/^[A-Za-z]+/)?.[0] || REF_PREFIX[part?.kind] || "J";
      const ref = this.project.uniqueRef(prefix);
      const spot = part ? this._duplicateSpot(comp, part) : this.findFreeSpot();
      this.project.addComponent(new Component({
        ref,
        part: comp.part,
        x: spot.x,
        y: spot.y,
        rot: comp.rot,
        locked: false,
        value: comp.value,
        pinNames: comp.pinNames,
        span: comp.span,
        group: comp.group,
      }));
      newRefs.push(ref);
    }
    this.selection = new Set(newRefs);
    this.selected = newRefs[0] ?? null;
    this._afterStructuralChange();
    this._status(`duplicated ${comps.length} part(s)`);
  }

  deleteSelected() {
    if (!this._guard()) return;
    if (this.selectedWire) {
      const w = this.selectedWire;
      this.snapshot();
      if (w.kind === "jumper") {
        const j = this.project.jumpers[w.i];
        if (j) {
          // remember the removal so a later Solve does not just put it back
          this.project.removedJumpers.add(jumperKey(j));
          this.project.jumpers.splice(w.i, 1);
        }
      } else if (w.kind === "mount") {
        this.project.mountingHoles.delete(w.key); // mounting holes are always user-made
      } else {
        this.project.cuts.delete(w.key);
        this.project.fixedCuts.delete(w.key);
        this.project.removedCuts.add(w.key); // "delete stays deleted" for Solve
      }
      this.selectedWire = null;
      this._afterStructuralChange(false);
      return;
    }
    const refs = this._selectedRefs();
    if (refs.length === 0) {
      if (this.selectedNet) {
        this.snapshot();
        this.project.nets = this.project.nets.filter((n) => n.id !== this.selectedNet);
        this.selectedNet = null;
        this._afterStructuralChange(false);
      }
      return;
    }
    this.snapshot();
    for (const ref of refs) this.project.removeComponent(ref);
    this.selection.clear();
    this.selected = null;
    this._afterStructuralChange();
  }

  toggleFixSelected() {
    if (!this._guard()) return;
    const w = this.selectedWire;
    if (!w) return;
    this.snapshot();
    let fixed;
    if (w.kind === "jumper") {
      const j = this.project.jumpers[w.i];
      if (!j) return;
      j.fixed = !j.fixed;
      fixed = j.fixed;
    } else if (this.project.fixedCuts.has(w.key)) {
      this.project.fixedCuts.delete(w.key);
      fixed = false;
    } else {
      this.project.fixedCuts.add(w.key);
      fixed = true;
    }
    this._afterStructuralChange(false);
    this._status(fixed ? "fixed (Solve keeps it)" : "released (Solve may change it)");
  }

  setMode(mode) {
    if (!this._guard()) return;
    this.mode = mode;
    if (mode !== "connect") this.pending = null;
    if (mode !== "jumper") this.jumperStart = null;
    this._syncModeButtons();
    this.render();
    if (mode === "connect") this._status("connect: click a first pin, then a second pin (Esc cancels)");
    else if (mode === "cut") this._status("cut tool: click a hole to cut that strip; click it again to remove the cut");
    else if (mode === "jumper") this._status("jumper tool: click a hole, then another in the same column (Esc cancels)");
    else if (mode === "mount") this._status("mount tool: click a hole to place a chassis screw hole; click it again to remove it");
  }

  _syncModeButtons() {
    const buttons = { connect: "connect", cut: "addCut", jumper: "addJumper", mount: "addMount" };
    for (const [m, id] of Object.entries(buttons)) {
      const el = document.getElementById(id);
      if (el) el.classList.toggle("active", this.mode === m);
    }
  }

  /** True when the mode is one of the manual "board" tools (cut / jumper / mount). */
  _isToolMode() {
    return this.mode === "cut" || this.mode === "jumper" || this.mode === "mount";
  }

  /** Human cell name (row letter + column), matching the Problems panel. */
  _cellName(x, y) {
    return `${rowLabel(y, this.project.rows)}${x}`;
  }

  /** Pin key occupying a hole, or null. Used to keep cuts/jumpers off pins. */
  _pinAt(x, y) {
    for (const comp of this.project.components.values()) {
      const part = LIBRARY.get(comp.part);
      if (!part) continue;
      for (const p of componentPins(comp, part)) {
        if (p.x === x && p.y === y) return `${comp.ref}.${p.id}`;
      }
    }
    return null;
  }

  /** Every component sharing a group name (empty name -> just that component). */
  _groupMembers(name) {
    return [...this.project.components.values()].filter((c) => c.group === name);
  }

  /** First unused auto group name (G1, G2, ...). */
  _newGroupName() {
    const used = new Set([...this.project.components.values()].map((c) => c.group).filter(Boolean));
    let n = 1;
    while (used.has(`G${n}`)) n += 1;
    return `G${n}`;
  }

  /**
   * `G`: with a part selected, either make its group the active one (so the next parts join
   * it) or add it to the active group — creating one if none is active.
   */
  _addToGroup() {
    if (!this._guard()) return;
    const comps = this._selectedComps();
    if (!comps.length) {
      this._status("select part(s) first, then press G");
      return;
    }
    // A single already-grouped part just becomes the active group (for subsequent additions).
    if (comps.length === 1 && comps[0].group) {
      this.activeGroup = comps[0].group;
      this._status(`active group: "${comps[0].group}" — select parts and press G to add them`);
      return;
    }
    if (!this.activeGroup) this.activeGroup = this._newGroupName();
    this.snapshot();
    for (const comp of comps) comp.group = this.activeGroup;
    this._afterStructuralChange(false);
    this._status(`added ${comps.length} part(s) to group "${this.activeGroup}"`);
  }

  /** `Shift+G`: remove the selected part(s) from their group. */
  _removeFromGroup() {
    if (!this._guard()) return;
    const comps = this._selectedComps().filter((c) => c.group);
    if (!comps.length) {
      this._status("no selected part is in a group");
      return;
    }
    this.snapshot();
    const names = new Set();
    for (const comp of comps) {
      names.add(comp.group);
      comp.group = "";
    }
    for (const name of names) {
      if (this._groupMembers(name).length === 0 && this.activeGroup === name) this.activeGroup = null;
    }
    this._afterStructuralChange(false);
    this._status(`removed ${comps.length} part(s) from their group`);
  }

  /** Cell under the pointer, or null when the click lands off the board. */
  _cutCellAt(evt) {
    const { x, y } = this._cellAt(evt);
    if (x < 1 || x > this.project.cols || y < 1 || y > this.project.rows) return null;
    return { x, y };
  }

  _handleToolClick(evt) {
    const cell = this._cutCellAt(evt);
    if (!cell) return;
    if (this.mode === "cut") this._addCut(cell.x, cell.y);
    else if (this.mode === "mount") this._toggleMount(cell.x, cell.y);
    else this._addJumperClick(cell.x, cell.y);
  }

  _addCut(x, y) {
    const key = `${x},${y}`;
    const name = this._cellName(x, y);
    if (this.project.cuts.has(key)) {
      // toggle: clicking an existing cut removes it (and remembers that choice)
      this.snapshot();
      this.project.cuts.delete(key);
      this.project.fixedCuts.delete(key);
      this.project.removedCuts.add(key);
      this._afterStructuralChange(false);
      this._status(`cut removed at ${name}`);
      return;
    }
    const pin = this._pinAt(x, y);
    if (pin) {
      this._status(`cannot cut ${name}: ${pin} sits there`);
      return;
    }
    this.snapshot();
    this.project.cuts.add(key);
    this.project.fixedCuts.add(key); // a hand-placed cut is fixed: Solve keeps it
    this.project.removedCuts.delete(key);
    this._afterStructuralChange(false);
    this._status(`cut added at ${name} (fixed)`);
  }

  _toggleMount(x, y) {
    const key = `${x},${y}`;
    const name = this._cellName(x, y);
    if (this.project.mountingHoles.has(key)) {
      this.snapshot();
      this.project.mountingHoles.delete(key);
      // A hole breaks (or restores) copper, so any existing routing is now stale.
      this._afterStructuralChange(true);
      this._status(`mounting hole removed at ${name} — re-run Solve`);
      return;
    }
    const bad = this._mountBlocker(x, y);
    if (bad) {
      this._status(`cannot place mounting hole: ${bad}`);
      return;
    }
    this.snapshot();
    this.project.mountingHoles.add(key);
    this._afterStructuralChange(true);
    this._status(`mounting hole added at ${name} — re-run Solve`);
  }

  _mountBlocker(x, y) {
    const pin = this._pinAt(x, y);
    if (pin) return `${this._cellName(x, y)} has the pin ${pin}`;
    for (const j of this.project.jumpers) {
      if (j.x === x && y >= Math.min(j.ya, j.yb) && y <= Math.max(j.ya, j.yb)) {
        return `a jumper runs over ${this._cellName(x, y)}`;
      }
    }
    for (const comp of this.project.components.values()) {
      const part = LIBRARY.get(comp.part);
      if (!part || part.wiresUnder) continue;
      const b = componentBody(comp, part);
      if (b && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return `${comp.ref} covers ${this._cellName(x, y)}`;
    }
    return null;
  }

  _addJumperClick(x, y) {
    const name = this._cellName(x, y);
    if (!this.jumperStart) {
      if (this._pinAt(x, y)) {
        this._status(`a jumper cannot end on ${name}: a pin is there`);
        return;
      }
      this.jumperStart = { x, y };
      this.render();
      this._status(`jumper: click the other hole in column ${x} (Esc cancels)`);
      return;
    }
    const { x: x0, y: y0 } = this.jumperStart;
    if (x !== x0) {
      this._status("a jumper is a vertical wire — pick a hole in the same column");
      return;
    }
    const lo = Math.min(y0, y);
    const hi = Math.max(y0, y);
    if (lo === hi) {
      this.jumperStart = null;
      this.render();
      return;
    }
    const bad = this._jumperBlocker(x, lo, hi);
    if (bad) {
      this._status(`cannot add jumper: ${bad}`);
      return;
    }
    this.snapshot();
    this.project.jumpers.push({ x, ya: lo, yb: hi, fixed: true });
    this.project.removedJumpers.delete(`${x},${lo},${hi}`);
    // one jumper per activation: drop back to Select so the next click won't start another
    this.mode = "select";
    this.jumperStart = null;
    this._syncModeButtons();
    this._afterStructuralChange(false);
    this._status(`jumper added ${this._cellName(x, lo)}-${this._cellName(x, hi)} (fixed) — back to Select`);
  }

  /** Mirror the router/DRC keepouts so a hand-drawn jumper is physically sane. */
  _jumperBlocker(x, lo, hi) {
    const jumperEnds = new Set();
    for (const j of this.project.jumpers) {
      jumperEnds.add(`${j.x},${j.ya}`);
      jumperEnds.add(`${j.x2 ?? j.x},${j.yb}`);
    }
    for (let y = lo; y <= hi; y++) {
      const cell = `${x},${y}`;
      const pin = this._pinAt(x, y);
      if (pin) return `${this._cellName(x, y)} has the pin ${pin}`;
      if (y !== lo && y !== hi && jumperEnds.has(cell)) return `another jumper already ends at ${this._cellName(x, y)}`;
    }
    if (jumperEnds.has(`${x},${lo}`) || jumperEnds.has(`${x},${hi}`)) return "a jumper already ends in that hole";
    if (this.project.mountingHoles.has(`${x},${lo}`) || this.project.mountingHoles.has(`${x},${hi}`)) return "a mounting hole is in that hole";
    // No solder room under a flush body.
    for (const comp of this.project.components.values()) {
      const part = LIBRARY.get(comp.part);
      if (!part || part.wiresUnder) continue;
      const b = componentBody(comp, part);
      if (!b) continue;
      for (let y = lo; y <= hi; y++) {
        if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return `${comp.ref} covers ${this._cellName(x, y)}`;
      }
    }
    return null;
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

  // -- versions (result tabs) -----------------------------------------------------

  _canEdit() {
    return this.active === "edit";
  }

  _guard() {
    if (this._canEdit()) return true;
    this._status("read-only result tab — click 'Use this' (top right) to edit");
    return false;
  }

  solve() {
    this.switchTab("solve");
  }

  optimize() {
    this.switchTab("optimize");
  }

  compact() {
    this.switchTab("compact");
  }

  easy() {
    this.switchTab("easy");
  }

  trim() {
    this.switchTab("trim");
  }

  // -- board-size search (F4b) --------------------------------------------------

  async openSizeSearch() {
    if (!this._guard()) return;
    if (this._busy) {
      this._status("busy — wait for the current computation");
      return;
    }
    const body = document.getElementById("sizeBody");
    body.textContent = t("size.computing");
    document.getElementById("sizeDlg").showModal();
    this._busy = true;
    document.body.classList.add("busy");
    const t0 = Date.now();
    try {
      const list = await this._computeSizes((i, n, d) => {
        body.textContent = t("size.progress", { i, n, w: d.w, h: d.h, s: ((Date.now() - t0) / 1000).toFixed(0) });
      });
      this._renderSizeResults(list);
    } catch (err) {
      body.textContent = `failed: ${err.message}`;
    } finally {
      this._busy = false;
      document.body.classList.remove("busy");
    }
  }

  async _computeSizes(onProgress) {
    // 1. Compact once to learn the smallest content size.
    const compacted = this.project.clone();
    await optimizeAsync(compacted, LIBRARY, { weights: COMPACT_WEIGHTS, maxPasses: 6, maxEvaluations: 300, diagonal: this.allowDiagonal });
    const bb = contentBounds(compacted, LIBRARY) ?? { x0: 1, y0: 1, x1: this.project.cols, y1: this.project.rows };
    const minW = Math.max(4, bb.x1 - bb.x0 + 1);
    const minH = Math.max(4, bb.y1 - bb.y0 + 1);
    const curW = this.project.cols;
    const curH = this.project.rows;
    const dims = [];
    const push = (w, h) => {
      const W = Math.max(4, Math.min(curW, Math.round(w)));
      const H = Math.max(4, Math.min(curH, Math.round(h)));
      if (!dims.some((d) => d.w === W && d.h === H)) dims.push({ w: W, h: H });
    };
    push(minW, minH); // smallest content
    push(minW, curH); // narrow, full height
    push(curW, minH); // full width, short
    push((minW + curW) / 2, (minH + curH) / 2); // middle
    push(curW, curH); // current size

    // 2. Optimize + route each candidate, then keep the non-dominated ones.
    const results = [];
    for (let i = 0; i < dims.length; i++) {
      const d = dims[i];
      if (onProgress) onProgress(i + 1, dims.length, d);
      const clone = compacted.clone();
      const b = contentBounds(clone, LIBRARY);
      if (b) cropTo(clone, 1 - b.x0, 1 - b.y0, d.w, d.h);
      else {
        clone.cols = d.w;
        clone.rows = d.h;
      }
      await optimizeAsync(clone, LIBRARY, { maxPasses: 4, maxEvaluations: 120, diagonal: this.allowDiagonal }); // balanced: uses the space
      const r = route(clone, LIBRARY, { diagonal: this.allowDiagonal });
      clone.cuts = alignCuts(clone, LIBRARY, r.cuts, r.jumpers);
      clone.jumpers = r.jumpers.map((j) => ({ x: j.x, ya: j.ya, yb: j.yb, net: j.net, fixed: !!j.fixed }));
      const a = analyze(clone, LIBRARY);
      const errors = a.issues.filter((x) => x.level === "error").length;
      results.push({ w: d.w, h: d.h, area: d.w * d.h, jumpers: clone.jumpers.length, cuts: clone.cuts.size, errors, board: clone });
    }
    const feasible = results.filter((r) => r.errors === 0);
    const front = paretoFront(feasible.length ? feasible : results, ["area", "jumpers", "cuts"]);
    front.sort((a, b) => a.area - b.area || a.jumpers - b.jumpers);
    return front;
  }

  _renderSizeResults(list) {
    const body = document.getElementById("sizeBody");
    body.innerHTML = "";
    if (!list.length) {
      body.textContent = t("size.none");
      return;
    }
    const intro = document.createElement("div");
    intro.className = "muted";
    intro.textContent = t("size.intro");
    body.appendChild(intro);
    for (const r of list) {
      const row = document.createElement("div");
      row.className = "pinrow";
      const label = document.createElement("span");
      label.className = "grow";
      label.textContent = `${r.w}×${r.h} (${(r.w * 2.54).toFixed(1)}×${(r.h * 2.54).toFixed(1)} mm) — ${r.jumpers} jumpers, ${r.cuts} cuts`;
      const apply = document.createElement("button");
      apply.className = "minibtn";
      apply.textContent = t("size.apply");
      apply.addEventListener("click", () => this._applySize(r.board));
      row.appendChild(label);
      row.appendChild(apply);
      body.appendChild(row);
    }
  }

  _applySize(board) {
    this.snapshot();
    this.project = board.clone();
    this.active = "edit";
    this.versions = emptyVersions();
    this.selected = null;
    this.selection.clear();
    this.selectedWire = null;
    this.selectedNet = null;
    this.dirty = true;
    document.getElementById("sizeDlg").close();
    this._syncSizeInputs();
    this._recomputeIssues();
    this.render();
    this._status(`applied ${board.cols}×${board.rows} board (Ctrl+Z undoes it)`);
  }

  switchTab(name) {
    if (this._busy) return; // one compute at a time
    if (name !== "edit" && !this.versions[name]) {
      this._runBusy(`Computing ${name}…`, async () => {
        this.versions[name] = await this._computeVersion(name);
        this.active = name;
        this.selected = null;
        this.selection.clear();
        this.selectedWire = null;
        this.selectedNet = null;
        this.render();
        this._status(`${name} ready — 'Use this' to make the edit board`);
      });
      return;
    }
    this.active = name;
    this.selected = null;
    this.selection.clear();
    this.selectedWire = null;
    this.selectedNet = null;
    this.render();
    if (name !== "edit") this._status(`${name} (cached) — 'Use this' to make it the edit board`);
  }

  async _computeVersion(name) {
    // Trim crops whatever is on screen (so "Solve -> Trim" keeps the Solve routing);
    // the other tabs always recompute from the editable board.
    const base = name === "trim" ? this._shownProject() : this.project;
    const clone = base.clone();
    if (name === "trim") {
      const b = contentBounds(clone, LIBRARY);
      if (b) cropTo(clone, 1 - b.x0, 1 - b.y0, b.x1 - b.x0 + 1, b.y1 - b.y0 + 1);
      return clone;
    }
    if (name === "optimize" || name === "compact" || name === "easy") {
      // Cooperative: the optimizer yields to the event loop so it may take as long as it
      // needs without freezing the tab (no time limit). All three presets share the same
      // search budget, so they differ only by their weights (the intended design).
      const weights = name === "compact" ? COMPACT_WEIGHTS : name === "easy" ? EASY_WEIGHTS : undefined;
      await optimizeAsync(clone, LIBRARY, { weights, maxPasses: 6, maxEvaluations: 300, diagonal: this.allowDiagonal });
    }
    // solve / optimize / compact all finish by routing the (possibly optimized) board
    const result = route(clone, LIBRARY, { diagonal: this.allowDiagonal });
    clone.cuts = alignCuts(clone, LIBRARY, result.cuts, result.jumpers);
    clone.jumpers = result.jumpers.map((j) => ({ x: j.x, ya: j.ya, yb: j.yb, net: j.net, fixed: !!j.fixed }));
    return clone;
  }

  useThis() {
    if (this.active === "edit") return;
    const next = this.versions[this.active].clone();
    // Applying a whole computed result is ONE undoable step: snapshot the edit board
    // before swapping it in, and keep the history so Ctrl+Z returns to it.
    this.snapshot();
    this.project = next;
    this.versions = emptyVersions();
    this.active = "edit";
    this.selected = null;
    this.selection.clear();
    this.selectedWire = null;
    this.selectedNet = null;
    this.dirty = true; // the applied result is not saved until the user saves
    this._syncSizeInputs();
    this._recomputeIssues();
    this.render();
    this._status("result copied to the edit board (Ctrl+Z undoes it)");
  }

  _updateTabUI() {
    for (const b of document.querySelectorAll(".vtab")) {
      b.classList.toggle("active", b.dataset.vtab === this.active);
    }
    const use = document.getElementById("useThis");
    if (use) use.style.display = this.active === "edit" ? "none" : "";
    const note = document.getElementById("tabNote");
    if (note) note.textContent = this.active === "edit" ? "" : "read-only";
    const bar = document.getElementById("readonlyBar");
    if (bar) bar.style.display = this.active === "edit" ? "none" : "";
    const undo = document.getElementById("undo");
    if (undo) undo.disabled = !this._canEdit() || this.history.length === 0;
    const redo = document.getElementById("redo");
    if (redo) redo.disabled = !this._canEdit() || this.redoStack.length === 0;
    this._updateSaveState();
    const probTab = document.querySelector('.tabbar .tab[data-tab="problems"]');
    if (probTab) {
      const errors = this.issues.filter((i) => i.level === "error").length;
      const warns = this.issues.filter((i) => i.level === "warn").length;
      probTab.textContent = errors || warns ? `Problems (${errors || warns})` : "Problems";
      probTab.classList.toggle("alert", errors > 0);
      probTab.classList.toggle("warn", errors === 0 && warns > 0);
    }
  }

  openPrintDialog() {
    const project = this._shownProject();
    if (project.components.size === 0 && !this._solvedShown()) {
      this._status("nothing to print yet — add parts or run Solve first");
      return;
    }
    document.getElementById("printOrigin").value = this._printOrigin || "A1";
    document.getElementById("printDlg").showModal();
  }

  _doPrint() {
    const project = this._shownProject();
    const { cols, rows } = project;
    const ans = document.getElementById("printOrigin").value;
    this._printOrigin = ans;
    const m = /^\s*([A-Za-z]+)\s*(\d+)\s*$/.exec(ans);
    const origin = m ? { row: lettersToNum(m[1]), col: Number(m[2]) } : { row: 1, col: 1 };
    const colText = (x) => String(origin.col + x - 1);
    const rowText = (y) => rowLetter(origin.row + rows - y);
    const cell = (x, y) => `${rowText(y)}${colText(x)}`;
    const want = (id) => document.getElementById(id).checked;
    const sections = {
      front: want("pc-front"),
      copper: want("pc-copper"),
      holes: want("pc-holes"),
      cuts: want("pc-cuts"),
      jumpers: want("pc-jumpers"),
      bom: want("pc-bom"),
      steps: want("pc-steps"),
    };
    if (!Object.values(sections).some(Boolean)) {
      this._status("pick at least one section to print");
      return;
    }

    const SVG_NS = "http://www.w3.org/2000/svg";
    const build = (view, parts) => {
      const svg = document.createElementNS(SVG_NS, "svg");
      render(svg, {
        project,
        library: LIBRARY,
        view,
        selected: null,
        pending: null,
        mode: "select",
        solved: project.jumpers.length > 0 || project.cuts.size > 0,
        showNames: view === "front",
        selectedNet: null,
        selectedWire: null,
        focusNets: new Set(),
        layers: { parts, wires: true, cuts: true, copper: true, nets: false, grid: true },
        origin,
        mono: true, // black & white, for a non-colour printer
        issues: [],
      });
      const vb = svg.viewBox.baseVal;
      const mm = 2.54 / CELL; // one hole = 2.54 mm -> true scale at print 100%
      svg.setAttribute("width", `${(vb.width * mm).toFixed(2)}mm`);
      svg.setAttribute("height", `${(vb.height * mm).toFixed(2)}mm`);
      return svg;
    };
    const cutList = [...project.cuts].sort().map((c) => {
      const [x, y] = c.split(",").map(Number);
      return cell(x, y);
    }).join(" ") || "(none)";
    const jumperList = project.jumpers.map((j) => `${cell(j.x, j.ya)}-${cell(j.x2 ?? j.x, j.yb)} (${j.net || "?"})`).join("; ") || "(none)";
    const mounts = project.mountingHoles ?? new Set();
    const mountList = [...mounts].sort().map((c) => {
      const [x, y] = c.split(",").map(Number);
      return cell(x, y);
    }).join(" ") || "(none)";
    // Millimetre geometry for enclosure/support design (hole = 2.54 mm grid).
    const mountInfo = (() => {
      if (mounts.size === 0) return "";
      const { holes, pairs, spanX, spanY } = mountHoleMetrics(project);
      const f = (n) => n.toFixed(2);
      const out = [`Board ${(cols * 2.54).toFixed(1)} x ${(rows * 2.54).toFixed(1)} mm; hole centres are cell centres.`];
      if (pairs.length) {
        out.push("Centre-to-centre distances:");
        for (const p of pairs) out.push(`  ${p.a} - ${p.b} : dx ${f(p.dx)} mm, dy ${f(p.dy)} mm, distance ${f(p.dist)} mm`);
        out.push(`Pattern span: ${f(spanX)} x ${f(spanY)} mm (dx x dy between the extreme holes)`);
      }
      out.push("Each hole centre, from the board's top-left corner (X right, Y down):");
      for (const h of holes) out.push(`  ${h.cell} : X ${f(h.mmX)} mm, Y ${f(h.mmY)} mm`);
      return out.join("\n");
    })();

    const bom = new Map();
    for (const c of project.components.values()) {
      const key = `${c.part}|${c.value || ""}`;
      const entry = bom.get(key) ?? { part: c.part, value: c.value || "", refs: [] };
      entry.refs.push(c.ref);
      bom.set(key, entry);
    }
    const bomRows = [...bom.values()]
      .sort((a, b) => a.part.localeCompare(b.part))
      .map((e) => `${e.value ? `${e.value} ` : ""}${e.part} ×${e.refs.length} — ${e.refs.sort().join(", ")}`)
      .join("\n") || "(none)";

    const comps = [...project.components.values()].sort((a, b) => a.ref.localeCompare(b.ref));
    const compRows = comps
      .map((c) => `${c.ref} — ${c.part}${c.value ? ` (${c.value})` : ""} — at ${cell(c.x, c.y)}${c.rot ? ` rot ${c.rot}°` : ""}`)
      .join("\n") || "(none)";
    const netRows = project.nets.map((n) => `${n.label || n.id}: ${[...n.pins].sort().join(", ")}`).join("\n") || "(none)";
    const steps = [
      `1. Print at 100% (no 'fit to page') for true scale. Board ${cols} x ${rows} holes = ${(cols * 2.54).toFixed(1)} x ${(rows * 2.54).toFixed(1)} mm. (Scale relies on the browser print dialog; a direct vector-PDF export is not built yet.)`,
      `2. Drill the mounting holes (Ø${project.mountDiameter} mm, through the board) at: ${mountList}`,
      `3. On the COPPER side, cut the tracks at: ${cutList}`,
      `4. On the COPPER side, solder the jumpers: ${jumperList}`,
      `5. On the COMPONENT side, insert and solder ${comps.length} part(s), mind orientation:`,
      compRows,
      `6. Final electrical check against the nets:`,
      netRows,
    ].join("\n");

    const blocks = [];
    if (sections.front) {
      blocks.push(`<h3>Component side (1:1) — origin ${rowLetter(origin.row)}${origin.col}</h3><div class="page">${build("front", true).outerHTML}</div>`);
    }
    if (sections.copper) {
      blocks.push(`<h3>Copper side, mirrored (1:1, no components)</h3><div class="page">${build("copper", false).outerHTML}</div>`);
    }
    if (sections.holes) {
      const holesText = mountList + (mountInfo ? `\n\n${mountInfo}` : "");
      blocks.push(`<h3>Mounting holes (${mounts.size}, Ø${project.mountDiameter} mm)</h3><pre>${holesText}</pre>`);
    }
    if (sections.cuts) blocks.push(`<h3>Cuts (${project.cuts.size})</h3><pre>${cutList}</pre>`);
    if (sections.jumpers) blocks.push(`<h3>Jumpers (${project.jumpers.length})</h3><pre>${jumperList}</pre>`);
    if (sections.bom) blocks.push(`<h3>BOM</h3><pre>${bomRows}</pre>`);
    if (sections.steps) blocks.push(`<h3>Assembly steps</h3><pre>${steps}</pre>`);

    const win = window.open("", "_blank");
    if (!win) {
      this._status("allow pop-ups to print");
      return;
    }
    win.document.write(`<!doctype html><html><head><title>${project.title} — print 1:1</title>
<style>@page{size:A4;margin:10mm} body{font:12px monospace;margin:0;color:#000} h3{margin:8px 0 4px} svg{display:block;height:auto} .page{margin-bottom:10mm} pre{white-space:pre-wrap;font:12px monospace}</style>
</head><body>
${blocks.join("\n")}
</body></html>`);
    win.document.close();
    win.focus();
    win.print();
    document.getElementById("printDlg").close();
    this._status("print window opened (print at 100% / Save as PDF)");
  }

  showAscii() {
    const project = this._shownProject();
    if (project.components.size === 0) {
      this._status("nothing to export — add some parts first");
      return;
    }
    const pre = document.getElementById("asciiText");
    pre.textContent = toAscii(project, LIBRARY);
    document.getElementById("asciiDlg").showModal();
    this._select(pre); // so Ctrl+C works even if the clipboard API is blocked
  }

  _select(node) {
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  _copyPre(id, label) {
    const pre = document.getElementById(id);
    const fallback = () => {
      this._select(pre);
      try {
        const ok = document.execCommand("copy");
        this._status(ok ? `${label} copied` : "text selected — press Ctrl+C");
      } catch {
        this._status("text selected — press Ctrl+C");
      }
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(pre.textContent)
        .then(() => this._status(`${label} copied`))
        .catch(fallback);
    } else {
      fallback();
    }
  }

  showNetlist() {
    const project = this._shownProject();
    if (project.components.size === 0 || project.nets.length === 0) {
      this._status("nothing to export — add parts and nets first");
      return;
    }
    this._renderNetlist();
    document.getElementById("netDlg").showModal();
  }

  _renderNetlist() {
    const fmt = document.getElementById("netFormat").value;
    document.getElementById("netText").textContent = exportNetlist(this._shownProject(), LIBRARY, fmt);
  }

  _downloadNetlist() {
    const fmt = document.getElementById("netFormat").value;
    const ext = { json: "json", spice: "cir", kicad: "net" }[fmt] || "txt";
    const blob = new Blob([document.getElementById("netText").textContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${this.fileName || this.project.title || "board"}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  setView(copper) {
    this.view = copper ? "copper" : "front";
    this.render();
  }

  setBoardSize(cols, rows) {
    if (!this._guard()) {
      this._syncSizeInputs();
      return;
    }
    const min = this._minBoard();
    this.snapshot();
    this.project.cols = Math.max(min.cols, Math.min(100, Math.round(cols) || 1));
    this.project.rows = Math.max(min.rows, Math.min(60, Math.round(rows) || 1));
    this._syncSizeInputs();
    this._afterStructuralChange(true);
  }

  // -- files --------------------------------------------------------------------

  newProject() {
    if (!this._confirmDiscard()) return;
    const cols = Number(document.getElementById("cols").value) || 34;
    const rows = Number(document.getElementById("rows").value) || 26;
    this.project = new Project({ cols, rows });
    this.fileName = null;
    // A new board invalidates every cached result tab.
    this.versions = emptyVersions();
    this.active = "edit";
    this._syncSizeInputs();
    this.selected = null;
    this.selection.clear();
    this.pending = null;
    this.jumperStart = null;
    this.solved = false;
    this.dirty = false;
    this.history.length = 0;
    this.redoStack.length = 0;
    this._recomputeIssues();
    this.render();
  }

  _downloadProject(name) {
    const blob = new Blob([JSON.stringify(this.project.toJSON(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  _baseName(name) {
    return name.replace(/ \(\d+\)$/, "");
  }

  // The browser cannot see the Downloads folder, so we cannot detect a file that already
  // exists on disk. We can only avoid reusing a name *this app* has already emitted; on top
  // of that, browsers themselves rename on a real collision (so worst case is "x (1) (1)").
  _usedNames() {
    try {
      return new Set(JSON.parse(localStorage.getItem(SAVED_NAMES_KEY) || "[]"));
    } catch {
      return new Set();
    }
  }

  _uniqueName(base) {
    const used = this._usedNames();
    if (!used.has(base)) return base;
    for (let i = 1; ; i++) {
      const cand = `${base} (${i})`;
      if (!used.has(cand)) return cand;
    }
  }

  _rememberName(name) {
    try {
      const used = this._usedNames();
      used.add(name);
      localStorage.setItem(SAVED_NAMES_KEY, JSON.stringify([...used]));
    } catch {
      // storage unavailable: the browser's own collision handling still applies
    }
  }

  _afterSave(name) {
    this.fileName = name;
    this.project.title = this._baseName(name); // keep the title free of the "(n)" suffix
    this.dirty = false;
    this._persistAutosave(); // record the cleared dirty flag right away
    this._rememberName(name);
    this._updateSaveState();
    this._status(`saved ${name}.json`);
  }

  _updateSaveState() {
    const el = document.getElementById("saveState");
    if (!el) return;
    el.textContent = this.dirty ? "● unsaved" : "saved";
    el.classList.toggle("dirty", !!this.dirty);
  }

  save() {
    if (!this.fileName) {
      // First save: ask for a name in the dialog (consistent with Print / Size dialogs).
      this._openSaveDialog(this.project.title || "board");
      return;
    }
    const name = this._uniqueName(this._baseName(this.fileName));
    this._downloadProject(name);
    this._afterSave(name);
  }

  /** Always ask for a name, even when the board already has one. */
  saveAs() {
    this._openSaveDialog(this.fileName ? this._baseName(this.fileName) : this.project.title || "board");
  }

  _openSaveDialog(defaultName) {
    const input = document.getElementById("saveName");
    input.value = defaultName;
    document.getElementById("saveDlg").showModal();
    input.focus();
    input.select?.();
  }

  _confirmSave() {
    const base = (document.getElementById("saveName").value.trim() || "board").replace(/\.json$/i, "");
    const name = this._uniqueName(base);
    this._downloadProject(name);
    this._afterSave(name);
    document.getElementById("saveDlg").close();
  }

  async open(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      this._status(`could not open ${file.name}: not valid JSON`);
      return;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      this._status(`could not open ${file.name}: not a Stripboard Studio board file`);
      return;
    }
    try {
      this.project = Project.fromJSON(data);
      registerProjectParts(this.project.customParts);
    } catch (err) {
      this._status(`could not open ${file.name}: ${err.message}`);
      return;
    }
    this.fileName = (file.name || "board").replace(/\.json$/i, "");
    document.getElementById("cols").value = this.project.cols;
    document.getElementById("rows").value = this.project.rows;
    // A freshly opened board invalidates every cached result tab (Solve/Trim/...) and returns
    // to the Edit tab, so a stale result from the previous board can never be shown.
    this.versions = emptyVersions();
    this.active = "edit";
    this.selected = null;
    this.selection.clear();
    this.pending = null;
    this.jumperStart = null;
    this.solved = false;
    this.dirty = false;
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
    on("saveAs", () => this.saveAs());
    on("open", () => {
      if (!this._confirmDiscard()) return;
      document.getElementById("file").click();
    });
    on("newPart", () => this.openNewPart());
    document.getElementById("partCancel").addEventListener("click", () => document.getElementById("partDlg").close());
    document.getElementById("partCreate").addEventListener("click", () => this.createPart());
    document.getElementById("pDouble").addEventListener("change", () => this.updatePartForm());
    on("undo", () => this.undo());
    on("redo", () => this.redo());

    on("print", () => this.openPrintDialog());
    document.getElementById("printCancel").addEventListener("click", () => document.getElementById("printDlg").close());
    document.getElementById("printGo").addEventListener("click", () => this._doPrint());
    for (const el of document.querySelectorAll("#exportMenu .menu-items button")) {
      el.addEventListener("click", () => {
        document.getElementById("exportMenu").open = false;
      });
    }
    on("ascii", () => this.showAscii());
    document.getElementById("asciiClose").addEventListener("click", () =>
      document.getElementById("asciiDlg").close(),
    );
    document.getElementById("asciiCopy").addEventListener("click", () => this._copyPre("asciiText", "board text"));
    on("netlist", () => this.showNetlist());
    document.getElementById("netFormat").addEventListener("change", () => this._renderNetlist());
    document.getElementById("netClose").addEventListener("click", () => document.getElementById("netDlg").close());
    document.getElementById("netCopy").addEventListener("click", () => this._copyPre("netText", "netlist"));
    document.getElementById("netDownload").addEventListener("click", () => this._downloadNetlist());
    on("connect", () => this.setMode(this.mode === "connect" ? "select" : "connect"));
    on("addCut", () => this.setMode(this.mode === "cut" ? "select" : "cut"));
    on("addJumper", () => this.setMode(this.mode === "jumper" ? "select" : "jumper"));
    on("addMount", () => this.setMode(this.mode === "mount" ? "select" : "mount"));
    document.getElementById("names").addEventListener("change", (e) => {
      this.showNames = e.target.checked;
      this.render();
    });
    document.getElementById("connections").addEventListener("change", (e) => {
      this.showConnections = e.target.checked;
      this.render();
    });
    document.getElementById("mountzones").addEventListener("change", (e) => {
      this.showMountZones = e.target.checked;
      this.render();
    });
    document.getElementById("diagonals").addEventListener("change", (e) => {
      this.allowDiagonal = e.target.checked;
      // A routing option changed: cached results are stale, so go back to Edit.
      this.versions = emptyVersions();
      this.active = "edit";
      this.selected = null;
      this.selection.clear();
      this.render();
      this._status(this.allowDiagonal ? "diagonal jumpers enabled — re-run Solve" : "diagonal jumpers disabled — re-run Solve");
    });
    document.getElementById("schematic").addEventListener("change", (e) => {
      this.schematic = e.target.checked;
      if (this.schematic && this._isToolMode()) this.setMode("select");
      this.render();
    });
    const partSearch = document.getElementById("partSearch");
    partSearch.addEventListener("input", () => {
      this._paletteQuery = partSearch.value;
      this._renderPalette();
    });
    const layerIds = { "lc-parts": "parts", "lc-wires": "wires", "lc-cuts": "cuts", "lc-copper": "copper", "lc-nets": "nets", "lc-grid": "grid" };
    for (const [id, key] of Object.entries(layerIds)) {
      document.getElementById(id).addEventListener("change", (e) => {
        this.layers[key] = e.target.checked;
        this.render();
      });
    }
    document.getElementById("file").addEventListener("change", (e) => {
      const file = e.target.files[0];
      e.target.value = ""; // allow re-selecting the same file later
      if (file) this.open(file);
    });
    document.getElementById("copper").addEventListener("change", (e) => this.setView(e.target.checked));
    document.getElementById("cols").addEventListener("change", () => this.setBoardSize(Number(document.getElementById("cols").value), this.project.rows));
    document.getElementById("rows").addEventListener("change", () => this.setBoardSize(this.project.cols, Number(document.getElementById("rows").value)));

    for (const b of document.querySelectorAll(".vtab")) {
      b.addEventListener("click", () => this.switchTab(b.dataset.vtab));
    }
    document.getElementById("useThis").addEventListener("click", () => this.useThis());
    on("sizeSearch", () => this.openSizeSearch());
    document.getElementById("sizeClose").addEventListener("click", () => document.getElementById("sizeDlg").close());
    document.getElementById("theme").addEventListener("change", (e) => {
      this.theme = e.target.value;
      try {
        localStorage.setItem(THEME_KEY, this.theme);
      } catch {
        // storage unavailable: theme just won't persist
      }
      this.render();
    });
    try {
      window.matchMedia?.("(prefers-color-scheme: light)")?.addEventListener?.("change", () => {
        if (this.theme === "auto") this.render();
      });
    } catch {
      // no matchMedia: auto stays on the default
    }
    document.getElementById("lang").addEventListener("change", (e) => {
      this.lang = e.target.value;
      try {
        localStorage.setItem(LANG_KEY, this.lang);
      } catch {
        // storage unavailable: language just won't persist
      }
      setLang(this._resolveLang());
      applyStatic();
      this.render();
    });
    document.getElementById("saveGo").addEventListener("click", () => this._confirmSave());
    document.getElementById("saveCancel").addEventListener("click", () => document.getElementById("saveDlg").close());
    document.getElementById("saveName").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this._confirmSave();
      }
    });

    const tabs = [...document.querySelectorAll(".tabbar .tab")];
    for (const tab of tabs) {
      tab.addEventListener("click", () => {
        for (const x of tabs) x.classList.toggle("active", x === tab);
        for (const pane of document.querySelectorAll(".tabpane")) {
          pane.classList.toggle("hidden", pane.id !== `pane-${tab.dataset.tab}`);
        }
      });
    }
  }

  /** Pointer position in the SVG's user units (viewBox space). */
  _svgPoint(evt) {
    const pt = this.svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    return pt.matrixTransform(this.svg.getScreenCTM().inverse());
  }

  _cellFromPoint(loc) {
    const colIndex = Math.round((loc.x - PAD) / CELL);
    const row = Math.round((loc.y - PAD) / CELL) + 1;
    const x = this.view === "copper" ? this.project.cols - colIndex : colIndex + 1;
    return { x, y: row };
  }

  _cellAt(evt) {
    return this._cellFromPoint(this._svgPoint(evt));
  }

  // -- zoom / pan (viewBox transform; interactions use getScreenCTM so they stay correct) --

  // -- theme ---------------------------------------------------------------------

  _loadTheme() {
    try {
      const t = localStorage.getItem(THEME_KEY);
      return t === "light" || t === "dark" ? t : "auto";
    } catch {
      return "auto";
    }
  }

  _loadLang() {
    try {
      const l = localStorage.getItem(LANG_KEY);
      return l === "en" || l === "pt" ? l : "auto";
    } catch {
      return "auto";
    }
  }

  _resolveLang() {
    if (this.lang === "en" || this.lang === "pt") return this.lang;
    try {
      return String(navigator.language || "en").toLowerCase().startsWith("pt") ? "pt" : "en";
    } catch {
      return "en";
    }
  }

  _effectiveTheme() {
    if (this.theme === "light" || this.theme === "dark") return this.theme;
    try {
      return window.matchMedia?.("(prefers-color-scheme: light)")?.matches ? "light" : "dark";
    } catch {
      return "dark";
    }
  }

  _applyTheme() {
    const eff = this._effectiveTheme();
    document.documentElement.dataset.theme = eff;
    const sel = document.getElementById("theme");
    if (sel) sel.value = this.theme;
    return eff;
  }

  _viewBase() {
    const p = this._shownProject();
    return { width: p.cols * CELL + PAD * 2, height: p.rows * CELL + PAD * 2 + 48 };
  }

  _clampView() {
    const { width, height } = this._viewBase();
    const vw = width / this.zoom;
    const vh = height / this.zoom;
    this.pan.x = Math.max(0, Math.min(width - vw, this.pan.x));
    this.pan.y = Math.max(0, Math.min(height - vh, this.pan.y));
  }

  _applyViewBox() {
    const { width, height } = this._viewBase();
    this._clampView();
    const vw = width / this.zoom;
    const vh = height / this.zoom;
    this.svg.setAttribute("viewBox", `${this.pan.x} ${this.pan.y} ${vw} ${vh}`);
    const pct = document.getElementById("zoomPct");
    if (pct) pct.textContent = `${Math.round(this.zoom * 100)}%`;
  }

  zoomBy(factor, anchor) {
    const { width, height } = this._viewBase();
    const oldW = width / this.zoom;
    const oldH = height / this.zoom;
    const z2 = Math.max(0.4, Math.min(8, this.zoom * factor));
    if (z2 === this.zoom) return;
    const a = anchor ?? { x: this.pan.x + oldW / 2, y: this.pan.y + oldH / 2 };
    const fx = (a.x - this.pan.x) / oldW;
    const fy = (a.y - this.pan.y) / oldH;
    this.zoom = z2;
    this.pan.x = a.x - fx * (width / this.zoom);
    this.pan.y = a.y - fy * (height / this.zoom);
    this._applyViewBox();
  }

  zoomFit() {
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this._applyViewBox();
  }

  _selectedRefs() {
    return [...this.selection];
  }

  /** Components under the current selection, in insertion order. */
  _selectedComps() {
    return this._selectedRefs().map((r) => this.project.components.get(r)).filter(Boolean);
  }

  _selectOnly(ref) {
    this.selection = new Set(ref ? [ref] : []);
    this.selected = ref || null;
  }

  _toggleSel(ref) {
    if (this.selection.has(ref)) this.selection.delete(ref);
    else this.selection.add(ref);
    this.selected = this.selection.has(ref) ? ref : (this._selectedRefs()[0] ?? null);
  }

  /** Select every component whose pins/body fall inside the marquee rectangle. */
  _selectInRect(m) {
    const a = this._cellFromPoint({ x: m.x0, y: m.y0 });
    const b = this._cellFromPoint({ x: m.x1, y: m.y1 });
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);
    const next = new Set();
    for (const comp of this.project.components.values()) {
      const part = LIBRARY.get(comp.part);
      if (!part) continue;
      const body = componentBody(comp, part);
      const inside = body
        ? !(body.x1 < x0 || body.x0 > x1 || body.y1 < y0 || body.y0 > y1) // rect overlap
        : componentPins(comp, part).some((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1);
      if (inside) next.add(comp.ref);
    }
    this.selection = next;
    this.selected = this._selectedRefs()[0] ?? null;
  }

  _bindBoard() {
    this.svg.addEventListener("pointerdown", (evt) => {
      // If a panel input still has focus, commit it before we re-render (otherwise the
      // input is destroyed before its change event fires and the edit is lost).
      const active = document.activeElement;
      if (active && ["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName)) active.blur();
      evt.preventDefault(); // stop text selection while dragging on the board
      const editing = this._canEdit();
      // Middle-button (or Space+left) drag pans the view instead of selecting/dragging.
      if (evt.button === 1 || (this._spaceDown && evt.button === 0)) {
        this._panDrag = { x: evt.clientX, y: evt.clientY };
        this.svg.setPointerCapture(evt.pointerId);
        return;
      }

      const netEl = evt.target.closest("[data-net]");
      if (netEl) {
        const id = netEl.dataset.net;
        this.selectedNet = this.selectedNet === id ? null : id;
        this.selected = null;
        this.selectedWire = null;
        this.render();
        return;
      }
      const handleEl = evt.target.closest("[data-handle]");
      if (handleEl && editing) {
        this.boardResize = { axis: handleEl.dataset.handle, before: JSON.stringify(this.project.toJSON()), moved: false };
        this.svg.setPointerCapture(evt.pointerId);
        return;
      }
      // Shift+drag (or Alt+drag) a bendable part's lead to change its span. Shift is used
      // first because Alt+drag is grabbed by the window manager on Linux.
      if ((evt.shiftKey || evt.altKey) && this.mode === "select" && editing) {
        const pinEl = evt.target.closest("[data-pin]"); // only ON a lead, not the whole body
        const el = evt.target.closest("[data-ref]");
        const comp = el && this.project.components.get(el.dataset.ref);
        const part = comp && LIBRARY.get(comp.part);
        if (pinEl && comp && part?.bendable) {
          this.selected = comp.ref;
          this.selectedWire = null;
          this.selectedNet = null;
          this.spanDrag = { ref: comp.ref, before: JSON.stringify(this.project.toJSON()), moved: false };
          this.svg.setPointerCapture(evt.pointerId);
          this.render();
          return;
        }
      }

      if (editing && this._isToolMode() && !this.schematic) {
        this._handleToolClick(evt);
        return;
      }
      const pinEl = evt.target.closest("[data-pin]");
      if (pinEl && this.mode === "connect" && editing) {
        this.handlePinClick(`${pinEl.dataset.ref}.${pinEl.dataset.pin}`);
        return;
      }
      const wireEl = evt.target.closest("[data-wire]");
      if (wireEl && this.mode === "select") {
        const i = Number(wireEl.dataset.wire);
        const jumper = this.project.jumpers[i];
        const already = this.selectedWire?.kind === "jumper" && this.selectedWire.i === i;
        if (!already) {
          this.selected = null;
          this.selectedNet = null; // the jumper's net is derived from the selection
          this.selectedWire = { kind: "jumper", i };
        }
        if (editing) {
          this.wireDrag = { kind: "jumper", i, before: JSON.stringify(this.project.toJSON()), moved: false, wasSelected: already };
          this.svg.setPointerCapture(evt.pointerId);
        }
        this.render();
        return;
      }
      const cutEl = evt.target.closest("[data-cut]");
      if (cutEl && this.mode === "select") {
        const key = cutEl.dataset.cut;
        const already = this.selectedWire?.kind === "cut" && this.selectedWire.key === key;
        if (!already) {
          this.selected = null;
          this.selectedNet = null;
          this.selectedWire = { kind: "cut", key };
        }
        if (editing) {
          this.wireDrag = { kind: "cut", key, before: JSON.stringify(this.project.toJSON()), moved: false, wasSelected: already };
          this.svg.setPointerCapture(evt.pointerId);
        }
        this.render();
        return;
      }
      const mountEl = evt.target.closest("[data-mount]");
      if (mountEl && this.mode === "select") {
        const key = mountEl.dataset.mount;
        const already = this.selectedWire?.kind === "mount" && this.selectedWire.key === key;
        this.selected = null;
        this.selectedNet = null;
        this.selectedWire = already ? null : { kind: "mount", key };
        this.render();
        return;
      }
      const compEl = evt.target.closest("[data-ref]");
      if (!compEl) {
        // empty board: start a rubber-band selection (a plain click clears on pointerup)
        if (this.mode === "select" && editing && !this.schematic) {
          const p = this._svgPoint(evt);
          this.marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, moved: false };
          this.svg.setPointerCapture(evt.pointerId);
          this.render();
          return;
        }
        this._selectOnly(null);
        this.selectedWire = null;
        this.selectedNet = null;
        this.render();
        return;
      }
      const ref = compEl.dataset.ref;
      this.selectedWire = null;
      this.selectedNet = null;
      if (evt.shiftKey) {
        this._toggleSel(ref); // shift-click adds/removes from the selection
        this.render();
        return;
      }
      // Remember whether this was the ONLY selected part BEFORE we select it, so a plain click
      // selects the first time and only a second click (on the sole selection) toggles it off.
      const wasOnly = this.selection.size === 1 && this.selection.has(ref);
      if (!this.selection.has(ref)) this._selectOnly(ref);
      else this.selected = ref; // keep a multi-selection; dragging moves it all
      const comp = this.project.components.get(ref);
      if (this.schematic || !editing) {
        if (!editing) this._guard(); // explain why nothing moves
        this.render();
        return;
      }
      // Drag the whole selection, expanded by any groups; refuse if any member is locked.
      const memberMap = new Map();
      for (const r of this.selection.size ? this._selectedRefs() : [ref]) {
        const c = this.project.components.get(r);
        if (!c) continue;
        const mates = c.group ? this._groupMembers(c.group) : [c];
        for (const m of mates) memberMap.set(m.ref, m);
      }
      const members = [...memberMap.values()];
      if (members.some((m) => m.locked)) {
        this._status("selection has a locked part — unlock it to move");
        this.render();
        return;
      }
      this.drag = {
        ref,
        start: this._cellAt(evt),
        members: members.map((m) => ({ comp: m, ox: m.x, oy: m.y })),
        before: JSON.stringify(this.project.toJSON()),
        moved: false,
        wasOnly,
      };
      this.svg.setPointerCapture(evt.pointerId);
      this.render();
    });

    this.svg.addEventListener("pointermove", (evt) => {
      if (this._panDrag) {
        const rect = this.svg.getBoundingClientRect();
        const basePerPx = this._viewBase().width / this.zoom / (rect.width || 1);
        this.pan.x -= (evt.clientX - this._panDrag.x) * basePerPx;
        this.pan.y -= (evt.clientY - this._panDrag.y) * basePerPx;
        this._panDrag.x = evt.clientX;
        this._panDrag.y = evt.clientY;
        this._applyViewBox();
        return;
      }
      if (this.marquee) {
        const p = this._svgPoint(evt);
        this.marquee.x1 = p.x;
        this.marquee.y1 = p.y;
        this.marquee.moved = true;
        this.render();
        return;
      }
      if (this.boardResize) {
        const cell = this._cellAt(evt);
        const min = this._minBoard();
        if (this.boardResize.axis === "right") this.project.cols = Math.max(min.cols, Math.min(100, cell.x));
        else this.project.rows = Math.max(min.rows, Math.min(60, cell.y));
        this._syncSizeInputs();
        this.boardResize.moved = true;
        this.render();
        return;
      }
      if (this.spanDrag) {
        const comp = this.project.components.get(this.spanDrag.ref);
        const part = comp && LIBRARY.get(comp.part);
        if (comp && part?.bendable) {
          const cell = this._cellAt(evt);
          const step = rotateLocal(0, 1, comp.rot || 0);
          const span = Math.round((cell.x - comp.x) * step.x + (cell.y - comp.y) * step.y);
          comp.span = Math.max(part.bendable.min, Math.min(part.bendable.max, span));
          this.spanDrag.moved = true;
          this.render();
        }
        return;
      }
      if (this.wireDrag) {
        const cell = this._cellAt(evt);
        const x = Math.max(1, Math.min(this.project.cols, cell.x));
        const y = Math.max(1, Math.min(this.project.rows, cell.y));
        if (this.wireDrag.kind === "jumper") {
          const j = this.project.jumpers[this.wireDrag.i];
          if (j) {
            const bx = j.x;
            const bya = j.ya;
            const byb = j.yb;
            if (Math.abs(y - j.ya) <= Math.abs(y - j.yb)) j.ya = y;
            else j.yb = y;
            j.x = x;
            if (j.ya > j.yb) [j.ya, j.yb] = [j.yb, j.ya];
            if (j.ya === j.yb) j.yb = Math.min(this.project.rows, j.ya + 1);
            if (j.x !== bx || j.ya !== bya || j.yb !== byb) this.wireDrag.moved = true;
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
            this.wireDrag.moved = true;
            this.render();
          }
        }
        return;
      }
      if (!this.drag) return;
      const cell = this._cellAt(evt);
      // Clamp one rigid delta so every member of the (possibly grouped) drag stays on board.
      const { cols, rows } = this.project;
      let minDx = -Infinity;
      let maxDx = Infinity;
      let minDy = -Infinity;
      let maxDy = Infinity;
      for (const m of this.drag.members) {
        minDx = Math.max(minDx, 1 - m.ox);
        maxDx = Math.min(maxDx, cols - m.ox);
        minDy = Math.max(minDy, 1 - m.oy);
        maxDy = Math.min(maxDy, rows - m.oy);
      }
      const dx = Math.max(minDx, Math.min(maxDx, cell.x - this.drag.start.x));
      const dy = Math.max(minDy, Math.min(maxDy, cell.y - this.drag.start.y));
      for (const m of this.drag.members) {
        const nx = m.ox + dx;
        const ny = m.oy + dy;
        if (nx !== m.comp.x || ny !== m.comp.y) this.drag.moved = true;
        m.comp.x = nx;
        m.comp.y = ny;
      }
      this.render();
    });

    this.svg.addEventListener("pointerup", () => {
      if (this._panDrag) {
        this._panDrag = null;
        return;
      }
      if (this.marquee) {
        const m = this.marquee;
        this.marquee = null;
        if (!m.moved || (Math.abs(m.x1 - m.x0) < 3 && Math.abs(m.y1 - m.y0) < 3)) {
          this._selectOnly(null); // a plain click on empty board clears the selection
        } else {
          this._selectInRect(m);
        }
        this.render();
        return;
      }
      if (this.boardResize) {
        const d = this.boardResize;
        this.boardResize = null;
        if (d.moved) {
          this.pushHistory(d.before);
          this._afterStructuralChange(true);
        }
        return;
      }
      if (this.spanDrag) {
        const d = this.spanDrag;
        this.spanDrag = null;
        if (d.moved) {
          this.pushHistory(d.before);
          this._afterStructuralChange(true);
        }
        return;
      }
      if (this.wireDrag) {
        const d = this.wireDrag;
        this.wireDrag = null;
        if (!d.moved) {
          // a plain click: toggle the selection back off if it was already selected
          if (d.wasSelected) {
            this.selectedWire = null;
            this.selectedNet = null;
            this.render();
          }
          return;
        }
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
      const { before, moved, wasOnly } = this.drag;
      this.drag = null;
      if (!moved) {
        // a plain click on the sole selected part toggles it off
        if (wasOnly) {
          this._selectOnly(null);
          this.render();
        }
        return;
      }
      this.pushHistory(before);
      this._afterStructuralChange();
    });

    this.svg.addEventListener(
      "wheel",
      (evt) => {
        evt.preventDefault();
        this.zoomBy(evt.deltaY < 0 ? 1.15 : 1 / 1.15, this._svgPoint(evt));
      },
      { passive: false },
    );
    document.getElementById("zoomIn").addEventListener("click", () => this.zoomBy(1.25));
    document.getElementById("zoomOut").addEventListener("click", () => this.zoomBy(1 / 1.25));
    document.getElementById("zoomFit").addEventListener("click", () => this.zoomFit());
  }

  _clearSelection() {
    this.pending = null;
    this.jumperStart = null;
    this.activeGroup = null; // Esc also ends the "add to group" session
    this.marquee = null;
    this.selection.clear();
    this.selected = null;
    this.selectedWire = null;
    this.selectedNet = null;
    this.render();
  }

  _nudgeSelected(evt) {
    const comps = this._selectedComps();
    if (!comps.length) return;
    let dx = evt.key === "ArrowLeft" ? -1 : evt.key === "ArrowRight" ? 1 : 0;
    let dy = evt.key === "ArrowUp" ? -1 : evt.key === "ArrowDown" ? 1 : 0;
    // Clamp so the whole selection stays on the board.
    const { cols, rows } = this.project;
    dx = Math.max(Math.max(...comps.map((c) => 1 - c.x)), Math.min(Math.min(...comps.map((c) => cols - c.x)), dx));
    dy = Math.max(Math.max(...comps.map((c) => 1 - c.y)), Math.min(Math.min(...comps.map((c) => rows - c.y)), dy));
    this.snapshot();
    for (const comp of comps) {
      comp.x += dx;
      comp.y += dy;
    }
    this._afterStructuralChange();
  }

  _bindKeyboard() {
    document.addEventListener("keydown", (evt) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(evt.target.tagName)) return;
      const key = evt.key;
      const lower = key.length === 1 ? key.toLowerCase() : key;
      const mod = evt.ctrlKey || evt.metaKey;
      // View controls work in any tab (they don't edit): Space pans, +/-/0 zoom.
      if (key === " ") {
        this._spaceDown = true;
        evt.preventDefault();
        return;
      }
      if (!mod && (key === "+" || key === "=")) return evt.preventDefault(), this.zoomBy(1.2);
      if (!mod && (key === "-" || key === "_")) return evt.preventDefault(), this.zoomBy(1 / 1.2);
      if (!mod && key === "0") return evt.preventDefault(), this.zoomFit();
      if (!this._canEdit() && key !== "Escape" && lower !== "v") return; // read-only tab
      if (mod) {
        if (evt.shiftKey) {
          if (lower === "o") return evt.preventDefault(), this.optimize();
          if (lower === "c") return evt.preventDefault(), this.compact();
          if (lower === "e") return evt.preventDefault(), this.easy();
          if (lower === "t") return evt.preventDefault(), this.trim();
          if (lower === "z") return evt.preventDefault(), this.redo();
          if (lower === "s") return evt.preventDefault(), this.saveAs();
        }
        if (lower === "z") return evt.preventDefault(), this.undo();
        if (lower === "y") return evt.preventDefault(), this.redo();
        if (lower === "s") return evt.preventDefault(), this.save();
        if (lower === "o") return evt.preventDefault(), document.getElementById("file").click();
        if (lower === "n") return evt.preventDefault(), this.newProject();
        if (lower === "d") return evt.preventDefault(), this.duplicateSelected();
        if (lower === "r") return evt.preventDefault(), this.solve();
        return;
      }
      if (key === "Escape") return this._clearSelection();
      if (key === "Delete" || key === "Backspace") return this.deleteSelected();
      if (key.startsWith("Arrow")) return this._nudgeSelected(evt);
      if (lower === "v") return this.setMode("select");
      if (lower === "c") return this.setMode(this.mode === "connect" ? "select" : "connect");
      if (lower === "x") return this.setMode(this.mode === "cut" ? "select" : "cut");
      if (lower === "j") return this.setMode(this.mode === "jumper" ? "select" : "jumper");
      if (lower === "m") return this.setMode(this.mode === "mount" ? "select" : "mount");
      if (lower === "r") return this.rotateSelected(evt.shiftKey ? -1 : 1);
      if (lower === "l") return this.lockSelected();
      if (lower === "g") return evt.shiftKey ? this._removeFromGroup() : this._addToGroup();
    });
    document.addEventListener("keyup", (evt) => {
      if (evt.key === " ") this._spaceDown = false;
    });
  }

  _status(msg) {
    document.title = `Stripboard Studio — ${msg}`;
    const el = document.getElementById("status");
    if (el) el.textContent = msg;
    clearTimeout(this._statusTimer);
    if (!msg) return;
    this._statusTimer = setTimeout(() => {
      const box = document.getElementById("status");
      if (box) box.textContent = "";
      document.title = "Stripboard Studio";
    }, 6000);
  }

  _solvedShown() {
    const p = this._shownProject();
    return p.jumpers.length > 0 || p.cuts.size > 0 || (p.mountingHoles?.size ?? 0) > 0;
  }

  /** Run a heavy synchronous task with a visible "busy" state painted first. */
  _runBusy(msg, fn) {
    const t0 = Date.now();
    const tick = () => this._status(`${msg} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    tick();
    this._busy = true;
    document.body.classList.add("busy");
    const timer = setInterval(tick, 250); // live elapsed-time counter
    requestAnimationFrame(() =>
      requestAnimationFrame(async () => {
        try {
          await fn();
        } finally {
          clearInterval(timer);
          this._busy = false;
          document.body.classList.remove("busy");
        }
      }),
    );
  }
}

function lettersToNum(s) {
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function starterProject() {
  // Match the toolbar defaults (A1..X55 board) so the drawn size equals the inputs.
  return new Project({ cols: 55, rows: 24, title: "shield" });
}
