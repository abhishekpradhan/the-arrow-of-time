"""Effects: synthesized convolution reverb, chorus, delay, saturation,
compression and stereo width.

Reverb impulse responses are generated (no samples needed): sparse early
reflections followed by a diffuse tail built from independent noise per
channel (so L/R are decorrelated), split into octave-ish bands that each decay
with their own RT60 (highs die faster than lows, like a real room). They are
cached in memory, so asking for the same room twice costs nothing.

Insert-effect classes are callables ``f(x, t0) -> y`` on ``(2, n)`` arrays and
expose a ``tail`` attribute (seconds of extra output they produce).
"""
from __future__ import annotations

import math
from functools import lru_cache

import numpy as np
from scipy.signal import oaconvolve, resample_poly, sosfilt

from .core import F32, SR, db, rng, stereo
from .filters import apply_sos, butter_sos

# ----------------------------------------------------------------------------
# Reverb impulse responses
# ----------------------------------------------------------------------------

#: name -> (rt60 s, predelay s, early-reflection window s, ER level, HF damping cutoff Hz,
#:          per-band RT multipliers for bands [<250, 250-700, 700-2k, 2k-5k, 5k-10k, >10k])
IR_PRESETS = {
    'room':      (0.45, 0.003, 0.025, 0.55, 11000, (1.15, 1.05, 1.0, 0.85, 0.65, 0.45)),
    'chamber':   (1.3, 0.012, 0.045, 0.40, 10000, (1.2, 1.1, 1.0, 0.8, 0.6, 0.4)),
    'plate':     (2.4, 0.008, 0.010, 0.10, 12000, (0.9, 1.0, 1.0, 0.95, 0.8, 0.6)),
    'hall':      (4.2, 0.028, 0.085, 0.30, 9500, (1.3, 1.15, 1.0, 0.8, 0.55, 0.35)),
    'cathedral': (7.5, 0.045, 0.140, 0.22, 8000, (1.35, 1.2, 1.0, 0.75, 0.5, 0.3)),
}

_BANDS = [(None, 250.0), (250.0, 700.0), (700.0, 2000.0), (2000.0, 5000.0), (5000.0, 10000.0), (10000.0, None)]


@lru_cache(maxsize=16)
def reverb_ir(kind: str = 'hall', rt60: float | None = None, predelay: float | None = None,
              seed: int = 1, sr: int = SR) -> np.ndarray:
    """Synthesize a stereo impulse response ``(2, m)`` (float32, cached).

    ``kind`` is one of :data:`IR_PRESETS` (room, chamber, plate, hall,
    cathedral); ``rt60`` / ``predelay`` override the preset. The IR is
    normalised to unit energy per channel, so a send level in dB sets the wet
    level for noise-like material.
    """
    base_rt, base_pd, er_win, er_lvl, damp, mults = IR_PRESETS[kind]
    rt = float(rt60 or base_rt)
    pd = float(base_pd if predelay is None else predelay)
    r = rng('ir', kind, rt, pd, seed)
    n = int((pd + rt * 1.15 + 0.05) * sr)
    t = np.arange(n) / sr
    out = np.zeros((2, n))
    tail_t = np.maximum(t - pd, 0.0)
    # density build-up: the diffuse field needs a moment to fill in
    build = 1.0 - np.exp(-tail_t / max(0.004, er_win * 0.6))
    build[t < pd] = 0.0
    for ch in range(2):
        noise = r.standard_normal(n)
        tail = np.zeros(n)
        for (lo, hi), m in zip(_BANDS, mults):
            if lo is None:
                band = apply_sos(noise, butter_sos('lowpass', hi, 4, sr))
            elif hi is None:
                band = apply_sos(noise, butter_sos('highpass', lo, 4, sr))
            else:
                band = apply_sos(noise, butter_sos('bandpass', (lo, hi), 2, sr))
            tail += band * np.exp(-6.9078 * tail_t / (rt * m))
        tail *= build
        # early reflections: sparse taps with random sign, decaying, per channel
        er = np.zeros(n)
        k = 18 if kind != 'plate' else 4
        times = pd + np.sort(r.uniform(0.0015, er_win, k))
        amps = er_lvl * np.exp(-3.0 * (times - pd) / er_win) * r.choice([-1.0, 1.0], k) * r.uniform(0.5, 1.0, k)
        idx = np.minimum((times * sr).astype(int), n - 1)
        np.add.at(er, idx, amps)
        er = apply_sos(er, butter_sos('lowpass', 7000.0, 2, sr))
        # scale tail so its energy is comparable to its ER
        tail /= math.sqrt(np.sum(tail ** 2)) + 1e-12
        er_e = math.sqrt(np.sum(er ** 2)) + 1e-12
        y = tail + er * (er_lvl / er_e)
        y = apply_sos(y, butter_sos('lowpass', float(damp), 2, sr))
        y = apply_sos(y, butter_sos('highpass', 30.0, 2, sr))
        out[ch] = y
    # fade the very end to avoid truncation clicks
    m = int(0.05 * sr)
    out[:, -m:] *= np.linspace(1.0, 0.0, m)
    out /= np.sqrt(np.sum(out ** 2, axis=1, keepdims=True)) + 1e-12
    return out.astype(F32)


