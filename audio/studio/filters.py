"""Filters: RBJ-cookbook biquads, Butterworth helpers and time-varying sweeps.

Static filters run through ``scipy.signal.sosfilt`` along the last axis, so
they work on mono ``(n,)`` and stereo ``(2, n)`` buffers alike.

Time-varying filters (:func:`sweep`) recompute biquad coefficients every
``block`` samples (default 32, i.e. 0.67 ms) and carry the filter state across
blocks, which is smooth for musical sweeps (filter envelopes, risers, wind).

The capitalised classes (:class:`HP`, :class:`LP`, :class:`EQ`,
:class:`AutoFilter`) are track insert effects: callables ``f(x, t0)``.
"""
from __future__ import annotations

import math
from functools import lru_cache
from typing import Sequence

import numpy as np
from scipy.signal import butter, lfilter, sosfilt

from .core import F32, SR

KINDS = ('lowpass', 'highpass', 'bandpass', 'notch', 'peak', 'lowshelf', 'highshelf', 'allpass')


def rbj(kind: str, f0, q=0.7071, gain_db=0.0, sr: int = SR):
    """RBJ biquad coefficients. ``f0``/``q``/``gain_db`` may be arrays (then the
    result has shape ``(m, 3)``). Returns normalised ``(b, a)`` with a0 = 1.

    ``bandpass`` has 0 dB peak gain. Shelves use ``q`` as the shelf Q
    (0.7071 corresponds to slope S = 1)."""
    f0 = np.clip(np.asarray(f0, dtype=np.float64), 1.0, 0.49 * sr)
    q = np.maximum(np.asarray(q, dtype=np.float64), 1e-3)
    w0 = 2 * np.pi * f0 / sr
    cw, sw = np.cos(w0), np.sin(w0)
    alpha = sw / (2 * q)
    A = np.power(10.0, np.asarray(gain_db, dtype=np.float64) / 40.0)
    one = np.ones_like(w0)
    if kind == 'lowpass':
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == 'highpass':
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == 'bandpass':
        b = [alpha, 0 * one, -alpha]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == 'notch':
        b = [one, -2 * cw, one]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == 'allpass':
        b = [1 - alpha, -2 * cw, 1 + alpha]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == 'peak':
        b = [1 + alpha * A, -2 * cw, 1 - alpha * A]
        a = [1 + alpha / A, -2 * cw, 1 - alpha / A]
    elif kind == 'lowshelf':
        s = 2 * np.sqrt(A) * alpha
        b = [A * ((A + 1) - (A - 1) * cw + s), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - s)]
        a = [(A + 1) + (A - 1) * cw + s, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - s]
    elif kind == 'highshelf':
        s = 2 * np.sqrt(A) * alpha
        b = [A * ((A + 1) + (A - 1) * cw + s), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - s)]
        a = [(A + 1) - (A - 1) * cw + s, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - s]
    else:
        raise ValueError(f'unknown filter kind {kind!r}')
    b = np.stack(np.broadcast_arrays(*b), axis=-1)
    a = np.stack(np.broadcast_arrays(*a), axis=-1)
    a0 = a[..., :1]
    return b / a0, a / a0


def rbj_sos(kind: str, f0: float, q: float = 0.7071, gain_db: float = 0.0, sr: int = SR) -> np.ndarray:
    b, a = rbj(kind, f0, q, gain_db, sr)
    return np.concatenate([b, a]).reshape(1, 6)


@lru_cache(maxsize=512)
def butter_sos(kind: str, freq, order: int = 2, sr: int = SR) -> np.ndarray:
    """Cached Butterworth SOS. ``kind`` in lowpass/highpass/bandpass/bandstop;
    ``freq`` is a float or a (lo, hi) tuple for band filters."""
    if isinstance(freq, tuple):
        wn = tuple(min(max(f, 1.0), 0.49 * sr) for f in freq)
    else:
        wn = min(max(float(freq), 1.0), 0.49 * sr)
    return butter(order, wn, btype=kind, fs=sr, output='sos')


