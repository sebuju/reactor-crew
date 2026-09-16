//! Transport (`advectStep` + `injectFluid`), ported from `src/sim/step.js:1296`.
//!
//! Plant-coupled reads arrive pre-evaluated (dump-kit, like the edge gate):
//! `src` is the real `advectSrc` output, anchors are a skip mask (march
//! samples are fully seeded, `need == false`), booked quantities, resolved
//! `netPAt`/`netHAt` fallbacks, per-node circuit data for the Tavg tail, and
//! post-call `edgeCval` areas for the H2 rise. What ports is the pure
//! transport math: donor sweep (`advEdge`), Courant limiter (`advCourant`),
//! capacity limiter (`advCap`), separator split (`advSep`), the carry loop,
//! the enthalpy/mass sweeps, out books, H2 rise, Tavg/boron/metal tails.

use crate::eos::{clamp, js_max, js_min, js_truthy, rhof_of, rho_mix_of, sat_h, sat_hg, sat_t, t_of_h, Curve};

pub const COURANT_PASSES: usize = 8;

/// Structural per-edge data for the transport core.
pub struct TransportEdges {
    pub u: Vec<u32>,
    pub v: Vec<u32>,
    pub gas_at: Vec<i32>,
    pub liq_at: Vec<i32>,
    /// 1 if `kind === "break"`.
    pub is_break: Vec<u8>,
    /// 1 if `kind === "break"` or `"vent"` (both book holes; only
    /// non-steam breaks count toward the spill totals).
    pub is_hole: Vec<u8>,
    /// `ed.steam` truthy.
    pub steam: Vec<u8>,
    /// `ed.sec` truthy.
    pub sec: Vec<u8>,
    /// Structural out-book index per edge (-1: no hole booking).
    pub opos: Vec<i32>,
    pub n_out: usize,
}

/// Structural per-node data for the transport core.
pub struct TransportNodes {
    pub vol: Vec<f64>,
    pub z: Vec<f64>,
    /// `netBooked`: 0 field, 1 booked, 2 containment.
    pub booked: Vec<u8>,
    /// Integer partition of `netBookOf` (0 = the field's own/undefined).
    pub book_id: Vec<u32>,
    /// 1 if `net.tankIdByNode[i]` is defined.
    pub tank_has: Vec<u8>,
    pub curve_of: Vec<u32>,
    /// Metal wall per node (`None` entries read as absent `net.metalKg`).
    pub metal_kg: Vec<f64>,
    pub metal_tau: Vec<f64>,
    pub metal_ua: Vec<f64>,
    /// `netInCore` mask (boron/H2 totals).
    pub in_core: Vec<u8>,
    /// `circOfNode` per node.
    pub circ_of: Vec<i32>,
    /// `P.netRefThru` per node (NaN = missing).
    pub ref_thru: Vec<f64>,
    /// Anchor SKIP mask (1 = held/seeded, not swept). All zero on march.
    pub anch_skip: Vec<u8>,
}

/// Live F arrays at sample time (post `netFieldUpdate`, untouched by advect).
pub struct TransportField<'a> {
    pub p: &'a [f64],
    pub x: &'a [f64],
    pub rho: &'a [f64],
    pub rho_g: &'a [f64],
    pub rho_l: &'a [f64],
    pub wet: &'a [u8],
    pub void_: &'a [u8],
}