def convolve(x: np.ndarray, ir: np.ndarray, cross: float = 0.3) -> np.ndarray:
    """Stereo convolution. Each output channel convolves a mix of both input
    channels (``cross`` = share of the opposite channel), so hard-panned
    sources still bloom into both sides, with the decorrelated IR channels
    providing width. Output length = len(x) + len(ir) - 1 (float32)."""
    x = stereo(np.asarray(x, dtype=F32))
    ir = stereo(np.asarray(ir, dtype=F32))
    if cross:
        xl = x[0] * F32(1 - cross) + x[1] * F32(cross)
        xr = x[1] * F32(1 - cross) + x[0] * F32(cross)
    else:
        xl, xr = x[0], x[1]
    yl = oaconvolve(xl, ir[0])
    yr = oaconvolve(xr, ir[1])
    return np.stack([yl, yr]).astype(F32, copy=False)


def convolve_into(out: np.ndarray, at: int, x: np.ndarray, ir: np.ndarray, cross: float = 0.3,
                  stop: int | None = None, gain: float = 1.0, fade: np.ndarray | None = None,
                  chunk: int = 1 << 20) -> None:
    """Add ``gain * convolve(x, ir)`` into ``out[:, at:]``, processing the input
    in chunks (overlap-add), keeping only the first ``stop`` output samples.
    If ``fade`` (a descending ramp) is given, the kept output ends with it
    (used for hard cuts)."""
    n, M = x.shape[-1], ir.shape[-1]
    total = n + M - 1 if stop is None else min(stop, n + M - 1)
    total = min(total, out.shape[-1] - at)
    if total <= 0:
        return
    g = F32(gain)
    for a in range(0, n, chunk):
        if a >= total:
            break
        b = min(n, a + chunk)
        xl, xr = x[0, a:b], x[1, a:b]
        if cross:
            xl, xr = xl * F32(1 - cross) + xr * F32(cross), xr * F32(1 - cross) + xl * F32(cross)
        m = min(total - a, (b - a) + M - 1)
        for c, xc in ((0, xl), (1, xr)):
            y = oaconvolve(xc, ir[c])[:m].astype(F32, copy=False)
            y *= g
            if fade is not None and a + m > total - fade.shape[0]:
                f0 = total - fade.shape[0]            # fade starts here (relative to x)
                lo = max(f0, a)
                y[lo - a:m] *= fade[lo - f0:lo - f0 + (m - (lo - a))]
            out[c, at + a:at + a + m] += y