def apply_sos(x: np.ndarray, sos: np.ndarray) -> np.ndarray:
    x = np.asarray(x)
    dt = x.dtype if x.dtype in (np.float32, np.float64) else np.float64
    return sosfilt(sos.astype(dt, copy=False), x, axis=-1)


def sosfilt_inplace(x: np.ndarray, sos: np.ndarray, chunk: int = 1 << 17) -> np.ndarray:
    """Filter ``x`` (float, last axis = time) in place, chunk by chunk with the
    state carried across chunks: no full-length temporaries."""
    sos = sos.astype(x.dtype, copy=False)
    zi = np.zeros((sos.shape[0],) + x.shape[:-1] + (2,), dtype=x.dtype)
    n = x.shape[-1]
    for a in range(0, n, chunk):
        b = min(n, a + chunk)
        x[..., a:b], zi = sosfilt(sos, x[..., a:b], axis=-1, zi=zi)
    return x


def biquad(x: np.ndarray, kind: str, f0: float, q: float = 0.7071, gain_db: float = 0.0,
           sr: int = SR) -> np.ndarray:
    """Apply one static RBJ biquad."""
    return apply_sos(x, rbj_sos(kind, f0, q, gain_db, sr))


def lowpass(x, f, order: int = 2, sr: int = SR):
    return apply_sos(x, butter_sos('lowpass', float(f), order, sr))


def highpass(x, f, order: int = 2, sr: int = SR):
    return apply_sos(x, butter_sos('highpass', float(f), order, sr))


def bandpass(x, f, q: float = 1.0, sr: int = SR):
    """RBJ constant-0dB-peak bandpass centred on ``f``."""
    return biquad(x, 'bandpass', f, q, 0.0, sr)


def bandpass_bw(x, lo, hi, order: int = 2, sr: int = SR):
    return apply_sos(x, butter_sos('bandpass', (float(lo), float(hi)), order, sr))


def peak(x, f, gain_db, q: float = 1.0, sr: int = SR):
    return biquad(x, 'peak', f, q, gain_db, sr)


def lowshelf(x, f, gain_db, q: float = 0.7071, sr: int = SR):
    return biquad(x, 'lowshelf', f, q, gain_db, sr)


def highshelf(x, f, gain_db, q: float = 0.7071, sr: int = SR):
    return biquad(x, 'highshelf', f, q, gain_db, sr)


def onepole_lp(x, f, sr: int = SR):
    """6 dB/oct low-pass."""
    a = math.exp(-2 * math.pi * min(f, 0.49 * sr) / sr)
    return lfilter([1 - a], [1, -a], x, axis=-1).astype(np.asarray(x).dtype, copy=False)


def onepole_hp(x, f, sr: int = SR):
    x = np.asarray(x)
    return x - onepole_lp(x, f, sr)


def eq(x, bands: Sequence[tuple], sr: int = SR):
    """Chain of RBJ bands: ``[(kind, f0, q, gain_db), ...]``."""
    sos = np.concatenate([rbj_sos(k, f, q, g, sr) for (k, f, q, g) in bands])
    return apply_sos(x, sos)


