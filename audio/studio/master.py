"""Mastering: ITU-R BS.1770-4 loudness, true peak, limiting, normalisation.

* :func:`integrated_loudness` implements BS.1770-4 exactly: K-weighting
  (high-shelf pre-filter + RLB high-pass, derived for any sample rate),
  400 ms blocks with 75 % overlap, absolute gate at -70 LUFS and relative
  gate at -10 LU.
* :func:`true_peak` estimates inter-sample peaks by 4x polyphase oversampling
  (as in BS.1770 Annex 2).
* :func:`limit` is an offline look-ahead limiter driven by the oversampled
  peak envelope: a centred min-filter plus moving average (so the gain never
  exceeds what the ceiling requires) followed by a smooth release.
* :func:`master` chains glue compression, loudness normalisation to a LUFS
  target and the true-peak limiter, iterating until both targets are met.
"""
from __future__ import annotations

import math

import numpy as np
from scipy.ndimage import minimum_filter1d, uniform_filter1d
from scipy.signal import resample_poly, sosfilt

from .core import F32, SR, db, stereo
from .fx import compress


# ----------------------------------------------------------------------------
# K-weighting and loudness
# ----------------------------------------------------------------------------

def k_weighting_sos(sr: int = SR) -> np.ndarray:
    """The two BS.1770 K-weighting biquads as SOS, derived for ``sr``.

    The analog-prototype derivation follows libebur128's ``ebur128_init_filter``
    (MIT License, Copyright (c) 2011 Jan Kokemüller; see THIRD_PARTY_NOTICES.md).
    At 48 kHz this reproduces the coefficients tabulated in the standard."""
    # stage 1: high-shelf (head acoustics)
    f0, G, Q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    K = math.tan(math.pi * f0 / sr)
    Vh = 10 ** (G / 20)
    Vb = Vh ** 0.4996667741545416
    a0 = 1 + K / Q + K * K
    b1 = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0]
    a1 = [1.0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]
    # stage 2: RLB high-pass
    f0, Q = 38.13547087602444, 0.5003270373238773
    K = math.tan(math.pi * f0 / sr)
    d = 1 + K / Q + K * K
    b2 = [1.0, -2.0, 1.0]
    a2 = [1.0, 2 * (K * K - 1) / d, (1 - K / Q + K * K) / d]
    return np.array([b1 + a1, b2 + a2], dtype=np.float64)


