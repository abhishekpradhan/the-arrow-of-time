# CLAUDE.md

Guidance for working in this repository: a code-driven film studio (WebGL2 engine, Python
score synthesis, headless rendering). Read `README.md` for the overview and commands.

## Layout

- `engine/`: reusable film engine (TypeScript, browser). Public API: `@engine` (`engine/index.ts`).
- `audio/studio/`: reusable Python synthesizer and mastering (`audio/README.md`).
- `tools/`: Node CLIs (`render`, `still`, `audio`, `release`, `new-project`), `tools/assets/`
  builders, and the Modal pipeline (`tools/modal/studio.py`).
- `docs/`: guides (getting started, making a film, engine, rendering, Modal, releasing).
- `projects/<id>/`: one film per folder. `timeline.json` + `project.ts` + `shots/` + `score.py`.
- `templates/starter/`: copied by `npm run new -- <id>`.
- `assets/`: data the films load (Earth maps; the giant-impact SPH simulation, whose recipe is in
  `tools/assets/giant_impact/`). Each folder has a README and a builder in `tools/assets/`.
- `out/`: all generated media (git-ignored). Finished films are published as GitHub Releases,
  never committed (`docs/releasing.md`).

## Workflow and conventions

- **Timing lives in `timeline.json`.** Beats (start/end/caption text) and cues (sync points) are
  read by the shots, the captions and `score.py`. Never hard-code a time that exists there. To
  make room, `tools/retime.py <timeline> --at <s> --by <s> [--extend <beat>]` shifts everything
  after a point. `spline(t, knots)` remaps time smoothly (slow motion through an event).
- **Shots are shots.** Each shot owns its whole frame (background included) and renders HDR,
  linear light into `c.target`. Overlap shots with `fadeIn`/`fadeOut` to dissolve. In
  `projects/arrow-of-time`, `span(id, { dIn, dOut })` centres dissolves on beat boundaries and
  `bt(c, id)` gives time since a beat began.
