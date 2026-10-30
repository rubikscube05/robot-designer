// Viewer: renderer, camera, orbit/transform controls, and the animated "focus" zoom.
// Scene units are millimetres, Z is up.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";

const DEFAULT_BUTTONS = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
const PAINT_BUTTONS = { LEFT: -1, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };

export function createViewer(canvas, container) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14171c);

  const camera = new THREE.PerspectiveCamera(40, 1, 1, 50000);
  camera.up.set(0, 0, 1);
  const home = { position: new THREE.Vector3(380, -520, 320), target: new THREE.Vector3(0, 0, 40) };
  camera.position.copy(home.position);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.target.copy(home.target);
  controls.mouseButtons = { ...DEFAULT_BUTTONS };
  controls.update();

  // Lights, ground grid (XY plane) and a small axes marker at the origin.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x2b303a, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(300, -200, 500);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9db8ff, 0.6);
  fill.position.set(-300, 300, 100);
  scene.add(fill);
  const grid = new THREE.GridHelper(2000, 40, 0x3a4250, 0x242a33);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -0.5;
  scene.add(grid);
  scene.add(new THREE.AxesHelper(60));

  const transform = new TransformControls(camera, canvas);
  transform.setSize(0.8);
  transform.addEventListener("dragging-changed", (e) => {
    controls.enabled = !e.value;
  });
  scene.add(transform.getHelper());

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  // --- animated camera moves ---
  let anim = null;
  let savedView = null;
  function flyTo(position, target, ms = 450) {
    anim = {
      t0: performance.now(), ms,
      p0: camera.position.clone(), p1: position.clone(),
      q0: controls.target.clone(), q1: target.clone(),
    };
  }

  /** Zoom so that a sphere (centre, radius in mm) fills the view, keeping the view direction. */
  function focusOn(center, radius) {
    if (!savedView) {
      savedView = { position: camera.position.clone(), target: controls.target.clone() };
    }
    const c = new THREE.Vector3(...center);
    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(1, -1, 0.6);
    dir.normalize();
    const vHalf = THREE.MathUtils.degToRad(camera.fov) / 2;
    const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
    const dist = (radius / Math.sin(Math.min(vHalf, hHalf))) * 1.1;
    flyTo(c.clone().add(dir.multiplyScalar(dist)), c);
  }

  /** Return to the view from before the first focusOn(). */
  function restoreView() {
    if (!savedView) return;
    flyTo(savedView.position, savedView.target);
    savedView = null;
  }

  /** Fit a list of spheres [{ center, radius }]; falls back to the home view. */
  function fitAll(spheres) {
    savedView = null;
    if (!spheres.length) {
      flyTo(home.position, home.target);
      return;
    }
    const box = new THREE.Box3();
    for (const s of spheres) {
      const c = new THREE.Vector3(...s.center);
      box.expandByPoint(c.clone().addScalar(s.radius));
      box.expandByPoint(c.clone().addScalar(-s.radius));
    }
    const c = box.getCenter(new THREE.Vector3());
    const r = box.getSize(new THREE.Vector3()).length() / 2;
    focusOn([c.x, c.y, c.z], r);
    savedView = null;
  }

  const frameHooks = new Set();
  renderer.setAnimationLoop(() => {
    if (anim) {
      const k = Math.min(1, (performance.now() - anim.t0) / anim.ms);
      const e = 1 - Math.pow(1 - k, 3);
      camera.position.lerpVectors(anim.p0, anim.p1, e);
      controls.target.lerpVectors(anim.q0, anim.q1, e);
      if (k >= 1) anim = null;
    }
    controls.update();
    frameHooks.forEach((fn) => fn());
    renderer.render(scene, camera);
  });

  return {
    renderer, scene, camera, controls, transform, raycaster,
    /** THREE.Ray under the mouse for a pointer event. */
    rayFromEvent(ev) {
      const r = canvas.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      return raycaster.ray;
    },
    focusOn, restoreView, fitAll,
    isFocused: () => savedView !== null,
    onFrame(fn) {
      frameHooks.add(fn);
    },
    /** In paint mode the left button paints, so orbiting moves to the right button. */
    setPaintMode(on) {
      controls.mouseButtons = { ...(on ? PAINT_BUTTONS : DEFAULT_BUTTONS) };
    },
  };
}
