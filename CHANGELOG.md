# Changelog

Every version of *The Arrow of Time*: the film, and the engine, tools and synthesizer that make
it. Releases start with v1.0 and are published on the
[Releases page](https://github.com/abhishekpradhan/the-arrow-of-time/releases); the newest section
here becomes the release notes. The working cuts before it (v0.1 to v0.4) are recorded below. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [v1.0] - 2026-09-28

The finished film: 6:12, from the Big Bang to the end of time, and the repository becomes the
film's own.

### The film

- **The space race** is the new centrepiece: 36 seconds from Baikonur to the Sea of
  Tranquility with the letterbox open to full frame. The camera cranes up after the painted R-7
  into the cloud over the pad and comes out above it in 3D: the rocket bursts through a moonlit
  cloud deck, its fire glowing inside the cloud, and climbs across the face of the gibbous Moon
  (it was ten days old that night) on a long lens. At 45 km, in slow motion, the four boosters
  peel away in the Korolev cross over the curve of the Earth. In orbit over the night side the
  fairing splits and Sputnik springs off, antennas swinging out, beeping, and the camera eases
  round behind it in one long, slow arc as the Sun breaks over the limb through a red and blue
  dawn arc. Through the glare the film dissolves to the other side, where the polished sphere
  blazes like a star, and the camera draws back and turns to the gibbous Moon beyond it.
- **1957 is Sputnik's year**: the Saturn V under the 1957 card is gone; the R-7 that carried
  Sputnik stands in its "tulip" at Baikonur, and the arms swing open as it lifts off.
- **The Moon landing** is photographic 3D: Eagle, gold foil and all, comes down over a cratered
  Sea of Tranquility in the low morning Sun, its exhaust tearing a radial sheet of dust across the
  plain until the engine stops and the dust is gone. The film holds on the lander while
  Armstrong's own voice comes in over the radio (NASA's recording: "Houston, Tranquility Base
  here. The Eagle has landed."), and the 1969 card arrives with the reflection that follows. The
  camera drifts round and looks up to the Earth in the black sky, gibbous as it was that day and
  turned to the Americas, and closes in on it as it dissolves slowly into the Earth of today.
- **Civilization** is rebuilt from the ground up in the painted, silhouette style of the life
  scenes: twelve thousand years as one day and one continuous tracking shot. Dawn over wild
  wheat, a woman reaping with a flint sickle; morning in Uruk, reed boats on the canal below the
  White Temple; a scribe pressing cuneiform into a clay tablet, seen over his shoulder; Giza at
  noon in its white casing, a gang hauling a block; the Acropolis in the afternoon sun above the
  Aegean; Mainz at sunset, pages streaming from Gutenberg's window over the town; dusk over a
  mill town, a train crossing the viaduct; the Wright Flyer against the last of the light;
  Trinity at night, cut in on its flash; and the launch. Each age is wiped in by something passing
  close to the lens: a palm, a city wall, quarried blocks, a column, a cathedral pier, a chimney,
  a telegraph pole, a floodlight mast.
- **Homo sapiens** now happens at dusk on the savanna in the manner of the life scenes: giraffes
  and acacias against the afterglow, a band round a fire on a granite outcrop, one standing and
  a child pointing as a meteor crosses the open sky. The meteor no longer strobes: its head is
  drawn as the streak it covers in each exposure and it leaves a fading train.
- **The Moon** forms closer to the camera: the ejecta are embers of every size, streaked by
  motion blur, and the molten crusts crack unevenly.
- **Score**: a whoosh with every civilization wipe, and the stylus taps and the press's thud on
  their pictures. The theme's first two bars carry the launch at the clock's own tempo so that
  bar 3 lands on the staging; the clock falls silent above the clouds; Sputnik's beeps play over a
  held glass-harmonica note; C major and theme bar 5 break with the orbital sunrise, bar 6's high
  A with the Moon; a pulse, Houston's Quindar tones and the engine's rumble carry the descent. At
  touchdown the engine stops and the tension opens into F major 7, which sinks to a hush under
  Armstrong's voice; then, in a moment of reflection, the theme's first two bars on a far piano
  over that chord, whose last note becomes the A minor of night Earth, where the clock comes back
  from far away and the orchestra builds again to NOW.
- **Credits**: a closing card after the final title, over black and in silence: the film was
  made entirely in code, and it names what it borrows (NASA's Apollo 11 audio, Natural Earth,
  the Hipparcos catalogue, SWIFT, the typefaces).

### Engine and tools

#### Added

- `figures` shader chunk: people and four-legged animals posed from a few joints (two-bone IK),
  with walk, run, sit, point, reap, haul, carry and speaking poses, dress, and animal species
  ([docs/engine.md](docs/engine.md#painted-scenes)).
- `illustration` shader chunk: painted skies from the sun's elevation (night to midday), haze for
  distant silhouettes, rim light, clouds, mist and smoke.
- `sdDatePalm` and `sdCypress` in `creatures`.
- `Atmosphere` component and `atmosphere` shader chunk: a planet's sky, limb and shadow from
  single scattering (Rayleigh, Mie, ozone) over a baked transmittance table; skies from the
  ground, sunrise arcs from orbit, the colour of sunlight at any point
  ([docs/engine.md](docs/engine.md#atmosphere)).
- Light shafts in the post chain (`Look.rays`, `raysCenter`, `raysThreshold`, `raysDecay`,
  `raysTint`).
- `Shot.motionBlur` may be a function of film time; the frame takes the most samples any shot on
  screen asks for.
- `MOVIES_BROWSER`: render with an installed browser (a Playwright channel such as `chrome`, or
  an executable path) when Playwright's own Chromium is not available
  ([docs/rendering.md](docs/rendering.md#gpu-or-cpu)).
- NASA's Apollo 11 recording in `assets/apollo11/`, built by `tools/assets/build_apollo11.py`.

#### Changed

- `Planet`'s molten mode: cracks of uneven width, some choked with cooled crust, with heat
  bleeding into the plates beside them.
- Anamorphic streaks: taps a texel and a half apart with bilinear filtering, so a point of light
  (the Sun on a limb) draws a continuous line instead of a row of dots.
- `tools/retime.py` also moves the times cards leave (`until`, `captionUntil`), and it and
  `tools/check_sync.py` default to the film's timeline.

#### Removed

- The ray-marched civilization scenes and 3D Moon landing of v0.4, and the painted Moon landing
  and first step that briefly replaced it.
- The Khronos "neutral" tone mapper (unused, and the only Apache-licensed code).

### The repository

- The repository is the film's own, renamed from `movies` to `the-arrow-of-time`: the film is
  in `film/` (was `projects/arrow-of-time/`); the starter template and `npm run new` are gone;
  the CLIs take no project id (`npm run render`, `npm run still -- --t 12`, `npm run audio`,
  `npm run release`) and write to `out/`; releases are tagged `v1.0`, `v1.1`, ...
- Licensing: all code, including the film's shots, shaders and score code, is under the MIT
  License (it was Apache-2.0, and the film's code was CC BY 4.0). The film as a work (the video,
  its soundtrack, stills and script) stays CC BY 4.0, and NASA's recording is excluded from it.
- CI synthesizes the film's score and checks its hits and cuts against the timeline.
- Docs rewritten around the film: a making-of, the score, and a guide to working on it.

## v0.4 - 2026-09-27

### The film

- **Civilization** is rebuilt as ten scenes, one per card, each a ray-marched set with its own
  light and a moving camera: a reaper with a flint sickle in wild wheat at golden hour, the White
  Temple of Uruk at dusk, a scribe's stylus pressing cuneiform into wet clay, the pyramids of Giza
  in their white limestone casing, a Doric colonnade at sunset, printed pages of Genesis drying
  above Gutenberg's press, a night train on a viaduct under mill chimneys, the Wright Flyer over
  Kill Devil Hills, the Trinity fireball, and a Saturn V lifting off under searchlights. The cards
  now read 2500 BCE for the pyramids (when all three stood) and 1830 for industry (the railway
  age).
- **The Moon landing** is a 3D scene: the lunar module on a cratered plain under a low Sun, an
  astronaut stepping off the ladder onto the regolith on the beat, a bootprint, a kick of dust
  on ballistic arcs, the flag, and the real Earth above the horizon as the camera cranes back.
- **The Moon** forms in one continuous shot. The molten Earth stays the same planet from its
  card to the young Moon: the camera pulls back as Theia, another magma world, falls in on the
  orbit traced back from the simulation, and hands over to its simulated parcels at contact.
  The same camera carries through to years later, so the dissolve lines up.
- **Score**: the civilization no longer stops dead before the launch. The build, the clock and
  every tail run into the ignition; the engines' roar falls silent with the cut to the Moon,
  where there is no air to carry it. Scene sounds land on their pictures: the stylus in the
  clay, the platen of the press, a steam whistle and the chuff of the train, a thud at Trinity.
- **Homo sapiens**: the caption sits in the sky, clear of the people and the fire; a meteor
  crosses the Milky Way above them.
- **Prologue**: motes of light drift in towards the point before the Big Bang.

### Engine and tools

#### Added

- `sdf3` and `march` shader chunks: 3D distance-field primitives with limited repetition, and a
  ray marcher with normals, soft shadows (`SHADOW_MIN_STEP` for thin parts), ambient occlusion,
  sky and fog, for ray-marched scenes ([docs/engine.md](docs/engine.md#ray-marched-scenes)).
- Motion-blur samples jitter camera rays by a sub-pixel Halton offset (`uJitter` in `camRay`),
  so `motionBlur` also anti-aliases ray-marched shots.
- `PlanetParams.opacity` fades a planet, for hand-overs to particle simulations.
- Instruments: `steam_whistle` and `chuff`.
- The Unifraktur Maguntia font (OFL-1.1, `@fontsource/unifrakturmaguntia`) for the printed page.

## v0.3 - 2026-09-27

### The film

- **The Moon** now comes from a real simulation. An SPH run (SWIFT, 61,139 particles) of Theia
  striking the proto-Earth plays back particle by particle: the graze, the remnant's return and
  second impact six hours later, and the long arm that breaks into clumps and a disk. Every parcel
  glows at its simulated temperature. Then, years later, the molten Earth and the newborn Moon,
  which recedes as the oceans form. The sequence is four seconds longer; the film runs 5:38.
- **Civilization** is a new 30-second sequence: one river valley over twelve thousand years,
  from the first fields to the first rocket. A grid city grows and rebuilds itself taller with
  each age, and the pyramids, a temple, a cathedral, industry and a coastal launch pad rise on
  schedule. Days race past between the cards.
- **The Moon landing** has a lander, a flag and an astronaut, lit by a low Sun.
- **Cells**: binary fission of a rod-shaped microbe. It has no nucleus (life 3.8 billion years
  ago was prokaryotic); a DNA tangle is copied and pulled apart and an FtsZ ring pinches the cell.
  The two daughters differ; the old scene mirrored one cell.
- **Snowball Earth**: the last open water breaks up as the ice closes.
- **Score**: the main theme runs through the whole film, and a 42-second build carries the
  civilization sequence into the launch. The Moon section follows the simulation, with a second
  hit when Theia's remnant returns.
- **Captions**: no hairlines under the era labels, and the Cambrian card is back at lower centre.
  The galaxy-merger, clock and black-hole cards moved clear of their subjects.

### Engine and tools

#### Added

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
- **Giant-impact data** (`assets/giant-impact/`): a SWIFT simulation of the Moon-forming impact,
  with its recipe and post-processing scripts in `tools/assets/giant_impact/` and a packer,
  `tools/assets/build_giant_impact.py`. Packing predicts each frame from the last two and stores
  the residuals, which keeps 20k particles over 138 frames to 7.5 MB.
- `spline()` in the engine: monotone cubic keyframes (no jumps in speed, no overshoot), for time
  remaps and camera moves.
- `tools/retime.py` inserts or removes time in a `timeline.json` (beats, cues, lists), keeping its
  layout.

#### Changed

- Released films are published as GitHub Releases instead of being committed with Git LFS
  ([docs/releasing.md](docs/releasing.md)). `releases/` and the LFS rules are gone.
- `tools/check_sync.py` checks the cues named in a timeline's `syncCues` (or every cue).
- Whisper and montage cards honour a beat's `layout`.
- Chromium gets `--disable-dev-shm-usage` in containers (`STUDIO_NO_DEV_SHM`).

#### Fixed

- Hairlines under era labels removed; caption collisions at the galaxy merger, the clock and the
  black hole.
- Sprites held at their minimum on-screen size now scale their opacity as well as their colour,
  so premultiplied sprites no longer darken what is behind them.
- CI compiles every Python tool.

## v0.2 - 2026-09-27

### The film

- Rebuilt the Moon-forming impact, the Chicxulub impact and the red giant.
- Captions placed scene by scene, in each shot's negative space; jitter-free text from a
  sub-pixel glyph cache; an end credit.

### Engine and tools

#### Added

- Sub-pixel glyph cache for jitter-free captions (`drawText`, `drawGlyph`) and `--textonly` stills.
- Per-beat caption layouts with a scrim that follows the card; `Camera.pan()`.
- Planet impacts that scale to planet size, `planetLocal()`, depth-tested planets, dust veils.
- Licensing: Apache-2.0 for code (with `NOTICE`), CC BY 4.0 for films, `THIRD_PARTY_NOTICES.md`,
  contribution terms (DCO).
- `npm run release` distribution encodes.

#### Changed

- Bloom downsample rewritten (13-tap with Karis averaging).

## v0.1 - 2026-09-26

### The film

- First cut: 5:18 from the Big Bang to the end of time, with an original synthesized score.

### Engine and tools

#### Added

- The WebGL2 film engine: shots, dissolves, motion blur, HDR post-processing, letterbox, captions,
  sprites, planets and galaxies, and a GLSL library.
- The preview player and the headless renderer (Playwright, ffmpeg, segmented and resumable).
- `audio/studio`: a synthesizer, effects, convolution reverb, music theory helpers, BS.1770
  loudness mastering and analysis.
- `npm run new` and the starter template.

[v1.0]: https://github.com/abhishekpradhan/the-arrow-of-time/releases/tag/v1.0
