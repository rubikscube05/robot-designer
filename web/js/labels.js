// HTML labels pinned to 3D positions (used for the mount-face callouts).

import * as THREE from "three";

export function createLabelLayer(container, camera, renderer) {
  let items = []; // { el, position: THREE.Vector3 }
  const v = new THREE.Vector3();

  function clear() {
    for (const it of items) it.el.remove();
    items = [];
  }

  return {
    /** Replace all labels. Each entry: { position:[x,y,z], text, kind } */
    set(list) {
      clear();
      for (const l of list) {
        const el = document.createElement("div");
        el.className = `label ${l.kind ?? ""}`;
        el.textContent = l.text;
        container.appendChild(el);
        items.push({ el, position: new THREE.Vector3(...l.position) });
      }
    },
    clear,
    /** Call once per frame. */
    update() {
      const w = renderer.domElement.clientWidth;
      const h = renderer.domElement.clientHeight;
      for (const it of items) {
        v.copy(it.position).project(camera);
        if (v.z > 1 || v.z < -1) {
          it.el.style.display = "none";
          continue;
        }
        it.el.style.display = "block";
        it.el.style.transform =
          `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px) translate(-50%, -120%)`;
      }
    },
  };
}
