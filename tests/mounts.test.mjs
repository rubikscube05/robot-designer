import test from "node:test";
import assert from "node:assert/strict";
import {
  mountFaces, bodyShapes, boltHolePositions, toWorldFace, faceAabb, insideBody,
} from "../web/js/mounts.js";
import { quatFromTo, quatRotate, toWorldPoint, toLocalPoint } from "../web/js/vec.js";

const AK80_6 = { name: "AK80-6", OD_mm: 98, L_mm: 38.5 };
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const nearV = (a, b, eps = 1e-6) => a.forEach((v, i) => near(v, b[i], eps));
const IDENT = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };

test("mountFaces: housing at back, output at front, generic pattern", () => {
  const f = mountFaces(AK80_6);
  nearV(f.housing.center, [0, 0, -19.25]);
  nearV(f.housing.normal, [0, 0, -1]);
  nearV(f.output.center, [0, 0, 19.25]);
  nearV(f.output.normal, [0, 0, 1]);
  near(f.housing.radius, 49);
  near(f.housing.boltCircleDia, 0.82 * 98);
  assert.equal(f.housing.generic, true);
  assert.equal(f.output.holeCount, 6);
});

test("bodyShapes: housing + flange fill the full length", () => {
  const [h, fl] = bodyShapes(AK80_6);
  near(h.z0, -19.25);
  near(fl.z1, 19.25);
  near(h.z1, fl.z0);
});

test("boltHolePositions lie on the bolt circle", () => {
  const face = mountFaces(AK80_6).housing;
  const holes = boltHolePositions(face);
  assert.equal(holes.length, 6);
  for (const p of holes) {
    near(Math.hypot(p[0], p[1]), face.boltCircleDia / 2);
    near(p[2], face.center[2]);
  }
});

test("quatFromTo rotates a onto b (including opposite vectors)", () => {
  for (const [a, b] of [[[0, 0, 1], [1, 0, 0]], [[0, 0, 1], [0, 0, -1]], [[0, 0, 1], [0, 1, 1]]]) {
    const q = quatFromTo(a, b);
    const bn = Math.hypot(...b);
    nearV(quatRotate(q, a), b.map((v) => v / bn), 1e-9);
  }
});

test("world/local point conversion round trip", () => {
  const pose = { position: [10, -5, 3], quaternion: quatFromTo([0, 0, 1], [1, 1, 0]) };
  const p = [1, 2, 3];
  nearV(toLocalPoint(pose, toWorldPoint(pose, p)), p, 1e-9);
});

test("toWorldFace follows the pose", () => {
  const pose = { position: [100, 0, 0], quaternion: quatFromTo([0, 0, 1], [1, 0, 0]) }; // axis -> +X
  const out = toWorldFace(mountFaces(AK80_6).output, pose);
  nearV(out.normal, [1, 0, 0], 1e-9);
  nearV(out.center, [119.25, 0, 0], 1e-9);
});

test("faceAabb of a disc facing +Z is flat in Z", () => {
  const out = toWorldFace(mountFaces(AK80_6).output, IDENT);
  const box = faceAabb(out);
  near(box.min[2], 19.25);
  near(box.max[2], 19.25);
  near(box.max[0], out.radius);
  near(box.min[1], -out.radius);
});

test("insideBody: centre inside, far point outside, beyond output face outside", () => {
  assert.equal(insideBody([0, 0, 0], AK80_6, IDENT), true);
  assert.equal(insideBody([0, 0, 25], AK80_6, IDENT), false);
  assert.equal(insideBody([60, 0, 0], AK80_6, IDENT), false);
  // flange is narrower than the housing: point at r=40 near the front is outside the body
  assert.equal(insideBody([40, 0, 18], AK80_6, IDENT), false);
  assert.equal(insideBody([40, 0, 0], AK80_6, IDENT), true);
});
