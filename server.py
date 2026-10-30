#!/usr/bin/env python3
"""Local server for the robot designer.

Serves ./web as static files and the actuator catalogue at /api/catalog.
Binds to 127.0.0.1 only. Standard library only, so there is nothing to install.

    python3 server.py            # http://127.0.0.1:8000
    python3 server.py --port 9000
"""
from __future__ import annotations

import argparse
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"
CATALOG_PATH = ROOT / "data" / "actuator_catalog.json"

# Only the fields the editor needs; keeps the response small.
CATALOG_FIELDS = (
    "name", "vendor", "category", "tau_peak_Nm", "omega_NL_rad_s",
    "mass_kg", "OD_mm", "L_mm", "source", "notes",
)


def load_catalog(path: Path = CATALOG_PATH) -> list[dict]:
    """Read the actuator catalogue and keep only the fields the editor uses."""
    with path.open() as f:
        rows = json.load(f)
    return [{k: r.get(k) for k in CATALOG_FIELDS} for r in rows]


class Handler(SimpleHTTPRequestHandler):
    """Static files plus a small JSON API."""

    catalog: list[dict] = []

    def do_GET(self) -> None:  # noqa: N802 (http.server naming)
        """Answer /api/* requests; everything else is a static file."""
        if self.path.split("?")[0] == "/api/catalog":
            self._send_json(self.catalog)
        elif self.path.split("?")[0] == "/api/health":
            self._send_json({"ok": True, "actuators": len(self.catalog)})
        else:
            super().do_GET()

    def _send_json(self, payload) -> None:
        """Write a JSON response."""
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self) -> None:
        """Disable caching so edits to the web files show up on reload."""
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def make_server(port: int = 8000, host: str = "127.0.0.1") -> ThreadingHTTPServer:
    """Create (but do not start) the HTTP server. Port 0 picks a free port."""
    Handler.catalog = load_catalog()
    handler = partial(Handler, directory=str(WEB_DIR))
    return ThreadingHTTPServer((host, port), handler)


def main() -> None:
    """Command-line entry point."""
    parser = argparse.ArgumentParser(description="Robot designer local server")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    server = make_server(args.port)
    print(f"Robot designer running at http://127.0.0.1:{server.server_port}  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
