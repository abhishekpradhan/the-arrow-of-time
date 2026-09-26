"""Analysis and QA: spectrogram images, onset / hard-cut detection, per-section
level tables and a click detector. Used to verify a render without listening.
"""
from __future__ import annotations

import math

import numpy as np

from .core import F32, SR, mono
from .master import integrated_loudness, short_term_loudness, true_peak


# ----------------------------------------------------------------------------
# Envelopes and onsets
# ----------------------------------------------------------------------------

def energy_env(x: np.ndarray, t0: float, t1: float, sr: int = SR, win: float = 0.001,
               hop: float = 0.00025) -> tuple[np.ndarray, np.ndarray]:
    """RMS envelope (dBFS) of ``x`` between ``t0`` and ``t1``:
    returns (times, dB)."""
    m = mono(x)
    a, b = max(0, int(t0 * sr)), min(m.shape[-1], int(t1 * sr))
    seg = m[a:b].astype(np.float64)
    w, h = max(1, int(win * sr)), max(1, int(hop * sr))
    c = np.concatenate([[0.0], np.cumsum(seg * seg)])
    starts = np.arange(0, max(1, len(seg) - w), h)
    e = (c[starts + w] - c[starts]) / w
    times = (a + starts + w / 2) / sr
    return times, 10 * np.log10(e + 1e-20)


def onset_near(x: np.ndarray, t: float, sr: int = SR, before: float = 0.1, after: float = 0.1,
               win: float = 0.025) -> dict:
    """Locate the attack of a hit expected at ``t``.

    A hit is where the level jumps and *stays* up: for every candidate time
    in ``[t - before, t + after]`` compare the mean power in the ``win``
    seconds after it with the ``win`` seconds before it, take the largest
    jump, then refine to the first 1 ms frame that rises 6 dB above the
    preceding level (the start of the attack). Ignores quick strokes of
    rolls/ticks and risers that lead into the hit. Returns the onset time,
    the error against ``t`` in ms and the jump in dB."""
    m = mono(x).astype(np.float64)
    a = max(0, int((t - before - win - 0.01) * sr))
    b = min(m.shape[-1], int((t + after + win + 0.01) * sr))
    p = m[a:b] ** 2
    c = np.concatenate([[0.0], np.cumsum(p)])
    W = int(win * sr)
    hop = max(1, int(0.00025 * sr))
    cand = np.arange(W, len(p) - W, hop)
    tt = (a + cand) / sr
    sel = (tt >= t - before) & (tt <= t + after)
    cand, tt = cand[sel], tt[sel]
    e_after = (c[cand + W] - c[cand]) / W
    e_before = (c[cand] - c[cand - W]) / W
    ratio = 10 * np.log10((e_after + 1e-20) / (e_before + 1e-20))
    k = int(np.argmax(ratio))
    # refine: first 1 ms frame (from 10 ms before the best split) that is 6 dB above the level before
    ref = e_before[k]
    f = max(1, int(0.001 * sr))
    start = cand[k] - int(0.010 * sr)
    onset_i = cand[k]
    for i in range(max(f, start), cand[k] + int(0.010 * sr), hop):
        if (c[i + f] - c[i]) / f > ref * 4.0:
            onset_i = i
            break
    onset = (a + onset_i) / sr
    return {'onset': float(onset), 'error_ms': (onset - t) * 1000.0, 'jump_db': float(ratio[k]),
            'pre_db': float(10 * np.log10(ref + 1e-20)), 'post_db': float(10 * np.log10(e_after[k] + 1e-20))}


def cut_check(x: np.ndarray, t: float, sr: int = SR, window: float = 0.9) -> dict:
    """Check a hard cut to silence at ``t``: level just before, the last time
    the envelope is within 60 dB of that level, and RMS after the cut."""
    m = mono(x)
    i = int(round(t * sr))
    before = m[max(0, i - int(0.25 * sr)):i]
    after = m[i + int(0.005 * sr):i + int(window * sr)]
    rb = 20 * math.log10(float(np.sqrt(np.mean(before.astype(np.float64) ** 2))) + 1e-20)
    ra = 20 * math.log10(float(np.sqrt(np.mean(after.astype(np.float64) ** 2))) + 1e-20)
    pa = 20 * math.log10(float(np.max(np.abs(after))) + 1e-20) if after.size else -400.0
    tt, e = energy_env(x, t - 0.1, t + 0.1, sr)
    loud = np.where(e > rb - 60)[0]
    last = float(tt[loud[-1]]) if loud.size else t
    return {'rms_before_db': rb, 'rms_after_db': ra, 'peak_after_db': pa, 'last_loud': last,
            'cut_error_ms': (last - t) * 1000.0}


