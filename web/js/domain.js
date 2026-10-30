// Voxel "design domain" between two actuator mount faces.
// Pure functions (no three.js) so they can be unit-tested with `node --test`.
//
// A domain is an axis-aligned grid in world millimetres:
//   { min: [x,y,z], cell: mm, dims: [nx,ny,nz], data: Uint8Array }   index = i + nx*(j + ny*k)
// Cell values:
//   EMPTY     0  no material allowed
//   PAINT     1  painted by the user: material may exist here (design space)
//   INTERFACE 2  touches an actuator mount face: always solid, cannot be erased
//   KEEPOUT   3  inside an actuator body: never material, cannot be painted

import { add, sub, scale, dot, len, norm } from "./vec.js";
import { faceAabb, insideBody } from "./mounts.js";

export const EMPTY = 0;
export const PAINT = 1;
export const INTERFACE = 2;
export const KEEPOUT = 3;

/** Create an empty domain covering [min, max] with cubic cells of size `cell`. */
export function createDomain(min, max, cell) {
  const dims = [0, 1, 2].map((a) => Math.max(1, Math.ceil((max[a] - min[a]) / cell - 1e-9)));
  return { min: [...min], cell, dims, data: new Uint8Array(dims[0] * dims[1] * dims[2]) };
}

/** Domain bounding two world faces, with padding. Cell size is chosen automatically. */
export function domainFromFaces(faceA, faceB, { pad = 10, maxCells = 40, minCell = 1 } = {}) {
  const a = faceAabb(faceA);
  const b = faceAabb(faceB);
  const min = [0, 1, 2].map((i) => Math.min(a.min[i], b.min[i]) - pad);
  const max = [0, 1, 2].map((i) => Math.max(a.max[i], b.max[i]) + pad);
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const cell = Math.max(minCell, Math.ceil((extent / maxCells) * 2) / 2); // round up to 0.5 mm
  return createDomain(min, max, cell);
}

export const cellIndex = (d, i, j, k) => i + d.dims[0] * (j + d.dims[1] * k);

/** Grid coordinates [i,j,k] of a flat index. */
export function cellCoords(d, idx) {
  const nx = d.dims[0];
  const ny = d.dims[1];
  return [idx % nx, Math.floor(idx / nx) % ny, Math.floor(idx / (nx * ny))];
}

/** World position of the centre of a cell. */
export function cellCenter(d, idx) {
  const c = cellCoords(d, idx);
  return [0, 1, 2].map((a) => d.min[a] + (c[a] + 0.5) * d.cell);
}

/** Grid coordinates of a world point, or null if outside the domain. */
export function worldToCell(d, p) {
  const c = [0, 1, 2].map((a) => Math.floor((p[a] - d.min[a]) / d.cell));
  return c.every((v, a) => v >= 0 && v < d.dims[a]) ? c : null;
}

/**
 * Lock cells: KEEPOUT inside any actuator body, then INTERFACE in the first layer of
 * cells just outside each given (world) face. `bodies` = [{ entry, pose }].
 * Existing locks are cleared first; painted cells under a lock are discarded.
 */
export function markLocked(d, faces, bodies) {
  for (let idx = 0; idx < d.data.length; idx++) {
    if (d.data[idx] >= INTERFACE) d.data[idx] = EMPTY;
  }
  for (let idx = 0; idx < d.data.length; idx++) {
    const c = cellCenter(d, idx);
    if (bodies.some((b) => insideBody(c, b.entry, b.pose))) d.data[idx] = KEEPOUT;
  }
  for (const face of faces) {
    for (let idx = 0; idx < d.data.length; idx++) {
      if (d.data[idx] === KEEPOUT) continue;
      const v = sub(cellCenter(d, idx), face.center);
      const h = dot(v, face.normal);
      if (h <= 0 || h > d.cell) continue;
      const radial = len(sub(v, scale(face.normal, h)));
      if (radial <= face.radius + 0.5 * d.cell) d.data[idx] = INTERFACE;
    }
  }
  return d;
}

/**
 * Paint (value 1) or erase (value 0) all cells whose centre is within `radius` of `center`.
 * Locked cells are never changed. Returns the list of changed flat indices.
 */
export function paintSphere(d, center, radius, value) {
  const changed = [];
  const lo = [0, 1, 2].map((a) =>
    Math.max(0, Math.floor((center[a] - radius - d.min[a]) / d.cell)));
  const hi = [0, 1, 2].map((a) =>
    Math.min(d.dims[a] - 1, Math.floor((center[a] + radius - d.min[a]) / d.cell)));
  const r2 = radius * radius;
  for (let k = lo[2]; k <= hi[2]; k++) {
    for (let j = lo[1]; j <= hi[1]; j++) {
      for (let i = lo[0]; i <= hi[0]; i++) {
        const idx = cellIndex(d, i, j, k);
        const cur = d.data[idx];
        if (cur >= INTERFACE || cur === value) continue;
        const dx = d.min[0] + (i + 0.5) * d.cell - center[0];
        const dy = d.min[1] + (j + 0.5) * d.cell - center[1];
        const dz = d.min[2] + (k + 0.5) * d.cell - center[2];
        if (dx * dx + dy * dy + dz * dz <= r2) {
          d.data[idx] = value;
          changed.push(idx);
        }
      }
    }
  }
  return changed;
}

/** Paint every free cell. Returns changed indices. */
export function fillAll(d) {
  const changed = [];
  for (let idx = 0; idx < d.data.length; idx++) {
    if (d.data[idx] === EMPTY) {
      d.data[idx] = PAINT;
      changed.push(idx);
    }
  }
  return changed;
}

