# audio/: code-synthesized film scores

`studio/` is a small numpy/scipy toolkit for writing a film's soundtrack as code.
Nothing is sampled: every instrument, room and effect is synthesized. A score is a
Python script (`projects/<film>/score.py`) that reads the film's `timeline.json`,
so moving a cue there moves the music with the picture.

```bash
npm run audio -- arrow-of-time                      # full render -> out/arrow-of-time/audio/score.wav
npm run audio -- arrow-of-time --from 180 --to 212  # quick partial render (score-180-212.wav)
npm run audio -- arrow-of-time --stems out/arrow-of-time/audio/stems   # + pre-master stems
.venv/bin/python audio/analyze.py out/arrow-of-time/audio/score.wav \
    --timeline projects/arrow-of-time/timeline.json --png out/arrow-of-time/audio/spectrogram.png \
    --onsets bang theia asteroidImpact lastFlash --cut now
```

Setup: `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`.

## Conventions

- 48 kHz (`studio.SR`). Times are seconds and placement is sample-accurate (`round(t * SR)`).
- Buffers are float32: mono `(n,)`, stereo `(2, n)`. Gains are in dB; pan runs from -1 to +1.
- Notes are names (`'A4'`, `'C#5'`, `'Bb2'`) or MIDI numbers. A4 = 440 Hz.
- Randomness always goes through `studio.rng(*keys)`, so renders are reproducible.

## Modules

| module | what |
|---|---|
| `core` | `Mix`/`Track`/`Bounce`, dB helpers, ADSR and breakpoint envelopes, fades, pan/width, `smooth_noise` |
| `osc` | alias-free additive wavetables (saw/square/triangle/pulse/any spectrum), PolyBLEP variants, white/pink/brown noise |
| `filters` | RBJ biquads (LP/HP/BP/notch/peak/shelves/allpass), Butterworth helpers, time-varying `sweep`, inserts `HP`/`LP`/`EQ`/`AutoFilter` |
| `fx` | synthesized convolution reverb IRs (`room`, `chamber`, `plate`, `hall`, `cathedral`; stereo-decorrelated, per-band decay, cached), `Chorus`, `Delay`, `saturate`, `compress`, `Carve` (dynamic EQ that makes room for a percussive element), `Width` |
| `instruments` | clock tick/tock, organ (registrations of 32'…1' ranks), strings, piano, CS-80-style brass, bells (glass/celesta/crystal/church), formant choir, Karplus-Strong pluck, marimba, glass harmonica, pads, drums (taiko, timpani, toms, rim, shaker, taps), sub booms, impacts, risers, Shepard tones, whooshes, reverse swells, rumble, rain, wind, fire, debris, shimmer |
| `theory` | note names and Hz, scales/modes, chord symbols, voicings, voice leading, `legato` (holds common tones) |
| `timeline` | `Timeline` (reads `timeline.json`), `pulses` (event times from a changing tempo), `ramp`, `fit`, `grid` |
| `master` | ITU-R BS.1770-4 loudness (K-weighting, gating), short-term/momentary loudness, LRA, 4x-oversampled true peak, look-ahead limiter, `master()` chain |
| `wav` | 24-bit PCM / 32-bit float WAV writer (streamed) and reader |
| `analysis` | spectrogram PNG, hit onset / hard-cut detection, per-section tables, click finder |

## Writing a score

```python
from studio import Mix, Timeline, fx, filters as flt, instruments as ins, master, wav

tl = Timeline.load('projects/film/timeline.json')
mix = Mix(tl.duration)
mix.reverb('hall', fx.reverb_ir('hall'), hp=180)          # send is high-passed: no muddy reverb
organ = mix.track('organ', fx=[flt.HP(36)], sends={'hall': -7})
organ.add(tl.cue('bang'), ins.organ(['A2', 'E3', 'A3', 'C4'], dur=8, reg='full'), gain_db=-3)
mix.cut(tl.cue('now'))                                     # hard cut: sounds *and* reverb tails stop
y, report = master.master(mix.render(), target_lufs=-14, tp_ceiling=-1)
wav.write_wav('out/film/audio/score.wav', y)
```

- **Hard cuts.** `Mix.cut(t)` renders each track in segments, so everything that started
  before `t` (insert effects and reverb tails included) stops at `t` with a 4 ms fade, while
  anything placed after `t` plays normally. Cuts can target track groups, for example
  `mix.cut(t, groups=['music'])`.
- **Tracks** hold clips. At render time they are summed, run through their insert chain
  (callables `f(x, t0)`), scaled by the fader (plus optional `volume()` automation) and sent
  post-fader to reverb buses. Rendering is chunked and reuses one scratch buffer, so the
  318 s *Arrow of Time* score (18 tracks, ~1,300 synthesized notes and events, three
  convolution reverbs) renders in about two minutes on 4 cores; partial renders take seconds.
- **Mastering.** `master()` applies gentle glue compression, then iterates make-up gain plus a
  true-peak limiter until the output meets the LUFS target and true peak is at or below the ceiling.
  The report includes where the limiter worked hardest (`limiter_events`).

## Verifying without listening

`audio/analyze.py` prints duration, NaN/inf, clipping, DC offset, integrated loudness, LRA,
true peak, the onset error at each named cue (`--onsets`), hard-cut checks (`--cut`), and a
per-section level table. It can also write a spectrogram with a loudness strip and section
marks (`--png`). Use `--stems` renders to see which track dominates a moment.
