//! Edge terms, ported from `src/data/pipenet.js`: `valveLeq`, `throttledC`,
//! `dutyC`, `pumpHeadNow` (algebra), `staticH` (algebra), `tankDiscC`,
//! `edgeCval`, `edgeG`, `edgeH` (+ `edgeIn`).
//!
//! Plant predicates (tank/relief/port live, wreckage, governor and waste
//! answers, head/drive/cavitation scalars) arrive pre-evaluated per edge;
//! their own stages port the predicates. `flowG`'s choke flag is returned,
//! never stored.

use crate::eos::{clamp, js_max, js_min};
use crate::hydro::*;
use std::f64::consts::PI;

pub const BREACH_BORE: f64 = 1.6;
pub const VALVE_LEQ: f64 = 2.0;
pub const VALVE_XMIN: f64 = 0.05;
pub const PUMP_DROOP: f64 = 0.25;
pub const CAV_DERATE: f64 = 0.8;
pub const G_MPA: f64 = 9.81e-6;

/// Equivalent length, never a multiplier. `**2` is `pow`: keep it pow.
pub fn valve_leq(x: f64) -> f64 {
    if x >= 1.0 {
        0.0
    } else {
        VALVE_LEQ * (1.0 / crate::fdlibm::pow(js_max(x, VALVE_XMIN), 2.0) - 1.0)
    }
}

/// One law for branch and in-line alike: any throttle at x<=0 cuts the edge.
pub fn throttled_c(bore: f64, l: f64, valves: &[f64], k0: f64, f: Option<f64>) -> f64 {
    let mut l_tot = l;
    for &x in valves {
        if !(x > 0.0) {
            return 0.0;
        }
        l_tot += valve_leq(x);
    }
    pipe_c(bore, l_tot, k0, f)
}

/// Passage sized to the machine's own rated duty.
pub fn duty_c(q: f64, rho: f64, casing_f: f64, pump_h0: f64) -> f64 {
    js_max(q, 0.0) / libm::sqrt(2.0 * js_max(js_rho(rho), 1.0) * casing_f * pump_h0 * 1e6)
}

#[inline]
fn js_rho(rho: f64) -> f64 {
    if rho != 0.0 && !rho.is_nan() { rho } else { 700.0 }
}

/// MPa at shutoff, at its own speed, less what suction costs it.
pub fn pump_head_now(head: f64, drive: f64, cav: f64, rho_k: f64) -> f64 {
    head * drive * drive * (1.0 + PUMP_DROOP) * (1.0 - CAV_DERATE * cav) * rho_k
}

/// Static column off end densities plus the pool term.
pub fn static_h(dz: f64, rho_u: f64, rho_v: f64, pool: f64) -> f64 {
    (if dz == 0.0 { 0.0 } else { (rho_u + rho_v) / 2.0 * G_MPA * dz }) + pool
}

/// Authored drain as a hole at the disc pressure.
pub fn tank_disc_c(kg: f64, vol: f64, drain: f64, at: f64, has_burst: bool, pcont: f64) -> f64 {
    if !has_burst {
        return 0.0;
    }
    let rho = kg / js_max(vol, 1e-9);
    let dp = js_max(at - pcont, 0.01);
    drain / 100.0 * kg / libm::sqrt(2.0 * rho * dp * 1e6)
}

/// Inertance as resistance over one tick; identically zero outside a march.
#[inline]
pub fn edge_in(march: bool, inert: f64) -> f64 {
    if march { inert / 0.02 / 1e6 } else { 0.0 }
}

/// Per-edge evaluated inputs for `edge_cval`. Missing numerics are NaN and
/// read falsy, exactly like `undefined`.
pub struct CvalIn<'a> {
    pub ck: i8,
    pub c_closure: f64,
    pub cdead_wrecked: bool,
    pub bore: f64,
    pub llen: f64,
    pub k0: f64,
    pub w: Option<f64>,
    pub mu: f64,
    pub tank_live: bool,
    pub port_live: bool,
    pub gate_valves: &'a [f64],
    pub gate_throttle: bool,
    pub relief_live: bool,
    pub freg: f64,
    pub feed_train_c: f64,
    pub turb_c: f64,
    pub sgtr_live: bool,
    pub sgtr_prod: f64,
    pub broken: bool,
    pub wrecked: bool,
    pub hole_c: f64,
    pub sg_open: bool,
    pub vent_active: bool,
    pub vent_bore: f64,
    pub dump_open: bool,
    pub dump_q: f64,
    pub dump_rho: f64,
    pub breach: bool,
    pub tubes_open: f64,
    pub cav_n: f64,
    pub cav_one: f64,
    pub cav_relief_flag: bool,
    pub cav_relief: f64,
    pub burst_by: bool,
    pub disc: DiscIn,
    pub casing_f: f64,
    pub pump_h0: f64,
    /// ed.Cc for the k0 arm (only read when ck==0).
    pub cc: f64,
}

