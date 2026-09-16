//! Hydraulic leaves, ported from `src/data/pipenet.js`: `fricOf`, `boreM`,
//! `areaOf`, `pipeC`, `holeC`, `compC`, `flowW`, `flowG` (+ `gasEnd`/`liqEnd`
//! predicates). Pure given the field arrays and edge scalars; the choke
//! flag `flowG` sets as a module global in JS is returned here instead.
//!
//! NaN policy: JS `Math.max/min` propagate NaN, so all clamps go through
//! `eos::js_max/js_min`, never `libm::fmax/fmin`.

use crate::eos::{js_max, js_min};

pub const BORE_REF: f64 = 750.0;
pub const NET_COMP_LEN: f64 = 0.1;
pub const PIPE_FRIC: f64 = 0.02;
pub const RCRIT: f64 = 0.55;
pub const DPFRAC: f64 = 0.00005;
pub const ORIF_CD: f64 = 0.61;
pub const PIPE_ROUGH: f64 = 4.5e-5;
pub const RE_FLOOR: f64 = 500.0;

/// Haaland; Re floored so a stopped leg keeps a finite coefficient.
pub fn fric_of(bore: f64, w: Option<f64>, mu: f64) -> f64 {
    match w {
        Some(w) if mu > 0.0 => {
            let d = bore_m(bore);
            let re = js_max(4.0 * libm::fabs(w) / (std::f64::consts::PI * d * mu), RE_FLOOR);
            if re < 2300.0 {
                return 64.0 / re;
            }
            let r = -1.8 * crate::fdlibm::log10(crate::fdlibm::pow(PIPE_ROUGH / d / 3.7, 1.11) + 6.9 / re);
            1.0 / (r * r)
        }
        _ => PIPE_FRIC,
    }
}

#[inline]
pub fn bore_m(bore: f64) -> f64 {
    js_max(bore * BORE_REF / 1000.0, 0.01)
}

#[inline]
pub fn area_of(bore: f64) -> f64 {
    let d = bore_m(bore);
    std::f64::consts::PI / 4.0 * d * d
}

/// Infinite length reaches exactly 0: how a severed pipe says no pipe.
/// `k0` arrives as 0.0 for JS `undefined` (both read falsy).
pub fn pipe_c(bore: f64, l: f64, k0: f64, f: Option<f64>) -> f64 {
    let f = f.unwrap_or(PIPE_FRIC);
    // JS `(K0||0)`: NaN and 0 both read 0.
    let k0 = if k0 != 0.0 && !k0.is_nan() { k0 } else { 0.0 };
    let k = f * js_max(l, NET_COMP_LEN) / bore_m(bore) + k0;
    if k.is_finite() && k > 0.0 {
        area_of(bore) / libm::sqrt(k)
    } else {
        0.0
    }
}

/// An orifice has no length term, only its own area.
#[inline]
pub fn hole_c(bore: f64) -> f64 {
    ORIF_CD * area_of(bore)
}

/// Path through a component's own body plus its ROLE internals loss.
#[inline]
pub fn comp_c(k: f64) -> f64 {
    if k > 0.0 {
        pipe_c(1.0, NET_COMP_LEN, k, None)
    } else {
        pipe_c(1.0, NET_COMP_LEN, 0.0, None)
    }
}

/// kg/s an opening WOULD pass at a stated pair of pressures.
pub fn flow_w(c: f64, rho: f64, p_hi: f64, p_lo: f64) -> f64 {
    if c > 0.0 {
        c * libm::sqrt(
            2.0 * js_max(rho, 1e-3) * js_max(js_min(p_hi - p_lo, (1.0 - RCRIT) * js_max(p_hi, 0.0)), 0.0)
                * 1e6,
        )
    } else {
        0.0
    }
}

/// Donor field slice read by `flow_g`.
pub struct FlowField<'a> {
    pub p: &'a [f64],
    pub x: Option<&'a [f64]>,
    pub wet: Option<&'a [u8]>,
    pub void_: Option<&'a [u8]>,
    pub rho_d: &'a [f64],
    pub rho_g: &'a [f64],
    pub rho_l: &'a [f64],
}

/// A nozzle in the steam space stands in the steam's own density.
#[inline]
fn gas_end(f: &FlowField, gas_at: Option<usize>, i: usize) -> bool {
    match gas_at {
        Some(g) if g == i => {
            (f.x.map(|x| x[i]).unwrap_or(0.0) > 0.0) || f.void_.map(|v| v[i] != 0).unwrap_or(false)
        }
        _ => false,
    }
}

