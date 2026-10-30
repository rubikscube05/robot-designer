// Controller: wires the store, the 3D views, the panels and the mouse/keyboard together.

import * as THREE from "three";
import { createViewer } from "./scene3d.js";
import { createStore } from "./store.js";
import { createPartView } from "./partview.js";
import { createStructureView } from "./structview.js";
import { createLabelLayer } from "./labels.js";
import { createCatalogPanel } from "./ui.js";
import { renderInspector, updatePoseFields, quatForAxis } from "./inspector.js";
import { mountFaces } from "./mounts.js";
import { buildStructure, refit, relock, worldFaceOf } from "./structure.js";
import { raycast as voxelRaycast, paintSphere, fillAll, clearPaint, PAINT, EMPTY } from "./domain.js";
import { voxelsToStl, countTriangles } from "./stl.js";

const SAVE_KEY = "robot-designer-v1";
const $ = (id) => document.getElementById(id);
const f = (n, d = 1) => Number(n).toFixed(d);

const canvas = $("c");
const viewport = $("viewport");
const viewer = createViewer(canvas, viewport);
const labels = createLabelLayer($("labels"), viewer.camera, viewer.renderer);
viewer.onFrame(() => labels.update());

const store = createStore();
const partViews = new Map();
const structViews = new Map();
let catalogByName = new Map();

// tool: select | move | rotate | paint | erase.  parts: selected part ids (max 2).
const state = { tool: "select", parts: [], structure: null, brushRadius: null, undo: new Map() };

const brushMesh = new THREE.Mesh(
  new THREE.SphereGeometry(1, 24, 16),
  new THREE.MeshBasicMaterial({ color: 0x58b6ff, wireframe: true, transparent: true, opacity: 0.6 }));
brushMesh.visible = false;
brushMesh.raycast = () => {};
viewer.scene.add(brushMesh);

const isPaintTool = () => state.tool === "paint" || state.tool === "erase";
const selectedStructure = () => (state.structure ? store.structures.get(state.structure) : null);
const partBodies = () => [...partViews.values()].map((v) => v.group);

// ---------- small helpers ----------
function toast(message, ms = 5000) {
  const el = document.createElement("div");
  el.id = "toast";
  el.textContent = message;
  $("toast")?.remove();
  viewport.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(store.toJSON())); } catch { /* storage full or blocked */ }
  }, 400);
}

let inspectorQueued = false;
function scheduleInspector() {
  if (inspectorQueued) return;
  inspectorQueued = true;
  requestAnimationFrame(() => { inspectorQueued = false; refreshInspector(); });
}

const sphereOfPart = (p) => ({
  center: p.pose.position,
  radius: Math.hypot(p.entry.OD_mm / 2, p.entry.L_mm / 2) * 1.05,
});

// ---------- refreshing the UI from the state ----------
function brushInfo(s) {
  const min = s.domain.cell;
  const max = s.domain.cell * 12;
  state.brushRadius = Math.min(max, Math.max(min, state.brushRadius ?? s.domain.cell * 3));
  return { min, max, radius: state.brushRadius };
}

function refreshInspector() {
  const ctx = { parts: store.parts, tool: state.tool, actions, mode: "none" };
  const s = selectedStructure();
  if (s) Object.assign(ctx, { mode: "structure", structure: s, brush: brushInfo(s) });
  else if (state.parts.length === 1) Object.assign(ctx, { mode: "part", part: store.parts.get(state.parts[0]) });
  else if (state.parts.length === 2) {
    Object.assign(ctx, { mode: "two", partA: store.parts.get(state.parts[0]), partB: store.parts.get(state.parts[1]) });
  }
  renderInspector($("inspector"), ctx);
}

function refreshStyles() {
  const focused = viewer.isFocused();
  const s = selectedStructure();
  const keep = new Set(state.parts);
  if (s) { keep.add(s.a.part); keep.add(s.b.part); }
  for (const [id, v] of partViews) {
    v.setSelected(state.parts.includes(id));
    v.setOverlay(keep.has(id));
    v.setDim(focused && !keep.has(id) ? 0.12 : 1);
  }
  for (const [id, v] of structViews) v.setDim(focused && id !== state.structure ? 0.15 : 1);
}

