#!/usr/bin/env python3
"""Export the SWIFT giant-impact snapshots to a compact, render-friendly .npz.

Usage:  python tools/assets/giant_impact/export.py [--max-part 70000] [--out <run>/export/giant_impact.npz]

(<run> is the simulation directory: $GIANT_IMPACT_RUN, else out/giant-impact; see README.md.)
        (the default keeps all 61139 particles; e.g. --max-part 40000 keeps all of Theia plus a
        random subset of the proto-Earth, with `weight` = 1/sampling rate)

Reads impact/snapshots/impact_*.hdf5 (SWIFT planetary output, internal units:
mass 1e24 kg, length 1e6 m = 1000 km, time 1 s) and writes, for every particle
(or a fixed random subsample) tracked by ParticleID through every snapshot:

  times        (n_snap,)          float64  seconds since first contact (t_sim - t_contact, see below)
  sim_time     (n_snap,)          float64  SWIFT simulation time [s]
  pos          (n_snap, n_part, 3) float32 position [R_earth] relative to the
                                          proto-Earth centre (see below)
  vel          (n_snap, n_part, 3) float32 velocity [R_earth / s] relative to the
                                          proto-Earth centre's velocity
  temp         (n_snap, n_part)   float32  temperature [K] (ANEOS tables, via WoMa T(u, rho))
  u            (n_snap, n_part)   float32  specific internal energy [J/kg]
  rho          (n_snap, n_part)   float32  SPH density [kg/m^3]
  h            (n_snap, n_part)   float32  SPH smoothing length [R_earth] (kernel support = 1.8257 h)
  alive        (n_snap, n_part)   bool     False once a particle has left the 200 R_E box
                                          (then pos/vel/temp/... are NaN)
  origin       (n_part,)          int8     0 = proto-Earth, 1 = Theia
  material     (n_part,)          int8     0 = core (ANEOS Fe85Si15), 1 = mantle (ANEOS forsterite)
  mat_id       (n_part,)          int16    SWIFT material id (402 iron alloy, 400 forsterite)
  mass         (n_part,)          float32  particle mass [kg]
  weight       (n_part,)          float32  1 / sampling rate of the particle's body (use it to
                                          weight sprite flux so Theia is not over-represented)
  ids          (n_part,)          int64    SWIFT ParticleIDs (Theia ids >= 100000000)
  earth_centre     (n_snap, 3)    float32  proto-Earth centre in the barycentric frame [R_earth]
  earth_centre_vel (n_snap, 3)    float32  its velocity [R_earth / s]
  barycentre       (n_snap, 3)    float32  centre of mass of all particles still in the box,
                                          in the same barycentric frame [R_earth]

Frame: the simulation runs in the centre-of-mass (barycentric) frame. The exported
positions are centred on the proto-Earth centre = centre of mass of the proto-Earth's
iron-core particles (all of them, not just the subsample), which stays at the centre of
the post-impact Earth. Barycentric positions: pos + earth_centre[:, None, :].
The impact is in the x-y plane (orbital angular momentum along +z), so a top-down view
looks along -z.

First contact (t_contact, stored in meta): the first time the closest proto-Earth/Theia
particle pair is within one smoothing length, interpolated between snapshots (~3450 s of
simulation time). Tidal stretching makes this ~150 s earlier than the nominal set-up value
(3600 s, when the centres are R_t + R_i apart on the two-body orbit).
"""

import argparse
import json
import os

import h5py
import numpy as np

from simtools import (RUN, SNAPDIR, ID_OFFSET_IMPACTOR, MAT_CORE, R_E, T_CONTACT_NOMINAL, find_contact_time,
                      snapshot_files)


