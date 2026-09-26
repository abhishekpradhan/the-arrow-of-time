"""Oscillators: band-limited waveforms and noise.

Two band-limiting strategies are provided:

* **Additive wavetables** (default). A single-cycle table is built from a
  harmonic spectrum that stops below ``fmax`` for the highest frequency the
  note will reach, then read with linear interpolation. No aliasing at all,
  and cost is independent of the number of harmonics.
* **PolyBLEP** (``saw_blep`` / ``square_blep`` / ``triangle_blep``): naive
  waveforms with polynomial band-limited step corrections; cheap and good for
  wide pitch sweeps.

Frequencies may be scalars or per-sample arrays (for vibrato, glides). Phase
is accumulated in float64 (no drift over long notes), trigonometry is done in
float32 for speed. All outputs are float32 in about [-1, 1].
"""
from __future__ import annotations

import math
from functools import lru_cache

import numpy as np
from scipy.signal import lfilter

from .core import F32, SR

TWO_PI = F32(2.0 * math.pi)


# ----------------------------------------------------------------------------
# Phase
# ----------------------------------------------------------------------------

def phase(freq, n: int, sr: int = SR, phase0: float = 0.0) -> np.ndarray:
    """Cumulative phase in cycles (float64) for ``n`` samples at ``freq`` Hz."""
    if np.ndim(freq) == 0:
        return phase0 + np.arange(n, dtype=np.float64) * (float(freq) / sr)
    f = np.asarray(freq, dtype=np.float64)
    if f.shape[-1] != n:
        raise ValueError('freq array length must equal n')
    ph = np.empty(n, dtype=np.float64)
    ph[0] = phase0
    if n > 1:
        np.cumsum(f[:-1] * (1.0 / sr), out=ph[1:])
        ph[1:] += phase0
    return ph


def frac(ph: np.ndarray) -> np.ndarray:
    """Fractional part of a float64 phase as float32 in [0, 1)."""
    f = (ph - np.floor(ph)).astype(F32)
    np.minimum(f, F32(0.99999994), out=f)
    return f


def sine_ph(ph: np.ndarray) -> np.ndarray:
    """sin(2*pi*ph) for a float64 phase in cycles (accurate, float32 out)."""
    return np.sin(frac(ph) * TWO_PI)


def sine(freq, n: int, sr: int = SR, phase0: float = 0.0) -> np.ndarray:
    return sine_ph(phase(freq, n, sr, phase0))


# ----------------------------------------------------------------------------
# Additive wavetables
# ----------------------------------------------------------------------------

def _table_size(kmax: int) -> int:
    size = 2048
    while size < 16 * kmax and size < 65536:
        size *= 2
    return size


