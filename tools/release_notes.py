"""Markdown notes (or the title) for the film's GitHub Release.

    python3 tools/release_notes.py [--tag v1.0] [--title] [--dir out/release]

Reads film/timeline.json (title, logline), the release folder's info.json (files, sizes,
checksums, commit) and the newest section of CHANGELOG.md.
"""

import argparse
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILM = ROOT / "film"


def newest_changes(changelog: Path) -> str:
    """The body of the first '## ' section."""
    if not changelog.exists():
        return ""
    m = re.search(r"^## .*?\n(.*?)(?=^## |\Z)", changelog.read_text(), re.S | re.M)
    return m.group(1).strip() if m else ""


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--tag", default="")
    ap.add_argument("--title", action="store_true", help="print only the release title")
    ap.add_argument("--dir", default="")
    a = ap.parse_args()

    tl = json.loads((FILM / "timeline.json").read_text())
    title = tl.get("title", "The Arrow of Time")
    # Tags are v1.0, v1.1, ... (the cuts before v1.0 were tagged arrow-of-time-v0.x).
    version = a.tag.rsplit("-", 1)[-1].lstrip("v") if a.tag else ""
    if a.title:
        print(f"{title} v{version}" if version else title)
        return

    rdir = Path(a.dir) if a.dir else ROOT / "out" / "release"
    info = json.loads((rdir / "info.json").read_text())
    minutes, seconds = divmod(round(info["duration"]), 60)
    repo = f"{os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}/{os.environ.get('GITHUB_REPOSITORY', 'abhishekpradhan/the-arrow-of-time')}"
    out = [f"**{title}**. {tl.get('logline', '')}".strip(), "", f"Runtime {minutes}:{seconds:02d}, {tl.get('fps', 24)} fps.", ""]
    changes = newest_changes(ROOT / "CHANGELOG.md")
    if changes:
        out += ["### What's new", "", changes, ""]
    out += ["### Files", "", "| File | Size | SHA-256 |", "| --- | --- | --- |"]
    out += [f"| `{f['file']}` | {f['bytes'] / 1e6:.1f} MB | `{f['sha256'][:16]}…` |" for f in info["files"]]
    out += ["", "Full checksums are in `SHA256SUMS`."]
    out += ["", "### License", "",
            f"The film is licensed under CC BY 4.0: see [how to credit it]({repo}/blob/main/film/LICENSE.md). "
            "The code is MIT. The Apollo 11 recording is courtesy of NASA."]
    if info.get("commit"):
        out += ["", f"Rendered from {repo}/commit/{info['commit']}."]
    print("\n".join(out))


if __name__ == "__main__":
    main()
