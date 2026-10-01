// Grid geometry: 1-based coordinates, x = column (a copper strip runs along x), y = row.
// A component's pins are given in local coordinates with pin 1 conventionally at (0, 0),
// and the component is placed by translating its origin and rotating it about that origin.

export const ROTS = [0, 90, 180, 270];

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
    for (const p of componentPins(comp, part)) hit(p.x, p.y);
  }
  for (const c of project.cuts) {
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
