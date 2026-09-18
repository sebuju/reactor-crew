//! Nodal core, ported from `src/sim/core2d.js` (`coreStep` + shape helpers)
//! and the tick-called per-core integrators in `src/sim/step.js`
//! (`coreRodStep`, `coreDecayStep`, `coreKineticsStep`, the `coreVesselStep`
//! tail assembly, `coreMeltStep` physics, `coreBurstStep` logic, `coreFatigueStep`).
//!
//! Plant-coupled reads arrive pre-evaluated (dump-kit, like the transport
//! gate): `coreStep` args (`heat/sat/vLeak/mflux/flowFrac/hIn`), rod rates
//! and the `sinkDriver` answer, melt `loopKg`/`have`/`contRelPart`, H2 `m2`.
//! All constants below are asserted bit-equal against the JS by the gate.

use crate::eos::{clamp, js_max, js_min, js_truthy, rhof_of, rhog_of, sat_t, Curve};

pub const XNR: usize = 14;
pub const XNZ: usize = 10;
pub const XNN: usize = XNR * XNZ;
#[inline]
pub fn xix(i: usize, j: usize) -> usize {
    i * XNZ + j
}

pub const SOR_SWEEPS: usize = 6;
pub const SOR_OM: f64 = 1.5;
pub const XCOUP: f64 = 1.0;
pub const XTILTZ: f64 = 0.30;
pub const XTAU_F: f64 = 4.0;
pub const CLAD_DT0: f64 = 30.0;
pub const H_POOL: f64 = 2000.0;
pub const JL_K: f64 = 25.0;
pub const JL_P: f64 = 6.2;
pub const XC0: f64 = 1.13;
pub const XMIX_MAX: f64 = 0.85;
pub const SZ_LO: f64 = 0.0022;
pub const K_COOL: f64 = 0.54;
pub const DNB_FILM: f64 = 0.10;
pub const DT_LEID: f64 = 150.0;
pub const PROMPT_F: f64 = 0.935;
pub const DEC_A: [f64; 4] = [0.0299, 0.0212, 0.00947, 0.00380];
pub const DEC_L: [f64; 4] = [0.0994, 0.00477, 4.11e-4, 2.19e-5];
pub const MELT_LATCH: f64 = 0.25;
pub const MELT_INV: f64 = 0.35;
pub const MELT_FAT: f64 = 1.6;
pub const FCI_TAU: f64 = 0.01;
pub const FCI_ETA: f64 = 0.2;
pub const DISP_H: f64 = 280.0 * 4.184;
pub const DISP_SPAN: f64 = 40.0;
pub const FUSE_KJ: f64 = 277.0;
pub const FUEL_CP: f64 = 0.33;
pub const FUSE_DT: f64 = FUSE_KJ / FUEL_CP;
pub const T_STP: f64 = 298.0;
pub const BURST_TAU: f64 = 8.0;
pub const BURST_SPAN: f64 = 50.0;
pub const BURST_LO_SIG: f64 = 20.0;
pub const BURST_LO_T: f64 = 1477.0;
pub const BURST_HI_SIG: f64 = 140.0;
pub const BURST_HI_T: f64 = 1030.0;
pub const OX_CP_A: f64 = 2.252e-6;
pub const OX_CP_B: f64 = 18063.0;
pub const OX_BJ_A: f64 = 1.867e-4;
pub const OX_BJ_B: f64 = 22899.0;
pub const OX_TSW: f64 = 1850.0;
pub const OX_VMIN: f64 = 0.02;
pub const OX_T0: f64 = 1073.0;
pub const OX_ECR_FAIL: f64 = 0.17;
pub const P_FILL: f64 = 2.2;
pub const T_FILL: f64 = 300.0;
pub const ROD_D0: f64 = 0.0095;
pub const ROD_CLAD: f64 = 0.00057;
pub const ZR_RHO: f64 = 6560.0;
pub const ZR_PBR: f64 = 1.56;
pub const ZR_QOX: f64 = 6.45e6;
pub const ZR_H2: f64 = 0.0442;
pub const REL_GAP: f64 = 0.40;
pub const REL_OX: f64 = 0.80;
pub const REL_DISP: f64 = 1.60;
pub const REL_MELT: f64 = 2.40;
/// `RELK` in `FAIL` order (intact, tube, burst, oxid, disp, molten).
pub const RELK: [f64; 6] = [0.0, 0.0, REL_GAP, REL_OX, REL_DISP, REL_MELT];
pub const W3_P: f64 = 145.038;
pub const W3_G: f64 = 737.338;
pub const W3_D: f64 = 39.3701;
pub const W3_Q: f64 = 3.15459;
pub const W3_H: f64 = 2.326;
pub const W3_P_LO: f64 = 1000.0;
pub const W3_P_HI: f64 = 2300.0;
pub const W3_G_LO: f64 = 1.0;
pub const W3_G_HI: f64 = 5.0;
pub const W3_D_LO: f64 = 0.2;
pub const W3_D_HI: f64 = 0.7;
pub const W3_X_LO: f64 = -0.15;
pub const W3_X_HI: f64 = 0.15;

/// JS `Math.sign`: NaN stays NaN, signed zero stays signed zero.
#[inline]
fn js_sign(d: f64) -> f64 {
    if d > 0.0 {
        1.0
    } else if d < 0.0 {
        -1.0
    } else {
        d
    }
}

/// `x || 0`: NaN/0/missing read as zero.
#[inline]
fn js_or0(v: f64) -> f64 {
    if js_truthy(v) {
        v
    } else {
        0.0
    }
}

/// Levy's profile fit below departure is 1 then NaN; guarded by the caller.
pub fn sub_qual(xe: f64, xd: f64) -> f64 {
    if xe <= xd {
        return 0.0;
    }
    let e = crate::fdlibm::exp(xe / xd - 1.0);
    (xe - xd * e) / (1.0 - xd * e)
}