def _block_powers(x: np.ndarray, sr: int, block: float, step: float) -> np.ndarray:
    """Mean-square of the K-weighted signal per channel for each gating block
    (``block`` long, hopping by ``step``; block must be a multiple of step).
    Filtering is chunked with carried state; per-step sums accumulate in float64."""
    s = stereo(np.asarray(x))
    st = int(round(step * sr))
    k = int(round(block / step))
    n = s.shape[-1]
    m = n // st
    if m < k:
        return np.zeros((s.shape[0], 0))
    sos = k_weighting_sos(sr).astype(F32)
    zi = np.zeros((sos.shape[0], s.shape[0], 2), F32)
    seg = np.empty((s.shape[0], m))
    per = max(1, (1 << 18) // st)                # segments per chunk
    for j0 in range(0, m, per):
        j1 = min(m, j0 + per)
        y, zi = sosfilt(sos, s[:, j0 * st:j1 * st].astype(F32, copy=False), axis=-1, zi=zi)
        np.square(y, out=y)
        seg[:, j0:j1] = y.reshape(s.shape[0], j1 - j0, st).sum(axis=2, dtype=np.float64)
    csum = np.concatenate([np.zeros((s.shape[0], 1)), np.cumsum(seg, axis=1)], axis=1)
    return (csum[:, k:] - csum[:, :-k]) / (k * st)


def integrated_loudness(x: np.ndarray, sr: int = SR) -> float:
    """BS.1770-4 gated integrated loudness in LUFS (stereo, G = 1 per channel)."""
    z = _block_powers(x, sr, 0.4, 0.1)
    if z.shape[1] == 0:
        return -math.inf
    tot = z.sum(axis=0)
    lj = -0.691 + 10 * np.log10(tot + 1e-30)
    keep = lj > -70.0
    if not keep.any():
        return -math.inf
    rel = -0.691 + 10 * math.log10(tot[keep].mean()) - 10.0
    keep &= lj > rel
    if not keep.any():
        return -math.inf
    return -0.691 + 10 * math.log10(tot[keep].mean())


def short_term_loudness(x: np.ndarray, sr: int = SR, step: float = 0.1) -> tuple[np.ndarray, np.ndarray]:
    """Short-term (3 s window) loudness curve: returns (times of window end, LUFS)."""
    z = _block_powers(x, sr, 3.0, step)
    tot = z.sum(axis=0)
    t = 3.0 + np.arange(tot.shape[0]) * step
    return t, -0.691 + 10 * np.log10(tot + 1e-30)


def momentary_loudness(x: np.ndarray, sr: int = SR, step: float = 0.1):
    z = _block_powers(x, sr, 0.4, step)
    tot = z.sum(axis=0)
    t = 0.4 + np.arange(tot.shape[0]) * step
    return t, -0.691 + 10 * np.log10(tot + 1e-30)


def loudness_range(x: np.ndarray, sr: int = SR) -> float:
    """EBU R128 loudness range (LRA) in LU."""
    _, st = short_term_loudness(x, sr, 0.1)
    st = st[st > -70]
    if st.size == 0:
        return 0.0
    p = 10 ** (st / 10)
    rel = 10 * math.log10(p.mean()) - 20
    st = st[st > rel]
    if st.size < 2:
        return 0.0
    return float(np.percentile(st, 95) - np.percentile(st, 10))


# ----------------------------------------------------------------------------
# True peak
# ----------------------------------------------------------------------------

def peak_envelope(x: np.ndarray, os: int = 4, chunk: int = 1 << 20) -> np.ndarray:
    """Per-sample maximum absolute value of the ``os``-times oversampled
    signal over both channels (inter-sample peaks included). Chunked to keep
    memory small."""
    s = stereo(np.asarray(x, dtype=F32))
    n = s.shape[-1]
    out = np.empty(n, F32)
    pad = 64
    for a in range(0, n, chunk):
        b = min(n, a + chunk)
        lo, hi = max(0, a - pad), min(n, b + pad)
        u = resample_poly(s[:, lo:hi], os, 1, axis=-1)
        u = np.abs(u).max(axis=0)
        u = u[(a - lo) * os:(b - lo) * os].reshape(b - a, os).max(axis=1)
        out[a:b] = np.maximum(u, np.abs(s[:, a:b]).max(axis=0))
    return out


def true_peak(x: np.ndarray, os: int = 4) -> float:
    """True-peak level in dBTP (4x oversampled estimate)."""
    p = float(peak_envelope(x, os).max()) if np.size(x) else 0.0
    return 20 * math.log10(max(p, 1e-12))


def sample_peak(x: np.ndarray) -> float:
    return 20 * math.log10(max(float(np.max(np.abs(x))), 1e-12))


# ----------------------------------------------------------------------------
# Limiter
# ----------------------------------------------------------------------------

def _release_curve(g: np.ndarray, release: float, sr: int, hop: int = 32) -> None:
    """In place: let ``g`` drop instantly but recover with time constant
    ``release`` (evaluated at control rate, interpolated, never above g)."""
    n = g.shape[0]
    m = (n + hop - 1) // hop
    fr = np.ones(m * hop, F32)
    fr[:n] = g
    fr = fr.reshape(m, hop).min(axis=1).astype(np.float64)
    if fr.min() >= 1.0:
        return
    a = math.exp(-hop / (release * sr))
    outc = np.empty(m)
    cur = 1.0
    for i, v in enumerate(fr.tolist()):
        cur = v if v < cur else v + (cur - v) * a
        outc[i] = cur
    centers = np.arange(m) * hop + hop / 2
    for c0 in range(0, n, 1 << 16):
        c1 = min(n, c0 + (1 << 16))
        rel = np.interp(np.arange(c0, c1, dtype=np.float64), centers, outc).astype(F32)
        np.minimum(g[c0:c1], rel, out=g[c0:c1])


def gain_from_peaks(p: np.ndarray, pre_gain: float, ceiling_db: float = -1.0, lookahead: float = 0.0025,
                    release: float = 0.12, sr: int = SR, out: np.ndarray | None = None,
                    work: np.ndarray | None = None) -> np.ndarray:
    """Limiter gain curve (float32, <= 1) for a signal whose oversampled peak
    envelope is ``p`` after a make-up gain ``pre_gain`` (linear)."""
    c = 10 ** (ceiling_db / 20) / pre_gain
    n = p.shape[0]
    g = np.empty(n, F32) if out is None else out
    w = np.empty(n, F32) if work is None else work
    np.maximum(p, F32(1e-9), out=w)
    np.divide(F32(c), w, out=w)
    np.minimum(w, F32(1.0), out=w)
    if w.min() >= 1.0:
        g.fill(1.0)
        return g
    L = max(1, int(lookahead * sr))
    # centred min over +-L, then a centred moving average over +-L: every
    # averaged value includes the requirement at the centre, so g <= req.
    minimum_filter1d(w, size=2 * L + 1, mode='nearest', output=g)
    uniform_filter1d(g, size=2 * L + 1, mode='nearest', output=w)
    g[:] = w
    _release_curve(g, release, sr)
    return g


def limiter_gain(x: np.ndarray, ceiling_db: float = -1.0, lookahead: float = 0.0025,
                 release: float = 0.12, os: int = 4, sr: int = SR) -> np.ndarray:
    """Gain curve (float32, <= 1) that keeps the oversampled peaks of ``x``
    under ``ceiling_db``. Offline and non-causal, so the look-ahead is free."""
    return gain_from_peaks(peak_envelope(x, os), 1.0, ceiling_db, lookahead, release, sr)


def _apply(x: np.ndarray, g: np.ndarray, pre_gain: float, out: np.ndarray, chunk: int = 1 << 18) -> np.ndarray:
    n = x.shape[-1]
    pg = F32(pre_gain)
    for a in range(0, n, chunk):
        b = min(n, a + chunk)
        np.multiply(x[:, a:b], g[a:b] * pg, out=out[:, a:b])
    return out


def limit(x: np.ndarray, ceiling_db: float = -1.0, **kw) -> tuple[np.ndarray, np.ndarray]:
    """Apply the true-peak limiter; returns (y, gain_curve)."""
    x = np.asarray(x, dtype=F32)
    g = limiter_gain(x, ceiling_db, **kw)
    return _apply(x, g, 1.0, np.empty_like(x)), g


# ----------------------------------------------------------------------------
# Master chain
# ----------------------------------------------------------------------------

def gr_events(g: np.ndarray, sr: int = SR, thresh_db: float = 2.0, gap: float = 0.25, top: int = 12) -> list:
    """Where the limiter works: [(start_s, end_s, max_gain_reduction_db)] for
    regions with more than ``thresh_db`` of reduction (loudest first)."""
    hop = 480
    m = g.shape[0] // hop
    fr = g[:m * hop].reshape(m, hop).min(axis=1)
    idx = np.where(fr < 10 ** (-thresh_db / 20))[0]
    ev = []
    for i in idx:
        t = i * hop / sr
        if ev and t - ev[-1][1] <= gap:
            ev[-1][1] = t + hop / sr
            ev[-1][2] = min(ev[-1][2], float(fr[i]))
        else:
            ev.append([t, t + hop / sr, float(fr[i])])
    ev = [(round(a, 2), round(b, 2), round(-20 * math.log10(max(v, 1e-9)), 2)) for a, b, v in ev]
    return sorted(ev, key=lambda e: -e[2])[:top]


def master(x: np.ndarray, target_lufs: float = -14.0, tp_ceiling: float = -1.0, glue: bool = True,
           glue_threshold: float | None = None, sr: int = SR, log=print) -> tuple[np.ndarray, dict]:
    """Glue compression -> loudness normalisation -> true-peak limiting.

    Iterates the make-up gain so that the *limited* output hits
    ``target_lufs`` (within 0.05 LU) with true peak <= ``tp_ceiling``.
    The oversampled peak envelope is computed once and reused, since the
    limiter's input only changes by a constant gain between iterations.
    Returns ``(y, report)``.
    """
    x = np.asarray(x, dtype=F32)
    rep = {}
    if glue:
        # threshold relative to the programme loudness so behaviour does not
        # depend on the absolute level the mix happens to be at
        L0 = integrated_loudness(x, sr)
        thr = (L0 + 4.0) if glue_threshold is None else glue_threshold
        x, gr = compress(x, threshold=thr, ratio=1.6, attack=0.03, release=0.35, knee=8.0,
                         sr=sr, return_gain=True)
        rep['glue_max_gr_db'] = float(-gr.min())
        rep['glue_threshold'] = float(thr)
    L = integrated_loudness(x, sr)
    rep['pre_lufs'] = L
    p = peak_envelope(x)
    n = x.shape[-1]
    g = np.empty(n, F32)
    work = np.empty(n, F32)
    y = np.empty_like(x)
    ceiling = tp_ceiling - 0.25
    g_db = target_lufs - L
    it = 0
    for it in range(8):
        gain_from_peaks(p, db(g_db), ceiling, sr=sr, out=g, work=work)
        _apply(x, g, db(g_db), y)
        L = integrated_loudness(y, sr)
        if abs(L - target_lufs) < 0.03:
            break
        g_db += target_lufs - L
    del work, p
    tp = true_peak(y)
    if tp > tp_ceiling - 0.05:
        y *= F32(db(tp_ceiling - 0.05 - tp))
        tp = true_peak(y)
        L = integrated_loudness(y, sr)
    rep['limiter_events'] = gr_events(g, sr)
    rep.update(gain_db=g_db, lufs=L, true_peak=tp, limiter_max_gr_db=float(-20 * np.log10(max(float(g.min()), 1e-9))),
               limiter_time_over_1db=float(np.count_nonzero(g < db(-1.0)) / sr),
               limiter_time_over_3db=float(np.count_nonzero(g < db(-3.0)) / sr),
               iterations=it + 1)
    return y, rep


def master_fixed(x: np.ndarray, gain_db: float, glue_threshold: float | None, tp_ceiling: float = -1.0,
                 sr: int = SR) -> tuple[np.ndarray, dict]:
    """The same chain as :func:`master` with settings taken from a previous
    full render (glue threshold, make-up gain), for partial previews that
    match the full mix."""
    x = np.asarray(x, dtype=F32)
    if glue_threshold is not None:
        x = compress(x, threshold=glue_threshold, ratio=1.6, attack=0.03, release=0.35, knee=8.0, sr=sr)
    p = peak_envelope(x)
    g = gain_from_peaks(p, db(gain_db), tp_ceiling - 0.25, sr=sr)
    y = _apply(x, g, db(gain_db), np.empty_like(x))
    return y, {'gain_db': gain_db, 'glue_threshold': glue_threshold, 'lufs': integrated_loudness(y, sr),
               'true_peak': true_peak(y), 'note': 'partial render: chain settings reused from the last full render'}
