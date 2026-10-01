// SVG rendering of the board. Pure draw: it builds the SVG DOM from a state object and
// sets data attributes for event delegation. No application state lives here.

import { componentPins, contentBounds } from "../core/geometry.js";
import { cellId } from "../core/connectivity.js";
import { splitPin } from "../core/model.js";

export const CELL = 34;
export const PAD = 44;
const HOLE_R = 3.2;
const NS = "http://www.w3.org/2000/svg";

const NET_COLORS = [
  "#e05a5a", "#5aa85a", "#5a86e0", "#e0b84a",
  "#b06ad0", "#4ac0c0", "#e0884a", "#9a9a9a",
];

function el(tag, attrs = {}, parent = null) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function runsForRow(project, y) {
  const runs = [];
  let start = null;
  for (let x = 1; x <= project.cols; x++) {
    if (!project.cuts.has(cellId(x, y))) {
      if (start === null) start = x;
    } else if (start !== null) {
      runs.push([start, x - 1]);
      start = null;
    }
  }
  if (start !== null) runs.push([start, project.cols]);
  return runs;
}

export function makeMapper(state) {
  const { project, view } = state;
  const sx = (x) => PAD + (view === "copper" ? project.cols - x : x - 1) * CELL;
  const sy = (y) => PAD + (y - 1) * CELL;
  return { sx, sy };
}

export function render(svg, state) {
  const { project, library, view, selected, pending, solved, showNames = true } = state;
  const selectedNet = state.selectedNet ?? null;
  const selectedWire = state.selectedWire ?? null;
  const L = state.layers ?? { parts: true, wires: true, cuts: true, copper: true, nets: true };
  const { sx, sy } = makeMapper(state);
  const { cols, rows } = project;
  const width = cols * CELL + PAD * 2;
  const height = rows * CELL + PAD * 2 + 48;
  svg.innerHTML = "";
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);

  el("rect", { x: PAD - CELL / 2, y: PAD - CELL / 2, width: cols * CELL, height: rows * CELL, rx: 4, fill: "#0f5132", stroke: "#062d1c", "stroke-width": 2 }, svg);

  const colors = new Map(project.nets.map((n, i) => [n.id, NET_COLORS[i % NET_COLORS.length]]));
  const pinNet = new Map(); // "x,y" -> net id (pins that belong to a net)
  for (const net of project.nets) {
    for (const key of net.pins) {
      const { ref, pin } = splitPin(key);
      const comp = project.components.get(ref);
      const part = comp && library.get(comp.part);
      if (!part) continue;
      const p = componentPins(comp, part).find((q) => q.id === pin);
      if (p) pinNet.set(cellId(p.x, p.y), net.id);
    }
  }

  // copper strips, split by cuts, tinted by the net they carry (so a same-row connection
  // is visible as copper in the net's colour -- no jumper is needed there).
  const stripOpacity = view === "copper" ? 0.95 : 0.42;
  for (let y = 1; L.copper !== false && y <= rows; y++) {
    for (const [a, b] of runsForRow(project, y)) {
      const nets = new Set();
      for (let x = a; x <= b; x++) {
        const id = pinNet.get(cellId(x, y));
        if (id) nets.add(id);
      }
      const fill = nets.size === 1 ? colors.get([...nets][0]) : "#c48a3e";
      const lit = selectedNet && nets.has(selectedNet);
      const x1 = sx(a);
      const x2 = sx(b);
      el("rect", {
        x: Math.min(x1, x2) - CELL / 2,
        y: sy(y) - CELL / 2,
        width: Math.abs(x1 - x2) + CELL,
        height: CELL,
        fill,
        opacity: lit ? 0.85 : stripOpacity,
      }, svg);
    }
  }

  // holes
  for (let y = 1; y <= rows; y++) {
    for (let x = 1; x <= cols; x++) {
      el("circle", { cx: sx(x), cy: sy(y), r: HOLE_R, fill: "#e8e8e8", stroke: "#8a8a8a", "stroke-width": 0.5 }, svg);
    }
  }

  // ratsnest (intended wiring) only while unsolved
  if (!solved && L.nets !== false) drawRatsnest(svg, state, sx, sy, colors);

  // jumpers (clickable/draggable)
  (L.wires === false ? [] : project.jumpers).forEach((j, i) => {
    const x = sx(j.x);
    const y1 = sy(j.ya);
    const y2 = sy(j.yb);
    const sel = selectedWire?.kind === "jumper" && selectedWire.i === i;
    const lit = sel || (selectedNet && j.net === selectedNet);
    const g = el("g", { "data-wire": i, class: "wire" }, svg);
    el("line", { x1: x, y1, x2: x, y2, stroke: "transparent", "stroke-width": 16 }, g);
    el("line", { x1: x, y1, x2: x, y2, stroke: lit ? "#ffd54a" : "#4c9aff", "stroke-width": sel ? 4.5 : 3, "stroke-linecap": "round" }, g);
    for (const cy of [y1, y2]) {
      el("circle", { cx: x, cy, r: 6, fill: lit ? "#ffd54a" : "#4c9aff", stroke: "#0b2b52", "stroke-width": 1.5 }, g);
    }
  });

  // components
  if (L.parts !== false) {
    for (const comp of project.components.values()) {
      const part = library.get(comp.part);
      if (!part) continue;
      drawComponent(svg, comp, part, state, sx, sy);
    }
  }

  // cuts on top (clickable/draggable)
  for (const c of L.cuts === false ? [] : project.cuts) {
    const [x, y] = c.split(",").map(Number);
    const cx = sx(x);
    const cy = sy(y);
    const r = HOLE_R + 3;
    const sel = selectedWire?.kind === "cut" && selectedWire.key === c;
    const g = el("g", { "data-cut": c, class: "cut" }, svg);
    el("rect", { x: cx - r - 5, y: cy - r - 5, width: 2 * (r + 5), height: 2 * (r + 5), fill: "transparent" }, g);
    el("line", { x1: cx - r, y1: cy - r, x2: cx + r, y2: cy + r, stroke: sel ? "#ffd54a" : "#ff5555", "stroke-width": sel ? 3.5 : 2.5, "stroke-linecap": "round" }, g);
    el("line", { x1: cx - r, y1: cy + r, x2: cx + r, y2: cy - r, stroke: sel ? "#ffd54a" : "#ff5555", "stroke-width": sel ? 3.5 : 2.5, "stroke-linecap": "round" }, g);
  }

  drawCutBorder(svg, state, sx, sy);

  if (view === "copper") {
    el("text", { x: width / 2, y: 22, "text-anchor": "middle", fill: "#ff6b6b", "font-size": 18, "font-weight": 700 }, svg).textContent = "COPPER SIDE (mirrored)";
  }
}

