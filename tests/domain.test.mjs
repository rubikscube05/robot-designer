import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY, PAINT, INTERFACE, KEEPOUT,
  createDomain, domainFromFaces, cellIndex, cellCenter, worldToCell, markLocked, paintSphere,
  fillAll, clearPaint, raycast, resample, stats, encode, decode,
} from "../web/js/domain.js";
import { mountFaces, toWorldFace } from "../web/js/mounts.js";
import { quatFromTo } from "../web/js/vec.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const nearV = (a, b, eps = 1e-6) => a.forEach((v, i) => near(v, b[i], eps));
const unit = () => createDomain([0, 0, 0], [10, 10, 10], 1);
const AK = { name: "AK80-6", OD_mm: 98, L_mm: 38.5 };

test("createDomain: dims, indexing and centres", () => {
  const d = createDomain([0, 0, 0], [10, 6, 4.5], 1);
  assert.deepEqual(d.dims, [10, 6, 5]);
  assert.equal(d.data.length, 300);
  const idx = cellIndex(d, 3, 2, 1);
  nearV(cellCenter(d, idx), [3.5, 2.5, 1.5]);
  assert.deepEqual(worldToCell(d, [3.9, 2.1, 1.7]), [3, 2, 1]);
  assert.equal(worldToCell(d, [-0.1, 0, 0]), null);
});

test("paintSphere paints cells within radius and erase restores", () => {
  const d = unit();
  const changed = paintSphere(d, [5, 5, 5], 2, PAINT);
  assert.ok(changed.length > 20);
  for (const idx of changed) {
    const c = cellCenter(d, idx);
    assert.ok(Math.hypot(c[0] - 5, c[1] - 5, c[2] - 5) <= 2 + 1e-9);
  }
  assert.equal(stats(d).paint, changed.length);
  paintSphere(d, [5, 5, 5], 2, EMPTY);
  assert.equal(stats(d).paint, 0);
});

test("locked cells are never painted or erased", () => {
  const d = unit();
  d.data[cellIndex(d, 5, 5, 5)] = INTERFACE;
  d.data[cellIndex(d, 4, 5, 5)] = KEEPOUT;
  paintSphere(d, [5, 5, 5], 3, PAINT);
  assert.equal(d.data[cellIndex(d, 5, 5, 5)], INTERFACE);
  assert.equal(d.data[cellIndex(d, 4, 5, 5)], KEEPOUT);
  paintSphere(d, [5, 5, 5], 3, EMPTY);
  assert.equal(d.data[cellIndex(d, 5, 5, 5)], INTERFACE);
  assert.equal(d.data[cellIndex(d, 4, 5, 5)], KEEPOUT);
});

test("fillAll and clearPaint", () => {
  const d = unit();
  d.data[0] = KEEPOUT;
  fillAll(d);
  assert.equal(stats(d).paint, 999);
  clearPaint(d);
  assert.equal(stats(d).paint, 0);
  assert.equal(d.data[0], KEEPOUT);
});

test("raycast on an empty domain returns the box entry point", () => {
  const d = unit();
  const hit = raycast(d, [-5, 5.5, 5.5], [1, 0, 0]);
  assert.equal(hit.hitSolid, false);
  near(hit.point[0], 0);
  nearV(hit.normal, [-1, 0, 0]);
  assert.equal(raycast(d, [-5, 20, 5], [1, 0, 0]), null); // misses the box
});