pub fn drift_flux(x: f64, rvl: f64) -> f64 {
    let q = clamp(x, 0.0, 1.0);
    if q <= 0.0 {
        0.0
    } else {
        clamp(q / (XC0 * (q + (1.0 - q) * rvl)), 0.0, 1.0)
    }
}

/// `driftFlux` run backwards.
pub fn void_qual(v: f64, rvl: f64) -> f64 {
    let q = clamp(v, 0.0, 1.0);
    let den = 1.0 - q * XC0 * (1.0 - rvl);
    if den > 1e-6 {
        clamp(q * XC0 * rvl / den, 0.0, 1.0)
    } else {
        1.0
    }
}

/// First maximum wins, like the JS scan. Returns (value, k, ring, level).
pub fn node_peak(a: &[f64]) -> (f64, usize, usize, usize) {
    let mut v = -1e30;
    let mut k = 0;
    for (q, &x) in a.iter().enumerate() {
        if x > v {
            v = x;
            k = q;
        }
    }
    (v, k, k / XNZ, k % XNZ)
}

/// Vapour/liquid density ratio at the core's own pressure.
pub fn sat_rvl(c: &Curve, p: f64) -> f64 {
    let t = sat_t(c, p);
    rhog_of(c, t) / rhof_of(c, t)
}

/// Coolant density off the linear law (`rhoAt` in pipenet.js).
pub fn rho_at(t: f64, rho0: f64, beta: f64, tref: f64) -> f64 {
    rho0 * (1.0 - beta * (t - tref))
}

/// Cathcart-Pawel below `OX_TSW`, Baker-Just above; thickness-squared rate.
pub fn ox_rate(t: f64) -> f64 {
    if t < OX_TSW {
        OX_CP_A * crate::fdlibm::exp(-OX_CP_B / js_max(t, 300.0))
    } else {
        OX_BJ_A * crate::fdlibm::exp(-OX_BJ_B / js_max(t, 300.0))
    }
}

/// Equivalent clad reacted off the drawn wall.
#[inline]
pub fn ecr_of(ox: f64) -> f64 {
    ox / ZR_PBR / ROD_CLAD
}

/// NUREG-0630 fast-ramp burst temperature in log stress.
pub fn burst_t(dp: f64, burst_r: f64) -> f64 {
    let sig = burst_r * dp.max(0.0);
    if sig <= BURST_LO_SIG {
        return BURST_LO_T;
    }
    let f = crate::fdlibm::log(sig / BURST_LO_SIG) / crate::fdlibm::log(BURST_HI_SIG / BURST_LO_SIG);
    BURST_HI_T.max(BURST_LO_T - (BURST_LO_T - BURST_HI_T) * f)
}

/// Film-boiling latch: a wall past `DT_LEID` stays blanketed.
pub fn dnb_latch(dryout: bool, d: f64, dts: f64, was: f64) -> f64 {
    if !dryout {
        0.0
    } else if d < 1.0 {
        1.0
    } else if js_truthy(was) && dts > DT_LEID {
        1.0
    } else {
        0.0
    }
}

fn sigma_w(t: f64) -> f64 {
    let x = clamp(1.0 - t / 647.096, 0.0, 1.0);
    0.2358 * crate::fdlibm::pow(x, 1.256) * (1.0 - 0.625 * x)
}

fn chf_zuber(c: &Curve, p_mpa: f64) -> f64 {
    let t = sat_t(c, p_mpa);
    let rf = rhof_of(c, t);
    let rg = rhog_of(c, t);
    0.131 * crate::eos::hfg_of(c, t) * 1000.0 * libm::sqrt(rg)
        * crate::fdlibm::pow(sigma_w(t) * 9.81 * js_max(rf - rg, 1e-3), 0.25)
}

fn chf_biasi(p_mpa: f64, g_si: f64, x: f64, dh_m: f64) -> f64 {
    let dc = dh_m * 100.0;
    let g = js_max(g_si, 1.0) / 10.0;
    let pb = p_mpa * 10.0;
    let dn = crate::fdlibm::pow(dc, if dc >= 1.0 { 0.4 } else { 0.6 });
    let g6 = crate::fdlibm::pow(g, 1.0 / 6.0);
    let f = 0.7249 + 0.099 * pb * crate::fdlibm::exp(-0.032 * pb);
    let h = -1.159 + 0.149 * pb * crate::fdlibm::exp(-0.019 * pb) + 8.99 * pb / (10.0 + pb * pb);
    let q1 = 1.883e3 / (dn * g6) * (f / g6 - x);
    let q2 = 3.78e3 * h * (1.0 - x) / (dn * crate::fdlibm::pow(g, 0.6));
    js_max(js_max(q1, q2), 0.0) * 1e4
}

/// Per-core constants (commissioned `K`;/XNN geometry is module-fixed).
#[derive(Clone)]
pub struct CoreK {
    pub nb: usize,
    pub sat: Curve,
    pub n0: f64,
    pub tf_ref: f64,
    pub tref: f64,
    pub rod_a: f64,
    pub tip_rho: f64,
    pub tip_len: f64,
    pub poison: f64,
    pub poi_g: Vec<f64>,
    pub n_pen: Vec<f64>,
    pub enr_rho: Vec<f64>,
    pub mix: f64,
    pub dt0: f64,
    pub dh: f64,
    pub a_heat: f64,
    pub g0: f64,
    pub film_pool: f64,
    pub x_sub: f64,
    pub x_sub_lo: f64,
    pub hfg: f64,
    pub flow_k: f64,
    pub pin_ua: f64,
    pub g_solid: f64,
    pub clad_r: f64,
    pub rod_d: f64,
    pub tmelt: f64,
    pub oxid: bool,
    pub kxe: f64,
    pub a_f: f64,
    pub a_m: f64,
    pub a_x: f64,
    pub a_s: f64,
    pub a_v: f64,
    pub excess: f64,
    pub dnbr_k: f64,
    /// 0 W-3, 1 boil, 2 temp.
    pub dnb_law: u8,
    pub tdmg: f64,
    pub dryout: bool,
    pub rated: f64,
    pub scram: f64,
    pub rod_rate: f64,
    pub burst_k: f64,
    pub p0: f64,
    pub core_kg0: f64,
    pub tube: bool,
    pub beta: f64,
    pub bet: Vec<f64>,
    pub lam: Vec<f64>,
    pub lam_big: f64,
    pub g_i: f64,
    pub lam_i: f64,
    pub g_x: f64,
    pub lam_x: f64,
    pub sig: f64,
    pub cr: f64,
    pub cz: f64,
    pub alb_r: f64,
    pub alb_t: f64,
    pub alb_b: f64,
    pub rinf: f64,
    pub bank_r: Vec<f64>,
    pub bank_w: Vec<f64>,
    pub rinf_w: Vec<f64>,
    pub burst_r: f64,
    pub rho0: f64,
    pub rho_beta: f64,
    pub plant_tref: f64,
    pub core_hgt: f64,
}