pub struct DiscIn {
    pub kg: f64,
    pub vol: f64,
    pub drain: f64,
    pub at: f64,
    pub has_burst: bool,
    pub pcont: f64,
}

/// The ONE place the law is applied: an edge states a flow coefficient.
pub fn edge_cval(k: &CvalIn) -> f64 {
    // Ck undefined: typeof ed.C === 'function' ? ed.C(s) : ed.C — dumped.
    if k.ck < 0 {
        return k.c_closure;
    }
    if k.cdead_wrecked {
        return 0.0;
    }
    match k.ck {
        0 => k.cc,
        1 | 2 => {
            let f = fric_of(k.bore, k.w, k.mu);
            if k.ck == 1 {
                if k.tank_live && k.port_live {
                    pipe_c(k.bore, k.llen, k.k0, Some(f))
                } else {
                    0.0
                }
            } else if k.port_live {
                throttled_c(k.bore, k.llen, &[], k.k0, Some(f))
            } else {
                0.0
            }
        }
        3 => {
            if k.gate_throttle {
                throttled_c(k.bore, NET_COMP_LEN, k.gate_valves, 0.0, None)
            } else if k.relief_live {
                hole_c(k.bore)
            } else {
                0.0
            }
        }
        4 => {
            let fr = if k.freg != 0.0 && !k.freg.is_nan() { k.freg } else { 0.0 };
            k.feed_train_c * (1.0 - js_max(js_min(fr, 1.0), 0.0))
        }
        5 => k.turb_c,
        6 => {
            if k.sgtr_live {
                k.sgtr_prod
            } else {
                0.0
            }
        }
        7 => {
            if k.broken {
                k.hole_c
            } else {
                0.0
            }
        }
        8 => {
            if k.wrecked {
                k.hole_c
            } else {
                0.0
            }
        }
        9 => {
            if k.sg_open {
                hole_c(BREACH_BORE)
            } else {
                0.0
            }
        }
        10 => {
            if k.wrecked {
                hole_c(BREACH_BORE)
            } else if k.vent_active {
                hole_c(k.vent_bore)
            } else if k.dump_open {
                duty_c(k.dump_q, k.dump_rho, k.casing_f, k.pump_h0)
            } else {
                0.0
            }
        }
        11 => {
            if k.breach {
                hole_c(BREACH_BORE)
            } else {
                0.0
            }
        }
        12 => {
            if k.wrecked {
                hole_c(BREACH_BORE)
            } else {
                0.0
            }
        }
        13 => {
            if k.tubes_open > 0.0 {
                k.tubes_open * k.cav_n * k.cav_one
            } else {
                0.0
            }
        }
        14 => {
            if k.breach {
                hole_c(BREACH_BORE)
            } else if k.cav_relief_flag {
                k.cav_relief
            } else {
                0.0
            }
        }
        _ => {
            if k.wrecked {
                hole_c(BREACH_BORE)
            } else if k.burst_by {
                tank_disc_c(k.disc.kg, k.disc.vol, k.disc.drain, k.disc.at, k.disc.has_burst, k.disc.pcont)
            } else {
                0.0
            }
        }
    }
}

/// Per-edge evaluated inputs for the head terms.
pub struct HeadIn {
    pub ck_undef: bool,
    pub is_pump: bool,
    pub pump_head: f64,
    pub static_h: f64,
    pub head_k: f64,
    pub h0: f64,
    pub hsrc_closure: f64,
    pub edge_in: f64,
}

