"""Music theory helpers: note names, frequencies, scales, chords, voicings and
voice leading.

Notes may be given as names (``'A4'``, ``'C#5'``, ``'Eb3'``, ``'B♭2'``) or MIDI
numbers (``69``). ``A4 = 440 Hz`` by default.
"""
from __future__ import annotations

import itertools
import math
import re
from typing import Iterable, Sequence

A4 = 440.0

_PC = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
_NOTE_RE = re.compile(r'^\s*([A-Ga-g])([#♯b♭]*)(-?\d+)?\s*$')


def midi(note) -> float:
    """MIDI number of a note name or number. Octave defaults to 4."""
    if isinstance(note, (int, float)):
        return float(note)
    m = _NOTE_RE.match(str(note))
    if not m:
        raise ValueError(f'bad note name {note!r}')
    letter, acc, octv = m.groups()
    pc = _PC[letter.upper()] + acc.count('#') + acc.count('♯') - acc.count('b') - acc.count('♭')
    o = int(octv) if octv is not None else 4
    return float(12 * (o + 1) + pc)


def midi_to_hz(m: float, a4: float = A4) -> float:
    return a4 * 2.0 ** ((float(m) - 69.0) / 12.0)


def hz_to_midi(f: float, a4: float = A4) -> float:
    return 69.0 + 12.0 * math.log2(f / a4)


def hz(note, a4: float = A4) -> float:
    """Frequency in Hz of a note name or MIDI number."""
    return midi_to_hz(midi(note), a4)


def name(m: float) -> str:
    """Note name of a MIDI number (sharps/flats as in C C# D Eb E F F# G Ab A Bb B)."""
    m = int(round(m))
    return f'{_NAMES[m % 12]}{m // 12 - 1}'


def pc(note) -> int:
    """Pitch class 0..11 (C = 0)."""
    if isinstance(note, str) and not re.search(r'\d', note):
        note = note + '4'
    return int(round(midi(note))) % 12


def cents(ratio: float) -> float:
    return 1200.0 * math.log2(ratio)


def transpose(notes: Iterable, semis: float) -> list[float]:
    return [midi(n) + semis for n in notes]


# ----------------------------------------------------------------------------
# Scales
# ----------------------------------------------------------------------------

SCALES = {
    'major': [0, 2, 4, 5, 7, 9, 11],
    'minor': [0, 2, 3, 5, 7, 8, 10],
    'harmonic_minor': [0, 2, 3, 5, 7, 8, 11],
    'melodic_minor': [0, 2, 3, 5, 7, 9, 11],
    'dorian': [0, 2, 3, 5, 7, 9, 10],
    'phrygian': [0, 1, 3, 5, 7, 8, 10],
    'lydian': [0, 2, 4, 6, 7, 9, 11],
    'mixolydian': [0, 2, 4, 5, 7, 9, 10],
    'pentatonic_minor': [0, 3, 5, 7, 10],
    'pentatonic_major': [0, 2, 4, 7, 9],
    'whole_tone': [0, 2, 4, 6, 8, 10],
    'chromatic': list(range(12)),
}


def scale(root, mode: str = 'minor', lo='A2', hi='A5') -> list[int]:
    """All MIDI notes of ``root``/``mode`` between ``lo`` and ``hi`` inclusive."""
    r = pc(root)
    steps = set((r + s) % 12 for s in SCALES[mode])
    return [m for m in range(int(midi(lo)), int(midi(hi)) + 1) if m % 12 in steps]


# ----------------------------------------------------------------------------
# Chords
# ----------------------------------------------------------------------------

CHORDS = {
    '': [0, 4, 7], 'maj': [0, 4, 7], 'm': [0, 3, 7], 'min': [0, 3, 7],
    '5': [0, 7], 'sus2': [0, 2, 7], 'sus4': [0, 5, 7], 'dim': [0, 3, 6], 'aug': [0, 4, 8],
    '6': [0, 4, 7, 9], 'm6': [0, 3, 7, 9], '7': [0, 4, 7, 10], 'maj7': [0, 4, 7, 11],
    'm7': [0, 3, 7, 10], 'm7b5': [0, 3, 6, 10], 'dim7': [0, 3, 6, 9],
    'add9': [0, 4, 7, 14], 'madd9': [0, 3, 7, 14], 'mb6': [0, 3, 7, 8],
    '9': [0, 4, 7, 10, 14], 'maj9': [0, 4, 7, 11, 14], 'm9': [0, 3, 7, 10, 14],
    'maj7#11': [0, 4, 7, 11, 18], '6/9': [0, 4, 7, 9, 14], '7sus4': [0, 5, 7, 10],
}
_CHORD_RE = re.compile(r'^([A-G][#♯b♭]?)([^/]*)(?:/([A-G][#♯b♭]?))?$')


