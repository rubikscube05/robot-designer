// Mount faces and body shapes of an actuator, built from catalogue data.
// Pure functions (no three.js) so they can be unit-tested with `node --test`.
//
// Local frame of an actuator: millimetres, rotation axis = +Z.
//   housing (fixed side)  : the back face at z = -L/2, normal -Z
//   output flange (moving): the front face at z = +L/2, normal +Z
//
// The catalogue only has outer diameter and length, so the shape is a schematic
// (a housing cylinder plus a smaller output flange) and the bolt pattern is GENERIC.
// Real bolt circles must come from the vendor datasheet before manufacturing.

import { add, quatRotate, toWorldPoint, toLocalPoint } from "./vec.js";

export const FLANGE_LENGTH_FRACTION = 0.18; // flange length as a fraction of L
export const FLANGE_RADIUS_FRACTION = 0.35; // flange radius as a fraction of OD
export const HOUSING_BOLT_CIRCLE = 0.82; // bolt circle diameter as a fraction of OD
export const OUTPUT_BOLT_CIRCLE = 0.5;
export const BOLT_COUNT = 6;

/** The two mount faces of an actuator in its local frame. */
export function mountFaces(entry) {
  const OD = entry.OD_mm;
  const L = entry.L_mm;
  const holeDia = Math.max(3, 0.045 * OD);
  return {
    housing: {
      name: "housing",
      label: "Housing mount (fixed side)",
      center: [0, 0, -L / 2],
      normal: [0, 0, -1],
      radius: OD / 2,
      boltCircleDia: HOUSING_BOLT_CIRCLE * OD,
      holeCount: BOLT_COUNT,
      holeDia,
      generic: true,
    },
    output: {
      name: "output",
      label: "Output flange (rotating side)",
      center: [0, 0, L / 2],
      normal: [0, 0, 1],
      radius: FLANGE_RADIUS_FRACTION * OD,
      boltCircleDia: OUTPUT_BOLT_CIRCLE * OD,
      holeCount: BOLT_COUNT,
      holeDia,
      generic: true,
    },
  };
}

/** Cylinders that make up the actuator body, in the local frame. */
export function bodyShapes(entry) {
  const OD = entry.OD_mm;
  const L = entry.L_mm;
  const flangeLen = FLANGE_LENGTH_FRACTION * L;
  return [
    { name: "housing", radius: OD / 2, z0: -L / 2, z1: L / 2 - flangeLen },
    { name: "flange", radius: FLANGE_RADIUS_FRACTION * OD, z0: L / 2 - flangeLen, z1: L / 2 },
  ];
}

/** Positions of the bolt holes of a face, in the actuator's local frame. */
export function boltHolePositions(face) {
  const R = face.boltCircleDia / 2;
  const out = [];
  for (let i = 0; i < face.holeCount; i++) {
    const a = (2 * Math.PI * i) / face.holeCount;
    out.push(add(face.center, [R * Math.cos(a), R * Math.sin(a), 0]));
  }
  return out;
}

/** Same face, expressed in world coordinates for a given pose. */
export function toWorldFace(face, pose) {
  return {
    ...face,
    center: toWorldPoint(pose, face.center),
    normal: quatRotate(pose.quaternion, face.normal),
  };
}

/** Axis-aligned bounding box { min, max } of a (world) circular face. */
export function faceAabb(face) {
  const min = [0, 0, 0];
  const max = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const ext = face.radius * Math.sqrt(Math.max(0, 1 - face.normal[a] * face.normal[a]));
    min[a] = face.center[a] - ext;
    max[a] = face.center[a] + ext;
  }
  return { min, max };
}

/** True if a world point lies inside the actuator body placed at `pose`. */
export function insideBody(point, entry, pose) {
  const p = toLocalPoint(pose, point);
  const r = Math.hypot(p[0], p[1]);
  return bodyShapes(entry).some((s) => r <= s.radius && p[2] >= s.z0 && p[2] <= s.z1);
}
