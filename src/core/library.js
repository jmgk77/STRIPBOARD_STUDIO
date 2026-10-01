// The part library. A part is a footprint: named pins in local (grid) coordinates plus
// enough drawing info to render a symbol. Keep it small; add parts here as needed.
//
// Stripboard convention: copper strips run horizontally (along x), so parts are placed
// with their pins running DOWN a column (along y) -- one pin per row, hence one pin per
// strip. A single-row header is therefore a vertical column of pins, and a module is two
// vertical columns `gap` apart.

export class PartDef {
  constructor({ name, label, kind = "generic", pins = [], body = null, rotatable = true, defaultValue = "" }) {
    this.name = name;
    this.label = label;
    this.kind = kind;
    this.pins = pins;
    this.body = body; // { x, y, w, h } in local units, for drawing only
    this.rotatable = rotatable;
    this.defaultValue = defaultValue;
    const ids = pins.map((p) => p.id);
    if (new Set(ids).size !== ids.length) throw new Error(`part ${name}: duplicate pin ids`);
  }
}

export const LIBRARY = new Map();

function register(part) {
  LIBRARY.set(part.name, part);
  return part;
}

export function getPart(name) {
  const part = LIBRARY.get(name);
  if (!part) throw new Error(`unknown part ${name}`);
  return part;
}

/** A vertical column of pins, top to bottom. */
export function colPins(ids) {
  return ids.map((id, i) => ({ id, x: 0, y: i }));
}

/** Two vertical columns, each top-to-bottom, `gap` columns apart. */
export function dualRow(leftIds, rightIds, gap) {
  const pins = [];
  leftIds.forEach((id, i) => pins.push({ id, x: 0, y: i }));
  rightIds.forEach((id, i) => pins.push({ id, x: gap, y: i }));
  return pins;
}

const numbers = (count) => Array.from({ length: count }, (_, i) => String(i + 1));
const labels = (prefix, count) => Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);

// --- discretes ---------------------------------------------------------------

register(new PartDef({
  name: "resistor", label: "Resistor", kind: "resistor", defaultValue: "10k",
  pins: [{ id: "1", x: 0, y: 0 }, { id: "2", x: 0, y: 3 }],
}));
register(new PartDef({
  name: "led", label: "LED", kind: "led",
  pins: [{ id: "A", x: 0, y: 0 }, { id: "K", x: 0, y: 2 }],
}));
register(new PartDef({
  name: "diode", label: "Diode", kind: "diode", defaultValue: "1N4148",
  pins: [{ id: "A", x: 0, y: 0 }, { id: "K", x: 0, y: 2 }],
}));
register(new PartDef({
  name: "transistor", label: "Transistor (TO-92)", kind: "transistor", defaultValue: "2N3904",
  pins: colPins(["E", "B", "C"]),
}));

// --- headers / terminals / DIP ----------------------------------------------

for (let n = 2; n <= 8; n++) {
  register(new PartDef({
    name: `header${n}`, label: `${n}-pin header`, kind: "header", pins: colPins(numbers(n)),
  }));
}
for (let n = 2; n <= 4; n++) {
  register(new PartDef({
    name: `terminal${n}`, label: `${n}-way terminal`, kind: "terminal", pins: colPins(numbers(n)),
  }));
}
for (const half of [4, 7, 8]) {
  register(new PartDef({
    name: `dip${half * 2}`, label: `DIP-${half * 2}`, kind: "dip",
    pins: dualRow(numbers(half), numbers(half).map((n) => String(Number(n) + half)), 3),
  }));
}

// --- modules (dev boards / breakout boards) ----------------------------------
// Pins are generically named (L1.., R1..). Rename them for your specific board.

register(new PartDef({
  name: "module-2x15", label: "Module 2x15 (dev board)", kind: "module",
  pins: dualRow(labels("L", 15), labels("R", 15), 9),
}));
register(new PartDef({
  name: "module-2x10", label: "Module 2x10", kind: "module",
  pins: dualRow(labels("L", 10), labels("R", 10), 6),
}));
register(new PartDef({
  name: "module-1x8", label: "Module 1x8", kind: "module", pins: colPins(labels("P", 8)),
}));

export function listParts() {
  return [...LIBRARY.values()];
}
