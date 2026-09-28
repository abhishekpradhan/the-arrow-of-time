# The engine

`engine/` is a small WebGL2 film engine written in TypeScript. Films import it as `@engine`
(`engine/index.ts`). It renders one frame at a time, deterministically, for a given time.

```text
for each frame:
  active shots ──► each renders HDR, linear light into its target ──► dissolves composited
              ──► motion blur (optional sub-frame accumulation)
              ──► post: bloom, streaks, tonemap, grade, grain, vignette, letterbox, flash, shake
              ──► captions composited from the glyph cache ──► canvas
```

## Projects and shots

A project (`defineProject`) declares the frame size, `fps`, `duration`, the soundtrack, fonts to
preload, its shots, its text items, timeline markers for the preview, and `look(t)`.

A shot has an `id`, a `start` and `end`, optional `fadeIn`/`fadeOut` (overlap shots to dissolve),
an optional `motionBlur` sample count (or a function of film time, so a shot pays for many samples
only during fast moves), an optional `setup(engine)` that creates GPU resources once,
and `render(ctx, state)`. The context carries the engine (`c.e`), the GL context, times (`c.t`
shot-local, `c.time` film time, `c.p` progress), the frame size and the target to draw into, plus
`c.fullscreen(program, uniforms)`.

Uniforms are typed by reflection (`Program.set`): pass numbers, arrays (flat), `Vec3`s, matrices,
textures or render targets. Unknown names are ignored silently, so a misspelt uniform just does
nothing.

Animation helpers (`engine/core/anim.ts`): `prog(t, a, b, ease)` for 0..1 progress, `keys(t, [[t,
v, ease], ...])` for eased keyframes, and `spline(t, [[t, v], ...])` for a monotone cubic through
several marks. The speed never jumps at a mark and the curve never overshoots, which suits time
remaps (slow motion around an event) and camera moves. Also `envelope`, `drift`, `shake` and
`stagger`.

## Full-screen shaders and the GLSL library