// A dashed outline around everything the board uses: where you can cut a virgin board.
function drawCutBorder(svg, state, sx, sy) {
  const { project, library } = state;
  const b = contentBounds(project, library);
  if (!b) return;
  const xa = sx(b.x0) - CELL / 2;
  const xb = sx(b.x1) + CELL / 2;
  const y0 = sy(b.y0) - CELL / 2;
  const y1 = sy(b.y1) + CELL / 2;
  const x = Math.min(xa, xb);
  const w = Math.abs(xb - xa);
  el("rect", {
    x, y: y0, width: w, height: y1 - y0, rx: 4, fill: "none",
    stroke: "#ffd54a", "stroke-width": 2, "stroke-dasharray": "9 5",
  }, svg);
  const cols = b.x1 - b.x0 + 1;
  const rows = b.y1 - b.y0 + 1;
  el("text", {
    x: x + w / 2, y: y0 - 7, "text-anchor": "middle", fill: "#ffd54a", "font-size": 11, "font-weight": 600,
  }, svg).textContent = `cut board: ${cols} x ${rows} holes`;
}

function drawRatsnest(svg, state, sx, sy, colors) {
  const { project, library } = state;
  const selectedNet = state.selectedNet ?? null;
  for (const net of project.nets) {
    const sel = net.id === selectedNet;
    const dim = selectedNet != null && !sel;
    const pts = [];
    for (const key of net.pins) {
      const { ref, pin } = splitPin(key);
      const comp = project.components.get(ref);
      const part = comp && library.get(comp.part);
      if (!part) continue;
      const p = componentPins(comp, part).find((q) => q.id === pin);
      if (p) pts.push({ x: sx(p.x), y: sy(p.y) });
    }
    if (pts.length < 2) continue;
    for (let i = 1; i < pts.length; i++) {
      el("line", {
        x1: pts[0].x, y1: pts[0].y, x2: pts[i].x, y2: pts[i].y,
        stroke: colors.get(net.id),
        "stroke-width": sel ? 3.6 : 1.6,
        "stroke-dasharray": sel ? "9 5" : "5 4",
        opacity: sel ? 1 : dim ? 0.16 : 0.7,
      }, svg);
    }
  }
}