def sweep(x: np.ndarray, kind: str, f0, q=0.7071, gain_db=0.0, block: int = 32,
          sr: int = SR, stages: int = 1) -> np.ndarray:
    """Time-varying biquad. ``f0`` (and optionally ``q``) may be per-sample
    arrays or callables of time (seconds from the start of ``x``).
    ``stages`` cascades identical sections (e.g. 2 = 24 dB/oct)."""
    x = np.asarray(x)
    n = x.shape[-1]
    nb = (n + block - 1) // block
    centres = np.minimum(np.arange(nb) * block + block // 2, n - 1)
    def at(v):
        if callable(v):
            return np.asarray(v(centres / sr), dtype=np.float64)
        if np.ndim(v) == 0:
            return np.full(nb, float(v))
        return np.asarray(v, dtype=np.float64)[centres]
    b, a = rbj(kind, at(f0), at(q), at(gain_db), sr)
    y = np.array(x, dtype=F32 if x.dtype == np.float32 else np.float64, copy=True)
    lead = y.shape[:-1]
    for _ in range(stages):
        zi = np.zeros(lead + (2,), dtype=y.dtype)
        bb = b.astype(y.dtype)
        aa = a.astype(y.dtype)
        for k in range(nb):
            s = slice(k * block, min(n, (k + 1) * block))
            y[..., s], zi = lfilter(bb[k], aa[k], y[..., s], axis=-1, zi=zi)
    return y


def smooth(x: np.ndarray, ms: float, sr: int = SR) -> np.ndarray:
    """Moving-average smoothing (for envelopes)."""
    k = max(1, int(ms * sr / 1000))
    from scipy.ndimage import uniform_filter1d
    return uniform_filter1d(np.asarray(x, dtype=np.float64), k, axis=-1, mode='nearest')


# ----------------------------------------------------------------------------
# Insert-effect wrappers (callables f(x, t0))
# ----------------------------------------------------------------------------

class HP:
    """High-pass insert (Butterworth); filters in place."""
    tail = 0.05

    def __init__(self, freq: float, order: int = 2, sr: int = SR):
        self.sos = butter_sos('highpass', float(freq), order, sr)

    def __call__(self, x, t0=0.0):
        return sosfilt_inplace(x, self.sos) if x.dtype in (np.float32, np.float64) else apply_sos(x, self.sos)


class LP:
    """Low-pass insert (Butterworth); filters in place."""
    tail = 0.02

    def __init__(self, freq: float, order: int = 2, sr: int = SR):
        self.sos = butter_sos('lowpass', float(freq), order, sr)

    def __call__(self, x, t0=0.0):
        return sosfilt_inplace(x, self.sos) if x.dtype in (np.float32, np.float64) else apply_sos(x, self.sos)


class EQ:
    """Chain of RBJ bands ``(kind, f0, q, gain_db)``."""
    tail = 0.05

    def __init__(self, *bands, sr: int = SR):
        self.sos = np.concatenate([rbj_sos(k, f, q, g, sr) for (k, f, q, g) in bands])

    def __call__(self, x, t0=0.0):
        return sosfilt_inplace(x, self.sos) if x.dtype in (np.float32, np.float64) else apply_sos(x, self.sos)


class AutoFilter:
    """Filter whose cutoff follows absolute-time breakpoints ``[(t, Hz), ...]``
    (interpolated in log-frequency). Outside the breakpoints the filter holds
    the first/last value; if ``bypass_above`` is set, regions where the cutoff
    is at/above it pass through untouched (saves CPU)."""
    tail = 0.05

    def __init__(self, kind: str, points, q: float = 0.7071, stages: int = 1,
                 bypass_above: float | None = None, sr: int = SR):
        self.kind, self.q, self.stages, self.sr = kind, q, stages, sr
        self.t = np.array([p[0] for p in points], dtype=np.float64)
        self.lf = np.log(np.array([p[1] for p in points], dtype=np.float64))
        self.bypass_above = bypass_above

    def freq_at(self, t):
        return np.exp(np.interp(t, self.t, self.lf))

    def __call__(self, x, t0=0.0):
        n = x.shape[-1]
        if self.bypass_above is not None:
            tt = t0 + np.arange(0, n, 256) / self.sr
            f = self.freq_at(tt)
            active = f < self.bypass_above
            if not active.any():
                return x
            i0 = max(0, int(np.argmax(active)) * 256 - 4096)
            y = np.array(x, copy=True)
            y[..., i0:] = sweep(x[..., i0:], self.kind, lambda tl: self.freq_at(t0 + i0 / self.sr + tl),
                                self.q, sr=self.sr, stages=self.stages)
            return y
        return sweep(x, self.kind, lambda tl: self.freq_at(t0 + tl), self.q, sr=self.sr, stages=self.stages)
