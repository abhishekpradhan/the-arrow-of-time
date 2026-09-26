"""Check audio/video sync of a rendered film at named cues.

    .venv/bin/python tools/check_sync.py out/<id>/renders/<file>.mp4 projects/<id>/timeline.json [cue ...]

For each cue it finds the loudest audio onset and the brightest frame change within +-0.5 s
and prints both offsets relative to the cue. Well-synced hits agree within about a frame.
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
    cues = sys.argv[3:] or ["bang", "theia", "asteroidImpact", "now", "lastFlash"]
    sr = 8000
    a = audio_env(video, sr)
    for name in cues:
        c = T["cues"][name]
        lo, hi = max(0, int((c - 0.5) * sr)), int((c + 0.5) * sr)
        seg = np.abs(a[lo:hi])
        win = int(0.01 * sr)
        env = np.convolve(seg, np.ones(win) / win, mode="same")
        d = np.diff(env)
        onset = (lo + int(np.argmax(d))) / sr - c
        # For NOW the audio should *drop*: report the steepest fall instead.
        if name == "now":
            onset = (lo + int(np.argmin(d))) / sr - c
        luma = frame_luma(video, fps, c - 0.5, c + 0.5)
        dl = np.abs(np.diff(luma))
        vshift = (int(np.argmax(dl)) + 1) / fps - 0.5
        print(f"{name:16s} cue {c:7.2f}s  audio {onset * 1000:+7.1f} ms  picture {vshift * 1000:+7.1f} ms")


if __name__ == "__main__":
    main()