/// Per-sample inputs: bags pre-call plus dumped plant reads.
pub struct TransportSample<'a> {
    pub dt: f64,
    pub f: TransportField<'a>,
    pub h_v: &'a [f64],
    pub h_has: &'a [u8],
    pub m_v: &'a [f64],
    pub m_has: &'a [u8],
    pub pb_v: &'a [f64],
    pub pb_has: &'a [u8],
    /// Resolved `netPAt`/`netHAt` fallbacks per node.
    pub fb_p: &'a [f64],
    pub fb_h: &'a [f64],
    pub b_v: &'a [f64],
    pub b_has: &'a [u8],
    pub c_v: &'a [f64],
    pub c_has: &'a [u8],
    pub metal_v: &'a [f64],
    pub metal_has: &'a [u8],
    /// Real `advectSrc` output (pre-call) + its metal books.
    pub src: &'a [f64],
    pub metal_qv: &'a [f64],
    pub metal_qm: &'a [u8],
    /// Resolved `bookedKg` per node (NaN = undefined).
    pub booked_kg: &'a [f64],
    /// Boron tank pin per node: non-hold tank nodes are overwritten with
    /// `(boron0 - 100*fluid.boron)` every tick before the sweep (NaN = none).
    pub boron_pin: &'a [f64],
    /// Solve's per-edge kg (NaN slot reads falsy). Always present on march.
    pub edge_kg_in: &'a [f64],
    // --- Tavg tail ---
    pub tavg_circs: &'a [TavgCirc],
    pub tavg_prev_t: &'a [f64],
    pub tavg_prev_dt: &'a [f64],
    pub tavg_in_loop: &'a [u8],
    pub tavg_core_member: &'a [u8],
    pub tavg_top: TavgTop,
    // --- boron tail ---
    pub has_boron: bool,
    pub core_node: i32,
    pub boron_prev: f64,
    pub boron_dem_prev: f64,
    pub h2_prev: f64,
    pub core_circ: i32,
    // --- H2 rise: endpoints per rise edge + post-call `edgeCval` areas.
    // Orientation (low/high by elevation) replays `h2RiseStep`.
    pub rise_lo: &'a [u32],
    pub rise_hi: &'a [u32],
    pub rise_a: &'a [f64],
    // --- consts (dumped, asserted by the gate driver) ---
    pub cond_p0: f64,
    pub cp_steel: f64,
    pub h2_rise: f64,
    pub dry_min_kg: f64,
    pub core_dt_qmin: f64,
    pub tavg_rate_tau: f64,
}

/// One `holdCircs` entry with `coreCircs[ci] == 1`.
pub struct TavgCirc {
    pub ci: i32,
    pub curve: u32,
    pub tmin: f64,
    pub tmax: f64,
}

/// Plant-level Tavg reads pre-call.
pub struct TavgTop {
    pub tavg_prev: f64,
    pub dtavg_prev: f64,
}

/// Outputs: bags post-call plus every side book the tick reads back.
#[derive(Default)]
pub struct TransportOut {
    pub h_v: Vec<f64>,
    pub h_has: Vec<u8>,
    pub m_v: Vec<f64>,
    pub m_has: Vec<u8>,
    pub b_v: Vec<f64>,
    pub b_has: Vec<u8>,
    pub c_v: Vec<f64>,
    pub c_has: Vec<u8>,
    pub metal_v: Vec<f64>,
    pub edge_kg: Vec<f64>,
    pub landed: Vec<f64>,
    pub out_pri: f64,
    pub out_sec: f64,
    pub out_kg_v: Vec<f64>,
    pub out_kg_m: Vec<u8>,
    pub out_h2_v: Vec<f64>,
    pub out_h2_m: Vec<u8>,
    pub feed_hv: Vec<f64>,
    pub feed_hm: Vec<u8>,
    pub feed_mv: Vec<f64>,
    pub feed_mm: Vec<u8>,
    pub core_hv: Vec<f64>,
    pub core_hm: Vec<u8>,
    pub h2_take_v: Vec<f64>,
    pub h2_take_m: Vec<u8>,
    /// `book(s, "advect", …)` total (floor refusals).
    pub advect_booked: f64,
    pub clamped: u32,
    pub tavg_t: Vec<f64>,
    pub tavg_dt: Vec<f64>,
    pub tavg: f64,
    pub dtavg: f64,
    pub boron: f64,
    pub boron_dem: f64,
    pub h2: f64,
}

fn floor_p(pb_v: f64, cond_p0: f64) -> f64 {
    if pb_v > cond_p0 { pb_v } else { cond_p0 }
}

/// `advEdge`: donor + limited rate per edge off the solve's kg.
fn adv_edge(n_e: usize, eu: &[u32], ev: &[u32], edge_kg: &[f64], booked: &[u8]) -> (Vec<i32>, Vec<f64>) {
    let mut e_from = vec![-1i32; n_e];
    let mut e_m = vec![0.0; n_e];
    for e in 0..n_e {
        let q = edge_kg[e];
        if !js_truthy(q) {
            continue;
        }
        let m = q.abs();
        if !(m > 1e-9) {
            continue;
        }
        // Containment never donates.
        let from = if q > 0.0 { eu[e] as usize } else { ev[e] as usize };
        if booked[from] == 2 {
            continue;
        }
        e_from[e] = from as i32;
        e_m[e] = m;
    }
    (e_from, e_m)
}

