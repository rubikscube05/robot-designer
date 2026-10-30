#!/usr/bin/env python3
"""Build the static site into dist/ for GitHub Pages or Vercel.

Copies ./web, writes the trimmed actuator catalogue as a static JSON file so the
frontend works without server.py, and adds .nojekyll for GitHub Pages.
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from server import CATALOG_FIELDS, CATALOG_PATH  # noqa: E402

WEB_DIR = ROOT / "web"
OUT_DIR = ROOT / "dist"


def main() -> None:
    """Generate a self-contained static site in dist/."""
    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    shutil.copytree(WEB_DIR, OUT_DIR)

    rows = json.loads(CATALOG_PATH.read_text())
    catalog = [{k: r.get(k) for k in CATALOG_FIELDS} for r in rows]

    api = OUT_DIR / "api"
    api.mkdir(parents=True, exist_ok=True)
    (api / "catalog.json").write_text(json.dumps(catalog))
    (api / "health.json").write_text(json.dumps({"ok": True, "actuators": len(catalog)}))
    (OUT_DIR / ".nojekyll").write_text("")

    print(f"Built {OUT_DIR} with {len(catalog)} actuators")


if __name__ == "__main__":
    main()
