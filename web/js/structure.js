// Logic for a structure (the painted part that connects two actuator mount faces).
// Pure functions (no three.js, no DOM). `parts` is the Map from store.js.

import { mountFaces, toWorldFace } from "./mounts.js";
import { domainFromFaces, markLocked, resample, stats } from "./domain.js";
import { dot, len, sub } from "./vec.js";

export const MATERIALS = {
  PLA: 1.24,
  PETG: 1.27,
  ABS: 1.04,
  "Nylon PA12": 1.01,
  "Aluminium 6061": 2.7,
  Steel: 7.85,
}; // density in g/cm^3

/** World-space mount face of a part. */
export function worldFaceOf(part, faceName) {
  return toWorldFace(mountFaces(part.entry)[faceName], part.pose);
}

/** Bodies of all parts, used for keep-out cells. */
export function bodiesOf(parts) {
  return [...parts.values()].map((p) => ({ entry: p.entry, pose: p.pose }));
}

const snapshotOf = (fa, fb) => ({
  a: { center: [...fa.center], normal: [...fa.normal] },
  b: { center: [...fb.center], normal: [...fb.normal] },
});

/** Faces of a structure in world space, from the parts' current poses. */
export function facesOf(structure, parts) {
  return [
    worldFaceOf(parts.get(structure.a.part), structure.a.face),
    worldFaceOf(parts.get(structure.b.part), structure.b.face),
  ];
}

/**
 * Build the pieces for a new structure between (partA, faceA) and (partB, faceB):
 * the locked voxel domain and the face snapshot used to detect later movement.
 */
export function buildStructure(partA, faceA, partB, faceB, parts, { pad = 10, maxCells = 40 } = {}) {
  const fa = worldFaceOf(partA, faceA);
  const fb = worldFaceOf(partB, faceB);
  const domain = domainFromFaces(fa, fb, { pad, maxCells });
  markLocked(domain, [fa, fb], bodiesOf(parts));
  return { domain, snapshot: snapshotOf(fa, fb), pad };
}

/** True if either connected face has moved since the domain was built or re-fitted. */
export function isStale(structure, parts) {
  const [fa, fb] = facesOf(structure, parts);
  const moved = (now, then) =>
    len(sub(now.center, then.center)) > 0.5 || dot(now.normal, then.normal) < 0.9999;
  return moved(fa, structure.snapshot.a) || moved(fb, structure.snapshot.b);
}

/** Recompute keep-out and interface cells (e.g. after loading a saved scene). */
export function relock(structure, parts) {
  markLocked(structure.domain, facesOf(structure, parts), bodiesOf(parts));
}

/** Build a new domain around the current faces and carry the painted cells over. */
export function refit(structure, parts, { maxCells = 40 } = {}) {
  const [fa, fb] = facesOf(structure, parts);
  const fresh = domainFromFaces(fa, fb, { pad: structure.pad, maxCells });
  resample(structure.domain, fresh);
  markLocked(fresh, [fa, fb], bodiesOf(parts));
  structure.domain = fresh;
  structure.snapshot = snapshotOf(fa, fb);
  return fresh;
}

/** Volume (cm^3) and mass (g) if every painted + interface cell were solid. */
export function solidEstimate(structure) {
  const s = stats(structure.domain);
  const volume_cm3 = s.volume_mm3 / 1000;
  const density = MATERIALS[structure.material] ?? MATERIALS.PLA;
  return { ...s, volume_cm3, mass_g: volume_cm3 * density };
}
