# Releasing

The film is published as **GitHub Releases**: video is never committed to the repository.

## Versions

Releases are tagged `v<major>.<minor>`: `v1.0` is the first, and later versions are new cuts of
the film. The working cuts before it (v0.1 to v0.4) are described in
[`CHANGELOG.md`](../CHANGELOG.md).

- A new version is a full release at 1080p with a 720p preview and a poster.
- A cut you want feedback on before it is finished can go out as a pre-release.
- A 4K version renders with `--scale 2` and adds a 2160p file.

The newest section of [`CHANGELOG.md`](../CHANGELOG.md) becomes the "What's new" part of the
release notes.

## What a release contains

| File | Encode |
| --- | --- |
| `the-arrow-of-time-2160p.mp4` | 4K only: two-pass x264 at 40 Mbps (`--mbps-2160`), about 1.9 GB for 6:12. Much above six and a half minutes at 40 Mbps a file passes GitHub's 2 GiB asset limit, so lower the bitrate. |
| `the-arrow-of-time-1080p.mp4` | Two-pass x264 at 8 Mbps (`--mbps`), AAC 256 kbit/s |
| `the-arrow-of-time-720p.mp4` | Preview sized to fit 28 MB (`--preview-mb`), light denoise |
| `poster.jpg` | Frame at the timeline's `poster` time (`--poster`) |
| `info.json`, `SHA256SUMS` | Sizes, checksums and the commit it was rendered from |

## Checklist

1. Render the score and the master: `npm run audio`, then `npm run render` (or render on
   [Modal](modal.md)).
2. Check sync: `.venv/bin/python tools/check_sync.py out/renders/the-arrow-of-time-final-latest.mp4`.
   Hits should agree within a frame (42 ms at 24 fps).
3. Check loudness and the mix: `.venv/bin/python audio/analyze.py out/audio/score.wav --timeline
   film/timeline.json --onsets bang theia asteroidImpact launch --cut now` should report about
   -14 LUFS integrated, a true peak at or below -1 dBTP, and every check `ok`.
4. Look at a contact sheet of the whole film:
   `npm run still -- --sheet --from 0 --to 372 --n 80 --cols 10`.
5. Update `CHANGELOG.md`, the credits in `film/timeline.json` if the film borrows something new,
   and `THIRD_PARTY_NOTICES.md` to match.
6. Publish (next section).

## Publishing

**With the workflow** (renders on Modal too): *Actions → Render on Modal → Run workflow*, with
`tag` set. The release is created at the commit the workflow ran on.

**By hand**, from a local render:

```bash
npm run release                                    # -> out/release/
python3 tools/release_notes.py --tag v1.1 > notes.md
gh release create v1.1 out/release/* \
  --title "$(python3 tools/release_notes.py --tag v1.1 --title)" --notes-file notes.md
```

Link to the Releases page (or `releases/latest`) rather than to a single file: download URLs
change with every version.

## Why Releases, not Git LFS

The first two cuts were committed with Git LFS, which doesn't scale: a personal account includes
10 GiB of LFS storage and bandwidth a month, each cut adds hundreds of megabytes, and LFS storage
never shrinks (deleting a file keeps its object). Release assets have no total-size or bandwidth
limit; each file must be under 2 GiB, and a release can hold up to 1000 files.

Those two cuts' encodes (about 0.7 GB) are still LFS objects in the history. A normal clone of
`main` doesn't download them, but checking out one of those old commits does, and counts against
the owner's LFS bandwidth.
