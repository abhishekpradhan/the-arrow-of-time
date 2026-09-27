"""Pack the Moon-forming giant-impact simulation into a compact film asset.

    .venv/bin/python tools/assets/build_giant_impact.py giant_impact.npz [--budget 20000]

The input is the export of the SPH simulation described in tools/assets/giant_impact/README.md:
positions, temperatures and smoothing lengths of every particle at every snapshot, in Earth
radii, centred on the proto-Earth's core. This keeps what the camera can see:

- every particle that is ever thrown clear of the Earth (the bridge, the spiral arms, the disk
  and the escaping spray), and all of Theia;
- a thinned sample of the rest, denser near the surface than deep inside, where nothing is
  ever seen. Thinned particles get bigger sprites (``grow``), so the Earth stays a continuous
  surface.

It also thins the frames to what the film's time map needs (``--steps``).

Output (assets/giant-impact/):
  impact.json    counts, frame times (hours after first contact), scales, Theia's centre per frame
  impact.bin.gz  gzip of, in order:
    positions  [frame][particle][xyz] in steps of posScale Earth radii, as int16 residuals of a
               linear prediction from the two previous frames, zigzag varint coded (the predictor
               and wrap-around are spelled out in predict() below and in shots/moon.ts)
    temp       uint8 [frame][particle], log scale tempMin..tempMax (K), each frame minus the last (mod 256)
    h          uint8 [frame][particle], log scale hMin..hMax (Earth radii), the same way
    kind       uint8 [particle]: origin (0 proto-Earth, 1 Theia) + 2 * material (0 core, 1 mantle)
    grow       uint8 [particle]: sprite size multiplier * 32
Particles that have left the simulation box are parked at +32767 with h code 255.
"""

from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets" / "giant-impact"

POS_SCALE = 1 / 320  # Earth radii per step: +-102 R_E at 20 km resolution
T_MIN, T_MAX = 1000.0, 60000.0
H_MIN, H_MAX = 0.02, 0.4
GONE = 32767


def log_code(x: np.ndarray, lo: float, hi: float) -> np.ndarray:
    v = np.log(np.clip(x, lo, hi) / lo) / np.log(hi / lo) * 254
    return np.round(v).astype(np.uint8)


def wrap16(x: np.ndarray) -> np.ndarray:
    return ((x + 32768) % 65536) - 32768


def predict(q1: np.ndarray, q0: np.ndarray, rho: float) -> np.ndarray:
    """Next frame from the last two: q1 + floor((q1 - q0) * rho + 0.5), rho = dt_next / dt_last."""
    return q1 + np.floor((q1 - q0) * rho + 0.5).astype(np.int64)


