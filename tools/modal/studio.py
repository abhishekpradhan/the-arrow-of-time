"""Render a film on Modal: many CPU containers each render a slice of the timeline at once.

    pip install -r tools/modal/requirements.txt && modal setup        # once
    modal run tools/modal/studio.py --project arrow-of-time                       # 1080p master
    modal run tools/modal/studio.py --project arrow-of-time --preset draft        # half resolution
    modal run tools/modal/studio.py --project arrow-of-time --window 182-216      # re-render one sequence
    modal run tools/modal/studio.py --project arrow-of-time --release             # + distribution encodes
    modal run tools/modal/studio.py --project arrow-of-time --scale 2 --release --variants 2160p,1080p,poster

Slices are rendered with the same code, browser and software rasterizer (Mesa llvmpipe) as
`npm run render`, so a Modal render matches a local one frame for frame.

Nothing is deployed. `modal run` makes an ephemeral app that stops when the command ends, and no
other app in the Modal workspace is touched. The one persistent object is a Volume (default
"movies-studio") that caches slices, scores and outputs under keys hashed from the files that
affect them: re-running after a score-only change renders no video at all, and an unchanged
film costs nothing. The volume carries a marker file; if a volume of that name exists without it,
the run stops rather than write into someone else's data.

Settings (environment variables, all optional):
    MODAL_ENVIRONMENT             Modal environment to run in (e.g. a dedicated "movies" one)
    STUDIO_MODAL_APP              app name shown in the Modal dashboard   (default movies-studio)
    STUDIO_MODAL_VOLUME           cache volume name                       (default movies-studio)
    STUDIO_MODAL_CPU              cores per render container              (default 8)
    STUDIO_MODAL_WORKERS          browser pages per render container      (default 3)
    STUDIO_MODAL_MAX_CONTAINERS   render containers at once               (default 40)

See docs/modal.md for costs, timings and the GitHub Actions workflow that drives this.
"""

from __future__ import annotations

import hashlib
import io
import json
import math
import os
import shutil
import subprocess
import time
from fractions import Fraction
from pathlib import Path

import modal

APP_NAME = os.environ.get("STUDIO_MODAL_APP", "movies-studio")
VOLUME_NAME = os.environ.get("STUDIO_MODAL_VOLUME", "movies-studio")
CPU = float(os.environ.get("STUDIO_MODAL_CPU", "8"))
WORKERS = int(os.environ.get("STUDIO_MODAL_WORKERS", "3"))
MAX_CONTAINERS = int(os.environ.get("STUDIO_MODAL_MAX_CONTAINERS", "40"))
MEMORY_GIB = 12  # per render container: enough for three 4K pages
MARKER = ".movies-studio"
# Modal list prices (September 2026) for the cost estimate printed at the end.
USD_PER_CORE_S = 0.0000131
USD_PER_GIB_S = 0.00000222

REPO = Path(__file__).resolve().parents[2] if modal.is_local() else Path("/src")
CACHE = Path("/cache")

# The working tree is mounted when a container starts (not baked into the image), so editing a
# shot does not rebuild anything. Generated and heavy folders stay behind.
IGNORE = ["node_modules", ".venv", "out", ".git", "dist", ".vite", "**/__pycache__", "**/*.pyc", "**/.DS_Store"]

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("curl", "ca-certificates", "ffmpeg", "libegl1", "libegl-mesa0", "libgl1-mesa-dri", "libgles2")
    .run_commands("curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs")
    .add_local_file(REPO / "package.json", "/app/package.json", copy=True)
    .add_local_file(REPO / "package-lock.json", "/app/package-lock.json", copy=True)
    .run_commands("cd /app && npm ci --no-audit --no-fund && npx playwright install --with-deps chromium")
    .pip_install_from_requirements(str(REPO / "requirements.txt"))
    .env({"STUDIO_NO_DEV_SHM": "1"})
    .add_local_dir(REPO, "/src", ignore=IGNORE)
)
app = modal.App(APP_NAME, image=image)
vol = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True, version=2)


