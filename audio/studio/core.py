"""Core building blocks: sample rate, buffers, dB helpers, envelopes, randomness,
and the :class:`Mix` / :class:`Track` timeline that places sounds at times.

Conventions used across the whole package
-----------------------------------------
* Sample rate is 48 kHz (:data:`SR`). Times are seconds (floats); a time ``t``
  maps to sample ``round(t * SR)``, so placement is sample-accurate.
* Audio buffers are ``float32`` numpy arrays. Mono is shape ``(n,)`` and stereo
  is ``(2, n)`` (channel-first).
* Gains are in dB unless a name says otherwise. Pan runs from -1 (left) to +1
  (right) with an equal-power law normalised so that centre is unity.
* Everything random goes through :func:`rng`, seeded from descriptive keys, so a
  render is bit-for-bit reproducible.
"""
from __future__ import annotations

import math
import time
import zlib
from dataclasses import dataclass, field
from typing import Callable, Iterable, Sequence

import numpy as np

SR = 48000
F32 = np.float32


# ----------------------------------------------------------------------------
# Units
# ----------------------------------------------------------------------------

def db(x):
    """Decibels to linear amplitude (scalar or array)."""
    if np.ndim(x) == 0:
        return 10.0 ** (float(x) / 20.0)
    return np.power(10.0, np.asarray(x, dtype=np.float64) / 20.0)


def to_db(a, floor: float = -200.0):
    """Linear amplitude to decibels, clamped at ``floor``."""
    if np.ndim(a) == 0:
        return 20.0 * math.log10(max(abs(float(a)), 10 ** (floor / 20)))
    return 20.0 * np.log10(np.maximum(np.abs(a), 10 ** (floor / 20)))


def ns(t: float, sr: int = SR) -> int:
    """Seconds to a sample count / index (rounded)."""
    return int(round(t * sr))


def secs(n: int, sr: int = SR) -> float:
    return n / sr


def tvec(n: int, sr: int = SR, dtype=F32) -> np.ndarray:
    """Time axis ``[0, n)/sr`` as ``dtype``."""
    return (np.arange(n, dtype=np.float64) / sr).astype(dtype, copy=False)


# ----------------------------------------------------------------------------
# Randomness
# ----------------------------------------------------------------------------

def rng(*keys) -> np.random.Generator:
    """A deterministic random generator seeded from arbitrary keys.

    >>> rng('bell', 3, 56.6).normal()   # same value on every run
    """
    return np.random.default_rng(zlib.crc32(repr(keys).encode('utf8')))


def smooth_noise(n: int, rate: float, r: np.random.Generator, sr: int = SR) -> np.ndarray:
    """Band-limited random curve (std ~0.5, mostly within [-1, 1]) that wanders
    at about ``rate`` Hz.

    Useful for pitch drift, vibrato jitter, gusts and flicker.
    """
    if n <= 0:
        return np.zeros(0, F32)
    step = max(1, min(512, int(sr / (rate * 3))))       # control points ~3x per period
    m = n // step + 3
    pts = r.standard_normal(m + 6)
    k = np.hanning(7)
    pts = np.convolve(pts, k / k.sum(), mode='same')[3:3 + m] * 1.07   # std ~0.5
    # piecewise-linear upsampling via cumulative slopes (cheaper than np.interp)
    slopes = np.repeat(np.diff(pts) / step, step)[:n - 1]
    y = np.empty(n, np.float64)
    y[0] = pts[0]
    np.cumsum(slopes, out=y[1:])
    y[1:] += pts[0]
    return y.astype(F32)


# ----------------------------------------------------------------------------
# Stereo helpers
# ----------------------------------------------------------------------------

def stereo(x: np.ndarray) -> np.ndarray:
    """Return ``x`` as a ``(2, n)`` array (duplicating mono)."""
    x = np.asarray(x)
    if x.ndim == 1:
        return np.stack([x, x])
    if x.shape[0] == 1:
        return np.concatenate([x, x])
    return x


