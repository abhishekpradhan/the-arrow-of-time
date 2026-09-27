#!/usr/bin/env python3
"""Diagnostic plots + simple disk/moonlet analysis of the SWIFT giant-impact snapshots.

Usage: python tools/assets/giant_impact/plots.py [--times 0 1 3 6 12 24 ...] [--analysis-every 1]

Writes to <run>/plots/ (<run>: $GIANT_IMPACT_RUN, else out/giant-impact):
  impact_t+XXh.png         per-time panels: top-down (x-y) coloured by temperature and by
                           origin/material (+-8 R_E, +-16 R_E from +7 h), edge-on (x-z) by origin,
                           wide top-down (+-40 R_E)
  overview_temperature.png grid of top-down views at all requested times (temperature)
  overview_origin.png      same, coloured by body of origin / material
  disk_evolution.png       planet / disk / escaping mass and clump masses vs time
  analysis.json            the numbers behind disk_evolution.png

Temperatures come from the ANEOS tables via WoMa (T(u, rho)). Uses all particles.
Frame: centred on the proto-Earth core centre of mass (same as export.py). Times are hours
since first contact (closest inter-body particle pair within one smoothing length, ~3450 s).
Disk classification (Canup 2004-style): relative to the planet centre, a particle is
escaping if its two-body orbital energy E >= 0 (mass M_p), in the planet if bound with
periapsis q < R_p, otherwise in the disk; M_p is iterated and R_p = (3 M_p / 4 pi rho_E)^(1/3)
with rho_E = 5510 kg/m^3. Clumps: friends-of-friends (linking length 0.25 R_E) on
non-planet particles with rho > 1000 kg/m^3.
"""

import argparse
import glob
import json
import os

import h5py
import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LogNorm, ListedColormap
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

from simtools import RUN, SNAPDIR
R_E = 6.3710e6
M_E = 5.9724e24
M_MOON = 7.346e22
G = 6.67430e-11
MAT_CORE = 402
ID_OFFSET_IMPACTOR = 100_000_000
T_CONTACT = 3600.0  # replaced in main() by the measured first-contact time (simtools.find_contact_time)
RHO_EARTH = 5510.0

ORIGIN_COLORS = {  # (origin, material) -> colour
    (0, 1): "#5b8fd6",  # proto-Earth mantle
    (0, 0): "#2c3e66",  # proto-Earth core
    (1, 1): "#ff9a3c",  # Theia mantle
    (1, 0): "#d7263d",  # Theia core
}


def load(fn, want_temp=True):
    with h5py.File(fn, "r") as f:
        box = np.array(f["Header"].attrs["BoxSize"])
        t = float(f["Header"].attrs["Time"][0])
        p = f["PartType0"]
        x = (p["Coordinates"][()] - 0.5 * box) * 1e6  # m (internal length 1e6 m)
        v = p["Velocities"][()].astype(np.float64) * 1e6  # m/s
        m = p["Masses"][()].astype(np.float64) * 1e24  # kg
        u = p["InternalEnergies"][()].astype(np.float64) * 1e12  # J/kg
        rho = p["Densities"][()].astype(np.float64) * 1e24 / 1e18  # kg/m^3
        mat = p["MaterialIDs"][()].astype(np.int64)
        ids = p["ParticleIDs"][()].astype(np.int64)
    origin = (ids >= ID_OFFSET_IMPACTOR).astype(int)
    core_e = (origin == 0) & (mat == MAT_CORE)
    c = (m[core_e, None] * x[core_e]).sum(0) / m[core_e].sum()
    cv = (m[core_e, None] * v[core_e]).sum(0) / m[core_e].sum()
    d = dict(t=t, x=x - c, v=v - cv, m=m, u=u, rho=rho, mat=mat, ids=ids, origin=origin,
             material=np.where(mat == MAT_CORE, 0, 1))
    if want_temp:
        from eos_temp import temperature
        d["T"] = temperature(u, rho, mat)
    return d


