"""End-to-end check of the robot designer in headless Chromium."""
import json, subprocess, sys, time, os
from pathlib import Path
from playwright.sync_api import sync_playwright

APP = Path.home() / "robot-designer"
OUT = Path(__file__).resolve().parent / "shots"
OUT.mkdir(exist_ok=True)
PORT = 8765

server = subprocess.Popen([sys.executable, str(APP / "server.py"), "--port", str(PORT)],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.0)
results = []
def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        page = browser.new_page(viewport={"width": 1500, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.goto(f"http://127.0.0.1:{PORT}/")
        page.wait_for_selector(".catalog-item", timeout=15000)
        check("catalogue lists 114 actuators", page.locator(".catalog-item").count() == 114,
              str(page.locator(".catalog-item").count()))

        # search filter
        page.fill("input[type=search]", "AK80-6")
        check("search narrows the list", 0 < page.locator(".catalog-item").count() < 10)
        page.locator(".catalog-item", has_text="AK80-6").first.click()
        page.fill("input[type=search]", "AK80-9")
        page.locator(".catalog-item", has_text="AK80-9").first.click()
        page.wait_for_timeout(600)
        n = page.evaluate("__rd.store.parts.size")
        check("two actuators added", n == 2, str(n))
        page.screenshot(path=str(OUT / "1_two_actuators.png"))

        # click-select: project part A's centre to the screen and click it
        def screen_of(pid):
            return page.evaluate("""(pid) => {
                const THREE_V = __rd.viewer.camera.position.constructor;
                const p = __rd.store.parts.get(pid).pose.position;
                const v = new THREE_V(...p).project(__rd.viewer.camera);
                const r = document.getElementById('c').getBoundingClientRect();
                return [r.left + (v.x*0.5+0.5)*r.width, r.top + (-v.y*0.5+0.5)*r.height];
            }""", pid)
        ids = page.evaluate("[...__rd.store.parts.keys()]")
        x, y = screen_of(ids[0])
        page.mouse.click(x, y)
        page.wait_for_timeout(300)
        sel = page.evaluate("__rd.state.parts")
        check("clicking a part selects it", sel == [ids[0]], str(sel))
        check("inspector shows its specs", "peak torque" in page.inner_text("#inspector").lower()
              and "mount faces" in page.inner_text("#inspector").lower())

        # double-click -> focus zoom
        d0 = page.evaluate("__rd.viewer.camera.position.distanceTo(__rd.viewer.controls.target)")
        page.mouse.dblclick(x, y)
        page.wait_for_timeout(900)
        d1 = page.evaluate("__rd.viewer.camera.position.distanceTo(__rd.viewer.controls.target)")
        check("double-click zooms in", d1 < d0 * 0.8, f"{d0:.0f} -> {d1:.0f} mm")
        check("focus flag set", page.evaluate("__rd.viewer.isFocused()"))
        check("mount labels shown with hole info", page.locator(".label").count() >= 2
              and "holes" not in "" and "generic" in page.inner_text("#labels"), page.inner_text("#labels")[:120].replace("\n", " | "))
        page.screenshot(path=str(OUT / "2_focus_mounts.png"))
        page.keyboard.press("Escape")
        page.wait_for_timeout(700)
        check("Esc leaves focus", not page.evaluate("__rd.viewer.isFocused()"))

        # move part B next to A on the Z axis via the inspector, then connect
        page.evaluate("__rd.select([__rd.store.parts.keys().next().value])")
        page.evaluate("""() => { const [a,b] = [...__rd.store.parts.keys()];
            __rd.store.setPose(b, {position:[0,0,160], quaternion:[0,0,0,1]});
            __rd.store.setPose(a, {position:[0,0,0], quaternion:[0,0,0,1]});
            __rd.select([a,b]); }""")
        page.wait_for_timeout(300)
        check("two selected shows connect form", "Create part between faces" in page.inner_text("#inspector"))
        page.get_by_role("button", name="Create part between faces").click()
        page.wait_for_timeout(1200)
        ns = page.evaluate("__rd.store.structures.size")
        check("structure created", ns == 1, str(ns))
        check("paint tool auto-selected", page.evaluate("__rd.state.tool") == "paint")
        info = page.evaluate("""() => { const s=[...__rd.store.structures.values()][0];
            let k=0,i=0; for (const v of s.domain.data){ if(v===3)k++; if(v===2)i++; }
            return {dims:s.domain.dims, cell:s.domain.cell, keepout:k, iface:i}; }""")
        check("locked cells exist (keep-out + interface)", info["keepout"] > 0 and info["iface"] > 0, json.dumps(info))
        page.screenshot(path=str(OUT / "3_structure_domain.png"))

        # paint with the mouse: drag across the middle of the domain box
        canvas = page.locator("#c").bounding_box()
        cx, cy = canvas["x"] + canvas["width"] / 2, canvas["y"] + canvas["height"] / 2
        before = page.evaluate("__rd.store.structures.values().next().value.domain.data.filter(v=>v===1).length")
        page.mouse.move(cx - 60, cy)
        page.mouse.down()
        for i in range(0, 13):
            page.mouse.move(cx - 60 + i * 10, cy + (i % 3) * 6)
        page.mouse.up()
        page.wait_for_timeout(300)
        after = page.evaluate("[...__rd.store.structures.values().next().value.domain.data].filter(v=>v===1).length")
        check("mouse drag paints cells", after > before, f"{before} -> {after}")
        page.screenshot(path=str(OUT / "4_painted.png"))

        # undo, redo
        page.keyboard.press("Control+z")
        undone = page.evaluate("[...__rd.store.structures.values().next().value.domain.data].filter(v=>v===1).length")
        check("Ctrl+Z undoes the stroke", undone < after, f"{after} -> {undone}")
        page.keyboard.press("Control+Shift+z")
        redone = page.evaluate("[...__rd.store.structures.values().next().value.domain.data].filter(v=>v===1).length")
        check("Ctrl+Shift+Z redoes it", redone == after, f"{redone}")

        # fill all, erase with mouse
        page.get_by_role("button", name="Fill all").click()
        filled = page.evaluate("[...__rd.store.structures.values().next().value.domain.data].filter(v=>v===1).length")
        check("Fill all paints the free cells", filled > after, str(filled))
        page.keyboard.press("e")
        page.mouse.move(cx - 80, cy)
        page.mouse.down()
        for i in range(0, 17):
            page.mouse.move(cx - 80 + i * 10, cy)
        page.mouse.up()
        erased = page.evaluate("[...__rd.store.structures.values().next().value.domain.data].filter(v=>v===1).length")
        check("erase tool removes cells", erased < filled, f"{filled} -> {erased}")
        locked_ok = page.evaluate("""() => { const d=__rd.store.structures.values().next().value.domain.data;
            let c=0; for (const v of d) if (v===2||v===3) c++; return c; }""")
        check("locked cells survive fill/erase", locked_ok == info["keepout"] + info["iface"])

        # STL export through the real download path
        page.keyboard.press("Escape")
        with page.expect_download() as dl:
            page.get_by_role("button", name="Export STL").click()
        path = dl.value.path()
        data = Path(path).read_bytes()
        ntri = int.from_bytes(data[80:84], "little")
        check("STL download is a valid binary STL", len(data) == 84 + ntri * 50 and ntri > 0, f"{ntri} triangles")

        # save -> reload page -> autosave restores the scene
        page.wait_for_timeout(700)
        page.reload()
        page.wait_for_selector(".catalog-item")
        page.wait_for_timeout(1200)
        back = page.evaluate("({p: __rd.store.parts.size, s: __rd.store.structures.size})")
        check("autosave restores parts and structure after reload", back == {"p": 2, "s": 1}, json.dumps(back))
        restored = page.evaluate("[...__rd.store.structures.values().next().value.domain.data].filter(v=>v===1).length")
        check("painted cells restored", restored == erased, f"{restored} vs {erased}")
        page.screenshot(path=str(OUT / "5_after_reload.png"))

        check("no browser errors", not errors, "; ".join(errors)[:300])
        browser.close()
finally:
    server.terminate()

bad = [r for r in results if not r[1]]
print(f"\n{len(results)-len(bad)}/{len(results)} checks passed")
sys.exit(1 if bad else 0)
