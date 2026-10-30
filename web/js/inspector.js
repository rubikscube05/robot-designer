// Right-hand inspector: details of the selected actuator / pair of actuators / structure.

import { h } from "./ui.js";
import { mountFaces } from "./mounts.js";
import { quatRotate, quatFromTo } from "./vec.js";
import { MATERIALS, isStale, solidEstimate } from "./structure.js";

const AXES = {
  "+Z": [0, 0, 1], "-Z": [0, 0, -1], "+X": [1, 0, 0], "-X": [-1, 0, 0], "+Y": [0, 1, 0], "-Y": [0, -1, 0],
};
export const axisVector = (name) => AXES[name];

/** Name of the world axis the actuator's output points along, or "custom". */
export function axisLabel(quaternion) {
  const v = quatRotate(quaternion, [0, 0, 1]);
  for (const [name, a] of Object.entries(AXES)) {
    if (Math.hypot(v[0] - a[0], v[1] - a[1], v[2] - a[2]) < 1e-3) return name;
  }
  return "custom";
}

export const quatForAxis = (name) => quatFromTo([0, 0, 1], AXES[name]);

const f = (n, d = 1) => Number(n).toFixed(d);
const safeLink = (url, text) =>
  typeof url === "string" && /^https?:\/\//.test(url)
    ? h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, text)
    : null;
const spec = (k, v) => [h("dt", {}, k), h("dd", {}, v)];

function faceCards(entry) {
  return Object.values(mountFaces(entry)).map((face) =>
    h("div", { class: `face-card ${face.name}` },
      h("strong", {}, face.label),
      h("div", {}, `Ø${f(face.radius * 2)} mm face`),
      h("div", {}, `${face.holeCount}× Ø${f(face.holeDia)} mm holes on a Ø${f(face.boltCircleDia)} mm circle`)));
}

const GENERIC_NOTE = h("p", { class: "note" },
  "Bolt pattern is generic: the catalogue only has diameter and length. " +
  "Check the vendor datasheet before machining or printing.");

function partDetails(ctx) {
  const { part, actions } = ctx;
  const e = part.entry;
  const pos = (i) => h("input", {
    type: "number", step: "1", "data-pos": i, value: f(part.pose.position[i], 1),
    onchange: (ev) => actions.setPosition(part.id, i, Number(ev.target.value)),
  });
  const axis = h("select", { onchange: (ev) => actions.setAxis(part.id, ev.target.value) },
    ...Object.keys(AXES).concat("custom").map((n) =>
      h("option", { value: n, selected: n === axisLabel(part.pose.quaternion) }, n)));
  return [
    h("h2", {}, e.name),
    h("div", { class: "muted" }, `${e.vendor} · ${e.category}`),
    h("dl", { class: "specs" },
      spec("Peak torque", `${f(e.tau_peak_Nm)} N·m`),
      spec("No-load speed", `${f((e.omega_NL_rad_s * 60) / (2 * Math.PI), 0)} rpm (${f(e.omega_NL_rad_s)} rad/s)`),
      spec("Mass", `${f(e.mass_kg, 3)} kg`),
      spec("Size", `Ø${f(e.OD_mm)} × ${f(e.L_mm)} mm`),
      spec("Torque density", `${f(e.tau_peak_Nm / e.mass_kg)} N·m/kg`),
      e.notes ? spec("Notes", e.notes) : null),
    safeLink(e.source, "Vendor datasheet ↗"),
    h("h3", {}, "Placement"),
    h("div", { class: "row pos" }, h("label", {}, "X", pos(0)), h("label", {}, "Y", pos(1)), h("label", {}, "Z", pos(2))),
    h("label", { class: "row" }, "Output axis points along ", axis),
    h("div", { class: "row buttons" },
      h("button", { onclick: () => actions.focus() }, "Focus"),
      h("button", { onclick: () => actions.duplicate(part.id) }, "Duplicate"),
      h("button", { class: "danger", onclick: () => actions.removePart(part.id) }, "Delete")),
    h("h3", {}, "Mount faces"),
    ...faceCards(e), GENERIC_NOTE,
  ];
}

let draft = { faceA: "output", faceB: "housing", pad: 10 };

function connectForm(ctx) {
  const { partA, partB, actions } = ctx;
  const faceSelect = (key) => h("select", { onchange: (ev) => { draft[key] = ev.target.value; } },
    ...["output", "housing"].map((n) => h("option", { value: n, selected: draft[key] === n }, n)));
  return [
    h("h2", {}, "Connect two actuators"),
    h("p", { class: "muted" }, `${partA.name} (${partA.id}) and ${partB.name} (${partB.id}) are selected.`),
    h("label", { class: "row" }, `Face on ${partA.name} (A)`, faceSelect("faceA")),
    h("label", { class: "row" }, `Face on ${partB.name} (B)`, faceSelect("faceB")),
    h("label", { class: "row" }, "Padding around the faces (mm)",
      h("input", { type: "number", min: "0", step: "1", value: draft.pad,
        onchange: (ev) => { draft.pad = Math.max(0, Number(ev.target.value) || 0); } })),
    h("p", { class: "note" },
      "This creates a design space between the two faces. Paint where material may exist; the " +
      "orange cells next to the mount faces are locked solid so the part always bolts on."),
    h("button", { class: "primary", onclick: () => actions.connect(partA.id, draft.faceA, partB.id, draft.faceB, draft.pad) },
      "Create part between faces"),
  ];
}

