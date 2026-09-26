# CLAUDE.md

Guidance for working in this repository: a code-driven film studio (WebGL2 engine, Python
score synthesis, headless rendering). Read `README.md` for the overview and commands.

## Layout

- `engine/`: reusable film engine (TypeScript, browser). Public API: `@engine` (`engine/index.ts`).
- `audio/studio/`: reusable Python synthesizer and mastering (`audio/README.md`).
- `tools/`: Node CLIs (`render`, `still`, `audio`, `new-project`) and `tools/assets/` builders.
- `projects/<id>/`: one film per folder. `timeline.json` + `project.ts` + `shots/` + `score.py`.
- `templates/starter/`: copied by `npm run new -- <id>`.
- `out/`: all generated media (git-ignored). `releases/` holds published films (Git LFS).

## Workflow and conventions

- **Timing lives in `timeline.json`.** Beats (start/end/caption text) and cues (sync points) are
  read by the shots, the captions and `score.py`. Never hard-code a time that exists there.
- **Shots are shots.** Each shot owns its whole frame (background included) and renders HDR,
  linear light into `c.target`. Overlap shots with `fadeIn`/`fadeOut` to dissolve. In
  `projects/arrow-of-time`, `span(id, { dIn, dOut })` centres dissolves on beat boundaries and
  `bt(c, id)` gives time since a beat began.
- **Full-screen shaders**: `c.fullscreen(c.e.program(SRC, 'name'), uniforms)`. Standard uniforms
  are `uRes` (the bound target's size), `uTime` (shot-local), `uDur`, `uProg`, `uGTime`
  (global), `uAspect` and `uScale`. Use `centered(vUv, uAspect)`: y spans [-0.5, 0.5]. With the
  2.39:1 letterbox only |y| < 0.372 is visible, so keep subjects inside it.
- **GLSL includes**: `#include <common|noise|color|sdf|stars|camera>`. Project chunks are
  registered with a prefix (`#include <aot/planet>`-style) from `projects/<id>/shaders/*.glsl`.
- **Camera**: `engine/core/camera.ts` feeds both sprites and ray-marched shaders
  (`...cam.uniforms()` plus `#include <camera>` and `camRay(p)`). The chunk declares
  `uCamPos, uCamFwd, uCamRight, uCamUp, uTanHalfFov, uNear, uFar, uViewProj`, so do not
  reuse those names.
- **Sprites** (`Sprites`, `allocSprites`, `starSphere`): the colour is the flux and the size is the world-space
  sigma. Sub-pixel sprites keep their flux, so they never flicker. Draw sky spheres with
  `{ sky: true }`. The `animate`/`shade` GLSL hooks run per sprite and per fragment.
- **Uniforms** are typed by reflection (`Program.set`). Arrays: pass flat JS arrays. Unknown
  names are ignored silently, so a misspelt uniform just does nothing.

## Pitfalls (all have bitten this repo)

- Shaders live in JS template strings: **never put a backtick in GLSL, even in a comment**,
  and remember `${...}` interpolates.
- `pow(x, y)` with `x < 0` is NaN, and so is `exp()` of a huge positive number times 0.
  Guard with `max(x, 0.0)`. Post zeroes NaNs so they cannot bloom into black holes, but
  the pixel is still wrong.
- Ray/sphere: use the front hit `t = -b - sqrt(h)`, not the closest approach.
- PNG data textures: never pack data into alpha (browsers premultiply on decode). Use RGB files.
- Canvas2D `ctx.filter = 'blur()'` is catastrophically slow on software GL. The text layer
  blurs via `shadowBlur` with the glyph drawn off-canvas. Keep it that way.
- The first frame that uses a big shader pays a one-time LLVM compile (seconds). Benchmarks
  must render a second frame of the same shot.
- `starLayer` glows must stay inside one cell (3x3 search) or square halos appear.

## Review loop (do this constantly)

```bash
npm run still -- <id> --t 12 --t 30 --grid --scale 0.25        # quick look at moments
npm run still -- <id> --sheet --from 0 --to 80 --n 40 --cols 8   # continuity across a range
npm run still -- <id> --t 12 --bench --scale 1                   # cost per 1080p frame
npm run typecheck
```

Look at every PNG you render. Check exposure (nothing blown out or muddy), text legibility
over the image, letterbox framing, and transitions between shots.

## Rendering

- `npm run render -- <id> --preset draft`: half resolution in about 25 min for 5 minutes of film on a 4-core CPU.
- `npm run render -- <id>`: final 1080p, x264 CRF 17 `slow`, Rec.709, AAC 320k. Outputs
  `out/<id>/renders/<id>-final-<stamp>.mp4` and `...-final-latest.mp4`.
- Run `npm run audio -- <id>` first or the render is silent (a warning is printed).
- Long renders: segments are written to `out/<id>/segments/`. If the container restarts, re-run
  the same command with `--resume` to continue. If only the score changed, don't re-render:
  re-mux the audio with ffmpeg (`-map 0:v -map 1:a -c:v copy -c:a aac -b:a 320k`).
- Container note: there is no GPU; `--gl auto` picks Mesa llvmpipe via EGL (needs `libegl1`
  and `mesa-vulkan-drivers`/`libgl1-mesa-dri`). Install ffmpeg with apt if it is missing.