def clicks(x: np.ndarray, sr: int = SR, thresh_db: float = 30.0, hop: float = 0.002) -> list[float]:
    """Very rough click finder: frames where the 2nd-difference energy jumps
    ``thresh_db`` above its local median. Returns times (s)."""
    m = mono(x).astype(np.float64)
    d2 = np.diff(m, 2)
    h = int(hop * sr)
    k = d2.shape[0] // h
    e = 10 * np.log10(np.mean(d2[:k * h].reshape(k, h) ** 2, axis=1) + 1e-20)
    from scipy.ndimage import median_filter
    med = median_filter(e, size=101, mode='nearest')
    hits = np.where((e - med > thresh_db) & (e > -90))[0]
    return [float(i * hop) for i in hits]


# ----------------------------------------------------------------------------
# Tables
# ----------------------------------------------------------------------------

def section_table(x: np.ndarray, sections: list[tuple[str, float, float]], sr: int = SR) -> list[dict]:
    """Per-section RMS / peak (dBFS) and max short-term loudness (LUFS)."""
    st_t, st = short_term_loudness(x, sr, 0.1)
    rows = []
    for name, a, b in sections:
        seg = x[:, int(a * sr):int(b * sr)].astype(np.float64)
        rms = 20 * math.log10(float(np.sqrt(np.mean(seg ** 2))) + 1e-20)
        pk = 20 * math.log10(float(np.max(np.abs(seg))) + 1e-20)
        sel = (st_t - 1.5 >= a) & (st_t - 1.5 < b)
        stm = float(st[sel].max()) if sel.any() else float('nan')
        rows.append({'section': name, 'start': a, 'end': b, 'rms_db': rms, 'peak_db': pk, 'st_max_lufs': stm})
    return rows


def summary(x: np.ndarray, sr: int = SR) -> dict:
    x = np.asarray(x, dtype=F32)
    finite = bool(np.all(np.isfinite(x)))
    return {
        'duration_s': x.shape[-1] / sr,
        'samples': int(x.shape[-1]),
        'finite': finite,
        'sample_peak_dbfs': 20 * math.log10(float(np.max(np.abs(x))) + 1e-20),
        'clipped_samples': int(np.sum(np.abs(x) >= 0.9999)),
        'dc_offset': [float(np.mean(c, dtype=np.float64)) for c in x],
        'lufs_integrated': integrated_loudness(x, sr),
        'true_peak_dbtp': true_peak(x),
    }


# ----------------------------------------------------------------------------
# Spectrogram image
# ----------------------------------------------------------------------------

_CMAP = np.array([  # magma-like control points
    [0, 0, 4], [28, 16, 68], [79, 18, 123], [129, 37, 129], [181, 54, 122],
    [229, 80, 100], [251, 135, 97], [254, 194, 135], [252, 253, 191]], dtype=np.float64)


def _colormap(v: np.ndarray) -> np.ndarray:
    v = np.clip(v, 0, 1) * (len(_CMAP) - 1)
    i = np.minimum(v.astype(int), len(_CMAP) - 2)
    f = (v - i)[..., None]
    return (_CMAP[i] * (1 - f) + _CMAP[i + 1] * f).astype(np.uint8)


