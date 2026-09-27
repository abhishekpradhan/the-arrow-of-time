# The Moon-forming impact simulation

*The Arrow of Time* shows the Moon-forming impact as it happens in a real smoothed-particle
hydrodynamics (SPH) simulation. A Mars-sized Theia strikes the proto-Earth, and the film follows
its 61,139 particles through the first day. This folder documents that simulation: how it was
set up and run, how to reproduce it, and what happened in it. It also holds the scripts that turn
its snapshots into the film's asset, [`assets/giant-impact/`](../../../assets/giant-impact/).

The set-up follows Kegerreis et al. (2022), as packaged in SWIFT's `DemoImpactInitCond` and
`DemoImpact` examples: a canonical, graze-and-merge impact.

## Set-up

| | proto-Earth | Theia |
|---|---|---|
| mass | 0.885 M⊕ (5.285e24 kg) | 0.1325 M⊕ (7.915e23 kg) |
| radius (WoMa profile) | 1.000 R⊕ | 0.566 R⊕ |
| structure | 30 wt% iron core, 70 wt% rock mantle | the same |
| equations of state | ANEOS Fe85Si15 core, ANEOS forsterite mantle | the same |
| thermal profile | adiabatic from 2000 K and 1 bar at the surface | the same |
| SPH particles | 51,725 | 9,414 |

- **Impact:** 45° (impact parameter b = sin 45°), at the mutual escape speed (9.02 km/s at
  contact). The bodies start 4.68 R⊕ apart, centre to centre, 3600 s before their point-mass
  surfaces would touch. Neither body spins.
- **Frame:** the run is in the centre-of-mass frame. The orbit lies in the x–y plane, with its
  angular momentum along +z, and Theia arrives from +x.
- **First contact** is at simulation time 3449.4 s: the first moment the closest pair of
  particles from the two bodies is within one smoothing length. Tidal stretching makes it about
  150 s earlier than the nominal 3600 s. Every "hours after contact" in this folder counts from
  it.

### Codes

