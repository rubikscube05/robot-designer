// Export the solid voxels (PAINT + INTERFACE) of a domain as a binary STL.
// Only faces between a solid cell and a non-solid cell are written. Units: millimetres.
// Pure function, no dependencies, so it can be unit-tested with `node --test`.

import { PAINT, INTERFACE, cellIndex } from "./domain.js";

const isSolid = (d, i, j, k) => {
  if (i < 0 || j < 0 || k < 0 || i >= d.dims[0] || j >= d.dims[1] || k >= d.dims[2]) return false;
  const v = d.data[cellIndex(d, i, j, k)];
  return v === PAINT || v === INTERFACE;
};

// For each of the 6 directions: outward normal and the 4 corner offsets (counter-clockwise
// when seen from outside), as unit-cube coordinates.
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];

/** Number of triangles the STL of this domain will contain. */
export function countTriangles(d) {
  let faces = 0;
  for (let k = 0; k < d.dims[2]; k++) {
    for (let j = 0; j < d.dims[1]; j++) {
      for (let i = 0; i < d.dims[0]; i++) {
        if (!isSolid(d, i, j, k)) continue;
        for (const f of FACES) {
          if (!isSolid(d, i + f.n[0], j + f.n[1], k + f.n[2])) faces++;
        }
      }
    }
  }
  return faces * 2;
}

/** Binary STL (Uint8Array) of the solid voxels. */
export function voxelsToStl(d) {
  const tris = countTriangles(d);
  const buf = new ArrayBuffer(84 + tris * 50);
  const view = new DataView(buf);
  new TextEncoder().encodeInto("robot-designer voxel export", new Uint8Array(buf, 0, 80));
  view.setUint32(80, tris, true);
  let off = 84;
  const put = (v) => {
    view.setFloat32(off, v, true);
    off += 4;
  };
  const vertex = (i, j, k, o) => [0, 1, 2].map((a) => d.min[a] + ([i, j, k][a] + o[a]) * d.cell);
  for (let k = 0; k < d.dims[2]; k++) {
    for (let j = 0; j < d.dims[1]; j++) {
      for (let i = 0; i < d.dims[0]; i++) {
        if (!isSolid(d, i, j, k)) continue;
        for (const f of FACES) {
          if (isSolid(d, i + f.n[0], j + f.n[1], k + f.n[2])) continue;
          const q = f.c.map((o) => vertex(i, j, k, o));
          for (const tri of [[q[0], q[1], q[2]], [q[0], q[2], q[3]]]) {
            f.n.forEach(put);
            tri.forEach((v) => v.forEach(put));
            view.setUint16(off, 0, true);
            off += 2;
          }
        }
      }
    }
  }
  return new Uint8Array(buf);
}
