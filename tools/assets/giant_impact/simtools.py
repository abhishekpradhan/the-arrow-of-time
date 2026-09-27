"""Shared helpers for export.py and plots.py (SWIFT giant-impact snapshots)."""

import glob
import json
import os

import h5py
import numpy as np
from scipy.spatial import cKDTree

# The simulation's working directory (snapshots, export, plots): $GIANT_IMPACT_RUN, else
# out/giant-impact in the repository.
RUN = os.environ.get("GIANT_IMPACT_RUN") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "out", "giant-impact")
SNAPDIR = os.path.join(RUN, "impact", "snapshots")
R_E = 6.3710e6  # m (WoMa / SWIFT examples value)
MAT_CORE, MAT_MANTLE = 402, 400  # ANEOS Fe85Si15, ANEOS forsterite
ID_OFFSET_IMPACTOR = 100_000_000  # Theia particle ids start here (ics/make_impact_init_cond.py)
T_CONTACT_NOMINAL = 3600.0  # s: centre separation = R_t + R_i on the two-body orbit (WoMa set-up)
CONTACT_CACHE = os.path.join(RUN, "impact", "contact_time.json")


def snapshot_files(snapdir=SNAPDIR):
    return sorted(glob.glob(os.path.join(snapdir, "impact_*.hdf5")))


def snap_time(fn):
    with h5py.File(fn, "r") as f:
        return float(f["Header"].attrs["Time"][0])


def find_contact_time(files, use_cache=True):
    """First contact: when the closest proto-Earth/Theia particle pair comes within one
    smoothing length (mean h of the pair). Linear interpolation of (d_min - h) between
    snapshots. Tidal stretching makes this earlier than the nominal 3600 s."""
    if use_cache and os.path.exists(CONTACT_CACHE):
        with open(CONTACT_CACHE) as fp:
            c = json.load(fp)
        if c.get("n_files_checked", 0) > 0:
            return c["t_contact_s"]
    prev = None
    for fn in files:
        with h5py.File(fn, "r") as f:
            box = np.array(f["Header"].attrs["BoxSize"])
            t = float(f["Header"].attrs["Time"][0])
            if t < 0.5 * T_CONTACT_NOMINAL:
                continue
            x = f["PartType0/Coordinates"][()] - 0.5 * box
            ids = f["PartType0/ParticleIDs"][()]
            h = f["PartType0/SmoothingLengths"][()]
        th = ids >= ID_OFFSET_IMPACTOR
        d, j = cKDTree(x[~th]).query(x[th])
        k = np.argmin(d)
        gap = d[k] - 0.5 * (h[th][k] + h[~th][j[k]])  # internal length units
        if gap <= 0:
            if prev is None:
                tc = t
            else:
                t0, g0 = prev
                tc = t0 + (t - t0) * g0 / (g0 - gap)
            with open(CONTACT_CACHE, "w") as fp:
                json.dump(dict(t_contact_s=tc, definition="closest inter-body particle pair within one mean "
                               "smoothing length (linear interpolation between snapshots)",
                               t_contact_nominal_s=T_CONTACT_NOMINAL, n_files_checked=len(files)), fp, indent=1)
            return tc
        prev = (t, gap)
    return T_CONTACT_NOMINAL