def classify(d):
    r_vec, v_vec, m = d["x"], d["v"], d["m"]
    r = np.linalg.norm(r_vec, axis=1)
    v2 = (d["v"] ** 2).sum(1)
    L = np.linalg.norm(np.cross(r_vec, v_vec), axis=1)
    M_p = m[r < 1.5 * R_E].sum()
    for _ in range(30):
        R_p = (3 * M_p / (4 * np.pi * RHO_EARTH)) ** (1 / 3)
        mu = G * M_p
        E = 0.5 * v2 - mu / np.maximum(r, 1.0)
        bound = E < 0
        a = np.where(bound, -mu / (2 * np.where(bound, E, -1.0)), np.inf)
        e = np.sqrt(np.maximum(0.0, 1 + 2 * E * L**2 / mu**2))
        q = np.where(bound, a * (1 - e), np.inf)
        planet = bound & ((q < R_p) | (r < R_p))
        M_new = m[planet].sum()
        if abs(M_new - M_p) < 1e-6 * M_p:
            break
        M_p = M_new
    disk = bound & ~planet
    esc = ~bound
    Lz = np.cross(r_vec, v_vec)[:, 2] * m
    return dict(planet=planet, disk=disk, esc=esc, M_p=M_p, R_p=R_p, Lz=Lz)


def find_clumps(d, cls, link=0.25 * R_E, rho_min=1000.0, min_n=20):
    sel = np.flatnonzero((~cls["planet"]) & (d["rho"] > rho_min))
    if len(sel) < min_n:
        return []
    tree = cKDTree(d["x"][sel])
    pairs = tree.query_pairs(link, output_type="ndarray")
    from scipy.sparse import coo_matrix
    n = len(sel)
    A = coo_matrix((np.ones(len(pairs)), (pairs[:, 0], pairs[:, 1])), shape=(n, n))
    ncomp, lab = connected_components(A, directed=False)
    out = []
    for g in range(ncomp):
        mem = sel[lab == g]
        if len(mem) < min_n:
            continue
        mg = d["m"][mem].sum()
        cg = (d["m"][mem, None] * d["x"][mem]).sum(0) / mg
        out.append(dict(n=int(len(mem)), mass_moon=float(mg / M_MOON), r_RE=float(np.linalg.norm(cg) / R_E),
                        theia_frac=float(d["m"][mem][d["origin"][mem] == 1].sum() / mg),
                        in_disk_frac=float(cls["disk"][mem].mean())))
    return sorted(out, key=lambda c: -c["mass_moon"])


def scatter(ax, d, xy, colors, lim, size=0.25, zsort=True):
    i, j = xy
    k = 3 - i - j
    order = np.argsort(d["x"][:, k]) if zsort else slice(None)
    X = d["x"][order, i] / R_E
    Y = d["x"][order, j] / R_E
    ax.scatter(X, Y, c=colors[order] if not isinstance(colors, str) else colors, s=size, lw=0,
               rasterized=True)
    ax.set_xlim(-lim, lim)
    ax.set_ylim(-lim, lim)
    ax.set_aspect("equal")
    ax.set_facecolor("black")
    ax.tick_params(colors="0.7", labelsize=7)
    for s in ax.spines.values():
        s.set_color("0.4")


def origin_colors(d):
    keys = list(zip(d["origin"], d["material"]))
    return np.array([matplotlib.colors.to_rgba(ORIGIN_COLORS[k]) for k in keys])


def temp_colors(d, norm, cmap):
    return cmap(norm(np.clip(d["T"], norm.vmin, norm.vmax)))