/// `advCourant`: no node gives more than it has plus same-tick arrivals.
fn adv_courant(
    n: usize,
    eu: &[u32],
    ev: &[u32],
    e_from: &[i32],
    e_m: &mut [f64],
    m_v: &[f64],
    m_has: &[u8],
    booked: &[u8],
    tank_has: &[u8],
    dt: f64,
) {
    for _ in 0..COURANT_PASSES {
        let mut m_out = vec![0.0; n];
        let mut m_in = vec![0.0; n];
        for e in 0..e_from.len() {
            let from = e_from[e];
            if from < 0 {
                continue;
            }
            let from = from as usize;
            let to = if from == eu[e] as usize { ev[e] as usize } else { eu[e] as usize };
            m_out[from] += e_m[e];
            m_in[to] += e_m[e];
        }
        let mut k_out = vec![1.0; n];
        let mut bit = false;
        for i in 0..n {
            let o = m_out[i] * dt;
            if !(o > 0.0) || (booked[i] != 0 && tank_has[i] == 0) {
                continue;
            }
            if m_has[i] == 0 {
                continue;
            }
            let cap = m_v[i] + m_in[i] * dt;
            if o > cap {
                k_out[i] = js_max(cap, 0.0) / o;
                bit = true;
            }
        }
        if !bit {
            break;
        }
        for e in 0..e_from.len() {
            let from = e_from[e];
            if from < 0 {
                continue;
            }
            let k = k_out[from as usize];
            if k != 1.0 {
                e_m[e] *= k;
            }
        }
    }
}

/// `advCap`: no node takes more than its own state weighs at the highest
/// pressure next to it.
#[allow(clippy::too_many_arguments)]
fn adv_cap(
    n: usize,
    eu: &[u32],
    ev: &[u32],
    curves: &[Curve],
    st: &TransportNodes,
    s: &TransportSample,
    e_from: &[i32],
    e_m: &mut [f64],
) {
    // March-only (`netStoreHeld == false`): the held branch leaves every
    // scale at one, so the gate feeds march samples and this is exact.
    let mut k_in = vec![1.0; n];
    let mut p_max = vec![0.0; n];
    let mut p_now = vec![0.0; n];
    for i in 0..n {
        let p = if s.pb_has[i] != 0 { floor_p(s.pb_v[i], s.cond_p0) } else { s.fb_p[i] };
        p_max[i] = p;
        p_now[i] = p;
    }
    for e in 0..e_from.len() {
        let from = e_from[e];
        if from < 0 {
            continue;
        }
        let from = from as usize;
        let to = if from == eu[e] as usize { ev[e] as usize } else { eu[e] as usize };
        let pf = p_now[from];
        if pf > p_max[to] {
            p_max[to] = pf;
        }
    }
    let mut in_raw = vec![0.0; n];
    let mut out_now = vec![0.0; n];
    for e in 0..e_from.len() {
        let from = e_from[e];
        if from < 0 {
            continue;
        }
        let from = from as usize;
        let to = if from == eu[e] as usize { ev[e] as usize } else { eu[e] as usize };
        out_now[from] += e_m[e];
        in_raw[to] += e_m[e];
    }
    for i in 0..n {
        let ir = in_raw[i] * s.dt;
        if !(ir > 0.0) || st.booked[i] != 0 {
            continue;
        }
        if s.m_has[i] == 0 || !(st.vol[i] > 0.0) {
            continue;
        }
        let c = &curves[st.curve_of[i] as usize];
        let cap = st.vol[i]
            * if s.f.void_[i] != 0 {
                rhof_of(c, sat_t(c, p_max[i]))
            } else {
                rho_mix_of(c, p_max[i], s.h_v[i])
            };
        let room = cap - s.m_v[i] + out_now[i] * s.dt;
        if ir > room {
            k_in[i] = js_max(room, 0.0) / ir;
        }
    }
    for e in 0..e_from.len() {
        let from = e_from[e];
        if from < 0 {
            continue;
        }
        let from = from as usize;
        let to = if from == eu[e] as usize { ev[e] as usize } else { eu[e] as usize };
        let k = k_in[to];
        if k != 1.0 {
            e_m[e] *= k;
        }
    }
}

