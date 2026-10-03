// A basic, read-only schematic view (IEC-style symbols), derived from the same model.
// It is just another rendering: nets are wires, components are symbols. No editing here;
// edit the schematic in KiCad (Netlist export) if you need more.

import { splitPin } from "../core/model.js";

const NS = "http://www.w3.org/2000/svg";
const NET_COLORS = [
  "#e05a5a", "#5aa85a", "#5a86e0", "#e0b84a",
  "#b06ad0", "#4ac0c0", "#e0884a", "#9a9a9a",
];
const LINE = "#202020";

function el(tag, attrs = {}, parent = null) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function symbolLayout(part) {
  const pins = part.pins.map((p) => ({ id: p.id, x: p.x }));
  const dual = pins.some((p) => p.x > 0);
  if (pins.length === 2 && !dual) {
    return {
      two: true,
      body: { w: 56, h: 22 },
      left: [{ id: pins[0].id, lx: -58, ly: 0 }],
      right: [{ id: pins[1].id, lx: 58, ly: 0 }],
      box: { w: 150, h: 60 },
    };
  }
  const left = dual ? pins.filter((p) => p.x === 0) : pins;
  const right = dual ? pins.filter((p) => p.x > 0) : [];
  const rows = Math.max(left.length, right.length, 1);
  const h = rows * 18 + 16;
  const place = (list, side) =>
    list.map((p, i) => ({ id: p.id, lx: side * 62, ly: -(rows - 1) * 9 + i * 18 }));
  return {
    two: false,
    body: { w: dual ? 96 : 72, h },
    left: place(left, -1),
    right: place(right, 1),
    box: { w: (dual ? 124 : 100) + 60, h: h + 30 },
  };
}

function pack(project, library) {
  const items = [];
  for (const comp of project.components.values()) {
    const part = library.get(comp.part);
    if (!part) continue;
    const layout = symbolLayout(part);
    items.push({ comp, part, layout, all: [...layout.left, ...layout.right] });
  }
  const maxW = 820;
  const gapX = 40;
  const gapY = 44;
  let x = 40;
  let y = 40;
  let rowH = 0;
  for (const it of items) {
    const w = it.layout.box.w;
    const h = it.layout.box.h;
    if (x + w > maxW && x > 40) {
      x = 40;
      y += rowH + gapY;
      rowH = 0;
    }
    it.cx = x + w / 2;
    it.cy = y + h / 2;
    x += w + gapX;
    rowH = Math.max(rowH, h);
  }
  return { items, width: maxW + 40, height: y + rowH + 60 };
}

export function renderSchematic(svg, state) {
  const { project, library } = state;
  const focus = state.focusNets ?? new Set();
  const selected = state.selected ?? null;
  const colors = new Map(project.nets.map((n, i) => [n.id, NET_COLORS[i % NET_COLORS.length]]));

  svg.innerHTML = "";
  const { items, width, height } = pack(project, library);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  el("rect", { x: 0, y: 0, width, height, fill: "#fbfbf7" }, svg);
  el("text", { x: width / 2, y: 20, "text-anchor": "middle", "font-size": 13, fill: "#6b7280" }, svg).textContent = `${project.title} — schematic`;

  // wires first (under symbols)
  for (const net of project.nets) {
    const pts = [];
    for (const key of net.pins) {
      const { ref, pin } = splitPin(key);
      const it = items.find((i) => i.comp.ref === ref);
      const p = it && it.all.find((q) => q.id === pin);
      if (p) pts.push({ x: it.cx + p.lx, y: it.cy + p.ly });
    }
    if (pts.length < 2) continue;
    // Orthogonal trunk: one vertical line per net; each pin joins it horizontally, so
    // wires of a net do not pile on top of each other.
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const tx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2);
    const ymin = Math.min(...ys);
    const ymax = Math.max(...ys);
    const lit = focus.has(net.id);
    const stroke = colors.get(net.id);
    const width = lit ? 3 : 1.6;
    const opacity = lit ? 1 : 0.75;
    const g = el("g", { "data-net": net.id, class: "wire hoverable", cursor: "pointer" }, svg);
    if (ymax > ymin) {
      el("line", { x1: tx, y1: ymin, x2: tx, y2: ymax, stroke, "stroke-width": width, opacity }, g);
    }
    for (const p of pts) {
      el("line", { x1: p.x, y1: p.y, x2: tx, y2: p.y, stroke, "stroke-width": width, opacity }, g);
      el("circle", { cx: p.x, cy: p.y, r: 3, fill: stroke }, g);
      el("circle", { cx: p.x, cy: p.y, r: 8, fill: "transparent" }, g);
    }
    el("text", { x: tx + 5, y: ymin - 6, "font-size": 11, "font-weight": 600, fill: stroke }, g).textContent = net.label || net.id;
  }

  // symbols
  for (const it of items) {
    const { comp, part, layout } = it;
    const s = el("g", { "data-ref": comp.ref, class: "component hoverable", cursor: "pointer" }, svg);
    const bx = it.cx - layout.body.w / 2;
    const by = it.cy - layout.body.h / 2;
    el("rect", { x: bx, y: by, width: layout.body.w, height: layout.body.h, rx: 4, fill: "#ffffff", stroke: "#202020", "stroke-width": 1.6 }, s);
    // pin stubs + labels
    for (const p of it.all) {
      const side = layout.left.includes(p) ? -1 : 1;
      el("line", { x1: it.cx + (side < 0 ? bx - it.cx : bx + layout.body.w - it.cx), y1: it.cy + p.ly, x2: it.cx + p.lx, y2: it.cy + p.ly, stroke: LINE, "stroke-width": 1.4 }, s);
      el("text", { x: it.cx + p.lx + (side < 0 ? -3 : 3), y: it.cy + p.ly - 3, "text-anchor": side < 0 ? "end" : "start", "font-size": 8, fill: "#555" }, s).textContent = p.id;
    }
    drawGlyph(s, part, it.cx, it.cy, layout);
    const label = `${comp.ref}${comp.value ? ` ${comp.value}` : ""}`;
    const sel = selected === comp.ref;
    el("text", { x: it.cx, y: by - 6, "text-anchor": "middle", "font-size": 10, fill: sel ? "#2a9d5f" : "#101010", "font-weight": sel ? 700 : 400 }, s).textContent = label;
  }
}

function drawGlyph(g, part, cx, cy) {
  const kind = part.kind;
  const line = { fill: "none", stroke: LINE, "stroke-width": 1.6 };
  if (kind === "resistor") {
    el("rect", { x: cx - 20, y: cy - 9, width: 40, height: 18, ...line }, g);
  } else if (kind === "capacitor") {
    el("line", { x1: cx - 6, y1: cy - 10, x2: cx - 6, y2: cy + 10, ...line }, g);
    el("line", { x1: cx + 6, y1: cy - 10, x2: cx + 6, y2: cy + 10, ...line }, g);
  } else if (kind === "diode" || kind === "led") {
    el("polygon", { points: `${cx - 9},${cy - 9} ${cx - 9},${cy + 9} ${cx + 9},${cy}`, fill: LINE }, g);
    el("line", { x1: cx + 9, y1: cy - 9, x2: cx + 9, y2: cy + 9, ...line }, g);
    if (kind === "led") {
      el("line", { x1: cx + 8, y1: cy - 10, x2: cx + 16, y2: cy - 18, ...line }, g);
      el("line", { x1: cx + 12, y1: cy - 7, x2: cx + 20, y2: cy - 15, ...line }, g);
    }
  }
}