def label(t):
    h = (t - T_CONTACT) / 3600
    return "%+.1f h" % h if abs(h - round(h)) > 1e-3 else "%+d h" % round(h)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapdir", default=SNAPDIR)
    ap.add_argument("--outdir", default=os.path.join(RUN, "plots"))
    ap.add_argument("--times", type=float, nargs="*", default=[-0.5, 0, 0.5, 1, 2, 3, 4.5, 6, 7, 8, 10, 12, 16, 20, 22, 24],
                    help="hours relative to nominal contact")
    ap.add_argument("--analysis-every", type=int, default=2,
                    help="analyse every n-th snapshot (0 = skip; timeline.py does the full analysis)")
    args = ap.parse_args()
    os.makedirs(args.outdir, exist_ok=True)

    global T_CONTACT
    from simtools import find_contact_time, snapshot_files
    files = snapshot_files(args.snapdir)
    T_CONTACT = find_contact_time(files)
    print("first contact at t_sim = %.1f s" % T_CONTACT)
    times = []
    for fn in files:
        with h5py.File(fn, "r") as f:
            times.append(float(f["Header"].attrs["Time"][0]))
    times = np.array(times)
    print("%d snapshots, t = %.0f .. %.0f s" % (len(files), times[0], times[-1]))

    # ---------- per-time panels + overview grids ----------
    want = [h for h in args.times if T_CONTACT + h * 3600 <= times[-1] + 1]
    picks = [int(np.argmin(abs(times - (T_CONTACT + h * 3600)))) for h in want]
    norm = LogNorm(vmin=1500, vmax=15000)
    cmap = ListedColormap(plt.get_cmap("inferno")(np.linspace(0.2, 1.0, 256)))  # keep ~2000 K visible
    snaps = {}
    for k in picks:
        d = load(files[k])
        snaps[k] = d
        cls = classify(d)
        fig, axs = plt.subplots(2, 2, figsize=(11, 11), facecolor="black")
        tc = temp_colors(d, norm, cmap)
        oc = origin_colors(d)
        zl = 8 if d["t"] - T_CONTACT < 7 * 3600 else 16
        scatter(axs[0, 0], d, (0, 1), tc, zl)
        axs[0, 0].set_title("top-down (x-y), temperature", color="w", fontsize=9)
        scatter(axs[0, 1], d, (0, 1), oc, zl)
        axs[0, 1].set_title("top-down (x-y), origin: blue proto-Earth, orange Theia (dark = core)",
                            color="w", fontsize=9)
        scatter(axs[1, 0], d, (0, 2), oc, zl)
        axs[1, 0].set_title("edge-on (x-z), origin", color="w", fontsize=9)
        scatter(axs[1, 1], d, (0, 1), tc, 40, size=0.4)
        axs[1, 1].set_title("top-down wide (+-40 R_E), temperature", color="w", fontsize=9)
        for ax in axs.flat:
            ax.set_xlabel("R_earth", color="0.7", fontsize=8)
        sm = plt.cm.ScalarMappable(norm=norm, cmap=cmap)
        cax = axs[0, 0].inset_axes([0.62, 0.93, 0.35, 0.03])
        cb = fig.colorbar(sm, cax=cax, orientation="horizontal")
        cb.set_label("T [K]", color="w", fontsize=7)
        cb.ax.tick_params(colors="w", labelsize=6)
        if d["t"] > T_CONTACT + 1800:
            summary = ("bound planet %.3f M_E, disk (bound, periapsis > R_p) %.2f M_moon, unbound %.2f M_moon"
                       % (cls["M_p"] / M_E, d["m"][cls["disk"]].sum() / M_MOON, d["m"][cls["esc"]].sum() / M_MOON))
        else:
            summary = "(disk/escape classification only meaningful after the collision)"
        fig.suptitle("Moon-forming impact, SWIFT SPH, %d particles:  t = %s from contact  (sim t = %.0f s)\n%s"
                     % (len(d["m"]), label(d["t"]), d["t"], summary), color="w", fontsize=11)
        h = (d["t"] - T_CONTACT) / 3600
        fn_out = os.path.join(args.outdir, "impact_t%+05.1fh.png" % h)
        fig.savefig(fn_out, dpi=110, facecolor="black")
        plt.close(fig)
        print("wrote", fn_out)

    for mode in ("temperature", "origin"):
        n = len(picks)
        ncol = min(4, n)
        nrow = int(np.ceil(n / ncol))
        fig, axs = plt.subplots(nrow, ncol, figsize=(4 * ncol, 4 * nrow), facecolor="black", squeeze=False)
        for a in axs.flat:
            a.axis("off")
        for a, k in zip(axs.flat, picks):
            a.axis("on")
            d = snaps[k]
            col = temp_colors(d, norm, cmap) if mode == "temperature" else origin_colors(d)
            th = (d["t"] - T_CONTACT) / 3600
            lim = 6 if th < 2 else (10 if th < 11 else 16)
            scatter(a, d, (0, 1), col, lim, size=0.2)
            a.set_title("%s   (+-%d R_E)" % (label(d["t"]), lim), color="w", fontsize=10)
        fig.suptitle("top-down view coloured by %s" % ("temperature (1500-15000 K, log)" if mode == "temperature"
                     else "origin: blue proto-Earth, orange Theia; dark = iron core"), color="w")
        fig.tight_layout(rect=(0, 0, 1, 0.97))
        fn_out = os.path.join(args.outdir, "overview_%s.png" % mode)
        fig.savefig(fn_out, dpi=100, facecolor="black")
        plt.close(fig)
        print("wrote", fn_out)

    # ---------- disk / clump analysis over time ----------
    if args.analysis_every <= 0:
        return
    rows = []
    for k in range(0, len(files), args.analysis_every):
        d = load(files[k], want_temp=False)
        cls = classify(d)
        clumps = find_clumps(d, cls) if d["t"] > T_CONTACT else []
        m = d["m"]
        Ld = cls["Lz"][cls["disk"]].sum()
        Md = m[cls["disk"]].sum()
        rows.append(dict(t_h=(d["t"] - T_CONTACT) / 3600, M_planet_ME=cls["M_p"] / M_E, R_planet_RE=cls["R_p"] / R_E,
                         M_disk_moon=Md / M_MOON, M_esc_moon=m[cls["esc"]].sum() / M_MOON,
                         L_disk=float(Ld),
                         a_eq_disk_RE=float((Ld / Md) ** 2 / (G * cls["M_p"]) / R_E) if Md > 0 else 0.0,
                         disk_theia_frac=float(m[cls["disk"] & (d["origin"] == 1)].sum() / Md) if Md > 0 else 0.0,
                         disk_iron_moon=float(m[cls["disk"] & (d["material"] == 0)].sum() / M_MOON),
                         n_alive=int(len(m)), clumps=clumps[:5]))
        if k % 20 == 0:
            r = rows[-1]
            print("t=%+6.2f h  M_p=%.3f M_E  disk=%.2f M_moon (Theia %.0f%%, a_eq %.2f R_E)  esc=%.2f M_moon  clumps=%s"
                  % (r["t_h"], r["M_planet_ME"], r["M_disk_moon"], 100 * r["disk_theia_frac"], r["a_eq_disk_RE"],
                     r["M_esc_moon"], [(c["n"], round(c["mass_moon"], 3), round(c["r_RE"], 1)) for c in clumps[:3]]),
                  flush=True)
    with open(os.path.join(args.outdir, "analysis.json"), "w") as fp:
        json.dump(rows, fp, indent=1)

    th = np.array([r["t_h"] for r in rows])
    fig, ax = plt.subplots(1, 2, figsize=(12, 4.5))
    ax[0].plot(th, [r["M_disk_moon"] for r in rows], label="disk (bound, periapsis > R_p)")
    ax[0].plot(th, [r["M_esc_moon"] for r in rows], label="escaping (unbound)")
    ax[0].plot(th, [r["disk_iron_moon"] for r in rows], label="iron in disk")
    ax[0].plot(th, [r["clumps"][0]["mass_moon"] if r["clumps"] else 0 for r in rows], label="largest clump")
    ax[0].set_xlabel("hours since contact")
    ax[0].set_ylabel("mass [lunar masses]")
    ax[0].legend(fontsize=8)
    ax[0].grid(alpha=0.3)
    ax[1].plot(th, [r["disk_theia_frac"] for r in rows], label="Theia fraction of disk mass")
    ax[1].plot(th, [r["a_eq_disk_RE"] / 3 for r in rows], label="disk a_eq / 3 R_E")
    ax[1].set_xlabel("hours since contact")
    ax[1].legend(fontsize=8)
    ax[1].grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(os.path.join(args.outdir, "disk_evolution.png"), dpi=110)
    print("wrote disk_evolution.png")


if __name__ == "__main__":
    main()