# ----------------------------------------------------------------------------- in the containers


def _prepare() -> Path:
    """Copy the mounted sources over /app, which already holds node_modules from the image."""
    subprocess.run(["cp", "-a", "/src/.", "/app/"], check=True)
    return Path("/app")


def _cores() -> int:
    """Cores this container may use (the cgroup quota; os.cpu_count() can report the host's)."""
    try:
        quota, period = Path("/sys/fs/cgroup/cpu.max").read_text().split()
        if quota != "max":
            return max(1, math.ceil(int(quota) / int(period)))
    except (OSError, ValueError):
        pass
    return os.cpu_count() or 4


def _run(cmd: list[str], cwd: Path, env: dict[str, str] | None = None) -> None:
    print("$", " ".join(cmd), flush=True)
    subprocess.run(cmd, cwd=cwd, check=True, env={**os.environ, **(env or {})})


def _ffmpeg(args: list[str]) -> None:
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def _frames_in(path: Path) -> int:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    )
    return int(r.stdout.strip())


@app.function(cpu=CPU, memory=MEMORY_GIB * 1024, timeout=3600, retries=1, max_containers=MAX_CONTAINERS, volumes={str(CACHE): vol})
def render_slice(project: str, preset: str, scale: float, a: int, b: int, rel: str, segment_s: float, force: bool) -> float:
    """Render frames [a, b) into CACHE/rel (video only). Returns the seconds spent."""
    t0 = time.time()
    out = CACHE / rel
    if out.exists() and not force:
        return 0.0
    root = _prepare()
    cores = _cores()
    # llvmpipe sizes its thread pool from the CPU count, which may be the host's.
    env = {"LP_NUM_THREADS": str(cores)} if cores < (os.cpu_count() or cores) else {}
    print(f"[slice {a}-{b}] {cores} cores, {WORKERS} pages", flush=True)
    tmp = Path("/tmp") / out.name
    _run(["npx", "tsx", "tools/render.ts", project, "--preset", preset, "--scale", f"{scale:g}", "--frames", f"{a}:{b}",
          "--workers", str(WORKERS), "--segment", f"{segment_s:.4f}", "--no-audio", "--out", str(tmp)], root, env)
    if _frames_in(tmp) != b - a:
        raise RuntimeError(f"slice {a}-{b}: expected {b - a} frames, got {_frames_in(tmp)}")
    out.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(tmp, out)
    vol.commit()
    return time.time() - t0


@app.function(cpu=2, memory=8192, timeout=3600, volumes={str(CACHE): vol})
def score(project: str, rel: str) -> float:
    """Synthesize the soundtrack into CACHE/rel. Returns the seconds spent."""
    t0 = time.time()
    out = CACHE / rel
    if out.exists():
        return 0.0
    root = _prepare()
    _run(["npx", "tsx", "tools/audio.ts", project], root)
    out.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(root / "out" / project / "audio" / "score.wav", out)
    vol.commit()
    return time.time() - t0