def parse_chord(symbol: str) -> tuple[int, list[int], int]:
    """``'Fmaj7'`` -> (root pc, intervals, bass pc). Supports slash chords."""
    m = _CHORD_RE.match(symbol.strip())
    if not m:
        raise ValueError(f'bad chord {symbol!r}')
    root, quality, bass = m.groups()
    if quality not in CHORDS:
        raise ValueError(f'unknown chord quality {quality!r} in {symbol!r}')
    r = pc(root)
    return r, CHORDS[quality], pc(bass) if bass else r


def chord_pcs(symbol: str) -> set[int]:
    r, iv, _ = parse_chord(symbol)
    return {(r + i) % 12 for i in iv}


def chord(symbol: str, octave: int = 3) -> list[int]:
    """Close-position chord (root position) starting in ``octave``."""
    r, iv, _ = parse_chord(symbol)
    base = 12 * (octave + 1) + r
    return [base + i for i in iv]


def voicing(symbol: str, lo='G3', hi='E5', n: int = 4, bass_octave: int | None = 2,
            top=None) -> list[int]:
    """A spread voicing: bass note (root or slash bass) in ``bass_octave`` plus
    ``n`` upper voices chosen from chord tones between ``lo`` and ``hi``,
    optionally forcing the top note."""
    r, iv, b = parse_chord(symbol)
    pcs = {(r + i) % 12 for i in iv}
    cands = [m for m in range(int(midi(lo)), int(midi(hi)) + 1) if m % 12 in pcs]
    upper = cands[-n:] if len(cands) >= n else cands
    if top is not None:
        t = int(midi(top))
        upper = [m for m in cands if m < t][-(n - 1):] + [t]
    out = sorted(upper)
    if bass_octave is not None:
        out = [12 * (bass_octave + 1) + b] + out
    return out


def voice_lead(prev: Sequence[float], symbol: str, lo='E3', hi='A5', keep=None,
               max_leap: int = 7) -> list[int]:
    """Move the upper voices ``prev`` to chord ``symbol`` with minimal total
    motion (common tones stay put), keeping the same number of voices.

    ``keep`` optionally names a pitch that must be held if it is a chord tone
    (e.g. a pedal on top). Voices never cross; the result covers the root and
    third when possible."""
    r, iv, _ = parse_chord(symbol)
    pcs = {(r + i) % 12 for i in iv}
    third = next(((r + i) % 12 for i in iv if i in (3, 4)), None)
    prev = [int(round(p)) for p in sorted(prev)]
    lo_m, hi_m = int(midi(lo)), int(midi(hi))
    opts = []
    for p in prev:
        c = [m for m in range(p - max_leap, p + max_leap + 1) if m % 12 in pcs and lo_m <= m <= hi_m]
        c.sort(key=lambda m: abs(m - p))
        opts.append(c[:4] or [p])
    best, best_cost = None, float('inf')
    for combo in itertools.product(*opts):
        if any(b <= a for a, b in zip(combo, combo[1:])):
            continue
        cost = sum(abs(a - b) for a, b in zip(combo, prev))
        got = {m % 12 for m in combo}
        if r not in got:
            cost += 6
        if third is not None and third not in got:
            cost += 5
        cost += 2 * (len(combo) - len(got))
        if keep is not None and int(midi(keep)) in prev and int(midi(keep)) % 12 in pcs and int(midi(keep)) not in combo:
            cost += 20
        if cost < best_cost:
            best, best_cost = list(combo), cost
    return best if best is not None else prev


def progression(symbols: Sequence[str], start: Sequence, lo='E3', hi='A5', keep=None) -> list[list[int]]:
    """Voice-lead a list of chord symbols from the starting upper voicing."""
    out = [list(int(midi(n)) for n in start)]
    for s in symbols[1:]:
        out.append(voice_lead(out[-1], s, lo, hi, keep))
    return out


def legato(steps: Sequence[tuple[float, Sequence]], end: float) -> list[tuple[float, float, float, int]]:
    """Turn a list of ``(time, voicing)`` into note events per voice, merging
    repeated pitches so common tones are held rather than re-struck.

    Returns ``[(start, dur, midi, voice_index), ...]``. Voicings may differ in
    size; voices are matched by index from the bottom.
    """
    events = []
    active: dict[int, tuple[float, float]] = {}
    for k, (t, notes) in enumerate(steps):
        ms = [midi(n) for n in notes]
        for v in list(active):
            if v >= len(ms) or active[v][1] != ms[v]:
                st, m = active.pop(v)
                events.append((st, t - st, m, v))
        for v, m in enumerate(ms):
            if v not in active:
                active[v] = (t, m)
    for v, (st, m) in active.items():
        events.append((st, end - st, m, v))
    events.sort()
    return events