/** Erase every painted cell (locks stay). Returns changed indices. */
export function clearPaint(d) {
  const changed = [];
  for (let idx = 0; idx < d.data.length; idx++) {
    if (d.data[idx] === PAINT) {
      d.data[idx] = EMPTY;
      changed.push(idx);
    }
  }
  return changed;
}

/**
 * Cast a ray through the domain (Amanatides-Woo grid traversal).
 * Returns null if the ray misses the domain box. Otherwise returns
 *   { hitSolid, index, cell:[i,j,k], point:[x,y,z], normal:[x,y,z]|null }
 * where hitSolid is true if the first PAINT/INTERFACE cell was hit, and false if the ray
 * only reached the outside of the box (then `point`/`normal` describe the box surface).
 */
export function raycast(d, origin, dir) {
  dir = norm(dir);
  const max = [0, 1, 2].map((a) => d.min[a] + d.dims[a] * d.cell);

  // Slab test against the box.
  let tmin = -Infinity;
  let tmax = Infinity;
  let entryAxis = -1;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(dir[a]) < 1e-12) {
      if (origin[a] < d.min[a] || origin[a] > max[a]) return null;
      continue;
    }
    let t1 = (d.min[a] - origin[a]) / dir[a];
    let t2 = (max[a] - origin[a]) / dir[a];
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) {
      tmin = t1;
      entryAxis = a;
    }
    tmax = Math.min(tmax, t2);
  }
  if (tmax < Math.max(tmin, 0)) return null;

  const t0 = Math.max(tmin, 0);
  let normal = null;
  if (tmin > 0 && entryAxis >= 0) {
    normal = [0, 0, 0];
    normal[entryAxis] = dir[entryAxis] > 0 ? -1 : 1;
  }

  const p0 = add(origin, scale(dir, t0));
  const cell = [0, 1, 2].map((a) =>
    Math.min(d.dims[a] - 1, Math.max(0, Math.floor((p0[a] - d.min[a]) / d.cell))));
  const step = dir.map((v) => (v > 0 ? 1 : -1));
  const tDelta = dir.map((v) => (Math.abs(v) < 1e-12 ? Infinity : d.cell / Math.abs(v)));
  const tNext = [0, 1, 2].map((a) => {
    if (Math.abs(dir[a]) < 1e-12) return Infinity;
    const boundary = d.min[a] + (cell[a] + (step[a] > 0 ? 1 : 0)) * d.cell;
    return (boundary - origin[a]) / dir[a];
  });

  const first = { cell: [...cell], t: t0, normal };
  let t = t0;
  for (;;) {
    const idx = cellIndex(d, cell[0], cell[1], cell[2]);
    const v = d.data[idx];
    if (v === PAINT || v === INTERFACE) {
      return { hitSolid: true, index: idx, cell: [...cell], point: add(origin, scale(dir, t)), normal };
    }
    let a = 0;
    if (tNext[1] < tNext[a]) a = 1;
    if (tNext[2] < tNext[a]) a = 2;
    if (!isFinite(tNext[a])) break;
    t = tNext[a];
    tNext[a] += tDelta[a];
    cell[a] += step[a];
    if (cell[a] < 0 || cell[a] >= d.dims[a]) break;
    normal = [0, 0, 0];
    normal[a] = -step[a];
  }
  return {
    hitSolid: false,
    index: cellIndex(d, first.cell[0], first.cell[1], first.cell[2]),
    cell: first.cell,
    point: add(origin, scale(dir, first.t)),
    normal: first.normal,
  };
}

/** Copy the painted cells of `oldD` into `newD` (by world position). Returns newD. */
export function resample(oldD, newD) {
  for (let idx = 0; idx < oldD.data.length; idx++) {
    if (oldD.data[idx] !== PAINT) continue;
    const c = worldToCell(newD, cellCenter(oldD, idx));
    if (!c) continue;
    const ni = cellIndex(newD, c[0], c[1], c[2]);
    if (newD.data[ni] === EMPTY) newD.data[ni] = PAINT;
  }
  return newD;
}

/** Cell counts and solid volume (painted + interface cells). */
export function stats(d) {
  const s = { paint: 0, interface: 0, keepout: 0, volume_mm3: 0 };
  for (const v of d.data) {
    if (v === PAINT) s.paint++;
    else if (v === INTERFACE) s.interface++;
    else if (v === KEEPOUT) s.keepout++;
  }
  s.volume_mm3 = (s.paint + s.interface) * d.cell ** 3;
  return s;
}

/** Compact JSON form: only painted cells are stored (locks are recomputed on load). */
export function encode(d) {
  const rle = [];
  let cur = -1;
  let count = 0;
  for (const raw of d.data) {
    const v = raw === PAINT ? 1 : 0;
    if (v === cur) count++;
    else {
      if (count) rle.push([cur, count]);
      cur = v;
      count = 1;
    }
  }
  if (count) rle.push([cur, count]);
  return { min: d.min, cell: d.cell, dims: d.dims, rle };
}

/** Inverse of encode(). */
export function decode(obj) {
  const d = {
    min: [...obj.min],
    cell: obj.cell,
    dims: [...obj.dims],
    data: new Uint8Array(obj.dims[0] * obj.dims[1] * obj.dims[2]),
  };
  let pos = 0;
  for (const [v, n] of obj.rle) {
    if (v) d.data.fill(PAINT, pos, pos + n);
    pos += n;
  }
  return d;
}
