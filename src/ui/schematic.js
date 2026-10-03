// A basic, read-only schematic view (IEC-style symbols), derived from the same model.
// Read-only: edit the schematic in KiCad via netlist export if you need more.
//
// Wiring: a 2-pin net is routed as an orthogonal wire A -> (channel, Ay) -> (channel, By)
// -> B with its own vertical channel and its own horizontal lanes, so segments never
// overlap and never cross a component body; the channel must leave each pin outward.
// Anything that cannot be routed that way is shown with net labels (name or number).
//
// `planSchematic` is pure (no DOM) so it can be unit-tested; `renderSchematic` draws it.

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
      box: { w: 200, h: 76 },
    };
  }
  const left = dual ? pins.filter((p) => p.x === 0) : pins;
  const right = dual ? pins.filter((p) => p.x > 0) : [];
  const rows = Math.max(left.length, right.length, 1);
  const h = rows * 18 + 16;
  const place = (list, side) =>
    list.map((p, i) => ({ id: p.id, lx: side * 70, ly: -(rows - 1) * 9 + i * 18 }));
  return {
    two: false,
    body: { w: dual ? 96 : 72, h },
    left: place(left, -1),
    right: place(right, 1),
    box: { w: (dual ? 124 : 100) + 150, h: h + 48 },
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
    return { comp, part, layout, left: layout.left.slice(), right: layout.right.slice(), all: [] };
  });
  const maxW = 980;
  const gapX = 50;
  const gapY = 52;
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
  // 2-pin parts orient their connected pin toward the other end (so wires can go straight)
  for (const it of items) {
    if (!it.layout.two) continue;
    const [pinA, pinB] = [it.layout.left[0].id, it.layout.right[0].id];
    let normal = 0;
    let flip = 0;
    for (const net of project.nets) {
      if (net.pins.size !== 2) continue;
      const keys = [...net.pins];
      const mine = keys.find((k) => splitPin(k).ref === it.comp.ref);
      if (!mine) continue;
      const other = items.find((i) => i.comp.ref === splitPin(keys.find((k) => k !== mine)).ref);
      if (!other) continue;
      const want = other.cx > it.cx ? "right" : "left";
      const pid = splitPin(mine).pin;
      if ((pid === pinA ? "left" : "right") === want) normal += 1;
      if ((pid === pinA ? "right" : "left") === want) flip += 1;
    }
    if (flip > normal) {
      it.left = it.layout.right.map((p) => ({ ...p, lx: -p.lx }));
      it.right = it.layout.left.map((p) => ({ ...p, lx: -p.lx }));
    }
    it.all = [...it.left, ...it.right];
  }
  for (const it of items) if (it.all.length === 0) it.all = [...it.left, ...it.right];
  return { items, width: maxW + 40, height: y + rowH + 64 };
}

function bodyRect(it) {
  return {
    x0: it.cx - it.layout.body.w / 2,
    y0: it.cy - it.layout.body.h / 2,
    x1: it.cx + it.layout.body.w / 2,
    y1: it.cy + it.layout.body.h / 2,
  };
}

function channelCandidates(ax, sA, bx, sB) {
  let lower = -Infinity;
  let upper = Infinity;
  if (sA > 0) lower = Math.max(lower, ax + 12);
  else upper = Math.min(upper, ax - 12);
  if (sB > 0) lower = Math.max(lower, bx + 12);
  else upper = Math.min(upper, bx - 12);
  if (lower > upper) return [];
  const out = [];
  if (Number.isFinite(lower) && Number.isFinite(upper)) {
    const span = upper - lower;
    out.push(Math.round(lower + span / 2), Math.round(lower + span * 0.25), Math.round(lower + span * 0.75));
  } else if (Number.isFinite(lower)) {
    out.push(Math.round(lower + 10), Math.round(lower + 34), Math.round(lower + 70), Math.round(lower + 120));
  } else if (Number.isFinite(upper)) {
    out.push(Math.round(upper - 10), Math.round(upper - 34), Math.round(upper - 70), Math.round(upper - 120));
  } else {
    out.push(Math.round((ax + bx) / 2));
  }
  return out;
}

