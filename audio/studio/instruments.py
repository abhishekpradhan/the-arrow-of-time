"""Synthesized instruments and sound effects.

Every function returns a float32 buffer: stereo ``(2, n)`` for instruments
with built-in width, mono ``(n,)`` for point sources (pan them with
:meth:`Track.add`). Notes are names (``'A4'``) or MIDI numbers. All tones are
band-limited (additive wavetables or explicit partial lists that stop below
Nyquist) and every sound starts and ends with an envelope, so nothing clicks.

Pitched instruments
    :func:`organ`, :func:`strings`, :func:`piano`, :func:`brass`, :func:`bell`,
    :func:`choir`, :func:`pluck`, :func:`marimba`, :func:`glass`, :func:`pad`,
    :func:`breath_pad`, :func:`drone`
Percussion
    :func:`clock`, :func:`taiko`, :func:`timpani`, :func:`tom`, :func:`rim`,
    :func:`shaker`, :func:`tap`, :func:`drum` (generic membrane)
Effects and atmospheres
    :func:`sub_boom`, :func:`noise_burst`, :func:`impact`, :func:`riser`,
    :func:`shepard`, :func:`whoosh`, :func:`reverse_swell`, :func:`rumble`,
    :func:`rain`, :func:`wind`, :func:`fire`, :func:`debris`, :func:`shimmer`
"""
from __future__ import annotations

import math
from functools import lru_cache

import numpy as np
from scipy.signal import fftconvolve, lfilter

from . import osc
from .core import F32, SR, _ramp, adsr, fade, ns, pad_to, pan_gains, rng, smooth_noise, tvec
from .filters import apply_sos, biquad, butter_sos, eq, rbj_sos, sweep
from .fx import saturate
from .theory import hz, midi, midi_to_hz

TWO_PI = 2.0 * math.pi


def _frozen(x: np.ndarray) -> np.ndarray:
    x = np.ascontiguousarray(x, dtype=F32)
    x.flags.writeable = False
    return x


def _decay(t: np.ndarray, tau: float) -> np.ndarray:
    return np.exp(t * F32(-1.0 / max(tau, 1e-6)))


def _pitch_pan(m: float, spread: float = 0.5) -> float:
    """Keyboard-style pan: low notes left, high notes right (subtle)."""
    return float(np.clip((m - 64.0) / 36.0, -1, 1) * spread)


# ============================================================================
# Clock
# ============================================================================

def clock(kind: str = 'tick', vel: float = 1.0, seed: int = 0, bright: float = 0.0, sr: int = SR) -> np.ndarray:
    """Mechanical clock: a crisp escapement click plus resonant ring.
    ``kind='tick'`` rings at ~1.2 kHz, ``'tock'`` at ~0.95 kHz. ``bright``
    (0..1) sharpens the click so it cuts through a dense mix. Mono."""
    r = rng('clock', kind, seed)
    n = ns(0.2, sr)
    t = tvec(n, sr)
    tick = kind == 'tick'
    f = (1200.0 if tick else 950.0) * 2 ** (r.normal(0, 4) / 1200)
    burst = osc.white(n, r) * _decay(t, 0.00032)
    click = apply_sos(burst, butter_sos('highpass', 1400.0, 2, sr)) * F32(0.5 * (1 + bright))
    click += biquad(burst, 'bandpass', (3400.0 if tick else 2800.0) * (1 + 0.25 * bright), 1.1, 0, sr) * F32(1.3 * (1 + 0.6 * bright))
    body = np.zeros(n, F32)
    for ratio, amp, tau in ((1.0, 1.0, 0.024), (2.71, 0.30, 0.009), (4.13, 0.15, 0.005), (6.2, 0.06, 0.003)):
        body += F32(amp) * osc.sine(f * ratio, n, sr) * _decay(t, tau * r.uniform(0.9, 1.1))
    knock = F32(0.35) * osc.sine(235.0 if tick else 185.0, n, sr) * _decay(t, 0.0055)
    y = click * F32(0.9) + body * F32(0.42) + knock
    if bright > 0:   # a higher, drier transient that sits above dense music
        y += biquad(burst, 'bandpass', 6500.0 if tick else 5600.0, 1.4, 0, sr) * F32(1.1 * bright)
    # escapement double strike: a second, weaker impact ~8-11 ms later
    d = ns(0.0082 + r.uniform(0, 0.0028), sr)
    y[d:] += y[:n - d] * F32(0.26)
    y = apply_sos(y, butter_sos('lowpass', 9000.0 + 4000.0 * bright, 2, sr))
    y = fade(y, 0.0002, 0.03, sr)
    y *= F32(0.6 * vel / (np.max(np.abs(y)) + 1e-9))
    return y.astype(F32)


# ============================================================================
# Organ
# ============================================================================

#: harmonic amplitude profiles of pipe types (relative to the pipe's fundamental)
PIPES = {
    'principal': [1.0, 0.5, 0.33, 0.2, 0.14, 0.09, 0.065, 0.045, 0.032, 0.022, 0.016, 0.011, 0.008, 0.006],
    'flute': [1.0, 0.16, 0.05, 0.02, 0.008],
    'bourdon': [1.0, 0.02, 0.2, 0.01, 0.06, 0.004, 0.02],
    'string': [0.8 * k ** -0.85 for k in range(1, 25)],
    'reed': [0.9 * k ** -0.55 * (1.0 + 0.8 * math.exp(-((k - 6) / 4.0) ** 2)) for k in range(1, 31)],
}

#: registration -> [(foot, pipe type, level), ...]
REGISTRATIONS = {
    'drone': [(16, 'bourdon', 0.55), (8, 'flute', 0.6), (4, 'flute', 0.12)],
    'soft': [(8, 'flute', 0.8), (8, 'bourdon', 0.45), (4, 'flute', 0.3)],
    'celeste': [(8, 'string', 0.5), (8, 'flute', 0.65), (4, 'flute', 0.22)],
    'principal': [(16, 'bourdon', 0.45), (8, 'principal', 0.8), (4, 'principal', 0.42), (2, 'principal', 0.18)],
    'full': [(16, 'principal', 0.6), (8, 'principal', 0.8), (4, 'principal', 0.55), (8 / 3, 'principal', 0.28),
             (2, 'principal', 0.3), (4 / 3, 'principal', 0.18), (1, 'principal', 0.14), (8, 'reed', 0.3)],
    'pedal': [(32, 'bourdon', 0.4), (16, 'principal', 0.7), (8, 'principal', 0.45), (16, 'reed', 0.15)],
    'grand': [(16, 'principal', 0.7), (8, 'principal', 0.8), (4, 'principal', 0.4), (16, 'reed', 0.3),
              (8, 'reed', 0.45)],
}


