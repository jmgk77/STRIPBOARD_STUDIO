// SVG rendering of the board. Pure draw: it builds the SVG DOM from a state object and
// sets data attributes for event delegation. No application state lives here.

import { componentPins, componentBody, contentBounds, rowLabel, rowLetter } from "../core/geometry.js";
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
  const focusNets = state.focusNets ?? new Set();
  const selectedWire = state.selectedWire ?? null;
  const jumperStart = state.jumperStart ?? null; // first hole of a hand-drawn jumper
  const origin = state.origin ?? { row: 1, col: 1 }; // printed label origin (default A1)
  const colText = (x) => String(origin.col + x - 1);
  const rowText = (y) => rowLetter(origin.row + rows - y);
  const mono = state.mono === true; // greyscale/BW, for printing without a colour printer
  const C = {
    boardBg: mono ? "#ffffff" : "#0f5132",
    boardEdge: mono ? "#000000" : "#062d1c",
    strip: mono ? "#d9d9d9" : "#c48a3e",
    stripEdge: mono ? "#7a7a7a" : "#c48a3e",
    hole: mono ? "#ffffff" : "#e8e8e8",
    holeEdge: mono ? "#8a8a8a" : "#8a8a8a",
    grid: mono ? "#c0c0c0" : "#ffffff",
    cut: mono ? "#000000" : "#ff5555",
    jumper: mono ? "#000000" : "#4c9aff",
    jumperDark: mono ? "#000000" : "#0b2b52",
    comp: mono ? "#ffffff" : "#f0efe9",
    compEdge: mono ? "#000000" : "#202020",
    locked: mono ? "#555555" : "#b03ca0",
    sel: mono ? "#000000" : "#ffcc33",
    text: mono ? "#000000" : "#101010",
    axis: mono ? "#000000" : "#9aa2ac",
    border: mono ? "#000000" : "#ffd54a",
    banner: mono ? "#000000" : "#ff6b6b",
    pin: mono ? "#000000" : "#202020",
  };
  const L = state.layers ?? { parts: true, wires: true, cuts: true, copper: true, nets: true, grid: true };
  const { sx, sy } = makeMapper(state);
  const { cols, rows } = project;
  const width = cols * CELL + PAD * 2;
  const height = rows * CELL + PAD * 2 + 48;
  svg.innerHTML = "";
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);

  el("rect", { x: PAD - CELL / 2, y: PAD - CELL / 2, width: cols * CELL, height: rows * CELL, rx: 4, fill: C.boardBg, stroke: C.boardEdge, "stroke-width": 2 }, svg);

  const colors = new Map(project.nets.map((n, i) => [n.id, NET_COLORS[i % NET_COLORS.length]]));
  const netById = new Map(project.nets.map((n) => [n.id, n]));
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
      const fill = mono ? C.strip : nets.size === 1 ? colors.get([...nets][0]) : "#c48a3e";
      const lit = [...nets].some((id) => focusNets.has(id));
      const x1 = sx(a);
      const x2 = sx(b);
      // a run carrying exactly one net is clickable: it selects that net (U1)
      const clickableNet = nets.size === 1 && L.nets !== false && !mono;
      el("rect", {
        x: Math.min(x1, x2) - CELL / 2,
        y: sy(y) - CELL / 2,
        width: Math.abs(x1 - x2) + CELL,
        height: CELL,
        fill,
        stroke: mono ? C.stripEdge : "none",
        "stroke-width": mono ? 0.6 : 0,
        opacity: mono ? 1 : lit ? 0.85 : stripOpacity,
        ...(clickableNet ? { "data-net": [...nets][0], cursor: "pointer" } : {}),
      }, svg);
      // name the net on its strip (only when it has a friendly name, or is selected)
      if (nets.size === 1 && b - a >= 1) {
        const id = [...nets][0];
        const net = netById.get(id);
        const text = net?.label || (focusNets.has(id) ? net?.id : null);
        if (text) {
          el("text", {
            x: (x1 + x2) / 2, y: sy(y) + 3, "text-anchor": "middle", "font-size": 9,
            fill: C.text, "pointer-events": "none",
          }, svg).textContent = text;
        }
      }
    }
  }

  // a faint 5x5-hole grid to help measure and cut by hand
  if (L.grid !== false) {
    const edge = PAD - CELL / 2;
    const size = { w: cols * CELL, h: rows * CELL };
    for (let k = 5; k < cols; k += 5) {
      el("line", { x1: edge + k * CELL, y1: edge, x2: edge + k * CELL, y2: edge + size.h, stroke: C.grid, "stroke-opacity": mono ? 0.9 : 0.2, "stroke-width": 1, "stroke-dasharray": "3 5" }, svg);
    }
    for (let k = 5; k < rows; k += 5) {
      el("line", { x1: edge, y1: edge + k * CELL, x2: edge + size.w, y2: edge + k * CELL, stroke: C.grid, "stroke-opacity": mono ? 0.9 : 0.2, "stroke-width": 1, "stroke-dasharray": "3 5" }, svg);
    }
  }

  // holes
  for (let y = 1; y <= rows; y++) {
    for (let x = 1; x <= cols; x++) {
      el("circle", { cx: sx(x), cy: sy(y), r: HOLE_R, fill: C.hole, stroke: C.holeEdge, "stroke-width": 0.5 }, svg);
    }
  }

  // ratsnest (intended wiring): shown while unsolved, or always when the user asks for it
  if ((!solved || state.connections === true) && L.nets !== false) drawRatsnest(svg, state, sx, sy, colors);

  // jumpers (clickable/draggable)
  (L.wires === false ? [] : project.jumpers).forEach((j, i) => {
    const x = sx(j.x);
    const y1 = sy(j.ya);
    const y2 = sy(j.yb);
    const sel = selectedWire?.kind === "jumper" && selectedWire.i === i;
    const lit = sel || focusNets.has(j.net);
    const g = el("g", { "data-wire": i, class: "wire hoverable", cursor: "pointer" }, svg);
    el("line", { x1: x, y1, x2: x, y2, stroke: "transparent", "stroke-width": 16 }, g);
    if (j.fixed && !mono) el("line", { x1: x, y1, x2: x, y2, stroke: "#ffffff", "stroke-width": 6, "stroke-linecap": "round", opacity: 0.9 }, g);
    el("line", { x1: x, y1, x2: x, y2, stroke: lit ? C.sel : C.jumper, "stroke-width": sel || (mono && j.fixed) ? 4.5 : 3, "stroke-linecap": "round" }, g);
    for (const cy of [y1, y2]) {
      el("circle", { cx: x, cy, r: 6, fill: lit ? C.sel : C.jumper, stroke: C.jumperDark, "stroke-width": 1.5 }, g);
    }
    const net = netById.get(j.net);
    const text = net?.label || (focusNets.has(j.net) ? net?.id : null);
    if (text) el("text", { x: x + 8, y: (y1 + y2) / 2 + 3, "font-size": 9, fill: C.text, "pointer-events": "none" }, g).textContent = text;
  });

  // the first hole of a jumper being drawn by hand
  if (jumperStart) {
    el("circle", { cx: sx(jumperStart.x), cy: sy(jumperStart.y), r: 9, fill: "none", stroke: C.sel, "stroke-width": 3, "pointer-events": "none" }, svg);
    el("circle", { cx: sx(jumperStart.x), cy: sy(jumperStart.y), r: 4.5, fill: C.sel, "pointer-events": "none" }, svg);
  }

  // components
  if (L.parts !== false) {
    for (const comp of project.components.values()) {
      const part = library.get(comp.part);
      if (!part) continue;
      drawComponent(svg, comp, part, state, sx, sy, colors);
    }
  }

  // cuts on top (clickable/draggable)
  for (const c of L.cuts === false ? [] : project.cuts) {
    const [x, y] = c.split(",").map(Number);
    const cx = sx(x);
    const cy = sy(y);
    const r = HOLE_R + 3;
    const sel = selectedWire?.kind === "cut" && selectedWire.key === c;
    const g = el("g", { "data-cut": c, class: "cut hoverable", cursor: "pointer" }, svg);
    el("rect", { x: cx - r - 5, y: cy - r - 5, width: 2 * (r + 5), height: 2 * (r + 5), fill: "transparent" }, g);
    if (project.fixedCuts?.has(c) && !mono) el("circle", { cx, cy, r: r + 3, fill: "#ffffff", opacity: 0.9 }, g);
    el("line", { x1: cx - r, y1: cy - r, x2: cx + r, y2: cy + r, stroke: sel ? C.sel : C.cut, "stroke-width": sel || (mono && project.fixedCuts?.has(c)) ? 3.5 : 2.5, "stroke-linecap": "round" }, g);
    el("line", { x1: cx - r, y1: cy + r, x2: cx + r, y2: cy - r, stroke: sel ? C.sel : C.cut, "stroke-width": sel || (mono && project.fixedCuts?.has(c)) ? 3.5 : 2.5, "stroke-linecap": "round" }, g);
  }

  // mounting holes, on top so they are reliably clickable (a screw goes here; no copper)
  const mountR = ((project.mountDiameter ?? 3.2) / 2 / 2.54) * CELL;
  for (const c of project.mountingHoles ?? []) {
    const [x, y] = c.split(",").map(Number);
    const cx = sx(x);
    const cy = sy(y);
    const sel = selectedWire?.kind === "mount" && selectedWire.key === c;
    const g = el("g", { "data-mount": c, class: "mount hoverable", cursor: "pointer" }, svg);
    el("circle", { cx, cy, r: mountR + 4, fill: "transparent", "pointer-events": "all" }, g); // hit target
    el("circle", { cx, cy, r: mountR, fill: C.hole, stroke: sel ? C.sel : C.cut, "stroke-width": sel ? 3.5 : 2.5, "pointer-events": "none" }, g);
    const k = mountR * 0.72;
    el("line", { x1: cx - k, y1: cy, x2: cx + k, y2: cy, stroke: sel ? C.sel : C.cut, "stroke-width": 2, "pointer-events": "none" }, g);
    el("line", { x1: cx, y1: cy - k, x2: cx, y2: cy + k, stroke: sel ? C.sel : C.cut, "stroke-width": 2, "pointer-events": "none" }, g);
  }

  // axis labels: columns numbered along the top, rows lettered down the left (A at bottom)
  for (let x = 1; x <= cols; x++) {
    el("text", { x: sx(x), y: PAD - CELL / 2 - 7, "text-anchor": "middle", "font-size": 9, fill: C.axis, "pointer-events": "none" }, svg).textContent = colText(x);
  }
  // On the copper side the board is flipped, so the row letters move to the right edge.
  const lettersRight = view === "copper";
  const lettersX = lettersRight ? PAD - CELL / 2 + cols * CELL + 8 : PAD - CELL / 2 - 8;
  for (let y = 1; y <= rows; y++) {
    el("text", { x: lettersX, y: sy(y) + 3, "text-anchor": lettersRight ? "start" : "end", "font-size": 9, fill: C.axis, "pointer-events": "none" }, svg).textContent = rowText(y);
  }

  drawCutBorder(svg, state, sx, sy);

  // resize handles on the right and bottom edges (component side only)
  if (view !== "copper" && !mono) {
    const edge = PAD - CELL / 2;
    el("rect", { "data-handle": "right", x: edge + cols * CELL, y: edge, width: 12, height: rows * CELL, rx: 3, fill: "#4c9aff", "fill-opacity": 0.35, stroke: "#4c9aff", cursor: "ew-resize" }, svg);
    el("rect", { "data-handle": "bottom", x: edge, y: edge + rows * CELL, width: cols * CELL, height: 12, rx: 3, fill: "#4c9aff", "fill-opacity": 0.35, stroke: "#4c9aff", cursor: "ns-resize" }, svg);
  }

  if (view === "copper") {
    el("text", { x: width / 2, y: 22, "text-anchor": "middle", fill: C.banner, "font-size": 18, "font-weight": 700 }, svg).textContent = "COPPER SIDE (mirrored)";
  }
}

