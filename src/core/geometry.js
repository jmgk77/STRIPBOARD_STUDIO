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

/** World position of one pin of a component, or null if the part has no such pin. */
export function pinWorld(component, part, pinId) {
  const pin = part.pins.find((p) => p.id === pinId);
  if (!pin) return null;
  return place(component, pin.x, pin.y);
}

/** All pins of a component as { id, x, y }, world coordinates. */
export function componentPins(component, part) {
  return part.pins.map((p) => ({ id: p.id, ...place(component, p.x, p.y) }));
}

/** Bounding box (in grid units) of a component's pins, for drawing/selection. */
export function componentBounds(component, part) {
  const pts = componentPins(component, part);
  if (pts.length === 0) return { x0: component.x, y0: component.y, x1: component.x, y1: component.y };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