/// `advSep`: a gas nozzle hands over vapour, a water outlet liquid, each
/// capped at what the node has plus same-tick arrivals.
fn adv_sep(
    n: usize,
    eu: &[u32],
    ev: &[u32],
    gas_at: &[i32],
    liq_at: &[i32],
    e_from: &[i32],
    e_m: &[f64],
    fx: &[f64],
    m_v: &[f64],
    m_has: &[u8],
    dt: f64,
) -> (Vec<f64>, Vec<f64>) {
    let mut gas_k = vec![0.0; e_from.len()];
    let mut liq_k = vec![0.0; e_from.len()];
    {
        let mut v_in = vec![0.0; n];
        let mut g_out = vec![0.0; n];
        for e in 0..e_from.len() {
            let from = e_from[e];
            if from < 0 {
                continue;
            }
            let from = from as usize;
            let to = if from == eu[e] as usize { ev[e] as usize } else { eu[e] as usize };
            let x = fx[from];
            if gas_at[e] == from as i32 && x > 0.0 {
                gas_k[e] = 1.0;
                g_out[from] += e_m[e];
                v_in[to] += e_m[e];
            } else {
                v_in[to] += e_m[e] * js_max(0.0, x);
            }
        }
        for i in 0..n {
            let o = g_out[i];
            if !(o > 0.0) {
                continue;
            }
            let budget = if m_has[i] == 0 { o * dt } else { fx[i] * m_v[i] } / dt + v_in[i];
            if o > budget {
                let k = js_max(budget, 0.0) / o;
                for e in 0..e_from.len() {
                    if gas_k[e] == 1.0 && e_from[e] == i as i32 {
                        gas_k[e] = k;
                    }
                }
            }
        }
    }
    {
        let mut l_in = vec![0.0; n];
        let mut l_out = vec![0.0; n];
        for e in 0..e_from.len() {
            let from = e_from[e];
            if from < 0 {
                continue;
            }
            let from = from as usize;
            let to = if from == eu[e] as usize { ev[e] as usize } else { eu[e] as usize };
            let x = fx[from];
            if liq_at[e] == from as i32 && x > 0.0 {
                liq_k[e] = 1.0;
                l_out[from] += e_m[e];
                l_in[to] += e_m[e];
            } else {
                l_in[to] += e_m[e] * js_max(0.0, 1.0 - x);
            }
        }
        for i in 0..n {
            let o = l_out[i];
            if !(o > 0.0) {
                continue;
            }
            let budget = if m_has[i] == 0 { o * dt } else { (1.0 - fx[i]) * m_v[i] } / dt + l_in[i];
            if o > budget {
                let k = js_max(budget, 0.0) / o;
                for e in 0..e_from.len() {
                    if liq_k[e] == 1.0 && e_from[e] == i as i32 {
                        liq_k[e] = k;
                    }
                }
            }
        }
    }
    (gas_k, liq_k)
}

