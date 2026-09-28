# Third-party notices

*The Arrow of Time* and the code that makes it are original work (the code under the MIT
License, the film under CC BY 4.0), except for the material below, which keeps its own terms.
Each code snippet is also credited in a comment where it appears in the source.

## Code under the MIT License

| Where | What | Copyright |
|---|---|---|
| `engine/shaders/common.glsl` (hash11 … hash43) | "Hash without Sine", Dave Hoskins ([Shadertoy 4djSRW](https://www.shadertoy.com/view/4djSRW)) | Copyright (c) 2014 David Hoskins |
| `engine/shaders/noise.glsl` (`voronoiEdge`, fbm octave rotations, domain warp), `engine/shaders/sdf.glsl` (`sdBox`, `sdSegment`, `sdEllipse`, `sdTriangle`, `smin`), `engine/shaders/sdf3.glsl` (the 3D primitives), `engine/shaders/march.glsl` (`calcNormal`, `softShadow`, `calcAO`), `engine/shaders/color.glsl` (`palette`) | Inigo Quilez ([articles](https://iquilezles.org/articles/), [Voronoi – distances](https://www.shadertoy.com/view/ldl3W8)) | Copyright © 2013 Inigo Quilez (Voronoi); Copyright © Inigo Quilez (article snippets) |
| `film/shaders/r7.glsl` (`r7Edge`: polygon distance and winding), `orbit.glsl` (`hwShadow`) and `moonlanding.glsl` (`objShadow`): the improved soft shadow; `ascent.glsl` (`smoothCells`: smooth Voronoi) | Inigo Quilez ([2D distance functions](https://iquilezles.org/articles/distfunctions2d/), [soft shadows](https://iquilezles.org/articles/rmshadows/), [smooth Voronoi](https://iquilezles.org/articles/smoothvoronoi/)) | Copyright © Inigo Quilez (article snippets) |
| `engine/shaders/color.glsl` (`tonemapACES`) | Stephen Hill's ACES fit, as published in [BakingLab](https://github.com/TheRealMJP/BakingLab) | Copyright (c) 2016 MJP |
| `engine/shaders/color.glsl` (`tonemapAgX`) | Benjamin Wrensch, ["Minimal AgX"](https://iolite-engine.com/blog_posts/minimal_agx_implementation) (AgX by Troy Sobotka) | Copyright (c) 2024 Missing Deadlines (Benjamin Wrensch) |
| `engine/core/math.ts` (`m4.invert`) | [gl-matrix](https://github.com/toji/gl-matrix) `mat4.invert` | Copyright (c) 2015-2025, Brandon Jones, Colin MacKenzie IV |
| `audio/studio/master.py` (`k_weighting_sos`) | [libebur128](https://github.com/jiixyj/libebur128) `ebur128_init_filter` | Copyright (c) 2011 Jan Kokemüller |

Each of the above is provided under the following terms:

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Data

- **Earth maps** (`assets/earth/`): derived from [Natural Earth](https://www.naturalearthdata.com/)
  vector data, which is in the public domain.
- **Big Dipper** (`film/shots/future.ts`): positions, proper motions and
  magnitudes of seven stars from the Hipparcos catalogue (ESA).
- **Vocal formants** (`audio/studio/instruments.py`): the formant table in the Csound manual.
- **Apollo 11 audio** (`assets/apollo11/`): Neil Armstrong's "Houston, Tranquility Base here. The
  Eagle has landed.", courtesy of NASA ([Historical Sounds](https://www.nasa.gov/historical-sounds/)).
  NASA audio is generally not subject to copyright in the United States; NASA is acknowledged as
  the source, as its [media usage guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/)
  ask, and no endorsement is implied.
- **Giant impact** (`assets/giant-impact/`): our own SPH simulation, run with
  [SWIFT](https://github.com/SWIFTSIM/SWIFT) (LGPL-3.0), initial conditions from
  [WoMa](https://github.com/srbonilla/WoMa) and [SEAGen](https://github.com/jkeger/seagen)
  (GPL-3.0), and the ANEOS forsterite and Fe85Si15 equations of state (S. T. Stewart et al.).
  None of that software or those tables are redistributed here; the data is ours. Credits and the
  recipe are in [`tools/assets/giant_impact/README.md`](tools/assets/giant_impact/README.md).

## Fonts

Cinzel, Jost, Cormorant Garamond and UnifrakturMaguntia are installed from npm
([Fontsource](https://fontsource.org/)) and are not redistributed in this repository. They are
licensed under the [SIL Open Font License 1.1](https://openfontlicense.org/) (The Cinzel Project
Authors, The Jost Project Authors, The Cormorant Project Authors; UnifrakturMaguntia by
j. 'mach' wust and Peter Wiegel). The OFL places no restrictions on rendered output such as the
films.

## Methods credited (no code copied)

- Bloom downsample: Jorge Jimenez, "Next Generation Post Processing in Call of Duty: Advanced
  Warfare" (SIGGRAPH 2014); firefly suppression: Brian Karis.
- PCG 3D hash: Mark Jarzynski and Marc Olano, "Hash Functions for GPU Rendering", JCGT 9(3), 2020.
- Blackbody colour fit: Tanner Helland (2012), from Mitchell Charity's blackbody data.
- Easing curves: Robert Penner's easing equations.
- Schwarzschild lensing force law: Riccardo Antonelli, "Starless".
- Loudness: ITU-R BS.1770-4. PolyBLEP oscillators: Välimäki et al.
