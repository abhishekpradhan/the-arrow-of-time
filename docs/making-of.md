# The making of *The Arrow of Time*

*The Arrow of Time* runs 6:12 at 1920×1080 and 24 fps, in a 2.39:1 letterbox that opens to full
frame for its biggest moments. Nothing in it was filmed, drawn by hand or sampled. This page goes
through how it is made, scene by scene, and the science and history it rests on. To change it,
see [Working on the film](working-on-the-film.md).

## The idea

Time has one direction. The film follows it from the Big Bang to the heat death of the universe
and is paced by a ticking clock. The clock falls silent in the Big Bang, accelerates through human
history, stops dead at **Now**, then resumes and slows as the stars die, until the last tick.
After it the universe, and the audience, has one brief moment to look at itself. The score is
built on the same clock ([the score](score.md)).

## How a frame is made

```text
timeline.json ──► project.ts ──► shots (GLSL, sprites, ray marching) ──► HDR composite ──► post ──► frame
      │                 └──────► captions (glyph cache, per-beat layout) ─────────────────────┘
      └──────────────► score.py ──► audio/studio synth ──► mix ──► master ──► score.wav ──┐
                                                                                          ▼
                      headless Chromium ──► raw RGBA ──► ffmpeg (x264) ──────────────► film.mp4
```

Each shot is a span of time and a function that draws linear, HDR light into the frame; shots
overlap to dissolve. The post chain adds bloom, halation, anamorphic streaks, light shafts,
tonemapping, grading, film grain and the letterbox, all animated over the film by `project.ts`. Captions are drawn
last, from a sub-pixel glyph cache, in each shot's negative space. The score reads the same
timeline, so a hit in the picture and in the music is the same number. The engine behind all this
is described in [The engine](engine.md).

The film changes style on purpose. The universe and the far future are rendered: plasma, particle
fields, ray-marched volumes and a black hole's lensing. Life and people, from the Cambrian seas to
the savanna and twelve thousand years of civilization, are painted: layered silhouettes against
skies lit by one clear source. The space race is photographic 3D, built for scale.

## Scene by scene

- **Prologue** (`film/shots/universe.ts`): dust too faint to see, 170,000 motes of it, lit by a
  shell of light that each tick of the clock sends out through it, so the dark glitters in
  expanding rings round the three opening lines. Through the riser the cloud collapses as a
  uniform sphere does, every mote arriving at once, and a lone point holds for the hush before
  the bang.
- **Big Bang, inflation, the first elements, first light**: one continuous medium, a ray-marched
  flight through a baked, tiling noise volume (`film/shaders/universe-plasma.glsl`), so the
  dissolves between the four shots are invisible. The bang is seen from inside: volumetric fire
  rushing past at 40 units a second, slowing as the expansion does, with embers drawn as the
  streaks they cover in each exposure. In inflation the same flight runs away exponentially and
  stretches the plasma into streams. Protons and neutrons are glowing spheres under a shallow
  lens; fours fall together into helium with a flash. At first light the fog brightens, thins to
  nothing, and leaves a finely mottled afterglow that reddens into the dark.
- **Cosmic web and the first galaxies** (`film/shots/dawn.ts`): a 112³ periodic Voronoi density
  volume (filaments where three cells meet), ray-marched at half resolution, with sprite stars and
  small galaxies (spheroids, clumpy irregulars, soft disks) placed on its nodes. The flight
  through it ends at one galaxy, drawn by the same volumetric renderer as the Milky Way: it first
  shows as a blue, clumpy disk and grows its bulge, old stars and dust as the camera nears.
- **Milky Way** (`engine/components/galaxy.ts`): a barred spiral rendered as a volume. Its
  face-on structure (old stars, young stars, dust, H-II regions) is baked once into a map and
  ray-marched as a thin disk, so dust lanes darken only what lies behind them, with pink H-II
  knots along the arms' inner edges, an analytic bulge and nucleus, and 150,000 resolved stars on
  top, each dimmed by the dust in front of it. One camera carries across the dissolve from the
  cosmic web: it lands low over the disk as the theme arrives, then rises to a three-quarter
  view as the frame opens.
- **The solar nebula** (`film/shaders/nebula-cloud.glsl`): the cloud is a volume, a distance
  field of dust displaced by tiling 3D noise and marched with shadows towards a star cluster
  behind it, so the dust facing us is dark and its edges glow, as in the Eagle and Carina
  nebulae. Gas is teal near the stars and rose further out. A nearby star flares into a
  supernova; its blast wave is a shell that lights the gas it crosses and lags in dense dust,
  and the head of the tallest pillar contracts around an ember.