function refreshLabels() {
  const focused = viewer.isFocused();
  const s = selectedStructure();
  const show = new Map(state.parts.map((id) => [id, null]));
  if (s) { show.set(s.a.part, s.a.face); show.set(s.b.part, s.b.face); }
  const items = [];
  for (const [id, onlyFace] of show) {
    const part = store.parts.get(id);
    if (!part) continue;
    for (const face of Object.values(mountFaces(part.entry))) {
      if (onlyFace && face.name !== onlyFace) continue;
      const wf = worldFaceOf(part, face.name);
      let text = `${part.name} · ${face.label}`;
      if (onlyFace) text += " · locked solid";
      if (focused) {
        text += ` — Ø${f(face.radius * 2)} mm, ${face.holeCount}× Ø${f(face.holeDia)} on Ø${f(face.boltCircleDia)} (generic)`;
      }
      items.push({ position: wf.center.map((c, i) => c + wf.normal[i] * 6), text, kind: face.name });
    }
  }
  labels.set(items);
}

function refreshHint() {
  let t;
  if (isPaintTool()) {
    t = selectedStructure()
      ? `${state.tool === "paint" ? "Painting" : "Erasing"}: left-drag on the box or on painted cells · right-drag orbits · [ ] brush size · Esc to stop`
      : "Select a part (or connect two actuators) first, then paint.";
  } else if (viewer.isFocused()) t = "Focus view: orbit to inspect the mount faces and bolt holes · Esc to go back";
  else if (state.parts.length === 1) t = "Double-click or F to zoom in · G move · R rotate · Shift-click another actuator to connect them";
  else if (state.parts.length === 2) t = "Two selected: choose the faces on the right and create the part between them";
  else t = "Click an actuator in the list to add it, then click it in the scene to select it";
  $("hint").textContent = t;
}

function attachGizmo() {
  const id = state.parts.length === 1 && (state.tool === "move" || state.tool === "rotate") ? state.parts[0] : null;
  if (id && partViews.has(id)) {
    viewer.transform.setMode(state.tool === "move" ? "translate" : "rotate");
    viewer.transform.attach(partViews.get(id).group);
  } else viewer.transform.detach();
}

function afterSelectionChange() {
  attachGizmo(); refreshStyles(); refreshInspector(); refreshLabels(); refreshHint();
}

function select(parts, structure = null) {
  state.parts = parts;
  state.structure = structure;
  afterSelectionChange();
}

function setTool(tool) {
  state.tool = tool;
  document.querySelectorAll("#tools button").forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
  viewer.setPaintMode(isPaintTool());
  if (!isPaintTool()) brushMesh.visible = false;
  if (isPaintTool() && !state.structure && store.structures.size === 1) {
    select([], [...store.structures.keys()][0]);
    return;
  }
  attachGizmo(); refreshHint();
}

// ---------- focus ----------
function focusTarget() {
  const s = selectedStructure();
  if (s) return structViews.get(s.id)?.sphere() ?? null;
  const spheres = state.parts.map((id) => store.parts.get(id)).filter(Boolean).map(sphereOfPart);
  if (spheres.length < 2) return spheres[0] ?? null;
  const [a, b] = spheres;
  const dist = Math.hypot(...a.center.map((c, i) => c - b.center[i]));
  return { center: a.center.map((c, i) => (c + b.center[i]) / 2), radius: dist / 2 + Math.max(a.radius, b.radius) };
}

function focusSelection() {
  const t = focusTarget();
  if (!t) return;
  viewer.focusOn(t.center, t.radius);
  refreshStyles(); refreshLabels(); refreshHint();
}

function exitFocus() {
  viewer.restoreView();
  refreshStyles(); refreshLabels(); refreshHint();
}

function fitAll() {
  const spheres = [...store.parts.values()].map(sphereOfPart);
  for (const v of structViews.values()) spheres.push(v.sphere());
  viewer.fitAll(spheres);
  refreshStyles(); refreshLabels(); refreshHint();
}

// ---------- painting ----------
function stacksFor(id) {
  if (!state.undo.has(id)) state.undo.set(id, { undo: [], redo: [] });
  return state.undo.get(id);
}

function recordStroke(id, indices, from) {
  if (!indices.length) return;
  const st = stacksFor(id);
  st.undo.push({ indices, from });
  if (st.undo.length > 100) st.undo.shift();
  st.redo.length = 0;
}

