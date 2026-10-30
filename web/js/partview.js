// 3D view of one actuator: schematic body plus the mount-face overlay (shown on selection).

import * as THREE from "three";
import { mountFaces, bodyShapes, boltHolePositions } from "./mounts.js";

const BODY_COLORS = { QDD: 0x4f8fba, MidGear: 0xc08a4a, Harmonic: 0x8a6fc0 };
const FACE_COLORS = { housing: 0x3aa0ff, output: 0xff9a3a };

/** Make an object (and children) invisible to raycasting so only the body is pickable. */
function ignoreRaycast(obj) {
  obj.traverse((o) => {
    o.raycast = () => {};
  });
  return obj;
}

function faceOverlay(face) {
  const g = new THREE.Group();
  const z = face.center[2];
  const s = face.normal[2]; // +1 or -1: which way is "outwards" along the axis

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(face.radius, 64),
    new THREE.MeshBasicMaterial({
      color: FACE_COLORS[face.name], transparent: true, opacity: 0.32, side: THREE.DoubleSide,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }),
  );
  disc.position.z = z + s * 0.3;
  g.add(disc);

  const ringPts = [];
  const R = face.boltCircleDia / 2;
  for (let i = 0; i <= 64; i++) {
    const a = (2 * Math.PI * i) / 64;
    ringPts.push(new THREE.Vector3(R * Math.cos(a), R * Math.sin(a), z + s * 0.6));
  }
  g.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPts),
    new THREE.LineBasicMaterial({ color: 0xffffff })));

  const holeMat = new THREE.MeshBasicMaterial({ color: 0x0a0c10, side: THREE.DoubleSide });
  const holeGeo = new THREE.CircleGeometry(face.holeDia / 2, 24);
  for (const p of boltHolePositions(face)) {
    const hole = new THREE.Mesh(holeGeo, holeMat);
    hole.position.set(p[0], p[1], p[2] + s * 0.9);
    g.add(hole);
  }
  return g;
}

export function createPartView(part) {
  const entry = part.entry;
  const group = new THREE.Group();
  group.userData.partId = part.id;

  const base = new THREE.Color(BODY_COLORS[entry.category] ?? 0x8a8f98);
  const materials = [];
  const outlines = new THREE.Group();
  const overlay = new THREE.Group();

  for (const shape of bodyShapes(entry)) {
    const geo = new THREE.CylinderGeometry(shape.radius, shape.radius, shape.z1 - shape.z0, 64);
    geo.rotateX(Math.PI / 2); // cylinder axis Y -> Z
    geo.translate(0, 0, (shape.z0 + shape.z1) / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: shape.name === "flange" ? base.clone().offsetHSL(0, 0, 0.14) : base.clone(),
      metalness: 0.4, roughness: 0.45,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.partId = part.id;
    group.add(mesh);
    materials.push(mat);
    outlines.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25),
      new THREE.LineBasicMaterial({ color: 0xffe08a })));
  }
  outlines.visible = false;
  group.add(ignoreRaycast(outlines));

  for (const face of Object.values(mountFaces(entry))) overlay.add(faceOverlay(face));
  overlay.add(new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, entry.L_mm / 2),
    entry.OD_mm * 0.55, 0xffd34d, entry.OD_mm * 0.12, entry.OD_mm * 0.07));
  overlay.visible = false;
  group.add(ignoreRaycast(overlay));

  return {
    group,
    applyPose(pose) {
      group.position.set(...pose.position);
      group.quaternion.set(...pose.quaternion);
    },
    setSelected(on) {
      outlines.visible = on;
    },
    setOverlay(on) {
      overlay.visible = on;
    },
    setDim(alpha) {
      for (const m of materials) {
        m.transparent = alpha < 1;
        m.opacity = alpha;
        m.depthWrite = alpha >= 1;
        m.needsUpdate = true;
      }
    },
    dispose() {
      group.traverse((o) => {
        o.geometry?.dispose();
        if (o.material) [].concat(o.material).forEach((m) => m.dispose());
      });
    },
  };
}
