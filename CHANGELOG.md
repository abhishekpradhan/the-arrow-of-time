# Changelog

Notable changes to the studio (engine, tools, audio) and its films. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Film cuts have their own history in
each film's `CHANGELOG.md` (for example [The Arrow of Time](projects/arrow-of-time/CHANGELOG.md))
and are published on the [Releases page](https://github.com/abhishekpradhan/movies/releases).

## [Unreleased]

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
- The Arrow of Time: a 30-second civilization sequence (one river valley over twelve thousand
  years, ray-marched, with a baked terrain texture), binary fission in the cell scene, the main
  theme threaded through the score, and a launch cue.

### Changed

- Released films are published as GitHub Releases instead of being committed with Git LFS
  ([docs/releasing.md](docs/releasing.md)). `releases/` and the LFS rules are gone.
- `tools/check_sync.py` checks the cues named in a timeline's `syncCues` (or every cue).
- Whisper and montage cards honour a beat's `layout`.
- Chromium gets `--disable-dev-shm-usage` in containers (`STUDIO_NO_DEV_SHM`).

### Fixed

- Hairlines under era labels removed; caption collisions at the galaxy merger, the clock and the
  black hole.

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

[Unreleased]: https://github.com/abhishekpradhan/movies/compare/arrow-of-time-v0.2...HEAD
[0.2.0]: https://github.com/abhishekpradhan/movies/releases/tag/arrow-of-time-v0.2