// A dashed outline around everything the board uses: where you can cut a virgin board.
function drawCutBorder(svg, state, sx, sy) {
  const { project, library } = state;
  const mono = state.mono === true;
  const b = contentBounds(project, library);
  if (!b) return;
  // Pad in screen space: sx() is mirrored on the copper side, so expand min/max, not x0/x1.
  const c0 = sx(b.x0);
  const c1 = sx(b.x1);
  const x = Math.min(c0, c1) - CELL / 2;
  const w = Math.abs(c0 - c1) + CELL;
  const y0 = sy(b.y0) - CELL / 2;
  const y1 = sy(b.y1) + CELL / 2;
  el("rect", {
    x, y: y0, width: w, height: y1 - y0, rx: 4, fill: "none",
    stroke: mono ? "#000000" : "#ffd54a", "stroke-width": 2, "stroke-dasharray": "9 5",
  }, svg);
  const cols = b.x1 - b.x0 + 1;
  const rows = b.y1 - b.y0 + 1;
  el("text", {
    x: x + w / 2, y: y0 - 20, "text-anchor": "middle", fill: mono ? "#000000" : "#ffd54a", "font-size": 11, "font-weight": 600,
  }, svg).textContent = `cut board: ${cols} x ${rows} holes`;
}

function drawRatsnest(svg, state, sx, sy, colors) {
  const { project, library } = state;
  const focusNets = state.focusNets ?? new Set();
  for (const net of project.nets) {
    const sel = focusNets.has(net.id);
    const dim = focusNets.size > 0 && !sel;
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
        "data-net": net.id, cursor: "pointer", // click a rat line to select the net (U1)
      }, svg);
    }
    if (sel) {
      el("text", {
        x: pts[0].x + 8, y: pts[0].y - 8, fill: colors.get(net.id),
        "font-size": 11, "font-weight": 700, stroke: "#fff", "stroke-width": 2.5, "paint-order": "stroke",
      }, svg).textContent = net.label || net.id;
    }
  }
}

