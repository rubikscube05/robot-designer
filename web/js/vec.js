// Tiny vector and quaternion helpers. Pure functions on plain arrays, no dependencies.
// Vectors are [x, y, z]; quaternions are [x, y, z, w] (same order as three.js).

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => {
  const l = len(a);
  return l > 0 ? scale(a, 1 / l) : [0, 0, 0];
};

export const QUAT_IDENTITY = [0, 0, 0, 1];

/** Rotate vector v by unit quaternion q. */
export function quatRotate(q, v) {
  const u = [q[0], q[1], q[2]];
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q[3])), cross(u, t));
}

/** Conjugate (= inverse for a unit quaternion). */
export const quatConjugate = (q) => [-q[0], -q[1], -q[2], q[3]];

/** Smallest rotation that turns unit vector a into unit vector b. */
export function quatFromTo(a, b) {
  a = norm(a);
  b = norm(b);
  const d = dot(a, b);
  if (d > 1 - 1e-9) return [0, 0, 0, 1];
  if (d < -1 + 1e-9) {
    // Opposite vectors: rotate 180 degrees about any axis perpendicular to a.
    let axis = cross([1, 0, 0], a);
    if (len(axis) < 1e-6) axis = cross([0, 1, 0], a);
    axis = norm(axis);
    return [axis[0], axis[1], axis[2], 0];
  }
  const c = cross(a, b);
  const q = [c[0], c[1], c[2], 1 + d];
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** Pose = { position: [x,y,z], quaternion: [x,y,z,w] }. Local point -> world point. */
export const toWorldPoint = (pose, p) => add(pose.position, quatRotate(pose.quaternion, p));

/** World point -> local point of a pose. */
export const toLocalPoint = (pose, p) =>
  quatRotate(quatConjugate(pose.quaternion), sub(p, pose.position));
