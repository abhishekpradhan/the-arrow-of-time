# Changelog

Notable changes to the studio (engine, tools, audio) and its films. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Film cuts have their own history in
each film's `CHANGELOG.md` (for example [The Arrow of Time](projects/arrow-of-time/CHANGELOG.md))
and are published on the [Releases page](https://github.com/abhishekpradhan/movies/releases).

## [Unreleased]

### Added

- `figures` shader chunk: people and four-legged animals posed from a few joints (two-bone IK),
  with walk, run, sit, point, reap, haul, carry and speaking poses, dress, and animal species
  ([docs/engine.md](docs/engine.md#painted-scenes)).
- `illustration` shader chunk: painted skies from the sun's elevation (night to midday), haze for
  distant silhouettes, rim light, clouds, mist and smoke.
- `sdDatePalm` and `sdCypress` in `creatures`.
- Light shafts in the post chain (`Look.rays`, `raysCenter`, `raysThreshold`, `raysDecay`,
  `raysTint`).
- `Shot.motionBlur` may be a function of film time; the frame takes the most samples any shot on
  screen asks for.
- `MOVIES_BROWSER`: render with an installed browser (a Playwright channel such as `chrome`, or
  an executable path) when Playwright's own Chromium is not available
  ([docs/rendering.md](docs/rendering.md#gpu-or-cpu)).
- The Arrow of Time v0.5: the civilization and the Moon landing painted in the style of the life
  scenes, the R-7 and Sputnik under the 1957 card, Homo sapiens at dusk with a meteor that no
  longer strobes (see its [changelog](projects/arrow-of-time/CHANGELOG.md)).
- `Atmosphere` component and `atmosphere` shader chunk: a planet's sky, limb and shadow from
  single scattering (Rayleigh, Mie, ozone) over a baked transmittance table; skies from the
  ground, sunrise arcs from orbit, the colour of sunlight at any point
  ([docs/engine.md](docs/engine.md#atmosphere)).
- The Arrow of Time v0.6: the space race in 3D, from the R-7 climbing out of the clouds to Sputnik
  in an orbital sunrise and Apollo 11's landing, held under Armstrong's own voice (NASA's
  recording, in `assets/apollo11/`) before a slow dissolve home to the Earth of today.
- `tools/retime.py` also moves the times cards leave (`until`, `captionUntil`).

### Changed

- `Planet`'s molten mode: cracks of uneven width, some choked with cooled crust, with heat
  bleeding into the plates beside them.
- Anamorphic streaks: taps a texel and a half apart with bilinear filtering, so a point of light
  (the Sun on a limb) draws a continuous line instead of a row of dots.

### Removed

- The Arrow of Time's ray-marched civilization scenes (`age-*.glsl`, `shots/ages.ts`) and 3D Moon
  landing (`apollo.glsl`), replaced by the painted ones; in v0.6 the painted Moon landing
  (`moonstep.glsl`) and the old Sputnik pass (`sputnik.glsl`) gave way to the 3D space race.

## [0.4.0] - 2026-09-27

### Added

- `sdf3` and `march` shader chunks: 3D distance-field primitives with limited repetition, and a
  ray marcher with normals, soft shadows (`SHADOW_MIN_STEP` for thin parts), ambient occlusion,
  sky and fog, for ray-marched scenes ([docs/engine.md](docs/engine.md#ray-marched-scenes)).
- Motion-blur samples jitter camera rays by a sub-pixel Halton offset (`uJitter` in `camRay`),
  so `motionBlur` also anti-aliases ray-marched shots.
- `PlanetParams.opacity` fades a planet, for hand-overs to particle simulations.
- Instruments: `steam_whistle` and `chuff`.
- The Arrow of Time: ten ray-marched civilization scenes, a 3D Moon landing, and one continuous
  shot from the molten Earth to the young Moon (see its [changelog](projects/arrow-of-time/CHANGELOG.md)).
- The Unifraktur Maguntia font (OFL-1.1, `@fontsource/unifrakturmaguntia`) for the printed page.

### Removed

- The Arrow of Time's single-valley civilization sequence (`valley.glsl`), replaced by the
  scenes above.

## [0.3.0] - 2026-09-27

### Added

- **Modal render pipeline** (`tools/modal/studio.py`, [docs/modal.md](docs/modal.md)): CPU
  containers render slices of a film in parallel with the same renderer as local renders,
  slices and scores are cached by source hash, `--window` re-renders one sequence, and release
  encodes run in parallel. It runs as an ephemeral app and never touches other Modal apps.
- **Render on Modal** GitHub workflow: render from the Actions tab and optionally publish a GitHub
  Release.
- `npm run release` variants (`--variants 2160p,1080p,720p,poster`), checksums (`SHA256SUMS`),
  and `tools/release_notes.py` for release notes from a film's changelog.
- `npm run render -- --frames a:b` for exact frame ranges.
- Guides in `docs/`: getting started, making a film, the engine, rendering, Modal, releasing.
- `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue and pull-request templates.
- The Arrow of Time: the Moon-forming impact from an SPH simulation, a 30-second civilization
  sequence (one river valley over twelve thousand years, ray-marched, with a baked terrain
  texture), binary fission in the cell scene, the main theme threaded through the score, and a
  launch cue.
- **Giant-impact data** (`assets/giant-impact/`): a SWIFT simulation of the Moon-forming impact,
  with its recipe and post-processing scripts in `tools/assets/giant_impact/` and a packer,
  `tools/assets/build_giant_impact.py`. Packing predicts each frame from the last two and stores
  the residuals, which keeps 20k particles over 138 frames to 7.5 MB.
- `spline()` in the engine: monotone cubic keyframes (no jumps in speed, no overshoot), for time
  remaps and camera moves.
- `tools/retime.py` inserts or removes time in a `timeline.json` (beats, cues, lists), keeping its
  layout.

### Changed

- Released films are published as GitHub Releases instead of being committed with Git LFS
  ([docs/releasing.md](docs/releasing.md)). `releases/` and the LFS rules are gone.
- `tools/check_sync.py` checks the cues named in a timeline's `syncCues` (or every cue).
- Whisper and montage cards honour a beat's `layout`.
- Chromium gets `--disable-dev-shm-usage` in containers (`STUDIO_NO_DEV_SHM`).

### Fixed

- Hairlines under era labels removed; caption collisions at the galaxy merger, the clock and the
  black hole.
- Sprites held at their minimum on-screen size now scale their opacity as well as their colour,
  so premultiplied sprites no longer darken what is behind them.
- CI compiles every Python tool.

## [0.2.0] - 2026-09-27

### Added

- Sub-pixel glyph cache for jitter-free captions (`drawText`, `drawGlyph`) and `--textonly` stills.
- Per-beat caption layouts with a scrim that follows the card; `Camera.pan()`.
- Planet impacts that scale to planet size, `planetLocal()`, depth-tested planets, dust veils.
- Licensing: Apache-2.0 for code (with `NOTICE`), CC BY 4.0 for films, `THIRD_PARTY_NOTICES.md`,
  contribution terms (DCO).
- `npm run release` distribution encodes.

### Changed

- The Arrow of Time: rebuilt Moon-forming impact, Chicxulub impact and red giant; an end credit.
- Bloom downsample rewritten (13-tap with Karis averaging).

## [0.1.0] - 2026-09-26

### Added

- The WebGL2 film engine: shots, dissolves, motion blur, HDR post-processing, letterbox, captions,
  sprites, planets and galaxies, and a GLSL library.
- The preview player and the headless renderer (Playwright, ffmpeg, segmented and resumable).
- `audio/studio`: a synthesizer, effects, convolution reverb, music theory helpers, BS.1770
  loudness mastering and analysis.
- `npm run new` and the starter template.
- *The Arrow of Time*, first cut.

[Unreleased]: https://github.com/abhishekpradhan/movies/compare/arrow-of-time-v0.3...HEAD
[0.3.0]: https://github.com/abhishekpradhan/movies/releases/tag/arrow-of-time-v0.3
[0.2.0]: https://github.com/abhishekpradhan/movies/releases/tag/arrow-of-time-v0.2