- **Full-screen shaders**: `c.fullscreen(c.e.program(SRC, 'name'), uniforms)`. Standard uniforms
  are `uRes` (the bound target's size), `uTime` (shot-local), `uDur`, `uProg`, `uGTime`
  (global), `uAspect` and `uScale`. Use `centered(vUv, uAspect)`: y spans [-0.5, 0.5]. With the
  2.39:1 letterbox only |y| < 0.372 is visible, so keep subjects inside it.
- **GLSL includes**: `#include <common|noise|color|sdf|stars|camera|creatures|structures>`
  (`engine/shaders/*.glsl`, registered by file name). `creatures` and `structures` are 2D
  silhouette SDF libraries, from trilobites to people and from huts to rockets. For
  film-specific chunks, call `registerChunks(import.meta.glob('./shaders/*.glsl', { query: '?raw',
  import: 'default', eager: true }), '<id>/')` in a module the shots import, then
  `#include <<id>/name>`. Big shaders read better as `.glsl` files (no backtick hazard); a chunk
  can serve two passes with `#ifdef` (the valley bakes its terrain with `#define VALLEY_BAKE`).
- **Bake what never changes.** A ray-marched shot whose terrain or data is static should render
  it once into a texture in its first `render` call (`new RenderTarget(e.gl, w, h, { format:
  'rgba16f' })`, bind, `c.fullscreen`, then `c.target.bind()`): one fetch per march step instead
  of several noise octaves. Store the slope too, for smooth normals.
- **Components** (`engine/components/`): `Planet` + `loadEarth` render a planet from any era
  (molten, ocean, snowball, real present-day Earth, city lights, Mars, the Moon; every knob is
  documented on `PlanetParams`). Colliding or overlapping planets need `depthTest: true`;
  `impacts` scars scale with the length of their vector (1 = crater, ~10 = planet-scale), and
  `planetLocal()` converts a world direction for them. `Galaxy` (or raw `galaxyData`) is a
  rotating sprite spiral. Promote anything a second film could use into the engine rather than
  copying it.
- **Captions** sit in each shot's negative space: set `layout` on a beat in `timeline.json`
  (`lower`, `lower-left/right`, `left/right`, `upper-left/right`, `upper`, `center`, or
  `{ "at": ..., "x": ..., "y": ... }`), and `captionDelay` to let an event play first. The
  scrim follows the card (`Look.scrimCenter/scrimRadius`). If a card collides with the subject,
  reframe the shot (`Camera.pan`, target offsets) rather than squeezing the text. Review
  layouts with a sheet of one frame per beat.
- **Camera**: `engine/core/camera.ts` feeds both sprites and ray-marched shaders
  (`...cam.uniforms()` plus `#include <camera>` and `camRay(p)`). The chunk declares
  `uCamPos, uCamFwd, uCamRight, uCamUp, uTanHalfFov, uNear, uFar, uViewProj`, so do not
  reuse those names.
- **Sprites** (`Sprites`, `allocSprites`, `starSphere`): the colour is the flux and the size is the world-space
  sigma. Sub-pixel sprites keep their flux, so they never flicker. Draw sky spheres with
  `{ sky: true }`. The `animate`/`shade` GLSL hooks run per sprite and per fragment.
- **Uniforms** are typed by reflection (`Program.set`). Arrays: pass flat JS arrays. Unknown
  names are ignored silently, so a misspelt uniform just does nothing.
- **CI** (`.github/workflows/ci.yml`) typechecks everything and scaffolds and scores a film
  from the template. Keep `npm run typecheck` clean: the engine is shared by every film.

## Pitfalls (all have bitten this repo)

- Licensing: code must be original or permissively licensed. Never paste Shadertoy code under
  its default CC BY-NC-SA or tutorial code (LearnOpenGL is CC BY-NC). When adapting MIT or
  Apache code, keep a source comment and add it to `THIRD_PARTY_NOTICES.md`.

- Shaders live in JS template strings: **never put a backtick in GLSL, even in a comment**,
  and remember `${...}` interpolates.
- `pow(x, y)` with `x < 0` is NaN, and so is `exp()` of a huge positive number times 0.
  Guard with `max(x, 0.0)`. Post zeroes NaNs so they cannot bloom into black holes, but
  the pixel is still wrong.
- Ray/sphere: use the front hit `t = -b - sqrt(h)`, not the closest approach.
- PNG data textures: never pack data into alpha (browsers premultiply on decode). Use RGB files.
- Canvas2D snaps every `fillText` origin (and shadow offset) to whole pixels, so animated
  text drawn with it jitters letter by letter. Draw text with `drawText`/`drawGlyph`: glyphs
  come from a cache rasterized at 4 sub-pixel phases and blurred in JS. Never blur with
  `ctx.filter` (seconds per frame) or `drawImage` + `shadowBlur` (~60x slower than fillText).
  Check typography with `npm run still -- <id> --textonly`.
- Text shadow/glow colours apply their alpha once (`rgba(0,0,0,0.5)` is a 50% shadow).
- The first frame that uses a big shader pays a one-time LLVM compile (seconds). Benchmarks
  must render a second frame of the same shot.
- `starLayer` glows must stay inside one cell (3x3 search) or square halos appear.
- Additive particle clouds saturate to flat white where thousands overlap (an impact spray, a
  launch point): dim particles while they are dense, cool their colour, spread launch times.
- A display-space `flash` over a dark frame reads as a grey veil. Prefer an exposure kick plus
  light that comes from the scene itself.
- GLSL ES 3.00 reserves words you might use as names: `flat`, `smooth`, `sample`, `input`,
  `output`, `filter`, `active`, `common`, `partition`. The compile error is cryptic.
- Ray-marching heightfields: the vertical height difference overshoots on steep or convex ground,
  so rays tunnel through ridges (the sea shows through hills) or stop inside cliffs. Use the
  distance to the local tangent plane with a safety factor, bisect each hit back onto the
  surface, and start shadow rays from a baked (faceted) heightfield further out, or steep slopes
  get black contour bands.
- After a march, classify the material by the closest surface (argmin of the component
  distances), not by a fixed tolerance: the hit tolerance grows with distance, and a pyramid
  hit 200 units away otherwise shades as ground.
- A ray-marched grid city must never step across a cell without evaluating the next cell's
  building: cap the step at the cell boundary, but never count that cap as a surface (it
  produces a lattice of phantom walls).
- Masks from slope thresholds (`n.y > 0.95`) flicker between on and off along contours of gentle
  slopes; derive them from a smooth measure over a wide range.
- Chromatic aberration fringes thousands of tiny bright lights red and blue (city lights read
  pink): keep `aberration` low in those shots.
- Joining MP4s by stream copy (the concat demuxer) can leave timestamp gaps at the seams,
  depending on the ffmpeg version. A gap makes players stutter and kills a two-pass encode with
  "Incomplete MB-tree stats file" (ffmpeg fills gaps for MP4 in pass 2 but not for the null
  muxer of pass 1). The Modal assembly renumbers every frame with the `setts` filter, and
  `release.ts` uses `-fps_mode cfr` in both passes.

## Audio

- Scores are Python (`projects/<id>/score.py`) using `audio/studio` (read `audio/README.md`).
  Run with `npm run audio -- <id>`; `--from/--to` renders a window in seconds for fast iteration.
- A recurring theme ties a long score together: *The Arrow of Time* states its theme (`THEME`,
  played with `theme_line`) at the main title, the Milky Way, the oceans, the mammals, the launch,
  Mars and the epilogue, in different orchestrations and keys.
- A big hit needs a clean onset: `mix.cut(cue - BREATH)` stops everything (tails included) a
  moment before the hit, as for the asteroid and the launch.
- Take every time from `Timeline.load(.../timeline.json)` (`tl.cue()`, `tl.beat()`); express
  extra times as offsets from cues. Use `mix.cut(t)` for hard cuts (it stops reverb tails too).
- Master to -14 LUFS / -1 dBTP with `master.master()`. Verify with
  `.venv/bin/python audio/analyze.py <wav> --timeline <json> --onsets <cues> --cut <cue> --png <file>`
  and `.venv/bin/python tools/check_sync.py <mp4> <timeline.json>` on a rendered film.
  You cannot listen: judge from spectrograms, loudness curves, onsets and stems.

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
  `out/<id>/renders/<id>-final-<stamp>.mp4` and `...-final-latest.mp4`. The Arrow of Time
  (5:18 cut) took 1 h 23 min with `--workers 2` on a 4-core CPU (motion blur on); the master
  is about 1 GB because film grain is expensive to encode.
- `npm run release -- <id>` makes the distribution encodes in `out/<id>/release/` (1080p, 720p
  preview, poster, checksums; `--variants 2160p,...` from a 4K master). Check sync on the master
  first with `tools/check_sync.py`. Publish them as a GitHub Release; never commit video.
- Modal (`tools/modal/studio.py`, `docs/modal.md`) renders slices of the film in parallel CPU
  containers with the same renderer, caching slices by source hash. The "Render on Modal" GitHub
  workflow drives it and can publish the Release (the 5:38 cut: about 10 minutes and $1 from
  scratch). Claude's cloud sessions cannot reach Modal (its gRPC API needs HTTP/2, which their
  egress proxy does not relay): trigger the workflow with the GitHub tools, and fetch its 720p
  preview with `download_workflow_run_artifact` (release assets of a private repo are not
  downloadable from the session).
- Run `npm run audio -- <id>` first or the render is silent (a warning is printed).
- Long renders: segments are written to `out/<id>/segments/`. If the container restarts, re-run
  the same command with `--resume` to continue. If only the score changed, don't re-render:
  re-mux the audio with ffmpeg (`-map 0:v -map 1:a -c:v copy -c:a aac -b:a 320k`).
- Container note: there is no GPU; `--gl auto` picks Mesa llvmpipe via EGL (needs `libegl1`
  and `mesa-vulkan-drivers`/`libgl1-mesa-dri`). Install ffmpeg with apt if it is missing.
- The civilization sequence is the most expensive shot (about 2 to 3 s per 1080p frame on a
  4-core CPU); render it on Modal or budget for it.