/// Mutable per-vessel state (`cs`; XNN nodal arrays + scalars).
#[derive(Clone, Default)]
pub struct CoreState {
    pub phi: Vec<f64>,
    pub x_i: Vec<f64>,
    pub x_x: Vec<f64>,
    pub n_tf: Vec<f64>,
    pub n_tc: Vec<f64>,
    pub n_v: Vec<f64>,
    pub n_rho: Vec<f64>,
    pub n_vt: Vec<f64>,
    pub n_tct: Vec<f64>,
    pub n_cov: Vec<f64>,
    pub n_fol: Vec<f64>,
    pub n_dmg: Vec<f64>,
    pub n_ox: Vec<f64>,
    pub n_melt: Vec<f64>,
    pub n_disp: Vec<f64>,
    pub n_dnb: Vec<f64>,
    pub ch_w: Vec<f64>,
    pub n: f64,
    pub c: Vec<f64>,
    pub dec: Vec<f64>,
    pub decay: f64,
    pub heat: f64,
    pub rod_pos: f64,
    pub rod_dem: f64,
    pub rod_z: Vec<f64>,
    pub rod_zdem: Vec<f64>,
    pub tilt: f64,
    pub tilt_dem: f64,
    pub split: bool,
    pub re_gang: bool,
    pub rod_jam: bool,
    pub scrammed: bool,
    pub rod_band: bool,
    pub dnbr: f64,
    pub x: f64,
    pub i: f64,
    pub tf: f64,
    pub ao: f64,
    pub ro: f64,
    pub hot_ring: f64,
    pub hot_lev: f64,
    pub v_node: f64,
    pub hot_flow: f64,
    pub tip_rho_out: f64,
    pub tf_hot: f64,
    pub dmg: f64,
    pub melt_frac: f64,
    pub ox_max: f64,
    pub q_ox: f64,
    pub fci: f64,
    pub t_clad_hot: f64,
    pub dnbr_min: f64,
    pub dnbr_ring: f64,
    pub dnbr_lev: f64,
    pub fq: f64,
    pub vf: f64,
    pub void_th: f64,
    pub core_dt: f64,
    pub parts: [f64; 9],
    pub rho: f64,
    pub p_core: f64,
    pub flow_net: f64,
    pub fatigue: f64,
    pub melt: bool,
    pub breach: bool,
    pub n_tube: Vec<u8>,
    pub tubes_open: f64,
    pub cav_relief: bool,
}

/// `coreStep` return block (ODOP..OFCI), copied out per call.
#[derive(Clone, Default)]
pub struct CoreO {
    pub o: [f64; 10],
}

/// Rod coverage + follower fraction off bank positions.
pub fn rod_shape(k: &CoreK, rod_z: &[f64], cov: &mut [f64], fol: &mut [f64]) {
    cov.fill(0.0);
    fol.fill(0.0);
    for b in 0..k.nb {
        let ins = clamp(rod_z[b], 0.0, 1.0);
        let tip = XNZ as f64 * (1.0 - ins);
        let f_lo = tip - k.tip_len;
        let f_hi = tip;
        for i in 0..XNR {
            let w = js_max(0.0, 1.0 - (i as f64 - k.bank_r[b]).abs() / k.rinf) / js_max(k.rinf_w[i], 1e-6);
            if w <= 0.0 {
                continue;
            }
            for j in 0..XNZ {
                let kk = xix(i, j);
                cov[kk] += w * clamp(j as f64 + 1.0 - tip, 0.0, 1.0);
                fol[kk] += w * clamp(js_min(j as f64 + 1.0, f_hi) - js_max(j as f64, f_lo), 0.0, 1.0);
            }
        }
    }
}

/// SOR flux solve with albedo boundaries, renormalised per sweep.
pub fn core_solve(k: &CoreK, phi: &mut [f64], rho: &[f64], sweeps: usize) {
    for _ in 0..sweeps {
        for i in 0..XNR {
            let b = i * XNZ;
            let fi = i as f64 / (i as f64 + 0.5);
            let fo = (i as f64 + 1.0) / (i as f64 + 0.5);
            let den = k.cr * (fi + fo) + 2.0 * k.cz + 1.0;
            for j in 0..XNZ {
                let kk = b + j;
                let inn = if i > 0 { phi[kk - XNZ] } else { 0.0 };
                let ou = if i < XNR - 1 { phi[kk + XNZ] } else { k.alb_r * phi[kk] };
                let dn = if j > 0 { phi[kk - 1] } else { k.alb_b * phi[kk] };
                let up = if j < XNZ - 1 { phi[kk + 1] } else { k.alb_t * phi[kk] };
                let num = k.cr * (fi * inn + fo * ou) + k.cz * (dn + up) + (1.0 + rho[kk] * 1e-5) * phi[kk];
                let v = phi[kk] + SOR_OM * (num / den - phi[kk]);
                phi[kk] = if v.is_finite() && v > 1e-6 { v } else { 1e-6 };
            }
        }
        let mut m = 0.0;
        for kk in 0..XNN {
            m += phi[kk] * node_w(kk);
        }
        if m > 1e-9 {
            for kk in 0..XNN {
                phi[kk] /= m;
            }
        } else {
            phi.fill(1.0);
        }
    }
}

