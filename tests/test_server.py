"""Server tests: catalogue endpoint, static files, and path-traversal safety."""
import json
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402


def _start():
    srv = server.make_server(port=0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_port}"


def test_catalog_endpoint():
    srv, base = _start()
    try:
        rows = json.load(urllib.request.urlopen(base + "/api/catalog"))
        assert len(rows) == 114
        ak = next(r for r in rows if r["name"] == "AK80-6")
        assert ak["tau_peak_Nm"] == 12.0
        assert ak["OD_mm"] == 98.0 and ak["L_mm"] == 38.5
        assert "rotor_inertia_kgm2" not in ak  # only editor fields are sent
    finally:
        srv.shutdown()


def test_serves_index_and_vendor_three():
    srv, base = _start()
    try:
        html = urllib.request.urlopen(base + "/").read().decode()
        assert "<canvas" in html or "importmap" in html
        js = urllib.request.urlopen(base + "/vendor/three/three.module.js")
        assert js.status == 200
    finally:
        srv.shutdown()


def test_no_path_traversal():
    srv, base = _start()
    try:
        try:
            urllib.request.urlopen(base + "/../server.py")
            leaked = True
        except urllib.error.HTTPError:
            leaked = False
        assert not leaked
    finally:
        srv.shutdown()
