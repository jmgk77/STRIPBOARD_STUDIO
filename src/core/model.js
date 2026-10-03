// The editable document model. Pure data + small operations; no DOM, no rendering.
//
// Pin identity is (component ref, pin id), kept as the string "REF.PIN" so it is a valid
// Set key. Refs never contain a dot.

export const pinKey = (ref, pin) => `${ref}.${pin}`;

export function splitPin(key) {
  const i = key.lastIndexOf(".");
  return { ref: key.slice(0, i), pin: key.slice(i + 1) };
}

/** Human label for a pin: "U1.GPIO4" when named, else "U1.L4". */
export function pinLabel(project, key) {
  const { ref, pin } = splitPin(key);
  const name = project.components.get(ref)?.pinNames?.[pin];
  return name ? `${ref}.${name}` : key;
}

export class Net {
  constructor(id, pins = [], weight = 1, label = "") {
    this.id = id;
    this.pins = new Set(pins);
    this.weight = weight;
    this.label = label; // friendly name, e.g. "VCC", "bomba1"
  }

  toJSON() {
    const out = { id: this.id, pins: [...this.pins].sort(), weight: this.weight };
    if (this.label) out.label = this.label;
    return out;
  }
}

export class Component {
  constructor({ ref, part, x = 1, y = 1, rot = 0, locked = false, value = "", pinNames = null, span = 0 }) {
    this.ref = ref;
    this.part = part;
    this.x = x;
    this.y = y;
    this.rot = rot;
    this.locked = locked;
    this.value = value;
    this.pinNames = pinNames ? { ...pinNames } : {}; // pin id -> display name
    this.span = span; // bendable parts: lead spacing in holes (0 = part default)
  }

  toJSON() {
    const { ref, part, x, y, rot, locked, value, pinNames, span } = this;
    const out = { ref, part, x, y, rot, locked, value };
    if (Object.keys(pinNames).length) out.pinNames = pinNames;
    if (span) out.span = span;
    return out;
  }
}

export class Project {
  constructor({ cols = 34, rows = 26, title = "untitled" } = {}) {
    this.cols = cols;
    this.rows = rows;
    this.title = title;
    this.components = new Map(); // ref -> Component
    this.nets = []; // Net[]
    this.cuts = new Set(); // "x,y" cells where the copper is broken
    this.fixedCuts = new Set(); // the subset the user pinned; Solve keeps these
    this.jumpers = []; // { x, ya, yb, net?, fixed? }
    this.customParts = []; // specs of user-defined pin bars (see library.buildBarPart)
  }

  addComponent(comp) {
    if (this.components.has(comp.ref)) throw new Error(`duplicate ref ${comp.ref}`);
    this.components.set(comp.ref, comp);
    return comp;
  }

  removeComponent(ref) {
    this.components.delete(ref);
    for (const net of this.nets) {
      for (const key of [...net.pins]) if (splitPin(key).ref === ref) net.pins.delete(key);
    }
    this.nets = this.nets.filter((n) => n.pins.size > 0);
  }

  uniqueRef(prefix) {
    let n = 1;
    while (this.components.has(`${prefix}${n}`)) n += 1;
    return `${prefix}${n}`;
  }

  netOf(key) {
    return this.nets.find((n) => n.pins.has(key)) ?? null;
  }

  /** Join every pin key into one net, merging any nets they already belong to. */
  connect(keys, id = null) {
    const wanted = new Set(keys);
    const existing = this.nets.filter((n) => [...n.pins].some((k) => wanted.has(k)));
    const netId = id ?? existing[0]?.id ?? this.uniqueNetId();
    for (const net of existing) {
      for (const k of net.pins) wanted.add(k);
      this.nets.splice(this.nets.indexOf(net), 1);
    }
    const net = new Net(netId, wanted);
    this.nets.push(net);
    return net;
  }

  /** Move a pin into net `id` (creating it if needed), removing it from any other net. */
  assignPin(key, id) {
    for (const n of this.nets) n.pins.delete(key);
    let net = this.nets.find((n) => n.id === id);
    if (!net) {
      net = new Net(id);
      this.nets.push(net);
    }
    net.pins.add(key);
    this.nets = this.nets.filter((n) => n === net || n.pins.size > 0);
    return net;
  }

  uniqueNetId() {
    const taken = new Set(this.nets.map((n) => n.id));
    let n = 1;
    while (taken.has(`N${n}`)) n += 1;
    return `N${n}`;
  }

  /** Deep copy (used for undo snapshots). */
  clone() {
    return Project.fromJSON(this.toJSON());
  }

  toJSON() {
    return {
      version: 1,
      title: this.title,
      board: { cols: this.cols, rows: this.rows },
      components: [...this.components.values()].map((c) => c.toJSON()),
      nets: this.nets.map((n) => n.toJSON()),
      cuts: [...this.cuts].sort(),
      fixedCuts: [...this.fixedCuts].sort(),
      jumpers: this.jumpers.map((j) => ({ ...j })),
      customParts: this.customParts.map((p) => ({ ...p })),
    };
  }

  static fromJSON(o) {
    const board = o.board ?? {};
    const p = new Project({ cols: board.cols ?? board.w ?? 34, rows: board.rows ?? board.h ?? 26, title: o.title ?? "untitled" });
    for (const c of o.components ?? []) p.components.set(c.ref, new Component(c));
    p.nets = (o.nets ?? []).map((n) => new Net(n.id, n.pins ?? [], n.weight ?? 1, n.label ?? ""));
    p.cuts = new Set(o.cuts ?? []);
    p.fixedCuts = new Set(o.fixedCuts ?? []);
    p.jumpers = (o.jumpers ?? []).map((j) => {
      const out = { x: j.x, ya: j.ya, yb: j.yb };
      if (j.net) out.net = j.net;
      if (j.fixed) out.fixed = true;
      return out;
    });
    p.customParts = (o.customParts ?? []).map((s) => ({ ...s }));
    return p;
  }
}