function structureDetails(ctx) {
  const { structure: s, parts, actions, brush } = ctx;
  const a = parts.get(s.a.part);
  const b = parts.get(s.b.part);
  const est = solidEstimate(s);
  const stale = isStale(s, parts);
  const radiusLabel = h("span", {}, `${f(brush.radius)} mm`);
  return [
    h("h2", {}, `Part ${s.id}`),
    h("div", { class: "muted" }, `${a.name} (${s.a.face}) → ${b.name} (${s.b.face})`),
    stale ? h("div", { class: "warn" },
      "An actuator moved after this design space was made. ",
      h("button", { onclick: () => actions.refit(s.id) }, "Re-fit design space")) : null,
    h("h3", {}, "Brush"),
    h("label", { class: "row" }, "Radius ", radiusLabel,
      h("input", {
        type: "range", min: brush.min, max: brush.max, step: brush.min / 2, value: brush.radius,
        oninput: (ev) => { radiusLabel.textContent = `${f(Number(ev.target.value))} mm`; actions.setBrush(Number(ev.target.value)); },
      })),
    h("div", { class: "row buttons" },
      h("button", { onclick: () => actions.setTool("paint") }, "Paint (B)"),
      h("button", { onclick: () => actions.setTool("erase") }, "Erase (E)"),
      h("button", { onclick: () => actions.fill(s.id) }, "Fill all"),
      h("button", { onclick: () => actions.clearPaint(s.id) }, "Clear"),
      h("button", { onclick: () => actions.undo() }, "Undo")),
    h("p", { class: "note" },
      "Left-drag paints on the box surface or on painted cells. Right-drag orbits. " +
      "Tip: Fill all, then Erase to carve."),
    h("h3", {}, "Design space"),
    h("dl", { class: "specs" },
      spec("Grid", `${s.domain.dims.join(" × ")} cells of ${f(s.domain.cell)} mm`),
      spec("Painted", `${est.paint} cells`),
      spec("Locked to mounts", `${est.interface} cells`),
      spec("Solid volume", `${f(est.volume_cm3)} cm³`),
      spec(`Mass if solid`, `${f(est.mass_g)} g`)),
    h("label", { class: "row" }, "Material ",
      h("select", { onchange: (ev) => actions.setMaterial(s.id, ev.target.value) },
        ...Object.entries(MATERIALS).map(([n, d]) =>
          h("option", { value: n, selected: s.material === n }, `${n} (${d} g/cm³)`)))),
    h("p", { class: "note" }, "Mass assumes the painted volume is 100% solid: an upper bound before optimization."),
    h("div", { class: "row buttons" },
      h("button", { onclick: () => actions.focus() }, "Focus"),
      h("button", { onclick: () => actions.exportStl(s.id) }, "Export STL"),
      h("button", { class: "danger", onclick: () => actions.removeStructure(s.id) }, "Delete")),
    h("button", { disabled: true, title: "Next milestone: topology optimization with CNC / 3D-print rules" },
      "Optimize (coming next)"),
  ];
}

const EMPTY = [
  h("h2", {}, "Nothing selected"),
  h("ol", { class: "steps" },
    h("li", {}, "Click an actuator on the left to add it."),
    h("li", {}, "Click it in the scene to select it. Double-click (or press F) to zoom in and see its mount faces and bolt holes."),
    h("li", {}, "Shift-click a second actuator, choose which faces to join, and press “Create part between faces”."),
    h("li", {}, "Paint the region where material may go, then Export STL.")),
];

/** Render the inspector for the current selection described by ctx. */
export function renderInspector(root, ctx) {
  let kids;
  if (ctx.mode === "part") kids = partDetails(ctx);
  else if (ctx.mode === "two") kids = connectForm(ctx);
  else if (ctx.mode === "structure") kids = structureDetails(ctx);
  else kids = EMPTY;
  root.replaceChildren(...kids.flat().filter(Boolean));
}

/** Update the position inputs in place (used while dragging, so inputs keep focus). */
export function updatePoseFields(root, part) {
  root.querySelectorAll("input[data-pos]").forEach((input) => {
    if (document.activeElement !== input) input.value = f(part.pose.position[Number(input.dataset.pos)], 1);
  });
}
