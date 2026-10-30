import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../web/js/store.js";
import {
  buildStructure, isStale, refit, relock, solidEstimate, facesOf,
} from "../web/js/structure.js";
import { createDomain, paintSphere, stats, PAINT, cellIndex } from "../web/js/domain.js";
import { voxelsToStl, countTriangles } from "../web/js/stl.js";

const AK = { name: "AK80-6", OD_mm: 98, L_mm: 38.5 };
const R8 = { name: "R8-9", OD_mm: 156, L_mm: 51 };
const catalog = new Map([[AK.name, AK], [R8.name, R8]]);

function twoPartScene() {
  const store = createStore();
  const a = store.addPart(AK, [0, 0, 0]);
  const b = store.addPart(AK, [0, 0, 150]);
  const s = buildStructure(a, "output", b, "housing", store.parts, { pad: 10, maxCells: 40 });
  const structure = store.addStructure({ a: { part: a.id, face: "output" }, b: { part: b.id, face: "housing" }, ...s });
  return { store, a, b, structure };
}

test("store: add, move, duplicate, remove cascades to structures", () => {
  const { store, a, b, structure } = twoPartScene();
  const events = [];
  store.onChange((k, id) => events.push(k));
  store.setPose(b.id, { position: [5, 0, 150], quaternion: [0, 0, 0, 1] });
  assert.deepEqual(b.pose.position, [5, 0, 150]);
  const copy = store.duplicatePart(a.id, [200, 0, 0]);
  assert.deepEqual(copy.pose.position, [200, 0, 0]);
  assert.ok(store.structures.has(structure.id));
  store.removePart(a.id);
  assert.equal(store.structures.size, 0);
  assert.equal(store.parts.has(a.id), false);
  assert.ok(events.includes("structure-removed") && events.includes("part-removed"));
});

test("store: JSON round trip keeps parts, structure and painted cells", () => {
  const { store, structure } = twoPartScene();
  paintSphere(structure.domain, [0, 0, 75], 20, PAINT);
  const painted = stats(structure.domain).paint;
  assert.ok(painted > 0);
  const json = JSON.parse(JSON.stringify(store.toJSON()));
  const other = createStore();
  const warnings = other.load(json, catalog);
  assert.deepEqual(warnings, []);
  assert.equal(other.parts.size, 2);
  const s2 = [...other.structures.values()][0];
  relock(s2, other.parts);
  assert.equal(stats(s2.domain).paint, painted);
  assert.ok(stats(s2.domain).interface > 0 && stats(s2.domain).keepout > 0);
  // ids keep counting up after a load
  const extra = other.addPart(AK, [0, 0, 0]);
  assert.ok(!json.parts.some((p) => p.id === extra.id));
});

test("store: unknown actuators are skipped with a warning and their structures dropped", () => {
  const { store } = twoPartScene();
  const json = store.toJSON();
  const other = createStore();
  const warnings = other.load(json, new Map()); // empty catalogue
  assert.equal(other.parts.size, 0);
  assert.equal(other.structures.size, 0);
  assert.ok(warnings.length >= 3);
});

test("structure: locks, staleness, refit keeps paint", () => {
  const { store, b, structure } = twoPartScene();
  const s = stats(structure.domain);
  assert.ok(s.keepout > 0 && s.interface > 0);
  assert.equal(isStale(structure, store.parts), false);

  paintSphere(structure.domain, [0, 0, 75], 15, PAINT);
  const before = stats(structure.domain);
  const volumeBefore = before.paint * structure.domain.cell ** 3;
  assert.ok(before.paint > 0);

  store.setPose(b.id, { position: [0, 0, 170], quaternion: [0, 0, 0, 1] });
  assert.equal(isStale(structure, store.parts), true);

  refit(structure, store.parts);
  assert.equal(isStale(structure, store.parts), false);
  // The grid may get a different cell size, so the cell count changes; the volume should not.
  const after = stats(structure.domain);
  const volumeAfter = after.paint * structure.domain.cell ** 3;
  assert.ok(after.paint > 0);
  assert.ok(Math.abs(volumeAfter - volumeBefore) / volumeBefore < 0.3,
    `volume ${volumeBefore} -> ${volumeAfter}`);
  const [fa, fb] = facesOf(structure, store.parts);
  assert.ok(Math.abs(fb.center[2] - (170 - 19.25)) < 1e-9);
  assert.ok(fa.normal[2] === 1);
});

test("structure: solid volume and mass estimate follow the cell count and material", () => {
  const { structure } = twoPartScene();
  structure.domain = createDomain([0, 0, 0], [10, 10, 10], 2);
  structure.domain.data.fill(PAINT, 0, 10); // 10 cells of 2 mm = 80 mm^3
  structure.material = "Aluminium 6061";
  const e = solidEstimate(structure);
  assert.ok(Math.abs(e.volume_cm3 - 0.08) < 1e-9);
  assert.ok(Math.abs(e.mass_g - 0.08 * 2.7) < 1e-9);
});

test("stl: one cell = 12 triangles, two adjacent cells = 20, valid binary layout", () => {
  const d = createDomain([0, 0, 0], [3, 1, 1], 1);
  d.data[cellIndex(d, 0, 0, 0)] = PAINT;
  assert.equal(countTriangles(d), 12);
  let stl = voxelsToStl(d);
  assert.equal(stl.length, 84 + 12 * 50);
  assert.equal(new DataView(stl.buffer).getUint32(80, true), 12);
  d.data[cellIndex(d, 1, 0, 0)] = PAINT;
  assert.equal(countTriangles(d), 20);
  stl = voxelsToStl(d);
  assert.equal(stl.length, 84 + 20 * 50);
});

test("stl: triangle normals match their winding (outward)", () => {
  const d = createDomain([0, 0, 0], [1, 1, 1], 2);
  d.data[0] = PAINT;
  const v = new DataView(voxelsToStl(d).buffer);
  for (let t = 0; t < 12; t++) {
    const o = 84 + t * 50;
    const f = (n) => v.getFloat32(o + n * 4, true);
    const nrm = [f(0), f(1), f(2)];
    const p = [[f(3), f(4), f(5)], [f(6), f(7), f(8)], [f(9), f(10), f(11)]];
    const e1 = p[1].map((x, i) => x - p[0][i]);
    const e2 = p[2].map((x, i) => x - p[0][i]);
    const c = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    assert.ok(c[0] * nrm[0] + c[1] * nrm[1] + c[2] * nrm[2] > 0, `triangle ${t} winding`);
  }
});