def zigzag_varint(v: np.ndarray) -> bytes:
    z = np.where(v >= 0, 2 * v, -2 * v - 1).astype(np.uint32)  # |v| < 2^15, so z < 2^16
    b = np.zeros((len(z), 3), np.uint8)
    n1, n2 = z >= 0x80, z >= 0x4000
    b[:, 0] = (z & 0x7F) | (n1.astype(np.uint32) << 7)
    b[:, 1] = ((z >> 7) & 0x7F) | (n2.astype(np.uint32) << 7)
    b[:, 2] = z >> 14
    return b[np.arange(3)[None, :] < (1 + n1 + n2)[:, None]].tobytes()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("npz")
    ap.add_argument("--budget", type=int, default=20000, help="particles to keep")
    ap.add_argument("--from-h", type=float, default=-0.8, help="first frame, hours after contact")
    ap.add_argument("--to-h", type=float, default=21.0, help="last frame, hours after contact")
    ap.add_argument("--steps", default="-9:300,0:150,1.2:300,2:600,5.5:300,6.6:600,11:1200",
                    help="minimum spacing of kept frames: hours:seconds, each from that hour on")
    ap.add_argument("--eject", type=float, default=1.35, help="r_max (R_E) that marks a particle as ejecta")
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()

    d = np.load(a.npz)
    times_h = d["times"] / 3600.0
    pos, alive = d["pos"], d["alive"]
    origin, material = d["origin"].astype(np.int64), d["material"].astype(np.int64)
    n_all = len(origin)

    # ---- frames
    steps = sorted((float(k), float(v)) for k, v in (s.split(":") for s in a.steps.split(",")))

    def spacing(t: float) -> float:
        return [v for hh, v in steps if t >= hh - 1e-9][-1] if t >= steps[0][0] - 1e-9 else steps[0][1]

    keep_f: list[int] = []
    for k, t in enumerate(times_h):
        if a.from_h - 1e-9 <= t <= a.to_h + 1e-9 and (not keep_f or (t - times_h[keep_f[-1]]) * 3600 >= spacing(t) - 1):
            keep_f.append(k)
    F = np.array(keep_f)
    times = np.round(times_h[F], 5)
    print(f"{len(F)} of {len(times_h)} frames, {times[0]:+.2f} h .. {times[-1]:+.2f} h")

    # ---- particles
    r = np.linalg.norm(pos[F], axis=2)  # [frame, particle], NaN once gone
    after = times > 0.3
    rmax = np.nanmax(np.where(alive[F][after], r[after], 0.0), axis=0)
    eject = (rmax > a.eject) | (origin == 1) | ~alive[F].all(axis=0)
    rng = np.random.default_rng(a.seed)
    idx_e = np.flatnonzero(eject)
    idx_b = np.flatnonzero(~eject)
    if len(idx_e) > a.budget:
        idx_e = np.sort(rng.choice(idx_e, a.budget, replace=False))
    # Body particles: the sampling weight rises from the deep interior (never seen) to the surface.
    w = np.clip((rmax[idx_b] - 0.55) / (0.95 - 0.55), 0.0, 1.0) ** 2 * 0.9 + 0.1
    room = max(0, a.budget - len(idx_e))
    lo, hi = 0.0, 1e6  # scale the weights so that `room` particles are kept on average
    for _ in range(60):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if np.minimum(1, w * mid).sum() < room else (lo, mid)
    p = np.minimum(1.0, w * lo)
    pick_b = idx_b[rng.random(len(idx_b)) < p]
    rate = np.ones(n_all)
    rate[idx_b] = p
    sel = np.sort(np.concatenate([idx_e, pick_b]))
    n = len(sel)
    grow = np.clip(rate[sel] ** (-1 / 3), 1, 7.9)
    print(f"{n} of {n_all} particles: {len(idx_e)} ejecta and Theia (all), {len(pick_b)} of {len(idx_b)} "
          f"others (sampled at {p.min():.2f}..{p.max():.2f})")

    # ---- positions: residuals of a linear prediction, zigzag varint coded
    gone = ~alive[F][:, sel]
    q = np.clip(np.round(np.nan_to_num(pos[F][:, sel, :]) / POS_SCALE), -GONE, GONE).astype(np.int64)
    q[gone] = GONE
    res = np.empty_like(q)
    res[0] = q[0]
    res[1] = wrap16(q[1] - q[0])
    for k in range(2, len(F)):
        rho = (times[k] - times[k - 1]) / (times[k - 1] - times[k - 2])
        res[k] = wrap16(q[k] - predict(q[k - 1], q[k - 2], rho))
    pos_bytes = zigzag_varint(res.ravel())

    # ---- temperature and smoothing length: log codes, frame-to-frame differences
    Tq = log_code(np.nan_to_num(d["temp"][F][:, sel], nan=T_MIN), T_MIN, T_MAX)
    Hq = log_code(np.nan_to_num(d["h"][F][:, sel], nan=H_MAX), H_MIN, H_MAX)
    Hq[gone] = 255
    dT, dH = Tq.copy(), Hq.copy()
    dT[1:] = Tq[1:] - Tq[:-1]  # uint8 arithmetic wraps like the decoder's
    dH[1:] = Hq[1:] - Hq[:-1]
    kind = (origin[sel] + 2 * material[sel]).astype(np.uint8)
    growq = np.round(grow * 32).astype(np.uint8)

    # Theia's centre (its core particles, while they hold together), for sunlight on the intact body.
    th_core = (origin == 1) & (material == 0)
    theia = np.nanmean(np.where(alive[F][:, th_core, None], pos[F][:, th_core, :], np.nan), axis=1)

    OUT.mkdir(parents=True, exist_ok=True)
    blob = b"".join([pos_bytes, dT.tobytes(), dH.tobytes(), kind.tobytes(), growq.tobytes()])
    with gzip.GzipFile(OUT / "impact.bin.gz", "wb", compresslevel=9, mtime=0) as f:
        f.write(blob)
    meta = {
        "source": "SWIFT SPH simulation of the Moon-forming impact; see tools/assets/giant_impact/README.md",
        "n": int(n),
        "frames": int(len(F)),
        "times": [float(t) for t in times],
        "posBytes": len(pos_bytes),
        "posScale": POS_SCALE,
        "tempMin": T_MIN, "tempMax": T_MAX,
        "hMin": H_MIN, "hMax": H_MAX,
        "theiaCentre": [[round(float(v), 3) for v in c] for c in np.nan_to_num(theia)],
        "counts": {"ejecta": int(len(idx_e)), "others": int(len(pick_b)), "othersTotal": int(len(idx_b)),
                   "all": int(n_all)},
    }
    (OUT / "impact.json").write_text(json.dumps(meta, separators=(",", ":")) + "\n")
    size = (OUT / "impact.bin.gz").stat().st_size
    print(f"wrote {OUT / 'impact.bin.gz'}: {len(blob) / 1e6:.1f} MB raw, {size / 1e6:.1f} MB gzip "
          f"(positions {len(pos_bytes) / 1e6:.1f} MB varint)")


if __name__ == "__main__":
    main()
