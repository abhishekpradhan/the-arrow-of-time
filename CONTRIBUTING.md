# Contributing

Thanks for helping! Fixes, engine features, new films and re-cuts of existing ones are all welcome.

## Licensing of contributions

- Changes to the studio code (`engine/`, `tools/`, `audio/`, `templates/`, ...) are contributed
  under the [Apache License 2.0](LICENSE), as its section 5 describes.
- Changes to a film (`projects/<id>/`, `releases/<id>/`) are contributed under that film's
  license (CC BY 4.0 for *The Arrow of Time*; see its `LICENSE.md`).
- Please sign off your commits (`git commit -s`) to certify the
  [Developer Certificate of Origin](https://developercertificate.org/): that you wrote the
  change, or otherwise have the right to submit it under these licenses.
- Don't paste code you can't license this way. Shadertoy's default license (CC BY-NC-SA 3.0)
  and most tutorial code are **not** compatible. If you adapt permissively licensed code, keep
  its notice and add it to [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Before you open a pull request

```bash
npm run typecheck                                   # CI runs this too
npm run still -- <id> --t 12 --t 30 --grid --scale 0.25   # look at what you changed
```

- Read [CLAUDE.md](CLAUDE.md): it lists the conventions and the pitfalls this codebase has hit.
- Engine changes affect every film: render stills of the shots that use what you touched.
- Timing belongs in `timeline.json`, never in shot code.
- Don't commit rendered media except through `npm run release` (Git LFS).

## Making your own film

`npm run new -- <id> --title "My Film"` scaffolds a film from `templates/starter`. What you write
for your film is yours to license as you like. The scaffold it starts from and the studio code it
runs on are Apache-2.0, so keep `LICENSE` and `NOTICE` when you redistribute them.