#[inline]
pub fn node_w(k: usize) -> f64 {
    let i = k / XNZ;
    let mut t = 0.0;
    for q in 0..XNR {
        t += (2 * q + 1) as f64;
    }
    (2 * i + 1) as f64 / t / XNZ as f64
}

/// Settle where each bank actually stands — the one place that decides it.
pub fn rod_banks(k: &CoreK, cs: &mut CoreState) {
    for b in 0..k.nb {
        cs.rod_z[b] = clamp(
            if cs.split { cs.rod_z[b] } else { cs.rod_pos + k.bank_w[b] * XTILTZ * cs.tilt },
            0.0,
            1.0,
        );
    }
}

/// `coreRodStep`: bank drives, scram latch, regang, tilt. `sink` is the
/// dumped `sinkDriver(S,"rodStep",id)` answer; rates are dumped K reads.
pub fn rod_step(k: &CoreK, cs: &mut CoreState, dt: f64, sink: bool, tilt_rate: f64) {
    if !sink {
        cs.rod_band = false;
    }
    if cs.re_gang {
        let mut done = true;
        for b in 0..k.nb {
            cs.rod_zdem[b] = clamp(cs.rod_dem + k.bank_w[b] * XTILTZ * cs.tilt, 0.0, 1.0);
            if (cs.rod_z[b] - cs.rod_zdem[b]).abs() > 1e-6 {
                done = false;
            }
        }
        if done {
            cs.split = false;
            cs.re_gang = false;
        }
    }
    if cs.scrammed {
        cs.rod_dem = 1.0;
        for b in 0..k.nb {
            cs.rod_zdem[b] = 1.0;
        }
    }
    if !cs.rod_jam {
        let r = if cs.scrammed { k.scram } else { k.rod_rate };
        if cs.split {
            for b in 0..k.nb {
                let d = cs.rod_zdem[b] - cs.rod_z[b];
                cs.rod_z[b] += js_sign(d) * js_min(d.abs(), r * dt);
            }
        } else {
            let d = cs.rod_dem - cs.rod_pos;
            cs.rod_pos += js_sign(d) * js_min(d.abs(), r * dt);
        }
        if !cs.split {
            let d = cs.tilt_dem - cs.tilt;
            cs.tilt += js_sign(d) * js_min(d.abs(), tilt_rate * dt);
        }
    }
    rod_banks(k, cs);
    if cs.split {
        let mut m = 0.0;
        for b in 0..k.nb {
            m += cs.rod_z[b];
        }
        cs.rod_pos = m / k.nb as f64;
        if !cs.re_gang {
            let mut d = 0.0;
            for b in 0..k.nb {
                d += cs.rod_zdem[b];
            }
            cs.rod_dem = d / k.nb as f64;
        }
    }
}

/// `coreDecayStep`: four-group decay heat pot.
pub fn decay_step(cs: &mut CoreState, dt: f64) {
    let mut d = 0.0;
    for i in 0..4 {
        cs.dec[i] += DEC_L[i] * (DEC_A[i] * cs.n - cs.dec[i]) * dt;
        d += cs.dec[i];
    }
    cs.decay = d;
    cs.heat = cs.n * PROMPT_F + cs.decay;
}

/// `coreKineticsStep`: point kinetics, 4 RK-ish substeps over 6 groups.
/// Floored, never zero: the nodal core divides by the power it is given.
pub fn kinetics_step(k: &CoreK, cs: &mut CoreState, dt: f64) {
    let h = dt / 4.0;
    let rk = cs.rho * 1e-5;
    for _ in 0..4 {
        let mut num = 0.0;
        let mut den = 0.0;
        for i in 0..6 {
            let dd = 1.0 + h * k.lam[i];
            num += k.lam[i] * cs.c[i] / dd;
            den += k.lam[i] * h * k.bet[i] / k.lam_big / dd;
        }
        let a = 1.0 - h * (rk - k.beta) / k.lam_big - h * den;
        let mut n = if a > 1e-6 { (cs.n + h * num + h * 2e-9) / a } else { cs.n * 12.0 };
        if !n.is_finite() || n < 0.0 {
            n = cs.n * 12.0;
        }
        cs.n = js_min(n, 60.0);
        for i in 0..6 {
            cs.c[i] = (cs.c[i] + h * k.bet[i] / k.lam_big * cs.n) / (1.0 + h * k.lam[i]);
        }
    }
    cs.n = js_max(cs.n, 1e-9);
    cs.dnbr = cs.dnbr_min;
}

/// Margin chain (`marginNode`, sole caller coreStep): W-3 with Biasi past
/// the quality edge and Zuber below the low-flow floor.
#[allow(clippy::too_many_arguments)]
pub fn margin_node(
    k: &CoreK,
    heat: f64,
    pw: f64,
    rise: f64,
    tin: f64,
    tf: f64,
    g_share: f64,
    x: f64,
    dh_sub: f64,
    p_core: f64,
) -> f64 {
    let dh = dh_sub;
    let dt = rise;
    let q = heat * k.rated * 1e6 / js_max(k.a_heat, 1e-6) * js_max(pw, 1e-3);
    let g = k.g0 * g_share;
    if k.dnb_law == 1 {
        return k.dnbr_k * (dh / k.sat.cp) / js_max(dt, 1e-3);
    }
    if k.dnb_law == 2 {
        return k.dnbr_k * js_max(k.tdmg - tin, 0.0) / js_max(tf - tin, 1e-3);
    }
    let g_floor = W3_G_LO * 1e6 / W3_G;
    let g_si = if g > g_floor { g } else { g_floor };
    let p = clamp(p_core * W3_P, W3_P_LO, W3_P_HI);
    let gg = clamp(g_si * W3_G / 1e6, W3_G_LO, W3_G_HI);
    let de = clamp(k.dh * W3_D, W3_D_LO, W3_D_HI);
    let qq = clamp(x, W3_X_LO, W3_X_HI);
    let hs = js_max(dh, 0.0) / W3_H;
    let w3 = 1e6
        * W3_Q
        * ((2.022 - 4.302e-4 * p) + (0.1722 - 9.84e-5 * p) * crate::fdlibm::exp((18.177 - 4.129e-3 * p) * qq))
        * ((0.1484 - 1.596 * qq + 0.1729 * qq * qq.abs()) * gg + 1.037)
        * (1.157 - 0.869 * qq)
        * (0.2664 + 0.8357 * crate::fdlibm::exp(-3.151 * de))
        * (0.8258 + 7.94e-4 * hs);
    let w = if x > W3_X_HI {
        w3.min(chf_biasi(p_core, if g > g_floor { g } else { g_floor }, x, k.dh))
    } else {
        w3
    };
    if g >= g_floor {
        let mq = if q > 1.0 { q } else { 1.0 };
        return k.dnbr_k * w / mq;
    }
    let z = chf_zuber(&k.sat, p_core);
    let mq = if q > 1.0 { q } else { 1.0 };
    k.dnbr_k * (w.min(z + (w - z) * g / g_floor)) / mq
}