/** Undo/redo flips the cells of one stroke between EMPTY and PAINT. */
function replay(direction) {
  const s = selectedStructure();
  if (!s) return;
  const st = stacksFor(s.id);
  const entry = (direction === "undo" ? st.undo : st.redo).pop();
  if (!entry) return;
  const written = entry.from === EMPTY ? PAINT : EMPTY; // what the stroke wrote
  const [expect, set] = direction === "undo" ? [written, entry.from] : [entry.from, written];
  for (const i of entry.indices) if (s.domain.data[i] === expect) s.domain.data[i] = set;
  (direction === "undo" ? st.redo : st.undo).push(entry);
  structViews.get(s.id).update(entry.indices);
  scheduleInspector(); scheduleSave();
}

function brushTarget(e) {
  const s = selectedStructure();
  if (!s || !state.brushRadius) return null;
  const ray = viewer.rayFromEvent(e);
  const origin = ray.origin.toArray();
  const dir = ray.direction.toArray();
  const r = voxelRaycast(s.domain, origin, dir);
  if (!r) return null;
  const dist = Math.hypot(r.point[0] - origin[0], r.point[1] - origin[1], r.point[2] - origin[2]);
  const blocker = viewer.raycaster.intersectObjects(partBodies(), true).find((x) => x.object.userData.partId);
  if (blocker && blocker.distance < dist - 0.01) return null; // an actuator is in front
  const n = r.normal ?? dir.map((v) => -v);
  // Painting on top of painted cells grows outwards; everything else digs slightly into the box.
  const sign = state.tool === "paint" && r.hitSolid ? 1 : -1;
  const radius = state.brushRadius;
  return { s, radius, center: r.point.map((p, i) => p + sign * n[i] * radius * 0.5) };
}

function showBrush(t) {
  brushMesh.visible = !!t;
  if (!t) return;
  brushMesh.position.set(...t.center);
  brushMesh.scale.setScalar(t.radius);
  brushMesh.material.color.set(state.tool === "paint" ? 0x58b6ff : 0xff6b6b);
}

let stroke = null;
function paintAt(e) {
  const t = brushTarget(e);
  showBrush(t);
  if (!t) return;
  const changed = paintSphere(t.s.domain, t.center, t.radius, stroke.value);
  if (!changed.length) return;
  for (const i of changed) stroke.indices.push(i);
  structViews.get(t.s.id).update(changed);
  scheduleInspector();
}

// ---------- picking and selection ----------
function pick(e) {
  const ray = viewer.rayFromEvent(e);
  const origin = ray.origin.toArray();
  let best = null;
  const body = viewer.raycaster.intersectObjects(partBodies(), true).find((x) => x.object.userData.partId);
  if (body) best = { kind: "part", id: body.object.userData.partId, dist: body.distance };
  for (const s of store.structures.values()) {
    const r = voxelRaycast(s.domain, origin, ray.direction.toArray());
    if (!r || !r.hitSolid) continue;
    const dist = Math.hypot(r.point[0] - origin[0], r.point[1] - origin[1], r.point[2] - origin[2]);
    if (!best || dist < best.dist) best = { kind: "structure", id: s.id, dist };
  }
  return best;
}

function selectHit(hit, additive) {
  if (!hit) { if (!additive) select([]); return; }
  if (hit.kind === "structure") { select([], hit.id); return; }
  if (additive && !state.structure) {
    let ids = state.parts.includes(hit.id) ? state.parts.filter((i) => i !== hit.id) : [...state.parts, hit.id];
    if (ids.length > 2) ids = ids.slice(-2);
    select(ids);
  } else select([hit.id]);
}

let down = null;
canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || viewer.transform.axis) return; // gizmo handle grabbed
  down = { x: e.clientX, y: e.clientY };
  if (isPaintTool() && selectedStructure()) {
    stroke = { id: state.structure, indices: [], value: state.tool === "paint" ? PAINT : EMPTY };
    canvas.setPointerCapture(e.pointerId);
    paintAt(e);
  }
});
canvas.addEventListener("pointermove", (e) => {
  if (stroke) paintAt(e);
  else if (isPaintTool()) showBrush(brushTarget(e));
});
canvas.addEventListener("pointerup", (e) => {
  if (stroke) {
    recordStroke(stroke.id, stroke.indices, stroke.value === PAINT ? EMPTY : PAINT);
    stroke = null; down = null;
    scheduleSave();
    return;
  }
  if (down && e.button === 0 && !isPaintTool() && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) {
    selectHit(pick(e), e.shiftKey);
  }
  down = null;
});
canvas.addEventListener("pointerleave", () => { if (!stroke) brushMesh.visible = false; });
canvas.addEventListener("dblclick", (e) => {
  if (isPaintTool()) return;
  const hit = pick(e);
  if (!hit) return;
  selectHit(hit, false);
  focusSelection();
});