`c.fullscreen(c.e.program(SOURCE, 'name'), uniforms)` draws a full-screen pass. Standard uniforms:
`uRes` (the bound target's size), `uTime`, `uDur`, `uProg`, `uGTime`, `uAspect`, `uScale`.
`centered(vUv, uAspect)` gives picture coordinates with y in [-0.5, 0.5].

`#include <name>` pulls in a chunk from `engine/shaders/`:

| Chunk | Contents |
| --- | --- |
| `common` | constants, `saturate`, `remap`, rotations, hashes, `centered`, ray/sphere, `band` |
| `noise` | value and gradient noise, fbm, ridged, turbulence, Worley, Voronoi edges, domain warping |
| `color` | sRGB conversion, blackbody, palettes, saturation and hue, ACES and AgX tonemaps, fire ramp |
| `sdf` | 2D distance fields (circle, box, segment, tapered strokes, Bézier, ellipse, triangle), smooth min/max, anti-aliased fills |
| `sdf3` | 3D distance fields (sphere, box, capsule, tapered capsule, cylinders, cone frustum, torus, square pyramid, ellipsoid, hexagonal prism) and limited repetition |
| `march` | a ray marcher for 3D scenes: `march`, `calcNormal`, `softShadow`, `calcAO`, `skyColor`, `applyFog` (see below) |
| `stars` | procedural star fields for backgrounds |
| `camera` | `camRay(p)` and `depthOf(worldPos)` matching `engine/core/camera.ts` |
| `creatures` | animated 2D silhouettes, from trilobites and fish to dinosaurs and people; plants (ferns, cycads, conifers, acacias, date palms, cypresses) |
| `structures` | 2D silhouettes from huts and pyramids to factories, rockets and skylines |
| `figures` | people and four-legged animals posed from a few joints (see below) |
| `illustration` | painted light: skies from the sun's elevation, haze, rim light, clouds, mist, smoke |

A film can add its own chunks: put them in `projects/<id>/shaders/*.glsl`, register them with
`registerChunks(import.meta.glob('../shaders/*.glsl', { query: '?raw', import: 'default', eager: true }), '<id>/')`
and `#include <<id>/name>`. Chunks may use `#ifdef` to share code between passes (a terrain chunk
can bake its height field into a texture and march it from the same source).

## Painted scenes

`<illustration>` and `<figures>` are for scenes painted in light and silhouette, the way *The
Arrow of Time* shows life and people. `paintSky(p, horizonY, sunPos, elevation)` paints a clear
sky for any sun elevation in degrees, from deep night (-18) through dusk, a low sun and midday
(40), with a glow round the sun that widens and reddens as it sinks; `skyTone(e)` gives its
colours for lighting the rest of the scene, and `sunDisc` and `nightStars` finish it. Draw layers
back to front with parallax, and ink each with `inkIn(airAt(x, ...), fog, ink)`: the farther the
layer, the more it takes on the colour of the air at the horizon. `rimLight` edges a backlit shape
with light (pass the outward gradient of its distance field), `stratus` paints banks of cloud lit
from the sun's side, `mistBand` and `smokeColumn` the rest.

`<figures>` draws people and animals from their joints. A `Pose` places the head, the base of the
neck, the hips, the hands and the ankles; `sdFigure(p, pose, dress, bulk)` solves the elbows and
knees with a two-bone IK (`ik2`) and strokes the limbs, so a gesture is a handful of points.
`standPose`, `walkPose`, `runPose`, `sitPose`, `pointPose`, `reapPose`, `haulPose`, `carryPose`
and `oratePose` are starting points; `dress` adds a robe, a tunic, long hair or a hat. `sdBeast`
walks a four-legged animal from a `Build` (body, legs, neck, head, tail), with species built on it
(`sdOx`, `sdDonkey`, `sdHorse`, `sdGiraffe`, `sdAntelope`, `sdGoat`, `sdDog`), and `sdBird` flaps.
The civilization of *The Arrow of Time* (`projects/arrow-of-time/shots/civilization.ts`,
`shaders/civ-*.glsl`) and its Homo sapiens scene are worked examples.

## Ray-marched scenes

`<march>` marches any signed-distance scene. The shader defines `float mapD(vec3 p)` (the distance
to everything; the chunk declares it), then calls `march(ro, rd, tmin, tmax, pixelAngle(uRes.y))`
for the first hit, `calcNormal`, `softShadow` and `calcAO` to light it, and `skyColor` and
`applyFog` for the air. Classify the material at the hit by the closest component (the argmin of
their distances). Tune it with defines before the include: `MARCH_STEPS`, `SHADOW_STEPS`,
`MARCH_RELAX` (under-step distances that are only bounds, such as height fields) and
`SHADOW_MIN_STEP` (below the thickness of thin parts, or they cast dotted shadows). A ray that
runs out of steps counts as a hit: a ray creeping along terrain near the horizon has found it.
Worked examples in *The Arrow of Time*'s space race: `shaders/ascent.glsl` marches the R-7
(`shaders/r7.glsl`, a revolved polygon outline per stage) only inside a bounding sphere round it,
in its own frame and in metres, while the Earth and its clouds are traced in kilometres from the
camera's position relative to the planet's centre (no float precision trouble at 6371 km).
`shaders/moonlanding.glsl` marches a baked lunar height field (a fine bake round the site and a
coarse one out to the horizon, the small craters and stones added only close to the surface),
a lander (`shaders/lm.glsl`) and an astronaut posed from joints (`shaders/astronaut.glsl`).

Soft shadows of curved surfaces band into terraces with the simple estimate; the improved one
(the closest approach between successive steps, as in `orbit.glsl`'s `hwShadow`) does not. A
mirror's image of the Sun is far smaller than a pixel: spread its light over the angle a pixel
sees (`sunGlint` in `orbit.glsl`), or it flickers and, near a silhouette, vanishes; a rough
highlight lobe gives the crescent a real polished sphere shows a low Sun.

## The camera

`Camera` (`engine/core/camera.ts`) is a look-at camera shared by sprites and ray-marched shaders:
`cam.set({ pos, target, fov })`, `cam.pan(dx, dy)` to reframe a subject, and `...cam.uniforms()`
to hand `uCamPos, uCamFwd, uCamRight, uCamUp, uTanHalfFov, uNear, uFar, uViewProj` to a shader
that includes `<camera>` (do not reuse those names). When a shot renders several motion-blur
samples, the engine shifts `camRay` by a different sub-pixel offset for each (`uJitter`, a Halton
sequence), so the same accumulation that blurs motion also anti-aliases ray-marched edges.

## Sprites

`Sprites` draws instanced, Gaussian point sprites: stars, dust, particles, debris. The colour is the
flux and the size is the world-space sigma, so sprites smaller than a pixel keep their brightness
and never flicker. `starSphere(rng, options)` makes a sky; draw it with `{ sky: true }`.
`allocSprites(n)` gives raw arrays to fill. Two GLSL hooks customise sprites:
`animate(p, x, col, size)` runs per sprite in the vertex shader (orbits, explosions), and
`shade(q, col, x)` per fragment.

## Components

- **`Planet`** renders a planet from any era: molten, ocean world, snowball, present-day Earth
  (from `loadEarth`, Natural Earth maps), city lights, Mars and its terraforming, the Moon. Every
  knob (lava, crust, ocean, ice, deserts, clouds and storms, atmosphere, haze, dust veils, impact
  scars) is documented on `PlanetParams`. Colliding or overlapping planets need `depthTest: true`;
  impact scars scale with the length of their vector (1 is a crater, about 10 a planet-scale
  wound), and `planetLocal()` converts a world direction into the planet's frame. `opacity` fades
  the whole planet (a body dissolving into a particle simulation of itself, for example).
- **`Galaxy`** (or raw `galaxyData`) is a rotating barred spiral made of sprites: stars, a glow
  layer and dust lanes.
- <a id="atmosphere"></a>**`Atmosphere`** (`engine/components/atmosphere.ts` with the
  `atmosphere` chunk) is a planet's air from single scattering: Rayleigh and Mie scattering,
  ozone absorption and the planet's shadow, with the transmittance to space baked once into a
  small table (the parameterization of Bruneton and Neyret). `...atmo.uniforms(c)` supplies the
  chunk's uniforms (call it while the shot's own target is bound: the first call bakes). In the
  shader, kilometres and positions relative to the planet's centre: `atmoSegment(ro, rd, t0, t1,
  l0, e0, l1, e1, trans)` returns the light scattered along a stretch of ray from two lights (a
  Sun and a Moon) and multiplies `trans`, so the air in front of a cloud layer and behind it
  composite in order; `atmoLight(p, l)` is the colour of sunlight reaching `p` (reddened near the
  horizon, zero in the planet's shadow); `atmoGlow` is the night airglow layer. The sky from the
  ground, the limb from orbit and a sunrise's red and blue arc all come out of it. The Earth
  defaults can be overridden (radius, height, scattering, scale heights, ozone, the Sun's size).

Promote anything a second film could use into the engine rather than copying it.

## Post-processing

The post chain turns the HDR frame into the picture: 13-tap bloom with Karis averaging, anamorphic
streaks, light shafts (`rays`: the bright parts of the frame smeared towards `raysCenter`, so a low
sun streams between silhouettes), ACES or AgX tonemapping, lift/gamma/gain grading, saturation and contrast, grain,
vignette, chromatic aberration, a letterbox that animates between 16:9 and 2.39:1, fades, flashes
and camera shake. Everything is animated through `project.look(t)` (see `Look` in
`engine/core/types.ts`). NaNs are zeroed so they cannot bloom into black holes, but the pixel is
still wrong: guard `pow()` and `exp()`.

## Text

`engine/text/` draws captions on a 2D canvas composited after tonemapping. Canvas2D snaps every
`fillText` origin to whole pixels, so animated text drawn with it jitters. `drawText` and
`drawGlyph` draw from a cache of glyphs rasterized at four sub-pixel phases and blurred in
JavaScript. `caption()` and `stack()` build common cards; films can write their own builders.

## Headless rendering

`engine/runtime/headless.ts` serves `render.html`, which renders frame ranges on request and posts
raw RGBA frames back to the Node tools (`tools/lib/session.ts`), which stream them into ffmpeg. The
preview player (`engine/runtime/player.ts`, `index.html`) runs the same engine interactively.