function drawComponent(svg, comp, part, state, sx, sy) {
  const { project, selected, pending } = state;
  const pts = componentPins(comp, part).map((p) => ({ id: p.id, X: sx(p.x), Y: sy(p.y), cx: p.x, cy: p.y }));
  const xs = pts.map((p) => p.X);
  const ys = pts.map((p) => p.Y);
  const bx0 = Math.min(...xs) - CELL * 0.45;
  const bx1 = Math.max(...xs) + CELL * 0.45;
  const by0 = Math.min(...ys) - CELL * 0.45;
  const by1 = Math.max(...ys) + CELL * 0.45;

  const g = el("g", { "data-ref": comp.ref, class: "component" }, svg);
  el("rect", {
    x: bx0, y: by0, width: bx1 - bx0, height: by1 - by0, rx: 5,
    fill: "#f0efe9", "fill-opacity": 0.5,
    stroke: comp.locked ? "#b03ca0" : (selected === comp.ref ? "#ffcc33" : "#202020"),
    "stroke-width": selected === comp.ref ? 2.5 : 1.6,
  }, g);

  drawGlyph(g, part, pts);

  // pins
  for (const p of pts) {
    const isPending = pending && pending === `${comp.ref}.${p.id}`;
    el("circle", {
      "data-ref": comp.ref, "data-pin": p.id,
      cx: p.X, cy: p.Y, r: isPending ? 6 : 4.5,
      fill: "#202020",
      stroke: isPending ? "#ffaa00" : "#202020", "stroke-width": isPending ? 2.5 : 1,
    }, g);
  }

  // named pins (the whole point of naming them is to read them off the board)
  if (state.showNames !== false && comp.pinNames) {
    for (const p of pts) {
      const name = comp.pinNames[p.id];
      if (name) el("text", { x: p.X + 7, y: p.Y - 5, "font-size": 8, fill: "#123" }, g).textContent = name;
    }
  }

  // label
  const label = `${comp.ref}${comp.value ? ` ${comp.value}` : ""}${comp.locked ? " *" : ""}`;
  el("text", { x: (bx0 + bx1) / 2, y: by0 - 4, "text-anchor": "middle", "font-size": 10, fill: "#101010" }, g).textContent = label;
}

function drawGlyph(g, part, pts) {
  const stroke = { stroke: "#202020", "stroke-width": 1.6, fill: "none" };
  const kind = part.kind;
  if (kind === "resistor" && pts.length >= 2) {
    // Draw along the axis between the two pins, so it works vertically AND horizontally.
    const [a, b] = pts;
    const dx = b.X - a.X;
    const dy = b.Y - a.Y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    const x0 = a.X + ux * len * 0.3;
    const y0 = a.Y + uy * len * 0.3;
    const x1 = a.X + ux * len * 0.7;
    const y1 = a.Y + uy * len * 0.7;
    const n = 6;
    const amp = 5;
    let d = `M ${a.X} ${a.Y} L ${x0} ${y0}`;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const cx = x0 + (x1 - x0) * t;
      const cy = y0 + (y1 - y0) * t;
      const off = i % 2 === 0 ? amp : -amp;
      d += ` L ${cx + px * off} ${cy + py * off}`;
    }
    d += ` L ${x1} ${y1} L ${b.X} ${b.Y}`;
    el("path", { d, ...stroke }, g);
    return;
  }
  if (kind === "capacitor" && pts.length >= 2) {
    const [a, b] = pts;
    const dx = b.X - a.X;
    const dy = b.Y - a.Y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    const mx = (a.X + b.X) / 2;
    const my = (a.Y + b.Y) / 2;
    const gap = 4;
    const half = 8;
    const seg = (x1, y1, x2, y2) => el("line", { x1, y1, x2, y2, ...stroke }, g);
    seg(a.X, a.Y, mx - ux * gap, my - uy * gap);
    seg(mx + ux * gap, my + uy * gap, b.X, b.Y);
    seg(mx - ux * gap - px * half, my - uy * gap - py * half, mx - ux * gap + px * half, my - uy * gap + py * half);
    seg(mx + ux * gap - px * half, my + uy * gap - py * half, mx + ux * gap + px * half, my + uy * gap + py * half);
    return;
  }
  if ((kind === "led" || kind === "diode") && pts.length >= 2) {
    const a = pts.find((p) => p.id === "A");
    const k = pts.find((p) => p.id === "K");
    if (a && k) {
      const midX = (a.X + k.X) / 2;
      const midY = (a.Y + k.Y) / 2;
      const size = 9;
      const my = midY - size;
      const py = midY + size;
      el("path", { d: `M ${midX - 7} ${my} L ${midX + 7} ${my} L ${midX} ${py} Z`, fill: "#202020" }, g);
      el("line", { x1: midX - 7, y1: py, x2: midX + 7, y2: py, ...stroke }, g);
      if (kind === "led") {
        el("line", { x1: midX + 8, y1: midY - 4, x2: midX + 14, y2: midY - 10, ...stroke }, g);
        el("line", { x1: midX + 11, y1: midY - 2, x2: midX + 17, y2: midY - 8, ...stroke }, g);
      }
      return;
    }
  }
  if (kind === "transistor" && pts.length === 3) {
    const [e, b, c] = pts;
    const cx = (e.X + c.X) / 2;
    const cy = (e.Y + c.Y) / 2;
    el("circle", { cx, cy, r: 11, ...stroke }, g);
    el("line", { x1: e.X, y1: e.Y, x2: cx, y2: cy, ...stroke }, g);
    el("line", { x1: c.X, y1: c.Y, x2: cx, y2: cy, ...stroke }, g);
    el("line", { x1: b.X, y1: b.Y, x2: cx, y2: cy, ...stroke }, g);
    return;
  }
  if (kind === "dip" || kind === "module") {
    const p1 = pts.find((p) => p.id === "1" || p.id === "L1");
    if (p1) el("circle", { cx: p1.X, cy: p1.Y, r: 3, fill: "#202020" }, g);
  }
}
