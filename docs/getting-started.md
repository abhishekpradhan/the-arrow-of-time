# Getting started

## Requirements

| Tool | Version | Used for |
| --- | --- | --- |
| Node.js | 20 or newer | the engine, the preview and the render tools |
| Python | 3.10 or newer | score synthesis (NumPy, SciPy) |
| ffmpeg | any recent build with libx264 | encoding renders |
| Chromium | installed by Playwright | headless rendering |

A GPU is optional. Without one, Linux renders use Mesa's llvmpipe (see [Rendering](rendering.md)).

## Install

```bash
git clone https://github.com/abhishekpradhan/movies.git
cd movies
npm install
npm run setup
```

`npm run setup` creates `.venv` with the Python audio dependencies (`requirements.txt`), installs
Playwright's Chromium, and checks for ffmpeg.

**Linux (Debian/Ubuntu):** `sudo apt install ffmpeg python3-venv`. For CPU-only rendering you
also need Mesa's EGL and DRI drivers: `sudo apt install libegl1 libgl1-mesa-dri`.
**macOS:** `brew install ffmpeg python`.
**Windows:** install ffmpeg (for example `winget install ffmpeg`) and Python from python.org; run
the commands from PowerShell. WSL2 works too.

## Preview

```bash
npm run dev
```

Open http://localhost:5173 and pick a film. The player scrubs the timeline, plays the soundtrack
(once it is synthesized) and steps frame by frame:

| Key | Action |
| --- | --- |
| `Space` | play / pause |
| `←` / `→` | one frame back / forward |
| `[` / `]` | previous / next shot |

Add `?s=1` to the URL for full resolution and `?mb=1` for motion blur. The preview renders at a
reduced resolution by default so it stays interactive.

## Score, stills, and a first render

```bash
npm run audio -- arrow-of-time                          # the score (about 2.5 min on 4 cores)
npm run still -- arrow-of-time --t 70 --t 213 --grid    # two frames, tiled into one PNG
npm run render -- arrow-of-time --preset draft          # half resolution, fast
npm run render -- arrow-of-time                         # final 1080p
```

Outputs go to `out/<id>/` (`audio/`, `stills/`, `renders/`), which git ignores.

## Troubleshooting

- **"ffmpeg not found".** Install ffmpeg and make sure it is on your `PATH`.
- **The render is silent.** Run `npm run audio -- <id>` first; the renderer warns when the score
  is missing.
- **"Framebuffer incomplete" or a black frame on Linux without a GPU.** Install
  `libegl1 libgl1-mesa-dri`, or try `--gl swiftshader` (slower, but always available).
- **The first frame of a shot is slow.** Big shaders are compiled on first use (seconds on a
  CPU); later frames are fast. Benchmarks with `--bench` render each frame twice for this reason.
- **Interrupted render.** Run the same command again with `--resume`; finished segments are
  kept in `out/<id>/segments/`.
- **Python errors in `npm run audio`.** Recreate the venv: `rm -rf .venv && npm run setup`.

Next: [Making a film](making-a-film.md).