@app.function(cpu=4, memory=8192, timeout=3600, volumes={str(CACHE): vol})
def assemble(project: str, slices: list[str], audio: str, frames: int, fps: float, rel: str) -> float:
    """Join the slices (stream copy), add the soundtrack, and check picture/sound sync."""
    t0 = time.time()
    vol.reload()
    root = _prepare()
    work = Path("/tmp/assemble")
    work.mkdir(parents=True, exist_ok=True)
    listing = work / "concat.txt"
    listing.write_text("".join(f"file '{CACHE / s}'\n" for s in slices))
    video = work / "video.mp4"
    # Joining files (pages into slices, then slices here) can leave gaps or overlaps in the
    # timestamps at the seams, depending on the ffmpeg version, and a gap makes players stutter
    # and two-pass encodes fail. Renumber every frame from its place in the stream: an exact
    # constant frame rate, with each frame's B-frame reordering offset kept.
    rate = Fraction(fps).limit_denominator(1001)
    step = f"({rate.denominator}/({rate.numerator}*TB))"
    setts = f"setts=dts=N*{step}+STARTDTS:pts=N*{step}+STARTDTS+PTS-DTS"
    _ffmpeg(["-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", "-bsf:v", setts, str(video)])
    if _frames_in(video) != frames:
        raise RuntimeError(f"assembled {_frames_in(video)} frames, expected {frames}")
    out = CACHE / rel
    out.parent.mkdir(parents=True, exist_ok=True)
    _ffmpeg(["-i", str(video), "-i", str(CACHE / audio), "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
             "-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-t", f"{frames / fps:.3f}", "-movflags", "+faststart", str(out)])
    vol.commit()
    # Every cue in the timeline against the audio (prints a table; informational).
    subprocess.run(["python3", "tools/check_sync.py", str(out), f"projects/{project}/timeline.json"], cwd=root)
    return time.time() - t0


@app.function(cpu=16, memory=16384, timeout=5400, volumes={str(CACHE): vol})
def release_variant(project: str, master: str, variant: str, poster: float, rel_dir: str) -> float:
    """Encode one distribution variant (2160p, 1080p, 720p or poster) of a master into CACHE/rel_dir."""
    t0 = time.time()
    vol.reload()
    root = _prepare()
    work = Path("/tmp/release")
    shutil.rmtree(work, ignore_errors=True)
    cmd = ["npx", "tsx", "tools/release.ts", project, "--input", str(CACHE / master), "--variants", variant, "--out-dir", str(work)]
    if poster >= 0:
        cmd += ["--poster", f"{poster:g}"]
    _run(cmd, root)
    dest = CACHE / rel_dir
    dest.mkdir(parents=True, exist_ok=True)
    for f in work.iterdir():
        if f.name not in ("info.json", "SHA256SUMS"):
            shutil.copyfile(f, dest / f.name)
    vol.commit()
    return time.time() - t0