- **The Sun is born** (`film/shaders/sun-disk.glsl`): the ember becomes the protostar at the
  centre of a disk of dust in hydrostatic balance, flared, with a puffed inner rim. A table of
  optical depth from the star lets the rim and each ringlet shade what lies behind. Light sweeps
  outward at ignition; gaps deepen as worlds sweep them, each trailing a spiral wake, under a
  bipolar jet.
- **The Moon-forming impact** (`film/shots/moon.ts`): a real smoothed-particle hydrodynamics
  simulation, not an animation. Theia (0.13 Earth masses) strikes the proto-Earth at 45° and the
  mutual escape speed, run with SWIFT on 61,139 particles for the first day after contact
  ([how](../tools/assets/giant_impact/README.md)). The film plays back 20,000 of them:
  every particle thrown clear of the Earth and a thinned sample of the rest. Each one glows at its
  simulated temperature and absorbs what lies behind it. The shot is continuous from the molten
  Earth: the camera pulls back as Theia, another rendered planet, falls in on the orbit the
  simulation starts from (integrated backwards from its first frame) and hands over to its
  parcels at contact. Theia grazes the Earth, its remnant swings out and hits again six hours
  later, and a long arm breaks into clumps and a disk. The same camera carries on through a
  dissolve to years later, the molten Earth and the newborn Moon, which recedes as the oceans
  form.
- **Planets** (`engine/components/planet.ts`): one shader for every era. The magma ocean's
  rifts follow the zero lines of smooth noise fields, so they meander, branch and gape into pools
  like fractures rather than forming a net of cells; the Snowball's ice carries the same kind of
  long curving leads, as Europa does. Clouds are weather: the noise they are read from is wound
  round storm centres in the mid-latitudes into spiral bands and fronts, thinned by climate zones
  (a cloudy equator, clear subtropics), eroded into cells at their edges, lit from the Sun's side
  and made to shade the ground beyond, with shadows that stretch towards the terminator. The air
  is a thin scattering shell in closed form: its optical depth per colour tints the disc by day,
  deepens to a bright limb, and is what the low Sun loses, so blue air gives orange terminators
  and Mars's dust gives blue ones. Water takes a wide, wind-roughened glint that climbs with the
  Fresnel reflection towards the limb; land takes relief shading from its height field. Under
  that, real present-day Earth from Natural Earth maps (bathymetry shelves, deserts, city lights
  from populated places and roads), impact dust and fires, a blast wave that tears the cloud
  deck away, Mars and its terraforming, the Moon.
- **Life and humanity**: a field of black smokers on the floor of the first ocean
  (`film/shaders/vent.glsl`), craggy spires pouring smoke that the glow of their own mouths lights
  from below; binary fission of a rod-shaped microbe (textures in material coordinates that each
  daughter carries away); animated signed-distance silhouettes (Anomalocaris, trilobites,
  jellyfish, Tiktaalik, sauropods, T. rex, pterosaurs, mammals, people) over painted-light skies;
  underwater god rays and caustics; the first clear dawn after the impact winter
  (`film/shaders/mammals.glsl`), the Sun coming up through the mist of a dead forest with a new
  one growing under it, birds crossing the light, and a small mammal watching from a fallen trunk
  with the Sun rimming its fur; the first people at dusk on the savanna
  (`film/shaders/humans.glsl`), a band round a fire on a granite kopje while giraffes cross under
  the acacias and a meteor, drawn as the streak it covers in each exposure so it never strobes,
  crosses the first stars; a bump-mapped cave wall lit by a moving torch. Today's Earth at night
  carries its air routes as hairline great-circle threads with aircraft running along them.
- **Civilization** (`film/shots/civilization.ts`, `film/shaders/civ-*.glsl`): twelve thousand years
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
  its flash; and the R-7 lifting off from its "tulip" at Baikonur. The camera drifts right
  through each tableau and sweeps on to the next behind something passing close to the lens (a
  palm, a city wall, a column, a chimney, a telegraph pole...), with more motion-blur samples
  during the sweep.
