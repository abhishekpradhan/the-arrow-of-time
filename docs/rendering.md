# Rendering

```bash
npm run audio -- <id>                    # the score first, or the render is silent
npm run render -- <id> --preset draft    # 960x540, veryfast x264, no motion blur
npm run render -- <id>                   # 1920x1080, x264 CRF 17 slow, Rec.709, AAC 320k
```

Frames are rendered by headless Chromium (WebGL2) and streamed as raw RGBA into ffmpeg. The film is
cut into segments (20 s by default) that workers pull from a queue; finished segments are kept in
`out/<id>/segments/`, so an interrupted render continues with `--resume`. Finally the segments are
joined (stream copy) and the soundtrack is muxed in. Complete renders to the default location
are also copied to `out/<id>/renders/<id>-final-latest.mp4`.

| Flag | Meaning |
| --- | --- |
| `--preset final\|draft` | quality preset |
| `--scale s` | resolution multiplier (`2` renders 3840x2160) |
| `--from s --to s`, `--frames a:b` | render a range (seconds, or exact frames, end exclusive) |
| `--workers n` | browser pages rendering in parallel |
| `--segment s` | segment length in seconds |
| `--crf n` | x264 quality (lower is better) |
| `--mb 0\|1` | motion blur off or on |
| `--gl auto\|egl\|vulkan\|swiftshader\|gpu` | WebGL backend |
| `--no-audio`, `--out file.mp4`, `--keep-segments`, `--resume` | |

## GPU or CPU

- **With a GPU** (`--gl gpu`, the default on macOS and Windows, and on Linux when a render node
  exists) frames take milliseconds to a few hundred milliseconds.
- **Another browser.** `MOVIES_BROWSER=chrome` (or `msedge`, or the path of a Chromium
  executable) renders with an installed browser instead of Playwright's Chromium, for machines
  where `npx playwright install chromium` cannot complete.
- **Without a GPU** on Linux, `--gl auto` uses Chromium's ANGLE on Mesa llvmpipe through EGL
  (`libegl1`, `libgl1-mesa-dri`). It is about 3x faster than SwiftShader. *The Arrow of Time*
  averages about 1 s per 1080p frame on a 4-core CPU, and its heaviest ray-marched shots take
  several seconds; the whole film takes a couple of hours with `--workers 2`.
- **In parallel in the cloud**, [Modal](modal.md) renders the same film in minutes with the same
  software rasterizer, so the result matches a local render.

## Performance tips

- Measure before you render: `npm run still -- <id> --t 12 --bench --scale 1`. The first frame of
  a shot pays a one-time shader compile (seconds for big shaders on LLVM), so benchmarks render
  each frame twice.
- Render soft, noisy layers (nebulae, volumes, glows) into a half-resolution target and composite
  them (`scratch(e, 0.5)` in *The Arrow of Time*).
- Bake what does not change: a ray-marched terrain whose shape never moves can be rendered once
  into a height-and-slope texture (`RenderTarget`, `rgba16f`), so each march step is one texture
  fetch instead of several noise octaves.
- Motion blur multiplies the cost by its sample count; the film enables it only where it shows.
  Its samples also anti-alias ray-marched edges (each is shifted by a sub-pixel jitter), so two
  samples are worth it for scenes with crisp silhouettes.
- Skip work a ray cannot need: rays that climb above the highest terrain never march it, points
  well above a detailed ground use its coarse shape as their distance, and a volume is marched
  only over the part of the ray that crosses its bounds.
- Keep text on the CPU canvas. Canvas `filter: blur()` costs seconds per frame on software GL.

## 4K

`--scale 2` renders 3840x2160. On a CPU that is four times the work; render 4K on Modal
(`modal run tools/modal/studio.py --project <id> --scale 2 --release --variants 2160p,1080p,poster`).
A 4K master at CRF 17 with film grain is several gigabytes; the release encodes a 2160p file at
40 Mbps that stays under GitHub's 2 GiB asset limit for films up to about six and a half minutes.

## Checking the result

```bash
.venv/bin/python tools/check_sync.py out/<id>/renders/<id>-final-latest.mp4 projects/<id>/timeline.json
```

For each sync cue this reports the biggest jump in audio level and in picture brightness within
half a second; well-synced hits agree within a frame. Which cues it checks comes from the
timeline's `syncCues` (every cue if there is none).