/// Full `advectStep` replay on one sample. `feed_idx`/`core_idx` hold the
/// per-preset feed/core node lists (`u32::MAX` = absent).
#[allow(clippy::too_many_arguments)]
pub fn advect_step(
    curves: &[Curve],
    st: &TransportNodes,
    ed: &TransportEdges,
    feed_idx: &[u32],
    core_idx: &[u32],
    s: &TransportSample,
) -> TransportOut {
    let n = st.vol.len();
    let n_e = ed.u.len();
    let dt = s.dt;
    let mut out = TransportOut::default();

    // Donor sweep + limiters.
    let (e_from, mut e_m) = adv_edge(n_e, &ed.u, &ed.v, s.edge_kg_in, &st.booked);
    adv_courant(n, &ed.u, &ed.v, &e_from, &mut e_m, s.m_v, s.m_has, &st.booked, &st.tank_has, dt);
    adv_cap(n, &ed.u, &ed.v, curves, st, s, &e_from, &mut e_m);
    let (gas_k, liq_k) =
        adv_sep(n, &ed.u, &ed.v, &ed.gas_at, &ed.liq_at, &e_from, &e_m, s.f.x, s.m_v, s.m_has, dt);

    // Boron tank pin: unconditional overwrite before the donor sweep.
    let mut b_pre = s.b_v.to_vec();
    let mut b_has = s.b_has.to_vec();
    if s.has_boron {
        for i in 0..n {
            let pin = s.boron_pin[i];
            if !pin.is_nan() {
                b_pre[i] = pin;
                b_has[i] = 1;
            }
        }
    }

    // Carry loop.
    let mut src = s.src.to_vec();
    let mut in_h = vec![0.0; n];
    let mut in_m = vec![0.0; n];
    let mut in_b = vec![0.0; n];
    let mut in_c = vec![0.0; n];
    let mut h2_take_v = vec![0.0; n];
    let mut h2_take_m = vec![0u8; n];
    for e in 0..n_e {
        let from = e_from[e];
        if from < 0 {
            continue;
        }
        let from = from as usize;
        let to = if from == ed.u[e] as usize { ed.v[e] as usize } else { ed.u[e] as usize };
        let m = e_m[e];
        let c = &curves[st.curve_of[from] as usize];
        let fg = gas_k[e];
        let gas = fg > 0.0;
        let fl = liq_k[e];
        let liq = fl > 0.0;
        let hg = if gas { sat_hg(c, s.f.p[from]) } else { 0.0 };
        let hf = if liq { sat_h(c, s.f.p[from]) } else { 0.0 };
        let h_from = s.h_v[from];
        let hd = if gas {
            fg * hg + (1.0 - fg) * h_from
        } else if liq {
            fl * hf + (1.0 - fl) * h_from
        } else {
            h_from
        };
        in_h[to] += m * hd;
        in_m[to] += m;
        if gas {
            src[from] -= m * fg * (hg - h_from);
        }
        if liq {
            src[from] -= m * fl * (hf - h_from);
        }
        if s.has_boron {
            in_b[to] += m * b_pre[from];
            let c_from = s.c_v[from];
            let mut c_in = m * c_from * if liq { 1.0 - fl } else { 1.0 };
            if gas && c_from > 0.0 {
                let m0 = if s.m_has[from] != 0 { s.m_v[from] } else { 0.0 };
                let have = c_from * m0;
                let mine = c_from * m * dt;
                let extra = js_min(
                    fg * mine * (1.0 / s.f.x[from] - 1.0),
                    js_max(0.0, have - mine - h2_take_v[from] * m0),
                );
                c_in += extra / dt;
                if m0 > 0.0 {
                    h2_take_v[from] += extra / m0;
                    h2_take_m[from] = 1;
                }
            }
            in_c[to] += c_in;
        }
    }

    // Feed/core inlet books.
    let mut feed_hv = vec![0.0; n];
    let mut feed_hm = vec![0u8; n];
    let mut feed_mv = vec![0.0; n];
    let mut feed_mm = vec![0u8; n];
    for &fi in feed_idx {
        if fi == u32::MAX {
            continue;
        }
        let i = fi as usize;
        if in_m[i] > 0.0 {
            feed_hv[i] = in_h[i] / in_m[i];
            feed_hm[i] = 1;
            feed_mv[i] = in_m[i];
            feed_mm[i] = 1;
        }
    }
    let mut core_hv = vec![0.0; n];
    let mut core_hm = vec![0u8; n];
    for &ci in core_idx {
        if ci == u32::MAX {
            continue;
        }
        let i = ci as usize;
        if !(in_m[i] > 0.0) {
            continue;
        }
            let r = st.ref_thru[i];
        let w = if r > 0.0 { clamp(in_m[i] / (r * s.core_dt_qmin), 0.0, 1.0) } else { 0.0 };
        core_hv[i] = w * (in_h[i] / in_m[i]) + (1.0 - w) * s.h_v[i];
        core_hm[i] = 1;
    }

    // Outflow per donor; signed edge kg; cross-book landed kg.
    let mut m_out = vec![0.0; n];
    for e in 0..n_e {
        if e_from[e] >= 0 {
            m_out[e_from[e] as usize] += e_m[e];
        }
    }
    let mut edge_kg = vec![0.0; n_e];
    let mut landed = vec![0.0; n];
    for e in 0..n_e {
        let from = e_from[e];
        if from < 0 {
            continue;
        }
        let from = from as usize;
        let to = if from == ed.u[e] as usize { ed.v[e] as usize } else { ed.u[e] as usize };
        let m = e_m[e] * dt;
        edge_kg[e] = if from == ed.u[e] as usize { m } else { -m };
        if st.book_id[to] == st.book_id[from] {
            continue;
        }
        if st.book_id[to] != 0 {
            landed[to] += m;
        }
        if st.book_id[from] != 0 {
            landed[from] -= m;
        }
    }

    // Hole books + spill totals.
    let mut out_kg_v = vec![0.0; ed.n_out];
    let mut out_kg_m = vec![0u8; ed.n_out];
    let mut out_h2_v = vec![0.0; ed.n_out];
    let mut out_h2_m = vec![0u8; ed.n_out];
    let mut out_pri = 0.0;
    let mut out_sec = 0.0;
    for e in 0..n_e {
        let m = edge_kg[e];
        if !(m > 0.0) {
            continue;
        }
        if s.has_boron && (ed.is_hole[e] != 0) && s.c_v[ed.u[e] as usize] > 0.0 {
            let hi = ed.opos[e];
            if hi >= 0 {
                let hi = hi as usize;
                out_h2_v[hi] += s.c_v[ed.u[e] as usize] * m;
                out_h2_m[hi] = 1;
            }
        }
        // ...and so does the fluid, off the same booking.
        if ed.is_hole[e] != 0 {
            let ki = ed.opos[e];
            if ki >= 0 {
                let ki = ki as usize;
                out_kg_v[ki] += m;
                out_kg_m[ki] = 1;
            }
        }
        if ed.is_break[e] == 0 || ed.steam[e] != 0 {
            continue;
        }
        if ed.sec[e] != 0 {
            out_sec += m;
        } else {
            out_pri += m;
        }
    }

    // Enthalpy sweep.
    let mut h_v = s.h_v.to_vec();
    let h_has = s.h_has.to_vec();
    let mut b_v = b_pre;
    let mut c_v = s.c_v.to_vec();
    let mut clamped = 0u32;
    for i in 0..n {
        let q = src[i];
        if (!(in_m[i] > 1e-9) && !js_truthy(q)) || st.anch_skip[i] != 0 {
            continue;
        }
        let rho_pre = rho_mix_of(&curves[st.curve_of[i] as usize], s.fb_p[i], s.h_v[i]);
        let mass = js_max(if s.m_has[i] != 0 { s.m_v[i] } else { st.vol[i] * rho_pre }, s.dry_min_kg);
        if !(in_m[i] > 1e-9) {
            h_v[i] += q * dt / mass;
            continue;
        }
        let mut f = in_m[i] * dt / mass;
        if f >= 1.0 {
            f = 1.0;
            clamped += 1;
        }
        let target = (in_h[i] + src[i]) / in_m[i];
        h_v[i] += f * (target - h_v[i]);
        if s.has_boron {
            b_v[i] += f * (in_b[i] / in_m[i] - b_v[i]);
            c_v[i] += f * (in_c[i] / in_m[i] - c_v[i]);
        }
    }
    // holdNodeSet `keep` skips nothing on march (held == false in the gate).

    // Mass sweep: integrated, never assigned; the floor refusal is booked.
    let mut m_v = s.m_v.to_vec();
    let mut m_has = s.m_has.to_vec();
    let mut advect_booked = 0.0;
    for i in 0..n {
        if st.booked[i] == 2 {
            continue;
        }
        let bk = s.booked_kg[i];
        if !bk.is_nan() {
            m_v[i] = bk;
            m_has[i] = 1;
            continue;
        }
        let rho_new = rho_mix_of(&curves[st.curve_of[i] as usize], s.fb_p[i], h_v[i]);
        let eos = st.vol[i] * rho_new;
        if s.m_has[i] == 0 || eos <= s.dry_min_kg {
            m_v[i] = eos;
            m_has[i] = 1;
            continue;
        }
        let want = m_v[i] + dt * (in_m[i] - m_out[i]);
        let got = js_max(want, 0.0);
        if want != got {
            advect_booked += want - got;
        }
        m_v[i] = got;
    }

    // A node may not give a hole more hydrogen than it holds.
    if s.has_boron {
        for i in 0..n {
            if h2_take_m[i] == 0 {
                continue;
            }
            c_v[i] = js_max(0.0, c_v[i] - h2_take_v[i]);
        }
    }

    // H2 rise (drift flux up the rise edges, capped at holdings).
    if s.has_boron {
        let nr = s.rise_lo.len();
        let mut out_by = vec![0.0; n];
        let mut moves: Vec<(usize, usize, f64)> = Vec::new();
        for k in 0..nr {
            let a0 = s.rise_lo[k] as usize;
            let b0 = s.rise_hi[k] as usize;
            let (lo, hi) = if st.z[b0] > st.z[a0] { (a0, b0) } else { (b0, a0) };
            let a = s.rise_a[k];
            if !(a > 0.0) {
                continue;
            }
            let ml = if m_has[lo] != 0 { m_v[lo] } else { 0.0 };
            let mh = if m_has[hi] != 0 { m_v[hi] } else { 0.0 };
            let vv = st.vol[lo];
            if !(ml > s.dry_min_kg) || !(mh > s.dry_min_kg) || !(c_v[lo] > 0.0) || !(vv > 0.0) {
                continue;
            }
            let kg = c_v[lo] * ml / vv * s.h2_rise * a * dt;
            if !(kg > 0.0) {
                continue;
            }
            moves.push((lo, hi, kg));
            out_by[lo] += kg;
        }
        let mut kk = vec![1.0; n];
        for i in 0..n {
            if !(out_by[i] > 0.0) {
                continue;
            }
            let have = c_v[i] * m_v[i];
            kk[i] = if out_by[i] > have { have / out_by[i] } else { 1.0 };
        }
        for (lo, hi, kg) in moves {
            let m = kg * kk[lo];
            c_v[lo] -= m / m_v[lo];
            c_v[hi] += m / m_v[hi];
        }
    }

    // Tavg tail: mass-weighted read off the core circuit.
    let mut tavg_t = s.tavg_prev_t.to_vec();
    let mut tavg_dt = s.tavg_prev_dt.to_vec();
    let mut tavg = s.tavg_top.tavg_prev;
    let mut dtavg = s.tavg_top.dtavg_prev;
    for (t, tc) in s.tavg_circs.iter().enumerate() {
        let mut m = 0.0;
        let mut hm = 0.0;
        let mut pm = 0.0;
        for i in 0..n {
            if st.anch_skip[i] != 0 || st.circ_of[i] != tc.ci {
                continue;
            }
            if s.tavg_in_loop[t * n + i] == 0 {
                continue;
            }
            let r = st.ref_thru[i];
            let w = if s.tavg_core_member[t * n + i] != 0 {
                1.0
            } else if r > 0.0 {
                clamp(js_min(in_m[i], m_out[i]) / r, 0.0, 1.0)
            } else {
                0.0
            };
            if !(w > 0.0) {
                continue;
            }
            let rho_new = rho_mix_of(&curves[st.curve_of[i] as usize], s.fb_p[i], h_v[i]);
            let mi = w * if m_has[i] != 0 { m_v[i] } else { st.vol[i] * rho_new };
            let hi = if s.tavg_core_member[t * n + i] != 0 && in_m[i] > 1e-9 {
                0.5 * (in_h[i] / in_m[i] + h_v[i])
            } else {
                h_v[i]
            };
            m += mi;
            hm += mi * hi;
            pm += mi * if s.pb_has[i] != 0 { floor_p(s.pb_v[i], s.cond_p0) } else { s.fb_p[i] };
        }
        if m > 0.0 {
            let c = &curves[tc.curve as usize];
            let was = s.tavg_prev_t[t];
            let tt = clamp(t_of_h(c, pm / m, hm / m), tc.tmin, tc.tmax);
            let raw = if dt > 0.0 { (tt - was) / dt } else { 0.0 };
            let d_was = s.tavg_prev_dt[t];
            let dtt = if d_was.is_finite() {
                d_was + (raw - d_was) * js_min(1.0, dt / s.tavg_rate_tau)
            } else {
                raw
            };
            tavg_t[t] = tt;
            tavg_dt[t] = dtt;
            if tc.ci == s.core_circ {
                tavg = tt;
                dtavg = dtt;
            }
        }
    }

    // Boron/H2 tail.
    let mut boron = s.boron_prev;
    let mut boron_dem = s.boron_dem_prev;
    let mut h2 = s.h2_prev;
    if s.has_boron && s.core_node >= 0 {
        let cn = s.core_node as usize;
        // `if(b.has[net.coreNode])`: the mask past pin + seeding decides.
        if b_has[cn] != 0 {
            let bv = b_v[cn];
            let d = bv - boron;
            boron = bv;
            boron_dem += d;
        }
        h2 = if s.core_circ < 0 {
            s.h2_prev
        } else {
            let mut t = 0.0;
            for i in 0..n {
                let cc = c_v[i];
                if !(cc > 0.0) || st.in_core[i] == 0 {
                    continue;
                }
                let rho_new = rho_mix_of(&curves[st.curve_of[i] as usize], s.fb_p[i], h_v[i]);
                let mm = if m_has[i] != 0 { m_v[i] } else { st.vol[i] * rho_new };
                t += cc * mm;
            }
            t
        };
    }

    // Metal wall gives back what advectSrc charged it.
    let mut metal_v = s.metal_v.to_vec();
    if st.metal_kg.iter().any(|&k| k != 0.0 && !k.is_nan()) && !s.metal_v.is_empty() {
        for i in 0..n {
            if s.metal_qm[i] == 0 {
                continue;
            }
            metal_v[i] -= s.metal_qv[i] * dt / (st.metal_kg[i] * s.cp_steel);
        }
    }

    // Masks: the sweep writes values, never masks (seeding ran pre-call),
    // so they pass through untouched.
    out.h_v = h_v;
    out.h_has = h_has;
    out.m_v = m_v;
    out.m_has = m_has;
    out.b_v = b_v;
    out.b_has = b_has;
    out.c_v = c_v;
    out.c_has = s.c_has.to_vec();
    out.metal_v = metal_v;
    out.edge_kg = edge_kg;
    out.landed = landed;
    out.out_pri = out_pri;
    out.out_sec = out_sec;
    out.out_kg_v = out_kg_v;
    out.out_kg_m = out_kg_m;
    out.out_h2_v = out_h2_v;
    out.out_h2_m = out_h2_m;
    out.feed_hv = feed_hv;
    out.feed_hm = feed_hm;
    out.feed_mv = feed_mv;
    out.feed_mm = feed_mm;
    out.core_hv = core_hv;
    out.core_hm = core_hm;
    out.h2_take_v = h2_take_v;
    out.h2_take_m = h2_take_m;
    out.advect_booked = advect_booked;
    out.clamped = clamped;
    out.tavg_t = tavg_t;
    out.tavg_dt = tavg_dt;
    out.tavg = tavg;
    out.dtavg = dtavg;
    out.boron = boron;
    out.boron_dem = boron_dem;
    out.h2 = h2;
    out
}

