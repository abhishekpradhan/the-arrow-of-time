# Working on the film

Everything that makes *The Arrow of Time* is in [`film/`](../film/). This guide explains each part
and how to change it without breaking the rest. [CLAUDE.md](../CLAUDE.md) has the conventions in
full, with every pitfall the film has hit.

```text
film/
  timeline.json    the script: beats, captions and sync cues, the single source of timing
  project.ts       the film: size, fps, shots, captions and the post-processing look over time
  lib.ts           helpers shared by the shots (beats and cues from the timeline, dissolve spans)
  shots/           the shots, one module per act (TypeScript)
  shaders/         the film's own GLSL chunks, included as <arrow-of-time/name>
  text.ts          the caption builder: chapter cards, montage flashes, whispers, credits
  score.py         the score (Python, on audio/studio)
  LICENSE.md       the film's license (CC BY 4.0) and how to credit it
```

## 1. The timeline

[`timeline.json`](../film/timeline.json) is where timing lives. The shots, the captions and the
score all read it, so moving a beat moves the picture, its caption and the music together. Never
hard-code a time that belongs there.

```json
{ "id": "moonlanding", "act": "human", "start": 229, "end": 246, "card": "chapter",
  "layout": "upper-left", "captionDelay": 10.4, "captionUntil": 244.6,
  "era": "1969", "line": "We set foot on another world." }
```

- **Beats** are the story's sections. The caption fields (`era`, `title`, `line`) are drawn by
  `text.ts` according to the beat's `card` (`chapter`, `montage`, `whisper`, `title`).
  `layout` places a card in the shot's negative space: `lower`, `lower-left`, `lower-right`,
  `left`, `right`, `upper-left`, `upper-right`, `upper`, `center`, or
  `{ "at": "lower-left", "x": 0.1, "y": 0.8 }`. `captionDelay` holds a card back so an event can
  play first, and `captionUntil` takes it away before the beat ends.
- **Cues** are sync points: impacts, flashes, cuts, a voice. The score places its hits on them,
  and `tools/check_sync.py` measures the rendered film against the ones listed in `syncCues`.
- Other lists live here too: the civilization's montage, star ignitions and deaths, the prologue
  and epilogue lines, the title cards and the closing `credits`.

To lengthen or shorten a section, insert time rather than editing numbers by hand:
`python3 tools/retime.py --at 108 --by 4 --extend moon` moves every beat, cue and listed time
from 108 s on by 4 s and lengthens the `moon` beat (`--dry-run` prints the result).

## 2. Shots

A shot is a span of time and a `render` function that draws HDR, linear light into `c.target`.
Each shot owns its whole frame, background included. Overlap two shots and give them
`fadeOut`/`fadeIn` to dissolve between them; `span(id, { dIn, dOut })` from `lib.ts` centres
the dissolves on a beat's boundaries.

```ts
import { type Shot } from '@engine';
import { span } from '../lib';

const GLOW = `
#include <noise>
in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uTime;
void main() {
  vec2 p = centered(vUv, uAspect);          // y spans [-0.5, 0.5]
  float f = fbm(vec3(p * 3.0, uTime * 0.1), 5);
  fragColor = vec4(vec3(0.9, 0.4, 0.2) * f * f, 1.0);
}`;

export const glow = (): Shot => ({
  ...span('nebula', { dIn: 1, dOut: 1 }),
  render(c) {
    c.fullscreen(c.e.program(GLOW, 'glow'), {});
  },
});
```

Full-screen shaders get `uRes`, `uTime` (shot-local), `uDur`, `uProg`, `uGTime` (film time),
`uAspect` and `uScale`. `#include <common|noise|color|sdf|sdf3|march|stars|camera|atmosphere|...>`
pulls in the engine's GLSL library; the film's own chunks live in `shaders/` and are included as
`<arrow-of-time/name>`. See [The engine](engine.md) for the library, the camera, sprites,
planets, galaxies and the atmosphere, and [the making-of](making-of.md) for how each act is
built.

Two rules save a lot of time:

- **Never put a backtick in GLSL** inside a JS template string, even in a comment, and remember
  that `${...}` interpolates. Big shaders read better as `.glsl` files in `shaders/`.
- With the 2.39:1 letterbox only `|y| < 0.372` is visible: keep subjects inside it.

## 3. Captions

The caption layer draws text after tonemapping, from a sub-pixel glyph cache, so slow drifts
never jitter. [`text.ts`](../film/text.ts) builds every card from the timeline: chapter cards,
the civilization's montage flashes, whispers, the title cards and the closing credits. Check
typography on its own with `npm run still -- --t 10 --textonly`.

## 4. The look

`look(t)` in [`project.ts`](../film/project.ts) returns the post-processing settings for any
moment: `exposure`, `bloom`, `streak` (anamorphic), light shafts (`rays`), `tonemap` (`aces` or
`agx`), grading (`lift`, `gamma`, `gain`, `saturation`, `contrast`), `grain`, `vignette`,
`aberration`, `letterbox`, `fade`, `flash`, `shake`, and a `scrim` that darkens the picture softly
behind captions. Animate them with `keys()`, keyed to cues from the timeline.

Prefer an exposure kick plus light from the scene itself to a white `flash`: over a dark frame a
flash reads as a grey veil.

## 5. The score

[`score.py`](../film/score.py) uses the synthesizer in `audio/studio`
([audio/README.md](../audio/README.md)); its design and cue sheet are in [the score](score.md).
Every time comes from the timeline, and other times are offsets from cues:

```python
tl = Timeline.load(HERE / 'timeline.json')
brass.add(tl.cue('launch'), ins.brass(['A2', 'E3', 'A3', 'C4'], 4.0, vel=0.9))
```

Render it with `npm run audio` (`--from/--to` renders a window in seconds). You cannot judge
music by reading code, so verify it with `audio/analyze.py`: loudness, onsets at the cues, hard
cuts and a spectrogram. CI does the same on every push.

## 6. The review loop

Render stills constantly and look at every one:

```bash
npm run still -- --t 12 --t 30 --grid --scale 0.25          # moments
npm run still -- --sheet --from 0 --to 80 --n 40 --cols 8   # continuity across a range
npm run still -- --t 12 --bench --scale 1                   # cost of a 1080p frame
npm run typecheck
```

Check exposure (nothing blown out or muddy), caption legibility, letterbox framing, and the
transitions between shots. For a camera move, measure it before rendering it: above about 40 px a
frame at 1080p a pan reads as judder.

## 7. Render and release

```bash
npm run audio
npm run render
npm run release
```

See [Rendering](rendering.md) for presets and performance, [Rendering on Modal](modal.md) to
render in parallel in the cloud, and [Releasing](releasing.md) for publishing a new version.
