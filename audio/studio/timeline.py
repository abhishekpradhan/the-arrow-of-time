"""Timeline access and tempo helpers.

:class:`Timeline` reads a project's ``timeline.json`` (the same file that
times the visuals), so a score never hard-codes a time that exists there.

Tempo helpers turn a (possibly changing) pulse rate into exact event times:
:func:`pulses` integrates an instantaneous rate curve and returns the times
where the phase crosses whole beats, and :func:`fit` time-warps a list so its
last event lands exactly on a target.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Callable, Sequence

import numpy as np


@dataclass(frozen=True)
class Beat:
    id: str
    start: float
    end: float
    data: dict

    @property
    def dur(self) -> float:
        return self.end - self.start

    def at(self, frac: float) -> float:
        """Time at a fraction (0..1) of the beat."""
        return self.start + frac * self.dur


class Timeline:
    """Read-only view of ``timeline.json``."""

    def __init__(self, data: dict):
        self.data = data
        self.duration = float(data['duration'])
        self.fps = float(data.get('fps', 24))
        self.cues: dict[str, float] = {k: float(v) for k, v in data.get('cues', {}).items()}
        self.beats: list[Beat] = [Beat(b['id'], float(b['start']), float(b['end']), b) for b in data.get('beats', [])]
        self._by_id = {b.id: b for b in self.beats}

    @classmethod
    def load(cls, path: str) -> 'Timeline':
        with open(path, 'r', encoding='utf8') as f:
            return cls(json.load(f))

    def cue(self, name: str) -> float:
        if name not in self.cues:
            raise KeyError(f'timeline has no cue {name!r}')
        return self.cues[name]

    def beat(self, bid: str) -> Beat:
        if bid not in self._by_id:
            raise KeyError(f'timeline has no beat {bid!r}')
        return self._by_id[bid]

    def times(self, key: str) -> list[float]:
        """A top-level list of times, e.g. ``starIgnitions``."""
        return [float(v) for v in self.data.get(key, [])]

    def montage(self, bid: str) -> list[dict]:
        return list(self.beat(bid).data.get('montage', []))

    def lines(self, key: str) -> list[dict]:
        return list(self.data.get(key, []))

    def beat_at(self, t: float) -> Beat | None:
        for b in self.beats:
            if b.start <= t < b.end:
                return b
        return None


# ----------------------------------------------------------------------------
# Tempo / pulse helpers
# ----------------------------------------------------------------------------

Rate = float | Callable[[np.ndarray], np.ndarray] | tuple


def ramp(t0: float, t1: float, r0: float, r1: float, curve: str = 'exp') -> Callable[[np.ndarray], np.ndarray]:
    """Rate curve going from ``r0`` at ``t0`` to ``r1`` at ``t1`` (held after).
    ``curve='exp'`` changes by a constant ratio per second (sounds even)."""
    def f(t):
        u = np.clip((np.asarray(t, dtype=np.float64) - t0) / (t1 - t0), 0.0, 1.0)
        if curve == 'exp':
            return r0 * (r1 / r0) ** u
        return r0 + (r1 - r0) * u
    return f


def pulses(t0: float, t1: float, rate: Rate, dt: float = 1e-4, include_end: bool = False) -> list[float]:
    """Pulse times in ``[t0, t1)`` (first pulse at ``t0``) for an
    instantaneous rate in Hz: a number, a callable of time, or ``(r0, r1)``
    meaning an exponential ramp across the span."""
    if isinstance(rate, tuple):
        rate = ramp(t0, t1, rate[0], rate[1])
    if not callable(rate):
        r = float(rate)
        k = int(math.floor((t1 - t0) * r + 1e-9))
        out = [t0 + i / r for i in range(k + 1)]
        return [t for t in out if t < t1 or (include_end and abs(t - t1) < 1e-9)]
    grid = np.arange(t0, t1 + dt, dt)
    rr = rate(grid)
    ph = np.concatenate([[0.0], np.cumsum((rr[:-1] + rr[1:]) * 0.5 * dt)])
    k = np.arange(0, int(math.floor(ph[-1] + 1e-9)) + 1)
    times = np.interp(k, ph, grid)
    return [float(t) for t in times if t < t1 - 1e-9 or include_end]


def fit(times: Sequence[float], first: float, last: float) -> list[float]:
    """Linearly time-warp ``times`` so the first lands on ``first`` and the
    last on ``last``."""
    if len(times) < 2:
        return [first]
    a, b = times[0], times[-1]
    return [first + (t - a) * (last - first) / (b - a) for t in times]


def grid(t0: float, t1: float, step: float) -> list[float]:
    """Regular times from ``t0`` (inclusive) to ``t1`` (exclusive)."""
    n = int(math.floor((t1 - t0) / step + 1e-9))
    return [t0 + i * step for i in range(n) if t0 + i * step < t1 - 1e-9]