def reverb(x: np.ndarray, kind: str = 'hall', mix: float = 0.3, hp: float = 180.0, **kw) -> np.ndarray:
    """One-shot convenience: dry + wet (wet high-passed at ``hp``)."""
    x = stereo(np.asarray(x, dtype=F32))
    ir = reverb_ir(kind, **kw)
    send = apply_sos(x, butter_sos('highpass', hp, 2)) if hp else x
    wet = convolve(send, ir)
    y = np.zeros_like(wet)
    y[:, :x.shape[-1]] += x * F32(1 - mix)
    y += wet * F32(mix)
    return y


# ----------------------------------------------------------------------------
# Modulation / time effects
# ----------------------------------------------------------------------------

def frac_delay(x: np.ndarray, d: np.ndarray) -> np.ndarray:
    """Read mono ``x`` delayed by ``d`` samples (array, 0 <= d) with linear
    interpolation; zero before the start."""
    n = x.shape[-1]
    pad = int(np.ceil(float(np.max(d)))) + 2
    xp = np.concatenate([np.zeros(pad, F32), np.asarray(x, dtype=F32), np.zeros(1, F32)])
    pos = np.arange(pad, n + pad, dtype=np.float64) - d
    i = pos.astype(np.int64)
    f = (pos - i).astype(F32)
    a = xp[i]
    b = xp[i + 1]
    b -= a
    b *= f
    b += a
    return b


class Chorus:
    """Multi-voice stereo chorus/ensemble. LFOs run on absolute time so
    segments rendered separately stay continuous."""

    def __init__(self, rate: float = 0.35, depth_ms: float = 2.5, delay_ms: float = 14.0,
                 mix: float = 0.4, voices: int = 2, seed: int = 0, sr: int = SR):
        self.rate, self.depth, self.delay, self.mix, self.voices, self.sr = rate, depth_ms, delay_ms, mix, voices, sr
        r = rng('chorus', seed)
        self.ph = r.uniform(0, 2 * math.pi, (2, voices))
        self.rates = rate * r.uniform(0.8, 1.25, (2, voices))
        self.tail = (delay_ms + depth_ms) / 1000.0

    def __call__(self, x, t0=0.0):
        x = stereo(np.asarray(x, dtype=F32))
        n = x.shape[-1]
        t = t0 + np.arange(n) / self.sr
        y = x * F32(1.0 - 0.5 * self.mix)
        for c in range(2):
            src = x[c] * F32(0.7) + x[1 - c] * F32(0.3)
            for v in range(self.voices):
                d = (self.delay * (1 + 0.35 * v) + self.depth * np.sin(2 * math.pi * self.rates[c, v] * t + self.ph[c, v])) * self.sr / 1000
                y[c] += frac_delay(src, d) * F32(self.mix / self.voices)
        return y


def chorus(x, t0: float = 0.0, **kw):
    return Chorus(**kw)(x, t0)


class Delay:
    """Feedback (optionally ping-pong) delay with filtered repeats. Computed
    block-wise (block = delay time), so it is fully vectorised."""

    def __init__(self, time: float = 0.375, feedback: float = 0.35, mix: float = 0.25,
                 pingpong: bool = True, lp: float = 5000.0, hp: float = 250.0, sr: int = SR):
        self.time, self.fb, self.mix, self.pp, self.sr = time, feedback, mix, pingpong, sr
        self.sos = np.concatenate([butter_sos('lowpass', lp, 1, sr), butter_sos('highpass', hp, 1, sr)])
        self.tail = time * math.log(1e-3) / math.log(max(feedback, 1e-3))

    def __call__(self, x, t0=0.0):
        x = stereo(np.asarray(x, dtype=F32))
        n = x.shape[-1]
        D = max(1, int(self.time * self.sr))
        inp = apply_sos(x, self.sos)
        if self.pp:
            inp = np.stack([inp.mean(0), np.zeros(n, F32)])
        w = np.zeros((2, n + D), F32)          # w[t] = delayed signal output
        zi = np.zeros((2, self.sos.shape[0], 2))
        prev = np.zeros((2, D), F32)
        for s in range(0, n, D):
            e = min(n, s + D)
            m = e - s
            fb, zi = sosfilt(self.sos, prev[:, :m], axis=-1, zi=zi)
            if self.pp:
                fb = fb[::-1]
            blk = inp[:, s:e] + F32(self.fb) * fb.astype(F32)
            w[:, s + D:e + D] = blk
            prev = np.zeros((2, D), F32)
            prev[:, :m] = blk
        y = x.copy()
        y += w[:, :n] * F32(self.mix)
        return y


