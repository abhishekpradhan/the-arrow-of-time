# Giant impact

The Moon-forming impact from an SPH simulation: Theia (0.13 Earth masses) strikes the
proto-Earth at 45° and the mutual escape speed. It covers 0.8 h before first contact to 21 h
after. The simulation and how to rerun it are in
[`tools/assets/giant_impact/`](../../tools/assets/giant_impact/README.md).

The files were packed by `tools/assets/build_giant_impact.py`, whose docstring gives the exact
layout:

- `impact.json`: particle and frame counts, frame times (hours after first contact), scales,
  and Theia's centre per frame.
- `impact.bin.gz`: positions (a linear prediction's residuals, varint coded), temperatures and
  smoothing lengths per frame, and each particle's origin, material and sprite scale.

It holds 19,957 of the 61,139 particles: every particle thrown clear of the Earth, all of Theia,
and a thinned sample of the Earth's interior. Positions are in Earth radii, centred on the
proto-Earth's core, with the orbit in the x–y plane. [`projects/arrow-of-time/shots/moon.ts`](../../projects/arrow-of-time/shots/moon.ts)
decodes and renders it.

Made with SWIFT, WoMa, SEAGen and the ANEOS equations of state; if you use this data, please cite
the works listed in the simulation's README.
