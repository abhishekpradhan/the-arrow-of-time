"""Fetch NASA's recording of Neil Armstrong's first words from the Moon.

    .venv/bin/python tools/assets/build_apollo11.py

Output: assets/apollo11/eagle-has-landed.wav (48 kHz mono, 24-bit): "Houston, Tranquility Base
here. The Eagle has landed." (Apollo 11, 20 July 1969), as it went out on the air-to-ground loop,
radio hiss and all. It opens with the Quindar tone that ended Houston's "We copy you down, Eagle"
(0.25-0.6 s); the words run from about 1.0 s to 4.9 s.

The recording is NASA's. NASA audio is generally not subject to copyright in the United States;
NASA's media usage guidelines ask that NASA be acknowledged as the source and that the material
not imply its endorsement. The MP3 (16 kHz mono) is fetched from nasa.gov's Historical Sounds
page and cached in out/cache/apollo11/; ffmpeg decodes it.
"""

from __future__ import annotations

import subprocess
import sys
import urllib.request
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "audio"))
from studio.wav import read_wav, write_wav  # noqa: E402

CACHE = ROOT / "out" / "cache" / "apollo11"
OUT = ROOT / "assets" / "apollo11"
URL = "https://www.nasa.gov/wp-content/uploads/2015/01/569462main_eagle_has_landed.mp3"
SR = 48000


def main() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    mp3 = CACHE / URL.rsplit("/", 1)[1]
    if not mp3.exists():
        print(f"  downloading {URL}")
        urllib.request.urlretrieve(URL, mp3)
    raw = CACHE / "raw48k.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(mp3), "-ar", str(SR), "-ac", "1",
                    "-c:a", "pcm_f32le", str(raw)], check=True)
    x, sr = read_wav(str(raw))
    x = np.asarray(x, dtype=np.float64).mean(axis=0)
    # The decoded MP3 overshoots full scale a little: bring its peak to -1 dBFS, and fade the
    # loop's hiss in and out.
    x *= 10 ** (-1 / 20) / np.abs(x).max()
    n_in, n_out = int(0.06 * SR), int(0.3 * SR)
    x[:n_in] *= np.linspace(0.0, 1.0, n_in)
    x[-n_out:] *= np.linspace(1.0, 0.0, n_out)
    out = OUT / "eagle-has-landed.wav"
    write_wav(str(out), x.astype(np.float32), SR, bits=24)
    print(f"  wrote {out.relative_to(ROOT)} ({len(x) / SR:.2f} s)")


if __name__ == "__main__":
    main()
