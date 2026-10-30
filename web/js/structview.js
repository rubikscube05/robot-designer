// 3D view of a structure's voxel domain: painted cells (blue), locked interface cells
// (orange) and a wireframe of the domain box. One instanced cube per grid cell; cells that
// are not solid are scaled to zero, so painting only touches the cells that changed.

import * as THREE from "three";
import { cellCenter, PAINT, INTERFACE } from "./domain.js";

const COLORS = { [PAINT]: new THREE.Color(0x58b6ff), [INTERFACE]: new THREE.Color(0xffa13d) };

export function createStructureView(structure) {
  const group = new THREE.Group();
  group.userData.structureId = structure.id;
  const dummy = new THREE.Object3D();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  let mesh = null;
  let frame = null;

  function setCell(idx) {
    const d = structure.domain;
    const v = d.data[idx];
    if (v === PAINT || v === INTERFACE) {
      dummy.position.set(...cellCenter(d, idx));
      dummy.scale.setScalar(d.cell);
      dummy.updateMatrix();
      mesh.setMatrixAt(idx, dummy.matrix);
      mesh.setColorAt(idx, COLORS[v]);
    } else {
      mesh.setMatrixAt(idx, hidden);
    }
  }

  function disposeChildren() {
    for (const child of [...group.children]) {
      group.remove(child);
      child.geometry?.dispose();
      if (child.material) [].concat(child.material).forEach((m) => m.dispose());
    }
  }

  function build() {
    disposeChildren();
    const d = structure.domain;
    mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.1 }),
      d.data.length);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.setColorAt(0, COLORS[PAINT]); // creates the colour buffer up front
    for (let i = 0; i < d.data.length; i++) setCell(i);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.raycast = () => {}; // picking is done with the voxel ray cast instead
    group.add(mesh);

    const size = d.dims.map((n) => n * d.cell);
    frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(...size)),
      new THREE.LineBasicMaterial({ color: 0x6b7686 }));
    frame.position.set(...d.min.map((m, a) => m + size[a] / 2));
    frame.raycast = () => {};
    group.add(frame);
  }
  build();

  return {
    group,
    /** Update the given flat cell indices, or rebuild everything when called without them. */
    update(indices) {
      if (!indices) return build();
      for (const i of indices) setCell(i);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    },
    setDim(alpha) {
      const m = mesh.material;
      m.transparent = alpha < 1;
      m.opacity = alpha;
      m.depthWrite = alpha >= 1;
      m.needsUpdate = true;
      frame.visible = alpha >= 1;
    },
    /** Bounding sphere of the domain box, for the focus zoom. */
    sphere() {
      const d = structure.domain;
      const size = d.dims.map((n) => n * d.cell);
      return {
        center: d.min.map((m, a) => m + size[a] / 2),
        radius: Math.hypot(...size) / 2,
      };
    },
    dispose: disposeChildren,
  };
}
