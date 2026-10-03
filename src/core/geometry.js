// Grid geometry: 1-based coordinates, x = column (a copper strip runs along x), y = row.
// A component's pins are given in local coordinates with pin 1 conventionally at (0, 0),
// and the component is placed by translating its origin and rotating it about that origin.

export const ROTS = [0, 90, 180, 270];

/** Spreadsheet-style row letter: 1 -> A, 26 -> Z, 27 -> AA. */
export function rowLetter(n) {
  let s = "";
  let k = Math.max(1, Math.round(n));
  while (k > 0) {
    k -= 1;
    s = String.fromCharCode(65 + (k % 26)) + s;
    k = Math.floor(k / 26);
  }
  return s;
}

/** Row label with A at the BOTTOM: row y of a `rows`-tall board. */
export function rowLabel(y, rows) {
  return rowLetter(rows - y + 1);
}

export function normalizeDeg(deg) {
  return ((deg % 360) + 360) % 360;
}

/** Rotate a local offset about the origin. */
export function rotateLocal(dx, dy, deg) {
  switch (normalizeDeg(deg)) {
    case 90:
      return { x: -dy, y: dx };
    case 180:
      return { x: -dx, y: -dy };
    case 270:
      return { x: dy, y: -dx };
    default:
      return { x: dx, y: dy };
  }
}

export function nextRotation(deg) {
  return normalizeDeg(deg + 90);
}

/** World position of a local offset for a placed component. */
export function place(component, dx, dy) {
  const r = rotateLocal(dx, dy, component.rot || 0);
  return { x: component.x + r.x, y: component.y + r.y };
}

/** Effective lead span of a two-lead part for this instance (0 if not bendable). */
export function resolveSpan(component, part) {
  if (!part.bendable) return 0;
  const { min, max, default: def } = part.bendable;
  const s = Math.round(component.span || def);
  return Math.max(min, Math.min(max, s));
}

/** The part's pins, with a bendable part's second lead placed at its span. */
export function effectivePins(part, span) {
  if (!part.bendable) return part.pins;
  const { min, max, default: def } = part.bendable;
  const s = Math.max(min, Math.min(max, Math.round(span || def)));
  const [p0, p1] = part.pins;
  return [
    { id: p0.id, x: p0.x, y: p0.y },
    { id: p1.id, x: p1.x, y: s },
  ];
}

/** World position of one pin of a component, or null if the part has no such pin. */
export function pinWorld(component, part, pinId) {
  const pin = effectivePins(part, resolveSpan(component, part)).find((p) => p.id === pinId);
  if (!pin) return null;
  return place(component, pin.x, pin.y);
}

/** All pins of a component as { id, x, y }, world coordinates. */
export function componentPins(component, part) {
  return effectivePins(part, resolveSpan(component, part)).map((p) => ({
    id: p.id,
    ...place(component, p.x, p.y),
  }));
}

/** Bounding box (in grid units) of a component's pins, for drawing/selection. */
export function componentBounds(component, part) {
  const pts = componentPins(component, part);
  if (pts.length === 0) return { x0: component.x, y0: component.y, x1: component.x, y1: component.y };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/**
 * World rect of a part's physical body, or null (callers fall back to pin extent).
 * `part.body` is { x, y, w, h } in local holes, inclusive: holes [x .. x+w-1] x [y .. y+h-1].
 */
export function componentBody(component, part) {
  const b = part.body;
  if (!b) return null;
  const a = place(component, b.x, b.y);
  const c = place(component, b.x + b.w - 1, b.y + b.h - 1);
  return {
    x0: Math.min(a.x, c.x),
    y0: Math.min(a.y, c.y),
    x1: Math.max(a.x, c.x),
    y1: Math.max(a.y, c.y),
  };
}

/** Total half-perimeter wirelength of every net (a placement quality proxy). */
export function totalWirelength(project, library) {
  let total = 0;
  for (const net of project.nets) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const key of net.pins) {
      const i = key.lastIndexOf(".");
      const ref = key.slice(0, i);
      const pin = key.slice(i + 1);
      const comp = project.components.get(ref);
      const part = comp && library.get(comp.part);
      if (!part) continue;
      const p = componentPins(comp, part).find((q) => q.id === pin);
      if (!p) continue;
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    if (x0 !== Infinity) total += x1 - x0 + (y1 - y0);
  }
  return total;
}

/**
 * Bounding box of everything the board actually uses: component pins, cuts and jumper
 * ends. Null when nothing is placed. This is where you can cut a virgin stripboard.
 */
export function contentBounds(project, library) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const hit = (x, y) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const comp of project.components.values()) {
    const part = library.get(comp.part);
    if (!part) continue;
    const body = componentBody(comp, part);
    if (body) {
      hit(body.x0, body.y0);
      hit(body.x1, body.y1);
    } else {
      for (const p of componentPins(comp, part)) hit(p.x, p.y);
    }
  }
  for (const c of project.cuts) {
    const [x, y] = c.split(",").map(Number);
    hit(x, y);
  }
  for (const c of project.mountingHoles ?? []) {
    const [x, y] = c.split(",").map(Number);
    hit(x, y);
  }
  for (const j of project.jumpers) {
    hit(j.x, j.ya);
    hit(j.x, j.yb);
  }
  if (x0 === Infinity) return null;
  return { x0, y0, x1, y1 };
}