- [SWIFT](https://github.com/SWIFTSIM/SWIFT) (Schaller et al. 2024), git `e7f7dd1`, configured
  with `--with-hydro=planetary --with-equation-of-state=planetary --disable-mpi`, cubic-spline
  kernel. A second build adds `--enable-planetary-fixed-entropy` for settling the bodies.
- [WoMa](https://github.com/srbonilla/WoMa) 1.5.0 for the planet profiles and
  [SEAGen](https://github.com/jkeger/seagen) 1.7 (Kegerreis et al. 2019) for the particle
  placement.
- ANEOS tables for forsterite and Fe85Si15 (Stewart et al.), as distributed for SWIFT.
- Python 3 with numpy, scipy, h5py, numba and matplotlib for the scripts here.

### Numerical parameters

The runs start from SWIFT's `DemoImpactInitCond` and `DemoImpact` examples. These are the
changes:

| | SWIFT demo | this run | why |
|---|---|---|---|
| particles | ~1e5 or more | 61,139 | CPU time (an 87k run projected past 2.5 h) |
| gravity `epsilon_fmm` | 0.001 | 0.01 | about 2.5× faster; forces good to ~1% |
| softening `max_physical_baryon_softening` | 160 km | 200 km | about the minimum particle spacing at this resolution |
| settling time (fixed entropy) | 10,000 s | 6,000 s | rms velocities had fallen to 24–36 m/s |
| box | 100 R⊕ | 200 R⊕ | keeps escaping clumps for the first day |
| `max_top_level_cells` | 64 | 16 | about 25% faster here |
| snapshots | regular | every 150 s to +2 h, 300 s to +11 h, then 600 s | dense where the action is fast |

Unchanged from the demo: 48 neighbours (`resolution_eta` 1.2348), CFL 0.2, `h_max` 1000 km,
Monaghan artificial viscosity (α = 1.5) with the Balsara switch, the adaptive multipole
acceptance criterion, internal units of 1e24 kg, 1000 km and 1 s.

The demo's impact script needed three changes: the settled bodies are recentred and their
residual motion removed; the radii come from the WoMa profiles; and Theia's particle IDs are
offset by 100,000,000, so `origin = ParticleIDs >= 1e8` in every snapshot. It also needed small
fixes for numpy 2.

## Reproduce it

About two hours on four CPU cores. SWIFT, WoMa, SEAGen and the ANEOS tables are not part of this
repository: install them as below. SWIFT is under the LGPL-3.0; WoMa and SEAGen are under the
GPL-3.0.

```bash
export GIANT_IMPACT_RUN=$PWD/out/giant-impact     # where the runs and their outputs go
mkdir -p $GIANT_IMPACT_RUN && cd $GIANT_IMPACT_RUN

# 1. SWIFT, twice (Debian/Ubuntu packages: autoconf automake libtool libgsl-dev libhdf5-dev
#    libfftw3-dev libnuma-dev)
git clone https://github.com/SWIFTSIM/SWIFT.git swiftsim && (cd swiftsim && git checkout e7f7dd1 && ./autogen.sh)
mkdir build_impact build_settle
(cd build_impact && ../swiftsim/configure --with-hydro=planetary --with-equation-of-state=planetary --disable-mpi && make -j4)
(cd build_settle && ../swiftsim/configure --with-hydro=planetary --with-equation-of-state=planetary --disable-mpi \
    --enable-planetary-fixed-entropy && make -j4)
python3 -m venv venv && venv/bin/pip install woma==1.5.0 seagen==1.7 h5py numba scipy matplotlib

# 2. Initial conditions and settling: follow swiftsim/examples/Planetary/DemoImpactInitCond
#    (its README and run.sh) with the changes above: request 5.6e4 particles in
#    make_init_cond.py, settle for 6000 s, and build the impact file in a 200 R_E box.
# 3. The impact: swiftsim/examples/Planetary/DemoImpact's parameter file with the changes
#    above, run in impact/ until at least 3450 s + 24 h of simulated time:
#      ../build_impact/swift --hydro --self-gravity --threads=4 impact.yml

# 4. From the repository root: export, analyse, build the film's asset.
venv=$GIANT_IMPACT_RUN/venv/bin/python
$venv tools/assets/giant_impact/export.py          # -> $GIANT_IMPACT_RUN/export/giant_impact.npz
$venv tools/assets/giant_impact/timeline.py        # -> plots/timeline.png, timeline.json
$venv tools/assets/giant_impact/plots.py           # -> plots/impact_t*.png, overview_*.png
.venv/bin/python tools/assets/build_giant_impact.py $GIANT_IMPACT_RUN/export/giant_impact.npz
```

The run took 87 minutes of wall-clock on three threads (5,243 s for 17,151 steps, dt 2.7–5.4 s)
while other jobs shared the machine. Settling took another five minutes, and exporting every
particle takes about 30 s.

### Scripts

| script | does |
|---|---|
| `export.py` | Tracks particles by ID through the snapshots. Writes positions and velocities centred on the proto-Earth's core, temperature, internal energy, density, smoothing length, origin and material to one `.npz` file. |
| `timeline.py` | For each snapshot, classifies the mass into planet, disk and escaping (after Canup 2004), finds clumps outside the planet, and plots the timeline. |
| `plots.py` | Diagnostic views: top-down by temperature and by origin, edge-on, and wide. |
| `simtools.py`, `eos_temp.py` | Shared helpers: the first-contact time, and temperature from internal energy and density with the ANEOS tables. WoMa 1.5's own routine does not compile with numba 0.67, so `eos_temp.py` calls its table lookup directly. |
| [`../build_giant_impact.py`](../build_giant_impact.py) | Packs the export into the film's asset. It keeps every particle that leaves the Earth, and all of Theia, plus a thinned sample of the interior. It predicts each frame from the last two and stores only the residuals. The result is 7.5 MB for 20k particles over 138 frames. |

## What happened

Hours after first contact (numbers from `timeline.py`):

| hours | event |
|---|---|
| 0–0.5 | **The graze.** Theia shears across the proto-Earth's leading side. The contact shock passes 10,000 K, and some parcels later exceed 30,000 K. Within half an hour the Earth captures 60–80% of Theia's iron core. The rest of Theia is flung forward as a hot first spiral arm. |
| 0.5–1.5 | The arm's head collapses into a bound clump of about 2.5 lunar masses: Theia's remnant, 75–80% Theia material. A thin tidal bridge links it to the Earth. |
| 1.5–2.6 | The remnant coasts out to about 4.8 R⊕ and turns back. |
| 3–5.5 | It falls back, sweeping up material from the stream. |
| **5.8–6.5** | **The second impact.** The remnant grazes the Earth again; its centre passes 1.4 R⊕ from the Earth's centre at +6.1 h. About one lunar mass is flung onto escape orbits, and the Earth takes in 98% of Theia's core by +8 h. |
| 6.5–9 | What is left is drawn out into a long spiral arm, about 10 R⊕ long. |
| 8–11.5 | The arm breaks into three to five clumps of 0.05–0.6 lunar masses. |
| 11–24 | Two clumps escape. The largest bound one, 0.23 lunar masses, swings out to 8 R⊕ and back to 2.35 R⊕, inside the Roche limit (about 2.9 R⊕), and is torn into an arc between +22 and +24 h. A debris disk settles around a hot, fast-spinning Earth. |

At +24.4 h the Earth holds 1.001 M⊕. The disk holds 0.70 lunar masses, 72% of it from Theia, and
0.59 lunar masses are escaping. Energy is conserved to 2e-4 of the potential energy (1e-3 at
worst) and angular momentum to 1e-3. Six particles left the box.

**What the film adds.** No satellite survives the first day at this resolution. Kegerreis et al.
(2022) needed about ten million particles or more to settle whether a Moon forms at once. The
film's last shot therefore jumps ahead to the Moon that accretes from the disk: close, molten,
and a few Earth radii out.

## Caveats

- **Resolution.** Sixty thousand particles is low for this problem. Disk and clump masses are
  uncertain at the tens-of-percent level. Whether a given clump survives, is torn apart or falls
  back can change with resolution. Graze-and-merge impacts are also chaotic. Treat the run as one
  physically consistent realization of a canonical impact, not a converged prediction.
- **Missing physics.** There is no material strength, radiative cooling, vapour condensation or
  disk viscosity. Hot vapour therefore stays hot, and the film tones its glow down
  ([`shots/moon.ts`](../../../projects/arrow-of-time/shots/moon.ts) explains how). The
  1000 km cap on the smoothing length coarsens the sparse outer disk.
- **Gravity** is computed more loosely than in the demo (above).

## References

- R. M. Canup (2004), *Simulations of a late lunar-forming impact*, Icarus 168, 433.
- J. A. Kegerreis et al. (2019), *Planetary giant impacts: convergence of high-resolution
  simulations using efficient spherical initial conditions and SWIFT*, MNRAS 487, 5029 (SEAGen).
- J. A. Kegerreis et al. (2022), *Immediate origin of the Moon as a post-impact satellite*,
  ApJL 937, L40.
- M. Schaller et al. (2024), *SWIFT: a modern highly-parallel gravity and smoothed particle
  hydrodynamics solver for astrophysical and cosmological applications*, MNRAS 530, 2378.
- S. Ruiz-Bonilla et al., WoMa: [github.com/srbonilla/WoMa](https://github.com/srbonilla/WoMa).
- S. T. Stewart et al., ANEOS forsterite and Fe85Si15 material models, as distributed with SWIFT.