# ----------------------------------------------------------------------------
# Nonlinear / dynamics
# ----------------------------------------------------------------------------

def saturate(x: np.ndarray, drive: float = 2.0, mix: float = 1.0, oversample: int = 2) -> np.ndarray:
    """tanh soft clipping with unity small-signal gain, oversampled to keep
    the new harmonics from aliasing."""
    x = np.asarray(x, dtype=F32)
    if oversample > 1:
        u = resample_poly(x, oversample, 1, axis=-1)
        u = np.tanh(u * F32(drive)) / F32(drive)
        w = resample_poly(u, 1, oversample, axis=-1)[..., :x.shape[-1]].astype(F32)
    else:
        w = np.tanh(x * F32(drive)) / F32(drive)
    return w if mix >= 1 else (x * F32(1 - mix) + w * F32(mix))


class Saturate:
    tail = 0.0

    def __init__(self, drive=2.0, mix=1.0, oversample=2):
        self.drive, self.mix, self.os = drive, mix, oversample

    def __call__(self, x, t0=0.0):
        return saturate(x, self.drive, self.mix, self.os)


def gain_computer(level_db: np.ndarray, threshold: float, ratio: float, knee: float) -> np.ndarray:
    """Static compression curve (gain change in dB, <= 0) with a soft knee."""
    over = level_db - threshold
    gr = np.zeros_like(over)
    slope = 1.0 / ratio - 1.0
    if knee > 0:
        k = np.abs(over) <= knee / 2
        gr[k] = slope * (over[k] + knee / 2) ** 2 / (2 * knee)
    hard = over > knee / 2
    gr[hard] = slope * over[hard]
    return gr