/// The nodal pass (`coreStep`): channel split, per-node thermal/damage/
/// xenon/reactivity, void-temp lag, flux solve, aggregates. Returns the
/// 10-term reactivity block; `cs` carries the rest.
#[allow(clippy::too_many_arguments)]
pub fn core_step(
    k: &CoreK,
    cs: &mut CoreState,
    dt: f64,
    heat: f64,
    sat: f64,
    v_leak: f64,
    mflux: f64,
    flow_frac: f64,
    h_in: f64,
    core_dt_max: f64,
) -> CoreO {
    let rvl = sat_rvl(&k.sat, cs.p_core);
    {
        let rq = 1.0 / js_max(rvl, 1e-6) - 1.0;
        let mut tot = 0.0;
        for i in 0..XNR {
            let mut x = 0.0;
            for j in 0..XNZ {
                x += void_qual(cs.n_v[xix(i, j)], rvl);
            }
            cs.ch_w[i] = 1.0 / libm::sqrt(1.0 + rq * (x / XNZ as f64));
            tot += cs.ch_w[i] * ring_w(i);
        }
        for i in 0..XNR {
            cs.ch_w[i] /= js_max(tot, 1e-6);
        }
    }

    rod_shape(k, &cs.rod_z, &mut cs.n_cov, &mut cs.n_fol);
    let mut mix_k = [0.0; XNR];
    {
        let mut raw = 0.0;
        for i in 0..XNR {
            let mut ring_p = 0.0;
            for j in 0..XNZ {
                ring_p += cs.phi[xix(i, j)];
            }
            ring_p = js_max(ring_p / XNZ as f64, 1e-6);
            mix_k[i] = (1.0 + (ring_p - 1.0) * (1.0 - k.mix)) / ring_p;
            raw += ring_w(i) * heat * k.dt0 * ring_p * mix_k[i] / js_max(flow_frac, 1e-3);
        }
        cs.core_dt = clamp(raw, 0.0, core_dt_max);
    }
    let t_cold = h_in / k.sat.cp;
    let qhat = heat * k.rated * 1000.0 / js_max(k.pin_ua, 1e-9);
    let qpp0 = k.rated * 1e6 / js_max(k.a_heat, 1e-6);
    let ff = js_max(flow_frac, 1e-3);
    let cp = k.sat.cp;
    let d_t0 = k.dt0;
    let h_sat = cp * sat;
    let mut dnb_lo = 1e30;
    let mut dnb_k = 0usize;
    let mut tcl_h = 0.0;
    let mut ecr_h = 0.0;
    let mut h2 = 0.0;
    let mut ox_p = 0.0;
    let mut fci_e = 0.0;
    let mut dis_k = [0.0; XNN];
    let dh_sub = cp * (sat - t_cold);
    for i in 0..XNR {
        let chan = js_max(cs.ch_w[i], 1e-3);
        let d_tn = heat * d_t0 * mix_k[i] / (XNZ as f64 * ff * chan);
        let film0 = js_max(crate::fdlibm::pow(js_max(mflux * chan, 0.0), 0.8), js_or0(k.film_pool));
        let g_ch = js_max(mflux * chan, 1e-3);
        let mut h = h_in;
        for j in 0..XNZ {
            let kk = xix(i, j);
            let pw = cs.phi[kk];
            let dh = cp * d_tn * pw;
            let h_mid = h + dh / 2.0;
            h += dh;
            cs.n_tct[kk] = if h_mid <= h_sat { h_mid / cp } else { sat };
            let q2 = js_max(heat * pw, 0.0);
            let xd = -js_max(js_min(k.x_sub * q2 / g_ch, k.x_sub_lo * q2), 1e-6);
            let xe = (h_mid - h_sat) / k.hfg;
            cs.n_vt[kk] = drift_flux(sub_qual(xe, xd), rvl);

            let dnb = margin_node(
                k, heat, pw, h_mid / cp - t_cold, t_cold, cs.n_tf[kk],
                mflux * chan, xe, dh_sub, cs.p_core,
            );
            if dnb < dnb_lo {
                dnb_lo = dnb;
                dnb_k = kk;
            }

            let bare = 1.0 - clamp(v_leak, 0.0, 1.0);
            let h_csp = film0 * bare / k.clad_r;
            let h_cnb = qhat * pw * bare
                / js_max(
                    sat + JL_K * crate::fdlibm::pow(js_max(qpp0 * q2, 1.0) / 1e6, 0.25)
                        * crate::fdlibm::exp(-cs.p_core / JL_P)
                        - cs.n_tc[kk],
                    1e-3,
                );
            let h_cw = js_max(h_csp, h_cnb);
            let tcl_nb = cs.n_tc[kk] + (cs.n_tf[kk] - cs.n_tc[kk]) * k.g_solid / (k.g_solid + h_cw);
            cs.n_dnb[kk] = dnb_latch(k.dryout, dnb, tcl_nb - sat, cs.n_dnb[kk]);
            let h_c = if js_truthy(cs.n_dnb[kk]) { h_csp * DNB_FILM } else { h_cw };
            let film = k.g_solid * h_c / js_max(k.g_solid + h_c, 1e-12);

            let tcl = cs.n_tc[kk] + (cs.n_tf[kk] - cs.n_tc[kk]) * k.g_solid / (k.g_solid + h_c);
            if tcl > tcl_h {
                tcl_h = tcl;
            }

            let mut q_ox = 0.0;
            if dt > 0.0 && k.oxid && tcl > OX_T0 && cs.n_v[kk] > OX_VMIN && ecr_of(cs.n_ox[kk]) < 1.0 {
                let o0 = cs.n_ox[kk];
                cs.n_ox[kk] = js_min(
                    ZR_PBR * ROD_CLAD,
                    libm::sqrt(o0 * o0 + ox_rate(tcl) * (1.0 + cs.n_dmg[kk]) * dt),
                );
                let dm = ZR_RHO * (cs.n_ox[kk] - o0) / ZR_PBR * k.a_heat * node_w(kk);
                h2 += ZR_H2 * dm;
                q_ox = ZR_QOX * dm / (1000.0 * dt * node_w(kk) * js_max(k.pin_ua, 1e-9));
            }
            {
                let e = ecr_of(cs.n_ox[kk]);
                if e > ecr_h {
                    ecr_h = e;
                }
            }
            ox_p += q_ox * node_w(kk);

            let q_pin = qhat * pw * (1.0 - cs.n_disp[kk]);
            let mut tn = if dt > 0.0 {
                cs.n_tf[kk] + (q_pin + q_ox - film * (cs.n_tf[kk] - cs.n_tc[kk])) * dt / x_tau_f(k)
            } else {
                cs.n_tc[kk] + (q_pin + q_ox) / js_max(film, 1e-9)
            };
            if tn > k.tmelt && cs.n_dmg[kk] >= 1.0 && cs.n_melt[kk] + cs.n_disp[kk] < 1.0 {
                let room = (1.0 - cs.n_melt[kk] - cs.n_disp[kk]) * FUSE_DT;
                let paid = js_min(tn - k.tmelt, room);
                cs.n_melt[kk] = js_min(1.0, cs.n_melt[kk] + paid / FUSE_DT);
                tn = k.tmelt + (tn - k.tmelt - paid);
            }
            if dt > 0.0 {
                let h_f = FUEL_CP * (tn - T_STP) + cs.n_melt[kk] * FUSE_KJ;
                if h_f > DISP_H {
                    cs.n_disp[kk] = js_max(cs.n_disp[kk], clamp((h_f - DISP_H) / DISP_SPAN, 0.0, 1.0));
                    cs.n_dmg[kk] = js_max(cs.n_dmg[kk], cs.n_disp[kk]);
                }
                let fr = js_max(cs.n_disp[kk], cs.n_melt[kk]) * (1.0 - clamp(cs.n_v[kk], 0.0, 1.0));
                if fr > 0.0 && tn > cs.n_tc[kk] {
                    let d_t = (tn - cs.n_tc[kk]) * js_min(1.0, fr * FCI_ETA * (1.0 - crate::fdlibm::exp(-dt / FCI_TAU)));
                    tn -= d_t;
                    fci_e += d_t * node_w(kk);
                }
            }
            cs.n_tf[kk] = clamp(tn, 0.0, 6000.0);

            if ecr_of(cs.n_ox[kk]) >= 1.0 {
                cs.n_dmg[kk] = 1.0;
            } else {
                let dp = P_FILL * tcl / T_FILL - cs.p_core;
                let tb = burst_t(dp, k.burst_r);
                if tcl > tb {
                    cs.n_dmg[kk] = js_min(
                        1.0,
                        cs.n_dmg[kk] + clamp((tcl - tb) / BURST_SPAN, 0.0, 1.0) * dt / BURST_TAU,
                    );
                }
            }

            let fl = cs.n * pw;
            cs.x_i[kk] = js_max(0.0, cs.x_i[kk] + (k.g_i * fl - k.lam_i * cs.x_i[kk]) * dt);
            cs.x_x[kk] = js_max(
                0.0,
                cs.x_x[kk]
                    + (k.g_x * fl + k.lam_i * cs.x_i[kk] - k.lam_x * cs.x_x[kk] - k.sig * fl * cs.x_x[kk]) * dt,
            );

            let r_i = clamp(k.a_f * (cs.n_tf[kk] - k.tf_ref), -6000.0, 3000.0)
                + clamp(k.a_m * (cs.n_tc[kk] - k.tref), -6000.0, 2500.0)
                + clamp(
                    k.a_x * (cs.n_tf[kk] - k.tf_ref) + k.a_s * (cs.n_tc[kk] - k.tref),
                    -6000.0,
                    2500.0,
                )
                + k.a_v * cs.n_v[kk]
                - k.kxe * cs.x_x[kk]
                - k.rod_a * cs.n_cov[kk]
                + k.tip_rho * cs.n_fol[kk]
                - k.poison * (k.poi_g[i] - 1.0)
                - k.n_pen[i]
                + k.enr_rho[i];
            dis_k[kk] = -cs.n_disp[kk] * (1e5 + r_i);
            cs.n_rho[kk] = r_i + dis_k[kk];
        }
    }

    {
        let v = js_max(mflux, 1e-3) * k.g0 / js_max(rho_at(t_cold, k.rho0, k.rho_beta, k.plant_tref), 1.0);
        let tau = clamp(js_max(k.core_hgt, 0.05) / js_max(v, 1e-3), 0.1, 60.0);
        for kk in 0..XNN {
            let v_t = clamp(js_max(cs.n_vt[kk], v_leak), 0.0, 1.0);
            cs.n_v[kk] += (v_t - cs.n_v[kk]) * dt / tau;
            cs.n_tc[kk] += (cs.n_tct[kk] - cs.n_tc[kk]) * dt / tau;
        }
    }

    core_solve(k, &mut cs.phi, &cs.n_rho, SOR_SWEEPS);

    let mut o = CoreO::default();
    let mut x = 0.0;
    let mut ii = 0.0;
    let mut vv = 0.0;
    let mut tf = 0.0;
    let mut tf_h = 0.0;
    let mut top = 0.0;
    let mut bot = 0.0;
    let mut inn = 0.0;
    let mut outt = 0.0;
    let mut w2t = 0.0;
    for i in 0..XNR {
        for j in 0..XNZ {
            let kk = xix(i, j);
            let v = node_w(kk);
            let w = v * cs.phi[kk];
            let w2 = w * cs.phi[kk];
            o.o[0] += w2 * clamp(k.a_f * (cs.n_tf[kk] - k.tf_ref), -6000.0, 3000.0);
            o.o[1] += w2 * clamp(k.a_m * (cs.n_tc[kk] - k.tref), -6000.0, 2500.0);
            o.o[2] += w2
                * clamp(
                    k.a_x * (cs.n_tf[kk] - k.tf_ref) + k.a_s * (cs.n_tc[kk] - k.tref),
                    -6000.0,
                    2500.0,
                );
            o.o[3] += w2 * k.a_v * cs.n_v[kk];
            o.o[4] += w2 * -k.kxe * cs.x_x[kk];
            o.o[5] += w2 * -k.rod_a * cs.n_cov[kk];
            o.o[6] += w2 * k.tip_rho * cs.n_fol[kk];
            o.o[7] += w2 * dis_k[kk];
            w2t += w2;
            x += v * cs.x_x[kk];
            ii += v * cs.x_i[kk];
            vv += v * cs.n_v[kk];
            tf += w * cs.n_tf[kk];
            if cs.n_tf[kk] > tf_h {
                tf_h = cs.n_tf[kk];
            }
            if j >= XNZ / 2 {
                top += w;
            } else {
                bot += w;
            }
            if i < XNR / 2 {
                inn += w;
            } else {
                outt += w;
            }
        }
    }
    if w2t > 0.0 {
        for q in 0..8 {
            o.o[q] /= w2t;
        }
    }
    let hot = node_peak(&cs.phi);
    cs.fq = hot.0;
    cs.hot_ring = hot.2 as f64;
    cs.hot_lev = hot.3 as f64;
    cs.ao = (top - bot) / js_max(top + bot, 1e-6);
    cs.ro = (inn - outt) / js_max(inn + outt, 1e-6);
    // cs.x/cs.i are dump-only commission leftovers: the march writes cs.X/
    // cs.I (core2d.js:517), nothing reads the lowercase pair. Same for
    // cs.t_clad_hot below (march: cs.TcladHot). Leave S0 values untouched.
    let _ = (x, ii);
    cs.tf = tf;
    cs.tf_hot = tf_h;
    cs.v_node = vv;
    cs.tip_rho_out = o.o[6];
    cs.hot_flow = js_max(mflux * cs.ch_w[hot.2], 0.02);
    let mut dm = 0.0;
    let mut mf = 0.0;
    for kk in 0..XNN {
        dm += node_w(kk) * cs.n_dmg[kk];
        mf += node_w(kk) * cs.n_melt[kk];
    }
    cs.dmg = js_min(100.0, 100.0 * dm);
    cs.melt_frac = mf;
    o.o[8] = h2;
    cs.ox_max = ecr_h;
    let _ = tcl_h;
    o.o[9] = if dt > 0.0 { fci_e * x_tau_f(k) * k.pin_ua / dt } else { 0.0 };
    cs.q_ox = ox_p * k.pin_ua / js_max(k.rated * 1000.0, 1e-9);
    cs.dnbr_min = dnb_lo;
    cs.dnbr_ring = (dnb_k / XNZ) as f64;
    cs.dnbr_lev = (dnb_k % XNZ) as f64;
    o
}

