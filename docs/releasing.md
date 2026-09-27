# Releasing a film

Finished films are published as **GitHub Releases**, never committed to the repository.

## Why Releases, not Git LFS

The first two cuts of *The Arrow of Time* were committed with Git LFS. That doesn't scale:

- Personal accounts include 10 GiB of LFS storage and 10 GiB of LFS bandwidth a month, and each
  cut of this film adds about 350 MB. Every clone or CI checkout that pulls the videos spends
  bandwidth.
- LFS storage never shrinks. Deleting a file keeps its LFS object; GitHub's documented way to
  purge objects is to delete and recreate the repository, or to ask GitHub Support.
- Release assets have no total-size or bandwidth limit. Each file must be under 2 GiB, and a
  release can have up to 1000 files.

Cut v0.2 now lives on the Releases page. Its LFS objects (and v0.1's), about 0.7 GB, still count
toward LFS storage. That is well within the free quota. If you want a clean history before
making the repository public, recreate it or contact GitHub Support.

## Versions

Tags are `<project>-v<major>.<minor>`, for example `arrow-of-time-v0.3`.

- Working cuts are **pre-releases** at 1080p, with a 720p preview.
- The finished film is a full release, rendered in 4K (`--scale 2`) with a 2160p variant.

Each film can keep a `projects/<id>/CHANGELOG.md`; its newest section becomes the "What's new"
part of the release notes.

## What a release contains

| File | Encode |
| --- | --- |
| `<id>-2160p.mp4` | 4K cuts only: two-pass x264 at 40 Mbps (`--mbps-2160`), about 1.6 GB for five and a half minutes. Above about 6.5 minutes at 40 Mbps a file passes the 2 GiB asset limit, so lower the bitrate. |
| `<id>-1080p.mp4` | Two-pass x264 at 8 Mbps (`--mbps`), AAC 256 kbit/s |
| `<id>-720p.mp4` | Preview sized to fit 28 MB (`--preview-mb`), light denoise |
| `poster.jpg` | Frame at the timeline's `poster` time (`--poster`) |
| `info.json`, `SHA256SUMS` | Sizes, checksums and the commit it was rendered from |

## Checklist

1. Render the score and the master: `npm run audio -- <id>` then `npm run render -- <id>`, or
   use Modal.
2. Check sync: `.venv/bin/python tools/check_sync.py <master> projects/<id>/timeline.json`.
   Hits should agree within a frame (42 ms at 24 fps).
3. Check loudness and the mix: `.venv/bin/python audio/analyze.py <wav> --timeline ...` should
   report about -14 LUFS integrated and a true peak at or below -1 dBTP.
4. Look at a contact sheet of the whole film:
   `npm run still -- <id> --sheet --from 0 --to <duration> --n 80 --cols 10`.
5. Update the film's `CHANGELOG.md` and credits.
6. Publish (next section).

## Publishing

**With the workflow** (renders on Modal too): *Actions → Render on Modal → Run workflow*, with
`tag` set. The release is created at the commit the workflow ran on.

**By hand**, from a local render:

```bash
npm run release -- arrow-of-time                  # -> out/arrow-of-time/release/
python3 tools/release_notes.py arrow-of-time --tag arrow-of-time-v0.3 > notes.md
gh release create arrow-of-time-v0.3 out/arrow-of-time/release/* --prerelease \
  --title "$(python3 tools/release_notes.py arrow-of-time --tag arrow-of-time-v0.3 --title)" \
  --notes-file notes.md
```

Link to the Releases page from READMEs, not to a single file: download URLs change with every
cut.