def read_snap(fn, fields):
    with h5py.File(fn, "r") as f:
        units = f["Units"].attrs
        U_L = float(units["Unit length in cgs (U_L)"][0]) * 1e-2  # m
        U_M = float(units["Unit mass in cgs (U_M)"][0]) * 1e-3  # kg
        U_t = float(units["Unit time in cgs (U_t)"][0])  # s
        box = np.array(f["Header"].attrs["BoxSize"], dtype=np.float64)
        t = float(f["Header"].attrs["Time"][0]) * U_t
        d = {k: f["PartType0/" + k][()] for k in fields}
    conv = dict(U_L=U_L, U_M=U_M, U_t=U_t, U_v=U_L / U_t, U_rho=U_M / U_L**3, U_u=(U_L / U_t) ** 2)
    return t, box, d, conv


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapdir", default=SNAPDIR)
    ap.add_argument("--out", default=os.path.join(RUN, "export", "giant_impact.npz"))
    ap.add_argument("--max-part", type=int, default=70000,
                    help="subsample size; >= 61139 keeps every particle (the default)")
    ap.add_argument("--theia-frac", type=float, default=1.0,
                    help="max fraction of the subsample given to Theia before capping (all of "
                         "Theia is kept when it fits)")
    ap.add_argument("--seed", type=int, default=20260927)
    ap.add_argument("--no-temp", action="store_true", help="skip the ANEOS temperature inversion")
    args = ap.parse_args()

    files = snapshot_files(args.snapdir)
    if not files:
        raise SystemExit("no snapshots in " + args.snapdir)
    T_CONTACT = find_contact_time(files)
    print("%d snapshots; first contact at t_sim = %.1f s (nominal %.0f s)" % (len(files), T_CONTACT, T_CONTACT_NOMINAL))

    # ---- choose the subsample from the first snapshot ----
    _, box, d0, conv = read_snap(files[0], ["ParticleIDs", "MaterialIDs", "Masses"])
    ids0 = d0["ParticleIDs"].astype(np.int64)
    is_theia = ids0 >= ID_OFFSET_IMPACTOR
    rng = np.random.default_rng(args.seed)
    idx_t = np.flatnonzero(is_theia)
    idx_e = np.flatnonzero(~is_theia)
    n_max = min(args.max_part, len(ids0))
    n_theia = min(len(idx_t), int(round(args.theia_frac * n_max)))
    n_earth = min(len(idx_e), n_max - n_theia)
    pick = np.concatenate([rng.choice(idx_t, n_theia, replace=False), rng.choice(idx_e, n_earth, replace=False)])
    pick = pick[np.argsort(ids0[pick])]  # sorted by id
    sel_ids = ids0[pick]
    origin = (sel_ids >= ID_OFFSET_IMPACTOR).astype(np.int8)
    mat_id = d0["MaterialIDs"][pick].astype(np.int16)
    material = np.where(mat_id == MAT_CORE, 0, 1).astype(np.int8)
    mass = (d0["Masses"][pick] * conv["U_M"]).astype(np.float32)
    rate_t = n_theia / len(idx_t)
    rate_e = n_earth / len(idx_e)
    weight = np.where(origin == 1, 1.0 / rate_t, 1.0 / rate_e).astype(np.float32)
    print("subsample: %d particles (%d Theia = %.1f%% of Theia, %d proto-Earth = %.1f%% of proto-Earth)"
          % (len(sel_ids), n_theia, 100 * rate_t, n_earth, 100 * rate_e))

    # proto-Earth core particle ids (all of them) define the frame centre
    earth_core_ids = np.sort(ids0[(~is_theia) & (d0["MaterialIDs"] == MAT_CORE)])

    if not args.no_temp:
        from eos_temp import temperature

    n_snap, n_part = len(files), len(sel_ids)
    nanf = np.float32(np.nan)
    pos = np.full((n_snap, n_part, 3), nanf, np.float32)
    vel = np.full((n_snap, n_part, 3), nanf, np.float32)
    temp = np.full((n_snap, n_part), nanf, np.float32)
    u_out = np.full((n_snap, n_part), nanf, np.float32)
    rho_out = np.full((n_snap, n_part), nanf, np.float32)
    h_out = np.full((n_snap, n_part), nanf, np.float32)
    alive = np.zeros((n_snap, n_part), bool)
    sim_time = np.zeros(n_snap)
    earth_centre = np.zeros((n_snap, 3), np.float32)
    earth_centre_vel = np.zeros((n_snap, 3), np.float32)
    barycentre = np.zeros((n_snap, 3), np.float32)

    fields = ["ParticleIDs", "Coordinates", "Velocities", "Masses", "InternalEnergies",
              "Densities", "SmoothingLengths", "MaterialIDs"]
    for k, fn in enumerate(files):
        t, box, d, conv = read_snap(fn, fields)
        sim_time[k] = t
        ids = d["ParticleIDs"].astype(np.int64)
        x = (d["Coordinates"] - 0.5 * box) * conv["U_L"] / R_E  # R_E, barycentric (box centre)
        v = d["Velocities"].astype(np.float64) * conv["U_v"] / R_E  # R_E / s
        m = d["Masses"].astype(np.float64)
        # frame centre: centre of mass of the proto-Earth's core particles
        core = np.isin(ids, earth_core_ids, assume_unique=True)
        c = (m[core, None] * x[core]).sum(0) / m[core].sum()
        cv = (m[core, None] * v[core]).sum(0) / m[core].sum()
        earth_centre[k], earth_centre_vel[k] = c, cv
        barycentre[k] = (m[:, None] * x).sum(0) / m.sum()
        # map the subsample
        order = np.argsort(ids)
        j = np.searchsorted(ids[order], sel_ids)
        j = np.clip(j, 0, len(ids) - 1)
        found = ids[order][j] == sel_ids
        src = order[j[found]]
        alive[k] = found
        pos[k, found] = (x[src] - c).astype(np.float32)
        vel[k, found] = (v[src] - cv).astype(np.float32)
        u_si = d["InternalEnergies"][src].astype(np.float64) * conv["U_u"]
        rho_si = d["Densities"][src].astype(np.float64) * conv["U_rho"]
        u_out[k, found] = u_si
        rho_out[k, found] = rho_si
        h_out[k, found] = d["SmoothingLengths"][src] * conv["U_L"] / R_E
        if not args.no_temp:
            temp[k, found] = temperature(u_si, rho_si, d["MaterialIDs"][src])
        if k % 20 == 0 or k == n_snap - 1:
            print("  %4d/%d  t = %8.0f s (%+6.2f h from contact)  alive %d/%d  T[K] median %.0f max %.0f"
                  % (k + 1, n_snap, t, (t - T_CONTACT) / 3600, found.sum(), n_part,
                     np.nanmedian(temp[k]) if not args.no_temp else 0, np.nanmax(temp[k]) if not args.no_temp else 0),
                  flush=True)

    times = sim_time - T_CONTACT
    meta = dict(
        description="SWIFT planetary SPH Moon-forming giant impact (proto-Earth 0.887 M_E + Theia 0.133 M_E, "
                    "b=sin45, v=v_esc); fixed random subsample tracked by particle ID",
        units=dict(times="s since first contact (sim time t_contact_sim_s)", pos="R_earth (6371 km)",
                   vel="R_earth/s", temp="K (ANEOS tables via WoMa, T(u, rho))", u="J/kg", rho="kg/m^3", h="R_earth",
                   mass="kg"),
        frame="centred on the proto-Earth core centre of mass; barycentric = pos + earth_centre",
        origin="0 proto-Earth, 1 Theia", material="0 core (Fe85Si15), 1 mantle (forsterite)",
        t_contact_sim_s=T_CONTACT, t_contact_nominal_sim_s=T_CONTACT_NOMINAL,
        contact_definition="closest proto-Earth/Theia particle pair within one smoothing length",
        R_earth_m=R_E, n_total_particles=int(len(ids0)),
        n_theia_total=int(len(idx_t)), n_earth_total=int(len(idx_e)),
        sampling_rate_theia=rate_t, sampling_rate_earth=rate_e, seed=args.seed,
    )
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    np.savez(
        args.out, times=times, sim_time=sim_time, pos=pos, vel=vel, temp=temp, u=u_out, rho=rho_out,
        h=h_out, alive=alive, origin=origin, material=material, mat_id=mat_id, mass=mass,
        weight=weight, ids=sel_ids, earth_centre=earth_centre, earth_centre_vel=earth_centre_vel,
        barycentre=barycentre, meta=np.array(json.dumps(meta)),
    )
    print("wrote %s (%.0f MB)" % (args.out, os.path.getsize(args.out) / 1e6))
    for name, a in [("times", times), ("pos", pos), ("vel", vel), ("temp", temp), ("u", u_out),
                    ("rho", rho_out), ("h", h_out), ("alive", alive), ("origin", origin),
                    ("material", material)]:
        print("  %-9s %-18s %s" % (name, a.shape, a.dtype))


if __name__ == "__main__":
    main()
