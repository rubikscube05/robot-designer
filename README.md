# Robot Designer (local)

Browser-based tool to place real actuators, zoom in on any part to see its mount faces and
bolt holes, connect two actuators, and paint the structure between them. Runs only on your
machine (127.0.0.1); no internet needed.

## Run

    python3 server.py            # then open http://127.0.0.1:8000

Python 3.9+ only (standard library). three.js is bundled in `web/vendor/`.

## Use

1. Click an actuator in the left list to add it (114 from the Draft catalogue).
2. Click it in the scene to select it. **Double-click or press F** to zoom in: the housing
   (blue) and output flange (orange) faces, their bolt holes and sizes are shown. Esc goes back.
3. Move (G) / Rotate (R) with the gizmo, or type X/Y/Z and the output axis in the right panel.
4. **Shift-click a second actuator**, pick which face of each to join, press
   "Create part between faces".
5. Paint (B) / Erase (E) with the left mouse button; right button orbits; `[` `]` change brush
   size; Ctrl+Z / Ctrl+Shift+Z undo/redo. Orange cells next to the mounts are locked solid and
   actuator bodies are keep-out zones.
6. **Export STL** (voxel surface, mm). Save/Load keeps the design as JSON; it also autosaves in the browser.

## Tests

    node --test tests/*.test.mjs        # 26 geometry/store/STL tests
    python3 -m pytest -q tests/test_server.py
    python3 tests/e2e_browser.py        # drives real Chromium via Playwright (23 checks)

## Limits (read before building anything)

- Actuator shapes are schematic cylinders from the catalogue's diameter and length.
- **Bolt patterns are generic**, not the vendor's. Use the datasheet link before machining.
- The part is a blocky voxel shape; no topology optimization, CNC or 3D-print rules yet
  (the disabled "Optimize" button is the next milestone). Mass shown assumes 100% solid.
- No stress analysis: nothing here says the part is strong enough.

## Licence

MIT, see `LICENSE`.

Actuator data: Draft (https://github.com/davidhnguyen2000/draft), MIT licence, see `data/LICENSE-draft`.
three.js: MIT, see `web/vendor/three/LICENSE`.