viewer.transform.addEventListener("objectChange", () => {
  const g = viewer.transform.object;
  if (!g) return;
  store.setPose(g.userData.partId, { position: g.position.toArray(), quaternion: g.quaternion.toArray() });
});
viewer.transform.addEventListener("dragging-changed", (e) => { if (!e.value) refreshInspector(); });

// ---------- actions used by the inspector ----------
const actions = {
  focus: focusSelection,
  setTool,
  undo: () => replay("undo"),
  duplicate(id) {
    const p = store.parts.get(id);
    select([store.duplicatePart(id, [p.entry.OD_mm + 20, 0, 0]).id]);
  },
  removePart: (id) => store.removePart(id),
  setPosition(id, axis, value) {
    const p = store.parts.get(id);
    const position = [...p.pose.position];
    position[axis] = value;
    store.setPose(id, { position, quaternion: p.pose.quaternion });
    refreshLabels();
  },
  setAxis(id, name) {
    if (name === "custom") return;
    store.setPose(id, { position: store.parts.get(id).pose.position, quaternion: quatForAxis(name) });
    refreshLabels();
  },
  connect(aId, faceA, bId, faceB, pad) {
    const built = buildStructure(store.parts.get(aId), faceA, store.parts.get(bId), faceB, store.parts, { pad });
    const s = store.addStructure({
      a: { part: aId, face: faceA }, b: { part: bId, face: faceB }, material: "PLA", ...built,
    });
    state.brushRadius = null;
    select([], s.id);
    setTool("paint");
    focusSelection();
  },
  refit(id) {
    const s = store.structures.get(id);
    refit(s, store.parts);
    state.undo.delete(id);
    store.touchStructure(id);
  },
  fill(id) {
    const s = store.structures.get(id);
    const changed = fillAll(s.domain);
    recordStroke(id, changed, EMPTY);
    structViews.get(id).update(changed);
    refreshInspector(); scheduleSave();
  },
  clearPaint(id) {
    const s = store.structures.get(id);
    const changed = clearPaint(s.domain);
    recordStroke(id, changed, PAINT);
    structViews.get(id).update(changed);
    refreshInspector(); scheduleSave();
  },
  setBrush(radius) {
    state.brushRadius = radius;
  },
  setMaterial(id, name) {
    store.structures.get(id).material = name;
    refreshInspector(); scheduleSave();
  },
  exportStl(id) {
    const s = store.structures.get(id);
    const tris = countTriangles(s.domain);
    if (!tris) { toast("Nothing to export yet: paint some material first."); return; }
    download(`part-${id}.stl`, voxelsToStl(s.domain), "application/octet-stream");
    toast(`Exported ${tris} triangles (blocky voxel surface, millimetres).`);
  },
  removeStructure(id) {
    state.undo.delete(id);
    store.removeStructure(id);
  },
};

// ---------- store -> views ----------
function addPartView(part) {
  const v = createPartView(part);
  v.applyPose(part.pose);
  partViews.set(part.id, v);
  viewer.scene.add(v.group);
}
function addStructureView(s) {
  const v = createStructureView(s);
  structViews.set(s.id, v);
  viewer.scene.add(v.group);
}
function dropView(map, id) {
  const v = map.get(id);
  if (!v) return;
  viewer.scene.remove(v.group);
  v.dispose();
  map.delete(id);
}

function rebuildAll() {
  viewer.transform.detach();
  for (const id of [...partViews.keys()]) dropView(partViews, id);
  for (const id of [...structViews.keys()]) dropView(structViews, id);
  state.undo.clear();
  for (const p of store.parts.values()) addPartView(p);
  for (const s of store.structures.values()) {
    relock(s, store.parts);
    addStructureView(s);
  }
  select([]);
  fitAll();
}

