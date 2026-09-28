# CLAUDE.md

Guidance for working in this repository: *The Arrow of Time*, a film made entirely in code
(a WebGL2 engine, a Python-synthesized score, headless rendering). Read `README.md` for the
overview and commands.

## Layout

- `film/`: the film. `timeline.json` (script, captions, cues) + `project.ts` + `shots/` +
  `shaders/` + `text.ts` (captions) + `score.py`.
- `engine/`: the film engine (TypeScript, browser), kept general. Public API: `@engine`
  (`engine/index.ts`); the runtime loads `film/project.ts`.
- `audio/studio/`: the Python synthesizer and mastering the score is written with (`audio/README.md`).
- `tools/`: Node CLIs (`render`, `still`, `audio`, `release`), `check_sync.py`, `retime.py`,
  `release_notes.py`, the `tools/assets/` builders, and the Modal pipeline (`tools/modal/studio.py`).
- `docs/`: the making-of, the score (`score.md`, with the cue sheet), and guides (getting started,
  working on the film, engine, rendering, Modal, releasing).
- `assets/`: data the film loads (Earth maps; the giant-impact SPH simulation, whose recipe is in
  `tools/assets/giant_impact/`; NASA's Apollo 11 audio). Each folder has a README and a builder
  in `tools/assets/`.
- `out/`: all generated media (git-ignored): `renders/`, `audio/`, `stills/`, `release/`. The
  film is published as GitHub Releases (tags `v1.0`, `v1.1`, ...), never committed
  (`docs/releasing.md`).
- Licensing: all code is MIT (`LICENSE`); the film as a work (video, soundtrack, stills, the
  words in `timeline.json`) is CC BY 4.0 (`film/LICENSE.md`). Anything borrowed goes in
  `THIRD_PARTY_NOTICES.md` and, if the film shows or plays it, in the `credits` of `timeline.json`.

## Workflow and conventions

- **Timing lives in `timeline.json`.** Beats (start/end/caption text) and cues (sync points) are
  read by the shots, the captions and `score.py`. Never hard-code a time that exists there. To
  make room, `tools/retime.py <timeline> --at <s> --by <s> [--extend <beat>]` shifts everything
  after a point. `spline(t, knots)` remaps time smoothly (slow motion through an event).
- **Shots are shots.** Each shot owns its whole frame (background included) and renders HDR,
  linear light into `c.target`. Overlap shots with `fadeIn`/`fadeOut` to dissolve. In `film/lib.ts`,
  `span(id, { dIn, dOut })` centres dissolves on beat boundaries and `bt(c, id)` gives time
  since a beat began.
- **Full-screen shaders**: `c.fullscreen(c.e.program(SRC, 'name'), uniforms)`. Standard uniforms
  are `uRes` (the bound target's size), `uTime` (shot-local), `uDur`, `uProg`, `uGTime`
  (global), `uAspect` and `uScale`. Use `centered(vUv, uAspect)`: y spans [-0.5, 0.5]. With the
  2.39:1 letterbox only |y| < 0.372 is visible, so keep subjects inside it.
- **GLSL includes**: `#include <common|noise|color|sdf|sdf3|march|stars|camera|creatures|structures|figures|illustration>`
  (`engine/shaders/*.glsl`, registered by file name). `creatures` and `structures` are 2D
  silhouette SDF libraries, from trilobites to people and from huts to rockets. `figures` poses
  people and four-legged animals from a few joints (`Pose`, `sdFigure`, two-bone `ik2`,
  `walkPose`/`runPose`/`sitPose`/`haulPose`..., `sdBeast` and species such as `sdHorse`);
  `illustration` paints the light: `paintSky`/`skyTone` from the sun's elevation (night to
  midday), `airAt` and `inkIn` for silhouettes that fade into the haze, `rimLight`, `stratus`
  clouds, `mistBand`, `smokeColumn`. The film's own chunks are `film/shaders/*.glsl`, registered by
  `registerChunks(import.meta.glob('../shaders/*.glsl', { query: '?raw', import: 'default',
  eager: true }), 'arrow-of-time/')` (in `film/shots/civilization.ts`) and included as
  `#include <arrow-of-time/name>`. Big shaders read better as `.glsl` files (no backtick hazard); a chunk
  can serve two passes with `#ifdef` (a terrain chunk can bake its height field with a define
  and march the texture in the same source).
- **Bake what never changes.** A ray-marched shot whose terrain or data is static should render
  it once into a texture in its first `render` call (`new RenderTarget(e.gl, w, h, { format:
  'rgba16f' })`, bind, `c.fullscreen`, then `c.target.bind()`): one fetch per march step instead
  of several noise octaves. Store the slope too, for smooth normals.
- **Painted (illustrated) scenes** are the film's language for life and people: a sky from
  `paintSky` with one clear light source, then layers back to front, each moved by parallax and
  inked with `inkIn(airAt(...), fog, INK)` so distant layers take on the air's colour. Backlit
  figures get `rimLight` from a finite-difference gradient; daylit buildings get two tones (a lit
  face and a shadow face) rather than shading. The civilization is one shot
  (`film/shots/civilization.ts`) through ten such tableaux (`film/shaders/civ-<name>.glsl`, sharing
  `civ-common.glsl`: `L(p, k)` for parallax, `uSun`/`uElev` for the day's light): a `Tableau`
  entry gives its sun, drift, wipe object and uniforms. Between tableaux an object sweeps past
  the lens (`civ-wipe.glsl`) and the two are drawn clipped at its centre line, so the seam is
  never seen; `motionBlur` is a function of time so only the whips pay for 6 samples.
- **Ray-marched 3D scenes**: `#include <sdf3>` (primitives, `repLim`) and `<march>`, then define
  `float mapD(vec3 p)` and call `march`, `calcNormal`, `softShadow`, `calcAO`, `skyColor` and
  `applyFog`. Tune with `MARCH_STEPS`, `SHADOW_STEPS`, `MARCH_RELAX` and `SHADOW_MIN_STEP`
  defined before the include. `motionBlur: N` also anti-aliases: each sample shifts `camRay` by
  a sub-pixel jitter (`uJitter`), so 2 samples clean up crisp silhouettes. Crude primitives read
  as crude CGI next to painted scenes: prefer the painted language for people and buildings on
  Earth. The space race is 3D and photographic (`film/shots/ascent.ts`,
  `film/shots/sputnik.ts`, `film/shots/apollo.ts`): planet-sized things are traced in kilometres from the
  camera's position relative to the planet's centre (`uCamP`, `uCamAlt`) and small ones (the
  R-7, Sputnik) in metres relative to the camera, each only inside its bounding sphere; the
  Moon landing marches a baked two-level height field (`lunar.glsl`) and the lander (`lm.glsl`)
  over a `Planet` Earth drawn first (premultiplied alpha).
- **Components** (`engine/components/`): `Planet` + `loadEarth` render a planet from any era
  (molten, ocean, snowball, real present-day Earth, city lights, Mars, the Moon; every knob is
  documented on `PlanetParams`; `opacity` fades one out). Colliding or overlapping planets need `depthTest: true`;
  `impacts` scars scale with the length of their vector (1 = crater, ~10 = planet-scale), and
  `planetLocal()` converts a world direction for them. `Galaxy` (or raw `galaxyData`) is a
  rotating sprite spiral. `Atmosphere` (with `#include <atmosphere>`) is a physically based sky
  and limb from single scattering: `...atmo.uniforms(c)` bakes its transmittance table on first
  use; `atmoSegment` integrates a stretch of ray (composite the air in front of a cloud layer,
  then behind it), `atmoLight` gives sunlight's colour at a point (red near the horizon, zero in
  the planet's shadow). Keep the engine general: anything that isn't specific to one scene of the
  film belongs in the engine rather than in `film/`.
- **Captions** sit in each shot's negative space: set `layout` on a beat in `timeline.json`
  (`lower`, `lower-left/right`, `left/right`, `upper-left/right`, `upper`, `center`, or `{ "at":
  ..., "x": ..., "y": ... }`), and `captionDelay` to let an event play first (`captionUntil` takes
  it away early; a `line` with `\n` in it arrives a line at a time, `lineStagger` seconds apart).
  The closing credits are `credits` in `timeline.json`: name anything a film borrows there as well
  as in `THIRD_PARTY_NOTICES.md`. The scrim follows the card (`Look.scrimCenter/scrimRadius`). If a
  card collides with the subject, reframe the shot (`Camera.pan`, target offsets) rather than
  squeezing the text. Review layouts with a sheet of one frame per beat.
- **Camera**: `engine/core/camera.ts` feeds both sprites and ray-marched shaders
  (`...cam.uniforms()` plus `#include <camera>` and `camRay(p)`). The chunk declares
  `uCamPos, uCamFwd, uCamRight, uCamUp, uTanHalfFov, uNear, uFar, uViewProj, uJitter`, so do
  not reuse those names.
- **Sprites** (`Sprites`, `allocSprites`, `starSphere`): the colour is the flux and the size is the world-space
  sigma. Sub-pixel sprites keep their flux, so they never flicker. Draw sky spheres with
  `{ sky: true }`. The `animate`/`shade` GLSL hooks run per sprite and per fragment.
- **Uniforms** are typed by reflection (`Program.set`). Arrays: pass flat JS arrays. Unknown
  names are ignored silently, so a misspelt uniform just does nothing.
- **CI** (`.github/workflows/ci.yml`) typechecks everything, compiles the Python, synthesizes
  the whole score and checks its hits and cuts against the timeline (`audio/analyze.py`). Keep
  `npm run typecheck` clean, and when a cue moves, keep the onsets CI checks in step.

## Pitfalls (all have bitten this repo)

- Licensing: code must be original or permissively licensed. Never paste Shadertoy code under
  its default CC BY-NC-SA or tutorial code (LearnOpenGL is CC BY-NC). When adapting permissively
  licensed code (MIT, BSD, zlib), keep its copyright notice in a source comment and add it to
  `THIRD_PARTY_NOTICES.md`. Avoid Apache-2.0 code where you can: it brings NOTICE obligations
  that the rest of the repository doesn't have.

- Shaders live in JS template strings: **never put a backtick in GLSL, even in a comment**,
  and remember `${...}` interpolates.
- WebGL rejects the ternary operator on structs (`Pose f = i == 0 ? a : b;`): use if/else. A
  local variable named like a function (`vec3 L` beside `L(p, k)`) hides the function.
- `pow(x, y)` with `x < 0` is NaN, and so is `exp()` of a huge positive number times 0.
  Guard with `max(x, 0.0)`. Post zeroes NaNs so they cannot bloom into black holes, but
  the pixel is still wrong.
- Ray/sphere: use the front hit `t = -b - sqrt(h)`, not the closest approach.
- PNG data textures: never pack data into alpha (browsers premultiply on decode). Use RGB files.
- Canvas2D snaps every `fillText` origin (and shadow offset) to whole pixels, so animated
  text drawn with it jitters letter by letter. Draw text with `drawText`/`drawGlyph`: glyphs
  come from a cache rasterized at 4 sub-pixel phases and blurred in JS. Never blur with
  `ctx.filter` (seconds per frame) or `drawImage` + `shadowBlur` (~60x slower than fillText).
  Check typography with `npm run still -- --t 10 --textonly`.
- Text shadow/glow colours apply their alpha once (`rgba(0,0,0,0.5)` is a 50% shadow).
- The first frame that uses a big shader pays a one-time LLVM compile (seconds). Benchmarks
  must render a second frame of the same shot.
- `starLayer` glows must stay inside one cell (3x3 search) or square halos appear.
- Additive particle clouds saturate to flat white where thousands overlap (an impact spray, a
  launch point): dim particles while they are dense, cool their colour, spread launch times.
- A display-space `flash` over a dark frame reads as a grey veil. Prefer an exposure kick plus
  light that comes from the scene itself.
- GLSL ES 3.00 reserves words you might use as names: `flat`, `smooth`, `sample`, `input`,
  `output`, `filter`, `active`, `common`, `partition`, `half`. The compile error is cryptic. Built-in
  function names (`sign`, `step`, `length`, ...) cannot be redefined or overloaded either.
- Ray-marching heightfields: the vertical height difference overshoots on steep or convex ground,
  so rays tunnel through ridges (the sea shows through hills) or stop inside cliffs. Use the
  distance to the local tangent plane with a safety factor, bisect each hit back onto the
  surface, and start shadow rays from a baked (faceted) heightfield further out, or steep slopes
  get black contour bands.
- A march that runs out of steps has almost always crept along a surface at a grazing angle
  (terrain near the horizon): count it as a hit, or slivers of sky show through the ground.
- A volume marched over an interval (a fireball, a dust skirt) must end at the first opaque hit
  and never run backwards: clamp the far end to `max(min(t1, tHit), t0)`, or rays that meet the
  ground first integrate the volume underground (a dark slab across the frame).
- Soft shadows of thin parts (ladder rungs, struts, flag poles) come out dotted unless the
  shadow step (`SHADOW_MIN_STEP`) is smaller than their thickness.
- Repetition searched over neighbouring cells (`repLim`, a 3x3 grid): keep every object inside
  its own cell and cap the distance at the cell size, or objects are sliced into stripes.
- Procedural terrain rises and falls under a camera path: check the height along the whole move
  (or flatten the terrain along it). A camera underground renders a black or inside-out frame.
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
- Soft shadows of curved surfaces (a rocket's tank, a fairing) come out terraced with the
  simple estimate `min(k * h / t)`; use the closest approach between successive steps (the
  improved soft shadow in `orbit.glsl` and `moonlanding.glsl`).
- A mirror's image of the Sun is far smaller than a pixel: spread its light over the angle one
  pixel sees after the reflection (`2 * distance * pixelAngle / radius` for a sphere), or it
  flickers; seen against the Sun it sits on the silhouette and vanishes, so give polished metal a
  rough lobe too (the lit crescent a real sphere shows).
- A camera that turns fast (a long lens tracking a fast subject) with two motion-blur samples
  draws everything in the background twice. Lock a long lens and let the subject cross it, or
  give the shot more samples for the move. Measure a move before rendering it (replay the camera
  function in `tsx` and project the subject and the background): above about 40 px per frame at
  1080p it reads as judder. Blend camera setups with one eased curve (a Bezier through them),
  not overlapping eases that stop and start again; where the angle is too large for the time,
  dissolve to the other side instead of whipping round.
- Cloud cover from orbit: fbm normalised over many octaves varies little at the scale you see,
  so a view a few hundred kilometres wide can land in one clear patch. Give the cover a band of
  octaves at the scale on screen, not only continental ones.
- Height-field marching is dominated by what each step evaluates: bake the large ground (near
  and far bakes) and add small craters and stones only within half a metre of the surface.
- Joining MP4s by stream copy (the concat demuxer) can leave timestamp gaps at the seams,
  depending on the ffmpeg version. A gap makes players stutter and kills a two-pass encode with
  "Incomplete MB-tree stats file" (ffmpeg fills gaps for MP4 in pass 2 but not for the null
  muxer of pass 1). The Modal assembly renumbers every frame with the `setts` filter, and
  `release.ts` uses `-fps_mode cfr` in both passes.

## Audio

- The score is Python (`film/score.py`) using `audio/studio` (read `audio/README.md`; its design
  and cue sheet are in `docs/score.md`, keep that in step). Run with `npm run audio`; `--from/--to`
  renders a window in seconds for fast iteration.
- A recurring theme ties a long score together: *The Arrow of Time* states its theme (`THEME`,
  played with `theme_line`) at the main title, the Milky Way, the oceans, the mammals, the launch,
  Mars and the epilogue, in different orchestrations and keys.
- A big hit needs a clean onset: `mix.cut(cue - BREATH)` stops everything (tails included) a
  moment before the hit, as for the asteroid. Don't cut where the music should carry through:
  the launch ignition swells out of the montage, and at `eagleLands` (where a dead stop felt
  abrupt) the engine stops but the tension opens into a chord that carries under Armstrong's
  voice. Nothing placed after a cut is cut: check that a cue list does not run past it.
- Recorded sound is an asset like any other: NASA's Apollo 11 loop is in `assets/apollo11/`
  (built by `tools/assets/build_apollo11.py`, credited in `THIRD_PARTY_NOTICES.md`), read with
  `wav.read_wav` and placed on a cue. Know what is in a clip before placing it (its envelope and
  spectrum: this one opens with Houston's Quindar tone).
- Take every time from `Timeline.load(.../timeline.json)` (`tl.cue()`, `tl.beat()`); express
  extra times as offsets from cues. Use `mix.cut(t)` for hard cuts (it stops reverb tails too).
- Master to -14 LUFS / -1 dBTP with `master.master()`. Verify with
  `.venv/bin/python audio/analyze.py <wav> --timeline <json> --onsets <cues> --cut <cue> --png <file>`
  and `.venv/bin/python tools/check_sync.py <mp4> <timeline.json>` on a rendered film.
  You cannot listen: judge from spectrograms, loudness curves, onsets and stems.

## Review loop (do this constantly)

```bash
npm run still -- --t 12 --t 30 --grid --scale 0.25        # quick look at moments
npm run still -- --sheet --from 0 --to 80 --n 40 --cols 8   # continuity across a range
npm run still -- --t 12 --bench --scale 1                   # cost per 1080p frame
npm run typecheck
```

Look at every PNG you render. Check exposure (nothing blown out or muddy), text legibility
over the image, letterbox framing, and transitions between shots.

## Rendering

- `npm run render -- --preset draft`: half resolution, no motion blur (about 16 min for the 6:12
  film at 720p with motion blur on a Mac's GPU; hours on a 4-core CPU).
- `npm run render`: final 1080p, x264 CRF 17 `slow`, Rec.709, AAC 320k. Outputs
  `out/renders/the-arrow-of-time-final-<stamp>.mp4` and `...-final-latest.mp4`. The v1.0 master
  (6:12) took 31 min with `--workers 2` on a Mac's GPU (`MOVIES_BROWSER=chrome`) and is 1.6 GB,
  because film grain is expensive to encode; the 5:18 cut took 1 h 23 min on a 4-core CPU, before
  the ray-marched space race.
- `npm run release` makes the distribution encodes in `out/release/` (1080p, 720p
  preview, poster, checksums; `--variants 2160p,...` from a 4K master). Check sync on the master
  first with `tools/check_sync.py`. Publish them as a GitHub Release; never commit video.
- Modal (`tools/modal/studio.py`, `docs/modal.md`) renders slices of the film in parallel CPU
  containers with the same renderer, caching slices by source hash. The "Render on Modal" GitHub
  workflow drives it and can publish the Release (the 5:38 cut: about 15 minutes and $1.13 from
  scratch, paced by its slowest slice; publishing again from cached slices takes about 6). Claude's cloud sessions cannot reach Modal (its gRPC API needs HTTP/2, which their
  egress proxy does not relay): trigger the workflow with the GitHub tools, and fetch its 720p
  preview with `download_workflow_run_artifact` (release assets of a private repo are not
  downloadable from the session).
- Run `npm run audio` first or the render is silent (a warning is printed).
- Long renders: segments are written to `out/segments/`. If the container restarts, re-run
  the same command with `--resume` to continue. If only the score changed, don't re-render:
  re-mux the audio with ffmpeg (`-map 0:v -map 1:a -c:v copy -c:a aac -b:a 320k`).
- Container note: there is no GPU; `--gl auto` picks Mesa llvmpipe via EGL (needs `libegl1`
  and `mesa-vulkan-drivers`/`libgl1-mesa-dri`). Install ffmpeg with apt if it is missing.
- The painted civilization costs about 10 to 20 ms per 1080p frame on a GPU; its wipes render
  6 motion-blur samples. The space race is the heaviest part of the film: on a software
  renderer (`--gl swiftshader` on a Mac) the ascent and orbit cost about 8 s and the Moon landing
  about 12 s per 1080p frame with their motion-blur samples (the lunar terrain bakes, near and
  far, take a few seconds once per page). Give its slices to more containers on Modal
  (`--slice-seconds 4`).
- `MOVIES_BROWSER=chrome` renders with the installed Chrome when Playwright's Chromium is missing
  (its installer has hung on macOS).
