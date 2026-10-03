// A basic, read-only schematic view (IEC-style symbols), derived from the same model.
// Read-only: edit the schematic in KiCad via netlist export if you need more.
//
// Wires are NOT drawn (they overlapped). Each pin carries a net LABEL (its name, or a
// number when unnamed), like real schematics use net labels. Same label = same net.

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
      box: { w: 200, h: 70 },
    };
  }
  const left = dual ? pins.filter((p) => p.x === 0) : pins;
  const right = dual ? pins.filter((p) => p.x > 0) : [];
  const rows = Math.max(left.length, right.length, 1);
  const h = rows * 18 + 16;
  const place = (list, side) =>
    list.map((p, i) => ({ id: p.id, lx: side * 66, ly: -(rows - 1) * 9 + i * 18 }));
  return {
    two: false,
    body: { w: dual ? 96 : 72, h },
    left: place(left, -1),
    right: place(right, 1),
    box: { w: (dual ? 124 : 100) + 110, h: h + 40 },
  };
}

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
  const items = ordered.map((comp) => {
    const part = library.get(comp.part);
    const layout = symbolLayout(part);
    return { comp, part, layout, all: [...layout.left, ...layout.right] };
  });
  const maxW = 900;
  const gapX = 46;
  const gapY = 46;
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
  const netNumber = new Map(project.nets.map((n, i) => [n.id, String(i + 1)]));
  const labelOf = (net) => (net.label ? net.label : netNumber.get(net.id));

  svg.innerHTML = "";
  const { items, width, height } = pack(project, library);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  el("rect", { x: 0, y: 0, width, height, fill: "#fbfbf7" }, svg);
  el("text", { x: width / 2, y: 20, "text-anchor": "middle", "font-size": 13, fill: "#6b7280" }, svg).textContent = `${project.title} — schematic`;

  // placed pins per net (and which nets are simple = exactly two pins -> draw a wire)
  const netPins = new Map();
  for (const it of items) {
    for (const p of it.all) {
      const net = project.netOf(`${it.comp.ref}.${p.id}`);
      if (!net) continue;
      const list = netPins.get(net.id) ?? [];
      list.push({ x: it.cx + p.lx, y: it.cy + p.ly });
      netPins.set(net.id, list);
    }
  }
  const isWireNet = (id) => (netPins.get(id)?.length ?? 0) === 2;

  for (const it of items) {
    const { comp, part, layout } = it;
    const s = el("g", { "data-ref": comp.ref, class: "component hoverable", cursor: "pointer" }, svg);
    const bx = it.cx - layout.body.w / 2;
    const by = it.cy - layout.body.h / 2;
    el("rect", { x: bx, y: by, width: layout.body.w, height: layout.body.h, rx: 4, fill: "#ffffff", stroke: "#202020", "stroke-width": 1.6 }, s);

    for (const p of it.all) {
      const side = layout.left.includes(p) ? -1 : 1;
      const edgeX = side < 0 ? bx : bx + layout.body.w;
      const px = it.cx + p.lx;
      const py = it.cy + p.ly;
      el("line", { x1: edgeX, y1: py, x2: px, y2: py, stroke: LINE, "stroke-width": 1.4 }, s);
      el("circle", { cx: px, cy: py, r: 2.6, fill: LINE }, s);
      const net = project.netOf(`${comp.ref}.${p.id}`);
      if (net && !isWireNet(net.id)) {
        // complex net: a label (name or number) instead of a wire
        const lit = focus.has(net.id);
        const col = colors.get(net.id);
        const g = el("g", { "data-net": net.id, class: "wire hoverable", cursor: "pointer" }, s);
        el("line", { x1: px, y1: py, x2: px + side * 14, y2: py, stroke: col, "stroke-width": lit ? 3 : 1.6 }, g);
        el("text", {
          x: px + side * 18, y: py + 3, "text-anchor": side < 0 ? "end" : "start",
          "font-size": 10, "font-weight": lit ? 700 : 600, fill: col,
        }, g).textContent = labelOf(net);
      } else if (!net) {
        el("text", { x: px + side * 6, y: py - 3, "text-anchor": side < 0 ? "end" : "start", "font-size": 8, fill: "#999" }, s).textContent = p.id;
      }
    }
    drawGlyph(s, part, it.cx, it.cy);
    const label = `${comp.ref}${comp.value ? ` ${comp.value}` : ""}`;
    const sel = selected === comp.ref;
    el("text", { x: it.cx, y: by - 7, "text-anchor": "middle", "font-size": 10, fill: sel ? "#2a9d5f" : "#101010", "font-weight": sel ? 700 : 400 }, s).textContent = label;
  }

  // simple (2-pin) nets: an orthogonal wire, drawn on top
  for (const net of project.nets) {
    const pts = netPins.get(net.id);
    if (!pts || pts.length !== 2) continue;
    const [a, b] = pts;
    const lit = focus.has(net.id);
    const col = colors.get(net.id);
    const g = el("g", { "data-net": net.id, class: "wire hoverable", cursor: "pointer" }, svg);
    el("path", { d: `M ${a.x} ${a.y} L ${b.x} ${a.y} L ${b.x} ${b.y}`, fill: "none", stroke: col, "stroke-width": lit ? 3 : 1.8 }, g);
    for (const p of [a, b]) {
      el("circle", { cx: p.x, cy: p.y, r: 3.2, fill: col }, g);
      el("circle", { cx: p.x, cy: p.y, r: 8, fill: "transparent" }, g);
    }
    el("text", { x: (a.x + b.x) / 2 + 6, y: a.y - 4, "font-size": 10, "font-weight": 600, fill: col }, g).textContent = labelOf(net);
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