store.onChange((kind, id) => {
  if (kind === "part-added") { addPartView(store.parts.get(id)); refreshStyles(); }
  else if (kind === "part-removed") {
    dropView(partViews, id);
    state.parts = state.parts.filter((p) => p !== id);
    afterSelectionChange();
  } else if (kind === "part-moved") {
    partViews.get(id)?.applyPose(store.parts.get(id).pose);
    refreshLabels();
    if (state.parts.length === 1 && state.parts[0] === id) updatePoseFields($("inspector"), store.parts.get(id));
  } else if (kind === "structure-added") addStructureView(store.structures.get(id));
  else if (kind === "structure-removed") {
    dropView(structViews, id);
    if (state.structure === id) state.structure = null;
    afterSelectionChange();
  } else if (kind === "structure-changed") {
    structViews.get(id)?.update();
    refreshInspector();
  } else if (kind === "loaded") rebuildAll();
  scheduleSave();
});

// ---------- toolbar and keyboard ----------
document.querySelectorAll("#tools button").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool)));
$("btn-focus").addEventListener("click", focusSelection);
$("btn-back").addEventListener("click", exitFocus);
$("btn-fit").addEventListener("click", fitAll);
$("btn-undo").addEventListener("click", () => replay("undo"));
$("btn-save").addEventListener("click", () => download("robot-design.json", JSON.stringify(store.toJSON()), "application/json"));
$("btn-load").addEventListener("click", () => $("file-load").click());
$("btn-new").addEventListener("click", () => {
  if (!store.parts.size || confirm("Discard the current design and start a new one?")) store.clear();
});
$("file-load").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const warnings = store.load(JSON.parse(await file.text()), catalogByName);
    if (warnings.length) toast(warnings.join(" "), 9000);
  } catch (err) {
    toast(`Could not load that file: ${err.message}`);
  }
});

function changeBrush(factor) {
  const s = selectedStructure();
  if (!s || !state.brushRadius) return;
  state.brushRadius = Math.min(s.domain.cell * 12, Math.max(s.domain.cell, state.brushRadius * factor));
  refreshInspector();
}

document.addEventListener("keydown", (e) => {
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && key === "z") { e.preventDefault(); replay(e.shiftKey ? "redo" : "undo"); return; }
  if ((e.ctrlKey || e.metaKey) && key === "y") { e.preventDefault(); replay("redo"); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (key === "v") setTool("select");
  else if (key === "g") setTool("move");
  else if (key === "r") setTool("rotate");
  else if (key === "b") setTool("paint");
  else if (key === "e") setTool("erase");
  else if (key === "f") focusSelection();
  else if (key === "[") changeBrush(1 / 1.25);
  else if (key === "]") changeBrush(1.25);
  else if (key === "escape") {
    if (viewer.isFocused()) exitFocus();
    else if (isPaintTool()) setTool("select");
    else select([]);
  } else if (key === "delete" || key === "backspace") {
    if (state.structure) actions.removeStructure(state.structure);
    else [...state.parts].forEach((id) => store.removePart(id));
  }
});

// ---------- start-up ----------
function addFromCatalog(entry) {
  const parts = [...store.parts.values()];
  const x = parts.length
    ? Math.max(...parts.map((p) => p.pose.position[0] + p.entry.OD_mm / 2)) + entry.OD_mm / 2 + 30
    : 0;
  const part = store.addPart(entry, [x, 0, entry.L_mm / 2]);
  select([part.id]);
  const p = new THREE.Vector3(...part.pose.position).project(viewer.camera);
  if (parts.length === 0 || Math.abs(p.x) > 0.9 || Math.abs(p.y) > 0.9) fitAll();
}

async function start() {
  setTool("select");
  refreshInspector();
  refreshHint();
  try {
    const entries = await (await fetch("./api/catalog.json")).json();
    catalogByName = new Map(entries.map((e) => [e.name, e]));
    createCatalogPanel($("catalog"), entries, addFromCatalog);
  } catch (err) {
    $("catalog").textContent = `Could not load the actuator catalogue (${err.message}). Is server.py running?`;
    return;
  }
  try {
    const saved = localStorage.getItem(SAVE_KEY);
    if (saved) store.load(JSON.parse(saved), catalogByName);
  } catch { /* ignore a broken autosave */ }
}

window.__rd = { store, viewer, state, actions, partViews, structViews, select, setTool, pick, focusSelection, exitFocus };
start();
