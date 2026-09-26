# Movies

A code-driven studio for cinematic, procedurally animated films. Every frame is rendered by
WebGL2 shaders and every note of the score is synthesized in Python, so a film is just source
code: diffable, reproducible, and renderable on any machine (GPU or not).

**Featured film: [The Arrow of Time](projects/arrow-of-time/)** is the history and future of
everything, from the Big Bang through the Earth, life and humanity to the heat death of the
universe, in 5 minutes 18 seconds.

![Frames from The Arrow of Time](projects/arrow-of-time/poster.jpg)

## Quick start

Requirements: Node 20+, Python 3.10+, ffmpeg, and Chromium for Playwright.

```bash
npm install
npx playwright install chromium          # skip if Chromium is already provided
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

npm run dev                              # interactive preview at http://localhost:5173
npm run audio -- arrow-of-time           # synthesize the score -> out/arrow-of-time/audio/score.wav
npm run render -- arrow-of-time          # 1080p24 film -> out/arrow-of-time/renders/
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Preview player: scrub the timeline, play with the soundtrack, step frames (`Space`, `←/→`, `[`/`]` jump between shots). `?s=1` renders at full resolution, `?mb=1` enables motion blur. |
| `npm run still -- <id> --t 12.5 [--t 30 ...]` | Render PNG stills to `out/<id>/stills/`. Add `--grid` to tile them into one image. |
| `npm run still -- <id> --shot <shotId>` | Contact sheet of frames spread across one shot. |
| `npm run still -- <id> --sheet --from 0 --to 80 --n 40 --cols 8` | Contact sheet of a whole time range. |
| `npm run still -- <id> --t 10 --t 20 --bench --scale 1` | Per-frame render cost, for planning renders. |
| `npm run render -- <id> [--preset draft\|final]` | Render the film. `draft` is half resolution, fast x264 and no motion blur. Rendering is split into 20 s segments that workers pull from a queue; an interrupted render continues with `--resume`. Also takes `--from/--to` seconds, `--workers n`, `--segment s`, `--crf`, `--scale`, `--gl auto\|egl\|vulkan\|swiftshader\|gpu` and `--no-audio`. |
| `npm run release -- <id> [--poster 75]` | Package the latest final render into `releases/<id>/`: the 1080p master, a 720p preview, a poster frame and `info.json`. |
| `npm run audio -- <id>` | Run `projects/<id>/score.py` and write `out/<id>/audio/score.wav`. |
| `npm run new -- <id> --title "My Film"` | Scaffold a new film from `templates/starter`. |
| `npm run typecheck` | TypeScript check of the engine, tools and all projects. |

## How a film is made

1. **Timeline first.** `projects/<id>/timeline.json` holds every beat (start/end, captions) and
   every sync cue (hits, flashes, ignitions). Both the visuals (`project.ts`) and the music
   (`score.py`) read it, so retiming a beat moves the picture, the text and the score together.
2. **Shots.** A shot is a time span plus a `render(ctx)` function that draws HDR light into a
   render target: full-screen GLSL, instanced sprites, or both. Overlapping shots dissolve (`fadeIn`/
   `fadeOut`), and each shot can ask for motion blur (sub-frame accumulation).
3. **Look.** `project.look(t)` animates the post chain over time: exposure kicks, white flashes,
   camera shake, the 2.39:1 letterbox (which opens to full frame for "IMAX" moments), bloom,
   anamorphic streaks, grading, grain and vignette.
4. **Type.** Captions are Canvas2D text items (per-letter reveals, blur-ins, tracking drift,
   superscripts like `10^40`) composited after tonemapping.
5. **Score.** `score.py` uses the `audio/studio` synthesizer (organ, strings, piano, synth brass,
   bells, choir, drums, booms, risers, clock) with convolution reverb and loudness mastering.
6. **Review loop.** Render stills and contact sheets constantly, and look at them before
   committing to a full render.
7. **Render.** Headless Chromium renders frames and streams raw RGBA into ffmpeg (x264,
   Rec.709-tagged), then the soundtrack is muxed in.

## Architecture

```
engine/                 WebGL2 film engine (TypeScript, browser)
  core/engine.ts        frame renderer: shots -> HDR composite -> motion blur -> post -> canvas
  core/types.ts         Project / Shot / Look contracts
  core/anim.ts, math.ts keyframes, easing, envelopes, drift/shake, vectors, matrices, seeded RNG
  core/camera.ts        look-at camera shared by sprites and ray-marched shaders
  gl/                   programs with reflected uniforms, render targets, 3D textures, #include
  post/post.ts          bloom (13-tap down / tent up), streaks, ACES/AgX/neutral, grade, grain, letterbox
  text/                 typography layer and caption builders
  components/           sprites (instanced, flux-conserving: stars, dust, particles), planet (any era
                        of Earth, Mars, the Moon), galaxy (rotating barred spiral)
  shaders/*.glsl        common, noise (value/gradient/fbm/ridged/Worley/warp), color, sdf, stars,
                        camera, creatures and structures (silhouette SDFs: trilobites to people,
                        huts to rockets)
  runtime/              preview player (index.html) and headless renderer (render.html)
audio/studio/           Python synthesizer, effects, theory, mastering (see audio/README.md)
tools/                  render, still, audio and new-project CLIs, plus asset builders
assets/earth/           Earth maps generated from Natural Earth (see assets/earth/README.md)
templates/starter/      skeleton copied by `npm run new`
projects/<id>/          one folder per film: timeline.json, project.ts, shots/, score.py
out/                    renders, stills, audio (git-ignored)
```

### Rendering without a GPU

On Linux machines without a GPU the renderer uses Chromium's ANGLE on Mesa llvmpipe over EGL
(`--gl egl`). On a 4-core CPU that is about 3x faster than SwiftShader and good for roughly
2–5 frames per second at 1080p on typical shots. With a GPU (`--gl gpu`, the default on macOS
and Windows) everything is much faster. Tips:

- Shader programs compile lazily; LLVM compiles big shaders on first use (up to a few
  seconds per program, once).
- Render soft, noisy layers (nebulae, volumes) into a half-resolution target and composite.
- Keep text on the CPU canvas. Canvas `filter: blur()` on software GL costs seconds per frame,
  so the text layer blurs with the shadow path instead.

## Credits and licenses

- Code: this repository.
- Earth maps: derived from [Natural Earth](https://www.naturalearthdata.com/) (public domain).
- Fonts: Cinzel, Jost and Cormorant Garamond via [Fontsource](https://fontsource.org/) (SIL Open Font License).
- Everything else, meaning all imagery and all music, is generated procedurally by this code.