/// The authored head (pre-momentum), gated on C>0 exactly like the JS.
pub fn authored_head(c: f64, h: &HeadIn) -> f64 {
    if c > 0.0 {
        if h.ck_undef {
            if h.h0 != 0.0 && !h.h0.is_nan() { h.h0 } else { 0.0 }
        } else if h.is_pump {
            (h.pump_head + h.static_h) * h.head_k
        } else {
            h.static_h * h.head_k
        }
    } else {
        0.0
    }
}
/// (which reads FLOWG_CHOKE set by its own flowG call). Returns (g, h, choke)
/// where h is the full matrix-driving head including carried momentum.
#[allow(clippy::too_many_arguments)]
pub fn edge_gh(
    c: f64,
    h: &HeadIn,
    f: &crate::hydro::FlowField,
    u: usize,
    v: usize,
    diode: f64,
    choke_at: Option<usize>,
    gas_at: Option<usize>,
    liq_at: Option<usize>,
    w: f64,
) -> (f64, f64, bool) {
    let hh = authored_head(c, h);
    let h_src = if c > 0.0 {
        if h.ck_undef {
            h.hsrc_closure
        } else if h.is_pump {
            h.pump_head * h.head_k
        } else {
            0.0
        }
    } else {
        0.0
    };
    let (g0, choke) = if c > 0.0 {
        crate::hydro::flow_g(c, f, u, v, hh, diode, h_src, choke_at, gas_at, liq_at)
    } else {
        (0.0, false)
    };
    let g = if g0 > 0.0 { g0 / (1.0 + g0 * h.edge_in) } else { g0 };
    (g, edge_h(h, w), choke)
}

/// Dumped-lane flag bit: the gate writes exactly 0/1, never truthy.
#[inline]
pub fn lane_flag(v: &[f64], i: usize) -> bool {
    v[i] == 1.0
}

/// `ed.h` gate shared by the solve assembly and diode-sig heads: fn edges
/// take the evaluated head, scalar edges the constant, else zero.
#[inline]
pub fn head_gate(h_is_fn: bool, h: f64, h_scalar: f64) -> f64 {
    if h_is_fn {
        h
    } else if h_scalar != 0.0 && !h_scalar.is_nan() {
        h_scalar
    } else {
        0.0
    }
}

/// Live edge-Q lane ports (`src/data/pipenet.js`, `src/sim/step.js`):
/// governor, rupture, vent/dump, pump scalars. Deep chains (condenser
/// pressure, programme temperature, runback) arrive pre-evaluated; their
/// own stages port the readers.
pub const SGTR_RATE: f64 = 0.30;
pub const HOT_DUMP: f64 = 1.6;
pub const ORIF_CD: f64 = 0.61;
pub const RCRIT: f64 = 0.55;
pub const COND_ATM: f64 = 0.101;
pub const FIT_BORE0: f64 = 412.5;
pub const DUMP_K: f64 = 0.02;
/// `SAT_WATER.rho`, the feed-train reference density.
pub const SAT_RHO: f64 = 740.0;

/// Rated rupture passage (`sgtrC`): a plant constant per commission.
pub fn sgtr_c(loop_kg: f64, rho0: f64, hold_p: f64, design_p: f64) -> f64 {
    let dp = js_max(hold_p - design_p, 0.05);
    (SGTR_RATE / 100.0) * loop_kg / libm::sqrt(2.0 * js_max(rho0, 1.0) * dp * 1e6)
}

/// Relief-disc bank bore (`condVentBore`), mm: a plant constant per valve.
pub fn cond_vent_bore(steam_ref: f64, n_sinks: usize, rhog: f64) -> f64 {
    let w = steam_ref / js_max(n_sinks as f64, 1.0);
    let area = w / (ORIF_CD * libm::sqrt(2.0 * js_max(rhog, 1e-3) * (1.0 - RCRIT) * COND_ATM * 1e6));
    if area.is_finite() && area > 0.0 {
        libm::sqrt(4.0 * area / PI) * 1000.0
    } else {
        FIT_BORE0
    }
}

/// Operator's drain at a full pool (`condDumpKgs`), kg/s.
pub fn cond_dump_kgs(pool_vol: f64, tank_rho: f64) -> f64 {
    HOT_DUMP / 100.0 * pool_vol * tank_rho
}

