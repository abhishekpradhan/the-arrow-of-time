"""studio: a small, reusable audio synthesis toolkit for code-driven films.

Modules
-------
core         sample rate, buffers, dB, envelopes, deterministic RNG, Mix/Track timeline
osc          band-limited oscillators (additive wavetables, PolyBLEP) and noise
filters      RBJ biquads, Butterworth helpers, time-varying sweeps, filter inserts
fx           synthesized convolution reverb, chorus, delay, saturation, compressor
instruments  organ, strings, piano, brass, bells, choir, plucks, drums, FX, atmospheres
theory       note names, scales, chords, voicings, voice leading
timeline     timeline.json access and tempo/pulse helpers
master       BS.1770-4 loudness, true peak, limiter, mastering chain
wav          24-bit / float WAV writer and reader
analysis     spectrograms, onset / cut checks, section tables

Typical use (see projects/*/score.py)::

    from studio import Mix, SR, fx, instruments as ins, master, wav
    mix = Mix(60.0)
    mix.reverb('hall', fx.reverb_ir('hall'))
    pno = mix.track('piano', sends={'hall': -10})
    pno.add(1.0, ins.piano('A3', dur=3, vel=0.5))
    y, report = master.master(mix.render(), target_lufs=-14, tp_ceiling=-1)
    wav.write_wav('out.wav', y)
"""
from .core import (SR, Bounce, Clip, Mix, Track, adsr, db, env_points, exp_decay, fade, mono, normalize,
                   ns, pan, pan_gains, rng, smooth_noise, stereo, to_db, width)
from . import analysis, filters, fx, instruments, master, osc, theory, timeline, wav
from .theory import hz, midi, name
from .timeline import Timeline

__all__ = ['SR', 'Bounce', 'Clip', 'Mix', 'Track', 'Timeline', 'adsr', 'db', 'env_points', 'exp_decay', 'fade', 'mono',
           'normalize', 'ns', 'pan', 'pan_gains', 'rng', 'smooth_noise', 'stereo', 'to_db', 'width', 'hz', 'midi',
           'name', 'analysis', 'filters', 'fx', 'instruments', 'master', 'osc', 'theory', 'timeline', 'wav']
