# The Arrow of Time

*The history and future of everything, from the first instant to the last.* 5:38, 1920×1080,
24 fps, 2.39:1 letterbox that opens to full frame for the biggest moments.

![Frames from the film](poster.jpg)

Watch: the latest cut is on the [Releases page](https://github.com/abhishekpradhan/movies/releases)
(1080p, a 720p preview and a poster).
Rendering on a 4-core CPU without a GPU (Mesa llvmpipe) takes a couple of hours; on
[Modal](../../docs/modal.md) it takes minutes. Cut history: [CHANGELOG.md](CHANGELOG.md).

```bash
npm run audio -- arrow-of-time      # score  -> out/arrow-of-time/audio/score.wav
npm run render -- arrow-of-time     # film   -> out/arrow-of-time/renders/arrow-of-time-final-latest.mp4
```

## Concept

Time has one direction. The film follows it from the Big Bang to the heat death of the
universe and is paced by a ticking clock. The clock falls silent in the Big Bang, accelerates
through human history, stops dead at **NOW**, and resumes and slows down as the stars die
until the last tick. After it, the universe (and the audience) has one brief moment to look
at itself. See `MUSIC.md` for the score design.

## Structure

| Time | Act | Beats |
|---|---|---|
| 0:00 | Prologue | "Everything that has ever happened…", a single point of light gathering energy |
| 0:20 | The Universe | Big Bang and title, inflation, first elements (3 min), first light / CMB (380,000 yr) |
| 0:50 | Cosmic Dawn | dark ages, first stars igniting on the score's bell notes, galaxies, the Milky Way |
| 1:20 | The Sun and Earth | collapsing nebula, protoplanetary disk, molten Earth, Theia impact and the Moon, oceans |
| 2:00 | Life | deep-sea vent and the first cells, Great Oxidation, Snowball Earth, Cambrian seas, onto land, dinosaurs, the asteroid |
| 2:46 | Humanity | mammals at dawn, the first people under the Milky Way, hand stencils |
| 3:06 | Civilization | twelve thousand years as one day, dawn to night: the first harvest, Uruk, a scribe writing cuneiform, Giza, the Acropolis, Gutenberg's press, a mill town and its railway, the Wright Flyer, Trinity, the R-7 launching Sputnik; Sputnik in orbit; the first step on the Moon; Earth at night |
| 3:48 | Now | the pale blue dot, and silence |
| 3:56 | The Future | new worlds, drifting constellations, oceans boil away, red giant, white dwarf, Milky Way and Andromeda merge |
| 4:42 | The End | the last stars, the black hole era, evaporation, the end of time |
| 5:16 | Epilogue | "That moment is now." |

## Visual techniques

- **Big Bang, inflation, first light**: domain-warped fbm plasma with a fire colour ramp, a
  log-scale infinite zoom with radially streaking quantum fluctuations, a bokeh particle field,
  and a Planck-style CMB sphere with photons "breaking free".
- **Cosmic web**: a 112³ periodic Voronoi density volume (filaments where three cells meet),
  ray-marched at half resolution, with sprite stars and galaxies placed on its nodes.
- **Milky Way**: about 170k sprites (sparkle stars, a smooth glow layer, HII knots, a bulge)
  following a barred four-arm logarithmic spiral with 19° pitch, with absorbing dust lanes and
  differential rotation.
- **The Moon-forming impact** (`shots/moon.ts`): a real smoothed-particle hydrodynamics
  simulation, not an animation. Theia (0.13 Earth masses) strikes the proto-Earth at 45° and the
  mutual escape speed, run with SWIFT on 61,139 particles for the first day after contact
  ([how](../../tools/assets/giant_impact/README.md)). The film plays back 20,000 of them:
  every particle thrown clear of the Earth and a thinned sample of the rest. Each one glows at its
  simulated temperature and absorbs what lies behind it. The shot is continuous from the molten
  Earth: the camera pulls back as Theia, another rendered planet, falls in on the orbit the
  simulation starts from (integrated backwards from its first frame) and hands over to its
  parcels at contact. Theia grazes the Earth, its remnant swings out and hits again six hours
  later, and a long arm breaks into clumps and a disk. The same camera carries on through a
  dissolve to years later, the molten Earth and the newborn Moon, which recedes as the oceans
  form.
- **Planets**: one shader for every era. Voronoi lava cracks, procedural oceans and ice lines,
  real present-day Earth from Natural Earth maps (bathymetry shelves, deserts, city lights from
  populated places and roads), clouds, atmospheric rim and twilight, impact dust and fires,
  Mars terraforming, the Moon.
- **Life and humanity**: binary fission of a rod-shaped microbe (textures in material
  coordinates that each daughter carries away); animated signed-distance silhouettes
  (Anomalocaris, trilobites, jellyfish, Tiktaalik, sauropods, T. rex, pterosaurs, mammals,
  people) over painted-light skies; underwater god rays and caustics; the first people at dusk
  on the savanna (`shaders/humans.glsl`), a band round a fire on a granite kopje while giraffes
  cross under the acacias and a meteor, drawn as the streak it covers in each exposure so it
  never strobes, crosses the first stars; a bump-mapped cave wall lit by a moving torch.
- **Civilization** (`shots/civilization.ts`, `shaders/civ-*.glsl`): twelve thousand years
  painted as a single day in the film's silhouette style, one tracking shot through ten
  tableaux, each with its own parallax layers and figures posed from joints (the engine's
  `figures` chunk): wild wheat at sunrise, backlit, a woman reaping with a flint sickle; Uruk in
  the morning, the White Temple on its terrace above a canal where reed boats are poled along;
  over a scribe's shoulder as he presses wedges into a clay tablet in raking light; Giza at noon
  in its white casing while a gang hauls a block on a sledge; the Acropolis in the afternoon sun
  above the Aegean, philosophers talking on a terrace; Mainz at sunset, pages streaming from
  Gutenberg's window over the town; a mill town at dusk, a train crossing the viaduct while a
  horse still tows a narrowboat below; the Wright Flyer against the last of the light (a small
  3D model projected obliquely so its span and bracing read in silhouette); Trinity, cut in on
  its flash; and the R-7 lifting off from its "tulip" at Baikonur as the camera tilts up after
  it. The camera drifts right through each tableau and sweeps on to the next behind something
  passing close to the lens (a palm, a city wall, a column, a chimney, a telegraph pole...),
  with more motion-blur samples during the sweep. Then Sputnik tumbles over the daylit Earth
  (`shots/sputnik.ts`: the polished sphere mirrors the Planet below it).
- **The Moon landing** (`shots/apollo.ts`, `shaders/moonstep.glsl`): painted like the
  civilization: the lunar module in hard, low sunlight, its gold foil a mosaic of facets; the
  astronaut backing down the ladder and setting his boot on the regolith on the beat, dust flying
  on ballistic arcs; the real Earth (the Planet component) in the black sky.
- **The far future**: a boiling red giant engulfing the inner planets, a ray-marched ring
  nebula, a restricted N-body galaxy merger (36k test particles, two cores with dynamical
  friction), and a Schwarzschild lensing ray tracer for the black hole and its accretion disk.

## Science notes

The captions follow current mainstream estimates and hedge where science does:

- Inflation ends around 10⁻³² s; Big Bang nucleosynthesis at about 3 minutes;
  recombination (the CMB) at about 380,000 years.
- First stars at about 100–200 million years; galaxies are already present by about 300–400 million years (JWST).
- Solar system: 4.6 Gyr ago. Earth: 4.54 Gyr. Moon-forming impact (Theia, the leading hypothesis): about 4.5 Gyr.
  The impact is a canonical graze-and-merge collision (after Kegerreis et al. 2022) simulated for
  this film. At its resolution no satellite survives the first day (the disk holds 0.7 lunar
  masses), so the film then skips ahead to the Moon that accretes from the disk, a few Earth radii
  out. Its orbit has widened ever since.
- Liquid water by about 4.4 Gyr (zircons); life by about 3.8 Gyr; Great Oxidation about 2.4 Gyr;
  Cryogenian Snowball Earth about 720–635 Myr; Cambrian explosion 538.8 Myr; tetrapods about 375 Myr;
  dinosaurs about 230 Myr; Chicxulub 66 Myr; *Homo sapiens* about 300,000 years; hand stencils more than 40,000 years.
- Future: the constellations change noticeably within about 100,000 years (the Big Dipper uses
  real proper motions); the Sun brightens enough to evaporate the oceans in about 1 Gyr;
  it leaves the main sequence at about 5 Gyr and becomes a white dwarf by about 8 Gyr.
  A 2025 study (Sawala et al.) puts the chance of a Milky Way–Andromeda merger within
  10 Gyr at about 50%, hence "may merge". The last stars fade at about 10¹⁴ years; black holes dominate
  after about 10⁴⁰ years (if protons decay); the largest evaporate by about 10¹⁰⁰ years.