@lru_cache(maxsize=2048)
def _table_cached(amps: tuple, phases: tuple | None, size: int) -> np.ndarray:
    spec = np.zeros(size // 2 + 1, dtype=np.complex128)
    k = np.arange(1, len(amps) + 1)
    a = np.asarray(amps, dtype=np.float64)
    ph = np.zeros(len(amps)) if phases is None else np.asarray(phases, dtype=np.float64)
    keep = k < size // 2
    spec[k[keep]] = a[keep] * (size / 2.0) * np.exp(1j * (ph[keep] - math.pi / 2))
    tab = np.fft.irfft(spec, size)
    # two guard samples so that linear interpolation never wraps
    return np.concatenate([tab, tab[:2]]).astype(F32)


def harmonic_table(amps, phases=None) -> np.ndarray:
    """Single-cycle table (with 2 guard samples) for harmonic amplitudes
    ``amps[k-1]`` of harmonic k (sine phase 0 unless ``phases`` given)."""
    amps = tuple(float(a) for a in amps)
    ph = None if phases is None else tuple(float(p) for p in phases)
    return _table_cached(amps, ph, _table_size(len(amps)))


def read_table(table: np.ndarray, ph: np.ndarray) -> np.ndarray:
    """Read a guarded single-cycle table (power-of-two size + 2 guard samples)
    at float64 phase ``ph`` (cycles, >= 0) with linear interpolation."""
    size = table.shape[0] - 2
    x = ph * float(size)
    if x.size and x[0] < 0:
        x -= math.floor(float(x.min()) / size) * size
    i = x.astype(np.int64)
    f = (x - i).astype(F32)
    i &= size - 1
    a = table[i]
    b = table[i + 1]
    b -= a
    b *= f
    b += a
    return b


def wavetable(table: np.ndarray, freq, n: int, sr: int = SR, phase0: float = 0.0) -> np.ndarray:
    return read_table(table, phase(freq, n, sr, phase0))


def nharm(fmax_note: float, fmax: float = 18000.0, sr: int = SR) -> int:
    """Number of harmonics that stay below ``fmax`` (and Nyquist) for a note
    whose frequency can reach ``fmax_note``."""
    lim = min(fmax, 0.46 * sr)
    return max(1, int(lim // max(fmax_note, 1e-3)))


@lru_cache(maxsize=512)
def saw_table(k: int) -> np.ndarray:
    """Band-limited sawtooth with ``k`` harmonics (1/n amplitudes)."""
    n = np.arange(1, k + 1)
    # gentle Lanczos-style taper reduces Gibbs ringing
    sig = np.sinc(n / (k + 1)) if k > 4 else np.ones(k)
    return harmonic_table((2 / math.pi) / n * sig)


@lru_cache(maxsize=512)
def square_table(k: int) -> np.ndarray:
    n = np.arange(1, k + 1)
    a = np.where(n % 2 == 1, 4 / (math.pi * n), 0.0)
    sig = np.sinc(n / (k + 1)) if k > 4 else np.ones(k)
    return harmonic_table(a * sig)


@lru_cache(maxsize=512)
def triangle_table(k: int) -> np.ndarray:
    n = np.arange(1, k + 1)
    a = np.where(n % 2 == 1, 8 / (math.pi ** 2 * n ** 2) * (-1.0) ** ((n - 1) // 2), 0.0)
    return harmonic_table(a)


def _fmax_of(freq) -> float:
    return float(np.max(freq)) if np.ndim(freq) else float(freq)


def saw(freq, n: int, sr: int = SR, phase0: float = 0.0, fmax: float = 18000.0) -> np.ndarray:
    """Alias-free sawtooth (additive wavetable)."""
    return wavetable(saw_table(nharm(_fmax_of(freq), fmax, sr)), freq, n, sr, phase0)


def square(freq, n: int, sr: int = SR, phase0: float = 0.0, fmax: float = 18000.0) -> np.ndarray:
    return wavetable(square_table(nharm(_fmax_of(freq), fmax, sr)), freq, n, sr, phase0)


def triangle(freq, n: int, sr: int = SR, phase0: float = 0.0, fmax: float = 18000.0) -> np.ndarray:
    return wavetable(triangle_table(nharm(_fmax_of(freq), fmax, sr)), freq, n, sr, phase0)


def pulse(freq, n: int, width: float = 0.5, sr: int = SR, phase0: float = 0.0,
          fmax: float = 18000.0) -> np.ndarray:
    """Band-limited pulse as the difference of two phase-shifted saws.
    ``width`` may be an array for pulse-width modulation."""
    tab = saw_table(nharm(_fmax_of(freq), fmax, sr))
    ph = phase(freq, n, sr, phase0)
    y = read_table(tab, ph) - read_table(tab, ph + np.asarray(width, dtype=np.float64))
    return y


def additive(freq, n: int, amps, ratios=None, sr: int = SR, phase0=None,
             fmax: float = 19000.0) -> np.ndarray:
    """Sum of sinusoids at ``freq * ratios[i]`` with ``amps[i]`` (partials above
    ``fmax`` are dropped). Ratios default to harmonics 1, 2, 3, ..."""
    amps = np.asarray(amps, dtype=np.float64)
    ratios = np.arange(1, len(amps) + 1) if ratios is None else np.asarray(ratios, dtype=np.float64)
    ph = phase(freq, n, sr)
    top = _fmax_of(freq)
    y = np.zeros(n, F32)
    for i, (a, r) in enumerate(zip(amps, ratios)):
        if a == 0 or top * r >= min(fmax, 0.48 * sr):
            continue
        p0 = 0.0 if phase0 is None else float(phase0[i])
        y += F32(a) * sine_ph(ph * r + p0)
    return y


# ----------------------------------------------------------------------------
# PolyBLEP oscillators
# ----------------------------------------------------------------------------

def _blep(t: np.ndarray, dt: np.ndarray) -> np.ndarray:
    """Polynomial band-limited step residual for phase ``t`` in [0,1)."""
    r = np.zeros_like(t)
    m = t < dt
    x = t[m] / dt[m] if np.ndim(dt) else t[m] / dt
    r[m] = x + x - x * x - 1.0
    m2 = t > 1.0 - dt
    x = (t[m2] - 1.0) / (dt[m2] if np.ndim(dt) else dt)
    r[m2] = x * x + x + x + 1.0
    return r


def saw_blep(freq, n: int, sr: int = SR, phase0: float = 0.0) -> np.ndarray:
    ph = phase(freq, n, sr, phase0)
    t = (ph - np.floor(ph))
    dt = np.asarray(freq, dtype=np.float64) / sr
    return (2.0 * t - 1.0 - _blep(t, dt)).astype(F32)


def square_blep(freq, n: int, width: float = 0.5, sr: int = SR, phase0: float = 0.0) -> np.ndarray:
    ph = phase(freq, n, sr, phase0)
    t = ph - np.floor(ph)
    dt = np.asarray(freq, dtype=np.float64) / sr
    y = np.where(t < width, 1.0, -1.0)
    y += _blep(t, dt)
    t2 = t - width
    t2 -= np.floor(t2)
    y -= _blep(t2, dt)
    return y.astype(F32)


def triangle_blep(freq, n: int, sr: int = SR, phase0: float = 0.0) -> np.ndarray:
    """Leaky-integrated PolyBLEP square (band-limited triangle)."""
    sq = square_blep(freq, n, 0.5, sr, phase0).astype(np.float64)
    dt = np.asarray(freq, dtype=np.float64) / sr
    y = lfilter([1.0], [1.0, -0.9995], 4.0 * dt * sq)
    y -= np.mean(y)
    m = np.max(np.abs(y)) or 1.0
    return (y / m).astype(F32)


# ----------------------------------------------------------------------------
# Noise
# ----------------------------------------------------------------------------

def white(n: int, r: np.random.Generator) -> np.ndarray:
    return r.standard_normal(n, dtype=np.float32) * F32(0.5)


def _shaped(n: int, r: np.random.Generator, slope_db_oct: float) -> np.ndarray:
    if n <= 0:
        return np.zeros(0, F32)
    m = 1 << max(4, int(math.ceil(math.log2(n))))
    spec = np.fft.rfft(r.standard_normal(m))
    f = np.arange(spec.shape[0], dtype=np.float64)
    f[0] = 1.0
    spec *= f ** (slope_db_oct / (20 * math.log10(2)))
    spec[0] = 0.0
    y = np.fft.irfft(spec, m)[:n]
    s = float(np.std(y)) or 1.0
    return (y * (0.5 / s)).astype(F32)


def colored(n: int, r: np.random.Generator, lo: float = 0.0, hi: float = 0.0, sr: int = SR) -> np.ndarray:
    """Cheap band-limited noise: white noise through first-order high/low-pass
    filters at ``lo``/``hi`` Hz (0 = off). RMS about 0.5 before filtering."""
    y = r.standard_normal(n, dtype=np.float32) * F32(0.5)
    if hi:
        a = math.exp(-2 * math.pi * hi / sr)
        y = lfilter([1 - a], [1, -a], y).astype(F32)
    if lo:
        a = math.exp(-2 * math.pi * lo / sr)
        y = (y - lfilter([1 - a], [1, -a], y)).astype(F32)
    return y


def pink(n: int, r: np.random.Generator) -> np.ndarray:
    """Pink (-3 dB/oct) noise, RMS 0.5."""
    return _shaped(n, r, -3.0)


def brown(n: int, r: np.random.Generator) -> np.ndarray:
    """Brown (-6 dB/oct) noise, RMS 0.5 (DC removed)."""
    return _shaped(n, r, -6.0)
