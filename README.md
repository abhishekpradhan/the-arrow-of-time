<div align="center">

# Movies

**A code-driven film studio.** Every frame is a WebGL2 shader, every note of the score is
synthesized in Python, and one timeline file keeps picture, captions and music in sync.
A film is source code: diffable, reproducible, forkable, and renderable on any machine, GPU or not.

[![CI](https://github.com/abhishekpradhan/movies/actions/workflows/ci.yml/badge.svg)](https://github.com/abhishekpradhan/movies/actions/workflows/ci.yml)
[![Code: Apache-2.0](https://img.shields.io/badge/code-Apache--2.0-blue.svg)](LICENSE)
[![Films: CC BY 4.0](https://img.shields.io/badge/films-CC%20BY%204.0-lightgrey.svg)](LICENSES/CC-BY-4.0.txt)
![Node 20+](https://img.shields.io/badge/node-%E2%89%A520-339933.svg)
![Python 3.10+](https://img.shields.io/badge/python-%E2%89%A53.10-3776AB.svg)

![Frames from The Arrow of Time](projects/arrow-of-time/poster.jpg)

</div>

## The Arrow of Time

The featured film, **[The Arrow of Time](projects/arrow-of-time/)**, tells the history and future
of everything in 5 minutes 38 seconds: the Big Bang, the first stars, the birth of the Sun and the
Moon, four billion years of life, twelve thousand years of civilization in ten scenes from the
first fields to the first steps on the Moon, and onward to the red giant Sun, the last stars and
the heat death of the universe.

**[Watch the latest cut on the Releases page](https://github.com/abhishekpradhan/movies/releases)**
(1080p, a 720p preview and a poster). The film is CC BY 4.0: re-cut it, translate it, remix it,
with credit.

## Highlights

- **Everything is code.** No footage, samples or stock assets: shaders, ray marching, sprites and
  a small synthesizer make every pixel and every sound.
- **Real science where it counts.** The Moon-forming impact is a smoothed-particle
  hydrodynamics simulation run for the film (SWIFT, 61,139 particles; [recipe](tools/assets/giant_impact/README.md)),
  played back parcel by parcel at its simulated temperatures. The present-day Earth comes from
  Natural Earth maps, and the drifting Big Dipper follows Hipparcos proper motions.
- **One source of timing.** `timeline.json` drives shots, captions and the score. Move a beat and
  the picture, the text and the music move with it.
- **Cinematic post.** HDR rendering, bloom, anamorphic streaks, ACES tonemapping, grading, grain,
  motion blur, and a 2.39:1 letterbox that opens to full frame for the biggest moments.
- **Jitter-free typography.** Captions are composited from a sub-pixel glyph cache and placed in
  each shot's negative space.
- **A synthesized score.** Organ, strings, piano, synth brass, bells, choir, drums and effects,
  with convolution reverb and mastering to -14 LUFS / -1 dBTP, verified by analysis (onsets, cuts,
  loudness) rather than by ear.
- **Renders anywhere.** Headless Chromium on a GPU, or Mesa llvmpipe on a plain CPU; or dozens of
  containers at once [on Modal](docs/modal.md), for minutes and about a dollar per film.

## Quick start

You need Node 20+, Python 3.10+ and ffmpeg. See [Getting started](docs/getting-started.md) for
details per platform.

```bash
git clone https://github.com/abhishekpradhan/movies.git && cd movies
npm install
npm run setup                          # Python venv for the audio, Playwright's Chromium, ffmpeg check

npm run dev                            # interactive preview at http://localhost:5173
npm run audio -- arrow-of-time         # synthesize the score  -> out/arrow-of-time/audio/score.wav
npm run render -- arrow-of-time        # render the 1080p film -> out/arrow-of-time/renders/
```

Start your own film with `npm run new -- my-film --title "My Film"` and follow
[Making a film](docs/making-a-film.md).

## Documentation

| Guide | What it covers |
| --- | --- |
| [Getting started](docs/getting-started.md) | Install, first preview, first render, troubleshooting |
| [Making a film](docs/making-a-film.md) | Timeline, shots, captions, score, the review loop |
| [The engine](docs/engine.md) | Shots, the camera, sprites, planets and galaxies, shader includes, post, text |
| [Audio](audio/README.md) | The synthesizer, mixing, mastering, verifying without listening |
| [Rendering](docs/rendering.md) | Presets, CPU and GPU rendering, performance, 4K |
| [Rendering on Modal](docs/modal.md) | Parallel cloud renders, caching, costs, the GitHub workflow |
| [Releasing a film](docs/releasing.md) | Distribution encodes and GitHub Releases |
| [CLAUDE.md](CLAUDE.md) | Conventions and hard-won pitfalls, for humans and AI assistants alike |

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Preview player: scrub, play with sound, step frames (`Space`, `←`/`→`, `[`/`]` between shots). `?s=1` renders at full resolution, `?mb=1` enables motion blur. |
| `npm run still -- <id> --t 12.5 [--t 30 ...] [--grid]` | Still frames (PNG), optionally tiled into one image. `--sheet --from 0 --to 80 --n 40` makes a contact sheet; `--bench --scale 1` measures the cost per frame; `--textonly` shows captions over black. |
| `npm run render -- <id> [--preset draft\|final]` | Render the film. Segments are rendered by parallel workers and resumable (`--resume`); `--from/--to` or `--frames a:b` render a range. |
| `npm run audio -- <id> [--from s --to s]` | Synthesize the score (a partial window renders in seconds). |
| `npm run release -- <id>` | Distribution encodes of the latest render (1080p, 720p preview, poster, checksums; 2160p from a 4K master). |
| `npm run new -- <id> --title "..."` | Scaffold a new film from `templates/starter`. |
| `npm run typecheck` | Type-check the engine, tools and every film (CI runs it on every push). |
| `modal run tools/modal/studio.py --project <id>` | Render on Modal ([guide](docs/modal.md)); the *Render on Modal* workflow does the same from GitHub. |

## How it works

```text
timeline.json ──► project.ts ──► shots (GLSL, sprites, ray marching) ──► HDR composite ──► post ──► frame
      │                 └──────► captions (glyph cache, per-beat layout) ─────────────────────┘
      └──────────────► score.py ──► audio/studio synth ──► mix ──► master ──► score.wav ──┐
                                                                                          ▼
                      headless Chromium ──► raw RGBA ──► ffmpeg (x264) ──────────────► film.mp4
```

```text
engine/            WebGL2 film engine (TypeScript): renderer, camera, post, text, components, GLSL library
audio/studio/      Python synthesizer, effects, music theory, loudness mastering, analysis
tools/             render, still, audio, release and scaffolding CLIs; Modal pipeline (tools/modal/);
                   asset builders and the impact simulation's recipe (tools/assets/)
projects/<id>/     one folder per film: timeline.json, project.ts, shots/, shaders/, score.py
templates/starter/ the skeleton copied by `npm run new`
assets/            data the films load: Earth maps (Natural Earth), the giant-impact simulation
docs/              guides
out/               renders, stills and audio (git-ignored)
```

## Contributing

Fixes, engine features, new films and re-cuts are all welcome. Read
[CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md); report security
issues as described in [SECURITY.md](SECURITY.md). Changes are listed in the
[CHANGELOG](CHANGELOG.md).

## License

- **Code** (engine, tools, audio synthesizer, templates): [Apache License 2.0](LICENSE). Keep the
  [`NOTICE`](NOTICE) file with copies and forks, and mark files you change.
- **Films** (each `projects/<id>/` folder and its released renders): [CC BY 4.0](LICENSES/CC-BY-4.0.txt).
  For *The Arrow of Time*, credit "*The Arrow of Time* by Abhishek Pradhan,
  https://github.com/abhishekpradhan/movies, CC BY 4.0" and say what you changed
  ([details](projects/arrow-of-time/LICENSE.md)).
- **Third-party** snippets, data and fonts are listed with their licenses in
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Earth maps derive from
  [Natural Earth](https://www.naturalearthdata.com/) (public domain); the giant-impact data is our
  own simulation, made with SWIFT, WoMa and SEAGen, which are credited but not redistributed; the
  fonts (Cinzel, Jost, Cormorant Garamond, via [Fontsource](https://fontsource.org/)) are under the
  SIL Open Font License.