/// `injectFluid`: the INJECT tool's fluid half. Pure boundary math over a
/// driver-resolved node.
pub struct InjectOut {
    pub acted: bool,
    pub have: f64,
    /// `book(s, "inject", …)` delta.
    pub booked: f64,
}

pub fn inject_fluid(have: Option<f64>, rate: f64, dt: f64) -> InjectOut {
    let h = match have {
        Some(h) => h,
        None => return InjectOut { acted: false, have: f64::NAN, booked: 0.0 },
    };
    if !js_truthy(rate) {
        return InjectOut { acted: false, have: h, booked: 0.0 };
    }
    let kg = if rate > 0.0 { rate * dt } else { -js_min(-rate * dt, h) };
    if !js_truthy(kg) {
        return InjectOut { acted: false, have: h, booked: 0.0 };
    }
    InjectOut { acted: true, have: h + kg, booked: -kg }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn courant_never_overdraws() {
        let eu = vec![0, 1];
        let ev = vec![1, 2];
        let from = vec![0, 1];
        let mut e_m = vec![100.0, 100.0];
        let m_v = vec![1.0, 1.0, 1000.0];
        let m_has = vec![1, 1, 1];
        adv_courant(3, &eu, &ev, &from, &mut e_m, &m_v, &m_has, &[0, 0, 0], &[0, 0, 0], 0.02);
        assert!(e_m[0] * 0.02 <= 1.0 + 1e-12);
    }

    #[test]
    fn inject_withdrawal_clamps_at_holdings() {
        let r = inject_fluid(Some(5.0), -1000.0, 0.02);
        assert!(r.acted);
        assert_eq!(r.have, 0.0);
        assert_eq!(r.booked, 5.0);
    }

    #[test]
    fn inject_missing_node_is_noop() {
        let r = inject_fluid(None, 10.0, 0.02);
        assert!(!r.acted);
    }
}
