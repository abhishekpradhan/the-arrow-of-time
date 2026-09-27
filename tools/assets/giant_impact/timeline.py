#!/usr/bin/env python3
"""Event timeline of the impact from export/giant_impact.npz (all particles).

Per snapshot: planet / disk / unbound masses (Canup-style classification, see plots.py),
friends-of-friends clumps outside the planet, and the orbit of the largest clump
(Theia's remnant). Writes plots/timeline.json and plots/timeline.png and prints a summary.
Usage: python tools/assets/giant_impact/timeline.py   (reads <run>/export/giant_impact.npz)
"""

import json
import os

import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

from plots import G, M_E, M_MOON, R_E, classify, find_clumps

from simtools import RUN

d = np.load(os.path.join(RUN, "export", "giant_impact.npz"))
times = d["times"]
mass = d["mass"].astype(np.float64)
origin = d["origin"].astype(int)
material = d["material"].astype(int)
theia_core = (origin == 1) & (material == 0)

rows = []
for k in range(len(times)):
    ok = d["alive"][k]
    s = dict(x=d["pos"][k][ok].astype(np.float64) * R_E, v=d["vel"][k][ok].astype(np.float64) * R_E,
             m=mass[ok], rho=d["rho"][k][ok].astype(np.float64), origin=origin[ok], material=material[ok])
    cls = classify(s)
    clumps = find_clumps(s, cls) if times[k] > 0 else []
    r = np.linalg.norm(s["x"], axis=1) / R_E
    tc = theia_core[ok]
    row = dict(t_h=float(times[k] / 3600), M_planet_ME=cls["M_p"] / M_E, R_planet_RE=cls["R_p"] / R_E,
               M_disk_moon=float(s["m"][cls["disk"]].sum() / M_MOON),
               M_unbound_moon=float(s["m"][cls["esc"]].sum() / M_MOON),
               disk_theia_frac=float(s["m"][cls["disk"] & (s["origin"] == 1)].sum() / max(s["m"][cls["disk"]].sum(), 1)),
               theia_core_in_planet=float(s["m"][tc & cls["planet"]].sum() / s["m"][tc].sum()),
               theia_core_r_median_RE=float(np.median(r[tc])),
               n_clumps=len(clumps), clumps=clumps[:6])
    if clumps:
        # orbit of the largest clump about the planet
        from scipy.spatial import cKDTree  # noqa: F401  (find_clumps already used it)
        c0 = clumps[0]
        row["clump0_mass_moon"] = c0["mass_moon"]
        row["clump0_r_RE"] = c0["r_RE"]
    rows.append(row)

# radial motion of the largest clump (Theia's remnant) and events
t = np.array([r_["t_h"] for r_ in rows])
rc = np.array([r_.get("clump0_r_RE", np.nan) for r_ in rows])
mc = np.array([r_.get("clump0_mass_moon", 0.0) for r_ in rows])
md = np.array([r_["M_disk_moon"] for r_ in rows])
nc = np.array([r_["n_clumps"] for r_ in rows])
os.makedirs(os.path.join(RUN, "plots"), exist_ok=True)
with open(os.path.join(RUN, "plots", "timeline.json"), "w") as fp:
    json.dump(rows, fp, indent=1)

fig, ax = plt.subplots(3, 1, figsize=(10, 9), sharex=True)
ax[0].plot(t, rc, ".-", ms=2)
ax[0].set_ylabel("largest clump distance [R_E]")
ax[0].set_ylim(0, 20)
ax[0].grid(alpha=0.3)
ax[1].plot(t, mc, label="largest clump")
ax[1].plot(t, md, label="disk (bound, periapsis > R_p)")
ax[1].plot(t, [r_["M_unbound_moon"] for r_ in rows], label="unbound")
ax[1].set_ylabel("mass [lunar masses]")
ax[1].set_ylim(0, 6)
ax[1].legend(fontsize=8)
ax[1].grid(alpha=0.3)
ax[2].plot(t, nc, label="number of clumps (>=20 particles)")
ax[2].plot(t, [r_["theia_core_in_planet"] for r_ in rows], label="fraction of Theia's core in the planet")
ax[2].set_xlabel("hours since first contact")
ax[2].legend(fontsize=8)
ax[2].grid(alpha=0.3)
fig.tight_layout()
fig.savefig(os.path.join(RUN, "plots", "timeline.png"), dpi=110)

for r_ in rows:
    if r_["t_h"] < -0.5:
        continue
    th = r_["t_h"]
    if th < 3 or abs(th * 2 - round(th * 2)) < 0.02:
        print("t=%+6.2f h  planet %.3f M_E  disk %.2f  unbound %.2f  (lunar masses)  Theia core in planet %.0f%%  "
              "clumps %d: %s" % (th, r_["M_planet_ME"], r_["M_disk_moon"], r_["M_unbound_moon"],
                                 100 * r_["theia_core_in_planet"], r_["n_clumps"],
                                 [(round(c["mass_moon"], 3), round(c["r_RE"], 1)) for c in r_["clumps"][:4]]))
