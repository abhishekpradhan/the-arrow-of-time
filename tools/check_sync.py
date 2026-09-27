"""Check audio/video sync of a rendered film at named cues.

    .venv/bin/python tools/check_sync.py out/<id>/renders/<file>.mp4 projects/<id>/timeline.json [cue ...]

Without cue names it checks the timeline's "syncCues" list, or every cue if there is none.

For each cue it finds the biggest jump in audio level (RMS in dB, adjacent 20 ms windows, 5 ms
steps) and the biggest frame-to-frame luma change within +-0.5 s, and prints both offsets
relative to the cue. Well-synced hits agree within about a frame. Cues whose name contains
"now" or "cut" are hard cuts to silence, so for those the biggest *drop* in level is reported.
"""

import json
import subprocess
import sys

import numpy as np


def audio_env(path: str, sr: int = 8000) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, np.float32)


def frame_luma(path: str, fps: float, t0: float, t1: float, w: int = 64, h: int = 36) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", f"{t0:.3f}", "-t", f"{t1 - t0:.3f}", "-i", path,
         "-vf", f"scale={w}:{h},format=gray", "-f", "rawvideo", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, h * w).mean(axis=1)


def main() -> None:
    video, timeline = sys.argv[1], sys.argv[2]
    T = json.load(open(timeline))
    fps = T["fps"]
    cues = sys.argv[3:] or T.get("syncCues") or sorted(T.get("cues", {}), key=lambda k: T["cues"][k])
    sr = 8000
    a = audio_env(video, sr)
    length = len(a) / sr
    win, hop = int(0.02 * sr), int(0.005 * sr)
    lag = win // hop
    for name in cues:
        c = T.get("cues", {}).get(name)
        if c is None or c < 0.5 or c > length - 0.5:
            print(f"{name:16s} {'no such cue' if c is None else 'too close to an end of the film'}")
            continue
        lo, hi = max(0, int((c - 0.5) * sr) - win), int((c + 0.5) * sr) + win
        seg = a[lo:hi]
        starts = np.arange(0, len(seg) - win, hop)
        rms = np.sqrt(np.array([np.mean(np.square(seg[i:i + win])) for i in starts]) + 1e-12)
        db = 20 * np.log10(rms)
        # Level change between adjacent, non-overlapping windows; the boundary between them is
        # the event time.
        jump = db[lag:] - db[:-lag]
        cut = "now" in name.lower() or "cut" in name.lower()
        k = int(np.argmin(jump) if cut else np.argmax(jump))
        onset = (lo + starts[k + lag]) / sr - c
        luma = frame_luma(video, fps, c - 0.5, c + 0.5)
        dl = np.abs(np.diff(luma))
        vshift = (int(np.argmax(dl)) + 1) / fps - 0.5
        print(f"{name:16s} cue {c:7.2f}s  audio {onset * 1000:+7.1f} ms  picture {vshift * 1000:+7.1f} ms")


if __name__ == "__main__":
    main()