/// The outlet under the surface stands in the water.
#[inline]
fn liq_end(f: &FlowField, liq_at: Option<usize>, i: usize) -> bool {
    match liq_at {
        Some(l) if l == i => f.x.map(|x| x[i]).unwrap_or(0.0) > 0.0,
        _ => false,
    }
}

/// Flow coefficient off data. Returns (g, choked): the choke is an
/// expansion the caller (`edgeG`) spends, not module state.
#[allow(clippy::too_many_arguments)]
pub fn flow_g(
    c: f64,
    f: &FlowField,
    u: usize,
    v: usize,
    h: f64,
    diode: f64,
    h_src: f64,
    choke_at: Option<usize>,
    gas_at: Option<usize>,
    liq_at: Option<usize>,
) -> (f64, bool) {
    if !(c > 0.0) {
        return (0.0, false);
    }
    // The differential carries the head: netFlows carries Q = g*(p_u-p_v+h).
    let d = f.p[u] - f.p[v] + h;
    let a = libm::fabs(d);
    let up = if d >= 0.0 { u } else { v };
    // The choke is a fraction of the higher PRESSURE, never of the donor's.
    let p_hi = js_max(f.p[u], js_max(f.p[v], 1e-4));
    let floor = DPFRAC * p_hi;
    let act = js_max(a, floor);
    // Only a vapour expands, only where no head source drives the edge, and
    // only once per duct: chokeAt is the run's own node. `!hSrc` is JS
    // falsiness: 0, -0 and NaN all count as no source.
    let has_x = f.x.is_some();
    let x_up = f.x.map(|x| x[up]).unwrap_or(0.0);
    let choke =
        (h_src == 0.0 || h_src.is_nan()) && has_x && x_up > 0.0 && (choke_at.is_none() || Some(up) == choke_at);
    let eff = js_max(if choke { js_min(a, (1.0 - RCRIT) * p_hi) } else { a }, floor);
    let choked = choke && (1.0 - RCRIT) * p_hi < a;
    // A spent node feeds nothing; the DONOR's bit.
    if let Some(wet) = f.wet {
        if wet[up] == 0 {
            return (0.0, choked);
        }
    }
    // A check valve is signed: +1 passes u->v only.
    if diode != 0.0 && d * diode < 0.0 {
        return (0.0, choked);
    }
    let rho = if gas_end(f, gas_at, up) {
        f.rho_g[up]
    } else if liq_end(f, liq_at, up) {
        f.rho_l[up]
    } else {
        f.rho_d[up]
    };
    let w = c * libm::sqrt(2.0 * js_max(rho, 1e-3) * eff * 1e6);
    (w / act, choked)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64, tol: f64) -> bool {
        (a - b).abs() <= tol * (a.abs() + b.abs() + 1e-300)
    }

    #[test]
    fn fric_laminar_and_turbulent() {
        // Re < 2300: 64/Re. D=750mm bore 1, mu=1e-3, w=0.5:
        // Re = 4*0.5/(pi*0.75*1e-3) = 848.8 -> 64/Re.
        let f = fric_of(1.0, Some(0.5), 1e-3);
        assert!(approx(f, 64.0 / (4.0 * 0.5 / (std::f64::consts::PI * 0.75 * 1e-3)), 1e-12));
        // Stopped leg / missing mu: floor factor.
        assert_eq!(fric_of(1.0, Some(0.0), 1e-3), 64.0 / 500.0);
        assert_eq!(fric_of(1.0, None, 1e-3), PIPE_FRIC);
        assert_eq!(fric_of(1.0, Some(1.0), 0.0), PIPE_FRIC);
        // Turbulent: finite, below laminar extension.
        let t = fric_of(1.0, Some(500.0), 1e-3);
        assert!(t > 0.0 && t < 0.05);
    }

    #[test]
    fn coins() {
        assert!(pipe_c(1.0, 0.0, 0.0, None) > 0.0);
        assert_eq!(hole_c(0.0), ORIF_CD * area_of(0.0));
        assert_eq!(flow_w(0.0, 1000.0, 2.0, 1.0), 0.0);
        assert_eq!(flow_w(1.0, 1000.0, 1.0, 2.0), 0.0);
        // Severed run: infinite length -> exactly 0.
        assert_eq!(pipe_c(1.0, f64::INFINITY, 0.0, None), 0.0);
    }
}