def mono(x: np.ndarray) -> np.ndarray:
    x = np.asarray(x)
    return x if x.ndim == 1 else x.mean(axis=0)


def pan_gains(p: float) -> tuple[float, float]:
    """Equal-power pan gains, normalised so that centre (0) is (1, 1)."""
    p = min(1.0, max(-1.0, float(p)))
    th = (p + 1.0) * math.pi / 4.0
    return math.sqrt(2.0) * math.cos(th), math.sqrt(2.0) * math.sin(th)


def pan(x: np.ndarray, p: float = 0.0) -> np.ndarray:
    """Pan a mono signal (or balance a stereo one); returns stereo."""
    gl, gr = pan_gains(p)
    s = stereo(x)
    return np.stack([s[0] * F32(gl), s[1] * F32(gr)])


def width(x: np.ndarray, w: float) -> np.ndarray:
    """Mid/side stereo width: 0 = mono, 1 = unchanged, >1 = wider."""
    s = stereo(x)
    m = (s[0] + s[1]) * 0.5
    d = (s[0] - s[1]) * (0.5 * w)
    return np.stack([m + d, m - d])


def mix_into(dst: np.ndarray, src: np.ndarray, at: int, gain: float = 1.0) -> None:
    """Add ``src`` into ``dst`` starting at sample ``at`` (clipped to bounds)."""
    n = dst.shape[-1]
    a, b = at, at + src.shape[-1]
    if b <= 0 or a >= n:
        return
    s0 = max(0, -a)
    a, b = max(a, 0), min(b, n)
    if gain == 1.0:
        dst[..., a:b] += src[..., s0:s0 + (b - a)]
    else:
        dst[..., a:b] += src[..., s0:s0 + (b - a)] * gain


def _acc(dst: np.ndarray, src: np.ndarray, g: float = 1.0, chunk: int = 1 << 17) -> None:
    """``dst += src * g`` in chunks (no full-length temporaries)."""
    n = src.shape[-1]
    if g == 1.0:
        dst += src
        return
    gg = F32(g)
    for a in range(0, n, chunk):
        dst[..., a:a + chunk] += src[..., a:a + chunk] * gg


def pad_to(x: np.ndarray, n: int) -> np.ndarray:
    """Zero-pad (or trim) the last axis to length ``n``."""
    m = x.shape[-1]
    if m == n:
        return x
    if m > n:
        return x[..., :n]
    out = np.zeros(x.shape[:-1] + (n,), dtype=x.dtype)
    out[..., :m] = x
    return out


# ----------------------------------------------------------------------------
# Envelopes and fades
# ----------------------------------------------------------------------------

def _ramp(n: int, shape: str = 'cos') -> np.ndarray:
    """Rising ramp 0 -> 1 of length n (exclusive of the final 1)."""
    if n <= 0:
        return np.zeros(0, F32)
    u = np.arange(n, dtype=np.float64) / n
    if shape == 'lin':
        r = u
    elif shape == 'exp':           # fast start, slow finish (natural swell)
        r = 1.0 - np.exp(-5.0 * u)
        r /= 1.0 - math.exp(-5.0)
    elif shape == 'pow':           # slow start, fast finish (riser)
        r = u ** 3
    else:                          # raised cosine: smooth at both ends
        r = 0.5 - 0.5 * np.cos(math.pi * u)
    return r.astype(F32)


