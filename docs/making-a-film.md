# Making a film

A film is a folder in `projects/`. This guide builds one from the starter template and explains
each part, with pointers to how *The Arrow of Time* does the same things at scale.

```bash
npm run new -- my-film --title "My Film"
npm run dev                  # pick "my-film"
```

```text
projects/my-film/
  timeline.json    beats, captions and sync cues: the single source of timing
  project.ts       the film: size, fps, shots, captions and the post-processing look over time
  shots/           shot definitions (TypeScript and GLSL)
  score.py         the soundtrack
```

## 1. The timeline

`timeline.json` is where timing lives. Shots, captions and the score all read it, so moving a beat
moves the picture, its caption and the music together. Never hard-code a time that belongs here.

```json
{
  "title": "My Film",
  "fps": 24,
  "duration": 24,
  "beats": [
    { "id": "intro", "start": 0, "end": 8, "card": "title", "title": "My Film" },
    { "id": "voyage", "start": 8, "end": 18, "card": "chapter", "era": "Chapter one",
      "title": "The Voyage", "line": "Replace this with your story.", "layout": "lower-left" }
  ],
  "cues": { "hit": 8.0 }
}
```

- **Beats** are the story's sections. The caption fields (`era`, `title`, `line`) are shown by the
  caption builder in `project.ts`. `layout` places a card in the shot's negative space: `lower`,
  `lower-left`, `lower-right`, `left`, `right`, `upper-left`, `upper-right`, `upper`, `center`, or
  `{ "at": "lower-left", "x": 0.1, "y": 0.8 }`. `captionDelay` holds a card back so an event
  can play first.
- **Cues** are sync points: impacts, flashes, cuts. The score places its hits on them, and
  `tools/check_sync.py` measures the rendered film against them.
- Anything else your film needs (a list of star ignitions, montage items) can live here too.

To lengthen or shorten a section later, insert time rather than editing numbers by hand:
`python3 tools/retime.py projects/<id>/timeline.json --at 108 --by 4 --extend moon` moves every
beat, cue and listed time from 108 s on by 4 s and lengthens the `moon` beat (`--dry-run` prints
the result).

## 2. Shots

A shot is a time span and a `render` function that draws HDR, linear light into `c.target`. Each
shot owns its whole frame, background included. Overlap two shots and give them
`fadeOut`/`fadeIn` to dissolve between them.

```ts
import { type Shot } from '@engine';

const NEBULA = `
#include <noise>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uTime;
void main() {
  vec2 p = centered(vUv, uAspect);          // y spans [-0.5, 0.5]
  float f = fbm(vec3(p * 3.0, uTime * 0.1), 5);
  fragColor = vec4(vec3(0.9, 0.4, 0.2) * f * f, 1.0);
}`;

export const nebula = (): Shot => ({
  id: 'nebula',
  start: 0,
  end: 8.5,
  fadeOut: 1,
  render(c) {
    c.fullscreen(c.e.program(NEBULA, 'nebula'), {});
  },
});
```

Full-screen shaders get `uRes`, `uTime` (shot-local), `uDur`, `uProg`, `uGTime` (film time),
`uAspect` and `uScale`. `#include <common|noise|color|sdf|stars|camera|creatures|structures>` pulls
in the engine's GLSL library; see [The engine](engine.md) for what is in it, and for the camera,
sprites, planets and galaxies.

Two rules save a lot of time:

- **Never put a backtick in GLSL** inside a JS template string, even in a comment, and remember
  that `${...}` interpolates. Big shaders can live in `projects/<id>/shaders/*.glsl` instead
  (register them with `registerChunks`, as `projects/arrow-of-time/shots/ages.ts` does).
- With the 2.39:1 letterbox only `|y| < 0.372` is visible: keep subjects inside it.

## 3. Captions

The caption layer draws text after tonemapping, from a sub-pixel glyph cache, so slow drifts
never jitter. The starter builds cards with `stack()` from the timeline. *The Arrow of Time* has
its own builder (`projects/arrow-of-time/text.ts`) with chapter cards, montage flashes and
whispers, placed by each beat's `layout`.

Check typography on its own with `npm run still -- my-film --t 10 --textonly`.

## 4. The look

`project.look(t)` returns the post-processing settings for any moment: `exposure`, `bloom`,
`streak` (anamorphic), `tonemap` (`aces`, `agx`, `neutral`), grading (`lift`, `gamma`, `gain`,
`saturation`, `contrast`), `grain`, `vignette`, `aberration`, `letterbox`, `fade`, `flash`,
`shake`, and a `scrim` that darkens the picture softly behind captions. Animate them with `keys()`:

```ts
look: (t) => ({
  letterbox: keys(t, [[0, 1], [T.cues.hit - 0.3, 1], [T.cues.hit + 0.5, 0, 'inOutCubic']]),
  exposure: t > T.cues.hit ? Math.exp(-(t - T.cues.hit) * 2) : 0,
}),
```

Prefer an exposure kick plus light from the scene itself to a white `flash`: over a dark frame a
flash reads as a grey veil.

## 5. The score

`score.py` uses the shared synthesizer in `audio/studio` ([audio/README.md](../audio/README.md)).
Take every time from the timeline and express other times as offsets from cues:

```python
tl = Timeline.load(HERE / 'timeline.json')
mix = Mix(tl.duration)
mix.reverb('hall', fx.reverb_ir('hall'))
brass = mix.track('brass', sends={'hall': -8})
brass.add(tl.cue('hit'), ins.brass(['A2', 'E3', 'A3', 'C4'], 4.0, vel=0.9))
y, report = master.master(mix.render(), target_lufs=-14, tp_ceiling=-1)
```

Render it with `npm run audio -- my-film` (`--from/--to` renders a window in seconds). You cannot
judge music by looking at code, so verify it with `audio/analyze.py`: loudness, onsets at your cues,
hard cuts and a spectrogram.

## 6. The review loop

Render stills constantly and look at every one:

```bash
npm run still -- my-film --t 5 --t 12 --grid --scale 0.25        # moments
npm run still -- my-film --sheet --from 0 --to 24 --n 24 --cols 6 # continuity across a range
npm run still -- my-film --t 12 --bench --scale 1                # cost of a 1080p frame
npm run typecheck
```

Check exposure (nothing blown out or muddy), caption legibility, letterbox framing, and the
transitions between shots.

## 7. Render and release

```bash
npm run audio -- my-film
npm run render -- my-film
npm run release -- my-film
```

See [Rendering](rendering.md) for presets and performance, [Rendering on Modal](modal.md) to
render in parallel in the cloud, and [Releasing a film](releasing.md) for publishing.

## Licensing your film

What you write for your film is yours to license as you like. The template it starts from and the
studio code it runs on are Apache-2.0, so keep `LICENSE` and `NOTICE` when you redistribute them.
