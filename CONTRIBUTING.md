# Contributing

Thanks for helping! Fixes, engine features, new films and re-cuts of existing ones are all
welcome. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report a bug or give film feedback** with the [issue forms](https://github.com/abhishekpradhan/movies/issues/new/choose).
  For a film, the timestamp and what you noticed are enough; for a scientific detail, a source helps.
- **Improve the engine, tools or audio studio.** Anything a second film could use belongs in
  `engine/` or `audio/studio/`, not copied into a film.
- **Make a film**, or re-cut an existing one (see [Making a film](docs/making-a-film.md)).
- **Improve the docs.** If something confused you, it will confuse the next person.

## Development setup

```bash
npm install
npm run setup          # Python venv, Playwright's Chromium, ffmpeg check
npm run dev            # preview at http://localhost:5173
```

See [Getting started](docs/getting-started.md) for platform notes.

## Workflow

1. Create a branch from `main`.
2. Make the change, and keep it focused: one topic per pull request.
3. Review what you changed visually and, for the score, by analysis (below).
4. Run the checks, update the docs and `CHANGELOG.md` where it matters, and open a pull request
   using the template.

### Checks

```bash
npm run typecheck                                              # CI runs this on every push
npm run still -- <id> --t 12 --t 30 --grid --scale 0.25        # the shots you touched
npm run still -- <id> --sheet --from 0 --to 80 --n 40 --cols 8 # continuity across a range
npm run audio -- <id> --from 180 --to 220                      # a window of the score
.venv/bin/python audio/analyze.py out/<id>/audio/score.wav --timeline projects/<id>/timeline.json
```

CI type-checks the engine, tools and films, compiles the Python tools, and scaffolds and scores a
film from the template.

### Conventions

[CLAUDE.md](CLAUDE.md) lists the conventions and every pitfall this codebase has hit. The short
version:

- Timing belongs in `timeline.json`, never in shot code or the score.
- Shots render HDR, linear light and own their whole frame; dissolve by overlapping shots.
- Never put a backtick in GLSL inside a JavaScript template string; guard `pow()` and `exp()`.
- Draw animated text with `drawText`/`drawGlyph`, never raw `fillText`.
- Engine changes affect every film: render stills of every shot that uses what you touched.
- Don't commit rendered media: films are published as GitHub Releases
  ([docs/releasing.md](docs/releasing.md)).

## Licensing of contributions

- Changes to the studio code (`engine/`, `tools/`, `audio/`, `templates/`, ...) are contributed
  under the [Apache License 2.0](LICENSE), as its section 5 describes.
- Changes to a film (`projects/<id>/` and its released videos) are contributed under that film's
  license (CC BY 4.0 for *The Arrow of Time*; see its `LICENSE.md`).
- Please sign off your commits (`git commit -s`) to certify the
  [Developer Certificate of Origin](https://developercertificate.org/): that you wrote the
  change, or otherwise have the right to submit it under these licenses.
- Don't paste code you can't license this way. Shadertoy's default license (CC BY-NC-SA 3.0) and
  most tutorial code are **not** compatible. If you adapt permissively licensed code, keep its
  notice and add it to [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Making your own film

`npm run new -- <id> --title "My Film"` scaffolds a film from `templates/starter`. What you write
for your film is yours to license as you like. The scaffold it starts from and the studio code it
runs on are Apache-2.0, so keep `LICENSE` and `NOTICE` when you redistribute them.