@lru_cache(maxsize=1024)
def _organ_tables(reg: str, m: int, fmax: float = 16000.0):
    ranks = REGISTRATIONS[reg]
    ks = [int(round(32 / foot)) for foot, _, _ in ranks]
    g = 0
    for k in ks:
        g = math.gcd(g, k)
    base = midi_to_hz(m) * g / 4.0
    K = max(1, int(fmax // base))
    H = {'f': np.zeros(K + 1), 'u': np.zeros(K + 1)}
    r = rng('organ-voicing', reg, m)
    for (foot, typ, lvl), k in zip(ranks, ks):
        part = 'f' if foot >= 8 else 'u'
        step = k // g
        for i, a in enumerate(PIPES[typ], start=1):
            h = step * i
            if h > K:
                break
            H[part][h] += lvl * a * 10 ** (r.normal(0, 0.8) / 20)
    total = math.sqrt((np.sum(H['f'] ** 2) + np.sum(H['u'] ** 2)) / 2) + 1e-9
    ph = tuple(r.uniform(0, TWO_PI, K))
    tf = osc.harmonic_table(tuple(H['f'][1:] * (0.1 / total)), ph)
    tu = osc.harmonic_table(tuple(H['u'][1:] * (0.1 / total)), ph) if H['u'].any() else None
    return tf, tu, g / 4.0


def organ(notes, dur: float, reg: str = 'principal', attack: float = 0.08, release: float = 0.45,
          trem: float = 0.0, chiff: float = 0.25, level: float = 1.0, seed: int = 0, sr: int = SR) -> np.ndarray:
    """Pipe organ chord. ``reg`` picks a registration from
    :data:`REGISTRATIONS` (drone, soft, celeste, principal, full, pedal).
    Upper-work ranks speak slightly before the foundation and are tuned a
    fraction of a cent apart (gentle shimmer); notes alternate between the
    C and C-sharp sides of the case (stereo width). ``trem`` adds tremulant."""
    n = ns(dur + release, sr)
    out = np.zeros((2, n), F32)
    t = tvec(n, sr)
    envf = pad_to(adsr(dur, attack, 0, 1, release, sr), n)
    envu = pad_to(adsr(dur, attack * 0.55, 0, 1, release * 0.8, sr), n)
    tr = (F32(1.0) + F32(trem) * np.sin(t * F32(TWO_PI * 5.3))) if trem else None
    for i, note in enumerate(notes):
        m = midi(note)
        r = rng('organ', reg, m, seed, i)
        tf, tu, ratio = _organ_tables(reg, int(round(m)))
        fk = midi_to_hz(m) * 2 ** (r.normal(0, 0.5) / 1200)
        fb = fk * ratio
        if trem:
            fb = fb * (1.0 + 0.0012 * trem * np.sin(TWO_PI * 5.3 * t.astype(np.float64) + 0.3))
        sig = osc.wavetable(tf, fb, n, sr, r.random()) * envf
        if tu is not None:
            sig += osc.wavetable(tu, fb * 2 ** (r.normal(0.9, 0.3) / 1200), n, sr, r.random()) * envu
        if chiff > 0 and attack < 0.4:
            nc = min(n, ns(0.12, sr))
            ch = biquad(osc.white(nc, r), 'bandpass', min(3 * fk, 9000.0), 3.0, 0, sr)
            sig[:nc] += ch * _decay(t[:nc], 0.028) * F32(0.12 * chiff) * _ramp(nc, 'lin')[::-1]
        if tr is not None:
            sig *= tr
        p = (0.35 if int(round(m)) % 2 else -0.35) * float(np.clip((m - 36) / 24.0, 0, 1))
        gl, gr = pan_gains(p)
        out[0] += sig * F32(gl)
        out[1] += sig * F32(gr)
    out *= F32(level)
    return out


# ============================================================================
# Strings
# ============================================================================

def strings(notes, dur: float, attack: float = 0.6, release: float = 1.5, voices: int = 6,
            detune: float = 9.0, vibrato: float = 13.0, vib_rate: float = 5.3, bright: float = 4200.0,
            air: float = 0.015, level: float = 1.0, seed: int = 0, sr: int = SR,
            attack_shape: str = 'cos') -> np.ndarray:
    """String section: a detuned, band-limited saw ensemble per note with
    delayed vibrato and slow pitch drift per player, spread across the stereo
    field, low-passed at ``bright`` Hz and shaped with a body EQ. A little
    bow-noise ``air`` follows the envelope."""
    n = ns(dur + release, sr)
    t = tvec(n, sr)
    out = np.zeros((2, n), F32)
    vib_on = np.clip((t - F32(0.25)) * F32(1 / 0.9), 0.0, 1.0)
    for i, note in enumerate(notes):
        f0 = hz(note)
        r = rng('strings', midi(note), seed, i)
        tab = osc.saw_table(osc.nharm(f0 * 1.03, min(16000.0, bright * 3.0), sr))
        for v in range(voices):
            u = (v / (voices - 1) * 2 - 1) if voices > 1 else 0.0
            c = detune * u + r.normal(0, detune * 0.25)
            rate = vib_rate * r.uniform(0.88, 1.12)
            cents = np.sin(t * F32(TWO_PI * rate) + F32(r.uniform(0, TWO_PI))) * vib_on
            cents *= F32(vibrato * r.uniform(0.7, 1.2))
            cents += smooth_noise(n, 0.6, r, sr) * F32(3.0) + F32(c)
            f = np.exp2(cents * F32(1 / 1200.0)) * F32(f0)
            y = osc.wavetable(tab, f, n, sr, r.random())
            gl, gr = pan_gains(0.75 * u)
            out[0] += y * F32(gl)
            out[1] += y * F32(gr)
    out *= F32(0.18 * level / math.sqrt(max(1, voices)))
    out = apply_sos(out, butter_sos('lowpass', bright, 2, sr))
    out = eq(out, [('highpass', 45.0, 0.7, 0), ('peak', 280.0, 1.0, 1.5), ('peak', 650.0, 1.2, -2.0),
                   ('peak', 2800.0, 1.0, 1.0)], sr)
    env = pad_to(adsr(dur, attack, 0, 1, release, sr, attack_shape=attack_shape), n)
    out *= env
    if air > 0:
        r = rng('strings-air', seed, len(notes))
        a = np.stack([osc.white(n, r), osc.white(n, r)])
        a = apply_sos(a, butter_sos('bandpass', (2500.0, 7000.0), 2, sr)) * env * F32(0.18 * air * level * math.sqrt(len(notes)))
        out += a
    return out.astype(F32)


# ============================================================================
# Piano
# ============================================================================

@lru_cache(maxsize=512)
def _piano(m: float, vel: float, dur: float, tone: float, seed: int, sr: int) -> np.ndarray:
    f0 = midi_to_hz(m)
    r = rng('piano', m, vel, dur, tone, seed)
    B = float(np.clip(2.6e-4 * 2 ** ((m - 60) / 12 * 1.4), 8e-5, 0.02))
    tau = float(np.clip(9.0 * 2 ** (-(m - 48) / 12 * 0.6), 1.0, 16.0))
    length = min(dur, 6.0 * tau) + 0.45
    n = ns(length, sr)
    t = tvec(n, sr)
    fc = (700.0 + 5200.0 * vel ** 2) * (0.45 + 0.55 * tone) * (1 + max(0, m - 60) / 30)
    p = 1.35 - 0.5 * vel
    x0 = 0.12 + r.uniform(-0.005, 0.005)
    out = np.zeros((2, n), F32)
    k = 1
    while k <= 48:
        fk = k * f0 * math.sqrt(1 + B * k * k)
        if fk > 17000:
            break
        a = k ** -p * (abs(math.sin(math.pi * k * x0)) ** 0.7 + 0.08) / (1 + (fk / fc) ** 2)
        if a < 2e-4:
            k += 1
            continue
        tk = tau / (1 + 0.12 * (k - 1) + (fk / 2600) ** 1.3)
        env = F32(0.55) * _decay(t, tk * 0.16) + F32(0.45) * _decay(t, tk)
        if k <= 10:
            dc = r.uniform(0.25, 1.1)
            ph = r.uniform(0, 1, 2)
            s1 = osc.sine(fk * 2 ** (dc / 1200), n, sr, ph[0])
            s2 = osc.sine(fk * 2 ** (-dc / 1200), n, sr, ph[1])
            out[0] += (s1 * F32(0.62) + s2 * F32(0.38)) * env * F32(a)
            out[1] += (s1 * F32(0.38) + s2 * F32(0.62)) * env * F32(a)
        else:
            s = osc.sine(fk, n, sr, r.random()) * env * F32(a)
            out[0] += s
            out[1] += s
        k += 1
    # hammer: felt thump + short noise
    nh = min(n, ns(0.06, sr))
    hn = osc.white(nh, r) * _decay(t[:nh], 0.0022)
    hn = apply_sos(hn, butter_sos('lowpass', 1200.0 + 3500.0 * vel * tone, 2, sr)) * F32(0.05 + 0.1 * vel)
    th = osc.sine(95.0, nh, sr) * _decay(t[:nh], 0.02) * F32(0.04 * (0.5 + vel))
    out[:, :nh] += hn + th
    # damper
    nd = ns(dur, sr)
    if nd < n:
        rel = np.ones(n, F32)
        rel[nd:] = _decay(t[:n - nd], 0.09)
        out *= rel
    out = fade(out, 0.0015, 0.04, sr)
    pk = float(np.max(np.abs(out))) + 1e-9
    out *= F32((0.22 + 0.55 * vel) / pk)
    g = pan_gains(_pitch_pan(m, 0.45))
    out[0] *= F32(g[0])
    out[1] *= F32(g[1])
    return _frozen(out)


def piano(note, dur: float = 1.0, vel: float = 0.6, tone: float = 0.7, seed: int = 0, sr: int = SR) -> np.ndarray:
    """Piano note: inharmonic partials (stiff-string law), two-stage decay,
    detuned unison strings (beating), hammer thump. ``dur`` is when the damper
    falls (use a long ``dur`` for pedalled notes); ``tone`` < 1 gives a darker,
    felt-piano colour. Cached; the returned array is read-only."""
    return _piano(round(midi(note), 3), round(float(vel), 2), round(float(dur), 2), round(float(tone), 2), seed, sr)


# ============================================================================
# Synth brass
# ============================================================================

def brass(notes, dur: float, attack: float = 0.14, release: float = 0.7, vel: float = 0.8,
          bright: float = 1.0, detune: float = 7.0, vibrato: float = 7.0, growl: float = 0.0,
          level: float = 1.0, seed: int = 0, sr: int = SR) -> np.ndarray:
    """CS-80-style synth brass: two detuned saws plus a slowly width-modulated
    pulse per note, a brassy pitch scoop, delayed vibrato, and a swelling
    24 dB/oct low-pass filter envelope. ``growl`` adds saturation."""
    n = ns(dur + release, sr)
    t = tvec(n, sr)
    t64 = t.astype(np.float64)
    x = np.zeros((2, n), F32)
    ms = [midi(nt) for nt in notes]
    for i, m in enumerate(ms):
        f0 = midi_to_hz(m)
        r = rng('brass', m, seed, i)
        scoop = -28.0 * np.exp(-t64 / 0.06)
        vib = vibrato * np.clip((t64 - 0.45) / 0.8, 0, 1) * np.sin(TWO_PI * r.uniform(4.8, 5.6) * t64 + r.uniform(0, 6.3))
        drift = 2.5 * smooth_noise(n, 0.5, r, sr)
        base = scoop + vib + drift
        tab = osc.saw_table(osc.nharm(f0 * 1.02, 15000.0, sr))
        for c, p in ((detune, -0.55), (-detune, 0.55)):
            y = osc.wavetable(tab, f0 * np.exp2((base + c + r.normal(0, 1.5)) / 1200.0), n, sr, r.random())
            gl, gr = pan_gains(p)
            x[0] += y * F32(gl)
            x[1] += y * F32(gr)
        ph = osc.phase(f0 * np.exp2(base / 1200.0), n, sr, r.random())
        w = 0.42 + 0.08 * np.sin(TWO_PI * 0.31 * t64 + r.uniform(0, 6.3))
        pu = (osc.read_table(tab, ph) - osc.read_table(tab, ph + w)) * F32(0.45)
        x += pu
    fe = (1 - np.exp(-t64 / max(attack * 0.9, 0.01))) * (0.55 + 0.45 * np.exp(-np.maximum(t64 - attack, 0) / 0.9))
    nd = ns(dur, sr)
    if nd < n:
        fe[nd:] *= np.exp(-(t64[nd:] - dur) / max(release * 0.6, 0.05))
    flo = max(160.0, 1.1 * midi_to_hz(min(ms)))
    fhi = min(10000.0, flo * (3.0 + 9.0 * bright * vel))
    cutoff = flo * (fhi / flo) ** (fe * (0.55 + 0.45 * vel))
    amp = pad_to(adsr(dur, attack, 0.6, 0.86, release, sr), n)
    x *= amp
    y = sweep(x, 'lowpass', cutoff, 0.9, block=64, sr=sr, stages=2)
    if growl > 0:
        y = saturate(y * F32(1.0 + 2.0 * growl), 1.0 + 2.5 * growl) / F32(1.0 + 1.0 * growl)
    y = eq(y, [('highpass', 45.0, 0.7, 0), ('highshelf', 7000.0, 0.7, -3.0)], sr)
    y = fade(y, 0.0, 0.02, sr)
    return (y * F32(level * 0.14)).astype(F32)


# ============================================================================
# Bells
# ============================================================================

BELLS = {
    # ratios, amplitudes, decay multipliers
    'glass': ([1.0, 2.0, 3.0, 4.16, 5.43, 6.8], [1.0, 0.3, 0.1, 0.07, 0.04, 0.025], [1.0, 0.55, 0.3, 0.2, 0.14, 0.1]),
    'celesta': ([1.0, 4.0, 10.0], [1.0, 0.12, 0.03], [1.0, 0.2, 0.06]),
    'crystal': ([1.0, 2.76, 5.40, 8.93], [1.0, 0.25, 0.08, 0.03], [1.0, 0.4, 0.2, 0.1]),
    'church': ([0.5, 1.0, 1.183, 1.506, 2.0, 2.514, 2.662, 3.011, 4.166],
               [0.55, 1.0, 0.45, 0.3, 0.55, 0.22, 0.18, 0.13, 0.08],
               [1.6, 1.0, 0.7, 0.55, 0.5, 0.35, 0.3, 0.25, 0.18]),
}


def bell(note, dur: float = 6.0, vel: float = 0.8, kind: str = 'glass', glide: float = 0.0,
         fm: float = 0.35, seed: int = 0, sr: int = SR) -> np.ndarray:
    """Bell / celesta. Additive inharmonic partials (per-channel phases for
    width, a slowly beating twin of the lowest partials) plus a short FM
    'sparkle' at the strike. ``glide`` bends the pitch down by that many
    semitones over the decay (a dying star)."""
    ratios, amps, decs = BELLS[kind]
    f0 = hz(note)
    r = rng('bell', midi(note), kind, seed)
    n = ns(dur, sr)
    t = tvec(n, sr)
    t64 = t.astype(np.float64)
    tau0 = dur / 4.5
    gl = np.exp2(-glide * (1 - np.exp(-t64 / (dur / 3))) / 12.0) if glide else 1.0
    out = np.zeros((2, n), F32)
    for k, (ra, a, dm) in enumerate(zip(ratios, amps, decs)):
        f = f0 * ra
        if f * 1.01 > 19000:
            continue
        env = _decay(t, tau0 * dm) * F32(a)
        p0, beat = r.random(), r.uniform(0.8, 2.2)
        for c in range(2):
            # the channels share the partial's phase up to a small offset: wide but mono-safe
            y = osc.sine(f * gl, n, sr, p0 + r.uniform(-0.08, 0.08))
            if k < 2:
                y = (y + osc.sine(f * gl * 2 ** (beat / 1200), n, sr, p0 + 0.3 + r.uniform(-0.08, 0.08))) * F32(0.5)
            out[c] += y * env
    if fm > 0:
        fmr = 3.5
        ind = min(4.0 * fm * vel, max(0.0, (19000 - f0) / (fmr * f0) - 1))
        if ind > 0.05:
            I = F32(ind) * _decay(t, 0.12)
            mod = osc.sine(f0 * fmr * gl, n, sr)
            car = np.sin((osc.frac(osc.phase(f0 * gl, n, sr)) * F32(TWO_PI)) + I * mod)
            sp = car * _decay(t, tau0 * 0.25) * F32(0.3 * fm * vel)
            out += sp
    nc = min(n, ns(0.01, sr))
    click = biquad(osc.white(nc, r), 'bandpass', min(12000.0, 4 * f0), 2.0, 0, sr) * _decay(t[:nc], 0.0015) * F32(0.06 * vel)
    out[:, :nc] += click
    out = fade(out, 0.0008, min(0.3, dur * 0.1), sr)
    out *= F32(0.5 * vel / (np.max(np.abs(out)) + 1e-9))
    return out


# ============================================================================
# Choir
# ============================================================================

#: (section, vowel) -> (formant Hz, gains dB, bandwidths Hz)
FORMANTS = {
    ('soprano', 'a'): ([800, 1150, 2900, 3900, 4950], [0, -6, -32, -20, -50], [80, 90, 120, 130, 140]),
    ('alto', 'a'): ([800, 1150, 2800, 3500, 4950], [0, -4, -20, -36, -60], [80, 90, 120, 130, 140]),
    ('tenor', 'a'): ([650, 1080, 2650, 2900, 3250], [0, -6, -7, -8, -22], [80, 90, 120, 130, 140]),
    ('bass', 'a'): ([600, 1040, 2250, 2450, 2750], [0, -7, -9, -9, -20], [60, 70, 110, 120, 130]),
    ('soprano', 'o'): ([450, 800, 2830, 3800, 4950], [0, -11, -22, -22, -50], [70, 80, 100, 130, 135]),
    ('alto', 'o'): ([450, 800, 2830, 3500, 4950], [0, -9, -16, -28, -55], [70, 80, 100, 130, 135]),
    ('tenor', 'o'): ([400, 800, 2600, 2800, 3000], [0, -10, -12, -12, -26], [70, 80, 100, 130, 135]),
    ('bass', 'o'): ([400, 750, 2400, 2600, 2900], [0, -11, -21, -20, -40], [40, 80, 100, 120, 120]),
    ('soprano', 'u'): ([350, 600, 2700, 2900, 3300], [0, -20, -17, -14, -26], [50, 60, 170, 180, 200]),
    ('alto', 'u'): ([325, 700, 2530, 3500, 4950], [0, -12, -30, -40, -64], [50, 60, 170, 180, 200]),
    ('tenor', 'u'): ([350, 600, 2700, 2900, 3300], [0, -20, -17, -14, -26], [40, 60, 100, 120, 120]),
    ('bass', 'u'): ([350, 600, 2400, 2675, 2950], [0, -20, -32, -28, -36], [40, 80, 100, 120, 120]),
}


def _section(m: float) -> str:
    return 'bass' if m < 52 else 'tenor' if m < 60 else 'alto' if m < 67 else 'soprano'


def _formant_sos(section: str, vowel: str, spread: float, sr: int) -> list:
    F, G, BW = FORMANTS[(section, vowel)]
    return [(rbj_sos('bandpass', f, f / (bw * spread), 0, sr), 10 ** (g / 20)) for f, g, bw in zip(F, G, BW)]


def choir(notes, dur: float, vowel: str = 'a', attack: float = 0.8, release: float = 2.0, voices: int = 4,
          detune: float = 10.0, vibrato: float = 18.0, drift: float = 6.0, breath: float = 0.04,
          level: float = 1.0, seed: int = 0, sr: int = SR) -> np.ndarray:
    """Formant-synthesized choir ("aah" = ``'a'``, "ooh" = ``'u'``, ``'o'``).
    Notes are assigned to bass/tenor/alto/soprano by pitch; each section is an
    ensemble of glottal-like sources with individual vibrato, jitter and
    detune, filtered through that section's vowel formants (widened for an
    ensemble) with a little breath noise. Big ``detune``/``drift`` = eerie."""
    n = ns(dur + release, sr)
    t = tvec(n, sr)
    groups: dict[str, list[float]] = {}
    for nt in notes:
        m = midi(nt)
        groups.setdefault(_section(m), []).append(m)
    out = np.zeros((2, n), F32)
    vib_on = np.clip((t - F32(0.2)) * F32(1 / 0.7), 0, 1)
    nref = min(n, ns(3.0, sr))
    for sec, ms in groups.items():
        src = np.zeros((2, n), F32)
        for i, m in enumerate(ms):
            f0 = midi_to_hz(m)
            r = rng('choir', m, sec, seed, i)
            tab = osc.harmonic_table(tuple(k ** -1.1 for k in range(1, osc.nharm(f0 * 1.05, 9000.0, sr) + 1)))
            for v in range(voices):
                u = (v / (voices - 1) * 2 - 1) if voices > 1 else 0.0
                c = detune * u + r.normal(0, detune * 0.3)
                cents = np.sin(t * F32(TWO_PI * r.uniform(4.6, 5.9)) + F32(r.uniform(0, 6.3))) * vib_on
                cents *= F32(vibrato * r.uniform(0.6, 1.2))
                cents += smooth_noise(n, 1.8, r, sr) * F32(drift) + F32(c)
                y = osc.wavetable(tab, np.exp2(cents * F32(1 / 1200.0)) * F32(f0), n, sr, r.random())
                y *= F32(1.0) + F32(0.12) * smooth_noise(n, 2.5, r, sr)
                gl, gr = pan_gains(0.8 * u * (1 if i % 2 else -1))
                src[0] += y * F32(gl)
                src[1] += y * F32(gr)
        # level-match the source, then add breath noise before the (shared) formant bank
        src *= F32(1.0 / (float(np.sqrt(np.mean(src[:, :nref] ** 2))) + 1e-9))
        if breath > 0:
            r = rng('choir-breath', sec, seed)
            src += np.stack([osc.colored(n, r, 0, 2500.0), osc.colored(n, r, 0, 2500.0)]) * F32(breath * 5.0)
        bank = _formant_sos(sec, vowel, 1.6, sr)
        y = apply_sos(src, butter_sos('lowpass', 500.0, 2, sr)) * F32(0.06)
        for sos, g in bank:
            y += apply_sos(src, sos) * F32(g)
        rms = float(np.sqrt(np.mean(y[:, :nref] ** 2))) + 1e-9
        y *= F32(0.1 * math.sqrt(len(ms)) / rms)
        out += y
    env = pad_to(adsr(dur, attack, 0, 1, release, sr), n)
    out *= env
    out = eq(out, [('highpass', 75.0, 0.7, 0), ('lowpass', 9500.0, 0.7, 0)], sr)
    return (out * F32(level)).astype(F32)


# ============================================================================
# Plucked / mallet
# ============================================================================

def pluck(note, dur: float = 1.5, vel: float = 0.8, bright: float = 0.6, decay: float | None = None,
          pos: float = 0.18, seed: int = 0, sr: int = SR) -> np.ndarray:
    """Karplus-Strong plucked string (harp/guitar-like), fractional-delay
    tuned, computed block-wise (one period per step, fully vectorised).
    ``decay`` is the T60 in seconds (default depends on pitch). Mono."""
    f0 = hz(note)
    r = rng('pluck', midi(note), seed, round(vel, 2))
    P = sr / f0
    D = int(P - 0.5)
    eta = P - 0.5 - D
    n = ns(dur, sr)
    L = int(P) + 1
    exc = r.standard_normal(L)
    a = math.exp(-TWO_PI * (400.0 + 7000.0 * bright * vel) / sr)
    exc = lfilter([1 - a], [1, -a], exc)
    sh = max(1, int(P * pos))
    exc = exc - np.concatenate([np.zeros(sh), exc[:-sh]])
    exc /= np.max(np.abs(exc)) + 1e-9
    T60 = decay if decay is not None else float(np.clip(3.2 * (220.0 / f0) ** 0.4, 0.5, 7.0))
    g = 10 ** (-3.0 / (T60 * f0))
    c0, c1, c2 = g * 0.5 * (1 - eta), g * 0.5, g * 0.5 * eta
    o = D + 2
    y = np.zeros(n + o)
    y[o:o + min(L, n)] = exc[:min(L, n)]
    for s in range(0, n, D):
        e = min(n, s + D)
        y[o + s:o + e] += c0 * y[o + s - D:o + e - D] + c1 * y[o + s - D - 1:o + e - D - 1] + c2 * y[o + s - D - 2:o + e - D - 2]
    y = y[o:]
    y = lfilter([1, -1], [1, -0.995], y)
    y = fade(y.astype(F32), 0.0005, min(0.08, dur * 0.2), sr)
    y *= F32(0.5 * vel / (np.max(np.abs(y)) + 1e-9))
    return y


def marimba(note, vel: float = 0.8, dur: float = 1.6, seed: int = 0, sr: int = SR) -> np.ndarray:
    """Marimba bar: tuned partials 1 : 3.98 : 9.1 with fast upper decays,
    plus a soft mallet transient. Mono."""
    f0 = hz(note)
    r = rng('marimba', midi(note), seed)
    n = ns(dur, sr)
    t = tvec(n, sr)
    tau = float(np.clip(0.9 * (262.0 / f0) ** 0.5, 0.2, 2.0))
    y = np.zeros(n, F32)
    for ra, a, dm in ((1.0, 1.0, 1.0), (3.98, 0.4 * vel, 0.18), (9.1, 0.12 * vel, 0.07)):
        if f0 * ra < 18000:
            y += osc.sine(f0 * ra, n, sr) * _decay(t, tau * dm) * F32(a)
    nm = min(n, ns(0.02, sr))
    y[:nm] += apply_sos(osc.white(nm, r), butter_sos('lowpass', 1500.0 + 3000.0 * vel, 2, sr)) * _decay(t[:nm], 0.0015) * F32(0.2 * vel)
    y = fade(y, 0.0004, min(0.1, dur * 0.2), sr)
    return y * F32(0.5 * vel / (np.max(np.abs(y)) + 1e-9))


def glass(note, dur: float, attack: float = 0.4, release: float = 1.5, vel: float = 0.6,
          seed: int = 0, sr: int = SR) -> np.ndarray:
    """Glass-harmonica tone: nearly pure, with slowly beating twins and a
    breath of 2nd/3rd harmonic. Stereo."""
    f0 = hz(note)
    r = rng('glass', midi(note), seed)
    n = ns(dur + release, sr)
    t64 = np.arange(n) / sr
    out = np.zeros((2, n), F32)
    for c, cents in enumerate((-2.0, 2.4)):
        wob = 1 + 0.0015 * np.sin(TWO_PI * r.uniform(0.2, 0.4) * t64 + r.uniform(0, 6.3))
        f = f0 * 2 ** (cents / 1200) * wob
        ph = osc.phase(f, n, sr, r.random())
        y = osc.sine_ph(ph) + F32(0.1) * osc.sine_ph(2 * ph) + (F32(0.03) * osc.sine_ph(3 * ph) if 3 * f0 < 18000 else 0)
        out[c] += y
        out[1 - c] += y * F32(0.35)
    env = pad_to(adsr(dur, attack, 0, 1, release, sr), n)
    return (out * env * F32(0.25 * vel)).astype(F32)


def pad(notes, dur: float, attack: float = 1.5, release: float = 2.5, bright: float = 2200.0,
        voices: int = 3, detune: float = 12.0, level: float = 1.0, seed: int = 0, sr: int = SR) -> np.ndarray:
    """Warm analog-style pad: detuned band-limited saws, low-passed, with a
    slow filter drift and wide stereo."""
    n = ns(dur + release, sr)
    out = np.zeros((2, n), F32)
    for i, note in enumerate(notes):
        f0 = hz(note)
        r = rng('pad', midi(note), seed, i)
        tab = osc.saw_table(osc.nharm(f0 * 1.02, min(15000.0, bright * 4), sr))
        for v in range(voices):
            u = (v / (voices - 1) * 2 - 1) if voices > 1 else 0.0
            f = f0 * np.exp2((detune * u + 3 * smooth_noise(n, 0.4, r, sr)) / 1200.0)
            y = osc.wavetable(tab, f, n, sr, r.random())
            gl, gr = pan_gains(0.9 * u)
            out[0] += y * F32(gl)
            out[1] += y * F32(gr)
    r = rng('pad-f', seed)
    cut = bright * np.exp2(0.5 * smooth_noise(n, 0.15, r, sr))
    out = sweep(out, 'lowpass', cut, 0.8, block=128, sr=sr)
    out = eq(out, [('highpass', 50.0, 0.7, 0)], sr)
    env = pad_to(adsr(dur, attack, 0, 1, release, sr), n)
    return (out * env * F32(level * 0.35 / math.sqrt(voices * max(1, len(notes)) / 2))).astype(F32)


def breath_pad(notes, dur: float, attack: float = 1.2, release: float = 2.0, vel: float = 0.6,
               seed: int = 0, sr: int = SR) -> np.ndarray:
    """Breathy, whispered pad: noise resonating at each note's first
    harmonics (like a chorus of flutes/breaths) over a faint sine core."""
    n = ns(dur + release, sr)
    r = rng('breath', seed, len(notes))
    noise = np.stack([osc.pink(n, r), osc.pink(n, r)])
    out = np.zeros((2, n), F32)
    for note in notes:
        f0 = hz(note)
        for k, a in ((1, 1.0), (2, 0.45), (3, 0.2)):
            if f0 * k < 12000:
                out += biquad(noise, 'bandpass', f0 * k, 35.0, 0, sr) * F32(a * 3.0)
        out += np.stack([osc.sine(f0, n, sr, 0.0), osc.sine(f0 * 1.0012, n, sr, 0.25)]) * F32(0.05)
    out += apply_sos(noise, butter_sos('bandpass', (2000.0, 9000.0), 2, sr)) * F32(0.05)
    am = F32(1.0) + F32(0.25) * smooth_noise(n, 0.7, r, sr)
    env = pad_to(adsr(dur, attack, 0, 1, release, sr), n)
    return (out * am * env * F32(vel * 0.4 / math.sqrt(len(notes)))).astype(F32)


def drone(notes, dur: float, attack: float = 3.0, release: float = 3.0, beat: float = 0.25,
          vel: float = 0.6, seed: int = 0, sr: int = SR) -> np.ndarray:
    """Pure sine drone (sub register): two slightly detuned sines per note
    beating slowly, plus a faint 2nd harmonic."""
    n = ns(dur + release, sr)
    out = np.zeros(n, F32)
    for note in notes:
        f0 = hz(note)
        r = rng('drone', midi(note), seed)
        out += osc.sine(f0, n, sr, r.random()) + osc.sine(f0 + beat, n, sr, r.random()) * F32(0.7)
        out += osc.sine(2 * f0, n, sr, r.random()) * F32(0.12)
    env = pad_to(adsr(dur, attack, 0, 1, release, sr), n)
    return (out * env * F32(vel * 0.3)).astype(F32)


# ============================================================================
# Percussion
# ============================================================================

MEMBRANE = (1.0, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501)
TIMPANI = (1.0, 1.504, 1.742, 2.0, 2.245, 2.494, 2.8, 2.98)


def drum(f0: float, vel: float = 1.0, decay: float = 0.8, drop: float = 0.25, modes=MEMBRANE,
         amps=None, noise: float = 0.3, noise_lp: float = 3000.0, drive: float = 1.5,
         seed: int = 0, sr: int = SR) -> np.ndarray:
    """Generic membrane drum: circular-membrane modes with a tension pitch
    drop at the strike, stick/mallet noise, and gentle saturation. Mono."""
    r = rng('drum', f0, seed, round(vel, 3))
    n = ns(min(decay * 5.5, 8.0) + 0.05, sr)
    t = tvec(n, sr)
    t64 = t.astype(np.float64)
    amps = amps or [1.0, 0.55, 0.38, 0.3, 0.22, 0.16, 0.12, 0.09]
    fenv = 1.0 + drop * vel * np.exp(-t64 / 0.035)
    y = np.zeros(n, F32)
    for i, (ra, a) in enumerate(zip(modes, amps)):
        y += osc.sine(f0 * ra * fenv, n, sr, 0.25 if i == 0 else r.random()) * _decay(t, decay / (1 + 0.9 * i)) * F32(a)
    nb = min(n, ns(0.06, sr))
    nz = apply_sos(osc.white(nb, r), butter_sos('lowpass', noise_lp, 2, sr)) * _decay(t[:nb], 0.004)
    slap = biquad(osc.white(nb, r), 'bandpass', 700.0, 0.8, 0, sr) * _decay(t[:nb], 0.018)
    y[:nb] += (nz * F32(noise) + slap * F32(noise * 0.5)) * F32(vel)
    y *= F32(vel)
    if drive > 1:
        y = np.tanh(y * F32(drive)) / F32(drive)
    y = fade(y, 0.0004, 0.05, sr)
    return y.astype(F32)


def taiko(vel: float = 1.0, size: float = 1.0, seed: int = 0, sr: int = SR) -> np.ndarray:
    """O-daiko style big drum (fundamental ~72 Hz / sqrt(size)), with a
    strong skin 'body' around 150-250 Hz so it reads on any speaker. Mono."""
    f0 = 72.0 / math.sqrt(size)
    y = drum(f0, vel, decay=0.5 * size, drop=0.3, noise=0.32, noise_lp=2800.0, drive=1.8,
             amps=[0.8, 0.7, 0.55, 0.45, 0.35, 0.25, 0.18, 0.12], seed=seed, sr=sr)
    return y * F32(0.9)


def timpani(note, vel: float = 0.9, decay: float = 1.6, seed: int = 0, sr: int = SR) -> np.ndarray:
    """Timpani: nearly harmonic kettle modes, felt mallet, long ring. Mono.
    Use a shorter ``decay`` for the individual strokes of a roll."""
    f0 = hz(note)
    return drum(f0, vel, decay=decay, drop=0.04, modes=TIMPANI,
                amps=[1.0, 0.5, 0.2, 0.3, 0.14, 0.12, 0.07, 0.05], noise=0.12, noise_lp=1200.0, drive=1.2, seed=seed, sr=sr)


def tom(f0: float = 110.0, vel: float = 0.8, seed: int = 0, sr: int = SR) -> np.ndarray:
    """Low tom. Mono."""
    return drum(f0, vel, decay=0.32, drop=0.35, noise=0.22, noise_lp=3500.0, drive=1.5, seed=seed, sr=sr)


def rim(vel: float = 0.7, seed: int = 0, sr: int = SR) -> np.ndarray:
    """Taiko rim 'ka' / wood click. Mono."""
    r = rng('rim', seed)
    n = ns(0.12, sr)
    t = tvec(n, sr)
    y = biquad(osc.white(n, r), 'bandpass', 2200.0, 2.0, 0, sr) * _decay(t, 0.006)
    y += osc.sine(880.0, n, sr) * _decay(t, 0.012) * F32(0.4)
    y = fade(y, 0.0002, 0.02, sr)
    return y * F32(0.5 * vel / (np.max(np.abs(y)) + 1e-9))


def shaker(vel: float = 0.5, dur: float = 0.12, seed: int = 0, sr: int = SR) -> np.ndarray:
    """Shaker grain: high noise with a short swell. Mono."""
    r = rng('shaker', seed)
    n = ns(dur, sr)
    t = tvec(n, sr)
    env = (1 - _decay(t, 0.008)) * _decay(t, 0.03)
    y = apply_sos(osc.white(n, r), butter_sos('bandpass', (4500.0, 12000.0), 2, sr)) * env
    y = fade(y, 0.001, 0.01, sr)
    return y * F32(0.4 * vel / (np.max(np.abs(y)) + 1e-9))


def tap(vel: float = 0.5, pitch: float = 700.0, seed: int = 0, sr: int = SR) -> np.ndarray:
    """Soft stone/wood tap. Mono."""
    r = rng('tap', seed, pitch)
    n = ns(0.15, sr)
    t = tvec(n, sr)
    y = np.zeros(n, F32)
    for ra, a, tau in ((1.0, 1.0, 0.012), (2.32, 0.4, 0.006), (3.9, 0.2, 0.004)):
        y += osc.sine(pitch * ra * r.uniform(0.97, 1.03), n, sr, r.random()) * _decay(t, tau) * F32(a)
    y += apply_sos(osc.white(n, r), butter_sos('lowpass', 4000.0, 2, sr)) * _decay(t, 0.0015) * F32(0.5)
    y = fade(y, 0.0003, 0.02, sr)
    return y * F32(0.5 * vel / (np.max(np.abs(y)) + 1e-9))


# ============================================================================
# Hits, booms and effects
# ============================================================================

def sub_boom(dur: float = 6.0, f_start: float = 85.0, f_end: float = 28.0, drop: float = 0.35,
             decay: float = 2.2, vel: float = 1.0, click: float = 0.4, harmonics: float = 0.35,
             seed: int = 0, sr: int = SR) -> np.ndarray:
    """Cinematic sub boom: a sine that drops in pitch with a long decay, a
    saturated copy (harmonics audible on small speakers) and a short click. Mono."""
    r = rng('boom', seed)
    n = ns(dur, sr)
    t = tvec(n, sr)
    t64 = t.astype(np.float64)
    f = f_end + (f_start - f_end) * np.exp(-t64 / drop)
    env = _decay(t, decay) * (1 - _decay(t, 0.0025))
    y = osc.sine(f, n, sr) * env
    h = np.tanh(y * F32(3.0)) / F32(3.0)
    h = apply_sos(h, butter_sos('highpass', 90.0, 2, sr)) * F32(harmonics)
    nc = min(n, ns(0.08, sr))
    c = apply_sos(osc.white(nc, r), butter_sos('lowpass', 2500.0, 2, sr)) * _decay(t[:nc], 0.009) * F32(click)
    y = y + h
    y[:nc] += c
    y = fade(y, 0.0005, min(0.8, dur * 0.2), sr)
    return (y * F32(vel)).astype(F32)


def noise_burst(dur: float = 6.0, lp_start: float = 14000.0, lp_end: float = 150.0, sweep_time: float = 3.0,
                decay: float = 1.5, vel: float = 1.0, seed: int = 0, sr: int = SR) -> np.ndarray:
    """Wide stereo noise blast whose low-pass closes from ``lp_start`` to
    ``lp_end`` (explosion air / shockwave)."""
    r = rng('burst', seed)
    n = ns(dur, sr)
    t = tvec(n, sr)
    x = np.stack([osc.white(n, r), osc.white(n, r)])
    t64 = t.astype(np.float64)
    cut = lp_end + (lp_start - lp_end) * np.exp(-t64 / (sweep_time / 3.0))
    y = sweep(x, 'lowpass', cut, 0.7, block=64, sr=sr, stages=2)
    env = (F32(0.7) * _decay(t, decay) + F32(0.3) * _decay(t, decay * 3)) * (1 - _decay(t, 0.002))
    y *= env
    y = fade(y, 0.0005, min(1.0, dur * 0.2), sr)
    return (y * F32(vel)).astype(F32)


def debris(dur: float = 4.0, density: float = 30.0, vel: float = 0.6, seed: int = 0, sr: int = SR) -> np.ndarray:
    """Falling rocks / debris: a thinning stream of short filtered noise
    grains scattered in stereo."""
    r = rng('debris', seed)
    n = ns(dur, sr)
    out = np.zeros((2, n), F32)
    kernels = []
    for k in range(10):
        nk = ns(r.uniform(0.015, 0.08), sr)
        tk = tvec(nk, sr)
        g = osc.white(nk, r) * _decay(tk, r.uniform(0.004, 0.02))
        g = biquad(g, 'bandpass', r.uniform(300.0, 3500.0), r.uniform(0.8, 2.5), 0, sr)
        g = fade(g, 0.001, 0.002, sr)
        kernels.append(g / (np.max(np.abs(g)) + 1e-9))
    tt = 0.0
    while True:
        rate = density * math.exp(-tt / (dur * 0.35))
        tt += r.exponential(1.0 / max(rate, 1e-3))
        if tt >= dur * 0.95:
            break
        k = kernels[r.integers(len(kernels))]
        a = min(r.pareto(2.5), 2.5) * 0.15 * math.exp(-tt / (dur * 0.5))   # capped: a texture, not stray cracks
        gl, gr = pan_gains(r.uniform(-0.8, 0.8))
        i = ns(tt, sr)
        m = min(len(k), n - i)
        out[0, i:i + m] += k[:m] * F32(a * gl)
        out[1, i:i + m] += k[:m] * F32(a * gr)
    out = fade(out, 0.001, 0.2, sr)
    return (out * F32(vel)).astype(F32)


def impact(vel: float = 1.0, size: float = 1.0, dur: float = 8.0, seed: int = 0, sr: int = SR) -> np.ndarray:
    """Layered cinematic impact: sub boom + huge drum + shockwave noise +
    debris. Stereo."""
    n = ns(dur, sr)
    out = np.zeros((2, n), F32)
    b = sub_boom(dur, 75.0 / size ** 0.3, 25.0, 0.3, 1.6 * size, 1.0, 0.6, 0.4, seed, sr)
    out += b[None, :n] * F32(0.9)
    d = taiko(1.0, 1.3 * size, seed, sr)
    out[:, :d.shape[0]] += d * F32(0.6)
    nb = noise_burst(min(dur, 4.0 * size), 12000.0, 250.0, 1.2 * size, 0.35 * size, 1.0, seed, sr)
    out[:, :nb.shape[-1]] += nb * F32(0.5)
    dbr = debris(min(dur, 4.0 * size), 35.0, 0.9, seed, sr)
    out[:, :dbr.shape[-1]] += dbr * F32(0.5)
    return (out * F32(vel)).astype(F32)


def riser(dur: float, f0: float = 150.0, f1: float = 8000.0, q: float = 2.0, vel: float = 1.0,
          curve: float = 2.0, seed: int = 0, sr: int = SR) -> np.ndarray:
    """Noise riser: pink noise through a band-pass whose centre climbs
    exponentially from ``f0`` to ``f1`` while the level swells."""
    r = rng('riser', seed)
    n = ns(dur, sr)
    u = np.arange(n) / max(1, n - 1)
    x = np.stack([osc.pink(n, r), osc.pink(n, r)])
    fc = f0 * (f1 / f0) ** (u ** 1.3)
    y = sweep(x, 'bandpass', fc, q, block=64, sr=sr)
    y = y + sweep(x, 'highpass', fc * 1.5, 0.7, block=64, sr=sr) * F32(0.25)
    env = (u ** curve).astype(F32)
    y *= env * F32(2.2 * vel)
    y = fade(y, 0.01, 0.004, sr)
    return y.astype(F32)


def shepard(dur: float, rate0: float = 0.25, rate1: float = 1.0, base: float = 40.0, octaves: int = 8,
            center: float = 500.0, sigma: float = 1.2, vel: float = 1.0, crescendo: float = 1.0,
            seed: int = 0, sr: int = SR) -> np.ndarray:
    """Shepard-Risset glissando: octave-spaced tones gliding upward forever
    under a fixed spectral bell curve. Glide speed goes from ``rate0`` to
    ``rate1`` octaves per second (accelerating tension)."""
    r = rng('shepard', seed)
    n = ns(dur, sr)
    t64 = np.arange(n) / sr
    rate = rate0 * (rate1 / rate0) ** (t64 / dur)
    pos = np.cumsum(rate) / sr
    out = np.zeros((2, n), F32)
    c = math.log2(center / base)
    for k in range(octaves):
        p = (k + pos) % octaves
        f = base * np.exp2(p)
        w = np.exp(-0.5 * ((p - c) / sigma) ** 2).astype(F32)
        ph = osc.phase(f, n, sr, r.random())
        y = (osc.sine_ph(ph) + F32(0.15) * osc.sine_ph(2 * ph)) * w
        gl, gr = pan_gains(0.5 * math.sin(k * 2.4))
        out[0] += y * F32(gl)
        out[1] += y * F32(gr)
    env = (1.0 - crescendo + crescendo * (t64 / dur) ** 2).astype(F32)
    out *= env * F32(0.25 * vel)
    out = fade(out, 0.05, 0.004, sr)
    return out


def whoosh(dur: float, f0: float = 200.0, f1: float = 3000.0, peak: float = 0.75, pan_from: float = -0.8,
           pan_to: float = 0.8, q: float = 1.2, vel: float = 1.0, seed: int = 0, sr: int = SR) -> np.ndarray:
    """Pass-by whoosh: band-passed noise that sweeps up (and slightly back
    down after the ``peak`` fraction) while panning across the field."""
    r = rng('whoosh', seed)
    n = ns(dur, sr)
    u = np.arange(n) / max(1, n - 1)
    x = osc.pink(n, r)
    up = np.minimum(u / peak, 1.0)
    down = np.clip((u - peak) / (1 - peak + 1e-9), 0, 1)
    fc = f0 * (f1 / f0) ** (up ** 1.5) * (1 - 0.35 * down)
    y = sweep(x, 'bandpass', fc, q, block=64, sr=sr) * F32(1.6)
    y += sweep(x, 'lowpass', fc * 0.5, 0.7, block=64, sr=sr) * F32(0.35)
    env = np.where(u < peak, (u / peak) ** 2.5, np.exp(-5 * (u - peak) / (1 - peak + 1e-9))).astype(F32)
    y *= env
    p = pan_from + (pan_to - pan_from) * u
    th = (p + 1) * math.pi / 4
    out = np.stack([y * (math.sqrt(2) * np.cos(th)).astype(F32), y * (math.sqrt(2) * np.sin(th)).astype(F32)])
    out = fade(out, 0.01, 0.02, sr)
    return (out * F32(vel)).astype(F32)


def reverse_swell(dur: float = 2.0, bright: float = 1.0, vel: float = 1.0, seed: int = 0, sr: int = SR) -> np.ndarray:
    """Reverse-cymbal swell that peaks at the very end (place it so that
    ``t + dur`` lands on the hit)."""
    r = rng('revswell', seed)
    n = ns(dur, sr)
    t = tvec(n, sr)
    x = np.stack([osc.white(n, r), osc.white(n, r)])
    y = apply_sos(x, butter_sos('highpass', 1800.0, 2, sr))
    y += biquad(x, 'bandpass', 5500.0 * bright, 1.5, 0, sr) * F32(0.8)
    y = apply_sos(y, butter_sos('lowpass', 7000.0 + 6000.0 * bright, 2, sr))
    env = _decay(t, dur / 4.0)[::-1] * (1 - _decay(t, 0.03))
    y = y * env
    y = fade(y, 0.02, 0.003, sr)
    return (y * F32(0.5 * vel)).astype(F32)


def rumble(dur: float, lp: float = 160.0, vel: float = 0.5, attack: float = 1.0, release: float = 2.0,
           seed: int = 0, sr: int = SR) -> np.ndarray:
    """Low rumble: brown noise, low-passed, slowly breathing."""
    r = rng('rumble', seed)
    n = ns(dur, sr)
    x = np.stack([osc.brown(n, r), osc.brown(n, r)])
    y = apply_sos(x, butter_sos('lowpass', lp, 4, sr))
    y = apply_sos(y, butter_sos('highpass', 22.0, 2, sr))
    am = F32(0.65) + F32(0.35) * smooth_noise(n, 0.4, r, sr)
    y *= am
    y = fade(y, attack, release, sr)
    return (y * F32(1.5 * vel)).astype(F32)


def rain(dur: float, density: float = 1.0, vel: float = 0.5, seed: int = 0, sr: int = SR) -> np.ndarray:
    """Rain: thousands of synthesized droplets (tiny rising bubble chirps)
    over a soft hiss and a distant low patter. Stereo, independent L/R."""
    r = rng('rain', seed)
    n = ns(dur, sr)
    out = np.zeros((2, n), F32)
    kern = []
    for k in range(12):
        nk = ns(0.03, sr)
        tk = np.arange(nk) / sr
        f = r.uniform(1800.0, 5500.0) * (1 + 0.8 * tk / 0.03)
        g = (np.sin(TWO_PI * np.cumsum(f) / sr) * np.exp(-tk / r.uniform(0.003, 0.009))).astype(F32)
        kern.append(fade(g, 0.0002, 0.003, sr))
    rate = 500.0 * density
    for c in range(2):
        cnt = int(rate * dur)
        pos = r.integers(0, n, cnt)
        amp = (r.pareto(3.0, cnt) * 0.2 + 0.02).astype(F32)
        which = r.integers(0, len(kern), cnt)
        for k, kk in enumerate(kern):
            sel = which == k
            imp = np.zeros(n, F32)
            np.add.at(imp, pos[sel], amp[sel])
            out[c] += fftconvolve(imp, kk)[:n].astype(F32)
    out = apply_sos(out, butter_sos('highpass', 900.0, 2, sr)) * F32(0.6)
    hiss = np.stack([osc.pink(n, r), osc.pink(n, r)])
    out += apply_sos(hiss, butter_sos('bandpass', (1500.0, 9000.0), 2, sr)) * F32(0.35)
    low = np.stack([osc.brown(n, r), osc.brown(n, r)])
    out += apply_sos(low, butter_sos('bandpass', (120.0, 700.0), 2, sr)) * F32(0.25)
    am = F32(0.8) + F32(0.2) * smooth_noise(n, 0.3, r, sr)
    out *= am
    out = fade(out, 0.5, 0.5, sr)
    return (out * F32(vel)).astype(F32)


def wind(dur: float, strength: float = 1.0, vel: float = 0.5, seed: int = 0, sr: int = SR) -> np.ndarray:
    """Wind: two layers of resonant band-passed noise whose centre wanders,
    with gusting amplitude, plus a faint whistle."""
    r = rng('wind', seed)
    n = ns(dur, sr)
    out = np.zeros((2, n), F32)
    for c in range(2):
        x = osc.pink(n, r)
        cf = 380.0 * np.exp2(1.4 * strength * smooth_noise(n, 0.12, r, sr).astype(np.float64))
        y = sweep(x, 'bandpass', cf, 1.8, block=128, sr=sr) * F32(1.8)
        y += sweep(x, 'bandpass', cf * 3.1, 6.0, block=128, sr=sr) * F32(0.25)
        gust = np.clip(F32(0.55) + F32(0.45) * smooth_noise(n, 0.18, r, sr), 0.05, None)
        out[c] = y * gust
    out = fade(out, 1.0, 1.5, sr)
    return (out * F32(vel)).astype(F32)


def fire(dur: float, intensity: float = 1.0, vel: float = 0.5, seed: int = 0, sr: int = SR) -> np.ndarray:
    """Campfire: bursty crackles (short band-passed noise grains), a
    flickering low roar and a little hiss."""
    r = rng('fire', seed)
    n = ns(dur, sr)
    out = np.zeros((2, n), F32)
    kern = []
    for k in range(10):
        nk = ns(r.uniform(0.002, 0.012), sr)
        g = biquad(osc.white(nk, r), 'bandpass', r.uniform(1500.0, 6500.0), r.uniform(0.7, 2.0), 0, sr)
        g *= _decay(tvec(nk, sr), r.uniform(0.0008, 0.003))
        g = fade(g, 0.0005, 0.001, sr)
        kern.append(g / (np.max(np.abs(g)) + 1e-9))
    flick = np.clip(smooth_noise(n, 0.8, r, sr) * F32(0.7) + F32(0.6), 0.1, None)
    tt = 0.0
    while True:
        tt += r.exponential(1.0 / (14.0 * intensity))
        if tt >= dur:
            break
        burst = 1 + (r.integers(1, 5) if r.random() < 0.25 else 0)
        for b in range(burst):
            t2 = tt + b * r.uniform(0.004, 0.03)
            i = ns(t2, sr)
            if i >= n:
                break
            k = kern[r.integers(len(kern))]
            a = min(r.pareto(2.2), 3.0) * 0.12 + 0.03
            gl, gr = pan_gains(r.uniform(-0.6, 0.6))
            m = min(len(k), n - i)
            out[0, i:i + m] += k[:m] * F32(a * gl)
            out[1, i:i + m] += k[:m] * F32(a * gr)
    roar = np.stack([osc.brown(n, r), osc.brown(n, r)])
    roar = apply_sos(roar, butter_sos('lowpass', 380.0, 2, sr)) * flick * F32(0.5)
    hiss = apply_sos(np.stack([osc.white(n, r), osc.white(n, r)]), butter_sos('highpass', 3500.0, 2, sr)) * flick * F32(0.03)
    out += roar + hiss
    out = fade(out, 0.8, 1.5, sr)
    return (out * F32(vel)).astype(F32)


def shimmer(dur: float, center='A6', spread: float = 12.0, rise: float = 5.0, count: int = 9,
            vel: float = 0.4, seed: int = 0, sr: int = SR) -> np.ndarray:
    """High twinkling cluster of pure tones that slowly rise in pitch
    (``rise`` semitones over ``dur``), each twinkling independently."""
    r = rng('shimmer', seed)
    n = ns(dur, sr)
    t64 = np.arange(n) / sr
    out = np.zeros((2, n), F32)
    c = midi(center)
    for k in range(count):
        m = c + r.uniform(-spread / 2, spread / 2)
        f = midi_to_hz(m) * np.exp2(rise * t64 / dur / 12.0)
        if f[-1] > 17000:
            continue
        y = osc.sine(f, n, sr, r.random())
        tw = np.clip(smooth_noise(n, 3.0, r, sr) * F32(0.8) + F32(0.4), 0, None)
        gl, gr = pan_gains(r.uniform(-0.9, 0.9))
        out[0] += y * tw * F32(gl)
        out[1] += y * tw * F32(gr)
    out = fade(out, dur * 0.3, dur * 0.2, sr)
    return (out * F32(vel / math.sqrt(count) * 0.5)).astype(F32)
