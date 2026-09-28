#!/usr/bin/env python3
"""The Arrow of Time: the score.

Synthesizes the full soundtrack from code with the shared ``audio/studio``
library, following MUSIC.md ("Clockwork Cosmos"). Every time comes from
``timeline.json`` (cues, beats, montage, starIgnitions, starDeaths), so
retiming the film retimes the music. Offsets inside a section are musical
(bars/beats at 60 BPM) and are always relative to a timeline anchor.

    python projects/arrow-of-time/score.py                     # full render
    python projects/arrow-of-time/score.py --from 180 --to 212 # quick partial render
    python projects/arrow-of-time/score.py --stems out/arrow-of-time/audio/stems

Output: 48 kHz stereo 24-bit WAV, mastered to -14 LUFS integrated and at most
-1 dBTP. A ``.json`` report is written next to the WAV (loudness, peaks, master
gain; partial renders reuse the full render's master gain).
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / 'audio'))

import numpy as np  # noqa: E402

from studio import Mix, SR, Timeline, analysis, fx, instruments as ins, master, theory, wav  # noqa: E402
from studio import filters as flt  # noqa: E402
from studio.core import F32, Bounce, env_points, ns, rng  # noqa: E402
from studio.theory import midi, name  # noqa: E402
from studio.timeline import fit, grid, pulses, ramp  # noqa: E402

PROJECT = HERE.name
DEFAULT_OUT = ROOT / 'out' / PROJECT / 'audio' / 'score.wav'

# ----------------------------------------------------------------------------
# Musical material (MUSIC.md)
# ----------------------------------------------------------------------------

GAP = 0.35      # silent gap before the Big Bang (MUSIC.md)
BREATH = 0.06   # the "suck": everything stops this long before the asteroid impact
END_FADE = 0.5  # the file ends in silence (fades the last reverb tail)

#: core progression Am - Fmaj7 - C - G6 with the E pedal held on top:
#: bass + upper voices (common tones A/C/E are held between chords)
CORE = {
    'Am': ('A2', ['A3', 'C4', 'E4']),
    'F': ('F2', ['A3', 'C4', 'E4']),
    'C': ('C3', ['G3', 'C4', 'E4']),
    'G': ('G2', ['G3', 'B3', 'E4']),
}
CYCLE = ['Am', 'F', 'C', 'G']

#: brass / stab triads and string-ostinato figures for the core chords
TRIAD = {'Am': ['A3', 'C4', 'E4', 'A4'], 'F': ['A3', 'C4', 'F4', 'A4'],
         'C': ['G3', 'C4', 'E4', 'G4'], 'G': ['G3', 'B3', 'D4', 'G4']}
FIGURE = {'Am': ['A3', 'E4', 'A4', 'E4'], 'F': ['F3', 'C4', 'F4', 'C4'],
          'C': ['C4', 'G4', 'C5', 'G4'], 'G': ['G3', 'D4', 'G4', 'D4']}

#: per-section mix offsets (dB): the film's dynamic arc. Quiet moments are
#: genuinely quiet; the climaxes (bang, Milky Way, asteroid, civilization to
#: NOW, red giant, merger, Picardy) carry the loudness.
LEVEL = {
    'prologue': -9.0, 'riser': -4.0, 'bang': 0.0, 'universe': -1.5, 'darkages': -12.0, 'firststars': -8.0,
    'galaxies': -2.0, 'milkyway': -2.0, 'nebula': -7.0, 'sun': -1.5, 'earth': -2.5, 'moon': -1.5, 'oceans': -6.0,
    'life': 1.5, 'snowball': -11.0, 'cambrian': 1.5, 'dinosaurs': 2.0, 'impact': 0.0, 'mammals': -7.0,
    'humans': -10.0, 'caves': -4.0, 'ascent': -1.5, 'now': -10.0, 'future': -4.0, 'redgiant': 1.5,
    'whitedwarf': -8.0, 'merger': 0.0, 'laststars': -4.0, 'blackholes': -11.0, 'evaporation': -9.0,
    'epilogue': -4.0,
}

#: extra clock level (dB) and click brightness per section, so the heartbeat
#: stays audible over the loudest music without being annoying in quiet parts
TICK_BOOST = {'prologue': (0.0, 0.0), 'civilization': (7.0, 1.0), 'moonlanding': (11.0, 1.0), 'nightearth': (12.0, 1.0),
              'mars': (5.0, 0.5), 'drift': (5.0, 0.5), 'hotearth': (3.0, 0.3), 'redgiant': (10.0, 1.0),
              'whitedwarf': (2.0, 0.3), 'merger': (12.0, 1.0), 'laststars': (8.0, 0.8)}

#: the 8-bar theme, quarter note = 1 s: (note, beats) per bar
THEME = [
    [('E5', 2), ('D5', 1), ('C5', 1)], [('C5', 3), ('A4', 1)], [('G4', 2), ('C5', 1), ('E5', 1)], [('D5', 4)],
    [('E5', 2), ('D5', 1), ('C5', 1)], [('A5', 3), ('G5', 1)], [('E5', 2), ('D5', 1), ('C5', 1)], [('B4', 4)],
]

#: life-motif arpeggios (16ths over C - G/B - Am - F)
ARP = {'C': ['C4', 'G4', 'C5', 'E5', 'G5', 'E5', 'C5', 'G4'],
       'G/B': ['B3', 'G4', 'B4', 'D5', 'G5', 'D5', 'B4', 'G4'],
       'Am': ['A3', 'E4', 'A4', 'C5', 'E5', 'C5', 'A4', 'E4'],
       'F': ['F3', 'C4', 'F4', 'A4', 'C5', 'A4', 'F4', 'C4']}
LIFE_BASS = {'C': 'C3', 'G/B': 'B2', 'Am': 'A2', 'F': 'F2'}
LIFE_PAD = {'C': ['E4', 'G4', 'C5'], 'G/B': ['D4', 'G4', 'B4'], 'Am': ['E4', 'A4', 'C5'], 'F': ['F4', 'A4', 'C5']}
LIFE = ['C', 'G/B', 'Am', 'F']


def up(notes, octaves=1):
    return [name(midi(n) + 12 * octaves) for n in notes]


def beep(dur: float = 0.3, f: float = 1010.0) -> np.ndarray:
    """Sputnik's beep as it came out of a 1957 receiver: a plain tone with a slight warble,
    band-limited and a touch noisy, with quick fades."""
    from studio.core import fade, tvec
    t = tvec(ns(dur))
    warble = 1.0 + 0.004 * np.sin(2 * np.pi * 7.0 * t)
    x = np.sin(2 * np.pi * f * warble * t) + 0.12 * np.sin(2 * np.pi * 2 * f * t)
    x += 0.03 * rng('beep').standard_normal(x.shape[0])
    x = fade(x.astype(F32) * 0.5, 0.006, 0.03)
    return flt.HP(400)(flt.LP(3200)(x, 0.0), 0.0)


def quindar(f: float) -> np.ndarray:
    """Apollo's Quindar tones: a pure 250 ms beep keyed onto the air-to-ground loop at the start
    (2525 Hz) and the end (2475 Hz) of each transmission from Houston, band-limited like the
    radio it came through."""
    from studio.core import fade, tvec
    t = tvec(ns(0.25))
    x = (np.sin(2 * np.pi * f * t) * 0.4).astype(F32)
    x = fade(x, 0.004, 0.012)
    return flt.HP(300)(flt.LP(3400)(x, 0.0), 0.0)


def squelch(seed: int = 0) -> np.ndarray:
    """A voice loop's squelch closing: a short burst of noise ending in a click, band-limited like
    the radio."""
    from studio.core import fade
    r = rng('squelch', seed)
    n = ns(0.2)
    k = np.linspace(0.0, 1.0, n, dtype=np.float64)
    x = (r.standard_normal(n) * np.minimum(1.0, k * 10.0) * (1.0 - k) ** 1.5 * 0.45).astype(F32)
    x[n - 24:] += np.hanning(24).astype(F32) * 0.8
    x = fade(x, 0.002, 0.004)
    return flt.HP(300)(flt.LP(3000)(x, 0.0), 0.0)


def armstrong() -> np.ndarray:
    """Neil Armstrong, 20 July 1969: "Houston, Tranquility Base here. The Eagle has landed." NASA's
    recording of the air-to-ground loop (assets/apollo11/, built by tools/assets/build_apollo11.py):
    the Quindar tone that ended Houston's last call (0.25-0.6 s), then his words (1.0-4.9 s); the
    hiss is faded out after the last word."""
    from studio.core import fade
    x, sr = wav.read_wav(str(ROOT / 'assets' / 'apollo11' / 'eagle-has-landed.wav'))
    assert sr == SR, sr
    x = np.asarray(x, dtype=F32).mean(axis=0)[:ns(4.98)]
    return fade(x, 0.01, 0.08)


def theme_line(score, track, bars, start, beat, synth, gain_db=0.0, shape=None, legato=0.15):
    """Play theme bars with ``synth(note, dur, k)`` (k = index), notes overlapping slightly."""
    for k, (t, note, d) in enumerate(theme_events(bars, start, beat)):
        score.put(track, t, synth(note, d + legato, k), gain_db, shape=shape)


def theme_events(bars, start, beat=1.0):
    """(time, note, dur) for the given 1-based theme bars starting at ``start``."""
    out, t = [], start
    for b in bars:
        for note, beats in THEME[b - 1]:
            out.append((t, note, beats * beat))
            t += beats * beat
    return out


# ----------------------------------------------------------------------------
# The score
# ----------------------------------------------------------------------------

class Score:
    def __init__(self, tl: Timeline, t0: float = 0.0, t1: float | None = None, log=print):
        self.tl = tl
        self.cue = tl.cue
        self.B = tl.beat
        self.t0 = t0
        self.t1 = tl.duration if t1 is None else t1
        self.log = log
        m = self.mix = Mix(tl.duration)
        m.log = log
        m.reverb('room', fx.reverb_ir('room'), hp=150.0)
        m.reverb('hall', fx.reverb_ir('hall'), hp=180.0)
        m.reverb('cathedral', fx.reverb_ir('cathedral'), hp=200.0, lp=9000.0)
        T = m.track
        chorus = lambda seed, mix=0.3, rate=0.3: fx.Chorus(rate, 2.2, 13.0, mix, 2, seed=seed)  # noqa: E731
        # the clock must read through the loudest passages: carve room for each tick there
        self.sched = self.tick_schedule()
        loud = {k for k, (boost, _) in TICK_BOOST.items() if boost >= 7.0}
        carve_times = [t for t, _, _, far, _ in self.sched if not far and (tl.beat_at(t) and tl.beat_at(t).id in loud)]
        carve = lambda: fx.Carve(carve_times, depth_db=6.0)  # noqa: E731
        self.clock = T('clock', gain_db=-8, fx=[flt.HP(250)], sends={'room': -10, 'hall': -22}, group='clock')
        self.clock_far = T('clock_far', gain_db=-8, fx=[flt.HP(250)], sends={'room': -10, 'hall': -10, 'cathedral': -16},
                           group='clock')
        self.organ = T('organ', gain_db=0, fx=[flt.HP(36), flt.LP(12000), carve()], sends={'hall': -7, 'cathedral': -16})
        self.strings = T('strings', gain_db=0, fx=[flt.HP(40), carve()], sends={'hall': -6})
        self.lead = T('lead', gain_db=0, fx=[flt.HP(60), carve()], sends={'hall': -6, 'cathedral': -15})
        self.piano = T('piano', gain_db=0, fx=[flt.HP(30)], sends={'hall': -10})
        self.piano_far = T('piano_far', gain_db=0, fx=[flt.HP(30)], sends={'hall': -12, 'cathedral': -5})
        self.brass = T('brass', gain_db=0, fx=[flt.HP(40), chorus(2, 0.3, 0.45), carve()], sends={'hall': -8})
        self.choir = T('choir', gain_db=-1, fx=[flt.HP(80), carve()], sends={'hall': -10, 'cathedral': -8})
        self.bells = T('bells', gain_db=-5, fx=[flt.HP(250), carve()], sends={'cathedral': -4, 'hall': -14})
        self.pluck = T('pluck', gain_db=-3, fx=[flt.HP(110), flt.LP(9000), fx.Delay(0.375, 0.28, 0.16, lp=4500.0)],
                       sends={'hall': -11})
        self.mallet = T('mallet', gain_db=-4, fx=[flt.HP(90), flt.LP(9000)], sends={'hall': -12})
        self.pad = T('pad', gain_db=0, fx=[flt.HP(40)], sends={'hall': -8, 'cathedral': -14})
        self.glass = T('glass', gain_db=-3, fx=[flt.HP(300)], sends={'cathedral': -4})
        self.perc = T('perc', gain_db=0, fx=[flt.HP(28)], sends={'room': -7, 'hall': -15})
        self.boom = T('boom', gain_db=0, fx=[flt.HP(20)], sends={'hall': -20}, group='fx')
        self.sfx = T('sfx', gain_db=0, fx=[flt.HP(30)], sends={'hall': -13, 'cathedral': -18}, group='fx')
        self.amb = T('amb', gain_db=0, fx=[flt.HP(40)], sends={'hall': -16}, group='fx')
        # hard cuts (MUSIC.md): the silent gap before the bang, NOW, and the asteroid impact. (The
        # launch has none: the civilization's crescendo runs straight into the ignition.)
        m.cut(self.cue('bang') - GAP)
        m.cut(self.cue('now'))
        m.cut(self.cue('asteroidImpact') - BREATH)   # all music (and every tail) stops, then the hit
        self._cache = {}
        self.offset = 0.0

    # -- helpers ---------------------------------------------------------------
    def sec(self, name: str) -> None:
        """Set the mix offset (dB) applied to everything placed next."""
        self.offset = LEVEL[name]

    def want(self, a: float, b: float) -> bool:
        """Does [a, b] (plus tails) touch the render window?"""
        return b + 14.0 >= self.t0 and a <= self.t1 + 0.5

    def put(self, track, t, x, gain_db=0.0, pan=0.0, shape=None):
        """Place ``x`` at ``t``; ``shape`` = absolute-time dB breakpoints."""
        if x is None:
            return
        if shape:
            n = x.shape[-1]
            env = env_points([(ta - t, v) for ta, v in shape], n, db_domain=True)
            x = x * env
        track.add(t, x, gain_db + self.offset, pan)

    def cached(self, key, fn):
        if key not in self._cache:
            self._cache[key] = fn()
        return self._cache[key]

    def prog(self, track, steps, end, synth, gain_db=0.0, shape=None, bass_synth=None):
        """Legato progression: ``steps`` = [(t, bass or None, [upper voices])].
        Common tones are held (one long note), changed voices overlap."""
        vs = [(t, ([b] if b else []) + list(u)) for t, b, u in steps]
        has_bass = all(b for _, b, _ in steps)
        for st, dur, m, v in theory.legato(vs, end):
            fn = bass_synth if (bass_synth and has_bass and v == 0) else synth
            self.put(track, st, fn([m], dur, v), gain_db, shape=shape)

    def organ_prog(self, steps, end, reg='principal', attack=0.25, release=1.0, gain_db=0.0, shape=None,
                   trem=0.0, pedal=None, seed=0):
        synth = lambda ms, d, v: ins.organ(ms, d, reg, attack=attack, release=release, trem=trem, seed=seed + v)  # noqa: E731
        bass = (lambda ms, d, v: ins.organ(ms, d, pedal, attack=attack, release=release, seed=seed + 50)) if pedal else None  # noqa: E731
        self.prog(self.organ, steps, end, synth, gain_db, shape, bass)

    def string_prog(self, steps, end, attack=0.7, release=1.4, gain_db=0.0, shape=None, track=None, seed=0, **kw):
        synth = lambda ms, d, v: ins.strings(ms, d, attack=attack, release=release, seed=seed + v, **kw)  # noqa: E731
        self.prog(track or self.strings, steps, end, synth, gain_db, shape)

    def roll(self, t0, t1, note, v0=0.2, v1=0.9, rate=15.0, gain_db=0.0, seed=0):
        """Timpani roll with a crescendo from ``v0`` to ``v1``. The strokes of a
        roll overlap (same pitch, ~15 per second), so each one is short and the
        roll sits about 10 dB under a single stroke: support, not a solo."""
        r = rng('roll', t0, note, seed)
        ts = grid(t0, t1, 1.0 / rate)
        for i, t in enumerate(ts):
            u = (t - t0) / max(t1 - t0, 1e-6)
            v = (v0 + (v1 - v0) * u ** 1.5) * r.uniform(0.85, 1.0)
            vq = round(v * 20) / 20
            x = self.cached(('timp-roll', note, vq, i % 3), lambda: ins.timpani(note, vq, decay=0.45, seed=i % 3))
            self.put(self.perc, t + r.normal(0, 0.004), x, gain_db - 10.0, pan=0.25 if i % 2 else -0.05)

    def tick(self, t, kind, vel, far=False, seed=0):
        b = self.tl.beat_at(t)
        boost, bright = TICK_BOOST.get(b.id if b else '', (0.0, 0.0))
        x = self.cached(('tick', kind, seed % 6, bright), lambda: ins.clock(kind, 1.0, seed=seed % 6, bright=bright))
        g = 20 * math.log10(max(vel, 1e-3)) + boost
        (self.clock_far if far else self.clock).add(t, x, g, pan=-0.12 if kind == 'tick' else 0.12)

    # -- the clock ---------------------------------------------------------------
    def clock_part(self):
        """Place every tick of :meth:`tick_schedule` that touches the window."""
        sched = self.sched
        self.tick_count = len(sched)
        for t, kind, v, far, i in sched:
            if self.t0 - 2 <= t <= self.t1 + 0.1:
                self.tick(t, kind, v, far, seed=i)

    def tick_schedule(self):
        """The heartbeat: calm, accelerating into the bang, silent in the
        blast, soft in the dark ages, accelerating through civilization,
        dead at NOW, resuming, slowing through the end, one final tick.
        Returns [(time, 'tick'|'tock', velocity, far, index)]."""
        c, B = self.cue, self.B
        runs = []
        first, rs, bang = c('firstTick'), c('riserStart'), c('bang')
        stop = bang - GAP
        steady = pulses(first, rs, 1.0)
        acc = [t for t in pulses(rs, stop, ramp(rs, stop, 1.0, 5.0)) if t < stop - 0.06]
        runs.append([(t, 0.55, False) for t in steady] +
                    [(t, 0.55 + 0.5 * ((t - rs) / (stop - rs)) ** 1.5, False) for t in acc])
        D = B('darkages')
        runs.append([(t, 0.32, True) for t in grid(D.start, D.end, 2.0)])
        a0, top, now = c('accelStart'), c('launch'), c('now')
        r1, r2 = 140 / 60, 150 / 60
        def rate(t):
            t = np.asarray(t, dtype=np.float64)
            u1 = np.clip((t - a0) / (top - a0), 0, 1)
            u2 = np.clip((t - top) / (now - top), 0, 1)
            return np.where(t <= top, r1 ** u1, r1 * (r2 / r1) ** u2)
        # silent from the clouds (the ascent above them, orbit, the Moon) until the dissolve from
        # the Moon to night Earth (shots/apollo.ts), where it comes back from far away
        ne0 = B('nightearth').start
        back = ne0 - 1.2
        quiet = (c('clouds') - 0.05, back - 0.05)
        self.accel_ticks = [t for t in pulses(a0, now, rate) if t < now - 0.03 and not quiet[0] <= t < quiet[1]]
        def vel(t):
            v = 0.5 + 0.4 * (t - a0) / (now - a0)
            u = min(1.0, max(0.0, (t - back) / (ne0 + 1.5 - back)))
            return v * (0.2 + 0.8 * u * u) if t >= back else v
        runs.append([(t, vel(t), back <= t < ne0) for t in self.accel_ticks])
        res, Ls, last = c('resumeTick'), B('laststars'), c('lastTick')
        runs.append([(res, 0.5, True)])
        steady = pulses(res + 1.5, Ls.start, 1.0)
        run = [(t, 0.3 + 0.15 * min(1.0, (t - steady[0]) / 4.0), False) for t in steady]
        # 60 -> 30 BPM across the last stars, then ever slower (a gentler decay) until the
        # last tick lands exactly on lastTick; the late decay rate is chosen so that no
        # tick collides with the final flash (lastFlash)
        k1 = math.log(2) / Ls.dur
        flash = c('lastFlash')
        def schedule(k2):
            def slowing(t):
                t = np.asarray(t, dtype=np.float64) - Ls.start
                return np.where(t <= Ls.dur, np.exp(-k1 * t), 0.5 * np.exp(-k2 * (t - Ls.dur)))
            ts = pulses(Ls.start, last + 40.0, slowing)
            j = int(np.argmin([abs(t - last) for t in ts]))
            return fit(ts[:j + 1], Ls.start, last)
        cands = [schedule(k1 * m) for m in np.linspace(0.25, 0.45, 21)]
        slow = max(cands, key=lambda ts: (min(0.6, min(abs(t - flash) for t in ts)), -abs(len(ts) - len(cands[10]))))
        bh = B('blackholes').start
        run += [(t, 0.45 - 0.1 * (t - Ls.start) / (last - Ls.start), t >= bh) for t in slow]
        runs.append(run)
        runs.append([(c('finalTick'), 0.36, True)])
        return [(t, 'tick' if i % 2 == 0 else 'tock', v, far, i) for run in runs for i, (t, v, far) in enumerate(run)]

    # -- sections ------------------------------------------------------------------
    def prologue(self):
        """0-20: ticks, low organ A drone, E6 shimmer, sparse piano, riser, gap."""
        P, rs, bang = self.B('prologue'), self.cue('riserStart'), self.cue('bang')
        stop = bang - GAP
        if not self.want(P.start, stop):
            return
        self.sec('prologue')
        t_in = P.start + 2.0
        self.put(self.organ, t_in, ins.organ(['A2'], stop - t_in + 0.3, 'drone', attack=6.0, release=0.3, seed=1),
                 -3, shape=[(rs, 0), (stop, 5)])
        self.put(self.organ, rs, ins.organ(['A2', 'E3', 'A3'], stop - rs + 0.3, 'principal', attack=stop - rs,
                                           release=0.3, chiff=0, seed=2), -9)
        ts = P.start + 8.0
        self.put(self.strings, ts, ins.strings(['E6'], stop - ts + 0.3, attack=3.5, release=0.3, voices=8, vibrato=7,
                                               detune=6, bright=7000, air=0.03, seed=11), -8, shape=[(rs, 0), (stop, 8)])
        self.put(self.strings, ts + 1.0, ins.strings(['E5'], stop - ts - 0.7, attack=4.0, release=0.3, voices=6,
                                                     vibrato=8, bright=5000, seed=12), -14, shape=[(rs, 0), (stop, 8)])
        for dt, note, vel in ((4.0, 'A3', 0.36), (8.0, 'E4', 0.33), (11.0, 'C4', 0.30)):
            t = P.start + dt
            self.put(self.piano, t, ins.piano(note, dur=min(6.0, stop - t), vel=vel, tone=0.55), -1)
        d = stop - rs
        self.sec('riser')
        self.put(self.sfx, rs, ins.riser(d, 180.0, 7000.0, q=1.6, vel=0.9, curve=2.2, seed=1), -10)
        self.put(self.sfx, rs, ins.shepard(d, 0.18, 1.3, vel=1.0, seed=1), -7)
        self.put(self.amb, rs, ins.rumble(d, lp=110.0, vel=0.7, attack=d * 0.8, release=0.01, seed=1), -8)
        self.put(self.sfx, stop - 2.5, ins.reverse_swell(2.5, bright=1.0, vel=0.8, seed=1), -12)

    def bigbang(self):
        """20: the blast (sub boom, noise, choir + organ tutti on Am), then the
        title music Am - F - C - G (2 s per chord)."""
        bang, BB = self.cue('bang'), self.B('bigbang')
        if not self.want(bang, BB.end):
            return
        self.sec('bang')
        self.put(self.boom, bang, ins.sub_boom(12.0, 95.0, 24.0, 0.5, 3.2, 1.0, click=0.9, harmonics=0.5, seed=1), -4)
        self.put(self.sfx, bang, ins.impact(1.0, 1.5, 8.0, seed=2), -5)
        self.put(self.sfx, bang, ins.noise_burst(12.0, 16000.0, 110.0, 5.0, 2.4, 1.0, seed=3), -7)
        self.put(self.perc, bang, ins.timpani('A2', 1.0, seed=1), -2)
        decay = [(bang, -1.5), (bang + 1.5, -4.5), (bang + 4, -11), (bang + 7, -20), (BB.end, -30)]
        # the tutti blooms a moment after the blast's transient (room for the boom)
        self.put(self.choir, bang, ins.choir(['A2', 'E3', 'A3', 'C4', 'E4', 'A4', 'E5'], BB.end - bang, 'a',
                                             attack=0.25, release=3.0, voices=5, seed=4), 2, shape=decay)
        self.put(self.organ, bang, ins.organ(['A1', 'E2', 'A2', 'C3', 'E3', 'A3', 'C4', 'E4', 'A4'], BB.end - bang,
                                             'full', attack=0.12, release=2.5, seed=5), 1, shape=decay)
        self.put(self.organ, bang, ins.organ(['A2'], BB.end - bang, 'pedal', attack=0.15, release=3.0, seed=6), 0,
                 shape=decay)
        self.put(self.strings, bang, ins.strings(['A2', 'E3', 'A3', 'E4', 'A4', 'C5', 'E5'], 3.0, attack=0.2,
                                                 release=3.0, bright=6000, seed=7), -1, shape=decay)
        # title music
        t = bang + 1.0
        steps = [(t + 2 * i, *CORE[ch]) for i, ch in enumerate(CYCLE)]
        swell = [(t, -8), (t + 1.5, -2), (BB.end - 1.0, 0), (BB.end + 1.0, -3)]
        self.organ_prog(steps, BB.end + 0.3, 'principal', attack=0.6, release=1.5, gain_db=-1, shape=swell,
                        pedal='pedal', seed=10)
        s_steps = [(t, 'A2', ['A3', 'E4', 'A4', 'C5', 'E5']), (t + 2, 'F2', ['A3', 'F4', 'A4', 'C5', 'E5']),
                   (t + 4, 'C3', ['G3', 'E4', 'G4', 'C5', 'E5']), (t + 6, 'G2', ['G3', 'D4', 'G4', 'B4', 'E5'])]
        self.string_prog(s_steps, BB.end + 0.3, attack=0.9, release=1.6, gain_db=0, shape=swell, bright=5200, seed=20)
        self.roll(BB.end - 2.0, BB.end, 'E2', 0.15, 0.7, gain_db=-6, seed=1)
        # the main title: theme bars 1-4 (one bar per chord), horns with violins an octave up
        tswell = [(t, -9), (t + 2.0, -2), (BB.end - 1.0, 0), (BB.end + 0.8, -6)]
        theme_line(self, self.brass, [1, 2, 3, 4], t, 0.5,
                   lambda n, d, k: ins.brass([up([n], -1)[0]], d, attack=0.08, release=0.5, vel=0.85, bright=0.9,
                                             seed=300 + k), -3, shape=tswell)
        theme_line(self, self.lead, [1, 2, 3, 4], t, 0.5,
                   lambda n, d, k: ins.strings([n], d, attack=0.12, release=0.6, voices=6, vibrato=14, bright=5200,
                                               seed=310 + k), -6, shape=tswell)

    def universe(self):
        """30-50: organ progression, bell arpeggios over the first elements,
        warm swell into C major at First Light (cmbClear)."""
        I, E, CM = self.B('inflation'), self.B('elements'), self.B('cmb')
        cmb = self.cue('cmbClear')
        if not self.want(I.start, CM.end):
            return
        self.sec('universe')
        # inflation: a soft outward "whoomp"
        self.put(self.boom, I.start, ins.sub_boom(5.0, 70.0, 30.0, 0.4, 1.4, 0.5, click=0.2, seed=4), -6)
        self.put(self.sfx, I.start, ins.noise_burst(5.0, 9000.0, 250.0, 2.5, 1.2, 0.5, seed=5), -12)
        steps = [(I.start, *CORE['Am']), (I.start + 4, *CORE['F']), (E.start + 2, 'D2', ['A3', 'C4', 'E4']),
                 (CM.start, *CORE['G']), (cmb, *CORE['C']), (CM.end - 2, *CORE['F'])]
        dyn = [(I.start, -2), (E.start, -5), (CM.start, -6), (cmb, 1), (cmb + 3, -1), (CM.end - 2, -5), (CM.end, -16)]
        self.organ_prog(steps, CM.end + 0.2, 'principal', attack=0.5, release=2.0, shape=dyn, seed=30)
        s_steps = [(I.start, 'A2', ['E4', 'A4', 'C5', 'E5']), (I.start + 4, 'F2', ['F4', 'A4', 'C5', 'E5']),
                   (E.start + 2, 'D3', ['F4', 'A4', 'D5', 'E5']), (CM.start, 'G2', ['G4', 'B4', 'D5', 'E5']),
                   (cmb, 'C3', ['G4', 'C5', 'E5', 'G5']), (CM.end - 2, 'F2', ['F4', 'A4', 'C5', 'E5'])]
        self.string_prog(s_steps, CM.end + 0.2, attack=1.2, release=2.0, shape=dyn, gain_db=-2, bright=4800, seed=40)
        # a flute-stop organ arpeggio in 8ths keeps the young universe moving
        figs = {'A2': ['A3', 'E4', 'A4', 'C5'], 'F2': ['F3', 'C4', 'A4', 'C5'], 'D2': ['D4', 'A4', 'D5', 'F5'],
                'G2': ['G3', 'D4', 'B4', 'D5'], 'C3': ['C4', 'G4', 'C5', 'E5']}
        bnds = [st[0] for st in steps] + [CM.end]
        for (t0, b, _), t1 in zip(steps, bnds[1:]):
            fig = figs[b]
            for j, tt in enumerate(grid(t0, t1 - 0.05, 0.5)):
                note = fig[[0, 1, 2, 3, 2, 1][j % 6]]
                vel = 0.8 if j % 2 == 0 else 0.62
                x = self.cached(('uarp', note, vel), lambda: ins.organ([note], 0.55, 'soft', attack=0.02, release=0.35,
                                                                      chiff=0.5, level=vel, seed=7))
                self.put(self.organ, tt, x, -13, pan=-0.3 if j % 2 else 0.3, shape=dyn)
        # glittering bell arpeggios over the first elements
        tones = {E.start: ['A5', 'C6', 'E6', 'F6', 'A6', 'C7'], E.start + 2: ['A5', 'C6', 'D6', 'E6', 'F6', 'A6']}
        r = rng('glitter')
        ts = pulses(E.start, E.end, ramp(E.start, E.end, 3.0, 7.0))
        idx = 2
        for i, t in enumerate(ts):
            pool = tones[E.start] if t < E.start + 2 else tones[E.start + 2]
            idx = int(np.clip(idx + r.choice([-2, -1, 1, 1, 2]), 0, len(pool) - 1))
            u = (t - E.start) / E.dur
            vel = (0.3 + 0.35 * math.sin(math.pi * u)) * r.uniform(0.75, 1.0)
            kind = 'celesta' if i % 3 else 'glass'
            self.put(self.bells, t, ins.bell(pool[idx], 3.0, vel, kind=kind, fm=0.25, seed=i), -2,
                     pan=(-0.55 if i % 2 else 0.55) * r.uniform(0.5, 1.0))
        # First Light: swell (choir + reverse swell) into C major at cmbClear
        self.put(self.choir, CM.start, ins.choir(['E4', 'G4', 'C5', 'E5'], CM.end - CM.start - 1.5, 'a', attack=2.2,
                                                 release=2.5, seed=50), -3, shape=[(cmb, 0), (cmb + 2, -2), (CM.end, -14)])
        self.put(self.sfx, cmb - 2.0, ins.reverse_swell(2.0, 0.8, 0.7, seed=2), -14)
        for k, note in enumerate(['C6', 'E6', 'G6', 'C7']):
            self.put(self.bells, cmb + 0.08 * k, ins.bell(note, 5.0, 0.45, 'glass', seed=60 + k), -3,
                     pan=[-0.5, 0.5, -0.2, 0.3][k])
        self.put(self.organ, cmb, ins.organ(['C4', 'E4', 'G4', 'C5'], CM.end - cmb - 1.5, 'full', attack=0.4,
                                            release=2.0, seed=70), -8, shape=[(cmb, 0), (CM.end - 1, -10)])

    def darkages(self):
        """50-56: nearly silent: low A drone, faint wind (ticks from clock_part)."""
        D, FS, G = self.B('darkages'), self.B('firststars'), self.B('galaxies')
        if not self.want(D.start, G.start):
            return
        self.sec('darkages')
        self.put(self.pad, D.start - 1.0, ins.drone(['A1'], G.start - D.start, attack=3.0, release=4.0, vel=0.9), -16)
        self.put(self.organ, D.start - 0.5, ins.organ(['A2'], FS.end - D.start, 'drone', attack=3.0, release=3.0,
                                                      seed=80), -8)
        self.put(self.amb, D.start - 1.5, ins.wind(D.dur + 4.0, 0.8, vel=0.6, seed=1), -8)

    def firststars(self):
        """56-64: one bell per starIgnitions time (A minor pentatonic, high),
        organ re-enters."""
        FS = self.B('firststars')
        if not self.want(FS.start, FS.end):
            return
        self.sec('firststars')
        penta = theory.scale('A', 'pentatonic_minor', 'A5', 'E7')
        r = rng('stars')
        prev = None
        for i, t in enumerate(self.tl.times('starIgnitions')):
            m = int(r.choice([p for p in penta if p != prev]))
            prev = m
            self.put(self.bells, t, ins.bell(m, 7.0, r.uniform(0.55, 0.85), 'glass', fm=0.4, seed=100 + i), 5,
                     pan=float(r.uniform(-0.7, 0.7)))
        steps = [(FS.start, 'A2', ['A3', 'C4', 'E4']), (FS.start + 4, 'F2', ['A3', 'C4', 'E4'])]
        self.organ_prog(steps, FS.end + 0.3, 'soft', attack=3.0, release=1.5, gain_db=-4,
                        shape=[(FS.start, -8), (FS.end, -2)], seed=110)
        self.put(self.strings, FS.start + 2.0, ins.strings(['E5', 'A5'], FS.end - FS.start - 1.5, attack=3.0,
                                                           release=1.5, voices=6, bright=4000, vibrato=9, seed=120), -12)

    def galaxies(self):
        """64-70: crescendo, organ and strings rising into the Milky Way."""
        G, mw = self.B('galaxies'), self.cue('milkyWayReveal')
        if not self.want(G.start, mw):
            return
        self.sec('galaxies')
        s = G.start
        stop = mw - 0.15                        # the crescendo stops just short of the reveal: a breath, then the hit
        cres = [(s, -18), (s + 3, -11), (mw - 1, -2), (stop, 0)]
        self.organ_prog([(s, 'A2', ['A3', 'C4', 'E4']), (s + 2, 'B2', ['G3', 'B3', 'E4']), (s + 4, 'C3', ['G3', 'C4', 'E4']),
                         (s + 5, 'D3', ['A3', 'D4', 'F4'])], stop, 'principal', attack=0.5, release=0.1,
                        shape=cres, seed=130)
        self.string_prog([(s, 'A2', ['A4', 'C5', 'E5']), (s + 2, 'B2', ['B4', 'D5', 'G5']), (s + 4, 'C3', ['C5', 'E5', 'G5']),
                          (s + 5, 'D3', ['D5', 'F5', 'A5'])], stop, attack=0.8, release=0.1, shape=cres, bright=5500,
                         seed=140)
        self.put(self.choir, s + 3.0, ins.choir(['C4', 'E4', 'G4', 'C5'], stop - s - 3.0, 'a', attack=2.5, release=0.1,
                                                seed=150), -4)
        self.roll(mw - 2.5, mw - 0.12, 'C3', 0.1, 0.9, gain_db=-3, seed=2)
        self.put(self.sfx, mw - 2.05, ins.reverse_swell(2.0, 1.0, 0.9, seed=3), -11)   # peaks 50 ms before the reveal

    def milkyway(self):
        """70-80: synth brass + organ full chord, F major -> C, sustain to 80."""
        mw, MW = self.cue('milkyWayReveal'), self.B('milkyway')
        if not self.want(mw, MW.end):
            return
        self.sec('milkyway')
        t2 = MW.start + 5.0
        end = MW.end
        dyn = [(mw, 0), (t2 - 0.4, -2), (t2, 0), (end - 3.0, -2), (end, -16)]
        self.put(self.boom, mw, ins.sub_boom(6.0, 70.0, 32.0, 0.35, 1.6, 0.6, click=0.3, seed=7), -8)
        self.put(self.perc, mw, ins.timpani('F2', 1.0, seed=2), -5)
        self.put(self.sfx, mw, ins.noise_burst(4.0, 16000.0, 2500.0, 1.5, 0.9, 0.35, seed=8), -14)
        self.put(self.brass, mw, ins.brass(['F2', 'C3', 'F3', 'A3', 'C4', 'F4', 'A4'], t2 - mw, attack=0.07, release=0.9,
                                           vel=0.95, bright=1.0, seed=1), 1, shape=dyn)
        self.put(self.brass, t2, ins.brass(['C3', 'G3', 'C4', 'E4', 'G4', 'C5', 'E5'], end - t2 - 1.0, attack=0.3,
                                           release=2.0, vel=0.95, bright=1.0, seed=2), 1, shape=dyn)
        self.organ_prog([(mw, 'F2', ['C3', 'F3', 'A3', 'C4', 'F4', 'A4', 'C5']),
                         (t2, 'C3', ['C3', 'G3', 'C4', 'E4', 'G4', 'C5', 'E5'])], end, 'full', attack=0.08, release=2.2,
                        gain_db=-1, shape=dyn, pedal='pedal', seed=160)
        self.string_prog([(mw, 'F2', ['F3', 'C4', 'F4', 'A4', 'C5', 'F5', 'A5']),
                          (t2, 'C3', ['E3', 'G3', 'C4', 'G4', 'C5', 'E5', 'G5'])], end, attack=0.12, release=2.2,
                         shape=dyn, gain_db=-1, bright=6500, seed=170)
        self.put(self.choir, mw, ins.choir(['F3', 'C4', 'F4', 'A4', 'C5'], t2 - mw, 'a', attack=0.15, release=1.2,
                                           seed=180), 0, shape=dyn)
        self.put(self.choir, t2, ins.choir(['E3', 'G3', 'C4', 'E4', 'G4', 'C5'], end - t2 - 1.0, 'a', attack=0.5,
                                           release=2.5, seed=181), 0, shape=dyn)
        # theme bars 5-6, one bar per chord, horns doubled by violins
        theme_line(self, self.lead, [5, 6], mw + 0.2, (t2 - mw) / 4.0,
                   lambda n, d, k: ins.strings([n, up([n], -1)[0]], d, attack=0.3, release=1.0, voices=6, vibrato=15,
                                               bright=5200, seed=320 + k), -4, shape=dyn)

    def solar(self):
        """80-100: supernova boom, low piano ostinato (8ths), bright C major
        swell at sunIgnite, pads through the progression; molten Earth."""
        N, S, E, M = self.B('nebula'), self.B('sun'), self.B('earth'), self.B('moon')
        sn, si, theia = self.cue('supernova'), self.cue('sunIgnite'), self.cue('theia')
        if not self.want(N.start, theia):
            return
        self.sec('nebula')
        self.put(self.boom, sn, ins.sub_boom(5.0, 60.0, 30.0, 0.3, 1.8, 0.5, click=0.25, seed=9), -5)
        self.put(self.sfx, sn, ins.noise_burst(4.0, 7000.0, 400.0, 1.0, 0.8, 0.3, seed=10), -12)
        # ostinato: 8th notes (2 per second), root/fifth of the current chord
        changes = [(N.start, ('A2', 'E3')), (si, ('C3', 'G3')), (si + 4, ('G2', 'D3')), (E.start, ('A2', 'E3')),
                   (E.start + 3, ('F2', 'C3')), (M.start, ('D2', 'A2'))]
        for i, t in enumerate(grid(N.start, theia - 0.05, 0.5)):
            self.sec('nebula' if t < S.start else 'sun' if t < E.start else 'earth' if t < M.start else 'moon')
            pair = [p for tc, p in changes if tc <= t + 1e-6][-1]
            note = pair[i % 2]
            on_beat = abs(t - round(t)) < 1e-6
            base = 0.40 if t < M.start else 0.40 + 0.25 * (t - M.start) / (theia - M.start)
            vel = round(base + (0.06 if on_beat else 0.0), 2)
            self.put(self.piano, t, ins.piano(note, dur=min(0.9, theia - 0.07 - t), vel=vel, tone=0.6), -3)
        # nebula pads
        self.sec('nebula')
        self.put(self.strings, N.start, ins.strings(['A2', 'E3', 'A3', 'C4'], S.start - N.start + 0.5, attack=2.0,
                                                    release=2.0, bright=2200, vibrato=8, seed=190), -8)
        self.put(self.pad, N.start + 0.5, ins.pad(['A3', 'C4', 'E4'], S.start - N.start + 0.5, attack=3.0, release=2.0,
                                                  bright=1400, seed=1), -8)
        # sun ignites: reverse swell into a bright C major bloom
        self.sec('sun')
        self.put(self.sfx, si - 1.5, ins.reverse_swell(1.5, 1.2, 0.9, seed=4), -11)
        self.put(self.boom, si, ins.sub_boom(4.0, 65.0, 35.0, 0.25, 1.2, 0.4, click=0.2, seed=11), -7)
        for k, note in enumerate(['C6', 'G6', 'E6', 'C7', 'G5']):
            self.put(self.bells, si + 0.1 * k, ins.bell(note, 5.0, 0.5, 'glass', seed=200 + k), -3,
                     pan=[-0.6, 0.6, -0.3, 0.3, 0.0][k])
        steps = [(si, 'C3', ['G3', 'C4', 'E4']), (si + 4, 'G2', ['G3', 'B3', 'E4']), (E.start, 'A2', ['A3', 'C4', 'E4']),
                 (E.start + 3, 'F2', ['A3', 'C4', 'E4'])]
        dyn = [(si, 0), (si + 3, -3), (E.start, -5), (M.start, -7)]
        self.organ_prog(steps, M.start + 0.5, 'principal', attack=0.3, release=1.5, gain_db=-2, shape=dyn, seed=210)
        s_steps = [(si, None, ['G4', 'C5', 'E5', 'G5']), (si + 4, None, ['G4', 'B4', 'E5', 'G5']),
                   (E.start, None, ['A4', 'C5', 'E5', 'A5']), (E.start + 3, None, ['A4', 'C5', 'E5', 'F5'])]
        self.string_prog(s_steps, M.start + 0.5, attack=1.0, release=1.8, gain_db=-3, shape=dyn, bright=5500, seed=220)
        self.put(self.choir, si, ins.choir(['E4', 'G4', 'C5'], 3.5, 'a', attack=0.8, release=2.0, seed=230), -6)
        # a molten, battered Earth
        self.sec('earth')
        self.put(self.amb, E.start, ins.rumble(M.start - E.start + 2.0, lp=150.0, vel=0.5, attack=1.5, release=2.0,
                                               seed=2), -8)
        for k, dt in enumerate((1.3, 3.6)):
            self.put(self.boom, E.start + dt, ins.sub_boom(3.0, 55.0, 32.0, 0.2, 0.7, 0.35, click=0.1, seed=20 + k), -10)
            self.put(self.sfx, E.start + dt, ins.debris(2.0, 18.0, 0.5, seed=20 + k), -14, pan=0.4 if k else -0.4)

    def moon(self):
        """100-112: tension and the Theia impact; the graze and the tidal bridge
        (low D minor, a plucked figure circling the stereo field); Theia's
        remnant falls back (theiaReturn: a second, smaller hit on B flat); the arm
        winds into a disk (B flat to C sus, the figure faster and higher); years
        later the Moon (moonBorn: C add9, theme bars 3-4 in the bells, whose held
        D resolves to the E that opens the oceans' theme)."""
        M, O, theia = self.B('moon'), self.B('oceans'), self.cue('theia')
        ret, born = self.cue('theiaReturn'), self.cue('moonBorn')
        if not self.want(M.start, O.start):
            return
        self.sec('moon')
        d = theia - M.start
        br = 0.06                               # a breath before the impact
        self.put(self.strings, M.start, ins.strings(['D2', 'A2', 'D3', 'F3'], d - br - 0.04, attack=d * 0.8,
                                                    release=0.04, bright=3000, vibrato=20, seed=240), -2)
        self.put(self.strings, M.start + 0.3, ins.strings(['E5', 'F5'], d - 0.3 - br - 0.04, attack=d * 0.8,
                                                          release=0.04, bright=6000, vibrato=25, seed=241), -8)
        self.put(self.brass, M.start, ins.brass(['D2', 'A2', 'D3'], d - br - 0.04, attack=d * 0.9, release=0.04,
                                                vel=0.7, bright=0.6, growl=0.4, seed=3), -4)
        self.roll(M.start, theia - 0.12, 'D2', 0.1, 0.85, gain_db=-3, seed=3)
        self.put(self.sfx, M.start, ins.riser(d - br, 200.0, 5000.0, q=1.8, vel=0.8, seed=2), -12)
        # impact
        self.put(self.sfx, theia, ins.impact(1.0, 1.2, 7.0, seed=12), -4)
        self.put(self.boom, theia, ins.sub_boom(7.0, 80.0, 26.0, 0.35, 2.2, 0.8, click=0.5, seed=13), -6)
        self.put(self.sfx, theia + 0.1, ins.debris(4.5, 40.0, 0.9, seed=14), -4)
        # the graze and the bridge: low D minor, unsettled; debris circling
        t = theia + 0.35
        self.put(self.strings, t, ins.strings(['D2', 'A2', 'D3', 'F3', 'A3'], ret - t + 0.25, attack=1.4, release=0.5,
                                              voices=7, bright=2600, vibrato=18, seed=250), -6)
        self.put(self.strings, t + 0.8, ins.strings(['E5', 'F5', 'A5'], ret - t - 0.55, attack=1.8, release=0.5,
                                                    voices=5, bright=6500, vibrato=30, seed=251), -14)
        self.orbit(t + 0.5, ret - 0.12, ['D4', 'A4', 'D5', 'E5', 'F5', 'E5', 'D5', 'A4'], 0.22, 0.55, rate=5.0, seed=1)
        self.roll(ret - 1.3, ret - 0.1, 'Bb1', 0.1, 0.7, gain_db=-4, seed=4)
        # Theia's remnant falls back: a second, smaller hit, on B flat
        self.put(self.boom, ret, ins.sub_boom(4.5, 70.0, 28.0, 0.3, 1.5, 0.6, click=0.35, seed=15), -8)
        self.put(self.sfx, ret, ins.impact(0.6, 0.8, 4.5, seed=16), -11)
        self.put(self.perc, ret, ins.timpani('Bb1', 0.95, decay=2.0, seed=2), -3)
        self.put(self.brass, ret, ins.brass(['Bb2', 'F3', 'Bb3', 'D4'], 1.8, attack=0.04, release=1.0, vel=0.85,
                                            bright=0.7, growl=0.35, seed=6), -7)
        self.put(self.sfx, ret + 0.1, ins.debris(3.0, 22.0, 0.6, seed=17), -9)
        # the arm winds into a disk: B flat to C sus, the figure faster and higher
        mid = ret + 0.55 * (born - ret)
        self.string_prog([(ret + 0.1, 'Bb2', ['D4', 'F4', 'Bb4', 'C5']), (mid, 'C3', ['C4', 'F4', 'G4', 'C5'])],
                         born + 0.3, attack=0.9, release=0.6, gain_db=-5, bright=5000, vibrato=12, seed=252)
        self.orbit(ret + 0.3, mid, ['Bb4', 'D5', 'F5', 'C6', 'F5', 'D5'], 0.3, 0.55, rate=6.0, seed=2)
        self.orbit(mid, born - 0.05, ['C5', 'F5', 'G5', 'C6', 'G5', 'F5'], 0.45, 0.7, rate=7.0, seed=3)
        self.put(self.glass, ret + 0.4, ins.shimmer(born - ret + 1.5, 'F6', 10.0, 3.0, 9, 0.5, seed=3), -3)
        self.put(self.sfx, born - 1.6, ins.reverse_swell(1.6, 1.0, 0.8, seed=6), -13)
        # years later, the Moon: C add9, theme bars 3-4 in the bells; the held D resolves to the oceans' E
        end = O.start + 1.2
        self.put(self.strings, born, ins.strings(['C3', 'G3', 'E4', 'G4', 'D5'], end - born, attack=0.6, release=2.0,
                                                 voices=7, bright=5000, vibrato=10, seed=253), -6)
        self.put(self.choir, born + 0.1, ins.choir(['E4', 'G4', 'C5'], end - born, 'u', attack=0.8, release=2.0,
                                                   seed=260), -9)
        theme_line(self, self.bells, [3, 4], born, (O.start - born) / 5.0,
                   lambda n, dur, k: ins.bell(n, 3.5, 0.6, 'glass', seed=270 + k), -1)

    def orbit(self, t0, t1, notes, v0, v1, rate=5.0, seed=0):
        """A plucked figure circling the stereo field, like debris in orbit: ``notes``
        repeat at ``rate`` per second, crescendo ``v0`` to ``v1``, one turn per 1.6 s."""
        r = rng('orbit', t0, seed)
        for i, t in enumerate(grid(t0, t1, 1.0 / rate)):
            v = v0 + (v1 - v0) * (t - t0) / max(t1 - t0, 1e-6)
            x = ins.pluck(notes[i % len(notes)], 1.6, round(v, 2), bright=0.55, seed=i % 4)
            self.put(self.pluck, t + r.normal(0, 0.004), x, -4, pan=0.7 * math.sin(2 * math.pi * (t - t0) / 1.6))

    def oceans(self):
        """112-120: calm; rain from rainStart; warm pads."""
        O, L, rain = self.B('oceans'), self.B('life'), self.cue('rainStart')
        if not self.want(O.start, L.start + 4):
            return
        self.sec('oceans')
        self.organ_prog([(O.start, 'A2', ['A3', 'B3', 'C4', 'E4']), (O.start + 4, 'F2', ['A3', 'C4', 'E4'])],
                        O.end + 0.5, 'soft', attack=2.5, release=2.5, gain_db=-5, seed=270)
        self.string_prog([(O.start, None, ['E4', 'A4', 'B4', 'C5']), (O.start + 4, None, ['F4', 'A4', 'C5', 'E5'])],
                         O.end + 0.5, attack=2.5, release=2.5, gain_db=-9, bright=3500, seed=280)
        theme_line(self, self.piano_far, [1, 2], O.start, O.dur / 8.0,
                   lambda n, d, k: ins.piano(n, dur=d + 0.8, vel=0.34, tone=0.5), -3)
        self.put(self.amb, rain, ins.rain(L.start + 5.0 - rain, 1.0, 0.6, seed=1), -8,
                 shape=[(rain, -6), (rain + 2, 0), (L.start, 0), (L.start + 5.0, -30)])

    def life(self):
        """120-134 (+ snowball): the life motif, plucked 16th arpeggios over
        C - G/B - Am - F, brighter at oxygen; the lowpass closes at the freeze."""
        L, X, S = self.B('life'), self.B('oxygen'), self.B('snowball')
        fz = self.cue('snowballFreeze')
        if not self.want(L.start, S.end):
            return
        self.sec('life')
        chords = [(t, LIFE[i % 4]) for i, t in enumerate(grid(L.start, S.start + 1.0, 2.0))]
        bounce = Bounce(L.start, S.start - L.start + 6.0)
        accents = [1.0, 0.62, 0.78, 0.62, 0.9, 0.62, 0.78, 0.62]
        for t, ch in chords:
            bright = X.start <= t
            for k, note in enumerate(ARP[ch]):
                tn = t + 0.25 * k
                if tn >= S.start + 1.0:
                    break
                vel = accents[k] * (0.72 if bright else 0.62)
                x = ins.pluck(note, 1.4, vel, bright=0.8 if bright else 0.55, seed=k)
                bounce.add(tn, x, 0.0, pan_pos=-0.35 if k % 2 else 0.35)
                if bright and k % 4 == 0:
                    bounce.add(tn, ins.bell(up([note], 1)[0], 2.5, 0.3, 'celesta', fm=0.2, seed=k), -9, 0.2)
        # freeze: the low-pass closes over the first half second of snowball
        cut = lambda tl: np.exp(np.interp(L.start + tl, [S.start, fz], [math.log(16000.0), math.log(300.0)]))  # noqa: E731
        i0 = ns(S.start - L.start - 0.5)
        bounce.buf[:, i0:] = flt.sweep(bounce.buf[:, i0:], 'lowpass', lambda tl: cut(tl + (S.start - 0.5 - L.start)),
                                       0.9, block=64, stages=2)
        tail = ns(S.start + 1.2 - L.start)
        bounce.buf[:, tail:] *= np.exp(-np.arange(bounce.buf.shape[1] - tail) / (0.4 * SR)).astype(F32)
        self.put(self.pluck, L.start, bounce.buf, 0)
        # bass + pad (low-pass closes too)
        pads = Bounce(L.start, S.start - L.start + 4.0)
        for t, ch in chords:
            d = 2.0 if t + 2.0 <= S.start + 1.0 else S.start + 1.0 - t
            pads.add(t, ins.organ([LIFE_BASS[ch]], d, 'soft', attack=0.15, release=0.8, seed=5), -6)
            pads.add(t, ins.strings(LIFE_PAD[ch], d, attack=0.5, release=1.0, voices=5, bright=4200, vibrato=10,
                                    seed=290), -10 if t < X.start else -7)
        pads.buf[:, i0:] = flt.sweep(pads.buf[:, i0:], 'lowpass', lambda tl: cut(tl + (S.start - 0.5 - L.start)), 0.8,
                                     block=64)
        self.put(self.pad, L.start, pads.buf, 0)
        # oxygen: shaker 8ths and high strings
        for i, t in enumerate(grid(X.start, S.start, 0.5)):
            self.put(self.perc, t, self.cached(('shaker', i % 4), lambda: ins.shaker(0.5, seed=i % 4)),
                     -20 if i % 2 else -17, pan=0.3)
        self.put(self.strings, X.start, ins.strings(['G5', 'C6'], S.start - X.start + 0.3, attack=1.5, release=0.4,
                                                    voices=6, bright=6000, seed=300), -14)

    def snowball(self):
        """134-138: sudden cold: glassy high tones, sparse."""
        S, fz = self.B('snowball'), self.cue('snowballFreeze')
        if not self.want(S.start, S.end):
            return
        self.sec('snowball')
        self.put(self.glass, fz, ins.shimmer(3.0, 'E7', 5.0, 0.0, 7, 0.5, seed=4), -2)
        self.put(self.sfx, fz, ins.noise_burst(1.5, 14000.0, 6000.0, 0.5, 0.3, 0.2, seed=15), -16)
        for dt, note, d in ((0.0, 'E6', 3.3), (0.8, 'B6', 2.6), (1.7, 'A6', 2.0)):
            self.put(self.glass, fz + dt, ins.glass(note, d, attack=0.25, release=1.5, vel=0.55, seed=int(dt * 10)), 0,
                     pan=[-0.4, 0.4, 0.0][int(dt > 0) + int(dt > 1)])
        self.put(self.strings, fz, ins.strings(['B5'], S.end - fz, attack=1.0, release=1.0, voices=3, vibrato=0,
                                               bright=6000, seed=310), -16)
        self.put(self.amb, S.start, ins.wind(S.dur + 1.5, 0.6, vel=0.5, seed=2), -18)

    def cambrian(self):
        """138-152: the arpeggio returns fuller (bells, marimba); a warm
        cello line enters at 'land'."""
        C, Ld = self.B('cambrian'), self.B('land')
        if not self.want(C.start, Ld.end):
            return
        self.sec('cambrian')
        chords = [(t, LIFE[i % 4]) for i, t in enumerate(grid(C.start, Ld.end, 2.0))]
        accents = [1.0, 0.62, 0.78, 0.62, 0.9, 0.62, 0.78, 0.62]
        mar = {'C': ['E4', 'G4', 'C5'], 'G/B': ['D4', 'G4', 'B4'], 'Am': ['C4', 'E4', 'A4'], 'F': ['C4', 'F4', 'A4']}
        for t, ch in chords:
            for k, note in enumerate(ARP[ch]):
                tn = t + 0.25 * k
                self.put(self.pluck, tn, ins.pluck(note, 1.4, accents[k] * 0.75, bright=0.75, seed=k), 0,
                         pan=-0.35 if k % 2 else 0.35)
                if k % 4 == 0:
                    self.put(self.bells, tn, ins.bell(up([note], 1)[0], 2.5, 0.35, 'celesta', fm=0.2, seed=k), -4,
                             pan=0.25)
            for j, off in enumerate((0.0, 0.75, 1.5)):
                self.put(self.mallet, t + off, ins.marimba(mar[ch][j], 0.7 if j == 0 else 0.5, seed=j), -2,
                         pan=[-0.3, 0.1, 0.3][j])
            self.put(self.pad, t, ins.organ([LIFE_BASS[ch]], 2.0, 'soft', attack=0.12, release=0.8, seed=6), -5)
            if t < Ld.start:
                for off, v in ((0.0, 0.5), (1.0, 0.35)):
                    self.put(self.perc, t + off, self.cached(('tom', 88, v), lambda: ins.tom(88.0, v, seed=1)), -10)
        self.string_prog([(t, None, LIFE_PAD[ch]) for t, ch in chords], Ld.end + 0.3, attack=0.6, release=1.2,
                         gain_db=-9, bright=4500, voices=5, seed=320)
        # cello line (land)
        s = Ld.start
        for t, note, d in ((s, 'E3', 2.0), (s + 2, 'D3', 1.0), (s + 3, 'B2', 1.0), (s + 4, 'C3', 1.5), (s + 5.5, 'A2', 1.0)):
            self.put(self.lead, t, ins.strings([note], d, attack=0.25, release=0.9, voices=3, detune=5, vibrato=18,
                                               vib_rate=5.0, bright=2600, seed=330), -3)

    def dinosaurs(self):
        """152-160: primal taiko groove plus low brass."""
        Dn = self.B('dinosaurs')
        if not self.want(Dn.start, Dn.end):
            return
        self.sec('dinosaurs')
        big = {0: 1.0, 3: 0.7, 6: 0.8, 8: 0.95, 10: 0.7, 11: 0.8, 14: 0.85}
        mid = {2: 0.55, 5: 0.6, 7: 0.5, 12: 0.6, 13: 0.55, 15: 0.7}
        rims = {4: 0.5, 12: 0.45}
        for bar, t0 in enumerate(grid(Dn.start, Dn.end, 4.0)):
            for s in range(16):
                t = t0 + 0.25 * s
                if s in big:
                    v = round(big[s], 2)
                    self.put(self.perc, t, self.cached(('taiko', v), lambda: ins.taiko(v, 1.2, seed=1)), -1)
                if s in mid and not (bar == 1 and s >= 12):
                    v = round(mid[s], 2)
                    self.put(self.perc, t, self.cached(('taikom', v), lambda: ins.taiko(v, 0.75, seed=2)), -5,
                             pan=0.3 if s % 2 else -0.3)
                if s in rims:
                    self.put(self.perc, t, self.cached(('rim', s), lambda: ins.rim(0.6, seed=s)), -9, pan=0.4)
            if bar == 1:   # tom fill
                for k, f in enumerate((150.0, 125.0, 105.0, 88.0)):
                    self.put(self.perc, t0 + 3.0 + 0.25 * k, ins.tom(f, 0.8, seed=k), -4, pan=0.5 - 0.3 * k)
        self.put(self.perc, Dn.end, ins.taiko(1.0, 1.5, seed=3), 0)
        self.put(self.boom, Dn.end, ins.sub_boom(3.0, 60.0, 35.0, 0.2, 0.8, 0.5, click=0.2, seed=30), -6)
        s = Dn.start
        self.put(self.brass, s, ins.brass(['A1', 'E2', 'A2'], 3.8, attack=0.3, release=0.5, vel=0.85, bright=0.6,
                                          growl=0.7, seed=4), 2)
        self.put(self.brass, s + 4, ins.brass(['F1', 'C2', 'F2'], 1.9, attack=0.25, release=0.3, vel=0.85, bright=0.6,
                                              growl=0.7, seed=5), 2)
        self.put(self.brass, s + 6, ins.brass(['G1', 'D2', 'G2'], 1.9, attack=0.25, release=0.3, vel=0.9, bright=0.7,
                                              growl=0.7, seed=6), 2)
        self.put(self.organ, s, ins.organ(['A2'], 3.9, 'pedal', attack=0.2, release=0.6, seed=340), -4)
        figs = [(s, 'A2'), (s + 4, 'F2'), (s + 6, 'G2')]
        for t in grid(s, Dn.end, 0.5):
            note = [n for tt, n in figs if tt <= t + 1e-6][-1]
            acc = abs((t - s) % 2.0) < 1e-6
            self.put(self.strings, t, self.cached(('spic', note, acc), lambda: ins.strings(
                [note, up([note])[0]], 0.22, attack=0.01, release=0.18, voices=4, vibrato=0, bright=3500,
                air=0.0, seed=7)), -4 if acc else -8)

    def impact(self):
        """160-166: ominous whoosh along asteroidStreak, IMPACT at
        asteroidImpact (music cuts), rumble tail."""
        Dn = self.B('dinosaurs')
        st, imp = self.cue('asteroidStreak'), self.cue('asteroidImpact')
        Mm = self.B('mammals')
        if not self.want(Dn.end, Mm.start + 2):
            return
        self.sec('impact')
        d = imp - Dn.end
        br = BREATH
        self.put(self.brass, Dn.end, ins.brass(['A1', 'E2', 'Bb2'], d - br - 0.04, attack=d * 0.9, release=0.04,
                                               vel=0.8, bright=0.5, growl=0.6, seed=7), -1)
        self.put(self.strings, Dn.end + 0.2, ins.strings(['A2', 'Bb2', 'E5', 'F5'], d - 0.2 - br - 0.04,
                                                         attack=d * 0.8, release=0.04, vibrato=24, bright=3500,
                                                         seed=350), -6)
        self.roll(st, imp - 0.12, 'A2', 0.1, 0.9, gain_db=-4, seed=4)
        w = imp - st - br
        self.put(self.sfx, st, ins.whoosh(w, 90.0, 2800.0, peak=0.97, pan_from=-0.7, pan_to=0.4, q=1.0, vel=1.0,
                                          seed=1), -4)
        self.put(self.sfx, st, ins.riser(w, 100.0, 4000.0, q=1.2, vel=0.8, seed=3), -10)
        self.put(self.amb, st, ins.rumble(w, lp=120.0, vel=0.8, attack=w * 0.9, release=0.01, seed=3), -2)
        self.put(self.sfx, imp, ins.impact(1.0, 1.5, 9.0, seed=31), -3)
        self.put(self.boom, imp, ins.sub_boom(9.0, 72.0, 24.0, 0.5, 2.5, 0.95, click=0.8, harmonics=0.5, seed=32), -5)
        self.put(self.sfx, imp, ins.noise_burst(9.0, 14000.0, 150.0, 3.0, 1.8, 0.9, seed=33), -5)
        self.put(self.sfx, imp + 0.15, ins.debris(5.0, 40.0, 0.9, seed=34), -3)
        self.put(self.amb, imp, ins.rumble(Mm.start + 0.5 - imp, lp=140.0, vel=0.9, attack=0.05, release=3.5, seed=4), -2)

    def mammals(self):
        """166-172: a soft dawn chord (C add9)."""
        Mm, H = self.B('mammals'), self.B('humans')
        if not self.want(Mm.start, H.start + 2):
            return
        self.sec('mammals')
        self.put(self.strings, Mm.start, ins.strings(['C3', 'G3', 'D4', 'E4', 'G4'], Mm.dur + 0.5, attack=2.5,
                                                     release=2.5, bright=3200, vibrato=9, seed=360), -8)
        self.put(self.organ, Mm.start + 0.5, ins.organ(['C3', 'G3', 'D4', 'E4'], Mm.dur, 'soft', attack=2.5,
                                                       release=2.5, seed=361), -9)
        self.put(self.strings, Mm.start + 2.0, ins.strings(['E5'], Mm.dur - 1.5, attack=2.0, release=2.0, voices=5,
                                                           bright=4500, vibrato=10, seed=362), -15)
        theme_line(self, self.lead, [3, 4], Mm.start + 0.5, (Mm.dur - 0.5) / 8.0,
                   lambda n, d, k: ins.strings([n], d, attack=0.4, release=1.2, voices=4, vibrato=12, bright=4000,
                                               seed=365 + k), -9)

    def humans(self):
        """172-186: solo piano (theme bars 1-2), fire from 'fire'; caves:
        breathy pad and soft taps."""
        H, Cv, fire = self.B('humans'), self.B('caves'), self.cue('fire')
        if not self.want(H.start, Cv.end):
            return
        self.sec('humans')
        for t, note, d in theme_events([1, 2], H.start):
            self.put(self.piano, t, ins.piano(note, dur=d + 0.6, vel=0.42, tone=0.5), 0)
        for dt, chord in ((0.0, ['A2', 'E3', 'A3']), (4.0, ['F2', 'C3', 'A3'])):
            for k, note in enumerate(chord):
                self.put(self.piano, H.start + dt + 0.07 * k, ins.piano(note, dur=4.2, vel=0.3, tone=0.5), -2)
        self.put(self.amb, fire, ins.fire(Cv.end + 1.5 - fire, 0.8, 0.5, seed=1), -8,
                 shape=[(fire, -8), (fire + 2, 0), (Cv.end - 1, 0), (Cv.end + 1.5, -24)])
        # caves
        self.sec('caves')
        self.put(self.pad, Cv.start, ins.breath_pad(['C4', 'E4', 'G4'], 3.0, attack=1.2, release=1.5, vel=0.7, seed=1), 0)
        self.put(self.pad, Cv.start + 3.0, ins.breath_pad(['B3', 'D4', 'G4'], 2.6, attack=1.0, release=1.2, vel=0.7,
                                                          seed=2), 0)
        self.put(self.strings, Cv.start, ins.strings(['C3', 'G3'], 3.0, attack=1.5, release=1.0, bright=1800, seed=370),
                 -12)
        self.put(self.strings, Cv.start + 3.0, ins.strings(['B2', 'G3'], 2.6, attack=1.0, release=0.8, bright=1800,
                                                           seed=371), -12)
        r = rng('taps')
        t = Cv.start + 0.35
        while t < Cv.end - 0.3:
            self.put(self.perc, t, ins.tap(r.uniform(0.25, 0.45), r.uniform(450.0, 900.0), seed=int(t * 100)), -8,
                     pan=float(r.uniform(-0.5, 0.5)))
            t += float(r.choice([0.2, 0.25, 0.5, 0.6, 0.75, 1.0]))

    def ascent(self):
        """186-245: civilization, the launch, night Earth, and the hard cut at
        NOW. The clock accelerates from 60 BPM at accelStart to 140 at the launch (150 at NOW),
        and every age is a scene cut on its card, so the music is phrased to match: pastoral
        plucks and hand drums (farming to writing, with the stylus tapping the clay),
        monumental organ, taiko and choir (the pyramids to printing, the platen's thunk), a
        mechanical string ostinato with anvil clangs, a steam whistle and chuffing (industry,
        flight), then Trinity: a deep thud and a hush, rebuilt by a riser through the countdown.
        The crescendo runs straight into the ignition (no pause), where :meth:`space` takes over
        until night Earth: out of the Moon's stillness the clock comes back from far away, and
        the whole orchestra with it, building from the reflection's A minor to the peak, which
        rushes on into the hard cut at NOW."""
        civ, ml, ne = self.B('civilization'), self.B('moonlanding'), self.B('nightearth')
        a0, now, launch = self.cue('accelStart'), self.cue('now'), self.cue('launch')
        if not self.want(a0, now):
            return
        self.sec('ascent')
        mont = [float(m['t']) for m in self.tl.montage('civilization')]
        writing, pyramids, printing, industry, flight, atom = mont[2], mont[3], mont[5], mont[6], mont[7], mont[8]
        # one chord per age, arriving on the dominant (G) just before the launch resolves to Am
        ages = ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G', 'F', 'G']
        beat = 2 * 60.0 / 140.0              # the theme's quarter at the ignition (see space())
        staging = self.cue('staging')
        plan = [(t, ages[k % len(ages)]) for k, t in enumerate(mont)]
        plan += [(launch, 'Am'), (launch + 4 * beat, 'F')]
        night = [(ne.start + 1.5 * k, CYCLE[k % 4]) for k in range(4)]
        plan += night

        def chord_at(t):
            return [c for tc, c in plan if tc <= t + 1e-6][-1]
        ticks = self.accel_ticks
        span = now - a0
        # a long crescendo, hushed for a moment by the Trinity flash, running straight into the
        # ignition
        cres = [(a0, -12), (pyramids, -7), (industry, -4), (atom - 0.05, -3), (atom + 0.35, -10), (mont[-1], -6),
                (launch - 0.1, -1), (launch + 0.6, 1), (staging - 0.3, 1), (staging + 0.5, -16)]
        # night Earth grows out of the reflection on the Moon (see space()) to the peak at NOW
        nres = [(ne.start - 0.5, -16), (ne.start + 1.5, -8), (ne.start + 4.5, -1), (now, 1)]
        # organ: soft (farming) -> principal (pyramids on) -> full from the launch
        o_steps = [(t, *CORE[ch]) for t, ch in plan]
        self.organ_prog([st for st in o_steps if st[0] < pyramids], pyramids + 0.2, 'soft', attack=0.4, release=0.6,
                        shape=cres, seed=400)
        self.organ_prog([(t, b, u + up(u[-1:])) for t, b, u in o_steps if pyramids <= t < launch], launch, 'principal',
                        attack=0.08, release=0.3, shape=cres, pedal='pedal', seed=410)
        # full organ from the ignition up to the staging, and again at night Earth
        self.organ_prog([(t, b, u + up(u[-1:])) for t, b, u in o_steps if launch <= t < ne.start], staging + 0.3,
                        'full', attack=0.05, release=1.2, shape=cres, pedal='pedal', seed=415)
        self.organ_prog([(t, b, u + up(u[-1:])) for t, b, u in o_steps if t >= ne.start], now + 0.5, 'full',
                        attack=0.4, release=0.4, shape=nres, pedal='pedal', seed=416)
        # sustained strings and choir from Philosophy (the same split)
        for part, end, shp in (([st for st in plan if mont[4] <= st[0] < ne.start], staging + 0.3, cres),
                               (night, now + 0.5, nres)):
            self.string_prog([(t, None, up(CORE[ch][1])) for t, ch in part], end, attack=0.3, release=0.5, shape=shp,
                             gain_db=-5, bright=4200, seed=420)
            c_steps = [(t, up(CORE[ch][1])) for t, ch in part]
            for (t, notes), nxt in zip(c_steps, [st[0] for st in c_steps[1:]] + [end - 0.2]):
                self.put(self.choir, t, ins.choir(notes + [CORE[chord_at(t)][0]], nxt - t, 'a', attack=0.15, release=0.4,
                                                  voices=4, seed=int(t * 10)), -4, shape=shp)

        # farming to writing: pastoral plucked arpeggios (16ths) and hand drums on the clock
        arp_of = {'Am': 'Am', 'F': 'F', 'C': 'C', 'G': 'G/B'}
        for j, t in enumerate(grid(a0 + 0.5, pyramids, 0.25)):
            ch = arp_of[chord_at(t)]
            note = ARP[ch][j % 8]
            u = (t - a0) / (pyramids - a0)
            vel = round((0.42 + 0.2 * u) * (1.0 if j % 4 == 0 else 0.72), 2)
            x = self.cached(('carp', note, vel), lambda: ins.pluck(note, 1.2, vel, bright=0.6, seed=j % 3))
            self.put(self.pluck, t, x, -4, pan=-0.3 if j % 2 else 0.3)
        # ticks: hand drums early, taiko toms later; after space, the clock comes back alone
        # through the dissolve from the Moon, its drums from night Earth on (growing, with a
        # heavier pulse from the second chord)
        full = ne.start + 1.5
        for i, t in enumerate(ticks):
            if ml.start <= t < ne.start:
                continue
            u = (t - a0) / span
            vt = round(min(0.95, 0.3 + 0.6 * u), 2)
            if t < pyramids:
                f = 150.0 if i % 2 else 190.0
                x = self.cached(('hand', f, vt), lambda: ins.drum(f, vt, decay=0.18, drop=0.2, noise=0.3,
                                                                   noise_lp=2500.0, seed=4))
                self.put(self.perc, t, x, -13 + 3 * u, pan=-0.3 if i % 2 else 0.3)
            else:
                f = 95.0 if i % 2 else 120.0
                x = self.cached(('ctom', f, vt), lambda: ins.drum(f, vt, decay=0.3, drop=0.35, noise=0.15,
                                                                   noise_lp=1500.0, seed=2))
                self.put(self.perc, t, x, -10 + 4 * u - 10.0 * max(0.0, (full - t) / 1.5), pan=-0.25 if i % 2 else 0.25)
            if t >= full and i % 2 == 0:
                self.put(self.perc, t, self.cached(('ctaiko', vt), lambda: ins.taiko(vt, 1.0, seed=5)), -6)

        # an accent on every age: taiko (+ low taiko once monumental), boom, brass and string stabs
        for k, t in enumerate(mont):
            ch = ages[k % len(ages)]
            v = 0.7 + 0.3 * k / (len(mont) - 1)
            self.put(self.perc, t, ins.taiko(v, 1.15, seed=10 + k), -2 if t >= pyramids else -6)
            if t >= pyramids:
                self.put(self.perc, t, ins.taiko(v, 1.6, seed=20 + k), -4)
                self.put(self.brass, t, ins.brass(TRIAD[ch], 0.45, attack=0.015, release=0.5, vel=0.9, bright=1.2,
                                                  seed=50 + k), -5 + 0.4 * k)
            self.put(self.boom, t, ins.sub_boom(2.0, 80.0, 42.0, 0.12, 0.45, 0.4 + 0.04 * k, click=0.5, seed=40 + k),
                     -5 if k in (0, 3) else -10)
            self.put(self.strings, t, ins.strings(TRIAD[ch] + up([TRIAD[ch][0]]), 0.28, attack=0.008, release=0.35,
                                                  voices=5, vibrato=0, bright=7500, air=0.0, seed=60 + k), -7 + 0.3 * k)
        # printing onwards: the machine age, a string ostinato interlocking with the clock
        for i in range(len(ticks)):
            t = ticks[i]
            if t < printing:
                continue
            nxt = ticks[i + 1] if i + 1 < len(ticks) else now
            if nxt - t > 1.0 or ml.start <= t < full:
                continue   # the clock's silence in space, and its return
            u = (t - a0) / span
            offs = [0.5, 0.75] if nxt - t > 0.52 else [0.5]
            for h, frac in enumerate(offs):
                tt = t + (nxt - t) * frac
                if tt >= now - 0.02:
                    continue
                note = FIGURE[chord_at(tt)][(2 * i + h + 1) % 4]
                x = self.cached(('ost', note, h), lambda: ins.strings([note], 0.2, attack=0.006, release=0.14, voices=4,
                                                                      vibrato=0, bright=5500, air=0.0, seed=h))
                self.put(self.strings, tt, x, -11 + 7 * u - 3.0 * h)
        # industry and flight: anvil clangs on the off-beats of every other tick
        for i, t in enumerate(ticks):
            if industry <= t < atom and i % 4 == 1:
                x = self.cached(('anvil', i % 3), lambda: ins.bell(['E5', 'B4', 'G5'][i % 3], 0.9, 0.55, 'church',
                                                                   fm=0.8, seed=i % 3))
                self.put(self.mallet, t, x, -9, pan=0.45 if i % 8 == 1 else -0.45)
        # the scenes' own sounds, on their pictures. The civilization is one tracking shot through
        # ten painted tableaux (shots/civilization.ts); the animation in shaders/civ-*.glsl runs on
        # film time, so these follow its formulas.
        # The reed presses into the clay when cos(13 t) = -1 (civ-writing.glsl), every 0.48 s.
        n0 = math.ceil((writing - 0.2) * 13.0 / math.pi / 2.0 - 0.5)
        for k in range(6):
            tt = (2 * (n0 + k) + 1) * math.pi / 13.0
            if writing - 0.15 <= tt <= pyramids - 0.35:
                self.put(self.perc, tt, ins.tap(0.55, 360.0 + 20.0 * (k % 3), seed=k), -9, pan=0.1)
        # The platen of the press comes down when cos(2.2 t) = -1 (civ-mainz.glsl).
        pt = (2 * math.ceil((printing - 0.1) * 2.2 / math.pi / 2.0 - 0.5) + 1) * math.pi / 2.2
        if pt < industry - 0.3:
            self.put(self.perc, pt, ins.drum(88.0, 0.8, decay=0.14, drop=0.1, noise=0.6, noise_lp=1800.0, seed=11), -8,
                     pan=0.45)
        # Each age is wiped in by something passing close to the lens, right to left, just before its
        # card (the atom arrives on its flash instead).
        for k, t in enumerate(mont):
            if k == 0 or k == 8:
                continue
            w = 0.8 - (k - 1) * (0.25 / 8.0)
            seam = t - 0.15
            self.put(self.sfx, seam - w * 0.55, ins.whoosh(w * 0.9, 180.0, 2600.0 + 200.0 * k, 0.55, 0.7, -0.7, vel=0.9,
                                                          seed=90 + k), -12.5 + 0.5 * k)
        self.put(self.sfx, industry + 0.05, ins.steam_whistle(1.3, ('C5', 'E5'), 0.9, seed=1), -11, pan=0.3)
        for i, t in enumerate(ticks):
            if industry <= t < flight:
                for off in (0.0, 0.5):
                    nxt = ticks[i + 1] if i + 1 < len(ticks) else t + 0.5
                    tc = t + (nxt - t) * off
                    self.put(self.perc, tc, self.cached(('chuff', i % 3, off), lambda: ins.chuff(0.8 if off == 0 else 0.55,
                                                                                               seed=i % 3)), -12,
                             pan=0.25 if off else -0.1)
        # the atom: a deep thud; then a riser and a reverse swell into the launch
        self.put(self.boom, atom, ins.sub_boom(4.0, 60.0, 28.0, 0.3, 1.6, 0.8, click=0.6, seed=70), -3)
        self.put(self.sfx, atom, ins.noise_burst(3.0, 10000.0, 300.0, 0.8, 0.6, 0.6, seed=71), -11)
        self.put(self.sfx, atom + 0.5, ins.riser(launch - atom - 0.5, 150.0, 6000.0, q=1.5, vel=0.8, seed=72), -11)
        self.put(self.sfx, launch - 1.5, ins.reverse_swell(1.5, 1.2, 0.9, seed=73), -10)
        self.roll(launch - 2.0, launch - 0.08, 'A2', 0.15, 0.9, gain_db=-4, seed=7)

        # night Earth: brass on every change after the first (the A minor grows out of the Moon's
        # reflection), louder each time, and a riser into the cut
        for k in range(1, 4):
            t = ne.start + 1.5 * k
            ch = CYCLE[k % 4]
            self.put(self.brass, t, ins.brass(TRIAD[ch] + up(TRIAD[ch][:1]), 1.5, attack=0.06, release=0.3, vel=1.0,
                                              bright=1.2, seed=90 + k), [-7, -3, 0][k - 1])
            self.put(self.perc, t, ins.taiko(1.0, 1.4, seed=30 + k), [-8, -5, -2][k - 1])
        self.put(self.sfx, ne.start + 2.0, ins.riser(now - ne.start - 2.0, 200.0, 9000.0, q=1.4, vel=1.0, seed=6), -9)
        self.put(self.sfx, ne.start + 2.0, ins.shepard(now - ne.start - 2.0, 0.4, 1.6, vel=1.0, seed=2), -9)

    def space(self):
        """211.6-239: the space race, 1957 to 1969. The ignition's theme (bars 1-2, its quarter
        half the clock's 140 BPM) carries the R-7 up out of the clouds and across the face of the
        Moon, so that bar 3 lands on the staging, where the roar drops away in slow motion. In orbit
        the clock and the orchestra fall silent; Sputnik's beeps take over, a glass harmonica
        holding bar 4's D over them as the limb pales, and the sunrise (orbitalDawn) breaks in C
        major with bar 5 as the camera swings round the blazing satellite; bar 6's high A arrives
        with the Moon. The descent: a low pulse, Houston's Quindar tones, the engine and the dust,
        all rising until eagleLands, where the engine stops and the tension opens into F major 7,
        which sinks to a hush under Armstrong's own voice (tranquilityBase, NASA's recording). Then
        the reflection (cue reflection): the theme's first two bars on a far piano, slow, over
        Fmaj7 and G6, as the camera looks up from the lander to the Earth; their last note, A,
        becomes the A minor of night Earth."""
        launch, clouds, staging = self.cue('launch'), self.cue('clouds'), self.cue('staging')
        sput, dawn, lands = self.cue('sputnik'), self.cue('orbitalDawn'), self.cue('eagleLands')
        call, rf = self.cue('tranquilityBase'), self.cue('reflection')
        ml, ne = self.B('moonlanding'), self.B('nightearth')
        if not self.want(launch, ne.start):
            return
        self.sec('ascent')
        q = 2 * 60.0 / 140.0
        on_frame = lambda t: round(t * 24) / 24  # noqa: E731
        # the picture's cuts (shots/ascent.ts, shots/sputnik.ts)
        lens = on_frame(clouds + 1.05)          # to the long lens on the Moon
        chase = on_frame(staging - 1.6)         # to the chase camera
        crossing = chase - 0.45                 # the rocket crosses the Moon
        orbit = sput - 1.7                      # the dissolve into orbit
        fairing = sput - 0.75
        b3 = launch + 8 * q                     # bar 3: the staging
        b6 = dawn + 4 * q                       # bar 6: the Moon

        # ---- ignition and ascent
        self.put(self.boom, launch, ins.sub_boom(7.0, 55.0, 24.0, 0.6, 2.8, 0.9, click=0.6, harmonics=0.5, seed=74), -3)
        self.put(self.perc, launch, ins.timpani('A2', 1.0, seed=8), -1)
        # The roar: close at the pad and over the clouds, distant under the long lens, close again
        # in the chase; at the staging it falls away (slow motion, thin air) and dies before orbit.
        roar = [(launch, -14), (launch + 1.0, 0), (lens - 0.02, 0), (lens + 0.06, -13), (chase - 0.02, -13),
                (chase + 0.06, 1), (staging - 0.05, 2), (staging + 0.45, -16), (orbit, -45)]
        self.put(self.amb, launch, ins.rumble(orbit + 0.5 - launch, lp=140.0, vel=0.95, attack=0.8, release=0.4, seed=8),
                 -4, shape=roar)
        self.put(self.sfx, launch, ins.noise_burst(orbit + 0.5 - launch, 9000.0, 400.0, 3.0, 3.0, 0.7, seed=75), -12,
                 shape=roar)
        tdyn = [(launch, -2), (launch + 1.0, 0), (lens, -3), (chase, 1), (b3, 0)]
        theme_line(self, self.brass, [1, 2], launch, q,
                   lambda n, d, k: ins.brass([up([n], -1)[0], n], d, attack=0.05, release=0.35, vel=1.0, bright=1.1,
                                             seed=330 + k), -1, shape=tdyn)
        theme_line(self, self.lead, [1, 2], launch, q,
                   lambda n, d, k: ins.strings([n, up([n])[0]], d, attack=0.08, release=0.5, voices=7, vibrato=16,
                                               bright=6000, seed=340 + k), -3, shape=tdyn)
        # the rocket crosses the face of the Moon: a glint of bells
        self.put(self.bells, crossing - 0.15, ins.shimmer(2.5, 'E6', 10.0, 3.0, 7, 0.45, seed=91), -8)

        # ---- the staging (the Korolev cross), in slow motion
        self.put(self.sfx, staging - 1.0, ins.reverse_swell(1.0, 1.1, 0.9, seed=92), -9)
        self.put(self.perc, staging, ins.timpani('C3', 1.0, seed=93), -2)
        self.put(self.boom, staging, ins.sub_boom(4.0, 90.0, 35.0, 0.25, 1.4, 0.8, click=0.9, seed=94), -5)
        self.put(self.brass, staging, ins.brass(['C3', 'G3', 'C4', 'E4'], 0.5, attack=0.02, release=0.9, vel=1.0,
                                                bright=1.2, seed=95), -4)
        # bar 3 floats over the slow motion, high violins alone, the choir under them
        theme_line(self, self.lead, [3], b3, q,
                   lambda n, d, k: ins.strings([up([n])[0]], d, attack=0.35, release=1.2, voices=6, vibrato=10,
                                               bright=5000, seed=350 + k), -8)
        self.put(self.choir, staging, ins.choir(['C4', 'E4', 'G4', 'C5'], orbit + 1.5 - staging, 'u', attack=0.6,
                                                release=1.5, voices=4, seed=96), -9)
        # the core stage flies past the camera
        self.put(self.sfx, staging + 1.15, ins.whoosh(1.2, 150.0, 2400.0, 0.55, -0.7, 0.8, vel=0.8, seed=97), -11)

        # ---- orbit: silence; the fairing's thump; Sputnik's beeps, 0.3 s every 0.6 s
        self.put(self.perc, fairing, ins.drum(70.0, 0.6, decay=0.25, drop=0.2, noise=0.4, noise_lp=1200.0, seed=98), -14)
        k = 0
        while sput + 0.6 * k < ml.start + 0.6:
            self.put(self.sfx, sput + 0.6 * k, self.cached(('beep',), lambda: beep()), -15,
                     shape=[(ml.start - 0.8, 0), (ml.start + 0.4, -40)])
            k += 1
        # bar 4's D held by a glass harmonica over the beeps as the limb pales; the dawn builds
        self.put(self.glass, sput + 0.2, ins.glass('D6', dawn - sput + 0.4, attack=1.2, release=0.8, vel=0.5, seed=99), -6)
        self.put(self.strings, orbit + 0.8, ins.strings(['G2', 'D3', 'G3', 'C4', 'D4'], dawn - orbit - 0.6, attack=2.5,
                                                        release=0.8, voices=6, vibrato=6, bright=2400, seed=100), -10,
                 shape=[(orbit + 0.8, -18), (dawn - 0.3, 0)])
        self.put(self.sfx, dawn - 2.0, ins.riser(2.0, 300.0, 7000.0, q=1.8, vel=0.7, seed=101), -14)
        self.put(self.sfx, dawn - 1.2, ins.reverse_swell(1.2, 1.3, 1.0, seed=102), -9)
        self.roll(dawn - 0.9, dawn - 0.04, 'C3', 0.1, 0.8, gain_db=-4, seed=103)

        # ---- the sunrise: C major, bar 5 as the camera swings round Sputnik; the Moon on bar 6
        self.put(self.choir, dawn, ins.choir(['C3', 'G3', 'C4', 'E4', 'G4'], b6 - dawn + 0.3, 'a', attack=0.15,
                                             release=1.4, voices=5, seed=104), -3)
        self.put(self.choir, b6, ins.choir(['F3', 'C4', 'F4', 'A4', 'C5'], 2.4, 'a', attack=0.4, release=1.2, voices=5,
                                           seed=105), -5, shape=[(b6, 0), (b6 + 1.2, -3), (b6 + 3.0, -20)])
        fade = [(dawn, 0), (b6, 0), (b6 + 1.3, -4), (b6 + 2.8, -20)]
        self.string_prog([(dawn, 'C2', ['G3', 'C4', 'E4', 'G4']), (b6, 'F2', ['A3', 'C4', 'F4', 'A4'])], b6 + 2.6,
                         attack=0.1, release=1.2, gain_db=-3, bright=5000, seed=106, shape=fade)
        self.organ_prog([(dawn, 'C2', ['G3', 'C4', 'E4', 'C5']), (b6, 'F2', ['A3', 'C4', 'F4', 'C5'])], b6 + 2.4, 'full',
                        attack=0.08, release=1.0, gain_db=-4, pedal='pedal', seed=107, shape=fade)
        self.put(self.perc, dawn, ins.timpani('C3', 1.0, seed=108), -2)
        self.put(self.boom, dawn, ins.sub_boom(5.0, 70.0, 30.0, 0.3, 2.0, 0.7, click=0.2, seed=109), -6)
        self.put(self.bells, dawn, ins.shimmer(4.0, 'G6', 12.0, 5.0, 9, 0.5, seed=110), -6)
        sdyn = [(dawn, 0), (b6, 1), (b6 + 1.4, -3), (b6 + 3.2, -18)]
        theme_line(self, self.brass, [5, 6], dawn, q,
                   lambda n, d, k: ins.brass([up([n], -1)[0], n], d, attack=0.08, release=0.6, vel=0.95, bright=1.0,
                                             seed=360 + k), -2, shape=sdyn)
        theme_line(self, self.lead, [5, 6], dawn, q,
                   lambda n, d, k: ins.strings([n, up([n])[0]], d, attack=0.12, release=0.8, voices=7, vibrato=15,
                                               bright=6000, seed=370 + k), -3, shape=sdyn)
        # the crossing to the Moon: a deep breath of air
        self.put(self.sfx, ml.start - 0.9, ins.whoosh(1.8, 90.0, 900.0, 0.5, 0.0, 0.0, vel=0.7, seed=111), -12)

        # ---- the descent: a pulse on the quarter, the radio, the engine and the dust, rising to
        # eagleLands, where the engine stops and the tension opens into a chord
        d0 = b6 + 2.0
        for i in range(int((lands - d0) / q) + 1):
            t = d0 + i * q
            if t >= lands - 0.05:
                break
            u = (t - d0) / (lands - d0)
            self.put(self.perc, t, self.cached(('pulse', i % 2), lambda: ins.timpani('A2', 0.7, decay=0.5, seed=112 + i % 2)),
                     -10 + 9 * u)
            self.put(self.strings, t, self.cached(('pizz',), lambda: ins.strings(['A2', 'A3'], 0.35, attack=0.01, release=0.25,
                                                                                 voices=5, vibrato=0, bright=3000, seed=114)),
                     -13 + 8 * u)
        self.put(self.strings, d0, ins.strings(['E4', 'F4', 'A4', 'B4'], lands - d0, attack=2.0, release=0.5, voices=6,
                                               vibrato=8, bright=3500, seed=115), -9, shape=[(d0, -20), (lands - 0.1, 0)])
        self.put(self.brass, lands - 1.8, ins.brass(['A2', 'E3', 'A3'], 1.8, attack=1.6, release=0.7, vel=0.9, bright=0.9,
                                                    growl=0.3, seed=127), -6)
        self.put(self.amb, d0, ins.rumble(lands - d0, lp=200.0, vel=0.8, attack=1.5, release=0.4, seed=116), -5,
                 shape=[(d0, -16), (lands - 0.05, 0)])
        self.put(self.sfx, lands - 2.6, ins.riser(2.6, 200.0, 6000.0, q=1.6, vel=0.9, seed=126), -9)
        dust0 = lands - 2.3
        self.put(self.sfx, dust0, ins.noise_burst(lands - dust0 + 0.35, 7000.0, 2500.0, 2.0, 5.0, 0.5, seed=117), -13,
                 shape=[(dust0, -24), (lands - 0.05, 0), (lands + 0.3, -30)])
        for a, b in ((d0 + 0.25, d0 + 0.95), (lands - 1.3, lands - 0.65)):
            self.put(self.sfx, a, self.cached(('quindar', 0), lambda: quindar(2525.0)), -16)
            self.put(self.sfx, b, self.cached(('quindar', 1), lambda: quindar(2475.0)), -16)

        # ---- touchdown: the engine stops and the tension opens into F major 7 (the chord the
        # reflection will begin on), a breath of choir and low horns; it sinks to a hush under
        # Armstrong's call from the Moon (cue tranquilityBase), and the reflection (cue reflection)
        # takes it up: the theme's first two bars, slow, on a far piano, the camera looking up from
        # the lander to the Earth; bar 2 comes with the Earth, over G6, and its last note (A) is the
        # root of night Earth's A minor
        settle = lands + math.sqrt(1 / 1.62) / 2.2       # the lander drops onto its pads (apollo.ts)
        rq = (ne.start - rf) / 8.0
        b2 = rf + 4 * rq
        self.put(self.boom, lands, ins.sub_boom(3.0, 50.0, 30.0, 0.25, 1.4, 0.45, click=0.0, seed=118), -11)
        self.put(self.boom, settle, ins.sub_boom(1.4, 58.0, 36.0, 0.05, 0.4, 0.3, click=0.15, seed=119), -15)
        self.string_prog([(lands, 'F2', ['C3', 'A3', 'E4']), (b2, 'G2', ['D3', 'B3', 'E4'])], ne.start + 0.5,
                         attack=0.3, release=1.2, gain_db=-5, bright=3000, voices=6, vibrato=7, seed=121,
                         shape=[(lands, -1), (lands + 0.35, 0), (lands + 1.6, -11), (call + 1.0, -17), (rf - 0.4, -17),
                                (rf + 1.2, -9), (b2, -7), (ne.start, -5)])
        self.put(self.choir, lands, ins.choir(['F3', 'A3', 'C4', 'E4'], 1.6, 'a', attack=0.35, release=1.8, voices=4,
                                              seed=124), -9)
        self.put(self.brass, lands + 0.05, ins.brass(['F2', 'C3', 'A3'], 1.1, attack=0.3, release=1.6, vel=0.6, bright=0.7,
                                                     seed=125), -10)
        # Armstrong, as Houston heard him: the Quindar tone that ended Houston's "We copy you down,
        # Eagle", then his words; the loop's squelch closes after them
        self.put(self.sfx, call, self.cached(('armstrong',), armstrong), -5)
        self.put(self.sfx, call + 4.9, squelch(seed=2), -10)
        vels = [0.45, 0.38, 0.42, 0.46, 0.4]
        theme_line(self, self.piano_far, [1, 2], rf, rq,
                   lambda n, d, k: ins.piano(n, d + 1.4, vel=vels[k], tone=0.6, seed=120 + k), -5)
        self.put(self.choir, b2, ins.choir(['G3', 'B3', 'E4'], ne.start - b2 + 0.8, 'u', attack=1.6, release=1.0,
                                           voices=4, seed=122), -13, shape=[(b2, -12), (ne.start, 0)])
        # the E held high over it all (the pedal of the core progression), as the Earth appears
        self.put(self.glass, b2 - 0.5, ins.glass('E6', ne.start - b2 + 1.6, attack=1.5, release=1.0, vel=0.4,
                                                 seed=123), -11)

    def now(self):
        """NOW: silence after the hard cut; single piano notes with long reverb at
        blueDot (A4) and 3 s later (E5)."""
        bd, T = self.cue('blueDot'), self.B('turn')
        if not self.want(bd, T.start):
            return
        self.sec('now')
        self.put(self.piano_far, bd, ins.piano('A4', dur=7.0, vel=0.42, tone=0.6), 0)
        self.put(self.piano_far, bd + 3.0, ins.piano('E5', dur=6.0, vel=0.38, tone=0.6), -1)

    def future(self):
        """Mars and drift: hopeful Lydian A major, slow arpeggios and the theme turned
        major; hot Earth: warm drone with a creeping b6."""
        Ma, Dr, He, R = self.B('mars'), self.B('drift'), self.B('hotearth'), self.B('redgiant')
        if not self.want(Ma.start, R.start):
            return
        self.sec('future')
        s = Ma.start
        steps = [(s, 'A2', ['E3', 'B3', 'C#4', 'E4']), (s + 4, 'A2', ['F#3', 'B3', 'D#4', 'F#4']),
                 (Dr.start, 'D3', ['F#3', 'A3', 'C#4', 'E4']), (Dr.start + 3, 'E2', ['B3', 'E4', 'A4'])]
        self.organ_prog(steps, He.start + 0.5, 'celeste', attack=2.0, release=2.0, gain_db=-5, trem=0.25,
                        shape=[(s, -4), (s + 3, 0), (Dr.end - 1, -2)], seed=500)
        self.string_prog([(t, None, up(u)) for t, b, u in steps], He.start + 0.5, attack=2.0, release=2.0, gain_db=-10,
                         bright=4200, vibrato=10, seed=510)
        arps = {0: ['A3', 'E4', 'B4', 'C#5', 'E5', 'C#5', 'B4', 'E4'], 1: ['A3', 'F#4', 'B4', 'D#5', 'F#5', 'D#5', 'B4', 'F#4'],
                2: ['D4', 'A4', 'C#5', 'E5', 'F#5', 'E5', 'C#5', 'A4'], 3: ['E4', 'B4', 'E5', 'A5', 'B5', 'A5', 'E5', 'B4']}
        bounds = [st[0] for st in steps] + [He.start]
        for k in range(4):   # harp-like arpeggio a 16th off the clock, interlocking with the ticks
            for j, t in enumerate(grid(bounds[k] + 0.25, bounds[k + 1], 0.5)):
                note = arps[k][j % 8]
                self.put(self.pluck, t, ins.pluck(note, 2.5, 0.5 if j % 4 == 0 else 0.38, bright=0.35, decay=3.5,
                                                  seed=j), -3, pan=0.3 * math.sin(j * 1.3))
            self.put(self.bells, bounds[k], ins.bell(up([arps[k][4]])[0], 5.0, 0.35, 'glass', seed=520 + k), -6,
                     pan=0.4 if k % 2 else -0.4)
        # the theme, now in A major with a Lydian D sharp: bars 1-2 over the first two chords
        lyd = {'C5': 'C#5', 'D5': 'D#5', 'C4': 'C#4', 'G4': 'G#4'}
        theme_line(self, self.lead, [1, 2], s, (Dr.start - s) / 8.0,
                   lambda n, d, k: ins.strings([lyd.get(n, n)], d, attack=0.35, release=1.2, voices=5, vibrato=12,
                                               bright=4600, seed=540 + k), -5)
        # hot Earth
        self.put(self.organ, He.start - 0.5, ins.organ(['A2', 'E3'], He.dur + 1.0, 'drone', attack=2.0, release=1.5,
                                                       seed=530), -5)
        self.put(self.strings, He.start, ins.strings(['A2', 'E3', 'A3', 'E4'], He.dur + 0.3, attack=2.0, release=1.0,
                                                     bright=1800, vibrato=8, seed=540), -6)
        self.put(self.strings, He.start + 1.0, ins.strings(['F4'], He.dur - 0.7, attack=He.dur * 0.7, release=1.0,
                                                           voices=5, bright=2500, vibrato=14, seed=541), -8)
        self.put(self.strings, He.start + 3.0, ins.strings(['C5'], He.dur - 2.7, attack=2.5, release=1.0, voices=5,
                                                           bright=2500, vibrato=14, seed=542), -12)
        self.put(self.amb, He.start, ins.rumble(He.dur + 2.0, lp=260.0, vel=0.5, attack=2.5, release=2.0, seed=5), -12)

    def redgiant(self):
        """Red giant: huge, heavy, dark: low brass and organ pedal, swell from
        redGiantSwell; white dwarf: crystalline bells, soft pad."""
        R, W, sw = self.B('redgiant'), self.B('whitedwarf'), self.cue('redGiantSwell')
        if not self.want(R.start, W.end):
            return
        self.sec('redgiant')
        swell = [(sw, -12), (sw + 5.0, 0), (R.end - 1.6, -2), (R.end, -15), (R.end + 0.8, -40)]
        steps = [(sw, 'A2', ['A2', 'E3', 'F3', 'C4']), (R.start + 4, 'A2', ['F2', 'C3', 'F3', 'A3', 'C4']),
                 (R.start + 6, 'A2', ['Bb2', 'D3', 'F3', 'Bb3'])]
        self.organ_prog(steps, R.end + 0.3, 'grand', attack=0.4, release=1.2, gain_db=0, shape=swell, pedal='pedal',
                        seed=600)
        for (t, b, u), nxt, br in zip(steps, [s[0] for s in steps[1:]] + [R.end + 0.3],
                                      (['A1', 'E2', 'A2'], ['F1', 'C2', 'F2'], ['Bb1', 'F2', 'Bb2'])):
            self.put(self.brass, t, ins.brass(br, nxt - t, attack=1.2 if t == sw else 0.3, release=0.8, vel=0.9,
                                              bright=0.55, growl=0.8, seed=int(t)), 2, shape=swell)
        self.put(self.choir, sw + 0.5, ins.choir(['A2', 'E3', 'F3', 'C4'], R.dur - 1.0, 'o', attack=3.0, release=1.5,
                                                 seed=610), -2, shape=swell)
        for k, v in enumerate((1.0, 0.7, 0.95, 0.75)):
            self.put(self.perc, sw + 2.0 * k, ins.taiko(v, 1.5, seed=40 + k), -1)
        self.put(self.boom, sw, ins.sub_boom(R.dur, 60.0, 25.0, 0.6, 2.5, 0.7, click=0.2, seed=90), -3)
        self.put(self.amb, sw, ins.rumble(R.dur + 0.3, lp=160.0, vel=0.6, attack=3.0, release=1.5, seed=6), -6)
        # white dwarf
        self.sec('whitedwarf')
        r = rng('dwarf')
        pool = ['A5', 'B5', 'C6', 'E6', 'A6', 'B6']
        for k, t in enumerate(grid(W.start + 0.2, W.end - 1.0, 0.6)):
            self.put(self.bells, t, ins.bell(pool[int(r.integers(len(pool)))], 4.0, 0.5 - 0.03 * k, 'crystal',
                                             fm=0.3, seed=620 + k), -2, pan=float(r.uniform(-0.6, 0.6)))
        self.put(self.strings, W.start, ins.strings(['A4', 'E5', 'B5'], W.dur, attack=2.0, release=2.0, voices=5,
                                                    bright=5000, vibrato=8, seed=630), -14)
        self.put(self.glass, W.start + 0.5, ins.glass('E6', W.dur - 1.0, attack=1.0, release=2.0, vel=0.4, seed=5), -4)

    def merger(self):
        """Merger: the last grand swell: sweeping strings and choir; the violins
        sing theme bars 5-6."""
        Mg = self.B('merger')
        if not self.want(Mg.start, Mg.end):
            return
        self.sec('merger')
        s = Mg.start
        dyn = [(s, -5), (s + 4.5, 0), (Mg.end - 1.0, -2), (Mg.end + 0.5, -10)]
        steps = [(s, 'F2', ['A3', 'C4', 'E4']), (s + 4, 'C3', ['G3', 'C4', 'E4']), (s + 6, 'B2', ['G3', 'B3', 'D4'])]
        self.organ_prog(steps, Mg.end + 0.5, 'principal', attack=0.4, release=1.5, gain_db=-1, shape=dyn, pedal='pedal',
                        seed=700)
        self.string_prog([(t, b, up(u)) for t, b, u in steps], Mg.end + 0.5, attack=1.2, release=1.8, shape=dyn,
                         gain_db=-2, bright=4800, seed=710)
        for t, note, d in theme_events([5, 6], s, 1.0):
            self.put(self.lead, t, ins.strings([note, up([note], -1)[0]], d + 0.2, attack=0.35, release=1.0, voices=6,
                                               vibrato=16, bright=4500, seed=720), -1, shape=dyn)
        self.put(self.choir, s, ins.choir(['F3', 'A3', 'C4', 'E4', 'A4'], 4.0, 'a', attack=1.0, release=1.2, seed=730),
                 0, shape=dyn)
        self.put(self.choir, s + 4.0, ins.choir(['E3', 'G3', 'C4', 'E4', 'G4'], 2.0, 'a', attack=0.5, release=1.0,
                                                seed=731), 0, shape=dyn)
        self.put(self.choir, s + 6.0, ins.choir(['D3', 'G3', 'B3', 'D4', 'G4'], 2.0, 'a', attack=0.5, release=2.0,
                                                seed=732), 0, shape=dyn)
        self.put(self.brass, s, ins.brass(['F2', 'C3', 'A3', 'C4'], 3.9, attack=0.6, release=0.8, vel=0.7, bright=0.7,
                                          seed=11), -5, shape=dyn)
        self.roll(s - 1.6, s - 0.03, 'C3', 0.1, 0.8, gain_db=-4, seed=5)
        self.put(self.sfx, s - 1.5, ins.reverse_swell(1.5, 1.0, 0.8, seed=6), -12)
        self.put(self.boom, s, ins.sub_boom(6.0, 70.0, 28.0, 0.4, 2.0, 0.6, click=0.3, seed=95), -4)
        self.put(self.perc, s, ins.timpani('F2', 1.0, seed=6), -2)

    def ending(self):
        """The last stars (descending bells per starDeaths), black holes (sub
        drone, eerie choir), evaporation (shimmer, lastFlash), heat death
        (near silence)."""
        Ls, Bh, Ev, Hd = self.B('laststars'), self.B('blackholes'), self.B('evaporation'), self.B('heatdeath')
        lf = self.cue('lastFlash')
        if not self.want(Ls.start, Hd.end):
            return
        self.sec('laststars')
        thin = [(Ls.start, -3), (Ls.end, -16)]
        self.put(self.strings, Ls.start, ins.strings(['A3', 'C4', 'E4'], Ls.dur, attack=1.0, release=3.0, voices=4,
                                                     bright=3000, vibrato=8, seed=800), -6, shape=thin)
        self.put(self.organ, Ls.start, ins.organ(['A2', 'A3', 'C4', 'E4'], Ls.dur, 'soft', attack=0.8, release=3.0,
                                                 seed=801), -5, shape=thin)
        deaths = self.tl.times('starDeaths')
        notes = sorted(theory.scale('A', 'pentatonic_minor', 'A4', 'E6'), reverse=True)[:len(deaths)]
        for k, (t, m) in enumerate(zip(deaths, notes)):
            v = 0.72 - 0.35 * k / max(1, len(deaths) - 1)
            self.put(self.bells, t, ins.bell(m, 6.0, v, 'glass', glide=1.0, fm=0.3, seed=810 + k), 0,
                     pan=0.5 * math.sin(k * 2.1))
        # black holes
        self.sec('blackholes')
        self.put(self.boom, Bh.start - 1.0, ins.drone(['A0', 'A1'], Bh.dur + 1.0, attack=3.0, release=2.5, beat=0.21,
                                                     vel=1.0), -2)
        self.put(self.choir, Bh.start, ins.choir(['A2', 'Bb2', 'E3'], Bh.dur, 'u', attack=3.0, release=3.0, voices=4,
                                                 detune=30.0, drift=22.0, vibrato=6.0, seed=820), -6)
        # evaporation
        self.sec('evaporation')
        self.put(self.glass, Ev.start, ins.shimmer(lf - Ev.start + 0.4, 'A6', 10.0, 7.0, 9, 0.5, seed=6), -4)
        for k, note in enumerate(('A6', 'E6', 'A5')):
            self.put(self.bells, lf + 0.03 * k, ins.bell(note, 6.0, 0.8, 'glass', fm=0.5, seed=830 + k), 0,
                     pan=[-0.3, 0.3, 0.0][k])
        self.put(self.choir, lf, ins.choir(['A4', 'E5', 'A5'], 0.8, 'a', attack=0.02, release=3.5, voices=4, seed=840), 0)
        self.put(self.boom, lf, ins.sub_boom(5.0, 65.0, 30.0, 0.3, 1.8, 0.45, click=0.3, seed=96), -4)
        self.put(self.sfx, lf, ins.noise_burst(3.0, 12000.0, 3000.0, 0.8, 0.6, 0.25, seed=97), -12)

    def epilogue(self):
        """Epilogue: soft organ Am returns, strings enter, theme bars 1-3 on piano
        leading into the Picardy A major at picardy; fade at finalTitle; the
        final tick is in clock_part."""
        Ep, pc, ft = self.B('epilogue'), self.cue('picardy'), self.cue('finalTitle')
        fin = self.cue('finalTick')
        if not self.want(Ep.start, Ep.end):
            return
        self.sec('epilogue')
        ts = pc - 12.0                          # theme bars 1-3 end exactly on the Picardy chord
        fade = [(pc, 0), (ft, -1.5), (fin - 0.3, -30), (Ep.end, -60)]
        steps = [(Ep.start, 'A2', ['A3', 'C4', 'E4']), (ts + 4, 'F2', ['A3', 'C4', 'E4']), (ts + 8, 'C3', ['G3', 'C4', 'E4']),
                 (ts + 10, 'G2', ['G3', 'B3', 'D4']), (pc, 'A2', ['A3', 'C#4', 'E4'])]
        self.organ_prog(steps, ft + 2.0, 'soft', attack=2.5, release=2.5, gain_db=-5,
                        shape=[(Ep.start, -12), (ts + 8, -7), (pc - 0.5, -4), (pc + 1, 0)] + fade[1:], seed=900)
        self.put(self.organ, pc, ins.organ(['A2', 'E3', 'A3', 'C#4', 'E4', 'A4'], ft - pc + 2.0, 'principal', attack=0.8,
                                           release=2.5, seed=901), -3, shape=fade)
        s_steps = [(ts + 4, 'F2', ['A4', 'C5', 'E5']), (ts + 8, 'C3', ['G4', 'C5', 'E5']),
                   (ts + 10, 'G2', ['G4', 'B4', 'D5']), (pc, 'A2', ['A4', 'C#5', 'E5'])]
        self.string_prog(s_steps, ft + 2.0, attack=2.0, release=2.5, gain_db=-5,
                         shape=[(ts + 4, -14), (pc - 0.5, -7), (pc + 1.5, 0)] + fade[1:], bright=5000, seed=910)
        self.put(self.strings, pc, ins.strings(['E3', 'A3', 'C#4', 'A5', 'C#6'], ft - pc + 2.0, attack=1.5, release=2.5,
                                               bright=5500, seed=911), -3, shape=fade)
        self.put(self.choir, ts + 10, ins.choir(['G3', 'B3', 'D4', 'G4'], 2.0, 'a', attack=1.5, release=0.8, seed=920),
                 -9)
        self.put(self.choir, pc, ins.choir(['A3', 'C#4', 'E4', 'A4', 'C#5', 'E5'], ft - pc + 1.5, 'a', attack=1.0,
                                           release=2.5, seed=921), 2, shape=fade)
        self.put(self.sfx, pc - 1.5, ins.reverse_swell(1.5, 0.7, 0.6, seed=7), -16)
        # the theme on piano: bars 1-3, then bar 4's D5 arrives on the Picardy chord and resolves to C#5
        for t, note, d in theme_events([1, 2, 3], ts):
            self.put(self.piano, t, ins.piano(note, dur=d + 0.5, vel=0.42, tone=0.55), 0)
        self.put(self.piano, pc, ins.piano('D5', dur=2.4, vel=0.45, tone=0.55), 0)
        self.put(self.piano, pc + 2.0, ins.piano('C#5', dur=ft - pc + 0.5, vel=0.4, tone=0.55), 0, shape=fade)
        lh = [(ts, ['A2', 'E3']), (ts + 4, ['F2', 'C3']), (ts + 8, ['C3', 'G3']), (ts + 10, ['G2', 'D3']),
              (pc, ['A2', 'E3', 'A3'])]
        for t, chord in lh:
            for k, note in enumerate(chord):
                d = 4.2 if t < pc else ft - pc + 1.0
                self.put(self.piano, t + 0.06 * k, ins.piano(note, dur=d, vel=0.3, tone=0.5), -2,
                         shape=fade if t >= pc else None)

    # -- run --------------------------------------------------------------------------
    def compose(self):
        for part in (self.clock_part, self.prologue, self.bigbang, self.universe, self.darkages, self.firststars,
                     self.galaxies, self.milkyway, self.solar, self.moon, self.oceans, self.life, self.snowball,
                     self.cambrian, self.dinosaurs, self.impact, self.mammals, self.humans, self.ascent, self.space, self.now,
                     self.future, self.redgiant, self.merger, self.ending, self.epilogue):
            t = time.time()
            part()
            self.log(f'  composed {part.__name__:<11} ({time.time() - t:5.2f}s)')


# ----------------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------------

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--out', default=None, help=f'output WAV (default {DEFAULT_OUT.relative_to(ROOT)})')
    ap.add_argument('--from', dest='t0', type=float, default=0.0, help='start time (s) for a partial render')
    ap.add_argument('--to', dest='t1', type=float, default=None, help='end time (s) for a partial render')
    ap.add_argument('--stems', default=None, help='directory for pre-master float32 stems (one per track/bus)')
    ap.add_argument('--timeline', default=str(HERE / 'timeline.json'))
    ap.add_argument('--bits', type=int, default=24, choices=(24, 32))
    ap.add_argument('--lufs', type=float, default=-14.0)
    ap.add_argument('--tp', type=float, default=-1.0)
    ap.add_argument('--spectrogram', default=None, help='also write a spectrogram PNG here')
    args = ap.parse_args(argv)

    tl = Timeline.load(args.timeline)
    partial = args.t0 > 0 or (args.t1 is not None and args.t1 < tl.duration)
    t1 = tl.duration if args.t1 is None else min(args.t1, tl.duration)
    out = Path(args.out) if args.out else (DEFAULT_OUT if not partial else
                                           DEFAULT_OUT.with_name(f'score-{args.t0:g}-{t1:g}.wav'))
    report_path = out.with_suffix('.json')
    full_report = DEFAULT_OUT.with_suffix('.json')
    T0 = time.time()
    print(f'[score] {tl.data.get("title", PROJECT)}: rendering {args.t0:.2f}-{t1:.2f}s of {tl.duration:.2f}s')
    sc = Score(tl, args.t0, t1)
    sc.compose()
    print(f'[score] composed in {time.time() - T0:.1f}s; mixing')
    y = sc.mix.render(args.t0, t1, stems_dir=args.stems)
    if t1 >= tl.duration:
        # the film ends: let the last reverb tail (after finalTick) fade to exact silence
        k = min(y.shape[-1], ns(END_FADE))
        y[:, -k:] *= (0.5 + 0.5 * np.cos(np.linspace(0.0, math.pi, k))).astype(F32)
    print(f'[score] mixed in {time.time() - T0:.1f}s; mastering')
    if not np.all(np.isfinite(y)):
        raise SystemExit('non-finite samples in mix')
    prev = None
    if partial and full_report.exists():
        try:
            prev = json.loads(full_report.read_text())['master']
        except (OSError, ValueError, KeyError):
            prev = None
    if prev and 'gain_db' in prev:
        # partial preview: same glue threshold and make-up gain as the full mix
        y, rep = master.master_fixed(y, prev['gain_db'], prev.get('glue_threshold'), args.tp)
    else:
        y, rep = master.master(y, args.lufs, args.tp)
    expected = ns(t1 - args.t0)
    if y.shape[-1] != expected:
        raise SystemExit(f'length mismatch: {y.shape[-1]} != {expected}')
    wav.write_wav(str(out), y, SR, bits=args.bits)
    summ = analysis.summary(y)
    report = {'file': str(out), 'from': args.t0, 'to': t1, 'master': rep, 'summary': summ,
              'ticks': sc.tick_count, 'render_seconds': time.time() - T0}
    report_path.write_text(json.dumps(report, indent=2))
    if args.spectrogram:
        marks = [(b.start - args.t0, b.id) for b in tl.beats if args.t0 <= b.start < t1]
        analysis.spectrogram_png(y, args.spectrogram, marks=marks, title=f'{tl.data.get("title", "")} score')
    print(f'[score] wrote {out} ({summ["duration_s"]:.3f}s, {summ["lufs_integrated"]:.2f} LUFS, '
          f'{summ["true_peak_dbtp"]:.2f} dBTP) in {time.time() - T0:.1f}s')
    return 0


if __name__ == '__main__':
    sys.exit(main())