/// Pump drive (`pumpDrive`): wrecked is stopped; `flowScale` is never
/// written during a march (only `sNat` carries one), so the factor is 1.
pub fn pump_drive(wrecked: bool, flow_by: Option<f64>) -> f64 {
    (if wrecked { 0.0 } else { 1.0 }) * flow_by.unwrap_or(1.0)
}

/// Cavitation derate input (`cavOf`): `|| 0`, so NaN reads 0 too.
pub fn cav_of(cav: Option<f64>) -> f64 {
    match cav {
        Some(x) if x != 0.0 && !x.is_nan() => x,
        _ => 0.0,
    }
}

/// Suction-density derate (`pumpRhoK`): the settle rates at 1.
pub fn pump_rho_k(store_held: bool, rho0: f64, rho: f64) -> f64 {
    if store_held {
        return 1.0;
    }
    if !(rho0 > 0.0) {
        return 1.0;
    }
    if rho.is_finite() && rho > 0.0 { rho / rho0 } else { 0.0 }
}

/// Governor's share of rated duty (`turbWorkOf`).
pub fn turb_work_of(piped: bool, load: f64, swallow: f64, steam_ref: f64, turb_trip: bool) -> f64 {
    js_min(load, swallow / js_max(steam_ref, 1e-9))
        * clamp(if piped && !turb_trip { 1.0 } else { 0.0 }, 0.0, 1.0)
}

/// Governor opening off the fitted swallow (`turbCOf`): bypass work is
/// pre-evaluated (`dumpOf`), damage is the edge's own question.
pub fn turb_c_of(wrecked: bool, turb_c: f64, work: f64, dump: f64) -> f64 {
    if wrecked {
        0.0
    } else {
        turb_c * js_max(0.0, work + dump)
    }
}

/// Bypass/dump opening (`dumpOf`): the condenser-permissive term (hot-leg
/// regulating plus pressure-regulator bypass) plus the scrammed term.
pub fn dump_of(cond_avail: bool, tavg: f64, tprog: f64, bypass: f64, dump_p: f64, scrammed: bool, rule_any: bool) -> f64 {
    (if cond_avail { js_max(clamp((tavg - tprog) * DUMP_K, 0.0, bypass), dump_p) } else { 0.0 })
        + if scrammed && rule_any { 0.08 } else { 0.0 }
}

/// Matrix-driving head: authored head plus carried momentum.
pub fn edge_h(h: &HeadIn, w: f64) -> f64 {
    (if h.ck_undef {
        if h.h0 != 0.0 && !h.h0.is_nan() { h.h0 } else { 0.0 }
    } else if h.is_pump {
        (h.pump_head + h.static_h) * h.head_k
    } else {
        h.static_h * h.head_k
    }) + h.edge_in * (if w != 0.0 && !w.is_nan() { w } else { 0.0 })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64, tol: f64) -> bool {
        (a - b).abs() <= tol * (a.abs() + b.abs() + 1e-300)
    }

    #[test]
    fn valve_and_throttle() {
        assert_eq!(valve_leq(1.0), 0.0);
        assert_eq!(valve_leq(2.0), 0.0);
        assert!(valve_leq(0.5) > 0.0);
        // Any throttle at x<=0 cuts the whole edge (NaN counts).
        assert_eq!(throttled_c(1.0, 1.0, &[0.5, 0.0], 0.0, None), 0.0);
        assert_eq!(throttled_c(1.0, 1.0, &[0.5, f64::NAN], 0.0, None), 0.0);
        assert!(throttled_c(1.0, 1.0, &[0.5, 0.5], 0.0, None) > 0.0);
    }

    #[test]
    fn duty_and_disc() {
        assert_eq!(duty_c(-5.0, 1000.0, 0.05, 0.6), duty_c(0.0, 1000.0, 0.05, 0.6));
        // NaN rho reads 700.
        assert_eq!(duty_c(10.0, f64::NAN, 0.05, 0.6), duty_c(10.0, 700.0, 0.05, 0.6));
        assert_eq!(tank_disc_c(1.0, 1.0, 1.0, 1.0, false, 0.1), 0.0);
        assert!(tank_disc_c(1000.0, 10.0, 5.0, 1.0, true, 0.1) > 0.0);
    }
}