/** Pure layout + wiring plan. Returns items placed and the wires to draw. */
export function planSchematic(project, library) {
  const { items, width, height } = pack(project, library);
  const boxes = items.map((it) => ({ ref: it.comp.ref, r: bodyRect(it) }));
  const netPins = new Map();
  for (const it of items) {
    for (const p of it.all) {
      const net = project.netOf(`${it.comp.ref}.${p.id}`);
      if (!net) continue;
      const list = netPins.get(net.id) ?? [];
      list.push({ x: it.cx + p.lx, y: it.cy + p.ly, side: it.left.includes(p) ? -1 : 1, ref: it.comp.ref });
      netPins.set(net.id, list);
    }
  }

  const usedH = [];
  const usedV = [];
  const clearH = (y, x0, x1, selfRefs) => {
    const lo = Math.min(x0, x1);
    const hi = Math.max(x0, x1);
    for (const { ref, r } of boxes) {
      if (selfRefs.includes(ref)) continue;
      if (y >= r.y0 - 2 && y <= r.y1 + 2 && hi > r.x0 - 4 && lo < r.x1 + 4) return false;
    }
    for (const s of usedH) if (Math.abs(s.y - y) < 1 && hi > s.x0 - 3 && lo < s.x1 + 3) return false;
    return true;
  };
  const clearV = (x, y0, y1, selfRefs) => {
    const lo = Math.min(y0, y1);
    const hi = Math.max(y0, y1);
    for (const { ref, r } of boxes) {
      if (selfRefs.includes(ref)) continue;
      if (x >= r.x0 - 2 && x <= r.x1 + 2 && hi > r.y0 - 3 && lo < r.y1 + 3) return false;
    }
    for (const s of usedV) if (Math.abs(s.x - x) < 1 && hi > s.y0 - 3 && lo < s.y1 + 3) return false;
    return true;
  };

  const wires = [];
  for (const net of project.nets) {
    const pts = netPins.get(net.id);
    if (!pts || pts.length !== 2) continue;
    const [a, b] = pts;
    const selfRefs = [a.ref, b.ref];
    for (const cx of channelCandidates(a.x, a.side, b.x, b.side)) {
      if (!clearH(a.y, a.x, cx, selfRefs)) continue;
      if (!clearV(cx, a.y, b.y, selfRefs)) continue;
      if (!clearH(b.y, cx, b.x, selfRefs)) continue;
      usedH.push({ y: a.y, x0: Math.min(a.x, cx), x1: Math.max(a.x, cx) });
      usedV.push({ x: cx, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) });
      usedH.push({ y: b.y, x0: Math.min(cx, b.x), x1: Math.max(cx, b.x) });
      wires.push({ netId: net.id, points: [{ x: a.x, y: a.y }, { x: cx, y: a.y }, { x: cx, y: b.y }, { x: b.x, y: b.y }] });
      break;
    }
  }
  return { items, width, height, wires, wiredNets: new Set(wires.map((w) => w.netId)), netPins };
}

export function renderSchematic(svg, state) {
  const { project, library } = state;
  const focus = state.focusNets ?? new Set();
  const selected = state.selected ?? null;
  const colors = new Map(project.nets.map((n, i) => [n.id, NET_COLORS[i % NET_COLORS.length]]));
  const netNumber = new Map(project.nets.map((n, i) => [n.id, String(i + 1)]));
  const labelOf = (net) => (net.label ? net.label : netNumber.get(net.id));

  svg.innerHTML = "";
  const { items, width, height, wires, wiredNets } = planSchematic(project, library);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  el("rect", { x: 0, y: 0, width, height, fill: "#fbfbf7" }, svg);
  el("text", { x: width / 2, y: 20, "text-anchor": "middle", "font-size": 13, fill: "#6b7280" }, svg).textContent = `${project.title} — schematic`;

  for (const it of items) {
    const { comp, part, layout } = it;
    const s = el("g", { "data-ref": comp.ref, class: "component hoverable", cursor: "pointer" }, svg);
    const bx = it.cx - layout.body.w / 2;
    const by = it.cy - layout.body.h / 2;
    el("rect", { x: bx, y: by, width: layout.body.w, height: layout.body.h, rx: 4, fill: "#ffffff", stroke: "#202020", "stroke-width": 1.6 }, s);
    for (const p of it.all) {
      const side = it.left.includes(p) ? -1 : 1;
      const edgeX = side < 0 ? bx : bx + layout.body.w;
      const px = it.cx + p.lx;
      const py = it.cy + p.ly;
      el("line", { x1: edgeX, y1: py, x2: px, y2: py, stroke: LINE, "stroke-width": 1.4 }, s);
      el("circle", { cx: px, cy: py, r: 2.6, fill: LINE }, s);
      // pin number INSIDE the body
      el("text", { x: side < 0 ? bx + 5 : bx + layout.body.w - 5, y: py + 3, "text-anchor": side < 0 ? "start" : "end", "font-size": 7.5, fill: "#888" }, s).textContent = p.id;
      const net = project.netOf(`${comp.ref}.${p.id}`);
      if (net && !wiredNets.has(net.id)) {
        // complex net (or unroutable): a label outside instead of a wire
        const lit = focus.has(net.id);
        const col = colors.get(net.id);
        const g = el("g", { "data-net": net.id, class: "wire hoverable", cursor: "pointer" }, s);
        el("line", { x1: px, y1: py, x2: px + side * 16, y2: py, stroke: col, "stroke-width": lit ? 3 : 1.6 }, g);
        el("text", {
          x: px + side * 20, y: py + 3, "text-anchor": side < 0 ? "end" : "start",
          "font-size": 10, "font-weight": lit ? 700 : 600, fill: col,
        }, g).textContent = labelOf(net);
      }
    }
    drawGlyph(s, part, it.cx, it.cy);
    const label = `${comp.ref}${comp.value ? ` ${comp.value}` : ""}`;
    const sel = selected === comp.ref;
    el("text", { x: it.cx, y: by - 7, "text-anchor": "middle", "font-size": 10, fill: sel ? "#2a9d5f" : "#101010", "font-weight": sel ? 700 : 400 }, s).textContent = label;
  }

  for (const wire of wires) {
    const net = project.nets.find((n) => n.id === wire.netId);
    const lit = focus.has(wire.netId);
    const col = colors.get(wire.netId);
    const g = el("g", { "data-net": wire.netId, class: "wire hoverable", cursor: "pointer" }, svg);
    el("polyline", { points: wire.points.map((p) => `${p.x},${p.y}`).join(" "), fill: "none", stroke: col, "stroke-width": lit ? 3 : 1.8 }, g);
    for (const p of [wire.points[0], wire.points[wire.points.length - 1]]) {
      el("circle", { cx: p.x, cy: p.y, r: 8, fill: "transparent" }, g);
    }
    const mid = wire.points[1];
    el("text", { x: mid.x + 4, y: mid.y - 4, "font-size": 10, "font-weight": 600, fill: col }, g).textContent = net ? net.label || netNumber.get(net.id) : "";
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