#[inline]
fn ring_w(i: usize) -> f64 {
    let mut t = 0.0;
    for q in 0..XNR {
        t += (2 * q + 1) as f64;
    }
    (2 * i + 1) as f64 / t
}

#[inline]
fn x_tau_f(k: &CoreK) -> f64 {
    XTAU_F * k.rod_d / ROD_D0
}

/// Vessel tail: void fraction, reactivity parts, total rho. `boron` is the
/// dumped `S.boron`.
pub fn vessel_tail(o: &CoreO, excess: f64, boron: f64, v_leak: f64, v_node: f64) -> ([f64; 9], f64, f64) {
    let vf = clamp(js_max(v_leak, v_node), 0.0, 1.6);
    let parts = [o.o[5], o.o[0], o.o[1], o.o[2], o.o[4], o.o[3], o.o[6], o.o[7], boron];
    let rho = excess + parts[0] + parts[1] + parts[2] + parts[3] + parts[4] + parts[5] + parts[6] + parts[7]
        + parts[8];
    (parts, rho, vf)
}

/// Damage stage index (`fuelStage`); indexes `RELK`.
pub fn fuel_stage(n_melt: f64, n_disp: f64, n_ox: f64, n_dmg: f64, n_tube: f64) -> usize {
    if n_melt > 0.0 {
        5
    } else if n_disp > 0.0 {
        4
    } else if ecr_of(n_ox) >= OX_ECR_FAIL {
        3
    } else if n_dmg > 0.0 {
        2
    } else if n_tube > 0.0 {
        1
    } else {
        0
    }
}