def compress(x: np.ndarray, threshold: float = -18.0, ratio: float = 2.0, attack: float = 0.02,
             release: float = 0.25, knee: float = 6.0, makeup: float = 0.0, sidechain=None,
             hop: int = 32, sr: int = SR, return_gain: bool = False, chunk: int = 1 << 18):
    """Feed-forward RMS compressor, stereo-linked, computed at control rate
    (every ``hop`` samples) with separate attack/release smoothing in dB.
    Chunked: no full-length float64 temporaries. Returns ``y`` (and the gain
    curve in dB per hop if ``return_gain``)."""
    x = np.asarray(x, dtype=F32)
    s = stereo(x if sidechain is None else np.asarray(sidechain, dtype=F32))
    n = x.shape[-1]
    m = (n + hop - 1) // hop
    frame = np.zeros(m)
    for a in range(0, n, chunk):
        b = min(n, a + chunk)
        e = (s[0, a:b] ** 2 + s[1, a:b] ** 2) * F32(0.5)
        k = (b - a) // hop
        frame[a // hop:a // hop + k] = e[:k * hop].reshape(k, hop).mean(axis=1)
        if (b - a) % hop:
            frame[a // hop + k] = e[k * hop:].mean()
    frame = np.convolve(frame, np.ones(3) / 3, mode='same')
    lvl = 10 * np.log10(frame + 1e-12)
    target = gain_computer(lvl, threshold, ratio, knee)
    aa = math.exp(-hop / (max(attack, 1e-4) * sr))
    ar = math.exp(-hop / (max(release, 1e-4) * sr))
    g = np.empty(m)
    cur = 0.0
    for i, v in enumerate(target.tolist()):
        cur = (aa * cur + (1 - aa) * v) if v < cur else (ar * cur + (1 - ar) * v)
        g[i] = cur
    centers = np.arange(m) * hop + hop / 2
    y = np.empty_like(x)
    for a in range(0, n, chunk):
        b = min(n, a + chunk)
        gs = np.interp(np.arange(a, b, dtype=np.float64), centers, g)
        y[..., a:b] = x[..., a:b] * np.power(10.0, (gs + makeup) / 20.0).astype(F32)
    return (y, g) if return_gain else y


class Compressor:
    tail = 0.0

    def __init__(self, **kw):
        self.kw = kw

    def __call__(self, x, t0=0.0):
        return compress(x, **self.kw)


class Carve:
    """Dynamic-EQ "carving": briefly dip a frequency band at given absolute
    times, so a percussive element placed at those times (e.g. a clock
    tick) cuts through dense music without having to be louder.

    The band is extracted with a Butterworth band-pass and partially
    subtracted under an envelope that ramps in over ``attack`` before each
    time, holds, then releases. Only the spans around the times are filtered.
    """
    tail = 0.0

    def __init__(self, times, depth_db: float = 5.0, band=(1500.0, 9000.0), attack: float = 0.003,
                 hold: float = 0.025, release: float = 0.07, sr: int = SR):
        self.times = np.sort(np.asarray(list(times), dtype=np.float64))
        self.k = F32(1.0 - 10 ** (-depth_db / 20))
        self.sos = butter_sos('bandpass', (float(band[0]), float(band[1])), 2, sr)
        self.a, self.h, self.r, self.sr = int(attack * sr), int(hold * sr), int(release * sr), sr
        u = np.arange(self.a) / max(1, self.a)
        rel = 0.5 + 0.5 * np.cos(np.pi * np.arange(self.r) / max(1, self.r))
        self.shape = np.concatenate([0.5 - 0.5 * np.cos(np.pi * u), np.ones(self.h), rel]).astype(F32)

    def __call__(self, x, t0=0.0):
        n = x.shape[-1]
        span = self.shape.shape[0]
        ts = self.times[(self.times >= t0 - span / self.sr) & (self.times < t0 + n / self.sr + self.a / self.sr)]
        if ts.size == 0:
            return x
        starts = np.round((ts - t0) * self.sr).astype(np.int64) - self.a
        # group nearby events into spans that are filtered together
        groups, cur = [], [starts[0]]
        for st in starts[1:]:
            if st - cur[-1] < self.sr:          # closer than 1 s: same span
                cur.append(st)
            else:
                groups.append(cur)
                cur = [st]
        groups.append(cur)
        warm = int(0.05 * self.sr)
        for g in groups:
            lo = max(0, g[0] - warm)
            hi = min(n, g[-1] + span)
            if hi <= lo:
                continue
            env = np.zeros(hi - lo, F32)
            for st in g:
                a, b = st - lo, st - lo + span
                s0, s1 = max(a, 0), min(b, hi - lo)
                if s1 > s0:
                    np.maximum(env[s0:s1], self.shape[s0 - a:s1 - a], out=env[s0:s1])
            band = apply_sos(x[..., lo:hi], self.sos)
            band *= env * self.k
            x[..., lo:hi] -= band
        return x


class Width:
    tail = 0.0

    def __init__(self, w: float):
        self.w = w

    def __call__(self, x, t0=0.0):
        from .core import width
        return width(x, self.w)


class Gain:
    tail = 0.0

    def __init__(self, gain_db: float):
        self.g = F32(db(gain_db))

    def __call__(self, x, t0=0.0):
        return x * self.g


def reverse(x: np.ndarray) -> np.ndarray:
    return np.ascontiguousarray(np.asarray(x)[..., ::-1])