def spectrogram_png(x: np.ndarray, path: str, sr: int = SR, px_per_sec: float = 8.0, height: int = 420,
                    fmin: float = 25.0, fmax: float = 20000.0, db_floor: float = -110.0,
                    marks: list[tuple[float, str]] | None = None, title: str = '') -> str:
    """Render a log-frequency spectrogram with a short-term loudness strip,
    a time axis and optional section marks to a PNG (numpy + Pillow)."""
    from PIL import Image, ImageDraw, ImageFont
    m = mono(x).astype(F32)
    dur = m.shape[-1] / sr
    nfft, hop = 8192, 1024
    win = np.hanning(nfft).astype(F32)
    nfr = max(1, (m.shape[-1] - nfft) // hop + 1)
    W = max(1, int(round(dur * px_per_sec)))
    freqs = np.fft.rfftfreq(nfft, 1 / sr)
    edges = fmin * (fmax / fmin) ** (np.arange(height + 1) / height)      # ascending
    bin_lo = np.minimum(np.searchsorted(freqs, edges[:-1]), len(freqs) - 1)
    spec = np.full((height, W), -200.0, dtype=np.float32)
    cols = (np.arange(nfr) * hop + nfft / 2) / sr * px_per_sec
    colidx = np.minimum(cols.astype(int), W - 1)
    scale = 2.0 / np.sum(win)
    chunk = 512
    for a in range(0, nfr, chunk):
        b = min(nfr, a + chunk)
        idx = (np.arange(a, b) * hop)[:, None] + np.arange(nfft)[None, :]
        fr = m[idx] * win
        mag = np.abs(np.fft.rfft(fr, axis=1)) * scale
        dbm = 20 * np.log10(mag + 1e-12).astype(np.float32)
        # per display row: max over the bins it covers (interp for narrow rows)
        cs = np.maximum.reduceat(dbm, bin_lo, axis=1)[:, ::-1]           # top row = high freq
        for k, c in enumerate(colidx[a:b]):
            spec[:, c] = np.maximum(spec[:, c], cs[k])
    v = (spec - db_floor) / (-db_floor)
    img = _colormap(v)
    strip_h, axis_h, top_h = 70, 22, 34 if marks else 16
    H = top_h + height + strip_h + axis_h
    canvas = Image.new('RGB', (W + 60, H), (12, 12, 16))
    canvas.paste(Image.fromarray(img, 'RGB'), (50, top_h))
    d = ImageDraw.Draw(canvas)
    font = ImageFont.load_default()
    for f in (50, 100, 200, 500, 1000, 2000, 5000, 10000):
        y = top_h + int(height * (1 - math.log(f / fmin) / math.log(fmax / fmin)))
        d.line([(46, y), (50, y)], fill=(200, 200, 200))
        d.text((2, y - 6), f'{f / 1000:g}k' if f >= 1000 else str(f), fill=(200, 200, 200), font=font)
    # loudness strip
    st_t, st = short_term_loudness(x, sr, 0.1)
    y0 = top_h + height + 4
    def ly(l):
        return y0 + int((strip_h - 8) * (1 - (np.clip(l, -50, -4) + 50) / 46))
    for ref, col in ((-14, (90, 160, 90)), (-24, (70, 70, 90)), (-40, (60, 60, 70))):
        d.line([(50, ly(ref)), (50 + W, ly(ref))], fill=col)
        d.text((4, ly(ref) - 6), f'{ref}', fill=col, font=font)
    pts = [(50 + int((tt - 1.5) * px_per_sec), ly(l)) for tt, l in zip(st_t, st)]
    if len(pts) > 1:
        d.line(pts, fill=(255, 210, 90), width=1)
    ya = top_h + height + strip_h
    for s in range(0, int(dur) + 1, 10):
        xx = 50 + int(s * px_per_sec)
        d.line([(xx, ya), (xx, ya + 4)], fill=(200, 200, 200))
        d.text((xx - 8, ya + 6), f'{s}', fill=(200, 200, 200), font=font)
    if marks:
        for k, (tm, label) in enumerate(marks):
            xx = 50 + int(tm * px_per_sec)
            d.line([(xx, top_h), (xx, top_h + height)], fill=(120, 200, 255), width=1)
            d.text((xx + 2, 2 + (k % 2) * 14), label, fill=(150, 210, 255), font=font)
    if title:
        d.text((W - 300, 2), title, fill=(230, 230, 230), font=font)
    canvas.save(path)
    return path