/// `coreFatigueStep`: injection-driven vessel fatigue.
pub fn fatigue_step(fatigue: f64, dt: f64, inj: f64) -> f64 {
    fatigue + 0.35 * dt * clamp(inj / 1.6, 0.0, 2.0)
}

/// `coreBurstStep` logic for a non-tube vessel. Returns (breach, tripped).
pub fn burst_logic(breach: bool, p_core: f64, burst_p: f64) -> (bool, bool) {
    if !breach && p_core > burst_p {
        (true, true)
    } else {
        (breach, false)
    }
}

/// Melt mass removal (`coreMeltStep` first block). Returns (new_have, booked).
pub fn melt_mass(have: Option<f64>, melt_frac: f64, dt: f64, loop_kg: f64) -> (Option<f64>, f64) {
    match have {
        None => (None, 0.0),
        Some(h) => {
            let want = MELT_INV * melt_frac * dt / 100.0 * loop_kg;
            let kg = js_min(want, js_max(h, 0.0));
            (Some(h - kg), kg)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qual_helpers() {
        assert_eq!(sub_qual(0.0, 1.0), 0.0);
        assert_eq!(drift_flux(0.0, 0.5), 0.0);
        assert_eq!(void_qual(2.0, 0.5), void_qual(1.0, 0.5));
        let (v, k, i, j) = node_peak(&[1.0, 3.0, 3.0]);
        assert_eq!((v, k, i, j), (3.0, 1, 0, 1));
    }

    #[test]
    fn kinetics_floor() {
        let k = CoreK {
            nb: 1, sat: Curve::new(1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0),
            n0: 1.0, tf_ref: 900.0, tref: 560.0, rod_a: 1.0, tip_rho: 0.0, tip_len: 1.0,
            poison: 0.0, poi_g: vec![1.0; XNR], n_pen: vec![0.0; XNR], enr_rho: vec![0.0; XNR],
            mix: 0.5, dt0: 30.0, dh: 0.01, a_heat: 1.0, g0: 1.0, film_pool: 0.0,
            x_sub: 0.0, x_sub_lo: 0.0, hfg: 1.0, flow_k: 1.0, pin_ua: 1.0, g_solid: 1.0,
            clad_r: 0.5, rod_d: 0.0095, tmelt: 3000.0, oxid: false, kxe: 0.0,
            a_f: 0.0, a_m: 0.0, a_x: 0.0, a_s: 0.0, a_v: 0.0, excess: 0.0, dnbr_k: 1.0,
            dnb_law: 0, tdmg: 0.0, dryout: false, rated: 1.0, scram: 1.0, rod_rate: 0.01,
            burst_k: 1.0, p0: 15.0, core_kg0: 1.0, tube: false, beta: 0.006,
            bet: vec![0.0; 6], lam: vec![1.0; 6], lam_big: 1.0,
            g_i: 0.0, lam_i: 0.0, g_x: 0.0, lam_x: 0.0, sig: 0.0,
            cr: 0.1, cz: 0.1, alb_r: 0.5, alb_t: 0.5, alb_b: 0.5, rinf: 2.2,
            bank_r: vec![7.0], bank_w: vec![0.0], rinf_w: vec![1.0; XNR],
            burst_r: 1.0, rho0: 700.0, rho_beta: 0.0025, plant_tref: 560.0,
            core_hgt: 4.0,
        };
        let mut cs = CoreState::default();
        cs.n = 0.0;
        cs.c = vec![0.0; 6];
        kinetics_step(&k, &mut cs, 0.02);
        assert!(cs.n >= 1e-9);
    }
}

/// Live core-tail readers (step-gate.js:1617-1642 post_kinetics).
pub const LOOP_TRANSIT: f64 = 12.0;

/// `satT(K.sat, pCore)`: delegates to eos saturation temperature.
pub fn live_sat_t(sat: &Curve, p_core: f64) -> f64 {
    sat_t(sat, p_core)
}

/// `tiltRate(K) = rodRate(K)/XTILTZ` (step.js:2122).
pub fn live_tilt_rate(rod_rate: f64) -> f64 {
    rod_rate / XTILTZ
}

/// `coreDTMax = coreDT0()*8.3` (gate :109 + pipenet 744).
pub fn live_core_dt_max(core_dt0: f64) -> f64 {
    core_dt0 * 8.3
}

/// `loopKg()` (step.js:1026): frozen inventory else rated correlation.
pub fn live_loop_kg(inv_kg0: f64, rated: f64, sat_cp: f64, core_dt0: f64) -> f64 {
    if inv_kg0 > 0.0 {
        inv_kg0
    } else {
        rated * 1000.0 / (sat_cp * core_dt0) * LOOP_TRANSIT
    }
}

/// `vLeak` (gate :111-114): void-fraction leak off vessel inventory.
pub fn live_v_leak(core_kg0: f64, m: Option<f64>, tc_defined_and_hot: bool, rvl: f64) -> f64 {
    let mm = match m {
        Some(v) => v,
        None => return 0.0,
    };
    if core_kg0.is_nan() || core_kg0 <= 0.0 || tc_defined_and_hot {
        return 0.0;
    }
    js_max(0.0, (1.0 - mm / core_kg0) / js_max(1.0 - rvl, 1e-3))
}

/// `coreInH(S,id)` (step.js:889): advect core inlet book else Tavg algebra.
/// hv is the transport core-book value (field datum); +cp*H_DATUM converts.
pub fn live_core_in_h(
    hv: Option<f64>,
    hm: bool,
    sat_cp: f64,
    h_datum: f64,
    tavg: f64,
    core_dt0: f64,
    heat: f64,
) -> f64 {
    if hm {
        if let Some(v) = hv {
            return v + sat_cp * h_datum;
        }
    }
    sat_cp * (tavg - core_dt0 * heat / 2.0)
}

/// Tube taken-detection (gate :1597-1599): grew open or trip changed.
pub fn tube_taken(pre_open: f64, pre_trip: &str, post_open: f64, post_trip: &str) -> bool {
    let a = if pre_open.is_nan() || pre_open == 0.0 { 0.0 } else { pre_open };
    let b = if post_open.is_nan() || post_open == 0.0 { 0.0 } else { post_open };
    b > a || post_trip != pre_trip
}