def adsr(dur: float, a: float = 0.01, d: float = 0.0, s: float = 1.0, r: float = 0.1,
         sr: int = SR, attack_shape: str = 'cos', release_shape: str = 'exp') -> np.ndarray:
    """ADSR envelope: the gate lasts ``dur`` seconds, then a release of ``r``.

    Returns ``round((dur + r) * sr)`` samples. The attack is clipped if the
    gate is shorter than it; the release always starts from the level reached
    at note-off, so there are never discontinuities (no clicks).
    """
    ng = max(1, ns(dur, sr))
    nr = max(1, ns(r, sr))
    na = max(1, ns(a, sr))
    nd = ns(d, sr)
    env = np.empty(ng + nr, F32)
    k = min(na, ng)
    env[:k] = _ramp(na, attack_shape)[:k]
    pos = k
    if pos < ng:
        if nd > 0 and s != 1.0:
            m = min(nd, ng - pos)
            u = np.arange(m, dtype=np.float64) / nd
            env[pos:pos + m] = (s + (1.0 - s) * np.exp(-4.0 * u)).astype(F32)
            pos += m
            if pos < ng:
                env[pos:ng] = F32(s + (1.0 - s) * math.exp(-4.0))
        else:
            env[pos:ng] = F32(s if nd > 0 else 1.0)
    last = float(env[ng - 1])
    if release_shape == 'exp':
        u = np.arange(nr, dtype=np.float64) / nr
        rel = (np.exp(-5.0 * u) - math.exp(-5.0)) / (1.0 - math.exp(-5.0))
        env[ng:] = (last * rel).astype(F32)
    else:
        env[ng:] = last * (1.0 - _ramp(nr, release_shape))
    return env


def exp_decay(n: int, tau: float, sr: int = SR) -> np.ndarray:
    """``exp(-t / tau)`` over n samples."""
    return np.exp(-tvec(n, sr) / F32(max(tau, 1e-6)))


def env_points(points: Sequence[tuple[float, float]], n: int, sr: int = SR,
               t0: float = 0.0, db_domain: bool = False) -> np.ndarray:
    """Piecewise-linear envelope from ``(time, value)`` breakpoints.

    Times are seconds relative to ``t0`` (the time of sample 0). With
    ``db_domain=True`` the values are dB and interpolation happens in dB.
    """
    pts = sorted(points)
    tt = np.array([p[0] for p in pts], dtype=np.float64)
    vv = np.array([p[1] for p in pts], dtype=np.float64)
    x = t0 + np.arange(n, dtype=np.float64) / sr
    y = np.interp(x, tt, vv)
    if db_domain:
        y = np.power(10.0, y / 20.0)
    return y.astype(F32)


def fade(x: np.ndarray, fin: float = 0.005, fout: float = 0.005, sr: int = SR,
         shape: str = 'cos') -> np.ndarray:
    """Return a copy of ``x`` with raised-cosine fade-in/out (seconds)."""
    y = np.array(x, dtype=F32, copy=True)
    n = y.shape[-1]
    a = min(n, ns(fin, sr))
    b = min(n, ns(fout, sr))
    if a > 0:
        y[..., :a] *= _ramp(a, shape)
    if b > 0:
        y[..., n - b:] *= _ramp(b, shape)[::-1]
    return y


def normalize(x: np.ndarray, peak: float = 1.0) -> np.ndarray:
    m = float(np.max(np.abs(x))) if x.size else 0.0
    return x if m == 0 else (x * F32(peak / m)).astype(F32)


class Bounce:
    """A small stereo scratch buffer starting at absolute time ``t0``: add
    sounds to it, process the whole buffer (e.g. a filter sweep), then place
    ``.buf`` on a track at ``t0``."""

    def __init__(self, t0: float, dur: float, sr: int = SR):
        self.t0, self.sr = t0, sr
        self.buf = np.zeros((2, ns(dur, sr)), F32)

    def add(self, t: float, x: np.ndarray, gain_db: float = 0.0, pan_pos: float = 0.0) -> 'Bounce':
        s = stereo(np.asarray(x, dtype=F32))
        gl, gr = pan_gains(pan_pos)
        g = db(gain_db)
        mix_into(self.buf, np.stack([s[0] * F32(gl * g), s[1] * F32(gr * g)]), ns(t - self.t0, self.sr))
        return self


# ----------------------------------------------------------------------------
# Timeline: Mix / Track / Bus
# ----------------------------------------------------------------------------

FX = Callable[[np.ndarray, float], np.ndarray]


