"""Markdown notes (or the title) for a film's GitHub Release.

    python3 tools/release_notes.py <project> [--tag arrow-of-time-v0.3] [--title] [--dir out/<project>/release]

Reads the project's timeline.json (title, logline), the release folder's info.json (files, sizes,
checksums, commit) and the newest section of projects/<project>/CHANGELOG.md, if there is one.
"""

import argparse
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def newest_changes(changelog: Path) -> str:
    """The body of the first '## ' section."""
    if not changelog.exists():
        return ""
    m = re.search(r"^## .*?\n(.*?)(?=^## |\Z)", changelog.read_text(), re.S | re.M)
    return m.group(1).strip() if m else ""


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("project")
    ap.add_argument("--tag", default="")
    ap.add_argument("--title", action="store_true", help="print only the release title")
    ap.add_argument("--dir", default="")
    a = ap.parse_args()

    pdir = ROOT / "projects" / a.project
    tl = json.loads((pdir / "timeline.json").read_text())
    title = tl.get("title", a.project)
    version = a.tag.rsplit("-v", 1)[1] if "-v" in a.tag else ""
    if a.title:
        print(f"{title} v{version}" if version else title)
        return

    rdir = Path(a.dir) if a.dir else ROOT / "out" / a.project / "release"
    info = json.loads((rdir / "info.json").read_text())
    minutes, seconds = divmod(round(info["duration"]), 60)
    repo = f"{os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}/{os.environ.get('GITHUB_REPOSITORY', 'abhishekpradhan/movies')}"
    out = [f"**{title}**. {tl.get('logline', '')}".strip(), "", f"Runtime {minutes}:{seconds:02d}, {tl.get('fps', 24)} fps.", ""]
    changes = newest_changes(pdir / "CHANGELOG.md")
    if changes:
        out += ["### What's new", "", changes, ""]
    out += ["### Files", "", "| File | Size | SHA-256 |", "| --- | --- | --- |"]
    out += [f"| `{f['file']}` | {f['bytes'] / 1e6:.1f} MB | `{f['sha256'][:16]}…` |" for f in info["files"]]
    out += ["", "Full checksums are in `SHA256SUMS`."]
    if (pdir / "LICENSE.md").exists():
        out += ["", "### License", "",
                f"The film is licensed under CC BY 4.0: see [how to credit it]({repo}/blob/main/projects/{a.project}/LICENSE.md). "
                "The studio code is Apache-2.0."]
    if info.get("commit"):
        out += ["", f"Rendered from {repo}/commit/{info['commit']}."]
    print("\n".join(out))


if __name__ == "__main__":
    main()
