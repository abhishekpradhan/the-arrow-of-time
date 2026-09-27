"""Temperature from (specific internal energy, density) with the ANEOS tables, via WoMa.

WoMa 1.5's own A1_T_u_rho() fails to compile with numba 0.67 (its optional mixing
argument), so this loops over woma.eos.sesame.T_u_rho() directly. Valid for the
tabulated ANEOS/SESAME materials used here (ANEOS forsterite 400, ANEOS Fe85Si15 402).
"""

import numpy as np
from numba import njit

import woma
from woma.eos import sesame

woma.load_eos_tables(["ANEOS_forsterite", "ANEOS_Fe85Si15"])  # must precede compilation


@njit(cache=False)
def _A1_T_u_rho(A1_u, A1_rho, A1_mat_id):
    out = np.empty(A1_u.shape[0])
    for i in range(A1_u.shape[0]):
        out[i] = sesame.T_u_rho(A1_u[i], A1_rho[i], A1_mat_id[i])
    return out


def temperature(u, rho, mat_id):
    """u [J/kg], rho [kg/m^3], mat_id (SWIFT ids) -> T [K] (float64 array)."""
    return _A1_T_u_rho(np.ascontiguousarray(u, dtype=np.float64),
                       np.ascontiguousarray(rho, dtype=np.float64),
                       np.ascontiguousarray(mat_id, dtype=np.int64))