@dataclass
class Clip:
    start: int              # sample index
    data: np.ndarray        # (2, n) float32
    gl: float = 1.0         # left gain (includes pan and clip gain)
    gr: float = 1.0

    @property
    def end(self) -> int:
        return self.start + self.data.shape[-1]


class Track:
    """A named source track. Sounds are placed with :meth:`add`.

    At render time the clips are summed, passed through the insert ``fx``
    chain (callables ``f(x, t0) -> y`` working on ``(2, n)`` arrays, where
    ``t0`` is the absolute time of the first sample), scaled by the fader
    (``gain_db`` plus any :meth:`volume` automation) and sent to the master and
    to reverb buses (post-fader ``sends``).
    """

    def __init__(self, mix: 'Mix', name: str, gain_db: float = 0.0, fx: Sequence[FX] = (),
                 sends: dict[str, float] | None = None, tail: float = 0.3, group: str = 'music'):
        self.mix = mix
        self.name = name
        self.gain_db = gain_db
        self.fx = list(fx)
        self.sends = dict(sends or {})
        self.tail = tail
        self.group = group
        self.clips: list[Clip] = []
        self.auto: list[tuple[float, float]] = []

    def add(self, t: float, x: np.ndarray, gain_db: float = 0.0, pan: float = 0.0) -> 'Track':
        """Place sound ``x`` (mono or stereo) so that its first sample is at ``t`` s."""
        if x is None:
            return self
        x = np.asarray(x)
        if x.ndim == 1:
            x = x[None, :]
        if x.shape[-1] == 0:
            return self
        if not np.all(np.isfinite(x)):
            raise ValueError(f'{self.name}: non-finite samples in clip at t={t:.3f}')
        data = x.astype(F32, copy=False)
        g = db(gain_db)
        gl, gr = pan_gains(pan)
        self.clips.append(Clip(ns(t, self.mix.sr), data, g * gl, g * gr))
        return self

    def volume(self, points: Iterable[tuple[float, float]]) -> 'Track':
        """Add fader automation breakpoints ``(time_s, dB)`` (linear in dB)."""
        self.auto.extend((float(t), float(v)) for t, v in points)
        self.auto.sort()
        return self

    def cut(self, t: float) -> 'Track':
        """Hard-cut this track (and its reverb tails) at ``t``."""
        self.mix.cut(t, tracks=[self.name])
        return self

    # -- render helpers ------------------------------------------------------
    def _apply_gain(self, buf: np.ndarray, lo: int, chunk: int = 1 << 16) -> None:
        """Multiply ``buf`` (which starts at sample ``lo``) by the fader gain
        and automation, in place."""
        g = db(self.gain_db)
        if not self.auto:
            if g != 1.0:
                buf *= F32(g)
            return
        sr = self.mix.sr
        tt = np.array([p[0] for p in self.auto]) * sr
        vv = np.array([p[1] for p in self.auto])
        n = buf.shape[-1]
        for a in range(0, n, chunk):
            b = min(n, a + chunk)
            dbs = np.interp(np.arange(lo + a, lo + b, dtype=np.float64), tt, vv)
            buf[:, a:b] *= (np.power(10.0, dbs / 20.0) * g).astype(F32)


@dataclass
class Bus:
    """A reverb (or other effect) return bus fed by track sends."""
    name: str
    ir: np.ndarray                          # (2, m) impulse response
    gain_db: float = 0.0
    pre: list = field(default_factory=list)  # fx applied to the send before convolution
    post: list = field(default_factory=list)
    cross: float = 0.3                      # L/R cross-feed into the convolution


@dataclass
class Cut:
    at: int
    tracks: frozenset | None       # None = everything
    groups: frozenset | None