@app.function(cpu=2, memory=4096, timeout=1200, volumes={str(CACHE): vol})
def finalize_release(project: str, rel_dir: str, duration: float, commit: str) -> list[str]:
    """Write info.json and SHA256SUMS for everything in a release folder; returns the file names."""
    vol.reload()
    dest = CACHE / rel_dir
    files = sorted(f for f in dest.iterdir() if f.name not in ("info.json", "SHA256SUMS"))

    def sha(f: Path) -> str:
        h = hashlib.sha256()
        with open(f, "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
        return h.hexdigest()

    entries = [{"file": f.name, "bytes": f.stat().st_size, "sha256": sha(f)} for f in files]
    info = {"project": project, "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "commit": commit, "duration": duration, "files": entries}
    (dest / "info.json").write_text(json.dumps(info, indent=2) + "\n")
    (dest / "SHA256SUMS").write_text("".join(f"{e['sha256']}  {e['file']}\n" for e in entries))
    vol.commit()
    return [f.name for f in files] + ["info.json", "SHA256SUMS"]


# ----------------------------------------------------------------------------- on your machine


def _hash(paths: list[Path]) -> str:
    h = hashlib.sha256()
    for p in sorted(paths):
        h.update(str(p.relative_to(REPO)).encode() + b"\0" + p.read_bytes() + b"\0")
    return h.hexdigest()[:16]


def _walk(*roots: Path) -> list[Path]:
    out: list[Path] = []
    for r in roots:
        if r.is_file():
            out.append(r)
        elif r.is_dir():
            out += [p for p in r.rglob("*") if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc"]
    return out


def _video_sources(project: str) -> list[Path]:
    """Everything that can change a pixel: engine, project code and data, assets, the render tools."""
    pdir = REPO / "projects" / project
    own = [p for p in _walk(pdir) if p.suffix != ".md" and p.name not in ("score.py", "poster.jpg")]
    return own + _walk(REPO / "engine", REPO / "assets", REPO / "tools" / "render.ts", REPO / "tools" / "lib",
                       REPO / "render.html", REPO / "vite.config.ts", REPO / "package-lock.json")


def _audio_sources(project: str) -> list[Path]:
    pdir = REPO / "projects" / project
    return _walk(REPO / "audio" / "studio", pdir / "score.py", pdir / "timeline.json", REPO / "requirements.txt", REPO / "tools" / "audio.ts")


def _listdir(path: str) -> set[str]:
    try:
        return {e.path.lstrip("/").split("/")[-1] for e in vol.listdir(path)}
    except Exception:  # noqa: BLE001 - a missing folder is simply empty
        return set()


def _read_json(path: str) -> dict | None:
    try:
        return json.loads(b"".join(vol.read_file(path)))
    except Exception:  # noqa: BLE001
        return None


def _write(path: str, data: bytes) -> None:
    with vol.batch_upload(force=True) as batch:
        batch.put_file(io.BytesIO(data), path)


def _fetch(remote: str, local: Path) -> None:
    local.parent.mkdir(parents=True, exist_ok=True)
    with open(local, "wb") as f:
        for chunk in vol.read_file(remote):
            f.write(chunk)
    print(f"  {local.relative_to(REPO)}  {local.stat().st_size / 1e6:.1f} MB", flush=True)


def _claim_volume() -> None:
    names = _listdir("/")
    if names and MARKER not in names:
        raise SystemExit(f"The Modal volume '{VOLUME_NAME}' already holds data from something else. "
                         "Set STUDIO_MODAL_VOLUME to a new name and run again.")
    if not names:
        _write(MARKER, b"Cache for tools/modal/studio.py (movies studio). Safe to delete: it only holds rendered media.\n")


def _git_commit() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO, capture_output=True, text=True, check=True).stdout.strip()
    except Exception:  # noqa: BLE001
        return "unknown"


@app.local_entrypoint()
def main(
    project: str = "arrow-of-time",
    preset: str = "final",
    scale: float = 0.0,
    window: str = "",
    slice_seconds: float = 8.0,
    release: bool = False,
    variants: str = "1080p,720p,poster",
    poster: float = -1.0,
    download: str = "auto",
    force: bool = False,
) -> None:
    """Render PROJECT on Modal and download the result into out/<project>/.

    --preset final|draft, --scale (0 = preset default; 2 = 4K), --window 182-216 re-renders only the
    slices touching that time range and reuses the rest from the last render with the same settings,
    --release adds the distribution encodes (--variants), --download auto|master|release|all|none,
    --force ignores cached slices.
    """
    t0 = time.time()
    if preset not in ("final", "draft"):
        raise SystemExit("--preset must be final or draft")
    timeline = json.loads((REPO / "projects" / project / "timeline.json").read_text())
    fps, duration = float(timeline["fps"]), float(timeline["duration"])
    frames = round(duration * fps)
    scale = scale or (0.5 if preset == "draft" else 1.0)
    base = f"{project}/{preset}-x{scale:g}"
    vkey, akey = _hash(_video_sources(project)), _hash(_audio_sources(project))
    _claim_volume()

    latest = _read_json(f"{base}/latest.json")
    if window:
        if not latest:
            raise SystemExit(f"--window needs an earlier full render of {project} with --preset {preset} --scale {scale:g}.")
        wa, wb = (float(x) for x in window.split("-"))
        step = int(latest["slice_frames"])
        grid = [(a, min(a + step, frames)) for a in range(0, frames, step)]
        if [(s[0], s[1]) for s in latest["slices"]] != grid:
            raise SystemExit("The film's length changed since the last render: run without --window.")
        plan = [(a, b, f"{base}/slices/{vkey}/{a:06d}-{b:06d}.mp4" if b / fps > wa and a / fps < wb else old[2])
                for (a, b), old in zip(grid, latest["slices"])]
    else:
        step = max(1, round(slice_seconds * fps))
        plan = [(a, min(a + step, frames), f"{base}/slices/{vkey}/{a:06d}-{min(a + step, frames):06d}.mp4") for a in range(0, frames, step)]

    # Only slices under the current key are rendered; a --window run reuses older ones as they are.
    prefix = f"{base}/slices/{vkey}/"
    have = set() if force else _listdir(prefix)
    todo = [(a, b, rel) for a, b, rel in plan if rel.startswith(prefix) and rel[len(prefix):] not in have]
    print(f"[modal] {timeline.get('title', project)}: {len(plan)} slices of {step / fps:g} s, {len(todo)} to render "
          f"(video {vkey}, audio {akey}), {CPU:g} cores x {WORKERS} pages each, up to {MAX_CONTAINERS} containers", flush=True)

    audio_rel = f"{project}/audio/{akey}.wav"
    audio_call = score.spawn(project, audio_rel)
    busy, done, failed = 0.0, 0, []
    args = [(project, preset, scale, a, b, rel, step / fps / WORKERS, force) for a, b, rel in todo]
    # A failed slice does not stop the others: they finish and stay cached, so a re-run resumes.
    # (Never map over an empty list: with every slice cached, that call waits forever.)
    for spent in render_slice.starmap(args, order_outputs=False, return_exceptions=True) if args else []:
        if isinstance(spent, BaseException):
            failed.append(spent)
            continue
        busy += spent
        done += 1
        print(f"[modal] slices {done}/{len(todo)}  ({time.time() - t0:.0f} s)", flush=True)
    if failed:
        raise SystemExit(f"{len(failed)} slice(s) failed (the rest are cached; run again to retry): {failed[0]}")
    print("[modal] waiting for the soundtrack …", flush=True)
    audio_s = audio_call.get()
    cost = busy * (CPU * USD_PER_CORE_S + MEMORY_GIB * USD_PER_GIB_S) + audio_s * (2 * USD_PER_CORE_S + 8 * USD_PER_GIB_S)

    stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    master = f"{base}/renders/{project}-{preset}-{stamp}.mp4"
    print(f"[modal] joining {len(plan)} slices and adding the soundtrack …", flush=True)
    cost += assemble.remote(project, [rel for _, _, rel in plan], audio_rel, frames, fps, master) * (4 * USD_PER_CORE_S + 8 * USD_PER_GIB_S)
    _write(f"{base}/latest.json", json.dumps({
        "slice_frames": step, "slices": plan, "video": vkey, "audio": audio_rel, "master": master, "commit": _git_commit(),
    }, indent=1).encode())

    rel_dir, names = "", []
    if release:
        rel_dir = f"{base}/release/{stamp}"
        wanted = [v.strip() for v in variants.split(",") if v.strip()]
        print(f"[modal] encoding {', '.join(wanted)} in parallel …", flush=True)
        for spent in release_variant.starmap([(project, master, v, poster, rel_dir) for v in wanted], order_outputs=False):
            cost += spent * (16 * USD_PER_CORE_S + 16 * USD_PER_GIB_S)
        names = finalize_release.remote(project, rel_dir, duration, _git_commit())

    what = download if download != "auto" else ("release" if release else "master")
    print(f"[modal] downloading ({what}) …", flush=True)
    if what in ("master", "all"):
        local = REPO / "out" / project / "renders" / master.split("/")[-1]
        _fetch(master, local)
        if not window:
            shutil.copyfile(local, local.with_name(f"{project}-{preset}-latest.mp4"))
    if what in ("release", "all") and release:
        for name in names:
            _fetch(f"{rel_dir}/{name}", REPO / "out" / project / "release" / name)
    print(f"[modal] done in {time.time() - t0:.0f} s; about ${cost:.2f} of compute. Master in volume "
          f"'{VOLUME_NAME}' at {master}{f', release files at {rel_dir}' if rel_dir else ''}.", flush=True)
