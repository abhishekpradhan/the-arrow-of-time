# Contributing

Thanks for helping make *The Arrow of Time* better. Please follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Give feedback on the film** with the
  [issue forms](https://github.com/abhishekpradhan/the-arrow-of-time/issues/new/choose): the
  timestamp and what you noticed are enough. For a scientific or historical point, a source helps.
- **Report a bug** in building, previewing or rendering the film.
- **Improve the engine, the tools or the synthesizer.** Keep the engine general: anything that
  isn't specific to one scene belongs in `engine/` or `audio/studio/`, not in `film/`.
- **Improve a scene, a caption or the score**, with stills (and for the score, an analysis) that
  show the difference.
- **Improve the docs.** If something confused you, it will confuse the next person.

Re-cuts, translations and remixes of the film don't need to come back here: the film is
CC BY 4.0 and the code is MIT, so you can make your own and publish it, with credit
([how](film/LICENSE.md)).

## Development setup

```bash
npm install
npm run setup          # Python venv, Playwright's Chromium, ffmpeg check
npm run dev            # preview at http://localhost:5173
```

See [Getting started](docs/getting-started.md) for platform notes and
[Working on the film](docs/working-on-the-film.md) for how the film is put together.

## Workflow

1. Create a branch from `main`.
2. Make the change, and keep it focused: one topic per pull request.
3. Review what you changed by eye and, for the score, by analysis (below).
4. Run the checks, update the docs and `CHANGELOG.md` where it matters, and open a pull request
   using the template.

### Checks

```bash
npm run typecheck                                          # CI runs this on every push
npm run still -- --t 12 --t 30 --grid --scale 0.25         # the shots you touched
npm run still -- --sheet --from 0 --to 80 --n 40 --cols 8  # continuity across a range
npm run audio -- --from 180 --to 220                       # a window of the score
.venv/bin/python audio/analyze.py out/audio/score.wav --timeline film/timeline.json
```

CI type-checks the engine, the film and the tools, compiles the Python, synthesizes the whole
score and checks its hits and cuts against the timeline.

### Conventions

[AGENTS.md](AGENTS.md) lists the conventions and every pitfall this code has hit. The short
version:

- Timing belongs in `film/timeline.json`, never in shot code or the score.
- Shots render HDR, linear light and own their whole frame; dissolve by overlapping shots.
- Never put a backtick in GLSL inside a JavaScript template string; guard `pow()` and `exp()`.
- Draw animated text with `drawText`/`drawGlyph`, never raw `fillText`.
- Engine changes affect the whole film: render stills of every shot that uses what you touched.
- Don't commit rendered media: the film is published as GitHub Releases
  ([docs/releasing.md](docs/releasing.md)).

## Licensing of contributions

By contributing, you agree that your contribution is licensed like the rest of the repository:
code under the [MIT License](LICENSE), and changes to the film itself (its captions and other
words, and what it shows and sounds like) under [CC BY 4.0](film/LICENSE.md).

Don't paste code you can't license this way. Shadertoy's default license (CC BY-NC-SA 3.0) and
most tutorial code are **not** compatible. If you adapt permissively licensed code, keep its
copyright notice in a comment and add it to [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