class Mix:
    """A fixed-length multitrack timeline.

    >>> mix = Mix(318.0)
    >>> mix.reverb('hall', fx.reverb_ir('hall'))
    >>> strings = mix.track('strings', gain_db=-6, sends={'hall': -8})
    >>> strings.add(20.0, instruments.strings(['A3', 'C4', 'E4'], dur=4))
    >>> mix.cut(208.0)                  # hard cut: everything, incl. reverb tails
    >>> y = mix.render()                # (2, n) float32

    Hard cuts are handled exactly: every track is rendered in segments
    between its cut points, so sounds (and their insert-FX and reverb tails)
    that started before a cut are silenced at the cut with a short
    raised-cosine fade, while sounds starting after it play normally.
    """

    def __init__(self, duration: float, sr: int = SR, cut_fade: float = 0.004):
        self.duration = float(duration)
        self.sr = sr
        self.n = ns(duration, sr)
        self.tracks: dict[str, Track] = {}
        self.buses: dict[str, Bus] = {}
        self.cuts: list[Cut] = []
        self.cut_fade = cut_fade
        self.log: Callable[[str], None] = lambda s: None

    # -- construction ------------------------------------------------------
    def track(self, name: str, **kw) -> Track:
        if name in self.tracks:
            return self.tracks[name]
        tr = Track(self, name, **kw)
        self.tracks[name] = tr
        return tr

    def reverb(self, name: str, ir: np.ndarray, gain_db: float = 0.0, hp: float | None = 180.0,
               lp: float | None = None, cross: float = 0.3, post: Sequence[FX] = ()) -> Bus:
        """Create a convolution-reverb return bus. The send is high-passed at
        ``hp`` Hz (keeps the low end clean) and optionally low-passed."""
        from . import filters as _f
        pre = []
        if hp:
            pre.append(_f.HP(hp, order=2))
        if lp:
            pre.append(_f.LP(lp, order=2))
        bus = Bus(name, np.asarray(ir, F32), gain_db, pre, list(post), cross)
        self.buses[name] = bus
        return bus

    def cut(self, t: float, tracks: Iterable[str] | None = None, groups: Iterable[str] | None = None) -> None:
        """Hard cut at ``t``. With no ``tracks``/``groups`` it cuts everything."""
        self.cuts.append(Cut(ns(t, self.sr), frozenset(tracks) if tracks else None,
                             frozenset(groups) if groups else None))

    def _cuts_for(self, tr: Track) -> list[int]:
        out = set()
        for c in self.cuts:
            if c.tracks is None and c.groups is None:
                out.add(c.at)
            elif (c.tracks and tr.name in c.tracks) or (c.groups and tr.group in c.groups):
                out.add(c.at)
        return sorted(a for a in out if 0 < a < self.n)

    # -- rendering ---------------------------------------------------------
    def render(self, t0: float = 0.0, t1: float | None = None, stems_dir: str | None = None) -> np.ndarray:
        """Render ``[t0, t1)`` to a ``(2, n)`` float32 array (pre-master).

        Material from before ``t0`` is still rendered far enough back to
        produce the reverb/insert tails that reach into the window. Tracks are
        rendered one at a time into a single reusable scratch buffer, and all
        long operations are chunked, so peak memory stays small.
        """
        from .fx import convolve_into
        sr = self.sr
        w0 = max(0, ns(t0, sr))
        w1 = self.n if t1 is None else min(self.n, ns(t1, sr))
        longest_ir = max([b.ir.shape[-1] for b in self.buses.values()] + [0])
        a0 = max(0, w0 - longest_ir - ns(2.0, sr)) if w0 > 0 else 0
        out = np.zeros((2, w1 - a0), F32)
        scratch = np.empty((2, w1 - a0), F32)
        fade_n = max(1, ns(self.cut_fade, sr))
        fade_out = (0.5 + 0.5 * np.cos(np.linspace(0, math.pi, fade_n))).astype(F32)
        bus_in: dict[tuple[str, int, int], list] = {}
        tstart = time.time()
        for tr in self.tracks.values():
            if not tr.clips:
                continue
            stem = np.zeros((2, w1 - a0), F32) if stems_dir else None
            bounds = [0] + self._cuts_for(tr) + [self.n]
            tail_n = ns(tr.tail + sum(getattr(f, 'tail', 0.0) for f in tr.fx), sr)
            for sa, sb in zip(bounds[:-1], bounds[1:]):
                clips = [c for c in tr.clips if sa <= c.start < sb and c.end > a0 and c.start < w1]
                if not clips:
                    continue
                lo = max(sa, a0, min(c.start for c in clips))
                natural_end = max(c.end for c in clips) + tail_n
                hi = min(sb, w1, natural_end)
                if hi <= lo:
                    continue
                buf = scratch[:, :hi - lo]
                buf.fill(0.0)
                for c in clips:
                    a, b = max(c.start, lo), min(c.end, hi)
                    if b <= a:
                        continue
                    seg = c.data[:, a - c.start:b - c.start]
                    ch_r = 0 if seg.shape[0] == 1 else 1
                    _acc(buf[0, a - lo:b - lo], seg[0], c.gl)
                    _acc(buf[1, a - lo:b - lo], seg[ch_r], c.gr)
                for f in tr.fx:
                    buf = f(buf, lo / sr)
                    if buf.dtype != F32:
                        buf = buf.astype(F32)
                tr._apply_gain(buf, lo)
                if hi == sb and natural_end > sb:
                    k = min(fade_n, buf.shape[-1])
                    buf[:, -k:] *= fade_out[-k:] if k < fade_n else fade_out
                out[:, lo - a0:hi - a0] += buf
                for bname, sdb in tr.sends.items():
                    if bname not in self.buses:
                        raise KeyError(f'track {tr.name}: unknown bus {bname}')
                    key = (bname, sa, sb)
                    ent = bus_in.get(key)
                    if ent is None:
                        s_lo, s_hi = max(sa, a0), min(sb, w1)
                        ent = bus_in[key] = [s_lo, np.zeros((2, s_hi - s_lo), F32), hi, lo]
                    s_lo, acc = ent[0], ent[1]
                    _acc(acc[:, lo - s_lo:hi - s_lo], buf, db(sdb))
                    ent[2] = max(ent[2], hi)
                    ent[3] = min(ent[3], lo)
                if stem is not None:
                    stem[:, lo - a0:hi - a0] += buf
            if stem is not None:
                self._write_stem(stems_dir, tr.name, stem[:, w0 - a0:])
                del stem
            self.log(f'  track {tr.name:<10} {len(tr.clips):5d} clips  ({time.time() - tstart:6.1f}s)')
        del scratch
        stem, stem_name = None, None
        for (bname, sa, sb) in sorted(bus_in):
            s_lo, acc, used_hi, used_lo = bus_in.pop((bname, sa, sb))
            if stems_dir and stem_name != bname:
                if stem is not None:
                    self._write_stem(stems_dir, 'bus-' + stem_name, stem[:, w0 - a0:])
                stem, stem_name = np.zeros((2, w1 - a0), F32), bname
            bus = self.buses[bname]
            x = acc[:, used_lo - s_lo:used_hi - s_lo]
            for f in bus.pre:
                x = f(x, used_lo / sr)
            end = min(sb, w1)
            fade = fade_out if sb < self.n else None
            for dst in ([out] + ([stem] if stem is not None else [])):
                convolve_into(dst, used_lo - a0, x, bus.ir, cross=bus.cross, stop=end - used_lo,
                              gain=db(bus.gain_db), fade=fade)
            del acc, x
            self.log(f'  bus   {bname:<10} [{sa / sr:7.2f}, {sb / sr:7.2f})  ({time.time() - tstart:6.1f}s)')
        if stem is not None:
            self._write_stem(stems_dir, 'bus-' + stem_name, stem[:, w0 - a0:])
        return out[:, w0 - a0:]

    def _write_stem(self, d: str, name: str, x: np.ndarray) -> None:
        """Stems are pre-master (no loudness normalisation/limiting), float32."""
        import os
        from .wav import write_wav
        os.makedirs(d, exist_ok=True)
        write_wav(os.path.join(d, f'{name}.wav'), x, self.sr, bits=32)
