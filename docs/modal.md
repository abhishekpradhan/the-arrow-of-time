# Rendering on Modal

A local render of a five-minute film takes about two hours on a 4-core CPU. On
[Modal](https://modal.com) the same film renders in minutes: the timeline is cut into short
slices, dozens of CPU containers render them at once, and one container joins the slices and
adds the score. Each slice is rendered by the same headless Chromium and software rasterizer
(Mesa llvmpipe) as `npm run render`, so a Modal render matches a local one frame for frame.

```text
 timeline ─► 40 slices ─► render_slice × 40 (8 cores each, in parallel) ─┐
         └─► score (synthesize the soundtrack) ──────────────────────────┤
                                                                          ▼
                              assemble (join, mux, sync check) ─► release_variant × N ─► out/<id>/
```

Everything is in [`tools/modal/studio.py`](../tools/modal/studio.py). The
[Render on Modal](../.github/workflows/render.yml) workflow runs it from GitHub Actions and can
publish the result as a GitHub Release.

## Setup

1. Create a Modal token in the [Modal dashboard](https://modal.com/settings/tokens) (or run
   `modal token new`).
2. **To render from GitHub** (recommended), add two repository secrets under *Settings → Secrets
   and variables → Actions*: `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET`.
3. **To render from your machine**, install the client into the project's virtual environment
   and log in once:

   ```bash
   .venv/bin/pip install -r tools/modal/requirements.txt
   .venv/bin/modal setup
   ```

4. Optional, but a good idea if you use Modal for other work: keep the studio in its own
   [Modal environment](https://modal.com/docs/guide/environments). Create it with
   `modal environment create movies`, then set `MODAL_ENVIRONMENT=movies` locally, or set a
   repository **variable** (not a secret) called `MODAL_ENVIRONMENT` for the workflow.

## Rendering

From GitHub: *Actions → Render on Modal → Run workflow*. The inputs mirror the command-line
flags below. Leave `tag` empty to only render: the 720p preview is attached to the run as an
artifact for a week. Set a tag such as `arrow-of-time-v0.3` to publish a GitHub Release (see
[releasing.md](releasing.md)).

From your machine (outputs land in `out/<id>/`):

```bash
modal run tools/modal/studio.py --project arrow-of-time                      # 1080p master
modal run tools/modal/studio.py --project arrow-of-time --preset draft       # half resolution, no motion blur
modal run tools/modal/studio.py --project arrow-of-time --window 182-216     # re-render one sequence
modal run tools/modal/studio.py --project arrow-of-time --release            # + 1080p, 720p, poster
modal run tools/modal/studio.py --project arrow-of-time --scale 2 --release --variants 2160p,1080p,poster   # 4K
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--project` | `arrow-of-time` | Folder in `projects/` |
| `--preset` | `final` | `final` (full resolution, motion blur) or `draft` (half resolution) |
| `--scale` | preset's | Resolution multiplier; `2` renders 3840×2160 |
| `--window A-B` | whole film | Re-render only the slices that touch seconds A to B and reuse the rest from the last render with the same preset and scale |
| `--slice-seconds` | `8` | Slice length; shorter slices mean more containers |
| `--release` | off | Also make the distribution encodes (`--variants`) |
| `--variants` | `1080p,720p,poster` | Any of `2160p`, `1080p`, `720p`, `poster` |
| `--poster` | timeline's `poster` | Poster frame time in seconds |
| `--download` | `auto` | `master`, `release`, `all` or `none` (`auto`: the release files if `--release`, else the master) |
| `--force` | off | Ignore cached slices |

## Caching

Slices, soundtracks and outputs live in one Modal Volume (default `movies-studio`), under keys
hashed from the files that can change them:

- **Video**: the engine, the project's code, shaders, timeline and assets, the render tools and
  the lockfile. A project's Markdown, `score.py` and `poster.jpg` don't count.
- **Audio**: `audio/studio/`, the project's `score.py` and `timeline.json`, and `requirements.txt`.

So a run with nothing changed renders nothing, a score-only change re-synthesizes the audio and
re-muxes, and `--window` re-renders one sequence after you edit its shot. `--window` trusts you:
it reuses slices outside the window even if shared code changed. Run a full render before
publishing.

## Staying out of the way of your other Modal work

- `modal run` creates an **ephemeral** app that stops when the command ends. Nothing is
  deployed, and no existing app, deployment or secret is created or changed.
- The only persistent object is the cache volume. It carries a marker file; if a volume with
  that name already exists without the marker, the run stops rather than write into it.
- Render containers are capped (`STUDIO_MODAL_MAX_CONTAINERS`, default 40), so a render never
  takes all of your workspace's concurrency.
- Names are configurable: `STUDIO_MODAL_APP` (default `movies-studio`) and
  `STUDIO_MODAL_VOLUME` (default `movies-studio`).

## Cost and time

Modal bills CPU per core-second and memory per GiB-second. At the list prices in September 2026
($0.0000131 per core-second, $0.00000222 per GiB-second), a render container with 8 cores and
12 GiB costs about $0.40 an hour. Every run prints its own estimate from the time its containers
actually spent.

Measured on *The Arrow of Time* v0.4 (5:38, 8,112 frames, 1080p with motion blur): its 43
slices rendered in 9 minutes on 43 containers at once, for about $1.00, and joining them plus the
1080p, 720p and poster encodes took another 5 minutes and $0.10. The slowest slice sets the pace:
most finished within 5 minutes, but the ray-marched Moon landing takes about 8 s a frame (v0.3,
without the ray-marched scenes, rendered in 4 minutes for $0.85). From v0.6 the space race
(3:30 to 4:00) is the heaviest stretch, 8 to 12 s a frame on a software renderer, so its slices
set the pace: `--slice-seconds 4` halves the wait for about the same cost. Rough numbers for a
five-minute film:

| Render | Compute | Wall-clock time |
| --- | --- | --- |
| Draft (960×540, no motion blur) | about $0.15 | 2 to 4 min |
| Final 1080p master | about $1 | 4 to 10 min |
| Final 4K master | about $2 to $4 | 10 to 20 min |
| Release encodes (1080p, 720p, poster) | about $0.10 | 5 to 7 min |

The first run also builds the container image (Debian, Node, Chromium, ffmpeg, NumPy and SciPy),
which takes about five minutes; later runs reuse it until `package-lock.json` or
`requirements.txt` changes. The workflow itself waits on Modal, so each run also uses 10 to 30
minutes of GitHub Actions time.

## Tuning

| Variable | Default | Effect |
| --- | --- | --- |
| `STUDIO_MODAL_CPU` | `8` | Cores per render container |
| `STUDIO_MODAL_WORKERS` | `3` | Browser pages rendering in parallel inside each container |
| `STUDIO_MODAL_MAX_CONTAINERS` | `40` | Render containers at once |

More containers finish sooner at about the same total cost. Each slice pays a fixed start-up of
roughly half a minute (container start, Vite, Chromium and shader compilation), so very short
slices waste money.

## Cleaning up

Old slices and renders accumulate in the volume. List and delete them with the Modal CLI:

```bash
modal volume ls movies-studio arrow-of-time
modal volume rm movies-studio arrow-of-time/final-x1/slices --recursive
modal volume delete movies-studio        # everything (the next run recreates it)
```

## Troubleshooting

- **"Could not connect to the Modal server" from a Claude Code cloud session.** Modal's API is
  gRPC over HTTP/2, and the egress proxy of those sessions relays only HTTP/1.1. Trigger the
  *Render on Modal* workflow instead (a Claude session can do that through its GitHub tools).
- **A slice fails.** The others finish and stay cached; run the same command again to retry
  only the missing slices. The error is printed with the slice's frame range.
- **Out of memory at 4K.** Lower `STUDIO_MODAL_WORKERS` to 2.
- **The volume already holds data from something else.** Set `STUDIO_MODAL_VOLUME` to a new name.