test("raycast hits the first painted cell with the right face normal", () => {
  const d = unit();
  d.data[cellIndex(d, 2, 5, 5)] = PAINT;
  d.data[cellIndex(d, 7, 5, 5)] = PAINT;
  let hit = raycast(d, [-5, 5.5, 5.5], [1, 0, 0]);
  assert.equal(hit.hitSolid, true);
  assert.equal(hit.index, cellIndex(d, 2, 5, 5));
  near(hit.point[0], 2);
  nearV(hit.normal, [-1, 0, 0]);
  // from the other side the cell at x=7 is hit first, through its +X face
  hit = raycast(d, [20, 5.5, 5.5], [-1, 0, 0]);
  assert.equal(hit.index, cellIndex(d, 7, 5, 5));
  near(hit.point[0], 8);
  nearV(hit.normal, [1, 0, 0]);
  // from above
  d.data[cellIndex(d, 5, 5, 7)] = PAINT;
  hit = raycast(d, [5.5, 5.5, 30], [0, 0, -1]);
  assert.equal(hit.index, cellIndex(d, 5, 5, 7));
  near(hit.point[2], 8);
  nearV(hit.normal, [0, 0, 1]);
});

test("raycast from inside the box and along a diagonal", () => {
  const d = unit();
  d.data[cellIndex(d, 8, 8, 8)] = PAINT;
  const hit = raycast(d, [0.2, 0.2, 0.2], [1, 1, 1]);
  assert.equal(hit.hitSolid, true);
  assert.equal(hit.index, cellIndex(d, 8, 8, 8));
  const inside = raycast(d, [5.5, 5.5, 5.5], [1, 0, 0]);
  assert.equal(inside.hitSolid, false);
  assert.equal(inside.normal, null);
});

test("markLocked: keep-out inside the body, interface layer outside the face", () => {
  const face = toWorldFace(mountFaces(AK).output, { position: [0, 0, 0], quaternion: [0, 0, 0, 1] });
  const d = createDomain([-60, -60, -30], [60, 60, 50], 2);
  markLocked(d, [face], [{ entry: AK, pose: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] } }]);
  const at = (x, y, z) => d.data[cellIndex(d, ...worldToCell(d, [x, y, z]))];
  assert.equal(at(0, 0, 0), KEEPOUT);
  assert.equal(at(0, 0, 20.5), INTERFACE); // first layer just outside the output face (z=19.25)
  assert.equal(at(0, 0, 24.5), EMPTY); // further out is free
  assert.equal(at(30, 0, 20.5), INTERFACE); // still inside the flange radius (34.3 mm)
  assert.equal(at(40, 0, 20.5), EMPTY); // outside flange radius + half a cell
  const s = stats(d);
  assert.ok(s.keepout > 0 && s.interface > 0);
  // locks are recomputed, not accumulated
  markLocked(d, [], []);
  assert.equal(stats(d).keepout, 0);
});

test("domainFromFaces covers both faces with padding and a sane cell size", () => {
  const a = toWorldFace(mountFaces(AK).output, { position: [0, 0, 0], quaternion: [0, 0, 0, 1] });
  const b = toWorldFace(mountFaces(AK).housing, {
    position: [0, 0, 150],
    quaternion: quatFromTo([0, 0, 1], [0, 0, 1]),
  });
  const d = domainFromFaces(a, b, { pad: 10, maxCells: 40 });
  assert.ok(d.dims.every((n) => n <= 41));
  assert.ok(d.min[2] <= a.center[2] - 10 + 1e-9);
  const top = d.min[2] + d.dims[2] * d.cell;
  assert.ok(top >= b.center[2] + 10 - 1e-9);
});

test("resample keeps painted cells that still fit", () => {
  const a = createDomain([0, 0, 0], [10, 10, 10], 1);
  paintSphere(a, [5, 5, 5], 2, PAINT);
  const b = createDomain([5, 5, 5], [15, 15, 15], 1); // only the upper corner of the sphere fits
  resample(a, b);
  assert.ok(stats(b).paint > 0 && stats(b).paint < stats(a).paint);
});

test("encode/decode round trip keeps painted cells only", () => {
  const d = unit();
  paintSphere(d, [5, 5, 5], 3, PAINT);
  d.data[0] = INTERFACE;
  const copy = decode(JSON.parse(JSON.stringify(encode(d))));
  assert.deepEqual(copy.dims, d.dims);
  assert.equal(stats(copy).paint, stats(d).paint);
  assert.equal(copy.data[0], EMPTY); // locks are not stored
});