- **The space race** (`film/shots/ascent.ts`, `film/shots/sputnik.ts`, `film/shots/apollo.ts`), with the letterbox
  open to full frame throughout. The camera cranes up after the painted R-7 into the cloud over the
  pad, and the cloud dissolves into the ray-marched sky above it: the rocket bursts out of a moonlit
  stratocumulus deck (a height field of rounded cells, lit through the engine's physically based
  `Atmosphere`, its fire glowing inside the cloud), climbs across the face of the gibbous Moon on a
  long lens (the Moon really was ten days old that night), and at 45 km, in slow motion, its four
  boosters peel away in the "Korolev cross" over the curve of the Earth. In orbit over the night
  side (the real maps, moonlit cloud, the thin green airglow over the limb) the fairing splits
  (the stage and fairing are painted sheet metal in rings and gores, with rivet rows, soot streaks
  and frost where the oxygen tank chills the skin),
  Sputnik springs off with its antennas swinging out, and the camera eases round behind it in one
  slow arc as the Sun breaks over the limb through a dawn arc of red and blue that comes out of
  single scattering; through the glare the film dissolves to the other side, where the polished
  sphere blazes against the night, and the camera draws back and turns to the gibbous Moon beyond
  it. 1969: Eagle comes down on the Sea of Tranquility, a baked height field of craters of every
  size and scattered stones, the regolith lit with Lommel-Seeliger scattering and the opposition
  surge by a Sun 10 degrees up, as it was that morning; its exhaust tears a radial sheet of dust off
  the plain until the engine stops and the dust is simply gone, and the music opens into a chord
  instead of stopping. The film holds on the lander while Armstrong's own voice comes in over the
  radio (NASA's recording of the air-to-ground loop, Houston's Quindar tone and all); then, as a
  piano takes up the theme, the camera drifts round and looks up to the real Earth in the black sky,
  gibbous as it was that day, and closes in on it as it dissolves into the Earth of today.
- **The far future** (`film/shots/future.ts`): a watch-face dial whose hand rebounds on each
  tick; the Big Dipper moving on its Hipparcos proper motions over today's dotted shape, while
  16,000 field stars trail the last third of their journey; the oceans boiling away. The red
  giant (`film/shaders/giant.glsl`) is traced in AU as granules within granules, from a handful
  of giant convection cells down to granulation only the close view resolves, with strong,
  reddening limb darkening; its atmosphere is integrated along each ray with absorption, so
  plumes glow at the limb and stay faint against the disc. Mercury and Venus are swallowed when
  the surface reaches their orbits, and the Earth is left a black disc veined with the glow of
  its melting crust, ringed by the last of its air. The planetary nebula
  (`film/shaders/pneb.glsl`) is a volume modelled on the Ring and the Helix, coloured by
  ionisation (He II blue, O III green, H-alpha red), with cometary knots and thin older shells
  traced analytically, brightest where the ray grazes them; the white dwarf is a sub-pixel point
  with a diffraction cross.
- **The end** (`film/shots/end.ts`): the Milky Way and Andromeda as two disks of 74,000 test
  particles falling together around softened cores on a decaying orbit, both spinning with the
  orbit, which throws the tidal tails, and a starburst where the cores meet. The last stars are
  red and white dwarf embers that die on the score's bells. The black hole
  (`film/shaders/blackhole-trace.glsl`) is a Schwarzschild geodesic tracer: every ray is a null
  geodesic, integrated with RK4 in its own orbital plane (the Binet equation) with exact disk
  crossings, so the far side of the disk arches over the shadow and its underside shows below,
  inside a photon ring; the disk's light is shifted by its orbital speed and the hole's gravity.
  The disk drains and cools, the hole shrinks as it evaporates while its Hawking glow runs from
  red to blue-white, and it ends in a point and an expanding shell of light whose photons thin to
  black. The epilogue comes back to the film's "Now", modelled on Voyager 1's 1990 frame: a fan
  of sunlight scattered in the camera, and in its brightest ray a pale blue dot about a pixel
  wide. "That moment is now." The closing credits follow in silence.

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

## History notes

The civilization's cards and the space race follow the record:

- **Farming**, about 10,000 BCE, in the Fertile Crescent; **cities**, by 4000 BCE (Uruk);
  **writing**, by 3200 BCE (cuneiform on clay). The cards read **2500 BCE** for the pyramids of Giza
  (by then all three stood, in their white limestone casing), **500 BCE** for Athens,
  **1450** for Gutenberg's press in Mainz, **1830** for the railway age, **1903** for the Wright
  Flyer and **1945** for Trinity.
- **1957**: the rocket is the R-7 that carried Sputnik 1 into orbit on 4 October 1957. It rises
  from its "tulip" launch structure at Baikonur, and the Moon it climbs across is gibbous, as it was
  that night. Sputnik's beeps follow its signal: pulses about 0.3 seconds long with gaps of the same
  length.
- **1969**: Apollo 11's lunar module Eagle landed on the Sea of Tranquility on 20 July 1969, with
  the Sun about ten degrees above the eastern horizon; the film lights the plain the same way.
  Houston's Quindar tones (2525 Hz to open a call, 2475 Hz to close it) mark its radio calls, and
  the voice after touchdown is NASA's own recording of Neil Armstrong: "Houston, Tranquility Base
  here. The Eagle has landed."
- One liberty: from Tranquility Base the Earth stood high in the western sky. The film brings it
  down to 16 degrees above the northern horizon so it can share the frame with the lander, and
  keeps the phase it showed that day (about two thirds lit).