function drawComponent(svg, comp, part, state, sx, sy, colors) {
  const { project, selected, pending } = state;
  const focusNets = state.focusNets ?? new Set();
  const mono = state.mono === true;
  const compFill = mono ? "#ffffff" : "#f0efe9";
  const compEdge = mono ? "#000000" : "#202020";
  const lockedEdge = mono ? "#555555" : "#b03ca0";
  const selEdge = mono ? "#000000" : "#ffcc33";
  const wiredEdge = mono ? "#000000" : "#2a9d5f";
  const textColor = mono ? "#000000" : "#101010";
  const pinColor = mono ? "#000000" : "#202020";
  const isSel = selected === comp.ref;
  const wired = part.pins.some((p) => project.netOf(`${comp.ref}.${p.id}`));
  const pts = componentPins(comp, part).map((p) => ({ id: p.id, X: sx(p.x), Y: sy(p.y), cx: p.x, cy: p.y }));
  const body = componentBody(comp, part);
  let bx0;
  let bx1;
  let by0;
  let by1;
  if (body) {
    // Physical body: map both edges to the screen, then pad outward by half a hole. The pad
    // must come AFTER min/max, otherwise the mirrored (copper) view collapses the box.
    const c0 = sx(body.x0);
    const c1 = sx(body.x1);
    const r0 = sy(body.y0);
    const r1 = sy(body.y1);
    bx0 = Math.min(c0, c1) - CELL / 2;
    bx1 = Math.max(c0, c1) + CELL / 2;
    by0 = Math.min(r0, r1) - CELL / 2;
    by1 = Math.max(r0, r1) + CELL / 2;
  } else {
    const xs = pts.map((p) => p.X);
    const ys = pts.map((p) => p.Y);
    bx0 = Math.min(...xs) - CELL * 0.45;
    bx1 = Math.max(...xs) + CELL * 0.45;
    by0 = Math.min(...ys) - CELL * 0.45;
    by1 = Math.max(...ys) + CELL * 0.45;
  }

  // In the copper view, components are a faint ghost so the copper/jumpers stay readable
  // while you can still see where each part sits (and still click it).
  const ghost = state.view === "copper" && !mono;
  const g = el("g", { "data-ref": comp.ref, class: "component hoverable", cursor: "pointer", ...(ghost ? { opacity: "0.38" } : {}) }, svg);
  el("rect", {
    x: bx0, y: by0, width: bx1 - bx0, height: by1 - by0, rx: 5,
    fill: isSel && wired && !mono ? "#cfe9cf" : compFill, "fill-opacity": mono ? 1 : 0.5,
    stroke: comp.locked ? lockedEdge : isSel ? (wired ? wiredEdge : selEdge) : compEdge,
    "stroke-width": isSel ? 2.5 : 1.6,
  }, g);

  drawGlyph(g, part, pts, mono);

  // pins: visible dot (no events). A pin lights up when its net is selected, or when the
  // part is selected (colour = its net).
  for (const p of pts) {
    const isPending = pending && pending === `${comp.ref}.${p.id}`;
    const net = project.netOf(`${comp.ref}.${p.id}`);
    const inSelNet = net && focusNets.has(net.id);
    const lit = isPending || inSelNet || (isSel && net);
    el("circle", {
      cx: p.X, cy: p.Y, r: isPending ? 6.5 : lit ? 6 : 4.5,
      fill: isPending ? "#ffcc33" : lit && net && !mono ? colors.get(net.id) || pinColor : pinColor,
      stroke: isPending ? "#ffaa00" : inSelNet ? "#ffffff" : pinColor,
      "stroke-width": inSelNet || isPending ? 2.5 : 1,
      "pointer-events": "none",
    }, g);
  }

  // named pins (the whole point of naming them is to read them off the board)
  if (state.showNames !== false && comp.pinNames) {
    for (const p of pts) {
      const name = comp.pinNames[p.id];
      if (name) el("text", { x: p.X + 7, y: p.Y - 5, "font-size": 8, fill: textColor }, g).textContent = name;
    }
  }

  // label
  const label = `${comp.ref}${comp.value ? ` ${comp.value}` : ""}${comp.locked ? " *" : ""}`;
  el("text", { x: (bx0 + bx1) / 2, y: by0 - 4, "text-anchor": "middle", "font-size": 10, fill: textColor, "pointer-events": "none" }, g).textContent = label;

  // ... and a big invisible hit target on top, so pins are easy to click (and highlight)
  for (const p of pts) {
    el("circle", { "data-ref": comp.ref, "data-pin": p.id, cx: p.X, cy: p.Y, r: 11, fill: "transparent", cursor: "pointer" }, g);
  }

  // when a bendable part is selected, mark the movable lead so Shift+Alt drag is discoverable
  if (isSel && part.bendable) {
    const far = pts.find((p) => p.id === part.pins[1]?.id) ?? pts[1];
    if (far) {
      const vertical = (comp.rot || 0) % 180 === 0;
      el("rect", {
        x: far.X - 8, y: far.Y - 8, width: 16, height: 16, rx: 3, fill: "none",
        stroke: wiredEdge, "stroke-width": 2.5, "stroke-dasharray": "4 3",
        cursor: vertical ? "ns-resize" : "ew-resize", "pointer-events": "none",
      }, g);
    }
  }
}

function drawGlyph(g, part, pts, mono = false) {
  const base = mono ? "#000000" : "#202020";
  const stroke = { stroke: base, "stroke-width": 1.6, fill: "none" };
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
      el("path", { d: `M ${midX - 7} ${my} L ${midX + 7} ${my} L ${midX} ${py} Z`, fill: base }, g);
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
  if (kind === "terminal") {
    for (const p of pts) {
      el("circle", { cx: p.X, cy: p.Y, r: 29, fill: mono ? "#ffffff" : "#d9d7cb", stroke: base, "stroke-width": 2.2 }, g);
      el("circle", { cx: p.X, cy: p.Y, r: 17, fill: "none", stroke: mono ? "#888888" : "#8a8a80", "stroke-width": 1.6 }, g);
      el("line", { x1: p.X - 12, y1: p.Y - 12, x2: p.X + 12, y2: p.Y + 12, stroke: base, "stroke-width": 4 }, g);
    }
    return;
  }
  if (kind === "dip" || kind === "module") {
    const p1 = pts.find((p) => p.id === "1" || p.id === "L1");
    if (p1) el("circle", { cx: p1.X, cy: p1.Y, r: 3, fill: base }, g);
  }
}
