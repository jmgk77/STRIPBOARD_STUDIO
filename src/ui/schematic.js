// A basic, read-only schematic view (IEC-style symbols), derived from the same model.
// Read-only: edit the schematic in KiCad via netlist export if you need more.
//
// Layout to avoid overlapping wires: all symbols sit in ONE row; each net gets its own
// horizontal routing channel (lane) below the row, so no two nets share a segment.
// Nets cross each other, but they never overlap.

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
      box: { w: 170, h: 60 },
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
    box: { w: (dual ? 124 : 100) + 66, h: h + 30 },
  };
}

// Order components so connected ones sit together (fewer long wires).
function orderComponents(comps, project) {
  const adj = new Map(comps.map((c) => [c.ref, new Set()]));
  for (const net of project.nets) {
    const refs = [...new Set([...net.pins].map((k) => splitPin(k).ref))];
    for (const a of refs) for (const b of refs) if (a !== b) adj.get(a)?.add(b);
  }
  const placed = [];
  const done = new Set();
  while (placed.length < comps.length) {
    let pick = null;
    if (placed.length === 0) {
      pick = [...comps].sort((a, b) => (adj.get(b.ref)?.size || 0) - (adj.get(a.ref)?.size || 0))[0];
    } else {
      let best = -1;
      for (const c of comps) {
        if (done.has(c.ref)) continue;
        const score = [...(adj.get(c.ref) ?? [])].filter((r) => done.has(r)).length;
        if (score > best) {
          best = score;
          pick = c;
        }
      }
      if (!pick) pick = comps.find((c) => !done.has(c.ref));
    }
    placed.push(pick);
    done.add(pick.ref);
  }
  return placed;
}

function pack(project, library) {
  const comps = [...project.components.values()].filter((c) => library.get(c.part));
  const ordered = orderComponents(comps, project);
  const margin = 40;
  const gapX = 46;
  const items = [];
  let x = margin;
  let maxH = 60;
  for (const comp of ordered) {
    const part = library.get(comp.part);
    const layout = symbolLayout(part);
    const box = layout.box;
    items.push({ comp, part, layout, all: [...layout.left, ...layout.right] });
    maxH = Math.max(maxH, box.h);
    x += box.w + gapX;
  }
  const rowWidth = x;
  const cy = margin + maxH / 2;
  x = margin;
  for (const it of items) {
    it.cx = x + it.layout.box.w / 2;
    it.cy = cy;
    x += it.layout.box.w + gapX;
  }
  const channelTop = margin + maxH + 46;
  const laneGap = 18;
  return { items, rowWidth, channelTop, laneGap, margin, maxH };
}

export function renderSchematic(svg, state) {
  const { project, library } = state;
  const focus = state.focusNets ?? new Set();
  const selected = state.selected ?? null;
  const colors = new Map(project.nets.map((n, i) => [n.id, NET_COLORS[i % NET_COLORS.length]]));

  svg.innerHTML = "";
  const { items, rowWidth, channelTop, laneGap, margin, maxH } = pack(project, library);

  // net geometry + lane order (top pins get the top lane: fewer crossings)
  const nets = project.nets.map((net) => {
    const pts = [];
    for (const key of net.pins) {
      const { ref, pin } = splitPin(key);
      const it = items.find((i) => i.comp.ref === ref);
      const p = it && it.all.find((q) => q.id === pin);
      if (p) pts.push({ x: it.cx + p.lx, y: it.cy + p.ly });
    }
    return { net, pts, avgY: pts.length ? pts.reduce((s, p) => s + p.y, 0) / pts.length : 0 };
  }).filter((n) => n.pts.length >= 2);
  nets.sort((a, b) => a.avgY - b.avgY);

  const laneOf = new Map();
  nets.forEach((n, i) => laneOf.set(n.net.id, channelTop + i * laneGap));
  const width = rowWidth + margin;
  const height = channelTop + nets.length * laneGap + margin;

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  el("rect", { x: 0, y: 0, width, height, fill: "#fbfbf7" }, svg);
  el("text", { x: width / 2, y: 20, "text-anchor": "middle", "font-size": 13, fill: "#6b7280" }, svg).textContent = `${project.title} — schematic`;

  // wires: one horizontal lane per net; each pin drops vertically onto its lane
  for (const { net, pts } of nets) {
    const laneY = laneOf.get(net.id);
    const xs = pts.map((p) => p.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const lit = focus.has(net.id);
    const stroke = colors.get(net.id);
    const width2 = lit ? 3 : 1.6;
    const opacity = lit ? 1 : 0.8;
    const g = el("g", { "data-net": net.id, class: "wire hoverable", cursor: "pointer" }, svg);
    el("line", { x1: minX, y1: laneY, x2: maxX, y2: laneY, stroke, "stroke-width": width2, opacity }, g);
    for (const p of pts) {
      el("line", { x1: p.x, y1: p.y, x2: p.x, y2: laneY, stroke, "stroke-width": width2, opacity }, g);
      el("circle", { cx: p.x, cy: laneY, r: 3.2, fill: stroke }, g); // junction at the lane
      el("circle", { cx: p.x, cy: laneY, r: 8, fill: "transparent" }, g);
    }
    el("text", { x: minX - 6, y: laneY + 4, "text-anchor": "end", "font-size": 11, "font-weight": 600, fill: stroke }, g).textContent = net.label || net.id;
  }

  // symbols
  for (const it of items) {
    const { comp, part, layout } = it;
    const s = el("g", { "data-ref": comp.ref, class: "component hoverable", cursor: "pointer" }, svg);
    const bx = it.cx - layout.body.w / 2;
    const by = it.cy - layout.body.h / 2;
    el("rect", { x: bx, y: by, width: layout.body.w, height: layout.body.h, rx: 4, fill: "#ffffff", stroke: "#202020", "stroke-width": 1.6 }, s);
    const edgeX = (p) => (layout.left.includes(p) ? bx : bx + layout.body.w);
    for (const p of it.all) {
      el("line", { x1: edgeX(p), y1: it.cy + p.ly, x2: it.cx + p.lx, y2: it.cy + p.ly, stroke: LINE, "stroke-width": 1.4 }, s);
      const side = layout.left.includes(p) ? -1 : 1;
      el("text", { x: it.cx + p.lx + (side < 0 ? -3 : 3), y: it.cy + p.ly - 3, "text-anchor": side < 0 ? "end" : "start", "font-size": 8, fill: "#555" }, s).textContent = p.id;
    }
    drawGlyph(s, part, it.cx, it.cy);
    const label = `${comp.ref}${comp.value ? ` ${comp.value}` : ""}`;
    const sel = selected === comp.ref;
    el("text", { x: it.cx, y: by - 7, "text-anchor": "middle", "font-size": 10, fill: sel ? "#2a9d5f" : "#101010", "font-weight": sel ? 700 : 400 }, s).textContent = label;
  }
  void maxH;
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
