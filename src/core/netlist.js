// Netlist export in a few plain formats, so the design can move to KiCad / SPICE.
// The app stays a stripboard planner; the schematic itself is edited elsewhere.

import { splitPin } from "./model.js";

export const NETLIST_FORMATS = ["json", "spice", "kicad"];

export function exportNetlist(project, library, format = "json") {
  if (format === "spice") return toSpice(project, library);
  if (format === "kicad") return toKicad(project, library);
  return toJson(project, library);
}

function toJson(project, library) {
  const components = [...project.components.values()].map((c) => {
    const part = library.get(c.part);
    return { ref: c.ref, part: c.part, value: c.value, pins: part ? part.pins.map((p) => p.id) : [] };
  });
  const nets = project.nets.map((n) => ({
    id: n.id,
    label: n.label || n.id,
    pins: [...n.pins].sort(),
  }));
  return JSON.stringify({ title: project.title, components, nets }, null, 2);
}

const SPICE_PREFIX = { resistor: "R", capacitor: "C", diode: "D", led: "D", transistor: "Q" };

function toSpice(project, library) {
  const nodes = new Map();
  let next = 1;
  const nodeOf = (netId) => {
    const net = project.nets.find((n) => n.id === netId);
    if ((net?.label || netId).toUpperCase() === "GND") return "0";
    if (!nodes.has(netId)) nodes.set(netId, String(next++));
    return nodes.get(netId);
  };
  const lines = [`* netlist from Stripboard Shield Planner`, `* ${project.title}`];
  for (const net of project.nets) lines.push(`* ${net.label || net.id} -> ${nodeOf(net.id)}`);
  for (const comp of project.components.values()) {
    const part = library.get(comp.part);
    if (!part) continue;
    const prefix = SPICE_PREFIX[part.kind];
    if (part.pins.length !== 2 || !prefix) {
      lines.push(`* skipped ${comp.ref} (${comp.part}, ${part.pins.length} pins)`);
      continue;
    }
    const [p1, p2] = part.pins;
    const n1 = project.netOf(`${comp.ref}.${p1.id}`);
    const n2 = project.netOf(`${comp.ref}.${p2.id}`);
    const value = comp.value || part.defaultValue || "";
    lines.push(`${comp.ref} ${n1 ? nodeOf(n1.id) : "0"} ${n2 ? nodeOf(n2.id) : "0"} ${value}`.trim());
  }
  lines.push(".end");
  return lines.join("\n");
}

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function toKicad(project, library) {
  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<export version="D">`,
    `  <components>`,
  ];
  for (const c of project.components.values()) {
    lines.push(`    <comp ref="${esc(c.ref)}"><value>${esc(c.value || "")}</value><footprint></footprint></comp>`);
  }
  lines.push(`  </components>`, `  <nets>`);
  project.nets.forEach((net, i) => {
    lines.push(`    <net code="${i + 1}" name="${esc(net.label || net.id)}">`);
    for (const key of [...net.pins].sort()) {
      const { ref, pin } = splitPin(key);
      lines.push(`      <node ref="${esc(ref)}" pin="${esc(pin)}"/>`);
    }
    lines.push(`    </net>`);
  });
  lines.push(`  </nets>`, `</export>`);
  return lines.join("\n");
}
